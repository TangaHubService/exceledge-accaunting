import {
  assertTaxCodeUsable,
  buildTaxAdjustmentLines,
  buildTaxPaymentLines,
  defaultAccountKeyForTaxType,
  reverseJournalLines,
  roundMoney,
  taxReconciliation,
  taxTypeDirection,
  vatReturnTotals,
  type JournalLineDraft,
  type TaxFilingKind,
  type TaxType,
} from "@exceledge/accounting-domain";
import type { TaxCode } from "@prisma/client";
import { defaultsFor, money, nextNumber } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createJournal, postJournal } from "../journals/journal.service";
import { glBalance, isoDay, startOfDay, endOfDay } from "../banking/banking.service";

export type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

const DAY = 86_400_000;

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, beforeJson, afterJson, ...actor.meta });
}

async function postTax(
  companyId: string,
  input: {
    journalDate: Date;
    description: string;
    referenceNumber?: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string;
    lines: JournalLineDraft[];
  },
  actor: Actor,
) {
  const journal = await createJournal(
    companyId,
    {
      journalDate: input.journalDate,
      journalType: "AUTOMATIC",
      description: input.description,
      referenceNumber: input.referenceNumber,
      currencyCode: "RWF",
      sourceModule: "TAX",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      status: "APPROVED",
      lines: input.lines,
    },
    actor,
  );
  return postJournal(companyId, journal.id, actor);
}

function range(from?: string, to?: string) {
  const end = to ? endOfDay(to) : endOfDay(new Date());
  const start = from ? startOfDay(from) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  if (start > end) throw new Error("The start date must be on or before the end date");
  return { start, end };
}

async function accountName(companyId: string, id: string | null | undefined) {
  if (!id) return null;
  const a = await prisma.account.findFirst({ where: { id, companyId }, select: { id: true, code: true, name: true } });
  return a;
}

async function resolveTaxAccount(companyId: string, taxType: TaxType, taxCodeId?: string | null) {
  if (taxCodeId) {
    const code = await prisma.taxCode.findFirst({ where: { id: taxCodeId, companyId } });
    if (!code) throw new Error("Tax code does not exist");
    if (code.glAccountId) return { accountId: code.glAccountId, taxCode: code };
  }
  const defaults = await defaultsFor(companyId);
  const key = defaultAccountKeyForTaxType(taxType);
  const accountId = key ? (defaults[key] as string | null | undefined) : null;
  if (!accountId) throw new Error(`Map a GL account for ${taxType.replace(/_/g, " ").toLowerCase()} in Company setup or on the tax code`);
  return { accountId, taxCode: taxCodeId ? await prisma.taxCode.findFirst({ where: { id: taxCodeId, companyId } }) : null };
}

/** Movement on a tax GL account in a period. Payable: credit − debit. Recoverable: debit − credit. */
async function taxAccountMovement(
  companyId: string,
  accountId: string,
  from: Date,
  to: Date,
  direction: "PAYABLE" | "RECOVERABLE" | "MEMO",
  options: { excludeTaxSettlements?: boolean } = {},
) {
  if (options.excludeTaxSettlements) {
    const entries = await prisma.glEntry.findMany({
      where: { companyId, accountId, transactionDate: { gte: from, lte: to } },
      include: { journal: { select: { sourceDocumentType: true } } },
    });
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      if (
        e.sourceModule === "TAX" &&
        (e.journal.sourceDocumentType === "TaxPayment" || e.journal.sourceDocumentType === "TaxPaymentReversal")
      ) {
        continue;
      }
      debit += money(e.debit);
      credit += money(e.credit);
    }
    if (direction === "RECOVERABLE") return roundMoney(debit - credit);
    if (direction === "MEMO") return 0;
    return roundMoney(credit - debit);
  }

  const sum = await prisma.glEntry.aggregate({
    where: { companyId, accountId, transactionDate: { gte: from, lte: to } },
    _sum: { debit: true, credit: true },
  });
  const debit = money(sum._sum.debit);
  const credit = money(sum._sum.credit);
  if (direction === "RECOVERABLE") return roundMoney(debit - credit);
  if (direction === "MEMO") return 0;
  return roundMoney(credit - debit);
}

/* ── Settings & codes ───────────────────────────────────── */

const RW_SEED: Array<{ code: string; name: string; taxType: TaxType; ratePercent: number }> = [
  { code: "VAT18", name: "VAT 18%", taxType: "OUTPUT_VAT", ratePercent: 18 },
  { code: "VAT0", name: "VAT zero-rated", taxType: "ZERO_RATED", ratePercent: 0 },
  { code: "VATEX", name: "VAT exempt", taxType: "EXEMPT", ratePercent: 0 },
  { code: "VATIN", name: "Input VAT 18%", taxType: "INPUT_VAT", ratePercent: 18 },
  { code: "WHT3", name: "Withholding tax 3%", taxType: "WHT_PAYABLE", ratePercent: 3 },
  { code: "WHT15", name: "Withholding tax 15%", taxType: "WHT_PAYABLE", ratePercent: 15 },
];

export async function ensureTaxSettings(companyId: string, actor: Actor = {}) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: { profile: true, localization: true, taxSettings: true },
  });
  let settings = company.taxSettings;
  if (!settings) {
    settings = await prisma.taxSettings.create({
      data: {
        companyId,
        taxAuthority: company.localization?.taxAuthority ?? "RRA",
        tin: company.profile?.taxIdentificationNumber ?? null,
        vatRegistered: Boolean(company.profile?.taxIdentificationNumber),
        vatFilingFrequency: company.localization?.taxFilingFrequency ?? "MONTHLY",
        taxCurrency: "RWF",
        roundingMethod: "HALF_UP",
      },
    });
    await audit(companyId, actor, "CREATE", "TaxSettings", settings.id, settings);
  }
  const existing = await prisma.taxCode.count({ where: { companyId } });
  if (existing === 0 && (company.localization?.countryOfRegistration === "RW" || company.localization?.localizationPackage === "RW")) {
    const defaults = await defaultsFor(companyId);
    const from = startOfDay("2020-01-01");
    for (const seed of RW_SEED) {
      const key = defaultAccountKeyForTaxType(seed.taxType);
      await prisma.taxCode.create({
        data: {
          companyId,
          code: seed.code,
          name: seed.name,
          taxType: seed.taxType,
          ratePercent: seed.ratePercent,
          glAccountId: key ? ((defaults[key] as string | null | undefined) ?? null) : null,
          authority: "RRA",
          effectiveFrom: from,
          appliesTo: seed.taxType.startsWith("WHT") ? "PURCHASES" : seed.taxType === "INPUT_VAT" ? "PURCHASES" : "SALES",
          createdByErpUserId: actor.erpUserId,
        },
      });
    }
  }
  return settings;
}

export async function getTaxSettings(companyId: string) {
  await ensureTaxSettings(companyId);
  const settings = await prisma.taxSettings.findUniqueOrThrow({ where: { companyId } });
  const codes = await listTaxCodes(companyId, { includeInactive: true });
  return { ...settings, codes };
}

export async function updateTaxSettings(
  companyId: string,
  input: {
    taxAuthority?: string | null;
    tin?: string | null;
    vatRegistered?: boolean;
    vatFilingFrequency?: string | null;
    taxCurrency?: string;
    roundingMethod?: string | null;
    defaultOutputTaxCodeId?: string | null;
    defaultInputTaxCodeId?: string | null;
    defaultWhtTaxCodeId?: string | null;
    notes?: string | null;
  },
  actor: Actor = {},
) {
  await ensureTaxSettings(companyId, actor);
  const before = await prisma.taxSettings.findUniqueOrThrow({ where: { companyId } });
  for (const id of [input.defaultOutputTaxCodeId, input.defaultInputTaxCodeId, input.defaultWhtTaxCodeId]) {
    if (id && !(await prisma.taxCode.findFirst({ where: { id, companyId } }))) throw new Error("Tax code does not exist");
  }
  const updated = await prisma.taxSettings.update({
    where: { companyId },
    data: {
      taxAuthority: input.taxAuthority === undefined ? undefined : input.taxAuthority,
      tin: input.tin === undefined ? undefined : input.tin,
      vatRegistered: input.vatRegistered,
      vatFilingFrequency: input.vatFilingFrequency === undefined ? undefined : input.vatFilingFrequency,
      taxCurrency: input.taxCurrency,
      roundingMethod: input.roundingMethod === undefined ? undefined : input.roundingMethod,
      defaultOutputTaxCodeId: input.defaultOutputTaxCodeId === undefined ? undefined : input.defaultOutputTaxCodeId,
      defaultInputTaxCodeId: input.defaultInputTaxCodeId === undefined ? undefined : input.defaultInputTaxCodeId,
      defaultWhtTaxCodeId: input.defaultWhtTaxCodeId === undefined ? undefined : input.defaultWhtTaxCodeId,
      notes: input.notes === undefined ? undefined : input.notes,
    },
  });
  await audit(companyId, actor, "UPDATE", "TaxSettings", updated.id, updated, before);
  return getTaxSettings(companyId);
}

function serializeCode(c: TaxCode & { gl?: { code: string; name: string } | null }) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    taxType: c.taxType,
    ratePercent: money(c.ratePercent),
    glAccountId: c.glAccountId,
    glAccountCode: c.gl?.code ?? null,
    glAccountName: c.gl?.name ?? null,
    authority: c.authority,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    isActive: c.isActive,
    appliesTo: c.appliesTo,
    notes: c.notes,
  };
}

export async function listTaxCodes(companyId: string, options: { includeInactive?: boolean; taxType?: TaxType } = {}) {
  await ensureTaxSettings(companyId);
  const rows = await prisma.taxCode.findMany({
    where: {
      companyId,
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(options.taxType ? { taxType: options.taxType } : {}),
    },
    orderBy: [{ taxType: "asc" }, { code: "asc" }],
  });
  const accounts = await prisma.account.findMany({
    where: { companyId, id: { in: rows.map((r) => r.glAccountId).filter(Boolean) as string[] } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((c) => serializeCode({ ...c, gl: c.glAccountId ? byId.get(c.glAccountId) ?? null : null }));
}

export async function createTaxCode(
  companyId: string,
  input: {
    code: string;
    name: string;
    taxType: TaxType;
    ratePercent: number;
    glAccountId?: string | null;
    authority?: string | null;
    effectiveFrom: string;
    effectiveTo?: string | null;
    appliesTo?: string | null;
    notes?: string | null;
  },
  actor: Actor = {},
) {
  await ensureTaxSettings(companyId, actor);
  const code = input.code.trim().toUpperCase();
  if (await prisma.taxCode.findFirst({ where: { companyId, code } })) throw new Error(`Tax code ${code} already exists`);
  if (!(input.ratePercent >= 0) || input.ratePercent > 100) throw new Error("Rate must be between 0 and 100");
  if (input.glAccountId) {
    const gl = await prisma.account.findFirst({ where: { id: input.glAccountId, companyId } });
    if (!gl) throw new Error("GL account does not exist");
    if (!gl.isActive) throw new Error(`${gl.code} ${gl.name} is inactive`);
  }
  const created = await prisma.taxCode.create({
    data: {
      companyId,
      code,
      name: input.name.trim(),
      taxType: input.taxType,
      ratePercent: roundMoney(input.ratePercent),
      glAccountId: input.glAccountId ?? null,
      authority: input.authority,
      effectiveFrom: startOfDay(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? startOfDay(input.effectiveTo) : null,
      appliesTo: input.appliesTo,
      notes: input.notes,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "TaxCode", created.id, created);
  const list = await listTaxCodes(companyId, { includeInactive: true });
  return list.find((c) => c.id === created.id)!;
}

export async function updateTaxCode(
  companyId: string,
  id: string,
  input: {
    name?: string;
    ratePercent?: number;
    glAccountId?: string | null;
    authority?: string | null;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    isActive?: boolean;
    appliesTo?: string | null;
    notes?: string | null;
  },
  actor: Actor = {},
) {
  const before = await prisma.taxCode.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Tax code does not exist");
  if (input.ratePercent !== undefined && (!(input.ratePercent >= 0) || input.ratePercent > 100)) throw new Error("Rate must be between 0 and 100");
  if (input.glAccountId) {
    const gl = await prisma.account.findFirst({ where: { id: input.glAccountId, companyId } });
    if (!gl) throw new Error("GL account does not exist");
  }
  const updated = await prisma.taxCode.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      ratePercent: input.ratePercent === undefined ? undefined : roundMoney(input.ratePercent),
      glAccountId: input.glAccountId === undefined ? undefined : input.glAccountId,
      authority: input.authority === undefined ? undefined : input.authority,
      effectiveFrom: input.effectiveFrom ? startOfDay(input.effectiveFrom) : undefined,
      effectiveTo: input.effectiveTo === undefined ? undefined : input.effectiveTo ? startOfDay(input.effectiveTo) : null,
      isActive: input.isActive,
      appliesTo: input.appliesTo === undefined ? undefined : input.appliesTo,
      notes: input.notes === undefined ? undefined : input.notes,
    },
  });
  await audit(companyId, actor, "UPDATE", "TaxCode", updated.id, updated, before);
  const list = await listTaxCodes(companyId, { includeInactive: true });
  return list.find((c) => c.id === updated.id)!;
}

/* ── Dashboard & reports ────────────────────────────────── */

export async function taxDashboard(companyId: string) {
  await ensureTaxSettings(companyId);
  const defaults = await defaultsFor(companyId);
  const settings = await prisma.taxSettings.findUniqueOrThrow({ where: { companyId } });
  const today = isoDay(new Date());
  const month = range(`${today.slice(0, 8)}01`, today);
  const year = range(`${today.slice(0, 4)}-01-01`, today);

  const outputId = defaults.outputTaxPayableId;
  const inputId = defaults.inputTaxReceivableId;
  const whtId = defaults.withholdingTaxPayableId;
  const payeId = defaults.payrollTaxPayableId;

  const [outputBal, inputBal, whtBal, payeBal, outputMtd, inputMtd, whtMtd] = await Promise.all([
    outputId ? glBalance(companyId, outputId) : 0,
    inputId ? glBalance(companyId, inputId) : 0,
    whtId ? glBalance(companyId, whtId) : 0,
    payeId ? glBalance(companyId, payeId) : 0,
    outputId ? taxAccountMovement(companyId, outputId, month.start, month.end, "PAYABLE") : 0,
    inputId ? taxAccountMovement(companyId, inputId, month.start, month.end, "RECOVERABLE") : 0,
    whtId ? taxAccountMovement(companyId, whtId, month.start, month.end, "PAYABLE") : 0,
  ]);

  const vatPayable = roundMoney(Math.max(0, -outputBal));
  const vatReceivable = roundMoney(Math.max(0, inputBal));
  const whtPayable = roundMoney(Math.max(0, -whtBal));
  const payePayable = roundMoney(Math.max(0, -payeBal));

  const payments = await prisma.taxPayment.findMany({
    where: { companyId, status: "POSTED", paymentDate: { gte: year.start, lte: year.end } },
    orderBy: { paymentDate: "desc" },
    take: 8,
  });
  const filings = await prisma.taxFiling.findMany({
    where: { companyId },
    orderBy: { periodTo: "desc" },
    take: 6,
  });
  const openFilings = await prisma.taxFiling.count({ where: { companyId, status: { in: ["DRAFT", "PREPARED"] } } });
  const dueSoon = filings.filter((f) => f.status !== "FILED" && f.dueDate && f.dueDate.getTime() <= Date.now() + 30 * DAY);

  const recentPayments = await Promise.all(
    payments.map(async (p) => ({
      id: p.id,
      number: p.number,
      paymentDate: p.paymentDate,
      taxType: p.taxType,
      amount: money(p.amount),
      isRefund: p.isRefund,
      reference: p.reference,
    })),
  );

  return {
    settings: {
      taxAuthority: settings.taxAuthority,
      tin: settings.tin,
      vatRegistered: settings.vatRegistered,
      vatFilingFrequency: settings.vatFilingFrequency,
    },
    balances: {
      vatPayable,
      vatReceivable,
      vatNetDue: roundMoney(vatPayable - vatReceivable),
      withholdingPayable: whtPayable,
      payePayable,
      totalOutstanding: roundMoney(vatPayable - vatReceivable + whtPayable + payePayable),
    },
    month: {
      from: month.start,
      to: month.end,
      outputVat: outputMtd,
      inputVat: inputMtd,
      withholding: whtMtd,
      vatNet: roundMoney(outputMtd - inputMtd),
    },
    openFilings,
    dueSoon: dueSoon.map((f) => ({ id: f.id, number: f.number, kind: f.kind, dueDate: f.dueDate, status: f.status })),
    recentFilings: filings.map((f) => ({
      id: f.id,
      number: f.number,
      kind: f.kind,
      status: f.status,
      periodFrom: f.periodFrom,
      periodTo: f.periodTo,
      filedAt: f.filedAt,
      filingReference: f.filingReference,
    })),
    recentPayments,
  };
}

export async function vatReport(companyId: string, from?: string, to?: string) {
  await ensureTaxSettings(companyId);
  const { start, end } = range(from, to);
  const defaults = await defaultsFor(companyId);
  if (!defaults.outputTaxPayableId || !defaults.inputTaxReceivableId) throw new Error("Map output and input VAT accounts in Company setup");

  const [outputEntries, inputEntries, adjustments, paid] = await Promise.all([
    prisma.glEntry.findMany({
      where: { companyId, accountId: defaults.outputTaxPayableId, transactionDate: { gte: start, lte: end } },
      include: { journal: { select: { sourceDocumentNumber: true, sourceDocumentType: true } } },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.glEntry.findMany({
      where: { companyId, accountId: defaults.inputTaxReceivableId, transactionDate: { gte: start, lte: end } },
      include: { journal: { select: { sourceDocumentNumber: true, sourceDocumentType: true } } },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.taxAdjustment.findMany({
      where: { companyId, adjustmentDate: { gte: start, lte: end }, taxType: { in: ["OUTPUT_VAT", "INPUT_VAT"] } },
      orderBy: { adjustmentDate: "asc" },
    }),
    prisma.taxPayment.findMany({
      where: {
        companyId,
        status: "POSTED",
        paymentDate: { gte: start, lte: end },
        taxType: { in: ["OUTPUT_VAT", "INPUT_VAT"] },
      },
      orderBy: { paymentDate: "asc" },
    }),
  ]);

  // Gross output/input exclude tax payments so the return schedule and the payment total stay separate.
  // Tax adjustments stay in the GL gross (they change VAT due) and are surfaced separately for the schedule.
  const isTaxPayment = (e: { sourceModule: string | null; journal: { sourceDocumentType: string | null } }) =>
    e.sourceModule === "TAX" && (e.journal.sourceDocumentType === "TaxPayment" || e.journal.sourceDocumentType === "TaxPaymentReversal");

  const scheduleOutput = outputEntries.filter((e) => !isTaxPayment(e));
  const scheduleInput = inputEntries.filter((e) => !isTaxPayment(e));

  const outputLines = scheduleOutput.map((e) => ({
    id: e.id,
    date: e.transactionDate,
    journalId: e.journalId,
    journalNumber: e.journalNumber,
    description: e.description,
    sourceModule: e.sourceModule,
    sourceDocumentNumber: e.journal.sourceDocumentNumber,
    debit: money(e.debit),
    credit: money(e.credit),
    amount: roundMoney(money(e.credit) - money(e.debit)),
  }));
  const inputLines = scheduleInput.map((e) => ({
    id: e.id,
    date: e.transactionDate,
    journalId: e.journalId,
    journalNumber: e.journalNumber,
    description: e.description,
    sourceModule: e.sourceModule,
    sourceDocumentNumber: e.journal.sourceDocumentNumber,
    debit: money(e.debit),
    credit: money(e.credit),
    amount: roundMoney(money(e.debit) - money(e.credit)),
  }));

  const outputGross = roundMoney(scheduleOutput.reduce((s, e) => s + money(e.credit) - money(e.debit), 0));
  const inputGross = roundMoney(scheduleInput.reduce((s, e) => s + money(e.debit) - money(e.credit), 0));
  const paidTotal = roundMoney(
    paid.filter((p) => !p.isRefund).reduce((s, p) => s + money(p.amount), 0) - paid.filter((p) => p.isRefund).reduce((s, p) => s + money(p.amount), 0),
  );
  const adjustmentNet = roundMoney(
    adjustments.reduce((s, a) => {
      const amt = money(a.amount);
      if (a.taxType === "OUTPUT_VAT") return s + (a.increasesLiability ? amt : -amt);
      return s + (a.increasesLiability ? -amt : amt);
    }, 0),
  );

  // Adjustments are already in the GL gross; keep them out of vatReturnTotals so they are not double-counted.
  const totals = { ...vatReturnTotals({ output: outputGross, input: inputGross, adjustments: 0, paid: paidTotal }), adjustments: adjustmentNet };
  return {
    from: start,
    to: end,
    outputAccount: await accountName(companyId, defaults.outputTaxPayableId),
    inputAccount: await accountName(companyId, defaults.inputTaxReceivableId),
    totals,
    outputLines,
    inputLines,
    payments: paid.map((p) => ({
      id: p.id,
      number: p.number,
      paymentDate: p.paymentDate,
      amount: money(p.amount),
      isRefund: p.isRefund,
      reference: p.reference,
    })),
  };
}

export async function taxLedger(companyId: string, options: { taxType?: TaxType; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  await ensureTaxSettings(companyId);
  const defaults = await defaultsFor(companyId);
  const { start, end } = range(options.from, options.to);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

  const accountIds: string[] = [];
  const typeForAccount = new Map<string, TaxType>();
  const map: Array<[TaxType, string | null | undefined]> = [
    ["OUTPUT_VAT", defaults.outputTaxPayableId],
    ["INPUT_VAT", defaults.inputTaxReceivableId],
    ["WHT_PAYABLE", defaults.withholdingTaxPayableId],
    ["WHT_RECEIVABLE", defaults.withholdingTaxReceivableId],
    ["PAYE", defaults.payrollTaxPayableId],
  ];
  for (const [type, id] of map) {
    if (!id) continue;
    if (options.taxType && options.taxType !== type) continue;
    accountIds.push(id);
    typeForAccount.set(id, type);
  }
  if (!accountIds.length) return { from: start, to: end, page, pageSize, total: 0, openingBalance: 0, rows: [], closingBalance: 0 };

  const openingAgg = await prisma.glEntry.aggregate({
    where: { companyId, accountId: { in: accountIds }, transactionDate: { lt: start } },
    _sum: { debit: true, credit: true },
  });
  let opening = roundMoney(money(openingAgg._sum.debit) - money(openingAgg._sum.credit));

  const where = { companyId, accountId: { in: accountIds }, transactionDate: { gte: start, lte: end } };
  const total = await prisma.glEntry.count({ where });
  const entries = await prisma.glEntry.findMany({
    where,
    include: { journal: true, account: { select: { id: true, code: true, name: true } } },
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // Running balance needs all prior rows on this page's window when paging from the start of the period
  const priorOnPage = page > 1
    ? await prisma.glEntry.findMany({
        where,
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
        take: (page - 1) * pageSize,
        select: { debit: true, credit: true },
      })
    : [];
  let running = opening;
  for (const e of priorOnPage) running = roundMoney(running + money(e.debit) - money(e.credit));

  const rows = entries.map((e) => {
    running = roundMoney(running + money(e.debit) - money(e.credit));
    return {
      id: e.id,
      date: e.transactionDate,
      taxType: typeForAccount.get(e.accountId) ?? "OTHER",
      accountCode: e.account.code,
      accountName: e.account.name,
      journalId: e.journalId,
      journalNumber: e.journalNumber,
      reference: e.referenceNumber ?? e.journal.sourceDocumentNumber,
      description: e.description,
      sourceModule: e.sourceModule,
      debit: money(e.debit),
      credit: money(e.credit),
      balance: running,
    };
  });

  const periodAgg = await prisma.glEntry.aggregate({ where, _sum: { debit: true, credit: true } });
  const closing = roundMoney(opening + money(periodAgg._sum.debit) - money(periodAgg._sum.credit));

  return { from: start, to: end, page, pageSize, total, openingBalance: opening, rows, closingBalance: closing };
}

export async function taxReconciliationReport(companyId: string, options: { from?: string; to?: string } = {}) {
  await ensureTaxSettings(companyId);
  const { start, end } = range(options.from, options.to);
  const defaults = await defaultsFor(companyId);
  const vat = await vatReport(companyId, isoDay(start), isoDay(end));
  const filed = await prisma.taxFiling.findFirst({
    where: { companyId, kind: "VAT", status: "FILED", periodFrom: { lte: start }, periodTo: { gte: end } },
    orderBy: { filedAt: "desc" },
  });
  const filedNet = filed?.summary && typeof filed.summary === "object" && filed.summary !== null && "net" in (filed.summary as object)
    ? Number((filed.summary as { net: number }).net)
    : null;

  const ebm = await prisma.fiscalDocument.aggregate({
    where: { companyId, occurredAt: { gte: start, lte: end } },
    _sum: { taxAmount: true },
  });
  const ebmTax = money(ebm._sum.taxAmount);

  const glOutput = defaults.outputTaxPayableId
    ? await taxAccountMovement(companyId, defaults.outputTaxPayableId, start, end, "PAYABLE", { excludeTaxSettlements: true })
    : 0;
  const glInput = defaults.inputTaxReceivableId
    ? await taxAccountMovement(companyId, defaults.inputTaxReceivableId, start, end, "RECOVERABLE", { excludeTaxSettlements: true })
    : 0;
  const recon = taxReconciliation({
    ledger: vat.totals.net,
    gl: roundMoney(glOutput - glInput),
    filed: filedNet,
    ebm: ebmTax || null,
  });

  const wht = await prisma.apPayment.aggregate({
    where: { companyId, status: "POSTED", withholdingTax: { gt: 0 }, paymentDate: { gte: start, lte: end } },
    _sum: { withholdingTax: true },
  });
  const whtGl = defaults.withholdingTaxPayableId
    ? await taxAccountMovement(companyId, defaults.withholdingTaxPayableId, start, end, "PAYABLE")
    : 0;

  return {
    from: start,
    to: end,
    vat: recon,
    withholding: {
      ledger: money(wht._sum.withholdingTax),
      gl: whtGl,
      difference: roundMoney(money(wht._sum.withholdingTax) - whtGl),
    },
    fiscalDocuments: await prisma.fiscalDocument.count({ where: { companyId, occurredAt: { gte: start, lte: end } } }),
  };
}

/* ── Payments & adjustments ─────────────────────────────── */

export async function recordTaxPayment(
  companyId: string,
  input: {
    paymentDate: string;
    taxType: TaxType;
    taxCodeId?: string;
    taxAccountId?: string;
    bankAccountId?: string;
    financialAccountId?: string;
    amount: number;
    isRefund?: boolean;
    reference?: string;
    description?: string;
    periodFrom?: string;
    periodTo?: string;
  },
  actor: Actor = {},
) {
  await ensureTaxSettings(companyId, actor);
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  const resolved = await resolveTaxAccount(companyId, input.taxType, input.taxCodeId);
  const taxAccountId = input.taxAccountId || resolved.accountId;
  if (resolved.taxCode) {
    assertTaxCodeUsable({
      name: resolved.taxCode.name,
      isActive: resolved.taxCode.isActive,
      effectiveFrom: isoDay(resolved.taxCode.effectiveFrom),
      effectiveTo: resolved.taxCode.effectiveTo ? isoDay(resolved.taxCode.effectiveTo) : null,
      on: input.paymentDate.slice(0, 10),
    });
  }

  let bankAccountId = input.bankAccountId;
  if (input.financialAccountId) {
    const fa = await prisma.financialAccount.findFirst({ where: { id: input.financialAccountId, companyId } });
    if (!fa) throw new Error("Bank or cash account does not exist");
    if (!fa.isActive) throw new Error(`${fa.name} is inactive`);
    bankAccountId = fa.glAccountId;
  }
  if (!bankAccountId) {
    const defaults = await defaultsFor(companyId);
    bankAccountId = defaults.defaultBankAccountId ?? defaults.defaultCashAccountId ?? undefined;
  }
  if (!bankAccountId) throw new Error("Choose the bank or cash account the tax was paid from");

  const number = await nextNumber(companyId, "TAX_PAYMENT", "TXP");
  const paymentDate = startOfDay(input.paymentDate);
  const payment = await prisma.taxPayment.create({
    data: {
      companyId,
      number,
      paymentDate,
      taxType: input.taxType,
      taxCodeId: input.taxCodeId,
      taxAccountId,
      bankAccountId,
      financialAccountId: input.financialAccountId,
      amount,
      isRefund: Boolean(input.isRefund),
      reference: input.reference,
      description: input.description,
      periodFrom: input.periodFrom ? startOfDay(input.periodFrom) : null,
      periodTo: input.periodTo ? startOfDay(input.periodTo) : null,
      createdByErpUserId: actor.erpUserId,
    },
  });

  const lines = buildTaxPaymentLines({
    taxAccountId,
    bankAccountId,
    amount,
    refund: Boolean(input.isRefund),
    description: input.description || (input.isRefund ? `Tax refund ${number}` : `Tax payment ${number}`),
  });
  const journal = await postTax(
    companyId,
    {
      journalDate: paymentDate,
      description: input.description || (input.isRefund ? `Tax refund ${number}` : `Tax payment ${number}`),
      referenceNumber: input.reference || number,
      sourceDocumentType: "TaxPayment",
      sourceDocumentId: payment.id,
      sourceDocumentNumber: number,
      lines,
    },
    actor,
  );
  const updated = await prisma.taxPayment.update({ where: { id: payment.id }, data: { journalId: journal.id } });
  await audit(companyId, actor, "POST", "TaxPayment", payment.id, { ...updated, amount });
  return getTaxPayment(companyId, payment.id);
}

export async function getTaxPayment(companyId: string, id: string) {
  const p = await prisma.taxPayment.findFirst({ where: { id, companyId } });
  if (!p) throw new Error("Tax payment does not exist");
  const journal = p.journalId ? await prisma.journal.findFirst({ where: { id: p.journalId, companyId }, select: { id: true, journalNumber: true } }) : null;
  const taxAccount = await accountName(companyId, p.taxAccountId);
  const bankAccount = await accountName(companyId, p.bankAccountId);
  return {
    ...p,
    amount: money(p.amount),
    journalNumber: journal?.journalNumber ?? null,
    taxAccount,
    bankAccount,
  };
}

export async function listTaxPayments(companyId: string, options: { from?: string; to?: string; taxType?: TaxType; page?: number; pageSize?: number } = {}) {
  const { start, end } = range(options.from, options.to);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50));
  const where = {
    companyId,
    paymentDate: { gte: start, lte: end },
    ...(options.taxType ? { taxType: options.taxType } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.taxPayment.count({ where }),
    prisma.taxPayment.findMany({ where, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return {
    page,
    pageSize,
    total,
    rows: rows.map((p) => ({
      id: p.id,
      number: p.number,
      paymentDate: p.paymentDate,
      taxType: p.taxType,
      amount: money(p.amount),
      isRefund: p.isRefund,
      status: p.status,
      reference: p.reference,
      description: p.description,
      journalId: p.journalId,
    })),
  };
}

export async function reverseTaxPayment(companyId: string, id: string, input: { reason: string; reversalDate?: string }, actor: Actor = {}) {
  const payment = await prisma.taxPayment.findFirst({ where: { id, companyId } });
  if (!payment) throw new Error("Tax payment does not exist");
  if (payment.status === "REVERSED") throw new Error("This payment is already reversed");
  if (!payment.journalId) throw new Error("Payment has no journal to reverse");
  const original = await prisma.journal.findFirst({ where: { id: payment.journalId, companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
  if (!original) throw new Error("Original journal was not found");
  const lines = reverseJournalLines(
    original.lines.map((l) => ({ accountId: l.accountId, description: l.description ?? undefined, debit: money(l.debit), credit: money(l.credit) })),
  );
  const reversalDate = startOfDay(input.reversalDate ?? isoDay());
  const journal = await postTax(
    companyId,
    {
      journalDate: reversalDate,
      description: `Reversal of ${payment.number}: ${input.reason}`,
      referenceNumber: payment.number,
      sourceDocumentType: "TaxPaymentReversal",
      sourceDocumentId: payment.id,
      sourceDocumentNumber: payment.number,
      lines,
    },
    actor,
  );
  const updated = await prisma.taxPayment.update({
    where: { id },
    data: {
      status: "REVERSED",
      reversalJournalId: journal.id,
      reversedAt: new Date(),
      reversedByErpUserId: actor.erpUserId,
      reversalReason: input.reason,
    },
  });
  await audit(companyId, actor, "REVERSE", "TaxPayment", id, updated, payment);
  return getTaxPayment(companyId, id);
}

export async function recordTaxAdjustment(
  companyId: string,
  input: {
    adjustmentDate: string;
    taxType: TaxType;
    taxCodeId?: string;
    taxAccountId?: string;
    contraAccountId: string;
    amount: number;
    increasesLiability?: boolean;
    reason: string;
    reference?: string;
  },
  actor: Actor = {},
) {
  await ensureTaxSettings(companyId, actor);
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  if (!input.reason.trim()) throw new Error("Give a reason for the adjustment");
  const resolved = await resolveTaxAccount(companyId, input.taxType, input.taxCodeId);
  const taxAccountId = input.taxAccountId || resolved.accountId;
  const contra = await prisma.account.findFirst({ where: { id: input.contraAccountId, companyId } });
  if (!contra) throw new Error("Contra account does not exist");
  if (!contra.isActive) throw new Error(`${contra.code} ${contra.name} is inactive`);

  const number = await nextNumber(companyId, "TAX_ADJUSTMENT", "TXA");
  const adjustmentDate = startOfDay(input.adjustmentDate);
  const row = await prisma.taxAdjustment.create({
    data: {
      companyId,
      number,
      adjustmentDate,
      taxType: input.taxType,
      taxCodeId: input.taxCodeId,
      taxAccountId,
      contraAccountId: input.contraAccountId,
      amount,
      increasesLiability: input.increasesLiability !== false,
      reason: input.reason.trim(),
      reference: input.reference,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const lines = buildTaxAdjustmentLines({
    taxAccountId,
    contraAccountId: input.contraAccountId,
    amount,
    increase: input.increasesLiability !== false,
    description: input.reason.trim(),
  });
  const journal = await postTax(
    companyId,
    {
      journalDate: adjustmentDate,
      description: `Tax adjustment ${number}: ${input.reason.trim()}`,
      referenceNumber: input.reference || number,
      sourceDocumentType: "TaxAdjustment",
      sourceDocumentId: row.id,
      sourceDocumentNumber: number,
      lines,
    },
    actor,
  );
  await prisma.taxAdjustment.update({ where: { id: row.id }, data: { journalId: journal.id } });
  await audit(companyId, actor, "POST", "TaxAdjustment", row.id, { ...row, amount, journalId: journal.id });
  return {
    id: row.id,
    number,
    adjustmentDate,
    taxType: input.taxType,
    amount,
    increasesLiability: input.increasesLiability !== false,
    reason: input.reason.trim(),
    journalId: journal.id,
    journalNumber: journal.journalNumber,
  };
}

/* ── Filings ────────────────────────────────────────────── */

export async function listFilings(companyId: string, options: { kind?: TaxFilingKind } = {}) {
  const rows = await prisma.taxFiling.findMany({
    where: { companyId, ...(options.kind ? { kind: options.kind } : {}) },
    orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((f) => ({
    id: f.id,
    number: f.number,
    kind: f.kind,
    status: f.status,
    periodFrom: f.periodFrom,
    periodTo: f.periodTo,
    dueDate: f.dueDate,
    preparedAt: f.preparedAt,
    filedAt: f.filedAt,
    filingReference: f.filingReference,
    summary: f.summary,
  }));
}

export async function getFiling(companyId: string, id: string) {
  const f = await prisma.taxFiling.findFirst({ where: { id, companyId } });
  if (!f) throw new Error("Tax filing does not exist");
  return {
    ...f,
    summary: f.summary,
  };
}

export async function prepareFiling(
  companyId: string,
  input: { kind: TaxFilingKind; periodFrom: string; periodTo: string; dueDate?: string; notes?: string },
  actor: Actor = {},
) {
  await ensureTaxSettings(companyId, actor);
  const from = startOfDay(input.periodFrom);
  const to = endOfDay(input.periodTo);
  if (from > to) throw new Error("The period start must be on or before the end");

  const open = await prisma.taxFiling.findFirst({
    where: { companyId, kind: input.kind, status: { in: ["DRAFT", "PREPARED"] }, periodFrom: from, periodTo: startOfDay(input.periodTo) },
  });
  if (open) throw new Error(`A ${input.kind} filing for this period is already open (${open.number})`);

  let summary: Record<string, unknown>;
  if (input.kind === "VAT") {
    const vat = await vatReport(companyId, input.periodFrom, input.periodTo);
    summary = { ...vat.totals, outputLineCount: vat.outputLines.length, inputLineCount: vat.inputLines.length };
  } else if (input.kind === "WHT") {
    const payments = await prisma.apPayment.findMany({
      where: { companyId, status: "POSTED", withholdingTax: { gt: 0 }, paymentDate: { gte: from, lte: to } },
      include: { supplier: true },
    });
    summary = {
      payments: payments.length,
      totalWithheld: roundMoney(payments.reduce((s, p) => s + money(p.withholdingTax), 0)),
      totalSettled: roundMoney(payments.reduce((s, p) => s + money(p.amount) + money(p.withholdingTax), 0)),
    };
  } else {
    summary = { note: `${input.kind} returns are prepared from payroll or other modules when those postings exist.` };
  }

  const number = await nextNumber(companyId, "TAX_FILING", "FIL");
  const filing = await prisma.taxFiling.create({
    data: {
      companyId,
      number,
      kind: input.kind,
      status: "PREPARED",
      periodFrom: from,
      periodTo: startOfDay(input.periodTo),
      dueDate: input.dueDate ? startOfDay(input.dueDate) : null,
      preparedAt: new Date(),
      preparedByErpUserId: actor.erpUserId,
      summary,
      notes: input.notes,
    },
  });
  await audit(companyId, actor, "PREPARE", "TaxFiling", filing.id, filing);
  return getFiling(companyId, filing.id);
}

export async function fileFiling(companyId: string, id: string, input: { filingReference?: string; filedAt?: string }, actor: Actor = {}) {
  const filing = await prisma.taxFiling.findFirst({ where: { id, companyId } });
  if (!filing) throw new Error("Tax filing does not exist");
  if (filing.status === "FILED") throw new Error("This return is already filed");
  if (filing.status !== "PREPARED") throw new Error("Prepare the return before marking it filed");
  const updated = await prisma.taxFiling.update({
    where: { id },
    data: {
      status: "FILED",
      filedAt: input.filedAt ? startOfDay(input.filedAt) : new Date(),
      filedByErpUserId: actor.erpUserId,
      filingReference: input.filingReference ?? filing.filingReference,
    },
  });
  await audit(companyId, actor, "FILE", "TaxFiling", id, updated, filing);
  return getFiling(companyId, id);
}

export async function discardFiling(companyId: string, id: string, actor: Actor = {}) {
  const filing = await prisma.taxFiling.findFirst({ where: { id, companyId } });
  if (!filing) throw new Error("Tax filing does not exist");
  if (filing.status === "FILED") throw new Error("A filed return can't be deleted");
  await prisma.taxFiling.delete({ where: { id } });
  await audit(companyId, actor, "DELETE", "TaxFiling", id, null, filing);
  return { id };
}

/* ── Fiscal documents (EBM linkage) ─────────────────────── */

export async function listFiscalDocuments(companyId: string, options: { from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const { start, end } = range(options.from, options.to);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50));
  const where = { companyId, occurredAt: { gte: start, lte: end } };
  const [total, rows] = await Promise.all([
    prisma.fiscalDocument.count({ where }),
    prisma.fiscalDocument.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return {
    page,
    pageSize,
    total,
    totals: {
      net: roundMoney(rows.reduce((s, r) => s + money(r.netAmount), 0)),
      tax: roundMoney(rows.reduce((s, r) => s + money(r.taxAmount), 0)),
      gross: roundMoney(rows.reduce((s, r) => s + money(r.grossAmount), 0)),
    },
    rows: rows.map((r) => ({
      id: r.id,
      sourceDocumentType: r.sourceDocumentType,
      sourceDocumentId: r.sourceDocumentId,
      sourceDocumentNumber: r.sourceDocumentNumber,
      occurredAt: r.occurredAt,
      netAmount: money(r.netAmount),
      taxAmount: money(r.taxAmount),
      grossAmount: money(r.grossAmount),
      vsdcInvoiceNumber: r.vsdcInvoiceNumber,
      sdcReceiptNumber: r.sdcReceiptNumber,
      journalId: r.journalId,
    })),
  };
}

/** Called when a SALE_COMPLETED (or similar) event carries EBM/fiscal metadata. */
export async function recordFiscalDocumentFromEvent(
  companyId: string,
  input: {
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string;
    occurredAt: Date | string;
    net: number;
    tax: number;
    gross: number;
    currencyCode?: string;
    journalId?: string | null;
    integrationEventId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const meta = input.metadata ?? {};
  const vsdc = meta.vsdcInvoiceNumber ?? meta.vsdcInvcNo ?? meta.fiscalInvoiceNumber;
  const sdc = meta.sdcReceiptNumber ?? meta.receiptNumber ?? meta.sdcRcptNo;
  const signature = meta.receiptSignature ?? meta.vsdcSignature ?? meta.rcptSign;
  const internal = meta.internalData ?? meta.ysdcintdata;
  const qr = meta.qrCode ?? meta.qr;
  if (!vsdc && !sdc && !signature && !qr) return null;

  return prisma.fiscalDocument.upsert({
    where: {
      companyId_sourceDocumentType_sourceDocumentId: {
        companyId,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
      },
    },
    create: {
      companyId,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      occurredAt: new Date(input.occurredAt),
      netAmount: roundMoney(input.net),
      taxAmount: roundMoney(input.tax),
      grossAmount: roundMoney(input.gross),
      currencyCode: input.currencyCode ?? "RWF",
      vsdcInvoiceNumber: vsdc != null ? String(vsdc) : null,
      sdcReceiptNumber: sdc != null ? String(sdc) : null,
      receiptSignature: signature != null ? String(signature) : null,
      internalData: internal != null ? String(internal) : null,
      qrCode: qr != null ? String(qr) : null,
      journalId: input.journalId ?? null,
      integrationEventId: input.integrationEventId ?? null,
      metadata: meta as object,
    },
    update: {
      sourceDocumentNumber: input.sourceDocumentNumber,
      netAmount: roundMoney(input.net),
      taxAmount: roundMoney(input.tax),
      grossAmount: roundMoney(input.gross),
      vsdcInvoiceNumber: vsdc != null ? String(vsdc) : undefined,
      sdcReceiptNumber: sdc != null ? String(sdc) : undefined,
      receiptSignature: signature != null ? String(signature) : undefined,
      internalData: internal != null ? String(internal) : undefined,
      qrCode: qr != null ? String(qr) : undefined,
      journalId: input.journalId ?? undefined,
      integrationEventId: input.integrationEventId ?? undefined,
    },
  });
}

import {
  assertJournalBalanced,
  convertJournalLines,
  isDebitNormal,
  reverseJournalLines,
  sumJournalLines,
  transactionTiming,
  type BookAccountType,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { JournalStatus, JournalType, PeriodStatus, Prisma } from "@prisma/client";
import { allocateNumber } from "../../lib/numbering";
import { inTransaction, prisma } from "../../lib/prisma";
import { approvalControls, latestApprovalFor, planFor, requestApproval, resubmitApproval } from "../approvals/approval.service";
import { writeAudit } from "../audit/audit.service";
import { enforceBudget } from "../books/budget.service";

type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

const SYSTEM_JOURNAL_TYPES = new Set<JournalType>(["AUTOMATIC", "OPENING_BALANCE", "REVERSAL"]);

function nextJournalNumber(companyId: string, journalDate: Date, branchId?: string) {
  return allocateNumber(companyId, "JOURNAL_ENTRY", "JE", { date: journalDate, branchId });
}

async function assertCompanyActivated(companyId: string) {
  const activation = await prisma.accountingActivation.findUnique({ where: { companyId } });
  if (!activation || activation.status !== "ACTIVATED") {
    throw new Error("Accounting is not activated for this company");
  }
}

/**
 * Periods are generated as FUTURE; one opens the first time something is dated in it
 * once its start date has arrived. Closed and locked periods stay shut.
 */
export async function assertOpenPeriod(companyId: string, date: Date, opts: { forClose?: boolean } = {}) {
  const period = await prisma.accountingPeriod.findFirst({
    where: { financialYear: { companyId }, startDate: { lte: date }, endDate: { gte: date } },
    include: { financialYear: true },
  });
  if (!period) {
    throw new Error("No accounting period covers the journal date");
  }
  const lockDate = period.financialYear.transactionLockDate;
  if (lockDate && date <= lockDate) {
    throw new Error(`Transactions dated on or before ${lockDate.toISOString().slice(0, 10)} are locked`);
  }
  if (period.status === "FUTURE" && period.startDate <= new Date()) {
    await prisma.accountingPeriod.updateMany({ where: { id: period.id, status: "FUTURE" }, data: { status: "OPEN" } });
  }
  // FOR SHARE holds off a close of this period until the posting transaction ends, and sees a close that committed first.
  const [row] = await prisma.$queryRaw<Array<{ status: PeriodStatus }>>`
    SELECT status::text AS status FROM "accounting_periods" WHERE id = ${period.id} FOR SHARE`;
  const status = row?.status ?? period.status;
  // Year-end closing journals may post while the period is held for close approval.
  const open = status === "OPEN" || status === "REOPENED" || (opts.forClose && status === "TEMPORARILY_LOCKED");
  if (!open) {
    throw new Error(`Accounting period ${period.name} is ${status.toLowerCase().replace("_", " ")}`);
  }
  return { ...period, status };
}

/** Opens every FUTURE period that has started, e.g. after activation or a new financial year. */
export async function openStartedPeriods(companyId: string, asOf = new Date()) {
  const result = await prisma.accountingPeriod.updateMany({
    where: { financialYear: { companyId }, status: "FUTURE", startDate: { lte: asOf } },
    data: { status: "OPEN" },
  });
  return result.count;
}

const MANUAL_SOURCES = new Set(["IMPORT", "RECURRING"]);

/** Journals keyed by a person (screen, CSV import, recurring template) rather than produced by a module. */
export function isManualEntry(input: { journalType?: JournalType; sourceModule?: string }) {
  return (input.journalType ?? "MANUAL") === "MANUAL" && (!input.sourceModule || MANUAL_SOURCES.has(input.sourceModule));
}

export async function functionalCurrency(companyId: string) {
  return (await prisma.currencySettings.findUnique({ where: { companyId } }))?.functionalCurrency ?? "RWF";
}

export async function assertAccountsPostable(
  companyId: string,
  accountIds: string[],
  opts: { manual?: boolean; currency?: string; functional?: string; revaluation?: boolean } = {},
) {
  const accounts = await prisma.account.findMany({
    where: { companyId, id: { in: accountIds } },
  });
  if (accounts.length !== new Set(accountIds).size) {
    throw new Error("One or more journal accounts were not found");
  }
  const defaults = opts.manual
    ? await prisma.defaultPostingAccounts.findUnique({ where: { companyId } })
    : null;
  const control = new Map<string, string>();
  if (defaults?.accountsReceivableId) control.set(defaults.accountsReceivableId, "receivables");
  if (defaults?.accountsPayableId) control.set(defaults.accountsPayableId, "payables");
  if (defaults?.inventoryAssetId) control.set(defaults.inventoryAssetId, "inventory");
  for (const a of accounts) {
    if (!a.isActive) throw new Error(`Account ${a.code} is inactive`);
    if (opts.manual) {
      const kind = control.get(a.id) ?? (a.isInventoryAccount ? "inventory" : undefined);
      if (kind) {
        throw new Error(`Account ${a.code} is the ${kind} control account; post through the ${kind} module so its subledger stays in step`);
      }
      if (!a.allowManualPost) throw new Error(`Account ${a.code} does not accept manual journals`);
    } else if (!a.allowAutoPost) {
      throw new Error(`Account ${a.code} does not accept automatic postings`);
    }
    const kept = a.currency?.toUpperCase();
    if (kept && opts.functional && kept !== opts.functional && kept !== opts.currency && !opts.revaluation) {
      throw new Error(`Account ${a.code} is kept in ${kept}; post to it in ${kept}`);
    }
  }
  return accounts;
}

async function rateFor(companyId: string, currency: string, date: Date) {
  const rate = await prisma.exchangeRate.findFirst({
    where: { companyId, currency, rateDate: { lte: date } },
    orderBy: { rateDate: "desc" },
  });
  if (!rate) throw new Error(`No ${currency} exchange rate is on file on or before ${date.toISOString().slice(0, 10)}`);
  return Number(rate.rate);
}

type JournalInput = {
  journalDate: Date | string;
  journalType?: JournalType;
  description?: string;
  referenceNumber?: string;
  /** Lines are in this currency; when it is not the functional currency they are converted at `exchangeRate`. */
  currencyCode?: string;
  exchangeRate?: number;
  branchId?: string;
  costCentre?: string;
  project?: string;
  status?: JournalStatus;
  sourceModule?: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  sourceDocumentNumber?: string;
  integrationEventId?: string;
  lines: Array<JournalLineDraft & { amountForeign?: number }>;
};

/**
 * Journals keyed on the journal screen or imported from CSV go through approvals, date policies
 * and the different-poster rule. Recurring templates and module postings do not.
 */
export function underJournalControls(j: { journalType?: JournalType | null; sourceModule?: string | null }) {
  return (j.journalType ?? "MANUAL") === "MANUAL" && (!j.sourceModule || j.sourceModule === "IMPORT");
}

/** Cost centres and projects must be active dimensions; branches on manual entries must be company branches. */
export async function assertDimensions(
  companyId: string,
  values: { costCentres: Array<string | null | undefined>; projects: Array<string | null | undefined>; branchIds?: Array<string | null | undefined> },
) {
  const costCentres = [...new Set(values.costCentres.filter((v): v is string => Boolean(v)))];
  const projects = [...new Set(values.projects.filter((v): v is string => Boolean(v)))];
  if (costCentres.length || projects.length) {
    const found = await prisma.dimension.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [{ kind: "COST_CENTRE", code: { in: costCentres } }, { kind: "PROJECT", code: { in: projects } }],
      },
    });
    for (const code of costCentres) {
      if (!found.some((d) => d.kind === "COST_CENTRE" && d.code === code)) throw new Error(`Cost centre ${code} is not an active cost centre`);
    }
    for (const code of projects) {
      if (!found.some((d) => d.kind === "PROJECT" && d.code === code)) throw new Error(`Project ${code} is not an active project`);
    }
  }
  const branchIds = [...new Set((values.branchIds ?? []).filter((v): v is string => Boolean(v)))];
  if (branchIds.length) {
    const branches = await prisma.companyBranch.findMany({
      where: { companyId, OR: [{ id: { in: branchIds } }, { externalErpBranchId: { in: branchIds } }] },
    });
    for (const id of branchIds) {
      const branch = branches.find((b) => b.id === id || b.externalErpBranchId === id);
      if (!branch) throw new Error(`Branch ${id} is not a branch of this company`);
      if (!branch.isActive) throw new Error(`Branch ${branch.name ?? branch.code ?? id} is inactive`);
    }
  }
}

/** Backdated/future-dated classification of a date and the setup policy that applies to it. */
export async function datePolicyFor(companyId: string, date: Date, now = new Date()) {
  const current = await prisma.accountingPeriod.findFirst({
    where: { financialYear: { companyId }, startDate: { lte: now }, endDate: { gte: now } },
  });
  const timing = transactionTiming(date, now, current?.startDate);
  const controls = await approvalControls(companyId);
  const policy = timing === "BACKDATED" ? controls.backdated : timing === "FUTURE" ? controls.futureDated : "ALLOW";
  return { timing, policy };
}

async function prepareJournal(companyId: string, input: JournalInput) {
  await assertCompanyActivated(companyId);
  assertJournalBalanced(input.lines);
  const journalDate = new Date(input.journalDate);
  await assertOpenPeriod(companyId, journalDate, { forClose: input.sourceModule === "CLOSE" });

  if (underJournalControls(input)) {
    const { timing, policy } = await datePolicyFor(companyId, journalDate);
    if (policy === "BLOCK") throw new Error(`${timing === "BACKDATED" ? "Backdated" : "Future-dated"} journals are not allowed by the company's posting controls`);
  }

  const functional = await functionalCurrency(companyId);
  const currency = (input.currencyCode ?? functional).toUpperCase();
  let rate = 1;
  let lines = input.lines.map((l) => ({
    ...l,
    costCentre: l.costCentre || input.costCentre || undefined,
    project: l.project || input.project || undefined,
    branchId: l.branchId || input.branchId || undefined,
  }));
  if (currency !== functional) {
    // Rounded to the column's 8 decimals so a reversal at the stored rate cancels exactly.
    rate = Math.round((input.exchangeRate ?? (await rateFor(companyId, currency, journalDate))) * 1e8) / 1e8;
    lines = convertJournalLines(lines, rate);
  }
  const manual = isManualEntry(input);
  await assertAccountsPostable(
    companyId,
    lines.map((l) => l.accountId),
    { manual, currency, functional, revaluation: input.sourceModule === "FX" },
  );
  await assertDimensions(companyId, {
    costCentres: lines.map((l) => l.costCentre),
    projects: lines.map((l) => l.project),
    branchIds: manual ? lines.map((l) => l.branchId) : [],
  });
  return { journalDate, currency, rate, lines, totals: sumJournalLines(lines) };
}

function lineRows(companyId: string, lines: Awaited<ReturnType<typeof prepareJournal>>["lines"]) {
  return lines.map((l, idx) => ({
    companyId,
    lineNumber: idx + 1,
    accountId: l.accountId,
    description: l.description,
    debit: l.debit,
    credit: l.credit,
    amountForeign: (l as { amountForeign?: number }).amountForeign,
    taxCode: l.taxCode,
    customerRef: l.customerRef,
    supplierRef: l.supplierRef,
    costCentre: l.costCentre,
    project: l.project,
    branchId: l.branchId,
  }));
}

export async function createJournal(companyId: string, input: JournalInput, actor: Actor = {}) {
  const { journalDate, currency, rate, lines, totals } = await prepareJournal(companyId, input);
  const journalNumber = await nextJournalNumber(companyId, journalDate, input.branchId);

  const journal = await prisma.journal.create({
    data: {
      companyId,
      journalNumber,
      journalDate,
      journalType: input.journalType ?? "MANUAL",
      status: input.status ?? "DRAFT",
      referenceNumber: input.referenceNumber,
      description: input.description,
      currencyCode: currency,
      exchangeRate: rate,
      branchId: input.branchId,
      costCentre: input.costCentre,
      project: input.project,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      createdByErpUserId: actor.erpUserId,
      sourceModule: input.sourceModule,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      integrationEventId: input.integrationEventId,
      lines: { create: lineRows(companyId, lines) },
    },
    include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } },
  });

  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "CREATE",
    entityType: "Journal",
    entityId: journal.id,
    afterJson: { id: journal.id, journalNumber: journal.journalNumber, status: journal.status },
    ...actor.meta,
  });

  return journal;
}

export async function postJournal(companyId: string, journalId: string, actor: Actor = {}) {
  await assertCompanyActivated(companyId);

  return inTransaction(async () => {
    const tx = prisma;
    // Row lock: a second post of the same draft waits here, then sees it posted.
    await tx.journal.updateMany({ where: { id: journalId, companyId }, data: { updatedAt: new Date() } });
    const journal = await tx.journal.findFirst({
      where: { id: journalId, companyId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!journal) throw new Error("Journal not found");
    if (journal.status === "POSTED") return journal;
    if (journal.status === "REVERSED" || journal.status === "CANCELLED") {
      throw new Error(`Cannot post journal in status ${journal.status}`);
    }
    if (journal.status === "SUBMITTED" || journal.status === "UNDER_REVIEW") {
      throw new Error(`Journal ${journal.journalNumber} is waiting for approval`);
    }
    if (underJournalControls(journal)) {
      const requirement = await journalApprovalRequirement(companyId, journal);
      if (requirement.required && journal.status !== "APPROVED") {
        throw new Error(`Journal ${journal.journalNumber} needs approval before posting (${requirement.reasons.join("; ")}); submit it for approval`);
      }
      if (requirement.requireDifferentPoster && actor.erpUserId && journal.createdByErpUserId === actor.erpUserId) {
        throw new Error("You created this journal; someone else must post it");
      }
      if (requirement.supportingDocumentRequired && !(await hasSupportingDocument(companyId, journal.id))) {
        throw new Error("Attach a supporting document before posting this journal");
      }
    }

    const drafts: JournalLineDraft[] = journal.lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description ?? undefined,
    }));
    assertJournalBalanced(drafts);
    await assertOpenPeriod(companyId, journal.journalDate, { forClose: journal.sourceModule === "CLOSE" });

    const postingDate = new Date();
    for (const line of journal.lines) {
      // Balances are stored debit-positive. The increment locks the account row, so
      // concurrent posts cannot overwrite each other.
      const account = await tx.account.update({
        where: { id: line.accountId },
        data: {
          currentBalance: { increment: Number(line.debit) - Number(line.credit) },
          hasPostedTransactions: true,
        },
      });
      const nextBalance = account.currentBalance;
      if (!account.allowNegativeBalance) {
        const natural = isDebitNormal(account.type as BookAccountType) ? Number(nextBalance) : -Number(nextBalance);
        if (natural < -0.0001) throw new Error(`Posting would take account ${account.code} below zero`);
      }
      await tx.glEntry.create({
        data: {
          companyId,
          accountId: line.accountId,
          journalId: journal.id,
          journalLineId: line.id,
          postingDate,
          transactionDate: journal.journalDate,
          journalNumber: journal.journalNumber,
          referenceNumber: journal.referenceNumber,
          sourceModule: journal.sourceModule,
          sourceDocumentType: journal.sourceDocumentType,
          sourceDocumentId: journal.sourceDocumentId,
          description: line.description ?? journal.description,
          debit: line.debit,
          credit: line.credit,
          runningBalance: nextBalance,
          costCentre: line.costCentre ?? journal.costCentre,
          project: line.project ?? journal.project,
          branchId: line.branchId ?? journal.branchId,
          createdByErpUserId: actor.erpUserId,
        },
      });
    }

    if (journal.sourceDocumentType && journal.sourceDocumentId) {
      await tx.sourceDocumentLink.upsert({
        where: {
          companyId_sourceModule_sourceDocumentType_sourceDocumentId_journalId: {
            companyId,
            sourceModule: journal.sourceModule ?? "ACCOUNTING",
            sourceDocumentType: journal.sourceDocumentType,
            sourceDocumentId: journal.sourceDocumentId,
            journalId: journal.id,
          },
        },
        create: {
          companyId,
          journalId: journal.id,
          sourceModule: journal.sourceModule ?? "ACCOUNTING",
          sourceDocumentType: journal.sourceDocumentType,
          sourceDocumentId: journal.sourceDocumentId,
          sourceDocumentNumber: journal.sourceDocumentNumber,
        },
        update: {},
      });
    }

    const budgetWarnings = await enforceBudget(companyId, journal);

    const posted = await tx.journal.update({
      where: { id: journal.id },
      data: {
        status: "POSTED",
        postingDate,
        postedByErpUserId: actor.erpUserId,
      },
      include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } },
    });

    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId ?? 0,
      erpRole: actor.erpRole,
      action: "POST",
      entityType: "Journal",
      entityId: posted.id,
      afterJson: { journalNumber: posted.journalNumber, status: posted.status },
      ...actor.meta,
    });

    return { ...posted, budgetWarnings };
  });
}

/** Creates and posts a journal as one unit: if posting fails, no journal is left behind. */
export async function createAndPostJournal(
  companyId: string,
  input: Parameters<typeof createJournal>[1],
  actor: Actor = {},
) {
  return inTransaction(async () => {
    const journal = await createJournal(companyId, input, actor);
    return postJournal(companyId, journal.id, actor);
  });
}

export async function createAndSubmitJournal(companyId: string, input: JournalInput, actor: Actor = {}) {
  return inTransaction(async () => {
    const journal = await createJournal(companyId, input, actor);
    return submitJournal(companyId, journal.id, actor);
  });
}

/** Lines as they were entered: in the foreign currency when the journal had one, else functional. */
export function linesInJournalCurrency(
  lines: Array<{
    accountId: string;
    debit: Prisma.Decimal | number;
    credit: Prisma.Decimal | number;
    amountForeign: Prisma.Decimal | number | null;
    description: string | null;
    costCentre?: string | null;
    project?: string | null;
    branchId?: string | null;
  }>,
): JournalLineDraft[] {
  const foreign = lines.some((l) => l.amountForeign !== null);
  return lines.map((l) => {
    const f = Number(l.amountForeign ?? 0);
    return {
      accountId: l.accountId,
      debit: foreign ? Math.max(f, 0) : Number(l.debit),
      credit: foreign ? Math.max(-f, 0) : Number(l.credit),
      description: l.description ?? undefined,
      costCentre: l.costCentre ?? undefined,
      project: l.project ?? undefined,
      branchId: l.branchId ?? undefined,
    };
  });
}

/** Currency and rate of a posted journal, so a module reversing it posts back at the original rate. */
export async function reversalCurrency(companyId: string, journalId: string | null | undefined) {
  if (!journalId) return {};
  const journal = await prisma.journal.findFirst({ where: { id: journalId, companyId }, select: { currencyCode: true, exchangeRate: true } });
  return journal ? { currencyCode: journal.currencyCode, exchangeRate: Number(journal.exchangeRate) } : {};
}

async function reversalDate(companyId: string, originalDate: Date) {
  try {
    await assertOpenPeriod(companyId, originalDate);
    return originalDate;
  } catch {
    return new Date();
  }
}

export async function reverseJournal(
  companyId: string,
  journalId: string,
  actor: Actor = {},
  reason?: string,
) {
  const original = await prisma.journal.findFirst({
    where: { id: journalId, companyId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!original) throw new Error("Journal not found");
  if (original.status !== "POSTED") throw new Error("Only posted journals can be reversed");
  if (original.reversedJournalId) throw new Error("Journal already reversed");
  if (SYSTEM_JOURNAL_TYPES.has(original.journalType) || original.sourceModule === "CLOSE") {
    const source = original.sourceModule ? ` by ${original.sourceModule}` : "";
    throw new Error(`Journal ${original.journalNumber} was created${source}; reverse it from its source document`);
  }

  const foreign = original.lines.some((l) => l.amountForeign !== null);
  const reversalLines = reverseJournalLines(linesInJournalCurrency(original.lines));

  return inTransaction(async () => {
    const claimed = await prisma.journal.updateMany({
      where: { id: original.id, companyId, status: "POSTED", reversedJournalId: null },
      data: { status: "REVERSED" },
    });
    if (!claimed.count) throw new Error("Journal already reversed");
    const postedReversal = await createAndPostJournal(
      companyId,
      {
        journalDate: await reversalDate(companyId, original.journalDate),
        journalType: "REVERSAL",
        description: reason
          ? `Reversal of ${original.journalNumber}: ${reason}`
          : `Reversal of ${original.journalNumber}`,
        referenceNumber: original.journalNumber,
        currencyCode: foreign ? original.currencyCode : undefined,
        exchangeRate: foreign ? Number(original.exchangeRate) : undefined,
        branchId: original.branchId ?? undefined,
        sourceModule: original.sourceModule ?? undefined,
        sourceDocumentType: original.sourceDocumentType ?? undefined,
        sourceDocumentId: original.sourceDocumentId ?? undefined,
        sourceDocumentNumber: original.sourceDocumentNumber ?? undefined,
        lines: reversalLines,
        status: "DRAFT",
      },
      actor,
    );

    await prisma.journal.update({
      where: { id: original.id },
      data: { status: "REVERSED", reversedJournalId: postedReversal.id },
    });
    await prisma.journal.update({
      where: { id: postedReversal.id },
      data: { reversesJournalId: original.id },
    });

    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId ?? 0,
      erpRole: actor.erpRole,
      action: "REVERSE",
      entityType: "Journal",
      entityId: original.id,
      afterJson: { reversedBy: postedReversal.journalNumber },
      ...actor.meta,
    });

    return { originalId: original.id, reversal: postedReversal };
  });
}

export async function listJournals(
  companyId: string,
  filters: { status?: JournalStatus; q?: string; limit?: number } = {},
) {
  const where: Prisma.JournalWhereInput = { companyId };
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    where.OR = [
      { journalNumber: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
      { referenceNumber: { contains: filters.q, mode: "insensitive" } },
      { sourceDocumentNumber: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return prisma.journal.findMany({
    where,
    include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 50, 200),
  });
}

export async function getJournal(companyId: string, journalId: string) {
  const journal = await prisma.journal.findFirst({
    where: { id: journalId, companyId },
    include: {
      lines: { include: { account: true }, orderBy: { lineNumber: "asc" } },
      sourceDocumentLinks: true,
      glEntries: true,
    },
  });
  return journal && { ...journal, approval: await latestApprovalFor(companyId, "Journal", journal.id) };
}

async function hasSupportingDocument(companyId: string, journalId: string) {
  return (await prisma.accountingDocument.count({ where: { companyId, entityType: "Journal", entityId: journalId } })) > 0;
}

/** What a manual journal needs before it can be posted, and why. */
export async function journalApprovalRequirement(
  companyId: string,
  journal: { journalDate: Date; totalDebit: Prisma.Decimal | number; journalType?: JournalType | null; sourceModule?: string | null },
) {
  const controls = await approvalControls(companyId);
  if (!underJournalControls(journal)) {
    return {
      required: false,
      levels: 0,
      roles: [] as Array<string | null>,
      reasons: [] as string[],
      requireDifferentPoster: false,
      supportingDocumentRequired: false,
      plan: { levels: 0, roles: [] as string[] },
    };
  }
  const amount = Number(journal.totalDebit);
  const { timing, policy } = await datePolicyFor(companyId, journal.journalDate);
  const forced = policy === "REQUIRE_APPROVAL";
  const plan = await planFor(companyId, amount, forced);
  const reasons: string[] = [];
  if (forced) reasons.push(`${timing === "BACKDATED" ? "backdated" : "future-dated"} journals need approval`);
  const byAmount = await planFor(companyId, amount, false);
  if (byAmount.levels > 0) reasons.push(`${byAmount.levels} approval level(s) for ${amount.toLocaleString("en-US")}`);
  return {
    required: plan.levels > 0,
    levels: plan.levels,
    roles: Array.from({ length: plan.levels }, (_, i) => plan.roles[i] || null),
    reasons,
    requireDifferentPoster: controls.requireDifferentPoster,
    supportingDocumentRequired: controls.supportingDocumentRequired,
    plan,
  };
}

async function draftOrThrow(companyId: string, journalId: string) {
  const journal = await prisma.journal.findFirst({ where: { id: journalId, companyId } });
  if (!journal) throw new Error("Journal not found");
  if (!underJournalControls(journal)) throw new Error(`Journal ${journal.journalNumber} was created by ${journal.sourceModule ?? "the system"}; change it from its source`);
  if (journal.status !== "DRAFT") throw new Error(`Only a draft journal can be changed; ${journal.journalNumber} is ${journal.status.toLowerCase().replace("_", " ")}`);
  return journal;
}

/** Replaces a draft's header and lines; the number stays. A journal returned for correction is a draft again. */
export async function updateJournal(companyId: string, journalId: string, input: JournalInput, actor: Actor = {}) {
  return inTransaction(async () => {
    const before = await draftOrThrow(companyId, journalId);
    const prepared = await prepareJournal(companyId, { ...input, journalType: "MANUAL", sourceModule: before.sourceModule ?? undefined });
    await prisma.journalLine.deleteMany({ where: { journalId } });
    const journal = await prisma.journal.update({
      where: { id: journalId },
      data: {
        journalDate: prepared.journalDate,
        description: input.description,
        referenceNumber: input.referenceNumber,
        currencyCode: prepared.currency,
        exchangeRate: prepared.rate,
        branchId: input.branchId,
        costCentre: input.costCentre,
        project: input.project,
        totalDebit: prepared.totals.debit,
        totalCredit: prepared.totals.credit,
        lines: { create: lineRows(companyId, prepared.lines) },
      },
      include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } },
    });
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId ?? 0,
      erpRole: actor.erpRole,
      action: "UPDATE",
      entityType: "Journal",
      entityId: journalId,
      beforeJson: { journalDate: before.journalDate, totalDebit: before.totalDebit, description: before.description },
      afterJson: { journalDate: journal.journalDate, totalDebit: journal.totalDebit, description: journal.description },
      ...actor.meta,
    });
    return journal;
  });
}

export async function cancelJournal(companyId: string, journalId: string, actor: Actor = {}) {
  return inTransaction(async () => {
    const before = await draftOrThrow(companyId, journalId);
    const journal = await prisma.journal.update({ where: { id: journalId }, data: { status: "CANCELLED" } });
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId ?? 0,
      erpRole: actor.erpRole,
      action: "CANCEL",
      entityType: "Journal",
      entityId: journalId,
      beforeJson: { status: before.status },
      afterJson: { status: journal.status },
      ...actor.meta,
    });
    return journal;
  });
}

/**
 * Sends a draft for approval. When no approval applies the journal becomes APPROVED at once;
 * a journal returned for correction reuses its approval request, starting again at level 1.
 */
export async function submitJournal(companyId: string, journalId: string, actor: Actor = {}) {
  return inTransaction(async () => {
    const journal = await draftOrThrow(companyId, journalId);
    await assertOpenPeriod(companyId, journal.journalDate);
    const requirement = await journalApprovalRequirement(companyId, journal);
    if (requirement.supportingDocumentRequired && !(await hasSupportingDocument(companyId, journal.id))) {
      throw new Error("Attach a supporting document before submitting this journal");
    }
    let approval = null;
    if (requirement.required) {
      const returned = await prisma.approvalRequest.findFirst({
        where: { companyId, entityType: "Journal", entityId: journal.id, status: "RETURNED" },
        orderBy: { createdAt: "desc" },
      });
      const amount = Number(journal.totalDebit);
      approval = returned
        ? await resubmitApproval(companyId, returned.id, actor, { amount, plan: requirement.plan })
        : await requestApproval(
            companyId,
            { entityType: "Journal", entityId: journal.id, amount, reason: requirement.reasons.join("; "), plan: requirement.plan },
            actor,
          );
    }
    const updated = await prisma.journal.update({
      where: { id: journal.id },
      data: requirement.required ? { status: "SUBMITTED" } : { status: "APPROVED" },
      include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } },
    });
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId ?? 0,
      erpRole: actor.erpRole,
      action: "SUBMIT",
      entityType: "Journal",
      entityId: journal.id,
      beforeJson: { status: journal.status },
      afterJson: { status: updated.status, approvalId: approval?.id ?? null },
      ...actor.meta,
    });
    return { journal: updated, approval };
  });
}

import {
  assertJournalBalanced,
  convertJournalLines,
  isDebitNormal,
  reverseJournalLines,
  sumJournalLines,
  type BookAccountType,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { JournalStatus, JournalType, Prisma } from "@prisma/client";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

const SYSTEM_JOURNAL_TYPES = new Set<JournalType>(["AUTOMATIC", "OPENING_BALANCE", "REVERSAL"]);

async function nextJournalNumber(companyId: string, journalDate: Date) {
  const where = { companyId_documentType: { companyId, documentType: "JOURNAL_ENTRY" as const } };
  await prisma.numberSequence.upsert({
    where,
    create: {
      companyId,
      documentType: "JOURNAL_ENTRY",
      prefix: "JE",
      includeYear: true,
      sequenceLength: 6,
      startingNumber: 1,
      nextNumber: 1,
    },
    update: {},
  });
  const seq = await prisma.numberSequence.update({ where, data: { nextNumber: { increment: 1 } } });
  const n = String(seq.nextNumber - 1).padStart(seq.sequenceLength, "0");
  const prefix = seq.prefix ?? "JE";
  return seq.includeYear ? `${prefix}-${journalDate.getUTCFullYear()}-${n}` : `${prefix}-${n}`;
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
export async function assertOpenPeriod(companyId: string, date: Date) {
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
    return prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } });
  }
  if (period.status !== "OPEN" && period.status !== "REOPENED") {
    throw new Error(`Accounting period ${period.name} is ${period.status.toLowerCase().replace("_", " ")}`);
  }
  return period;
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

export async function createJournal(
  companyId: string,
  input: {
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
  },
  actor: Actor = {},
) {
  await assertCompanyActivated(companyId);
  assertJournalBalanced(input.lines);
  const journalDate = new Date(input.journalDate);
  await assertOpenPeriod(companyId, journalDate);

  const functional = await functionalCurrency(companyId);
  const currency = (input.currencyCode ?? functional).toUpperCase();
  let rate = 1;
  let lines = input.lines;
  if (currency !== functional) {
    rate = input.exchangeRate ?? (await rateFor(companyId, currency, journalDate));
    lines = convertJournalLines(input.lines, rate);
  }
  await assertAccountsPostable(
    companyId,
    lines.map((l) => l.accountId),
    { manual: isManualEntry(input), currency, functional, revaluation: input.sourceModule === "FX" },
  );

  const totals = sumJournalLines(lines);
  const journalNumber = await nextJournalNumber(companyId, journalDate);

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
      lines: {
        create: lines.map((l, idx) => ({
          companyId,
          lineNumber: idx + 1,
          accountId: l.accountId,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          amountForeign: l.amountForeign,
          taxCode: l.taxCode,
          customerRef: l.customerRef,
          supplierRef: l.supplierRef,
        })),
      },
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
    const journal = await tx.journal.findFirst({
      where: { id: journalId, companyId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!journal) throw new Error("Journal not found");
    if (journal.status === "POSTED") return journal;
    if (journal.status === "REVERSED" || journal.status === "CANCELLED") {
      throw new Error(`Cannot post journal in status ${journal.status}`);
    }

    const drafts: JournalLineDraft[] = journal.lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description ?? undefined,
    }));
    assertJournalBalanced(drafts);
    await assertOpenPeriod(companyId, journal.journalDate);

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

    return posted;
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

/** Lines as they were entered: in the foreign currency when the journal had one, else functional. */
export function linesInJournalCurrency(
  lines: Array<{ accountId: string; debit: Prisma.Decimal | number; credit: Prisma.Decimal | number; amountForeign: Prisma.Decimal | number | null; description: string | null }>,
): JournalLineDraft[] {
  const foreign = lines.some((l) => l.amountForeign !== null);
  return lines.map((l) => {
    const f = Number(l.amountForeign ?? 0);
    return {
      accountId: l.accountId,
      debit: foreign ? Math.max(f, 0) : Number(l.debit),
      credit: foreign ? Math.max(-f, 0) : Number(l.credit),
      description: l.description ?? undefined,
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
  return prisma.journal.findFirst({
    where: { id: journalId, companyId },
    include: {
      lines: { include: { account: true }, orderBy: { lineNumber: "asc" } },
      sourceDocumentLinks: true,
      glEntries: true,
    },
  });
}

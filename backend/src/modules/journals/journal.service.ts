import {
  assertJournalBalanced,
  reverseJournalLines,
  sumJournalLines,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { JournalStatus, JournalType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

async function nextJournalNumber(companyId: string) {
  const seq = await prisma.numberSequence.upsert({
    where: { companyId_documentType: { companyId, documentType: "JOURNAL_ENTRY" } },
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
  const year = new Date().getUTCFullYear();
  const n = seq.nextNumber;
  await prisma.numberSequence.update({
    where: { id: seq.id },
    data: { nextNumber: n + 1 },
  });
  return `${seq.prefix ?? "JE"}-${year}-${String(n).padStart(seq.sequenceLength, "0")}`;
}

async function assertCompanyActivated(companyId: string) {
  const activation = await prisma.accountingActivation.findUnique({ where: { companyId } });
  if (!activation || activation.status !== "ACTIVATED") {
    throw new Error("Accounting is not activated for this company");
  }
}

export async function assertOpenPeriod(companyId: string, date: Date) {
  const years = await prisma.financialYear.findMany({
    where: { companyId },
    include: { periods: true },
  });
  const open = years
    .flatMap((y) => y.periods)
    .find((p) => p.status === "OPEN" && p.startDate <= date && p.endDate >= date);
  if (!open) {
    throw new Error("No open accounting period covers the journal date");
  }
  return open;
}

export async function assertAccountsPostable(companyId: string, accountIds: string[]) {
  const accounts = await prisma.account.findMany({
    where: { companyId, id: { in: accountIds } },
  });
  if (accounts.length !== new Set(accountIds).size) {
    throw new Error("One or more journal accounts were not found");
  }
  for (const a of accounts) {
    if (!a.isActive) throw new Error(`Account ${a.code} is inactive`);
  }
  return accounts;
}

export async function createJournal(
  companyId: string,
  input: {
    journalDate: Date | string;
    journalType?: JournalType;
    description?: string;
    referenceNumber?: string;
    currencyCode?: string;
    branchId?: string;
    costCentre?: string;
    project?: string;
    status?: JournalStatus;
    sourceModule?: string;
    sourceDocumentType?: string;
    sourceDocumentId?: string;
    sourceDocumentNumber?: string;
    integrationEventId?: string;
    lines: JournalLineDraft[];
  },
  actor: Actor = {},
) {
  await assertCompanyActivated(companyId);
  assertJournalBalanced(input.lines);
  const journalDate = new Date(input.journalDate);
  await assertOpenPeriod(companyId, journalDate);
  await assertAccountsPostable(
    companyId,
    input.lines.map((l) => l.accountId),
  );

  const totals = sumJournalLines(input.lines);
  const journalNumber = await nextJournalNumber(companyId);

  const journal = await prisma.journal.create({
    data: {
      companyId,
      journalNumber,
      journalDate,
      journalType: input.journalType ?? "MANUAL",
      status: input.status ?? "DRAFT",
      referenceNumber: input.referenceNumber,
      description: input.description,
      currencyCode: input.currencyCode ?? "RWF",
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
        create: input.lines.map((l, idx) => ({
          companyId,
          lineNumber: idx + 1,
          accountId: l.accountId,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
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

  return prisma.$transaction(async (tx) => {
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
      const account = await tx.account.findUniqueOrThrow({ where: { id: line.accountId } });
      const delta = Number(line.debit) - Number(line.credit);
      // Assets/expenses increase with debit; liabilities/equity/income increase with credit.
      // Store signed running balance as debit-positive for simplicity (asset convention).
      const nextBalance = Number(account.currentBalance) + delta;
      await tx.account.update({
        where: { id: account.id },
        data: {
          currentBalance: nextBalance,
          hasPostedTransactions: true,
        },
      });
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

  const reversalLines = reverseJournalLines(
    original.lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description ?? undefined,
    })),
  );

  const reversal = await createJournal(
    companyId,
    {
      journalDate: original.journalDate,
      journalType: "REVERSAL",
      description: reason
        ? `Reversal of ${original.journalNumber}: ${reason}`
        : `Reversal of ${original.journalNumber}`,
      referenceNumber: original.journalNumber,
      currencyCode: original.currencyCode,
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

  const postedReversal = await postJournal(companyId, reversal.id, actor);

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

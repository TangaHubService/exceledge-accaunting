import { prisma } from "../../lib/prisma";

export async function getGlDashboard(companyId: string) {
  const [accountCount, activeAccounts, postedJournals, debitAgg, creditAgg, recent] =
    await Promise.all([
      prisma.account.count({ where: { companyId } }),
      prisma.account.count({ where: { companyId, isActive: true } }),
      prisma.journal.count({ where: { companyId, status: "POSTED" } }),
      prisma.glEntry.aggregate({ where: { companyId }, _sum: { debit: true } }),
      prisma.glEntry.aggregate({ where: { companyId }, _sum: { credit: true } }),
      prisma.glEntry.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { account: true, journal: true },
      }),
    ]);

  const openPeriod = await prisma.accountingPeriod.findFirst({
    where: { status: "OPEN", financialYear: { companyId } },
    orderBy: { startDate: "asc" },
  });

  return {
    totalLedgerAccounts: accountCount,
    activeLedgerAccounts: activeAccounts,
    postedJournalEntries: postedJournals,
    currentAccountingPeriod: openPeriod,
    totalDebits: Number(debitAgg._sum.debit ?? 0),
    totalCredits: Number(creditAgg._sum.credit ?? 0),
    recentlyPosted: recent,
  };
}

export async function getAccountLedger(
  companyId: string,
  accountId: string,
  opts: { from?: Date; to?: Date } = {},
) {
  const account = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!account) throw new Error("Account not found");

  const entries = await prisma.glEntry.findMany({
    where: {
      companyId,
      accountId,
      ...(opts.from || opts.to
        ? {
            postingDate: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ postingDate: "asc" }, { createdAt: "asc" }],
    include: { journal: true },
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      openingBalance: Number(account.openingBalance),
      currentBalance: Number(account.currentBalance),
      currency: account.currency,
    },
    entries: entries.map((e) => ({
      id: e.id,
      postingDate: e.postingDate,
      transactionDate: e.transactionDate,
      journalNumber: e.journalNumber,
      journalId: e.journalId,
      referenceNumber: e.referenceNumber,
      sourceModule: e.sourceModule,
      sourceDocumentType: e.sourceDocumentType,
      sourceDocumentId: e.sourceDocumentId,
      description: e.description,
      debit: Number(e.debit),
      credit: Number(e.credit),
      runningBalance: Number(e.runningBalance),
    })),
  };
}

import { Prisma } from "@prisma/client";
import { money4 } from "@exceledge/accounting-domain";
import { prisma } from "../../lib/prisma";
import type { Dims } from "../books/reports.service";

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

  const now = new Date();
  const openPeriod = await prisma.accountingPeriod.findFirst({
    where: { financialYear: { companyId }, startDate: { lte: now }, endDate: { gte: now } },
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

type LedgerRow = {
  id: string;
  journalId: string;
  journalNumber: string;
  postingDate: Date;
  transactionDate: Date;
  referenceNumber: string | null;
  sourceModule: string | null;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  description: string | null;
  costCentre: string | null;
  project: string | null;
  branchId: string | null;
  debit: number;
  credit: number;
  cumulative: number;
};

/**
 * Entries by transaction date with the balance before `from` and a debit-positive running balance computed
 * here, ordered by date, journal number and entry, so any page continues from the rows before it.
 */
export async function getAccountLedger(
  companyId: string,
  accountId: string,
  opts: { from?: Date; to?: Date; dims?: Dims; page?: number; pageSize?: number } = {},
) {
  const account = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!account) throw new Error("Account not found");
  if (opts.from && opts.to && opts.from > opts.to) throw new Error("from must be on or before to");

  const dims = opts.dims ?? {};
  const scope = Prisma.sql`g."companyId" = ${companyId} AND g."accountId" = ${accountId}
    ${dims.costCentre ? Prisma.sql`AND g."costCentre" = ${dims.costCentre}` : Prisma.empty}
    ${dims.project ? Prisma.sql`AND g."project" = ${dims.project}` : Prisma.empty}
    ${dims.branchId ? Prisma.sql`AND g."branchId" = ${dims.branchId}` : Prisma.empty}`;
  // Dates are stored as UTC timestamps without zone; bind them as such so the session time zone cannot shift them.
  const at = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;
  const range = Prisma.sql`${opts.from ? Prisma.sql`AND g."transactionDate" >= ${at(opts.from)}` : Prisma.empty}
    ${opts.to ? Prisma.sql`AND g."transactionDate" <= ${at(opts.to)}` : Prisma.empty}`;
  const paged = Boolean(opts.page || opts.pageSize);
  const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? 100) || 100, 1), 1000);
  const page = Math.max(Math.trunc(opts.page ?? 1) || 1, 1);

  const [[opening], [totals], rows] = await Promise.all([
    opts.from
      ? prisma.$queryRaw<Array<{ balance: number }>>`
          SELECT COALESCE(SUM(g."debit" - g."credit"), 0)::float8 AS "balance" FROM "gl_entries" g WHERE ${scope} AND g."transactionDate" < ${at(opts.from)}`
      : Promise.resolve([{ balance: 0 }]),
    prisma.$queryRaw<Array<{ count: number; debit: number; credit: number }>>`
      SELECT COUNT(*)::int AS "count", COALESCE(SUM(g."debit"), 0)::float8 AS "debit", COALESCE(SUM(g."credit"), 0)::float8 AS "credit"
      FROM "gl_entries" g WHERE ${scope} ${range}`,
    prisma.$queryRaw<LedgerRow[]>`
      SELECT g."id", g."journalId", g."journalNumber", g."postingDate", g."transactionDate", g."referenceNumber", g."sourceModule",
             g."sourceDocumentType", g."sourceDocumentId", g."description", g."costCentre", g."project", g."branchId",
             g."debit"::float8 AS "debit", g."credit"::float8 AS "credit",
             (SUM(g."debit" - g."credit") OVER (ORDER BY g."transactionDate", g."journalNumber", g."id" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::float8 AS "cumulative"
      FROM "gl_entries" g WHERE ${scope} ${range}
      ORDER BY g."transactionDate", g."journalNumber", g."id"
      ${paged ? Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : Prisma.empty}`,
  ]);
  const openingBalance = money4(opening.balance);
  const closingBalance = money4(openingBalance + totals.debit - totals.credit);
  const pageOpening = rows.length ? money4(openingBalance + rows[0].cumulative - (rows[0].debit - rows[0].credit)) : closingBalance;

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
    from: opts.from ?? null,
    to: opts.to ?? null,
    dims,
    openingBalance,
    closingBalance,
    totals: { debit: money4(totals.debit), credit: money4(totals.credit) },
    page: paged ? page : 1,
    pageSize: paged ? pageSize : totals.count,
    total: totals.count,
    pageOpeningBalance: pageOpening,
    entries: rows.map((e) => ({
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
      costCentre: e.costCentre,
      project: e.project,
      branchId: e.branchId,
      debit: e.debit,
      credit: e.credit,
      runningBalance: money4(openingBalance + e.cumulative),
    })),
  };
}

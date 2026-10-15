import { createHash, randomBytes } from "crypto";
import {
  aggregateTrialBalance,
  anomalyScore,
  answerFromBooks,
  budgetVariance,
  buildFinancialStatements,
  comparativeTrialBalance,
  assertEliminationBalanced,
  consolidateTrialBalances,
  esgIntensity,
  linearForecast,
  money4,
  naturalBalance,
  nextCronTime,
  nextRecurringDate,
  parseCron,
  periodCanClose,
  revaluationDelta,
  trialBalanceTotals,
  type BookAccountType,
  type TrialBalanceMode,
  yearEndClosingLines,
} from "@exceledge/accounting-domain";
import { withJobLock } from "../../lib/job-lock";
import type { ApiKeyScope } from "../../middleware/auth";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal, createJournal } from "../journals/journal.service";

type Actor = { erpUserId?: number; erpRole?: string };

function asType(type: string): BookAccountType {
  return type as BookAccountType;
}

async function movements(companyId: string, opts: { to?: Date; from?: Date } = {}) {
  const entries = await prisma.glEntry.findMany({
    where: {
      companyId,
      ...(opts.from || opts.to
        ? {
            transactionDate: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: { account: true, journal: true },
  });
  return entries.map((e) => ({
    accountId: e.accountId,
    code: e.account.code,
    name: e.account.name,
    type: asType(e.account.type),
    debit: Number(e.debit),
    credit: Number(e.credit),
    journalType: e.journal.journalType,
    costCentre: e.journal.costCentre,
    project: e.journal.project,
    postingDate: e.transactionDate,
    journalId: e.journalId,
    amount: Number(e.debit) + Number(e.credit),
  }));
}

export async function getTrialBalance(
  companyId: string,
  opts: { mode?: TrialBalanceMode; asOf?: Date; compareAsOf?: Date } = {},
) {
  const mode = opts.mode ?? "STANDARD";
  const current = aggregateTrialBalance(await movements(companyId, { to: opts.asOf }), mode);
  if (mode !== "COMPARATIVE") {
    const totals = current.reduce(
      (s, r) => ({ debit: money4(s.debit + r.debit), credit: money4(s.credit + r.credit) }),
      { debit: 0, credit: 0 },
    );
    return { mode, rows: current, ...totals, difference: money4(totals.debit - totals.credit) };
  }
  const prior = aggregateTrialBalance(await movements(companyId, { to: opts.compareAsOf }), "STANDARD");
  const rows = comparativeTrialBalance(current, prior);
  return { mode, rows, ...trialBalanceTotals(rows) };
}

export async function getStatements(companyId: string, asOf?: Date) {
  const rows = aggregateTrialBalance(await movements(companyId, { to: asOf }), "STANDARD");
  const reference = asOf ?? new Date();
  const year = await prisma.financialYear.findFirst({
    where: { companyId, startDate: { lte: reference }, endDate: { gte: reference } },
  });
  const periodStart = year?.startDate ?? new Date(Date.UTC(reference.getUTCFullYear(), 0, 1));
  const priorEnd = new Date(periodStart.getTime() - 1);
  const prior = aggregateTrialBalance(await movements(companyId, { to: priorEnd }), "STANDARD");
  return { ...buildFinancialStatements(rows, prior), periodStart, asOf: reference };
}

async function periodOrThrow(companyId: string, periodId: string) {
  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, financialYear: { companyId } },
    include: { financialYear: true },
  });
  if (!period) throw new Error("Accounting period not found");
  return period;
}

export async function listPeriods(companyId: string) {
  return prisma.financialYear.findMany({
    where: { companyId },
    include: { periods: { orderBy: { sequence: "asc" } } },
    orderBy: { startDate: "desc" },
  });
}

export async function closeChecklist(companyId: string, periodId: string) {
  const period = await periodOrThrow(companyId, periodId);
  const [drafts, openExceptions, pendingApprovals, tb, earlierOpen, laterPeriods] = await Promise.all([
    prisma.journal.count({
      where: { companyId, status: "DRAFT", journalDate: { gte: period.startDate, lte: period.endDate } },
    }),
    prisma.postingException.count({ where: { companyId, status: "OPEN" } }),
    prisma.approvalRequest.count({ where: { companyId, status: "PENDING" } }),
    getTrialBalance(companyId, { asOf: period.endDate }),
    prisma.accountingPeriod.count({
      where: { financialYearId: period.financialYearId, sequence: { lt: period.sequence }, status: { not: "CLOSED" } },
    }),
    prisma.accountingPeriod.count({ where: { financialYearId: period.financialYearId, sequence: { gt: period.sequence } } }),
  ]);
  const gate = periodCanClose({
    drafts,
    openExceptions,
    difference: tb.difference,
    pendingApprovals,
  });
  if (earlierOpen > 0) gate.blockers.unshift(`${earlierOpen} earlier period(s) in ${period.financialYear.name} are not closed yet`);
  return {
    period,
    canClose: gate.blockers.length === 0,
    blockers: gate.blockers,
    drafts,
    openExceptions,
    pendingApprovals,
    earlierOpen,
    lastOfYear: laterPeriods === 0,
    difference: tb.difference,
  };
}

export async function closePeriod(companyId: string, periodId: string, kind: "MONTH" | "YEAR", actor: Actor = {}) {
  const check = await closeChecklist(companyId, periodId);
  if (!check.canClose) throw new Error(check.blockers.join("; "));
  if (check.period.status === "CLOSED") throw new Error("Period is already closed");
  if (kind === "YEAR" && !check.lastOfYear) throw new Error("A year-end close can only be run on the last period of the year");
  if (kind === "MONTH" && check.lastOfYear) throw new Error("Close the last period of the year with a year-end close");

  return inTransaction(() => commitClose(companyId, periodId, kind, check, actor));
}

async function commitClose(
  companyId: string,
  periodId: string,
  kind: "MONTH" | "YEAR",
  check: Awaited<ReturnType<typeof closeChecklist>>,
  actor: Actor,
) {
  let journalId: string | undefined;
  if (kind === "YEAR") {
    const retained = await prisma.account.findFirst({ where: { companyId, code: "3100" } });
    if (!retained) throw new Error("Retained earnings account 3100 is missing");
    const rows = aggregateTrialBalance(
      await movements(companyId, { from: check.period.financialYear.startDate, to: check.period.endDate }),
      "STANDARD",
    );
    const lines = yearEndClosingLines(rows, retained.id);
    if (lines.length) {
      const journal = await createAndPostJournal(
        companyId,
        {
          journalDate: check.period.endDate,
          journalType: "ADJUSTMENT",
          description: `Year-end close ${check.period.financialYear.name}`,
          sourceModule: "CLOSE",
          sourceDocumentType: "YEAR_END_CLOSE",
          sourceDocumentId: periodId,
          lines,
        },
        actor,
      );
      journalId = journal.id;
    }
  }

  await prisma.accountingPeriod.update({ where: { id: periodId }, data: { status: "CLOSED" } });
  const record = await prisma.periodClose.create({
    data: {
      companyId,
      periodId,
      kind,
      checklistJson: { blockers: [], difference: check.difference },
      journalId,
      closedByErpUserId: actor.erpUserId,
    },
  });
  await prisma.notification.create({
    data: { companyId, title: "Period closed", body: `${check.period.name} closed (${kind}).`, severity: "INFO" },
  });
  if (actor.erpUserId) {
    await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action: "CLOSE_PERIOD", entityType: "AccountingPeriod", entityId: periodId });
  }
  return record;
}

export async function reopenPeriod(companyId: string, periodId: string, reason: string, actor: Actor = {}) {
  if (!reason.trim()) throw new Error("A reason is required to reopen a period");
  const period = await periodOrThrow(companyId, periodId);
  if (period.status !== "CLOSED") throw new Error("Only a closed period can be reopened");
  await prisma.accountingPeriod.update({ where: { id: periodId }, data: { status: "REOPENED", reopenReason: reason } });
  await prisma.periodClose.updateMany({ where: { companyId, periodId, status: "CLOSED" }, data: { status: "REOPENED", reopenReason: reason } });
  if (actor.erpUserId) {
    await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action: "REOPEN_PERIOD", entityType: "AccountingPeriod", entityId: periodId, afterJson: { reason } });
  }
  return { id: periodId, status: "REOPENED", reason };
}

export async function lockPeriod(companyId: string, periodId: string, locked: boolean, actor: Actor = {}) {
  const period = await periodOrThrow(companyId, periodId);
  if (locked && !["FUTURE", "OPEN", "REOPENED"].includes(period.status)) {
    throw new Error(`A ${period.status.toLowerCase()} period cannot be locked`);
  }
  if (!locked && period.status !== "TEMPORARILY_LOCKED") throw new Error("Only a locked period can be unlocked");
  const status = locked ? "TEMPORARILY_LOCKED" : "OPEN";
  await prisma.accountingPeriod.update({ where: { id: periodId }, data: { status } });
  if (actor.erpUserId) {
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId,
      erpRole: actor.erpRole,
      action: locked ? "LOCK_PERIOD" : "UNLOCK_PERIOD",
      entityType: "AccountingPeriod",
      entityId: periodId,
      beforeJson: { status: period.status },
      afterJson: { status },
    });
  }
  return { id: periodId, status };
}

export async function setTransactionLockDate(companyId: string, financialYearId: string, lockDate: Date | null, actor: Actor = {}) {
  const year = await prisma.financialYear.findFirst({ where: { id: financialYearId, companyId } });
  if (!year) throw new Error("Financial year not found");
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (lockDate && (day(lockDate) < day(year.startDate) || day(lockDate) > day(year.endDate))) {
    throw new Error("The lock date must fall inside the financial year");
  }
  const updated = await prisma.financialYear.update({ where: { id: year.id }, data: { transactionLockDate: lockDate } });
  if (actor.erpUserId) {
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId,
      erpRole: actor.erpRole,
      action: "SET_LOCK_DATE",
      entityType: "FinancialYear",
      entityId: year.id,
      beforeJson: { transactionLockDate: year.transactionLockDate },
      afterJson: { transactionLockDate: lockDate },
    });
  }
  return updated;
}

export async function listRecurring(companyId: string) {
  return prisma.recurringJournal.findMany({ where: { companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } }, orderBy: { name: "asc" } });
}

export async function createRecurring(
  companyId: string,
  input: {
    name: string;
    description?: string;
    frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
    nextRunDate: string;
    autoPost?: boolean;
    lines: Array<{ accountId: string; debit: number; credit: number; description?: string }>;
  },
  actor: Actor = {},
) {
  if (input.lines.length < 2) throw new Error("A recurring journal needs at least two lines");
  const debit = money4(input.lines.reduce((s, l) => s + l.debit, 0));
  const credit = money4(input.lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debit - credit) > 0.0001) throw new Error("Recurring journal does not balance");
  return prisma.recurringJournal.create({
    data: {
      companyId,
      name: input.name,
      description: input.description,
      frequency: input.frequency,
      nextRunDate: new Date(input.nextRunDate),
      autoPost: input.autoPost ?? false,
      createdByErpUserId: actor.erpUserId,
      lines: { create: input.lines.map((l, i) => ({ lineNumber: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })) },
    },
    include: { lines: true },
  });
}

export async function runRecurring(companyId: string, asOf = new Date(), actor: Actor = {}) {
  const result = await withJobLock(`recurring:${companyId}`, 10 * 60_000, () => runDueRecurring(companyId, asOf, actor));
  if (!result) throw new Error("Recurring journals are already being run for this company");
  return result;
}

async function runDueRecurring(companyId: string, asOf: Date, actor: Actor) {
  const due = await prisma.recurringJournal.findMany({
    where: { companyId, isActive: true, nextRunDate: { lte: asOf } },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  const created: string[] = [];
  const failed: Array<{ templateId: string; name: string; error: string }> = [];
  for (const template of due) {
    if (template.endDate && template.nextRunDate > template.endDate) {
      await prisma.recurringJournal.update({ where: { id: template.id }, data: { isActive: false } });
      continue;
    }
    try {
      const journalId = await inTransaction(async () => {
        const input = {
          journalDate: template.nextRunDate,
          description: template.description || template.name,
          sourceModule: "RECURRING",
          sourceDocumentType: "RECURRING_JOURNAL",
          sourceDocumentId: template.id,
          lines: template.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), description: l.description ?? undefined })),
        };
        const journal = template.autoPost
          ? await createAndPostJournal(companyId, input, actor)
          : await createJournal(companyId, input, actor);
        const nextRunDate = new Date(nextRecurringDate(template.nextRunDate, template.frequency));
        await prisma.recurringJournal.update({
          where: { id: template.id },
          data: { nextRunDate, isActive: !template.endDate || nextRunDate <= template.endDate },
        });
        return journal.id;
      });
      created.push(journalId);
    } catch (e) {
      const error = (e as Error).message;
      failed.push({ templateId: template.id, name: template.name, error });
      await prisma.notification.create({
        data: { companyId, title: "Recurring journal failed", body: `${template.name}: ${error}`, severity: "WARNING" },
      });
    }
  }
  return { generated: created.length, journalIds: created, failed };
}

export async function listRates(companyId: string) {
  return prisma.exchangeRate.findMany({ where: { companyId }, orderBy: { rateDate: "desc" } });
}

export async function saveRate(companyId: string, input: { currency: string; rateDate: string; rate: number; source?: string }) {
  const rateDate = new Date(input.rateDate);
  return prisma.exchangeRate.upsert({
    where: { companyId_currency_rateDate: { companyId, currency: input.currency.toUpperCase(), rateDate } },
    create: { companyId, currency: input.currency.toUpperCase(), rateDate, rate: input.rate, source: input.source },
    update: { rate: input.rate, source: input.source },
  });
}

async function fxResultAccounts(companyId: string) {
  const [settings, defaults] = await Promise.all([
    prisma.currencySettings.findUnique({ where: { companyId } }),
    prisma.defaultPostingAccounts.findUnique({ where: { companyId } }),
  ]);
  const pick = async (ids: Array<string | null | undefined>, code: string) => {
    const id = ids.find(Boolean);
    return id ? prisma.account.findFirst({ where: { id, companyId } }) : prisma.account.findFirst({ where: { companyId, code } });
  };
  const gain = await pick([settings?.fxGainAccountId, defaults?.fxGainId], "4300");
  const loss = await pick([settings?.fxLossAccountId, defaults?.fxLossId], "6500");
  if (!gain || !loss) throw new Error("Set FX gain and loss accounts in currency settings before revaluing");
  return { gain, loss, functional: settings?.functionalCurrency ?? "RWF" };
}

/**
 * Restates accounts kept in `currency` at the closing rate. The foreign balance is the sum of
 * the foreign amounts posted to each account; the book value is its functional balance.
 */
export async function revalueCurrency(companyId: string, currency: string, actor: Actor = {}, asOf = new Date()) {
  const code = currency.toUpperCase();
  const { gain: gainAccount, loss: lossAccount, functional } = await fxResultAccounts(companyId);
  if (code === functional) return { currency: code, gainLoss: 0, journalId: null, skipped: "Functional currency is not revalued" };
  const rate = await prisma.exchangeRate.findFirst({
    where: { companyId, currency: code, rateDate: { lte: asOf } },
    orderBy: { rateDate: "desc" },
  });
  if (!rate) throw new Error(`No ${code} exchange rate is on file on or before ${asOf.toISOString().slice(0, 10)}`);
  const accounts = await prisma.account.findMany({ where: { companyId, currency: code, isActive: true } });
  const postedLines = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      accountId: { in: accounts.map((a) => a.id) },
      journal: { status: { in: ["POSTED", "REVERSED"] }, journalDate: { lte: rate.rateDate } },
    },
    _sum: { debit: true, credit: true, amountForeign: true },
  });
  let gain = 0;
  const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
  for (const account of accounts) {
    const sums = postedLines.find((p) => p.accountId === account.id)?._sum;
    const delta = revaluationDelta({
      foreignBalance: Number(sums?.amountForeign ?? 0),
      bookFunctional: money4(Number(sums?.debit ?? 0) - Number(sums?.credit ?? 0)),
      closingRate: Number(rate.rate),
    });
    if (Math.abs(delta) < 0.0001) continue;
    gain = money4(gain + delta);
    if (delta > 0) lines.push({ accountId: account.id, description: `Revalue ${code}`, debit: delta, credit: 0 });
    else lines.push({ accountId: account.id, description: `Revalue ${code}`, debit: 0, credit: money4(-delta) });
  }
  if (!lines.length) return { currency: code, gainLoss: 0, journalId: null };
  if (gain > 0) lines.push({ accountId: gainAccount.id, description: `Unrealized FX gain ${code}`, debit: 0, credit: gain });
  else if (gain < 0) lines.push({ accountId: lossAccount.id, description: `Unrealized FX loss ${code}`, debit: money4(-gain), credit: 0 });
  return inTransaction(async () => {
    const journal = await createAndPostJournal(
      companyId,
      { journalDate: rate.rateDate, journalType: "ADJUSTMENT", description: `FX revaluation ${code} at ${Number(rate.rate)}`, sourceModule: "FX", lines },
      actor,
    );
    return prisma.fxRevaluation.create({
      data: { companyId, currency: code, rateDate: rate.rateDate, closingRate: rate.rate, gainLoss: gain, journalId: journal.id, createdByErpUserId: actor.erpUserId },
    });
  });
}

export async function listBudgets(companyId: string) {
  return prisma.budget.findMany({ where: { companyId }, include: { lines: true }, orderBy: { createdAt: "desc" } });
}

export async function createBudget(
  companyId: string,
  input: { name: string; financialYearId?: string; lines: Array<{ accountId: string; amount: number; periodSequence?: number; costCentre?: string; project?: string }> },
  actor: Actor = {},
) {
  return prisma.budget.create({
    data: {
      companyId,
      name: input.name,
      financialYearId: input.financialYearId,
      createdByErpUserId: actor.erpUserId,
      lines: { create: input.lines.map((l) => ({ accountId: l.accountId, amount: l.amount, periodSequence: l.periodSequence ?? 0, costCentre: l.costCentre, project: l.project })) },
    },
    include: { lines: true },
  });
}

export async function approveBudget(companyId: string, budgetId: string) {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, companyId } });
  if (!budget) throw new Error("Budget not found");
  return prisma.budget.update({ where: { id: budgetId }, data: { status: "APPROVED" } });
}

export async function budgetVarianceReport(companyId: string, budgetId: string) {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, companyId }, include: { lines: true } });
  if (!budget) throw new Error("Budget not found");
  const year = budget.financialYearId
    ? await prisma.financialYear.findFirst({ where: { id: budget.financialYearId, companyId } })
    : await prisma.financialYear.findFirst({ where: { companyId, isCurrent: true } });
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: budget.lines.map((l) => l.accountId) } } });
  const actuals = new Map<string, { debit: number; credit: number }>();
  for (const m of await movements(companyId, { from: year?.startDate, to: year?.endDate })) {
    const row = actuals.get(m.accountId) ?? { debit: 0, credit: 0 };
    row.debit += m.debit;
    row.credit += m.credit;
    actuals.set(m.accountId, row);
  }
  const byAccount = new Map<string, number>();
  for (const line of budget.lines) byAccount.set(line.accountId, money4((byAccount.get(line.accountId) ?? 0) + Number(line.amount)));
  const rows = budgetVariance(
    [...byAccount.entries()].map(([accountId, amount]) => {
      const account = accounts.find((a) => a.id === accountId);
      const actual = actuals.get(accountId) ?? { debit: 0, credit: 0 };
      return {
        key: account ? `${account.code} ${account.name}` : accountId,
        budget: amount,
        actual: account ? naturalBalance(asType(account.type), actual.debit, actual.credit) : 0,
        income: account ? INCOME.has(account.type) : false,
      };
    }),
  );
  return { budget: { id: budget.id, name: budget.name, status: budget.status, year: year?.name ?? null }, rows };
}

const INCOME = new Set(["INCOME", "OTHER_INCOME"]);

export async function listDimensions(companyId: string) {
  return prisma.dimension.findMany({ where: { companyId }, orderBy: [{ kind: "asc" }, { code: "asc" }] });
}

export async function createDimension(companyId: string, input: { kind: "COST_CENTRE" | "PROJECT"; code: string; name: string }) {
  return prisma.dimension.create({ data: { companyId, kind: input.kind, code: input.code, name: input.name } });
}

export async function dimensionReport(companyId: string) {
  const lines = await movements(companyId);
  const groups = new Map<string, { key: string; debit: number; credit: number }>();
  for (const line of lines) {
    const key = line.costCentre || line.project || "Unassigned";
    const row = groups.get(key) ?? { key, debit: 0, credit: 0 };
    row.debit = money4(row.debit + line.debit);
    row.credit = money4(row.credit + line.credit);
    groups.set(key, row);
  }
  return [...groups.values()];
}

export async function listControls(companyId: string) {
  return prisma.controlItem.findMany({ where: { companyId }, orderBy: { code: "asc" } });
}

export async function saveControl(companyId: string, input: { code: string; title: string; category: string; status?: "OPEN" | "EFFECTIVE" | "DEFICIENT"; notes?: string }) {
  return prisma.controlItem.upsert({
    where: { companyId_code: { companyId, code: input.code } },
    create: { companyId, code: input.code, title: input.title, category: input.category, status: input.status ?? "OPEN", notes: input.notes },
    update: { title: input.title, category: input.category, status: input.status ?? "OPEN", notes: input.notes },
  });
}

export async function listApprovals(companyId: string) {
  return prisma.approvalRequest.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
}

export const APPROVAL_ENTITY_TYPES = ["Journal", "Expense", "ApBill", "Budget", "TaxAdjustment", "FixedAssetImpairment"] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number];

async function approvalTargetExists(companyId: string, entityType: ApprovalEntityType, id: string) {
  const where = { id, companyId };
  switch (entityType) {
    case "Journal":
      return (await prisma.journal.count({ where })) > 0;
    case "Expense":
      return (await prisma.expense.count({ where })) > 0;
    case "ApBill":
      return (await prisma.apBill.count({ where })) > 0;
    case "Budget":
      return (await prisma.budget.count({ where })) > 0;
    case "TaxAdjustment":
      return (await prisma.taxAdjustment.count({ where })) > 0;
    case "FixedAssetImpairment":
      return (await prisma.fixedAssetImpairment.count({ where })) > 0;
  }
}

async function auditBooks(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType, entityId, beforeJson, afterJson });
}

export async function requestApproval(
  companyId: string,
  input: { entityType: ApprovalEntityType; entityId: string; amount: number; reason?: string },
  actor: Actor = {},
) {
  if (!(await approvalTargetExists(companyId, input.entityType, input.entityId))) {
    throw new Error(`${input.entityType} ${input.entityId} was not found`);
  }
  const open = await prisma.approvalRequest.count({
    where: { companyId, entityType: input.entityType, entityId: input.entityId, status: "PENDING" },
  });
  if (open) throw new Error(`${input.entityType} ${input.entityId} already has a pending approval`);
  const row = await prisma.approvalRequest.create({
    data: { companyId, entityType: input.entityType, entityId: input.entityId, amount: input.amount, reason: input.reason, requestedByErpUserId: actor.erpUserId },
  });
  await prisma.notification.create({
    data: { companyId, title: "Approval waiting", body: `${input.entityType} ${input.entityId} needs approval.`, severity: "WARNING" },
  });
  await auditBooks(companyId, actor, "REQUEST_APPROVAL", "ApprovalRequest", row.id, { entityType: row.entityType, entityId: row.entityId, amount: input.amount });
  return row;
}

export async function decideApproval(companyId: string, id: string, status: "APPROVED" | "REJECTED", actor: Actor = {}) {
  const row = await prisma.approvalRequest.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("Approval not found");
  if (row.status !== "PENDING") throw new Error(`This approval was already ${row.status.toLowerCase()}`);
  if (row.requestedByErpUserId && actor.erpUserId && row.requestedByErpUserId === actor.erpUserId) {
    throw new Error("The requester cannot approve their own item");
  }
  const decided = await prisma.approvalRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status, decidedByErpUserId: actor.erpUserId, decidedAt: new Date() },
  });
  if (!decided.count) throw new Error("This approval was decided by someone else a moment ago");
  await auditBooks(companyId, actor, status === "APPROVED" ? "APPROVE" : "REJECT", "ApprovalRequest", id, { status }, { status: row.status });
  return prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
}

export async function listNotifications(companyId: string) {
  return prisma.notification.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function markNotificationRead(companyId: string, id: string) {
  const row = await prisma.notification.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("Notification not found");
  return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function listDocuments(companyId: string, entityType?: string, entityId?: string) {
  return prisma.accountingDocument.findMany({
    where: { companyId, ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function addDocument(
  companyId: string,
  input: { entityType: string; entityId: string; fileName: string; note?: string; contentText?: string },
  actor: Actor = {},
) {
  return prisma.accountingDocument.create({
    data: { companyId, ...input, createdByErpUserId: actor.erpUserId },
  });
}

export async function importJournalCsv(companyId: string, csv: string, journalDate: string, actor: Actor = {}) {
  const accounts = await prisma.account.findMany({ where: { companyId } });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const lines: Array<{ accountId: string; debit: number; credit: number; description?: string }> = [];
  const errors: string[] = [];
  csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.toLowerCase().startsWith("account"))
    .forEach((line, idx) => {
      const [code, debit, credit, description] = line.split(",").map((p) => p.trim());
      const account = byCode.get(code);
      if (!account) {
        errors.push(`Line ${idx + 1}: unknown account ${code}`);
        return;
      }
      lines.push({ accountId: account.id, debit: Number(debit) || 0, credit: Number(credit) || 0, description });
    });
  if (!errors.length && lines.length < 2) errors.push("A journal needs at least two lines");
  if (errors.length) {
    const batch = await prisma.importBatch.create({
      data: { companyId, kind: "JOURNAL", status: "FAILED", rowCount: lines.length, errorCount: errors.length, summaryJson: { errors }, createdByErpUserId: actor.erpUserId },
    });
    return { batch, journal: null };
  }
  return inTransaction(async () => {
    const journal = await createJournal(companyId, { journalDate, description: "Imported journal", sourceModule: "IMPORT", lines }, actor);
    const batch = await prisma.importBatch.create({
      data: { companyId, kind: "JOURNAL", status: "IMPORTED", rowCount: lines.length, errorCount: 0, summaryJson: { journalId: journal.id }, createdByErpUserId: actor.erpUserId },
    });
    return { batch, journal };
  });
}

/** Accounting companies for the ERP organizations a user belongs to. */
export async function companiesForOrganizations(organizationIds: number[]) {
  if (!organizationIds.length) return [];
  const rows = await prisma.company.findMany({
    where: { externalErpOrganizationId: { in: organizationIds.map(String) } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function assertMembersAllowed(members: Array<{ name: string; companyId: string | null }>, allowedCompanyIds: string[]) {
  for (const m of members) {
    if (!m.companyId) throw new Error(`Group member ${m.name} is not linked to a company`);
    if (!allowedCompanyIds.includes(m.companyId)) throw new Error(`You do not have access to the books of ${m.name}`);
  }
}

export async function listGroups(companyId: string) {
  return prisma.companyGroup.findMany({
    where: { ownerCompanyId: companyId },
    include: { members: true, eliminations: { include: { lines: { orderBy: { lineNumber: "asc" } } } } },
  });
}

export async function createGroup(
  companyId: string,
  input: { name: string; members: Array<{ name: string; companyId?: string; ownershipPercent?: number }> },
  allowedCompanyIds: string[],
) {
  const members = input.members.map((m) => ({ name: m.name, companyId: m.companyId ?? companyId, ownershipPercent: m.ownershipPercent ?? 100 }));
  assertMembersAllowed(members, allowedCompanyIds);
  if (new Set(members.map((m) => m.companyId)).size !== members.length) throw new Error("A company can only be in a group once");
  return prisma.companyGroup.create({
    data: { ownerCompanyId: companyId, name: input.name, members: { create: members } },
    include: { members: true },
  });
}

export async function addElimination(
  companyId: string,
  groupId: string,
  input: { description: string; lines: Array<{ accountCode: string; debit: number; credit: number }> },
) {
  const group = await prisma.companyGroup.findFirst({ where: { id: groupId, ownerCompanyId: companyId }, include: { members: true } });
  if (!group) throw new Error("Group not found");
  assertEliminationBalanced(input.lines.map((l) => ({ code: l.accountCode, debit: l.debit, credit: l.credit })));
  const memberIds = group.members.map((m) => m.companyId).filter((id): id is string => Boolean(id));
  for (const code of new Set(input.lines.map((l) => l.accountCode))) {
    if (!(await prisma.account.count({ where: { companyId: { in: memberIds }, code } }))) {
      throw new Error(`No company in ${group.name} has account ${code}`);
    }
  }
  return prisma.elimination.create({
    data: {
      companyId,
      groupId,
      description: input.description,
      debit: money4(input.lines.reduce((s, l) => s + l.debit, 0)),
      credit: money4(input.lines.reduce((s, l) => s + l.credit, 0)),
      lines: { create: input.lines.map((l, i) => ({ lineNumber: i + 1, accountCode: l.accountCode, debit: l.debit, credit: l.credit })) },
    },
    include: { lines: true },
  });
}

export async function consolidateGroup(companyId: string, groupId: string, allowedCompanyIds: string[], asOf?: Date) {
  const group = await prisma.companyGroup.findFirst({
    where: { id: groupId, ownerCompanyId: companyId },
    include: { members: true, eliminations: { include: { lines: { orderBy: { lineNumber: "asc" } } } } },
  });
  if (!group) throw new Error("Group not found");
  assertMembersAllowed(group.members, allowedCompanyIds);
  const members = [];
  for (const member of group.members) {
    const rows = aggregateTrialBalance(await movements(member.companyId!, { to: asOf }), "STANDARD");
    members.push({ name: member.name, ownershipPercent: Number(member.ownershipPercent), rows });
  }
  const applied = group.eliminations.filter((e) => e.lines.length > 0);
  const result = consolidateTrialBalances(
    members,
    applied.map((e) => ({
      description: e.description,
      lines: e.lines.map((l) => ({ code: l.accountCode, debit: Number(l.debit), credit: Number(l.credit) })),
    })),
  );
  return {
    ...result,
    asOf: asOf ?? null,
    ignoredEliminations: group.eliminations.filter((e) => !e.lines.length).map((e) => ({ id: e.id, description: e.description })),
  };
}

export async function createForecast(companyId: string, name: string, horizonMonths: number) {
  const entries = await movements(companyId);
  const byMonth = new Map<string, number>();
  for (const line of entries) {
    if (!["INCOME", "OTHER_INCOME", "EXPENSE", "OTHER_EXPENSE", "COST_OF_SALES"].includes(line.type)) continue;
    const key = line.postingDate.toISOString().slice(0, 7);
    const signed = naturalBalance(line.type, line.debit, line.credit);
    const profitEffect = line.type === "INCOME" || line.type === "OTHER_INCOME" ? signed : -signed;
    byMonth.set(key, money4((byMonth.get(key) ?? 0) + profitEffect));
  }
  const today = new Date();
  const lastComplete = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const months = [...byMonth.keys()].filter((key) => key <= lastComplete).sort();
  const history: number[] = [];
  const historyMonths: string[] = [];
  if (months.length) {
    let [y, m] = months[0].split("-").map(Number);
    for (let key = months[0]; key <= lastComplete; key = `${y}-${String(m).padStart(2, "0")}`) {
      historyMonths.push(key);
      history.push(byMonth.get(key) ?? 0);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  const result = linearForecast(history, horizonMonths);
  const row = await prisma.forecastScenario.create({
    data: { companyId, name, horizonMonths, resultJson: { months: historyMonths, history, forecast: result } },
  });
  return row;
}

export async function scanAnomalies(companyId: string) {
  const journals = await prisma.journal.findMany({ where: { companyId, status: "POSTED" }, orderBy: { journalDate: "desc" }, take: 40 });
  const amounts = journals.map((j) => Number(j.totalDebit)).reverse();
  const flags = [];
  for (const journal of journals.slice(0, 10)) {
    const history = amounts.filter((n) => n !== Number(journal.totalDebit));
    const score = anomalyScore(Number(journal.totalDebit), history.slice(-20));
    if (!score.flag) continue;
    const row = await prisma.anomalyFlag.create({ data: { companyId, journalId: journal.id, score: score.score, reason: score.reason } });
    flags.push(row);
  }
  return flags;
}

export async function listAnomalies(companyId: string) {
  return prisma.anomalyFlag.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
}

export async function dismissAnomaly(companyId: string, id: string) {
  const row = await prisma.anomalyFlag.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("Anomaly not found");
  return prisma.anomalyFlag.update({ where: { id }, data: { status: "DISMISSED" } });
}

export async function listEsg(companyId: string) {
  const rows = await prisma.esgMeasure.findMany({ where: { companyId }, orderBy: { period: "desc" } });
  const statements = await getStatements(companyId);
  return rows.map((r) => ({ ...r, value: Number(r.value), intensity: esgIntensity(Number(r.value), statements.income.totalRevenue) }));
}

export async function saveEsg(companyId: string, input: { period: string; code: string; name: string; value: number; unit: string }) {
  return prisma.esgMeasure.upsert({
    where: { companyId_period_code: { companyId, period: input.period, code: input.code } },
    create: { companyId, ...input },
    update: { name: input.name, value: input.value, unit: input.unit },
  });
}

export async function listWorkflows(companyId: string) {
  return prisma.workflowTemplate.findMany({
    where: { companyId },
    include: { instances: { include: { steps: { orderBy: { stepIndex: "asc" } } } } },
  });
}

export async function createWorkflow(companyId: string, input: { name: string; steps: string[] }) {
  if (input.steps.length < 1) throw new Error("A workflow needs at least one step");
  return prisma.workflowTemplate.create({ data: { companyId, name: input.name, stepsJson: input.steps } });
}

export async function startWorkflow(companyId: string, templateId: string, entityType: string, entityId: string, actor: Actor = {}) {
  const template = await prisma.workflowTemplate.findFirst({ where: { id: templateId, companyId, isActive: true } });
  if (!template) throw new Error("Workflow not found");
  const row = await prisma.workflowInstance.create({ data: { companyId, templateId, entityType, entityId } });
  await auditBooks(companyId, actor, "START_WORKFLOW", "WorkflowInstance", row.id, { templateId, entityType, entityId });
  return row;
}

/** Completes the current step. One person cannot complete two steps in a row. */
export async function advanceWorkflow(companyId: string, instanceId: string, actor: Actor = {}) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  return inTransaction(async () => {
    const instance = await prisma.workflowInstance.findFirst({
      where: { id: instanceId, companyId },
      include: { template: true, steps: { orderBy: { stepIndex: "desc" }, take: 1 } },
    });
    if (!instance) throw new Error("Workflow instance not found");
    if (instance.status === "COMPLETED") throw new Error("This workflow is already complete");
    const previous = instance.steps[0];
    if (previous && previous.erpUserId === actor.erpUserId) {
      throw new Error(`You completed "${previous.stepName}"; someone else must complete the next step`);
    }
    const steps = instance.template.stepsJson as string[];
    const stepName = steps[instance.stepIndex] ?? `Step ${instance.stepIndex + 1}`;
    await prisma.workflowStepLog.create({
      data: { instanceId, stepIndex: instance.stepIndex, stepName, erpUserId: actor.erpUserId!, erpRole: actor.erpRole },
    });
    const next = instance.stepIndex + 1;
    const done = next >= steps.length;
    const updated = await prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { stepIndex: done ? steps.length - 1 : next, status: done ? "COMPLETED" : "IN_PROGRESS" },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
    await auditBooks(companyId, actor, "COMPLETE_WORKFLOW_STEP", "WorkflowInstance", instanceId, { step: stepName, status: updated.status });
    return updated;
  });
}

export async function issueApiKey(
  companyId: string,
  input: { name: string; scopes?: ApiKeyScope[]; expiresAt?: Date },
  actor: Actor = {},
) {
  const scopes = [...new Set(input.scopes?.length ? input.scopes : (["report:view"] as ApiKeyScope[]))];
  if (input.expiresAt && input.expiresAt <= new Date()) throw new Error("The expiry date must be in the future");
  const token = randomBytes(24).toString("hex");
  const prefix = token.slice(0, 8);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await prisma.apiCredential.create({
    data: { companyId, name: input.name, prefix, tokenHash, scopes, expiresAt: input.expiresAt, createdByErpUserId: actor.erpUserId },
  });
  await auditBooks(companyId, actor, "ISSUE_API_KEY", "ApiCredential", row.id, { name: row.name, prefix, scopes, expiresAt: row.expiresAt });
  return { id: row.id, name: row.name, prefix, token, scopes, expiresAt: row.expiresAt, createdAt: row.createdAt };
}

export async function listApiKeys(companyId: string) {
  return prisma.apiCredential.findMany({
    where: { companyId },
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeApiKey(companyId: string, id: string, actor: Actor = {}) {
  const row = await prisma.apiCredential.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("API key not found");
  if (row.revokedAt) return row;
  const revoked = await prisma.apiCredential.update({ where: { id }, data: { revokedAt: new Date() } });
  await auditBooks(companyId, actor, "REVOKE_API_KEY", "ApiCredential", id, { revokedAt: revoked.revokedAt });
  return revoked;
}

export async function signDocument(companyId: string, input: { entityType: string; entityId: string; statement: string }, actor: Actor) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  return prisma.signatureRecord.create({
    data: { companyId, entityType: input.entityType, entityId: input.entityId, statement: input.statement, signerErpUserId: actor.erpUserId },
  });
}

export async function listAutomation(companyId: string) {
  return prisma.automationJob.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createAutomation(companyId: string, input: { name: string; jobType: string; schedule: string }) {
  const schedule = input.schedule.trim().replace(/\s+/g, " ");
  if (!nextCronTime(parseCron(schedule), new Date())) throw new Error("This schedule never runs");
  return prisma.automationJob.create({ data: { companyId, name: input.name, jobType: input.jobType, schedule } });
}

/** True when the job's schedule has a run time between its last run (or creation) and `now`. */
export function automationDue(job: { schedule: string; lastRunAt: Date | null; createdAt: Date }, now: Date) {
  try {
    const next = nextCronTime(job.schedule, job.lastRunAt ?? job.createdAt);
    return next !== null && next <= now;
  } catch {
    return false;
  }
}

export async function runAutomation(companyId: string, id: string, actor: Actor = {}) {
  const job = await prisma.automationJob.findFirst({ where: { id, companyId, enabled: true } });
  if (!job) throw new Error("Automation job not found");
  let detail: unknown = null;
  try {
    if (job.jobType === "RECURRING_JOURNALS") detail = await runRecurring(companyId, new Date(), actor);
    else if (job.jobType === "ANOMALY_SCAN") detail = await scanAnomalies(companyId);
    else if (job.jobType === "FX_REVALUE") {
      const rates = await prisma.exchangeRate.findMany({ where: { companyId }, distinct: ["currency"] });
      detail = [];
      for (const rate of rates) (detail as unknown[]).push(await revalueCurrency(companyId, rate.currency, actor));
    } else throw new Error(`Unknown job type ${job.jobType}`);
    await prisma.automationJob.update({ where: { id }, data: { lastRunAt: new Date(), lastStatus: "OK" } });
    return { status: "OK", detail };
  } catch (e) {
    await prisma.automationJob.update({ where: { id }, data: { lastRunAt: new Date(), lastStatus: "FAILED" } });
    throw e;
  }
}

export async function askAssistant(companyId: string, question: string) {
  const statements = await getStatements(companyId);
  const cash = statements.position.assets.filter((a) => a.code.startsWith("11")).reduce((s, a) => s + a.amount, 0);
  const [customers, suppliers] = await Promise.all([
    prisma.customer.aggregate({ where: { companyId }, _sum: { balance: true } }),
    prisma.supplier.aggregate({ where: { companyId }, _sum: { balance: true } }),
  ]);
  const currency = (await prisma.currencySettings.findUnique({ where: { companyId } }))?.functionalCurrency ?? "RWF";
  return {
    answer: answerFromBooks(question, {
      profit: statements.income.profit,
      cash,
      receivables: Number(customers._sum.balance ?? 0),
      payables: Number(suppliers._sum.balance ?? 0),
      currency,
    }),
    source: "Posted books",
  };
}

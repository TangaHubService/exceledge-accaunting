import { aggregateTrialBalance, yearEndClosingLines } from "@exceledge/accounting-domain";
import type { PeriodClose, Prisma } from "@prisma/client";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { requestApproval } from "../approvals/approval.service";
import { writeAudit } from "../audit/audit.service";
import { previewDepreciation } from "../fixed-assets/fa.service";
import { createAndPostJournal } from "../journals/journal.service";
import { notify } from "../notifications/notification.service";
import { emitWebhook } from "../platform/webhook.service";
import { getTrialBalance, movements } from "./books.service";

type Actor = { erpUserId?: number; erpRole?: string };
type Kind = "MONTH" | "YEAR";

export const CLOSE_ITEMS = ["BANK_RECONCILIATION", "DEPRECIATION", "FX_REVALUATION", "TAX_FILING", "PAYROLL"] as const;
export type CloseItemKey = (typeof CLOSE_ITEMS)[number];
export type CloseItemStatus = "DONE" | "FAILING" | "NOT_APPLICABLE" | "OVERRIDDEN";

const ITEM_LABELS: Record<CloseItemKey, string> = {
  BANK_RECONCILIATION: "Bank reconciliations completed",
  DEPRECIATION: "Depreciation run posted",
  FX_REVALUATION: "Foreign currency revalued",
  TAX_FILING: "VAT return prepared",
  PAYROLL: "Payroll posted",
};

type Check = { status: Exclude<CloseItemStatus, "OVERRIDDEN">; detail: string };
type Period = Awaited<ReturnType<typeof periodOrThrow>>;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const done = (detail: string): Check => ({ status: "DONE", detail });
const failing = (detail: string): Check => ({ status: "FAILING", detail });
const notApplicable = (detail: string): Check => ({ status: "NOT_APPLICABLE", detail });

async function periodOrThrow(companyId: string, periodId: string) {
  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, financialYear: { companyId } },
    include: { financialYear: true },
  });
  if (!period) throw new Error("Accounting period not found");
  return period;
}

function monthsIn(start: Date, end: Date) {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

async function cashAccounts(companyId: string, period: Period) {
  return prisma.financialAccount.findMany({
    where: { companyId, isActive: true, kind: { in: ["BANK", "MOBILE_MONEY"] }, dateOpened: { lte: period.endDate }, reconcileFrom: { lte: period.endDate } },
    select: { id: true, name: true, glAccountId: true, reconcileFrom: true },
    orderBy: { name: "asc" },
  });
}

async function bankCheck(companyId: string, period: Period): Promise<Check> {
  const accounts = await cashAccounts(companyId, period);
  if (!accounts.length) return notApplicable("No active bank or mobile money accounts");
  const reconciled = await prisma.bankReconciliation.findMany({
    where: { companyId, status: "COMPLETED", financialAccountId: { in: accounts.map((a) => a.id) }, statementDate: { gte: dayStart(period.endDate) } },
    select: { financialAccountId: true },
    distinct: ["financialAccountId"],
  });
  const ok = new Set(reconciled.map((r) => r.financialAccountId));
  const missing = accounts.filter((a) => !ok.has(a.id));
  if (missing.length) return failing(`No completed reconciliation up to ${ymd(period.endDate)} for ${missing.map((a) => a.name).join(", ")}`);
  return done(`${accounts.length} account(s) reconciled up to ${ymd(period.endDate)}`);
}

async function depreciationCheck(companyId: string, period: Period): Promise<Check> {
  const months = monthsIn(period.startDate, period.endDate);
  const runs = await prisma.fixedAssetDepreciationRun.findMany({ where: { companyId, period: { in: months } }, select: { period: true } });
  const ran = new Set(runs.map((r) => r.period));
  const due: string[] = [];
  const hasAssets = await prisma.fixedAsset.count({ where: { companyId, status: "ACTIVE", capitalizedAt: { lte: period.endDate } } });
  for (const month of hasAssets ? months.filter((m) => !ran.has(m)) : []) {
    const preview = await previewDepreciation(companyId, month);
    const capitalized = await prisma.fixedAsset.count({
      where: { id: { in: preview.items.map((i) => i.assetId) }, capitalizedAt: { lte: monthEnd(month) } },
    });
    if (capitalized) due.push(`${month} (${capitalized} asset(s))`);
  }
  if (due.length) return failing(`Depreciation not run for ${due.join(", ")}`);
  if (ran.size) return done(`Depreciation posted for ${[...ran].sort().join(", ")}`);
  return notApplicable("No active assets due for depreciation");
}

async function fxCheck(companyId: string, period: Period): Promise<Check> {
  const functional = (await prisma.currencySettings.findUnique({ where: { companyId } }))?.functionalCurrency ?? "RWF";
  const accounts = await prisma.account.findMany({
    where: { companyId, isActive: true, currency: { not: null, notIn: [functional] } },
    select: { id: true, currency: true },
  });
  if (!accounts.length) return notApplicable("No foreign-currency accounts");
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId, accountId: { in: accounts.map((a) => a.id) }, journal: { status: { in: ["POSTED", "REVERSED"] }, journalDate: { lte: period.endDate } } },
    _sum: { debit: true, credit: true, amountForeign: true },
  });
  const withBalance = new Set(
    sums
      .filter((s) => Math.abs(Number(s._sum.amountForeign ?? 0)) > 0.0001 || Math.abs(Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) > 0.0001)
      .map((s) => s.accountId),
  );
  const currencies = [...new Set(accounts.filter((a) => withBalance.has(a.id)).map((a) => a.currency!.toUpperCase()))].sort();
  if (!currencies.length) return notApplicable("No foreign-currency balances at the period end");
  const revalued = await prisma.fxRevaluation.findMany({
    where: { companyId, currency: { in: currencies }, rateDate: { gte: period.startDate, lte: period.endDate } },
    select: { currency: true },
    distinct: ["currency"],
  });
  const ok = new Set(revalued.map((r) => r.currency));
  const missing = currencies.filter((c) => !ok.has(c));
  if (missing.length) return failing(`Not revalued in the period: ${missing.join(", ")}`);
  return done(`Revalued ${currencies.join(", ")}`);
}

async function taxCheck(companyId: string, period: Period, lastOfYear: boolean): Promise<Check> {
  const settings = await prisma.taxSettings.findUnique({ where: { companyId } });
  if (!settings?.vatRegistered) return notApplicable("The company is not VAT registered");
  const frequency = (settings.vatFilingFrequency ?? "MONTHLY").toUpperCase();
  if (frequency.startsWith("QUARTER") && (period.endDate.getUTCMonth() + 1) % 3 !== 0) return notApplicable("VAT is filed quarterly; no return ends in this period");
  if ((frequency.startsWith("ANNUAL") || frequency.startsWith("YEAR")) && !lastOfYear) return notApplicable("VAT is filed yearly; no return ends in this period");
  const filing = await prisma.taxFiling.findFirst({
    where: { companyId, kind: "VAT", status: { in: ["PREPARED", "FILED"] }, periodFrom: { lte: period.endDate }, periodTo: { gte: dayStart(period.endDate) } },
    orderBy: { periodTo: "desc" },
  });
  if (!filing) return failing(`No VAT return prepared for the period ending ${ymd(period.endDate)}`);
  return done(`${filing.number} ${filing.status.toLowerCase()}`);
}

async function payrollCheck(companyId: string, period: Period): Promise<Check> {
  const payroll = { companyId, eventType: "PAYROLL_APPROVED" };
  const [ever, posted] = await Promise.all([
    prisma.integrationEvent.count({ where: { ...payroll, occurredAt: { lte: period.endDate } } }),
    prisma.integrationEvent.count({ where: { ...payroll, status: "POSTED", occurredAt: { gte: period.startDate, lte: period.endDate } } }),
  ]);
  if (!ever) return notApplicable("No payroll has been posted from the ERP yet");
  if (!posted) return failing("No payroll posted for the period");
  return done(`${posted} payroll run(s) posted`);
}

/** Approvals still waiting on documents dated in the period. Budgets have no date and are left out. */
async function pendingApprovalsIn(companyId: string, period: Period) {
  const rows = await prisma.approvalRequest.findMany({ where: { companyId, status: "PENDING" }, select: { entityType: true, entityId: true } });
  const ids = (type: string) => rows.filter((r) => r.entityType === type).map((r) => r.entityId);
  const range = { gte: period.startDate, lte: period.endDate };
  const counts = await Promise.all([
    prisma.journal.count({ where: { companyId, id: { in: ids("Journal") }, journalDate: range } }),
    prisma.expense.count({ where: { companyId, id: { in: ids("Expense") }, expenseDate: range } }),
    prisma.apBill.count({ where: { companyId, id: { in: ids("ApBill") }, billDate: range } }),
    prisma.taxAdjustment.count({ where: { companyId, id: { in: ids("TaxAdjustment") }, adjustmentDate: range } }),
    prisma.fixedAssetImpairment.count({ where: { companyId, id: { in: ids("FixedAssetImpairment") }, impairmentDate: range } }),
  ]);
  return counts.reduce((s, n) => s + n, 0);
}

/** Open posting exceptions dated in the period by their event, else their journal, else when they were raised. */
async function openExceptionsIn(companyId: string, period: Period) {
  const rows = await prisma.postingException.findMany({
    where: { companyId, status: { in: ["OPEN", "RETRYING"] } },
    select: { integrationEventId: true, journalId: true, createdAt: true },
  });
  if (!rows.length) return 0;
  const [events, journals] = await Promise.all([
    prisma.integrationEvent.findMany({ where: { id: { in: rows.flatMap((r) => r.integrationEventId ?? []) } }, select: { id: true, occurredAt: true } }),
    prisma.journal.findMany({ where: { id: { in: rows.flatMap((r) => r.journalId ?? []) } }, select: { id: true, journalDate: true } }),
  ]);
  const eventDate = new Map(events.map((e) => [e.id, e.occurredAt]));
  const journalDate = new Map(journals.map((j) => [j.id, j.journalDate]));
  return rows.filter((r) => {
    const at = (r.integrationEventId && eventDate.get(r.integrationEventId)) || (r.journalId && journalDate.get(r.journalId)) || r.createdAt;
    return at >= period.startDate && at <= period.endDate;
  }).length;
}

async function unreconciledBankItemsIn(companyId: string, period: Period) {
  let total = 0;
  for (const account of await cashAccounts(companyId, period)) {
    const from = account.reconcileFrom > period.startDate ? account.reconcileFrom : period.startDate;
    const entries = await prisma.glEntry.findMany({
      where: { companyId, accountId: account.glAccountId, transactionDate: { gte: from, lte: period.endDate } },
      select: { id: true },
    });
    if (!entries.length) continue;
    const matched = await prisma.bankMatchEntry.count({ where: { glEntryId: { in: entries.map((e) => e.id) } } });
    total += entries.length - matched;
  }
  return total;
}

async function periodCounts(companyId: string, period: Period) {
  const range = { gte: period.startDate, lte: period.endDate };
  const [drafts, unpostedJournals, unpostedExpenses, heldBills, pendingApprovals, openExceptions, unreconciledBankItems] = await Promise.all([
    prisma.journal.count({ where: { companyId, status: "DRAFT", journalDate: range } }),
    prisma.journal.count({ where: { companyId, status: { in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "POSTING_FAILED"] }, journalDate: range } }),
    prisma.expense.count({ where: { companyId, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] }, expenseDate: range } }),
    prisma.apBill.count({ where: { companyId, status: "PENDING_APPROVAL", billDate: range } }),
    pendingApprovalsIn(companyId, period),
    openExceptionsIn(companyId, period),
    unreconciledBankItemsIn(companyId, period),
  ]);
  return { drafts, unpostedJournals, unpostedExpenses, heldBills, pendingApprovals, openExceptions, unreconciledBankItems };
}

export async function closeApprovalRequired(companyId: string) {
  return (await prisma.approvalPostingControls.findUnique({ where: { companyId }, select: { closeApprovalRequired: true } }))?.closeApprovalRequired ?? false;
}

export async function closeChecklist(companyId: string, periodId: string) {
  const period = await periodOrThrow(companyId, periodId);
  const [counts, tb, earlierOpen, laterPeriods, overrides, pendingRequest, approvalRequired] = await Promise.all([
    periodCounts(companyId, period),
    getTrialBalance(companyId, { asOf: period.endDate }),
    prisma.accountingPeriod.count({
      where: { financialYearId: period.financialYearId, sequence: { lt: period.sequence }, status: { not: "CLOSED" } },
    }),
    prisma.accountingPeriod.count({ where: { financialYearId: period.financialYearId, sequence: { gt: period.sequence } } }),
    prisma.periodCloseOverride.findMany({ where: { companyId, periodId } }),
    prisma.periodClose.findFirst({ where: { companyId, periodId, status: "PENDING_APPROVAL" } }),
    closeApprovalRequired(companyId),
  ]);
  const lastOfYear = laterPeriods === 0;
  const checks = await Promise.all([
    bankCheck(companyId, period),
    depreciationCheck(companyId, period),
    fxCheck(companyId, period),
    taxCheck(companyId, period, lastOfYear),
    payrollCheck(companyId, period),
  ]);
  const items = CLOSE_ITEMS.map((key, i) => {
    const override = overrides.find((o) => o.item === key);
    const check = checks[i];
    return {
      key,
      label: ITEM_LABELS[key],
      status: (check.status === "FAILING" && override ? "OVERRIDDEN" : check.status) as CloseItemStatus,
      detail: check.detail,
      override: override ? { note: override.note, erpUserId: override.erpUserId, at: override.createdAt } : null,
    };
  });

  const blockers: string[] = [];
  if (earlierOpen > 0) blockers.push(`${earlierOpen} earlier period(s) in ${period.financialYear.name} are not closed yet`);
  if (counts.unpostedJournals > 0) blockers.push(`${counts.unpostedJournals} journal(s) in the period are not posted`);
  if (counts.openExceptions > 0) blockers.push(`${counts.openExceptions} open posting exception(s) in the period`);
  if (counts.pendingApprovals > 0) blockers.push(`${counts.pendingApprovals} approval(s) for the period still pending`);
  if (Math.abs(tb.difference) > 0.0001) blockers.push("Trial balance is out of balance");
  for (const item of items) if (item.status === "FAILING") blockers.push(`${item.label}: ${item.detail}`);
  const warnings: string[] = [];
  if (counts.unpostedExpenses > 0) warnings.push(`${counts.unpostedExpenses} expense(s) in the period are not posted`);
  if (counts.heldBills > 0) warnings.push(`${counts.heldBills} supplier bill(s) in the period are held for approval`);
  if (counts.unreconciledBankItems > 0) warnings.push(`${counts.unreconciledBankItems} bank or mobile money entry(ies) in the period are not reconciled`);

  return {
    period,
    canClose: blockers.length === 0,
    blockers,
    warnings,
    items,
    counts,
    drafts: counts.drafts,
    openExceptions: counts.openExceptions,
    pendingApprovals: counts.pendingApprovals,
    earlierOpen,
    lastOfYear,
    difference: tb.difference,
    approvalRequired,
    pendingRequest,
  };
}

type Checklist = Awaited<ReturnType<typeof closeChecklist>>;

function snapshot(check: Checklist): Prisma.InputJsonValue {
  return {
    takenAt: new Date().toISOString(),
    items: check.items.map((i) => ({ ...i, override: i.override && { ...i.override, at: i.override.at.toISOString() } })),
    counts: check.counts,
    blockers: check.blockers,
    warnings: check.warnings,
    earlierOpen: check.earlierOpen,
    difference: check.difference,
  };
}

function assertCloseable(check: Checklist, kind: Kind) {
  if (check.period.status === "CLOSED") throw new Error("Period is already closed");
  if (!check.canClose) throw new Error(check.blockers.join("; "));
  if (kind === "YEAR" && !check.lastOfYear) throw new Error("A year-end close can only be run on the last period of the year");
  if (kind === "MONTH" && check.lastOfYear) throw new Error("Close the last period of the year with a year-end close");
}

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType, entityId, afterJson });
}

/** Closes the period inside the caller's transaction; the conditional status update makes a second closer fail. */
async function commitClose(companyId: string, check: Checklist, kind: Kind, actor: Actor, request?: PeriodClose) {
  const { period } = check;
  let journalId: string | undefined;
  if (kind === "YEAR") {
    const retained = await prisma.account.findFirst({ where: { companyId, code: "3100" } });
    if (!retained) throw new Error("Retained earnings account 3100 is missing");
    const rows = aggregateTrialBalance(await movements(companyId, { from: period.financialYear.startDate, to: period.endDate }), "STANDARD");
    const lines = yearEndClosingLines(rows, retained.id);
    if (lines.length) {
      const journal = await createAndPostJournal(
        companyId,
        {
          journalDate: period.endDate,
          journalType: "ADJUSTMENT",
          description: `Year-end close ${period.financialYear.name}`,
          sourceModule: "CLOSE",
          sourceDocumentType: "YEAR_END_CLOSE",
          sourceDocumentId: period.id,
          lines,
        },
        actor,
      );
      journalId = journal.id;
    }
  }

  const claimed = await prisma.accountingPeriod.updateMany({ where: { id: period.id, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
  if (!claimed.count) throw new Error("Period is already closed");
  const closing = { status: "CLOSED" as const, checklistJson: snapshot(check), journalId, closedByErpUserId: actor.erpUserId, closedAt: new Date() };
  let record: PeriodClose;
  if (request) {
    const moved = await prisma.periodClose.updateMany({
      where: { id: request.id, status: "PENDING_APPROVAL" },
      data: { ...closing, approvedByErpUserId: actor.erpUserId, approvedAt: closing.closedAt },
    });
    if (!moved.count) throw new Error("This close request is no longer waiting for approval");
    record = await prisma.periodClose.findUniqueOrThrow({ where: { id: request.id } });
  } else {
    record = await prisma.periodClose.create({ data: { companyId, periodId: period.id, kind, requestedByErpUserId: actor.erpUserId, ...closing } });
  }
  await notify({ companyId, title: "Period closed", body: `${period.name} closed (${kind}).`, entityType: "AccountingPeriod", entityId: period.id });
  await emitWebhook(companyId, "period.closed", {
    periodId: period.id,
    name: period.name,
    startDate: period.startDate.toISOString().slice(0, 10),
    endDate: period.endDate.toISOString().slice(0, 10),
    kind,
    journalId: journalId ?? null,
  });
  await audit(companyId, actor, "CLOSE_PERIOD", "AccountingPeriod", period.id, { kind, periodCloseId: record.id });
  return record;
}

export async function closePeriod(companyId: string, periodId: string, kind: Kind, actor: Actor = {}) {
  if (await closeApprovalRequired(companyId)) throw new Error("Closing a period needs approval: request the close so another person can approve it");
  const check = await closeChecklist(companyId, periodId);
  if (check.pendingRequest) throw new Error("A close request for this period is waiting for approval");
  assertCloseable(check, kind);
  return inTransaction(async () => {
    await lockForTransaction(`period-close:${periodId}`);
    if (await prisma.periodClose.findFirst({ where: { companyId, periodId, status: "PENDING_APPROVAL" } })) {
      throw new Error("A close request for this period is waiting for approval");
    }
    return commitClose(companyId, check, kind, actor);
  });
}

/** Raises the close for approval; the period closes when the approval is decided. */
export async function requestClose(companyId: string, periodId: string, kind: Kind, actor: Actor = {}, note?: string) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  if (!(await closeApprovalRequired(companyId))) throw new Error("Closing does not need approval for this company; close the period directly");
  const check = await closeChecklist(companyId, periodId);
  assertCloseable(check, kind);
  return inTransaction(async () => {
    await lockForTransaction(`period-close:${periodId}`);
    if (await prisma.periodClose.findFirst({ where: { companyId, periodId, status: "PENDING_APPROVAL" } })) {
      throw new Error("A close request for this period is waiting for approval");
    }
    const period = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    if (period.status === "CLOSED") throw new Error("Period is already closed");
    if (period.status !== "OPEN" && period.status !== "REOPENED" && period.status !== "TEMPORARILY_LOCKED") {
      throw new Error(`Accounting period ${period.name} is ${period.status.toLowerCase().replace("_", " ")}`);
    }
    // Hold postings until the close is approved or rejected (TEMPORARILY_LOCKED is not an open period for journals).
    await prisma.accountingPeriod.update({ where: { id: periodId }, data: { status: "TEMPORARILY_LOCKED" } });
    const row = await prisma.periodClose.create({
      data: { companyId, periodId, kind, status: "PENDING_APPROVAL", checklistJson: snapshot(check), requestedByErpUserId: actor.erpUserId },
    });
    const approval = await requestApproval(
      companyId,
      { entityType: "PeriodClose", entityId: row.id, amount: 0, reason: note?.trim() || `Close ${check.period.name}`, plan: { levels: 1, roles: [] } },
      actor,
    );
    await audit(companyId, actor, "REQUEST_CLOSE", "AccountingPeriod", periodId, { kind, periodCloseId: row.id, approvalRequestId: approval.id });
    return prisma.periodClose.update({ where: { id: row.id }, data: { approvalRequestId: approval.id } });
  });
}

/** Called by the approval engine inside its decision transaction once the final level approves. */
export async function approveCloseRequest(companyId: string, periodCloseId: string, actor: Actor) {
  const request = await prisma.periodClose.findFirst({ where: { id: periodCloseId, companyId } });
  if (!request || request.status !== "PENDING_APPROVAL") throw new Error("This close request is no longer waiting for approval");
  await lockForTransaction(`period-close:${request.periodId}`);
  const check = await closeChecklist(companyId, request.periodId);
  if (check.period.status !== "CLOSED" && !check.canClose) throw new Error(`The period cannot be closed now: ${check.blockers.join("; ")}`);
  assertCloseable(check, request.kind);
  return commitClose(companyId, check, request.kind, actor, request);
}

export async function rejectCloseRequest(companyId: string, periodCloseId: string, note?: string) {
  const request = await prisma.periodClose.findFirst({ where: { id: periodCloseId, companyId, status: "PENDING_APPROVAL" } });
  if (!request) return;
  await prisma.periodClose.update({ where: { id: request.id }, data: { status: "REJECTED", decisionNote: note } });
  // Restore posting if we locked the period for this request and nothing else closed it meanwhile.
  await prisma.accountingPeriod.updateMany({
    where: { id: request.periodId, status: "TEMPORARILY_LOCKED" },
    data: { status: "OPEN" },
  });
}

export async function reopenPeriod(companyId: string, periodId: string, reason: string, actor: Actor = {}) {
  if (!reason.trim()) throw new Error("A reason is required to reopen a period");
  const period = await periodOrThrow(companyId, periodId);
  if (period.status !== "CLOSED") throw new Error("Only a closed period can be reopened");
  return inTransaction(async () => {
    await lockForTransaction(`period-close:${periodId}`);
    const claimed = await prisma.accountingPeriod.updateMany({ where: { id: periodId, status: "CLOSED" }, data: { status: "REOPENED", reopenReason: reason } });
    if (!claimed.count) throw new Error("Only a closed period can be reopened");
    await prisma.periodClose.updateMany({
      where: { companyId, periodId, status: "CLOSED" },
      data: { status: "REOPENED", reopenReason: reason, reopenedByErpUserId: actor.erpUserId, reopenedAt: new Date() },
    });
    // Overrides were accepted for the close being undone; the closing snapshot keeps them.
    await prisma.periodCloseOverride.deleteMany({ where: { companyId, periodId } });
    if (actor.erpUserId) {
      await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action: "REOPEN_PERIOD", entityType: "AccountingPeriod", entityId: periodId, afterJson: { reason } });
    }
    await emitWebhook(companyId, "period.reopened", {
      periodId,
      name: period.name,
      startDate: period.startDate.toISOString().slice(0, 10),
      endDate: period.endDate.toISOString().slice(0, 10),
      reason,
    });
    return { id: periodId, status: "REOPENED", reason };
  });
}

export async function overrideCloseItem(companyId: string, periodId: string, item: CloseItemKey, note: string, actor: Actor = {}) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  const trimmed = note.trim();
  if (trimmed.length < 3) throw new Error("Explain why the item can be accepted");
  const check = await closeChecklist(companyId, periodId);
  if (check.period.status === "CLOSED") throw new Error("Period is already closed");
  const current = check.items.find((i) => i.key === item);
  if (!current) throw new Error("Unknown checklist item");
  if (current.status !== "FAILING") throw new Error(`${current.label} is not failing; there is nothing to override`);
  const row = await prisma.periodCloseOverride.upsert({
    where: { periodId_item: { periodId, item } },
    create: { companyId, periodId, item, note: trimmed, erpUserId: actor.erpUserId },
    update: { note: trimmed, erpUserId: actor.erpUserId, createdAt: new Date() },
  });
  await audit(companyId, actor, "OVERRIDE_CLOSE_ITEM", "AccountingPeriod", periodId, { item, note: trimmed, detail: current.detail });
  return row;
}

export async function removeCloseOverride(companyId: string, periodId: string, item: CloseItemKey, actor: Actor = {}) {
  const period = await periodOrThrow(companyId, periodId);
  if (period.status === "CLOSED") throw new Error("Period is already closed");
  const removed = await prisma.periodCloseOverride.deleteMany({ where: { companyId, periodId, item } });
  if (!removed.count) throw new Error("This item is not overridden");
  await audit(companyId, actor, "REMOVE_CLOSE_OVERRIDE", "AccountingPeriod", periodId, { item });
  return { periodId, item };
}

export async function closeHistory(companyId: string, periodId?: string) {
  const rows = await prisma.periodClose.findMany({
    where: { companyId, ...(periodId ? { periodId } : {}) },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  const [periods, approvals] = await Promise.all([
    prisma.accountingPeriod.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.periodId))] } },
      select: { id: true, name: true, startDate: true, endDate: true, financialYear: { select: { name: true } } },
    }),
    prisma.approvalRequest.findMany({
      where: { companyId, entityType: "PeriodClose", entityId: { in: rows.map((r) => r.id) } },
      select: { id: true, entityId: true, status: true, decidedByErpUserId: true, decidedAt: true, decisionNote: true },
    }),
  ]);
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const approvalByClose = new Map(approvals.map((a) => [a.entityId, a]));
  return rows.map((r) => {
    const period = periodById.get(r.periodId);
    const approval = approvalByClose.get(r.id);
    return {
      id: r.id,
      periodId: r.periodId,
      periodName: period?.name ?? null,
      yearName: period?.financialYear.name ?? null,
      periodStart: period?.startDate ?? null,
      periodEnd: period?.endDate ?? null,
      kind: r.kind,
      status: r.status,
      requestedByErpUserId: r.requestedByErpUserId,
      requestedAt: r.requestedAt,
      approvalRequestId: r.approvalRequestId,
      approvalStatus: approval?.status ?? null,
      decidedByErpUserId: approval?.decidedByErpUserId ?? r.approvedByErpUserId,
      decidedAt: approval?.decidedAt ?? r.approvedAt,
      decisionNote: approval?.decisionNote ?? r.decisionNote,
      closedByErpUserId: r.closedByErpUserId,
      closedAt: r.closedAt,
      journalId: r.journalId,
      reopenReason: r.reopenReason,
      reopenedByErpUserId: r.reopenedByErpUserId,
      reopenedAt: r.reopenedAt,
      checklist: r.checklistJson,
    };
  });
}

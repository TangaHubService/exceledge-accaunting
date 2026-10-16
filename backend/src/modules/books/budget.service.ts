import { AsyncLocalStorage } from "node:async_hooks";
import { budgetVariance, money4, naturalBalance, type BookAccountType } from "@exceledge/accounting-domain";
import type { BudgetStatus, JournalType, Prisma } from "@prisma/client";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { decideApproval, requestApproval, resubmitApproval } from "../approvals/approval.service";
import { writeAudit } from "../audit/audit.service";
import { assertDimensions } from "../journals/journal.service";
import { notify } from "../notifications/notification.service";

type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

export type BudgetLineInput = { accountId: string; amount: number; periodSequence?: number; costCentre?: string | null; project?: string | null; branchId?: string | null };
export type BudgetControlMode = "OFF" | "WARN" | "BLOCK";

const PNL_TYPES = new Set(["INCOME", "OTHER_INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);
const INCOME_TYPES = new Set(["INCOME", "OTHER_INCOME"]);
const EXPENSE_TYPES = new Set(["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);

async function audit(companyId: string, actor: Actor, action: string, entityId: string, afterJson?: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType: "Budget", entityId, beforeJson: beforeJson ?? undefined, afterJson, ...actor.meta });
}

async function budgetOrThrow(companyId: string, id: string) {
  const budget = await prisma.budget.findFirst({ where: { id, companyId }, include: { lines: true } });
  if (!budget) throw new Error("Budget not found");
  return budget;
}

const total = (lines: Array<{ amount: unknown }>) => money4(lines.reduce((s, l) => s + Number(l.amount), 0));

async function resolveYear(companyId: string, financialYearId?: string) {
  if (financialYearId) {
    const year = await prisma.financialYear.findFirst({ where: { id: financialYearId, companyId } });
    if (!year) throw new Error("Financial year not found");
    return year;
  }
  const now = new Date();
  const year =
    (await prisma.financialYear.findFirst({ where: { companyId, isCurrent: true } })) ??
    (await prisma.financialYear.findFirst({ where: { companyId, startDate: { lte: now }, endDate: { gte: now } } }));
  if (!year) throw new Error("Choose the financial year this budget is for");
  return year;
}

/** `a` takes in everything `b` does: each dimension of `a` is unset or equal to `b`'s. */
const covers = (a: Dims, b: Dims) =>
  (!a.costCentre || a.costCentre === b.costCentre) && (!a.project || a.project === b.project) && (!a.branchId || a.branchId === b.branchId);
const overlaps = (a: Dims, b: Dims) =>
  (!a.costCentre || !b.costCentre || a.costCentre === b.costCentre) &&
  (!a.project || !b.project || a.project === b.project) &&
  (!a.branchId || !b.branchId || a.branchId === b.branchId);

/**
 * Lines must be income or expense accounts, months of the year (0 = whole year) and active dimensions.
 * Lines of an account either nest (all spending and, within it, cost centre OPS) or are disjoint, and
 * each account and dimension set is budgeted for the whole year or by month, so totals add up.
 */
async function normalizeLines(companyId: string, financialYearId: string, lines: BudgetLineInput[]) {
  const periods = await prisma.accountingPeriod.count({ where: { financialYearId } });
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: [...new Set(lines.map((l) => l.accountId))] } } });
  const branches = await prisma.companyBranch.findMany({ where: { companyId } });
  await assertDimensions(companyId, { costCentres: lines.map((l) => l.costCentre), projects: lines.map((l) => l.project), branchIds: lines.map((l) => l.branchId) });
  const seen = new Set<string>();
  const rows = lines.map((l, i) => {
    const account = accounts.find((a) => a.id === l.accountId);
    if (!account) throw new Error(`Line ${i + 1}: account not found`);
    if (!PNL_TYPES.has(account.type)) throw new Error(`Line ${i + 1}: account ${account.code} is not an income or expense account`);
    const periodSequence = l.periodSequence ?? 0;
    if (!Number.isInteger(periodSequence) || periodSequence < 0 || periodSequence > periods) {
      throw new Error(`Line ${i + 1}: period ${periodSequence} is not a period of the financial year`);
    }
    if (!Number.isFinite(l.amount) || l.amount < 0) throw new Error(`Line ${i + 1}: the amount must be zero or more`);
    const branchId = l.branchId ? branches.find((b) => b.id === l.branchId || b.externalErpBranchId === l.branchId)!.id : null;
    const row = { accountId: account.id, periodSequence, amount: money4(l.amount), costCentre: l.costCentre || null, project: l.project || null, branchId };
    const key = [row.accountId, row.periodSequence, row.costCentre, row.project, row.branchId].join("|");
    if (seen.has(key)) throw new Error(`Line ${i + 1}: account ${account.code} has two amounts for the same period and dimensions`);
    seen.add(key);
    return row;
  });
  const earlier = new Map<string, Array<(typeof rows)[number] & { key: string }>>();
  rows.forEach((row, i) => {
    const code = accounts.find((a) => a.id === row.accountId)!.code;
    const key = dimKey(row);
    const same = earlier.get(row.accountId) ?? [];
    for (const other of same) {
      if (other.key === key && (other.periodSequence === 0) !== (row.periodSequence === 0)) {
        throw new Error(`Line ${i + 1}: account ${code} has a whole-year amount and monthly amounts for the same dimensions; use one or the other`);
      }
      if (overlaps(other, row) && !covers(other, row) && !covers(row, other)) {
        throw new Error(`Line ${i + 1}: account ${code} has lines whose dimensions partly overlap; each line must sit inside another or be separate from it`);
      }
    }
    same.push({ ...row, key });
    earlier.set(row.accountId, same);
  });
  return rows;
}

export async function listBudgets(companyId: string) {
  return prisma.budget.findMany({ where: { companyId }, include: { lines: true }, orderBy: [{ createdAt: "desc" }] });
}

export async function getBudget(companyId: string, id: string) {
  const budget = await budgetOrThrow(companyId, id);
  const familyId = budget.familyId ?? budget.id;
  const versions = await prisma.budget.findMany({
    where: { companyId, OR: [{ id: familyId }, { familyId }] },
    select: { id: true, name: true, version: true, status: true, createdAt: true, activatedAt: true },
    orderBy: { version: "asc" },
  });
  return { ...budget, versions };
}

export async function createBudget(companyId: string, input: { name: string; financialYearId?: string; lines: BudgetLineInput[] }, actor: Actor = {}) {
  const year = await resolveYear(companyId, input.financialYearId);
  const lines = await normalizeLines(companyId, year.id, input.lines);
  const row = await prisma.budget.create({
    data: { companyId, name: input.name.trim(), financialYearId: year.id, createdByErpUserId: actor.erpUserId, lines: { create: lines } },
    include: { lines: true },
  });
  await audit(companyId, actor, "CREATE", row.id, { name: row.name, version: row.version, lines: row.lines.length, total: total(row.lines) });
  return row;
}

/** Only a draft can be changed; the claim on DRAFT keeps an edit from racing a submit. */
export async function updateBudget(companyId: string, id: string, input: { name?: string; lines?: BudgetLineInput[] }, actor: Actor = {}) {
  return inTransaction(async () => {
    const before = await budgetOrThrow(companyId, id);
    if (before.status !== "DRAFT") throw new Error(`A ${before.status.toLowerCase()} budget cannot be changed; revise it to start a new version`);
    const lines = input.lines ? await normalizeLines(companyId, before.financialYearId ?? (await resolveYear(companyId)).id, input.lines) : null;
    const claimed = await prisma.budget.updateMany({ where: { id, companyId, status: "DRAFT" }, data: { name: input.name?.trim() || before.name } });
    if (!claimed.count) throw new Error("This budget was submitted a moment ago and can no longer be changed");
    if (lines) {
      await prisma.budgetLine.deleteMany({ where: { budgetId: id } });
      await prisma.budgetLine.createMany({ data: lines.map((l) => ({ ...l, budgetId: id })) });
    }
    const row = await budgetOrThrow(companyId, id);
    await audit(companyId, actor, "UPDATE", id, { name: row.name, lines: row.lines.length, total: total(row.lines) }, { name: before.name, lines: before.lines.length, total: total(before.lines) });
    return row;
  });
}

async function moveStatus(companyId: string, id: string, from: BudgetStatus, to: BudgetStatus, data: Record<string, unknown> = {}) {
  const claimed = await prisma.budget.updateMany({ where: { id, companyId, status: from }, data: { status: to, ...data } });
  if (!claimed.count) {
    const now = await prisma.budget.findFirst({ where: { id, companyId }, select: { status: true } });
    if (!now) throw new Error("Budget not found");
    throw new Error(`The budget is ${now.status.toLowerCase()}, not ${from.toLowerCase()}`);
  }
}

/** Sends a draft for approval through the approval engine; a returned request is resubmitted. */
export async function submitBudget(companyId: string, id: string, actor: Actor = {}) {
  return inTransaction(async () => {
    const budget = await budgetOrThrow(companyId, id);
    if (budget.status !== "DRAFT") throw new Error(`Only a draft budget can be submitted; this one is ${budget.status.toLowerCase()}`);
    if (!budget.lines.length) throw new Error("Add at least one line before submitting the budget");
    await moveStatus(companyId, id, "DRAFT", "SUBMITTED");
    const returned = await prisma.approvalRequest.findFirst({ where: { companyId, entityType: "Budget", entityId: id, status: "RETURNED" } });
    const approval = returned
      ? await resubmitApproval(companyId, returned.id, actor, { amount: total(budget.lines) })
      : await requestApproval(companyId, { entityType: "Budget", entityId: id, amount: total(budget.lines), reason: `Budget ${budget.name} v${budget.version}` }, actor);
    await audit(companyId, actor, "SUBMIT", id, { status: "SUBMITTED", approvalId: approval.id }, { status: "DRAFT" });
    return { ...(await budgetOrThrow(companyId, id)), approvalId: approval.id };
  });
}

/** Approves the budget's pending request on the caller's behalf; the approval engine's rules apply. */
export async function approveBudget(companyId: string, id: string, actor: Actor = {}) {
  const budget = await budgetOrThrow(companyId, id);
  if (budget.status !== "SUBMITTED") throw new Error(`Only a submitted budget can be approved; this one is ${budget.status.toLowerCase()}`);
  const pending = await prisma.approvalRequest.findFirst({ where: { companyId, entityType: "Budget", entityId: id, status: "PENDING" } });
  if (!pending) throw new Error("This budget has no pending approval request");
  await decideApproval(companyId, pending.id, "APPROVED", actor);
  return budgetOrThrow(companyId, id);
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002" || /budgets_one_active_per_year/.test((e as Error)?.message ?? "");

/** Makes an approved version the active budget of its year; the version it replaces becomes REVISED. */
export async function activateBudget(companyId: string, id: string, actor: Actor = {}) {
  try {
    return await inTransaction(async () => {
      await lockForTransaction(`budget-activate:${companyId}`);
      const budget = await budgetOrThrow(companyId, id);
      if (budget.status !== "APPROVED") throw new Error(`Only an approved budget can be activated; this one is ${budget.status.toLowerCase()}`);
      if (!budget.financialYearId) throw new Error("Set the budget's financial year before activating it");
      const previous = await prisma.budget.findFirst({ where: { companyId, financialYearId: budget.financialYearId, status: "ACTIVE" } });
      if (previous) await moveStatus(companyId, previous.id, "ACTIVE", "REVISED");
      await moveStatus(companyId, id, "APPROVED", "ACTIVE", { activatedAt: new Date(), activatedByErpUserId: actor.erpUserId });
      await audit(companyId, actor, "ACTIVATE", id, { status: "ACTIVE", replaced: previous?.id ?? null }, { status: "APPROVED" });
      if (previous) await audit(companyId, actor, "REVISE", previous.id, { status: "REVISED", replacedBy: id }, { status: "ACTIVE" });
      return budgetOrThrow(companyId, id);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error("Another budget was activated for this year a moment ago; reload and try again");
    throw e;
  }
}

/** Starts the next version of an active budget as a draft with the same lines. */
export async function reviseBudget(companyId: string, id: string, actor: Actor = {}) {
  return inTransaction(async () => {
    await lockForTransaction(`budget-revise:${companyId}:${id}`);
    const source = await budgetOrThrow(companyId, id);
    if (source.status !== "ACTIVE") throw new Error(`Only the active budget can be revised; this one is ${source.status.toLowerCase()}`);
    const familyId = source.familyId ?? source.id;
    const family = await prisma.budget.findMany({ where: { companyId, OR: [{ id: familyId }, { familyId }] }, select: { version: true, status: true } });
    const open = family.find((v) => v.version > source.version && ["DRAFT", "SUBMITTED", "APPROVED"].includes(v.status));
    if (open) throw new Error(`Version ${open.version} of this budget is already ${open.status.toLowerCase()}; finish or activate it first`);
    const version = Math.max(...family.map((v) => v.version)) + 1;
    const row = await prisma.budget.create({
      data: {
        companyId,
        name: source.name,
        financialYearId: source.financialYearId,
        familyId,
        version,
        revisedFromId: source.id,
        createdByErpUserId: actor.erpUserId,
        lines: {
          create: source.lines.map((l) => ({ accountId: l.accountId, periodSequence: l.periodSequence, amount: l.amount, costCentre: l.costCentre, project: l.project, branchId: l.branchId })),
        },
      },
      include: { lines: true },
    });
    await audit(companyId, actor, "CREATE_REVISION", row.id, { version, revisedFromId: source.id, lines: row.lines.length });
    return row;
  });
}

/** Approval engine outcomes: approval moves a submitted budget to APPROVED; reject or return sends it back to draft. */
export async function applyBudgetApproval(companyId: string, id: string, outcome: "PROGRESS" | "APPROVED" | "REJECTED" | "RETURNED" | "PENDING") {
  if (outcome === "APPROVED") await prisma.budget.updateMany({ where: { id, companyId, status: "SUBMITTED" }, data: { status: "APPROVED", approvedAt: new Date() } });
  if (outcome === "REJECTED" || outcome === "RETURNED") await prisma.budget.updateMany({ where: { id, companyId, status: "SUBMITTED" }, data: { status: "DRAFT" } });
}

type Dims = { costCentre: string | null; project: string | null; branchId: string | null };

/** A budget line without a dimension covers every value of it. `branchKeys` maps a branch id to the ids GL entries may carry. */
function matches(line: Dims, entry: Dims, branchKeys: Map<string, string[]>) {
  if (line.costCentre && line.costCentre !== entry.costCentre) return false;
  if (line.project && line.project !== entry.project) return false;
  if (line.branchId && !(branchKeys.get(line.branchId) ?? [line.branchId]).includes(entry.branchId ?? "")) return false;
  return true;
}

async function branchKeys(companyId: string) {
  const rows = await prisma.companyBranch.findMany({ where: { companyId } });
  return new Map(rows.map((b) => [b.id, [b.id, b.externalErpBranchId].filter(Boolean) as string[]]));
}

const dimKey = (l: Dims) => [l.costCentre ?? "", l.project ?? "", l.branchId ?? ""].join("|");

/** The year-end close moves income and expense to retained earnings; it is not spending or earning. */
const notYearEndClose: Prisma.GlEntryWhereInput = { OR: [{ sourceModule: null }, { sourceModule: { not: "CLOSE" } }] };

/** Budget against posted ledger movement for each account and dimension, month by month. */
export async function budgetVarianceReport(companyId: string, id: string) {
  const budget = await budgetOrThrow(companyId, id);
  const year = budget.financialYearId
    ? await prisma.financialYear.findFirst({ where: { id: budget.financialYearId, companyId }, include: { periods: { orderBy: { sequence: "asc" } } } })
    : await prisma.financialYear.findFirst({ where: { companyId, isCurrent: true }, include: { periods: { orderBy: { sequence: "asc" } } } });
  const periods = year?.periods ?? [];
  const accountIds = [...new Set(budget.lines.map((l) => l.accountId))];
  const [accounts, entries, branches] = await Promise.all([
    prisma.account.findMany({ where: { companyId, id: { in: accountIds } } }),
    prisma.glEntry.findMany({
      where: { companyId, accountId: { in: accountIds }, ...(year ? { transactionDate: { gte: year.startDate, lte: year.endDate } } : {}), ...notYearEndClose },
      select: { accountId: true, transactionDate: true, debit: true, credit: true, costCentre: true, project: true, branchId: true },
    }),
    branchKeys(companyId),
  ]);
  const sequenceOf = (d: Date) => periods.find((p) => p.startDate <= d && p.endDate >= d)?.sequence ?? 0;

  const groups = new Map<string, { accountId: string } & Dims>();
  for (const l of budget.lines) groups.set(`${l.accountId}|${dimKey(l)}`, { accountId: l.accountId, costCentre: l.costCentre, project: l.project, branchId: l.branchId });

  const rows = [...groups.values()].map((g) => {
    const account = accounts.find((a) => a.id === g.accountId);
    const type = (account?.type ?? "EXPENSE") as BookAccountType;
    const lines = budget.lines.filter((l) => l.accountId === g.accountId && dimKey(l) === dimKey(g));
    const actualBySeq = new Map<number, number>();
    for (const e of entries) {
      if (e.accountId !== g.accountId || !matches(g, e, branches)) continue;
      const seq = sequenceOf(e.transactionDate);
      actualBySeq.set(seq, (actualBySeq.get(seq) ?? 0) + naturalBalance(type, Number(e.debit), Number(e.credit)));
    }
    const months = periods.map((p) => {
      const planned = money4(lines.filter((l) => l.periodSequence === p.sequence).reduce((s, l) => s + Number(l.amount), 0));
      const actual = money4(actualBySeq.get(p.sequence) ?? 0);
      return { sequence: p.sequence, budget: planned, actual, variance: money4(actual - planned) };
    });
    const income = INCOME_TYPES.has(type);
    const [summary] = budgetVariance([
      {
        key: account ? `${account.code} ${account.name}` : g.accountId,
        budget: total(lines),
        actual: money4([...actualBySeq.values()].reduce((s, n) => s + n, 0)),
        income,
      },
    ]);
    return {
      ...summary,
      accountId: g.accountId,
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
      kind: income ? ("INCOME" as const) : ("EXPENSE" as const),
      costCentre: g.costCentre,
      project: g.project,
      branchId: g.branchId,
      annualBudget: total(lines.filter((l) => l.periodSequence === 0)),
      months,
    };
  });
  rows.sort((a, b) => (a.accountCode ?? "").localeCompare(b.accountCode ?? "", undefined, { numeric: true }) || a.key.localeCompare(b.key));

  // A line inside a broader line of the same account (cost centre OPS within all spending) is already in its total.
  const outermost = rows.filter((r) => !rows.some((o) => o !== r && o.accountId === r.accountId && covers(o, r)));
  const sum = (kind: "INCOME" | "EXPENSE") => {
    const of = outermost.filter((r) => r.kind === kind);
    const budgetTotal = money4(of.reduce((s, r) => s + r.budget, 0));
    const actual = money4(of.reduce((s, r) => s + r.actual, 0));
    return {
      budget: budgetTotal,
      actual,
      variance: money4(actual - budgetTotal),
      months: periods.map((p, i) => {
        const planned = money4(of.reduce((s, r) => s + r.months[i].budget, 0));
        const act = money4(of.reduce((s, r) => s + r.months[i].actual, 0));
        return { sequence: p.sequence, budget: planned, actual: act, variance: money4(act - planned) };
      }),
    };
  };
  return {
    budget: { id: budget.id, name: budget.name, status: budget.status, version: budget.version, year: year?.name ?? null },
    periods: periods.map((p) => ({ sequence: p.sequence, name: p.name, startDate: p.startDate, endDate: p.endDate })),
    rows,
    totals: { income: sum("INCOME"), expense: sum("EXPENSE") },
  };
}

export async function budgetControlMode(companyId: string): Promise<BudgetControlMode> {
  const row = await prisma.approvalPostingControls.findUnique({ where: { companyId }, select: { budgetControl: true } });
  const mode = row?.budgetControl?.toUpperCase();
  return mode === "WARN" || mode === "BLOCK" ? mode : "OFF";
}

/** Postings people key or approve can be blocked; feeds from other systems and automatic module postings only warn. */
const BLOCKABLE_SOURCES = new Set(["IMPORT", "RECURRING", "EXPENSE", "AP", "BANKING"]);
const SKIPPED_TYPES = new Set<JournalType>(["REVERSAL", "OPENING_BALANCE"]);

const warnOnly = new AsyncLocalStorage<true>();

/** Postings made by `fn` are never blocked by budget control, only warned about: the ERP feed must always post. */
export function withBudgetWarningsOnly<T>(fn: () => Promise<T>) {
  return warnOnly.run(true, fn);
}

export type BudgetWarning = {
  budgetId: string;
  budgetLineId: string;
  account: string;
  period: string;
  costCentre: string | null;
  project: string | null;
  branchId: string | null;
  budget: number;
  actual: number;
  over: number;
};

/**
 * Compares spending on expense accounts, including this journal's GL entries, with the active budget of
 * the journal date's year. Must run inside the posting transaction after the GL entries are written: the
 * account rows the posting updated stay locked until commit, so concurrent postings to the same account
 * are checked one after the other and both see each other's entries.
 */
export async function enforceBudget(
  companyId: string,
  journal: {
    journalNumber: string;
    journalDate: Date;
    journalType: JournalType;
    sourceModule: string | null;
    integrationEventId: string | null;
    costCentre: string | null;
    project: string | null;
    branchId: string | null;
    lines: Array<{ accountId: string; debit: unknown; credit: unknown; costCentre: string | null; project: string | null; branchId: string | null }>;
  },
): Promise<BudgetWarning[]> {
  if (SKIPPED_TYPES.has(journal.journalType) || journal.sourceModule === "CLOSE") return [];
  const mode = await budgetControlMode(companyId);
  if (mode === "OFF") return [];
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: [...new Set(journal.lines.map((l) => l.accountId))] } } });
  const spending = journal.lines
    .filter((l) => EXPENSE_TYPES.has(accounts.find((a) => a.id === l.accountId)?.type ?? ""))
    .map((l) => ({
      accountId: l.accountId,
      amount: Number(l.debit) - Number(l.credit),
      costCentre: l.costCentre ?? journal.costCentre,
      project: l.project ?? journal.project,
      branchId: l.branchId ?? journal.branchId,
    }));
  if (!spending.length) return [];

  const period = await prisma.accountingPeriod.findFirst({
    where: { financialYear: { companyId }, startDate: { lte: journal.journalDate }, endDate: { gte: journal.journalDate } },
    include: { financialYear: true },
  });
  if (!period) return [];
  const budget = await prisma.budget.findFirst({
    where: { companyId, financialYearId: period.financialYearId, status: "ACTIVE" },
    include: { lines: { where: { accountId: { in: spending.map((s) => s.accountId) }, periodSequence: { in: [0, period.sequence] } } } },
  });
  if (!budget?.lines.length) return [];
  const branches = await branchKeys(companyId);

  const warnings: BudgetWarning[] = [];
  for (const line of budget.lines) {
    const delta = spending.filter((s) => s.accountId === line.accountId && matches(line, s, branches)).reduce((sum, s) => sum + s.amount, 0);
    if (delta <= 0.0001) continue;
    const from = line.periodSequence === 0 ? period.financialYear.startDate : period.startDate;
    const to = line.periodSequence === 0 ? period.financialYear.endDate : period.endDate;
    const sums = await prisma.glEntry.aggregate({
      where: {
        companyId,
        accountId: line.accountId,
        transactionDate: { gte: from, lte: to },
        ...(line.costCentre ? { costCentre: line.costCentre } : {}),
        ...(line.project ? { project: line.project } : {}),
        ...(line.branchId ? { branchId: { in: branches.get(line.branchId) ?? [line.branchId] } } : {}),
        ...notYearEndClose,
      },
      _sum: { debit: true, credit: true },
    });
    const actual = money4(Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0));
    const planned = Number(line.amount);
    if (actual <= planned + 0.0001) continue;
    const account = accounts.find((a) => a.id === line.accountId)!;
    warnings.push({
      budgetId: budget.id,
      budgetLineId: line.id,
      account: `${account.code} ${account.name}`,
      period: line.periodSequence === 0 ? period.financialYear.name : period.name,
      costCentre: line.costCentre,
      project: line.project,
      branchId: line.branchId,
      budget: money4(planned),
      actual,
      over: money4(actual - planned),
    });
  }
  if (!warnings.length) return [];

  const describe = (w: BudgetWarning) =>
    `${w.account} in ${w.period}${[w.costCentre && ` cost centre ${w.costCentre}`, w.project && ` project ${w.project}`, w.branchId && ` branch ${w.branchId}`].filter(Boolean).join(",")}: budget ${w.budget}, spent ${w.actual} (${w.over} over)`;
  const blockable = !journal.integrationEventId && !warnOnly.getStore() && (!journal.sourceModule || BLOCKABLE_SOURCES.has(journal.sourceModule));
  if (mode === "BLOCK" && blockable) {
    throw new Error(`Posting would exceed the active budget ${budget.name}: ${warnings.map(describe).join("; ")}`);
  }
  for (const w of warnings) {
    const already = await prisma.notification.count({ where: { companyId, entityType: "BudgetLine", entityId: w.budgetLineId } });
    if (already) continue;
    await notify({
      companyId,
      title: "Budget exceeded",
      body: `${journal.journalNumber} took ${describe(w)}.`,
      severity: "WARNING",
      entityType: "BudgetLine",
      entityId: w.budgetLineId,
    });
  }
  return warnings;
}

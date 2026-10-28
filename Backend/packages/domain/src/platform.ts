/** Phases 11–20: close, statements, FX, budgets, controls, consolidation, platform analytics. */

export type BookAccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "INCOME"
  | "COST_OF_SALES"
  | "EXPENSE"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE";

export type TrialBalanceMode = "STANDARD" | "UNADJUSTED" | "ADJUSTED" | "POST_CLOSING" | "COMPARATIVE";

export interface LedgerMovement {
  accountId: string;
  code: string;
  name: string;
  type: BookAccountType;
  debit: number;
  credit: number;
  journalType?: string;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: BookAccountType;
  debit: number;
  credit: number;
  priorDebit?: number;
  priorCredit?: number;
}

const PNL_TYPES: BookAccountType[] = ["INCOME", "OTHER_INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"];
const INCOME_TYPES: BookAccountType[] = ["INCOME", "OTHER_INCOME"];
const EXPENSE_TYPES: BookAccountType[] = ["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"];

export function money4(value: number): number {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

export function isDebitNormal(type: BookAccountType): boolean {
  return type === "ASSET" || type === "COST_OF_SALES" || type === "EXPENSE" || type === "OTHER_EXPENSE";
}

export function naturalBalance(type: BookAccountType, debit: number, credit: number): number {
  const net = debit - credit;
  return money4(isDebitNormal(type) ? net : -net);
}

function toColumns(net: number): { debit: number; credit: number } {
  if (net >= 0) return { debit: money4(net), credit: 0 };
  return { debit: 0, credit: money4(-net) };
}

export function aggregateTrialBalance(
  lines: LedgerMovement[],
  mode: TrialBalanceMode = "STANDARD",
): TrialBalanceRow[] {
  const include = (line: LedgerMovement) => {
    if (mode === "UNADJUSTED" && line.journalType === "ADJUSTMENT") return false;
    if (mode === "ADJUSTED") return true;
    return true;
  };
  const map = new Map<string, TrialBalanceRow>();
  for (const line of lines) {
    if (!include(line)) continue;
    if (mode === "POST_CLOSING" && PNL_TYPES.includes(line.type)) continue;
    const current = map.get(line.accountId) ?? {
      accountId: line.accountId,
      code: line.code,
      name: line.name,
      type: line.type,
      debit: 0,
      credit: 0,
    };
    current.debit = money4(current.debit + line.debit);
    current.credit = money4(current.credit + line.credit);
    map.set(line.accountId, current);
  }
  return [...map.values()]
    .map((row) => {
      const net = row.debit - row.credit;
      const cols = toColumns(net);
      return { ...row, debit: cols.debit, credit: cols.credit };
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function trialBalanceTotals(rows: TrialBalanceRow[]) {
  const debit = money4(rows.reduce((s, r) => s + r.debit, 0));
  const credit = money4(rows.reduce((s, r) => s + r.credit, 0));
  return { debit, credit, difference: money4(debit - credit), balanced: Math.abs(debit - credit) < 0.0001 };
}

export function comparativeTrialBalance(current: TrialBalanceRow[], prior: TrialBalanceRow[]): TrialBalanceRow[] {
  const priorMap = new Map(prior.map((r) => [r.accountId, r]));
  const ids = new Set([...current.map((r) => r.accountId), ...prior.map((r) => r.accountId)]);
  const rows: TrialBalanceRow[] = [];
  for (const id of ids) {
    const now = current.find((r) => r.accountId === id);
    const then = priorMap.get(id);
    const base = now ?? then!;
    rows.push({
      accountId: id,
      code: base.code,
      name: base.name,
      type: base.type,
      debit: now?.debit ?? 0,
      credit: now?.credit ?? 0,
      priorDebit: then?.debit ?? 0,
      priorCredit: then?.credit ?? 0,
    });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export interface StatementLine {
  code: string;
  name: string;
  amount: number;
}

export interface FinancialStatements {
  income: { revenue: StatementLine[]; expenses: StatementLine[]; totalRevenue: number; totalExpenses: number; profit: number };
  position: { assets: StatementLine[]; liabilities: StatementLine[]; equity: StatementLine[]; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean };
  cashFlow: { operating: number; investing: number; financing: number; netChange: number; cashChange: number; depreciation: number; profit: number };
  ratios: { currentRatio: number | null; grossMargin: number | null; netMargin: number | null; debtToEquity: number | null };
}

function linesFor(rows: TrialBalanceRow[], types: BookAccountType[]): StatementLine[] {
  return rows
    .filter((r) => types.includes(r.type))
    .map((r) => ({ code: r.code, name: r.name, amount: naturalBalance(r.type, r.debit, r.credit) }))
    .filter((l) => Math.abs(l.amount) > 0.0001);
}

export function buildFinancialStatements(rows: TrialBalanceRow[], prior: TrialBalanceRow[] = []): FinancialStatements {
  const revenue = linesFor(rows, INCOME_TYPES);
  const expenses = linesFor(rows, EXPENSE_TYPES);
  const totalRevenue = money4(revenue.reduce((s, l) => s + l.amount, 0));
  const totalExpenses = money4(expenses.reduce((s, l) => s + l.amount, 0));
  const profit = money4(totalRevenue - totalExpenses);

  const assets = linesFor(rows, ["ASSET"]);
  const liabilities = linesFor(rows, ["LIABILITY"]);
  const equity = linesFor(rows, ["EQUITY"]);
  const totalAssets = money4(assets.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = money4(liabilities.reduce((s, l) => s + l.amount, 0));
  let totalEquity = money4(equity.reduce((s, l) => s + l.amount, 0));
  const earningsClosed = rows.some((r) => r.code === "3100" && naturalBalance(r.type, r.debit, r.credit) !== 0) && profit === 0;
  if (!earningsClosed && Math.abs(profit) > 0.0001) {
    equity.push({ code: "CYE", name: "Current year earnings (unclosed)", amount: profit });
    totalEquity = money4(totalEquity + profit);
  }

  // Period P&L figures: balance-sheet movements come from the change since `prior`.
  const priorProfit = money4(
    linesFor(prior, INCOME_TYPES).reduce((s, l) => s + l.amount, 0) -
      linesFor(prior, EXPENSE_TYPES).reduce((s, l) => s + l.amount, 0),
  );
  const periodProfit = money4(profit - priorProfit);
  const depreciation = money4(
    movementOf(rows, prior, ["EXPENSE"], (code) => code === "6300"),
  );
  const isCash = (code: string) => code.startsWith("11");
  const isFixed = (code: string) => code.startsWith("15");
  const workingAssets = movementOf(rows, prior, ["ASSET"], (code) => !isCash(code) && !isFixed(code));
  const fixedNet = movementOf(rows, prior, ["ASSET"], isFixed);
  const liabilityMovement = movementOf(rows, prior, ["LIABILITY"]);
  const equityMovement = movementOf(rows, prior, ["EQUITY"]);
  const operating = money4(periodProfit + depreciation - workingAssets + liabilityMovement);
  const investing = money4(-(fixedNet + depreciation));
  const financing = equityMovement;
  const cashChange = movementOf(rows, prior, ["ASSET"], isCash);

  const currentAssets = money4(assets.filter((a) => a.code.startsWith("1") && !a.code.startsWith("15")).reduce((s, a) => s + a.amount, 0));
  const currentLiabilities = totalLiabilities;
  const grossProfit = money4(totalRevenue - expenses.filter((e) => e.code.startsWith("5")).reduce((s, e) => s + e.amount, 0));

  return {
    income: { revenue, expenses, totalRevenue, totalExpenses, profit },
    position: {
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.05,
    },
    cashFlow: {
      operating,
      investing,
      financing,
      netChange: money4(operating + investing + financing),
      cashChange,
      depreciation,
      profit: periodProfit,
    },
    ratios: {
      currentRatio: currentLiabilities ? money4(currentAssets / currentLiabilities) : null,
      grossMargin: totalRevenue ? money4(grossProfit / totalRevenue) : null,
      netMargin: totalRevenue ? money4(profit / totalRevenue) : null,
      debtToEquity: totalEquity ? money4(totalLiabilities / totalEquity) : null,
    },
  };
}

function movementOf(current: TrialBalanceRow[], prior: TrialBalanceRow[], types: BookAccountType[], codeFilter?: (code: string) => boolean) {
  const sum = (rows: TrialBalanceRow[]) =>
    money4(
      rows
        .filter((r) => types.includes(r.type) && (!codeFilter || codeFilter(r.code)))
        .reduce((s, r) => s + naturalBalance(r.type, r.debit, r.credit), 0),
    );
  return money4(sum(current) - sum(prior));
}

export interface ClosingLine {
  accountId: string;
  description: string;
  debit: number;
  credit: number;
}

export function yearEndClosingLines(
  rows: Array<{ accountId: string; code: string; name: string; type: BookAccountType; debit: number; credit: number }>,
  retainedEarningsAccountId: string,
): ClosingLine[] {
  const lines: ClosingLine[] = [];
  let retainedDebit = 0;
  let retainedCredit = 0;
  for (const row of rows) {
    if (!PNL_TYPES.includes(row.type)) continue;
    const net = money4(row.debit - row.credit);
    if (Math.abs(net) < 0.0001) continue;
    if (net > 0) {
      lines.push({ accountId: row.accountId, description: `Close ${row.code}`, debit: 0, credit: net });
      retainedDebit = money4(retainedDebit + net);
    } else {
      const amount = money4(-net);
      lines.push({ accountId: row.accountId, description: `Close ${row.code}`, debit: amount, credit: 0 });
      retainedCredit = money4(retainedCredit + amount);
    }
  }
  const retainedNet = money4(retainedDebit - retainedCredit);
  if (retainedNet > 0) {
    lines.push({ accountId: retainedEarningsAccountId, description: "Year-end close to retained earnings", debit: retainedNet, credit: 0 });
  } else if (retainedNet < 0) {
    lines.push({ accountId: retainedEarningsAccountId, description: "Year-end close to retained earnings", debit: 0, credit: money4(-retainedNet) });
  }
  const debit = money4(lines.reduce((s, l) => s + l.debit, 0));
  const credit = money4(lines.reduce((s, l) => s + l.credit, 0));
  if (lines.length && Math.abs(debit - credit) > 0.0001) {
    throw new Error("Year-end closing journal does not balance");
  }
  return lines;
}

export function periodCanClose(input: { drafts: number; openExceptions: number; difference: number; pendingApprovals: number }) {
  const blockers: string[] = [];
  if (input.drafts > 0) blockers.push(`${input.drafts} draft journal(s) in the period`);
  if (input.openExceptions > 0) blockers.push(`${input.openExceptions} open posting exception(s)`);
  if (Math.abs(input.difference) > 0.0001) blockers.push("Trial balance is out of balance");
  if (input.pendingApprovals > 0) blockers.push(`${input.pendingApprovals} approval(s) still pending`);
  return { canClose: blockers.length === 0, blockers };
}

export function convertToFunctional(foreignAmount: number, rate: number): number {
  if (!(rate > 0)) throw new Error("Exchange rate must be greater than zero");
  return money4(foreignAmount * rate);
}

/**
 * Settlement of foreign AR/AP: cash moves at the payment rate, the control account is cleared at
 * each document's rate, and the difference is realized FX. Lines are already in functional money;
 * `amountForeign` is debit-positive in the document currency. Unallocated cash uses the payment rate.
 */
export function realizedFxSettlement(input: {
  cashAccountId: string;
  controlAccountId: string;
  fxGainAccountId: string;
  fxLossAccountId: string;
  amount: number;
  paymentRate: number;
  allocations: Array<{ amount: number; documentRate: number }>;
  side: "AR" | "AP";
}): Array<{ accountId: string; description: string; debit: number; credit: number; amountForeign: number }> {
  const amount = money4(input.amount);
  if (!(amount > 0)) throw new Error("Settlement amount must be positive");
  if (!(input.paymentRate > 0)) throw new Error("Exchange rate must be greater than zero");
  const allocated = money4(input.allocations.reduce((s, a) => s + money4(a.amount), 0));
  if (allocated - amount > 0.0001) throw new Error("Allocations exceed the settlement amount");
  for (const a of input.allocations) {
    if (!(a.amount >= 0)) throw new Error("Allocation amounts cannot be negative");
    if (!(a.documentRate > 0)) throw new Error("Exchange rate must be greater than zero");
  }
  const cashFunctional = convertToFunctional(amount, input.paymentRate);
  const controlAllocated = money4(input.allocations.reduce((s, a) => s + convertToFunctional(a.amount, a.documentRate), 0));
  const unallocated = money4(amount - allocated);
  const controlUnallocated = convertToFunctional(unallocated, input.paymentRate);
  const controlFunctional = money4(controlAllocated + controlUnallocated);
  const fx = money4(cashFunctional - controlFunctional);
  const lines: Array<{ accountId: string; description: string; debit: number; credit: number; amountForeign: number }> = [];
  if (input.side === "AR") {
    lines.push({ accountId: input.cashAccountId, description: "Receipt", debit: cashFunctional, credit: 0, amountForeign: amount });
    lines.push({ accountId: input.controlAccountId, description: "Receivables", debit: 0, credit: controlFunctional, amountForeign: -amount });
    if (fx > 0.00005) lines.push({ accountId: input.fxGainAccountId, description: "Realized FX gain", debit: 0, credit: fx, amountForeign: 0 });
    else if (fx < -0.00005) lines.push({ accountId: input.fxLossAccountId, description: "Realized FX loss", debit: money4(-fx), credit: 0, amountForeign: 0 });
  } else {
    lines.push({ accountId: input.controlAccountId, description: "Payables", debit: controlFunctional, credit: 0, amountForeign: amount });
    lines.push({ accountId: input.cashAccountId, description: "Payment", debit: 0, credit: cashFunctional, amountForeign: -amount });
    if (fx > 0.00005) lines.push({ accountId: input.fxLossAccountId, description: "Realized FX loss", debit: fx, credit: 0, amountForeign: 0 });
    else if (fx < -0.00005) lines.push({ accountId: input.fxGainAccountId, description: "Realized FX gain", debit: 0, credit: money4(-fx), amountForeign: 0 });
  }
  return lines;
}

export function unrealizedFxAdjustment(input: {
  foreignBalance: number;
  bookFunctional: number;
  closingRate: number;
  debitNormal: boolean;
}): { newFunctional: number; delta: number; gain: number } {
  const newFunctional = convertToFunctional(input.foreignBalance, input.closingRate);
  const delta = money4(newFunctional - input.bookFunctional);
  const gain = input.debitNormal ? delta : money4(-delta);
  return { newFunctional, delta, gain };
}

/**
 * Converts lines entered in a foreign currency to functional amounts at `rate`.
 * `amountForeign` is debit-positive. Rounding is absorbed by the largest line so the
 * functional journal still balances.
 */
export function convertJournalLines<T extends { debit: number; credit: number }>(
  lines: T[],
  rate: number,
): Array<T & { amountForeign: number }> {
  const converted = lines.map((line) => ({
    ...line,
    amountForeign: money4((Number(line.debit) || 0) - (Number(line.credit) || 0)),
    debit: convertToFunctional(Number(line.debit) || 0, rate),
    credit: convertToFunctional(Number(line.credit) || 0, rate),
  }));
  const diff = money4(
    converted.reduce((s, l) => s + l.debit, 0) - converted.reduce((s, l) => s + l.credit, 0),
  );
  if (diff !== 0 && converted.length) {
    const largest = converted.reduce((a, b) => (Math.max(b.debit, b.credit) > Math.max(a.debit, a.credit) ? b : a));
    if (largest.debit > 0) largest.debit = money4(largest.debit - diff);
    else largest.credit = money4(largest.credit + diff);
  }
  return converted;
}

/**
 * Unrealized FX on one account. Amounts are debit-positive, so a positive result is a
 * gain whether the account is an asset or a liability.
 */
export function revaluationDelta(input: { foreignBalance: number; bookFunctional: number; closingRate: number }): number {
  return money4(convertToFunctional(input.foreignBalance, input.closingRate) - input.bookFunctional);
}

export interface BudgetVarianceRow {
  key: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  favorable: boolean;
}

export function budgetVariance(
  lines: Array<{ key: string; budget: number; actual: number; income: boolean }>,
): BudgetVarianceRow[] {
  return lines.map((line) => {
    const variance = money4(line.actual - line.budget);
    const favorable = line.income ? variance >= 0 : variance <= 0;
    return {
      key: line.key,
      budget: money4(line.budget),
      actual: money4(line.actual),
      variance,
      variancePercent: line.budget ? money4(variance / line.budget) : null,
      favorable,
    };
  });
}

export interface ConsolidationMember {
  name: string;
  ownershipPercent: number;
  rows: TrialBalanceRow[];
}

export interface EliminationLine {
  code: string;
  debit: number;
  credit: number;
}

export function assertEliminationBalanced(lines: EliminationLine[]) {
  if (lines.length < 2) throw new Error("An elimination needs at least two lines");
  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0) throw new Error("Elimination amounts cannot be negative");
    if ((line.debit > 0) === (line.credit > 0)) throw new Error("Each elimination line needs either a debit or a credit");
  }
  const debit = money4(lines.reduce((s, l) => s + l.debit, 0));
  const credit = money4(lines.reduce((s, l) => s + l.credit, 0));
  if (debit !== credit) throw new Error(`Elimination does not balance: debit ${debit}, credit ${credit}`);
}

function profitOf(rows: TrialBalanceRow[]) {
  const income = rows.filter((r) => INCOME_TYPES.includes(r.type)).reduce((s, r) => s + naturalBalance(r.type, r.debit, r.credit), 0);
  const expense = rows.filter((r) => EXPENSE_TYPES.includes(r.type)).reduce((s, r) => s + naturalBalance(r.type, r.debit, r.credit), 0);
  return money4(income - expense);
}

/**
 * Full consolidation: every member is added at 100%, eliminations are applied per account,
 * and the non-controlling share of each partly owned member's net assets and profit is
 * reported separately.
 */
export function consolidateTrialBalances(
  members: ConsolidationMember[],
  eliminations: Array<{ description: string; lines: EliminationLine[] }> = [],
) {
  const map = new Map<string, { code: string; name: string; type: BookAccountType; net: number }>();
  for (const member of members) {
    for (const row of member.rows) {
      const current = map.get(row.code) ?? { code: row.code, name: row.name, type: row.type, net: 0 };
      current.net = money4(current.net + row.debit - row.credit);
      map.set(row.code, current);
    }
  }

  let elimDebit = 0;
  let elimCredit = 0;
  for (const elimination of eliminations) {
    assertEliminationBalanced(elimination.lines);
    for (const line of elimination.lines) {
      const current = map.get(line.code);
      if (!current) throw new Error(`Elimination "${elimination.description}" uses account ${line.code}, which no member has`);
      current.net = money4(current.net + line.debit - line.credit);
      elimDebit = money4(elimDebit + line.debit);
      elimCredit = money4(elimCredit + line.credit);
    }
  }

  const rows: TrialBalanceRow[] = [...map.values()]
    .map((r) => ({ accountId: r.code, code: r.code, name: r.name, type: r.type, ...toColumns(r.net) }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const nonControlling = members
    .filter((m) => m.ownershipPercent < 100)
    .map((m) => {
      const share = money4((100 - m.ownershipPercent) / 100);
      const equity = m.rows.filter((r) => r.type === "EQUITY").reduce((s, r) => s + naturalBalance(r.type, r.debit, r.credit), 0);
      const profit = profitOf(m.rows);
      return {
        member: m.name,
        ownershipPercent: m.ownershipPercent,
        netAssets: money4(equity + profit),
        equity: money4((equity + profit) * share),
        profit: money4(profit * share),
      };
    });
  const groupProfit = profitOf(rows);
  const nciProfit = money4(nonControlling.reduce((s, n) => s + n.profit, 0));
  const nciEquity = money4(nonControlling.reduce((s, n) => s + n.equity, 0));
  const groupEquity = money4(
    rows.filter((r) => r.type === "EQUITY").reduce((s, r) => s + naturalBalance(r.type, r.debit, r.credit), 0) + groupProfit,
  );

  return {
    rows,
    eliminations: { debit: elimDebit, credit: elimCredit },
    totals: trialBalanceTotals(rows),
    nonControllingInterest: nonControlling,
    attribution: {
      profit: groupProfit,
      profitToOwners: money4(groupProfit - nciProfit),
      profitToNonControlling: nciProfit,
      equity: groupEquity,
      equityToOwners: money4(groupEquity - nciEquity),
      equityToNonControlling: nciEquity,
    },
  };
}

type CronField = Set<number>;

function parseCronField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step "${part}"`);
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b === undefined ? (stepText === undefined ? lo : max) : Number(b);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Invalid cron value "${part}" (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export interface CronSchedule {
  minutes: CronField;
  hours: CronField;
  days: CronField;
  months: CronField;
  weekdays: CronField;
  anyDay: boolean;
  anyWeekday: boolean;
}

/** Parses a five-field cron expression (minute hour day month weekday), evaluated in UTC. */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("A schedule needs five fields: minute hour day month weekday");
  const weekdays = parseCronField(fields[4], 0, 7);
  if (weekdays.has(7)) weekdays.add(0);
  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    days: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    weekdays,
    anyDay: fields[2].startsWith("*"),
    anyWeekday: fields[4].startsWith("*"),
  };
}

/** As in standard cron: day and weekday must both match unless both are restricted (no leading `*`), then either may. */
function cronDayMatches(s: CronSchedule, d: Date) {
  const day = s.days.has(d.getUTCDate());
  const weekday = s.weekdays.has(d.getUTCDay());
  if (s.anyDay || s.anyWeekday) return day && weekday;
  return day || weekday;
}

/** First minute strictly after `after` that matches the schedule, or null within ~5 years. */
export function nextCronTime(expression: string | CronSchedule, after: Date): Date | null {
  const s = typeof expression === "string" ? parseCron(expression) : expression;
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = after.getTime() + 5 * 366 * 86_400_000;
  while (t.getTime() <= limit) {
    if (!s.months.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!cronDayMatches(s, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!s.hours.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!s.minutes.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}

export function linearForecast(history: number[], horizon: number): number[] {
  if (horizon < 1) return [];
  if (history.length === 0) return Array.from({ length: horizon }, () => 0);
  if (history.length === 1) return Array.from({ length: horizon }, () => money4(history[0]));
  const n = history.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  history.forEach((y, i) => {
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  });
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return Array.from({ length: horizon }, (_, k) => money4(intercept + slope * (n + k)));
}

export function anomalyScore(amount: number, history: number[]): { score: number; flag: boolean; reason: string } {
  if (history.length < 3) return { score: 0, flag: false, reason: "Not enough history" };
  const mean = history.reduce((s, n) => s + n, 0) / history.length;
  const variance = history.reduce((s, n) => s + (n - mean) ** 2, 0) / history.length;
  const sd = Math.sqrt(variance);
  if (sd < 0.0001) {
    const flag = Math.abs(amount - mean) > 0.0001;
    return { score: flag ? 4 : 0, flag, reason: flag ? "Amount differs from a flat history" : "Within flat history" };
  }
  const score = Math.abs(amount - mean) / sd;
  const flag = score >= 3;
  return { score: money4(score), flag, reason: flag ? "Amount is at least 3 standard deviations from recent postings" : "Within normal range" };
}

export function esgIntensity(measure: number, revenue: number): number | null {
  if (!(revenue > 0)) return null;
  return money4(measure / revenue);
}

export function answerFromBooks(question: string, facts: { profit: number; cash: number; receivables: number; payables: number; currency: string }): string {
  const q = question.toLowerCase();
  const fmt = (n: number) => `${facts.currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (q.includes("profit") || q.includes("income")) return `Posted profit for the selected period is ${fmt(facts.profit)}.`;
  if (q.includes("cash") || q.includes("bank"))
    return facts.cash < 0
      ? `Cash and bank accounts are overdrawn by ${fmt(-facts.cash)} in total.`
      : `Cash and bank balances currently total ${fmt(facts.cash)}.`;
  if (q.includes("receiv") || q.includes("customer")) return `Customer balances currently total ${fmt(facts.receivables)}.`;
  if (q.includes("payab") || q.includes("supplier")) return `Supplier balances currently total ${fmt(facts.payables)}.`;
  return `Posted profit is ${fmt(facts.profit)}. Cash is ${fmt(facts.cash)}. Receivables ${fmt(facts.receivables)}. Payables ${fmt(facts.payables)}.`;
}

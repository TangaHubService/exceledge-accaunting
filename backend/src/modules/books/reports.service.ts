import type { Prisma } from "@prisma/client";
import { money4, naturalBalance, type BookAccountType } from "@exceledge/accounting-domain";
import { prisma } from "../../lib/prisma";

export type Dims = { costCentre?: string; project?: string; branchId?: string };
type Sums = Map<string, { debit: number; credit: number }>;
type AccountInfo = { id: string; code: string; name: string; type: BookAccountType; reportingGroup: string | null; parentId: string | null };
export type Classification = "CURRENT" | "NON_CURRENT";
export type StatementLine = { accountId?: string; code: string; name: string; amount: number; comparative: number; classification?: Classification };

const PNL: BookAccountType[] = ["INCOME", "OTHER_INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"];
const isPnl = (type: BookAccountType) => PNL.includes(type);
const YEAR_END_CLOSE = "YEAR_END_CLOSE";

export function dimWhere(dims: Dims = {}): Prisma.GlEntryWhereInput {
  return {
    ...(dims.costCentre ? { costCentre: dims.costCentre } : {}),
    ...(dims.project ? { project: dims.project } : {}),
    ...(dims.branchId ? { branchId: dims.branchId } : {}),
  };
}

/** Year-end closing journals (and their reversals) carry this source type; `not` alone would drop NULL rows. */
const notClosing: Prisma.GlEntryWhereInput = { OR: [{ sourceDocumentType: null }, { sourceDocumentType: { not: YEAR_END_CLOSE } }] };

async function sums(
  companyId: string,
  opts: { from?: Date; to?: Date; before?: Date; closing?: "exclude" | "only"; dims?: Dims },
): Promise<Sums> {
  const transactionDate: Prisma.DateTimeFilter = {
    ...(opts.from ? { gte: opts.from } : {}),
    ...(opts.to ? { lte: opts.to } : {}),
    ...(opts.before ? { lt: opts.before } : {}),
  };
  const rows = await prisma.glEntry.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      ...dimWhere(opts.dims),
      ...(Object.keys(transactionDate).length ? { transactionDate } : {}),
      ...(opts.closing === "exclude" ? notClosing : opts.closing === "only" ? { sourceDocumentType: YEAR_END_CLOSE } : {}),
    },
    _sum: { debit: true, credit: true },
  });
  return new Map(rows.map((r) => [r.accountId, { debit: Number(r._sum.debit ?? 0), credit: Number(r._sum.credit ?? 0) }]));
}

async function accountsOf(companyId: string): Promise<Map<string, AccountInfo>> {
  const rows = await prisma.account.findMany({
    where: { companyId },
    select: { id: true, code: true, name: true, type: true, reportingGroup: true, parentId: true },
  });
  return new Map(rows.map((a) => [a.id, { ...a, type: a.type as BookAccountType }]));
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

/** The financial year containing `at`, or the calendar year when none is set up. */
export async function financialYearFor(companyId: string, at: Date) {
  const year = await prisma.financialYear.findFirst({ where: { companyId, startDate: { lte: at }, endDate: { gte: startOfDay(at) } } });
  return year
    ? { name: year.name, start: year.startDate, end: year.endDate }
    : { name: String(at.getUTCFullYear()), start: new Date(Date.UTC(at.getUTCFullYear(), 0, 1)), end: new Date(Date.UTC(at.getUTCFullYear(), 11, 31)) };
}

/** Same calendar day one year earlier (29 February becomes 28 February). */
function yearEarlier(d: Date) {
  const shifted = new Date(d);
  shifted.setUTCFullYear(d.getUTCFullYear() - 1);
  if (shifted.getUTCMonth() !== d.getUTCMonth()) shifted.setUTCDate(0);
  return shifted;
}

/** Current or non-current from the account's reporting group (or its parent's), else from the code range. */
export function classify(account: AccountInfo, accounts: Map<string, AccountInfo>): Classification {
  const group = [account.reportingGroup, account.parentId ? accounts.get(account.parentId)?.reportingGroup : null].filter(Boolean).join(" ").toLowerCase();
  if (/(?<!non[\s-]?)current portion|due within/.test(group)) return "CURRENT";
  if (/non[\s-]?current|long[\s-]?term|fixed asset|property|plant|equipment|intangible|investment property/.test(group)) return "NON_CURRENT";
  if (/current|short[\s-]?term|working capital/.test(group)) return "CURRENT";
  const head = Number(account.code.slice(0, 2));
  if (account.type === "ASSET") return [15, 17, 18, 19].includes(head) ? "NON_CURRENT" : "CURRENT";
  if (account.type === "LIABILITY") return head >= 25 && head <= 29 ? "NON_CURRENT" : "CURRENT";
  return "CURRENT";
}

type EquityKind = "OCI" | "DIVIDENDS" | "OTHER";
function equityKind(account: AccountInfo): EquityKind {
  const text = `${account.name} ${account.reportingGroup ?? ""}`.toLowerCase();
  if (account.code.startsWith("33") || /revaluation|other comprehensive|\boci\b|translation reserve|fair value reserve/.test(text)) return "OCI";
  if (/dividend|drawing|distribution/.test(text)) return "DIVIDENDS";
  return "OTHER";
}

const natural = (a: AccountInfo, s?: { debit: number; credit: number }) => (s ? naturalBalance(a.type, s.debit, s.credit) : 0);
/** Credit-positive amount, the sign equity and profit are reported in. */
const creditNet = (s?: { debit: number; credit: number }) => (s ? money4(s.credit - s.debit) : 0);
const sum = (values: number[]) => money4(values.reduce((s, v) => s + v, 0));

function pnlProfit(accounts: Map<string, AccountInfo>, s: Sums) {
  let total = 0;
  for (const [id, v] of s) if (accounts.get(id) && isPnl(accounts.get(id)!.type)) total += v.credit - v.debit;
  return money4(total);
}

const isCash = (a: AccountInfo) => a.type === "ASSET" && a.code.startsWith("11");
const isDepreciation = (a: AccountInfo) => a.type === "EXPENSE" && (a.code === "6300" || /depreciation|amorti[sz]ation/i.test(a.name));

/**
 * Indirect cash flow from the period's movements (year-end closing journals excluded): non-current assets are investing,
 * non-current liabilities and equity other than revaluation reserves are financing, and a revaluation is non-cash.
 */
function cashFlowFrom(accounts: Map<string, AccountInfo>, movement: Sums) {
  let profit = 0;
  let depreciation = 0;
  let workingCapital = 0;
  let investing = 0;
  let financing = 0;
  let cashChange = 0;
  for (const [id, v] of movement) {
    const a = accounts.get(id);
    if (!a) continue;
    const net = natural(a, v);
    if (isPnl(a.type)) {
      profit += v.credit - v.debit;
      if (isDepreciation(a)) depreciation += net;
    } else if (a.type === "ASSET") {
      if (isCash(a)) cashChange += net;
      else if (classify(a, accounts) === "NON_CURRENT") investing -= net;
      else workingCapital -= net;
    } else if (a.type === "LIABILITY") {
      if (classify(a, accounts) === "NON_CURRENT") financing += net;
      else workingCapital += net;
    } else if (equityKind(a) === "OCI") investing += net;
    else financing += net;
  }
  const operating = money4(profit + depreciation + workingCapital);
  investing = money4(investing - depreciation);
  financing = money4(financing);
  return { operating, investing, financing, netChange: money4(operating + investing + financing), cashChange: money4(cashChange), depreciation: money4(depreciation), profit: money4(profit) };
}

async function figuresFor(companyId: string, accounts: Map<string, AccountInfo>, from: Date, to: Date) {
  const year = await financialYearFor(companyId, to);
  const [movement, closingMoves, atEnd, beforeFrom, beforeYear] = await Promise.all([
    sums(companyId, { from, to, closing: "exclude" }),
    sums(companyId, { from, to, closing: "only" }),
    sums(companyId, { to }),
    sums(companyId, { before: from }),
    sums(companyId, { before: year.start }),
  ]);
  const priorYearsUnclosed = pnlProfit(accounts, beforeYear);
  const currentYearEarnings = money4(pnlProfit(accounts, atEnd) - priorYearsUnclosed);
  const cashFlow = cashFlowFrom(accounts, movement);

  return { from, to, year, movement, closingMoves, atEnd, beforeFrom, priorYearsUnclosed, currentYearEarnings, cashFlow };
}

type Figures = Awaited<ReturnType<typeof figuresFor>>;

function lines(
  accounts: Map<string, AccountInfo>,
  current: Sums,
  prior: Sums,
  types: BookAccountType[],
  withClass = false,
): StatementLine[] {
  const ids = new Set([...current.keys(), ...prior.keys()]);
  const out: StatementLine[] = [];
  for (const id of ids) {
    const a = accounts.get(id);
    if (!a || !types.includes(a.type)) continue;
    const amount = natural(a, current.get(id));
    const comparative = natural(a, prior.get(id));
    if (Math.abs(amount) < 0.0001 && Math.abs(comparative) < 0.0001) continue;
    out.push({ accountId: id, code: a.code, name: a.name, amount, comparative, ...(withClass ? { classification: classify(a, accounts) } : {}) });
  }
  return out.sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
}

const totalOf = (rows: StatementLine[], key: "amount" | "comparative") => sum(rows.map((r) => r[key]));

function equityStatement(accounts: Map<string, AccountInfo>, f: Figures, totalEquity: number) {
  const equityIds = [...new Set([...f.beforeFrom.keys(), ...f.atEnd.keys()])]
    .filter((id) => accounts.get(id)?.type === "EQUITY")
    .sort((x, y) => accounts.get(x)!.code.localeCompare(accounts.get(y)!.code, undefined, { numeric: true }));
  const PNL_KEY = "PNL";
  const components = [
    ...equityIds.map((id) => ({ key: id, code: accounts.get(id)!.code, name: accounts.get(id)!.name })),
    { key: PNL_KEY, code: "P&L", name: "Profit not yet closed to retained earnings" },
  ];
  const row = (key: string, label: string, pick: (id: string) => number, pnl: number) => {
    const amounts: Record<string, number> = {};
    for (const id of equityIds) amounts[id] = pick(id);
    amounts[PNL_KEY] = pnl;
    return { key, label, amounts, total: sum(Object.values(amounts)) };
  };
  const moved = (kind: EquityKind) => (id: string) => (equityKind(accounts.get(id)!) === kind ? creditNet(f.movement.get(id)) : 0);
  const rows = [
    row("OPENING", "Opening balance", (id) => creditNet(f.beforeFrom.get(id)), pnlProfit(accounts, f.beforeFrom)),
    row("PROFIT", "Profit for the period", () => 0, pnlProfit(accounts, f.movement)),
    row("OCI", "Other comprehensive income (revaluation surplus)", moved("OCI"), 0),
    row("DIVIDENDS", "Dividends and distributions", moved("DIVIDENDS"), 0),
    row("OTHER", "Capital contributions and other movements", moved("OTHER"), 0),
    row("TRANSFER", "Year-end transfer to retained earnings", (id) => creditNet(f.closingMoves.get(id)), pnlProfit(accounts, f.closingMoves)),
    row("CLOSING", "Closing balance", (id) => creditNet(f.atEnd.get(id)), pnlProfit(accounts, f.atEnd)),
  ];
  const opening = rows[0];
  const closing = rows[rows.length - 1];
  const movements = rows.slice(1, -1);
  const reconciles =
    components.every((c) => Math.abs(opening.amounts[c.key] + sum(movements.map((m) => m.amounts[c.key])) - closing.amounts[c.key]) < 0.005) &&
    Math.abs(closing.total - totalEquity) < 0.005;
  return {
    from: f.from,
    to: f.to,
    components,
    rows: rows.filter((r) => ["OPENING", "PROFIT", "CLOSING"].includes(r.key) || Math.abs(r.total) > 0.0001 || Object.values(r.amounts).some((v) => Math.abs(v) > 0.0001)),
    reconciles,
  };
}

const POLICY_TITLES: Array<[string, string]> = [
  ["revenueRecognitionMethod", "Revenue recognition"],
  ["expenseRecognitionMethod", "Expense recognition"],
  ["depreciationPolicy", "Property, plant and equipment"],
  ["badDebtPolicy", "Trade receivables and bad debts"],
  ["fxRevaluationPolicy", "Foreign currency"],
  ["roundingPolicy", "Rounding"],
];

async function notesFor(companyId: string, from: Date, to: Date, sections: Array<{ title: string; lines: StatementLine[] }>) {
  const [policy, business, currency] = await Promise.all([
    prisma.accountingPolicy.findUnique({ where: { companyId } }),
    prisma.businessAccountingInfo.findUnique({ where: { companyId } }),
    prisma.currencySettings.findUnique({ where: { companyId } }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const framework = business?.reportingFramework?.replace(/_/g, " ");
  const basis = [
    `These statements are prepared from journals posted to the general ledger for ${day(from)} to ${day(to)}.`,
    `${(policy?.accountingBasis ?? business?.accountingBasis ?? "ACCRUAL") === "CASH" ? "Cash" : "Accrual"} basis${framework ? `, ${framework} framework` : ""}. Amounts are in ${currency?.functionalCurrency ?? "the functional currency"}.`,
    "Assets and liabilities are split into current and non-current from each account's reporting group, or its code range when no group is set.",
  ];
  const policies: Array<{ title: string; text: string }> = [];
  if (policy?.inventoryValuationMethod) policies.push({ title: "Inventories", text: `Valued using the ${policy.inventoryValuationMethod.replace(/_/g, " ").toLowerCase()} method.` });
  for (const [key, title] of POLICY_TITLES) {
    const text = policy ? (policy as Record<string, unknown>)[key] : undefined;
    if (typeof text === "string" && text.trim()) policies.push({ title, text: text.trim() });
  }
  const items = sections
    .filter((s) => s.lines.length)
    .map((s, i) => ({ ref: i + 1, title: s.title, lines: s.lines, total: totalOf(s.lines, "amount"), comparative: totalOf(s.lines, "comparative") }));
  return { basis, policies, items };
}

export type StatementOptions = { from?: Date; to?: Date; compareFrom?: Date; compareTo?: Date };

/**
 * Income statement for a date range (from the start of the financial year by default), financial position at `to`,
 * changes in equity, cash flow and notes, each with a comparative period (the same range a year earlier by default).
 * Year-end closing journals are left out of profit; their transfer shows in the equity statement.
 */
export async function periodStatements(companyId: string, opts: StatementOptions = {}) {
  const to = opts.to ?? endOfDay(new Date());
  const from = opts.from ?? (await financialYearFor(companyId, to)).start;
  if (from > to) throw new Error("from must be on or before to");
  const compareTo = opts.compareTo ?? endOfDay(yearEarlier(to));
  const compareFrom = opts.compareFrom ?? startOfDay(yearEarlier(from));
  if (compareFrom > compareTo) throw new Error("compareFrom must be on or before compareTo");

  const accounts = await accountsOf(companyId);
  const [cur, prev] = await Promise.all([figuresFor(companyId, accounts, from, to), figuresFor(companyId, accounts, compareFrom, compareTo)]);

  const revenue = lines(accounts, cur.movement, prev.movement, ["INCOME", "OTHER_INCOME"]);
  const costOfSales = lines(accounts, cur.movement, prev.movement, ["COST_OF_SALES"]);
  const operating = lines(accounts, cur.movement, prev.movement, ["EXPENSE"]);
  const otherExpenses = lines(accounts, cur.movement, prev.movement, ["OTHER_EXPENSE"]);
  const expenses = [...costOfSales, ...operating, ...otherExpenses];
  const incomeTotals = (key: "amount" | "comparative") => {
    const totalRevenue = totalOf(revenue, key);
    const totalCostOfSales = totalOf(costOfSales, key);
    const totalExpenses = totalOf(expenses, key);
    const salesRevenue = sum(revenue.filter((l) => accounts.get(l.accountId!)?.type === "INCOME").map((l) => l[key]));
    return { totalRevenue, totalCostOfSales, grossProfit: money4(salesRevenue - totalCostOfSales), totalExpenses, profit: money4(totalRevenue - totalExpenses) };
  };
  const income = { revenue, expenses, costOfSales, operatingExpenses: operating, otherExpenses, ...incomeTotals("amount") };

  const assets = lines(accounts, cur.atEnd, prev.atEnd, ["ASSET"], true);
  const liabilities = lines(accounts, cur.atEnd, prev.atEnd, ["LIABILITY"], true);
  const equity = lines(accounts, cur.atEnd, prev.atEnd, ["EQUITY"]);
  if (Math.abs(cur.priorYearsUnclosed) > 0.0001 || Math.abs(prev.priorYearsUnclosed) > 0.0001) {
    equity.push({ code: "RE-UNCLOSED", name: "Prior years' profit not yet closed", amount: cur.priorYearsUnclosed, comparative: prev.priorYearsUnclosed });
  }
  if (Math.abs(cur.currentYearEarnings) > 0.0001 || Math.abs(prev.currentYearEarnings) > 0.0001) {
    equity.push({ code: "CYE", name: "Current year earnings (unclosed)", amount: cur.currentYearEarnings, comparative: prev.currentYearEarnings });
  }
  const split = (rows: StatementLine[], c: Classification) => rows.filter((r) => r.classification === c);
  const currentAssets = split(assets, "CURRENT");
  const nonCurrentAssets = split(assets, "NON_CURRENT");
  const currentLiabilities = split(liabilities, "CURRENT");
  const nonCurrentLiabilities = split(liabilities, "NON_CURRENT");
  const retained = await prisma.defaultPostingAccounts.findUnique({ where: { companyId }, select: { retainedEarningsId: true } });
  const retainedId = retained?.retainedEarningsId ?? [...accounts.values()].find((a) => a.code === "3100")?.id;
  const positionTotals = (key: "amount" | "comparative") => {
    const totalAssets = totalOf(assets, key);
    const totalLiabilities = totalOf(liabilities, key);
    const totalEquity = totalOf(equity, key);
    const totals = {
      currentAssets: totalOf(currentAssets, key),
      nonCurrentAssets: totalOf(nonCurrentAssets, key),
      currentLiabilities: totalOf(currentLiabilities, key),
      nonCurrentLiabilities: totalOf(nonCurrentLiabilities, key),
    };
    return { totalAssets, totalLiabilities, totalEquity, balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.05, totals };
  };
  const curPosition = positionTotals("amount");
  const prevPosition = positionTotals("comparative");
  const earnings = (f: Figures, key: "amount" | "comparative") => {
    const closed = retainedId ? (equity.find((l) => l.accountId === retainedId)?.[key] ?? 0) : 0;
    return { retainedEarnings: money4(closed + f.priorYearsUnclosed), currentYearEarnings: f.currentYearEarnings, closedToRetainedEarnings: closed };
  };

  const ratios = (inc: ReturnType<typeof incomeTotals>, pos: ReturnType<typeof positionTotals>) => ({
    currentRatio: pos.totals.currentLiabilities ? money4(pos.totals.currentAssets / pos.totals.currentLiabilities) : null,
    grossMargin: inc.totalRevenue ? money4(inc.grossProfit / inc.totalRevenue) : null,
    netMargin: inc.totalRevenue ? money4(inc.profit / inc.totalRevenue) : null,
    debtToEquity: pos.totalEquity ? money4(pos.totalLiabilities / pos.totalEquity) : null,
  });

  const notes = await notesFor(companyId, from, to, [
    { title: "Revenue and other income", lines: revenue },
    { title: "Cost of sales", lines: costOfSales },
    { title: "Operating expenses", lines: operating },
    { title: "Other expenses", lines: otherExpenses },
    { title: "Non-current assets", lines: nonCurrentAssets },
    { title: "Current assets", lines: currentAssets },
    { title: "Non-current liabilities", lines: nonCurrentLiabilities },
    { title: "Current liabilities", lines: currentLiabilities },
    { title: "Equity", lines: equity },
  ]);

  return {
    from,
    to,
    periodStart: from,
    asOf: to,
    financialYear: cur.year,
    income,
    position: { assets, liabilities, equity, currentAssets, nonCurrentAssets, currentLiabilities, nonCurrentLiabilities, ...curPosition },
    earnings: earnings(cur, "amount"),
    equityStatement: equityStatement(accounts, cur, curPosition.totalEquity),
    cashFlow: cur.cashFlow,
    ratios: ratios(incomeTotals("amount"), curPosition),
    notes,
    comparative: {
      from: compareFrom,
      to: compareTo,
      income: incomeTotals("comparative"),
      position: prevPosition,
      earnings: earnings(prev, "comparative"),
      equityStatement: equityStatement(accounts, prev, prevPosition.totalEquity),
      cashFlow: prev.cashFlow,
      ratios: ratios(incomeTotals("comparative"), prevPosition),
    },
  };
}

export type TrialBalanceColumnsRow = {
  accountId: string;
  code: string;
  name: string;
  type: BookAccountType;
  openingDebit: number;
  openingCredit: number;
  movementDebit: number;
  movementCredit: number;
  debit: number;
  credit: number;
};

const columns = (net: number) => (net >= 0 ? { debit: money4(net), credit: 0 } : { debit: 0, credit: money4(-net) });

/** Opening balance before `from`, debits and credits in the range, and closing balance at `to`, per account. */
export async function trialBalanceColumns(companyId: string, opts: { from?: Date; to?: Date; dims?: Dims } = {}) {
  const to = opts.to ?? endOfDay(new Date());
  const from = opts.from ?? (await financialYearFor(companyId, to)).start;
  if (from > to) throw new Error("from must be on or before to");
  const [accounts, opening, movement] = await Promise.all([
    accountsOf(companyId),
    sums(companyId, { before: from, dims: opts.dims }),
    sums(companyId, { from, to, dims: opts.dims }),
  ]);
  const rows: TrialBalanceColumnsRow[] = [];
  for (const id of new Set([...opening.keys(), ...movement.keys()])) {
    const a = accounts.get(id);
    if (!a) continue;
    const o = opening.get(id) ?? { debit: 0, credit: 0 };
    const m = movement.get(id) ?? { debit: 0, credit: 0 };
    const openingNet = money4(o.debit - o.credit);
    const closingNet = money4(openingNet + m.debit - m.credit);
    if (Math.abs(openingNet) < 0.0001 && Math.abs(closingNet) < 0.0001 && m.debit < 0.0001 && m.credit < 0.0001) continue;
    const oc = columns(openingNet);
    const cc = columns(closingNet);
    rows.push({
      accountId: id,
      code: a.code,
      name: a.name,
      type: a.type,
      openingDebit: oc.debit,
      openingCredit: oc.credit,
      movementDebit: money4(m.debit),
      movementCredit: money4(m.credit),
      debit: cc.debit,
      credit: cc.credit,
    });
  }
  rows.sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
  const total = (k: keyof TrialBalanceColumnsRow) => sum(rows.map((r) => r[k] as number));
  const totals = {
    openingDebit: total("openingDebit"),
    openingCredit: total("openingCredit"),
    movementDebit: total("movementDebit"),
    movementCredit: total("movementCredit"),
  };
  const debit = total("debit");
  const credit = total("credit");
  return { mode: "COLUMNS" as const, from, to, dims: opts.dims ?? {}, rows, totals, debit, credit, difference: money4(debit - credit) };
}

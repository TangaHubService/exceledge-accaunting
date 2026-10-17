import { linearForecast, money4 } from "./platform";

/* ── KPI pack ─────────────────────────────────────────────────────── */

export interface KpiInput {
  /** Length of the period the income figures cover, in days */
  days: number;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  profit: number;
  depreciation: number;
  interest: number;
  incomeTax: number;
  totalAssets: number;
  totalEquity: number;
  currentAssets: number;
  currentLiabilities: number;
  inventory: number;
  receivables: number;
  payables: number;
  cash: number;
}

export type KpiUnit = "MONEY" | "PERCENT" | "RATIO" | "DAYS" | "TIMES";

export interface Kpi {
  code: KpiCode;
  label: string;
  value: number | null;
  unit: KpiUnit;
  higherIsBetter: boolean;
  formula: string;
}

export const KPI_CODES = [
  "REVENUE",
  "GROSS_MARGIN",
  "NET_MARGIN",
  "EBITDA",
  "EBITDA_MARGIN",
  "ROA",
  "ROE",
  "CURRENT_RATIO",
  "QUICK_RATIO",
  "WORKING_CAPITAL",
  "CASH",
  "DSO",
  "DPO",
  "INVENTORY_TURNOVER",
  "DAYS_INVENTORY",
  "CASH_CONVERSION_CYCLE",
] as const;
export type KpiCode = (typeof KPI_CODES)[number];

const ratio = (a: number, b: number) => (Math.abs(b) > 0.0001 ? money4(a / b) : null);
const days = (balance: number, flow: number, period: number) => (flow > 0.0001 ? money4((balance / flow) * period) : null);

/** Margins and returns are fractions (0.25 = 25%); days are scaled to the period's length. */
export function kpiPack(i: KpiInput): Kpi[] {
  const ebitda = money4(i.profit + i.interest + i.incomeTax + i.depreciation);
  const dso = days(i.receivables, i.revenue, i.days);
  const dpo = days(i.payables, i.costOfSales, i.days);
  const dio = days(i.inventory, i.costOfSales, i.days);
  const k = (code: KpiCode, label: string, value: number | null, unit: KpiUnit, higherIsBetter: boolean, formula: string): Kpi => ({
    code,
    label,
    value,
    unit,
    higherIsBetter,
    formula,
  });
  return [
    k("REVENUE", "Revenue", money4(i.revenue), "MONEY", true, "Income and other income for the period"),
    k("GROSS_MARGIN", "Gross margin", ratio(i.grossProfit, i.revenue), "PERCENT", true, "Gross profit ÷ revenue"),
    k("NET_MARGIN", "Net margin", ratio(i.profit, i.revenue), "PERCENT", true, "Profit ÷ revenue"),
    k("EBITDA", "EBITDA", ebitda, "MONEY", true, "Profit + interest + income tax + depreciation and amortisation"),
    k("EBITDA_MARGIN", "EBITDA margin", ratio(ebitda, i.revenue), "PERCENT", true, "EBITDA ÷ revenue"),
    k("ROA", "Return on assets", ratio(i.profit, i.totalAssets), "PERCENT", true, "Profit ÷ total assets at period end"),
    k("ROE", "Return on equity", i.totalEquity > 0 ? ratio(i.profit, i.totalEquity) : null, "PERCENT", true, "Profit ÷ equity at period end"),
    k("CURRENT_RATIO", "Current ratio", ratio(i.currentAssets, i.currentLiabilities), "RATIO", true, "Current assets ÷ current liabilities"),
    k("QUICK_RATIO", "Quick ratio", ratio(i.currentAssets - i.inventory, i.currentLiabilities), "RATIO", true, "(Current assets − inventory) ÷ current liabilities"),
    k("WORKING_CAPITAL", "Working capital", money4(i.currentAssets - i.currentLiabilities), "MONEY", true, "Current assets − current liabilities"),
    k("CASH", "Cash and bank", money4(i.cash), "MONEY", true, "Cash, bank and mobile money balances at period end"),
    k("DSO", "Days sales outstanding", dso, "DAYS", false, "Receivables ÷ revenue × days in period"),
    k("DPO", "Days payables outstanding", dpo, "DAYS", true, "Payables ÷ cost of sales × days in period"),
    k("INVENTORY_TURNOVER", "Inventory turnover", ratio(i.costOfSales, i.inventory), "TIMES", true, "Cost of sales ÷ inventory at period end"),
    k("DAYS_INVENTORY", "Days inventory on hand", dio, "DAYS", false, "Inventory ÷ cost of sales × days in period"),
    k(
      "CASH_CONVERSION_CYCLE",
      "Cash conversion cycle",
      dso !== null && dio !== null && dpo !== null ? money4(dso + dio - dpo) : null,
      "DAYS",
      false,
      "Days sales outstanding + days inventory − days payables",
    ),
  ];
}

export function isKpiCode(value: string): value is KpiCode {
  return (KPI_CODES as readonly string[]).includes(value);
}

/** Whether the actual meets the target; null when either is missing. */
export function kpiTargetMet(value: number | null, target: number | null | undefined, higherIsBetter: boolean): boolean | null {
  if (value === null || target === null || target === undefined) return null;
  return higherIsBetter ? value >= target : value <= target;
}

/* ── Forecasting ──────────────────────────────────────────────────── */

export type ScenarioName = "BEST" | "BASE" | "WORST";

/** Multipliers applied to the base trend: revenue and expenses move independently. */
export interface ScenarioAssumption {
  revenue: number;
  expenses: number;
}

export const DEFAULT_SCENARIOS: Record<ScenarioName, ScenarioAssumption> = {
  BEST: { revenue: 1.1, expenses: 0.97 },
  BASE: { revenue: 1, expenses: 1 },
  WORST: { revenue: 0.85, expenses: 1.05 },
};

export interface ForecastMonth {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
  cashMovement: number;
  closingCash: number;
}

export interface ForecastHistory {
  months: string[];
  revenue: number[];
  expenses: number[];
  /** Net change in cash and bank per month */
  cashMovement: number[];
  /** Cash at the end of the last history month */
  closingCash: number;
}

export function shiftMonth(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + count, 1));
  return d.toISOString().slice(0, 7);
}

/** Consecutive months from `first` to `last` inclusive (YYYY-MM). */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last && out.length < 600; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

const clampNonNegative = (values: number[]) => values.map((v) => money4(Math.max(0, v)));

/**
 * Revenue and expenses follow their own straight-line trends (never below zero), scaled by the scenario.
 * Cash follows the trend of monthly cash movements, shifted by how much the scenario's profit differs
 * from the base profit, so a better scenario also brings in more cash.
 */
export function scenarioForecast(
  history: ForecastHistory,
  horizon: number,
  scenarios: Partial<Record<ScenarioName, ScenarioAssumption>> = DEFAULT_SCENARIOS,
): Record<string, ForecastMonth[]> {
  const baseRevenue = clampNonNegative(linearForecast(history.revenue, horizon));
  const baseExpenses = clampNonNegative(linearForecast(history.expenses, horizon));
  const baseCash = linearForecast(history.cashMovement, horizon);
  const last = history.months.at(-1) ?? new Date().toISOString().slice(0, 7);
  const result: Record<string, ForecastMonth[]> = {};
  for (const [name, a] of Object.entries(scenarios) as Array<[ScenarioName, ScenarioAssumption]>) {
    let cash = history.closingCash;
    result[name] = baseRevenue.map((r, k) => {
      const revenue = money4(r * a.revenue);
      const expenses = money4(baseExpenses[k] * a.expenses);
      const profit = money4(revenue - expenses);
      const cashMovement = money4(baseCash[k] + (profit - (baseRevenue[k] - baseExpenses[k])));
      cash = money4(cash + cashMovement);
      return { month: shiftMonth(last, k + 1), revenue, expenses, profit, cashMovement, closingCash: cash };
    });
  }
  return result;
}

export interface ForecastActualRow {
  month: string;
  forecastRevenue: number;
  actualRevenue: number | null;
  forecastExpenses: number;
  actualExpenses: number | null;
  forecastProfit: number;
  actualProfit: number | null;
  /** Actual − forecast profit */
  profitVariance: number | null;
  profitVariancePercent: number | null;
}

/** Forecast months compared with actuals; months not yet complete have null actuals. */
export function forecastVsActual(
  forecast: ForecastMonth[],
  actuals: Map<string, { revenue: number; expenses: number }>,
  lastCompleteMonth: string,
): ForecastActualRow[] {
  return forecast.map((f) => {
    const a = f.month <= lastCompleteMonth ? (actuals.get(f.month) ?? { revenue: 0, expenses: 0 }) : null;
    const actualProfit = a ? money4(a.revenue - a.expenses) : null;
    const variance = actualProfit === null ? null : money4(actualProfit - f.profit);
    return {
      month: f.month,
      forecastRevenue: f.revenue,
      actualRevenue: a ? money4(a.revenue) : null,
      forecastExpenses: f.expenses,
      actualExpenses: a ? money4(a.expenses) : null,
      forecastProfit: f.profit,
      actualProfit,
      profitVariance: variance,
      profitVariancePercent: variance === null || Math.abs(f.profit) < 0.0001 ? null : money4(variance / Math.abs(f.profit)),
    };
  });
}

/* ── Anomaly rules ────────────────────────────────────────────────── */

export const ANOMALY_RULES = ["AMOUNT_OUTLIER", "ROUND_AMOUNT", "OUTSIDE_HOURS", "DUPLICATE_BILL", "DUPLICATE_PAYMENT"] as const;
export type AnomalyRule = (typeof ANOMALY_RULES)[number];

/** A large amount in whole multiples of `unit` (e.g. 500,000 when unit is 10,000). */
export function isRoundAmount(amount: number, opts: { unit?: number; minimum?: number } = {}): boolean {
  const unit = opts.unit ?? 10_000;
  const minimum = opts.minimum ?? 100_000;
  const value = Math.abs(amount);
  return value >= minimum && Math.abs(value / unit - Math.round(value / unit)) < 1e-9;
}

/** Local weekday and hour of an instant in an IANA time zone. */
export function localTime(at: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday, hour };
}

/** Weekend, or before `startHour` / from `endHour` local time. Returns why, or null. */
export function outsideWorkingHours(at: Date, timeZone: string, startHour = 7, endHour = 20): string | null {
  const { weekday, hour } = localTime(at, timeZone);
  if (weekday === 0 || weekday === 6) return weekday === 0 ? "on a Sunday" : "on a Saturday";
  if (hour < startHour || hour >= endHour) return `at ${String(hour).padStart(2, "0")}:00 local time`;
  return null;
}

/** Case, spaces and punctuation removed, leading zeros on numbers dropped: "INV-0042" and "inv 42" match. */
export function normalizeReference(reference: string | null | undefined): string {
  return (reference ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(^|[a-z])0+(\d)/g, "$1$2");
}

export interface DuplicateCandidate {
  id: string;
  partyId: string;
  amount: number;
  date: Date;
  reference?: string | null;
}

/**
 * Pairs of documents for the same party that look like the same document entered twice: the same amount
 * within `windowDays`, or references that differ only in formatting. Each later document is reported once,
 * against the earliest document it duplicates.
 */
export function findDuplicates(items: DuplicateCandidate[], windowDays: number): Array<{ id: string; duplicateOf: string; reason: string }> {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  const out: Array<{ id: string; duplicateOf: string; reason: string }> = [];
  const window = windowDays * 86_400_000;
  for (let j = 0; j < sorted.length; j++) {
    const later = sorted[j];
    for (let i = 0; i < j; i++) {
      const earlier = sorted[i];
      if (earlier.partyId !== later.partyId) continue;
      const ref = normalizeReference(later.reference);
      if (ref && ref === normalizeReference(earlier.reference)) {
        out.push({ id: later.id, duplicateOf: earlier.id, reason: "has the same reference as" });
        break;
      }
      if (Math.abs(earlier.amount - later.amount) < 0.005 && later.date.getTime() - earlier.date.getTime() <= window) {
        out.push({ id: later.id, duplicateOf: earlier.id, reason: `has the same amount within ${windowDays} days as` });
        break;
      }
    }
  }
  return out;
}

/* ── Assistant: periods in questions ──────────────────────────────── */

export interface QuestionPeriod {
  from: Date;
  to: Date;
  label: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const startOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const endOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 1) - 1);
const monthName = (y: number, m: number) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(startOfMonth(y, m));

/**
 * The period a question refers to: "this/last month", "this/last year" (financial year when given),
 * "this/last quarter", "Q2 2026", "March 2026" / "March", "2025", "year to date". Null when none is named.
 */
export function periodFromQuestion(question: string, today: Date, financialYear?: { start: Date; end: Date }): QuestionPeriod | null {
  const q = question.toLowerCase();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const endToday = new Date(Date.UTC(y, m, today.getUTCDate() + 1) - 1);
  if (/\b(this|current) month\b|\bmonth to date\b|\bmtd\b/.test(q)) return { from: startOfMonth(y, m), to: endToday, label: `${monthName(y, m)} to date` };
  if (/\b(last|previous|prior) month\b/.test(q)) return { from: startOfMonth(y, m - 1), to: endOfMonth(y, m - 1), label: monthName(y, m - 1) };
  const quarter = Math.floor(m / 3);
  if (/\b(this|current) quarter\b/.test(q)) return { from: startOfMonth(y, quarter * 3), to: endToday, label: `Q${quarter + 1} ${y} to date` };
  if (/\b(last|previous|prior) quarter\b/.test(q)) {
    const start = startOfMonth(y, quarter * 3 - 3);
    return { from: start, to: endOfMonth(y, quarter * 3 - 1), label: `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}` };
  }
  const qMatch = q.match(/\bq([1-4])\s*(\d{4})?\b/);
  if (qMatch) {
    const qy = qMatch[2] ? Number(qMatch[2]) : y;
    const qi = Number(qMatch[1]) - 1;
    return { from: startOfMonth(qy, qi * 3), to: endOfMonth(qy, qi * 3 + 2), label: `Q${qi + 1} ${qy}` };
  }
  if (/\b(this|current) (financial |fiscal )?year\b|\byear to date\b|\bytd\b/.test(q)) {
    const from = financialYear?.start ?? new Date(Date.UTC(y, 0, 1));
    return { from, to: endToday, label: "this financial year to date" };
  }
  if (/\b(last|previous|prior) (financial |fiscal )?year\b/.test(q)) {
    if (financialYear) {
      const from = new Date(Date.UTC(financialYear.start.getUTCFullYear() - 1, financialYear.start.getUTCMonth(), financialYear.start.getUTCDate()));
      return { from, to: new Date(financialYear.start.getTime() - 1), label: "last financial year" };
    }
    return { from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y, 0, 1) - 1), label: String(y - 1) };
  }
  for (let i = 0; i < 12; i++) {
    const match = q.match(new RegExp(`\\b(${MONTHS[i]}|${MONTHS[i].slice(0, 3)})\\b(?:\\s+(\\d{4}))?`));
    if (!match || (match[1] === "may" && !match[2] && !/\bin may\b/.test(q))) continue;
    const my = match[2] ? Number(match[2]) : i > m ? y - 1 : y;
    return { from: startOfMonth(my, i), to: endOfMonth(my, i), label: monthName(my, i) };
  }
  const year = q.match(/\b(19|20)\d{2}\b/);
  if (year) {
    const yy = Number(year[0]);
    return { from: new Date(Date.UTC(yy, 0, 1)), to: new Date(Date.UTC(yy + 1, 0, 1) - 1), label: String(yy) };
  }
  return null;
}

export type AssistantTopic =
  | "PROFIT"
  | "REVENUE"
  | "EXPENSES"
  | "CASH"
  | "RECEIVABLES"
  | "OVERDUE"
  | "PAYABLES"
  | "MARGIN"
  | "EBITDA"
  | "LIQUIDITY"
  | "TOP_EXPENSES"
  | "SUMMARY";

/** What a question asks about, by keyword; SUMMARY when nothing matches. */
export function topicOfQuestion(question: string): AssistantTopic {
  const q = question.toLowerCase();
  const rules: Array<[AssistantTopic, RegExp]> = [
    ["OVERDUE", /overdue|late pay|past due/],
    ["TOP_EXPENSES", /(biggest|largest|top|main) (cost|expense|spend)|where .*(money|spend)|spend the most/],
    ["EBITDA", /ebitda/],
    ["MARGIN", /margin/],
    ["LIQUIDITY", /liquid|current ratio|quick ratio|working capital|pay (our|my) (bills|debts)/],
    ["RECEIVABLES", /receiv|customers? owe|owed to us|debtors?/],
    ["PAYABLES", /payab|we owe|suppliers?|creditors?/],
    ["CASH", /\bcash\b|\bbank\b|mobile money|money do we have/],
    ["REVENUE", /revenue|sales|turnover|income from|how much did we (sell|earn|make in sales)/],
    ["EXPENSES", /expense|costs?\b|spen[dt]/],
    ["PROFIT", /profit|loss|net income|earn|make money|bottom line/],
  ];
  return rules.find(([, re]) => re.test(q))?.[0] ?? "SUMMARY";
}

/* ── Signatures ───────────────────────────────────────────────────── */

/**
 * JSON with object keys sorted at every level, dates as ISO strings and undefined left out, so the same
 * content always gives the same text (and hash).
 */
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function" && typeof (v as { toJSON?: unknown }).toJSON === "function") {
      return (v as { toJSON: () => unknown }).toJSON();
    }
    if (Array.isArray(v)) return v.map(normalize);
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as object).sort()) {
        const inner = (v as Record<string, unknown>)[key];
        if (inner !== undefined) out[key] = normalize(inner);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

/** Top-level keys whose canonical value differs between two snapshots. */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k])).sort();
}

/* ── Risk register ────────────────────────────────────────────────── */

export type RiskRating = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export function riskScore(likelihood: number, impact: number): number {
  for (const [name, v] of [
    ["likelihood", likelihood],
    ["impact", impact],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`${name} must be a whole number from 1 to 5`);
  }
  return likelihood * impact;
}

export function riskRating(score: number): RiskRating {
  if (score >= 20) return "CRITICAL";
  if (score >= 10) return "HIGH";
  if (score >= 5) return "MEDIUM";
  return "LOW";
}

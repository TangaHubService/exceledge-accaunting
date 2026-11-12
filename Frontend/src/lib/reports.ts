import { useEffect, useMemo, useState } from "react";
import { isoDay } from "./format";
import { useSession } from "./session";
import { newId, saveLocal, useLocalCollection } from "./txn";

/* ── Report catalogue (mockups 173–178) ─────────────────── */

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/%/g, "percent")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export type ReportEntry = { name: string; to?: string };
export type ReportSection = { title: string; badge?: "NEW"; learnMore?: string; hint?: string; left: ReportEntry[]; right: ReportEntry[] };

const R = (name: string, to?: string): ReportEntry => ({ name, to });
const POSITION = "/reports/statements?tab=position";
const INCOME = "/reports/statements";

const BS = [R("Balance Sheet Comparison", POSITION), R("Balance Sheet Detail", POSITION), R("Balance Sheet Summary", POSITION), R("Statement of Cash Flows", "/reports/statements?tab=cashflow")];
const PL_MORE = [R("Profit and Loss as % of total income"), R("Profit and Loss year-to-date comparison", INCOME), R("Quarterly Profit and Loss Summary")];

export const REPORT_SECTIONS: ReportSection[] = [
  {
    title: "Custom report builder",
    hint: "Check out a new way to build and view reports. Customise these popular reports or start from scratch with",
    left: [R("Revenue Recognition Report (Beta)", "/accounting/revenue-recognition"), R("Inventory Status"), R("Bill Approval Status", "/approvals")],
    right: [R("Product/Item Profitability by Customer"), R("Invoice Approval Status", "/approvals")],
  },
  {
    title: "Business overview",
    left: [R("Audit Log", "/audit"), R("Balance Sheet", POSITION), ...BS, R("Business Snapshot", "/reports/performance"), R("Statement of Changes in equity", "/reports/statements?tab=equity"), R("Profit and Loss", INCOME)],
    right: [R("Profit and Loss by Customer"), R("Profit and Loss by Month"), R("Profit and Loss By Tag Group", "/dimensions"), R("Profit and Loss Comparison", INCOME), R("Profit and Loss Detail", INCOME), ...PL_MORE],
  },
  {
    title: "Who owes you",
    left: [R("Accounts receivable ageing summary", "/reports/ageing"), R("Accounts receivable ageing detail", "/reports/ageing"), R("Collections Report"), R("Customer Balance Summary"), R("Customer Balance Detail"), R("Invoice List")],
    right: [R("Invoices and Received Payments"), R("Open Invoices"), R("Statement List"), R("Terms List"), R("Unbilled charges"), R("Unbilled time")],
  },
  { title: "Projects", left: [R("Project Profitability Summary")], right: [] },
  {
    title: "Inventory",
    left: [R("Inventory Valuation Detail", "/reports/inventory-valuation"), R("Inventory Valuation Summary", "/reports/inventory-valuation"), R("Open Purchase Order Detail")],
    right: [R("Open Purchase Order List"), R("Physical Inventory Worksheet", "/inventory/reconciliation"), R("Inventory Status")],
  },
  {
    title: "Sales and customers",
    left: [R("Cashflow Payment Transactions", "/banking/transactions"), R("Sales by Customer Type Detail"), R("Customer Contact List"), R("Income by Customer Summary")],
    right: [R("Estimates by Customer"), R("Product/Service List", "/products-services"), R("Sales by Product/Service Summary"), R("Sales by Product/Service Detail")],
  },
  {
    title: "What you owe",
    left: [R("Accounts payable ageing summary", "/reports/payables-ageing"), R("Purchase List"), R("Transaction List by Vendor")],
    right: [R("Expenses by Vendor Summary", "/reports/purchases-by-supplier"), R("Vendor Phone List")],
  },
  { title: "Sales tax", left: [R("Tax Liability Report", "/tax/vat")], right: [] },
  { title: "Employees", left: [R("Employee Contact List", "/employees"), R("Recent/Edited Time Activities"), R("Time Activities by Employee Detail")], right: [] },
  {
    title: "For my accountant",
    left: [R("Account List"), R("Balance Sheet", POSITION), ...BS, R("Invalid Journal Transactions", "/exceptions"), R("General Ledger", "/ledger"), R("General Ledger List", "/ledger"), R("Journal", "/journals"), R("Recurring Template List", "/accounting/recurring-transactions"), R("Profit and Loss", INCOME), R("Profit and Loss by Customer")],
    right: [R("Profit and Loss by Month"), R("Profit and Loss Comparison", INCOME), ...PL_MORE, R("Recent Transactions", "/banking/transactions"), R("Reconciliation Reports", "/banking/reconciliation"), R("Trial Balance", "/reports/trial-balance"), R("Adjusted Trial Balance", "/reports/trial-balance"), R("Transaction Detail by Account", "/ledger"), R("Transaction List by Date", "/ledger"), R("Transaction List with Splits", "/ledger")],
  },
  { title: "Payroll", learnMore: "Learn more about Payroll", left: [R("Employee Contact List", "/employees"), R("Recent/Edited Time Activities"), R("Time Activities by Employee Detail")], right: [] },
  { title: "Time", badge: "NEW", left: [R("Timesheet Detail by Employee", "/time/weekly"), R("Time Summary by Pay Type")], right: [] },
];

export function reportHref(entry: ReportEntry) {
  return entry.to ?? `/reports/view/${slugify(entry.name)}`;
}

/** Every distinct report, for the "Type report name here" picker. */
export const ALL_REPORTS: ReportEntry[] = (() => {
  const seen = new Map<string, ReportEntry>();
  for (const s of REPORT_SECTIONS) for (const e of [...s.left, ...s.right]) if (!seen.has(e.name)) seen.set(e.name, e);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

export function reportNameFor(slug: string) {
  return ALL_REPORTS.find((r) => slugify(r.name) === slug)?.name;
}

const DEFAULT_FAVOURITES = new Set(["Accounts receivable ageing summary", "Balance Sheet", "Profit and Loss"].map(slugify));

export function useFavourites() {
  const overrides = useLocalCollection<{ id: string; on: boolean }>("report-favourites");
  const isFavourite = (name: string) => {
    const id = slugify(name);
    return overrides.find((o) => o.id === id)?.on ?? DEFAULT_FAVOURITES.has(id);
  };
  const toggle = (name: string) => saveLocal("report-favourites", { id: slugify(name), on: !isFavourite(name) });
  return { isFavourite, toggle, favourites: ALL_REPORTS.filter((r) => isFavourite(r.name)) };
}

/* ── Locally saved records ──────────────────────────────── */

export type CustomReport = { id: string; name: string; slug: string; from: string; to: string; createdBy: string; modifiedBy: string; updatedAt: string };

export type ManagementReport = { id: string; name: string; period: PeriodKey; sections: string[]; createdBy: string; updatedAt: string };

export const MANAGEMENT_SECTIONS = [
  { id: "overview", label: "Company overview" },
  { id: "pnl", label: "Profit and loss summary" },
  { id: "position", label: "Balance sheet summary" },
  { id: "sales", label: "Sales performance" },
  { id: "expenses", label: "Expenses performance" },
] as const;

export const SYSTEM_MANAGEMENT_REPORTS: Array<{ id: string; name: string; sections: string[] }> = [
  { id: "company-overview", name: "Company Overview", sections: ["overview", "pnl", "position"] },
  { id: "sales-performance", name: "Sales Performance", sections: ["sales"] },
  { id: "expenses-performance", name: "Expenses Performance", sections: ["expenses"] },
];

export type CustomKpi = {
  id: string;
  name: string;
  category: string;
  description: string;
  unit: "Currency" | "Percentage" | "Number";
  higherIsBetter: boolean;
  method: "formula" | "manual";
  formula: string;
  manualValue: number | null;
  manualComparative: number | null;
  chartType: "line" | "bar";
};

export type PlannerItem = { id: string; date: string; description: string; amount: number; direction: "IN" | "OUT"; scenario: "REAL" | "HYPOTHETICAL" };

export type ForecastRules = Record<string, { direction: "" | "INCREASE" | "DECREASE"; percent: string }>;
export type SavedForecast = {
  id: string;
  name: string;
  horizon: "1" | "2" | "3";
  method: "AVERAGE" | "LAST_MONTH" | "MANUAL";
  actualsMonths: 3 | 6 | 12;
  rules: ForecastRules;
  /** Manual overrides: accountId → month → amount. */
  overrides: Record<string, Record<string, number>>;
  updatedAt: string;
};

export function feedback(text: string) {
  saveLocal("report-feedback", { id: newId(), text, at: new Date().toISOString() });
}

/* ── Periods ────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => {
  const nd = new Date(Date.UTC(y, m, d));
  return `${nd.getUTCFullYear()}-${pad(nd.getUTCMonth() + 1)}-${pad(nd.getUTCDate())}`;
};
const monthEnd = (y: number, m: number) => {
  const nd = new Date(Date.UTC(y, m, 1));
  return iso(nd.getUTCFullYear(), nd.getUTCMonth(), lastDay(nd.getUTCFullYear(), nd.getUTCMonth()));
};

export const PERIODS = [
  { key: "THIS_MONTH", label: "This month" },
  { key: "LAST_MONTH", label: "Last month" },
  { key: "THIS_QUARTER", label: "This quarter" },
  { key: "LAST_QUARTER", label: "Last quarter" },
  { key: "THIS_YEAR", label: "This year" },
  { key: "YTD", label: "This year to date" },
  { key: "LAST_YEAR", label: "Last year" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];
export type Range = { from: string; to: string };

export function periodRange(key: PeriodKey, today = isoDay()): Range {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const q = Math.floor(m / 3) * 3;
  switch (key) {
    case "THIS_MONTH":
      return { from: iso(y, m, 1), to: monthEnd(y, m) };
    case "LAST_MONTH":
      return { from: iso(y, m - 1, 1), to: monthEnd(y, m - 1) };
    case "THIS_QUARTER":
      return { from: iso(y, q, 1), to: monthEnd(y, q + 2) };
    case "LAST_QUARTER":
      return { from: iso(y, q - 3, 1), to: monthEnd(y, q - 1) };
    case "THIS_YEAR":
      return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
    case "YTD":
      return { from: iso(y, 0, 1), to: today };
    case "LAST_YEAR":
      return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
  }
}

/** The same length immediately before, or the same dates a year earlier. */
export function compareRange(range: Range, mode: "PREVIOUS" | "LAST_YEAR"): Range {
  const f = new Date(`${range.from}T12:00:00Z`);
  const t = new Date(`${range.to}T12:00:00Z`);
  if (mode === "LAST_YEAR") {
    return { from: iso(f.getUTCFullYear() - 1, f.getUTCMonth(), f.getUTCDate()), to: iso(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()) };
  }
  const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth() + 1;
  const start = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - months, 1));
  return { from: iso(start.getUTCFullYear(), start.getUTCMonth(), 1), to: monthEnd(f.getUTCFullYear(), f.getUTCMonth() - 1) };
}

export const monthKey = (day: string) => day.slice(0, 7);

export function shiftMonth(month: string, by: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = monthKey(from); m <= monthKey(to) && out.length < 60; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthShort = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
export const monthLong = (month: string) => `${monthShort(month)} ${month.slice(0, 4)}`;
export const monthTick = (month: string) => `${monthShort(month)} '${month.slice(2, 4)}`;

/* ── Ledger figures per month ───────────────────────────── */

export type StatementLine = { accountId?: string; code: string; name: string; amount: number; comparative: number };

export type StatementPack = {
  from: string;
  to: string;
  income: {
    totalRevenue: number;
    totalCostOfSales: number;
    grossProfit: number;
    totalExpenses: number;
    profit: number;
    revenue: StatementLine[];
    costOfSales: StatementLine[];
    operatingExpenses: StatementLine[];
    otherExpenses: StatementLine[];
  };
  position: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totals: { currentAssets: number; nonCurrentAssets: number; currentLiabilities: number; nonCurrentLiabilities: number };
  };
  cashFlow: { operating: number; investing: number; financing: number; netChange: number; cashChange: number };
  ratios: { currentRatio: number | null; grossMargin: number | null; netMargin: number | null; debtToEquity: number | null };
  comparative: {
    from: string;
    to: string;
    income: StatementPack["income"];
    position: StatementPack["position"];
    cashFlow: StatementPack["cashFlow"];
    ratios: StatementPack["ratios"];
  };
};

export type KpiRow = { code: string; label: string; value: number | null; unit: "MONEY" | "PERCENT" | "RATIO" | "DAYS" | "TIMES"; higherIsBetter: boolean; formula: string; target: number | null; met: boolean | null };
export type KpiReport = { from: string; to: string; currency: string; kpis: KpiRow[] };

export type MonthFigures = {
  month: string;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  expenses: number;
  profit: number;
  netCash: number;
  kpis: Record<string, number | null>;
  /** accountId → amount for the month (profit and loss accounts). */
  byAccount: Record<string, number>;
};

/* A short-lived cache and a small queue: several charts share these per-month calls. */
const TTL_MS = 60_000;
const MAX_PARALLEL = 4;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
let running = 0;
const waiting: Array<() => void> = [];

function queued<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1;
      job()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          waiting.shift()?.();
        });
    };
    if (running < MAX_PARALLEL) start();
    else waiting.push(start);
  });
}

function cached<T>(path: string, load: (path: string) => Promise<T>): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = queued(() => load(path));
  cache.set(path, { at: Date.now(), value });
  value.catch(() => cache.delete(path));
  return value;
}

export function clearReportCache() {
  cache.clear();
}

function figuresFrom(month: string, s: StatementPack, k: KpiReport): MonthFigures {
  const byAccount: Record<string, number> = {};
  for (const l of [...s.income.revenue, ...s.income.costOfSales, ...s.income.operatingExpenses, ...s.income.otherExpenses]) {
    if (l.accountId) byAccount[l.accountId] = (byAccount[l.accountId] ?? 0) + l.amount;
  }
  return {
    month,
    revenue: s.income.totalRevenue,
    costOfSales: s.income.totalCostOfSales,
    grossProfit: s.income.grossProfit,
    expenses: s.income.totalExpenses,
    profit: s.income.profit,
    netCash: s.cashFlow.netChange,
    kpis: Object.fromEntries(k.kpis.map((x) => [x.code, x.value])),
    byAccount,
  };
}

/** One record per month, read from the ledger. Pass `[]` to skip loading. */
export function useMonthlyFigures(months: string[]) {
  const { api } = useSession();
  const key = months.join(",");
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string; rows?: MonthFigures[]; error?: string }>({ key: "" });

  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = key.split(",");
    Promise.all(
      list.map((month) => {
        const y = Number(month.slice(0, 4));
        const m = Number(month.slice(5, 7)) - 1;
        const qs = `from=${iso(y, m, 1)}&to=${monthEnd(y, m)}`;
        return Promise.all([
          cached(`/api/v1/books/statements?${qs}`, (p) => api<StatementPack>(p)),
          cached(`/api/v1/books/kpis?${qs}`, (p) => api<KpiReport>(p)),
        ]).then(([s, k]) => figuresFrom(month, s, k));
      }),
    )
      .then((rows) => live && setState({ key, rows }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [key, api, nonce]);

  const current = state.key === key;
  return {
    rows: current ? state.rows : undefined,
    error: current ? state.error : undefined,
    loading: Boolean(key) && (!current || (!state.rows && !state.error)),
    reload: () => {
      clearReportCache();
      setState({ key: "" });
      setNonce((n) => n + 1);
    },
  };
}

export function useYearMonths(period: PeriodKey = "YTD") {
  return useMemo(() => {
    const r = periodRange(period);
    return monthsBetween(r.from, r.to > isoDay() ? isoDay() : r.to);
  }, [period]);
}

/* ── KPI formulas ───────────────────────────────────────── */

/** `+ - * / ( )` over numbers and KPI codes. Throws a readable error when the text can't be read. */
export function evaluateFormula(text: string, vars: Record<string, number | null | undefined>): number | null {
  const tokens = text.match(/\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[-+*/()]|\S)/g)?.map((t) => t.trim()) ?? [];
  if (!tokens.length) throw new Error("Enter a formula");
  let i = 0;
  let missing = false;
  function primary(): number {
    const t = tokens[i++];
    if (t === undefined) throw new Error("The formula ends too early");
    if (t === "(") {
      const v = sum();
      if (tokens[i++] !== ")") throw new Error("A closing bracket is missing");
      return v;
    }
    if (t === "-") return -primary();
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      const code = t.toUpperCase();
      if (!(code in vars)) throw new Error(`"${t}" isn't a KPI you can use`);
      const v = vars[code];
      if (v === null || v === undefined) missing = true;
      return v ?? 0;
    }
    throw new Error(`"${t}" can't be used in a formula`);
  }
  function product(): number {
    let v = primary();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      const r = primary();
      if (op === "/" && r === 0) missing = true;
      v = op === "*" ? v * r : r === 0 ? 0 : v / r;
    }
    return v;
  }
  function sum(): number {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const value = sum();
  if (i < tokens.length) throw new Error(`"${tokens[i]}" is in the wrong place`);
  return missing ? null : value;
}

/* ── Files ──────────────────────────────────────────────── */

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const text = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const compactMoney = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return a !== 0 && a < 10 ? n.toFixed(2) : String(Math.round(n * 100) / 100);
};

export function delta(current: number, prior: number) {
  return Math.abs(prior) > 0.0001 ? (current - prior) / Math.abs(prior) : null;
}

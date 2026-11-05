import { CheckCircle2, Database, FileSpreadsheet, Printer, ArrowLeftRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChartError, ChartTable, Gauge, SERIES, type Series, StatTile, TimeChart } from "../../components/reports/charts";
import { CreateReportButton, GiveFeedback, Modal, PageTitle, RpSelect } from "../../components/reports/kit";
import { useFeedback } from "../../components/feedback";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../components/ui";
import { useCompany } from "../../lib/company";
import { amount, date, isoDay } from "../../lib/format";
import {
  delta,
  type ManagementReport,
  MANAGEMENT_SECTIONS,
  monthShort,
  monthsBetween,
  type PeriodKey,
  PERIODS,
  periodRange,
  type StatementPack,
  SYSTEM_MANAGEMENT_REPORTS,
  useMonthlyFigures,
} from "../../lib/reports";
import { Link, navigate, useLocation } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { readLocal } from "../../lib/txn";
import type { ApBill, ArInvoiceList } from "../../lib/types";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${amount(n * 100, 1)}%`);
const ratio = (n: number | null | undefined) => (n === null || n === undefined ? "—" : amount(n, 2));

function statementsPath(period: PeriodKey) {
  const r = periodRange(period);
  return `/api/v1/books/statements?from=${r.from}&to=${r.to > isoDay() ? isoDay() : r.to}`;
}

function usePeriodMonths(period: PeriodKey) {
  return useMemo(() => {
    const r = periodRange(period);
    return monthsBetween(r.from, r.to > isoDay() ? isoDay() : r.to);
  }, [period]);
}

function topBy<T>(rows: T[], name: (r: T) => string, value: (r: T) => number, limit = 3) {
  const out = new Map<string, number>();
  for (const r of rows) out.set(name(r), (out.get(name(r)) ?? 0) + value(r));
  return [...out.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function useReceivables(enabled: boolean) {
  const { can } = useSession();
  const list = useResource<ArInvoiceList>(enabled && can("ar:view") ? "/api/v1/ar/invoices?status=ALL&pageSize=500" : null);
  return useMemo(() => {
    const rows = list.data?.rows ?? [];
    const today = isoDay();
    const gross = rows.reduce((s, r) => s + r.gross, 0);
    const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    return {
      loading: list.loading,
      error: list.error,
      outstanding,
      overdue: rows.filter((r) => r.outstanding > 0 && r.dueDate.slice(0, 10) < today).reduce((s, r) => s + r.outstanding, 0),
      rate: gross > 0 ? (gross - outstanding) / gross : null,
      top: topBy(rows, (r) => r.customerName, (r) => r.outstanding),
    };
  }, [list.data, list.error, list.loading]);
}

function usePayables(enabled: boolean) {
  const { can } = useSession();
  const list = useResource<ApBill[]>(enabled && can("ap:view") ? "/api/v1/ap/bills" : null);
  return useMemo(() => {
    const rows = list.data ?? [];
    const today = isoDay();
    const gross = rows.reduce((s, r) => s + r.gross, 0);
    const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    return {
      loading: list.loading,
      error: list.error,
      outstanding,
      overdue: rows.filter((r) => r.outstanding > 0 && r.dueDate.slice(0, 10) < today).reduce((s, r) => s + r.outstanding, 0),
      rate: gross > 0 ? (gross - outstanding) / gross : null,
      top: topBy(rows, (r) => r.supplierName, (r) => r.outstanding),
    };
  }, [list.data, list.error, list.loading]);
}

/* ── Dashboards (183) ───────────────────────────────────── */

const DASHBOARDS = [
  { id: "profitability", name: "Profitability", summary: "Profitability overview for the selected period, showing revenue, expenses, profit and margin, with performance trend over time." },
  { id: "cash-flow", name: "Cash flow", summary: "Cash flow position and movement for the selected period, by operating, investing and financing activity, with net cash flow." },
  { id: "balance-sheet", name: "Balance Sheet", summary: "Financial position at period end, showing total assets, total liabilities, equity and key balance sheet ratios." },
  { id: "accounts-receivable", name: "Accounts Receivable", summary: "Accounts receivable position, collection performance and outstanding balances for the selected period." },
  { id: "accounts-payable", name: "Accounts Payable", summary: "Accounts payable position, payment performance and outstanding balances for the selected period." },
  { id: "revenue", name: "Revenue", summary: "Revenue performance for the selected period, showing monthly revenue, growth trend and comparison with the prior year." },
] as const;
type DashboardId = (typeof DASHBOARDS)[number]["id"];

function TopTable({ head, rows, currency }: { head: string; rows: Array<[string, number]>; currency: string }) {
  return (
    <table className="rp-mini-table">
      <thead>
        <tr>
          <th>{head}</th>
          <th className="num">Balance ({currency})</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2} className="rp-muted">
              Nothing outstanding
            </td>
          </tr>
        ) : (
          rows.map(([n, v]) => (
            <tr key={n}>
              <td>{n}</td>
              <td className="num">{amount(v, 0)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function DashboardBody({ id, period, compact }: { id: DashboardId; period: PeriodKey; compact?: boolean }) {
  const { currency } = useCompany();
  const money = (n: number) => `${currency} ${amount(n, 0)}`;
  const needsLedger = id !== "accounts-receivable" && id !== "accounts-payable";
  const statements = useResource<StatementPack>(needsLedger ? statementsPath(period) : null);
  const months = usePeriodMonths(period);
  const trend = useMonthlyFigures(id === "profitability" || id === "cash-flow" || id === "revenue" ? months : []);
  const ar = useReceivables(id === "accounts-receivable");
  const ap = usePayables(id === "accounts-payable");
  const labels = months.map(monthShort);
  const h = compact ? 110 : 280;

  const failed = statements.error ?? trend.error ?? ar.error ?? ap.error;
  if (failed) return <ChartError onRetry={compact ? undefined : () => (statements.reload(), trend.reload())} />;

  if (id === "accounts-receivable" || id === "accounts-payable") {
    const d = id === "accounts-receivable" ? ar : ap;
    const noun = id === "accounts-receivable" ? "receivables" : "payables";
    if (d.loading) return <SkeletonRows rows={3} cols={3} />;
    return (
      <>
        <div className="rp-tiles">
          <StatTile label={`Total ${noun}`} value={money(d.outstanding)} hint={`Open ${noun}`} />
          <StatTile label={id === "accounts-receivable" ? "Collection rate" : "Payment rate"} value={pct(d.rate)} hint="Share of billed value settled" />
          <StatTile label="Overdue" value={money(d.overdue)} hint="Past due date" />
        </div>
        <div className="rp-dash-split">
          <div>
            <h4>{id === "accounts-receivable" ? "Collected so far" : "Paid so far"}</h4>
            <Gauge value={d.rate} label={id === "accounts-receivable" ? "Collection rate" : "Payment rate"} size={compact ? 120 : 200} />
          </div>
          <div>
            <h4>{id === "accounts-receivable" ? "Top customers" : "Top suppliers"}</h4>
            <TopTable head={id === "accounts-receivable" ? "Customer" : "Supplier"} rows={d.top} currency={currency} />
          </div>
        </div>
      </>
    );
  }

  const s = statements.data;
  if (!s) return <SkeletonRows rows={3} cols={3} />;
  const p = s.comparative;

  if (id === "balance-sheet") {
    const turnover = s.position.totalAssets ? s.income.totalRevenue / s.position.totalAssets : null;
    const priorTurnover = p.position.totalAssets ? p.income.totalRevenue / p.position.totalAssets : null;
    return (
      <>
        <div className="rp-tiles">
          <StatTile label="Total assets" value={money(s.position.totalAssets)} change={delta(s.position.totalAssets, p.position.totalAssets)} />
          <StatTile label="Total liabilities" value={money(s.position.totalLiabilities)} change={delta(s.position.totalLiabilities, p.position.totalLiabilities)} invert />
          <StatTile label="Equity" value={money(s.position.totalEquity)} change={delta(s.position.totalEquity, p.position.totalEquity)} />
        </div>
        <div className="rp-tiles">
          <StatTile label="Current ratio" value={ratio(s.ratios.currentRatio)} hint={`${ratio(p.ratios.currentRatio)} prior year`} />
          <StatTile label="Debt to equity" value={ratio(s.ratios.debtToEquity)} hint={`${ratio(p.ratios.debtToEquity)} prior year`} />
          <StatTile label="Asset turnover" value={ratio(turnover)} hint={`${ratio(priorTurnover)} prior year`} />
        </div>
      </>
    );
  }

  if (id === "cash-flow") {
    const values = (trend.rows ?? []).map((m) => m.netCash);
    const series: Series[] = [{ name: "Net cash flow", color: SERIES[0], values }];
    return (
      <>
        <div className="rp-tiles">
          <StatTile label="Operating" value={money(s.cashFlow.operating)} change={delta(s.cashFlow.operating, p.cashFlow.operating)} />
          <StatTile label="Investing" value={money(s.cashFlow.investing)} change={delta(s.cashFlow.investing, p.cashFlow.investing)} />
          <StatTile label="Financing" value={money(s.cashFlow.financing)} change={delta(s.cashFlow.financing, p.cashFlow.financing)} />
          <StatTile label="Net cash flow" value={money(s.cashFlow.netChange)} change={delta(s.cashFlow.netChange, p.cashFlow.netChange)} />
        </div>
        <h4>Monthly cash flow</h4>
        {trend.rows ? <TimeChart labels={labels} series={series} height={h} compact={compact} prefix={compact ? "" : `${currency} `} label="Net cash flow by month" /> : <SkeletonRows rows={2} cols={1} />}
        {!compact && trend.rows && <ChartTable labels={labels} series={series} />}
      </>
    );
  }

  if (id === "revenue") {
    const values = (trend.rows ?? []).map((m) => m.revenue);
    const series: Series[] = [{ name: "Revenue", color: SERIES[0], values }];
    const growth = delta(s.income.totalRevenue, p.income.totalRevenue);
    return (
      <div className="rp-dash-split wide">
        <div>
          <h4>Monthly revenue</h4>
          {trend.rows ? <TimeChart labels={labels} series={series} height={compact ? 150 : 300} compact={compact} prefix={compact ? "" : `${currency} `} label="Revenue by month" /> : <SkeletonRows rows={2} cols={1} />}
          {!compact && trend.rows && <ChartTable labels={labels} series={series} />}
        </div>
        <div>
          <h4>Revenue growth</h4>
          <StatTile label="Revenue" value={money(s.income.totalRevenue)} change={growth} />
          {trend.rows && <TimeChart labels={labels} series={[{ name: "Revenue", color: SERIES[0], values, kind: "area" }]} height={compact ? 80 : 180} ticks={2} compact prefix="" label="Revenue trend" />}
        </div>
      </div>
    );
  }

  const profits = (trend.rows ?? []).map((m) => m.profit);
  const series: Series[] = [{ name: "Profit", color: SERIES[0], values: profits, kind: "area" }];
  const totalCost = s.income.totalCostOfSales + s.income.totalExpenses;
  const priorCost = p.income.totalCostOfSales + p.income.totalExpenses;
  return (
    <>
      <div className="rp-tiles">
        <StatTile label="Revenue" value={money(s.income.totalRevenue)} change={delta(s.income.totalRevenue, p.income.totalRevenue)} />
        <StatTile label="Expenses" value={money(totalCost)} change={delta(totalCost, priorCost)} invert />
        <StatTile label="Profit" value={money(s.income.profit)} change={delta(s.income.profit, p.income.profit)} />
        <StatTile label="Margin" value={pct(s.ratios.netMargin)} hint={`${pct(p.ratios.netMargin)} prior year`} />
      </div>
      <h4>Profit trend</h4>
      {trend.rows ? <TimeChart labels={labels} series={series} height={h} compact={compact} prefix={compact ? "" : `${currency} `} label="Profit by month" /> : <SkeletonRows rows={2} cols={1} />}
      {!compact && trend.rows && <ChartTable labels={labels} series={series} />}
    </>
  );
}

export function Dashboards() {
  return (
    <div className="rp-page">
      <PageTitle title="Dashboards" actions={<GiveFeedback />} />
      <div className="rp-dash-grid">
        {DASHBOARDS.map((d) => (
          <Link key={d.id} to={`/reports/dashboards/${d.id}`} className="rp-dash-card">
            <div className="rp-dash-thumb" aria-hidden="true">
              <div className="rp-dash-summary">
                <b>Summary</b>
                {d.summary}
              </div>
              <p className="rp-dash-period">Period: This year</p>
              <DashboardBody id={d.id} period="YTD" compact />
            </div>
            <div className="rp-dash-foot">
              <h2>{d.name}</h2>
              <span>Standard</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DashboardDetail({ id }: { id: string }) {
  const [period, setPeriod] = useState<PeriodKey>("YTD");
  const dash = DASHBOARDS.find((d) => d.id === id);
  if (!dash) return <EmptyState title="Dashboard not found" action={<Link to="/reports/dashboards" className="rp-btn">Back to Dashboards</Link>} />;
  return (
    <div className="rp-page">
      <PageHeader
        title={dash.name}
        description={dash.summary}
        back={{ to: "/reports/dashboards", label: "Dashboards" }}
        actions={
          <button type="button" className="rp-btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" /> Print
          </button>
        }
      />
      <div className="rp-filter no-print">
        <label className="rp-field">
          <span>Period</span>
          <RpSelect label="Period" value={period} options={PERIODS.filter((p) => p.key !== "THIS_YEAR")} onChange={setPeriod} />
        </label>
      </div>
      <div className="rp-card rp-dash-detail">
        <DashboardBody id={dash.id} period={period} />
      </div>
    </div>
  );
}

/* ── Management report preview ──────────────────────────── */

function PnlSection({ s, currency }: { s: StatementPack; currency: string }) {
  const rows: Array<[string, number, number, boolean?]> = [
    ["Revenue", s.income.totalRevenue, s.comparative.income.totalRevenue],
    ["Cost of sales", s.income.totalCostOfSales, s.comparative.income.totalCostOfSales],
    ["Gross profit", s.income.grossProfit, s.comparative.income.grossProfit, true],
    ["Expenses", s.income.totalExpenses, s.comparative.income.totalExpenses],
    ["Profit", s.income.profit, s.comparative.income.profit, true],
  ];
  return <SummaryTable rows={rows} currency={currency} />;
}

function SummaryTable({ rows, currency }: { rows: Array<[string, number, number, boolean?]>; currency: string }) {
  return (
    <table className="rp-table rp-table-report">
      <thead>
        <tr>
          <th>{currency}</th>
          <th className="num">This period</th>
          <th className="num">Comparative</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b, strong]) => (
          <tr key={label} className={strong ? "strong" : undefined}>
            <td>{label}</td>
            <td className="num">{amount(a, 2)}</td>
            <td className="num">{amount(b, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type ExpenseByCategory = { rows?: Array<{ categoryName?: string; name?: string; total?: number; amount?: number }> };

function ExpensesSection({ period, currency, s }: { period: PeriodKey; currency: string; s: StatementPack }) {
  const r = periodRange(period);
  const { can } = useSession();
  const categories = useResource<ExpenseByCategory>(can("expense:view") ? `/api/v1/expenses/reports/by-category?from=${r.from}&to=${r.to}` : null);
  const months = usePeriodMonths(period);
  const trend = useMonthlyFigures(months);
  const ap = usePayables(true);
  const series: Series[] = [{ name: "Expenses", color: SERIES[0], values: (trend.rows ?? []).map((m) => m.expenses + m.costOfSales) }];
  const cats = (categories.data?.rows ?? []).map((c) => [c.categoryName ?? c.name ?? "Other", Number(c.total ?? c.amount ?? 0)] as [string, number]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <>
      <div className="rp-tiles">
        <StatTile label="Total expenses" value={`${currency} ${amount(s.income.totalExpenses + s.income.totalCostOfSales, 0)}`} change={delta(s.income.totalExpenses + s.income.totalCostOfSales, s.comparative.income.totalExpenses + s.comparative.income.totalCostOfSales)} invert hint="vs comparative" />
        <StatTile label="Open bills" value={`${currency} ${amount(ap.outstanding, 0)}`} hint="Still to pay" />
        <StatTile label="Overdue bills" value={`${currency} ${amount(ap.overdue, 0)}`} hint="Past due date" />
      </div>
      {trend.rows && <TimeChart labels={months.map(monthShort)} series={series} height={220} prefix={`${currency} `} label="Expenses by month" />}
      <div className="rp-dash-split">
        <div>
          <h4>Top categories</h4>
          <TopTable head="Category" rows={cats} currency={currency} />
        </div>
        <div>
          <h4>Top suppliers</h4>
          <TopTable head="Supplier" rows={ap.top} currency={currency} />
        </div>
      </div>
    </>
  );
}

function SalesSection({ period, currency, s }: { period: PeriodKey; currency: string; s: StatementPack }) {
  const months = usePeriodMonths(period);
  const trend = useMonthlyFigures(months);
  const ar = useReceivables(true);
  const series: Series[] = [{ name: "Revenue", color: SERIES[0], values: (trend.rows ?? []).map((m) => m.revenue) }];
  return (
    <>
      <div className="rp-tiles">
        <StatTile label="Revenue" value={`${currency} ${amount(s.income.totalRevenue, 0)}`} change={delta(s.income.totalRevenue, s.comparative.income.totalRevenue)} hint="vs comparative" />
        <StatTile label="Open receivables" value={`${currency} ${amount(ar.outstanding, 0)}`} hint="Still to collect" />
        <StatTile label="Collection rate" value={pct(ar.rate)} hint="Share of billed value settled" />
      </div>
      {trend.rows && <TimeChart labels={months.map(monthShort)} series={series} height={220} prefix={`${currency} `} label="Revenue by month" />}
      <h4>Top customers</h4>
      <TopTable head="Customer" rows={ar.top} currency={currency} />
    </>
  );
}

export function ManagementPreview({ id }: { id: string }) {
  const { query } = useLocation();
  const { name, currency } = useCompany();
  const system = SYSTEM_MANAGEMENT_REPORTS.find((r) => r.id === id);
  const custom = useMemo(() => readLocal<ManagementReport>("management-reports").find((r) => r.id === id), [id]);
  const report = system ?? custom;
  const period = (PERIODS.find((p) => p.key === query.get("period"))?.key ?? custom?.period ?? "THIS_YEAR") as PeriodKey;
  const range = periodRange(period);
  const pack = useResource<StatementPack>(report ? statementsPath(period) : null);
  const printNow = query.get("print") === "1" && Boolean(pack.data);

  useEffect(() => {
    if (printNow) window.setTimeout(() => window.print(), 300);
  }, [printNow]);

  if (!report) return <EmptyState title="This report no longer exists" action={<Link to="/reports/management" className="rp-btn">Back to Management reports</Link>} />;

  const s = pack.data;
  return (
    <div className="rp-page">
      <PageHeader
        title={report.name}
        back={{ to: "/reports/management", label: "Management reports" }}
        description={`${name} · ${date(range.from)} – ${date(range.to)}`}
        actions={
          <>
            <RpSelect label="Report period" value={period} options={PERIODS} onChange={(p) => navigate(`/reports/management/${id}?period=${p}`, { replace: true })} />
            <button type="button" className="rp-btn" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print or save as PDF
            </button>
          </>
        }
      />
      {pack.error ? (
        <ErrorState message={pack.error} onRetry={pack.reload} />
      ) : !s ? (
        <SkeletonRows rows={8} cols={3} />
      ) : (
        report.sections.map((section) => (
          <section key={section} className="rp-card rp-mgmt-section">
            <h2>{MANAGEMENT_SECTIONS.find((x) => x.id === section)?.label}</h2>
            {section === "overview" && (
              <div className="rp-tiles">
                <StatTile label="Revenue" value={`${currency} ${amount(s.income.totalRevenue, 0)}`} change={delta(s.income.totalRevenue, s.comparative.income.totalRevenue)} hint="vs comparative" />
                <StatTile label="Profit" value={`${currency} ${amount(s.income.profit, 0)}`} change={delta(s.income.profit, s.comparative.income.profit)} hint="vs comparative" />
                <StatTile label="Net cash flow" value={`${currency} ${amount(s.cashFlow.netChange, 0)}`} change={delta(s.cashFlow.netChange, s.comparative.cashFlow.netChange)} hint="vs comparative" />
                <StatTile label="Net margin" value={pct(s.ratios.netMargin)} hint={`${pct(s.comparative.ratios.netMargin)} comparative`} />
              </div>
            )}
            {section === "pnl" && <PnlSection s={s} currency={currency} />}
            {section === "position" && (
              <SummaryTable
                currency={currency}
                rows={[
                  ["Total assets", s.position.totalAssets, s.comparative.position.totalAssets, true],
                  ["Total liabilities", s.position.totalLiabilities, s.comparative.position.totalLiabilities],
                  ["Equity", s.position.totalEquity, s.comparative.position.totalEquity, true],
                ]}
              />
            )}
            {section === "sales" && <SalesSection period={period} currency={currency} s={s} />}
            {section === "expenses" && <ExpensesSection period={period} currency={currency} s={s} />}
          </section>
        ))
      )}
    </div>
  );
}

/* ── Spreadsheet sync (184–185) ─────────────────────────── */

const SYNC_ROWS: Array<{ label: string; excel: boolean; sheets: boolean }> = [
  { label: "Run reports with your data", excel: true, sheets: true },
  { label: "Run multi-company reports", excel: true, sheets: true },
  { label: "Edit and sync data", excel: true, sheets: false },
  { label: "Create and sync budgets", excel: true, sheets: false },
];

const EXPORTS = [
  { label: "Financial statements", path: "/api/v1/books/statements", file: "financial-statements" },
  { label: "Trial balance", path: "/api/v1/books/trial-balance", file: "trial-balance" },
  { label: "Accounts receivable ageing", path: "/api/v1/ar/ageing", file: "ar-ageing" },
  { label: "Accounts payable ageing", path: "/api/v1/ap/ageing", file: "ap-ageing" },
];

function SyncModal({ target, onClose }: { target: "Excel" | "Google Sheets"; onClose: () => void }) {
  const { download } = useSession();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const format = target === "Excel" ? "xlsx" : "csv";
  return (
    <Modal title={`Sync with ${target}`} width={620} onClose={onClose} footer={<button type="button" className="rp-btn" onClick={onClose}>Close</button>}>
      <p className="rp-notice">Live two-way sync isn't connected yet. For now, download a report as a {target === "Excel" ? "workbook" : "CSV file to import into Google Sheets"}.</p>
      <ul className="rp-export-list">
        {EXPORTS.map((e) => (
          <li key={e.path}>
            <span>{e.label}</span>
            <button
              type="button"
              className="rp-btn"
              disabled={busy !== null}
              onClick={() => {
                setBusy(e.path);
                download(`${e.path}?format=${format}`, `${e.file}.${format}`)
                  .then(() => toast(`${e.label} downloaded.`))
                  .catch((err: Error) => toast(err.message, { error: true }))
                  .finally(() => setBusy(null));
              }}
            >
              {busy === e.path ? "Preparing…" : "Download"}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function SpreadsheetSync() {
  const [target, setTarget] = useState<"Excel" | "Google Sheets" | null>(null);
  return (
    <div className="rp-page">
      <div className="rp-toolbar rp-toolbar-end">
        <CreateReportButton />
      </div>
      <section className="rp-sync">
        <div>
          <h1>Get deeper insights with Spreadsheet Sync</h1>
          <p>Securely send data back and forth between your ERP and your spreadsheet for up-to-date data and custom insights.</p>
          <table className="rp-sync-table">
            <thead>
              <tr>
                <td />
                <th scope="col">
                  <FileSpreadsheet size={26} color="#1d6b3a" aria-hidden="true" /> Excel
                </th>
                <th scope="col">
                  <FileSpreadsheet size={26} color="#188038" aria-hidden="true" /> Google Sheets
                </th>
              </tr>
            </thead>
            <tbody>
              {SYNC_ROWS.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.excel ? <CheckCircle2 size={24} fill="#1238e6" color="#fff" aria-label="Included" /> : <span className="rp-sr">Not included</span>}</td>
                  <td>{r.sheets ? <CheckCircle2 size={24} fill="#1238e6" color="#fff" aria-label="Included" /> : <span className="rp-sr">Not included</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rp-sync-actions">
            <button type="button" className="rp-btn" onClick={() => setTarget("Excel")}>
              Sync with Excel
            </button>
            <span>Or</span>
            <button type="button" className="rp-btn" onClick={() => setTarget("Google Sheets")}>
              Sync with Google Sheets
            </button>
          </div>
        </div>
        <div className="rp-sync-art" aria-hidden="true">
          <div className="rp-laptop">
            <div className="rp-laptop-bar" />
            <table>
              <thead>
                <tr><th /><th>Actual</th><th>Budget</th></tr>
              </thead>
              <tbody>
                <tr><td>Revenue</td><td>1,245,600</td><td>1,300,000</td></tr>
                <tr><td>Cost of sales</td><td>(512,800)</td><td>(520,000)</td></tr>
                <tr className="b"><td>Gross profit</td><td>732,800</td><td>780,000</td></tr>
                <tr><td>Salaries and wages</td><td>(214,000)</td><td>(220,000)</td></tr>
                <tr><td>Rent</td><td>(36,000)</td><td>(36,000)</td></tr>
                <tr><td>Utilities</td><td>(12,900)</td><td>(13,500)</td></tr>
                <tr className="b"><td>Operating profit</td><td>421,900</td><td>460,500</td></tr>
              </tbody>
            </table>
          </div>
          <div className="rp-laptop-base" />
          <div className="rp-sync-card">
            <strong>Spreadsheet Sync</strong>
            <div>
              <FileSpreadsheet size={40} color="#1d6b3a" />
              <ArrowLeftRight size={30} color="#0f1b4d" />
              <span>
                <Database size={36} color="#0f1b4d" />
                <b>ERP</b>
              </span>
            </div>
          </div>
        </div>
      </section>
      {target && <SyncModal target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}


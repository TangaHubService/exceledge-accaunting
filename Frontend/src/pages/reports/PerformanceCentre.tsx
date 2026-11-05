import { ArrowDown, ArrowUp, Download, Sparkles, Table2, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ageColor, ChartError, ChartTable, Donut, SERIES, TimeChart } from "../../components/reports/charts";
import { GiveFeedback, RpSelect } from "../../components/reports/kit";
import { useFeedback } from "../../components/feedback";
import { Drawer, Menu } from "../../components/ui";
import { useCompany } from "../../lib/company";
import { amount, isoDay } from "../../lib/format";
import { downloadCsv, type MonthFigures, monthShort, monthsBetween, periodRange, useMonthlyFigures } from "../../lib/reports";
import { setQueryParam } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { newId, saveLocal, useLocalCollection } from "../../lib/txn";
import type { AgeingBucket, ApDashboard, ArDashboard } from "../../lib/types";

const MAX_CHARTS = 25;

type Metric = { id: string; title: string; total: string; money: boolean; sum: boolean; pick: (m: MonthFigures) => number | null };

const METRICS: Metric[] = [
  { id: "expenses", title: "Expenses by time", total: "Total expenses", money: true, sum: true, pick: (m) => m.expenses + m.costOfSales },
  { id: "revenue", title: "Revenue by time", total: "Total revenue", money: true, sum: true, pick: (m) => m.revenue },
  { id: "gross", title: "Gross profit by time", total: "Total gross profit", money: true, sum: true, pick: (m) => m.grossProfit },
  { id: "net", title: "Net profit by time", total: "Total net profit", money: true, sum: true, pick: (m) => m.profit },
  { id: "cash", title: "Cash flow", total: "Net cash flow", money: true, sum: true, pick: (m) => m.netCash },
  { id: "current", title: "Current ratio by time", total: "Latest current ratio", money: false, sum: false, pick: (m) => m.kpis.CURRENT_RATIO ?? null },
  { id: "quick", title: "Quick ratio by time", total: "Latest quick ratio", money: false, sum: false, pick: (m) => m.kpis.QUICK_RATIO ?? null },
  { id: "balance", title: "Cash balance by time", total: "Latest cash balance", money: true, sum: false, pick: (m) => m.kpis.CASH ?? null },
  { id: "working", title: "Working capital by time", total: "Latest working capital", money: true, sum: false, pick: (m) => m.kpis.WORKING_CAPITAL ?? null },
  { id: "ebitda", title: "EBITDA by time", total: "Total EBITDA", money: true, sum: true, pick: (m) => m.kpis.EBITDA ?? null },
  { id: "dso", title: "Days sales outstanding by time", total: "Latest days sales outstanding", money: false, sum: false, pick: (m) => m.kpis.DSO ?? null },
];

const RANGES = [
  { key: "YTD", label: "This year to date" },
  { key: "LAST_YEAR", label: "Last year" },
  { key: "THIS_QUARTER", label: "This quarter" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

type ChartConfig = { id: string; kind: "ar" | "ap" | "metric"; metric?: string; title?: string; chart: "bar" | "line"; range: RangeKey };

const DEFAULT_LAYOUT: ChartConfig[] = [
  { id: "ar", kind: "ar", chart: "bar", range: "YTD" },
  { id: "ap", kind: "ap", chart: "bar", range: "YTD" },
  { id: "expenses", kind: "metric", metric: "expenses", chart: "bar", range: "YTD" },
  { id: "revenue", kind: "metric", metric: "revenue", chart: "bar", range: "YTD" },
  { id: "gross", kind: "metric", metric: "gross", chart: "bar", range: "YTD" },
  { id: "net", kind: "metric", metric: "net", chart: "line", range: "YTD" },
  { id: "cash", kind: "metric", metric: "cash", chart: "bar", range: "YTD" },
  { id: "current", kind: "metric", metric: "current", chart: "line", range: "YTD" },
  { id: "quick", kind: "metric", metric: "quick", chart: "line", range: "YTD" },
];

const STORE = "performance-layout";
const metricOf = (id?: string) => METRICS.find((m) => m.id === id);

function useLayout() {
  const saved = useLocalCollection<{ id: "layout"; charts: ChartConfig[] }>(STORE);
  const charts = saved.find((s) => s.id === "layout")?.charts ?? DEFAULT_LAYOUT;
  const save = (next: ChartConfig[]) => saveLocal(STORE, { id: "layout", charts: next });
  return { charts, save };
}

function monthsFor(range: RangeKey) {
  const r = periodRange(range);
  return monthsBetween(r.from, r.to > isoDay() ? isoDay() : r.to);
}

function AgeingCard({ title, totalLabel, buckets, total, error, onRetry, tools }: { title: string; totalLabel: string; buckets: AgeingBucket[]; total: number; error?: string; onRetry: () => void; tools: ReactNode }) {
  const { currency } = useCompany();
  return (
    <article className="rp-perf-card span-3">
      <header>
        <h2>{title}</h2>
        <span className="rp-perf-range">As of today</span>
      </header>
      {tools}
      {error ? (
        <ChartError onRetry={onRetry} />
      ) : (
        <>
          <p className="rp-perf-label">{totalLabel}</p>
          <p className="rp-perf-total">
            {currency} {amount(total, 2)}
          </p>
          <div className="rp-perf-donut">
            <ul>
              {buckets.map((b, i) => (
                <li key={b.key}>
                  <i style={{ background: ageColor(i) }} />
                  <span>
                    <b>
                      {currency} {amount(b.amount, 2)}
                    </b>
                    {b.label}
                  </span>
                </li>
              ))}
            </ul>
            <Donut slices={buckets} label={`${title} by age`} size={140} />
          </div>
        </>
      )}
    </article>
  );
}

const EMPTY_BUCKETS: AgeingBucket[] = [
  { key: "current", label: "Current", amount: 0 },
  { key: "1-30", label: "1-30 days", amount: 0 },
  { key: "31-60", label: "31-60 days", amount: 0 },
  { key: "61+", label: "61+ days", amount: 0 },
];

function MetricCard({ config, onRange, tools, titleOverride }: { config: ChartConfig; onRange: (r: RangeKey) => void; tools: ReactNode; titleOverride?: string }) {
  const { currency } = useCompany();
  const metric = metricOf(config.metric)!;
  const months = useMemo(() => monthsFor(config.range), [config.range]);
  const data = useMonthlyFigures(months);
  const [table, setTable] = useState(false);
  const values = data.rows?.map((m) => metric.pick(m)) ?? [];
  const nums = values.filter((v): v is number => v !== null);
  const headline = metric.sum ? nums.reduce((a, b) => a + b, 0) : nums[nums.length - 1] ?? null;
  const series = [{ name: metric.total, color: SERIES[0], values: data.rows ? values : months.map(() => 0), kind: config.chart === "line" ? ("line" as const) : ("bar" as const) }];
  const labels = months.map(monthShort);
  return (
    <article className="rp-perf-card span-6">
      <header>
        <h2>{titleOverride ?? config.title ?? metric.title}</h2>
        <RpSelect label="Chart period" className="rp-plain-select" value={config.range} options={RANGES} onChange={onRange} />
      </header>
      {tools}
      {data.error ? (
        <ChartError onRetry={data.reload} />
      ) : (
        <>
          <p className="rp-perf-label">{metric.total}</p>
          <p className="rp-perf-total">
            {data.loading ? "…" : headline === null ? "—" : metric.money ? `${currency} ${amount(headline, 2)}` : amount(headline, 2)}
          </p>
          {table ? <ChartTable labels={labels} series={series} money={metric.money} /> : <TimeChart labels={labels} series={series} height={210} prefix={metric.money ? `${currency} ` : ""} money={metric.money} label={`${metric.title}, ${config.range}`} />}
          <div className="rp-perf-foot">
            <button type="button" className="rp-link rp-ask" onClick={() => setQueryParam("assistant", "1")}>
              <Sparkles size={17} aria-hidden="true" /> Ask a question
            </button>
            <button type="button" className="rp-link" onClick={() => setTable((t) => !t)} aria-pressed={table}>
              <Table2 size={16} aria-hidden="true" /> {table ? "View chart" : "View table"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function AddChart({ count, onClose, onAdd }: { count: number; onClose: () => void; onAdd: (c: ChartConfig) => void }) {
  const [metric, setMetric] = useState(METRICS[0].id);
  const [title, setTitle] = useState("");
  const [chart, setChart] = useState<"bar" | "line">("bar");
  const [range, setRange] = useState<RangeKey>("YTD");
  return (
    <Drawer
      title="Add new chart"
      subtitle={`${count} of ${MAX_CHARTS} charts created`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => onAdd({ id: newId(), kind: "metric", metric, title: title.trim() || undefined, chart, range })}>
            Add chart
          </button>
        </>
      }
    >
      <label className="rp-field">
        <span>Measure</span>
        <select className="rp-select" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {METRICS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </label>
      <label className="rp-field">
        <span>Chart title (optional)</span>
        <input value={title} placeholder={metricOf(metric)?.title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="rp-field">
        <span>Chart type</span>
        <select className="rp-select" value={chart} onChange={(e) => setChart(e.target.value as "bar" | "line")}>
          <option value="bar">Bar chart</option>
          <option value="line">Line chart</option>
        </select>
      </label>
      <label className="rp-field">
        <span>Period</span>
        <RpSelect label="Period" value={range} options={RANGES} onChange={setRange} />
      </label>
    </Drawer>
  );
}

export function PerformanceCentre() {
  const { toast } = useFeedback();
  const { can } = useSession();
  const { charts, save } = useLayout();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const ar = useResource<ArDashboard>(can("ar:view") ? "/api/v1/ar/dashboard" : null);
  const ap = useResource<ApDashboard>(can("ap:view") ? "/api/v1/ap/dashboard" : null);
  const months = useMemo(() => monthsFor("YTD"), []);
  const exportData = useMonthlyFigures(months);

  function add(c: ChartConfig) {
    if (charts.length >= MAX_CHARTS) return toast(`You can have up to ${MAX_CHARTS} charts.`, { error: true });
    save([...charts, c]);
    setAdding(false);
    toast("Chart added.");
  }

  function move(i: number, by: number) {
    const next = [...charts];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c);
    save(next);
  }

  function exportCsv() {
    if (!exportData.rows) return toast("Figures are still loading. Try again in a moment.");
    downloadCsv(`performance-centre-${isoDay()}.csv`, [
      ["Month", ...METRICS.map((m) => m.title.replace(/ by time$/, ""))],
      ...exportData.rows.map((r) => [r.month, ...METRICS.map((m) => m.pick(r))]),
    ]);
  }

  const quick = METRICS.filter((m) => !charts.some((c) => c.metric === m.id));

  return (
    <div className="rp-page">
      <div className="rp-title-row rp-perf-title">
        <h1>Performance centre</h1>
        <div className="rp-actions no-print">
          <button type="button" className="rp-link rp-strong" onClick={() => setAdding(true)}>
            Create custom charts
          </button>
          <Menu
            label="Quick add charts"
            triggerClassName="rp-btn"
            header={quick.length ? undefined : "All charts are already on this page."}
            items={quick.length ? quick.map((m) => ({ label: m.title, onSelect: () => add({ id: newId(), kind: "metric", metric: m.id, chart: "bar", range: "YTD" }) })) : [{ label: "Add new chart", onSelect: () => setAdding(true) }]}
          />
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => setAdding(true)}>
            Add new chart
          </button>
        </div>
      </div>
      <div className="rp-perf-meta">
        <span>
          <b>Accounting method:</b> Accrual basis
        </span>
        <span className="rp-perf-meta-right no-print">
          <span>
            <b>{charts.length} of {MAX_CHARTS}</b> charts created
          </span>
          <button type="button" className="rp-link rp-ink" onClick={exportCsv}>
            <Download size={18} aria-hidden="true" /> Export
          </button>
          <GiveFeedback />
        </span>
      </div>
      <div className="rp-perf-layout no-print">
        <button type="button" className="rp-link" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done customising" : "Customise Layout"}
        </button>
        {editing && (
          <button type="button" className="rp-link" onClick={() => save(DEFAULT_LAYOUT)}>
            Reset to default
          </button>
        )}
      </div>
      <div className="rp-perf-grid">
        {charts.map((c, i) => {
          const tools = editing ? (
            <div className="rp-perf-tools">
              <button type="button" className="rp-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move chart ${i + 1} earlier`}>
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button type="button" className="rp-icon" disabled={i === charts.length - 1} onClick={() => move(i, 1)} aria-label={`Move chart ${i + 1} later`}>
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button type="button" className="rp-icon" onClick={() => save(charts.filter((x) => x.id !== c.id))} aria-label={`Remove chart ${i + 1}`}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null;
          if (c.kind === "ar") return <AgeingCard key={c.id} title="Accounts receivable" totalLabel="Total A/R amount" total={ar.data?.totalOutstanding ?? 0} buckets={ar.data?.ageing ?? EMPTY_BUCKETS} error={ar.error} onRetry={ar.reload} tools={tools} />;
          if (c.kind === "ap") return <AgeingCard key={c.id} title="Accounts payable" totalLabel="Total A/P amount" total={ap.data?.totalOutstanding ?? 0} buckets={ap.data?.ageing ?? EMPTY_BUCKETS} error={ap.error} onRetry={ap.reload} tools={tools} />;
          if (!metricOf(c.metric)) return null;
          return <MetricCard key={c.id} config={c} tools={tools} onRange={(range) => save(charts.map((x) => (x.id === c.id ? { ...x, range } : x)))} />;
        })}
      </div>
      {adding && <AddChart count={charts.length} onClose={() => setAdding(false)} onAdd={add} />}
    </div>
  );
}

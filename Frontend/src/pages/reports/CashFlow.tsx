import { ChevronLeft, ChevronRight, Filter, Info, Plus, SearchCheck, SlidersHorizontal, FileText, Landmark, CalendarDays, CheckCircle2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { ChartError, ChartTable, Legend, SERIES, type Series, TimeChart } from "../../components/reports/charts";
import { GiveFeedback, Modal, PageTitle, PlanningHero, RpSelect } from "../../components/reports/kit";
import { Drawer, Menu } from "../../components/ui";
import { useCompany } from "../../lib/company";
import { amount, date, isoDay } from "../../lib/format";
import { monthKey, monthShort, monthTick, monthsBetween, periodRange, type PlannerItem, shiftMonth, useMonthlyFigures, useYearMonths } from "../../lib/reports";
import { Link, navigate } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { addDays, newId, readLocal, removeLocal, saveLocal, useLocalCollection } from "../../lib/txn";
import type { ApBill, ArInvoiceList, CashPositionReport } from "../../lib/types";

type Doc = { id: string; number: string; party: string; date: string; dueDate: string; gross: number; paid: number; outstanding: number };

function useOpenDocs() {
  const { can } = useSession();
  const invoices = useResource<ArInvoiceList>(can("ar:view") ? "/api/v1/ar/invoices?status=ALL&pageSize=500" : null);
  const bills = useResource<ApBill[]>(can("ap:view") ? "/api/v1/ap/bills" : null);
  const moneyIn = useMemo<Doc[]>(() => (invoices.data?.rows ?? []).filter((i) => i.status === "POSTED").map((i) => ({ id: i.id, number: i.invoiceNumber, party: i.customerName, date: i.invoiceDate.slice(0, 10), dueDate: i.dueDate.slice(0, 10), gross: i.gross, paid: i.paid, outstanding: i.outstanding })), [invoices.data]);
  const moneyOut = useMemo<Doc[]>(() => (bills.data ?? []).map((b) => ({ id: b.id, number: b.billNumber, party: b.supplierName, date: b.billDate.slice(0, 10), dueDate: b.dueDate.slice(0, 10), gross: b.gross, paid: b.paid, outstanding: b.outstanding })), [bills.data]);
  return { moneyIn, moneyOut, loading: invoices.loading || bills.loading };
}

/* ── Cash flow overview (188–189) ───────────────────────── */

const BANKS = [
  { name: "Chase", tone: "#1238e6" },
  { name: "Bank of America", tone: "#c7263e" },
  { name: "Wells Fargo", tone: "#c8421d" },
  { name: "American Express", tone: "#1a73c9" },
];

function OutlookCard({ title, help, docs, overdueLabel, openLabel, createLabel, createItems, reports }: {
  title: string;
  help: string;
  docs: Doc[];
  overdueLabel: string;
  openLabel: string;
  createLabel: string;
  createItems: Array<{ label: string; to: string }>;
  reports: Array<{ label: string; to: string }>;
}) {
  const { currency } = useCompany();
  const [tab, setTab] = useState<"UPCOMING" | "PAID">("UPCOMING");
  const today = isoDay();
  const month = monthKey(today);
  const overdue = docs.filter((d) => d.outstanding > 0 && d.dueDate < today);
  const open = docs.filter((d) => d.outstanding > 0 && d.dueDate >= today);
  const paid = docs.filter((d) => d.paid > 0 && monthKey(d.date) === month);
  const upcomingTotal = docs.filter((d) => d.outstanding > 0 && monthKey(d.dueDate) <= month).reduce((s, d) => s + d.outstanding, 0);
  const paidTotal = paid.reduce((s, d) => s + d.paid, 0);
  const total = tab === "UPCOMING" ? upcomingTotal : paidTotal;
  const share = upcomingTotal + paidTotal > 0 ? (upcomingTotal / (upcomingTotal + paidTotal)) * 100 : 47;
  const sum = (list: Doc[], key: "outstanding" | "paid") => list.reduce((s, d) => s + d[key], 0);
  const create = <Menu label={createLabel} triggerClassName="rp-btn" items={createItems.map((i) => ({ label: i.label, onSelect: () => navigate(i.to) }))} />;
  const rows = tab === "UPCOMING"
    ? [
        { label: overdueLabel, qty: overdue.length, value: sum(overdue, "outstanding") },
        { label: openLabel, qty: open.length, value: sum(open, "outstanding") },
      ]
    : [{ label: "Paid this month", qty: paid.length, value: paidTotal }];
  return (
    <section className="rp-card rp-outlook">
      <header>
        <h3>
          {title} <Info size={22} aria-label={help} />
        </h3>
        <Menu label={<><SearchCheck size={20} aria-hidden="true" /> View reports</>} triggerClassName="rp-link rp-menu-link" items={reports.map((r) => ({ label: r.label, onSelect: () => navigate(r.to) }))} />
      </header>
      <div className="rp-tabs" role="tablist">
        {(["UPCOMING", "PAID"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "UPCOMING" ? "Upcoming" : "Paid"}
          </button>
        ))}
      </div>
      <div className="rp-outlook-body">
        <div className="rp-outlook-sum">
          <span>This month</span>
          <strong>
            {currency} {amount(total, 2)}
          </strong>
          <div className="rp-split-bar" aria-hidden="true">
            <i style={{ width: `${share}%` }} />
            <b />
          </div>
          <dl>
            <div>
              <dt>
                <i className="dark" /> Upcoming
              </dt>
              <dd>
                {currency} {amount(upcomingTotal, 2)}
              </dd>
            </div>
            <div>
              <dt>
                <i /> Paid
              </dt>
              <dd>
                {currency} {amount(paidTotal, 2)}
              </dd>
            </div>
          </dl>
        </div>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Qty</th>
              <th className="num">Amount</th>
              <td />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="num">{r.qty}</td>
                <td className="num">
                  {currency} {amount(r.value, 2)}
                </td>
                <td className="rp-outlook-action">{create}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CashFlowOverview() {
  const { can } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const { moneyIn, moneyOut } = useOpenDocs();
  const cash = useResource<CashPositionReport>(can("bank:view") ? `/api/v1/banking/cash-position?asOf=${isoDay()}` : null);
  const months = useYearMonths("THIS_YEAR");
  const allMonths = useMemo(() => {
    const r = periodRange("THIS_YEAR");
    return monthsBetween(r.from, r.to);
  }, []);
  const figures = useMonthlyFigures(months);
  const [insights, setInsights] = useState(true);
  const [settings, setSettings] = useState(false);
  const series: Series[] = [{ name: "Net cash flow", color: SERIES[0], values: allMonths.map((m) => figures.rows?.find((r) => r.month === m)?.netCash ?? (m > monthKey(isoDay()) ? null : 0)) }];
  const accounts = cash.data?.rows ?? [];
  const horizon = addDays(isoDay(), 30);
  const coming = [
    ...moneyIn.filter((d) => d.outstanding > 0 && d.dueDate >= isoDay() && d.dueDate <= horizon).map((d) => ({ ...d, kind: "in" as const })),
    ...moneyOut.filter((d) => d.outstanding > 0 && d.dueDate >= isoDay() && d.dueDate <= horizon).map((d) => ({ ...d, kind: "out" as const })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);

  return (
    <div className="rp-page">
      <PageTitle
        title="Cash flow overview"
        actions={
          <>
            <GiveFeedback />
            <span className="rp-divider" />
            <div className="rp-popover-wrap">
              <button type="button" className="rp-icon" onClick={() => setSettings((s) => !s)} aria-label="Page settings" aria-expanded={settings}>
                <SlidersHorizontal size={22} aria-hidden="true" />
              </button>
              {settings && (
                <div className="rp-popover rp-popover-right">
                  <label className="rp-check">
                    <input type="checkbox" checked={insights} onChange={(e) => setInsights(e.target.checked)} /> Show insights and ideas
                  </label>
                </div>
              )}
            </div>
          </>
        }
      />
      <div className="rp-cash-top">
        <section className="rp-card rp-banks">
          <h2>All accounts</h2>
          {accounts.length > 0 ? (
            <>
              <h3>
                {currency} {amount(cash.data?.totals.closing ?? 0, 2)}
              </h3>
              <p>Across your bank and cash accounts today.</p>
              <ul>
                {accounts.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <span className="rp-bank-badge" style={{ background: SERIES[0] }}>
                      <Landmark size={18} aria-hidden="true" />
                    </span>
                    <Link to={`/banking/accounts/${a.id}`}>{a.name}</Link>
                    <span>{amount(a.closing, 2)}</span>
                  </li>
                ))}
              </ul>
              <Link to="/banking/transactions" className="rp-link">View all transactions</Link>
            </>
          ) : (
            <>
              <h3>Link your bank</h3>
              <p>See where your money is headed so you can take control of your finances.</p>
              <ul>
                {BANKS.map((b) => (
                  <li key={b.name}>
                    <span className="rp-bank-badge" style={{ background: b.tone }}>
                      {b.name[0]}
                    </span>
                    <b>{b.name}</b>
                    <button type="button" className="rp-icon rp-blue" aria-label={`Link ${b.name}`} onClick={() => toast("Live bank feeds aren't connected yet. Add the account under Banking for now.")}>
                      <Plus size={24} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="rp-card rp-cash-chart">
          <h2>Cash flow</h2>
          <h3>Track how your money is doing</h3>
          {figures.error ? <ChartError onRetry={figures.reload} /> : <TimeChart labels={allMonths.map(monthShort)} series={series} height={accounts.length ? 200 : 170} ticks={4} money={false} label="Net cash flow by month, this year" />}
          {accounts.length === 0 && (
            <button type="button" className="rp-btn rp-btn-block" onClick={() => navigate("/banking")}>
              Link your bank to see cash flow
            </button>
          )}
        </section>
      </div>
      <h2 className="rp-h2">Monthly outlook</h2>
      <OutlookCard
        title="Money in"
        help="Invoices due this month and payments received this month"
        docs={moneyIn}
        overdueLabel="Overdue invoices"
        openLabel="Open invoices"
        createLabel="Create invoice"
        createItems={[{ label: "Invoice", to: "/sales/invoice/new" }, { label: "Receive payment", to: "/sales/receive-payment/new" }]}
        reports={[{ label: "Accounts receivable ageing", to: "/reports/ageing" }, { label: "Open invoices", to: "/reports/view/open-invoices" }, { label: "Invoice list", to: "/reports/view/invoice-list" }]}
      />
      <OutlookCard
        title="Money out"
        help="Bills due this month and payments made this month"
        docs={moneyOut}
        overdueLabel="Overdue bills"
        openLabel="Open bills"
        createLabel="Create bill"
        createItems={[{ label: "Bill", to: "/expenses/bill/new" }, { label: "Pay bills", to: "/expenses/pay-bills" }]}
        reports={[{ label: "Accounts payable ageing", to: "/reports/payables-ageing" }, { label: "Purchase list", to: "/reports/view/purchase-list" }]}
      />
      {insights && (
        <>
          <h2 className="rp-h2">Insights and ideas</h2>
          <section className="rp-card rp-coming-up">
            <h2>Coming up</h2>
            {coming.length === 0 ? (
              <p className="rp-muted">Nothing is due in the next 30 days.</p>
            ) : (
              <ul>
                {coming.map((d) => (
                  <li key={d.kind + d.id}>
                    <span>{date(d.dueDate)}</span>
                    <span>
                      {d.kind === "in" ? "From" : "To"} {d.party} · {d.number}
                    </span>
                    <b>
                      {d.kind === "in" ? "+" : "−"}
                      {amount(d.outstanding, 2)}
                    </b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ── Cash flow planner (190–191) ────────────────────────── */

function minutesAgo(at: Date) {
  const minutes = Math.floor((Date.now() - at.getTime()) / 60000);
  return minutes < 1 ? "just now" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

const STARTED = "planner-started";
const PLANNER = "planner-items";

const HORIZONS = [
  { key: "3", label: "3 months" },
  { key: "6", label: "6 months" },
  { key: "12", label: "12 months" },
] as const;
const VIEWS = [
  { key: "UPCOMING", label: "Upcoming" },
  { key: "PAST", label: "Past" },
  { key: "ALL", label: "All" },
] as const;

type PlanRow = { id: string; date: string; description: string; amount: number; type: string; direction: "IN" | "OUT"; own: boolean; scenario: "REAL" | "HYPOTHETICAL" };

const blank = (): { date: string; description: string; amount: string; direction: "IN" | "OUT"; scenario: "REAL" | "HYPOTHETICAL" } => ({ date: isoDay(), description: "", amount: "", direction: "IN", scenario: "REAL" });

function AddItem({ initial, onClose }: { initial?: PlannerItem; onClose: () => void }) {
  const { toast } = useFeedback();
  const [d, setD] = useState(initial ? { ...initial, amount: String(initial.amount) } : blank());
  const [errors, setErrors] = useState<{ date?: string; description?: string; amount?: string }>({});
  function save() {
    const next: typeof errors = {};
    const n = Number(d.amount);
    if (!d.date) next.date = "Choose a date.";
    if (!d.description.trim()) next.description = "Describe the item.";
    if (!(n > 0)) next.amount = "Enter an amount above zero.";
    setErrors(next);
    if (Object.keys(next).length) return;
    saveLocal<PlannerItem>(PLANNER, { id: initial?.id ?? newId(), date: d.date, description: d.description.trim(), amount: n, direction: d.direction, scenario: d.scenario });
    toast("Item added to your plan. Your books aren't affected.");
    onClose();
  }
  return (
    <Drawer
      title={initial ? "Edit item" : "Add item"}
      subtitle="Plan a future amount without touching your books."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rp-btn rp-btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="rp-field">
        <span>Date</span>
        <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} aria-invalid={Boolean(errors.date)} />
        {errors.date && <small className="rp-error">{errors.date}</small>}
      </label>
      <label className="rp-field">
        <span>Description</span>
        <input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} aria-invalid={Boolean(errors.description)} />
        {errors.description && <small className="rp-error">{errors.description}</small>}
      </label>
      <label className="rp-field">
        <span>Amount</span>
        <input inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} aria-invalid={Boolean(errors.amount)} />
        {errors.amount && <small className="rp-error">{errors.amount}</small>}
      </label>
      <label className="rp-field">
        <span>Type</span>
        <select className="rp-select" value={d.direction} onChange={(e) => setD({ ...d, direction: e.target.value as "IN" | "OUT" })}>
          <option value="IN">Money in</option>
          <option value="OUT">Money out</option>
        </select>
      </label>
      <label className="rp-field">
        <span>Scenario</span>
        <select className="rp-select" value={d.scenario} onChange={(e) => setD({ ...d, scenario: e.target.value as "REAL" | "HYPOTHETICAL" })}>
          <option value="REAL">Real, expected to happen</option>
          <option value="HYPOTHETICAL">Hypothetical, a what-if</option>
        </select>
      </label>
    </Drawer>
  );
}

export function CashFlowPlanner() {
  const { can } = useSession();
  const { currency } = useCompany();
  const { toast, confirm } = useFeedback();
  const started = useLocalCollection<{ id: string }>(STARTED).length > 0;
  const [intro, setIntro] = useState(false);
  const items = useLocalCollection<PlannerItem>(PLANNER);
  const { moneyIn, moneyOut } = useOpenDocs();
  const cash = useResource<CashPositionReport>(started && can("bank:view") ? `/api/v1/banking/cash-position?asOf=${isoDay()}` : null);
  const [horizon, setHorizon] = useState<"3" | "6" | "12">("12");
  const [mode, setMode] = useState<"BALANCE" | "INOUT">("BALANCE");
  const [view, setView] = useState<"UPCOMING" | "PAST" | "ALL">("UPCOMING");
  const [editing, setEditing] = useState<PlannerItem | true | null>(null);
  const [showHypothetical, setShowHypothetical] = useState(true);
  const [showDocs, setShowDocs] = useState(true);
  const [threshold, setThreshold] = useState("0");
  const [filterOpen, setFilterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [table, setTable] = useState(false);
  const lastUpdated = useRef(new Date());
  const pageSize = 8;

  const today = isoDay();
  const nowMonth = monthKey(today);
  const span = Number(horizon);
  const pastCount = Math.floor(span * 0.75);
  const allMonths = useMemo(() => Array.from({ length: span }, (_, i) => shiftMonth(nowMonth, i - pastCount + 1)), [span, pastCount, nowMonth]);
  const pastMonths = useMemo(() => (started ? allMonths.filter((m) => m <= nowMonth) : []), [allMonths, nowMonth, started]);
  const history = useMonthlyFigures(pastMonths);
  const balance = cash.data?.totals.closing ?? 0;

  const rows = useMemo<PlanRow[]>(() => {
    const docs = showDocs
      ? [
          ...moneyIn.filter((d) => d.outstanding > 0).map<PlanRow>((d) => ({ id: `inv:${d.id}`, date: d.dueDate, description: `Invoice ${d.number} · ${d.party}`, amount: d.outstanding, type: "Invoice", direction: "IN", own: false, scenario: "REAL" })),
          ...moneyOut.filter((d) => d.outstanding > 0).map<PlanRow>((d) => ({ id: `bill:${d.id}`, date: d.dueDate, description: `Bill ${d.number} · ${d.party}`, amount: d.outstanding, type: "Bill", direction: "OUT", own: false, scenario: "REAL" })),
        ]
      : [];
    const own = items
      .filter((i) => showHypothetical || i.scenario === "REAL")
      .map<PlanRow>((i) => ({ id: i.id, date: i.date, description: i.description, amount: i.amount, type: `${i.direction === "IN" ? "Money in" : "Money out"}${i.scenario === "HYPOTHETICAL" ? " (what-if)" : ""}`, direction: i.direction, own: true, scenario: i.scenario }));
    return [...docs, ...own].sort((a, b) => a.date.localeCompare(b.date));
  }, [items, moneyIn, moneyOut, showDocs, showHypothetical]);

  const shown = rows.filter((r) => view === "ALL" || (view === "UPCOMING" ? r.date >= today : r.date < today));
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1);
  const pageRows = shown.slice(page * pageSize, page * pageSize + pageSize);
  useEffect(() => setPage(0), [view, horizon]);

  const moved = (m: string, dir: "IN" | "OUT") => rows.filter((r) => r.direction === dir && monthKey(r.date) === m && r.date >= today).reduce((s, r) => s + r.amount, 0);
  const thresholdN = Number(threshold) || 0;
  const labels = allMonths.map(monthTick);

  const series = useMemo<Series[]>(() => {
    if (mode === "INOUT") {
      return [
        { name: "Money in", color: SERIES[0], values: allMonths.map((m) => (m < nowMonth ? null : moved(m, "IN"))) },
        { name: "Money out", color: SERIES[1], values: allMonths.map((m) => (m < nowMonth ? null : moved(m, "OUT"))) },
      ];
    }
    let running = balance;
    const projected = allMonths.map((m) => {
      if (m < nowMonth) return null;
      running += moved(m, "IN") - moved(m, "OUT");
      return running;
    });
    const actual = allMonths.map((m) => {
      if (m === nowMonth) return balance;
      if (m > nowMonth) return null;
      return history.rows?.find((r) => r.month === m)?.kpis.CASH ?? null;
    });
    return [
      { name: "Cash balance", color: SERIES[2], values: actual, kind: "line" },
      { name: "Projected balance", color: SERIES[2], values: projected, kind: "line", dashed: true },
      { name: "Threshold", color: "#8391a8", values: allMonths.map(() => thresholdN), kind: "line", plain: true },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, allMonths, rows, balance, history.rows, thresholdN, nowMonth]);

  if (!started) {
    return (
      <div className="rp-page">
        <PageTitle title="Cash flow planner" />
        <PlanningHero title="Become a cash flow pro">
          <p>Keep track of your money and know what's coming in and going out so you can make smarter choices.</p>
          <ul>
            <li>Get a real-time view of your cash flow.</li>
            <li>Plan for future cash inflow and outflow based on past trends and patterns.</li>
            <li>Play with different outcomes without touching your books.</li>
          </ul>
          <button
            type="button"
            className="rp-btn rp-btn-primary rp-btn-lg"
            onClick={() => {
              saveLocal(STARTED, { id: "yes" });
              setIntro(true);
            }}
          >
            Start planning
          </button>
          <div className="rp-hero-tips">
            <h3>Tips &amp; resources</h3>
            <button type="button" className="rp-link" onClick={() => toast("Add future items with Add item, then compare the projected balance with your threshold.")}>
              See more
            </button>
          </div>
        </PlanningHero>
      </div>
    );
  }

  async function removeSelected() {
    const ids = [...selected].filter((id) => readLocal<PlannerItem>(PLANNER).some((i) => i.id === id));
    if (!ids.length) return toast("Only items you added can be deleted. Invoices and bills stay in your books.");
    if (await confirm({ title: `Delete ${ids.length} planned ${ids.length === 1 ? "item" : "items"}?`, confirmLabel: "Delete", danger: true })) {
      ids.forEach((id) => removeLocal(PLANNER, id));
      setSelected(new Set());
    }
  }

  const pageIds = pageRows.map((r) => r.id);
  const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div className="rp-page">
      <PageTitle
        title="Cash flow planner"
        actions={
          <>
            <GiveFeedback />
            <button type="button" className="rp-link rp-ink" onClick={() => window.print()}>
              Save as PDF
            </button>
            <div className="rp-popover-wrap">
              <button type="button" className="rp-icon" onClick={() => { setFilterOpen((o) => !o); setSettingsOpen(false); }} aria-label="Filter" aria-expanded={filterOpen}>
                <Filter size={22} aria-hidden="true" />
              </button>
              {filterOpen && (
                <div className="rp-popover rp-popover-right">
                  <label className="rp-check">
                    <input type="checkbox" checked={showDocs} onChange={(e) => setShowDocs(e.target.checked)} /> Open invoices and bills
                  </label>
                  <label className="rp-check">
                    <input type="checkbox" checked={showHypothetical} onChange={(e) => setShowHypothetical(e.target.checked)} /> Hypothetical items
                  </label>
                </div>
              )}
            </div>
            <div className="rp-popover-wrap">
              <button type="button" className="rp-icon" onClick={() => { setSettingsOpen((o) => !o); setFilterOpen(false); }} aria-label="Planner settings" aria-expanded={settingsOpen}>
                <SlidersHorizontal size={22} aria-hidden="true" />
              </button>
              {settingsOpen && (
                <div className="rp-popover rp-popover-right">
                  <label className="rp-field">
                    <span>Threshold ({currency})</span>
                    <input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                  </label>
                </div>
              )}
            </div>
          </>
        }
      />
      <section className="rp-card rp-planner-chart">
        <header>
          <div>
            <h2>Cash flow</h2>
            <em>Last updated {minutesAgo(lastUpdated.current)}</em>
            <p>Today's cash balance</p>
            <strong>
              {currency} {amount(balance, 2)}
            </strong>
          </div>
          <div className="rp-planner-controls no-print">
            <RpSelect label="Months shown" value={horizon} options={HORIZONS} onChange={setHorizon} />
            <div className="rp-toggle dark" role="group" aria-label="Chart view">
              <button type="button" className={mode === "BALANCE" ? "on" : ""} aria-pressed={mode === "BALANCE"} onClick={() => setMode("BALANCE")}>
                Cash balance
              </button>
              <button type="button" className={mode === "INOUT" ? "on" : ""} aria-pressed={mode === "INOUT"} onClick={() => setMode("INOUT")}>
                Money in/out
              </button>
            </div>
            <button type="button" className="rp-link" aria-pressed={table} onClick={() => setTable((t) => !t)}>
              {table ? "View chart" : "View table"}
            </button>
          </div>
        </header>
        {history.error ? <ChartError onRetry={history.reload} /> : table ? <ChartTable labels={labels} series={series} /> : <TimeChart labels={labels} series={series} height={190} ticks={4} prefix="" money={false} label="Cash balance and projected balance by month" />}
        <Legend series={series} />
      </section>
      <div className="rp-planner-bar">
        <RpSelect label="Items to show" value={view} options={VIEWS} onChange={setView} />
        <div className="rp-actions no-print">
          {selected.size > 0 && (
            <button type="button" className="rp-btn" onClick={() => void removeSelected()}>
              <Trash2 size={16} aria-hidden="true" /> Delete selected
            </button>
          )}
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => setEditing(true)}>
            Add item
          </button>
        </div>
      </div>
      <div className="rp-table-wrap rp-card-table">
        <table className="rp-table rp-table-caps">
          <thead>
            <tr>
              <th className="rp-check-col">
                <input
                  type="checkbox"
                  aria-label="Select all items on this page"
                  checked={allOn}
                  onChange={(e) => {
                    const next = new Set(selected);
                    pageIds.forEach((id) => (e.target.checked ? next.add(id) : next.delete(id)));
                    setSelected(next);
                  }}
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Amount</th>
              <th>Type</th>
              <td />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="rp-empty-row">
                  Nothing here yet. Use Add item to plan a future amount.
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="rp-check-col">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.description}`}
                      checked={selected.has(r.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>{date(r.date)}</td>
                  <td>{r.description}</td>
                  <td className="num">
                    {r.direction === "IN" ? "" : "−"}
                    {amount(r.amount, 2)}
                  </td>
                  <td>{r.type}</td>
                  <td className="num">
                    {r.own && (
                      <button type="button" className="rp-link" onClick={() => setEditing(items.find((i) => i.id === r.id) ?? null)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="rp-pager rp-pager-center">
          <button type="button" className="rp-icon" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span>
            {shown.length ? page * pageSize + 1 : 0} - {Math.min(shown.length, (page + 1) * pageSize)} of {shown.length} items
          </span>
          <button type="button" className="rp-icon" disabled={page >= lastPage} onClick={() => setPage(page + 1)} aria-label="Next page">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="rp-disclaimer">
        <Info size={18} aria-hidden="true" /> Cash flow planning is provided as a courtesy for informational purposes only. Actual results may vary.
      </p>
      {intro && (
        <Modal width={600} hideClose onClose={() => setIntro(false)}>
          <div className="rp-intro">
            <h2>The more you add, the more you'll see</h2>
            <ul>
              <li>
                <span>
                  <FileText size={40} strokeWidth={1.5} aria-hidden="true" />
                  <CheckCircle2 size={20} fill="#1d6b3a" color="#fff" aria-hidden="true" />
                </span>
                {moneyIn.length + moneyOut.length ? `Found ${moneyIn.filter((d) => d.outstanding > 0).length + moneyOut.filter((d) => d.outstanding > 0).length} open invoices and bills to plan around` : "No upcoming invoices, bills or expenses found"}
              </li>
              <li>
                <span>
                  <Landmark size={40} strokeWidth={1.5} aria-hidden="true" />
                  <CheckCircle2 size={20} fill="#1d6b3a" color="#fff" aria-hidden="true" />
                </span>
                {cash.data?.rows.length ? `Using ${cash.data.rows.length} bank and cash ${cash.data.rows.length === 1 ? "account" : "accounts"} for your cash flow position` : "Add your bank accounts under Banking so you can see your cash flow position"}
              </li>
              <li>
                <span>
                  <CalendarDays size={40} strokeWidth={1.5} aria-hidden="true" />
                  <CheckCircle2 size={20} fill="#1d6b3a" color="#fff" aria-hidden="true" />
                </span>
                Future items can be added for real and hypothetical scenario planning
              </li>
            </ul>
            <button type="button" className="rp-btn rp-btn-primary rp-btn-block rp-btn-lg" onClick={() => setIntro(false)}>
              Let's go
            </button>
          </div>
        </Modal>
      )}
      {editing && <AddItem initial={editing === true ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}


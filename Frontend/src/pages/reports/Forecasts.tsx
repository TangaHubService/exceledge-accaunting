import { ChevronDown, ChevronUp, Download, Info, Lightbulb, Pencil, PlayCircle, RefreshCw, Settings, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { Modal, PlanningHero } from "../../components/reports/kit";
import { EmptyState, ErrorState, Menu, SkeletonRows } from "../../components/ui";
import { useCompany } from "../../lib/company";
import { amount, date, isoDay } from "../../lib/format";
import { downloadCsv, type ForecastRules, monthKey, monthLong, monthShort, monthsBetween, type SavedForecast, shiftMonth, useMonthlyFigures } from "../../lib/reports";
import { Link, navigate } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { newId, readLocal, removeLocal, saveLocal, useLocalCollection } from "../../lib/txn";
import type { Account } from "../../lib/types";

const STORE = "forecasts";

const GROUPS = [
  { key: "INCOME", label: "Income", rule: "Income accounts", total: "Total Income" },
  { key: "COST_OF_SALES", label: "Cost of Goods Sold", rule: "COGS accounts", total: "Total Cost of Goods Sold" },
  { key: "EXPENSE", label: "Expense", rule: "Expense accounts", total: "Total Expense" },
  { key: "OTHER_INCOME", label: "Other Income", rule: "Other Income accounts", total: "Total Other Income" },
  { key: "OTHER_EXPENSE", label: "Other Expense", rule: "Other Expense accounts", total: "Total Other Expense" },
] as const;

const emptyRules = (): ForecastRules => Object.fromEntries(GROUPS.map((g) => [g.key, { direction: "", percent: "" }]));

function horizonEnd(horizon: SavedForecast["horizon"], today = isoDay()) {
  return `${Number(today.slice(0, 4)) + Number(horizon) - 1}-12`;
}
function horizonLabel(h: SavedForecast["horizon"]) {
  const start = monthLong(monthKey(isoDay()));
  const end = monthLong(horizonEnd(h));
  return `Up to ${h} year${h === "1" ? "" : "s"} (${start} - ${end})`;
}
const HORIZONS: SavedForecast["horizon"][] = ["1", "2", "3"];
const METHODS: Array<{ key: SavedForecast["method"]; label: string; about: string }> = [
  { key: "AVERAGE", label: "Average of actuals", about: "the rolling average of actuals" },
  { key: "LAST_MONTH", label: "Last month's actuals", about: "the most recent month of actuals" },
  { key: "MANUAL", label: "Enter manually", about: "amounts you enter yourself" },
];

/** Plain-language rule check, shared by setup and the settings panel. */
function ruleErrors(rules: ForecastRules) {
  const out: Record<string, string> = {};
  for (const g of GROUPS) {
    const r = rules[g.key];
    if (!r) continue;
    const has = r.percent.trim() !== "";
    const n = Number(r.percent);
    if (has && (!Number.isFinite(n) || n < 0 || n > 1000)) out[g.key] = "Enter a percentage from 0 to 1000.";
    else if (r.direction && !has) out[g.key] = "Enter a percentage.";
    else if (!r.direction && has) out[g.key] = "Choose increase or decrease.";
  }
  return out;
}

function RuleFields({ rules, onChange, errors }: { rules: ForecastRules; onChange: (r: ForecastRules) => void; errors: Record<string, string> }) {
  return (
    <div className="rp-rules">
      {GROUPS.map((g) => (
        <div key={g.key} className="rp-rule">
          <b>{g.rule}</b>
          <select className="rp-select" aria-label={`${g.rule} direction`} value={rules[g.key]?.direction ?? ""} onChange={(e) => onChange({ ...rules, [g.key]: { ...rules[g.key], direction: e.target.value as "" | "INCREASE" | "DECREASE" } })}>
            <option value="">Increase or decrease</option>
            <option value="INCREASE">Increase</option>
            <option value="DECREASE">Decrease</option>
          </select>
          <span>by</span>
          <div className="rp-percent">
            <input placeholder="Enter a number" inputMode="decimal" aria-label={`${g.rule} percentage`} aria-invalid={Boolean(errors[g.key])} value={rules[g.key]?.percent ?? ""} onChange={(e) => onChange({ ...rules, [g.key]: { ...rules[g.key], percent: e.target.value } })} />
            <b>%</b>
          </div>
          {errors[g.key] && <small className="rp-error">{errors[g.key]}</small>}
        </div>
      ))}
    </div>
  );
}

function SetupFields({ f, onChange }: { f: Pick<SavedForecast, "horizon" | "method" | "actualsMonths">; onChange: (patch: Partial<SavedForecast>) => void }) {
  return (
    <>
      <label className="rp-setup-row">
        <b>Forecast for:</b>
        <select className="rp-select" value={f.horizon} onChange={(e) => onChange({ horizon: e.target.value as SavedForecast["horizon"] })}>
          {HORIZONS.map((h) => (
            <option key={h} value={h}>
              {horizonLabel(h)}
            </option>
          ))}
        </select>
      </label>
      <label className="rp-setup-row">
        <b>Forecast using:</b>
        <select className="rp-select" value={f.method} onChange={(e) => onChange({ method: e.target.value as SavedForecast["method"] })}>
          {METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {f.method === "AVERAGE" && (
        <label className="rp-setup-row">
          <b>Use actuals from:</b>
          <select className="rp-select" value={f.actualsMonths} onChange={(e) => onChange({ actualsMonths: Number(e.target.value) as SavedForecast["actualsMonths"] })}>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
        </label>
      )}
    </>
  );
}

/* ── Landing (193) ──────────────────────────────────────── */

export function Forecasts() {
  const { toast, confirm } = useFeedback();
  const saved = useLocalCollection<SavedForecast>(STORE);
  return (
    <div className="rp-page">
      <PlanningHero title="Forecast like a pro">
        <p>Make informed decisions and take charge of your growth.</p>
        <button type="button" className="rp-link rp-see" onClick={() => toast("Choose a period and method, then adjust the grid. Nothing you do here affects your books.")}>
          <PlayCircle size={22} aria-hidden="true" /> See how it works
        </button>
        <ul className="rp-hero-strong">
          <li>
            <b>Predict outcomes from past trends</b>
            Analyse past data, spot patterns, and set goals.
          </li>
          <li>
            <b>Tweak forecasts as needed</b>
            Increase or decrease your accounts by a fixed percentage.
          </li>
          <li>
            <b>See potential impact in real time</b>
            Play around with the latest numbers without affecting your books.
          </li>
        </ul>
        <button type="button" className="rp-btn rp-btn-primary rp-btn-lg" onClick={() => navigate("/reports/forecasts/new")}>
          Create forecast
        </button>
      </PlanningHero>
      {saved.length > 0 && (
        <section className="rp-saved">
          <h2 className="rp-h2">Your forecasts</h2>
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Forecast using</th>
                  <th>Last saved</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {saved.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link to={`/reports/forecasts/${f.id}`}>{f.name}</Link>
                    </td>
                    <td>{METHODS.find((m) => m.key === f.method)?.label}</td>
                    <td>{date(f.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="rp-link"
                        onClick={() =>
                          void confirm({ title: `Delete ${f.name}?`, confirmLabel: "Delete", danger: true }).then((ok) => {
                            if (ok) removeLocal(STORE, f.id);
                          })
                        }
                      >
                        <Trash2 size={15} aria-hidden="true" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="rp-tips">
        <h3>Tips &amp; resources</h3>
        <button type="button" className="rp-link" onClick={() => toast("Start from your actuals, set a rule per account type, then fine-tune single months in the grid.")}>
          Find out more about forecasting
        </button>
      </div>
    </div>
  );
}

/* ── Set up (194) ───────────────────────────────────────── */

export function ForecastSetup() {
  const [f, setF] = useState<Pick<SavedForecast, "horizon" | "method" | "actualsMonths">>({ horizon: "2", method: "AVERAGE", actualsMonths: 3 });
  const [rules, setRules] = useState<ForecastRules>(emptyRules());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = GROUPS.filter((g) => rules[g.key]?.direction && rules[g.key]?.percent);

  function next() {
    const e = ruleErrors(rules);
    setErrors(e);
    if (Object.keys(e).length) return;
    const id = newId();
    const start = monthLong(monthKey(isoDay()));
    saveLocal<SavedForecast>(STORE, { id, name: `Forecast_P&L (${start} - ${monthLong(horizonEnd(f.horizon))})`, ...f, rules, overrides: {}, updatedAt: new Date().toISOString() });
    navigate(`/reports/forecasts/${id}?created=1`, { replace: true });
  }

  return (
    <div className="rp-fc-page">
      <header className="rp-fc-head">
        <h1>Forecast</h1>
        <Link to="/reports/forecasts" className="rp-icon" aria-label="Close">
          <X size={24} aria-hidden="true" />
        </Link>
      </header>
      <div className="rp-fc-setup">
        <div>
          <h2>Set up your forecast</h2>
          <p>Choose how you want to set up your profit and loss forecast. View projections for up to 3 years.</p>
          <SetupFields f={f} onChange={(patch) => setF({ ...f, ...patch })} />
          <hr />
          <h3>
            Set rules <span>(optional)</span> <Info size={20} aria-label="Raise or lower every account of a type by a fixed percentage" />
          </h3>
          <RuleFields rules={rules} onChange={setRules} errors={errors} />
          <p className="rp-rule-note">You can change the rules applied to individual account types at any time.</p>
        </div>
        <aside className="rp-fc-summary">
          <h3>
            <Lightbulb size={24} aria-hidden="true" /> Summary
          </h3>
          <p>
            Your forecast will be calculated based on {f.method === "AVERAGE" ? `the rolling average of actuals from the last ${f.actualsMonths} months` : METHODS.find((m) => m.key === f.method)?.about}.
          </p>
          <p>
            {active.length === 0
              ? "You didn't set any rules for this forecast."
              : active.map((g) => `${g.rule} ${rules[g.key].direction === "INCREASE" ? "increase" : "decrease"} by ${rules[g.key].percent}%`).join(". ") + "."}
          </p>
        </aside>
      </div>
      <footer className="rp-fc-foot">
        <button type="button" className="rp-btn" onClick={() => navigate("/reports/forecasts")}>
          Cancel
        </button>
        <button type="button" className="rp-btn rp-btn-primary" onClick={next}>
          Next
        </button>
      </footer>
    </div>
  );
}

/* ── Grid (195) ─────────────────────────────────────────── */

type Period = { id: string; name: string; sequence: number; startDate?: string };
type Year = { id: string; name: string; startDate: string; endDate: string; periods: Period[] };

function applyRule(value: number, rules: ForecastRules, group: string) {
  const r = rules[group];
  const n = Number(r?.percent);
  if (!r?.direction || !Number.isFinite(n)) return value;
  return value * (r.direction === "INCREASE" ? 1 + n / 100 : 1 - n / 100);
}

export function ForecastEditor({ id }: { id: string }) {
  const { accounts, currency } = useCompany();
  const { api, can } = useSession();
  const { toast, confirm } = useFeedback();
  const stored = useMemo(() => readLocal<SavedForecast>(STORE).find((f) => f.id === id), [id]);
  const [f, setF] = useState<SavedForecast | undefined>(stored);
  const [dirty, setDirty] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [panel, setPanel] = useState(true);
  const [panelTab, setPanelTab] = useState<"SETUP" | "RULES">("SETUP");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showActuals, setShowActuals] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [batchOpen, setBatchOpen] = useState<"INCREASE" | "DECREASE" | null>(null);
  const [batchText, setBatchText] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetName, setBudgetName] = useState("");
  const [budgetError, setBudgetError] = useState("");
  const [busy, setBusy] = useState(false);
  const years = useResource<Year[]>(budgetOpen ? "/api/v1/books/periods" : null);

  const nowMonth = monthKey(isoDay());
  const lastActual = shiftMonth(nowMonth, -1);
  const yearStart = `${nowMonth.slice(0, 4)}-01`;
  const lookback = f?.actualsMonths ?? 3;
  const firstNeeded = shiftMonth(nowMonth, -Math.max(lookback, 1));
  const actualMonths = useMemo(() => monthsBetween(`${yearStart}-01`, `${lastActual}-01`), [yearStart, lastActual]);
  const fetchMonths = useMemo(() => {
    const start = firstNeeded < yearStart ? firstNeeded : yearStart;
    return monthsBetween(`${start}-01`, `${lastActual}-01`);
  }, [firstNeeded, yearStart, lastActual]);
  const forecastMonths = useMemo(() => (f ? monthsBetween(`${nowMonth}-01`, `${horizonEnd(f.horizon)}-01`) : []), [f, nowMonth]);
  const figures = useMonthlyFigures(fetchMonths);

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        accounts: accounts.filter((a: Account) => a.isActive && a.type === g.key).sort((a, b) => a.code.localeCompare(b.code)),
      })),
    [accounts],
  );

  const grid = useMemo(() => {
    const out = new Map<string, Record<string, number>>();
    if (!f || !figures.rows) return out;
    const byMonth = new Map(figures.rows.map((r) => [r.month, r.byAccount]));
    for (const g of groups) {
      for (const a of g.accounts) {
        const values: Record<string, number> = {};
        for (const m of fetchMonths) values[m] = byMonth.get(m)?.[a.id] ?? 0;
        const base: number[] = fetchMonths.slice(-lookback).map((m) => values[m]);
        for (const m of forecastMonths) {
          let v = 0;
          if (f.method === "AVERAGE") {
            const window = base.slice(-lookback);
            v = window.length ? window.reduce((s, x) => s + x, 0) / window.length : 0;
            base.push(v);
          } else if (f.method === "LAST_MONTH") {
            v = values[lastActual] ?? 0;
          }
          const manual = f.overrides[a.id]?.[m];
          values[m] = manual ?? (f.method === "MANUAL" ? 0 : applyRule(v, f.rules, g.key));
        }
        out.set(a.id, values);
      }
    }
    return out;
  }, [f, figures.rows, groups, fetchMonths, forecastMonths, lookback, lastActual]);

  const visibleActuals = showActuals ? actualMonths : [];
  const columns = [...visibleActuals, ...forecastMonths];
  const groupTotal = (accs: Account[], m: string) => accs.reduce((s, a) => s + (grid.get(a.id)?.[m] ?? 0), 0);
  const signedProfit = (m: string) => {
    const t = (k: string) => groupTotal(groups.find((g) => g.key === k)!.accounts, m);
    return t("INCOME") + t("OTHER_INCOME") - t("COST_OF_SALES") - t("EXPENSE") - t("OTHER_EXPENSE");
  };

  const ruleProblems = f ? ruleErrors(f.rules) : {};

  function patch(next: Partial<SavedForecast>) {
    setF((cur) => (cur ? { ...cur, ...next } : cur));
    setDirty(true);
  }

  function persist(next = f, message: string | null = "Forecast saved.") {
    if (!next) return;
    if (Object.keys(ruleErrors(next.rules)).length) {
      setPanel(true);
      setPanelTab("RULES");
      toast("Fix the rules before saving.", { error: true });
      return false;
    }
    saveLocal<SavedForecast>(STORE, { ...next, updatedAt: new Date().toISOString() });
    setDirty(false);
    if (message) toast(message);
    return true;
  }

  useEffect(() => {
    if (autosave && dirty && f && !Object.keys(ruleErrors(f.rules)).length) {
      const t = window.setTimeout(() => persist(f, null), 800);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave, dirty, f]);

  async function close() {
    if (dirty && !(await confirm({ title: "Leave without saving?", body: "Your changes to this forecast will be lost.", confirmLabel: "Leave", danger: true }))) return;
    navigate("/reports/forecasts");
  }

  function setCell(accountId: string, month: string, text: string) {
    if (!f) return;
    const n = Number(text.replace(/,/g, ""));
    if (text.trim() !== "" && !Number.isFinite(n)) return;
    const row = { ...(f.overrides[accountId] ?? {}) };
    if (text.trim() === "") delete row[month];
    else row[month] = n;
    patch({ overrides: { ...f.overrides, [accountId]: row } });
  }

  function batchApply() {
    if (!f || !batchOpen) return;
    const pctValue = Number(batchText);
    if (!(pctValue >= 0) || !Number.isFinite(pctValue)) return toast("Enter a percentage.", { error: true });
    const factor = batchOpen === "INCREASE" ? 1 + pctValue / 100 : 1 - pctValue / 100;
    const overrides = { ...f.overrides };
    selected.forEach((aid) => {
      const row = { ...(overrides[aid] ?? {}) };
      for (const m of forecastMonths) row[m] = Math.round((grid.get(aid)?.[m] ?? 0) * factor * 100) / 100;
      overrides[aid] = row;
    });
    patch({ overrides });
    setBatchOpen(null);
    setBatchText("");
    toast(`Updated ${selected.size} account${selected.size === 1 ? "" : "s"}.`);
  }

  function clearSelected() {
    if (!f) return;
    const overrides = { ...f.overrides };
    selected.forEach((aid) => delete overrides[aid]);
    patch({ overrides });
    toast("Manual changes cleared for the selected accounts.");
  }

  function exportCsv() {
    if (!f) return;
    const rows: Array<Array<string | number>> = [["Account", ...columns.map((m) => `${monthLong(m)} ${m < nowMonth ? "Actuals" : "Forecast"}`)]];
    for (const g of groups) {
      rows.push([g.label]);
      for (const a of g.accounts) rows.push([a.name, ...columns.map((m) => grid.get(a.id)?.[m] ?? 0)]);
      rows.push([g.total, ...columns.map((m) => groupTotal(g.accounts, m))]);
    }
    rows.push(["Net profit", ...columns.map(signedProfit)]);
    downloadCsv(`${f.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, rows);
  }

  /** Budget lines for the first financial year that overlaps the forecast. */
  async function makeBudget() {
    if (!f) return;
    if (!budgetName.trim()) return setBudgetError("Give the budget a name.");
    const year = (years.data ?? []).find((y) => y.endDate.slice(0, 7) >= nowMonth && y.startDate.slice(0, 7) <= nowMonth);
    if (!year) return setBudgetError("There's no financial year covering this month. Set one up first.");
    const start = monthKey(year.startDate);
    const lines: Array<{ accountId: string; amount: number; periodSequence: number }> = [];
    for (const g of groups) {
      for (const a of g.accounts) {
        for (const m of forecastMonths) {
          const offset = (Number(m.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(m.slice(5, 7)) - Number(start.slice(5, 7));
          const sequence = year.periods.find((p) => p.startDate && monthKey(p.startDate) === m)?.sequence ?? year.periods[offset]?.sequence;
          const value = grid.get(a.id)?.[m] ?? 0;
          if (m <= monthKey(year.endDate) && sequence !== undefined && value > 0) lines.push({ accountId: a.id, amount: Math.round(value * 100) / 100, periodSequence: sequence });
        }
      }
    }
    if (!lines.length) return setBudgetError(`This forecast has no amounts above zero in ${year.name}, so there's nothing to budget.`);
    setBusy(true);
    try {
      await api("/api/v1/books/budgets", { method: "POST", body: JSON.stringify({ name: budgetName.trim(), financialYearId: year.id, lines }) });
      toast("Budget created as a draft.");
      navigate("/budgets");
    } catch (e) {
      setBudgetError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!f) {
    return <EmptyState title="This forecast no longer exists" action={<Link to="/reports/forecasts" className="rp-btn">Back to Forecasts</Link>} />;
  }

  const allAccountIds = groups.flatMap((g) => g.accounts.map((a) => a.id));

  return (
    <div className="rp-fc-page">
      <header className="rp-fc-head">
        {renaming ? (
          <input className="rp-fc-rename" autoFocus value={f.name} aria-label="Forecast name" onChange={(e) => patch({ name: e.target.value })} onBlur={() => setRenaming(false)} onKeyDown={(e) => e.key === "Enter" && setRenaming(false)} />
        ) : (
          <h1>
            {f.name}
            <button type="button" className="rp-icon" onClick={() => setRenaming(true)} aria-label="Rename forecast">
              <Pencil size={22} aria-hidden="true" />
            </button>
          </h1>
        )}
        <button type="button" className="rp-icon" onClick={() => void close()} aria-label="Close">
          <X size={24} aria-hidden="true" />
        </button>
      </header>
      <div className="rp-fc-body">
        <div className="rp-fc-main">
          <div className="rp-fc-tools">
            <Menu
              label="Batch Actions"
              triggerClassName="rp-btn rp-btn-sm"
              header={selected.size ? `${selected.size} account${selected.size === 1 ? "" : "s"} selected` : "Select accounts first"}
              items={[
                { label: "Increase by a percentage", onSelect: () => (selected.size ? setBatchOpen("INCREASE") : toast("Select at least one account first.")) },
                { label: "Decrease by a percentage", onSelect: () => (selected.size ? setBatchOpen("DECREASE") : toast("Select at least one account first.")) },
                { label: "Clear manual changes", onSelect: () => (selected.size ? clearSelected() : toast("Select at least one account first.")) },
              ]}
            />
            <Info size={20} className="rp-blue" aria-label="Tick accounts, then change their forecast months together" />
            <div className="rp-fc-tools-right">
              <label className="rp-autosave">
                <input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} /> Autosave {autosave ? "on" : "off"}
              </label>
              <button type="button" className="rp-icon" onClick={figures.reload} aria-label="Refresh actuals" title="Refresh actuals">
                <RefreshCw size={22} aria-hidden="true" />
              </button>
              <button type="button" className={`rp-icon ${panel ? "on" : ""}`} onClick={() => setPanel((p) => !p)} aria-pressed={panel} aria-label="Forecast settings" title="Forecast settings">
                <SlidersHorizontal size={22} aria-hidden="true" />
              </button>
              <button type="button" className="rp-icon" onClick={exportCsv} aria-label="Export CSV" title="Export CSV">
                <Download size={22} aria-hidden="true" />
              </button>
              <div className="rp-popover-wrap">
                <Menu
                  label={<Settings size={22} aria-hidden="true" />}
                  ariaLabel="Grid view"
                  triggerClassName="rp-icon rp-kebab"
                  items={[{ label: showActuals ? "Hide actuals" : "Show actuals", onSelect: () => setShowActuals((s) => !s) }]}
                />
              </div>
            </div>
          </div>
          {figures.error ? (
            <ErrorState message={figures.error} onRetry={figures.reload} />
          ) : !figures.rows ? (
            <SkeletonRows rows={10} cols={8} />
          ) : (
            <div className="rp-fc-scroll">
              <table className="rp-fc-grid">
                <thead>
                  <tr>
                    <th className="sticky">
                      <label className="rp-fc-all">
                        <input
                          type="checkbox"
                          aria-label="Select all accounts"
                          checked={allAccountIds.length > 0 && allAccountIds.every((a) => selected.has(a))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(allAccountIds) : new Set())}
                        />
                        Accounts
                      </label>
                    </th>
                    {columns.map((m) => (
                      <th key={m} className={m < nowMonth ? "actual" : "forecast"}>
                        {monthShort(m)} {m.slice(0, 4)}
                        <small>{m < nowMonth ? "Actuals" : "Forecast"}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                {groups.map((g) => {
                  const open = !collapsed[g.key];
                  return (
                    <tbody key={g.key}>
                      <tr className="group">
                        <th className="sticky" scope="rowgroup">
                          <button type="button" onClick={() => setCollapsed({ ...collapsed, [g.key]: open })} aria-expanded={open}>
                            {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                            {g.label}
                          </button>
                        </th>
                        {columns.map((m) => (
                          <td key={m} className={m < nowMonth ? "actual" : ""} />
                        ))}
                      </tr>
                      {open &&
                        g.accounts.map((a) => (
                          <tr key={a.id}>
                            <th className="sticky acct" scope="row">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={selected.has(a.id)}
                                  onChange={(e) => {
                                    const next = new Set(selected);
                                    if (e.target.checked) next.add(a.id);
                                    else next.delete(a.id);
                                    setSelected(next);
                                  }}
                                />
                                {a.name}
                              </label>
                            </th>
                            {columns.map((m) =>
                              m < nowMonth ? (
                                <td key={m} className="actual num">
                                  {amount(grid.get(a.id)?.[m] ?? 0, 0)}
                                </td>
                              ) : (
                                <td key={m} className="num">
                                  <input
                                    aria-label={`${a.name}, ${monthLong(m)}`}
                                    className={f.overrides[a.id]?.[m] !== undefined ? "edited" : ""}
                                    value={Math.round((grid.get(a.id)?.[m] ?? 0) * 100) / 100 || ""}
                                    placeholder="0"
                                    inputMode="decimal"
                                    onChange={(e) => setCell(a.id, m, e.target.value)}
                                  />
                                </td>
                              ),
                            )}
                          </tr>
                        ))}
                      {g.accounts.length === 0 && open && (
                        <tr>
                          <th className="sticky acct rp-muted" scope="row">
                            No accounts of this type
                          </th>
                          {columns.map((m) => (
                            <td key={m} className={m < nowMonth ? "actual" : ""} />
                          ))}
                        </tr>
                      )}
                      <tr className="total">
                        <th className="sticky" scope="row">
                          {g.total}
                        </th>
                        {columns.map((m) => (
                          <td key={m} className="num">
                            {amount(groupTotal(g.accounts, m), 0)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  );
                })}
                <tfoot>
                  <tr className="total">
                    <th className="sticky" scope="row">
                      Net profit ({currency})
                    </th>
                    {columns.map((m) => (
                      <td key={m} className="num">
                        {amount(signedProfit(m), 0)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        {panel && (
          <aside className="rp-fc-panel">
            <header>
              <h2>Forecast settings</h2>
              <button type="button" className="rp-icon" onClick={() => setPanel(false)} aria-label="Close settings">
                <X size={22} aria-hidden="true" />
              </button>
            </header>
            <div className="rp-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={panelTab === "SETUP"} className={panelTab === "SETUP" ? "on" : ""} onClick={() => setPanelTab("SETUP")}>
                Setup options
              </button>
              <button type="button" role="tab" aria-selected={panelTab === "RULES"} className={panelTab === "RULES" ? "on" : ""} onClick={() => setPanelTab("RULES")}>
                Rules
              </button>
            </div>
            {panelTab === "SETUP" ? (
              <div className="rp-panel-stack">
                <SetupFields f={f} onChange={patch} />
              </div>
            ) : (
              <RuleFields rules={f.rules} errors={ruleProblems} onChange={(rules) => patch({ rules })} />
            )}
          </aside>
        )}
      </div>
      <footer className="rp-fc-foot">
        {can("budget:manage") && (
          <button
            type="button"
            className="rp-btn"
            onClick={() => {
              setBudgetName(f.name.replace(/^Forecast_/, "Budget_"));
              setBudgetError("");
              setBudgetOpen(true);
            }}
          >
            Make this a budget
          </button>
        )}
        <div className="rp-split">
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => persist()}>
            Save
          </button>
          <Menu
            label={null}
            ariaLabel="More save options"
            triggerClassName="rp-btn rp-btn-primary rp-split-caret rp-open-up"
            items={[
              {
                label: "Save and close",
                onSelect: () => {
                  if (persist()) navigate("/reports/forecasts");
                },
              },
              {
                label: "Save as a copy",
                onSelect: () => {
                  const id2 = newId();
                  if (persist({ ...f, id: id2, name: `${f.name} (copy)` }, "Copy saved.")) navigate(`/reports/forecasts/${id2}`);
                },
              },
            ]}
          />
        </div>
      </footer>
      {batchOpen && (
        <Modal
          title={`${batchOpen === "INCREASE" ? "Increase" : "Decrease"} ${selected.size} account${selected.size === 1 ? "" : "s"}`}
          width={440}
          onClose={() => setBatchOpen(null)}
          footer={
            <>
              <button type="button" className="rp-btn" onClick={() => setBatchOpen(null)}>
                Cancel
              </button>
              <button type="button" className="rp-btn rp-btn-primary" onClick={batchApply}>
                Apply
              </button>
            </>
          }
        >
          <label className="rp-field">
            <span>Percentage, applied to every forecast month</span>
            <input autoFocus inputMode="decimal" value={batchText} onChange={(e) => setBatchText(e.target.value)} />
          </label>
        </Modal>
      )}
      {budgetOpen && (
        <Modal
          title="Make this a budget"
          width={500}
          onClose={() => setBudgetOpen(false)}
          footer={
            <>
              <button type="button" className="rp-btn" onClick={() => setBudgetOpen(false)}>
                Cancel
              </button>
              <button type="button" className="rp-btn rp-btn-primary" disabled={busy || years.loading} onClick={() => void makeBudget()}>
                {busy ? "Creating…" : "Create budget"}
              </button>
            </>
          }
        >
          <label className="rp-field">
            <span>Budget name</span>
            <input autoFocus value={budgetName} onChange={(e) => setBudgetName(e.target.value)} aria-invalid={Boolean(budgetError)} />
            {budgetError && <small className="rp-error">{budgetError}</small>}
          </label>
          <p className="rp-muted">Creates a draft budget from the forecast months in the current financial year. Actuals aren't included.</p>
        </Modal>
      )}
    </div>
  );
}

import { ArrowLeft, Download, Filter, Info, Pencil, RefreshCw, Search, SlidersHorizontal, Target, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { SERIES, TimeChart } from "../../components/reports/charts";
import { GiveFeedback, Modal, PageTitle, RpSelect } from "../../components/reports/kit";
import { Drawer, ErrorState, Menu } from "../../components/ui";
import { useCompany } from "../../lib/company";
import { amount, isoDay } from "../../lib/format";
import {
  clearReportCache,
  compareRange,
  type CustomKpi,
  downloadCsv,
  evaluateFormula,
  type KpiReport,
  type KpiRow,
  monthKey,
  monthLong,
  monthShort,
  periodRange,
  shiftMonth,
  useMonthlyFigures,
} from "../../lib/reports";
import { setQueryParam, useLocation } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { newId, removeLocal, saveLocal, useLocalCollection } from "../../lib/txn";

const KPI_PERIODS = [
  { key: "LAST_MONTH", label: "Last month" },
  { key: "THIS_MONTH", label: "This month" },
  { key: "LAST_QUARTER", label: "Last quarter" },
  { key: "THIS_QUARTER", label: "This quarter" },
  { key: "YTD", label: "This year to date" },
  { key: "LAST_YEAR", label: "Last year" },
] as const;
type KpiPeriod = (typeof KPI_PERIODS)[number]["key"];
const COMPARE = [
  { key: "PREVIOUS", label: "Previous period" },
  { key: "LAST_YEAR", label: "Same period last year" },
] as const;
type Compare = (typeof COMPARE)[number]["key"];

const CATEGORIES = ["Growth", "Profitability", "Liquidity", "Efficiency", "Other"] as const;
const CATEGORY_OF: Record<string, (typeof CATEGORIES)[number]> = {
  REVENUE: "Growth",
  GROSS_MARGIN: "Profitability",
  NET_MARGIN: "Profitability",
  EBITDA: "Profitability",
  EBITDA_MARGIN: "Profitability",
  ROA: "Profitability",
  ROE: "Profitability",
  CURRENT_RATIO: "Liquidity",
  QUICK_RATIO: "Liquidity",
  WORKING_CAPITAL: "Liquidity",
  CASH: "Liquidity",
  DSO: "Efficiency",
  DPO: "Efficiency",
  INVENTORY_TURNOVER: "Efficiency",
  DAYS_INVENTORY: "Efficiency",
  CASH_CONVERSION_CYCLE: "Efficiency",
};

type Row = {
  id: string;
  name: string;
  category: string;
  unit: KpiRow["unit"] | "NUMBER";
  higherIsBetter: boolean;
  value: number | null;
  prior: number | null;
  formula: string;
  target: number | null;
  custom?: CustomKpi;
};

const UNIT_MAP: Record<CustomKpi["unit"], Row["unit"]> = { Currency: "MONEY", Percentage: "PERCENT", Number: "NUMBER" };

function formatValue(n: number | null, unit: Row["unit"], currency: string) {
  if (n === null) return "—";
  if (unit === "MONEY") return `${currency} ${amount(n, 2)}`;
  if (unit === "PERCENT") return `${amount(n * 100, 1)}%`;
  if (unit === "DAYS") return `${amount(n, 1)} days`;
  if (unit === "TIMES") return `${amount(n, 2)}x`;
  return amount(n, 2);
}

function periodHead(from: string, to: string) {
  return monthKey(from) === monthKey(to) ? monthLong(monthKey(from)) : `${monthLong(monthKey(from))} – ${monthLong(monthKey(to))}`;
}

function varsFrom(kpis: KpiRow[] | undefined) {
  return Object.fromEntries((kpis ?? []).map((k) => [k.code, k.value]));
}

function safeEval(formula: string, vars: Record<string, number | null>) {
  try {
    return evaluateFormula(formula, vars);
  } catch {
    return null;
  }
}

/* ── Create KPI (182) ───────────────────────────────────── */

const empty = (): Omit<CustomKpi, "id"> => ({ name: "", category: "Growth", description: "", unit: "Currency", higherIsBetter: true, method: "formula", formula: "", manualValue: null, manualComparative: null, chartType: "line" });

function CreateKpi({ initial, codes, onClose }: { initial?: CustomKpi; codes: Array<{ code: string; label: string }>; onClose: () => void }) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Omit<CustomKpi, "id"> & { id?: string }>(initial ?? empty());
  const [manualText, setManualText] = useState({ value: initial?.manualValue?.toString() ?? "", prior: initial?.manualComparative?.toString() ?? "" });
  const [errors, setErrors] = useState<{ name?: string; formula?: string; manual?: string }>({});

  const months = useMemo(() => {
    const now = monthKey(isoDay());
    return Array.from({ length: 6 }, (_, i) => shiftMonth(now, i - 5));
  }, []);
  const vars = useMemo(() => Object.fromEntries(codes.map((c) => [c.code, 0])) as Record<string, number>, [codes]);
  const formulaError = useMemo(() => {
    if (draft.method !== "formula" || !draft.formula.trim()) return "";
    try {
      evaluateFormula(draft.formula, vars);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  }, [draft.formula, draft.method, vars]);
  const canPreview = draft.method === "formula" && Boolean(draft.formula.trim()) && !formulaError;
  const preview = useMonthlyFigures(canPreview ? months : []);

  function save(close: boolean) {
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = "Give the KPI a name.";
    if (draft.method === "formula") {
      if (!draft.formula.trim()) next.formula = "Enter a formula.";
      else if (formulaError) next.formula = formulaError;
    } else if (manualText.value.trim() === "" || !Number.isFinite(Number(manualText.value))) {
      next.manual = "Enter the KPI's value as a number.";
    } else if (manualText.prior.trim() !== "" && !Number.isFinite(Number(manualText.prior))) {
      next.manual = "The comparison value must be a number.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const id = draft.id ?? newId();
    saveLocal<CustomKpi>("custom-kpis", {
      ...draft,
      id,
      name: draft.name.trim(),
      manualValue: draft.method === "manual" ? Number(manualText.value) : null,
      manualComparative: draft.method === "manual" && manualText.prior.trim() ? Number(manualText.prior) : null,
    });
    setDraft((d) => ({ ...d, id }));
    toast("KPI saved.");
    if (close) onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const points = canPreview && preview.rows ? preview.rows.map((m) => safeEval(draft.formula, m.kpis)) : [];

  return (
    <>
      <div className="rp-side-overlay" onClick={onClose} />
      <aside className="rp-side" role="dialog" aria-modal="true" aria-label="Create KPI">
        <header className="rp-side-head">
          <button type="button" className="rp-link rp-ink" onClick={onClose}>
            <ArrowLeft size={18} aria-hidden="true" /> Back
          </button>
          <h2>{draft.id ? "Edit KPI" : "Create KPI"}</h2>
          <button type="button" className="rp-icon" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className="rp-side-body">
          <div className="rp-kpi-form">
            <h3>KPI details</h3>
            <div className="rp-form-row">
              <label className="rp-field">
                <span>KPI name</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={Boolean(errors.name && !draft.name.trim())} />
                {errors.name && !draft.name.trim() && <small className="rp-error">{errors.name}</small>}
              </label>
              <label className="rp-field">
                <span>KPI category</span>
                <select className="rp-select" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="rp-field">
              <span>Description</span>
              <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <div className="rp-form-row">
              <label className="rp-field">
                <span>Unit of measure</span>
                <select className="rp-select" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as CustomKpi["unit"] })}>
                  <option>Currency</option>
                  <option>Percentage</option>
                  <option>Number</option>
                </select>
              </label>
              <label className="rp-field">
                <span>
                  Variance <Info size={16} aria-label="Decides whether a rise counts as good or bad on the scorecard" />
                </span>
                <select className="rp-select" value={draft.higherIsBetter ? "high" : "low"} onChange={(e) => setDraft({ ...draft, higherIsBetter: e.target.value === "high" })}>
                  <option value="high">Higher values are better</option>
                  <option value="low">Lower values are better</option>
                </select>
              </label>
            </div>
            <h3>KPI calculation method</h3>
            <div className="rp-radios" role="radiogroup" aria-label="Calculation method">
              <label>
                <input type="radio" name="kpi-method" checked={draft.method === "formula"} onChange={() => setDraft({ ...draft, method: "formula" })} /> Build a formula
              </label>
              <label>
                <input type="radio" name="kpi-method" checked={draft.method === "manual"} onChange={() => setDraft({ ...draft, method: "manual" })} /> Enter manually
              </label>
            </div>
            {draft.method === "formula" ? (
              <>
                <label className="rp-field">
                  <span>Formula</span>
                  <textarea rows={3} placeholder="Start typing to create a formula" value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} aria-invalid={Boolean(formulaError || (errors.formula && !draft.formula.trim()))} />
                  {(formulaError || (errors.formula && !draft.formula.trim())) && <small className="rp-error">{formulaError || errors.formula}</small>}
                </label>
                <div className="rp-chips" aria-label="KPIs you can use">
                  {codes.map((c) => (
                    <button key={c.code} type="button" title={c.label} onClick={() => setDraft((d) => ({ ...d, formula: `${d.formula}${d.formula && !d.formula.endsWith(" ") ? " " : ""}${c.code}` }))}>
                      {c.code}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="rp-form-row">
                <label className="rp-field">
                  <span>Value</span>
                  <input inputMode="decimal" value={manualText.value} onChange={(e) => setManualText({ ...manualText, value: e.target.value })} aria-invalid={Boolean(errors.manual)} />
                  {errors.manual && <small className="rp-error">{errors.manual}</small>}
                </label>
                <label className="rp-field">
                  <span>Comparison value (optional)</span>
                  <input inputMode="decimal" value={manualText.prior} onChange={(e) => setManualText({ ...manualText, prior: e.target.value })} />
                </label>
              </div>
            )}
          </div>
          <div className="rp-chart-panel">
            <label className="rp-field">
              <span>Chart type</span>
              <select className="rp-select" value={draft.chartType} onChange={(e) => setDraft({ ...draft, chartType: e.target.value as CustomKpi["chartType"] })}>
                <option value="line">Line chart</option>
                <option value="bar">Bar chart</option>
              </select>
            </label>
            <div className="rp-chart-preview">
              <strong>{draft.name.trim() || "Chart title"}</strong>
              {!canPreview ? (
                <p>{draft.method === "manual" ? "Manual KPIs have a single value, so there's no trend to chart." : "Add formula to preview your chart here."}</p>
              ) : preview.error ? (
                <p>The preview couldn't load. Your formula can still be saved.</p>
              ) : !preview.rows ? (
                <p>Loading preview…</p>
              ) : (
                <TimeChart labels={months.map(monthShort)} series={[{ name: draft.name || "KPI", color: SERIES[0], values: points, kind: draft.chartType === "line" ? "line" : "bar" }]} height={190} ticks={4} money={false} compact label="KPI preview for the last six months" />
              )}
            </div>
          </div>
        </div>
        <footer className="rp-side-foot">
          <button type="button" className="rp-btn" onClick={() => save(false)}>
            Save
          </button>
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => save(true)}>
            Save and close
          </button>
        </footer>
      </aside>
    </>
  );
}

/* ── Scorecard (182) ────────────────────────────────────── */

export function KpiScorecard() {
  const { query } = useLocation();
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { toast, confirm } = useFeedback();
  const [period, setPeriod] = useState<KpiPeriod>("LAST_MONTH");
  const [compare, setCompare] = useState<Compare>("PREVIOUS");
  const [cashNote, setCashNote] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState("ALL");
  const [creating, setCreating] = useState<CustomKpi | true | null>(null);
  const [managing, setManaging] = useState(false);
  const [targetFor, setTargetFor] = useState<Row | null>(null);
  const [targetText, setTargetText] = useState("");
  const [targetError, setTargetError] = useState("");

  const custom = useLocalCollection<CustomKpi>("custom-kpis");
  const hiddenRows = useLocalCollection<{ id: string }>("kpi-hidden");
  const hidden = useMemo(() => new Set(hiddenRows.map((h) => h.id)), [hiddenRows]);

  useEffect(() => {
    if (query.get("new")) {
      setCreating(true);
      setQueryParam("new", null);
    }
  }, [query]);

  const range = periodRange(period);
  const prior = compareRange(range, compare);
  const current = useResource<KpiReport>(`/api/v1/books/kpis?from=${range.from}&to=${range.to}`);
  const previous = useResource<KpiReport>(`/api/v1/books/kpis?from=${prior.from}&to=${prior.to}`);
  const periodLabel = KPI_PERIODS.find((p) => p.key === period)!.label;
  const compareLabel = COMPARE.find((p) => p.key === compare)!.label;

  const allRows = useMemo<Row[]>(() => {
    if (!current.data) return [];
    const nowVars = varsFrom(current.data.kpis);
    const priorVars = varsFrom(previous.data?.kpis);
    const standard: Row[] = current.data.kpis.map((k) => ({
      id: k.code,
      name: k.label,
      category: CATEGORY_OF[k.code] ?? "Other",
      unit: k.unit,
      higherIsBetter: k.higherIsBetter,
      value: k.value,
      prior: priorVars[k.code] ?? null,
      formula: k.formula,
      target: k.target,
    }));
    const mine: Row[] = custom.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      unit: UNIT_MAP[c.unit],
      higherIsBetter: c.higherIsBetter,
      value: c.method === "manual" ? c.manualValue : safeEval(c.formula, nowVars),
      prior: c.method === "manual" ? c.manualComparative : safeEval(c.formula, priorVars),
      formula: c.method === "manual" ? "Entered manually" : c.formula,
      target: null,
      custom: c,
    }));
    return [...standard, ...mine];
  }, [current.data, previous.data, custom]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => !hidden.has(r.id) && (category === "ALL" || r.category === category) && (!q || r.name.toLowerCase().includes(q)));
  }, [allRows, hidden, category, search]);

  const refresh = useCallback(() => {
    clearReportCache();
    current.reload();
    previous.reload();
  }, [current, previous]);

  function exportCsv() {
    downloadCsv(`kpi-scorecard-${range.from}.csv`, [
      ["KPI name", periodLabel, compareLabel, "Variance", "Variance %"],
      ...rows.map((r) => {
        const v = r.value !== null && r.prior !== null ? r.value - r.prior : null;
        return [r.name, r.value, r.prior, v, v !== null && r.prior ? (v / Math.abs(r.prior)) * 100 : null];
      }),
    ]);
  }

  async function saveTarget() {
    if (!targetFor) return;
    const n = targetText.trim() === "" ? null : Number(targetText);
    if (n !== null && !Number.isFinite(n)) return setTargetError("Enter a number, or leave empty to remove the target.");
    try {
      await api(`/api/v1/books/kpis/targets/${targetFor.id}`, { method: "PUT", body: JSON.stringify({ target: n }) });
      toast(n === null ? "Target removed." : "Target saved.");
      setTargetFor(null);
      current.reload();
    } catch (e) {
      setTargetError((e as Error).message);
    }
  }

  return (
    <div className="rp-page">
      <PageTitle
        title="KPI Scorecard"
        actions={
          <>
            <GiveFeedback />
            <button type="button" className="rp-btn" onClick={() => setCreating(true)}>
              Create KPI
            </button>
            <button type="button" className="rp-btn rp-btn-primary" onClick={() => setManaging(true)}>
              Manage scorecard
            </button>
          </>
        }
      />
      <div className="rp-kpi-filters">
        <label className="rp-field">
          <span>Period</span>
          <RpSelect label="Period" value={period} options={KPI_PERIODS} onChange={setPeriod} />
        </label>
        <label className="rp-field">
          <span>Compare with</span>
          <RpSelect label="Compare with" value={compare} options={COMPARE} onChange={setCompare} />
        </label>
        <div className="rp-field">
          <span>Accounting method</span>
          <div className="rp-toggle" role="group" aria-label="Accounting method">
            <button type="button" onClick={() => setCashNote(true)}>
              Cash
            </button>
            <button type="button" className="on" aria-pressed="true" onClick={() => setCashNote(false)}>
              Accrual
            </button>
          </div>
        </div>
        <div className="rp-popover-wrap">
          <button type="button" className="rp-link rp-ink" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}>
            <Filter size={18} aria-hidden="true" /> Filters{category !== "ALL" ? " (1)" : ""}
          </button>
          {filterOpen && (
            <div className="rp-popover">
              <label className="rp-field">
                <span>KPI category</span>
                <select className="rp-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="ALL">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        {searchOpen ? (
          <input className="rp-inline-search" autoFocus placeholder="Search KPIs" aria-label="Search KPIs" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => !search && setSearchOpen(false)} />
        ) : (
          <button type="button" className="rp-link rp-ink" onClick={() => setSearchOpen(true)}>
            <Search size={18} aria-hidden="true" /> Search
          </button>
        )}
        <div className="rp-kpi-tools">
          <button type="button" className="rp-icon" onClick={refresh} aria-label="Refresh" title="Refresh">
            <RefreshCw size={20} aria-hidden="true" />
          </button>
          <button type="button" className="rp-icon" onClick={exportCsv} aria-label="Export CSV" title="Export CSV" disabled={!rows.length}>
            <Download size={20} aria-hidden="true" />
          </button>
          <button type="button" className="rp-icon" onClick={() => setManaging(true)} aria-label="Choose KPIs" title="Choose KPIs">
            <SlidersHorizontal size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      {cashNote && (
        <p className="rp-notice">
          Cash-basis KPIs aren't available yet because the ledger reports on an accrual basis. Showing accrual figures.
          <button type="button" className="rp-icon" onClick={() => setCashNote(false)} aria-label="Dismiss">
            <X size={16} aria-hidden="true" />
          </button>
        </p>
      )}
      {current.error ? (
        <ErrorState message={current.error} onRetry={refresh} />
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table rp-kpi-table">
            <thead>
              <tr>
                <th>KPI name</th>
                <th className="num">
                  {periodLabel}
                  <small>{periodHead(range.from, range.to)}</small>
                </th>
                <th className="num">
                  {compareLabel}
                  <small>{periodHead(prior.from, prior.to)}</small>
                </th>
                <th className="num">Variance</th>
                <th className="num">Variance %</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {current.loading && !current.data
                ? Array.from({ length: 9 }, (_, i) => (
                    <tr key={i} className="rp-skeleton-row" aria-hidden="true">
                      {Array.from({ length: 6 }, (_, j) => (
                        <td key={j}>
                          <i />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((r) => {
                    const v = r.value !== null && r.prior !== null ? r.value - r.prior : null;
                    const vp = v !== null && r.prior ? v / Math.abs(r.prior) : null;
                    const good = v === null || v === 0 ? null : v > 0 === r.higherIsBetter;
                    return (
                      <tr key={r.id}>
                        <td title={r.formula}>
                          {r.name}
                          <small>
                            {r.category}
                            {r.target !== null ? ` · Target ${formatValue(r.target, r.unit, currency)}` : ""}
                          </small>
                        </td>
                        <td className="num">{formatValue(r.value, r.unit, currency)}</td>
                        <td className="num">{formatValue(r.prior, r.unit, currency)}</td>
                        <td className={`num ${good === null ? "" : good ? "rp-good" : "rp-bad"}`}>{v === null ? "—" : formatValue(v, r.unit === "PERCENT" ? "PERCENT" : r.unit, currency)}</td>
                        <td className={`num ${good === null ? "" : good ? "rp-good" : "rp-bad"}`}>
                          {vp === null ? "—" : (
                            <>
                              <span aria-hidden="true">{vp >= 0 ? "▲ " : "▼ "}</span>
                              {amount(vp * 100, 1)}%
                            </>
                          )}
                        </td>
                        <td>
                          {r.custom ? (
                            <Menu
                              label="Edit"
                              triggerClassName="rp-link rp-menu-link"
                              items={[
                                { label: "Edit", icon: Pencil, onSelect: () => setCreating(r.custom!) },
                                {
                                  label: "Delete",
                                  icon: Trash2,
                                  onSelect: () =>
                                    void confirm({ title: `Delete ${r.name}?`, confirmLabel: "Delete", danger: true }).then((ok) => {
                                      if (ok) removeLocal("custom-kpis", r.id);
                                    }),
                                },
                              ]}
                            />
                          ) : can("budget:manage") ? (
                            <button
                              type="button"
                              className="rp-link"
                              onClick={() => {
                                setTargetFor(r);
                                setTargetText(r.target?.toString() ?? "");
                                setTargetError("");
                              }}
                            >
                              <Target size={15} aria-hidden="true" /> Set target
                            </button>
                          ) : (
                            <span className="rp-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              {!current.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="rp-empty-row">
                    No KPIs match. Clear the search or filters, or turn KPIs back on in Manage scorecard.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateKpi initial={creating === true ? undefined : creating} codes={(current.data?.kpis ?? []).map((k) => ({ code: k.code, label: k.label }))} onClose={() => setCreating(null)} />}

      {managing && (
        <Drawer title="Manage scorecard" subtitle="Choose which KPIs show on the scorecard." onClose={() => setManaging(false)} footer={<button type="button" className="rp-btn rp-btn-primary" onClick={() => setManaging(false)}>Done</button>}>
          {allRows.map((r) => (
            <label key={r.id} className="rp-check rp-check-row">
              <input
                type="checkbox"
                checked={!hidden.has(r.id)}
                onChange={(e) => {
                  if (e.target.checked) removeLocal("kpi-hidden", r.id);
                  else saveLocal("kpi-hidden", { id: r.id });
                }}
              />
              <span>
                {r.name}
                <small>{r.category}</small>
              </span>
            </label>
          ))}
        </Drawer>
      )}

      {targetFor && (
        <Modal
          title={`Target for ${targetFor.name}`}
          width={460}
          onClose={() => setTargetFor(null)}
          footer={
            <>
              <button type="button" className="rp-btn" onClick={() => setTargetFor(null)}>
                Cancel
              </button>
              <button type="button" className="rp-btn rp-btn-primary" onClick={() => void saveTarget()}>
                Save
              </button>
            </>
          }
        >
          <label className="rp-field">
            <span>Target{targetFor.unit === "PERCENT" ? " (as a fraction, e.g. 0.25 for 25%)" : ""}</span>
            <input autoFocus inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)} aria-invalid={Boolean(targetError)} />
            {targetError && <small className="rp-error">{targetError}</small>}
          </label>
        </Modal>
      )}
    </div>
  );
}


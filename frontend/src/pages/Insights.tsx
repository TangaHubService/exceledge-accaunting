import { Plus } from "lucide-react";
import { type CSSProperties, type FormEvent, useState } from "react";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Loadable, type Tone } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, humanize, isoDay, plural } from "../lib/format";
import { Link, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";

/* ── Assistant ─────────────────────────────────────────────────────── */

type Answer = { answer: string; topic: string; period: { from: string; to: string; label: string }; links: Array<{ label: string; path: string }> };

export function AssistantPanel() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    try {
      setAnswer(await api<Answer>("/api/v1/books/assistant", { method: "POST", body: JSON.stringify({ question: question.trim() }) }));
    } catch (err) {
      toast((err as Error).message, { error: true });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="panel panel-body" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Ask the books</h2>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        Ask about profit, revenue, expenses, cash, receivables, payables, margins or liquidity, for a period such as “last month”, “Q2” or “March 2026”. Answers come from the posted books.
      </p>
      <form className="filter-bar" onSubmit={ask}>
        <input className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What were our biggest expenses last quarter?" aria-label="Question" />
        <button className="btn btn-primary" type="submit" disabled={asking}>
          {asking ? "Asking…" : "Ask"}
        </button>
      </form>
      {answer && (
        <div className="notice info">
          <div className="grow">
            <div>{answer.answer}</div>
            <span className="sub">
              {answer.period.label} ({date(answer.period.from)} to {date(answer.period.to)})
              {answer.links.map((l) => (
                <span key={l.path}>
                  {" · "}
                  <Link to={l.path}>{l.label}</Link>
                </span>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── KPIs ──────────────────────────────────────────────────────────── */

type KpiRow = { code: string; label: string; value: number | null; unit: "MONEY" | "PERCENT" | "RATIO" | "DAYS" | "TIMES"; higherIsBetter: boolean; formula: string; comparative: number | null; target: number | null; met: boolean | null };
type KpiReport = { from: string; to: string; compareFrom: string; compareTo: string; currency: string; kpis: KpiRow[] };

function kpiValue(v: number | null, unit: KpiRow["unit"]) {
  if (v === null) return "—";
  if (unit === "PERCENT") return `${amount(v * 100, 1)}%`;
  if (unit === "RATIO") return amount(v, 2);
  if (unit === "TIMES") return `${amount(v, 1)}×`;
  if (unit === "DAYS") return `${amount(v, 0)} days`;
  return amount(v);
}

/** Headline KPIs for the overview: a short strip linking to the full pack on Platform. */
export function OverviewKpis() {
  const { can } = useSession();
  const report = useResource<KpiReport>(can("report:view") ? "/api/v1/books/kpis" : null);
  if (!can("report:view")) return null;
  const pick = ["REVENUE", "GROSS_MARGIN", "NET_MARGIN", "CURRENT_RATIO", "DSO", "CASH"] as const;
  return (
    <section className="panel panel-body" style={{ marginBottom: 16 }} aria-label="Key indicators">
      <div className="filter-bar" style={{ marginBottom: 8 }}>
        <h2 className="section-title grow">Key indicators</h2>
        <Link to="/platform" className="small">
          Full pack and targets
        </Link>
      </div>
      <Loadable resource={report} skeleton={<p className="muted">Loading indicators…</p>}>
        {(r) => {
          const byCode = new Map(r.kpis.map((k) => [k.code, k]));
          return (
            <div className="figures" style={{ "--cols": pick.length } as CSSProperties}>
              {pick.map((code) => {
                const k = byCode.get(code);
                if (!k) return null;
                const tone = k.met === false ? "negative" : k.met === true ? "positive" : undefined;
                return (
                  <div className="figure" key={code}>
                    <div className="figure-label">{k.label}</div>
                    <div className={`figure-value ${tone === "negative" ? "text-negative" : tone === "positive" ? "text-positive" : ""}`}>
                      {k.unit === "MONEY" && <span className="ccy">{r.currency}</span>}
                      {kpiValue(k.value, k.unit)}
                    </div>
                    <div className="figure-note">
                      {k.comparative === null ? "No comparative" : `Prior ${kpiValue(k.comparative, k.unit)}`}
                      {k.met !== null && (k.met ? " · on target" : " · off target")}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }}
      </Loadable>
    </section>
  );
}

export function KpiPanel() {
  const { can } = useSession();
  const { query } = useLocation();
  const [from, setFrom] = useState(query.get("from") ?? "");
  const [to, setTo] = useState(query.get("to") ?? "");
  const range = new URLSearchParams();
  if (from) range.set("from", from);
  if (to) range.set("to", to);
  const report = useResource<KpiReport>(`/api/v1/books/kpis?${range}`);
  const [editing, setEditing] = useState<KpiRow | null>(null);

  return (
    <div className="panel panel-body" style={{ marginBottom: 16 }}>
      <div className="filter-bar" style={{ alignItems: "flex-end" }}>
        <h2 className="section-title grow">Key indicators</h2>
        <Field label="From">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Loadable resource={report}>
        {(r) => (
          <>
            <p className="muted" style={{ margin: "4px 0 8px" }}>
              {date(r.from)} to {date(r.to)}, compared with {date(r.compareFrom)} to {date(r.compareTo)}. Money in {r.currency}.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Indicator</th>
                  <th className="num">This period</th>
                  <th className="num">Comparative</th>
                  <th className="num">Target</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.kpis.map((k) => (
                  <tr key={k.code}>
                    <td>
                      {k.label}
                      <span className="sub">{k.formula}</span>
                    </td>
                    <td className="num strong">{kpiValue(k.value, k.unit)}</td>
                    <td className="num muted">{kpiValue(k.comparative, k.unit)}</td>
                    <td className="num">
                      {k.target === null ? <span className="muted">—</span> : kpiValue(k.target, k.unit)}
                      {k.met !== null && (
                        <>
                          {" "}
                          <Badge tone={k.met ? "positive" : "negative"}>{k.met ? "Met" : "Missed"}</Badge>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {can("budget:manage") && (
                        <button type="button" className="btn btn-sm" onClick={() => setEditing(k)}>
                          Target
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Loadable>
      {editing && (
        <KpiTargetForm
          kpi={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            report.reload();
          }}
        />
      )}
    </div>
  );
}

function KpiTargetForm({ kpi, onClose, onSaved }: { kpi: KpiRow; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const scale = kpi.unit === "PERCENT" ? 100 : 1;
  const [value, setValue] = useState(kpi.target === null ? "" : String(kpi.target * scale));
  const { busy, error, run } = useSubmit(onSaved);
  function save(target: number | null) {
    void run(async () => {
      await api(`/api/v1/books/kpis/targets/${kpi.code}`, { method: "PUT", body: JSON.stringify({ target }) });
      return target === null ? "Target removed" : "Target saved";
    });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return save(null);
    save(n / scale);
  }
  return (
    <Drawer
      title={`Target: ${kpi.label}`}
      subtitle={kpi.higherIsBetter ? "Met when the actual is at or above the target." : "Met when the actual is at or below the target."}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="kpi-target-form" />}
    >
      <FormError message={error} />
      <form id="kpi-target-form" onSubmit={submit}>
        <Field label={kpi.unit === "PERCENT" ? "Target (%)" : kpi.unit === "DAYS" ? "Target (days)" : "Target"} hint="Leave empty to remove the target.">
          <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

/* ── Forecasts ─────────────────────────────────────────────────────── */

type Scenario = "BEST" | "BASE" | "WORST";
type ForecastMonth = { month: string; revenue: number; expenses: number; profit: number; cashMovement: number; closingCash: number };
type ForecastRow = {
  id: string;
  name: string;
  horizonMonths: number;
  createdAt: string;
  resultJson: { version?: number; scenarios?: Record<Scenario, { revenue: number; expenses: number }>; forecast?: Record<Scenario, ForecastMonth[]> | number[]; basedOn?: { months: string[] } };
};
type VsActual = {
  rows: Array<{ month: string; forecastRevenue: number; actualRevenue: number | null; forecastProfit: number; actualProfit: number | null; profitVariance: number | null }>;
  totals: { months: number; forecastProfit: number; actualProfit: number } | null;
};

const SCENARIOS: Array<{ value: Scenario; label: string }> = [
  { value: "BASE", label: "Base" },
  { value: "BEST", label: "Best case" },
  { value: "WORST", label: "Worst case" },
];
const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const fmtMonth = (m: string) => monthLabel.format(new Date(`${m}-01T00:00:00Z`));

export function ForecastPanel() {
  const { currency } = useCompany();
  const list = useResource<ForecastRow[]>("/api/v1/books/forecasts");
  const [making, setMaking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>("BASE");
  const [showActual, setShowActual] = useState(false);
  const current = list.data?.find((f) => f.id === selected) ?? list.data?.find((f) => f.resultJson.version === 2);
  const forecast = current && current.resultJson.version === 2 ? (current.resultJson.forecast as Record<Scenario, ForecastMonth[]>) : null;
  const vsActual = useResource<VsActual>(showActual && current && forecast ? `/api/v1/books/forecasts/${current.id}/vs-actual?scenario=${scenario}` : null);

  return (
    <div className="panel panel-body" style={{ marginBottom: 16 }}>
      <div className="filter-bar">
        <h2 className="section-title grow">Forecast</h2>
        {list.data && list.data.some((f) => f.resultJson.version === 2) && (
          <Select
            value={current?.id ?? ""}
            onChange={(v) => {
              setSelected(v);
              setShowActual(false);
            }}
            options={list.data.filter((f) => f.resultJson.version === 2).map((f) => ({ value: f.id, label: `${f.name} · ${date(f.createdAt)}` }))}
            style={{ minWidth: 240 }}
            aria-label="Forecast"
          />
        )}
        <Select value={scenario} onChange={(v) => setScenario(v as Scenario)} options={SCENARIOS} style={{ minWidth: 140 }} aria-label="Scenario" />
        <button type="button" className="btn" onClick={() => setMaking(true)}>
          <Plus size={16} aria-hidden="true" />
          New forecast
        </button>
      </div>
      {!forecast ? (
        <p className="muted">Project revenue, expenses, profit and cash from up to 24 completed months of posted books, with best, base and worst cases.</p>
      ) : (
        <>
          <p className="muted" style={{ margin: "4px 0 8px" }}>
            Based on {plural(current!.resultJson.basedOn?.months.length ?? 0, "completed month")}. {SCENARIOS.find((s) => s.value === scenario)!.label}: revenue ×
            {current!.resultJson.scenarios?.[scenario].revenue}, expenses ×{current!.resultJson.scenarios?.[scenario].expenses}. Amounts in {currency}.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Revenue</th>
                <th className="num">Expenses</th>
                <th className="num">Profit</th>
                <th className="num">Closing cash</th>
              </tr>
            </thead>
            <tbody>
              {forecast[scenario].map((m) => (
                <tr key={m.month}>
                  <td>{fmtMonth(m.month)}</td>
                  <td className="num">{amount(m.revenue)}</td>
                  <td className="num">{amount(m.expenses)}</td>
                  <td className="num strong">{amount(m.profit)}</td>
                  <td className="num">{amount(m.closingCash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="filter-bar" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => setShowActual((v) => !v)}>
              {showActual ? "Hide actuals" : "Compare with actuals"}
            </button>
          </div>
          {showActual && (
            <Loadable resource={vsActual}>
              {(v) =>
                v.totals === null ? (
                  <p className="muted">None of the forecast months has finished yet.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="num">Forecast profit</th>
                        <th className="num">Actual profit</th>
                        <th className="num">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.rows.map((r) => (
                        <tr key={r.month}>
                          <td>{fmtMonth(r.month)}</td>
                          <td className="num">{amount(r.forecastProfit)}</td>
                          <td className="num">{r.actualProfit === null ? <span className="muted">Not finished</span> : amount(r.actualProfit)}</td>
                          <td className={`num ${r.profitVariance !== null && r.profitVariance < 0 ? "negative" : ""}`}>{r.profitVariance === null ? "" : amount(r.profitVariance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </Loadable>
          )}
        </>
      )}
      {making && (
        <ForecastForm
          onClose={() => setMaking(false)}
          onSaved={(row) => {
            setMaking(false);
            setSelected(row.id);
            setShowActual(false);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function ForecastForm({ onClose, onSaved }: { onClose: () => void; onSaved: (row: ForecastRow) => void }) {
  const { api } = useSession();
  const [name, setName] = useState(`Forecast ${isoDay()}`);
  const [horizon, setHorizon] = useState("6");
  const [mult, setMult] = useState({ BEST: { revenue: "1.1", expenses: "0.97" }, WORST: { revenue: "0.85", expenses: "1.05" } });
  const { busy, error, run } = useSubmit();
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const scenarios = Object.fromEntries(Object.entries(mult).map(([k, v]) => [k, { revenue: Number(v.revenue), expenses: Number(v.expenses) }]));
      const row = await api<ForecastRow>("/api/v1/books/forecast", { method: "POST", body: JSON.stringify({ name: name.trim(), horizonMonths: Number(horizon), scenarios }) });
      onSaved(row);
      return "Forecast made";
    });
  }
  const setM = (s: "BEST" | "WORST", k: "revenue" | "expenses", v: string) => setMult({ ...mult, [s]: { ...mult[s], [k]: v } });
  return (
    <Drawer title="New forecast" subtitle="The base case continues the trend of posted revenue and expenses. Best and worst cases scale it." onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Forecast" formId="forecast-form" />}>
      <FormError message={error} />
      <form id="forecast-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required className="span-2">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Months ahead" required>
          <input className="input" type="number" min={1} max={36} required value={horizon} onChange={(e) => setHorizon(e.target.value)} />
        </Field>
        <div />
        {(["BEST", "WORST"] as const).map((s) => (
          <div key={s} className="span-2 form-grid">
            <Field label={`${s === "BEST" ? "Best" : "Worst"} case: revenue ×`}>
              <input className="input" inputMode="decimal" value={mult[s].revenue} onChange={(e) => setM(s, "revenue", e.target.value)} />
            </Field>
            <Field label="Expenses ×">
              <input className="input" inputMode="decimal" value={mult[s].expenses} onChange={(e) => setM(s, "expenses", e.target.value)} />
            </Field>
          </div>
        ))}
      </form>
    </Drawer>
  );
}

/* ── API keys ──────────────────────────────────────────────────────── */

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; rateLimitPerMinute: number; requestsLast24h: number; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };
type Usage = { key: { name: string; rateLimitPerMinute: number }; calls: Array<{ id: string; method: string; path: string; status: number | null; ipAddress: string | null; createdAt: string }>; last24h: Array<{ status: number | null; count: number }> };

const SCOPE_OPTIONS = [
  { value: "report:view", label: "Reports" },
  { value: "gl:view", label: "General ledger" },
  { value: "ar:view", label: "Receivables" },
  { value: "ap:view", label: "Payables" },
];

export function ApiKeysPanel() {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const keys = useResource<ApiKey[]>("/api/v1/books/api-keys");
  const [issuing, setIssuing] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; token: string } | null>(null);
  const [usageOf, setUsageOf] = useState<ApiKey | null>(null);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      keys.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <div className="panel panel-body" style={{ marginBottom: 16 }}>
      <div className="filter-bar">
        <h2 className="section-title grow">API keys</h2>
        <a className="btn" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
          API reference
        </a>
        <button type="button" className="btn" onClick={() => setIssuing(true)}>
          <Plus size={16} aria-hidden="true" />
          Issue key
        </button>
      </div>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        Keys give read-only access to reports and ledgers. Send one as the <code>X-API-Key</code> header. Calls over the per-minute limit are refused with 429.
      </p>
      {newKey && (
        <div className="notice info" style={{ marginBottom: 12 }}>
          Copy this key now. It will not be shown again: <code className="mono">{newKey.token}</code>
        </div>
      )}
      <Loadable resource={keys}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted">No API keys issued.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Access</th>
                  <th className="num">Limit / min</th>
                  <th className="num">Calls (24 h)</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => (
                  <tr key={k.id} className={k.revokedAt ? "row-inactive" : undefined}>
                    <td>
                      {k.name}
                      <span className="sub mono">{k.prefix}…</span>
                    </td>
                    <td>{k.scopes.map((s) => SCOPE_OPTIONS.find((o) => o.value === s)?.label ?? s).join(", ")}</td>
                    <td className="num">{k.rateLimitPerMinute}</td>
                    <td className="num">{k.requestsLast24h}</td>
                    <td>
                      {k.revokedAt ? `Revoked ${date(k.revokedAt)}` : k.expiresAt ? `Expires ${date(k.expiresAt)}` : `Issued ${date(k.createdAt)}`}
                      {k.lastUsedAt && <span className="sub">Last used {dateTime(k.lastUsedAt)}</span>}
                    </td>
                    <td className="num nowrap">
                      <button type="button" className="btn btn-sm" onClick={() => setUsageOf(k)}>
                        Usage
                      </button>{" "}
                      {!k.revokedAt && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              const value = window.prompt("Requests per minute (1–6000)", String(k.rateLimitPerMinute));
                              if (value) void act(() => api(`/api/v1/books/api-keys/${k.id}`, { method: "PATCH", body: JSON.stringify({ rateLimitPerMinute: Number(value) }) }));
                            }}
                          >
                            Limit
                          </button>{" "}
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={async () => {
                              if (!(await confirm({ title: `Revoke ${k.name}?`, body: "Anything using this key will stop working.", confirmLabel: "Revoke", danger: true }))) return;
                              void act(() => api(`/api/v1/books/api-keys/${k.id}/revoke`, { method: "POST", body: "{}" }));
                            }}
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
      {issuing && (
        <ApiKeyForm
          onClose={() => setIssuing(false)}
          onIssued={(k) => {
            setIssuing(false);
            setNewKey(k);
            keys.reload();
          }}
        />
      )}
      {usageOf && <UsageDrawer apiKey={usageOf} onClose={() => setUsageOf(null)} />}
    </div>
  );
}

function ApiKeyForm({ onClose, onIssued }: { onClose: () => void; onIssued: (k: { name: string; token: string }) => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["report:view"]);
  const [limit, setLimit] = useState("120");
  const [expiresAt, setExpiresAt] = useState("");
  const { busy, error, run } = useSubmit();
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const k = await api<{ name: string; token: string }>("/api/v1/books/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes, rateLimitPerMinute: Number(limit), expiresAt: expiresAt || undefined }),
      });
      onIssued(k);
      return "Key issued";
    });
  }
  return (
    <Drawer title="Issue API key" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Issue" formId="api-key-form" />}>
      <FormError message={error} />
      <form id="api-key-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required className="span-2">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="BI dashboard" />
        </Field>
        <Field label="Access" className="span-2">
          <div>
            {SCOPE_OPTIONS.map((o) => (
              <label key={o.value} className="check" style={{ marginRight: 16 }}>
                <input type="checkbox" checked={scopes.includes(o.value)} onChange={(e) => setScopes(e.target.checked ? [...scopes, o.value] : scopes.filter((s) => s !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Requests per minute" required>
          <input className="input" type="number" min={1} max={6000} required value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field label="Expires" hint="Optional">
          <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

function UsageDrawer({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const usage = useResource<Usage>(`/api/v1/books/api-keys/${apiKey.id}/usage`);
  return (
    <Drawer title={`Usage: ${apiKey.name}`} subtitle="The latest 100 calls. Usage is kept for 90 days." wide onClose={onClose}>
      <Loadable resource={usage}>
        {(u) => (
          <>
            <p className="muted">
              Last 24 hours:{" "}
              {u.last24h.length === 0 ? "no calls" : u.last24h.map((s) => `${s.count} × ${s.status ?? "in progress"}`).join(", ")}. Limit {u.key.rateLimitPerMinute} per minute.
            </p>
            {u.calls.length === 0 ? (
              <EmptyState title="Not used yet" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Request</th>
                    <th className="num">Status</th>
                    <th>From</th>
                  </tr>
                </thead>
                <tbody>
                  {u.calls.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{dateTime(c.createdAt)}</td>
                      <td className="mono">
                        {c.method} {c.path}
                      </td>
                      <td className="num">
                        <Badge tone={c.status === null ? "neutral" : c.status < 300 ? "positive" : c.status === 429 ? "warning" : "negative"}>{c.status ?? "—"}</Badge>
                      </td>
                      <td className="mono muted">{c.ipAddress ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

/* ── Webhooks ──────────────────────────────────────────────────────── */

type Webhook = { id: string; url: string; events: string[]; isActive: boolean; description: string | null; createdAt: string };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; createdAt: string; deliveredAt: string | null; nextAttemptAt: string };

const EVENT_LABEL: Record<string, string> = { "posting.failed": "Posting failed", "period.closed": "Period closed", "period.reopened": "Period reopened" };
const DELIVERY_TONE: Record<string, Tone> = { DELIVERED: "positive", PENDING: "warning", FAILED: "negative" };

export function WebhooksPanel() {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const hooks = useResource<{ events: string[]; endpoints: Webhook[] }>("/api/v1/books/webhooks");
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [deliveriesOf, setDeliveriesOf] = useState<Webhook | null>(null);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast(ok);
      hooks.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <div className="panel panel-body" style={{ marginBottom: 16 }}>
      <div className="filter-bar">
        <h2 className="section-title grow">Webhooks</h2>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          Add webhook
        </button>
      </div>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        Tell another system when a posting fails or a period is closed or reopened. Each delivery is signed with the webhook's secret in the <code>X-Exceledge-Signature</code> header and retried for about a day if it fails.
      </p>
      {secret && (
        <div className="notice info" style={{ marginBottom: 12 }}>
          Copy the signing secret now. It will not be shown again: <code className="mono">{secret}</code>
        </div>
      )}
      <Loadable resource={hooks}>
        {({ endpoints }) =>
          endpoints.length === 0 ? (
            <p className="muted">No webhooks.</p>
          ) : (
            <table className="table">
              <tbody>
                {endpoints.map((h) => (
                  <tr key={h.id} className={h.isActive ? undefined : "row-inactive"}>
                    <td>
                      <span className="mono">{h.url}</span>
                      <span className="sub">
                        {h.events.map((e) => EVENT_LABEL[e] ?? e).join(", ")}
                        {h.description && ` · ${h.description}`}
                      </span>
                    </td>
                    <td>{h.isActive ? <Badge tone="positive">Active</Badge> : <Badge>Paused</Badge>}</td>
                    <td className="num nowrap">
                      <button type="button" className="btn btn-sm" onClick={() => void act(() => api(`/api/v1/books/webhooks/${h.id}/ping`, { method: "POST", body: "{}" }), "Test delivery sent")}>
                        Test
                      </button>{" "}
                      <button type="button" className="btn btn-sm" onClick={() => setDeliveriesOf(h)}>
                        Deliveries
                      </button>{" "}
                      <button type="button" className="btn btn-sm" onClick={() => void act(() => api(`/api/v1/books/webhooks/${h.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !h.isActive }) }))}>
                        {h.isActive ? "Pause" : "Resume"}
                      </button>{" "}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          if (!(await confirm({ title: "Delete this webhook?", body: h.url, confirmLabel: "Delete", danger: true }))) return;
                          void act(() => api(`/api/v1/books/webhooks/${h.id}`, { method: "DELETE" }), "Webhook deleted");
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
      {adding && hooks.data && (
        <WebhookForm
          events={hooks.data.events}
          onClose={() => setAdding(false)}
          onSaved={(s) => {
            setAdding(false);
            setSecret(s);
            hooks.reload();
          }}
        />
      )}
      {deliveriesOf && <DeliveriesDrawer hook={deliveriesOf} onClose={() => setDeliveriesOf(null)} />}
    </div>
  );
}

function WebhookForm({ events, onClose, onSaved }: { events: string[]; onClose: () => void; onSaved: (secret: string) => void }) {
  const { api } = useSession();
  const [url, setUrl] = useState("https://");
  const [chosen, setChosen] = useState<string[]>(events);
  const [description, setDescription] = useState("");
  const { busy, error, run } = useSubmit();
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const row = await api<{ secret: string }>("/api/v1/books/webhooks", { method: "POST", body: JSON.stringify({ url: url.trim(), events: chosen, description: description.trim() || null }) });
      onSaved(row.secret);
      return "Webhook added";
    });
  }
  return (
    <Drawer title="Add webhook" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Add" formId="webhook-form" />}>
      <FormError message={error} />
      <form id="webhook-form" onSubmit={submit} className="form-grid">
        <Field label="URL" required className="span-2" hint="Must be https and reachable from the internet.">
          <input className="input mono" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Events" className="span-2">
          <div>
            {events.map((ev) => (
              <label key={ev} className="check" style={{ marginRight: 16 }}>
                <input type="checkbox" checked={chosen.includes(ev)} onChange={(e) => setChosen(e.target.checked ? [...chosen, ev] : chosen.filter((c) => c !== ev))} />
                {EVENT_LABEL[ev] ?? ev}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Description" className="span-2">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ops alerts channel" />
        </Field>
      </form>
    </Drawer>
  );
}

function DeliveriesDrawer({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const deliveries = useResource<Delivery[]>(`/api/v1/books/webhooks/${hook.id}/deliveries`);
  return (
    <Drawer title="Deliveries" subtitle={hook.url} wide onClose={onClose}>
      <Loadable resource={deliveries}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="Nothing sent yet" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th className="num">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{dateTime(d.createdAt)}</td>
                    <td>{EVENT_LABEL[d.event] ?? d.event}</td>
                    <td>
                      <Badge tone={DELIVERY_TONE[d.status] ?? "neutral"}>{humanize(d.status)}</Badge>
                      {d.lastError && <span className="sub">{d.lastError}</span>}
                      {d.status === "PENDING" && d.attempts > 0 && <span className="sub">Next try {dateTime(d.nextAttemptAt)}</span>}
                    </td>
                    <td className="num">{d.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
    </Drawer>
  );
}

/* ── Email notifications ───────────────────────────────────────────── */

type NotificationSettings = { emailEnabled: boolean; emailMinSeverity: "INFO" | "WARNING" | "CRITICAL"; outbox: { pending: number; failed: number; sent: number } };

export function EmailSettingsPanel() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const settings = useResource<NotificationSettings>("/api/v1/books/notifications/settings");
  const manage = can("platform:manage");

  async function save(patch: Partial<NotificationSettings>) {
    if (!settings.data) return;
    try {
      await api("/api/v1/books/notifications/settings", {
        method: "PUT",
        body: JSON.stringify({ emailEnabled: patch.emailEnabled ?? settings.data.emailEnabled, emailMinSeverity: patch.emailMinSeverity ?? settings.data.emailMinSeverity }),
      });
      toast("Email settings saved");
      settings.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <div className="panel panel-body" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Email alerts</h2>
      <Loadable resource={settings}>
        {(s) => (
          <>
            <p className="muted" style={{ margin: "4px 0 12px" }}>
              Alerts are emailed through Excel Edge to the people they are for: the targeted user or role, otherwise owners, admins and accountants.
            </p>
            <div className="filter-bar">
              <label className="check">
                <input type="checkbox" disabled={!manage} checked={s.emailEnabled} onChange={(e) => void save({ emailEnabled: e.target.checked })} />
                Email alerts
              </label>
              <Select
                value={s.emailMinSeverity}
                disabled={!manage || !s.emailEnabled}
                onChange={(v) => void save({ emailMinSeverity: v as NotificationSettings["emailMinSeverity"] })}
                options={[
                  { value: "INFO", label: "All alerts" },
                  { value: "WARNING", label: "Warnings and critical" },
                  { value: "CRITICAL", label: "Critical only" },
                ]}
                style={{ minWidth: 200 }}
                aria-label="Which alerts"
              />
              <span className="muted grow">
                Sent {s.outbox.sent}
                {s.outbox.pending > 0 && ` · waiting ${s.outbox.pending}`}
                {s.outbox.failed > 0 && ` · failed ${s.outbox.failed}`}
              </span>
            </div>
          </>
        )}
      </Loadable>
    </div>
  );
}

/* ── Risk register and control tests ───────────────────────────────── */

type Rating = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type ControlRef = { id: string; code: string; title: string; status: string; lastTestedAt: string | null };
type Risk = {
  id: string;
  code: string;
  title: string;
  category: string;
  description: string | null;
  likelihood: number;
  impact: number;
  residualLikelihood: number | null;
  residualImpact: number | null;
  inherentScore: number;
  inherentRating: Rating;
  residualScore: number | null;
  residualRating: Rating | null;
  status: string;
  ownerName: string | null;
  reviewDate: string | null;
  reviewOverdue: boolean;
  controls: ControlRef[];
};
export type ControlWithTests = {
  id: string;
  code: string;
  title: string;
  category: string;
  status: string;
  notes: string | null;
  lastTestedAt: string | null;
  lastTest: { result: "PASS" | "FAIL"; testedAt: string } | null;
  riskCount: number;
  testCount: number;
};
type ControlTest = { id: string; testedAt: string; result: "PASS" | "FAIL"; sampleSize: number | null; notes: string | null; testedByErpUserId: number; createdAt: string };

const RATING_TONE: Record<Rating, Tone> = { LOW: "positive", MEDIUM: "info", HIGH: "warning", CRITICAL: "negative" };
const LEVELS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} – ${["Rare", "Unlikely", "Possible", "Likely", "Almost certain"][n - 1]}` }));
const IMPACTS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} – ${["Minor", "Moderate", "Significant", "Major", "Severe"][n - 1]}` }));

export function RiskRegister({ controls }: { controls: ControlRef[] }) {
  const { can } = useSession();
  const risks = useResource<Risk[]>("/api/v1/books/risks");
  const [editing, setEditing] = useState<Risk | "new" | null>(null);

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: 8 }}>
        <h2 className="section-title grow">Risk register</h2>
        {can("control:manage") && (
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden="true" />
            Add risk
          </button>
        )}
      </div>
      <Loadable resource={risks}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel" style={{ marginBottom: 20 }}>
              <EmptyState title="No risks recorded" body="Score each risk by likelihood and impact (1–5), link the controls that address it, and set a review date." />
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Risk</th>
                    <th>Inherent</th>
                    <th>Residual</th>
                    <th>Controls</th>
                    <th>Owner / review</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.status === "CLOSED" ? "row-inactive" : undefined}>
                      <td>
                        <span className="mono">{r.code}</span> {r.title}
                        <span className="sub">
                          {r.category} · {humanize(r.status)}
                        </span>
                      </td>
                      <td className="nowrap">
                        <Badge tone={RATING_TONE[r.inherentRating]}>{r.inherentScore} {humanize(r.inherentRating)}</Badge>
                        <span className="sub">
                          L{r.likelihood} × I{r.impact}
                        </span>
                      </td>
                      <td className="nowrap">
                        {r.residualRating ? <Badge tone={RATING_TONE[r.residualRating]}>{r.residualScore} {humanize(r.residualRating)}</Badge> : <span className="muted">Not assessed</span>}
                      </td>
                      <td>
                        {r.controls.length === 0 ? (
                          <span className="muted">None</span>
                        ) : (
                          r.controls.map((c) => (
                            <span key={c.id} className="sub">
                              {c.code} · {humanize(c.status)}
                            </span>
                          ))
                        )}
                      </td>
                      <td>
                        {r.ownerName ?? <span className="muted">—</span>}
                        {r.reviewDate && <span className={`sub ${r.reviewOverdue ? "negative" : ""}`}>Review {date(r.reviewDate)}{r.reviewOverdue ? " (overdue)" : ""}</span>}
                      </td>
                      <td className="num">
                        {can("control:manage") && (
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>
                            Update
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
      {editing && (
        <RiskForm
          risk={editing === "new" ? undefined : editing}
          controls={controls}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            risks.reload();
          }}
        />
      )}
    </>
  );
}

function RiskForm({ risk, controls, onClose, onSaved }: { risk?: Risk; controls: ControlRef[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({
    code: risk?.code ?? "",
    title: risk?.title ?? "",
    category: risk?.category ?? "",
    description: risk?.description ?? "",
    likelihood: String(risk?.likelihood ?? 3),
    impact: String(risk?.impact ?? 3),
    residualLikelihood: risk?.residualLikelihood ? String(risk.residualLikelihood) : "",
    residualImpact: risk?.residualImpact ? String(risk.residualImpact) : "",
    status: risk?.status ?? "OPEN",
    ownerName: risk?.ownerName ?? "",
    reviewDate: risk?.reviewDate?.slice(0, 10) ?? "",
    controlIds: risk?.controls.map((c) => c.id) ?? [],
  });
  const { busy, error, run } = useSubmit(onSaved);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const body = {
        title: form.title.trim(),
        category: form.category.trim(),
        description: form.description.trim() || null,
        likelihood: Number(form.likelihood),
        impact: Number(form.impact),
        residualLikelihood: form.residualLikelihood ? Number(form.residualLikelihood) : null,
        residualImpact: form.residualImpact ? Number(form.residualImpact) : null,
        status: form.status,
        ownerName: form.ownerName.trim() || null,
        reviewDate: form.reviewDate || null,
        controlIds: form.controlIds,
      };
      if (risk) await api(`/api/v1/books/risks/${risk.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/books/risks", { method: "POST", body: JSON.stringify({ ...body, code: form.code.trim() }) });
      return "Risk saved";
    });
  }
  const notAssessed = [{ value: "", label: "Not assessed" }];
  return (
    <Drawer title={risk ? `Update ${risk.code}` : "Add risk"} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="risk-form" />}>
      <FormError message={error} />
      <form id="risk-form" onSubmit={submit} className="form-grid">
        <Field label="Code" required>
          <input className="input" required disabled={!!risk} value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="R-01" />
        </Field>
        <Field label="Area" required>
          <input className="input" required value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Cash" />
        </Field>
        <Field label="Risk" required className="span-2">
          <input className="input" required value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Cash receipts are not banked" />
        </Field>
        <Field label="Description" className="span-2">
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Likelihood" required>
          <Select value={form.likelihood} onChange={(v) => set({ likelihood: v })} options={LEVELS} />
        </Field>
        <Field label="Impact" required>
          <Select value={form.impact} onChange={(v) => set({ impact: v })} options={IMPACTS} />
        </Field>
        <Field label="Residual likelihood" hint="After controls">
          <Select value={form.residualLikelihood} onChange={(v) => set({ residualLikelihood: v })} options={[...notAssessed, ...LEVELS]} />
        </Field>
        <Field label="Residual impact">
          <Select value={form.residualImpact} onChange={(v) => set({ residualImpact: v })} options={[...notAssessed, ...IMPACTS]} />
        </Field>
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(v) => set({ status: v })}
            options={["OPEN", "MITIGATING", "ACCEPTED", "CLOSED"].map((s) => ({ value: s, label: humanize(s) }))}
          />
        </Field>
        <Field label="Owner">
          <input className="input" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
        </Field>
        <Field label="Next review">
          <input className="input" type="date" value={form.reviewDate} onChange={(e) => set({ reviewDate: e.target.value })} />
        </Field>
        <div />
        <Field label="Controls that address it" className="span-2">
          <div>
            {controls.length === 0 && <span className="muted">Add controls to the register first.</span>}
            {controls.map((c) => (
              <label key={c.id} className="check" style={{ display: "flex", marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={form.controlIds.includes(c.id)}
                  onChange={(e) => set({ controlIds: e.target.checked ? [...form.controlIds, c.id] : form.controlIds.filter((id) => id !== c.id) })}
                />
                <span className="mono">{c.code}</span>&nbsp;{c.title}
              </label>
            ))}
          </div>
        </Field>
      </form>
    </Drawer>
  );
}

export function ControlTestsDrawer({ control, onClose, onChanged }: { control: ControlWithTests; onClose: () => void; onChanged: () => void }) {
  const { can, api } = useSession();
  const tests = useResource<ControlTest[]>(`/api/v1/books/controls/${control.id}/tests`);
  const [form, setForm] = useState({ testedAt: isoDay(), result: "PASS", sampleSize: "", notes: "" });
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const { busy, error, run } = useSubmit(() => {
    tests.reload();
    onChanged();
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const row = await api<ControlTest>(`/api/v1/books/controls/${control.id}/tests`, {
        method: "POST",
        body: JSON.stringify({ testedAt: form.testedAt, result: form.result, sampleSize: form.sampleSize ? Number(form.sampleSize) : null, notes: form.notes.trim() || null }),
      });
      setForm({ ...form, sampleSize: "", notes: "" });
      setEvidenceFor(row.id);
      return "Test recorded";
    });
  }
  return (
    <Drawer title={`${control.code}: tests`} subtitle={control.title} wide onClose={onClose}>
      <FormError message={error} />
      {can("control:manage") && (
        <form onSubmit={submit} className="form-grid" style={{ marginBottom: 16 }}>
          <Field label="Tested on" required>
            <input className="input" type="date" required max={isoDay()} value={form.testedAt} onChange={(e) => setForm({ ...form, testedAt: e.target.value })} />
          </Field>
          <Field label="Result" required>
            <Select
              value={form.result}
              onChange={(v) => setForm({ ...form, result: v })}
              options={[
                { value: "PASS", label: "Passed" },
                { value: "FAIL", label: "Failed" },
              ]}
            />
          </Field>
          <Field label="Sample size">
            <input className="input" type="number" min={1} value={form.sampleSize} onChange={(e) => setForm({ ...form, sampleSize: e.target.value })} />
          </Field>
          <div />
          <Field label="What was checked" required={form.result === "FAIL"} className="span-2" hint="A failed test makes the control deficient; a pass makes it effective.">
            <textarea className="input" rows={2} required={form.result === "FAIL"} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className="span-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Record test"}
            </button>
          </div>
        </form>
      )}
      <Loadable resource={tests}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="Not tested yet" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Tested</th>
                  <th>Result</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">
                      {date(t.testedAt)}
                      <span className="sub">User #{t.testedByErpUserId}</span>
                    </td>
                    <td>
                      <Badge tone={t.result === "PASS" ? "positive" : "negative"}>{t.result === "PASS" ? "Passed" : "Failed"}</Badge>
                      {t.sampleSize && <span className="sub">Sample {t.sampleSize}</span>}
                    </td>
                    <td>{t.notes}</td>
                    <td className="num">
                      <button type="button" className="btn btn-sm" onClick={() => setEvidenceFor(evidenceFor === t.id ? null : t.id)}>
                        Evidence
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
      {evidenceFor && (
        <div style={{ marginTop: 16 }}>
          <AttachmentsPanel entityType="ControlTest" entityId={evidenceFor} title="Evidence for the selected test" />
        </div>
      )}
    </Drawer>
  );
}

import { Plus } from "lucide-react";
import { type FormEvent, Fragment, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader, type Tone } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, calendarDate, date, dateTime, humanize } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import { ApiKeysPanel, AssistantPanel, type ControlWithTests, ControlTestsDrawer, EmailSettingsPanel, ForecastPanel, KpiPanel, RiskRegister, WebhooksPanel } from "./Insights";

export { Statements } from "./Statements";

type Period = { id: string; name: string; sequence: number; startDate: string; endDate: string; status: string; reopenReason: string | null };
type Year = { id: string; name: string; startDate: string; endDate: string; periods: Period[] };
type CloseItemStatus = "DONE" | "FAILING" | "NOT_APPLICABLE" | "OVERRIDDEN";
type CloseItem = { key: string; label: string; status: CloseItemStatus; detail: string; override: { note: string; erpUserId: number; at: string } | null };
type Checklist = {
  canClose: boolean;
  blockers: string[];
  warnings: string[];
  items: CloseItem[];
  counts: { unpostedJournals: number; unpostedExpenses: number; heldBills: number; pendingApprovals: number; openExceptions: number; unreconciledBankItems: number };
  earlierOpen: number;
  lastOfYear: boolean;
  difference: number;
  approvalRequired: boolean;
  pendingRequest: { id: string; approvalRequestId: string | null; requestedByErpUserId: number | null; requestedAt: string } | null;
};
type CloseHistoryRow = {
  id: string;
  periodName: string | null;
  yearName: string | null;
  kind: "MONTH" | "YEAR";
  status: string;
  requestedByErpUserId: number | null;
  requestedAt: string;
  approvalRequestId: string | null;
  decidedByErpUserId: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  closedAt: string | null;
  reopenReason: string | null;
  reopenedByErpUserId: number | null;
  reopenedAt: string | null;
  checklist: { items?: Array<{ key: string; label: string; status: CloseItemStatus; override: { note: string } | null }> } | null;
};

const PERIOD_TONE: Record<string, Tone> = { OPEN: "positive", REOPENED: "warning", CLOSED: "neutral", FUTURE: "neutral", TEMPORARILY_LOCKED: "warning" };
const ITEM_TONE: Record<CloseItemStatus, Tone> = { DONE: "positive", FAILING: "negative", NOT_APPLICABLE: "neutral", OVERRIDDEN: "warning" };
const ITEM_STATUS: Record<CloseItemStatus, string> = { DONE: "Done", FAILING: "Not done", NOT_APPLICABLE: "Not applicable", OVERRIDDEN: "Accepted" };
const CLOSE_TONE: Record<string, Tone> = { PENDING_APPROVAL: "warning", CLOSED: "positive", REOPENED: "info", REJECTED: "negative" };
const userLabel = (id: number | null | undefined) => (id ? `User #${id}` : "—");

export function PeriodClose() {
  const { can } = useSession();
  const years = useResource<Year[]>("/api/v1/books/periods");
  const history = useResource<CloseHistoryRow[]>("/api/v1/books/close/history");
  const [reviewing, setReviewing] = useState<Period | null>(null);
  const [reopening, setReopening] = useState<Period | null>(null);
  const reload = () => {
    years.reload();
    history.reload();
  };

  return (
    <>
      <PageHeader
        title="Period close"
        description="Work through the checklist for a month, then close it. Closing the last month of the year moves profit to retained earnings."
      />
      <Loadable resource={years}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No financial years" body="Set up a financial year in Company setup first." />
            </div>
          ) : (
            rows.map((y) => (
              <div className="table-wrap" key={y.id} style={{ marginBottom: 16 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{y.name}</th>
                      <th>Dates</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {y.periods.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="nowrap">
                          {calendarDate(p.startDate)} – {calendarDate(p.endDate)}
                        </td>
                        <td>
                          <Badge tone={PERIOD_TONE[p.status] ?? "neutral"}>{humanize(p.status)}</Badge>
                          {p.reopenReason && <span className="sub">{p.reopenReason}</span>}
                        </td>
                        <td className="num">
                          {(p.status === "OPEN" || p.status === "REOPENED" || p.status === "TEMPORARILY_LOCKED") && (
                            <button type="button" className="btn" onClick={() => setReviewing(p)}>
                              {can("close:manage") ? "Review close" : "Checklist"}
                            </button>
                          )}
                          {can("close:manage") && p.status === "CLOSED" && (
                            <button type="button" className="btn" onClick={() => setReopening(p)}>
                              Reopen
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )
        }
      </Loadable>
      <CloseHistory history={history} />
      {reviewing && (
        <CloseDrawer
          period={reviewing}
          onClose={() => setReviewing(null)}
          onChanged={history.reload}
          onDone={() => {
            setReviewing(null);
            reload();
          }}
        />
      )}
      {reopening && (
        <ReopenDrawer
          period={reopening}
          onClose={() => setReopening(null)}
          onDone={() => {
            setReopening(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function CloseHistory({ history }: { history: { data?: CloseHistoryRow[]; error?: string; loading: boolean; reload: () => void } }) {
  return (
    <Loadable resource={history}>
      {(rows) => (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Closing history</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Approved or decided</th>
                <th>Closed</th>
                <th>Reopened</th>
                <th>Checklist at close</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No period has been closed yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const accepted = (r.checklist?.items ?? []).filter((i) => i.status === "OVERRIDDEN");
                  return (
                    <tr key={r.id}>
                      <td>
                        {r.periodName ?? "—"}
                        <span className="sub">
                          {r.yearName}
                          {r.kind === "YEAR" ? " · year-end" : ""}
                        </span>
                      </td>
                      <td>
                        <Badge tone={CLOSE_TONE[r.status] ?? "neutral"}>{humanize(r.status)}</Badge>
                      </td>
                      <td>
                        {userLabel(r.requestedByErpUserId)}
                        <span className="sub">{dateTime(r.requestedAt)}</span>
                      </td>
                      <td>
                        {r.approvalRequestId ? (
                          <>
                            <Link to={`/approvals?id=${r.approvalRequestId}`}>{r.decidedAt ? userLabel(r.decidedByErpUserId) : "Waiting"}</Link>
                            {r.decidedAt && <span className="sub">{dateTime(r.decidedAt)}</span>}
                            {r.decisionNote && <span className="sub">{r.decisionNote}</span>}
                          </>
                        ) : (
                          <span className="muted">No approval step</span>
                        )}
                      </td>
                      <td>{r.closedAt ? dateTime(r.closedAt) : "—"}</td>
                      <td>
                        {r.reopenedAt ? (
                          <>
                            {userLabel(r.reopenedByErpUserId)}
                            <span className="sub">{dateTime(r.reopenedAt)}</span>
                            {r.reopenReason && <span className="sub">{r.reopenReason}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {accepted.length === 0 ? (
                          <span className="muted">All items done or not applicable</span>
                        ) : (
                          accepted.map((i) => (
                            <span key={i.key} className="sub">
                              {i.label} accepted: {i.override?.note}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </Loadable>
  );
}

function CloseDrawer({ period, onClose, onChanged, onDone }: { period: Period; onClose: () => void; onChanged: () => void; onDone: () => void }) {
  const { api, can } = useSession();
  const { confirm, toast } = useFeedback();
  const check = useResource<Checklist>(`/api/v1/books/close/checklist?periodId=${period.id}`);
  const { busy, error, run } = useSubmit(onDone);
  const [accepting, setAccepting] = useState<CloseItem | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const manage = can("close:manage");
  const lastOfYear = check.data?.lastOfYear ?? false;
  const kind = lastOfYear ? "YEAR" : "MONTH";
  const needsApproval = check.data?.approvalRequired ?? false;
  const pending = check.data?.pendingRequest ?? null;

  async function close() {
    const ok = await confirm({
      title: needsApproval ? `Request approval to close ${period.name}?` : lastOfYear ? `Close ${period.name} and the year?` : `Close ${period.name}?`,
      body: needsApproval
        ? "Another person with close rights must approve the request. The period closes when they approve it."
        : lastOfYear
          ? "Profit and loss balances will be moved to retained earnings, and no more journals can be posted to this period."
          : "No more journals can be posted to this period until it is reopened.",
      confirmLabel: needsApproval ? "Request close" : lastOfYear ? "Close year" : "Close month",
    });
    if (!ok) return;
    void run(async () => {
      await api(needsApproval ? "/api/v1/books/close/request" : "/api/v1/books/close", { method: "POST", body: JSON.stringify({ periodId: period.id, kind }) });
      return needsApproval ? `Close of ${period.name} sent for approval` : `${period.name} closed`;
    });
  }

  async function changeOverride(item: CloseItem, accept: boolean) {
    setSaving(true);
    try {
      await api(accept ? "/api/v1/books/close/overrides" : "/api/v1/books/close/overrides/remove", {
        method: "POST",
        body: JSON.stringify({ periodId: period.id, item: item.key, ...(accept ? { note: note.trim() } : {}) }),
      });
      toast(accept ? `${item.label} accepted` : `${item.label} is checked again`);
      setAccepting(null);
      setNote("");
      check.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={`Close ${period.name}`}
      subtitle={`${calendarDate(period.startDate)} – ${calendarDate(period.endDate)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {manage ? "Cancel" : "Close"}
          </button>
          {manage && pending?.approvalRequestId && (
            <Link to={`/approvals?id=${pending.approvalRequestId}`} className="btn btn-primary">
              Open approval
            </Link>
          )}
          {manage && !pending && (
            <button type="button" className="btn btn-primary" disabled={busy || !check.data?.canClose} onClick={() => void close()}>
              {busy ? "Saving…" : needsApproval ? "Request close" : lastOfYear ? "Close year" : "Close month"}
            </button>
          )}
        </>
      }
    >
      <FormError message={error} />
      <Loadable resource={check}>
        {(c) => (
          <>
            <div className={`notice ${pending ? "info" : c.canClose ? "info" : "error"}`} role="status">
              {pending
                ? `Close requested by ${userLabel(pending.requestedByErpUserId)} on ${dateTime(pending.requestedAt)}; waiting for approval.`
                : c.canClose
                  ? c.approvalRequired
                    ? "Everything is in place. Closing needs a second person's approval."
                    : "Everything is in place to close this period."
                  : "Fix or accept these before closing:"}
            </div>
            {!pending && c.blockers.length > 0 && (
              <ul style={{ marginTop: 12 }}>
                {c.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}

            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Checklist</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <Fragment key={i.key}>
                    <tr>
                      <td>
                        {i.label}
                        <span className="sub">{i.detail}</span>
                        {i.override && (
                          <span className="sub">
                            Accepted by {userLabel(i.override.erpUserId)} on {dateTime(i.override.at)}: {i.override.note}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={ITEM_TONE[i.status]}>{ITEM_STATUS[i.status]}</Badge>
                      </td>
                      <td className="num">
                        {manage && !pending && i.status === "FAILING" && accepting?.key !== i.key && (
                          <button type="button" className="btn" onClick={() => setAccepting(i)}>
                            Accept…
                          </button>
                        )}
                        {manage && !pending && i.status === "OVERRIDDEN" && (
                          <button type="button" className="btn" disabled={saving} onClick={() => void changeOverride(i, false)}>
                            Check again
                          </button>
                        )}
                      </td>
                    </tr>
                    {accepting?.key === i.key && (
                      <tr>
                        <td colSpan={3}>
                          <Field label={`Why can ${i.label.toLowerCase()} be accepted?`} required hint="Recorded with your name in the closing history.">
                            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="No payroll this month: staff are paid quarterly" />
                          </Field>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button type="button" className="btn btn-primary" disabled={saving || note.trim().length < 3} onClick={() => void changeOverride(i, true)}>
                              {saving ? "Saving…" : "Accept item"}
                            </button>
                            <button type="button" className="btn" onClick={() => setAccepting(null)}>
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>

            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>In this period</th>
                  <th className="num">Count</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Earlier periods still open</td>
                  <td className="num">{c.earlierOpen}</td>
                </tr>
                <tr>
                  <td>Journals not posted (draft or waiting for approval)</td>
                  <td className="num">{c.counts.unpostedJournals}</td>
                </tr>
                <tr>
                  <td>Approvals waiting</td>
                  <td className="num">{c.counts.pendingApprovals}</td>
                </tr>
                <tr>
                  <td>Open posting exceptions</td>
                  <td className="num">{c.counts.openExceptions}</td>
                </tr>
                <tr>
                  <td>Expenses not posted</td>
                  <td className="num">{c.counts.unpostedExpenses}</td>
                </tr>
                <tr>
                  <td>Supplier bills held for approval</td>
                  <td className="num">{c.counts.heldBills}</td>
                </tr>
                <tr>
                  <td>Bank and mobile money entries not reconciled</td>
                  <td className="num">{c.counts.unreconciledBankItems}</td>
                </tr>
                <tr>
                  <td>Trial balance difference</td>
                  <td className="num">{amount(c.difference)}</td>
                </tr>
              </tbody>
            </table>
            {c.warnings.length > 0 && (
              <div className="notice" style={{ marginTop: 12 }}>
                {c.warnings.join(". ")}.
              </div>
            )}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

function ReopenDrawer({ period, onClose, onDone }: { period: Period; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSubmit(onDone);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/books/close/reopen", { method: "POST", body: JSON.stringify({ periodId: period.id, reason: reason.trim() }) });
      return `${period.name} reopened`;
    });
  }
  return (
    <Drawer title={`Reopen ${period.name}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Reopen" formId="reopen-form" />}>
      <FormError message={error} />
      <form id="reopen-form" onSubmit={submit}>
        <Field label="Reason" required hint="Recorded in the audit log.">
          <textarea className="input" required minLength={3} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Late supplier invoice for January" />
        </Field>
      </form>
    </Drawer>
  );
}

type Rate = { id: string; currency: string; rate: string; rateDate: string; source: string | null };

export function Currencies() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const company = useCompany();
  const rates = useResource<Rate[]>("/api/v1/books/fx/rates");
  const [adding, setAdding] = useState(false);

  const latest = useMemo(() => {
    const seen = new Map<string, Rate>();
    for (const r of rates.data ?? []) if (!seen.has(r.currency)) seen.set(r.currency, r);
    return [...seen.values()];
  }, [rates.data]);

  async function revalue(code: string) {
    const ok = await confirm({
      title: `Revalue ${code} balances?`,
      body: "Accounts held in this currency are restated at the latest rate, and the gain or loss is posted to the ledger.",
      confirmLabel: "Revalue",
    });
    if (!ok) return;
    try {
      const res = await api<{ gainLoss?: string | number }>("/api/v1/books/fx/revalue", { method: "POST", body: JSON.stringify({ currency: code }) });
      const gl = Number(res.gainLoss ?? 0);
      toast(gl === 0 ? `No ${code} balances needed revaluing` : `${code} revalued: ${gl > 0 ? "gain" : "loss"} of ${amount(Math.abs(gl))} ${company.currency}`);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Currencies"
        description={`Exchange rates against ${company.currency}. Revaluation restates accounts held in a foreign currency.`}
        actions={
          can("fx:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              Add rate
            </button>
          )
        }
      />
      <Loadable resource={rates}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No exchange rates" body="Add a closing rate for each foreign currency you hold." />
            </div>
          ) : (
            <>
              <div className="table-wrap" style={{ marginBottom: 16 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th className="num">Latest rate</th>
                      <th>Rate date</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((r) => (
                      <tr key={r.currency}>
                        <td>{r.currency}</td>
                        <td className="num">{amount(Number(r.rate), 4)}</td>
                        <td>{date(r.rateDate)}</td>
                        <td className="num">
                          {can("fx:manage") && (
                            <button type="button" className="btn" onClick={() => void revalue(r.currency)}>
                              Revalue
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className="section-title" style={{ marginBottom: 8 }}>
                Rate history
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Currency</th>
                      <th className="num">Rate</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{date(r.rateDate)}</td>
                        <td>{r.currency}</td>
                        <td className="num">{amount(Number(r.rate), 4)}</td>
                        <td>{r.source ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </Loadable>
      {adding && (
        <RateForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            rates.reload();
          }}
        />
      )}
    </>
  );
}

function RateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency: functional } = useCompany();
  const [form, setForm] = useState({ currency: "USD", rateDate: new Date().toISOString().slice(0, 10), rate: "", source: "BNR" });
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const rate = parseAmount(form.rate);
    if (!/^[A-Z]{3}$/.test(form.currency)) return setError("Use a three-letter currency code such as USD.");
    if (form.currency === functional) return setError(`${functional} is the reporting currency and has no rate.`);
    if (!(rate > 0)) return setError("Enter a rate above zero.");
    void run(async () => {
      await api("/api/v1/books/fx/rates", { method: "POST", body: JSON.stringify({ ...form, rate }) });
      return `${form.currency} rate saved`;
    });
  }
  return (
    <Drawer title="Add exchange rate" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save rate" formId="rate-form" />}>
      <FormError message={error} />
      <form id="rate-form" onSubmit={submit} className="form-grid">
        <Field label="Currency" required>
          <input className="input" required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Rate date" required>
          <input className="input" type="date" required value={form.rateDate} onChange={(e) => setForm({ ...form, rateDate: e.target.value })} />
        </Field>
        <Field label={`1 ${form.currency || "unit"} in ${functional}`} required>
          <MoneyInput value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} required />
        </Field>
        <Field label="Source">
          <input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </Field>
      </form>
    </Drawer>
  );
}

type Control = { id: string; code: string; title: string; category: string; status: string; notes: string | null };
type Approval = { id: string; entityType: string; entityId: string; amount: string; status: string; reason: string | null; requestedByErpUserId: number | null; createdAt: string };

const CONTROL_TONE: Record<string, Tone> = { EFFECTIVE: "positive", DEFICIENT: "negative", OPEN: "warning" };

export function Controls() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const controls = useResource<ControlWithTests[]>("/api/v1/books/controls");
  const approvals = useResource<Approval[]>("/api/v1/books/approvals");
  const [editing, setEditing] = useState<Control | "new" | null>(null);
  const [testing, setTesting] = useState<ControlWithTests | null>(null);

  async function decide(a: Approval, status: "APPROVED" | "REJECTED") {
    try {
      await api(`/api/v1/books/approvals/${a.id}/decide`, { method: "POST", body: JSON.stringify({ status }) });
      toast(status === "APPROVED" ? "Approved" : "Rejected");
      approvals.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Controls and approvals"
        description="Keep a register of risks and the internal controls that address them, record control tests with evidence, and decide pending approvals. The person who asked for an approval cannot give it."
        actions={
          can("control:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" />
              Add control
            </button>
          )
        }
      />
      <RiskRegister controls={controls.data ?? []} />
      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Control register
      </h2>
      <Loadable resource={controls}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel" style={{ marginBottom: 20 }}>
              <EmptyState title="No controls recorded" body="Record checks such as segregation of duties or monthly bank reconciliation, and rate how well they work." />
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Control</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th>Last tested</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.code}</td>
                      <td>
                        {c.title}
                        {c.notes && <span className="sub">{c.notes}</span>}
                      </td>
                      <td>{c.category}</td>
                      <td>
                        <Badge tone={CONTROL_TONE[c.status] ?? "neutral"}>{humanize(c.status)}</Badge>
                        {c.riskCount > 0 && <span className="sub">{c.riskCount === 1 ? "1 risk" : `${c.riskCount} risks`}</span>}
                      </td>
                      <td className="nowrap">
                        {c.lastTest ? (
                          <>
                            {date(c.lastTest.testedAt)}
                            <span className="sub">{c.lastTest.result === "PASS" ? "Passed" : "Failed"}</span>
                          </>
                        ) : (
                          <span className="muted">Never</span>
                        )}
                      </td>
                      <td className="num nowrap">
                        <button type="button" className="btn" onClick={() => setTesting(c)}>
                          Tests
                        </button>{" "}
                        {can("control:manage") && (
                          <button type="button" className="btn" onClick={() => setEditing(c)}>
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
      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Approvals
      </h2>
      <Loadable resource={approvals}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="Nothing waiting for approval" />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Item</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">
                        {dateTime(a.createdAt)}
                        {a.requestedByErpUserId && <span className="sub">User #{a.requestedByErpUserId}</span>}
                      </td>
                      <td>
                        {humanize(a.entityType)} {a.entityId}
                        {a.reason && <span className="sub">{a.reason}</span>}
                      </td>
                      <td className="num">{amount(Number(a.amount))}</td>
                      <td>
                        <Badge tone={a.status === "APPROVED" ? "positive" : a.status === "REJECTED" ? "negative" : "warning"}>{humanize(a.status)}</Badge>
                      </td>
                      <td className="num nowrap">
                        {a.status === "PENDING" && can("control:manage") && (
                          <>
                            <button type="button" className="btn" onClick={() => void decide(a, "APPROVED")}>
                              Approve
                            </button>{" "}
                            <button type="button" className="btn" onClick={() => void decide(a, "REJECTED")}>
                              Reject
                            </button>
                          </>
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
      {testing && <ControlTestsDrawer control={testing} onClose={() => setTesting(null)} onChanged={() => controls.reload()} />}
      {editing && (
        <ControlForm
          control={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            controls.reload();
          }}
        />
      )}
    </>
  );
}

function ControlForm({ control, onClose, onSaved }: { control?: Control; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({
    code: control?.code ?? "",
    title: control?.title ?? "",
    category: control?.category ?? "",
    status: control?.status ?? "OPEN",
    notes: control?.notes ?? "",
  });
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/books/controls", {
        method: "POST",
        body: JSON.stringify({ ...form, code: form.code.trim(), title: form.title.trim(), category: form.category.trim(), notes: form.notes.trim() || undefined }),
      });
      return "Control saved";
    });
  }
  return (
    <Drawer title={control ? `Update ${control.code}` : "Add control"} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="control-form" />}>
      <FormError message={error} />
      <form id="control-form" onSubmit={submit} className="form-grid">
        <Field label="Code" required>
          <input className="input" required disabled={!!control} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BANK-01" />
        </Field>
        <Field label="Area" required>
          <input className="input" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Banking" />
        </Field>
        <Field label="Control" required className="span-2">
          <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Bank accounts are reconciled every month" />
        </Field>
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
            options={[
              { value: "OPEN", label: "Not yet tested" },
              { value: "EFFECTIVE", label: "Effective" },
              { value: "DEFICIENT", label: "Deficient" },
            ]}
          />
        </Field>
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </form>
    </Drawer>
  );
}

type Notice = { id: string; title: string; body: string; severity: string; readAt: string | null; createdAt: string };
type Group = { id: string; name: string; members: { id: string; name: string; ownershipPercent: string }[] };
type Consolidated = { rows: { code: string; name: string; debit: number; credit: number }[]; totals: { debit: number; credit: number; difference: number } };

export function Platform() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const notes = useResource<Notice[]>("/api/v1/books/notifications");
  const groups = useResource<Group[]>("/api/v1/books/groups");
  const [consolidated, setConsolidated] = useState<{ group: Group; data: Consolidated } | null>(null);

  async function act<T>(fn: () => Promise<T>, onOk: (v: T) => void) {
    try {
      onOk(await fn());
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader title="Insights and integrations" description="Ask questions of the posted books, track key indicators, forecast, and manage alerts, groups, API keys and webhooks." />

      <AssistantPanel />
      <KpiPanel />
      <ForecastPanel />
      <EmailSettingsPanel />

      <div className="panel panel-body" style={{ marginBottom: 16 }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Alerts
        </h2>
        <Loadable resource={notes}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No alerts.</p>
            ) : (
              <table className="table">
                <tbody>
                  {rows.map((n) => (
                    <tr key={n.id} className={n.readAt ? "row-inactive" : undefined}>
                      <td className="nowrap">{dateTime(n.createdAt)}</td>
                      <td>
                        <strong>{n.title}</strong>
                        <span className="sub">{n.body}</span>
                      </td>
                      <td className="num">
                        {!n.readAt && (
                          <button type="button" className="btn" onClick={() => void act(() => api(`/api/v1/books/notifications/${n.id}/read`, { method: "POST", body: "{}" }), () => notes.reload())}>
                            Mark read
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loadable>
      </div>

      <div className="panel panel-body" style={{ marginBottom: 16 }}>
        <div className="filter-bar">
          <h2 className="section-title grow">Company groups</h2>
          {can("platform:manage") && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void act(
                  () => api("/api/v1/books/groups", { method: "POST", body: JSON.stringify({ name: "Group", members: [{ name: "This company", ownershipPercent: 100 }] }) }),
                  () => groups.reload(),
                )
              }
            >
              <Plus size={16} aria-hidden="true" />
              New group
            </button>
          )}
        </div>
        <Loadable resource={groups}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No groups. A group combines the books of related companies by ownership share.</p>
            ) : (
              <table className="table">
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id}>
                      <td>
                        {g.name}
                        <span className="sub">{g.members.map((m) => `${m.name} (${amount(Number(m.ownershipPercent))}%)`).join(", ")}</span>
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void act(() => api<Consolidated>(`/api/v1/books/groups/${g.id}/consolidate`), (data) => setConsolidated({ group: g, data }))}
                        >
                          Consolidated trial balance
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loadable>
      </div>

      {can("platform:manage") && (
        <>
          <ApiKeysPanel />
          <WebhooksPanel />
        </>
      )}

      {consolidated && (
        <Drawer title={`${consolidated.group.name}: consolidated trial balance`} subtitle={`Amounts in ${currency}`} wide onClose={() => setConsolidated(null)}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {consolidated.data.rows.map((r) => (
                <Fragment key={r.code}>
                  <tr>
                    <td className="mono muted">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.debit ? amount(r.debit) : ""}</td>
                    <td className="num">{r.credit ? amount(r.credit) : ""}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Total</td>
                <td className="num">{amount(consolidated.data.totals.debit)}</td>
                <td className="num">{amount(consolidated.data.totals.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </Drawer>
      )}
    </>
  );
}

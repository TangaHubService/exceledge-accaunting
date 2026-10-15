import { Play, Plus, Radar } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader, type Tone } from "../components/ui";
import { amount, dateTime, humanize, plural } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";

const TABS = [
  { key: "anomalies", label: "Unusual entries" },
  { key: "workflows", label: "Workflows" },
  { key: "automation", label: "Scheduled jobs" },
  { key: "records", label: "Documents and sign-off" },
  { key: "esg", label: "Sustainability" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function useAct() {
  const { toast } = useFeedback();
  return async function act<T>(fn: () => Promise<T>, onOk: (v: T) => void) {
    try {
      onOk(await fn());
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };
}

export function Assurance() {
  const { query } = useLocation();
  const tab = (TABS.find((t) => t.key === query.get("tab"))?.key ?? "anomalies") as TabKey;
  return (
    <>
      <PageHeader title="Assurance and automation" description="Review unusual entries, run approval workflows and scheduled jobs, keep supporting documents and sign-offs, and track sustainability measures." />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "on" : ""}`} onClick={() => setQueryParam("tab", t.key === "anomalies" ? null : t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "anomalies" && <Anomalies />}
      {tab === "workflows" && <Workflows />}
      {tab === "automation" && <Automation />}
      {tab === "records" && <Records />}
      {tab === "esg" && <Esg />}
    </>
  );
}

type AnomalyNote = { id: string; erpUserId: number; note: string; createdAt: string };
type Anomaly = {
  id: string;
  rule: string;
  entityType: string;
  entityId: string | null;
  journalId: string | null;
  score: string | number;
  reason: string;
  status: "OPEN" | "INVESTIGATING" | "CONFIRMED" | "DISMISSED";
  resolution: string | null;
  decidedByErpUserId: number | null;
  decidedAt: string | null;
  createdAt: string;
  notes: AnomalyNote[];
};

const RULE_LABEL: Record<string, string> = {
  AMOUNT_OUTLIER: "Unusual amount",
  ROUND_AMOUNT: "Round amount",
  OUTSIDE_HOURS: "Outside working hours",
  DUPLICATE_BILL: "Possible duplicate bill",
  DUPLICATE_PAYMENT: "Possible duplicate payment",
};
const ANOMALY_TONE: Record<Anomaly["status"], Tone> = { OPEN: "warning", INVESTIGATING: "info", CONFIRMED: "negative", DISMISSED: "neutral" };
const ANOMALY_FILTERS = [
  { value: "ACTIVE", label: "Open and investigating" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "DISMISSED", label: "Dismissed" },
  { value: "ALL", label: "All" },
];

function recordLink(a: Anomaly) {
  if (a.entityType === "ApBill") return "/bills";
  if (a.entityType === "ApPayment") return "/supplier-payments";
  return a.journalId ? `/journals?id=${encodeURIComponent(a.journalId)}` : null;
}

function Anomalies() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const act = useAct();
  const allowed = can("control:view");
  const [filter, setFilter] = useState("ACTIVE");
  const list = useResource<Anomaly[]>(allowed ? `/api/v1/books/anomalies${filter === "CONFIRMED" || filter === "DISMISSED" ? `?status=${filter}` : ""}` : null);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<Anomaly | null>(null);

  if (!allowed) return <NoAccess />;

  async function scan() {
    setScanning(true);
    await act(
      () => api<Anomaly[]>("/api/v1/books/anomalies/scan", { method: "POST", body: "{}" }),
      (flags) => {
        toast(flags.length ? `${plural(flags.length, "new item")} to review` : "Nothing new found");
        list.reload();
      },
    );
    setScanning(false);
  }

  return (
    <>
      <div className="filter-bar">
        <p className="muted grow" style={{ margin: 0 }}>
          A scan checks the last 90 days for manual journals with unusual or round amounts or entered outside working hours, and supplier bills or payments that look entered twice. Each item is flagged once.
        </p>
        <Select value={filter} onChange={setFilter} options={ANOMALY_FILTERS} style={{ minWidth: 200 }} aria-label="Show" />
        {can("control:manage") && (
          <button type="button" className="btn btn-primary" disabled={scanning} onClick={() => void scan()}>
            <Radar size={16} aria-hidden="true" />
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        )}
      </div>
      <Loadable resource={list}>
        {(rows) => {
          const visible = filter === "ACTIVE" ? rows.filter((r) => r.status === "OPEN" || r.status === "INVESTIGATING") : rows;
          return visible.length === 0 ? (
            <div className="panel">
              <EmptyState title="Nothing to review" body="Run a scan after posting to check for unusual entries." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Flagged</th>
                    <th>Check</th>
                    <th>Why</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr key={a.id} className={a.status === "DISMISSED" ? "row-inactive" : undefined}>
                      <td className="nowrap">{dateTime(a.createdAt)}</td>
                      <td className="nowrap">{RULE_LABEL[a.rule] ?? humanize(a.rule)}</td>
                      <td>
                        {a.reason}
                        {a.resolution && <span className="sub">Outcome: {a.resolution}</span>}
                      </td>
                      <td>
                        <Badge tone={ANOMALY_TONE[a.status]}>{humanize(a.status)}</Badge>
                        {a.notes.length > 0 && <span className="sub">{plural(a.notes.length, "note")}</span>}
                      </td>
                      <td className="num">
                        <button type="button" className="btn btn-sm" onClick={() => setOpen(a)}>
                          {a.status === "OPEN" || a.status === "INVESTIGATING" ? "Review" : "View"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loadable>
      {open && (
        <AnomalyCase
          flag={open}
          onClose={() => setOpen(null)}
          onChanged={(updated) => {
            list.reload();
            if (updated) setOpen(updated);
            else setOpen(null);
          }}
        />
      )}
    </>
  );
}

function AnomalyCase({ flag, onClose, onChanged }: { flag: Anomaly; onClose: () => void; onChanged: (updated: Anomaly | null) => void }) {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = flag.status === "OPEN" || flag.status === "INVESTIGATING";
  const manage = can("control:manage");
  const link = recordLink(flag);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const addNote = () =>
    run(async () => {
      const row = await api<AnomalyNote>(`/api/v1/books/anomalies/${flag.id}/notes`, { method: "POST", body: JSON.stringify({ note: note.trim() }) });
      setNote("");
      toast("Note added");
      onChanged({ ...flag, status: flag.status === "OPEN" ? "INVESTIGATING" : flag.status, notes: [...flag.notes, row] });
    });

  const resolve = (status: "CONFIRMED" | "DISMISSED") =>
    run(async () => {
      await api(`/api/v1/books/anomalies/${flag.id}/resolve`, { method: "POST", body: JSON.stringify({ status, reason: reason.trim() }) });
      toast(status === "CONFIRMED" ? "Marked as a real problem" : "Dismissed");
      onChanged(null);
    });

  return (
    <Drawer title={RULE_LABEL[flag.rule] ?? humanize(flag.rule)} subtitle={`Flagged ${dateTime(flag.createdAt)}`} onClose={onClose}>
      <FormError message={error} />
      <p>{flag.reason}</p>
      <p className="muted">
        Score {amount(Number(flag.score), 2)} · {humanize(flag.entityType)} <span className="mono">{flag.entityId ?? flag.journalId}</span>
        {link && (
          <>
            {" · "}
            <Link to={link}>Open record</Link>
          </>
        )}
      </p>
      {flag.resolution && (
        <div className="notice info" style={{ marginBottom: 12 }}>
          {humanize(flag.status)} {flag.decidedAt && dateTime(flag.decidedAt)}
          {flag.decidedByErpUserId && ` by user #${flag.decidedByErpUserId}`}: {flag.resolution}
        </div>
      )}
      <h3 className="section-title" style={{ margin: "16px 0 8px" }}>
        Case notes
      </h3>
      {flag.notes.length === 0 ? (
        <p className="muted">No notes yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
          {flag.notes.map((n) => (
            <li key={n.id} style={{ marginBottom: 8 }}>
              <span className="sub">
                {dateTime(n.createdAt)} · User #{n.erpUserId}
              </span>
              {n.note}
            </li>
          ))}
        </ul>
      )}
      {active && manage && (
        <>
          <Field label="Add a note" hint="Adding a note moves the item to investigating.">
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button type="button" className="btn" disabled={busy || note.trim().length < 3} onClick={() => void addNote()} style={{ marginBottom: 20 }}>
            Add note
          </button>
          <Field label="Outcome" required hint="Say what was found, or why it is not a problem.">
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="filter-bar">
            <button type="button" className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void resolve("CONFIRMED")}>
              Confirm problem
            </button>
            <button type="button" className="btn" disabled={busy || reason.trim().length < 3} onClick={() => void resolve("DISMISSED")}>
              Dismiss
            </button>
          </div>
        </>
      )}
    </Drawer>
  );
}

type StepLog = { id: string; stepIndex: number; stepName: string; erpUserId: number; erpRole: string | null; createdAt: string };
type Instance = { id: string; templateId: string; entityType: string; entityId: string; status: string; stepIndex: number; createdAt: string; steps: StepLog[] };
type Template = { id: string; name: string; stepsJson: string[]; isActive: boolean; createdAt: string; instances: Instance[] };

const INSTANCE_TONE: Record<string, Tone> = { IN_PROGRESS: "warning", COMPLETED: "positive" };

function Workflows() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const act = useAct();
  const list = useResource<Template[]>("/api/v1/books/workflows");
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState<Template | null>(null);
  const manage = can("platform:manage");

  return (
    <>
      <div className="filter-bar">
        <p className="muted grow" style={{ margin: 0 }}>
          A workflow is a list of sign-off steps for a record. Each step is completed by a different person than the one before.
        </p>
        {manage && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            New workflow
          </button>
        )}
      </div>
      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No workflows" body="Create one, such as Prepare → Review → Approve, then start it on a record." />
            </div>
          ) : (
            rows.map((t) => {
              const steps = Array.isArray(t.stepsJson) ? t.stepsJson : [];
              return (
                <div className="table-wrap" key={t.id} style={{ marginBottom: 16 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>
                          {t.name}
                          <span className="sub" style={{ fontWeight: 400 }}>
                            {steps.join(" → ")}
                          </span>
                        </th>
                        <th>Progress</th>
                        <th>Status</th>
                        <th className="num">
                          {manage && t.isActive && (
                            <button type="button" className="btn btn-sm" onClick={() => setStarting(t)}>
                              Start on a record
                            </button>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.instances.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="muted">
                            Not started on any record yet.
                          </td>
                        </tr>
                      ) : (
                        t.instances.map((i) => {
                          const done = i.status === "COMPLETED";
                          const last = i.steps.at(-1);
                          return (
                            <tr key={i.id}>
                              <td>
                                {humanize(i.entityType)} <span className="mono">{i.entityId}</span>
                                <span className="sub">Started {dateTime(i.createdAt)}</span>
                              </td>
                              <td>
                                {done ? "All steps complete" : `Waiting for: ${steps[i.stepIndex] ?? `Step ${i.stepIndex + 1}`}`}
                                {last && (
                                  <span className="sub">
                                    Last: {last.stepName} by user #{last.erpUserId}
                                    {last.erpRole ? ` (${humanize(last.erpRole)})` : ""}, {dateTime(last.createdAt)}
                                  </span>
                                )}
                              </td>
                              <td>
                                <Badge tone={INSTANCE_TONE[i.status] ?? "neutral"}>{humanize(i.status)}</Badge>
                              </td>
                              <td className="num">
                                {!done && manage && (
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() =>
                                      void act(
                                        () => api(`/api/v1/books/workflows/instances/${i.id}/advance`, { method: "POST", body: "{}" }),
                                        () => {
                                          toast(`${steps[i.stepIndex] ?? "Step"} completed`);
                                          list.reload();
                                        },
                                      )
                                    }
                                  >
                                    Complete step
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })
          )
        }
      </Loadable>
      {creating && (
        <WorkflowForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {starting && (
        <StartWorkflowForm
          template={starting}
          onClose={() => setStarting(null)}
          onSaved={() => {
            setStarting(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function WorkflowForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState("Prepare\nReview\nApprove");
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const list = steps
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return setError("Add at least one step.");
    void run(async () => {
      await api("/api/v1/books/workflows", { method: "POST", body: JSON.stringify({ name: name.trim(), steps: list }) });
      return "Workflow created";
    });
  }
  return (
    <Drawer title="New workflow" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Create" formId="workflow-form" />}>
      <FormError message={error} />
      <form id="workflow-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required className="span-2">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Month-end sign-off" />
        </Field>
        <Field label="Steps" required className="span-2" hint="One step per line, in order.">
          <textarea className="input" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

const RECORD_TYPES = ["Journal", "Expense", "ApBill", "ArInvoice", "Budget", "FixedAsset", "AccountingPeriod", "TaxFiling", "BankReconciliation"].map((v) => ({
  value: v,
  label: { ApBill: "Supplier bill", ArInvoice: "Customer invoice", FixedAsset: "Fixed asset", AccountingPeriod: "Accounting period", TaxFiling: "Tax filing", BankReconciliation: "Bank reconciliation" }[v] ?? v,
}));

function StartWorkflowForm({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [entityType, setEntityType] = useState("Journal");
  const [entityId, setEntityId] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/v1/books/workflows/${template.id}/start`, { method: "POST", body: JSON.stringify({ entityType, entityId: entityId.trim() }) });
      return `${template.name} started`;
    });
  }
  return (
    <Drawer title={`Start ${template.name}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Start" formId="start-workflow-form" />}>
      <FormError message={error} />
      <form id="start-workflow-form" onSubmit={submit} className="form-grid">
        <Field label="Record type" required>
          <Select value={entityType} onChange={setEntityType} options={RECORD_TYPES} />
        </Field>
        <Field label="Record ID" required hint="The ID shown on the record's page.">
          <input className="input mono" required value={entityId} onChange={(e) => setEntityId(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

type Job = { id: string; name: string; jobType: string; schedule: string; enabled: boolean; lastRunAt: string | null; lastStatus: string | null; createdAt: string };

const JOB_TYPES = [
  { value: "RECURRING_JOURNALS", label: "Run due recurring journals" },
  { value: "ANOMALY_SCAN", label: "Scan for unusual journals" },
  { value: "FX_REVALUE", label: "Revalue foreign currency balances" },
];

const SCHEDULE_PRESETS = [
  { value: "0 5 * * *", label: "Every day at 05:00 UTC" },
  { value: "0 5 * * 1", label: "Every Monday at 05:00 UTC" },
  { value: "0 5 1 * *", label: "First day of each month at 05:00 UTC" },
  { value: "0 20 28-31 * *", label: "Days 28–31 at 20:00 UTC (month end)" },
  { value: "", label: "Custom schedule" },
];

function describeSchedule(cron: string) {
  return SCHEDULE_PRESETS.find((p) => p.value && p.value === cron)?.label ?? `${cron} (UTC)`;
}

function Automation() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const act = useAct();
  const list = useResource<Job[]>("/api/v1/books/automation");
  const [creating, setCreating] = useState(false);
  const manage = can("platform:manage");

  async function runJob(j: Job) {
    const ok = await confirm({ title: `Run ${j.name} now?`, body: "The job runs immediately, in addition to its schedule.", confirmLabel: "Run now" });
    if (!ok) return;
    await act(
      () => api<{ status: string; detail: unknown }>(`/api/v1/books/automation/${j.id}/run`, { method: "POST", body: "{}" }),
      (res) => {
        const d = res.detail as { generated?: number; failed?: unknown[] } | unknown[] | null;
        const summary = Array.isArray(d)
          ? j.jobType === "ANOMALY_SCAN"
            ? `${plural(d.length, "journal")} flagged`
            : `${plural(d.length, "currency", "currencies")} revalued`
          : d && typeof d === "object" && "generated" in d
            ? `${plural(d.generated ?? 0, "journal")} created${d.failed?.length ? `, ${d.failed.length} failed` : ""}`
            : "Done";
        toast(`${j.name}: ${summary}`);
        list.reload();
      },
    );
    list.reload();
  }

  return (
    <>
      <div className="filter-bar">
        <p className="muted grow" style={{ margin: 0 }}>
          Jobs run on a schedule written as a five-field cron expression in UTC (minute hour day month weekday).
        </p>
        {manage && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            New job
          </button>
        )}
      </div>
      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No scheduled jobs" body="Schedule recurring journals, anomaly scans or currency revaluation to run on their own." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Schedule</th>
                    <th>Last run</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.id} className={j.enabled ? undefined : "row-inactive"}>
                      <td>
                        {j.name}
                        <span className="sub">{JOB_TYPES.find((t) => t.value === j.jobType)?.label ?? humanize(j.jobType)}</span>
                      </td>
                      <td>
                        {describeSchedule(j.schedule)}
                        <span className="sub mono">{j.schedule}</span>
                      </td>
                      <td className="nowrap">
                        {j.lastRunAt ? dateTime(j.lastRunAt) : <span className="muted">Never</span>}
                        {j.lastStatus && (
                          <span className="sub">
                            <Badge tone={j.lastStatus === "OK" ? "positive" : "negative"}>{j.lastStatus === "OK" ? "Succeeded" : humanize(j.lastStatus)}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {manage && j.enabled && (
                          <button type="button" className="btn btn-sm" onClick={() => void runJob(j)}>
                            <Play size={14} aria-hidden="true" />
                            Run now
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
      {creating && (
        <JobForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function JobForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [jobType, setJobType] = useState("RECURRING_JOURNALS");
  const [preset, setPreset] = useState(SCHEDULE_PRESETS[0].value);
  const [custom, setCustom] = useState("");
  const { busy, error, setError, run } = useSubmit(onSaved);
  const schedule = (preset || custom).trim().replace(/\s+/g, " ");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (schedule.split(" ").length !== 5) return setError("A schedule has five parts: minute hour day-of-month month day-of-week.");
    void run(async () => {
      await api("/api/v1/books/automation", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || (JOB_TYPES.find((t) => t.value === jobType)?.label ?? jobType), jobType, schedule }),
      });
      return "Job scheduled";
    });
  }
  return (
    <Drawer title="New scheduled job" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Schedule" formId="job-form" />}>
      <FormError message={error} />
      <form id="job-form" onSubmit={submit} className="form-grid">
        <Field label="What it does" required className="span-2">
          <Select value={jobType} onChange={setJobType} options={JOB_TYPES} />
        </Field>
        <Field label="Name" className="span-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={JOB_TYPES.find((t) => t.value === jobType)?.label} />
        </Field>
        <Field label="When" required className="span-2">
          <Select value={preset} onChange={setPreset} options={SCHEDULE_PRESETS} />
        </Field>
        {!preset && (
          <Field label="Cron schedule (UTC)" required className="span-2" hint="e.g. 30 6 * * 1-5 runs at 06:30 UTC on weekdays.">
            <input className="input mono" required value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0 5 * * *" />
          </Field>
        )}
      </form>
    </Drawer>
  );
}

type Signature = {
  id: string;
  statement: string;
  signedAt: string;
  signerErpUserId: number;
  signerErpRole: string | null;
  contentHash: string | null;
  approvalRequestId: string | null;
};
type Verification = { valid: boolean; signatureIntact: boolean | null; contentUnchanged: boolean | null; changedFields: string[]; reason: string };

type AccountingDocument = { id: string; entityType: string; entityId: string; fileName: string; note: string | null; contentText: string | null; createdByErpUserId: number | null; createdAt: string };

function Records() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const [entityType, setEntityType] = useState("Journal");
  const [entityId, setEntityId] = useState("");
  const [record, setRecord] = useState<{ entityType: string; entityId: string } | null>(null);
  const docs = useResource<AccountingDocument[]>(record ? `/api/v1/books/documents?${new URLSearchParams(record)}` : null);
  const [attaching, setAttaching] = useState(false);
  const [signing, setSigning] = useState(false);
  const signatures = useResource<Signature[]>(record && can("control:view") ? `/api/v1/books/signatures?${new URLSearchParams(record)}` : null);
  const [checks, setChecks] = useState<Record<string, Verification>>({});
  const manage = can("platform:manage");

  async function verify(id: string) {
    try {
      const result = await api<Verification>(`/api/v1/books/signatures/${id}/verify`);
      setChecks((c) => ({ ...c, [id]: result }));
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  function lookUp(e: FormEvent) {
    e.preventDefault();
    if (!entityId.trim()) return;
    setChecks({});
    setRecord({ entityType, entityId: entityId.trim() });
  }

  return (
    <>
      <form className="filter-bar" onSubmit={lookUp} style={{ alignItems: "flex-end" }}>
        <Field label="Record type">
          <Select value={entityType} onChange={setEntityType} options={RECORD_TYPES} style={{ minWidth: 190 }} />
        </Field>
        <Field label="Record ID">
          <input className="input mono" value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Paste the record's ID" style={{ width: 280 }} />
        </Field>
        <button type="submit" className="btn btn-primary">
          Open record
        </button>
      </form>

      {!record ? (
        <div className="panel">
          <EmptyState title="Choose a record" body="Attach supporting documents to any journal, bill or other record, and sign it off with a recorded statement." />
        </div>
      ) : (
        <div className="panel panel-body">
          <div className="filter-bar">
            <h2 className="section-title grow">
              {RECORD_TYPES.find((t) => t.value === record.entityType)?.label ?? record.entityType} <span className="mono muted">{record.entityId}</span>
            </h2>
            {manage && (
              <>
                <button type="button" className="btn" onClick={() => setSigning(true)}>
                  Sign off
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setAttaching(true)}>
                  <Plus size={16} aria-hidden="true" />
                  Attach document
                </button>
              </>
            )}
          </div>
          {signatures.data && signatures.data.length > 0 && (
            <table className="table" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Signed</th>
                  <th>Statement</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {signatures.data.map((sig) => {
                  const check = checks[sig.id];
                  return (
                    <tr key={sig.id}>
                      <td className="nowrap">
                        {dateTime(sig.signedAt)}
                        <span className="sub">
                          User #{sig.signerErpUserId}
                          {sig.signerErpRole && ` · ${humanize(sig.signerErpRole)}`}
                          {sig.approvalRequestId && " · on approval"}
                        </span>
                      </td>
                      <td>“{sig.statement}”</td>
                      <td>
                        {check ? (
                          <>
                            <Badge tone={check.valid ? "positive" : "negative"}>{check.valid ? "Unchanged" : "Does not match"}</Badge>
                            <span className="sub">{check.reason}</span>
                            {check.changedFields.length > 0 && <span className="sub">Changed: {check.changedFields.join(", ")}</span>}
                          </>
                        ) : sig.contentHash ? (
                          <button type="button" className="btn btn-sm" onClick={() => void verify(sig.id)}>
                            Verify
                          </button>
                        ) : (
                          <span className="muted">Signed before content checks</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Loadable resource={docs}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="muted">No documents attached to this record.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id}>
                        <td>
                          {d.fileName}
                          {d.note && <span className="sub">{d.note}</span>}
                          {d.contentText && <span className="sub" style={{ whiteSpace: "pre-wrap" }}>{d.contentText}</span>}
                        </td>
                        <td className="nowrap">
                          {dateTime(d.createdAt)}
                          {d.createdByErpUserId && <span className="sub">User #{d.createdByErpUserId}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Loadable>
        </div>
      )}

      {attaching && record && (
        <DocumentForm
          record={record}
          onClose={() => setAttaching(false)}
          onSaved={() => {
            setAttaching(false);
            docs.reload();
          }}
        />
      )}
      {signing && record && (
        <SignForm
          record={record}
          onClose={() => setSigning(false)}
          onSigned={() => {
            setSigning(false);
            signatures.reload();
          }}
        />
      )}
    </>
  );
}

function DocumentForm({ record, onClose, onSaved }: { record: { entityType: string; entityId: string }; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [contentText, setContentText] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/books/documents", {
        method: "POST",
        body: JSON.stringify({ ...record, fileName: fileName.trim(), note: note.trim() || undefined, contentText: contentText.trim() || undefined }),
      });
      return "Document attached";
    });
  }
  return (
    <Drawer title="Attach document" subtitle="Record the reference and, if useful, the text of the document." onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Attach" formId="document-form" />}>
      <FormError message={error} />
      <form id="document-form" onSubmit={submit} className="form-grid">
        <Field label="File name or reference" required className="span-2">
          <input className="input" required value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="INV-2026-0042.pdf" />
        </Field>
        <Field label="Note" className="span-2">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier invoice, original filed in cabinet B" />
        </Field>
        <Field label="Document text" className="span-2">
          <textarea className="input" rows={6} value={contentText} onChange={(e) => setContentText(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

function SignForm({
  record,
  onClose,
  onSigned,
}: {
  record: { entityType: string; entityId: string };
  onClose: () => void;
  onSigned: (s: { id: string; statement: string; signedAt: string }) => void;
}) {
  const { api } = useSession();
  const [statement, setStatement] = useState("I have reviewed this record and confirm it is complete and accurate.");
  const { busy, error, run } = useSubmit();
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const s = await api<{ id: string; statement: string; signedAt: string }>("/api/v1/books/signatures", { method: "POST", body: JSON.stringify({ ...record, statement: statement.trim() }) });
      onSigned(s);
      return "Signature recorded";
    });
  }
  return (
    <Drawer title="Sign off" subtitle="Your user, role and the time are recorded with the statement and a fingerprint of the record, so later changes can be detected." onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Sign" formId="sign-form" />}>
      <FormError message={error} />
      <form id="sign-form" onSubmit={submit}>
        <Field label="Statement" required>
          <textarea className="input" required minLength={3} rows={4} value={statement} onChange={(e) => setStatement(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

type EsgRow = { id: string; period: string; code: string; name: string; value: number; unit: string; intensity: number | null };

function Esg() {
  const { can } = useSession();
  const list = useResource<EsgRow[]>("/api/v1/books/esg");
  const [editing, setEditing] = useState<EsgRow | "new" | null>(null);
  const manage = can("platform:manage");
  return (
    <>
      <div className="filter-bar">
        <p className="muted grow" style={{ margin: 0 }}>
          Environmental and social measures per period. Intensity divides the value by revenue for comparison across periods.
        </p>
        {manage && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden="true" />
            Record measure
          </button>
        )}
      </div>
      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No measures recorded" body="Record figures such as electricity used, fuel burned or staff trained." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Measure</th>
                    <th className="num">Value</th>
                    <th className="num">Per unit of revenue</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.period}</td>
                      <td>
                        {r.name}
                        <span className="sub mono">{r.code}</span>
                      </td>
                      <td className="num">
                        {amount(r.value, r.value % 1 ? 2 : 0)} {r.unit}
                      </td>
                      <td className="num">{r.intensity == null ? "—" : amount(r.intensity, 4)}</td>
                      <td className="num">
                        {manage && (
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
        <EsgForm
          row={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function EsgForm({ row, onClose, onSaved }: { row?: EsgRow; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [f, setF] = useState({
    period: row?.period ?? new Date().toISOString().slice(0, 7),
    code: row?.code ?? "",
    name: row?.name ?? "",
    value: row ? String(row.value) : "",
    unit: row?.unit ?? "",
  });
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(f.value.replace(/,/g, ""));
    if (!Number.isFinite(value) || f.value.trim() === "") return setError("Enter a number for the value.");
    void run(async () => {
      await api("/api/v1/books/esg", { method: "POST", body: JSON.stringify({ period: f.period.trim(), code: f.code.trim().toUpperCase(), name: f.name.trim(), value, unit: f.unit.trim() }) });
      return "Measure saved";
    });
  }
  return (
    <Drawer title={row ? `Update ${row.name}` : "Record measure"} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="esg-form" />}>
      <FormError message={error} />
      <form id="esg-form" onSubmit={submit} className="form-grid">
        <Field label="Period" required hint="e.g. 2026-03 or 2026">
          <input className="input" required disabled={!!row} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} />
        </Field>
        <Field label="Code" required>
          <input className="input mono" required disabled={!!row} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="ELEC_KWH" />
        </Field>
        <Field label="Name" required className="span-2">
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Electricity used" />
        </Field>
        <Field label="Value" required>
          <input className="input num" required inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        </Field>
        <Field label="Unit" required>
          <input className="input" required value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="kWh" />
        </Field>
      </form>
    </Drawer>
  );
}

function NoAccess() {
  return (
    <div className="panel">
      <EmptyState title="Not available for your role" body="Ask an accountant or administrator for access to controls." />
    </div>
  );
}

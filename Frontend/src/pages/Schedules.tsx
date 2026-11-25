import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";

type Kind = "PREPAID" | "DEFERRED" | "ACCRUAL";
type Schedule = { id: string; kind: Kind; name: string; debitAccount: string; creditAccount: string; total: number; months: number; startDate: string; status: "ACTIVE" | "DONE" | "STOPPED"; lastError: string | null; posted: number; remaining: number; next: string | null; postings: Array<{ sequence: number }> };

const EXPENSES = ["EXPENSE", "COST_OF_SALES", "OTHER_EXPENSE"];
const KINDS: Record<Kind, { label: string; debit: string; debitTypes: string[]; credit: string; creditTypes: string[] }> = {
  PREPAID: { label: "Prepaid expense", debit: "Expense account", debitTypes: EXPENSES, credit: "Prepaid asset account", creditTypes: ["ASSET"] },
  ACCRUAL: { label: "Accrued expense", debit: "Expense account", debitTypes: EXPENSES, credit: "Accrued liability account", creditTypes: ["LIABILITY"] },
  DEFERRED: { label: "Deferred income", debit: "Deferred income account", debitTypes: ["LIABILITY"], credit: "Income account", creditTypes: ["INCOME", "OTHER_INCOME"] },
};
const PAGES = {
  expenses: { title: "Prepaid and accrued expenses", body: "Spread a cost over the months it covers. Record the payment to a prepaid account first; each month end moves one part to expense.", kinds: ["PREPAID", "ACCRUAL"] as Kind[] },
  income: { title: "Revenue recognition", body: "Earn income over the months it covers. Record the invoice to a deferred income account first; each month end moves one part to income.", kinds: ["DEFERRED"] as Kind[] },
};

export function Schedules({ view }: { view: keyof typeof PAGES }) {
  const page = PAGES[view];
  const { api, can } = useSession();
  const { toast, confirm } = useFeedback();
  const res = useResource<Schedule[]>("/api/v1/books/spread");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const manage = can("journal:post");

  async function stop(s: Schedule) {
    if (!(await confirm({ title: `Stop ${s.name}?`, body: `${amount(s.posted, 2)} already posted stays in the books. The remaining ${amount(s.remaining, 2)} won't be moved.`, confirmLabel: "Stop", danger: true }))) return;
    try {
      await api(`/api/v1/books/spread/${s.id}/stop`, { method: "POST", body: "{}" });
      toast(`${s.name} stopped`);
      res.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }
  async function run() {
    setBusy(true);
    try {
      const out = await api<{ posted: number; failed: number }>("/api/v1/books/spread/run", { method: "POST", body: "{}" });
      toast(out.failed ? `${out.posted} posted, ${out.failed} could not post` : out.posted ? `${out.posted} posted` : "Nothing is due yet", out.failed ? { error: true } : undefined);
      res.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={page.title}
        description={page.body}
        actions={manage ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void run()}>{busy ? "Posting…" : "Post what is due"}</button>
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> New schedule</button>
          </>
        ) : undefined}
      />
      <Loadable resource={res}>
        {(all) => {
          const rows = all.filter((s) => page.kinds.includes(s.kind));
          if (!rows.length) return <EmptyState title="No schedules yet" body="Due months are posted automatically every day." />;
          return (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>From / to</th><th className="num">Total</th><th className="num">Posted</th><th className="num">Left</th><th>Next</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}<span className="sub">{KINDS[s.kind].label}, {s.postings.length} of {s.months} months</span>{s.lastError && s.status === "ACTIVE" && <span className="sub text-negative">{s.lastError}</span>}</td>
                      <td>{s.creditAccount}<span className="sub">to {s.debitAccount}</span></td>
                      <td className="num">{amount(s.total, 2)}</td>
                      <td className="num">{amount(s.posted, 2)}</td>
                      <td className="num">{amount(s.remaining, 2)}</td>
                      <td className="nowrap">{s.next ? date(s.next) : ""}</td>
                      <td><Badge tone={s.status === "ACTIVE" ? "info" : s.status === "DONE" ? "positive" : "neutral"}>{s.status === "ACTIVE" ? "Active" : s.status === "DONE" ? "Finished" : "Stopped"}</Badge></td>
                      <td className="num">{manage && s.status === "ACTIVE" && <button type="button" className="btn btn-sm" onClick={() => void stop(s)}>Stop</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loadable>
      {adding && <ScheduleForm kinds={page.kinds} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); res.reload(); }} />}
    </>
  );
}

function ScheduleForm({ kinds, onClose, onSaved }: { kinds: Kind[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { accounts } = useCompany();
  const [f, setF] = useState({ kind: kinds[0], name: "", debitAccountId: "", creditAccountId: "", total: "", months: "12", startDate: isoDay() });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));
  const k = KINDS[f.kind];
  const of = (types: string[]) => accounts.filter((a) => a.isActive && !a.isCashAccount && types.includes(a.type));
  const each = useMemo(() => (Number(f.total) > 0 && Number(f.months) > 0 ? amount(Math.floor((Number(f.total) / Number(f.months)) * 100) / 100, 2) : ""), [f.total, f.months]);

  async function save() {
    if (!f.name.trim() || !f.debitAccountId || !f.creditAccountId) return setError("Fill in the name and both accounts");
    if (!(Number(f.total) > 0)) return setError("Enter the total amount");
    setBusy(true);
    try {
      await api("/api/v1/books/spread", { method: "POST", body: JSON.stringify({ ...f, total: Number(f.total), months: Number(f.months) }) });
      toast(`${f.name.trim()} saved`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const picker = (value: string, types: string[], onChange: (v: string) => void) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose</option>
      {of(types).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
    </select>
  );
  return (
    <Drawer title="New schedule" onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></>}>
      {error && <p className="text-negative" role="alert">{error}</p>}
      <div className="form-grid">
        {kinds.length > 1 && <Field label="Type" className="span-2"><select className="input" value={f.kind} onChange={(e) => set({ kind: e.target.value as Kind, debitAccountId: "", creditAccountId: "" })}>{kinds.map((x) => <option key={x} value={x}>{KINDS[x].label}</option>)}</select></Field>}
        <Field label="Name" required className="span-2"><input className="input" maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Insurance 2026" /></Field>
        <Field label={k.credit} required>{picker(f.creditAccountId, k.creditTypes, (v) => set({ creditAccountId: v }))}</Field>
        <Field label={k.debit} required>{picker(f.debitAccountId, k.debitTypes, (v) => set({ debitAccountId: v }))}</Field>
        <Field label="Total" required><input className="input" type="number" min="0" step="0.01" value={f.total} onChange={(e) => set({ total: e.target.value })} /></Field>
        <Field label="Months" required hint={each && `${each} each month`}><input className="input" type="number" min="1" max="120" value={f.months} onChange={(e) => set({ months: e.target.value })} /></Field>
        <Field label="First month" required hint="Each part posts on the last day of its month" className="span-2"><input className="input" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

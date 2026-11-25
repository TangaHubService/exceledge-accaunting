import { Plus } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { amount, dateTime } from "../lib/format";
import { useResource, useSession } from "../lib/session";

type Rule = { id: string; name: string; trigger: string; minAmount: number | null; action: "NOTIFY" | "EMAIL"; target: string; message: string | null; isActive: boolean; times: number; last: { status: string; detail: string | null; createdAt: string } | null };
type Data = { triggers: Array<{ value: string; label: string }>; rules: Rule[] };
type Form = { id?: string; name: string; trigger: string; minAmount: string; action: Rule["action"]; target: string; message: string; isActive: boolean };
const ROLES: Record<string, string> = { ADMIN: "Administrators", ACCOUNTANT: "Accountants", BRANCH_MANAGER: "Branch managers", SELLER: "Sellers" };

export function WorkflowRules() {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const res = useResource<Data>("/api/v1/workspace/rules");
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const open = (r?: Rule) => {
    setError("");
    setForm(r ? { ...r, minAmount: r.minAmount == null ? "" : String(r.minAmount), message: r.message ?? "" } : { name: "", trigger: res.data?.triggers[0]?.value ?? "", minAmount: "", action: "NOTIFY", target: "ADMIN", message: "", isActive: true });
  };
  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const body = { name: form.name, trigger: form.trigger, minAmount: form.minAmount === "" ? null : Number(form.minAmount), action: form.action, target: form.target, message: form.message || null, isActive: form.isActive };
      await api(`/api/v1/workspace/rules${form.id ? `/${form.id}` : ""}`, { method: form.id ? "PUT" : "POST", body: JSON.stringify(body) });
      toast(`${form.name.trim()} saved`);
      setForm(null);
      res.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(r: Rule) {
    if (!(await confirm({ title: `Delete ${r.name}?`, confirmLabel: "Delete", danger: true, body: "Messages it already sent are not affected." }))) return;
    try {
      await api(`/api/v1/workspace/rules/${r.id}`, { method: "DELETE" });
      toast(`${r.name} deleted`);
      res.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }
  return (
    <>
      <PageHeader title="Workflows" description="When something happens in the books, tell someone. Rules run within about a minute and never act on what happened before they were turned on." actions={<button type="button" className="btn btn-primary" disabled={!res.data} onClick={() => open()}><Plus size={16} aria-hidden="true" /> New rule</button>} />
      <Loadable resource={res}>
        {({ rules, triggers }) =>
          rules.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Rule</th><th>When</th><th>Tell</th><th className="num">Times</th><th>Last</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{triggers.find((t) => t.value === r.trigger)?.label}{r.minAmount != null && <span className="sub">of {amount(r.minAmount)} or more</span>}</td>
                      <td>{r.action === "EMAIL" ? r.target : ROLES[r.target] ?? r.target}</td>
                      <td className="num">{r.times}</td>
                      <td>{r.last ? dateTime(r.last.createdAt) : ""}{r.last?.status === "FAILED" && <span className="sub text-negative">{r.last.detail}</span>}</td>
                      <td><Badge tone={r.isActive ? "positive" : "neutral"}>{r.isActive ? "On" : "Off"}</Badge></td>
                      <td className="num nowrap"><button type="button" className="btn btn-sm" onClick={() => open(r)}>Edit</button> <button type="button" className="btn btn-sm" onClick={() => void remove(r)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No rules yet" body="For example: email the owner when an invoice over 5,000,000 is posted." />
          )
        }
      </Loadable>
      {form && res.data && (
        <Drawer title={form.id ? "Edit rule" : "New rule"} onClose={() => setForm(null)} footer={<><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></>}>
          {error && <p className="text-negative" role="alert">{error}</p>}
          <div className="form-grid">
            <Field label="Name" required className="span-2"><input className="input" maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="When"><select className="input" value={form.trigger} onChange={(e) => set({ trigger: e.target.value })}>{res.data.triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
            <Field label="Only from this amount" hint="In your company's currency. Reversed journals have no amount."><input className="input" type="number" min="0" value={form.minAmount} onChange={(e) => set({ minAmount: e.target.value })} placeholder="Any amount" /></Field>
            <Field label="Do this"><select className="input" value={form.action} onChange={(e) => set({ action: e.target.value as Rule["action"], target: e.target.value === "EMAIL" ? "" : "ADMIN" })}><option value="NOTIFY">Notify in the app</option><option value="EMAIL">Send an email</option></select></Field>
            <Field label={form.action === "EMAIL" ? "Email address" : "Who"} required>{form.action === "EMAIL" ? <input className="input" type="email" value={form.target} onChange={(e) => set({ target: e.target.value })} /> : <select className="input" value={form.target} onChange={(e) => set({ target: e.target.value })}>{Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
            <Field label="Message" className="span-2"><textarea className="input" rows={3} maxLength={1000} value={form.message} onChange={(e) => set({ message: e.target.value })} /></Field>
            <label className="span-2"><input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> On</label>
          </div>
        </Drawer>
      )}
    </>
  );
}

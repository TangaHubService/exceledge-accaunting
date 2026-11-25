import { Plus } from "lucide-react";
import { useState } from "react";
import type { CustomField, FieldEntity } from "../../components/CustomFieldsPanel";
import { useFeedback } from "../../components/feedback";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader } from "../../components/ui";
import { useResource, useSession } from "../../lib/session";

const ENTITIES: Record<FieldEntity, string> = { ArInvoice: "Invoices", ApBill: "Bills", Customer: "Customers", Supplier: "Suppliers", Expense: "Expenses", Project: "Projects" };
const TYPES: Record<CustomField["type"], string> = { TEXT: "Text", NUMBER: "Number", DATE: "Date", LIST: "List", YES_NO: "Yes or no" };
type Form = Omit<CustomField, "id" | "options"> & { id?: string; options: string };

export function CustomFields() {
  const { api, can } = useSession();
  const { toast } = useFeedback();
  const res = useResource<CustomField[]>("/api/v1/workspace/custom-fields");
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manage = can("setup:prepare");
  const open = (f?: CustomField) => {
    setError("");
    setForm(f ? { ...f, options: f.options.join("\n") } : { entityType: "ArInvoice", name: "", type: "TEXT", options: "", showOnForm: false, isActive: true });
  };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const { id, ...body } = form;
      const options = form.type === "LIST" ? [...new Set(form.options.split("\n").map((o) => o.trim()).filter(Boolean))] : [];
      await api(`/api/v1/workspace/custom-fields${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify({ entityType: body.entityType, name: body.name, type: body.type, options, showOnForm: body.showOnForm, isActive: body.isActive }) });
      toast(`${form.name.trim()} saved`);
      setForm(null);
      res.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="Custom fields" description="Your own fields on invoices, bills, customers, suppliers, expenses and projects." actions={manage ? <button type="button" className="btn btn-primary" onClick={() => open()}><Plus size={16} aria-hidden="true" /> Add field</button> : undefined} />
      <Loadable resource={res}>
        {(rows) =>
          rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Used on</th><th>Type</th><th>Printed</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>{f.name}{f.type === "LIST" && <span className="sub">{f.options.join(", ")}</span>}</td>
                      <td>{ENTITIES[f.entityType]}</td>
                      <td>{TYPES[f.type]}</td>
                      <td>{f.entityType === "ArInvoice" ? (f.showOnForm ? "Yes" : "No") : ""}</td>
                      <td><Badge tone={f.isActive ? "positive" : "neutral"}>{f.isActive ? "Active" : "Off"}</Badge></td>
                      <td className="num">{manage && <button type="button" className="btn btn-sm" onClick={() => open(f)}>Edit</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No custom fields yet" body="Fields you add appear on the record itself." />
          )
        }
      </Loadable>
      {form && (
        <Drawer title={form.id ? "Edit field" : "Add field"} onClose={() => setForm(null)} footer={<><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></>}>
          {error && <p className="text-negative" role="alert">{error}</p>}
          <div className="form-grid">
            <Field label="Name" required className="span-2"><input className="input" maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Used on"><select className="input" value={form.entityType} onChange={(e) => set({ entityType: e.target.value as FieldEntity })}>{Object.entries(ENTITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Type"><select className="input" value={form.type} onChange={(e) => set({ type: e.target.value as CustomField["type"] })}>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            {form.type === "LIST" && <Field label="Choices" required hint="One on each line" className="span-2"><textarea className="input" rows={5} value={form.options} onChange={(e) => set({ options: e.target.value })} /></Field>}
            {form.entityType === "ArInvoice" && <label className="span-2"><input type="checkbox" checked={form.showOnForm} onChange={(e) => set({ showOnForm: e.target.checked })} /> Print on the invoice</label>}
            <label className="span-2"><input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active</label>
          </div>
        </Drawer>
      )}
    </>
  );
}

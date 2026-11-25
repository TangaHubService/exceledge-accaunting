import type { AccountingCapability } from "@exceledge/accounting-domain-web";
import { useState } from "react";
import { useResource, useSession } from "../lib/session";
import { useFeedback } from "./feedback";
import { Field } from "./ui";

export type FieldEntity = "ArInvoice" | "ApBill" | "Customer" | "Supplier" | "Expense" | "Project";
export type CustomField = { id: string; entityType: FieldEntity; name: string; type: "TEXT" | "NUMBER" | "DATE" | "LIST" | "YES_NO"; options: string[]; showOnForm: boolean; isActive: boolean };

const CAPS: Record<FieldEntity, { view: AccountingCapability; edit: AccountingCapability }> = {
  ArInvoice: { view: "ar:view", edit: "ar:manage" },
  ApBill: { view: "ap:view", edit: "ap:manage" },
  Customer: { view: "ar:view", edit: "ar:manage" },
  Supplier: { view: "ap:view", edit: "ap:manage" },
  Expense: { view: "expense:view", edit: "expense:manage" },
  Project: { view: "project:view", edit: "project:manage" },
};

/** The company's own fields on one record. Shows nothing when none are set up. */
export function CustomFieldsPanel({ entityType, entityId }: { entityType: FieldEntity; entityId: string }) {
  const { api, can } = useSession();
  const { toast } = useFeedback();
  const res = useResource<Array<CustomField & { value: string }>>(can(CAPS[entityType].view) ? `/api/v1/workspace/custom-values/${entityType}/${entityId}` : null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const edit = can(CAPS[entityType].edit);
  if (!res.data?.length) return res.error ? <p className="muted">Couldn't load custom fields: {res.error}</p> : null;

  async function save() {
    setBusy(true);
    try {
      await api(`/api/v1/workspace/custom-values/${entityType}/${entityId}`, { method: "PUT", body: JSON.stringify(draft) });
      toast("Fields saved");
      setDraft({});
      res.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="form-section-title" style={{ marginTop: 22 }}>Custom fields</div>
      <div className="form-grid">
        {res.data.map((f) => {
          const value = draft[f.id] ?? f.value;
          const set = (v: string) => setDraft((d) => ({ ...d, [f.id]: v }));
          const choices = f.type === "YES_NO" ? ["Yes", "No"] : f.options;
          return (
            <Field key={f.id} label={f.name}>
              {f.type === "LIST" || f.type === "YES_NO" ? (
                <select className="input" disabled={!edit} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="" />
                  {(value && !choices.includes(value) ? [value, ...choices] : choices).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input className="input" disabled={!edit} type={f.type === "DATE" ? "date" : f.type === "NUMBER" ? "number" : "text"} step="any" maxLength={500} value={value} onChange={(e) => set(e.target.value)} />
              )}
            </Field>
          );
        })}
      </div>
      {Object.keys(draft).length > 0 && (
        <div className="filter-bar" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save fields"}</button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setDraft({})}>Cancel</button>
        </div>
      )}
    </>
  );
}

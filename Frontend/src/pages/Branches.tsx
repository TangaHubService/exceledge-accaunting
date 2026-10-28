import { Plus, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, useSubmit } from "../components/forms";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { date } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";

type Branch = { id: string; externalErpBranchId: string; name: string | null; code: string | null; isActive: boolean; postings: number; createdAt: string };

export function Branches() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const list = useResource<Branch[]>("/api/v1/setup/branches");
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const manage = can("setup:prepare");

  async function sync() {
    setSyncing(true);
    try {
      const r = await api<{ added: number; updated: number; deactivated: number; unchanged: number }>("/api/v1/setup/branches/sync", { method: "POST", body: "{}" });
      toast(`Branches synced: ${r.added} added, ${r.updated} updated, ${r.deactivated} deactivated`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setSyncing(false);
    }
  }

  async function toggle(b: Branch) {
    try {
      await api(`/api/v1/setup/branches/${b.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !b.isActive }) });
      toast(`${b.name ?? b.code ?? "Branch"} ${b.isActive ? "deactivated" : "reactivated"}`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Branches"
        description="Branches come from Excel Edge. Tag journal lines with a branch to report by branch; an inactive branch stays on past postings but can't be used on new ones."
        actions={
          manage && (
            <>
              <button type="button" className="btn" disabled={syncing} onClick={() => void sync()}>
                <RefreshCw size={16} aria-hidden="true" />
                {syncing ? "Syncing…" : "Sync from Excel Edge"}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus size={16} aria-hidden="true" />
                Add branch
              </button>
            </>
          )
        }
      />
      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No branches yet" body="Sync the branches of this organization from Excel Edge, or add one by its Excel Edge branch id." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Branch</th>
                    <th>Excel Edge id</th>
                    <th className="num">Ledger lines</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className={b.isActive ? undefined : "row-inactive"}>
                      <td className="mono">{b.code ?? "—"}</td>
                      <td>
                        {b.name ?? <span className="muted">Unnamed</span>}
                        <span className="sub">Added {date(b.createdAt)}</span>
                      </td>
                      <td className="mono muted">{b.externalErpBranchId}</td>
                      <td className="num">{b.postings ? <Link to="/dimensions?kind=BRANCH">{b.postings}</Link> : 0}</td>
                      <td>{b.isActive ? <Badge tone="positive">Active</Badge> : <Badge>Inactive</Badge>}</td>
                      <td className="num nowrap">
                        {manage && (
                          <>
                            <button type="button" className="btn btn-sm" onClick={() => setEditing(b)}>
                              Rename
                            </button>{" "}
                            <button type="button" className="btn btn-sm" onClick={() => void toggle(b)}>
                              {b.isActive ? "Deactivate" : "Reactivate"}
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
      {editing && (
        <BranchForm
          branch={editing === "new" ? undefined : editing}
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

function BranchForm({ branch, onClose, onSaved }: { branch?: Branch; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({ externalErpBranchId: branch?.externalErpBranchId ?? "", name: branch?.name ?? "", code: branch?.code ?? "" });
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const body = { name: form.name.trim(), code: form.code.trim() || null };
      if (branch) await api(`/api/v1/setup/branches/${branch.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/setup/branches", { method: "POST", body: JSON.stringify({ ...body, externalErpBranchId: form.externalErpBranchId.trim() }) });
      return "Branch saved";
    });
  }
  return (
    <Drawer title={branch ? "Rename branch" : "Add branch"} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="branch-form" />}>
      <FormError message={error} />
      <form id="branch-form" onSubmit={submit} className="form-grid">
        <Field label="Excel Edge branch id" required className="span-2" hint="The id of the branch in Excel Edge; sales and stock from that branch carry it.">
          <input className="input mono" required disabled={!!branch} value={form.externalErpBranchId} onChange={(e) => setForm({ ...form, externalErpBranchId: e.target.value })} />
        </Field>
        <Field label="Name" required>
          <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Code">
          <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
      </form>
    </Drawer>
  );
}

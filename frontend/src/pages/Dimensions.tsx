import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, humanize } from "../lib/format";
import { setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";

type Dimension = { id: string; kind: "COST_CENTRE" | "PROJECT"; code: string; name: string; isActive: boolean; createdAt: string };
type ReportRow = { key: string; name: string | null; income: number; expenses: number; profit: number; debit: number; credit: number };

const KINDS = [
  { value: "COST_CENTRE", label: "Cost centres" },
  { value: "PROJECT", label: "Projects" },
  { value: "BRANCH", label: "Branches" },
];

export function Dimensions() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const kind = KINDS.find((k) => k.value === query.get("kind"))?.value ?? "COST_CENTRE";
  const list = useResource<Dimension[]>("/api/v1/books/dimensions");
  const report = useResource<ReportRow[]>(`/api/v1/books/dimensions/report?kind=${kind}`);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Dimension | null>(null);
  const manage = can("budget:manage");

  async function toggle(d: Dimension) {
    try {
      await api(`/api/v1/books/dimensions/${d.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !d.isActive }) });
      toast(`${d.name} ${d.isActive ? "deactivated" : "reactivated"}`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const rows = (list.data ?? []).filter((d) => d.kind === kind);
  const totals = (report.data ?? []).reduce((t, r) => ({ income: t.income + r.income, expenses: t.expenses + r.expenses, profit: t.profit + r.profit }), { income: 0, expenses: 0, profit: 0 });

  return (
    <>
      <PageHeader
        title="Cost centres and projects"
        description="Tag journals with a cost centre or project to see profit by area of the business."
        actions={
          manage &&
          kind !== "BRANCH" && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              {kind === "PROJECT" ? "New project" : "New cost centre"}
            </button>
          )
        }
      />

      <div className="tabs" role="tablist">
        {KINDS.map((k) => (
          <button key={k.value} type="button" role="tab" aria-selected={kind === k.value} className={`tab ${kind === k.value ? "on" : ""}`} onClick={() => setQueryParam("kind", k.value === "COST_CENTRE" ? null : k.value)}>
            {k.label}
          </button>
        ))}
      </div>

      {kind !== "BRANCH" && (
        <>
          <h2 className="section-title" style={{ marginBottom: 8 }}>
            {kind === "PROJECT" ? "Projects" : "Cost centres"}
          </h2>
          <Loadable resource={list}>
            {() =>
              rows.length === 0 ? (
                <div className="panel" style={{ marginBottom: 20 }}>
                  <EmptyState title={kind === "PROJECT" ? "No projects yet" : "No cost centres yet"} body="Create one, then choose it on journal lines to report by it." />
                </div>
              ) : (
                <div className="table-wrap" style={{ marginBottom: 20 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>Code</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.id} className={d.isActive ? undefined : "row-inactive"}>
                          <td className="mono">{d.code}</td>
                          <td>{d.name}</td>
                          <td>
                            <Badge tone={d.isActive ? "positive" : "neutral"}>{d.isActive ? "Active" : "Inactive"}</Badge>
                          </td>
                          <td className="num nowrap">
                            {manage && (
                              <>
                                <button type="button" className="btn btn-sm" onClick={() => setRenaming(d)}>
                                  Rename
                                </button>{" "}
                                <button type="button" className="btn btn-sm" onClick={() => void toggle(d)}>
                                  {d.isActive ? "Deactivate" : "Reactivate"}
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
        </>
      )}

      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Profit by {kind === "PROJECT" ? "project" : kind === "BRANCH" ? "branch" : "cost centre"}
      </h2>
      <Loadable resource={report}>
        {(data) =>
          data.length === 0 ? (
            <div className="panel">
              <EmptyState title="Nothing posted yet" body="Posted journals tagged this way will be summarised here." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{humanize(kind)}</th>
                    <th className="num">Income ({currency})</th>
                    <th className="num">Expenses ({currency})</th>
                    <th className="num">Profit ({currency})</th>
                    <th className="num">Debits</th>
                    <th className="num">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.key}>
                      <td>
                        {r.name ?? r.key}
                        {r.name && r.name !== r.key && <span className="sub mono">{r.key}</span>}
                      </td>
                      <td className="num">{amount(r.income)}</td>
                      <td className="num">{amount(r.expenses)}</td>
                      <td className={`num ${r.profit < 0 ? "text-negative" : ""}`}>{amount(r.profit)}</td>
                      <td className="num muted">{amount(r.debit)}</td>
                      <td className="num muted">{amount(r.credit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{amount(totals.income)}</td>
                    <td className="num">{amount(totals.expenses)}</td>
                    <td className="num">{amount(totals.profit)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        }
      </Loadable>

      {creating && (
        <DimensionForm
          kind={kind as Dimension["kind"]}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {renaming && (
        <RenameForm
          dimension={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            list.reload();
            report.reload();
          }}
        />
      )}
    </>
  );
}

function DimensionForm({ kind: initialKind, onClose, onSaved }: { kind: Dimension["kind"]; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [kind, setKind] = useState<string>(initialKind);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/books/dimensions", { method: "POST", body: JSON.stringify({ kind, code: code.trim(), name: name.trim() }) });
      return `${name.trim()} created`;
    });
  }
  return (
    <Drawer title={kind === "PROJECT" ? "New project" : "New cost centre"} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Create" formId="dimension-form" />}>
      <FormError message={error} />
      <form id="dimension-form" onSubmit={submit} className="form-grid">
        <Field label="Type" required className="span-2">
          <Select value={kind} onChange={setKind} options={[{ value: "COST_CENTRE", label: "Cost centre" }, { value: "PROJECT", label: "Project" }]} />
        </Field>
        <Field label="Code" required hint="Used on journal lines and in imports.">
          <input className="input" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SALES" />
        </Field>
        <Field label="Name" required>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales department" />
        </Field>
      </form>
    </Drawer>
  );
}

function RenameForm({ dimension, onClose, onSaved }: { dimension: Dimension; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState(dimension.name);
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/v1/books/dimensions/${dimension.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
      return "Renamed";
    });
  }
  return (
    <Drawer title={`Rename ${dimension.code}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="rename-dimension-form" />}>
      <FormError message={error} />
      <form id="rename-dimension-form" onSubmit={submit}>
        <Field label="Name" required>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

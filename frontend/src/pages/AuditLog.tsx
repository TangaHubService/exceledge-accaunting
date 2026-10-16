import { Download } from "lucide-react";
import { type FormEvent, useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { entityHref } from "../lib/approvals";
import { dateTime, humanize, isoDay } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { AuditEvent } from "../lib/types";

function entityLabel(type: string) {
  return type.replace(/^Ar/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

type AuditRow = AuditEvent & { ipAddress?: string | null };

type Filters = { userId: string; entityType: string; entityId: string; action: string; from: string; to: string };

const EMPTY: Filters = { userId: "", entityType: "", entityId: "", action: "", from: "", to: "" };

function toQuery(filters: Filters, limit: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
  params.set("limit", String(limit));
  return params.toString();
}

export function AuditLog() {
  const { download } = useSession();
  const { toast } = useFeedback();
  const [limit, setLimit] = useState(50);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [exporting, setExporting] = useState(false);
  const [viewing, setViewing] = useState<AuditRow | null>(null);
  const qs = toQuery(applied, limit);
  const events = useResource<AuditRow[]>(`/api/v1/audit?${qs}`);
  const filtered = Object.values(applied).some((v) => v.trim());

  function apply(e: FormEvent) {
    e.preventDefault();
    setApplied(draft);
  }

  function clear() {
    setDraft(EMPTY);
    setApplied(EMPTY);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await download(`/api/v1/audit/export.csv?${qs}`, `audit-log-${isoDay()}.csv`);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<AuditRow>[] = [
    { key: "when", header: "When", className: "nowrap", sortValue: (e) => e.createdAt, render: (e) => dateTime(e.createdAt) },
    {
      key: "who",
      header: "User",
      render: (e) => (
        <>
          User #{e.erpUserId}
          {e.erpRole && <span className="sub">{humanize(e.erpRole)}</span>}
        </>
      ),
    },
    { key: "action", header: "Action", sortValue: (e) => e.action, render: (e) => humanize(e.action) },
    {
      key: "what",
      header: "Record",
      render: (e) => (
        <>
          {entityLabel(e.entityType)}
          {e.entityId && <span className="mono muted"> {e.entityId}</span>}
          {e.sectionKey && <span className="sub">{humanize(e.sectionKey)}</span>}
        </>
      ),
    },
  ];

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const viewingHref = viewing && entityHref(viewing.entityType, viewing.entityId);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who changed what in the books, most recent first."
        actions={
          <button type="button" className="btn" disabled={exporting} onClick={() => void exportCsv()}>
            <Download size={16} aria-hidden="true" />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
      />

      <form className="panel panel-body" style={{ marginBottom: 16 }} onSubmit={apply}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          <Field label="User ID">
            <input className="input" inputMode="numeric" value={draft.userId} onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 12" />
          </Field>
          <Field label="Record type">
            <input className="input" value={draft.entityType} onChange={set("entityType")} placeholder="e.g. Journal" />
          </Field>
          <Field label="Record ID">
            <input className="input" value={draft.entityId} onChange={set("entityId")} />
          </Field>
          <Field label="Action">
            <input className="input" value={draft.action} onChange={set("action")} placeholder="e.g. JOURNAL_POSTED" />
          </Field>
          <Field label="From">
            <input className="input" type="date" value={draft.from} onChange={set("from")} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={draft.to} onChange={set("to")} />
          </Field>
        </div>
        <div className="filter-bar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button type="submit" className="btn btn-primary">
            Apply filters
          </button>
          {filtered && (
            <button type="button" className="btn btn-quiet" onClick={clear}>
              Clear
            </button>
          )}
          <div className="grow" />
          <Select
            style={{ width: 180 }}
            value={String(limit)}
            onChange={(v) => setLimit(Number(v))}
            aria-label="Number of events"
            options={[50, 100, 200, 500].map((n) => ({ value: String(n), label: `Last ${n} events` }))}
          />
        </div>
      </form>

      <Loadable resource={events}>
        {(rows) => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            onRowClick={setViewing}
            empty={<EmptyState title={filtered ? "No events match these filters" : "No activity recorded yet"} />}
          />
        )}
      </Loadable>

      {viewing && (
        <Drawer title={`${humanize(viewing.action)} · ${entityLabel(viewing.entityType)}`} subtitle={`${dateTime(viewing.createdAt)} · User #${viewing.erpUserId}`} onClose={() => setViewing(null)} wide>
          {(viewing.entityId || viewingHref || viewing.ipAddress) && (
            <dl className="dl" style={{ marginBottom: 18 }}>
              {(viewing.entityId || viewingHref) && (
                <>
                  <dt>Record</dt>
                  <dd>
                    {viewingHref ? <Link to={viewingHref}>{viewing.entityId ?? entityLabel(viewing.entityType)}</Link> : <span className="mono">{viewing.entityId}</span>}
                  </dd>
                </>
              )}
              {viewing.ipAddress && (
                <>
                  <dt>IP address</dt>
                  <dd className="mono">{viewing.ipAddress}</dd>
                </>
              )}
            </dl>
          )}
          {viewing.beforeJson != null && (
            <>
              <div className="form-section-title">Before</div>
              <pre className="json">{JSON.stringify(viewing.beforeJson, null, 2)}</pre>
            </>
          )}
          {viewing.afterJson != null && (
            <>
              <div className="form-section-title" style={{ marginTop: 18 }}>After</div>
              <pre className="json">{JSON.stringify(viewing.afterJson, null, 2)}</pre>
            </>
          )}
          {viewing.beforeJson == null && viewing.afterJson == null && <p className="muted">No details were recorded for this event.</p>}
        </Drawer>
      )}
    </>
  );
}

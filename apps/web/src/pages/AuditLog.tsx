import { useMemo, useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { Select } from "../components/Select";
import { Drawer, EmptyState, Loadable, PageHeader } from "../components/ui";
import { dateTime, humanize } from "../lib/format";
import { useResource } from "../lib/session";
import type { AuditEvent } from "../lib/types";

function entityLabel(type: string) {
  return type.replace(/^Ar/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function AuditLog() {
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<AuditEvent | null>(null);
  const events = useResource<AuditEvent[]>(`/api/v1/audit?limit=${limit}`);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = events.data ?? [];
    if (!q) return all;
    return all.filter((e) => [e.action, e.entityType, e.sectionKey, e.erpRole, String(e.erpUserId)].some((v) => v?.toLowerCase().includes(q)));
  }, [events.data, search]);

  const columns: Column<AuditEvent>[] = [
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
          {e.sectionKey && <span className="sub">{humanize(e.sectionKey)}</span>}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Audit log" description="Who changed what in the books, most recent first." />

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Filter by action, record or role" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter audit log" />
        <div className="grow" />
        <Select
          style={{ width: 180 }}
          value={String(limit)}
          onChange={(v) => setLimit(Number(v))}
          aria-label="Number of events"
          options={[50, 100, 200].map((n) => ({ value: String(n), label: `Last ${n} events` }))}
        />
      </div>

      <Loadable resource={events}>
        {() => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            onRowClick={setViewing}
            empty={<EmptyState title={search ? "No events match" : "No activity recorded yet"} />}
          />
        )}
      </Loadable>

      {viewing && (
        <Drawer title={`${humanize(viewing.action)} · ${entityLabel(viewing.entityType)}`} subtitle={`${dateTime(viewing.createdAt)} · User #${viewing.erpUserId}`} onClose={() => setViewing(null)} wide>
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

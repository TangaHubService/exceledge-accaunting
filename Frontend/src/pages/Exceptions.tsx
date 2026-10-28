import { useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Badge, Drawer, EmptyState, Loadable, PageHeader, type Tone } from "../components/ui";
import { dateTime, humanize } from "../lib/format";
import { setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { PostingException } from "../lib/types";

const TONE: Record<PostingException["status"], Tone> = { OPEN: "negative", RETRYING: "warning", RESOLVED: "positive", DISMISSED: "neutral" };

function detail(ex: PostingException, key: string): string | undefined {
  const d = ex.detailsJson as Record<string, unknown> | null;
  const v = d?.[key];
  return typeof v === "string" ? v : undefined;
}

export function Exceptions() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const { query } = useLocation();
  const status = query.get("status") ?? "OPEN";
  const list = useResource<PostingException[]>(`/api/v1/exceptions${status === "ALL" ? "" : `?status=${status}`}`);
  const [viewing, setViewing] = useState<PostingException | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(ex: PostingException) {
    setRetrying(ex.id);
    try {
      await api(`/api/v1/exceptions/${ex.id}/retry`, { method: "POST", body: "{}" });
      toast("Posted to the ledger");
      setViewing(null);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setRetrying(null);
      list.reload();
    }
  }

  const columns: Column<PostingException>[] = [
    { key: "when", header: "Received", className: "nowrap", sortValue: (e) => e.createdAt, render: (e) => dateTime(e.createdAt) },
    {
      key: "what",
      header: "Transaction",
      render: (e) => {
        const type = detail(e, "eventType");
        const doc = detail(e, "sourceDocumentNumber");
        return type || doc ? `${humanize(type ?? "")} ${doc ?? ""}`.trim() : <span className="muted">ERP event</span>;
      },
    },
    { key: "reason", header: "Why it failed", render: (e) => e.reason },
    { key: "status", header: "Status", render: (e) => <Badge tone={TONE[e.status]}>{humanize(e.status)}</Badge> },
    ...(can("exceptions:retry")
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 90,
            render: (e: PostingException) =>
              e.status === "OPEN" && e.integrationEventId ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={retrying === e.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void retry(e);
                  }}
                >
                  {retrying === e.id ? "Retrying…" : "Retry"}
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  const filters: Array<[string, string]> = [
    ["OPEN", "Open"],
    ["RESOLVED", "Resolved"],
    ["ALL", "All"],
  ];

  return (
    <>
      <PageHeader
        title="Posting exceptions"
        description="Sales and purchases from Excel Edge that couldn't be posted to the books. Fix the cause — usually a missing account mapping or a closed period — then retry."
      />

      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="Filter by status">
          {filters.map(([key, label]) => (
            <button key={key} type="button" className={status === key ? "on" : ""} onClick={() => setQueryParam("status", key === "OPEN" ? null : key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Loadable resource={list}>
        {(rows) => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            onRowClick={setViewing}
            empty={
              status === "OPEN" ? (
                <EmptyState title="No open exceptions" body="Everything sent from Excel Edge has been posted to the books." />
              ) : (
                <EmptyState title="Nothing to show" />
              )
            }
          />
        )}
      </Loadable>

      {viewing && (
        <Drawer
          title="Posting exception"
          subtitle={dateTime(viewing.createdAt)}
          onClose={() => setViewing(null)}
          footer={
            can("exceptions:retry") && viewing.status === "OPEN" && viewing.integrationEventId ? (
              <button type="button" className="btn btn-primary" disabled={retrying === viewing.id} onClick={() => void retry(viewing)}>
                {retrying === viewing.id ? "Retrying…" : "Retry posting"}
              </button>
            ) : undefined
          }
        >
          <dl className="dl">
            <dt>Status</dt>
            <dd>
              <Badge tone={TONE[viewing.status]}>{humanize(viewing.status)}</Badge>
            </dd>
            <dt>Why it failed</dt>
            <dd>{viewing.reason}</dd>
            {viewing.resolvedAt && (
              <>
                <dt>Resolved</dt>
                <dd>{dateTime(viewing.resolvedAt)}</dd>
              </>
            )}
          </dl>
          {viewing.detailsJson != null && (
            <>
              <div className="form-section-title" style={{ marginTop: 22 }}>Technical details</div>
              <pre className="json">{JSON.stringify(viewing.detailsJson, null, 2)}</pre>
            </>
          )}
        </Drawer>
      )}
    </>
  );
}

import { useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { FormError } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Loadable, PageHeader } from "../components/ui";
import {
  APPROVAL_LABEL,
  APPROVAL_TONE,
  type ApprovalRequest,
  type ApprovalStatus,
  DECISION_LABEL,
  entityHref,
  entityTypeLabel,
  roleLabel,
} from "../lib/approvals";
import { useCompany } from "../lib/company";
import { amount, dateTime, daysBetween, plural } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";

function age(createdAt: string) {
  const days = daysBetween(createdAt);
  return days <= 0 ? "Today" : `${plural(days, "day")} ago`;
}

export function ApprovalProgress({ approval }: { approval: ApprovalRequest }) {
  const levels = Math.max(approval.requiredLevels, 1);
  return (
    <div>
      <div className="strong">
        {approval.approvedLevels} of {plural(levels, "level")} approved
      </div>
      {approval.status === "PENDING" && <span className="sub">Next: {roleLabel(approval.nextRole ?? approval.levelRoles[approval.approvedLevels])}</span>}
    </div>
  );
}

export function ApprovalHistory({ approval }: { approval: ApprovalRequest }) {
  const levels = Math.max(approval.requiredLevels, 1);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Level</th>
              <th>Approver role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: levels }, (_, i) => {
              const done = approval.decisions.find((d) => d.level === i + 1 && d.decision === "APPROVED");
              const current = approval.status === "PENDING" && i === approval.approvedLevels;
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{roleLabel(approval.levelRoles[i])}</td>
                  <td>
                    {done ? (
                      <>
                        <Badge tone="positive">Approved</Badge>
                        <span className="sub">
                          User #{done.erpUserId} · {dateTime(done.createdAt)}
                        </span>
                      </>
                    ) : current ? (
                      <Badge tone="warning">Waiting</Badge>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="form-section-title" style={{ marginTop: 18 }}>
        Decision history
      </div>
      {approval.decisions.length === 0 ? (
        <p className="muted">No decisions yet. Requested {dateTime(approval.createdAt)}.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {[...approval.decisions]
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{dateTime(d.createdAt)}</td>
                    <td>
                      <strong>{DECISION_LABEL[d.decision] ?? d.decision}</strong>
                      {d.decision !== "RESUBMITTED" && <span className="muted"> · level {d.level}</span>}
                      <span className="sub">
                        User #{d.erpUserId}
                        {d.erpRole ? ` · ${roleLabel(d.erpRole)}` : ""}
                      </span>
                      {d.note && <span className="sub">“{d.note}”</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ANY", label: "Any status" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "RETURNED", label: "Returned" },
];

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All records" },
  ...["Journal", "Expense", "ApBill", "Budget", "TaxAdjustment", "FixedAssetImpairment", "PeriodClose"].map((t) => ({ value: t, label: entityTypeLabel(t) })),
];

export function Approvals() {
  const { can } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const canSeeAll = can("control:view");
  const tab = canSeeAll && query.get("tab") === "all" ? "all" : "queue";
  const status = query.get("status") ?? "PENDING";
  const entityType = query.get("type") ?? "";
  const openId = query.get("id");

  const queue = useResource<ApprovalRequest[]>("/api/v1/books/approvals/queue");
  const params = new URLSearchParams();
  if (status !== "ANY") params.set("status", status);
  if (entityType) params.set("entityType", entityType);
  const qs = params.toString();
  const all = useResource<ApprovalRequest[]>(tab === "all" ? `/api/v1/books/approvals${qs ? `?${qs}` : ""}` : null);
  const queueIds = new Set((queue.data ?? []).map((a) => a.id));

  function reload() {
    queue.reload();
    all.reload();
  }

  const columns: Column<ApprovalRequest>[] = [
    {
      key: "item",
      header: "Item",
      render: (a) => (
        <>
          {a.summary || `${entityTypeLabel(a.entityType)} ${a.entityId}`}
          <span className="sub">
            {entityTypeLabel(a.entityType)}
            {a.reason ? ` · ${a.reason}` : ""}
          </span>
        </>
      ),
    },
    { key: "amount", header: `Amount (${currency})`, numeric: true, sortValue: (a) => Number(a.amount), render: (a) => amount(a.amount) },
    { key: "progress", header: "Progress", render: (a) => <ApprovalProgress approval={a} /> },
    {
      key: "requested",
      header: "Requested",
      className: "nowrap",
      sortValue: (a) => a.createdAt,
      render: (a) => (
        <>
          {age(a.createdAt)}
          <span className="sub">{a.requestedByErpUserId ? `User #${a.requestedByErpUserId}` : "System"}</span>
        </>
      ),
    },
    ...(tab === "all"
      ? [{ key: "status", header: "Status", render: (a: ApprovalRequest) => <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status] ?? a.status}</Badge> }]
      : []),
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "num nowrap",
      render: (a) => (
        <button
          type="button"
          className={`btn ${queueIds.has(a.id) ? "btn-primary" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setQueryParam("id", a.id);
          }}
        >
          {queueIds.has(a.id) ? "Review" : "View"}
        </button>
      ),
    },
  ];

  const resource = tab === "all" ? all : queue;

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Journals, expenses, bills and other items waiting for sign-off. The person who requested an approval cannot give it."
      />

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "queue"} className={`tab ${tab === "queue" ? "on" : ""}`} onClick={() => setQueryParam("tab", null)}>
          Waiting for me{queue.data?.length ? ` (${queue.data.length})` : ""}
        </button>
        {canSeeAll && (
          <button type="button" role="tab" aria-selected={tab === "all"} className={`tab ${tab === "all" ? "on" : ""}`} onClick={() => setQueryParam("tab", "all")}>
            All requests
          </button>
        )}
      </div>

      {tab === "all" && (
        <div className="filter-bar">
          <Select style={{ width: 200 }} value={status} onChange={(v) => setQueryParam("status", v === "PENDING" ? null : v)} options={STATUS_FILTERS} aria-label="Filter by status" />
          <Select style={{ width: 200 }} value={entityType} onChange={(v) => setQueryParam("type", v || null)} options={TYPE_FILTERS} aria-label="Filter by record type" />
        </div>
      )}

      <Loadable resource={resource}>
        {(rows) => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            onRowClick={(a) => setQueryParam("id", a.id)}
            initialSort={{ key: "requested", dir: "asc" }}
            empty={
              tab === "queue" ? (
                <EmptyState title="Nothing is waiting for you" body="Items you can approve will appear here as soon as they're submitted." />
              ) : (
                <EmptyState title="No approval requests match" body="Try a different status or record type." />
              )
            }
          />
        )}
      </Loadable>

      {openId && <ApprovalDrawer id={openId} canDecide={queueIds.has(openId)} onClose={() => setQueryParam("id", null)} onChanged={reload} />}
    </>
  );
}

function ApprovalDrawer({ id, canDecide, onClose, onChanged }: { id: string; canDecide: boolean; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const request = useResource<ApprovalRequest>(`/api/v1/books/approvals/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(status: Exclude<ApprovalStatus, "PENDING">) {
    setError("");
    if (status !== "APPROVED" && note.trim().length < 3) {
      setError(status === "REJECTED" ? "Add a note explaining why this is rejected." : "Add a note saying what needs to be corrected.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/books/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ status, note: note.trim() || undefined }) });
      toast(status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Returned for correction");
      setNote("");
      request.reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resubmit() {
    setError("");
    setBusy(true);
    try {
      await api(`/api/v1/books/approvals/${id}/resubmit`, { method: "POST", body: JSON.stringify({ note: note.trim() || undefined }) });
      toast("Resubmitted for approval");
      setNote("");
      request.reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const a = request.data;
  const pending = a?.status === "PENDING" && canDecide;
  const returned = a?.status === "RETURNED" && a.entityType !== "Journal";

  return (
    <Drawer
      title={a ? a.summary || entityTypeLabel(a.entityType) : "Approval request"}
      subtitle={a ? `${entityTypeLabel(a.entityType)} · requested ${dateTime(a.createdAt)}` : undefined}
      onClose={onClose}
      wide
      footer={
        pending ? (
          <>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void decide("REJECTED")}>
              Reject
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void decide("RETURNED")}>
              Return for correction
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide("APPROVED")}>
              {busy ? "Saving…" : "Approve"}
            </button>
          </>
        ) : returned ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resubmit()}>
            Resubmit
          </button>
        ) : undefined
      }
    >
      <Loadable resource={request}>
        {(a) => {
          const href = entityHref(a.entityType, a.entityId);
          return (
            <>
              <FormError message={error} />
              <dl className="dl">
                <dt>Status</dt>
                <dd>
                  <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status] ?? a.status}</Badge>
                </dd>
                <dt>Record</dt>
                <dd>
                  {href ? <Link to={href}>{a.summary || `${entityTypeLabel(a.entityType)} ${a.entityId}`}</Link> : a.summary || a.entityId}
                </dd>
                <dt>Amount</dt>
                <dd>
                  {currency} {amount(a.amount)}
                </dd>
                {a.reason && (
                  <>
                    <dt>Why approval is needed</dt>
                    <dd>{a.reason}</dd>
                  </>
                )}
                <dt>Requested by</dt>
                <dd>{a.requestedByErpUserId ? `User #${a.requestedByErpUserId}` : "System"}</dd>
                {a.decidedAt && (
                  <>
                    <dt>Decided</dt>
                    <dd>
                      {dateTime(a.decidedAt)}
                      {a.decidedByErpUserId ? ` · User #${a.decidedByErpUserId}` : ""}
                    </dd>
                  </>
                )}
              </dl>

              <div className="form-section-title" style={{ marginTop: 18 }}>
                Approval levels
              </div>
              <ApprovalHistory approval={a} />

              {a.status === "RETURNED" && a.entityType === "Journal" && (
                <div className="notice info" style={{ marginTop: 16 }}>
                  The journal is back in draft. The requester can edit it and submit it again from the journal.
                </div>
              )}

              {(pending || returned) && (
                <label className="field" style={{ marginTop: 18 }}>
                  <span className="field-label">Note</span>
                  <textarea
                    className="input"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={pending ? "Required when rejecting or returning for correction" : "Optional"}
                  />
                </label>
              )}
              {a.status === "PENDING" && !canDecide && <p className="muted" style={{ marginTop: 16 }}>This request is waiting on another approver.</p>}
            </>
          );
        }}
      </Loadable>
    </Drawer>
  );
}

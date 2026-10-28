import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Loadable, PageHeader, type Tone } from "../components/ui";
import { type ApprovalRequest, type ApprovalRequirement, APPROVAL_LABEL, APPROVAL_TONE, type JournalDetail } from "../lib/approvals";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, humanize, moduleLabel, plural, toNumber } from "../lib/format";
import { Link, navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Journal, JournalStatus } from "../lib/types";
import { ApprovalHistory, ApprovalProgress } from "./Approvals";

const STATUS_TONE: Partial<Record<JournalStatus, Tone>> = {
  DRAFT: "info",
  SUBMITTED: "warning",
  UNDER_REVIEW: "warning",
  APPROVED: "positive",
  POSTING_FAILED: "negative",
};

export const JOURNAL_STATUS_LABEL: Record<JournalStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  UNDER_REVIEW: "Partly approved",
  APPROVED: "Approved, ready to post",
  POSTED: "Posted",
  REVERSED: "Reversed",
  CANCELLED: "Cancelled",
  POSTING_FAILED: "Posting failed",
};

const OPEN_STATUSES: JournalStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED"];

export function JournalStatusBadge({ status, always }: { status: JournalStatus; always?: boolean }) {
  if (status === "POSTED" && !always) return null;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{JOURNAL_STATUS_LABEL[status] ?? humanize(status)}</Badge>;
}

function sourceLabel(j: Journal | JournalDetail) {
  if (j.journalType === "MANUAL") return "Manual entry";
  if (j.sourceDocumentType && j.sourceDocumentNumber) return `${moduleLabel(j.sourceModule)} · ${j.sourceDocumentNumber}`.replace(/^ · /, "");
  return humanize(j.journalType);
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  ...(Object.keys(JOURNAL_STATUS_LABEL) as JournalStatus[]).map((s) => ({ value: s, label: JOURNAL_STATUS_LABEL[s] })),
];

export function Journals() {
  const { can } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const status = query.get("status") ?? "";
  const openId = query.get("id");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (debounced) params.set("q", debounced);
  const qs = params.toString();
  const list = useResource<Journal[]>(`/api/v1/journals${qs ? `?${qs}` : ""}`);

  const columns: Column<Journal>[] = [
    { key: "date", header: "Date", className: "nowrap", sortValue: (j) => j.journalDate, render: (j) => date(j.journalDate) },
    { key: "number", header: "Entry", className: "nowrap", sortValue: (j) => j.journalNumber, render: (j) => <span className="mono">{j.journalNumber}</span> },
    {
      key: "description",
      header: "Description",
      render: (j) => (
        <>
          {j.description || <span className="muted">No description</span>}
          <span className="sub">
            {sourceLabel(j)}
            {j.referenceNumber && j.referenceNumber !== j.sourceDocumentNumber ? ` · Ref ${j.referenceNumber}` : ""}
          </span>
        </>
      ),
    },
    { key: "status", header: <span className="sr-only">Status</span>, width: 170, render: (j) => <JournalStatusBadge status={j.status} /> },
    { key: "amount", header: `Amount (${currency})`, numeric: true, sortValue: (j) => toNumber(j.totalDebit), render: (j) => amount(j.totalDebit) },
  ];

  return (
    <>
      <PageHeader
        title="Journal entries"
        description="Every entry in the books — from invoices, payments, Excel Edge sales and manual adjustments."
        actions={
          can("journal:create") && (
            <Link to="/journals/new" className="btn btn-primary">
              <Plus size={16} aria-hidden="true" />
              New journal entry
            </Link>
          )
        }
      />

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search number, description or reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search journal entries" />
        <Select style={{ width: 220 }} value={status} onChange={(v) => setQueryParam("status", v || null)} options={STATUS_FILTERS} aria-label="Filter by status" />
      </div>

      <Loadable resource={list}>
        {(rows) => (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(j) => j.id}
              onRowClick={(j) => setQueryParam("id", j.id)}
              empty={
                !status && !debounced ? (
                  <EmptyState title="No journal entries yet" body="Entries appear as invoices, payments and Excel Edge sales are posted, or when you record a manual journal." />
                ) : (
                  <EmptyState title="No entries match" body="Try a different search or status." />
                )
              }
            />
            {rows.length >= 50 && <p className="table-caption">Showing the 50 most recent entries. Search to find older ones.</p>}
          </>
        )}
      </Loadable>

      {openId && (
        <JournalDrawer
          id={openId}
          onClose={() => setQueryParam("id", null)}
          onChanged={() => list.reload()}
        />
      )}
    </>
  );
}

function lastNote(approval: ApprovalRequest, decision: "RETURNED" | "REJECTED") {
  return [...approval.decisions].filter((d) => d.decision === decision).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.note;
}

function JournalDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, can } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const journal = useResource<JournalDetail>(`/api/v1/journals/${id}`);
  const j = journal.data;
  const open = j ? OPEN_STATUSES.includes(j.status) : false;
  const requirement = useResource<ApprovalRequirement>(open ? `/api/v1/journals/${id}/approval-requirement` : null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    journal.reload();
    requirement.reload();
    onChanged();
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      toast(await action());
      refresh();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: "post" | "reverse", j: JournalDetail) {
    const ok = await confirm(
      kind === "post"
        ? { title: `Post ${j.journalNumber}?`, body: "Posting updates account balances. Posted entries can only be corrected by reversing them.", confirmLabel: "Post entry" }
        : {
            title: `Reverse ${j.journalNumber}?`,
            body: "A new entry with opposite amounts will be posted to cancel this one out. The original stays in the books for the audit trail.",
            confirmLabel: "Reverse entry",
            danger: true,
          },
    );
    if (!ok) return;
    await run(async () => {
      if (kind === "post") {
        const posted = await api<Journal & { budgetWarnings?: Array<{ account: string; period: string; over: number }> }>(`/api/v1/journals/${j.id}/post`, {
          method: "POST",
          body: "{}",
        });
        const warnings = posted.budgetWarnings ?? [];
        return warnings.length
          ? `${j.journalNumber} posted. Budget warning: ${warnings.map((w) => `${w.account} over by ${amount(w.over)} in ${w.period}`).join("; ")}`
          : `${j.journalNumber} posted`;
      }
      const result = await api<{ reversal: Journal }>(`/api/v1/journals/${j.id}/reverse`, { method: "POST", body: "{}" });
      return `${j.journalNumber} reversed by ${result.reversal.journalNumber}`;
    });
  }

  async function submit(j: JournalDetail) {
    await run(async () => {
      const result = await api<{ journal: Journal; approval: ApprovalRequest | null }>(`/api/v1/journals/${j.id}/submit`, { method: "POST", body: "{}" });
      return result.approval ? `${j.journalNumber} submitted for approval` : `${j.journalNumber} needs no approval and is ready to post`;
    });
  }

  async function cancel(j: JournalDetail) {
    const ok = await confirm({ title: `Cancel ${j.journalNumber}?`, body: "The draft will be kept for the record but can no longer be edited or posted.", confirmLabel: "Cancel draft", danger: true });
    if (!ok) return;
    await run(async () => {
      await api(`/api/v1/journals/${j.id}/cancel`, { method: "POST", body: "{}" });
      return `${j.journalNumber} cancelled`;
    });
  }

  const req = requirement.data;
  const isDraft = j?.status === "DRAFT";
  const canEdit = isDraft && can("journal:create");
  const canSubmit = canEdit && (!req || req.required || !can("journal:post"));
  const canPost = j && can("journal:post") && (j.status === "APPROVED" || (isDraft && req && !req.required));
  const canReverse = j && j.status === "POSTED" && !j.reversedJournalId && can("journal:reverse");
  const pendingApproval = j?.approval?.status === "PENDING" ? j.approval : null;
  const hasActions = canEdit || canPost || canReverse || pendingApproval;

  return (
    <Drawer
      title={j ? j.journalNumber : "Journal entry"}
      subtitle={j ? sourceLabel(j) : undefined}
      onClose={onClose}
      wide
      footer={
        hasActions && j ? (
          <>
            {canEdit && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void cancel(j)}>
                Cancel draft
              </button>
            )}
            {canEdit && (
              <Link to={`/journals/${j.id}/edit`} className="btn">
                Edit
              </Link>
            )}
            {canReverse && (
              <button type="button" className="btn" disabled={busy} onClick={() => void act("reverse", j)}>
                Reverse entry
              </button>
            )}
            {pendingApproval && (
              <Link to={`/approvals?id=${pendingApproval.id}`} className="btn">
                Open approval
              </Link>
            )}
            {canSubmit && (
              <button type="button" className={`btn ${canPost ? "" : "btn-primary"}`} disabled={busy} onClick={() => void submit(j)}>
                {j.approval?.status === "RETURNED" ? "Resubmit for approval" : "Submit for approval"}
              </button>
            )}
            {canPost && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act("post", j)}>
                Post entry
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <Loadable resource={journal}>
        {(j) => (
          <>
            {j.approval?.status === "RETURNED" && j.status === "DRAFT" && (
              <div className="notice info" style={{ marginBottom: 16 }}>
                <div className="grow">
                  <strong>Returned for correction.</strong> {lastNote(j.approval, "RETURNED") ?? "Edit the entry and submit it again."}
                </div>
              </div>
            )}
            {j.approval?.status === "REJECTED" && (
              <div className="notice error" style={{ marginBottom: 16 }}>
                <div className="grow">
                  <strong>Rejected.</strong> {lastNote(j.approval, "REJECTED") ?? ""}
                </div>
              </div>
            )}

            <dl className="dl">
              <dt>Status</dt>
              <dd>
                <JournalStatusBadge status={j.status} always />
              </dd>
              <dt>Journal date</dt>
              <dd>{date(j.journalDate)}</dd>
              {j.postingDate && (
                <>
                  <dt>Posted</dt>
                  <dd>
                    {dateTime(j.postingDate)}
                    {j.postedByErpUserId ? ` · User #${j.postedByErpUserId}` : ""}
                  </dd>
                </>
              )}
              {j.description && (
                <>
                  <dt>Description</dt>
                  <dd>{j.description}</dd>
                </>
              )}
              {j.referenceNumber && (
                <>
                  <dt>Reference</dt>
                  <dd>{j.referenceNumber}</dd>
                </>
              )}
              {j.createdByErpUserId && (
                <>
                  <dt>Prepared by</dt>
                  <dd>User #{j.createdByErpUserId}</dd>
                </>
              )}
              {j.approvedByErpUserId && (
                <>
                  <dt>Approved by</dt>
                  <dd>User #{j.approvedByErpUserId}</dd>
                </>
              )}
              {(j.reversedJournalId || j.reversesJournalId) && (
                <>
                  <dt>{j.reversesJournalId ? "Reverses" : "Reversed by"}</dt>
                  <dd>
                    <button type="button" className="link-button" onClick={() => navigate(`/journals?id=${j.reversesJournalId ?? j.reversedJournalId}`, { replace: true })}>
                      View entry
                    </button>
                  </dd>
                </>
              )}
            </dl>

            {open && req && (
              <div className={`notice ${req.required ? "" : "info"}`} style={{ marginTop: 16 }}>
                <div className="grow">
                  {req.required ? (
                    <>
                      <strong>Needs {plural(req.levels, "approval level")} before posting.</strong>
                      {req.reasons.length > 0 && (
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {req.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <strong>No approval needed for this entry.</strong>
                  )}
                  {req.requireDifferentPoster && <div className="small" style={{ marginTop: 4 }}>Someone other than the person who prepared it must post it.</div>}
                  {req.supportingDocumentRequired && <div className="small" style={{ marginTop: 4 }}>A supporting document must be attached before posting.</div>}
                </div>
              </div>
            )}

            {j.approval && (
              <>
                <div className="form-section-title" style={{ marginTop: 22 }}>
                  Approval{" "}
                  <Badge tone={APPROVAL_TONE[j.approval.status]}>{APPROVAL_LABEL[j.approval.status] ?? j.approval.status}</Badge>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <ApprovalProgress approval={j.approval} />
                </div>
                <ApprovalHistory approval={j.approval} />
              </>
            )}

            <div className="table-wrap" style={{ marginTop: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {j.lines.map((l) => {
                    const tags = [l.costCentre && `Cost centre ${l.costCentre}`, l.project && `Project ${l.project}`].filter(Boolean).join(" · ");
                    return (
                      <tr key={l.id}>
                        <td>
                          <Link to={`/ledger?account=${l.account.id}`} style={{ color: "inherit" }}>
                            <span className="mono muted">{l.account.code}</span> {l.account.name}
                          </Link>
                          {l.description && <span className="sub">{l.description}</span>}
                          {tags && <span className="sub">{tags}</span>}
                        </td>
                        <td className="num">{toNumber(l.debit) ? amount(l.debit) : ""}</td>
                        <td className="num">{toNumber(l.credit) ? amount(l.credit) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total ({currency})</td>
                    <td className="num">{amount(j.totalDebit)}</td>
                    <td className="num">{amount(j.totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <AttachmentsPanel
              entityType="Journal"
              entityId={j.id}
              title="Supporting documents"
              required={!!req?.supportingDocumentRequired}
              locked={j.status === "DRAFT" ? null : `the journal is ${JOURNAL_STATUS_LABEL[j.status].toLowerCase()}`}
            />
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

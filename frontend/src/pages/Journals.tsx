import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Badge, Drawer, EmptyState, Loadable, PageHeader, type Tone } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, humanize, moduleLabel, toNumber } from "../lib/format";
import { Link, navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Journal, JournalStatus } from "../lib/types";

const STATUS_TONE: Partial<Record<JournalStatus, Tone>> = {
  DRAFT: "info",
  SUBMITTED: "warning",
  UNDER_REVIEW: "warning",
  APPROVED: "info",
  POSTING_FAILED: "negative",
};

export function JournalStatusBadge({ status, always }: { status: JournalStatus; always?: boolean }) {
  if (status === "POSTED" && !always) return null;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

function sourceLabel(j: Journal) {
  if (j.journalType === "MANUAL") return "Manual entry";
  if (j.sourceDocumentType && j.sourceDocumentNumber) return `${moduleLabel(j.sourceModule)} · ${j.sourceDocumentNumber}`.replace(/^ · /, "");
  return humanize(j.journalType);
}

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
    { key: "status", header: <span className="sr-only">Status</span>, width: 120, render: (j) => <JournalStatusBadge status={j.status} /> },
    { key: "amount", header: `Amount (${currency})`, numeric: true, sortValue: (j) => toNumber(j.totalDebit), render: (j) => amount(j.totalDebit) },
  ];

  const filters: Array<[string, string]> = [
    ["", "All"],
    ["DRAFT", "Drafts"],
    ["POSTED", "Posted"],
    ["REVERSED", "Reversed"],
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
        <div className="segmented" role="group" aria-label="Filter by status">
          {filters.map(([key, label]) => (
            <button key={key} type="button" className={status === key ? "on" : ""} onClick={() => setQueryParam("status", key || null)}>
              {label}
            </button>
          ))}
        </div>
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

function JournalDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, can } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const journal = useResource<Journal>(`/api/v1/journals/${id}`);
  const [busy, setBusy] = useState(false);

  async function act(kind: "post" | "reverse", j: Journal) {
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
    setBusy(true);
    try {
      const result = await api<Journal>(`/api/v1/journals/${j.id}/${kind}`, { method: "POST", body: "{}" });
      toast(kind === "post" ? `${j.journalNumber} posted` : `${j.journalNumber} reversed by ${result.journalNumber}`);
      journal.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  const j = journal.data;
  const canPost = j && ["DRAFT", "APPROVED"].includes(j.status) && can("journal:post");
  const canReverse = j && j.status === "POSTED" && !j.reversedJournalId && can("journal:reverse");

  return (
    <Drawer
      title={j ? j.journalNumber : "Journal entry"}
      subtitle={j ? sourceLabel(j) : undefined}
      onClose={onClose}
      wide
      footer={
        (canPost || canReverse) && j ? (
          <>
            {canReverse && (
              <button type="button" className="btn" disabled={busy} onClick={() => void act("reverse", j)}>
                Reverse entry
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
                  <dd>{dateTime(j.postingDate)}</dd>
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
                  {j.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link to={`/ledger?account=${l.account.id}`} style={{ color: "inherit" }}>
                          <span className="mono muted">{l.account.code}</span> {l.account.name}
                        </Link>
                        {l.description && <span className="sub">{l.description}</span>}
                      </td>
                      <td className="num">{toNumber(l.debit) ? amount(l.debit) : ""}</td>
                      <td className="num">{toNumber(l.credit) ? amount(l.credit) : ""}</td>
                    </tr>
                  ))}
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
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

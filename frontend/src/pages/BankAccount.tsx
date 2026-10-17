import { Calculator, Check, FileUp, Pencil, Scale, Trash2 } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { CashCountForm, FinancialAccountForm, StartReconciliationForm, StatementImportForm, TransactionDrawer, useConfirmAction } from "../components/BankingForms";
import { Badge, EmptyState, Field, Figure, Loadable, Menu, PageHeader } from "../components/ui";
import { accountSubtitle, hasStatement, isCash } from "../lib/banking";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, isoDay, moduleLabel, plural } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { BankStatement, Cashbook, FinancialAccountDetail } from "../lib/types";
import { BankingActions, type BankingForm, BankingFormHost } from "./Banking";
import { monthStart } from "./WithholdingTax";

type Extra = "count" | "import" | "edit" | "reconcile" | null;

export function BankAccount({ id }: { id: string }) {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const tab = query.get("tab") ?? "cashbook";
  const from = query.get("from") ?? monthStart();
  const to = query.get("to") ?? isoDay();
  const account = useResource<FinancialAccountDetail>(`/api/v1/banking/accounts/${id}`);
  const book = useResource<Cashbook>(tab === "cashbook" ? `/api/v1/banking/accounts/${id}/cashbook?from=${from}&to=${to}` : null);
  const statements = useResource<BankStatement[]>(tab === "statements" ? `/api/v1/banking/accounts/${id}/statements` : null);
  const [open, setOpen] = useState<BankingForm>(null);
  const [extra, setExtra] = useState<Extra>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const act = useConfirmAction();

  function reloadAll() {
    account.reload();
    book.reload();
    statements.reload();
  }

  function closeAndReload() {
    setExtra(null);
    reloadAll();
  }

  return (
    <Loadable resource={account}>
      {(a) => {
        const statementBased = hasStatement(a.kind);
        const manage = can("bank:manage");
        return (
          <>
            <PageHeader
              title={a.name}
              description={
                <>
                  {accountSubtitle(a)} · <span className="mono">{a.glAccountCode}</span> {a.glAccountName}
                  {!a.isActive && (
                    <>
                      {" "}
                      <Badge tone="warning">Inactive</Badge>
                    </>
                  )}
                </>
              }
              back={{ to: "/banking", label: "Bank & cash" }}
              actions={
                a.isActive && (
                  <>
                    <BankingActions onOpen={setOpen} accountId={a.id} />
                    {manage && (
                      <Menu
                        label="More"
                        items={[
                          statementBased && { label: "Import statement", icon: FileUp, onSelect: () => setExtra("import") },
                          statementBased && !a.openReconciliation && { label: "Reconcile", icon: Scale, onSelect: () => setExtra("reconcile") },
                          isCash(a.kind) && { label: "Count cash", icon: Calculator, onSelect: () => setExtra("count") },
                          { label: "Edit account", icon: Pencil, onSelect: () => setExtra("edit") },
                        ]}
                      />
                    )}
                  </>
                )
              }
            />
            <BankingFormHost open={open} accountId={a.id} onClose={() => setOpen(null)} onSaved={reloadAll} />
            {extra === "count" && <CashCountForm account={a} onClose={() => setExtra(null)} onSaved={closeAndReload} />}
            {extra === "import" && (
              <StatementImportForm
                account={a}
                onClose={() => setExtra(null)}
                onSaved={() => {
                  setExtra(null);
                  reloadAll();
                  setQueryParam("tab", "statements");
                }}
              />
            )}
            {extra === "edit" && <FinancialAccountForm account={a} onClose={() => setExtra(null)} onSaved={closeAndReload} />}
            {extra === "reconcile" && <StartReconciliationForm accountId={a.id} onClose={() => setExtra(null)} />}
            {txnId && <TransactionDrawer id={txnId} onClose={() => setTxnId(null)} onChanged={reloadAll} />}

            {a.openReconciliation && (
              <div className="notice info">
                <span className="grow">
                  {a.openReconciliation.number} to {date(a.openReconciliation.statementDate)} is {a.openReconciliation.status.toLowerCase()}.
                </span>
                <Link to={`/banking/reconciliation/${a.openReconciliation.id}`} className="btn btn-sm">
                  Continue
                </Link>
              </div>
            )}

            <section className="figures" aria-label="Account position" style={{ "--cols": statementBased ? 4 : 3 } as CSSProperties}>
              <Figure lead label="Balance in the books" currency={a.currency} value={amount(a.balance)} tone={a.balance < 0 ? "negative" : undefined} note={a.allowOverdraft ? "Overdraft allowed" : "No overdraft"} />
              <Figure label="Money in this month" currency={a.currency} value={amount(a.monthIn)} />
              <Figure label="Money out this month" currency={a.currency} value={amount(a.monthOut)} />
              {statementBased && (
                <Figure
                  label="Reconciled to"
                  value={a.lastReconciledTo ? date(a.lastReconciledTo) : "Not yet"}
                  note={a.unmatchedStatementLines ? `${plural(a.unmatchedStatementLines, "statement line")} to match` : a.lastReconciledBalance !== null ? `Statement ${amount(a.lastReconciledBalance)}` : `From ${date(a.reconcileFrom)}`}
                />
              )}
            </section>

            <div className="tabs section" role="tablist">
              {[["cashbook", "Cashbook"], ...(statementBased ? [["statements", `Statements${a.statementCount ? ` (${a.statementCount})` : ""}`]] : []), ["details", "Details"]].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? "on" : ""}`} onClick={() => setQueryParam("tab", key === "cashbook" ? null : key)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "cashbook" && (
              <>
                <div className="filter-bar">
                  <Field label="From">
                    <input className="input" type="date" value={from} max={to} onChange={(e) => setQueryParam("from", e.target.value || null)} />
                  </Field>
                  <Field label="To">
                    <input className="input" type="date" value={to} min={from} onChange={(e) => setQueryParam("to", e.target.value || null)} />
                  </Field>
                </div>
                <Loadable resource={book}>
                  {(c) => (
                    <>
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Description</th>
                              <th className="hide-md">Reference</th>
                              <th className="num">In</th>
                              <th className="num">Out</th>
                              <th className="num hide-sm">Balance</th>
                              {statementBased && (
                                <th className="hide-sm" style={{ width: 36 }}>
                                  <span className="sr-only">Cleared</span>
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="type-group">
                              <td colSpan={5}>Opening balance on {date(c.from)}</td>
                              <td className="num hide-sm">{amount(c.openingBalance)}</td>
                              {statementBased && <td className="hide-sm" />}
                            </tr>
                            {c.rows.length === 0 && (
                              <tr>
                                <td colSpan={statementBased ? 7 : 6} style={{ padding: 0 }}>
                                  <EmptyState title="No movements in this period" body="Choose a wider date range, or record a receipt, payment or transfer." />
                                </td>
                              </tr>
                            )}
                            {c.rows.map((r) => (
                              <tr key={r.id} className={r.transactionId ? "clickable" : undefined} onClick={r.transactionId ? () => setTxnId(r.transactionId) : undefined}>
                                <td className="nowrap">{date(r.date)}</td>
                                <td>
                                  {r.description || "—"}
                                  <span className="sub">
                                    {r.transactionNumber ?? moduleLabel(r.sourceModule)} ·{" "}
                                    <Link to={`/journals?id=${r.journalId}`} onClick={(e) => e.stopPropagation()}>
                                      {r.journalNumber}
                                    </Link>
                                  </span>
                                </td>
                                <td className="hide-md muted">{r.reference ?? ""}</td>
                                <td className="num text-positive">{r.moneyIn ? amount(r.moneyIn) : ""}</td>
                                <td className="num">{r.moneyOut ? amount(r.moneyOut) : ""}</td>
                                <td className={`num hide-sm ${r.balance < 0 ? "text-negative" : ""}`}>{amount(r.balance)}</td>
                                {statementBased && (
                                  <td className="hide-sm" title={r.cleared ? "Cleared on a bank statement" : "Not on a statement yet"}>
                                    {r.cleared ? <Check size={15} className="text-positive" aria-label="Cleared" /> : <span className="subtle">·</span>}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={3}>Closing balance on {date(c.to)}</td>
                              <td className="num">{amount(c.receipts + c.transfersIn)}</td>
                              <td className="num">{amount(c.payments + c.transfersOut)}</td>
                              <td className="num hide-sm">{amount(c.closingBalance)}</td>
                              {statementBased && <td className="hide-sm" />}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <dl className="report-summary">
                        <div>
                          <dt>Receipts</dt>
                          <dd>{amount(c.receipts)}</dd>
                        </div>
                        <div>
                          <dt>Payments</dt>
                          <dd>{amount(c.payments)}</dd>
                        </div>
                        <div>
                          <dt>Transfers in</dt>
                          <dd>{amount(c.transfersIn)}</dd>
                        </div>
                        <div>
                          <dt>Transfers out</dt>
                          <dd>{amount(c.transfersOut)}</dd>
                        </div>
                        <div>
                          <dt>Closing ({currency})</dt>
                          <dd>{amount(c.closingBalance)}</dd>
                        </div>
                      </dl>
                    </>
                  )}
                </Loadable>
              </>
            )}

            {tab === "statements" && (
              <Loadable resource={statements}>
                {(list) =>
                  list.length === 0 ? (
                    <div className="panel">
                      <EmptyState
                        title="No statements imported"
                        body="Export the statement from online banking as CSV, OFX, QIF or CAMT.053 and import it here to match it to the books."
                        action={
                          manage && (
                            <button type="button" className="btn btn-primary" onClick={() => setExtra("import")}>
                              <FileUp size={16} aria-hidden="true" />
                              Import statement
                            </button>
                          )
                        }
                      />
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>File</th>
                            <th className="hide-sm">Period</th>
                            <th className="num">Lines</th>
                            <th className="num hide-sm">Matched</th>
                            <th className="num hide-md">Closing balance</th>
                            <th style={{ width: 40 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((s) => (
                            <tr key={s.id}>
                              <td>
                                {s.fileName}
                                <span className="sub">
                                  {s.format === "CAMT053" ? "CAMT.053" : s.format} · imported {dateTime(s.importedAt)}
                                  {s.duplicateCount ? ` · ${s.duplicateCount} skipped` : ""}
                                  {s.errorCount ? ` · ${s.errorCount} unreadable` : ""}
                                </span>
                              </td>
                              <td className="hide-sm">{s.periodStart ? `${date(s.periodStart)} – ${date(s.periodEnd)}` : "—"}</td>
                              <td className="num">{s.lineCount}</td>
                              <td className={`num hide-sm ${s.matchedCount < s.lineCount ? "text-warning" : "text-positive"}`}>{s.matchedCount}</td>
                              <td className="num hide-md">{s.closingBalance !== null ? amount(s.closingBalance) : "—"}</td>
                              <td>
                                {manage && (
                                  <button
                                    type="button"
                                    className="icon-button"
                                    aria-label={`Remove ${s.fileName}`}
                                    title="Remove this import"
                                    onClick={() =>
                                      act(
                                        {
                                          title: `Remove ${s.fileName}?`,
                                          body: "Its lines and their matches are removed. Lines that are part of a completed reconciliation can't be removed.",
                                          confirmLabel: "Remove import",
                                          danger: true,
                                        },
                                        async () => {
                                          await api(`/api/v1/banking/statements/${s.id}`, { method: "DELETE" });
                                          return `${s.fileName} removed`;
                                        },
                                        reloadAll,
                                      )
                                    }
                                  >
                                    <Trash2 size={15} aria-hidden="true" />
                                  </button>
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
            )}

            {tab === "details" && (
              <div className="panel panel-body">
                <dl className="dl">
                  <dt>Type</dt>
                  <dd>{accountSubtitle(a)}</dd>
                  {a.branchName && (
                    <>
                      <dt>Branch</dt>
                      <dd>{a.branchName}</dd>
                    </>
                  )}
                  {a.swiftCode && (
                    <>
                      <dt>SWIFT</dt>
                      <dd className="mono">{a.swiftCode}</dd>
                    </>
                  )}
                  <dt>Currency</dt>
                  <dd>{a.currency}</dd>
                  <dt>Ledger account</dt>
                  <dd>
                    <Link to={`/ledger?account=${a.glAccountId}`}>
                      {a.glAccountCode} {a.glAccountName}
                    </Link>
                  </dd>
                  <dt>Opened</dt>
                  <dd>
                    {date(a.dateOpened)}
                    {a.openingBalance ? ` with ${amount(a.openingBalance)}` : ""}
                  </dd>
                  {statementBased && (
                    <>
                      <dt>Reconcile from</dt>
                      <dd>{date(a.reconcileFrom)}</dd>
                    </>
                  )}
                  <dt>Overdraft</dt>
                  <dd>{a.allowOverdraft ? "Allowed" : "Not allowed — payments that exceed the balance are refused"}</dd>
                  {a.custodian && (
                    <>
                      <dt>Custodian</dt>
                      <dd>{a.custodian}</dd>
                    </>
                  )}
                  {a.notes && (
                    <>
                      <dt>Notes</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{a.notes}</dd>
                    </>
                  )}
                </dl>
                {statementBased && (
                  <p className="muted small" style={{ marginTop: 16 }}>
                    <Link to={`/banking/transactions?accountId=${a.id}`}>All transactions on this account</Link> ·{" "}
                    <Link to="/banking/reconciliation">Reconciliation history</Link>
                  </p>
                )}
              </div>
            )}
          </>
        );
      }}
    </Loadable>
  );
}

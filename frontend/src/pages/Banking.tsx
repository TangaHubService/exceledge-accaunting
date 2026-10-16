import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { FinancialAccountForm, MoneyForm, TransferForm } from "../components/BankingForms";
import { EmptyState, Figure, Loadable, Menu, PageHeader } from "../components/ui";
import { ACCOUNT_KIND_LABELS, ACCOUNT_KIND_ORDER, accountSubtitle, hasStatement } from "../lib/banking";
import { useCompany } from "../lib/company";
import { amount, date, daysBetween, moduleLabel, money, plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { BankingDashboard } from "../lib/types";

type Attention = { key: string; tone: "negative" | "warning" | "info"; what: string; why: string; value?: string; to: string };
export type BankingForm = "in" | "out" | "transfer" | "account" | null;

/** Money in and out per day, side by side. */
function CashFlowChart({ days }: { days: BankingDashboard["cashFlow"] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.moneyIn, d.moneyOut]));
  const totalIn = days.reduce((s, d) => s + d.moneyIn, 0);
  const totalOut = days.reduce((s, d) => s + d.moneyOut, 0);
  return (
    <>
      <div className="flow" role="img" aria-label={`Money in ${amount(totalIn)}, money out ${amount(totalOut)} over 30 days`}>
        {days.map((d) => (
          <div className="flow-day" key={d.day} title={`${date(d.day)} · in ${amount(d.moneyIn)} · out ${amount(d.moneyOut)}`}>
            <span className="flow-in" style={{ height: `${(d.moneyIn / max) * 100}%` }} />
            <span className="flow-out" style={{ height: `${(d.moneyOut / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flow-axis">
        <span>{date(days[0]?.day)}</span>
        <span>Today</span>
      </div>
      <div className="flow-legend">
        <span>
          <i className="flow-key in" /> In <strong className="amount">{amount(totalIn)}</strong>
        </span>
        <span>
          <i className="flow-key out" /> Out <strong className="amount">{amount(totalOut)}</strong>
        </span>
        <span className="muted">Transfers between your own accounts are left out</span>
      </div>
    </>
  );
}

export function BankingActions({ onOpen, accountId }: { onOpen: (f: BankingForm) => void; accountId?: string }) {
  const { can } = useSession();
  if (!can("bank:manage")) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => onOpen("transfer")}>
        <ArrowLeftRight size={16} aria-hidden="true" />
        Transfer
      </button>
      <button type="button" className="btn" onClick={() => onOpen("out")}>
        <ArrowUpRight size={16} aria-hidden="true" />
        Make payment
      </button>
      <button type="button" className="btn btn-primary" onClick={() => onOpen("in")}>
        <ArrowDownLeft size={16} aria-hidden="true" />
        Receive money
      </button>
      {!accountId && <Menu label="More" items={[{ label: "Add bank or cash account", icon: Plus, onSelect: () => onOpen("account") }]} />}
    </>
  );
}

export function BankingFormHost({ open, accountId, onClose, onSaved }: { open: BankingForm; accountId?: string; onClose: () => void; onSaved: () => void }) {
  const done = () => {
    onClose();
    onSaved();
  };
  if (open === "in" || open === "out") return <MoneyForm direction={open} accountId={accountId} onClose={onClose} onSaved={done} />;
  if (open === "transfer") return <TransferForm fromAccountId={accountId} onClose={onClose} onSaved={done} />;
  if (open === "account")
    return (
      <FinancialAccountForm
        onClose={onClose}
        onSaved={(a) => {
          onClose();
          navigate(`/banking/accounts/${a.id}`);
        }}
      />
    );
  return null;
}

export function Banking() {
  const { can } = useSession();
  const { currency } = useCompany();
  const dash = useResource<BankingDashboard>("/api/v1/banking/dashboard");
  const [open, setOpen] = useState<BankingForm>(null);

  return (
    <>
      <PageHeader title="Bank & cash" description="Balances, movements and reconciliation for every bank, mobile money and cash account." actions={<BankingActions onOpen={setOpen} />} />
      <BankingFormHost open={open} onClose={() => setOpen(null)} onSaved={dash.reload} />

      <Loadable resource={dash}>
        {(d) => {
          if (d.accounts.length === 0) {
            return (
              <div className="panel">
                <EmptyState
                  title="No bank or cash accounts yet"
                  body="Add each bank account, mobile money wallet, till and petty cash box you use. Each one gets its own ledger account, cashbook and reconciliation."
                  action={
                    can("bank:manage") && (
                      <button type="button" className="btn btn-primary" onClick={() => setOpen("account")}>
                        <Plus size={16} aria-hidden="true" />
                        Add account
                      </button>
                    )
                  }
                />
              </div>
            );
          }

          const attention: Attention[] = [];
          if (d.unmatchedStatementLines) {
            attention.push({
              key: "unmatched",
              tone: "warning",
              what: `${plural(d.unmatchedStatementLines, "statement line")} not matched`,
              why: "Imported bank lines that aren't matched to the books yet.",
              to: "/banking/reconciliation",
            });
          }
          for (const a of d.accounts) {
            if (a.balance < 0 && !a.allowOverdraft) {
              attention.push({ key: `neg:${a.id}`, tone: "negative", what: `${a.name} is below zero`, why: "Overdraft isn't allowed on this account. Check for missing receipts.", value: money(a.balance, currency), to: `/banking/accounts/${a.id}` });
            }
            if (a.openReconciliation) {
              attention.push({
                key: `rec:${a.id}`,
                tone: "info",
                what: `${a.openReconciliation.number} for ${a.name} is ${a.openReconciliation.status.toLowerCase()}`,
                why: `Statement to ${date(a.openReconciliation.statementDate)} is waiting to be finished.`,
                to: `/banking/reconciliation/${a.openReconciliation.id}`,
              });
            } else if (hasStatement(a.kind) && (!a.lastReconciledTo || daysBetween(a.lastReconciledTo) > 45)) {
              attention.push({
                key: `stale:${a.id}`,
                tone: "warning",
                what: a.lastReconciledTo ? `${a.name} last reconciled ${daysBetween(a.lastReconciledTo)} days ago` : `${a.name} hasn't been reconciled`,
                why: "Reconcile bank accounts to the statement every month.",
                to: "/banking/reconciliation",
              });
            }
          }
          if (d.pendingDeposits && d.pendingDeposits > 0.005) {
            attention.push({ key: "undeposited", tone: "info", what: "Receipts waiting to be banked", why: "The undeposited funds account holds money received but not yet deposited.", value: money(d.pendingDeposits, currency), to: "/ledger" });
          }

          return (
            <>
              <section className="figures" aria-label="Cash position" style={{ "--cols": 4 } as CSSProperties}>
                <Figure lead label="Total in bank and cash" currency={currency} value={amount(d.totalAvailable)} note={plural(d.accounts.length, "account")} />
                <Figure label="Received today" currency={currency} value={amount(d.receivedToday)} note={`Paid out ${amount(d.paidToday)}`} />
                <Figure
                  label="Payments not yet cleared"
                  currency={currency}
                  value={amount(d.outstandingPayments.amount)}
                  note={d.outstandingPayments.count ? `${plural(d.outstandingPayments.count, "item")} not on a statement yet` : "Everything has cleared"}
                />
                <Figure
                  label="Deposits in transit"
                  currency={currency}
                  value={amount(d.depositsInTransit.amount)}
                  note={d.depositsInTransit.count ? `${plural(d.depositsInTransit.count, "item")} not on a statement yet` : "Everything has cleared"}
                />
              </section>

              <div className="overview-grid">
                <section>
                  <div className="section-head">
                    <h2 className="section-title">Needs your attention</h2>
                    <Link to="/banking/reconciliation" className="small">
                      Reconciliation
                    </Link>
                  </div>
                  <div className="panel">
                    {attention.length ? (
                      <ul className="attention">
                        {attention.map((a) => (
                          <li key={a.key}>
                            <Link to={a.to}>
                              <span className={`dot ${a.tone}`} />
                              <span>
                                <span className="what">{a.what}</span>
                                <span className="why">{a.why}</span>
                              </span>
                              <span className="how-much">{a.value ?? <span className="muted">Review →</span>}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="all-clear">Every account is reconciled and every statement line is matched.</p>
                    )}
                  </div>
                </section>
                <section>
                  <div className="section-head">
                    <h2 className="section-title">Last 30 days</h2>
                  </div>
                  <div className="panel">
                    <CashFlowChart days={d.cashFlow} />
                  </div>
                </section>
              </div>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Accounts</h2>
                  <Link to="/reports/cash-position" className="small">
                    Cash position report
                  </Link>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="hide-md">Ledger</th>
                        <th className="hide-sm">Reconciled to</th>
                        <th className="num">Balance ({currency})</th>
                      </tr>
                    </thead>
                    {ACCOUNT_KIND_ORDER.map((kind) => {
                      const rows = d.accounts.filter((a) => a.kind === kind);
                      if (!rows.length) return null;
                      const group = d.byKind.find((b) => b.kind === kind);
                      return (
                        <tbody key={kind}>
                          <tr className="type-group">
                            <td colSpan={3}>
                              {ACCOUNT_KIND_LABELS[kind]} <span className="muted">· {rows.length}</span>
                            </td>
                            <td className="num">{amount(group?.balance ?? 0)}</td>
                          </tr>
                          {rows.map((a) => (
                            <tr key={a.id} className="clickable" onClick={() => navigate(`/banking/accounts/${a.id}`)}>
                              <td>
                                <Link to={`/banking/accounts/${a.id}`} style={{ color: "inherit" }}>
                                  {a.name}
                                </Link>
                                <span className="sub">{accountSubtitle(a)}</span>
                              </td>
                              <td className="hide-md muted">
                                <span className="mono">{a.glAccountCode}</span> {a.glAccountName}
                              </td>
                              <td className="hide-sm">
                                {hasStatement(a.kind) ? (
                                  a.lastReconciledTo ? (
                                    date(a.lastReconciledTo)
                                  ) : (
                                    <span className="muted">Not yet</span>
                                  )
                                ) : (
                                  <span className="subtle">—</span>
                                )}
                                {a.unmatchedStatementLines > 0 && <span className="sub text-warning">{plural(a.unmatchedStatementLines, "line")} to match</span>}
                              </td>
                              <td className={`num strong ${a.balance < 0 ? "text-negative" : ""}`}>{amount(a.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      );
                    })}
                    <tfoot>
                      <tr>
                        <td colSpan={3}>Total</td>
                        <td className="num">{amount(d.totalAvailable)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Latest movements</h2>
                  <Link to="/banking/transactions" className="small">
                    All transactions
                  </Link>
                </div>
                <div className="table-wrap">
                  {d.recent.length === 0 ? (
                    <EmptyState title="No movements yet" body="Receipts, payments and transfers on any bank or cash account appear here." />
                  ) : (
                    <table className="table">
                      <tbody>
                        {d.recent.map((r) => (
                          <tr key={r.id} className={r.accountId ? "clickable" : undefined} onClick={r.accountId ? () => navigate(`/banking/accounts/${r.accountId}`) : undefined}>
                            <td className="muted nowrap" style={{ width: 110 }}>
                              {date(r.date)}
                            </td>
                            <td>
                              {r.description || r.journalNumber}
                              <span className="sub">
                                {r.accountName} · {moduleLabel(r.sourceModule) || "Journal"} · {r.journalNumber}
                              </span>
                            </td>
                            <td className={`num ${r.moneyIn ? "text-positive" : ""}`}>{r.moneyIn ? `+${amount(r.moneyIn)}` : `−${amount(r.moneyOut)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

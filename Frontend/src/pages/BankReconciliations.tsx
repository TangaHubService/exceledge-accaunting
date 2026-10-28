import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Lock,
  Play,
  Plus,
  Printer,
  Unlink,
  WandSparkles,
  X,
} from "lucide-react";
import { type CSSProperties, type FormEvent, type ReactNode, useMemo, useState } from "react";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { RecordLineForm, StartReconciliationForm, useConfirmAction } from "../components/BankingForms";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../components/forms";
import { Badge, Drawer, EmptyState, Field, Figure, Loadable, Menu, PageHeader } from "../components/ui";
import { ACCOUNT_KIND_LABELS, LINE_KIND_LABELS, RECON_STATUS } from "../lib/banking";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, isoDay, plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { MatchingWorkspace, Reconciliation, ReconciliationOverview, StatementLine } from "../lib/types";

const who = (id: number | null) => (id === null ? "—" : `Excel Edge user #${id}`);
const signed = (n: number) => amount(n, n % 1 ? 2 : 0);

/* ── Overview & Setup ──────────────────────────────────── */

export function BankReconciliations() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { toast } = useFeedback();
  const overview = useResource<ReconciliationOverview>("/api/v1/banking/reconciliations");
  const [starting, setStarting] = useState<string | null>(null);

  // Modes: "dashboard" (Mockup 76), "setup" (Mockup 77), "history"
  const [viewMode, setViewMode] = useState<"dashboard" | "setup" | "history">("dashboard");

  // Setup screen form state (Mockup 77)
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [statementEndingBalance, setStatementEndingBalance] = useState("0.00");
  const [statementEndingDate, setStatementEndingDate] = useState(isoDay());
  const [serviceChargeDate, setServiceChargeDate] = useState("");
  const [serviceCharge, setServiceCharge] = useState("0.00");
  const [expenseAccount, setExpenseAccount] = useState("Bank charges");
  const [interestDate, setInterestDate] = useState("");
  const [interestEarned, setInterestEarned] = useState("0.00");
  const [incomeAccount, setIncomeAccount] = useState("Interest income");
  const [submittingRecon, setSubmittingRecon] = useState(false);

  const history: Column<ReconciliationOverview["history"][number]>[] = [
    { key: "number", header: "Reconciliation", className: "nowrap", render: (r) => r.number, sortValue: (r) => r.number },
    { key: "account", header: "Account", render: (r) => r.accountName, sortValue: (r) => r.accountName },
    { key: "date", header: "Statement date", className: "nowrap", render: (r) => date(r.statementDate), sortValue: (r) => r.statementDate },
    { key: "statement", header: `Statement (${currency})`, numeric: true, className: "hide-sm", render: (r) => amount(r.statementBalance) },
    { key: "book", header: "Books", numeric: true, className: "hide-md", render: (r) => (r.bookBalance === null ? "—" : amount(r.bookBalance)) },
    { key: "outstanding", header: "Outstanding", numeric: true, className: "hide-md", render: (r) => (r.outstandingCount === null ? "—" : r.outstandingCount) },
    { key: "status", header: "Status", render: (r) => <Badge tone={RECON_STATUS[r.status].tone}>{RECON_STATUS[r.status].label}</Badge> },
  ];

  async function handleStartReconciling(e: FormEvent) {
    e.preventDefault();
    const acct = overview.data?.accounts.find((a) => (selectedAccountId ? a.id === selectedAccountId : true)) || overview.data?.accounts[0];
    if (!acct) {
      toast("No eligible bank account found. Please configure a bank account first.", { error: true });
      return;
    }
    if (acct.openReconciliation) {
      navigate(`/banking/reconciliation/${acct.openReconciliation.id}`);
      return;
    }

    setSubmittingRecon(true);
    try {
      const balNum = parseFloat(statementEndingBalance) || 0;
      const rec = await api<Reconciliation>("/api/v1/banking/reconciliations", {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: acct.id,
          statementDate: statementEndingDate,
          statementBalance: balNum,
          notes: serviceCharge !== "0.00" || interestEarned !== "0.00"
            ? `Service charge: ${serviceCharge} (${expenseAccount}), Interest: ${interestEarned} (${incomeAccount})`
            : undefined,
        }),
      });
      toast(`Started reconciliation ${rec.number}.`);
      navigate(`/banking/reconciliation/${rec.id}`);
    } catch (err) {
      toast((err as Error).message, { error: true });
    } finally {
      setSubmittingRecon(false);
    }
  }

  return (
    <div className="ee-reconcile-split-layout">
      {/* Main content area */}
      <main className="ee-reconcile-main">
        {starting !== null && <StartReconciliationForm accountId={starting || undefined} onClose={() => setStarting(null)} />}

        {/* MODE 1: DASHBOARD (Mockup 76) */}
        {viewMode === "dashboard" && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>
              Reconcile
            </div>

            <div className="ee-reconcile-hero-card">
              <div className="ee-reconcile-hero-left">
                <h1 className="ee-reconcile-hero-title">
                  Match the books to the bank records
                </h1>
                <p className="ee-reconcile-hero-sub">
                  Connected accounts are easier to reconcile.{" "}
                  <Link to="/banking">Connect now</Link>
                </p>

                <a
                  href="#video-tutorial"
                  className="ee-reconcile-video-link"
                  onClick={(e) => {
                    e.preventDefault();
                    toast("Tutorial video: How to reconcile bank accounts in Excel Edge ERP.");
                  }}
                >
                  <Play size={18} fill="#0052ff" />
                  Video tutorials (3:35)
                </a>

                <ul className="ee-reconcile-bullets">
                  <li className="ee-reconcile-bullet">
                    <CheckCircle2 size={20} color="#0052ff" />
                    <span>Keep yourself on track</span>
                  </li>
                  <li className="ee-reconcile-bullet">
                    <CheckCircle2 size={20} color="#0052ff" />
                    <span>Find holes in your accounting</span>
                  </li>
                  <li className="ee-reconcile-bullet">
                    <CheckCircle2 size={20} color="#0052ff" />
                    <span>Get things tidy for tax time</span>
                  </li>
                </ul>

                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <button
                    type="button"
                    className="ee-btn-blue"
                    style={{ height: 44, padding: "0 28px", fontSize: 15 }}
                    onClick={() => setViewMode("setup")}
                  >
                    Get started
                  </button>
                  <button
                    type="button"
                    className="ee-btn-outline"
                    onClick={() => setViewMode("history")}
                  >
                    History by account
                  </button>
                </div>
              </div>

              <div className="ee-reconcile-hero-right">
                <img
                  src="/illustrations/reconcile-hero.png"
                  alt="Reconciliation illustration"
                  className="ee-reconcile-hero-img"
                  onError={(e) => {
                    // Fallback to placeholder vector if not loaded
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* MODE 2: SETUP SCREEN (Mockup 77) */}
        {viewMode === "setup" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#0052ff", display: "flex", alignItems: "center", gap: 6 }}>
                <Link to="/accounting/chart-of-accounts" style={{ color: "#0052ff", textDecoration: "none" }}>
                  Accounting
                </Link>
                <span>/</span>
                <span>Reconcile</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <a
                  href="#learn-more"
                  style={{ color: "#0c1c38", fontSize: 14, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                  onClick={(e) => {
                    e.preventDefault();
                    toast("Reconciliation documentation opened.");
                  }}
                >
                  Learn more <ExternalLink size={14} />
                </a>
                <Link to="/accounting/chart-of-accounts" style={{ color: "#0052ff", fontSize: 14, textDecoration: "none" }}>
                  Chart of accounts
                </Link>
                <Link to="/accounting/chart-of-accounts" style={{ color: "#0052ff", fontSize: 14, textDecoration: "none" }}>
                  Register
                </Link>
                <button
                  type="button"
                  className="ee-btn-outline"
                  style={{ height: 32, padding: "0 14px", fontSize: 13 }}
                  onClick={() => setViewMode("history")}
                >
                  Summary
                </button>
                <button
                  type="button"
                  className="ee-btn-outline"
                  style={{ height: 32, padding: "0 14px", fontSize: 13 }}
                  onClick={() => setViewMode("history")}
                >
                  History by account
                </button>
              </div>
            </div>

            <h1 style={{ fontSize: 32, fontWeight: 700, color: "#0c1c38", margin: "0 0 24px", letterSpacing: "-0.02em" }}>
              Reconcile
            </h1>

            <form onSubmit={handleStartReconciling} className="ee-recon-setup-card">
              {/* Section 1 */}
              <div className="ee-recon-section">
                <h2 className="ee-recon-section-title">
                  Which account do you want to reconcile?
                </h2>
                <div style={{ maxWidth: 440 }}>
                  <label className="ee-input-label">Account</label>
                  <select
                    className="ee-input-field"
                    style={{ width: "100%" }}
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                  >
                    {overview.data?.accounts && overview.data.accounts.length > 0 ? (
                      overview.data.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.bankName || "Bank"})
                        </option>
                      ))
                    ) : (
                      <option value="cash">Cash and cash equivalents</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Section 2 */}
              <div className="ee-recon-section">
                <h2 className="ee-recon-section-title">
                  Add the following information*
                </h2>
                <div className="ee-recon-grid-3col">
                  <div className="ee-input-group">
                    <label className="ee-input-label">Beginning balance</label>
                    <input
                      type="text"
                      className="ee-input-field"
                      disabled
                      value="0.00"
                    />
                  </div>
                  <div className="ee-input-group">
                    <label className="ee-input-label">Statement ending balance</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      className="ee-input-field"
                      style={{ textAlign: "right" }}
                      value={statementEndingBalance}
                      onChange={(e) => setStatementEndingBalance(e.target.value)}
                    />
                  </div>
                  <div className="ee-input-group">
                    <label className="ee-input-label">Statement ending date</label>
                    <input
                      type="date"
                      required
                      className="ee-input-field"
                      value={statementEndingDate}
                      onChange={(e) => setStatementEndingDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3 */}
              <div className="ee-recon-section">
                <h2 className="ee-recon-section-title">
                  Enter the service charge or interest earned, if necessary
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div className="ee-recon-grid-3col">
                    <div className="ee-input-group">
                      <label className="ee-input-label">Date</label>
                      <input
                        type="date"
                        className="ee-input-field"
                        value={serviceChargeDate}
                        onChange={(e) => setServiceChargeDate(e.target.value)}
                      />
                    </div>
                    <div className="ee-input-group">
                      <label className="ee-input-label">Service charge</label>
                      <input
                        type="number"
                        step="0.01"
                        className="ee-input-field"
                        style={{ textAlign: "right" }}
                        value={serviceCharge}
                        onChange={(e) => setServiceCharge(e.target.value)}
                      />
                    </div>
                    <div className="ee-input-group">
                      <label className="ee-input-label">Expense account</label>
                      <select
                        className="ee-input-field"
                        value={expenseAccount}
                        onChange={(e) => setExpenseAccount(e.target.value)}
                      >
                        <option value="Bank charges">Bank charges</option>
                        <option value="Interest expense">Interest expense</option>
                        <option value="General & Admin">General & Admin</option>
                      </select>
                    </div>
                  </div>

                  <div className="ee-recon-grid-3col">
                    <div className="ee-input-group">
                      <label className="ee-input-label">Date</label>
                      <input
                        type="date"
                        className="ee-input-field"
                        value={interestDate}
                        onChange={(e) => setInterestDate(e.target.value)}
                      />
                    </div>
                    <div className="ee-input-group">
                      <label className="ee-input-label">Interest earned</label>
                      <input
                        type="number"
                        step="0.01"
                        className="ee-input-field"
                        style={{ textAlign: "right" }}
                        value={interestEarned}
                        onChange={(e) => setInterestEarned(e.target.value)}
                      />
                    </div>
                    <div className="ee-input-group">
                      <label className="ee-input-label">Income account</label>
                      <select
                        className="ee-input-field"
                        value={incomeAccount}
                        onChange={(e) => setIncomeAccount(e.target.value)}
                      >
                        <option value="Interest income">Interest income</option>
                        <option value="Other income">Other income</option>
                        <option value="Operating revenue">Operating revenue</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                <button
                  type="submit"
                  className="ee-btn-blue"
                  disabled={submittingRecon}
                  style={{ height: 42, padding: "0 24px" }}
                >
                  {submittingRecon ? "Starting..." : "Start reconciling"}
                </button>
                <button
                  type="button"
                  className="ee-btn-outline"
                  onClick={() => setViewMode("dashboard")}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* MODE 3: HISTORY & SUMMARY TABLE */}
        {viewMode === "history" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0c1c38", margin: "0 0 6px" }}>
                  Reconciliation summary & history
                </h1>
                <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>
                  Overview of all bank accounts and past reconciliation statements.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="ee-btn-outline"
                  onClick={() => setViewMode("dashboard")}
                >
                  Back to Reconcile
                </button>
                <button
                  type="button"
                  className="ee-btn-blue"
                  onClick={() => setViewMode("setup")}
                >
                  <Plus size={16} /> New reconciliation
                </button>
              </div>
            </div>

            <Loadable resource={overview}>
              {(o) => (
                <>
                  <div className="table-wrap" style={{ marginBottom: 32 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th className="num">Books ({currency})</th>
                          <th className="hide-sm">Latest statement line</th>
                          <th className="num hide-md">To match</th>
                          <th className="hide-sm">Reconciled to</th>
                          <th style={{ width: 170 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {o.accounts.map((a) => (
                          <tr key={a.id} className={a.isActive ? undefined : "row-inactive"}>
                            <td>
                              <Link to={`/banking/accounts/${a.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                                {a.name}
                              </Link>
                              <span className="sub">{[ACCOUNT_KIND_LABELS[a.kind], a.bankName, a.accountNumber].filter(Boolean).join(" · ")}</span>
                            </td>
                            <td className="num">{amount(a.bookBalance)}</td>
                            <td className="hide-sm">
                              {a.lastStatementDate ? date(a.lastStatementDate) : <span className="muted">No statement imported</span>}
                              {a.lastStatementBalance !== null && <span className="sub">Balance {amount(a.lastStatementBalance)}</span>}
                            </td>
                            <td className={`num hide-md ${a.unmatchedLines ? "text-warning" : "muted"}`}>{a.unmatchedLines}</td>
                            <td className="hide-sm">{a.lastReconciledTo ? date(a.lastReconciledTo) : <span className="muted">Not yet</span>}</td>
                            <td className="num">
                              {a.openReconciliation ? (
                                <Link to={`/banking/reconciliation/${a.openReconciliation.id}`} className="btn btn-sm btn-primary">
                                  Continue {a.openReconciliation.number}
                                </Link>
                              ) : (
                                can("bank:manage") &&
                                a.isActive && (
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => {
                                      setSelectedAccountId(a.id);
                                      setViewMode("setup");
                                    }}
                                  >
                                    Reconcile
                                  </button>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <section className="section">
                    <div className="section-head">
                      <h2 className="section-title">Reconciliation history</h2>
                    </div>
                    <DataTable
                      columns={history}
                      rows={o.history}
                      rowKey={(r) => r.id}
                      onRowClick={(r) => navigate(`/banking/reconciliation/${r.id}`)}
                      empty={<EmptyState title="No reconciliations yet" body="Completed and in-progress reconciliations are listed here with their sign-offs." />}
                    />
                  </section>
                </>
              )}
            </Loadable>
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Workspace ─────────────────────────────────────────── */

function EditStatementForm({ rec, onClose, onSaved }: { rec: Reconciliation; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [balance, setBalance] = useState(signed(rec.statementBalance));
  const [notes, setNotes] = useState(rec.notes ?? "");
  const { busy, error, run } = useSubmit(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(balance);
    if (!Number.isFinite(n)) return;
    void run(async () => {
      await api(`/api/v1/banking/reconciliations/${rec.id}`, { method: "PATCH", body: JSON.stringify({ statementBalance: n, notes }) });
      return `${rec.number} updated`;
    });
  }

  return (
    <Drawer title={`Edit ${rec.number}`} subtitle={`Statement to ${date(rec.statementDate)}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="edit-rec-form" />}>
      <form id="edit-rec-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label={`Closing balance on the statement (${rec.currency})`} required className="span-2">
            <MoneyInput value={balance} onChange={setBalance} required />
          </Field>
          <Field label="Notes" className="span-2">
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

function Checks({ rec }: { rec: Reconciliation }) {
  const items: Array<[boolean, string, string]> = [
    [rec.checks.statementImported, "Statement imported", "Import the bank statement for this account"],
    [rec.checks.allLinesAccounted, "Every statement line matched or recorded", `${plural(rec.unrecorded.length, "line")} still to match or record`],
    [rec.checks.differenceZero, "Difference is zero", `Out by ${amount(rec.summary.difference, 2)}`],
    [rec.checks.periodOpen, "Accounting period is open", "Open the period for the statement date to record adjustments"],
  ];
  return (
    <ul className="checklist">
      {items.map(([ok, good, bad]) => (
        <li key={good}>
          <span className={`tick ${ok ? "done" : "review"}`}>{ok && <Check size={12} aria-hidden="true" />}</span>
          <span className={ok ? undefined : "text-warning"}>{ok ? good : bad}</span>
          <span />
        </li>
      ))}
    </ul>
  );
}

function ReportRow({ label, value, sub, strong }: { label: ReactNode; value: number | null; sub?: boolean; strong?: boolean }) {
  return (
    <tr className={strong ? "subtotal" : undefined}>
      <td style={sub ? { paddingLeft: 28 } : undefined}>{label}</td>
      <td className="num">{value === null ? "" : signed(value)}</td>
    </tr>
  );
}

function ReconciliationReport({ rec }: { rec: Reconciliation }) {
  const { name } = useCompany();
  const s = rec.summary;
  const deposits = rec.outstanding.filter((o) => o.amount > 0);
  const payments = rec.outstanding.filter((o) => o.amount < 0);
  const list = (title: string, rows: Reconciliation["outstanding"], total: number) =>
    rows.length > 0 && (
      <>
        <h3 className="report-subtitle">{title}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Details</th>
              <th className="hide-sm">Cheque / ref</th>
              <th className="num hide-sm">Days</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="nowrap">{date(o.date)}</td>
                <td>
                  {o.description || o.journalNumber}
                  <span className="sub">{[o.partyName, o.documentNumber ?? o.journalNumber].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="hide-sm">{o.chequeNumber ?? o.reference ?? ""}</td>
                <td className={`num hide-sm ${o.daysOutstanding > 90 ? "text-negative" : o.daysOutstanding > 30 ? "text-warning" : ""}`}>{o.daysOutstanding}</td>
                <td className="num">{signed(Math.abs(o.amount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total</td>
              <td className="num">{signed(total)}</td>
            </tr>
          </tfoot>
        </table>
      </>
    );

  return (
    <div className="report">
      <div className="report-head">
        <div className="company">{name}</div>
        <div className="title">Bank reconciliation statement</div>
        <div className="period">
          {[rec.accountName, rec.bankName, rec.accountNumber].filter(Boolean).join(" · ")} · as at {date(rec.statementDate)} · {rec.currency}
        </div>
      </div>
      <table className="table">
        <tbody>
          <ReportRow label={`Balance per bank statement at ${date(rec.statementDate)}`} value={s.statementBalance} />
          <ReportRow label="Add: deposits in transit" value={s.depositsInTransit} sub />
          <ReportRow label="Less: outstanding payments" value={-s.outstandingPayments} sub />
          <ReportRow label="Adjusted bank balance" value={s.adjustedBankBalance} strong />
          <tr>
            <td colSpan={2} style={{ border: 0, height: 10 }} />
          </tr>
          <ReportRow label={`Balance per books (${rec.glAccountCode} ${rec.glAccountName})`} value={s.bookBalance} />
          <ReportRow label="Less: bank charges not yet recorded" value={-s.bankCharges} sub />
          <ReportRow label="Add: interest not yet recorded" value={s.interestIncome} sub />
          {s.otherAdjustments !== 0 && <ReportRow label="Other statement items not yet recorded" value={s.otherAdjustments} sub />}
          <ReportRow label="Adjusted book balance" value={s.adjustedBookBalance} strong />
        </tbody>
        <tfoot>
          <tr>
            <td>Difference</td>
            <td className={`num ${Math.abs(s.difference) < 0.005 ? "" : "text-negative"}`}>{signed(s.difference)}</td>
          </tr>
        </tfoot>
      </table>

      {list("Deposits in transit", deposits, s.depositsInTransit)}
      {list("Outstanding payments", payments, s.outstandingPayments)}
      {rec.unrecorded.length > 0 && (
        <>
          <h3 className="report-subtitle">On the statement, not yet in the books</h3>
          <table className="table">
            <tbody>
              {rec.unrecorded.map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">{date(u.date)}</td>
                  <td>
                    {u.description}
                    <span className="sub">{LINE_KIND_LABELS[u.kind]}</span>
                  </td>
                  <td className="num">{signed(u.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <dl className="report-summary">
        <div>
          <dt>Period</dt>
          <dd>
            {date(rec.periodStart)} – {date(rec.statementDate)}
          </dd>
        </div>
        <div>
          <dt>Book entries cleared</dt>
          <dd>{rec.clearedEntryCount}</dd>
        </div>
        <div>
          <dt>Statement lines</dt>
          <dd>{rec.statementLineCount}</dd>
        </div>
      </dl>
      <div className="signoff">
        {(
          [
            ["Prepared", rec.preparedBy, rec.preparedAt],
            ["Reviewed", rec.reviewedBy, rec.reviewedAt],
            ["Approved", rec.approvedBy, rec.approvedAt],
            ["Completed", rec.completedBy, rec.completedAt],
          ] as Array<[string, number | null, string | null]>
        ).map(([label, user, at]) => (
          <div key={label}>
            <div className="muted small">{label}</div>
            <div>{at ? who(user) : "—"}</div>
            <div className="muted small">{at ? dateTime(at) : ""}</div>
          </div>
        ))}
      </div>
      {rec.notes && <p className="report-foot">Notes: {rec.notes}</p>}
    </div>
  );
}

export function BankReconciliationDetail({ id }: { id: string }) {
  const { can, api } = useSession();
  const recRes = useResource<Reconciliation>(`/api/v1/banking/reconciliations/${id}`);
  const rec = recRes.data;
  const live = rec && rec.status !== "COMPLETED";
  const ws = useResource<MatchingWorkspace>(live && rec ? `/api/v1/banking/accounts/${rec.financialAccountId}/matching?until=${rec.statementDate}` : null);
  const [lineSel, setLineSel] = useState<Set<string>>(new Set());
  const [entrySel, setEntrySel] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<StatementLine | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = useConfirmAction();
  const { toast } = useFeedback();
  const manage = can("bank:manage");

  function reload() {
    recRes.reload();
    ws.reload();
    setLineSel(new Set());
    setEntrySel(new Set());
  }

  const lineTotal = useMemo(() => (ws.data?.lines ?? []).filter((l) => lineSel.has(l.id)).reduce((s, l) => s + l.amount, 0), [ws.data, lineSel]);
  const entryTotal = useMemo(() => (ws.data?.entries ?? []).filter((e) => entrySel.has(e.id)).reduce((s, e) => s + e.amount, 0), [ws.data, entrySel]);
  const selDiff = Math.round((lineTotal - entryTotal) * 10000) / 10000;
  const selCount = lineSel.size + entrySel.size;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  async function step(path: string, verb: string) {
    setBusy(true);
    await act({ title: `${verb} ${rec!.number}?`, confirmLabel: verb }, async () => {
      await api(`/api/v1/banking/reconciliations/${id}/${path}`, { method: "POST" });
      return `${rec!.number} ${path === "review" ? "marked as reviewed" : path === "approve" ? "approved" : path === "complete" ? "completed" : "sent back to draft"}`;
    }, reload);
    setBusy(false);
  }

  async function match() {
    setBusy(true);
    try {
      await api(`/api/v1/banking/accounts/${rec!.financialAccountId}/matches`, { method: "POST", body: JSON.stringify({ lineIds: [...lineSel], entryIds: [...entrySel] }) });
      reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Loadable resource={recRes}>
      {(r) => {
        const notReady = !r.ready ? "Finish the checks first" : undefined;
        const actions: ReactNode[] = [];
        if (r.status === "DRAFT" && manage && r.workflowEnabled)
          actions.push(
            <button key="review" type="button" className="btn btn-primary" disabled={!r.ready || busy} title={notReady} onClick={() => step("review", "Mark as reviewed")}>
              Mark as reviewed
            </button>,
          );
        if (r.status === "REVIEWED" && can("bank:approve"))
          actions.push(
            <button key="approve" type="button" className="btn btn-primary" disabled={!r.ready || busy} title={notReady} onClick={() => step("approve", "Approve")}>
              Approve
            </button>,
          );
        if ((r.status === "APPROVED" || (r.status === "DRAFT" && !r.workflowEnabled)) && can("bank:approve"))
          actions.push(
            <button key="complete" type="button" className="btn btn-primary" disabled={!r.ready || busy} title={notReady} onClick={() => step("complete", "Complete")}>
              <Lock size={15} aria-hidden="true" />
              Complete
            </button>,
          );

        return (
          <>
            <PageHeader
              title={`${r.number} · ${r.accountName}`}
              description={
                <>
                  Statement to {date(r.statementDate)} · <Badge tone={RECON_STATUS[r.status].tone}>{RECON_STATUS[r.status].label}</Badge>
                  {!r.workflowEnabled && r.status !== "COMPLETED" && <span className="muted"> · Approval workflow is off; it can be completed directly</span>}
                </>
              }
              back={{ to: "/banking/reconciliation", label: "Bank reconciliation" }}
              actions={
                <>
                  <button type="button" className="btn" onClick={() => window.print()}>
                    <Printer size={16} aria-hidden="true" />
                    Print
                  </button>
                  {live && manage && (
                    <Menu
                      label="More"
                      items={[
                        r.status === "DRAFT" && { label: "Change statement balance", onSelect: () => setEditing(true) },
                        r.status !== "DRAFT" && { label: "Send back to draft", onSelect: () => step("reopen", "Send back") },
                        {
                          label: "Discard reconciliation",
                          onSelect: () =>
                            act(
                              { title: `Discard ${r.number}?`, body: "Matches you made are kept; only this reconciliation is removed.", confirmLabel: "Discard", danger: true },
                              async () => {
                                await api(`/api/v1/banking/reconciliations/${id}`, { method: "DELETE" });
                                navigate("/banking/reconciliation");
                                return `${r.number} discarded`;
                              },
                            ),
                        },
                      ]}
                    />
                  )}
                  {actions}
                </>
              }
            />
            {editing && (
              <EditStatementForm
                rec={r}
                onClose={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  reload();
                }}
              />
            )}
            {recording && (
              <RecordLineForm
                line={recording}
                onClose={() => setRecording(null)}
                onSaved={() => {
                  setRecording(null);
                  reload();
                }}
              />
            )}

            <div className="no-print">
              <section className="figures" aria-label="Reconciliation position" style={{ "--cols": 3 } as CSSProperties}>
                <Figure label="Statement balance" currency={r.currency} value={amount(r.statementBalance, r.statementBalance % 1 ? 2 : 0)} note={`At ${date(r.statementDate)}`} />
                <Figure label="Balance in the books" currency={r.currency} value={amount(r.summary.bookBalance, r.summary.bookBalance % 1 ? 2 : 0)} note={`${r.glAccountCode} ${r.glAccountName}`} />
                <Figure
                  lead
                  label="Difference"
                  currency={r.currency}
                  value={amount(r.summary.difference, 2)}
                  tone={Math.abs(r.summary.difference) < 0.005 ? "positive" : "negative"}
                  note={Math.abs(r.summary.difference) < 0.005 ? "Adjusted balances agree" : "Adjusted bank less adjusted books"}
                />
              </section>

              {live && (
                <div className="panel section">
                  <Checks rec={r} />
                </div>
              )}

              {live && (
                <section className="section">
                  <div className="section-head">
                    <h2 className="section-title">Match the statement to the books</h2>
                    {manage && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          await act({ title: "Match automatically?", body: "Pairs statement lines with book entries of the same amount where the reference or date makes the pair unambiguous.", confirmLabel: "Auto-match" }, async () => {
                            const res = await api<{ matched: number }>(`/api/v1/banking/accounts/${r.financialAccountId}/auto-match`, { method: "POST" });
                            return res.matched ? `${plural(res.matched, "pair")} matched` : "No unambiguous pairs found";
                          }, reload);
                          setBusy(false);
                        }}
                      >
                        <WandSparkles size={14} aria-hidden="true" />
                        Auto-match
                      </button>
                    )}
                  </div>
                  <Loadable resource={ws}>
                    {(w) => (
                      <>
                        <div className="two-col match-grid">
                          <div className="table-wrap">
                            <div className="match-head">
                              On the statement <span className="muted">· {w.lines.length} not matched</span>
                            </div>
                            {w.lines.length === 0 ? (
                              <p className="all-clear">Every statement line up to {date(r.statementDate)} is matched.</p>
                            ) : (
                              <table className="table">
                                <tbody>
                                  {w.lines.map((l) => (
                                    <tr key={l.id} className={`selectable ${lineSel.has(l.id) ? "selected" : ""}`} onClick={() => manage && toggle(lineSel, setLineSel, l.id)}>
                                      <td style={{ width: 28 }}>
                                        <input type="checkbox" checked={lineSel.has(l.id)} readOnly disabled={!manage} aria-label={`Select ${l.description}`} />
                                      </td>
                                      <td className="nowrap muted">{date(l.date)}</td>
                                      <td>
                                        {l.description}
                                        {(l.reference || l.chequeNumber) && <span className="sub">{[l.reference, l.chequeNumber && `Cheque ${l.chequeNumber}`].filter(Boolean).join(" · ")}</span>}
                                      </td>
                                      <td className={`num ${l.amount > 0 ? "text-positive" : ""}`}>{signed(l.amount)}</td>
                                      <td style={{ width: 70 }}>
                                        {manage && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-quiet"
                                            title="Post it in the books and match"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setRecording(l);
                                            }}
                                          >
                                            Record
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                          <div className="table-wrap">
                            <div className="match-head">
                              In the books <span className="muted">· {w.entries.length} not matched</span>
                            </div>
                            {w.entries.length === 0 ? (
                              <p className="all-clear">Every book entry up to {date(r.statementDate)} is matched.</p>
                            ) : (
                              <table className="table">
                                <tbody>
                                  {w.entries.map((e) => (
                                    <tr key={e.id} className={`selectable ${entrySel.has(e.id) ? "selected" : ""}`} onClick={() => manage && toggle(entrySel, setEntrySel, e.id)}>
                                      <td style={{ width: 28 }}>
                                        <input type="checkbox" checked={entrySel.has(e.id)} readOnly disabled={!manage} aria-label={`Select ${e.description ?? e.journalNumber}`} />
                                      </td>
                                      <td className="nowrap muted">{date(e.date)}</td>
                                      <td>
                                        {e.description || e.journalNumber}
                                        <span className="sub">{[e.partyName, e.chequeNumber && `Cheque ${e.chequeNumber}`, e.documentNumber, e.journalNumber].filter(Boolean).join(" · ")}</span>
                                      </td>
                                      <td className={`num ${e.amount > 0 ? "text-positive" : ""}`}>{signed(e.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>

                        {selCount > 0 && (
                          <div className="selection-bar" role="status">
                            <span>
                              Statement <strong className="amount">{signed(lineTotal)}</strong>
                            </span>
                            <span>
                              Books <strong className="amount">{signed(entryTotal)}</strong>
                            </span>
                            <span className={Math.abs(selDiff) < 0.005 ? "text-positive" : "text-negative"}>
                              Difference <strong className="amount">{signed(selDiff)}</strong>
                            </span>
                            <span className="grow" />
                            <button
                              type="button"
                              className="btn btn-sm btn-quiet"
                              onClick={() => {
                                setLineSel(new Set());
                                setEntrySel(new Set());
                              }}
                            >
                              <X size={14} aria-hidden="true" />
                              Clear
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy || selCount < 2 || Math.abs(selDiff) >= 0.005}
                              title={selCount < 2 ? "Select at least two items" : Math.abs(selDiff) >= 0.005 ? "The selected totals must be equal" : undefined}
                              onClick={match}
                            >
                              Match {selCount} items
                            </button>
                          </div>
                        )}

                        {w.matches.length > 0 && (
                          <details className="matched section">
                            <summary>
                              Matched items <span className="muted">· {w.matches.length}</span>
                            </summary>
                            <div className="table-wrap">
                              <table className="table">
                                <tbody>
                                  {w.matches.map((m) => (
                                    <tr key={m.id}>
                                      <td style={{ width: 110 }}>
                                        <Badge tone={m.method === "AUTO" ? "info" : m.method === "RECORDED" ? "positive" : "neutral"}>{m.method === "AUTO" ? "Auto" : m.method === "RECORDED" ? "Recorded" : "Manual"}</Badge>
                                      </td>
                                      <td>
                                        {m.lines.map((l) => (
                                          <div key={l.id}>
                                            <span className="muted">{date(l.date)}</span> {l.description} <span className="amount">{signed(l.amount)}</span>
                                          </div>
                                        ))}
                                        {m.lines.length === 0 && <span className="muted">Book entries that cancel each other</span>}
                                      </td>
                                      <td className="hide-sm">
                                        {m.entries.map((e) => (
                                          <div key={e.id}>
                                            <span className="muted">{e.journalNumber}</span> <span className="amount">{signed(e.amount)}</span>
                                          </div>
                                        ))}
                                      </td>
                                      <td style={{ width: 44 }}>
                                        {m.locked ? (
                                          <Lock size={14} className="subtle" aria-label="Locked by a completed reconciliation" />
                                        ) : (
                                          manage && (
                                            <button
                                              type="button"
                                              className="icon-button"
                                              aria-label="Unmatch"
                                              title="Unmatch"
                                              onClick={() =>
                                                act(
                                                  {
                                                    title: "Unmatch these items?",
                                                    body: m.method === "RECORDED" ? "The transaction recorded from the statement stays posted; reverse it from Bank transactions if it was wrong." : undefined,
                                                    confirmLabel: "Unmatch",
                                                  },
                                                  async () => {
                                                    await api(`/api/v1/banking/matches/${m.id}`, { method: "DELETE" });
                                                    return "Unmatched";
                                                  },
                                                  reload,
                                                )
                                              }
                                            >
                                              <Unlink size={15} aria-hidden="true" />
                                            </button>
                                          )
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </Loadable>
                </section>
              )}
            </div>

            <section className="section">
              <ReconciliationReport rec={r} />
            </section>

            <section className="panel panel-body section no-print">
              <AttachmentsPanel
                entityType="BankReconciliation"
                entityId={r.id}
                title="Bank statements and working papers"
                locked={r.status === "COMPLETED" ? "the reconciliation is completed" : null}
              />
            </section>
          </>
        );
      }}
    </Loadable>
  );
}

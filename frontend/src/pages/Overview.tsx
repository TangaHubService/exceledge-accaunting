import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Badge, BarsSkeleton, EmptyState, Figure, FiguresSkeleton, ListSkeleton, PageHeader, TableSkeleton } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, money, plural, toNumber } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { ApDashboard, ArDashboard, Customer, Journal, PostingException } from "../lib/types";
import { OverviewKpis } from "./Insights";

type Attention = { key: string; tone: "negative" | "warning" | "info"; what: string; why?: string; value?: ReactNode; to: string };

type AgeingBucket = { key: string; label: string; amount: number };

/** Vertical column chart for an ageing breakdown (receivables / payables). */
function AgeingColumns({
  buckets,
  currency,
  totalLabel,
  total,
}: {
  buckets: AgeingBucket[];
  currency: string;
  totalLabel: string;
  total: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  return (
    <div className="panel cols">
      {buckets.length === 0 ? (
        <p className="col-empty">Nothing outstanding.</p>
      ) : (
        <div
          className="col-chart"
          role="img"
          aria-label={`${totalLabel}: ${buckets.map((b) => `${b.label} ${amount(b.amount)}`).join(", ")}`}
        >
          {buckets.map((b, i) => (
            <div className="col" key={b.key} title={`${b.label}: ${money(b.amount, currency)}`}>
              <span className="col-value num">{amount(b.amount)}</span>
              <div className="col-track">
                <div className={`col-fill ${i ? `b${i}` : ""}`} style={{ height: `${(b.amount / max) * 100}%` }} />
              </div>
              <span className="col-label">{b.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="bar-total">
        <span>{totalLabel}</span>
        <span className="amount">{money(total, currency)}</span>
      </div>
    </div>
  );
}

type IntegrityScan = {
  id: string;
  ranAt: string;
  trigger: "SCHEDULED" | "MANUAL";
  findingCount: number;
  errors: number;
  checks: Array<{ check: string; label: string; count: number }>;
  findings: Array<{ check: string; severity: "ERROR" | "WARNING"; message: string }>;
};

/** Last data integrity scan: ledgers vs subledgers, numbering gaps, unbalanced journals, negative cash. */
function IntegrityCard() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const scan = useResource<IntegrityScan | null>("/api/v1/books/integrity");
  const [running, setRunning] = useState(false);
  const last = scan.data;

  async function runNow() {
    setRunning(true);
    try {
      const result = await api<IntegrityScan>("/api/v1/books/integrity/run", { method: "POST", body: "{}" });
      toast(result.findingCount ? `${plural(result.findingCount, "integrity issue")} found` : "No integrity issues found");
      scan.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
    setRunning(false);
  }

  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">Data integrity</h2>
        {can("close:manage") && (
          <button type="button" className="btn small" disabled={running} onClick={() => void runNow()}>
            {running ? "Checking…" : "Run now"}
          </button>
        )}
      </div>
      <div className="panel">
        {scan.loading && scan.data === undefined ? (
          <ListSkeleton rows={3} />
        ) : !last ? (
          <p className="all-clear">The books have not been checked yet. The check runs every day.</p>
        ) : (
          <>
            <p className="muted" style={{ padding: "8px 12px", margin: 0 }}>
              Last checked {dateTime(last.ranAt)}
              {last.trigger === "MANUAL" ? " (run by hand)" : ""} ·{" "}
              {last.findingCount ? (
                <Badge tone={last.errors ? "negative" : "warning"}>{plural(last.findingCount, "issue")}</Badge>
              ) : (
                <Badge tone="positive">No issues</Badge>
              )}
            </p>
            <table className="table">
              <tbody>
                {last.checks.map((c) => (
                  <tr key={c.check}>
                    <td>{c.label}</td>
                    <td className={`num ${c.count ? "text-negative" : "muted"}`}>{c.count || "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {last.findings.length > 0 && (
              <ul className="attention">
                {last.findings.slice(0, 5).map((f, i) => (
                  <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px" }}>
                    <span className={`dot ${f.severity === "ERROR" ? "negative" : "warning"}`} />
                    <span className="why">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function Overview() {
  const { can } = useSession();
  const company = useCompany();
  const ar = useResource<ArDashboard>(can("ar:view") ? "/api/v1/ar/dashboard" : null);
  const ap = useResource<ApDashboard>(can("ap:view") ? "/api/v1/ap/dashboard" : null);
  const customers = useResource<Customer[]>(can("ar:view") ? "/api/v1/ar/customers" : null);
  const journals = useResource<Journal[]>(can("journal:view") ? "/api/v1/journals" : null);
  const drafts = useResource<Journal[]>(can("journal:view") ? "/api/v1/journals?status=DRAFT" : null);
  const exceptions = useResource<PostingException[]>(can("exceptions:view") ? "/api/v1/exceptions?status=OPEN" : null);

  const { currency, dashboard, cashAccounts } = company;
  const cash = cashAccounts.reduce((s, a) => s + toNumber(a.currentBalance), 0);
  const overdueAmount = (ar.data?.ageing ?? []).filter((b) => b.key !== "CURRENT").reduce((s, b) => s + b.amount, 0);

  const overLimit = useMemo(
    () =>
      (customers.data ?? []).filter(
        (c) => c.status === "ACTIVE" && toNumber(c.creditLimit) > 0 && toNumber(c.balance) > toNumber(c.creditLimit),
      ),
    [customers.data],
  );

  const attention: Attention[] = [];
  if (dashboard && dashboard.activationStatus !== "ACTIVATED") {
    attention.push({
      key: "setup",
      tone: "warning",
      what: "Finish setting up accounting",
      why: `${dashboard.counts.completed} of ${dashboard.counts.total} setup sections complete. Nothing can be posted until the books are activated.`,
      to: "/setup",
    });
  }
  if (exceptions.data?.length) {
    attention.push({
      key: "exceptions",
      tone: "negative",
      what: `${plural(exceptions.data.length, "ERP transaction")} failed to post`,
      why: "Sales or purchases from Excel Edge that aren't in the books yet.",
      to: "/exceptions",
    });
  }
  if (ar.data && ar.data.overdueInvoices > 0) {
    attention.push({
      key: "overdue",
      tone: "negative",
      what: `${plural(ar.data.overdueInvoices, "invoice")} overdue`,
      why: "Customers who are past their payment date.",
      value: money(overdueAmount, currency),
      to: "/invoices?show=overdue",
    });
  }
  if (ap.data && ap.data.overdueBills.count > 0) {
    attention.push({
      key: "bills-overdue",
      tone: "negative",
      what: `${plural(ap.data.overdueBills.count, "supplier bill")} overdue`,
      why: "Bills past their due date. Late payment can put supply at risk.",
      value: money(ap.data.overdueBills.amount, currency),
      to: "/bills?show=overdue",
    });
  }
  if (ap.data && ap.data.billsDueToday.count > 0) {
    attention.push({
      key: "bills-today",
      tone: "warning",
      what: `${plural(ap.data.billsDueToday.count, "supplier bill")} due today`,
      value: money(ap.data.billsDueToday.amount, currency),
      to: "/bills?show=due-soon",
    });
  }
  if (overLimit.length) {
    attention.push({
      key: "limit",
      tone: "warning",
      what: `${plural(overLimit.length, "customer")} over their credit limit`,
      why: overLimit
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ") + (overLimit.length > 3 ? ` and ${overLimit.length - 3} more` : ""),
      to: "/customers?show=over-limit",
    });
  }
  if (drafts.data?.length) {
    attention.push({
      key: "drafts",
      tone: "info",
      what: `${plural(drafts.data.length, "journal entry", "journal entries")} waiting to be posted`,
      why: "Drafts don't affect balances until they're posted.",
      to: "/journals?status=DRAFT",
    });
  }

  const attentionLoading = ar.loading || ap.loading || exceptions.loading || drafts.loading || company.loading;
  const recentJournals = (journals.data ?? []).filter((j) => j.status === "POSTED").slice(0, 6);
  const ageing = ar.data?.ageing ?? [];
  const apAgeing = ap.data?.ageing ?? [];
  const figureCount = 1 + (can("ar:view") ? 3 : 0) + (can("ap:view") ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          dashboard?.currentOpenPeriod
            ? `Position as of today · ${dashboard.currentOpenPeriod.name} is the open period`
            : "Position as of today"
        }
      />

      {company.loading && !company.snapshot ? (
        <FiguresSkeleton count={figureCount} />
      ) : (
      <section className="figures" aria-label="Financial position" style={{ "--cols": figureCount } as CSSProperties}>
        {cashAccounts.length > 0 ? (
          <Figure
            lead
            label="Cash and bank"
            currency={currency}
            value={amount(cash)}
            note={<span title={cashAccounts.map((a) => `${a.code} ${a.name}`).join("\n")}>Across {plural(cashAccounts.length, "account")}</span>}
          />
        ) : (
          <Figure lead label="Cash and bank" value={company.snapshot ? "—" : "…"} note={company.snapshot && "Map cash and bank accounts in setup"} />
        )}
        {can("ar:view") && (
          <>
            <Figure
              label="Owed by customers"
              currency={currency}
              value={ar.data ? amount(ar.data.totalOutstanding) : "…"}
              note={ar.data && `${plural(ar.data.creditCustomers, "credit customer")}`}
            />
            <Figure
              label="Overdue from customers"
              currency={currency}
              value={ar.data ? amount(overdueAmount) : "…"}
              tone={overdueAmount > 0 ? "negative" : undefined}
              note={ar.data && (ar.data.overdueInvoices ? `${plural(ar.data.overdueInvoices, "invoice")} past due` : "Nothing past due")}
            />
            <Figure
              label="Customer deposits held"
              currency={currency}
              value={ar.data ? amount(ar.data.totalDeposits) : "…"}
              note="Paid in advance, not yet applied"
            />
          </>
        )}
        {can("ap:view") && (
          <Figure
            label="Owed to suppliers"
            currency={currency}
            value={ap.data ? amount(ap.data.totalOutstanding) : "…"}
            tone={ap.data && ap.data.overdueBills.count ? "warning" : undefined}
            note={
              ap.data &&
              (ap.data.overdueBills.count
                ? `${plural(ap.data.overdueBills.count, "bill")} overdue`
                : ap.data.dueNext7Days.count
                  ? `${amount(ap.data.dueNext7Days.amount)} due this week`
                  : "Nothing due this week")
            }
          />
        )}
      </section>
      )}

      <OverviewKpis />

      <div className="overview-grid">
        <section>
          <div className="section-head">
            <h2 className="section-title">Needs your attention</h2>
          </div>
          <div className="panel">
            {attention.length > 0 ? (
              <ul className="attention">
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link to={a.to}>
                      <span className={`dot ${a.tone}`} />
                      <span>
                        <span className="what">{a.what}</span>
                        {a.why && <span className="why">{a.why}</span>}
                      </span>
                      <span className="how-much">{a.value ?? <span className="muted">Review →</span>}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : attentionLoading ? (
              <ListSkeleton rows={3} />
            ) : (
              <p className="all-clear">You're up to date. Nothing needs attention right now.</p>
            )}
          </div>
        </section>

        {can("ar:view") && (
          <section>
            <div className="section-head">
              <h2 className="section-title">Receivables by age</h2>
              <Link to="/reports/ageing" className="small">
                Ageing report
              </Link>
            </div>
            {ar.data ? (
              <AgeingColumns
                buckets={ageing}
                currency={currency}
                totalLabel="Total owed"
                total={ar.data.totalOutstanding}
              />
            ) : (
              <div className="panel cols">
                <BarsSkeleton rows={5} />
              </div>
            )}
          </section>
        )}
      </div>

      <div className="overview-grid section">
        {can("ar:view") && (
          <section>
            <div className="section-head">
              <h2 className="section-title">Latest payments received</h2>
            </div>
            <div className="table-wrap">
              {!ar.data ? (
                <TableSkeleton rows={4} columns={3} wrap={false} label="Loading payments" />
              ) : ar.data.recentReceipts.length === 0 ? (
                <EmptyState title="No payments recorded yet" body="Customer payments will appear here as they're recorded." />
              ) : (
                <table className="table">
                  <tbody>
                    {(ar.data?.recentReceipts ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className="muted nowrap" style={{ width: 110 }}>
                          {date(r.receiptDate)}
                        </td>
                        <td>
                          {r.customerName}
                          <span className="sub">{r.receiptNumber}</span>
                        </td>
                        <td className="num text-positive">{amount(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}

        {can("journal:view") && (
          <section>
            <div className="section-head">
              <h2 className="section-title">Recently posted to the books</h2>
              <Link to="/journals" className="small">
                All journal entries
              </Link>
            </div>
            <div className="table-wrap">
              {!journals.data ? (
                <TableSkeleton rows={4} columns={3} wrap={false} label="Loading journal entries" />
              ) : recentJournals.length === 0 ? (
                <EmptyState title="Nothing posted yet" body="Invoices, receipts, ERP sales and manual journals appear here once posted." />
              ) : (
                <table className="table">
                  <tbody>
                    {recentJournals.map((j) => (
                      <tr key={j.id} className="clickable" onClick={() => navigate(`/journals?id=${j.id}`)}>
                        <td className="muted nowrap" style={{ width: 110 }}>
                          {date(j.journalDate)}
                        </td>
                        <td>
                          {j.description || j.sourceDocumentNumber || j.journalNumber}
                          <span className="sub">{j.journalNumber}</span>
                        </td>
                        <td className="num">{amount(j.totalDebit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}
      </div>

      {can("ap:view") && (
        <div className="overview-grid section">
          <section>
            <div className="section-head">
              <h2 className="section-title">Upcoming supplier payments</h2>
              <Link to="/bills?show=due-soon" className="small">
                Open bills
              </Link>
            </div>
            <div className="table-wrap">
              {!ap.data ? (
                <TableSkeleton rows={4} columns={3} wrap={false} label="Loading upcoming payments" />
              ) : ap.data.paymentCalendar.length === 0 ? (
                <EmptyState title="Nothing due in the next 30 days" body="Bills falling due will be listed here by date so you can plan cash." />
              ) : (
                <table className="table">
                  <tbody>
                    {(ap.data?.paymentCalendar ?? []).slice(0, 8).map((d) => (
                      <tr key={d.date}>
                        <td className="muted nowrap" style={{ width: 110 }}>
                          {date(d.date)}
                        </td>
                        <td>{plural(d.count, "bill")}</td>
                        <td className="num">{amount(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {ap.data && ap.data.averagePaymentDays !== null && (
                <p className="table-caption" style={{ padding: "8px 12px" }}>
                  On average you pay suppliers {plural(ap.data.averagePaymentDays, "day")} after the bill date.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2 className="section-title">Payables by age</h2>
              <Link to="/reports/payables-ageing" className="small">
                Ageing report
              </Link>
            </div>
            {ap.data ? (
              <AgeingColumns
                buckets={apAgeing}
                currency={currency}
                totalLabel="Total owed to suppliers"
                total={ap.data.totalOutstanding}
              />
            ) : (
              <div className="panel cols">
                <BarsSkeleton rows={5} />
              </div>
            )}
          </section>
        </div>
      )}

      {can("report:view") && (
        <div className="overview-grid section">
          <IntegrityCard />
        </div>
      )}
    </>
  );
}

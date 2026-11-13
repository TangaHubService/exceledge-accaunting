import { ArrowLeft, CalendarClock, Mail, MapPin, Phone } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { AllocateDepositForm, CreditNoteForm, DebitNoteForm, DepositForm, InvoiceForm, ReceiptForm } from "../components/ArForms";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { ApplyCreditsDrawer } from "../components/customers/ApplyCreditsDrawer";
import { CustomerFormDrawer } from "../components/customers/CustomerFormDrawer";
import { EmailComposer } from "../components/customers/EmailComposer";
import { MoneyBar } from "../components/customers/MoneyBar";
import { type Column, DataTable } from "../components/DataTable";
import { PeriodStatementView } from "../components/Documents";
import { useFeedback } from "../components/feedback";
import { SummaryRows } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, ErrorState, Loadable, Menu, PageHeader, Pagination, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, humanize, plural, toNumber } from "../lib/format";
import { usePagedResource } from "../lib/pagination";
import { Link, navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type {
  ArDeposit,
  Customer,
  CustomerActivityItem,
  CustomerNote,
  CustomerSummary,
  CustomerTxnDetail,
  CustomerTxnPage,
  CustomerTxnRow,
  CommercialDoc,
  CustomerPostingType,
  CustomerTxnType,
} from "../lib/types";
import { CustomerStatusBadge } from "./Customers";
import { InvoiceDrawer } from "./Invoices";

type Tab = "overview" | "transactions" | "invoices" | "payments" | "credit-notes" | "statements" | "notes";
type Dialog = null | "invoice" | "receipt" | "credit" | "debit" | "deposit" | "edit" | "apply" | "merge";

const TABS: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["transactions", "Transactions"],
  ["invoices", "Invoices"],
  ["payments", "Payments"],
  ["credit-notes", "Credit notes"],
  ["statements", "Statements"],
  ["notes", "Notes & activity"],
];

const TYPE_LABEL: Record<CustomerTxnType, string> = {
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
  DEPOSIT: "Deposit",
  ESTIMATE: "Estimate",
  SALES_ORDER: "Sales order",
  DELAYED_CHARGE: "Delayed charge",
  DELAYED_CREDIT: "Delayed credit",
  REFUND: "Refund",
};

const COMMERCIAL: CustomerTxnType[] = ["ESTIMATE", "SALES_ORDER", "DELAYED_CHARGE", "DELAYED_CREDIT"];
const isCommercial = (t: CustomerTxnType) => COMMERCIAL.includes(t);

const DOC_TO_TYPE: Record<string, CustomerTxnType | undefined> = {
  INVOICE: "INVOICE",
  OPENING: undefined,
  RECEIPT: "PAYMENT",
  RECEIPT_REVERSAL: "PAYMENT",
  CREDIT_NOTE: "CREDIT_NOTE",
  DEBIT_NOTE: "DEBIT_NOTE",
};

/** Which transaction drawer is open: invoices use the invoice drawer, the rest the generic one. */
type Viewing = { type: CustomerTxnType; id: string } | null;

export function CustomerDetail({ id }: { id: string }) {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const requested = query.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.some(([k]) => k === requested) ? requested : "overview";
  // ?action=receive (from the customer list's action menu) opens Receive payment straight away.
  const [dialog, setDialog] = useState<Dialog>(() => (query.get("action") === "receive" ? "receipt" : null));
  const [receiveFor, setReceiveFor] = useState<string | undefined>();
  const [applying, setApplying] = useState<ArDeposit | null>(null);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [version, setVersion] = useState(0);

  const customer = useResource<Customer>(`/api/v1/ar/customers/${id}`);
  const summary = useResource<CustomerSummary>(`/api/v1/ar/customers/${id}/summary`);

  const refresh = useCallback(() => {
    customer.reload();
    summary.reload();
    setVersion((v) => v + 1);
  }, [customer, summary]);

  const close = useCallback(() => {
    if (new URLSearchParams(window.location.search).get("action")) setQueryParam("action", null);
    setDialog(null);
    setReceiveFor(undefined);
    setApplying(null);
  }, []);
  const saved = useCallback(() => {
    close();
    refresh();
  }, [close, refresh]);

  async function reverseReceipt(row: { id: string; number: string; total: number }) {
    const ok = await confirm({
      title: `Reverse payment ${row.number}?`,
      body: `This adds ${currency} ${amount(row.total)} back to what the customer owes and posts a reversing journal. It can't be undone.`,
      confirmLabel: "Reverse payment",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/ar/receipts/${row.id}/reverse`, { method: "POST" });
      toast(`Payment ${row.number} reversed`);
      setViewing(null);
      refresh();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  async function setActive(c: Customer, next: "ACTIVE" | "INACTIVE") {
    if (next === "INACTIVE") {
      const ok = await confirm({
        title: `Make ${c.name} inactive?`,
        body: "They will be hidden from customer pickers on new transactions. History and reports are kept, and you can make them active again.",
        confirmLabel: "Make inactive",
      });
      if (!ok) return;
    }
    try {
      await api(`/api/v1/ar/customers/${c.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      toast(next === "ACTIVE" ? `${c.name} is active again` : `${c.name} made inactive`);
      refresh();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const manage = can("ar:manage");
  // Refunds live in Banking; the rest open in a drawer here.
  const open = (row: { type: CustomerTxnType; id: string; number?: string }) =>
    row.type === "REFUND" ? navigate(`/banking/transactions?q=${encodeURIComponent(row.number ?? "")}`) : setViewing({ type: row.type, id: row.id });

  return (
    <Loadable
      resource={customer}
      skeleton={
        <>
          <PageHeader title={<span className="skeleton" style={{ width: 240, height: 22 }} />} back={{ to: "/customers", label: "Customers" }} />
          <SkeletonRows rows={4} />
        </>
      }
    >
      {(c) => {
        const active = c.status === "ACTIVE";
        const canInvoice = manage && active && c.creditStatus !== "BLOCKED" && c.creditStatus !== "ON_HOLD";
        return (
          <div className="cust-profile">
            <header className="cust-hero">
              <div className="cust-hero-main">
                <Link to="/customers" className="back">
                  <ArrowLeft size={14} aria-hidden="true" />
                  Customers
                </Link>
                <div className="cust-hero-title">
                  <span className="cust-avatar" aria-hidden="true">
                    {initials(c.name)}
                  </span>
                  <div>
                    <h1>
                      {c.name} <CustomerStatusBadge customer={c} />
                    </h1>
                    <p className="cust-hero-meta">
                      {[c.companyName && c.companyName !== c.name ? c.companyName : null, c.code, humanize(c.customerType)].filter(Boolean).join(" · ")}
                      {c.parent && (
                        <>
                          {" · Sub-customer of "}
                          <Link to={`/customers/${c.parent.id}`}>{c.parent.name}</Link>
                        </>
                      )}
                    </p>
                    {(c.taxExempt || (c.tags?.length ?? 0) > 0) && (
                      <span className="cust-row-meta">
                        {c.taxExempt && (
                          <span className="cust-chip" title={c.taxExemptReason ?? undefined}>
                            Tax exempt
                          </span>
                        )}
                        {c.tags?.map((t) => (
                          <Link key={t} to={`/customers?tag=${encodeURIComponent(t)}`} className="cust-chip tag">
                            {t}
                          </Link>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <ul className="cust-hero-contact">
                  {c.email && (
                    <li>
                      <Mail size={14} aria-hidden="true" />
                      <a href={`mailto:${c.email}`}>{c.email}</a>
                    </li>
                  )}
                  {(c.telephone || c.mobile) && (
                    <li>
                      <Phone size={14} aria-hidden="true" />
                      {[c.telephone, c.mobile].filter(Boolean).join(" · ")}
                    </li>
                  )}
                  {c.physicalAddress && (
                    <li>
                      <MapPin size={14} aria-hidden="true" />
                      {[c.physicalAddress.split("\n").join(", "), c.country].filter(Boolean).join(", ")}
                    </li>
                  )}
                  <li>
                    <CalendarClock size={14} aria-hidden="true" />
                    {c.creditPeriodDays ? `Net ${c.creditPeriodDays}` : "Due on receipt"}
                    {c.preferredPaymentMethod ? ` · prefers ${humanize(c.preferredPaymentMethod).toLowerCase()}` : ""}
                  </li>
                  {!c.email && !c.telephone && !c.mobile && manage && (
                    <li>
                      <button type="button" className="link-button" onClick={() => setDialog("edit")}>
                        Add contact details
                      </button>
                    </li>
                  )}
                </ul>
              </div>

              <div className="cust-hero-side">
                {manage && (
                  <div className="cust-hero-actions no-print">
                    <button type="button" className="btn" onClick={() => setDialog("edit")}>
                      Edit
                    </button>
                    <Menu
                      label="More"
                      triggerClassName="btn"
                      items={[
                        { label: "Create statement", onSelect: () => setQueryParam("tab", "statements") },
                        { label: "Report: open balance detail", onSelect: () => navigate(`/reports/view/customer-balance-detail?customer=${encodeURIComponent(c.name)}`) },
                        { label: "Report: income by customer", onSelect: () => navigate(`/reports/view/income-by-customer-summary?customer=${encodeURIComponent(c.name)}`) },
                        { label: "Report: invoices and payments", onSelect: () => navigate(`/reports/view/invoices-and-received-payments?customer=${encodeURIComponent(c.name)}`) },
                        { label: "Merge into another customer…", onSelect: () => setDialog("merge") },
                        (summary.data?.availableCredit ?? 0) > 0 && { label: "Apply credits", onSelect: () => setDialog("apply") },
                        active
                          ? { label: "Make inactive", onSelect: () => void setActive(c, "INACTIVE") }
                          : { label: "Make active", onSelect: () => void setActive(c, "ACTIVE") },
                      ]}
                    />
                    <Menu
                      label="New transaction"
                      triggerClassName="btn btn-primary"
                      items={[
                        canInvoice && { label: "Invoice", onSelect: () => setDialog("invoice") },
                        { label: "Receive payment", onSelect: () => setDialog("receipt") },
                        { label: "Deposit", onSelect: () => setDialog("deposit") },
                        { label: "Credit note", onSelect: () => setDialog("credit") },
                        canInvoice && { label: "Debit note", onSelect: () => setDialog("debit") },
                        (summary.data?.availableCredit ?? 0) > 0 && { label: "Apply credits", onSelect: () => setDialog("apply") },
                      ]}
                    />
                  </div>
                )}
                <div className="cust-hero-balance">
                  <div>
                    <span className="cust-hero-label">Open balance</span>
                    <span className={`cust-hero-amount ${summary.data && summary.data.outstanding < -0.005 ? "text-positive" : ""}`}>
                      <span className="mb-ccy">{currency}</span>
                      {summary.data ? amount(Math.abs(summary.data.outstanding)) : "…"}
                      {summary.data && summary.data.outstanding < -0.005 && <span className="cust-cr"> CR</span>}
                    </span>
                  </div>
                  <div>
                    <span className="cust-hero-label">Overdue</span>
                    <span className={`cust-hero-amount ${summary.data && summary.data.overdue > 0 ? "text-negative" : ""}`}>
                      <span className="mb-ccy">{currency}</span>
                      {summary.data ? amount(summary.data.overdue) : "…"}
                    </span>
                  </div>
                </div>
                {manage && (
                  <button type="button" className="btn btn-primary cust-hero-pay no-print" onClick={() => setDialog("receipt")}>
                    Receive payment
                  </button>
                )}
              </div>
            </header>

            {!active && <p className="notice-inline">This customer is inactive. You can still record payments and credits, but not new invoices.</p>}

            {manage && summary.data && summary.data.availableCredit > 0.005 && summary.data.openInvoiceCount > 0 && (
              <div className="cust-credit-banner no-print" role="status">
                <span>
                  {c.name} has <strong>{currency} {amount(summary.data.availableCredit, 2)}</strong> in credits and {plural(summary.data.openInvoiceCount, "open invoice")}.
                </span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog("apply")}>
                  Apply credits
                </button>
              </div>
            )}

            <SummaryStrip summary={summary} />

            <div className="section">
              <div className="tabs no-print" role="tablist" aria-label="Customer sections">
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    className={`tab ${tab === key ? "on" : ""}`}
                    onClick={() => setQueryParam("tab", key === "overview" ? null : key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "overview" && <Overview customer={c} summary={summary.data} version={version} onOpen={open} onTab={(t) => setQueryParam("tab", t)} onChanged={refresh} />}

              {tab === "transactions" && <TxnTable key={`all-${version}`} customerId={c.id} onOpen={open} filters />}

              {tab === "invoices" && (
                <TxnTable
                  key={`inv-${version}`}
                  customerId={c.id}
                  type="INVOICE"
                  onOpen={open}
                  statusFilter
                  action={
                    manage
                      ? (r) =>
                          r.open > 0.005 ? (
                            <button
                              type="button"
                              className="btn btn-sm row-actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReceiveFor(r.number);
                                setDialog("receipt");
                              }}
                            >
                              Receive
                            </button>
                          ) : null
                      : undefined
                  }
                  empty={<EmptyState title="No invoices yet" body={`Invoices for ${c.name} will be listed here.`} />}
                />
              )}

              {tab === "payments" && (
                <>
                  <TxnTable
                    key={`pay-${version}`}
                    customerId={c.id}
                    type="PAYMENT"
                    onOpen={open}
                    action={
                      manage
                        ? (r) =>
                            r.status !== "Reversed" ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-quiet row-actions"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void reverseReceipt(r);
                                }}
                              >
                                Reverse
                              </button>
                            ) : null
                        : undefined
                    }
                    empty={<EmptyState title="No payments yet" body="Payments you receive from this customer will be listed here." />}
                  />
                  <Deposits key={`dep-${version}`} customerId={c.id} manage={manage} onApply={setApplying} onChanged={refresh} />
                </>
              )}

              {tab === "credit-notes" && (
                <TxnTable
                  key={`cn-${version}`}
                  customerId={c.id}
                  type="CREDIT_NOTE"
                  onOpen={open}
                  empty={
                    <EmptyState
                      title="No credit notes"
                      body="Credit notes reduce what the customer owes, for returns, discounts or billing corrections."
                      action={
                        manage ? (
                          <button type="button" className="btn btn-sm" onClick={() => setDialog("credit")}>
                            Issue credit note
                          </button>
                        ) : undefined
                      }
                    />
                  }
                />
              )}

              {tab === "statements" && <Statements customer={c} manage={manage} onSent={refresh} />}

              {tab === "notes" && <NotesAndActivity key={`notes-${version}`} customerId={c.id} manage={manage} onOpen={open} />}
            </div>

            {viewing?.type === "INVOICE" && <InvoiceDrawer id={viewing.id} onClose={() => setViewing(null)} onChanged={refresh} />}
            {viewing && isCommercial(viewing.type) && (
              <CommercialDrawer
                id={viewing.id}
                manage={manage}
                onClose={() => setViewing(null)}
                onOpenInvoice={(invoiceId) => setViewing({ type: "INVOICE", id: invoiceId })}
                onChanged={refresh}
              />
            )}
            {viewing && viewing.type !== "INVOICE" && !isCommercial(viewing.type) && (
              <TxnDrawer
                type={viewing.type as Exclude<CustomerPostingType, "INVOICE">}
                id={viewing.id}
                onClose={() => setViewing(null)}
                onOpenInvoice={(invoiceId) => setViewing({ type: "INVOICE", id: invoiceId })}
                onReverse={manage ? (d) => void reverseReceipt(d) : undefined}
              />
            )}

            {dialog === "invoice" && <InvoiceForm customer={c} onClose={close} onSaved={saved} />}
            {dialog === "receipt" && <ReceiptForm customer={c} invoiceNumber={receiveFor} onClose={close} onSaved={saved} />}
            {dialog === "credit" && <CreditNoteForm customer={c} onClose={close} onSaved={saved} />}
            {dialog === "debit" && <DebitNoteForm customer={c} onClose={close} onSaved={saved} />}
            {dialog === "deposit" && <DepositForm customer={c} onClose={close} onSaved={saved} />}
            {applying && <AllocateDepositForm customer={c} deposit={applying} onClose={close} onSaved={saved} />}
            {dialog === "apply" && <ApplyCreditsDrawer customerId={c.id} onClose={close} onSaved={saved} />}
            {dialog === "merge" && <MergeDrawer customer={c} onClose={close} />}
            {dialog === "edit" && <CustomerFormDrawer customer={c} onClose={close} onSaved={saved} />}
          </div>
        );
      }}
    </Loadable>
  );
}

/* ── Summary strip ─────────────────────────────────────── */

function SummaryStrip({ summary }: { summary: { data?: CustomerSummary; error?: string; loading: boolean; reload: () => void } }) {
  const { currency } = useCompany();
  if (summary.error && !summary.data) {
    return (
      <div className="panel">
        <ErrorState message={summary.error} onRetry={summary.reload} />
      </div>
    );
  }
  const s = summary.data;
  const last = s?.lastTransaction;
  const stat = (label: string, value: ReactNode, note?: ReactNode, tone?: string) => (
    <div className="cust-stat">
      <span className="cust-stat-label">{label}</span>
      <span className={`cust-stat-value ${tone ?? ""}`}>{s ? value : "…"}</span>
      {s && note && <span className="cust-stat-note">{note}</span>}
    </div>
  );
  return (
    <>
      <MoneyBar data={s?.moneyBar} loading={!s} currency={currency} />
      <section className="cust-stats" aria-label="Account summary">
        {stat("Total invoiced", `${currency} ${amount(s?.totalInvoiced)}`, s && plural(s.invoiceCount, "invoice"))}
        {stat("Payments received", `${currency} ${amount(s?.paymentsReceived)}`, s && plural(s.paymentCount, "payment"))}
        {stat(
          "Available credit",
          `${currency} ${amount(s?.availableCredit)}`,
          s && (s.creditHeadroom !== null ? `${amount(Math.max(0, s.creditHeadroom))} of ${amount(s.creditLimit)} limit left` : "No credit limit"),
          s && s.availableCredit > 0 ? "text-positive" : undefined,
        )}
        {stat("Last transaction", last ? date(last.date) : "None yet", last ? `${humanize(last.docType)} ${last.docNumber ?? ""}`.trim() : undefined)}
      </section>
    </>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/* ── Overview ──────────────────────────────────────────── */

function Overview({
  customer: c,
  summary,
  version,
  onOpen,
  onTab,
  onChanged,
}: {
  customer: Customer;
  summary?: CustomerSummary;
  version: number;
  onOpen: (r: { type: CustomerTxnType; id: string }) => void;
  onTab: (t: Tab) => void;
  onChanged: () => void;
}) {
  const { currency } = useCompany();
  const openInvoices = useResource<CustomerTxnPage>(`/api/v1/ar/customers/${c.id}/transactions?type=INVOICE&status=open&pageSize=5&v=${version}`);
  const recent = useResource<CustomerTxnPage>(`/api/v1/ar/customers/${c.id}/transactions?pageSize=5&v=${version}`);
  const detail = (label: string, value: ReactNode) =>
    value ? (
      <div className="cust-dl-row">
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  return (
    <div className="cust-overview">
      <section className="panel cust-card">
        <h3>Customer details</h3>
        <dl className="cust-dl">
          {detail("Contact person", c.contactPerson)}
          {detail("Email", c.email && <a href={`mailto:${c.email}`}>{c.email}</a>)}
          {detail("Phone", c.telephone)}
          {detail("Mobile", c.mobile)}
          {detail("Website", c.website)}
          {detail("Billing address", c.physicalAddress && <span className="pre">{[c.physicalAddress, c.country].filter(Boolean).join("\n")}</span>)}
          {detail("Shipping address", c.shippingAddress ? <span className="pre">{c.shippingAddress}</span> : c.physicalAddress ? "Same as billing" : null)}
          {detail("TIN", c.tin)}
          {detail("Tax", c.taxExempt ? `Exempt${c.taxExemptReason ? ` · ${c.taxExemptReason}` : ""}` : null)}
          {detail("Terms", c.creditPeriodDays ? `Net ${c.creditPeriodDays}` : "Due on receipt")}
          {detail("Payment method", c.preferredPaymentMethod && humanize(c.preferredPaymentMethod))}
          {detail("Credit limit", toNumber(c.creditLimit) > 0 ? `${currency} ${amount(c.creditLimit)}` : "No limit")}
          {detail("Credit status", humanize(c.creditStatus))}
          {detail("Currency", c.currency)}
          {detail("Notes", c.notes && <span className="pre">{c.notes}</span>)}
        </dl>
        <div className="cust-attachments">
          <AttachmentsPanel entityType="Customer" entityId={c.id} title="Documents" />
        </div>
        {summary && summary.availableCredit > 0 && (
          <div className="cust-credits">
            <strong>Credits to apply</strong>
            <SummaryRows
              rows={[
                ...(summary.credits.deposits ? ([["Unused deposits", amount(summary.credits.deposits)]] as Array<[string, string]>) : []),
                ...(summary.credits.unappliedPayments ? ([["Unapplied payments", amount(summary.credits.unappliedPayments)]] as Array<[string, string]>) : []),
                ...(summary.credits.unappliedCreditNotes ? ([["Unapplied credit notes", amount(summary.credits.unappliedCreditNotes)]] as Array<[string, string]>) : []),
              ]}
            />
          </div>
        )}
      </section>

      <div className="cust-overview-side">
        {((c.children?.length ?? 0) > 0 || c.parent) && (
          <section className="panel cust-card">
            <div className="cust-card-head">
              <h3>{c.children?.length ? "Sub-customers" : "Parent customer"}</h3>
              {c.children?.length ? <span className="muted small">Total with sub-customers: {currency} {amount(c.balanceWithSubCustomers ?? 0)}</span> : null}
            </div>
            <ul className="cust-mini">
              {c.parent && (
                <li>
                  <button type="button" onClick={() => navigate(`/customers/${c.parent!.id}`)}>
                    <span className="cust-mini-main">
                      <span className="strong">{c.parent.name}</span>
                      <span className="sub">Parent · {c.parent.code}</span>
                    </span>
                  </button>
                </li>
              )}
              {c.children?.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => navigate(`/customers/${k.id}`)}>
                    <span className="cust-mini-main">
                      <span className="strong">{k.name}</span>
                      <span className="sub">
                        {k.code}
                        {k.status === "INACTIVE" ? " · inactive" : ""}
                      </span>
                    </span>
                    <span className="num strong">{amount(k.balance)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Contacts customer={c} onChanged={onChanged} />
        <section className="panel cust-card">
          <div className="cust-card-head">
            <h3>Open invoices</h3>
            <button type="button" className="link-button" onClick={() => onTab("invoices")}>
              View all
            </button>
          </div>
          <Loadable resource={openInvoices} skeleton={<SkeletonRows rows={3} cols={3} />}>
            {(p) =>
              p.rows.length ? (
                <MiniTxnList rows={p.rows} onOpen={onOpen} showDue />
              ) : (
                <p className="muted small">No open invoices — everything invoiced is paid.</p>
              )
            }
          </Loadable>
        </section>
        <section className="panel cust-card">
          <div className="cust-card-head">
            <h3>Recent transactions</h3>
            <button type="button" className="link-button" onClick={() => onTab("transactions")}>
              View all
            </button>
          </div>
          <Loadable resource={recent} skeleton={<SkeletonRows rows={3} cols={3} />}>
            {(p) => (p.rows.length ? <MiniTxnList rows={p.rows} onOpen={onOpen} /> : <p className="muted small">No transactions yet.</p>)}
          </Loadable>
        </section>
      </div>
    </div>
  );
}

function MiniTxnList({ rows, onOpen, showDue }: { rows: CustomerTxnRow[]; onOpen: (r: CustomerTxnRow) => void; showDue?: boolean }) {
  return (
    <ul className="cust-mini">
      {rows.map((r) => (
        <li key={`${r.type}-${r.id}`}>
          <button type="button" onClick={() => onOpen(r)}>
            <span className="cust-mini-main">
              <span className="strong">
                {r.isOpening ? "Opening balance" : TYPE_LABEL[r.type]} {r.number}
              </span>
              <span className="sub">{showDue && r.dueDate ? `Due ${date(r.dueDate)}` : date(r.date)}</span>
            </span>
            <span className="cust-mini-amt">
              <span className="num strong">{amount(showDue ? r.open : r.total)}</span>
              <Badge tone={r.statusTone}>{r.status}</Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ── Transaction table (server-paged) ──────────────────── */

function TxnTable({
  customerId,
  type: fixedType,
  onOpen,
  action,
  filters,
  statusFilter,
  empty,
}: {
  customerId: string;
  type?: CustomerTxnType;
  onOpen: (r: CustomerTxnRow) => void;
  action?: (r: CustomerTxnRow) => ReactNode;
  filters?: boolean;
  statusFilter?: boolean;
  empty?: ReactNode;
}) {
  const { currency } = useCompany();
  const [type, setType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePagedResource<CustomerTxnRow>(
    `/api/v1/ar/customers/${customerId}/transactions`,
    { type: fixedType ?? (type || undefined), status: status || undefined, from: from || undefined, to: to || undefined },
    { key: "customer-txns", defaultPageSize: 25 },
  );
  const totals = (list.data as CustomerTxnPage | undefined)?.totals;

  const columns: Column<CustomerTxnRow>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (r) => date(r.date) },
    ...(fixedType ? [] : [{ key: "type", header: "Type", render: (r: CustomerTxnRow) => (r.isOpening ? "Opening balance" : TYPE_LABEL[r.type]) }]),
    {
      key: "number",
      header: "No.",
      render: (r) => (
        <>
          <span className="strong nowrap link-like">{r.number}</span>
          {r.description && <span className="sub">{r.description}</span>}
        </>
      ),
    },
    { key: "due", header: "Due", className: "hide-sm nowrap", render: (r) => (r.dueDate ? date(r.dueDate) : <span className="subtle">—</span>) },
    { key: "total", header: `Total (${currency})`, numeric: true, render: (r) => (r.posting ? amount(r.total) : <span className="muted" title="Doesn't affect the balance">{amount(r.total)}</span>) },
    {
      key: "open",
      header: fixedType === "PAYMENT" || fixedType === "CREDIT_NOTE" ? "Unapplied" : "Open",
      numeric: true,
      className: "hide-sm",
      render: (r) => (!r.posting ? <span className="subtle">—</span> : r.open > 0.005 ? <span className="strong">{amount(r.open)}</span> : <span className="subtle">0</span>),
    },
    { key: "status", header: "Status", render: (r) => <Badge tone={r.statusTone}>{r.status}</Badge> },
    ...(action ? [{ key: "act", header: <span className="sr-only">Actions</span>, width: 100, render: action }] : []),
  ];

  return (
    <>
      {(filters || statusFilter) && (
        <div className="cust-toolbar">
          {filters && (
            <Select
              aria-label="Transaction type"
              className="cust-select"
              value={type}
              onChange={setType}
              searchable={false}
              options={[
                { value: "", label: "All transactions" },
                ...(Object.keys(TYPE_LABEL) as CustomerTxnType[]).map((t) => ({ value: t, label: `${TYPE_LABEL[t]}s`, hint: isCommercial(t) ? "Not posted" : undefined })),
              ]}
            />
          )}
          <Select
            aria-label="Status"
            className="cust-select"
            value={status}
            onChange={setStatus}
            searchable={false}
            options={[
              { value: "", label: "Any status" },
              { value: "open", label: "Open" },
              { value: "overdue", label: "Overdue" },
              { value: "closed", label: "Paid / closed" },
            ]}
          />
          {filters && (
            <>
              <label className="cust-date">
                <span className="sr-only">From</span>
                <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              </label>
              <span className="muted">to</span>
              <label className="cust-date">
                <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
              </label>
              {(type || status || from || to) && (
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => {
                    setType("");
                    setStatus("");
                    setFrom("");
                    setTo("");
                  }}
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      )}
      {list.error && !list.data ? (
        <div className="panel">
          <ErrorState message={list.error} onRetry={list.reload} />
        </div>
      ) : (
        <div className={list.refreshing ? "is-refreshing" : undefined}>
          <DataTable
            columns={columns}
            rows={list.rows}
            rowKey={(r) => `${r.type}-${r.id}`}
            loading={list.loading}
            showPagination={false}
            onRowClick={onOpen}
            empty={empty ?? <EmptyState title="No transactions" body="Nothing matches these filters." />}
            footer={
              totals && list.total > 0 ? (
                <tr>
                  <td colSpan={fixedType ? 3 : 4}>
                    Total · {plural(list.total, "transaction")}
                  </td>
                  <td className="num">{amount(totals.total)}</td>
                  <td className="num hide-sm">{amount(totals.open)}</td>
                  <td colSpan={action ? 2 : 1} />
                </tr>
              ) : undefined
            }
          />
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} label="Transaction pages" />
        </div>
      )}
    </>
  );
}

/* ── Deposits (payments tab) ───────────────────────────── */

function Deposits({ customerId, manage, onApply, onChanged }: { customerId: string; manage: boolean; onApply: (d: ArDeposit) => void; onChanged: () => void }) {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const deposits = useResource<ArDeposit[]>(`/api/v1/ar/customers/${customerId}/deposits`);
  if (!deposits.data?.length) return null;

  async function refund(d: ArDeposit) {
    const ok = await confirm({
      title: `Refund deposit ${d.depositNumber}?`,
      body: `This pays back the unused ${currency} ${amount(d.remaining)} by ${humanize(d.method).toLowerCase()} today and posts the journal. It can't be undone.`,
      confirmLabel: "Refund deposit",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/ar/deposits/${d.id}/refund`, { method: "POST" });
      toast(`Deposit ${d.depositNumber} refunded`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const columns: Column<ArDeposit>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (d) => date(d.depositDate) },
    {
      key: "number",
      header: "Deposit",
      render: (d) => (
        <>
          <span className="strong nowrap">{d.depositNumber}</span>
          <span className="sub">{[humanize(d.method), d.reference, d.description].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    { key: "amount", header: "Received", numeric: true, className: "hide-sm", render: (d) => amount(d.amount) },
    {
      key: "remaining",
      header: `Available (${currency})`,
      numeric: true,
      render: (d) => (d.remaining > 0 ? <span className="strong">{amount(d.remaining)}</span> : <span className="subtle">0</span>),
    },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 160,
            render: (d: ArDeposit) =>
              d.status === "POSTED" && d.remaining > 0 ? (
                <span className="row-actions no-print" style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => onApply(d)}>
                    Apply
                  </button>
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => void refund(d)}>
                    Refund
                  </button>
                </span>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="section">
      <h3 className="cust-subhead">Deposits</h3>
      <p className="muted small">Money received before invoicing, held until it's applied to an invoice or refunded.</p>
      <DataTable columns={columns} rows={deposits.data} rowKey={(d) => d.id} initialSort={{ key: "date", dir: "desc" }} />
    </div>
  );
}

/* ── Notes & activity ──────────────────────────────────── */

function NotesAndActivity({ customerId, manage, onOpen }: { customerId: string; manage: boolean; onOpen: (r: { type: CustomerTxnType; id: string }) => void }) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const notes = useResource<CustomerNote[]>(`/api/v1/ar/customers/${customerId}/notes`);
  const activity = useResource<CustomerActivityItem[]>(`/api/v1/ar/customers/${customerId}/activity`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/api/v1/ar/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ body: text }) });
      setText("");
      notes.reload();
      toast("Note added");
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cust-overview">
      <section className="panel cust-card">
        <h3>Notes</h3>
        {manage && (
          <div className="cust-note-form">
            <textarea
              className="input"
              rows={3}
              placeholder="Call log, promise to pay, delivery instructions…"
              value={text}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              aria-label="New note"
            />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void add()}>
              {busy ? "Adding…" : "Add note"}
            </button>
          </div>
        )}
        <Loadable resource={notes} skeleton={<SkeletonRows rows={2} cols={2} />}>
          {(rows) =>
            rows.length ? (
              <ul className="cust-notes">
                {rows.map((n) => (
                  <li key={n.id}>
                    <p className="pre">{n.body}</p>
                    <span className="sub">
                      {n.authorName ?? `User ${n.erpUserId}`} · {dateTime(n.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No notes yet.</p>
            )
          }
        </Loadable>
      </section>
      <section className="panel cust-card">
        <h3>Activity</h3>
        <Loadable resource={activity} skeleton={<SkeletonRows rows={4} cols={2} />}>
          {(items) =>
            items.length ? (
              <ol className="cust-timeline">
                {items.map((a) => {
                  const type = a.docType ? DOC_TO_TYPE[a.docType] : undefined;
                  return (
                    <li key={a.id} className={a.kind}>
                      <span className="cust-timeline-dot" aria-hidden="true" />
                      <div>
                        {type && a.docId ? (
                          <button type="button" className="link-button strong" onClick={() => onOpen({ type, id: a.docId! })}>
                            {a.title}
                          </button>
                        ) : (
                          <span className="strong">{a.title}</span>
                        )}
                        {a.amount !== null && <span className="num muted"> · {a.amount < 0 ? `−${amount(-a.amount)}` : amount(a.amount)}</span>}
                        {a.detail && <span className="sub">{a.detail}</span>}
                        <span className="sub">{dateTime(a.at)}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="muted small">No activity yet.</p>
            )
          }
        </Loadable>
      </section>
    </div>
  );
}

/* ── Payment / credit note / debit note / deposit detail ─ */

function TxnDrawer({
  type,
  id,
  onClose,
  onOpenInvoice,
  onReverse,
}: {
  type: Exclude<CustomerPostingType, "INVOICE">;
  id: string;
  onClose: () => void;
  onOpenInvoice: (invoiceId: string) => void;
  onReverse?: (d: { id: string; number: string; total: number }) => void;
}) {
  const { currency } = useCompany();
  const detail = useResource<CustomerTxnDetail>(`/api/v1/ar/transactions/${type}/${id}`);
  const d = detail.data;
  return (
    <Drawer
      title={d ? `${TYPE_LABEL[type]} ${d.number}` : TYPE_LABEL[type]}
      subtitle={d && `${d.customer.name} · ${date(d.date)}${d.status === "REVERSED" ? " · reversed" : ""}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {d && onReverse && type === "PAYMENT" && d.status === "POSTED" && (
            <button type="button" className="btn btn-danger" onClick={() => onReverse(d)}>
              Reverse payment
            </button>
          )}
        </>
      }
    >
      <Loadable resource={detail}>
        {(t) => (
          <>
            <SummaryRows
              rows={[
                ...(t.method ? ([["Method", humanize(t.method)]] as Array<[string, string]>) : []),
                ...(t.reference ? ([[type === "PAYMENT" || type === "DEPOSIT" ? "Reference" : "Reason", t.reference]] as Array<[string, string]>) : []),
                ...(t.dueDate ? ([["Due", date(t.dueDate)]] as Array<[string, string]>) : []),
                ...(t.net !== undefined ? ([["Amount before tax", amount(t.net, 2)], ["Tax", amount(t.tax ?? 0, 2)]] as Array<[string, string]>) : []),
                [`Total (${currency})`, amount(t.total, 2), true],
                [type === "DEBIT_NOTE" ? "Still owed" : "Not yet applied", amount(t.open, 2)],
              ]}
            />
            {t.description && <p className="small">{t.description}</p>}
            <h3 className="cust-subhead">Applied to</h3>
            {t.applications.length > 0 && <p className="muted small">Open an invoice to take this off it again.</p>}
            {t.applications.length ? (
              <ul className="cust-mini">
                {t.applications.map((a) => (
                  <li key={a.applicationId ?? a.invoiceId}>
                    <button type="button" onClick={() => onOpenInvoice(a.invoiceId)}>
                      <span className="cust-mini-main">
                        <span className="strong">Invoice {a.invoiceNumber}</span>
                        <span className="sub">{date(a.date)}</span>
                      </span>
                      <span className="num strong">{amount(a.amount, 2)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{type === "DEBIT_NOTE" ? "Debit notes are charges, not applied to invoices." : "Not applied to any invoice yet."}</p>
            )}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

/* ── Estimate / sales order / delayed charge or credit ─── */

const CONVERT: Record<string, { target: "INVOICE" | "CREDIT_NOTE"; label: string; statuses: string[] }> = {
  ESTIMATE: { target: "INVOICE", label: "Convert to invoice", statuses: ["PENDING", "ACCEPTED"] },
  PROPOSAL: { target: "INVOICE", label: "Convert to invoice", statuses: ["PENDING", "ACCEPTED"] },
  SALES_ORDER: { target: "INVOICE", label: "Convert to invoice", statuses: ["OPEN"] },
  DELAYED_CHARGE: { target: "INVOICE", label: "Convert to invoice", statuses: ["OPEN"] },
  DELAYED_CREDIT: { target: "CREDIT_NOTE", label: "Convert to credit note", statuses: ["OPEN"] },
};

const COMMERCIAL_LABEL: Record<string, string> = {
  ESTIMATE: "Estimate",
  PROPOSAL: "Proposal",
  SALES_ORDER: "Sales order",
  DELAYED_CHARGE: "Delayed charge",
  DELAYED_CREDIT: "Delayed credit",
};

function CommercialDrawer({
  id,
  manage,
  onClose,
  onOpenInvoice,
  onChanged,
}: {
  id: string;
  manage: boolean;
  onClose: () => void;
  onOpenInvoice: (invoiceId: string) => void;
  onChanged: () => void;
}) {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const doc = useResource<CommercialDoc>(`/api/v1/commercial/documents/${id}`);
  const [busy, setBusy] = useState(false);
  const d = doc.data;
  const rule = d ? CONVERT[d.kind] : undefined;
  const canConvert = manage && d && rule && rule.statuses.includes(d.status);

  async function convert() {
    if (!d || !rule) return;
    const ok = await confirm({
      title: `${rule.label.replace("Convert", "Turn")} ${d.number}?`,
      body:
        rule.target === "INVOICE"
          ? `This posts an invoice for ${d.currency} ${amount(d.total, 2)} to the customer's account and the ledger, dated today.`
          : `This posts a credit note for ${d.currency} ${amount(d.total, 2)} to the customer's account and the ledger, dated today.`,
      confirmLabel: rule.label,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ convertedToId?: string; convertedToNumber?: string; convertedToType?: string }>(`/api/v1/commercial/documents/${d.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ target: rule.target }),
      });
      toast(`${COMMERCIAL_LABEL[d.kind]} ${d.number} converted${res.convertedToNumber ? ` to ${res.convertedToNumber}` : ""}`);
      doc.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={d ? `${COMMERCIAL_LABEL[d.kind] ?? "Document"} ${d.number}` : "Document"}
      subtitle={d && `${d.partyName} · ${date(d.docDate)} · ${humanize(d.status)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {canConvert && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void convert()}>
              {busy ? "Converting…" : rule!.label}
            </button>
          )}
        </>
      }
    >
      <Loadable resource={doc}>
        {(x) => (
          <>
            <p className="notice-inline" style={{ background: "var(--accent-soft)", color: "var(--ink-2)" }}>
              {x.status === "CONVERTED"
                ? "This document has been converted; the posted document below is what affects the balance."
                : x.kind === "DELAYED_CREDIT" || x.kind === "DELAYED_CHARGE"
                ? "Recorded for later. It doesn't change the balance until it's added to an invoice or credit note."
                : "Not posted. It doesn't change the customer's balance until it becomes an invoice."}
            </p>
            {x.convertedToId && x.convertedToNumber && (
              <p className="small">
                Converted to{" "}
                {x.convertedToType === "ArInvoice" ? (
                  <button type="button" className="link-button" onClick={() => onOpenInvoice(x.convertedToId!)}>
                    invoice {x.convertedToNumber}
                  </button>
                ) : (
                  <strong>{x.convertedToNumber}</strong>
                )}
              </p>
            )}
            {x.lines.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="num">Qty</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="num">{toNumber(l.quantity)}</td>
                        <td className="num">{amount(l.unitPrice, 2)}</td>
                        <td className="num">{amount(l.net, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <SummaryRows
              rows={[
                ["Amount before tax", amount(x.net, 2)],
                ["Tax", amount(x.tax, 2)],
                [`Total (${x.currency})`, amount(x.total, 2), true],
                ...(x.expirationDate ? ([["Expires", date(x.expirationDate)]] as Array<[string, string]>) : []),
              ]}
            />
            {(x.memo || x.note) && <p className="small muted">{x.note || x.memo}</p>}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

/* ── Extra contacts ────────────────────────────────────── */

function Contacts({ customer: c, onChanged }: { customer: Customer; onChanged: () => void }) {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const manage = can("ar:manage");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const contacts = c.contacts ?? [];
  if (!manage && !contacts.length) return null;

  async function add() {
    if (!form.name.trim()) return toast("Enter the contact's name", { error: true });
    setBusy(true);
    try {
      await api(`/api/v1/ar/customers/${c.id}/contacts`, { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", role: "", email: "", phone: "" });
      setAdding(false);
      toast("Contact added");
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    try {
      await api(`/api/v1/ar/customers/${c.id}/contacts/${id}`, { method: "DELETE" });
      toast(`${name} removed`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <section className="panel cust-card">
      <div className="cust-card-head">
        <h3>Other contacts</h3>
        {manage && !adding && (
          <button type="button" className="link-button" onClick={() => setAdding(true)}>
            Add contact
          </button>
        )}
      </div>
      {contacts.length > 0 ? (
        <ul className="cust-mini">
          {contacts.map((k) => (
            <li key={k.id}>
              <div className="inv-app">
                <span className="cust-mini-main">
                  <span className="strong">
                    {k.name}
                    {k.role ? <span className="muted"> · {k.role}</span> : null}
                  </span>
                  <span className="sub">{[k.email, k.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                </span>
                {manage && (
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => void remove(k.id, k.name)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="muted small">Add people like the accounts clerk or site manager.</p>
      )}
      {adding && (
        <div className="form-grid cust-contact-form">
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Accounts payable" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="span-2" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void add()}>
              {busy ? "Saving…" : "Save contact"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Merge ─────────────────────────────────────────────── */

function MergeDrawer({ customer: c, onClose }: { customer: Customer; onClose: () => void }) {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const list = useResource<Customer[]>("/api/v1/ar/customers");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = (list.data ?? []).filter((x) => x.id !== c.id && x.currency === c.currency).map((x) => ({ value: x.id, label: x.name, hint: x.code }));
  const chosen = list.data?.find((x) => x.id === target);

  async function merge() {
    if (!chosen) return setError("Choose the customer to keep.");
    const ok = await confirm({
      title: `Merge ${c.name} into ${chosen.name}?`,
      body: `Every invoice, payment, credit, note and document of ${c.name} moves to ${chosen.name}, and ${c.name} is deleted. Balances add up; nothing is reposted. This can't be undone.`,
      confirmLabel: "Merge customers",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ targetId: string }>(`/api/v1/ar/customers/${c.id}/merge`, { method: "POST", body: JSON.stringify({ intoCustomerId: chosen.id }) });
      toast(`${c.name} merged into ${chosen.name}`);
      navigate(`/customers/${res.targetId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={`Merge ${c.name}`}
      subtitle="For duplicates: combine this customer into the one you keep."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" disabled={busy || !target} onClick={() => void merge()}>
            {busy ? "Merging…" : "Merge"}
          </button>
        </>
      }
    >
      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      <Field label="Keep this customer" required hint={`Only customers in ${c.currency} are listed. ${c.name} is removed after the merge.`}>
        <Select value={target} onChange={setTarget} searchable placeholder={list.loading ? "Loading…" : "Choose a customer…"} options={options} />
      </Field>
      {chosen && (
        <SummaryRows
          rows={[
            [`${c.name} balance`, amount(c.balance)],
            [`${chosen.name} balance`, amount(chosen.balance)],
            ["Combined balance", amount(toNumber(c.balance) + toNumber(chosen.balance)), true],
          ]}
        />
      )}
    </Drawer>
  );
}

/* ── Statements tab ────────────────────────────────────── */

function Statements({ customer: c, manage, onSent }: { customer: Customer; manage: boolean; onSent: () => void }) {
  const [emailing, setEmailing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  return (
    <>
      {manage && (
        <div className="cust-statement-email">
          {!emailing ? (
            <button type="button" className="btn btn-sm" onClick={() => setEmailing(true)}>
              Email statement
            </button>
          ) : (
            <>
              <div className="cust-toolbar" style={{ borderRadius: "var(--radius-lg)", borderBottom: "1px solid var(--line)" }}>
                <span className="muted small">Statement period</span>
                <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Statement from" style={{ width: 160 }} />
                <span className="muted">to</span>
                <input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} aria-label="Statement to" style={{ width: 160 }} />
              </div>
              <EmailComposer
                title={`Email statement to ${c.name}`}
                defaultTo={c.email}
                endpoint={`/api/v1/ar/customers/${c.id}/statement/email`}
                extraBody={{ from, toDate: to }}
                sendLabel="Send statement"
                onSent={onSent}
                onCancel={() => setEmailing(false)}
              />
            </>
          )}
        </div>
      )}
      <PeriodStatementView kind="customer" partyId={c.id} partyCode={c.code} />
    </>
  );
}

import { ArrowLeft, Building2, CalendarClock, Mail, MapPin, Phone, Printer } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  AdvanceForm,
  AllocateAdvanceForm,
  BillForm,
  methodLabel,
  PaymentForm,
  RefundAdvanceForm,
  ReversePaymentForm,
  SupplierCreditNoteForm,
  SupplierDebitNoteForm,
  VoidBillForm,
} from "../components/ApForms";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { MoneyBar, PAYABLES_LABELS } from "../components/customers/MoneyBar";
import { type Column, DataTable } from "../components/DataTable";
import { PdfButton } from "../components/Documents";
import { useFeedback } from "../components/feedback";
import { SummaryRows } from "../components/forms";
import { Select } from "../components/Select";
import { SupplierFormDrawer } from "../components/suppliers/SupplierFormDrawer";
import { BillDrawer, poStatus, PurchaseOrderDrawer, SUPPLIER_TXN_LABEL, SupplierTxnDrawer } from "../components/suppliers/SupplierTxnDrawers";
import { Badge, EmptyState, ErrorState, Loadable, Menu, PageHeader, Pagination, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, humanize, isoDay, plural, toNumber } from "../lib/format";
import { usePagedResource } from "../lib/pagination";
import { Link, navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type {
  ApAdvance,
  ApBill,
  ApPayment,
  CommercialDoc,
  Supplier,
  SupplierActivityItem,
  SupplierCredit,
  SupplierNote,
  SupplierPeriodStatement,
  SupplierSummary,
  SupplierTxnPage,
  SupplierTxnRow,
  SupplierTxnType,
} from "../lib/types";
import { SupplierStatusBadge } from "./Suppliers";

type Tab = "overview" | "transactions" | "purchase-orders" | "bills" | "payments" | "credits" | "statements" | "notes";

const TABS: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["transactions", "Transactions"],
  ["purchase-orders", "Purchase orders"],
  ["bills", "Bills"],
  ["payments", "Payments"],
  ["credits", "Supplier credits"],
  ["statements", "Statements"],
  ["notes", "Notes & activity"],
];

type Dialog =
  | null
  | { kind: "bill" | "credit" | "debit" | "advance" | "edit" }
  | { kind: "pay"; billId?: string }
  | { kind: "void"; bill: ApBill }
  | { kind: "reverse"; payment: ApPayment }
  | { kind: "allocate" | "refund"; advanceId: string };

type Viewing = { type: SupplierTxnType; id: string } | null;

/** Ledger doc types → the document they came from, for the activity timeline. */
const DOC_TO_TYPE: Record<string, SupplierTxnType | undefined> = {
  BILL: "BILL",
  OPENING: "BILL",
  BILL_VOID: "BILL",
  PAYMENT: "PAYMENT",
  PAYMENT_REVERSAL: "PAYMENT",
  CREDIT_NOTE: "CREDIT_NOTE",
  DEBIT_NOTE: "DEBIT_NOTE",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * The supplier profile, on the QuickBooks vendor model: the whole relationship with one supplier in one place.
 * Figures come from GET /ap/suppliers/:id/summary; lists from /transactions; documents open in drawers.
 */
export function SupplierDetail({ id }: { id: string }) {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const requested = query.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.some(([k]) => k === requested) ? requested : "overview";
  const [dialog, setDialog] = useState<Dialog>(null);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [version, setVersion] = useState(0);

  const supplier = useResource<Supplier>(`/api/v1/ap/suppliers/${id}`);
  const summary = useResource<SupplierSummary>(`/api/v1/ap/suppliers/${id}/summary`);
  const advances = useResource<ApAdvance[]>(dialog?.kind === "allocate" || dialog?.kind === "refund" ? `/api/v1/ap/advances?supplierId=${id}&v=${version}` : null);

  const refresh = useCallback(() => {
    supplier.reload();
    summary.reload();
    setVersion((v) => v + 1);
  }, [supplier, summary]);
  const close = useCallback(() => setDialog(null), []);
  const saved = useCallback(() => {
    setDialog(null);
    setViewing(null);
    refresh();
  }, [refresh]);

  async function setActive(s: Supplier, next: "ACTIVE" | "INACTIVE") {
    if (next === "INACTIVE") {
      const ok = await confirm({
        title: `Make ${s.name} inactive?`,
        body: "They will be hidden from supplier pickers on new transactions. History and reports are kept, and you can make them active again.",
        confirmLabel: "Make inactive",
      });
      if (!ok) return;
    }
    try {
      await api(`/api/v1/ap/suppliers/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      toast(next === "ACTIVE" ? `${s.name} is active again` : `${s.name} made inactive`);
      refresh();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const manage = can("ap:manage");
  const open = useCallback((row: { type: SupplierTxnType; id: string }) => setViewing({ type: row.type, id: row.id }), []);
  const advance = (advanceId: string) => advances.data?.find((a) => a.id === advanceId);

  return (
    <Loadable
      resource={supplier}
      skeleton={
        <>
          <PageHeader title={<span className="skeleton" style={{ width: 240, height: 22 }} />} back={{ to: "/suppliers", label: "Suppliers" }} />
          <SkeletonRows rows={4} />
        </>
      }
    >
      {(s) => {
        const active = s.status === "ACTIVE";
        const sum = summary.data;
        const address = [s.physicalAddress, s.sector, s.district, s.province, s.country].filter(Boolean).join(", ");
        return (
          <div className="cust-profile">
            <header className="cust-hero">
              <div className="cust-hero-main">
                <Link to="/suppliers" className="back no-print">
                  <ArrowLeft size={14} aria-hidden="true" />
                  Suppliers
                </Link>
                <div className="cust-hero-title">
                  <span className="cust-avatar" aria-hidden="true">
                    {initials(s.name)}
                  </span>
                  <div>
                    <h1>
                      {s.name} <SupplierStatusBadge supplier={s} />
                    </h1>
                    <p className="cust-hero-meta">
                      {[s.companyName && s.companyName !== s.name ? s.companyName : null, s.code, s.tin && `TIN ${s.tin}`, s.category && humanize(s.category)].filter(Boolean).join(" · ")}
                    </p>
                    {s.vatRegistered && (
                      <span className="cust-row-meta">
                        <span className="cust-chip">VAT registered</span>
                      </span>
                    )}
                  </div>
                </div>
                <ul className="cust-hero-contact">
                  {s.contactPerson && (
                    <li>
                      <Building2 size={14} aria-hidden="true" />
                      {s.contactPerson}
                    </li>
                  )}
                  {s.email && (
                    <li>
                      <Mail size={14} aria-hidden="true" />
                      <a href={`mailto:${s.email}`}>{s.email}</a>
                    </li>
                  )}
                  {(s.telephone || s.mobile) && (
                    <li>
                      <Phone size={14} aria-hidden="true" />
                      {[s.telephone, s.mobile].filter(Boolean).join(" · ")}
                    </li>
                  )}
                  {address && (
                    <li>
                      <MapPin size={14} aria-hidden="true" />
                      {address}
                    </li>
                  )}
                  <li>
                    <CalendarClock size={14} aria-hidden="true" />
                    {s.creditPeriodDays ? `Net ${s.creditPeriodDays}` : "Due on receipt"}
                    {s.preferredPaymentMethod ? ` · pay by ${methodLabel(s.preferredPaymentMethod).toLowerCase()}` : ""}
                  </li>
                  {!s.email && !s.telephone && !s.mobile && manage && (
                    <li className="no-print">
                      <button type="button" className="link-button" onClick={() => setDialog({ kind: "edit" })}>
                        Add contact details
                      </button>
                    </li>
                  )}
                </ul>
              </div>

              <div className="cust-hero-side">
                {manage && (
                  <div className="cust-hero-actions no-print">
                    <button type="button" className="btn" onClick={() => setDialog({ kind: "edit" })}>
                      Edit
                    </button>
                    <Menu
                      label="More"
                      triggerClassName="btn"
                      items={[
                        { label: "Create statement", onSelect: () => setQueryParam("tab", "statements") },
                        { label: "Report: purchases by supplier", onSelect: () => navigate("/reports/purchases-by-supplier") },
                        { label: "Report: payables ageing", onSelect: () => navigate("/reports/payables-ageing") },
                        active
                          ? { label: "Make inactive", onSelect: () => void setActive(s, "INACTIVE") }
                          : { label: "Make active", onSelect: () => void setActive(s, "ACTIVE") },
                      ]}
                    />
                    {active && (
                      <Menu
                        label="New transaction"
                        triggerClassName="btn btn-primary"
                        items={[
                          { label: "Bill", onSelect: () => setDialog({ kind: "bill" }) },
                          { label: "Purchase order", onSelect: () => navigate(`/expenses/purchase-order/new?supplier=${s.id}`) },
                          { label: "Pay bills", onSelect: () => setDialog({ kind: "pay" }) },
                          { label: "Supplier credit", onSelect: () => setDialog({ kind: "credit" }) },
                          { label: "Debit note", onSelect: () => setDialog({ kind: "debit" }) },
                          { label: "Pay in advance", onSelect: () => setDialog({ kind: "advance" }) },
                        ]}
                      />
                    )}
                  </div>
                )}
                <div className="cust-hero-balance">
                  <div>
                    <span className="cust-hero-label">Open balance</span>
                    <span className={`cust-hero-amount ${sum && sum.outstanding < -0.005 ? "text-positive" : ""}`}>
                      <span className="mb-ccy">{s.currency}</span>
                      {sum ? amount(Math.abs(sum.outstanding)) : "…"}
                      {sum && sum.outstanding < -0.005 && <span className="cust-cr"> CR</span>}
                    </span>
                  </div>
                  <div>
                    <span className="cust-hero-label">Overdue</span>
                    <span className={`cust-hero-amount ${sum && sum.overdue > 0 ? "text-negative" : ""}`}>
                      <span className="mb-ccy">{s.currency}</span>
                      {sum ? amount(sum.overdue) : "…"}
                    </span>
                  </div>
                </div>
                {manage && active && (
                  <button type="button" className="btn btn-primary cust-hero-pay no-print" onClick={() => setDialog({ kind: "pay" })}>
                    Pay bills
                  </button>
                )}
              </div>
            </header>

            {!active && <p className="notice-inline">This supplier is inactive. Make them active to record new bills, orders or payments.</p>}

            {sum && sum.credits.advances > 0.005 && sum.openBillCount > 0 && manage && (
              <div className="cust-credit-banner no-print" role="status">
                <span>
                  You have <strong>{s.currency} {amount(sum.credits.advances, 2)}</strong> paid in advance to {s.name} and {plural(sum.openBillCount, "open bill")}.
                </span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setQueryParam("tab", "credits")}>
                  Review credits
                </button>
              </div>
            )}

            <SummaryStrip summary={summary} currency={s.currency} />

            <div className="section">
              <div className="tabs no-print" role="tablist" aria-label="Supplier sections">
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

              {tab === "overview" && <Overview supplier={s} summary={sum} version={version} onOpen={open} onTab={(t) => setQueryParam("tab", t)} />}

              {tab === "transactions" && <TxnTable key={`all-${version}`} supplierId={s.id} onOpen={open} filters />}

              {tab === "purchase-orders" && (
                <PurchaseOrders key={`po-${version}`} supplier={s} manage={manage && active} onOpen={(poId) => setViewing({ type: "PURCHASE_ORDER", id: poId })} />
              )}

              {tab === "bills" && (
                <TxnTable
                  key={`bill-${version}`}
                  supplierId={s.id}
                  type="BILL"
                  onOpen={open}
                  statusFilter
                  action={
                    manage
                      ? (r) =>
                          r.open > 0.005 && r.statusTone !== "neutral" ? (
                            <button
                              type="button"
                              className="btn btn-sm row-actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDialog({ kind: "pay", billId: r.id });
                              }}
                            >
                              Pay
                            </button>
                          ) : null
                      : undefined
                  }
                  empty={
                    <EmptyState
                      title="No bills yet"
                      body={`Bills from ${s.name} will be listed here with their due dates and what's left to pay.`}
                      action={
                        manage && active ? (
                          <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: "bill" })}>
                            Record a bill
                          </button>
                        ) : undefined
                      }
                    />
                  }
                />
              )}

              {tab === "payments" && (
                <>
                  <TxnTable
                    key={`pay-${version}`}
                    supplierId={s.id}
                    type="PAYMENT"
                    onOpen={open}
                    empty={<EmptyState title="No payments yet" body="Payments you make to this supplier will be listed here with the bills they paid." />}
                  />
                  <h3 className="cust-subhead">Advances</h3>
                  <p className="muted small">Money paid before the bill arrived. It sits in prepayments until it's applied to a bill or refunded.</p>
                  <TxnTable
                    key={`adv-${version}`}
                    supplierId={s.id}
                    type="ADVANCE"
                    onOpen={open}
                    empty={<EmptyState title="No advances" body="Use New transaction → Pay in advance to record a deposit or prepayment." />}
                  />
                </>
              )}

              {tab === "credits" && <Credits key={`cr-${version}`} supplier={s} manage={manage} onOpen={open} onApplyAdvance={(advanceId) => setDialog({ kind: "allocate", advanceId })} />}

              {tab === "statements" && <Statement supplier={s} />}

              {tab === "notes" && <NotesAndActivity key={`notes-${version}`} supplierId={s.id} manage={manage} onOpen={open} />}
            </div>

            {viewing?.type === "BILL" && (
              <BillDrawer
                id={viewing.id}
                manage={manage}
                onClose={() => setViewing(null)}
                onPay={(billId) => setDialog({ kind: "pay", billId })}
                onVoid={(bill) => setDialog({ kind: "void", bill })}
                onOpenPurchaseOrder={(poId) => setViewing({ type: "PURCHASE_ORDER", id: poId })}
              />
            )}
            {viewing?.type === "PURCHASE_ORDER" && (
              <PurchaseOrderDrawer
                id={viewing.id}
                manage={manage && active}
                canReceive={can("inventory:manage")}
                onClose={() => setViewing(null)}
                onOpenBill={(billId) => setViewing({ type: "BILL", id: billId })}
                onChanged={refresh}
              />
            )}
            {viewing && viewing.type !== "BILL" && viewing.type !== "PURCHASE_ORDER" && (
              <SupplierTxnDrawer
                key={`${viewing.type}-${viewing.id}`}
                type={viewing.type}
                id={viewing.id}
                manage={manage}
                onClose={() => setViewing(null)}
                onOpenBill={(billId) => setViewing({ type: "BILL", id: billId })}
                onOpen={open}
                onReverse={(payment) => setDialog({ kind: "reverse", payment })}
                onApplyAdvance={(advanceId) => setDialog({ kind: "allocate", advanceId })}
                onRefundAdvance={(advanceId) => setDialog({ kind: "refund", advanceId })}
              />
            )}

            {dialog?.kind === "bill" && <BillForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "pay" && <PaymentForm supplier={s} billId={dialog.billId} onClose={close} onSaved={saved} />}
            {dialog?.kind === "credit" && <SupplierCreditNoteForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "debit" && <SupplierDebitNoteForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "advance" && <AdvanceForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "edit" && <SupplierFormDrawer supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "void" && <VoidBillForm bill={dialog.bill} onClose={close} onSaved={saved} />}
            {dialog?.kind === "reverse" && <ReversePaymentForm payment={dialog.payment} onClose={close} onSaved={saved} />}
            {dialog?.kind === "allocate" && advance(dialog.advanceId) && <AllocateAdvanceForm advance={advance(dialog.advanceId)!} onClose={close} onSaved={saved} />}
            {dialog?.kind === "refund" && advance(dialog.advanceId) && <RefundAdvanceForm advance={advance(dialog.advanceId)!} onClose={close} onSaved={saved} />}
          </div>
        );
      }}
    </Loadable>
  );
}

/* ── Summary strip ─────────────────────────────────────── */

function SummaryStrip({ summary, currency }: { summary: { data?: SupplierSummary; error?: string; loading: boolean; reload: () => void }; currency: string }) {
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
      <MoneyBar
        labels={PAYABLES_LABELS}
        data={s ? { unbilled: s.moneyBar.purchaseOrders, overdue: s.moneyBar.overdue, notDue: s.moneyBar.notDue, paid30: s.moneyBar.paid30 } : undefined}
        loading={!s}
        currency={currency}
      />
      <section className="cust-stats" aria-label="Account summary">
        {stat("Total purchases", `${currency} ${amount(s?.totalPurchases)}`, s && `${plural(s.billCount, "bill")} and expenses, less credits`)}
        {stat("Payments made", `${currency} ${amount(s?.paymentsMade)}`, s && `${plural(s.paymentCount, "payment")}, advances included`)}
        {stat(
          "Credits available",
          `${currency} ${amount(s?.availableCredit)}`,
          s && (s.availableCredit > 0 ? "Credits, unapplied payments and advances" : "Nothing to apply"),
          s && s.availableCredit > 0 ? "text-positive" : undefined,
        )}
        {stat("Last transaction", last ? date(last.date) : "None yet", last ? `${humanize(last.docType)} ${last.docNumber ?? ""}`.trim() : undefined)}
      </section>
    </>
  );
}

/* ── Overview ──────────────────────────────────────────── */

function Overview({
  supplier: s,
  summary,
  version,
  onOpen,
  onTab,
}: {
  supplier: Supplier;
  summary?: SupplierSummary;
  version: number;
  onOpen: (r: { type: SupplierTxnType; id: string }) => void;
  onTab: (t: Tab) => void;
}) {
  const { can } = useSession();
  const openBills = useResource<SupplierTxnPage>(`/api/v1/ap/suppliers/${s.id}/transactions?type=BILL&status=open&pageSize=5&v=${version}`);
  const payments = useResource<SupplierTxnPage>(`/api/v1/ap/suppliers/${s.id}/transactions?type=PAYMENT&pageSize=5&v=${version}`);
  const orders = useResource<SupplierTxnPage>(`/api/v1/ap/suppliers/${s.id}/transactions?type=PURCHASE_ORDER&status=open&pageSize=5&v=${version}`);
  const recent = useResource<SupplierTxnPage>(`/api/v1/ap/suppliers/${s.id}/transactions?pageSize=6&v=${version}`);
  const detail = (label: string, value: ReactNode) =>
    value ? (
      <div className="cust-dl-row">
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;
  const wht = toNumber(s.whtRate);
  const address = [s.physicalAddress, s.sector, s.district, s.province, s.postalCode, s.country].filter(Boolean).join("\n");

  return (
    <div className="cust-overview">
      <section className="panel cust-card">
        <h3>Supplier details</h3>
        <dl className="cust-dl">
          {detail("Type", humanize(s.supplierType))}
          {detail("Contact person", s.contactPerson || [s.firstName, s.lastName].filter(Boolean).join(" "))}
          {detail("Email", s.email && <a href={`mailto:${s.email}`}>{s.email}</a>)}
          {detail("Phone", s.telephone)}
          {detail("Mobile", s.mobile)}
          {detail("Website", s.website)}
          {detail("Other contact", s.alternateContact)}
          {detail("Address", address && <span className="pre">{address}</span>)}
          {detail("TIN", s.tin)}
          {detail("VAT", s.vatRegistered ? `Registered${s.vatNumber ? ` · ${s.vatNumber}` : ""}` : "Not registered")}
          {detail("Registration no.", s.registrationNumber)}
          {detail("Withholding tax", wht ? `${wht}%${s.whtCategory ? ` · ${s.whtCategory}` : ""}` : null)}
          {detail("Terms", s.creditPeriodDays ? `Net ${s.creditPeriodDays}` : "Due on receipt")}
          {detail("Payment method", s.preferredPaymentMethod && methodLabel(s.preferredPaymentMethod))}
          {detail("Bank", s.bankName && [s.bankName, s.bankAccountHolder, s.bankAccountNumber].filter(Boolean).join(" · "))}
          {detail("Credit limit", toNumber(s.creditLimit) > 0 ? `${s.currency} ${amount(s.creditLimit)}${summary?.creditHeadroom != null ? ` · ${amount(Math.max(0, summary.creditHeadroom))} left` : ""}` : null)}
          {detail("Currency", s.currency)}
          {detail("Notes", s.notes && <span className="pre">{s.notes}</span>)}
          {detail("Internal remarks", s.internalRemarks && <span className="pre">{s.internalRemarks}</span>)}
        </dl>
        {summary && (summary.openingBalance > 0 || summary.debitNotesTotal > 0) && (
          <div className="cust-credits">
            <SummaryRows
              rows={[
                ...(summary.openingBalance ? ([["Opening balance", amount(summary.openingBalance)]] as Array<[string, string]>) : []),
                ...(summary.debitNotesTotal ? ([["Debit notes", amount(summary.debitNotesTotal)]] as Array<[string, string]>) : []),
              ]}
            />
          </div>
        )}
        <div className="cust-attachments">
          <AttachmentsPanel entityType="Supplier" entityId={s.id} title="Documents" />
        </div>
      </section>

      <div className="cust-overview-side">
        <section className="panel cust-card">
          <div className="cust-card-head">
            <h3>Outstanding bills{summary && summary.openBillCount ? ` (${summary.openBillCount})` : ""}</h3>
            <button type="button" className="link-button" onClick={() => onTab("bills")}>
              View all
            </button>
          </div>
          <Loadable resource={openBills} skeleton={<SkeletonRows rows={3} cols={3} />}>
            {(p) => (p.rows.length ? <MiniTxnList rows={p.rows} onOpen={onOpen} showDue /> : <p className="muted small">No open bills: everything billed is paid.</p>)}
          </Loadable>
        </section>
        <section className="panel cust-card">
          <div className="cust-card-head">
            <h3>Recent payments</h3>
            <button type="button" className="link-button" onClick={() => onTab("payments")}>
              View all
            </button>
          </div>
          <Loadable resource={payments} skeleton={<SkeletonRows rows={3} cols={3} />}>
            {(p) => (p.rows.length ? <MiniTxnList rows={p.rows} onOpen={onOpen} /> : <p className="muted small">No payments yet.</p>)}
          </Loadable>
        </section>
        <section className="panel cust-card">
          <div className="cust-card-head">
            <h3>Open purchase orders</h3>
            <button type="button" className="link-button" onClick={() => onTab("purchase-orders")}>
              View all
            </button>
          </div>
          <Loadable resource={orders} skeleton={<SkeletonRows rows={2} cols={3} />}>
            {(p) =>
              p.rows.length ? (
                <MiniTxnList rows={p.rows} onOpen={onOpen} />
              ) : (
                <p className="muted small">
                  No open orders.
                  {can("ap:manage") && s.status === "ACTIVE" && (
                    <>
                      {" "}
                      <button type="button" className="link-button" onClick={() => navigate(`/expenses/purchase-order/new?supplier=${s.id}`)}>
                        Create a purchase order
                      </button>
                    </>
                  )}
                </p>
              )
            }
          </Loadable>
        </section>
        <section className="panel cust-card">
          <div className="cust-card-head">
            <h3>Recent activity</h3>
            <button type="button" className="link-button" onClick={() => onTab("transactions")}>
              All transactions
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

const rowLabel = (r: SupplierTxnRow) => (r.isOpening ? "Opening balance" : SUPPLIER_TXN_LABEL[r.type]);

function MiniTxnList({ rows, onOpen, showDue }: { rows: SupplierTxnRow[]; onOpen: (r: SupplierTxnRow) => void; showDue?: boolean }) {
  return (
    <ul className="cust-mini">
      {rows.map((r) => (
        <li key={`${r.type}-${r.id}`}>
          <button type="button" onClick={() => onOpen(r)}>
            <span className="cust-mini-main">
              <span className="strong">
                {rowLabel(r)} {r.number}
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

const FILTER_TYPES: SupplierTxnType[] = ["BILL", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "ADVANCE", "EXPENSE", "PURCHASE_ORDER", "ITEM_RECEIPT"];
const NOT_POSTED: SupplierTxnType[] = ["EXPENSE", "PURCHASE_ORDER", "ITEM_RECEIPT"];

function TxnTable({
  supplierId,
  type: fixedType,
  onOpen,
  action,
  filters,
  statusFilter,
  empty,
}: {
  supplierId: string;
  type?: SupplierTxnType;
  onOpen: (r: SupplierTxnRow) => void;
  action?: (r: SupplierTxnRow) => ReactNode;
  filters?: boolean;
  statusFilter?: boolean;
  empty?: ReactNode;
}) {
  const { currency } = useCompany();
  const [type, setType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePagedResource<SupplierTxnRow>(
    `/api/v1/ap/suppliers/${supplierId}/transactions`,
    { type: fixedType ?? (type || undefined), status: status || undefined, from: from || undefined, to: to || undefined },
    { key: "supplier-txns", defaultPageSize: 25 },
  );
  const totals = (list.data as SupplierTxnPage | undefined)?.totals;
  const applied = fixedType === "PAYMENT" || fixedType === "CREDIT_NOTE" || fixedType === "ADVANCE";

  const columns: Column<SupplierTxnRow>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (r) => date(r.date) },
    ...(fixedType ? [] : [{ key: "type", header: "Type", render: (r: SupplierTxnRow) => rowLabel(r) }]),
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
    ...(fixedType === "PAYMENT" || fixedType === "ADVANCE"
      ? []
      : [{ key: "due", header: "Due", className: "hide-sm nowrap", render: (r: SupplierTxnRow) => (r.dueDate ? date(r.dueDate) : <span className="subtle">—</span>) }]),
    {
      key: "total",
      header: `Total (${currency})`,
      numeric: true,
      render: (r) => (r.posting ? amount(r.total) : <span className="muted" title="Doesn't change what you owe this supplier">{amount(r.total)}</span>),
    },
    {
      key: "open",
      header: applied ? "Unapplied" : "Balance",
      numeric: true,
      className: "hide-sm",
      render: (r) => (!r.posting ? <span className="subtle">—</span> : r.open > 0.005 ? <span className="strong">{amount(r.open)}</span> : <span className="subtle">0</span>),
    },
    { key: "status", header: "Status", render: (r) => <Badge tone={r.statusTone}>{r.status}</Badge> },
    ...(action ? [{ key: "act", header: <span className="sr-only">Actions</span>, width: 90, render: action }] : []),
  ];
  const dueCol = !(fixedType === "PAYMENT" || fixedType === "ADVANCE");

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
                ...FILTER_TYPES.map((t) => ({ value: t, label: `${SUPPLIER_TXN_LABEL[t]}s`, hint: NOT_POSTED.includes(t) ? "Not in balance" : undefined })),
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
              { value: "open", label: fixedType === "BILL" ? "Unpaid" : "Open" },
              { value: "overdue", label: "Overdue" },
              { value: "closed", label: fixedType === "BILL" ? "Paid" : "Paid / closed" },
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
            </>
          )}
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
              totals && list.total > 0 && fixedType !== "PURCHASE_ORDER" ? (
                <tr>
                  <td colSpan={(fixedType ? 2 : 3) + (dueCol ? 1 : 0)}>Total · {plural(list.total, "transaction")}</td>
                  {/* Bills and payments mixed together don't add up to anything; total one kind at a time. */}
                  <td className="num">{fixedType ? amount(totals.total) : ""}</td>
                  <td className="num hide-sm">{fixedType ? amount(totals.open) : ""}</td>
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

/* ── Purchase orders ───────────────────────────────────── */

/** Quantities on an order: what was ordered, received and billed. Stock lines are received; service lines only billed. */
function orderProgress(o: CommercialDoc) {
  let ordered = 0;
  let received = 0;
  let billed = 0;
  let stock = false;
  for (const l of o.lines) {
    const q = toNumber(l.quantity);
    ordered += q;
    billed += toNumber(l.billedQuantity ?? 0);
    if (l.itemId) {
      stock = true;
      received += toNumber(l.receivedQuantity ?? 0);
    } else received += q;
  }
  return { ordered, received, billed, stock };
}

function PurchaseOrders({ supplier: s, manage, onOpen }: { supplier: Supplier; manage: boolean; onOpen: (id: string) => void }) {
  const [show, setShow] = useState<"outstanding" | "all">("outstanding");
  const orders = useResource<CommercialDoc[]>(`/api/v1/commercial/purchase-order?supplierId=${s.id}`);
  const rows = useMemo(
    () => (orders.data ?? []).filter((o) => show === "all" || ["PENDING_APPROVAL", "OPEN", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status)),
    [orders.data, show],
  );
  const counts = useMemo(() => {
    const all = orders.data ?? [];
    return {
      outstanding: all.filter((o) => ["PENDING_APPROVAL", "OPEN", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status)).length,
      partly: all.filter((o) => o.status === "PARTIALLY_RECEIVED").length,
      all: all.length,
    };
  }, [orders.data]);

  const columns: Column<CommercialDoc>[] = [
    { key: "date", header: "Date", className: "nowrap", sortValue: (o) => o.docDate, render: (o) => date(o.docDate) },
    {
      key: "number",
      header: "Order",
      sortValue: (o) => o.number,
      render: (o) => (
        <>
          <span className="strong link-like">PO {o.number}</span>
          {(o.memo || o.lines[0]) && <span className="sub">{o.memo || o.lines.map((l) => l.description).join(", ")}</span>}
        </>
      ),
    },
    { key: "due", header: "Expected", className: "hide-sm nowrap", render: (o) => (o.dueDate ? date(o.dueDate) : <span className="subtle">—</span>) },
    {
      key: "progress",
      header: "Received / billed",
      className: "hide-sm",
      render: (o) => {
        const p = orderProgress(o);
        const pct = (n: number) => (p.ordered > 0 ? Math.min(100, (n / p.ordered) * 100) : 0);
        return (
          <span className="sup-progress" title={`${p.received} of ${p.ordered} received, ${p.billed} billed`}>
            <span className="small">
              {p.stock ? `${p.received}/${p.ordered} received` : "Services"} · {p.billed}/{p.ordered} billed
            </span>
            <span className="sup-progress-track" aria-hidden="true">
              {p.stock && <span className="sup-progress-fill" style={{ width: `${pct(p.received)}%` }} />}
              <span className="sup-progress-fill billed" style={{ width: `${pct(p.billed)}%` }} />
            </span>
          </span>
        );
      },
    },
    { key: "total", header: `Total (${s.currency})`, numeric: true, sortValue: (o) => toNumber(o.total), render: (o) => amount(o.total) },
    {
      key: "status",
      header: "Status",
      render: (o) => {
        const st = poStatus(o.status);
        return <Badge tone={st.tone}>{st.label}</Badge>;
      },
    },
  ];

  return (
    <>
      <div className="cust-toolbar">
        <div className="segmented" role="group" aria-label="Which orders">
          <button type="button" className={show === "outstanding" ? "on" : ""} onClick={() => setShow("outstanding")}>
            Outstanding <span className="count">{counts.outstanding}</span>
          </button>
          <button type="button" className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>
            All <span className="count">{counts.all}</span>
          </button>
        </div>
        {counts.partly > 0 && <span className="muted small">{plural(counts.partly, "order")} partly received</span>}
        <span className="grow" />
        {manage && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate(`/expenses/purchase-order/new?supplier=${s.id}`)}>
            New purchase order
          </button>
        )}
      </div>
      <Loadable resource={orders} skeleton={<SkeletonRows rows={3} />}>
        {() => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            onRowClick={(o) => onOpen(o.id)}
            initialSort={{ key: "date", dir: "desc" }}
            empty={
              <EmptyState
                title={show === "outstanding" ? "No outstanding purchase orders" : "No purchase orders yet"}
                body="Purchase orders record what you've ordered. Receive the goods against them, then bill what arrived."
                action={
                  manage ? (
                    <button type="button" className="btn btn-sm" onClick={() => navigate(`/expenses/purchase-order/new?supplier=${s.id}`)}>
                      Create a purchase order
                    </button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Loadable>
    </>
  );
}

/* ── Supplier credits ──────────────────────────────────── */

function Credits({
  supplier: s,
  manage,
  onOpen,
  onApplyAdvance,
}: {
  supplier: Supplier;
  manage: boolean;
  onOpen: (r: { type: SupplierTxnType; id: string }) => void;
  onApplyAdvance: (advanceId: string) => void;
}) {
  const credits = useResource<{ rows: SupplierCredit[]; total: number }>(`/api/v1/ap/suppliers/${s.id}/credits`);
  const columns: Column<SupplierCredit>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (c) => date(c.date) },
    {
      key: "number",
      header: "Credit",
      render: (c) => (
        <>
          <span className="strong link-like">
            {c.type === "PAYMENT" ? "Unapplied payment" : SUPPLIER_TXN_LABEL[c.type]} {c.number}
          </span>
          {c.description && <span className="sub">{c.description}</span>}
        </>
      ),
    },
    { key: "total", header: "Original", numeric: true, className: "hide-sm", render: (c) => amount(c.total) },
    { key: "available", header: `Available (${s.currency})`, numeric: true, render: (c) => <span className="strong">{amount(c.available)}</span> },
    {
      key: "act",
      header: <span className="sr-only">Actions</span>,
      width: 110,
      render: (c) =>
        manage && c.type === "ADVANCE" ? (
          <button
            type="button"
            className="btn btn-sm row-actions"
            onClick={(e) => {
              e.stopPropagation();
              onApplyAdvance(c.id);
            }}
          >
            Apply
          </button>
        ) : null,
    },
  ];
  return (
    <>
      <p className="muted small">
        Credits from {s.name} that haven't been set against a bill yet. Supplier credits and unapplied payments already reduce the open balance; advances reduce it when they're applied to a bill.
      </p>
      <Loadable resource={credits} skeleton={<SkeletonRows rows={2} />}>
        {(c) => (
          <DataTable
            columns={columns}
            rows={c.rows}
            rowKey={(r) => `${r.type}-${r.id}`}
            onRowClick={(r) => onOpen({ type: r.type, id: r.id })}
            empty={<EmptyState title="No credits to apply" body="Supplier credits, unapplied payments and advances appear here until they're used." />}
            footer={
              c.rows.length ? (
                <tr>
                  <td colSpan={2}>Total available</td>
                  <td className="hide-sm" />
                  <td className="num strong">{amount(c.total)}</td>
                  <td />
                </tr>
              ) : undefined
            }
          />
        )}
      </Loadable>
      <h3 className="cust-subhead">All supplier credits</h3>
      <TxnTable supplierId={s.id} type="CREDIT_NOTE" onOpen={onOpen} empty={<EmptyState title="No supplier credits" body="Record a supplier credit for returns, discounts or billing corrections from this supplier." />} />
    </>
  );
}

/* ── Statement ─────────────────────────────────────────── */

function firstOfYear() {
  return `${isoDay().slice(0, 4)}-01-01`;
}

const STATEMENT_DOC: Record<string, string> = {
  OPENING: "Opening balance",
  BILL: "Bill",
  BILL_VOID: "Bill voided",
  PAYMENT: "Payment",
  PAYMENT_REVERSAL: "Payment reversed",
  CREDIT_NOTE: "Supplier credit",
  DEBIT_NOTE: "Debit note",
  ADVANCE_APPLICATION: "Advance applied",
};

/** Supplier statement for a period: balance brought forward, bills, payments and credits, running balance, closing balance. */
function Statement({ supplier: s }: { supplier: Supplier }) {
  const { name: companyName } = useCompany();
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(isoDay);
  const valid = Boolean(from && to && from <= to);
  const range = `from=${from}&to=${to}`;
  const statement = useResource<SupplierPeriodStatement>(valid ? `/api/v1/ap/suppliers/${s.id}/period-statement?${range}` : null);
  type Entry = SupplierPeriodStatement["entries"][number];

  const preset = (key: string) => {
    const today = isoDay();
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    if (key === "month") return setFrom(`${today.slice(0, 7)}-01`), setTo(today);
    if (key === "last-month") {
      const start = new Date(Date.UTC(y, m - 2, 1));
      const end = new Date(Date.UTC(y, m - 1, 0));
      return setFrom(start.toISOString().slice(0, 10)), setTo(end.toISOString().slice(0, 10));
    }
    if (key === "quarter") return setFrom(`${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`), setTo(today);
    if (key === "year") return setFrom(`${y}-01-01`), setTo(today);
    if (key === "last-year") return setFrom(`${y - 1}-01-01`), setTo(`${y - 1}-12-31`);
  };

  const columns: Column<Entry>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (e) => date(e.entryDate) },
    {
      key: "doc",
      header: "Transaction",
      render: (e) => (
        <>
          {STATEMENT_DOC[e.docType] ?? humanize(e.docType)} <span className="muted">{e.docNumber}</span>
          {e.description && <span className="sub">{e.description}</span>}
        </>
      ),
    },
    { key: "credit", header: "Bills & charges", numeric: true, render: (e) => (e.credit ? amount(e.credit, 2) : "") },
    { key: "debit", header: "Payments & credits", numeric: true, render: (e) => (e.debit ? amount(e.debit, 2) : "") },
    { key: "balance", header: `Balance (${s.currency})`, numeric: true, render: (e) => <span className="strong">{amount(e.balance, 2)}</span> },
  ];

  return (
    <>
      <div className="sup-statement-head no-print">
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">From</span>
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">To</span>
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Select
          aria-label="Period"
          className="cust-select"
          value=""
          onChange={preset}
          searchable={false}
          placeholder="Quick period…"
          options={[
            { value: "month", label: "This month" },
            { value: "last-month", label: "Last month" },
            { value: "quarter", label: "This quarter" },
            { value: "year", label: "This year" },
            { value: "last-year", label: "Last year" },
          ]}
        />
        <span className="grow" />
        {valid && (
          <>
            <button type="button" className="btn" onClick={() => window.print()}>
              <Printer size={15} aria-hidden="true" /> Print
            </button>
            <PdfButton path={`/api/v1/ap/suppliers/${s.id}/statement.pdf?${range}`} filename={`supplier-statement-${s.code}-${from}-${to}.pdf`} label="Download PDF" className="btn" />
          </>
        )}
      </div>
      {!valid && <p className="field-error">The start date must be on or before the end date.</p>}
      {valid && (
        <Loadable resource={statement} skeleton={<SkeletonRows rows={4} />}>
          {(st) => (
            <>
              <div className="sup-statement-print">
                <strong>{companyName}</strong> · Supplier statement · {s.name} ({s.code}){s.tin ? ` · TIN ${s.tin}` : ""} · {date(st.from)} to {date(st.to)}
              </div>
              <div className="sup-statement-summary" aria-label="Statement summary">
                <div>
                  <span>Opening balance · {date(st.from)}</span>
                  <strong>{amount(st.openingBalance, 2)}</strong>
                </div>
                <div>
                  <span>Bills &amp; charges</span>
                  <strong>{amount(st.totalBilled, 2)}</strong>
                </div>
                <div>
                  <span>Payments &amp; credits</span>
                  <strong>{amount(st.totalPaid, 2)}</strong>
                </div>
                <div>
                  <span>Closing balance · {date(st.to)}</span>
                  <strong>{amount(st.closingBalance, 2)}</strong>
                </div>
              </div>
              <DataTable
                columns={columns}
                rows={st.entries}
                rowKey={(e) => e.id}
                empty={<EmptyState title="No activity in this period" body={`The balance stayed at ${s.currency} ${amount(st.openingBalance, 2)}.`} />}
                footer={
                  <tr>
                    <td colSpan={2}>Closing balance ({date(st.to)})</td>
                    <td className="num">{amount(st.totalBilled, 2)}</td>
                    <td className="num">{amount(st.totalPaid, 2)}</td>
                    <td className="num strong">{amount(st.closingBalance, 2)}</td>
                  </tr>
                }
              />
              <p className="muted small">A positive balance is what you owe {s.name}. Advances paid ahead appear when they're applied to a bill.</p>
            </>
          )}
        </Loadable>
      )}
    </>
  );
}

/* ── Notes & activity ──────────────────────────────────── */

function NotesAndActivity({ supplierId, manage, onOpen }: { supplierId: string; manage: boolean; onOpen: (r: { type: SupplierTxnType; id: string }) => void }) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const notes = useResource<SupplierNote[]>(`/api/v1/ap/suppliers/${supplierId}/notes`);
  const activity = useResource<SupplierActivityItem[]>(`/api/v1/ap/suppliers/${supplierId}/activity`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/api/v1/ap/suppliers/${supplierId}/notes`, { method: "POST", body: JSON.stringify({ body: text }) });
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
              placeholder="Price agreements, delivery issues, who to call about payments…"
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

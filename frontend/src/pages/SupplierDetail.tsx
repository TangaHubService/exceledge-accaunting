import { useCallback, useMemo, useState } from "react";
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
  SupplierForm,
} from "../components/ApForms";
import { type Column, DataTable } from "../components/DataTable";
import { Badge, DueStatus, EmptyState, Figure, Loadable, Menu, PageHeader, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, daysBetween, humanize, toNumber } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { ApAdvance, ApBill, ApPayment, Supplier, SupplierLedger, SupplierStatement } from "../lib/types";
import { SupplierStatusBadge } from "./Suppliers";

type Tab = "open" | "all" | "payments" | "advances" | "activity";
type Dialog =
  | null
  | { kind: "bill" | "credit" | "debit" | "advance" | "edit" }
  | { kind: "pay"; billId?: string }
  | { kind: "reverse"; payment: ApPayment }
  | { kind: "allocate" | "refund"; advance: ApAdvance };
type LedgerEntry = SupplierLedger["entries"][number];

const DOC_LABELS: Record<string, string> = {
  BILL: "Bill",
  PAYMENT: "Payment",
  PAYMENT_REVERSAL: "Payment reversed",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
  ADVANCE_APPLICATION: "Advance applied",
  OPENING: "Opening balance",
};

export function SupplierDetail({ id }: { id: string }) {
  const { can } = useSession();
  const { currency, name: companyName } = useCompany();
  const [tab, setTab] = useState<Tab>("open");
  const [dialog, setDialog] = useState<Dialog>(null);
  const manage = can("ap:manage");

  const supplier = useResource<Supplier>(`/api/v1/ap/suppliers/${id}`);
  const open = useResource<SupplierStatement>(`/api/v1/ap/suppliers/${id}/statement`);
  const full = useResource<SupplierStatement>(tab === "all" ? `/api/v1/ap/suppliers/${id}/statement?type=FULL` : null);
  const payments = useResource<ApPayment[]>(tab === "payments" ? `/api/v1/ap/payments?supplierId=${id}` : null);
  const advances = useResource<ApAdvance[]>(`/api/v1/ap/advances?supplierId=${id}`);
  const ledger = useResource<SupplierLedger>(tab === "activity" ? `/api/v1/ap/suppliers/${id}/ledger` : null);

  const refresh = useCallback(() => {
    supplier.reload();
    open.reload();
    full.reload();
    payments.reload();
    advances.reload();
    ledger.reload();
  }, [supplier, open, full, payments, advances, ledger]);
  const close = useCallback(() => setDialog(null), []);
  const saved = useCallback(() => {
    setDialog(null);
    refresh();
  }, [refresh]);

  const overdue = useMemo(() => (open.data?.rows ?? []).filter((r) => daysBetween(r.dueDate) > 0).reduce((s, r) => s + r.outstanding, 0), [open.data]);
  const advanceAvailable = useMemo(() => (advances.data ?? []).reduce((s, a) => s + a.remaining, 0), [advances.data]);

  const billColumns = (showPaid: boolean): Column<ApBill>[] => [
    {
      key: "number",
      header: "Bill",
      sortValue: (r) => r.billNumber,
      render: (r) => (
        <>
          <span className="strong nowrap">{r.billNumber}</span>
          <span className="sub">{[r.supplierInvoiceNumber && `Inv. ${r.supplierInvoiceNumber}`, r.description].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    { key: "date", header: "Date", className: "hide-md nowrap", sortValue: (r) => r.billDate, render: (r) => date(r.billDate) },
    { key: "due", header: "Due", className: "hide-sm nowrap", sortValue: (r) => r.dueDate, render: (r) => date(r.dueDate) },
    { key: "status", header: "Status", render: (r) => <DueStatus dueDate={r.dueDate} outstanding={r.outstanding} /> },
    { key: "gross", header: "Amount", numeric: true, className: "hide-sm", sortValue: (r) => r.gross, render: (r) => amount(r.gross) },
    {
      key: "outstanding",
      header: `Outstanding (${currency})`,
      numeric: true,
      sortValue: (r) => r.outstanding,
      render: (r) => (r.outstanding > 0 ? <span className="strong">{amount(r.outstanding)}</span> : <span className="subtle">0</span>),
    },
    ...(!showPaid && manage
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 80,
            render: (r: ApBill) => (
              <button
                type="button"
                className="btn btn-sm row-actions no-print"
                onClick={(e) => {
                  e.stopPropagation();
                  setDialog({ kind: "pay", billId: r.id });
                }}
              >
                Pay
              </button>
            ),
          },
        ]
      : []),
  ];

  const paymentColumns: Column<ApPayment>[] = [
    { key: "date", header: "Date", className: "nowrap", sortValue: (p) => p.paymentDate, render: (p) => date(p.paymentDate) },
    {
      key: "number",
      header: "Payment",
      sortValue: (p) => p.paymentNumber,
      render: (p) => (
        <>
          <span className="strong nowrap">{p.paymentNumber}</span>
          <span className="sub">{[methodLabel(p.method), p.reference, p.bills.map((b) => b.billNumber).join(", ")].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    { key: "wht", header: "WHT", numeric: true, className: "hide-sm", render: (p) => (p.withholdingTax ? amount(p.withholdingTax) : <span className="subtle">—</span>) },
    {
      key: "amount",
      header: `Paid (${currency})`,
      numeric: true,
      sortValue: (p) => p.amount,
      render: (p) => <span className={p.status === "REVERSED" ? "muted strike" : "strong"}>{amount(p.amount)}</span>,
    },
    { key: "status", header: <span className="sr-only">Status</span>, width: 96, render: (p) => (p.status === "REVERSED" ? <Badge tone="negative">Reversed</Badge> : null) },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 90,
            render: (p: ApPayment) =>
              p.status === "POSTED" && p.sourceModule === "AP" ? (
                <button type="button" className="btn btn-sm btn-quiet row-actions no-print" onClick={() => setDialog({ kind: "reverse", payment: p })}>
                  Reverse
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  const advanceColumns: Column<ApAdvance>[] = [
    { key: "date", header: "Date", className: "nowrap", sortValue: (a) => a.advanceDate, render: (a) => date(a.advanceDate) },
    {
      key: "number",
      header: "Advance",
      render: (a) => (
        <>
          <span className="strong nowrap">{a.advanceNumber}</span>
          <span className="sub">
            {[
              a.description,
              ...a.allocations.map((x) => `${amount(x.amount)} to ${x.billNumber}`),
              a.refunded > 0 && `${amount(a.refunded)} refunded`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>
      ),
    },
    { key: "amount", header: "Paid", numeric: true, className: "hide-sm", render: (a) => amount(a.amount) },
    {
      key: "remaining",
      header: `Available (${currency})`,
      numeric: true,
      render: (a) => (a.remaining > 0 ? <span className="strong">{amount(a.remaining)}</span> : <span className="subtle">0</span>),
    },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 160,
            render: (a: ApAdvance) =>
              a.remaining > 0 ? (
                <span className="row-actions no-print" style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: "allocate", advance: a })}>
                    Apply
                  </button>
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => setDialog({ kind: "refund", advance: a })}>
                    Refund
                  </button>
                </span>
              ) : null,
          },
        ]
      : []),
  ];

  const ledgerColumns: Column<LedgerEntry>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (e) => date(e.entryDate) },
    {
      key: "doc",
      header: "Transaction",
      render: (e) => (
        <>
          {DOC_LABELS[e.docType] ?? humanize(e.docType)} <span className="muted">{e.docNumber}</span>
          {e.description && <span className="sub">{e.description}</span>}
        </>
      ),
    },
    { key: "credit", header: "Billed", numeric: true, render: (e) => (toNumber(e.credit) ? amount(e.credit) : "") },
    { key: "debit", header: "Paid / credited", numeric: true, render: (e) => (toNumber(e.debit) ? amount(e.debit) : "") },
    { key: "balance", header: `We owe (${currency})`, numeric: true, render: (e) => <span className="strong">{amount(e.runningBalance)}</span> },
  ];

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
        const balance = toNumber(s.balance);
        const rate = toNumber(s.whtRate);
        const active = s.status === "ACTIVE";
        return (
          <>
            <PageHeader
              back={{ to: "/suppliers", label: "Suppliers" }}
              title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  {s.name} <SupplierStatusBadge supplier={s} />
                </span>
              }
              description={[s.code, s.category && humanize(s.category), s.tin && `TIN ${s.tin}`, s.telephone, s.email].filter(Boolean).join(" · ")}
              actions={
                <>
                  {manage && active && (
                    <>
                      <button type="button" className="btn" onClick={() => setDialog({ kind: "bill" })}>
                        Record bill
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "pay" })}>
                        Pay supplier
                      </button>
                    </>
                  )}
                  <Menu
                    label="More"
                    items={[
                      manage && active && { label: "Record credit note", onSelect: () => setDialog({ kind: "credit" }) },
                      manage && active && { label: "Record debit note", onSelect: () => setDialog({ kind: "debit" }) },
                      manage && active && { label: "Pay in advance", onSelect: () => setDialog({ kind: "advance" }) },
                      manage && { label: "Edit supplier", onSelect: () => setDialog({ kind: "edit" }) },
                      { label: "Print statement", onSelect: () => window.print() },
                    ]}
                  />
                </>
              }
            />

            <p className="muted small print-only" style={{ marginBottom: 12 }}>
              {companyName} · Supplier statement · {date(new Date())}
            </p>

            <section className="figures" aria-label="Account summary">
              <Figure lead label="We owe" currency={currency} value={amount(balance)} tone={balance < 0 ? "positive" : undefined} note={balance < 0 ? "Supplier owes us (prepaid)" : undefined} />
              <Figure
                label="Overdue"
                currency={currency}
                value={open.data ? amount(overdue) : "…"}
                tone={overdue > 0 ? "negative" : undefined}
                note={open.data && (overdue > 0 ? "Past the due date" : "Nothing overdue")}
              />
              <Figure label="Advances available" currency={currency} value={advances.data ? amount(advanceAvailable) : "…"} note="Paid ahead, not yet applied" />
              <Figure
                label="Payment terms"
                value={s.creditPeriodDays ? `${s.creditPeriodDays} days` : "On receipt"}
                note={[rate ? `${rate}% withholding tax` : null, s.bankName && `${s.bankName}${s.bankAccountNumber ? ` ${s.bankAccountNumber}` : ""}`].filter(Boolean).join(" · ") || undefined}
              />
            </section>

            <div className="section">
              <div className="tabs no-print" role="tablist">
                {(
                  [
                    ["open", `Open bills${open.data ? ` (${open.data.rows.length})` : ""}`],
                    ["all", "All bills"],
                    ["payments", "Payments"],
                    ["advances", `Advances${advances.data?.length ? ` (${advances.data.length})` : ""}`],
                    ["activity", "Account activity"],
                  ] as Array<[Tab, string]>
                ).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? "on" : ""}`} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === "open" && (
                <Loadable resource={open}>
                  {(st) => (
                    <DataTable
                      columns={billColumns(false)}
                      rows={st.rows}
                      rowKey={(r) => r.id}
                      initialSort={{ key: "due", dir: "asc" }}
                      empty={<EmptyState title="No open bills" body={`Everything billed by ${s.name} has been paid.`} />}
                      footer={
                        <tr>
                          <td>Total outstanding</td>
                          <td className="hide-md" />
                          <td className="hide-sm" />
                          <td />
                          <td className="hide-sm" />
                          <td className="num">{amount(st.totalOutstanding)}</td>
                          {manage && <td />}
                        </tr>
                      }
                    />
                  )}
                </Loadable>
              )}

              {tab === "all" && (
                <Loadable resource={full}>
                  {(st) => (
                    <DataTable
                      columns={billColumns(true)}
                      rows={st.rows}
                      rowKey={(r) => r.id}
                      initialSort={{ key: "date", dir: "desc" }}
                      empty={<EmptyState title="No bills yet" body="Bills from this supplier will be listed here." />}
                    />
                  )}
                </Loadable>
              )}

              {tab === "payments" && (
                <Loadable resource={payments}>
                  {(rows) => (
                    <DataTable
                      columns={paymentColumns}
                      rows={rows}
                      rowKey={(p) => p.id}
                      initialSort={{ key: "date", dir: "desc" }}
                      empty={<EmptyState title="No payments yet" body="Payments to this supplier will appear here." />}
                    />
                  )}
                </Loadable>
              )}

              {tab === "advances" && (
                <Loadable resource={advances}>
                  {(rows) => (
                    <DataTable
                      columns={advanceColumns}
                      rows={rows}
                      rowKey={(a) => a.id}
                      initialSort={{ key: "date", dir: "desc" }}
                      empty={<EmptyState title="No advances" body="Money paid to this supplier before goods or services arrive is tracked here until it's applied." />}
                    />
                  )}
                </Loadable>
              )}

              {tab === "activity" && (
                <Loadable resource={ledger}>
                  {(l) => (
                    <DataTable
                      columns={ledgerColumns}
                      rows={l.entries}
                      rowKey={(e) => e.id}
                      empty={<EmptyState title="No activity yet" body="Bills, payments and notes will appear here in date order." />}
                    />
                  )}
                </Loadable>
              )}
            </div>

            {dialog?.kind === "bill" && <BillForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "pay" && <PaymentForm supplier={s} billId={dialog.billId} onClose={close} onSaved={saved} />}
            {dialog?.kind === "credit" && <SupplierCreditNoteForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "debit" && <SupplierDebitNoteForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "advance" && <AdvanceForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "edit" && <SupplierForm supplier={s} onClose={close} onSaved={saved} />}
            {dialog?.kind === "reverse" && <ReversePaymentForm payment={dialog.payment} onClose={close} onSaved={saved} />}
            {dialog?.kind === "allocate" && <AllocateAdvanceForm advance={dialog.advance} onClose={close} onSaved={saved} />}
            {dialog?.kind === "refund" && <RefundAdvanceForm advance={dialog.advance} onClose={close} onSaved={saved} />}
          </>
        );
      }}
    </Loadable>
  );
}

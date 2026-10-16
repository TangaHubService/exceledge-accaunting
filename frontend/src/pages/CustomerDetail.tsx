import { useCallback, useMemo, useState } from "react";
import { CreditNoteForm, CustomerForm, DepositForm, InvoiceForm, ReceiptForm } from "../components/ArForms";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { DueStatus, EmptyState, Figure, Loadable, Menu, PageHeader, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, daysBetween, humanize, toNumber } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { Customer, CustomerLedger, CustomerStatement } from "../lib/types";
import { CustomerStatusBadge } from "./Customers";

type Tab = "open" | "all" | "activity";
type Dialog = null | "invoice" | "receipt" | "credit" | "deposit" | "edit";
type StatementRow = CustomerStatement["rows"][number];
type LedgerEntry = CustomerLedger["entries"][number];

const DOC_LABELS: Record<string, string> = {
  INVOICE: "Invoice",
  RECEIPT: "Payment",
  RECEIPT_REVERSAL: "Payment reversed",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
  DEPOSIT_APPLICATION: "Deposit applied",
  OPENING: "Opening balance",
};

export function CustomerDetail({ id }: { id: string }) {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency, name: companyName } = useCompany();
  const [tab, setTab] = useState<Tab>("open");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [receiveFor, setReceiveFor] = useState<string | undefined>();

  const customer = useResource<Customer>(`/api/v1/ar/customers/${id}`);
  const open = useResource<CustomerStatement>(`/api/v1/ar/customers/${id}/statement`);
  const full = useResource<CustomerStatement>(tab === "all" ? `/api/v1/ar/customers/${id}/statement?type=FULL` : null);
  const ledger = useResource<CustomerLedger>(`/api/v1/ar/customers/${id}/ledger`);

  const refresh = useCallback(() => {
    customer.reload();
    open.reload();
    full.reload();
    ledger.reload();
  }, [customer, open, full, ledger]);

  const close = useCallback(() => {
    setDialog(null);
    setReceiveFor(undefined);
  }, []);
  const saved = useCallback(() => {
    close();
    refresh();
  }, [close, refresh]);

  const overdue = useMemo(
    () => (open.data?.rows ?? []).filter((r) => daysBetween(r.dueDate) > 0).reduce((s, r) => s + r.outstanding, 0),
    [open.data],
  );
  const reversed = useMemo(
    () => new Set((ledger.data?.entries ?? []).filter((e) => e.docType === "RECEIPT_REVERSAL").map((e) => e.docId)),
    [ledger.data],
  );

  async function reverseReceipt(entry: LedgerEntry) {
    const ok = await confirm({
      title: `Reverse payment ${entry.docNumber}?`,
      body: `This adds ${currency} ${amount(entry.credit)} back to what the customer owes and posts a reversing journal. It can't be undone.`,
      confirmLabel: "Reverse payment",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/ar/receipts/${entry.docId}/reverse`, { method: "POST" });
      toast(`Payment ${entry.docNumber} reversed`);
      refresh();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const invoiceColumns = (showPaid: boolean): Column<StatementRow>[] => [
    {
      key: "number",
      header: "Invoice",
      sortValue: (r) => r.invoiceNumber,
      render: (r) => (
        <>
          <span className="strong nowrap">{r.invoiceNumber}</span>
          {r.description && <span className="sub">{r.description}</span>}
        </>
      ),
    },
    { key: "date", header: "Date", className: "hide-md nowrap", sortValue: (r) => r.invoiceDate, render: (r) => date(r.invoiceDate) },
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
    ...(!showPaid && can("ar:manage")
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 90,
            render: (r: StatementRow) => (
              <button
                type="button"
                className="btn btn-sm row-actions no-print"
                onClick={(e) => {
                  e.stopPropagation();
                  setReceiveFor(r.invoiceNumber);
                  setDialog("receipt");
                }}
              >
                Receive
              </button>
            ),
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
    { key: "debit", header: "Charged", numeric: true, render: (e) => (toNumber(e.debit) ? amount(e.debit) : "") },
    { key: "credit", header: "Paid / credited", numeric: true, render: (e) => (toNumber(e.credit) ? amount(e.credit) : "") },
    { key: "balance", header: `Balance (${currency})`, numeric: true, render: (e) => <span className="strong">{amount(e.runningBalance)}</span> },
    ...(can("ar:manage")
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 90,
            render: (e: LedgerEntry) =>
              e.docType === "RECEIPT" && !reversed.has(e.docId) ? (
                <button type="button" className="btn btn-sm btn-quiet row-actions no-print" onClick={() => void reverseReceipt(e)}>
                  Reverse
                </button>
              ) : null,
          },
        ]
      : []),
  ];

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
        const balance = toNumber(c.balance);
        const limit = toNumber(c.creditLimit);
        const available = limit - balance;
        return (
          <>
            <PageHeader
              back={{ to: "/customers", label: "Customers" }}
              title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  {c.name} <CustomerStatusBadge customer={c} />
                </span>
              }
              description={[c.code, humanize(c.customerType), c.tin && `TIN ${c.tin}`, c.telephone, c.email].filter(Boolean).join(" · ")}
              actions={
                <>
                  {can("ar:manage") && (
                    <>
                      <button type="button" className="btn" onClick={() => setDialog("invoice")}>
                        New invoice
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => setDialog("receipt")}>
                        Record payment
                      </button>
                    </>
                  )}
                  <Menu
                    label="More"
                    items={[
                      can("ar:manage") && { label: "Issue credit note", onSelect: () => setDialog("credit") },
                      can("ar:manage") && { label: "Record deposit", onSelect: () => setDialog("deposit") },
                      can("ar:manage") && { label: "Edit customer", onSelect: () => setDialog("edit") },
                      { label: "Print statement", onSelect: () => window.print() },
                    ]}
                  />
                </>
              }
            />

            <p className="muted small print-only" style={{ marginBottom: 12 }}>
              {companyName} · Customer statement · {date(new Date())}
            </p>

            <section className="figures" aria-label="Account summary">
              <Figure lead label="Balance owed" currency={currency} value={amount(balance)} tone={balance < 0 ? "positive" : undefined} note={balance < 0 ? "In credit" : undefined} />
              <Figure
                label="Overdue"
                currency={currency}
                value={open.data ? amount(overdue) : "…"}
                tone={overdue > 0 ? "negative" : undefined}
                note={open.data && (overdue > 0 ? "Past the due date" : "Nothing overdue")}
              />
              <Figure
                label="Credit available"
                currency={limit > 0 ? currency : undefined}
                value={limit > 0 ? amount(available) : "No limit set"}
                tone={limit > 0 && available < 0 ? "negative" : undefined}
                note={limit > 0 ? `of ${amount(limit)} limit` : undefined}
              />
              <Figure label="Payment terms" value={c.creditPeriodDays ? `${c.creditPeriodDays} days` : "On receipt"} note={c.paymentTerms ?? undefined} />
            </section>

            <div className="section">
              <div className="tabs no-print" role="tablist">
                {(
                  [
                    ["open", `Open invoices${open.data ? ` (${open.data.rows.length})` : ""}`],
                    ["all", "All invoices"],
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
                  {(s) => (
                    <DataTable
                      columns={invoiceColumns(false)}
                      rows={s.rows}
                      rowKey={(r) => r.invoiceNumber}
                      initialSort={{ key: "due", dir: "asc" }}
                      empty={<EmptyState title="No open invoices" body={`${c.name} has paid everything invoiced so far.`} />}
                      footer={
                        <tr>
                          <td>Total outstanding</td>
                          <td className="hide-md" />
                          <td className="hide-sm" />
                          <td />
                          <td className="hide-sm" />
                          <td className="num">{amount(s.totalOutstanding)}</td>
                          {can("ar:manage") && <td />}
                        </tr>
                      }
                    />
                  )}
                </Loadable>
              )}

              {tab === "all" && (
                <Loadable resource={full}>
                  {(s) => (
                    <DataTable
                      columns={invoiceColumns(true)}
                      rows={s.rows}
                      rowKey={(r) => r.invoiceNumber}
                      initialSort={{ key: "date", dir: "desc" }}
                      empty={<EmptyState title="No invoices yet" body="Invoices for this customer will be listed here." />}
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
                      empty={<EmptyState title="No activity yet" body="Invoices, payments and credit notes will appear here in date order." />}
                    />
                  )}
                </Loadable>
              )}
            </div>

            {dialog === "invoice" && <InvoiceForm customer={c} onClose={close} onSaved={saved} />}
            {dialog === "receipt" && <ReceiptForm customer={c} invoiceNumber={receiveFor} onClose={close} onSaved={saved} />}
            {dialog === "credit" && <CreditNoteForm customer={c} onClose={close} onSaved={saved} />}
            {dialog === "deposit" && <DepositForm customer={c} onClose={close} onSaved={saved} />}
            {dialog === "edit" && <CustomerForm customer={c} onClose={close} onSaved={saved} />}
          </>
        );
      }}
    </Loadable>
  );
}

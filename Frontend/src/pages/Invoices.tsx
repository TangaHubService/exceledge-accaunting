import { Plus } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { InvoiceForm, ReceiptForm } from "../components/ArForms";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { type Column, DataTable } from "../components/DataTable";
import { PdfButton } from "../components/Documents";
import { EmailComposer } from "../components/customers/EmailComposer";
import { useFeedback } from "../components/feedback";
import { SummaryRows } from "../components/forms";
import { Badge, Drawer, DueStatus, EmptyState, Figure, Loadable, PageHeader, Pagination } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, plural, toNumber } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { ArInvoiceDetail, ArInvoiceList, ArInvoiceRow, Customer, InvoiceApplications } from "../lib/types";

type Show = "OPEN" | "OVERDUE" | "PAID" | "ALL";
const SHOWS: Show[] = ["OPEN", "OVERDUE", "PAID", "ALL"];

export function Invoices() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const requested = query.get("show")?.toUpperCase() as Show | undefined;
  const show: Show = requested && SHOWS.includes(requested) ? requested : "OPEN";
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [creating, setCreating] = useState(false);
  // ?view=<invoiceId> opens that invoice, so other pages (the customer profile) can link straight to it.
  const [viewing, setViewingState] = useState<string | null>(query.get("view"));
  const setViewing = (id: string | null) => {
    setViewingState(id);
    if (!id && query.get("view")) setQueryParam("view", null);
  };
  const [receiving, setReceiving] = useState<{ customer: Customer; invoiceNumber: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [show, q, from, to, pageSize]);

  const params = new URLSearchParams({ status: show, page: String(page), pageSize: String(pageSize) });
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const list = useResource<ArInvoiceList>(`/api/v1/ar/invoices?${params.toString()}`);

  async function receive(row: ArInvoiceRow) {
    const customer = await api<Customer>(`/api/v1/ar/customers/${row.customerId}`);
    setReceiving({ customer, invoiceNumber: row.invoiceNumber });
  }

  const columns: Column<ArInvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      render: (r) => (
        <>
          <span className="strong nowrap">{r.invoiceNumber}</span>
          {r.description && <span className="sub">{r.description}</span>}
        </>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (r) => (
        <Link to={`/customers/${r.customerId}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
          {r.customerName}
        </Link>
      ),
    },
    { key: "date", header: "Date", className: "hide-md nowrap", render: (r) => date(r.invoiceDate) },
    { key: "due", header: "Due date", className: "hide-sm nowrap", render: (r) => date(r.dueDate) },
    {
      key: "status",
      header: "Status",
      render: (r) => (r.status === "REVERSED" ? <Badge tone="negative">Reversed</Badge> : <DueStatus dueDate={r.dueDate} outstanding={r.outstanding} />),
    },
    { key: "gross", header: "Amount", numeric: true, className: "hide-sm", render: (r) => amount(r.gross) },
    {
      key: "outstanding",
      header: `Outstanding (${currency})`,
      numeric: true,
      render: (r) => (r.outstanding > 0 ? <span className="strong">{amount(r.outstanding)}</span> : <span className="subtle">0</span>),
    },
    {
      key: "act",
      header: <span className="sr-only">Actions</span>,
      width: 170,
      render: (r) => (
        <span className="row-actions no-print" style={{ display: "inline-flex", gap: 6 }}>
          <PdfButton path={`/api/v1/ar/invoices/${r.id}/pdf`} filename={`${r.invoiceNumber}.pdf`} />
          {can("ar:manage") && r.outstanding > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                void receive(r);
              }}
            >
              Receive
            </button>
          )}
        </span>
      ),
    },
  ];

  const filters: Array<[Show, string]> = [
    ["OPEN", "Unpaid"],
    ["OVERDUE", "Overdue"],
    ["PAID", "Paid"],
    ["ALL", "All"],
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Customer invoices with their line items, payments and balance due."
        actions={
          can("ar:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              New invoice
            </button>
          )
        }
      />

      {list.data && list.data.total > 0 && (
        <section className="figures" style={{ marginBottom: 20, "--cols": 2 } as CSSProperties}>
          <Figure lead label="Invoiced" currency={currency} value={amount(list.data.totals.gross)} note={plural(list.data.total, "invoice")} />
          <Figure label="Still owed" currency={currency} value={amount(list.data.totals.outstanding)} tone={list.data.totals.outstanding > 0 ? "negative" : undefined} />
        </section>
      )}

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search invoice, customer or description" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
        <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Invoice date from" />
        <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Invoice date to" />
        <div className="segmented" role="group" aria-label="Filter invoices">
          {filters.map(([key, label]) => (
            <button key={key} type="button" className={show === key ? "on" : ""} onClick={() => setQueryParam("show", key === "OPEN" ? null : key.toLowerCase())}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Loadable resource={list}>
        {(l) => (
          <>
            <DataTable
              columns={columns}
              rows={l.rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setViewing(r.id)}
              pageSize={100}
              paginationKey="invoices-server"
              showPagination={false}
              empty={
                <EmptyState
                  title={show === "OPEN" && !q && !from && !to ? "No unpaid invoices" : "No invoices match"}
                  body={show === "OPEN" && !q && !from && !to ? "Every invoice has been paid." : "Try a different search, date range or filter."}
                  action={
                    can("ar:manage") && (
                      <button type="button" className="btn" onClick={() => setCreating(true)}>
                        Create an invoice
                      </button>
                    )
                  }
                />
              }
            />
            <Pagination page={page} pageSize={pageSize} total={l.total} onPage={setPage} onPageSize={setPageSize} label="Invoice pages" />
          </>
        )}
      </Loadable>

      {creating && (
        <InvoiceForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {viewing && <InvoiceDrawer id={viewing} onClose={() => setViewing(null)} onChanged={list.reload} />}
      {receiving && (
        <ReceiptForm
          customer={receiving.customer}
          invoiceNumber={receiving.invoiceNumber}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

export function InvoiceDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const invoice = useResource<ArInvoiceDetail>(`/api/v1/ar/invoices/${id}`);
  const applications = useResource<InvoiceApplications>(`/api/v1/ar/invoices/${id}/applications`);
  const { currency } = useCompany();
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const manage = can("ar:manage");
  const voided = invoice.data?.status === "REVERSED";
  const canVoid = manage && invoice.data && !voided && applications.data && applications.data.rows.length === 0;

  function changed() {
    invoice.reload();
    applications.reload();
    onChanged?.();
  }

  async function remove(row: InvoiceApplications["rows"][number]) {
    const what = row.kind === "PAYMENT" ? "payment" : row.kind === "DEPOSIT" ? "deposit" : "credit note";
    const ok = await confirm({
      title: `Remove ${what} ${row.sourceNumber} from this invoice?`,
      body:
        row.kind === "DEPOSIT"
          ? `${currency} ${amount(row.amount, 2)} goes back to the customer's deposits and the invoice opens up again. A reversing journal is posted.`
          : `${currency} ${amount(row.amount, 2)} stays on the customer's account as credit you can apply elsewhere, and the invoice opens up again. Nothing is posted to the ledger.`,
      confirmLabel: `Remove ${what}`,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/ar/applications/${row.kind}/${row.id}`, { method: "DELETE" });
      toast(`${row.sourceNumber} removed from the invoice`);
      changed();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const [feeOpen, setFeeOpen] = useState(false);
  const [fee, setFee] = useState("");
  const overdue = Boolean(invoice.data && !voided && invoice.data.outstanding > 0.005 && new Date(invoice.data.dueDate) < new Date(new Date().toDateString()));

  async function chargeFee() {
    const inv = invoice.data!;
    const n = Number(fee.replace(/[,\s]/g, ""));
    if (!(n > 0)) return toast("Enter a fee amount", { error: true });
    try {
      const res = await api<{ invoiceNumber: string }>("/api/v1/ar/invoices", {
        method: "POST",
        body: JSON.stringify({ customerId: inv.customer.id, invoiceDate: new Date().toISOString().slice(0, 10), net: n, description: `Late fee on ${inv.invoiceNumber}` }),
      });
      toast(`Late fee ${res.invoiceNumber} raised`);
      setFeeOpen(false);
      setFee("");
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const [composing, setComposing] = useState<null | "invoice" | "reminder">(null);

  async function voidIt() {
    const inv = invoice.data!;
    const ok = await confirm({
      title: `Void invoice ${inv.invoiceNumber}?`,
      body: `The invoice keeps its number but its ${currency} ${amount(inv.gross, 2)} comes off the customer's balance, and a reversing journal is posted. This can't be undone.`,
      confirmLabel: "Void invoice",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/ar/invoices/${inv.id}/void`, { method: "POST", body: JSON.stringify({}) });
      toast(`Invoice ${inv.invoiceNumber} voided`);
      changed();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }
  return (
    <Drawer
      title={invoice.data ? `Invoice ${invoice.data.invoiceNumber}` : "Invoice"}
      subtitle={invoice.data && `${invoice.data.customer.name} · ${date(invoice.data.invoiceDate)} · due ${date(invoice.data.dueDate)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {manage && invoice.data && !voided && (
            <button type="button" className="btn" onClick={() => setComposing("invoice")}>
              Email
            </button>
          )}
          {canVoid && (
            <button type="button" className="btn btn-quiet" style={{ color: "var(--negative)" }} onClick={() => void voidIt()}>
              Void
            </button>
          )}
          {invoice.data && <PdfButton path={`/api/v1/ar/invoices/${id}/pdf`} filename={`${invoice.data.invoiceNumber}.pdf`} label="Download PDF" className="btn btn-primary" />}
        </>
      }
    >
      <Loadable resource={invoice}>
        {(inv) => (
          <>
            {inv.description && <p className="small">{inv.description}</p>}
            {inv.lines.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="num">Qty</th>
                      <th className="num">Unit price</th>
                      <th className="num hide-sm">Discount</th>
                      <th>Tax</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="num">{toNumber(l.quantity)}</td>
                        <td className="num">{amount(l.unitPrice, 2)}</td>
                        <td className="num hide-sm">{toNumber(l.discount) ? amount(l.discount, 2) : ""}</td>
                        <td className="nowrap">{l.taxCode ? `${l.taxCode} ${toNumber(l.taxRate)}% · ${amount(l.tax, 2)}` : "—"}</td>
                        <td className="num">{amount(l.net, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <SummaryRows
              rows={[
                ["Amount before tax", amount(inv.net, 2)],
                ...(toNumber(inv.discount) ? ([["Discount", `−${amount(inv.discount, 2)}`]] as Array<[string, string]>) : []),
                ["Tax", amount(inv.tax, 2)],
                [`Total (${currency})`, amount(inv.gross, 2), true],
                ["Paid and credited", amount(toNumber(inv.amountPaid) + toNumber(inv.amountCredited), 2)],
                ["Balance due", amount(inv.outstanding, 2), true],
              ]}
            />
            {voided && <p className="notice-inline">This invoice is void. It stays on record with nothing owed.</p>}
            {overdue && manage && (
              <div className="inv-overdue">
                <span className="text-negative strong">Overdue since {date(inv.dueDate)}</span>
                <span className="grow" />
                <button type="button" className="btn btn-sm" onClick={() => setComposing("reminder")}>
                  Send reminder
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setFeeOpen((v) => !v)}>
                  Charge late fee
                </button>
              </div>
            )}
            {composing && (
              <EmailComposer
                title={composing === "reminder" ? `Payment reminder for ${inv.invoiceNumber}` : `Email invoice ${inv.invoiceNumber}`}
                defaultTo={inv.customer.email}
                endpoint={`/api/v1/ar/invoices/${inv.id}/email`}
                extraBody={{ reminder: composing === "reminder" }}
                sendLabel={composing === "reminder" ? "Send reminder" : "Send invoice"}
                onCancel={() => setComposing(null)}
              />
            )}
            {feeOpen && (
              <div className="inv-fee">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Late fee ({currency})</span>
                  <input className="input num" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" autoFocus />
                  <span className="field-hint">Raised as a new invoice dated today, referring to {inv.invoiceNumber}.</span>
                </label>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void chargeFee()}>
                  Raise fee invoice
                </button>
              </div>
            )}
            <h3 className="cust-subhead">Payments and credits</h3>
            <Loadable resource={applications}>
              {(a) =>
                a.rows.length ? (
                  <ul className="cust-mini">
                    {a.rows.map((r) => (
                      <li key={`${r.kind}-${r.id}`}>
                        <div className="inv-app">
                          <span className="cust-mini-main">
                            <span className="strong">
                              {r.kind === "PAYMENT" ? "Payment" : r.kind === "DEPOSIT" ? "Deposit" : "Credit note"} {r.sourceNumber}
                            </span>
                            <span className="sub">
                              {date(r.date)}
                              {r.reason ? ` · ${r.reason}` : ""}
                            </span>
                          </span>
                          <span className="num strong">{amount(r.amount, 2)}</span>
                          {manage && r.removable && r.kind !== "CREDIT_ON_ISSUE" && (
                            <button type="button" className="btn btn-sm btn-quiet" onClick={() => void remove(r)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{voided ? "None." : "Nothing applied yet."}</p>
                )
              }
            </Loadable>
            <AttachmentsPanel entityType="ArInvoice" entityId={inv.id} />
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

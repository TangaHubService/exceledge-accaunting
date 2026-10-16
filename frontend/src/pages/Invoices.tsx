import { Plus } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { InvoiceForm, ReceiptForm } from "../components/ArForms";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { type Column, DataTable } from "../components/DataTable";
import { PdfButton } from "../components/Documents";
import { SummaryRows } from "../components/forms";
import { Badge, Drawer, DueStatus, EmptyState, Figure, Loadable, PageHeader, Pagination } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, plural, toNumber } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { ArInvoiceDetail, ArInvoiceList, ArInvoiceRow, Customer } from "../lib/types";

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
  const [viewing, setViewing] = useState<string | null>(null);
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
      {viewing && <InvoiceDrawer id={viewing} onClose={() => setViewing(null)} />}
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

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const invoice = useResource<ArInvoiceDetail>(`/api/v1/ar/invoices/${id}`);
  const { currency } = useCompany();
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
            <AttachmentsPanel entityType="ArInvoice" entityId={inv.id} />
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

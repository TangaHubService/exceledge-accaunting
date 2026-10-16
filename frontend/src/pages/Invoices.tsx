import { Plus } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { InvoiceForm, ReceiptForm } from "../components/ArForms";
import { type Column, DataTable } from "../components/DataTable";
import { DueStatus, EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, daysBetween, plural } from "../lib/format";
import { Link, navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { AgeingReport, Customer } from "../lib/types";

type Line = AgeingReport["lines"][number];
type Show = "all" | "overdue" | "due-soon";

export function Invoices() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const show = (query.get("show") as Show) || "all";
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<{ customer: Customer; invoiceNumber: string } | null>(null);
  const report = useResource<AgeingReport>("/api/v1/ar/ageing");

  const lines = useMemo(() => report.data?.lines ?? [], [report.data]);
  const overdue = useMemo(() => lines.filter((l) => daysBetween(l.dueDate) > 0), [lines]);
  const dueSoon = useMemo(
    () =>
      lines.filter((l) => {
        const d = daysBetween(l.dueDate);
        return d <= 0 && d >= -7;
      }),
    [lines],
  );
  const overdueTotal = overdue.reduce((s, l) => s + l.outstanding, 0);
  const dueSoonTotal = dueSoon.reduce((s, l) => s + l.outstanding, 0);

  const rows = useMemo(() => {
    const base = show === "overdue" ? overdue : show === "due-soon" ? dueSoon : lines;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((l) => l.invoiceNumber.toLowerCase().includes(q) || l.customerName.toLowerCase().includes(q) || l.customerCode.toLowerCase().includes(q));
  }, [lines, overdue, dueSoon, show, search]);

  async function receive(line: Line) {
    const customer = await api<Customer>(`/api/v1/ar/customers/${line.customerId}`);
    setReceiving({ customer, invoiceNumber: line.invoiceNumber });
  }

  const columns: Column<Line>[] = [
    { key: "number", header: "Invoice", sortValue: (l) => l.invoiceNumber, render: (l) => <span className="strong nowrap">{l.invoiceNumber}</span> },
    {
      key: "customer",
      header: "Customer",
      sortValue: (l) => l.customerName,
      render: (l) => (
        <Link to={`/customers/${l.customerId}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
          {l.customerName}
        </Link>
      ),
    },
    { key: "due", header: "Due date", className: "hide-sm nowrap", sortValue: (l) => l.dueDate, render: (l) => date(l.dueDate) },
    { key: "status", header: "Status", sortValue: (l) => -daysBetween(l.dueDate), render: (l) => <DueStatus dueDate={l.dueDate} outstanding={l.outstanding} /> },
    {
      key: "outstanding",
      header: `Outstanding (${currency})`,
      numeric: true,
      sortValue: (l) => l.outstanding,
      render: (l) => <span className="strong">{amount(l.outstanding)}</span>,
    },
    ...(can("ar:manage")
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 90,
            render: (l: Line) => (
              <button
                type="button"
                className="btn btn-sm row-actions"
                onClick={(e) => {
                  e.stopPropagation();
                  void receive(l);
                }}
              >
                Receive
              </button>
            ),
          },
        ]
      : []),
  ];

  const filters: Array<[Show, string, number]> = [
    ["all", "All open", lines.length],
    ["overdue", "Overdue", overdue.length],
    ["due-soon", "Due in 7 days", dueSoon.length],
  ];

  const shownTotal = rows.reduce((s, l) => s + l.outstanding, 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Unpaid customer invoices. Paid invoices stay on each customer's account."
        actions={
          can("ar:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              New invoice
            </button>
          )
        }
      />

      {report.data && lines.length > 0 && (
        <section className="figures" style={{ marginBottom: 20, "--cols": 3 } as CSSProperties}>
          <Figure lead label="Total unpaid" currency={currency} value={amount(report.data.total)} note={plural(lines.length, "open invoice")} />
          <Figure
            label="Overdue"
            currency={currency}
            value={amount(overdueTotal)}
            tone={overdueTotal > 0 ? "negative" : undefined}
            note={overdue.length ? plural(overdue.length, "invoice") : "Nothing overdue"}
          />
          <Figure label="Due in the next 7 days" currency={currency} value={amount(dueSoonTotal)} note={plural(dueSoon.length, "invoice")} />
        </section>
      )}

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search invoice or customer" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
        <div className="segmented" role="group" aria-label="Filter invoices">
          {filters.map(([key, label, count]) => (
            <button key={key} type="button" className={show === key ? "on" : ""} onClick={() => setQueryParam("show", key === "all" ? null : key)}>
              {label}
              {report.data && <span className="count">{count}</span>}
            </button>
          ))}
        </div>
      </div>

      <Loadable resource={report}>
        {() => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(l) => l.invoiceNumber}
            onRowClick={(l) => navigate(`/customers/${l.customerId}`)}
            initialSort={{ key: "due", dir: "asc" }}
            empty={
              lines.length === 0 ? (
                <EmptyState
                  title="No unpaid invoices"
                  body="Every invoice has been paid. New credit invoices will appear here until they're settled."
                  action={
                    can("ar:manage") && (
                      <button type="button" className="btn" onClick={() => setCreating(true)}>
                        Create an invoice
                      </button>
                    )
                  }
                />
              ) : (
                <EmptyState title="No invoices match" body="Try a different search or filter." />
              )
            }
            footer={
              <tr>
                <td colSpan={2}>Total shown</td>
                <td className="hide-sm" />
                <td />
                <td className="num">{amount(shownTotal)}</td>
                {can("ar:manage") && <td />}
              </tr>
            }
          />
        )}
      </Loadable>

      {creating && (
        <InvoiceForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            report.reload();
          }}
        />
      )}
      {receiving && (
        <ReceiptForm
          customer={receiving.customer}
          invoiceNumber={receiving.invoiceNumber}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null);
            report.reload();
          }}
        />
      )}
    </>
  );
}

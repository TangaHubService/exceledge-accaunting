import { Plus } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { BillForm, PaymentForm } from "../components/ApForms";
import { type Column, DataTable } from "../components/DataTable";
import { DueStatus, EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, daysBetween, plural } from "../lib/format";
import { Link, navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { ApBill, Supplier } from "../lib/types";

type Show = "all" | "overdue" | "due-soon";

export function Bills() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const show = (query.get("show") as Show) || "all";
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<{ supplier: Supplier; billId: string } | null>(null);
  const bills = useResource<ApBill[]>("/api/v1/ap/bills");

  const lines = useMemo(() => bills.data ?? [], [bills.data]);
  const overdue = useMemo(() => lines.filter((b) => daysBetween(b.dueDate) > 0), [lines]);
  const dueSoon = useMemo(
    () =>
      lines.filter((b) => {
        const d = daysBetween(b.dueDate);
        return d <= 0 && d >= -7;
      }),
    [lines],
  );
  const sum = (rows: ApBill[]) => rows.reduce((s, b) => s + b.outstanding, 0);

  const rows = useMemo(() => {
    const base = show === "overdue" ? overdue : show === "due-soon" ? dueSoon : lines;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((b) =>
      [b.billNumber, b.supplierInvoiceNumber, b.supplierName, b.supplierCode, b.poReference].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [lines, overdue, dueSoon, show, search]);

  async function pay(bill: ApBill) {
    const supplier = await api<Supplier>(`/api/v1/ap/suppliers/${bill.supplierId}`);
    setPaying({ supplier, billId: bill.id });
  }

  const columns: Column<ApBill>[] = [
    {
      key: "number",
      header: "Bill",
      sortValue: (b) => b.billNumber,
      render: (b) => (
        <>
          <span className="strong nowrap">{b.billNumber}</span>
          {b.supplierInvoiceNumber && <span className="sub">Inv. {b.supplierInvoiceNumber}</span>}
        </>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      sortValue: (b) => b.supplierName,
      render: (b) => (
        <Link to={`/suppliers/${b.supplierId}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
          {b.supplierName}
        </Link>
      ),
    },
    { key: "due", header: "Due date", className: "hide-sm nowrap", sortValue: (b) => b.dueDate, render: (b) => date(b.dueDate) },
    { key: "status", header: "Status", sortValue: (b) => -daysBetween(b.dueDate), render: (b) => <DueStatus dueDate={b.dueDate} outstanding={b.outstanding} /> },
    {
      key: "outstanding",
      header: `Outstanding (${currency})`,
      numeric: true,
      sortValue: (b) => b.outstanding,
      render: (b) => <span className="strong">{amount(b.outstanding)}</span>,
    },
    ...(can("ap:manage")
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 80,
            render: (b: ApBill) => (
              <button
                type="button"
                className="btn btn-sm row-actions"
                onClick={(e) => {
                  e.stopPropagation();
                  void pay(b);
                }}
              >
                Pay
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

  return (
    <>
      <PageHeader
        title="Bills"
        description="Unpaid supplier bills. Paid bills stay on each supplier's account."
        actions={
          can("ap:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              Record bill
            </button>
          )
        }
      />

      {lines.length > 0 && (
        <section className="figures" style={{ marginBottom: 20, "--cols": 3 } as CSSProperties}>
          <Figure lead label="Total owed" currency={currency} value={amount(sum(lines))} note={plural(lines.length, "open bill")} />
          <Figure
            label="Overdue"
            currency={currency}
            value={amount(sum(overdue))}
            tone={overdue.length ? "negative" : undefined}
            note={overdue.length ? plural(overdue.length, "bill") : "Nothing overdue"}
          />
          <Figure label="Due in the next 7 days" currency={currency} value={amount(sum(dueSoon))} note={`Cash needed · ${plural(dueSoon.length, "bill")}`} />
        </section>
      )}

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search bill, invoice, supplier or PO" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bills" />
        <div className="segmented" role="group" aria-label="Filter bills">
          {filters.map(([key, label, count]) => (
            <button key={key} type="button" className={show === key ? "on" : ""} onClick={() => setQueryParam("show", key === "all" ? null : key)}>
              {label}
              {bills.data && <span className="count">{count}</span>}
            </button>
          ))}
        </div>
      </div>

      <Loadable resource={bills}>
        {() => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(b) => b.id}
            onRowClick={(b) => navigate(`/suppliers/${b.supplierId}`)}
            initialSort={{ key: "due", dir: "asc" }}
            empty={
              lines.length === 0 ? (
                <EmptyState
                  title="No unpaid bills"
                  body="Every supplier bill has been paid. New bills appear here until they're settled."
                  action={
                    can("ap:manage") && (
                      <button type="button" className="btn" onClick={() => setCreating(true)}>
                        Record a bill
                      </button>
                    )
                  }
                />
              ) : (
                <EmptyState title="No bills match" body="Try a different search or filter." />
              )
            }
            footer={
              <tr>
                <td colSpan={2}>Total shown</td>
                <td className="hide-sm" />
                <td />
                <td className="num">{amount(sum(rows))}</td>
                {can("ap:manage") && <td />}
              </tr>
            }
          />
        )}
      </Loadable>

      {creating && (
        <BillForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            bills.reload();
          }}
        />
      )}
      {paying && (
        <PaymentForm
          supplier={paying.supplier}
          billId={paying.billId}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            bills.reload();
          }}
        />
      )}
    </>
  );
}

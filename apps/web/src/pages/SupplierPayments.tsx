import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { methodLabel, PaymentForm, ReversePaymentForm } from "../components/ApForms";
import { type Column, DataTable } from "../components/DataTable";
import { Badge, EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, moduleLabel, money, plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { ApPayment } from "../lib/types";

export function SupplierPayments() {
  const { can } = useSession();
  const { currency } = useCompany();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<ApPayment | null>(null);
  const payments = useResource<ApPayment[]>("/api/v1/ap/payments");

  const rows = useMemo(() => {
    const all = payments.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => [p.paymentNumber, p.supplierName, p.supplierCode, p.reference].some((v) => v?.toLowerCase().includes(q)));
  }, [payments.data, search]);
  const posted = rows.filter((p) => p.status === "POSTED");

  const columns: Column<ApPayment>[] = [
    { key: "date", header: "Date", className: "nowrap", sortValue: (p) => p.paymentDate, render: (p) => date(p.paymentDate) },
    {
      key: "number",
      header: "Payment",
      sortValue: (p) => p.paymentNumber,
      render: (p) => (
        <>
          <span className="strong nowrap">{p.paymentNumber}</span>
          <span className="sub">
            {[methodLabel(p.method), p.reference, p.sourceModule && p.sourceModule !== "AP" ? `From ${moduleLabel(p.sourceModule)}` : null].filter(Boolean).join(" · ")}
          </span>
        </>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      sortValue: (p) => p.supplierName,
      render: (p) => (
        <Link to={`/suppliers/${p.supplierId}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
          {p.supplierName}
        </Link>
      ),
    },
    {
      key: "bills",
      header: "Settled",
      className: "hide-sm",
      render: (p) =>
        p.bills.length ? (
          <span className="small">{p.bills.map((b) => b.billNumber).join(", ")}</span>
        ) : (
          <span className="muted small">Kept on account</span>
        ),
    },
    { key: "wht", header: "WHT", numeric: true, className: "hide-sm", sortValue: (p) => p.withholdingTax, render: (p) => (p.withholdingTax ? amount(p.withholdingTax) : <span className="subtle">—</span>) },
    {
      key: "amount",
      header: `Paid (${currency})`,
      numeric: true,
      sortValue: (p) => p.amount,
      render: (p) => <span className={p.status === "REVERSED" ? "muted strike" : "strong"}>{amount(p.amount)}</span>,
    },
    { key: "status", header: <span className="sr-only">Status</span>, width: 96, render: (p) => (p.status === "REVERSED" ? <Badge tone="negative">Reversed</Badge> : null) },
    ...(can("ap:manage")
      ? [
          {
            key: "act",
            header: <span className="sr-only">Actions</span>,
            width: 90,
            render: (p: ApPayment) =>
              p.status === "POSTED" && p.sourceModule === "AP" ? (
                <button
                  type="button"
                  className="btn btn-sm btn-quiet row-actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReversing(p);
                  }}
                >
                  Reverse
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Supplier payments"
        description="Money paid to suppliers, newest first, with the bills each payment settled."
        actions={
          can("ap:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              Pay supplier
            </button>
          )
        }
      />

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search payment, supplier or reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payments" />
      </div>

      <Loadable resource={payments}>
        {() => (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate(`/suppliers/${p.supplierId}`)}
              initialSort={{ key: "date", dir: "desc" }}
              empty={
                (payments.data ?? []).length === 0 ? (
                  <EmptyState title="No supplier payments yet" body="Payments you record, and supplier payments approved in Excel Edge, appear here." />
                ) : (
                  <EmptyState title="No payments match" body="Try a different search." />
                )
              }
            />
            {posted.length > 0 && (
              <p className="table-caption">
                {plural(posted.length, "payment")} · {money(posted.reduce((s, p) => s + p.amount, 0), currency)} paid ·{" "}
                {money(posted.reduce((s, p) => s + p.withholdingTax, 0), currency)} withheld
              </p>
            )}
          </>
        )}
      </Loadable>

      {creating && (
        <PaymentForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            payments.reload();
          }}
        />
      )}
      {reversing && (
        <ReversePaymentForm
          payment={reversing}
          onClose={() => setReversing(null)}
          onSaved={() => {
            setReversing(null);
            payments.reload();
          }}
        />
      )}
    </>
  );
}

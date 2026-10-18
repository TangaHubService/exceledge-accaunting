import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AddCustomerDrawer } from "../components/customers/AddCustomerDrawer";
import { CustomersHero } from "../components/customers/CustomersHero";
import { CustomersTips } from "../components/customers/CustomersTips";
import { type Column, DataTable } from "../components/DataTable";
import { Badge, EmptyState, Loadable } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, humanize, money, plural, toNumber } from "../lib/format";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Customer } from "../lib/types";

type Show = "all" | "owing" | "over-limit" | "inactive";
type HubTab = "customers" | "leads";

function isOverLimit(c: Customer) {
  return toNumber(c.creditLimit) > 0 && toNumber(c.balance) > toNumber(c.creditLimit);
}

export function CustomerStatusBadge({ customer }: { customer: Customer }) {
  if (customer.status === "INACTIVE") return <Badge>Inactive</Badge>;
  if (customer.creditStatus === "BLOCKED") return <Badge tone="negative">Blocked</Badge>;
  if (customer.creditStatus === "ON_HOLD") return <Badge tone="warning">On hold</Badge>;
  if (isOverLimit(customer)) return <Badge tone="negative">Over limit</Badge>;
  if (customer.creditStatus === "WATCH") return <Badge tone="warning">Watch</Badge>;
  return null;
}

export function Customers() {
  const { can } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const show = (query.get("show") as Show) || "all";
  const hubTab = (query.get("tab") as HubTab) || "customers";
  const [search, setSearch] = useState(query.get("q") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [creating, setCreating] = useState(query.get("new") === "1");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const list = useResource<Customer[]>(`/api/v1/ar/customers${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);
  const all = useMemo(() => list.data ?? [], [list.data]);
  /** Empty-state mock (hero) when there are no customers, or API is unavailable. */
  const showHero = all.length === 0 && !debounced;

  const counts = useMemo(
    () => ({
      owing: all.filter((c) => toNumber(c.balance) > 0).length,
      "over-limit": all.filter(isOverLimit).length,
      inactive: all.filter((c) => c.status === "INACTIVE").length,
    }),
    [all],
  );

  const rows = useMemo(() => {
    switch (show) {
      case "owing":
        return all.filter((c) => toNumber(c.balance) > 0);
      case "over-limit":
        return all.filter(isOverLimit);
      case "inactive":
        return all.filter((c) => c.status === "INACTIVE");
      default:
        return all;
    }
  }, [all, show]);

  const totalOwed = rows.reduce((s, c) => s + Math.max(0, toNumber(c.balance)), 0);

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (c) => c.name,
      render: (c) => (
        <>
          <span className="strong">{c.name}</span>
          <span className="sub">
            {c.code}
            {c.tin ? ` · TIN ${c.tin}` : ""}
          </span>
        </>
      ),
    },
    { key: "type", header: "Type", className: "hide-sm", sortValue: (c) => c.customerType, render: (c) => humanize(c.customerType) },
    {
      key: "terms",
      header: "Terms",
      className: "hide-sm",
      sortValue: (c) => c.creditPeriodDays,
      render: (c) => (c.creditPeriodDays ? `${c.creditPeriodDays} days` : <span className="muted">On receipt</span>),
    },
    {
      key: "limit",
      header: "Credit limit",
      numeric: true,
      className: "hide-sm",
      sortValue: (c) => toNumber(c.creditLimit),
      render: (c) => (toNumber(c.creditLimit) > 0 ? amount(c.creditLimit) : <span className="subtle">—</span>),
    },
    {
      key: "balance",
      header: `Balance (${currency})`,
      numeric: true,
      sortValue: (c) => toNumber(c.balance),
      render: (c) => {
        const b = toNumber(c.balance);
        if (Math.abs(b) < 0.005) return <span className="subtle">0</span>;
        return <span className={isOverLimit(c) ? "strong text-negative" : b > 0 ? "strong" : "text-positive"}>{amount(b)}</span>;
      },
    },
    { key: "status", header: <span className="sr-only">Status</span>, width: 100, render: (c) => <CustomerStatusBadge customer={c} /> },
  ];

  const filters: Array<[Show, string]> = [
    ["all", "All"],
    ["owing", "Owing"],
    ["over-limit", "Over limit"],
    ["inactive", "Inactive"],
  ];

  function openCreate() {
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setQueryParam("new", null);
  }

  return (
    <div className="ee-cust-page">
      <nav className="ee-cust-crumbs" aria-label="Breadcrumb">
        <span>Customer Hub</span>
        <span className="ee-cust-crumbs-sep">/</span>
        <span>Customers &amp; leads</span>
      </nav>

      <header className="ee-cust-page-head">
        <h1>Customers &amp; leads</h1>
        {!showHero && hubTab === "customers" && can("ar:manage") && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" />
            Add customer
          </button>
        )}
      </header>

      <div className="ee-cust-tabs" role="tablist" aria-label="Customers or leads">
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === "customers"}
          className={`ee-cust-tab ${hubTab === "customers" ? "on" : ""}`}
          onClick={() => setQueryParam("tab", null)}
        >
          Customers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === "leads"}
          className={`ee-cust-tab ${hubTab === "leads" ? "on" : ""}`}
          onClick={() => setQueryParam("tab", "leads")}
        >
          Leads
        </button>
      </div>

      {hubTab === "leads" || showHero ? (
        <>
          <CustomersHero
            mode={hubTab === "leads" ? "leads" : "customers"}
            onAdd={openCreate}
            onImport={openCreate}
          />
          <CustomersTips mode={hubTab === "leads" ? "leads" : "customers"} />
        </>
      ) : (
        <Loadable resource={list}>
          {() => (
            <>
              <div className="filter-bar">
                <input
                  className="input search"
                  type="search"
                  placeholder="Search name, code or TIN"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search customers"
                />
                <div className="segmented" role="group" aria-label="Filter customers">
                  {filters.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={show === key ? "on" : ""}
                      onClick={() => setQueryParam("show", key === "all" ? null : key)}
                    >
                      {label}
                      {key !== "all" && list.data && <span className="count">{counts[key]}</span>}
                    </button>
                  ))}
                </div>
              </div>

              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(c) => c.id}
                onRowClick={(c) => navigate(`/customers/${c.id}`)}
                initialSort={{ key: "name", dir: "asc" }}
                empty={<EmptyState title="No matching customers" body="Try a different search or filter." />}
              />
              {rows.length > 0 && (
                <p className="table-caption">
                  {plural(rows.length, "customer")} · {money(totalOwed, currency)} owed
                  {all.length >= 200 && " · Showing the first 200 — search to narrow down"}
                </p>
              )}
            </>
          )}
        </Loadable>
      )}

      {creating && (
        <AddCustomerDrawer
          onClose={closeCreate}
          onSaved={(c) => {
            closeCreate();
            navigate(`/customers/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

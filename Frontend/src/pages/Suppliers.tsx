import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { AddSupplierDrawer } from "../components/suppliers/AddSupplierDrawer";
import { SuppliersHero } from "../components/suppliers/SuppliersHero";
import { Badge, EmptyState, Loadable } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, humanize, money, plural, toNumber } from "../lib/format";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Supplier } from "../lib/types";

type Show = "all" | "owing" | "inactive";

export function SupplierStatusBadge({ supplier }: { supplier: Supplier }) {
  if (supplier.status === "INACTIVE") return <Badge>Inactive</Badge>;
  if (toNumber(supplier.balance) < -0.005) return <Badge tone="info">Prepaid</Badge>;
  return null;
}

export function Suppliers() {
  const { can } = useSession();
  const { currency } = useCompany();
  const { query } = useLocation();
  const show = (query.get("show") as Show) || "all";
  const [search, setSearch] = useState(query.get("q") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [creating, setCreating] = useState(query.get("new") === "1");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const list = useResource<Supplier[]>(`/api/v1/ap/suppliers${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);
  const all = useMemo(() => list.data ?? [], [list.data]);
  const showHero = all.length === 0 && !debounced && !list.loading;

  const counts = useMemo(
    () => ({ owing: all.filter((s) => toNumber(s.balance) > 0).length, inactive: all.filter((s) => s.status === "INACTIVE").length }),
    [all],
  );
  const rows = useMemo(() => {
    if (show === "owing") return all.filter((s) => toNumber(s.balance) > 0);
    if (show === "inactive") return all.filter((s) => s.status === "INACTIVE");
    return all;
  }, [all, show]);
  const totalOwed = rows.reduce((s, r) => s + Math.max(0, toNumber(r.balance)), 0);

  const columns: Column<Supplier>[] = [
    {
      key: "name",
      header: "Supplier",
      sortValue: (s) => s.name,
      render: (s) => (
        <>
          <span className="strong">{s.name}</span>
          <span className="sub">
            {s.code}
            {s.tin ? ` · TIN ${s.tin}` : ""}
          </span>
        </>
      ),
    },
    {
      key: "category",
      header: "Category",
      className: "hide-sm",
      sortValue: (s) => s.category ?? "",
      render: (s) => (s.category ? humanize(s.category) : <span className="subtle">—</span>),
    },
    {
      key: "terms",
      header: "Terms",
      className: "hide-sm nowrap",
      sortValue: (s) => s.creditPeriodDays,
      render: (s) => (s.creditPeriodDays ? `${s.creditPeriodDays} days` : <span className="muted">On receipt</span>),
    },
    {
      key: "wht",
      header: "WHT",
      numeric: true,
      className: "hide-sm",
      sortValue: (s) => toNumber(s.whtRate),
      render: (s) => (toNumber(s.whtRate) ? `${toNumber(s.whtRate)}%` : <span className="subtle">—</span>),
    },
    {
      key: "balance",
      header: `We owe (${currency})`,
      numeric: true,
      sortValue: (s) => toNumber(s.balance),
      render: (s) => {
        const b = toNumber(s.balance);
        if (Math.abs(b) < 0.005) return <span className="subtle">0</span>;
        return <span className={b > 0 ? "strong" : "text-positive"}>{amount(b)}</span>;
      },
    },
    { key: "status", header: <span className="sr-only">Status</span>, width: 100, render: (s) => <SupplierStatusBadge supplier={s} /> },
  ];

  const filters: Array<[Show, string]> = [
    ["all", "All"],
    ["owing", "We owe"],
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
    <div className="ee-cust-page ee-sup-page">
      <nav className="ee-cust-crumbs" aria-label="Breadcrumb">
        <span>Expenses &amp; Bills</span>
        <span className="ee-cust-crumbs-sep">/</span>
        <span>Suppliers</span>
      </nav>

      <header className="ee-cust-page-head">
        <h1>Suppliers</h1>
        {!showHero && can("ap:manage") && (
          <div className="ee-sup-head-actions">
            <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/suppliers/import")}>
              Import
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" />
              Add supplier
            </button>
          </div>
        )}
      </header>

      {showHero ? (
        <SuppliersHero onAdd={openCreate} onImport={() => navigate("/suppliers/import")} />
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
                  aria-label="Search suppliers"
                />
                <div className="segmented" role="group" aria-label="Filter suppliers">
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
                rowKey={(s) => s.id}
                onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
                initialSort={{ key: "name", dir: "asc" }}
                empty={<EmptyState title="No matching suppliers" body="Try a different search or filter." />}
              />
              {rows.length > 0 && (
                <p className="table-caption">
                  {plural(rows.length, "supplier")} · {money(totalOwed, currency)} owed
                  {all.length >= 200 && " · Showing the first 200 — search to narrow down"}
                </p>
              )}
            </>
          )}
        </Loadable>
      )}

      {creating && can("ap:manage") && (
        <AddSupplierDrawer
          onClose={closeCreate}
          onSaved={(s) => {
            closeCreate();
            list.reload();
            navigate(`/suppliers/${s.id}`);
          }}
        />
      )}
    </div>
  );
}

import { Download, Plus, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CustomerFormDrawer } from "../components/customers/CustomerFormDrawer";
import { MoneyBar } from "../components/customers/MoneyBar";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Badge, EmptyState, ErrorState, Menu, PageHeader, Pagination } from "../components/ui";
import { CUSTOMER_TYPES } from "../components/ArForms";
import { useCompany } from "../lib/company";
import { amount, humanize, plural, toNumber } from "../lib/format";
import { toQuery, usePagedResource } from "../lib/pagination";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import type { Customer, CustomerListPage, CustomerListRow } from "../lib/types";

type BalanceFilter = "" | "owing" | "overdue" | "over-limit" | "credit";
type StatusFilter = "active" | "inactive" | "all";
type Sort = "name" | "code" | "balance" | "created";

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

const SORTS: Array<{ value: string; label: string }> = [
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "balance:desc", label: "Balance, highest first" },
  { value: "balance:asc", label: "Balance, lowest first" },
  { value: "created:desc", label: "Newest first" },
  { value: "code:asc", label: "Customer code" },
];

export function Customers() {
  const { can, api, download } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const balance = (query.get("balance") ?? "") as BalanceFilter;
  const status = (query.get("status") as StatusFilter) || "active";
  const type = query.get("type") ?? "";
  const tag = query.get("tag") ?? "";
  const [sortKey, sortDir] = (query.get("sort") ?? "name:asc").split(":") as [Sort, "asc" | "desc"];
  const [search, setSearch] = useState(query.get("q") ?? "");
  const [debounced, setDebounced] = useState(search.trim());
  const [creating, setCreating] = useState(query.get("new") === "1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(search.trim());
      setQueryParam("q", search.trim() || null);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({ q: debounced, status, balance: balance || undefined, type: type || undefined, tag: tag || undefined, sort: sortKey, dir: sortDir }),
    [debounced, status, balance, type, tag, sortKey, sortDir],
  );
  const list = usePagedResource<CustomerListRow>("/api/v1/ar/customers", params, { key: "customers", defaultPageSize: 25 });
  const page = list.data as CustomerListPage | undefined;
  const counts = page?.counts;

  // Selection only covers what is on screen; drop it when the page or filter changes.
  const rowIds = list.rows.map((r) => r.id).join(",");
  useEffect(() => setSelected(new Set()), [rowIds]);

  const allOnPage = list.rows.length > 0 && list.rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(list.rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function bulkStatus(next: "ACTIVE" | "INACTIVE") {
    const ids = [...selected];
    if (next === "INACTIVE") {
      const ok = await confirm({
        title: `Make ${plural(ids.length, "customer")} inactive?`,
        body: "Inactive customers are hidden from pickers on new transactions. Customers who still owe money or are in credit are skipped.",
        confirmLabel: "Make inactive",
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number; skipped: Array<{ name: string; reason: string }> }>("/api/v1/ar/customers/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids, status: next }),
      });
      const verb = next === "ACTIVE" ? "made active" : "made inactive";
      toast(
        res.skipped.length
          ? `${plural(res.updated, "customer")} ${verb}; ${res.skipped.length} skipped (${res.skipped[0].name}: ${res.skipped[0].reason})`
          : `${plural(res.updated, "customer")} ${verb}`,
        res.skipped.length ? { error: true } : undefined,
      );
      setSelected(new Set());
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkStatusOne(c: CustomerListRow, next: "ACTIVE" | "INACTIVE") {
    try {
      await api(`/api/v1/ar/customers/${c.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      toast(next === "ACTIVE" ? `${c.name} is active again` : `${c.name} made inactive`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  async function exportCsv() {
    try {
      await download(`/api/v1/ar/customers/export.csv${toQuery({ ...params })}`, `customers-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  function statements() {
    const ids = [...selected];
    navigate(`/sales/statement/new${ids.length ? `?customers=${ids.join(",")}` : ""}`);
  }

  const manage = can("ar:manage");
  const columns: Column<CustomerListRow>[] = [
    ...(manage
      ? [
          {
            key: "sel",
            header: <input type="checkbox" aria-label="Select all customers on this page" checked={allOnPage} onChange={toggleAll} />,
            width: 36,
            render: (c: CustomerListRow) => (
              <input
                type="checkbox"
                aria-label={`Select ${c.name}`}
                checked={selected.has(c.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(c.id)}
              />
            ),
          },
        ]
      : []),
    {
      key: "name",
      header: "Customer",
      className: "cust-col-name",
      render: (c) => (
        <>
          <span className="strong cust-name-link">{c.name}</span>
          {(c.parent || c.subCustomerCount > 0 || c.taxExempt || (c.tags?.length ?? 0) > 0) && (
            <span className="cust-row-meta">
              {c.parent && <span className="cust-chip parent">Sub-customer of {c.parent.name}</span>}
              {c.subCustomerCount > 0 && <span className="cust-chip">{plural(c.subCustomerCount, "sub-customer")}</span>}
              {c.taxExempt && <span className="cust-chip">Tax exempt</span>}
              {c.tags?.map((t) => (
                <span key={t} className="cust-chip tag">
                  {t}
                </span>
              ))}
            </span>
          )}
          <span className="sub">{[c.companyName && c.companyName !== c.name ? c.companyName : null, c.code, c.tin && `TIN ${c.tin}`].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      className: "hide-md",
      render: (c) =>
        c.email || c.telephone || c.mobile ? (
          <>
            <span>{c.telephone || c.mobile}</span>
            {c.email && <span className="sub">{c.email}</span>}
          </>
        ) : (
          <span className="subtle">—</span>
        ),
    },
    {
      key: "terms",
      header: "Terms",
      className: "hide-md nowrap",
      render: (c) => (c.creditPeriodDays ? `Net ${c.creditPeriodDays}` : <span className="muted">On receipt</span>),
    },
    {
      key: "overdue",
      header: "Overdue",
      numeric: true,
      className: "hide-sm",
      render: (c) => (c.overdue > 0 ? <span className="text-negative strong">{amount(c.overdue)}</span> : <span className="subtle">—</span>),
    },
    {
      key: "balance",
      header: `Open balance (${currency})`,
      numeric: true,
      render: (c) => {
        const b = toNumber(c.balance);
        if (Math.abs(b) < 0.005) return <span className="subtle">0</span>;
        return <span className={isOverLimit(c) ? "strong text-negative" : b > 0 ? "strong" : "text-positive"}>{b < 0 ? `${amount(-b)} CR` : amount(b)}</span>;
      },
    },
    { key: "status", header: <span className="sr-only">Status</span>, width: 100, render: (c) => <CustomerStatusBadge customer={c} /> },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="cust-act-head">Action</span>,
            width: 170,
            render: (c: CustomerListRow) => (
              <span className="cust-act" onClick={(e) => e.stopPropagation()}>
                {c.status === "ACTIVE" ? (
                  <button type="button" className="link-button cust-act-main" onClick={() => navigate(`/sales/invoice/new?customer=${c.id}`)}>
                    Create invoice
                  </button>
                ) : (
                  <button type="button" className="link-button cust-act-main" onClick={() => void bulkStatusOne(c, "ACTIVE")}>
                    Make active
                  </button>
                )}
                <Menu
                  label=""
                  ariaLabel={`More actions for ${c.name}`}
                  triggerClassName="cust-act-caret"
                  items={[
                    { label: "Receive payment", onSelect: () => navigate(`/customers/${c.id}?action=receive`) },
                    { label: "Create statement", onSelect: () => navigate(`/sales/statement/new?customers=${c.id}`) },
                    { label: "View profile", onSelect: () => navigate(`/customers/${c.id}`) },
                    c.status === "ACTIVE" && { label: "Make inactive", onSelect: () => void bulkStatusOne(c, "INACTIVE") },
                  ]}
                />
              </span>
            ),
          },
        ]
      : []),
  ];

  const chips: Array<[BalanceFilter, string, number | undefined]> = [
    ["", "All", counts?.all],
    ["owing", "Owing", counts?.owing],
    ["overdue", "Overdue", counts?.overdue],
    ["over-limit", "Over limit", counts?.overLimit],
    ["credit", "In credit", counts?.credit],
  ];
  const filtered = Boolean(debounced || balance || type || tag || status !== "active");

  return (
    <div className="cust-page">
      <PageHeader
        title="Customers"
        description={counts ? `${plural(counts.all, status === "inactive" ? "inactive customer" : "customer")}${counts.owing ? ` · ${counts.owing} owing` : ""}` : undefined}
        actions={
          <>
            <Menu
              label="Import / export"
              items={[
                manage && { label: "Import customers", icon: Upload, onSelect: () => navigate("/customers/import") },
                { label: "Export to CSV", icon: Download, onSelect: () => void exportCsv() },
              ]}
            />
            {manage && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" />
                New customer
              </button>
            )}
          </>
        }
      />

      <MoneyBar
        data={page?.moneyBar}
        loading={!page}
        currency={currency}
        active={balance === "overdue" ? "overdue" : balance === "owing" ? "notDue" : null}
        onSelect={(seg) => {
          if (seg === "paid30") return navigate("/invoices?show=paid");
          if (seg === "unbilled") return;
          const next = seg === "overdue" ? "overdue" : "owing";
          setQueryParam("balance", balance === next ? null : next);
        }}
      />

      <div className="tabs cust-tabs" role="tablist" aria-label="Balance filter">
        {chips.map(([key, label, n]) => (
          <button
            key={key || "all"}
            type="button"
            role="tab"
            aria-selected={balance === key}
            className={`tab ${balance === key ? "on" : ""}`}
            onClick={() => setQueryParam("balance", key || null)}
          >
            {label}
            {n !== undefined && <span className="cust-tab-count">{n}</span>}
          </button>
        ))}
      </div>

      <div className="cust-toolbar">
        <div className="cust-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="input"
            type="search"
            placeholder="Search name, company, phone, email or TIN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
        </div>
        <Select
          aria-label="Status"
          className="cust-select"
          value={status}
          onChange={(v) => setQueryParam("status", v === "active" ? null : v)}
          searchable={false}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: `Inactive${counts ? ` (${counts.inactive})` : ""}` },
            { value: "all", label: "All statuses" },
          ]}
        />
        <Select
          aria-label="Customer type"
          className="cust-select"
          value={type}
          onChange={(v) => setQueryParam("type", v || null)}
          searchable={false}
          options={[{ value: "", label: "All types" }, ...CUSTOMER_TYPES.map((t) => ({ value: t, label: humanize(t) }))]}
        />
        {(page?.tags?.length ?? 0) > 0 && (
          <Select
            aria-label="Tag"
            className="cust-select"
            value={tag}
            onChange={(v) => setQueryParam("tag", v || null)}
            searchable={(page?.tags.length ?? 0) > 8}
            options={[{ value: "", label: "All tags" }, ...(page?.tags ?? []).map((t) => ({ value: t.tag, label: t.tag, hint: String(t.count) }))]}
          />
        )}
        <span className="grow" />
        <Select
          aria-label="Sort"
          className="cust-select cust-sort"
          value={`${sortKey}:${sortDir}`}
          onChange={(v) => setQueryParam("sort", v === "name:asc" ? null : v)}
          searchable={false}
          options={SORTS}
        />
        <button type="button" className="icon-button cust-icon-btn" title="Export to CSV" aria-label="Export to CSV" onClick={() => void exportCsv()}>
          <Download size={16} aria-hidden="true" />
        </button>
      </div>

      {selected.size > 0 && (
        <div className="cust-bulk" role="region" aria-label="Bulk actions">
          <strong>{plural(selected.size, "customer")} selected</strong>
          <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={statements}>
            Create statements
          </button>
          {status !== "inactive" && (
            <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={() => void bulkStatus("INACTIVE")}>
              Make inactive
            </button>
          )}
          {status !== "active" && (
            <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={() => void bulkStatus("ACTIVE")}>
              Make active
            </button>
          )}
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(new Set())}>
            Clear
          </button>
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
            rowKey={(c) => c.id}
            loading={list.loading}
            showPagination={false}
            onRowClick={(c) => navigate(`/customers/${c.id}`)}
            rowClassName={(c) => (selected.has(c.id) ? "selected" : undefined)}
            empty={
              filtered ? (
                <EmptyState title="No matching customers" body="Try a different search or clear the filters." action={
                  <button type="button" className="btn btn-sm" onClick={() => { setSearch(""); navigate("/customers", { replace: true }); }}>
                    Clear filters
                  </button>
                } />
              ) : (
                <EmptyState
                  title="No customers yet"
                  body="Add the people and businesses you sell to, or import them from a spreadsheet."
                  action={
                    manage ? (
                      <span style={{ display: "inline-flex", gap: 8 }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                          New customer
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => navigate("/customers/import")}>
                          Import
                        </button>
                      </span>
                    ) : undefined
                  }
                />
              )
            }
          />
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} label="Customer pages" />
        </div>
      )}

      {creating && (
        <CustomerFormDrawer
          initialName={debounced && !list.total ? debounced : undefined}
          onClose={() => {
            setCreating(false);
            setQueryParam("new", null);
          }}
          onSaved={(c) => {
            setCreating(false);
            navigate(`/customers/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

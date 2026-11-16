import { Download, Plus, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MoneyBar, PAYABLES_LABELS } from "../components/customers/MoneyBar";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { SUPPLIER_TYPES, SupplierFormDrawer } from "../components/suppliers/SupplierFormDrawer";
import { Badge, EmptyState, ErrorState, Menu, PageHeader, Pagination } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, humanize, plural, toNumber } from "../lib/format";
import { toQuery, usePagedResource } from "../lib/pagination";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import type { Supplier, SupplierListPage, SupplierListRow } from "../lib/types";

type BalanceFilter = "" | "owing" | "overdue" | "credit";
type StatusFilter = "active" | "inactive" | "all";
type Sort = "name" | "code" | "balance" | "purchases" | "lastActivity" | "created";

export function SupplierStatusBadge({ supplier }: { supplier: Supplier }) {
  if (supplier.status === "INACTIVE") return <Badge>Inactive</Badge>;
  if (toNumber(supplier.balance) < -0.005) return <Badge tone="info">Prepaid</Badge>;
  return null;
}

const SORTS: Array<{ value: string; label: string }> = [
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "balance:desc", label: "Open balance, highest first" },
  { value: "purchases:desc", label: "Purchases, highest first" },
  { value: "lastActivity:desc", label: "Most recent transaction" },
  { value: "created:desc", label: "Newest first" },
  { value: "code:asc", label: "Supplier code" },
];

/**
 * Supplier centre list, on the QuickBooks Vendors model: money bar, balance tabs, server-side search,
 * filters, sort and pagination, bulk status changes and CSV import/export. Every figure comes from the API.
 */
export function Suppliers() {
  const { can, api, download } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const balance = (query.get("balance") ?? "") as BalanceFilter;
  const status = (query.get("status") as StatusFilter) || "active";
  const category = query.get("category") ?? "";
  const type = query.get("type") ?? "";
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
    () => ({ q: debounced, status, balance: balance || undefined, category: category || undefined, type: type || undefined, sort: sortKey, dir: sortDir }),
    [debounced, status, balance, category, type, sortKey, sortDir],
  );
  const list = usePagedResource<SupplierListRow>("/api/v1/ap/suppliers", params, { key: "suppliers", defaultPageSize: 25 });
  const page = list.data as SupplierListPage | undefined;
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
        title: `Make ${plural(ids.length, "supplier")} inactive?`,
        body: "Inactive suppliers are hidden from pickers on new transactions. Suppliers you still owe, or who owe you, are skipped.",
        confirmLabel: "Make inactive",
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number; skipped: Array<{ name: string; reason: string }> }>("/api/v1/ap/suppliers/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids, status: next }),
      });
      const verb = next === "ACTIVE" ? "made active" : "made inactive";
      toast(
        res.skipped.length
          ? `${plural(res.updated, "supplier")} ${verb}; ${res.skipped.length} skipped (${res.skipped[0].name}: ${res.skipped[0].reason})`
          : `${plural(res.updated, "supplier")} ${verb}`,
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

  async function setOneStatus(s: SupplierListRow, next: "ACTIVE" | "INACTIVE") {
    if (next === "INACTIVE") {
      const ok = await confirm({ title: `Make ${s.name} inactive?`, body: "They will be hidden from pickers on new transactions. Their history stays.", confirmLabel: "Make inactive" });
      if (!ok) return;
    }
    try {
      await api(`/api/v1/ap/suppliers/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      toast(next === "ACTIVE" ? `${s.name} is active again` : `${s.name} made inactive`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  async function exportCsv() {
    try {
      await download(`/api/v1/ap/suppliers/export.csv${toQuery({ ...params })}`, `suppliers-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const manage = can("ap:manage");
  const columns: Column<SupplierListRow>[] = [
    ...(manage
      ? [
          {
            key: "sel",
            header: <input type="checkbox" aria-label="Select all suppliers on this page" checked={allOnPage} onChange={toggleAll} />,
            width: 36,
            render: (s: SupplierListRow) => (
              <input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(s.id)} />
            ),
          },
        ]
      : []),
    {
      key: "name",
      header: "Supplier",
      className: "cust-col-name",
      render: (s) => (
        <>
          <span className="strong cust-name-link">{s.name}</span>
          {(s.category || s.status === "INACTIVE" || toNumber(s.balance) < -0.005) && (
            <span className="cust-row-meta">
              {s.category && <span className="cust-chip">{humanize(s.category)}</span>}
              <SupplierStatusBadge supplier={s} />
            </span>
          )}
          <span className="sub">{[s.companyName && s.companyName !== s.name ? s.companyName : null, s.code, s.tin && `TIN ${s.tin}`].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      className: "hide-md",
      render: (s) => {
        const phone = s.telephone || s.mobile;
        const first = s.contactPerson || s.email || phone;
        if (!first) return <span className="subtle">—</span>;
        const rest = [s.contactPerson ? s.email : null, first !== phone ? phone : null].filter(Boolean).join(" · ");
        return (
          <>
            <span>{first}</span>
            {rest && <span className="sub">{rest}</span>}
          </>
        );
      },
    },
    {
      key: "tin",
      header: "TIN",
      className: "sup-hide-lg nowrap",
      render: (s) => s.tin || <span className="subtle">—</span>,
    },
    {
      key: "purchases",
      header: "Purchases",
      numeric: true,
      className: "hide-sm",
      render: (s) => (s.purchases ? amount(s.purchases) : <span className="subtle">—</span>),
    },
    {
      key: "last",
      header: "Last transaction",
      className: "sup-hide-lg nowrap",
      render: (s) => (s.lastActivity ? date(s.lastActivity) : <span className="subtle">None yet</span>),
    },
    {
      key: "overdue",
      header: "Overdue",
      numeric: true,
      className: "hide-sm",
      render: (s) => (s.overdue > 0 ? <span className="text-negative strong">{amount(s.overdue)}</span> : <span className="subtle">—</span>),
    },
    {
      key: "balance",
      header: `Open balance (${currency})`,
      numeric: true,
      render: (s) => {
        const b = toNumber(s.balance);
        if (Math.abs(b) < 0.005) return <span className="subtle">0</span>;
        return <span className={b > 0 ? "strong" : "text-positive"}>{b < 0 ? `${amount(-b)} CR` : amount(b)}</span>;
      },
    },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="cust-act-head">Action</span>,
            width: 160,
            render: (s: SupplierListRow) => (
              <span className="cust-act" onClick={(e) => e.stopPropagation()}>
                {s.status === "INACTIVE" ? (
                  <button type="button" className="link-button cust-act-main" onClick={() => void setOneStatus(s, "ACTIVE")}>
                    Make active
                  </button>
                ) : toNumber(s.balance) > 0.005 ? (
                  <button type="button" className="link-button cust-act-main" onClick={() => navigate(`/expenses/pay-bills?supplier=${s.id}`)}>
                    Pay bills
                  </button>
                ) : (
                  <button type="button" className="link-button cust-act-main" onClick={() => navigate(`/expenses/bill/new?supplier=${s.id}`)}>
                    Create bill
                  </button>
                )}
                <Menu
                  label=""
                  ariaLabel={`More actions for ${s.name}`}
                  triggerClassName="cust-act-caret"
                  items={[
                    s.status === "ACTIVE" && { label: "Create bill", onSelect: () => navigate(`/expenses/bill/new?supplier=${s.id}`) },
                    s.status === "ACTIVE" && { label: "Create purchase order", onSelect: () => navigate(`/expenses/purchase-order/new?supplier=${s.id}`) },
                    s.status === "ACTIVE" && { label: "Record supplier credit", onSelect: () => navigate(`/expenses/supplier-credit/new?supplier=${s.id}`) },
                    toNumber(s.balance) > 0.005 && { label: "Pay bills", onSelect: () => navigate(`/expenses/pay-bills?supplier=${s.id}`) },
                    { label: "View profile", onSelect: () => navigate(`/suppliers/${s.id}`) },
                    s.status === "ACTIVE" && { label: "Make inactive", onSelect: () => void setOneStatus(s, "INACTIVE") },
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
    ["owing", "We owe", counts?.owing],
    ["overdue", "Overdue", counts?.overdue],
    ["credit", "Prepaid / credit", counts?.credit],
  ];
  const filtered = Boolean(debounced || balance || category || type || status !== "active");

  return (
    <div className="cust-page">
      <PageHeader
        title="Suppliers"
        description={
          counts
            ? `${plural(counts.all, status === "inactive" ? "inactive supplier" : "supplier")}${page?.totals.owed ? ` · ${currency} ${amount(page.totals.owed)} owed` : ""}`
            : undefined
        }
        actions={
          <>
            <Menu
              label="Import / export"
              items={[
                manage && { label: "Import suppliers", icon: Upload, onSelect: () => navigate("/suppliers/import") },
                { label: "Export to CSV", icon: Download, onSelect: () => void exportCsv() },
              ]}
            />
            {manage && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" />
                New supplier
              </button>
            )}
          </>
        }
      />

      <MoneyBar
        labels={PAYABLES_LABELS}
        data={page ? { unbilled: page.moneyBar.purchaseOrders, overdue: page.moneyBar.overdue, notDue: page.moneyBar.notDue, paid30: page.moneyBar.paid30 } : undefined}
        loading={!page}
        currency={currency}
        active={balance === "overdue" ? "overdue" : balance === "owing" ? "notDue" : null}
        onSelect={(seg) => {
          if (seg === "paid30") return navigate("/supplier-payments");
          // Purchase orders have no list page yet; they appear on each supplier's profile.
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
            aria-label="Search suppliers"
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
        {(page?.categories.length ?? 0) > 0 && (
          <Select
            aria-label="Category"
            className="cust-select"
            value={category}
            onChange={(v) => setQueryParam("category", v || null)}
            searchable={(page?.categories.length ?? 0) > 8}
            options={[{ value: "", label: "All categories" }, ...(page?.categories ?? []).map((c) => ({ value: c.category, label: humanize(c.category), hint: String(c.count) }))]}
          />
        )}
        <Select
          aria-label="Supplier type"
          className="cust-select"
          value={type}
          onChange={(v) => setQueryParam("type", v || null)}
          searchable={false}
          options={[{ value: "", label: "All types" }, ...SUPPLIER_TYPES]}
        />
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
          <strong>{plural(selected.size, "supplier")} selected</strong>
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
            rowKey={(s) => s.id}
            loading={list.loading}
            showPagination={false}
            onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
            rowClassName={(s) => (selected.has(s.id) ? "selected" : undefined)}
            empty={
              filtered ? (
                <EmptyState
                  title="No matching suppliers"
                  body="Try a different search or clear the filters."
                  action={
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setSearch("");
                        navigate("/suppliers", { replace: true });
                      }}
                    >
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="No suppliers yet"
                  body="Add the businesses and people you buy from, or import them from a spreadsheet. Bills, purchase orders and payments are then tracked per supplier."
                  action={
                    manage ? (
                      <span style={{ display: "inline-flex", gap: 8 }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                          New supplier
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => navigate("/suppliers/import")}>
                          Import
                        </button>
                      </span>
                    ) : undefined
                  }
                />
              )
            }
          />
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} label="Supplier pages" />
        </div>
      )}

      {creating && (
        <SupplierFormDrawer
          initialName={debounced && !list.total ? debounced : undefined}
          onClose={() => {
            setCreating(false);
            setQueryParam("new", null);
          }}
          onSaved={(s) => {
            setCreating(false);
            navigate(`/suppliers/${s.id}`);
          }}
        />
      )}
    </div>
  );
}

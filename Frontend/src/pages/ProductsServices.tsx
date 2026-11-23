import { AlertTriangle, Download, PackageX, Plus, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { useFeedback } from "../components/feedback";
import { ITEM_TYPE_LABEL, ItemFormDrawer } from "../components/items/ItemFormDrawer";
import { Select } from "../components/Select";
import { Badge, EmptyState, ErrorState, Menu, PageHeader, Pagination } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, plural } from "../lib/format";
import { toQuery, usePagedResource } from "../lib/pagination";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import type { ItemListPage, ItemRow, ItemType } from "../lib/types";

type TypeTab = "" | ItemType;
type StatusFilter = "active" | "inactive" | "all";

const SORTS = [
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "sku:asc", label: "SKU" },
  { value: "type:asc", label: "Type" },
  { value: "salesPrice:desc", label: "Price, highest first" },
  { value: "purchaseCost:desc", label: "Cost, highest first" },
  { value: "quantity:asc", label: "Quantity, lowest first" },
  { value: "updated:desc", label: "Recently changed" },
];

/**
 * Products and services list on the QuickBooks model: stock cards, type tabs, server-side search, filters,
 * sort and pagination, bulk status changes and CSV import/export. Stock quantities come from the ERP.
 */
export function ProductsServices() {
  const { can, api, download } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const type = (query.get("type") ?? "") as TypeTab;
  const stock = (query.get("stock") ?? "") as "" | "low" | "out";
  const status = (query.get("status") as StatusFilter) || "active";
  const category = query.get("category") ?? "";
  const source = query.get("source") ?? "";
  const [sortKey, sortDir] = (query.get("sort") ?? "name:asc").split(":");
  const [search, setSearch] = useState(query.get("q") ?? "");
  const [debounced, setDebounced] = useState(search.trim());
  const [editing, setEditing] = useState<{ id?: string; copyOf?: string } | null>(query.get("new") === "1" ? {} : null);
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
    () => ({ q: debounced, type: type || undefined, stock: stock || undefined, status, category: category || undefined, source: source || undefined, sort: sortKey, dir: sortDir }),
    [debounced, type, stock, status, category, source, sortKey, sortDir],
  );
  const list = usePagedResource<ItemRow>("/api/v1/inventory/items", params, { key: "items", defaultPageSize: 25 });
  const page = list.data as ItemListPage | undefined;
  const counts = page?.counts;
  const categories = useMemo(() => (page?.categories ?? []).map((c) => c.name), [page?.categories]);

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

  async function setStatus(ids: string[], isActive: boolean, label: string) {
    if (!isActive) {
      const ok = await confirm({
        title: `Make ${label} inactive?`,
        body: "Inactive items are hidden from new invoices, bills and orders. Past transactions keep them, and you can make them active again at any time.",
        confirmLabel: "Make inactive",
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number }>("/api/v1/inventory/items/bulk-status", { method: "POST", body: JSON.stringify({ ids, isActive }) });
      toast(`${ids.length === 1 ? label : plural(res.updated, "item")} ${isActive ? "made active" : "made inactive"}`);
      setSelected(new Set());
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBulkBusy(false);
    }
  }

  async function exportCsv() {
    try {
      await download(`/api/v1/inventory/items/export.csv${toQuery({ ...params })}`, `products-and-services-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const manage = can("inventory:manage");
  const dash = <span className="subtle">—</span>;
  const columns: Column<ItemRow>[] = [
    ...(manage
      ? [
          {
            key: "sel",
            header: <input type="checkbox" aria-label="Select all items on this page" checked={allOnPage} onChange={toggleAll} />,
            width: 36,
            render: (r: ItemRow) => <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} />,
          },
        ]
      : []),
    {
      key: "name",
      header: "Name",
      className: "cust-col-name",
      render: (r) => (
        <>
          <span className="strong cust-name-link">{r.name}</span>
          {(r.category || !r.isActive || r.source === "ERP") && (
            <span className="cust-row-meta">
              {r.category && <span className="cust-chip">{r.category}</span>}
              {!r.isActive && <Badge>Inactive</Badge>}
              {r.source === "ERP" && <span className="ps-erp" title="Name, SKU and quantities come from the ERP">ERP</span>}
            </span>
          )}
          {(r.salesDescription || r.purchaseDescription) && <span className="sub ps-desc">{r.salesDescription || r.purchaseDescription}</span>}
        </>
      ),
    },
    { key: "sku", header: "SKU", className: "hide-md nowrap", render: (r) => r.sku || dash },
    { key: "type", header: "Type", className: "hide-sm nowrap", render: (r) => ITEM_TYPE_LABEL[r.type] },
    {
      key: "price",
      header: `Sales price (${currency})`,
      numeric: true,
      render: (r) => (r.salesPrice != null ? amount(r.salesPrice, r.salesPrice % 1 ? 2 : 0) : dash),
    },
    {
      key: "cost",
      header: "Cost",
      numeric: true,
      className: "hide-md",
      render: (r) => {
        const c = r.type === "INVENTORY" ? r.averageCost : r.purchaseCost;
        return c != null ? <span title={r.type === "INVENTORY" ? "Average cost from the ERP" : undefined}>{amount(c, c % 1 ? 2 : 0)}</span> : dash;
      },
    },
    {
      key: "qty",
      header: "Qty on hand",
      numeric: true,
      render: (r) => {
        if (r.quantity == null) return dash;
        const tone = r.stockStatus === "OUT" ? "text-negative strong" : r.stockStatus === "LOW" ? "ps-low strong" : undefined;
        return (
          <>
            <span className={tone}>{amount(r.quantity)}</span>
            {r.stockStatus === "OUT" && <span className="sub text-negative">Out of stock</span>}
            {r.stockStatus === "LOW" && <span className="sub ps-low">Low · reorder at {amount(r.reorderPoint ?? 0)}</span>}
          </>
        );
      },
    },
    { key: "reorder", header: "Reorder point", numeric: true, className: "sup-hide-lg", render: (r) => (r.reorderPoint != null ? amount(r.reorderPoint) : dash) },
    ...(manage
      ? [
          {
            key: "act",
            header: <span className="cust-act-head">Action</span>,
            width: 130,
            render: (r: ItemRow) => (
              <span className="cust-act" onClick={(e) => e.stopPropagation()}>
                {r.isActive ? (
                  <button type="button" className="link-button cust-act-main" onClick={() => setEditing({ id: r.id })}>
                    Edit
                  </button>
                ) : (
                  <button type="button" className="link-button cust-act-main" onClick={() => void setStatus([r.id], true, r.name)}>
                    Make active
                  </button>
                )}
                <Menu
                  label=""
                  ariaLabel={`More actions for ${r.name}`}
                  triggerClassName="cust-act-caret"
                  items={[
                    !r.isActive && { label: "Edit", onSelect: () => setEditing({ id: r.id }) },
                    { label: "Duplicate", onSelect: () => setEditing({ copyOf: r.id }) },
                    r.isActive && { label: "Make inactive", onSelect: () => void setStatus([r.id], false, r.name) },
                  ]}
                />
              </span>
            ),
          },
        ]
      : []),
  ];

  const tabs: Array<[TypeTab, string, number | undefined]> = [
    ["", "All", counts?.active],
    ["SERVICE", "Services", counts?.service],
    ["NON_INVENTORY", "Non-stock", counts?.nonInventory],
    ["INVENTORY", "Stock", counts?.inventory],
  ];
  const filtered = Boolean(debounced || type || stock || category || source || status !== "active");

  return (
    <div className="cust-page">
      <PageHeader
        title="Products and services"
        description={counts ? `${plural(counts.active, "active item")}${counts.inactive ? ` · ${counts.inactive} inactive` : ""}` : undefined}
        actions={
          <>
            <Menu
              label="Import / export"
              items={[
                manage && { label: "Import products and services", icon: Upload, onSelect: () => navigate("/products-services/import") },
                { label: "Export to CSV", icon: Download, onSelect: () => void exportCsv() },
              ]}
            />
            {manage && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
                <Plus size={16} aria-hidden="true" />
                New
              </button>
            )}
          </>
        }
      />

      <div className="ps-cards" role="group" aria-label="Stock status">
        <button type="button" className={`ps-card ${stock === "low" ? "on" : ""}`} onClick={() => setQueryParam("stock", stock === "low" ? null : "low")} aria-pressed={stock === "low"}>
          <AlertTriangle size={20} className="ps-low" aria-hidden="true" />
          <span>
            <span className="ps-card-num">{counts ? counts.lowStock : "–"}</span>
            <span className="ps-card-label">Low stock</span>
          </span>
        </button>
        <button type="button" className={`ps-card ${stock === "out" ? "on" : ""}`} onClick={() => setQueryParam("stock", stock === "out" ? null : "out")} aria-pressed={stock === "out"}>
          <PackageX size={20} className="text-negative" aria-hidden="true" />
          <span>
            <span className="ps-card-num">{counts ? counts.outOfStock : "–"}</span>
            <span className="ps-card-label">Out of stock</span>
          </span>
        </button>
        <p className="ps-cards-note small muted">Stock items and their quantities come from the ERP. Set a reorder point on an item to see it here when it runs low.</p>
      </div>

      <div className="tabs cust-tabs" role="tablist" aria-label="Item type">
        {tabs.map(([key, label, n]) => (
          <button key={key || "all"} type="button" role="tab" aria-selected={type === key} className={`tab ${type === key ? "on" : ""}`} onClick={() => setQueryParam("type", key || null)}>
            {label}
            {n !== undefined && <span className="cust-tab-count">{n}</span>}
          </button>
        ))}
      </div>

      <div className="cust-toolbar">
        <div className="cust-search">
          <Search size={15} aria-hidden="true" />
          <input className="input" type="search" placeholder="Search name, SKU, description or category" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products and services" />
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
        {categories.length > 0 && (
          <Select
            aria-label="Category"
            className="cust-select"
            value={category}
            onChange={(v) => setQueryParam("category", v || null)}
            searchable={categories.length > 8}
            options={[{ value: "", label: "All categories" }, ...(page?.categories ?? []).map((c) => ({ value: c.name, label: c.name, hint: String(c.count) }))]}
          />
        )}
        <Select
          aria-label="Source"
          className="cust-select"
          value={source}
          onChange={(v) => setQueryParam("source", v || null)}
          searchable={false}
          options={[
            { value: "", label: "All sources" },
            { value: "erp", label: "From the ERP" },
            { value: "app", label: "Created here" },
          ]}
        />
        <span className="grow" />
        <Select aria-label="Sort" className="cust-select cust-sort" value={`${sortKey}:${sortDir}`} onChange={(v) => setQueryParam("sort", v === "name:asc" ? null : v)} searchable={false} options={SORTS} />
        <button type="button" className="icon-button cust-icon-btn" title="Export to CSV" aria-label="Export to CSV" onClick={() => void exportCsv()}>
          <Download size={16} aria-hidden="true" />
        </button>
      </div>

      {selected.size > 0 && (
        <div className="cust-bulk" role="region" aria-label="Bulk actions">
          <strong>{plural(selected.size, "item")} selected</strong>
          {status !== "inactive" && (
            <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={() => void setStatus([...selected], false, plural(selected.size, "item"))}>
              Make inactive
            </button>
          )}
          {status !== "active" && (
            <button type="button" className="btn btn-sm" disabled={bulkBusy} onClick={() => void setStatus([...selected], true, plural(selected.size, "item"))}>
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
            rowKey={(r) => r.id}
            loading={list.loading}
            showPagination={false}
            onRowClick={manage ? (r) => setEditing({ id: r.id }) : undefined}
            rowClassName={(r) => (selected.has(r.id) ? "selected" : undefined)}
            empty={
              filtered ? (
                <EmptyState
                  title="No matching items"
                  body="Try a different search or clear the filters."
                  action={
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setSearch("");
                        navigate("/products-services", { replace: true });
                      }}
                    >
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="No products or services yet"
                  body="Add the services and goods you sell and buy, so their prices, accounts and tax fill in on invoices and bills. Stock items appear here automatically from the ERP."
                  action={
                    manage ? (
                      <span style={{ display: "inline-flex", gap: 8 }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
                          New item
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => navigate("/products-services/import")}>
                          Import
                        </button>
                      </span>
                    ) : undefined
                  }
                />
              )
            }
          />
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} label="Item pages" />
        </div>
      )}

      {editing && (
        <ItemFormDrawer
          itemId={editing.id}
          copyOf={editing.copyOf}
          initialName={!editing.id && !editing.copyOf && debounced && !list.total ? debounced : undefined}
          categories={categories}
          onClose={() => {
            setEditing(null);
            setQueryParam("new", null);
          }}
          onSaved={() => {
            setEditing(null);
            setQueryParam("new", null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

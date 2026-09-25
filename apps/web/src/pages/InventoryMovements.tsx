import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type Column, DataTable } from "../components/DataTable";
import { Select } from "../components/Select";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date } from "../lib/format";
import { COST_SOURCE_LABELS, KIND_GROUPS, KIND_LABELS, postingStatus } from "../lib/inventory";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource } from "../lib/session";
import type { InventoryLocation, InventoryMovement, InventoryMovementPage } from "../lib/types";

const PAGE_SIZE = 50;

export function InventoryMovements() {
  const { currency } = useCompany();
  const { query } = useLocation();
  const show = query.get("show") ?? "all";
  const itemId = query.get("itemId") ?? "";
  const costSource = query.get("costSource") ?? "";
  const locationId = query.get("locationId") ?? "";
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  const page = Number(query.get("page") ?? 1) || 1;
  const [search, setSearch] = useState(query.get("q") ?? "");

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((query.get("q") ?? "") !== search.trim()) {
        setQueryParam("page", null);
        setQueryParam("q", search.trim() || null);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, query]);

  const group = KIND_GROUPS.find((g) => g.key === show);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (group) params.set("kind", group.kinds.join(","));
  for (const [k, v] of Object.entries({ itemId, costSource, locationId, from, to, q: query.get("q") ?? "" })) if (v) params.set(k, v);

  const movements = useResource<InventoryMovementPage>(`/api/v1/inventory/movements?${params}`);
  const locations = useResource<InventoryLocation[]>("/api/v1/inventory/locations");
  const itemName = movements.data?.rows.find((r) => r.item.id === itemId)?.item.name;

  const filter = (key: string, value: string | null) => {
    setQueryParam("page", null);
    setQueryParam(key, value);
  };

  const columns: Column<InventoryMovement>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (m) => date(m.movementDate) },
    {
      key: "item",
      header: "Item",
      render: (m) => (
        <>
          <Link to={`/inventory/movements?itemId=${m.item.id}`} style={{ color: "inherit" }}>
            {m.item.name}
          </Link>
          <span className="sub">{[m.item.sku, m.location.name].filter(Boolean).join(" · ")}</span>
        </>
      ),
    },
    {
      key: "kind",
      header: "Movement",
      render: (m) => (
        <>
          {KIND_LABELS[m.kind]}
          {(m.reference || m.batchNumber) && <span className="sub">{[m.reference, m.batchNumber && `Batch ${m.batchNumber}`].filter(Boolean).join(" · ")}</span>}
        </>
      ),
    },
    { key: "in", header: "In", numeric: true, className: "hide-sm", render: (m) => (m.quantityIn ? amount(m.quantityIn) : "") },
    { key: "out", header: "Out", numeric: true, className: "hide-sm", render: (m) => (m.quantityOut ? amount(m.quantityOut) : "") },
    {
      key: "cost",
      header: "Unit cost",
      numeric: true,
      className: "hide-md",
      render: (m) => (
        <span title={COST_SOURCE_LABELS[m.costSource]} className={m.costSource === "UNCOSTED" ? "text-warning" : undefined}>
          {m.costSource === "UNCOSTED" ? "No cost" : amount(m.unitCost, 2)}
        </span>
      ),
    },
    {
      key: "value",
      header: `Value (${currency})`,
      numeric: true,
      render: (m) => <span className={m.value > 0 ? "text-positive" : undefined}>{amount(m.value)}</span>,
    },
    {
      key: "journal",
      header: "Posted",
      className: "hide-sm nowrap",
      render: (m) =>
        m.journalId ? (
          <Link to={`/journals?id=${m.journalId}`} onClick={(e) => e.stopPropagation()}>
            {m.journalNumber}
          </Link>
        ) : (
          <span className={postingStatus(m) === "Not posted" ? "text-warning" : "muted"}>{postingStatus(m)}</span>
        ),
    },
  ];

  const filters: Array<[string, string]> = [["all", "All"], ...KIND_GROUPS.map((g) => [g.key, g.label] as [string, string])];
  const total = movements.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Stock movements" description="Every stock movement from Excel Edge, with the cost Accounting gave it and the journal it posted." />

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search item, SKU or reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search movements" />
        <div className="segmented" role="group" aria-label="Movement type">
          {filters.map(([key, label]) => (
            <button key={key} type="button" className={show === key ? "on" : ""} onClick={() => filter("show", key === "all" ? null : key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-bar">
        <Field label="Branch">
          <Select
            value={locationId}
            onChange={(v) => filter("locationId", v || null)}
            options={[{ value: "", label: "All branches" }, ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))]}
            style={{ width: 200 }}
          />
        </Field>
        <Field label="From">
          <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => filter("from", e.target.value || null)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => filter("to", e.target.value || null)} />
        </Field>
        {(itemId || costSource) && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={{ alignSelf: "flex-end", height: 34 }}
            onClick={() => {
              filter("itemId", null);
              setQueryParam("costSource", null);
            }}
          >
            {itemId ? `Only ${itemName ?? "one item"}` : COST_SOURCE_LABELS[costSource as InventoryMovement["costSource"]] ?? costSource}
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <Loadable resource={movements}>
        {(p) => (
          <>
            <DataTable
              columns={columns}
              rows={p.rows}
              rowKey={(m) => m.id}
              pageSize={PAGE_SIZE}
              empty={
                total === 0 && show === "all" && !itemId && !locationId && !from && !to && !query.get("q") ? (
                  <EmptyState title="No stock movements yet" body="Movements appear here as Excel Edge receives, sells, adjusts and transfers stock." />
                ) : (
                  <EmptyState title="No movements match" body="Try a different search, branch, date range or type." />
                )
              }
              footer={
                p.rows.length > 0 && (
                  <tr>
                    <td colSpan={3}>{pages > 1 ? "Total for all matching movements" : "Total"}</td>
                    <td className="num hide-sm">{amount(p.totals.quantityIn)}</td>
                    <td className="num hide-sm">{amount(p.totals.quantityOut)}</td>
                    <td className="hide-md" />
                    <td className="num">{amount(p.totals.value)}</td>
                    <td className="hide-sm" />
                  </tr>
                )
              }
            />
            {pages > 1 && (
              <div className="pager">
                <span>
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <button type="button" className="icon-button" onClick={() => setQueryParam("page", String(page - 1))} disabled={page <= 1} aria-label="Previous page">
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button type="button" className="icon-button" onClick={() => setQueryParam("page", String(page + 1))} disabled={page >= pages} aria-label="Next page">
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}
      </Loadable>
    </>
  );
}

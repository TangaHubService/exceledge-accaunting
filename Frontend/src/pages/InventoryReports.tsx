import { Printer } from "lucide-react";
import { useState } from "react";
import { Select } from "../components/Select";
import { Badge, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay, plural } from "../lib/format";
import { METHOD_LABELS } from "../lib/inventory";
import { Link } from "../lib/router";
import { useResource } from "../lib/session";
import type { CostOfSalesReport as CostOfSales, InventoryLocation, InventoryValuation, SlowMovingReport as SlowMoving } from "../lib/types";
import { monthStart, PeriodFilter } from "./WithholdingTax";

function PrintButton() {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      <Printer size={16} aria-hidden="true" />
      Print
    </button>
  );
}

export function InventoryValuationReport() {
  const { name, currency } = useCompany();
  const [asOf, setAsOf] = useState(isoDay());
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const params = new URLSearchParams();
  if (asOf !== isoDay()) params.set("asOf", asOf);
  if (locationId) params.set("locationId", locationId);
  if (category) params.set("category", category);
  const report = useResource<InventoryValuation>(`/api/v1/inventory/valuation?${params}`);
  const locations = useResource<InventoryLocation[]>("/api/v1/inventory/locations");
  const categories = report.data?.categories ?? [];

  return (
    <>
      <PageHeader title="Inventory valuation" description="Quantity and value of every item at every branch, from the accounting stock records." actions={<PrintButton />} />
      <div className="filter-bar no-print">
        <Field label="As at">
          <input className="input" type="date" value={asOf} max={isoDay()} onChange={(e) => setAsOf(e.target.value || isoDay())} />
        </Field>
        <Field label="Branch">
          <Select
            value={locationId}
            onChange={setLocationId}
            options={[{ value: "", label: "All branches" }, ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))]}
            style={{ width: 200 }}
          />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={setCategory} options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]} style={{ width: 200 }} />
        </Field>
      </div>

      <Loadable resource={report}>
        {(r) => (
          <div className="report">
            <div className="report-head">
              <div className="company">{name}</div>
              <div className="title">Inventory valuation</div>
              <div className="period">
                As at {date(r.asOf)} · {METHOD_LABELS[r.valuationMethod]} · Amounts in {currency}
              </div>
            </div>
            {r.lines.length === 0 ? (
              <EmptyState title="No stock valued" body="Nothing was on hand at this date for the selected branch and category." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table pin-first">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Branch</th>
                      <th className="hide-md">Category</th>
                      <th className="num">Quantity</th>
                      <th className="num hide-sm">Unit cost</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={`${l.itemId}:${l.locationId}`}>
                        <td>
                          <Link to={`/inventory/movements?itemId=${l.itemId}`} style={{ color: "inherit" }}>
                            {l.name}
                          </Link>
                          {l.sku && <span className="sub">{l.sku}</span>}
                        </td>
                        <td>{l.location}</td>
                        <td className="hide-md muted">{l.category ?? "—"}</td>
                        <td className={`num ${l.quantity < 0 ? "text-negative" : ""}`}>
                          {amount(l.quantity)} {l.unit && <span className="muted small">{l.unit}</span>}
                        </td>
                        <td className="num hide-sm">{l.unitCost !== null ? amount(l.unitCost, 2) : <span className="subtle">—</span>}</td>
                        <td className="num strong">{amount(l.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td />
                      <td className="hide-md" />
                      <td className="num">{amount(r.totalQuantity)}</td>
                      <td className="hide-sm" />
                      <td className="num">{amount(r.totalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="report-foot">
              <span>Values come from Excel Edge stock movements costed by Accounting. Unit cost is value divided by quantity.</span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}

export function CostOfSalesReport() {
  const { name, currency } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const report = useResource<CostOfSales>(`/api/v1/inventory/reports/cost-of-sales?from=${from}&to=${to}`);

  return (
    <>
      <PageHeader title="Cost of goods sold" description="What the items sold in the period cost, less goods customers returned." actions={<PrintButton />} />
      <PeriodFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <Loadable resource={report}>
        {(r) => (
          <div className="report">
            <div className="report-head">
              <div className="company">{name}</div>
              <div className="title">Cost of goods sold by item</div>
              <div className="period">
                {date(r.from)} to {date(r.to)} · Amounts in {currency}
              </div>
            </div>
            {r.lines.length === 0 ? (
              <EmptyState title="No sales in this period" body="Cost of goods sold appears here once Excel Edge sales are recorded." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Sold</th>
                      <th className="num hide-sm">Cost</th>
                      <th className="num hide-sm">Returned</th>
                      <th className="num">Net cost</th>
                      <th className="num hide-sm">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={l.itemId}>
                        <td>
                          <Link to={`/inventory/movements?itemId=${l.itemId}&show=sold`} style={{ color: "inherit" }}>
                            {l.name}
                          </Link>
                          <span className="sub">{[l.sku, l.category].filter(Boolean).join(" · ")}</span>
                        </td>
                        <td className="num">
                          {amount(l.quantitySold)}
                          {l.quantityReturned > 0 && <span className="sub">{amount(l.quantityReturned)} back</span>}
                        </td>
                        <td className="num hide-sm">{amount(l.cost)}</td>
                        <td className="num hide-sm">{l.returnedCost ? amount(-l.returnedCost) : <span className="subtle">0</span>}</td>
                        <td className="num strong">{amount(l.netCost)}</td>
                        <td className="num hide-sm muted">{r.totals.netCost ? `${Math.round((l.netCost / r.totals.netCost) * 100)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{amount(r.totals.quantitySold)}</td>
                      <td className="num hide-sm">{amount(r.totals.cost)}</td>
                      <td className="num hide-sm">{amount(-r.totals.returnedCost)}</td>
                      <td className="num">{amount(r.totals.netCost)}</td>
                      <td className="num hide-sm">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <dl className="report-summary">
              <div>
                <dt>Stock value at the start</dt>
                <dd className="num">{amount(r.openingValue)}</dd>
              </div>
              <div>
                <dt>Stock value at the end</dt>
                <dd className="num">{amount(r.closingValue)}</dd>
              </div>
              <div>
                <dt>Inventory turnover</dt>
                <dd className="num">{r.turnover !== null ? `${r.turnover}×` : "—"}</dd>
              </div>
            </dl>
            <div className="report-foot">
              <span>Turnover is net cost of goods sold divided by the average of the start and end stock values.</span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}

export function SlowMovingReport() {
  const { name, currency } = useCompany();
  const [slowDays, setSlowDays] = useState(90);
  const [deadDays, setDeadDays] = useState(180);
  const valid = slowDays > 0 && deadDays >= slowDays;
  const report = useResource<SlowMoving>(valid ? `/api/v1/inventory/reports/slow-moving?slowDays=${slowDays}&deadDays=${deadDays}` : null);

  return (
    <>
      <PageHeader title="Slow-moving and dead stock" description="Items still on hand that haven't sold for a while, and the value tied up in them." actions={<PrintButton />} />
      <div className="filter-bar no-print">
        <Field label="Slow after (days)">
          <input className="input" type="number" min={1} value={slowDays} onChange={(e) => setSlowDays(Number(e.target.value))} style={{ width: 120 }} />
        </Field>
        <Field label="Dead after (days)" error={valid ? null : "Must be at least the slow-moving days"}>
          <input className="input" type="number" min={slowDays} value={deadDays} onChange={(e) => setDeadDays(Number(e.target.value))} style={{ width: 120 }} />
        </Field>
      </div>
      {valid && (
        <Loadable resource={report}>
          {(r) => (
            <div className="report">
              <div className="report-head">
                <div className="company">{name}</div>
                <div className="title">Slow-moving and dead stock</div>
                <div className="period">
                  As at {date(new Date())} · Amounts in {currency}
                </div>
              </div>
              {r.lines.length === 0 ? (
                <EmptyState title="Everything on hand is moving" body={`Every item in stock has sold within the last ${plural(r.slowDays, "day")}.`} />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="table pin-first">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Branch</th>
                        <th className="hide-sm">Last sold</th>
                        <th className="num">Days</th>
                        <th className="num hide-sm">Quantity</th>
                        <th className="num">Value</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.lines.map((l) => (
                        <tr key={`${l.itemId}:${l.location}`}>
                          <td>
                            <Link to={`/inventory/movements?itemId=${l.itemId}`} style={{ color: "inherit" }}>
                              {l.name}
                            </Link>
                            {l.sku && <span className="sub">{l.sku}</span>}
                          </td>
                          <td>{l.location}</td>
                          <td className="hide-sm muted nowrap">{l.lastSaleAt ? date(l.lastSaleAt) : `Not since ${date(l.trackedSince)}`}</td>
                          <td className="num">{amount(l.daysWithoutSale)}</td>
                          <td className="num hide-sm">{amount(l.quantity)}</td>
                          <td className="num strong">{amount(l.value)}</td>
                          <td>{l.status === "DEAD" ? <Badge tone="negative">Dead</Badge> : <Badge tone="warning">Slow</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <dl className="report-summary">
                <div>
                  <dt>Slow-moving ({plural(r.slow.count, "line")})</dt>
                  <dd className="num">{amount(r.slow.value)}</dd>
                </div>
                <div>
                  <dt>Dead stock ({plural(r.dead.count, "line")})</dt>
                  <dd className="num">{amount(r.dead.value)}</dd>
                </div>
              </dl>
              <div className="report-foot">
                <span>Days are counted from the last sale recorded in Accounting, or from when Accounting started tracking the item at that branch.</span>
                <span>Printed {date(new Date())}</span>
              </div>
            </div>
          )}
        </Loadable>
      )}
    </>
  );
}

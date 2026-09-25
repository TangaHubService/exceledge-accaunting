import { type CSSProperties } from "react";
import { Badge, EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, humanize, money, plural } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { InventoryReconciliation as Recon } from "../lib/types";

export function InventoryReconciliation() {
  const { can } = useSession();
  const { currency } = useCompany();
  const recon = useResource<Recon>("/api/v1/inventory/reconciliation");

  return (
    <>
      <PageHeader
        title="Inventory reconciliation"
        description="Compares stock value with the general ledger, and accounting quantities with what Excel Edge last reported."
      />
      <Loadable resource={recon}>
        {(r) => {
          const balanced = Math.abs(r.difference) < 0.01;
          const unexplained = Math.round((r.difference - r.explained.saleCostDifference + r.explained.unpostedMovements.value) * 100) / 100;
          return (
            <>
              <section className="figures" aria-label="Inventory against the ledger" style={{ "--cols": 3 } as CSSProperties}>
                <Figure
                  lead
                  label="General ledger"
                  currency={currency}
                  value={amount(r.glValue)}
                  note={r.accounts.map((a) => `${a.code} ${a.name}`).join(", ") || "No inventory account mapped"}
                />
                <Figure label="Stock records" currency={currency} value={amount(r.subledgerValue)} note="Sum of item values at every branch" />
                <Figure
                  label="Difference"
                  currency={currency}
                  value={amount(r.difference)}
                  tone={balanced ? "positive" : "negative"}
                  note={balanced ? "Ledger and stock agree" : "Ledger less stock records"}
                />
              </section>

              {!balanced && (
                <section className="section">
                  <div className="section-head">
                    <h2 className="section-title">What makes up the difference</h2>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        <tr>
                          <td>
                            Movements valued but not yet in the ledger
                            <span className="sub">
                              {plural(r.explained.unpostedMovements.count, "movement")} · usually a closed period. Retry them from posting exceptions once the period is open.
                            </span>
                          </td>
                          <td className="num">{amount(-r.explained.unpostedMovements.value)}</td>
                        </tr>
                        <tr>
                          <td>
                            Sales cost posted by Excel Edge differs from the item cost
                            <span className="sub">The sale journal carries Excel Edge's cost of goods sold; the stock records carry each item's cost.</span>
                          </td>
                          <td className="num">{amount(r.explained.saleCostDifference)}</td>
                        </tr>
                        <tr>
                          <td>
                            Other entries on the inventory account
                            <span className="sub">For example manual journals posted directly to the inventory account.</span>
                          </td>
                          <td className="num">{amount(unexplained)}</td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Difference</td>
                          <td className="num">{money(r.difference, currency)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {r.accountsDiffer && (
                    <p className="table-caption">
                      Sales and stock movements post to different inventory accounts. Map the same account in Company setup under inventory and default accounts.
                    </p>
                  )}
                </section>
              )}

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Quantities that differ from Excel Edge</h2>
                </div>
                <div className="table-wrap">
                  {r.quantityDifferences.length === 0 ? (
                    <EmptyState title="Quantities agree" body="Every item and branch holds the quantity Excel Edge last reported." />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="num">Excel Edge</th>
                          <th className="num">Accounting</th>
                          <th className="num">Difference</th>
                          <th className="hide-sm">Likely cause</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.quantityDifferences.map((q) => (
                          <tr key={`${q.item}:${q.location}`}>
                            <td>
                              {q.item}
                              <span className="sub">
                                {[q.sku, q.location].filter(Boolean).join(" · ")} · reported {q.erpQuantityAt ? date(q.erpQuantityAt) : "—"}
                              </span>
                            </td>
                            <td className="num">{amount(q.erpQuantity)}</td>
                            <td className="num">{amount(q.accountingQuantity)}</td>
                            <td className="num text-negative">{amount(q.difference)}</td>
                            <td className="hide-sm muted">{q.openingRecorded ? "A movement failed or is still queued" : "Opening stock not loaded"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {(r.negativeStock.length > 0 || r.valueWithoutStock.length > 0) && (
                <section className="section">
                  <div className="section-head">
                    <h2 className="section-title">Stock records to review</h2>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {r.negativeStock.map((n) => (
                          <tr key={`neg:${n.item}:${n.location}`}>
                            <td>
                              {n.item}
                              <span className="sub">{[n.sku, n.location].filter(Boolean).join(" · ")}</span>
                            </td>
                            <td>
                              <Badge tone="negative">Below zero</Badge>
                            </td>
                            <td className="num">{amount(n.quantity)} units</td>
                            <td className="num">{amount(n.value)}</td>
                          </tr>
                        ))}
                        {r.valueWithoutStock.map((v) => (
                          <tr key={`val:${v.item}:${v.location}`}>
                            <td>
                              {v.item}
                              <span className="sub">{[v.sku, v.location].filter(Boolean).join(" · ")}</span>
                            </td>
                            <td>
                              <Badge tone="warning">Value with no stock</Badge>
                            </td>
                            <td className="num">0 units</td>
                            <td className="num">{amount(v.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="table-caption">
                    Below-zero stock usually means sales were recorded before opening stock was loaded. Value with no stock is left when Excel Edge's cost for the last units differed
                    from the recorded cost.
                  </p>
                </section>
              )}

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Movements that couldn't be recorded</h2>
                  {can("exceptions:view") && (
                    <Link to="/exceptions" className="small">
                      Posting exceptions
                    </Link>
                  )}
                </div>
                <div className="table-wrap">
                  {r.failedEvents.length === 0 ? (
                    <EmptyState
                      title="Nothing failed"
                      body={r.uncostedMovements ? `${plural(r.uncostedMovements, "movement")} were recorded without a cost; see stock movements.` : "Every stock movement from Excel Edge has been recorded."}
                    />
                  ) : (
                    <table className="table">
                      <tbody>
                        {r.failedEvents.map((f) => (
                          <tr key={f.id}>
                            <td className="muted nowrap" style={{ width: 150 }}>
                              {dateTime(f.occurredAt)}
                            </td>
                            <td>
                              {f.eventType === "INVENTORY_OPENING" ? "Opening stock snapshot" : `Stock movement ${f.sourceDocumentNumber ?? `#${f.sourceDocumentId}`}`}
                              <span className="sub">{f.lastError}</span>
                            </td>
                            <td>
                              <Badge tone="negative">{humanize(f.status)}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

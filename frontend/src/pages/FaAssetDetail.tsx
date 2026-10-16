import { useState, type CSSProperties } from "react";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { CapitalizeForm, DisposeForm, ImpairForm, MaintenanceForm, RevalueForm, TransferForm, UsageForm } from "../components/FaForms";
import { Badge, EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { ASSET_STATUS, DEP_FREQUENCY_LABELS, DEP_METHOD_LABELS, DISPOSAL_LABELS } from "../lib/fa";
import { amount, date } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { FixedAsset } from "../lib/types";

export function FaAssetDetail({ id }: { id: string }) {
  const { can } = useSession();
  const { currency } = useCompany();
  const asset = useResource<FixedAsset>(`/api/v1/fixed-assets/assets/${id}`);
  const [action, setAction] = useState<"capitalize" | "transfer" | "maintenance" | "dispose" | "revalue" | "impair" | "usage" | null>(null);

  return (
    <Loadable resource={asset}>
      {(a) => (
        <>
          <PageHeader
            title={a.number}
            description={`${a.name} · ${a.categoryName}`}
            actions={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {a.status === "REGISTERED" && can("fa:post") && (
                  <button type="button" className="btn btn-primary" onClick={() => setAction("capitalize")}>
                    Capitalize
                  </button>
                )}
                {a.status !== "DISPOSED" && can("fa:manage") && (
                  <>
                    <button type="button" className="btn" onClick={() => setAction("transfer")}>
                      Transfer
                    </button>
                    <button type="button" className="btn" onClick={() => setAction("maintenance")}>
                      Maintenance
                    </button>
                  </>
                )}
                {a.depreciationMethod === "UNITS_OF_PRODUCTION" && a.status !== "DISPOSED" && a.status !== "REGISTERED" && can("fa:manage") && (
                  <button type="button" className="btn" onClick={() => setAction("usage")}>
                    Record usage
                  </button>
                )}
                {(a.status === "ACTIVE" || a.status === "FULLY_DEPRECIATED") && can("fa:post") && (
                  <>
                    <button type="button" className="btn" onClick={() => setAction("revalue")}>
                      Revalue
                    </button>
                    <button type="button" className="btn" onClick={() => setAction("impair")}>
                      Impair
                    </button>
                    <button type="button" className="btn" onClick={() => setAction("dispose")}>
                      Dispose
                    </button>
                  </>
                )}
                <Link to="/fixed-assets/register" className="btn">
                  Register
                </Link>
              </div>
            }
          />

          {action === "capitalize" && <CapitalizeForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}
          {action === "transfer" && <TransferForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}
          {action === "maintenance" && <MaintenanceForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}
          {action === "dispose" && <DisposeForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}
          {action === "revalue" && <RevalueForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}
          {action === "impair" && <ImpairForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}
          {action === "usage" && <UsageForm asset={a} onClose={() => setAction(null)} onSaved={() => { setAction(null); asset.reload(); }} />}

          <section className="figures" aria-label="Asset values" style={{ "--cols": 3 } as CSSProperties}>
            <Figure lead label="Net book value" currency={currency} value={amount(a.netBookValue)} note={<Badge tone={ASSET_STATUS[a.status].tone}>{ASSET_STATUS[a.status].label}</Badge>} />
            <Figure label="Acquisition cost" currency={currency} value={amount(a.acquisitionCost)} note={`Residual ${amount(a.residualValue)}`} />
            <Figure label="Accumulated depreciation" currency={currency} value={amount(a.accumulatedDepreciation)} note={a.lastDepreciationPeriod ? `Last ${a.lastDepreciationPeriod}` : DEP_METHOD_LABELS[a.depreciationMethod]} />
          </section>

          <div className="overview-grid">
            <section>
              <h2 className="section-title">Details</h2>
              <div className="panel detail-list">
                <div>
                  <span className="muted">Method</span>
                  <span>
                    {DEP_METHOD_LABELS[a.depreciationMethod]}
                    {a.depreciationMethod === "UNITS_OF_PRODUCTION"
                      ? ` · ${a.unitsDepreciated.toLocaleString()} of ${(a.totalUnits ?? 0).toLocaleString()} units`
                      : a.ratePercent != null
                        ? ` · ${a.ratePercent}%`
                        : ` · ${a.usefulLifeMonths} mo`}
                    {` · posted ${DEP_FREQUENCY_LABELS[a.depreciationFrequency].toLowerCase()}`}
                  </span>
                </div>
                {(a.revaluationSurplus > 0 || a.revaluationLossInPl > 0) && (
                  <div>
                    <span className="muted">Revaluation</span>
                    <span>
                      Surplus {amount(a.revaluationSurplus)}
                      {a.revaluationLossInPl > 0 ? ` · losses in profit or loss ${amount(a.revaluationLossInPl)}` : ""}
                    </span>
                  </div>
                )}
                <div>
                  <span className="muted">Purchase</span>
                  <span>{a.purchaseDate ? date(a.purchaseDate) : "—"}</span>
                </div>
                <div>
                  <span className="muted">Capitalized</span>
                  <span>{a.capitalizedAt ? date(a.capitalizedAt) : "—"}</span>
                </div>
                <div>
                  <span className="muted">Location</span>
                  <span>{[a.branch, a.location, a.assignedEmployee].filter(Boolean).join(" · ") || "—"}</span>
                </div>
                <div>
                  <span className="muted">Serial</span>
                  <span>{a.serialNumber || "—"}</span>
                </div>
                {a.disposedAt && (
                  <div>
                    <span className="muted">Disposed</span>
                    <span>
                      {date(a.disposedAt)}
                      {a.disposalMethod ? ` · ${DISPOSAL_LABELS[a.disposalMethod]}` : ""}
                      {a.disposalProceeds != null ? ` · ${amount(a.disposalProceeds)}` : ""}
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="section-title">Depreciation history</h2>
              <div className="panel">
                {a.depreciations.length === 0 ? (
                  <p className="all-clear">No depreciation posted yet.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.depreciations.map((d) => (
                        <tr key={d.id}>
                          <td>{d.period}</td>
                          <td className="num">{amount(d.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          <div className="overview-grid">
            <section>
              <h2 className="section-title">Maintenance</h2>
              <div className="panel">
                {a.maintenances.length === 0 ? (
                  <EmptyState title="No maintenance logged" />
                ) : (
                  a.maintenances.map((m) => (
                    <div key={m.id} style={{ marginBottom: 8 }}>
                      <strong>{m.maintenanceType}</strong>
                      <span className="sub">
                        {date(m.maintenanceDate)}
                        {m.serviceProvider ? ` · ${m.serviceProvider}` : ""}
                        {m.cost ? ` · ${amount(m.cost)}` : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
            <section>
              <h2 className="section-title">Transfers</h2>
              <div className="panel">
                {a.transfers.length === 0 ? (
                  <p className="all-clear">No transfers.</p>
                ) : (
                  a.transfers.map((t) => (
                    <div key={t.id} style={{ marginBottom: 8 }}>
                      <strong>{date(t.transferDate)}</strong>
                      <span className="sub">{[t.toBranch, t.toLocation, t.toEmployee].filter(Boolean).join(" · ")}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {(a.revaluations.length > 0 || a.impairments.length > 0 || a.depreciationMethod === "UNITS_OF_PRODUCTION") && (
            <div className="overview-grid">
              <section>
                <h2 className="section-title">Revaluations and impairments</h2>
                <div className="panel">
                  {a.revaluations.length === 0 && a.impairments.length === 0 ? (
                    <p className="all-clear">None recorded.</p>
                  ) : (
                    <>
                      {a.revaluations.map((r) => (
                        <div key={r.id} style={{ marginBottom: 8 }}>
                          <strong>
                            {r.increase ? "Revalued up" : "Revalued down"} {amount(r.amount)}
                          </strong>
                          <span className="sub">
                            {date(r.effectiveDate)} · fair value {amount(r.fairValue)}
                            {r.reserveAmount ? ` · ${amount(r.reserveAmount)} ${r.increase ? "to" : "from"} surplus` : ""}
                            {r.plAmount ? ` · ${amount(r.plAmount)} ${r.increase ? "reversing earlier loss" : "to profit or loss"}` : ""}
                          </span>
                        </div>
                      ))}
                      {a.impairments.map((i) => (
                        <div key={i.id} style={{ marginBottom: 8 }}>
                          <strong>Impairment {amount(i.lossAmount)}</strong>{" "}
                          {i.status === "PENDING_APPROVAL" && (
                            <Link to="/approvals">
                              <Badge tone="warning">Waiting for approval</Badge>
                            </Link>
                          )}
                          {i.status === "REJECTED" && <Badge tone="negative">Rejected</Badge>}
                          <span className="sub">
                            {date(i.impairmentDate)} · recoverable {amount(i.recoverableAmount)}
                            {i.reason ? ` · ${i.reason}` : ""}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </section>
              {a.depreciationMethod === "UNITS_OF_PRODUCTION" && (
                <section>
                  <h2 className="section-title">Units used</h2>
                  <div className="panel">
                    {a.usages.length === 0 ? (
                      <p className="all-clear">No usage recorded — nothing depreciates until it is.</p>
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Period</th>
                            <th className="num">Units</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {a.usages.map((u) => (
                            <tr key={u.id}>
                              <td>
                                {u.period}
                                {u.notes && <span className="sub">{u.notes}</span>}
                              </td>
                              <td className="num">{u.units.toLocaleString()}</td>
                              <td className="muted small">{u.locked ? "Depreciated" : "Open"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          <section className="panel panel-body" style={{ marginTop: 20 }}>
            <AttachmentsPanel entityType="FixedAsset" entityId={a.id} title="Invoices, photos and other files" />
          </section>
        </>
      )}
    </Loadable>
  );
}

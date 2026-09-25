import { useState, type CSSProperties } from "react";
import { CapitalizeForm, DisposeForm, MaintenanceForm, TransferForm } from "../components/FaForms";
import { Badge, EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { ASSET_STATUS, DEP_METHOD_LABELS, DISPOSAL_LABELS } from "../lib/fa";
import { amount, date } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { FixedAsset } from "../lib/types";

export function FaAssetDetail({ id }: { id: string }) {
  const { can } = useSession();
  const { currency } = useCompany();
  const asset = useResource<FixedAsset>(`/api/v1/fixed-assets/assets/${id}`);
  const [action, setAction] = useState<"capitalize" | "transfer" | "maintenance" | "dispose" | null>(null);

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
                {(a.status === "ACTIVE" || a.status === "FULLY_DEPRECIATED") && can("fa:post") && (
                  <button type="button" className="btn" onClick={() => setAction("dispose")}>
                    Dispose
                  </button>
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
                    {a.ratePercent != null ? ` · ${a.ratePercent}%` : ` · ${a.usefulLifeMonths} mo`}
                  </span>
                </div>
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
        </>
      )}
    </Loadable>
  );
}

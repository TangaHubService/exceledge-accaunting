import { Calculator, Plus } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { DepreciationRunForm, RegisterAssetForm } from "../components/FaForms";
import { EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { ASSET_STATUS } from "../lib/fa";
import { amount, plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { FaDashboard } from "../lib/types";

export function FixedAssets() {
  const { can } = useSession();
  const { currency } = useCompany();
  const dash = useResource<FaDashboard>("/api/v1/fixed-assets/dashboard");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Fixed assets"
        description="Register, capitalize, depreciate and dispose of company assets. Carrying values stay in sync with the ledger."
        actions={
          <>
            {can("fa:post") && (
              <button type="button" className="btn" onClick={() => setDepOpen(true)}>
                <Calculator size={16} aria-hidden="true" />
                Run depreciation
              </button>
            )}
            {can("fa:manage") && (
              <button type="button" className="btn btn-primary" onClick={() => setRegisterOpen(true)}>
                <Plus size={16} aria-hidden="true" />
                Register asset
              </button>
            )}
          </>
        }
      />
      {registerOpen && (
        <RegisterAssetForm
          onClose={() => setRegisterOpen(false)}
          onSaved={(a) => {
            setRegisterOpen(false);
            dash.reload();
            navigate(`/fixed-assets/assets/${a.id}`);
          }}
        />
      )}
      {depOpen && (
        <DepreciationRunForm
          onClose={() => setDepOpen(false)}
          onSaved={() => {
            setDepOpen(false);
            dash.reload();
          }}
        />
      )}

      <Loadable resource={dash}>
        {(d) => (
          <>
            <section className="figures" aria-label="Fixed asset position" style={{ "--cols": 4 } as CSSProperties}>
              <Figure lead label="Net book value" currency={currency} value={amount(d.totals.netBookValue)} note={plural(d.totals.count, "active asset")} />
              <Figure label="Gross cost" currency={currency} value={amount(d.totals.cost)} note={`Accum. dep. ${amount(d.totals.accumulatedDepreciation)}`} />
              <Figure label="Acquired this year" value={String(d.totals.acquiredThisYear)} note={plural(d.totals.fullyDepreciated, "fully depreciated")} />
              <Figure label="Disposed" value={String(d.totals.disposed)} note={d.totals.dueMaintenance ? `${d.totals.dueMaintenance} due for maintenance` : "Maintenance clear"} />
            </section>

            <div className="overview-grid">
              <section>
                <div className="section-head">
                  <h2 className="section-title">By category</h2>
                  <Link to="/fixed-assets/categories" className="small">
                    Categories
                  </Link>
                </div>
                <div className="panel">
                  {d.byCategory.length === 0 ? (
                    <p className="all-clear">No assets on the register yet.</p>
                  ) : (
                    d.byCategory.map((c) => (
                      <div className="bar-row" key={c.name}>
                        <span className="muted">
                          {c.name}
                          <span className="sub">{plural(c.count, "asset")}</span>
                        </span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(c.cost / Math.max(1, d.byCategory[0].cost)) * 100}%` }} />
                        </div>
                        <span className="num">{amount(c.nbv)}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <div className="section-head">
                  <h2 className="section-title">Recent assets</h2>
                  <Link to="/fixed-assets/register" className="small">
                    Full register
                  </Link>
                </div>
                <div className="panel">
                  {d.recent.length === 0 ? (
                    <EmptyState title="No assets yet" body="Register a laptop, vehicle or other capital asset to start the register." />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Asset</th>
                          <th className="num">NBV</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.recent.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <Link to={`/fixed-assets/assets/${a.id}`}>{a.number}</Link>
                              <span className="sub">
                                {a.name} · {a.categoryName}
                              </span>
                            </td>
                            <td className="num">{amount(a.netBookValue)}</td>
                            <td>{ASSET_STATUS[a.status].label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Shortcuts</h2>
              </div>
              <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Link to="/fixed-assets/register" className="btn">
                  Asset register
                </Link>
                <Link to="/fixed-assets/depreciation" className="btn">
                  Depreciation
                </Link>
                <Link to="/fixed-assets/categories" className="btn">
                  Categories
                </Link>
              </div>
            </section>
          </>
        )}
      </Loadable>
    </>
  );
}

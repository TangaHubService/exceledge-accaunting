import { Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { TaxCodeForm, TaxSettingsForm } from "../components/TaxForms";
import { Badge, EmptyState, Loadable, PageHeader } from "../components/ui";
import { date } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import { TAX_TYPE_LABELS } from "../lib/tax";
import type { TaxCode, TaxSettings } from "../lib/types";

export function TaxSettingsPage() {
  const { can } = useSession();
  const settings = useResource<TaxSettings>("/api/v1/tax/settings");
  const [editSettings, setEditSettings] = useState(false);
  const [code, setCode] = useState<TaxCode | null | undefined>(undefined);

  return (
    <>
      <PageHeader
        title="Tax codes & settings"
        description="Company tax registration and the codes used on sales, purchases and withholdings. Seeded Rwanda rates are defaults you can edit."
        back={{ to: "/tax", label: "Tax" }}
        actions={
          can("tax:manage") && (
            <>
              <button type="button" className="btn" onClick={() => setEditSettings(true)}>
                <Settings2 size={16} aria-hidden="true" />
                Settings
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setCode(null)}>
                <Plus size={16} aria-hidden="true" />
                Add code
              </button>
            </>
          )
        }
      />

      {editSettings && settings.data && (
        <TaxSettingsForm
          settings={settings.data}
          onClose={() => setEditSettings(false)}
          onSaved={() => {
            setEditSettings(false);
            settings.reload();
          }}
        />
      )}
      {code !== undefined && (
        <TaxCodeForm
          code={code ?? undefined}
          onClose={() => setCode(undefined)}
          onSaved={() => {
            setCode(undefined);
            settings.reload();
          }}
        />
      )}

      <Loadable resource={settings}>
        {(s) => (
          <>
            <section className="figures" aria-label="Tax registration">
              <div className="figure lead">
                <div className="figure-label">Authority</div>
                <div className="figure-value">{s.taxAuthority || "—"}</div>
                <div className="figure-note">{s.vatRegistered ? "VAT registered" : "Not VAT registered"}</div>
              </div>
              <div className="figure">
                <div className="figure-label">TIN</div>
                <div className="figure-value">{s.tin || "—"}</div>
              </div>
              <div className="figure">
                <div className="figure-label">Filing</div>
                <div className="figure-value">{s.vatFilingFrequency || "—"}</div>
                <div className="figure-note">{s.taxCurrency}</div>
              </div>
            </section>

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Tax codes</h2>
              </div>
              {s.codes.length === 0 ? (
                <div className="panel">
                  <EmptyState title="No tax codes" body="Add the rates your company uses. Rwanda companies get a starter set on first open." />
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Type</th>
                        <th className="num">Rate %</th>
                        <th className="hide-sm">GL account</th>
                        <th className="hide-md">Effective</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {s.codes.map((c) => (
                        <tr key={c.id} className={c.isActive ? undefined : "row-inactive"}>
                          <td>
                            <strong>{c.code}</strong>
                            <span className="sub">{c.name}</span>
                          </td>
                          <td>{TAX_TYPE_LABELS[c.taxType]}</td>
                          <td className="num">{c.ratePercent}</td>
                          <td className="hide-sm">
                            {c.glAccountCode ? (
                              <>
                                {c.glAccountCode}
                                <span className="sub">{c.glAccountName}</span>
                              </>
                            ) : (
                              <span className="muted">Company default</span>
                            )}
                          </td>
                          <td className="hide-md nowrap">
                            {date(c.effectiveFrom)}
                            {c.effectiveTo ? ` – ${date(c.effectiveTo)}` : ""}
                          </td>
                          <td>
                            <Badge tone={c.isActive ? "positive" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                          </td>
                          <td className="num">
                            {can("tax:manage") && (
                              <button type="button" className="btn" onClick={() => setCode(c)}>
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </Loadable>
    </>
  );
}

import { FileCheck2, Plus, Receipt, Settings2, Scale } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { PrepareFilingForm, TaxAdjustmentForm, TaxPaymentForm } from "../components/TaxForms";
import { EmptyState, Figure, Loadable, Menu, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, money, plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import { FILING_KIND_LABELS, FILING_STATUS, TAX_TYPE_LABELS } from "../lib/tax";
import type { TaxDashboard } from "../lib/types";

type Form = "pay" | "adjust" | "file" | null;
type Attention = { key: string; tone: "negative" | "warning" | "info"; what: string; why: string; value?: string; to: string };

export function Tax() {
  const { can } = useSession();
  const { currency } = useCompany();
  const dash = useResource<TaxDashboard>("/api/v1/tax/dashboard");
  const [open, setOpen] = useState<Form>(null);

  return (
    <>
      <PageHeader
        title="Tax"
        description="VAT, withholding and filings from posted journals. Rates stay on your tax codes — nothing is recalculated here."
        actions={
          can("tax:manage") && (
            <>
              <button type="button" className="btn" onClick={() => setOpen("adjust")}>
                Adjustment
              </button>
              <button type="button" className="btn" onClick={() => setOpen("file")}>
                <FileCheck2 size={16} aria-hidden="true" />
                Prepare return
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setOpen("pay")}>
                <Plus size={16} aria-hidden="true" />
                Record payment
              </button>
              <Menu
                label="More"
                items={[
                  { label: "Tax codes & settings", icon: Settings2, onSelect: () => navigate("/tax/settings") },
                  { label: "VAT return", icon: Receipt, onSelect: () => navigate("/tax/vat") },
                  { label: "Tax reconciliation", icon: Scale, onSelect: () => navigate("/tax/reconciliation") },
                ]}
              />
            </>
          )
        }
      />

      {open === "pay" && (
        <TaxPaymentForm
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            dash.reload();
          }}
        />
      )}
      {open === "adjust" && (
        <TaxAdjustmentForm
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            dash.reload();
          }}
        />
      )}
      {open === "file" && (
        <PrepareFilingForm
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            navigate("/tax/filings");
          }}
        />
      )}

      <Loadable resource={dash}>
        {(d) => {
          const attention: Attention[] = [];
          if (d.balances.totalOutstanding > 0) {
            attention.push({
              key: "due",
              tone: "warning",
              what: "Tax still outstanding",
              why: "Net VAT, withholding and PAYE balances on the ledger.",
              value: money(d.balances.totalOutstanding, currency),
              to: "/tax/payments",
            });
          }
          for (const f of d.dueSoon) {
            attention.push({
              key: f.id,
              tone: "info",
              what: `${f.number} due ${f.dueDate ? date(f.dueDate) : "soon"}`,
              why: `${FILING_KIND_LABELS[f.kind]} is ${FILING_STATUS[f.status].label.toLowerCase()}.`,
              to: "/tax/filings",
            });
          }
          if (!d.settings.tin) {
            attention.push({
              key: "tin",
              tone: "warning",
              what: "TIN not set",
              why: "Add the company TIN under Tax settings before filing.",
              to: "/tax/settings",
            });
          }

          return (
            <>
              <section className="figures" aria-label="Tax position" style={{ "--cols": 3 } as CSSProperties}>
                <Figure lead label="VAT net due" currency={currency} value={amount(d.balances.vatNetDue)} note={`Payable ${amount(d.balances.vatPayable)} · Recoverable ${amount(d.balances.vatReceivable)}`} />
                <Figure label="Withholding payable" currency={currency} value={amount(d.balances.withholdingPayable)} note={`PAYE ${amount(d.balances.payePayable)}`} />
                <Figure label="This month VAT net" currency={currency} value={amount(d.month.vatNet)} note={`${date(d.month.from)} – ${date(d.month.to)}`} />
              </section>

              <div className="overview-grid">
                <section>
                  <div className="section-head">
                    <h2 className="section-title">Needs your attention</h2>
                    <Link to="/tax/reconciliation" className="small">
                      Reconciliation
                    </Link>
                  </div>
                  <div className="panel">
                    {attention.length ? (
                      <ul className="attention">
                        {attention.map((a) => (
                          <li key={a.key}>
                            <Link to={a.to}>
                              <span className={`dot ${a.tone}`} />
                              <span>
                                <span className="what">{a.what}</span>
                                <span className="why">{a.why}</span>
                              </span>
                              <span className="how-much">{a.value ?? <span className="muted">Review →</span>}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="all-clear">Nothing waiting on tax right now.</p>
                    )}
                  </div>
                </section>

                <section>
                  <div className="section-head">
                    <h2 className="section-title">Recent filings</h2>
                    <Link to="/tax/filings" className="small">
                      All filings
                    </Link>
                  </div>
                  <div className="panel">
                    {d.recentFilings.length === 0 ? (
                      <EmptyState title="No returns yet" body="Prepare a VAT or withholding return when the period is ready." />
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Return</th>
                            <th>Period</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.recentFilings.map((f) => (
                            <tr key={f.id}>
                              <td>
                                <Link to="/tax/filings">{f.number}</Link>
                                <span className="sub">{FILING_KIND_LABELS[f.kind]}</span>
                              </td>
                              <td className="nowrap">
                                {date(f.periodFrom)} – {date(f.periodTo)}
                              </td>
                              <td>{FILING_STATUS[f.status].label}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {d.openFilings > 0 && <p className="muted small">{plural(d.openFilings, "open filing")}</p>}
                  </div>
                </section>
              </div>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Recent payments</h2>
                  <Link to="/tax/payments" className="small">
                    All payments
                  </Link>
                </div>
                <div className="panel">
                  {d.recentPayments.length === 0 ? (
                    <EmptyState title="No tax payments" body="Record payments to RRA when you settle VAT or withholding." />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Payment</th>
                          <th className="num">Amount ({currency})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.recentPayments.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <Link to="/tax/payments">{p.number}</Link>
                              <span className="sub">
                                {date(p.paymentDate)} · {TAX_TYPE_LABELS[p.taxType]}
                                {p.isRefund ? " · refund" : ""}
                              </span>
                            </td>
                            <td className="num">{amount(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Shortcuts</h2>
                </div>
                <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Link to="/tax/vat" className="btn">
                    VAT return
                  </Link>
                  <Link to="/tax/ledger" className="btn">
                    Tax ledger
                  </Link>
                  <Link to="/tax/fiscal" className="btn">
                    Fiscal documents
                  </Link>
                  <Link to="/tax/settings" className="btn">
                    Codes & settings
                  </Link>
                  <Link to="/reports/withholding-tax" className="btn">
                    Supplier WHT report
                  </Link>
                </div>
                {d.settings.taxAuthority && (
                  <p className="muted small" style={{ marginTop: 12 }}>
                    Authority {d.settings.taxAuthority}
                    {d.settings.tin ? ` · TIN ${d.settings.tin}` : ""}
                    {d.settings.vatRegistered ? " · VAT registered" : ""}
                    {d.settings.vatFilingFrequency ? ` · ${d.settings.vatFilingFrequency.toLowerCase()} filing` : ""}
                  </p>
                )}
              </section>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

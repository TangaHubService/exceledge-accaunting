import { Printer } from "lucide-react";
import { useState } from "react";
import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay, moduleLabel } from "../lib/format";
import { Link } from "../lib/router";
import { useResource } from "../lib/session";
import type { VatReport } from "../lib/types";
import { PeriodFilter, monthStart } from "./WithholdingTax";

export function TaxVat() {
  const { name, currency, snapshot } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const report = useResource<VatReport>(`/api/v1/tax/reports/vat?from=${from}&to=${to}`);
  const tin = snapshot?.profile?.taxIdentificationNumber;

  return (
    <>
      <PageHeader
        title="VAT return"
        description="Output and input VAT from posted sales, purchases and adjustments. Payments are shown separately."
        back={{ to: "/tax", label: "Tax" }}
        actions={
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            Print
          </button>
        }
      />
      <PeriodFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />

      <Loadable resource={report}>
        {(r) => (
          <div className="report">
            <div className="report-head">
              <div className="company">
                {name}
                {tin && <span className="muted"> · TIN {tin}</span>}
              </div>
              <div className="title">VAT return schedule</div>
              <div className="period">
                {date(r.from)} to {date(r.to)} · Amounts in {currency}
              </div>
            </div>

            <div className="figures" style={{ marginBottom: 16 }}>
              <div className="figure">
                <div className="figure-label">Output VAT</div>
                <div className="figure-value amount">{amount(r.totals.output)}</div>
              </div>
              <div className="figure">
                <div className="figure-label">Input VAT</div>
                <div className="figure-value amount">{amount(r.totals.input)}</div>
              </div>
              <div className="figure">
                <div className="figure-label">Net VAT</div>
                <div className="figure-value amount">{amount(r.totals.net)}</div>
              </div>
              <div className="figure">
                <div className="figure-label">Paid</div>
                <div className="figure-value amount">{amount(r.totals.paid)}</div>
              </div>
              <div className="figure lead">
                <div className="figure-label">Outstanding</div>
                <div className="figure-value amount">{amount(r.totals.outstanding)}</div>
              </div>
            </div>

            <h3 className="section-title">Output VAT</h3>
            {r.outputAccount && (
              <p className="muted small">
                {r.outputAccount.code} · {r.outputAccount.name}
              </p>
            )}
            {r.outputLines.length === 0 ? (
              <EmptyState title="No output VAT" body="No sales or output adjustments posted in this period." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Journal</th>
                      <th className="hide-sm">Source</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.outputLines.map((l) => (
                      <tr key={l.id}>
                        <td className="nowrap">{date(l.date)}</td>
                        <td>
                          <Link to={`/journals`}>{l.journalNumber}</Link>
                          {l.description && <span className="sub">{l.description}</span>}
                        </td>
                        <td className="hide-sm">
                          {moduleLabel(l.sourceModule) || "—"}
                          {l.sourceDocumentNumber && <span className="sub">{l.sourceDocumentNumber}</span>}
                        </td>
                        <td className="num">{amount(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Total output</td>
                      <td className="num strong">{amount(r.totals.output)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <h3 className="section-title">Input VAT</h3>
            {r.inputAccount && (
              <p className="muted small">
                {r.inputAccount.code} · {r.inputAccount.name}
              </p>
            )}
            {r.inputLines.length === 0 ? (
              <EmptyState title="No input VAT" body="No purchase VAT posted in this period." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Journal</th>
                      <th className="hide-sm">Source</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.inputLines.map((l) => (
                      <tr key={l.id}>
                        <td className="nowrap">{date(l.date)}</td>
                        <td>
                          {l.journalNumber}
                          {l.description && <span className="sub">{l.description}</span>}
                        </td>
                        <td className="hide-sm">
                          {moduleLabel(l.sourceModule) || "—"}
                          {l.sourceDocumentNumber && <span className="sub">{l.sourceDocumentNumber}</span>}
                        </td>
                        <td className="num">{amount(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Total input</td>
                      <td className="num strong">{amount(r.totals.input)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {r.payments.length > 0 && (
              <>
                <h3 className="section-title">Payments in period</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Payment</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{date(p.paymentDate)}</td>
                        <td>
                          {p.number}
                          {p.reference && <span className="sub">{p.reference}</span>}
                          {p.isRefund && <span className="sub">Refund</span>}
                        </td>
                        <td className="num">{amount(p.isRefund ? -p.amount : p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </Loadable>
    </>
  );
}

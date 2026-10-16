import { Printer } from "lucide-react";
import { useState } from "react";
import { Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { useResource } from "../lib/session";
import type { TaxReconciliationReport } from "../lib/types";
import { PeriodFilter, monthStart } from "./WithholdingTax";

function Diff({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  if (Math.abs(value) < 0.005) return <span className="text-positive">Agrees</span>;
  return <span className="text-warning">{amount(value)}</span>;
}

export function TaxReconciliationPage() {
  const { name, currency } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const report = useResource<TaxReconciliationReport>(`/api/v1/tax/reconciliation?from=${from}&to=${to}`);

  return (
    <>
      <PageHeader
        title="Tax reconciliation"
        description="Compare the tax return schedule to the general ledger, filed figures and fiscal documents from Excel Edge."
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
              <div className="company">{name}</div>
              <div className="title">Tax reconciliation</div>
              <div className="period">
                {date(r.from)} to {date(r.to)} · Amounts in {currency}
              </div>
            </div>

            <h3 className="section-title">VAT</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th className="num">Ledger / return</th>
                  <th className="num">Compare to</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Return vs GL (excl. tax payments)</td>
                  <td className="num">{amount(r.vat.ledger)}</td>
                  <td className="num">{amount(r.vat.gl)}</td>
                  <td className="num">
                    <Diff value={r.vat.ledgerVsGl} />
                  </td>
                </tr>
                <tr>
                  <td>Return vs filed</td>
                  <td className="num">{amount(r.vat.ledger)}</td>
                  <td className="num">{r.vat.filed === null ? "—" : amount(r.vat.filed)}</td>
                  <td className="num">
                    <Diff value={r.vat.ledgerVsFiled} />
                  </td>
                </tr>
                <tr>
                  <td>Return vs EBM fiscal tax</td>
                  <td className="num">{amount(r.vat.ledger)}</td>
                  <td className="num">{r.vat.ebm === null ? "—" : amount(r.vat.ebm)}</td>
                  <td className="num">
                    <Diff value={r.vat.ledgerVsEbm} />
                  </td>
                </tr>
              </tbody>
            </table>

            <h3 className="section-title">Withholding tax</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th className="num">Supplier payments</th>
                  <th className="num">GL</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>WHT withheld vs payable account</td>
                  <td className="num">{amount(r.withholding.ledger)}</td>
                  <td className="num">{amount(r.withholding.gl)}</td>
                  <td className="num">
                    <Diff value={r.withholding.difference} />
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="muted">
              {r.fiscalDocuments === 0
                ? "No fiscal documents recorded from Excel Edge in this period."
                : `${r.fiscalDocuments} fiscal document${r.fiscalDocuments === 1 ? "" : "s"} from Excel Edge EBM in this period.`}
            </p>
          </div>
        )}
      </Loadable>
    </>
  );
}

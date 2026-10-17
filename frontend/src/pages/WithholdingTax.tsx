import { Printer } from "lucide-react";
import { useState } from "react";
import { PdfButton } from "../components/Documents";
import { ExportButtons } from "../components/ExportButtons";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, calendarDate, date, isoDay } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { WithholdingReport } from "../lib/types";

export function monthStart() {
  return `${isoDay().slice(0, 8)}01`;
}

export function PeriodFilter({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="filter-bar no-print">
      <Field label="From">
        <input className="input" type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value || monthStart())} />
      </Field>
      <Field label="To">
        <input className="input" type="date" value={to} min={from} onChange={(e) => onTo(e.target.value || isoDay())} />
      </Field>
    </div>
  );
}

export function WithholdingTaxReport() {
  const { name, currency, snapshot } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const report = useResource<WithholdingReport>(`/api/v1/ap/reports/withholding?from=${from}&to=${to}`);
  const tin = snapshot?.profile?.taxIdentificationNumber;
  const canCertify = useSession().can("tax:view");

  return (
    <>
      <PageHeader
        title="Withholding tax"
        description="Tax withheld from supplier payments in the period, to declare and pay to RRA."
        actions={
          <>
            <ExportButtons path={`/api/v1/ap/reports/withholding?from=${from}&to=${to}`} filename={`withholding-tax-${from}-${to}`} />
            <button type="button" className="btn" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" />
              Print
            </button>
          </>
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
              <div className="title">Withholding tax on supplier payments</div>
              <div className="period">
                {calendarDate(r.from)} to {calendarDate(r.to)} · Amounts in {currency}
              </div>
            </div>
            {r.rows.length === 0 ? (
              <EmptyState title="No tax withheld" body="No supplier payment in this period had withholding tax deducted." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th className="hide-sm">TIN</th>
                      <th className="hide-sm">Payment</th>
                      <th className="num">Amount settled</th>
                      <th className="num">Tax withheld</th>
                      <th className="num hide-sm">Paid to supplier</th>
                      {canCertify && (
                        <th className="no-print">
                          <span className="sr-only">Withholding certificate</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.paymentId}>
                        <td className="nowrap">{date(row.paymentDate)}</td>
                        <td>
                          <Link to={`/suppliers/${row.supplierId}`} style={{ color: "inherit" }}>
                            {row.supplierName}
                          </Link>
                          {row.whtCategory && <span className="sub">{row.whtCategory}</span>}
                        </td>
                        <td className="hide-sm">{row.supplierTin ?? <span className="text-warning small">Missing</span>}</td>
                        <td className="hide-sm nowrap">
                          {row.paymentNumber}
                          {row.reference && <span className="sub">{row.reference}</span>}
                        </td>
                        <td className="num">{amount(row.grossSettled)}</td>
                        <td className="num strong">{amount(row.withholdingTax)}</td>
                        <td className="num hide-sm">{amount(row.netPaid)}</td>
                        {canCertify && (
                          <td className="no-print">
                            <PdfButton path={`/api/v1/tax/wht/certificates/${row.paymentId}.pdf`} filename={`wht-certificate-${row.paymentNumber}.pdf`} label="Certificate" />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total</td>
                      <td colSpan={2} className="hide-sm" />
                      <td className="num">{amount(r.totalSettled)}</td>
                      <td className="num">{amount(r.totalWithheld)}</td>
                      <td className="num hide-sm">{amount(r.totalSettled - r.totalWithheld)}</td>
                      {canCertify && <td className="no-print" />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="report-foot">
              <span>Rates come from each supplier's record; amounts are as entered on each payment.</span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}

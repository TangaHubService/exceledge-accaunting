import { Printer } from "lucide-react";
import { useState } from "react";
import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { Link } from "../lib/router";
import { useResource } from "../lib/session";
import type { PurchasesBySupplier } from "../lib/types";
import { monthStart, PeriodFilter } from "./WithholdingTax";

export function PurchasesBySupplierReport() {
  const { name, currency } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const report = useResource<PurchasesBySupplier>(`/api/v1/ap/reports/purchases-by-supplier?from=${from}&to=${to}`);

  return (
    <>
      <PageHeader
        title="Purchases by supplier"
        description="Bills recorded in the period, largest suppliers first."
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
              <div className="title">Purchases by supplier</div>
              <div className="period">
                {date(r.from)} to {date(r.to)} · Amounts in {currency}
              </div>
            </div>
            {r.rows.length === 0 ? (
              <EmptyState title="No purchases" body="No supplier bills were recorded in this period." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="num hide-sm">Bills</th>
                      <th className="num hide-sm">Before VAT</th>
                      <th className="num hide-sm">Input VAT</th>
                      <th className="num">Total</th>
                      <th className="num">Share</th>
                      <th className="num hide-sm">Still owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.supplierId}>
                        <td>
                          <Link to={`/suppliers/${row.supplierId}`} style={{ color: "inherit" }}>
                            {row.supplierName}
                          </Link>
                          <span className="sub">{row.supplierCode}</span>
                        </td>
                        <td className="num hide-sm">{row.bills}</td>
                        <td className="num hide-sm">{amount(row.net)}</td>
                        <td className="num hide-sm">{amount(row.tax)}</td>
                        <td className="num strong">{amount(row.gross)}</td>
                        <td className="num muted">{r.totalGross ? `${Math.round((row.gross / r.totalGross) * 100)}%` : "—"}</td>
                        <td className="num hide-sm">{row.outstanding ? amount(row.outstanding) : <span className="subtle">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num hide-sm">{r.rows.reduce((s, x) => s + x.bills, 0)}</td>
                      <td className="num hide-sm">{amount(r.totalGross - r.totalTax)}</td>
                      <td className="num hide-sm">{amount(r.totalTax)}</td>
                      <td className="num">{amount(r.totalGross)}</td>
                      <td className="num">100%</td>
                      <td className="num hide-sm">{amount(r.rows.reduce((s, x) => s + x.outstanding, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="report-foot">
              <span>Opening balances are excluded. Totals are after purchase discounts.</span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}

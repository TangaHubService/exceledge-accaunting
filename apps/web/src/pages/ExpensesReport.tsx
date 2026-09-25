import { Printer } from "lucide-react";
import { useState } from "react";
import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { useResource } from "../lib/session";
import type { ExpensesByCategoryReport } from "../lib/types";
import { PeriodFilter, monthStart } from "./WithholdingTax";

export function ExpensesReport() {
  const { name, currency } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const report = useResource<ExpensesByCategoryReport>(`/api/v1/expenses/reports/by-category?from=${from}&to=${to}`);

  return (
    <>
      <PageHeader
        title="Expenses by category"
        description="Posted operating expenses in the period, grouped by category."
        back={{ to: "/expenses", label: "Expenses" }}
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
              <div className="title">Expenses by category</div>
              <div className="period">
                {date(r.from)} to {date(r.to)} · Amounts in {currency}
              </div>
            </div>
            {r.categories.length === 0 ? (
              <EmptyState title="No posted expenses" body="Nothing posted in this period." />
            ) : (
              <>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.categories.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="num">{amount(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num strong">{amount(r.total)}</td>
                    </tr>
                  </tfoot>
                </table>
                <h3 className="section-title">Detail</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Expense</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="nowrap">{date(row.expenseDate)}</td>
                        <td>
                          {row.number}
                          <span className="sub">{row.payeeName || row.description || "—"}</span>
                        </td>
                        <td>{row.categoryName}</td>
                        <td className="num">{amount(row.amount)}</td>
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

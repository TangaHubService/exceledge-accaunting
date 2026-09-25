import { Plus } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { ExpenseForm } from "../components/ExpenseForms";
import { EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { EXPENSE_STATUS } from "../lib/expense";
import { amount, date, money, plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { ExpenseDashboard } from "../lib/types";

export function Expenses() {
  const { can } = useSession();
  const { currency } = useCompany();
  const dash = useResource<ExpenseDashboard>("/api/v1/expenses/dashboard");
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Operating expenses and employee claims. Approved expenses post to the ledger automatically."
        actions={
          can("expense:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Record expense
            </button>
          )
        }
      />
      {open && (
        <ExpenseForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            dash.reload();
            navigate("/expenses/list");
          }}
        />
      )}

      <Loadable resource={dash}>
        {(d) => (
          <>
            <section className="figures" aria-label="Expense position" style={{ "--cols": 3 } as CSSProperties}>
              <Figure lead label="This month" currency={currency} value={amount(d.month.total)} note={plural(d.month.count, "posted expense")} />
              <Figure label="Today" currency={currency} value={amount(d.today.total)} note={plural(d.today.count, "expense")} />
              <Figure
                label="Waiting on approval"
                value={String(d.pendingApprovals)}
                note={d.reimbursable.count ? `${plural(d.reimbursable.count, "claim")} · ${money(d.reimbursable.amount, currency)}` : "No open claims"}
              />
            </section>

            <div className="overview-grid">
              <section>
                <div className="section-head">
                  <h2 className="section-title">Top categories this month</h2>
                  <Link to="/expenses/report" className="small">
                    Full report
                  </Link>
                </div>
                <div className="panel">
                  {d.topCategories.length === 0 ? (
                    <p className="all-clear">No posted expenses this month yet.</p>
                  ) : (
                    d.topCategories.map((c) => (
                      <div className="bar-row" key={c.name}>
                        <span className="muted">{c.name}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(c.amount / Math.max(1, d.topCategories[0].amount)) * 100}%` }} />
                        </div>
                        <span className="num">{amount(c.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <div className="section-head">
                  <h2 className="section-title">Recent expenses</h2>
                  <Link to="/expenses/list" className="small">
                    All expenses
                  </Link>
                </div>
                <div className="panel">
                  {d.recent.length === 0 ? (
                    <EmptyState title="No expenses yet" body="Record an operating expense or submit an employee claim." />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Expense</th>
                          <th className="num">Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.recent.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <Link to="/expenses/list">{e.number}</Link>
                              <span className="sub">
                                {date(e.expenseDate)} · {e.categoryName}
                                {e.payeeName ? ` · ${e.payeeName}` : ""}
                              </span>
                            </td>
                            <td className="num">{amount(e.grossAmount)}</td>
                            <td>{EXPENSE_STATUS[e.status].label}</td>
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
                <Link to="/expenses/list" className="btn">
                  Expense list
                </Link>
                <Link to="/expenses/recurring" className="btn">
                  Recurring
                </Link>
                <Link to="/expenses/categories" className="btn">
                  Categories
                </Link>
                <Link to="/expenses/report" className="btn">
                  By category
                </Link>
              </div>
            </section>
          </>
        )}
      </Loadable>
    </>
  );
}

import { Plus } from "lucide-react";
import { useState } from "react";
import { RecurringExpenseForm } from "../components/ExpenseForms";
import { useFeedback } from "../components/feedback";
import { Badge, EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { FREQUENCY_LABELS } from "../lib/expense";
import { amount, date } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { RecurringExpense } from "../lib/types";

export function ExpensesRecurring() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { toast } = useFeedback();
  const list = useResource<RecurringExpense[]>("/api/v1/expenses/recurring");
  const [open, setOpen] = useState(false);

  async function run(id: string, name: string) {
    try {
      await api(`/api/v1/expenses/recurring/${id}/run`, { method: "POST", body: "{}" });
      toast(`Generated expense from ${name}`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Recurring expenses"
        description="Templates for rent, subscriptions and other repeating costs."
        back={{ to: "/expenses", label: "Expenses" }}
        actions={
          can("expense:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Add recurring
            </button>
          )
        }
      />
      {open && (
        <RecurringExpenseForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            list.reload();
          }}
        />
      )}
      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No recurring expenses" body="Add rent, software or insurance templates to generate them each period." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Category</th>
                    <th>Frequency</th>
                    <th className="num">Amount ({currency})</th>
                    <th>Next run</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.isActive ? undefined : "row-inactive"}>
                      <td>
                        {r.name}
                        <span className="sub">{r.number}{r.payeeName ? ` · ${r.payeeName}` : ""}</span>
                      </td>
                      <td>{r.categoryName}</td>
                      <td>{FREQUENCY_LABELS[r.frequency]}</td>
                      <td className="num">{amount(r.amount)}</td>
                      <td className="nowrap">{date(r.nextRunDate)}</td>
                      <td>
                        <Badge tone={r.isActive ? "positive" : "neutral"}>{r.isActive ? (r.autoPost ? "Auto-post" : "Active") : "Ended"}</Badge>
                      </td>
                      <td className="num">
                        {r.isActive && can("expense:manage") && (
                          <button type="button" className="btn" onClick={() => void run(r.id, r.name)}>
                            Run now
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </>
  );
}

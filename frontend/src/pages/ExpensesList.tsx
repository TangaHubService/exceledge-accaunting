import { Plus } from "lucide-react";
import { useState } from "react";
import { ExpenseForm } from "../components/ExpenseForms";
import { useFeedback } from "../components/feedback";
import { Badge, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { Select } from "../components/Select";
import { useCompany } from "../lib/company";
import { EXPENSE_STATUS, PAYMENT_MODE_LABELS } from "../lib/expense";
import { amount, date, isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { ExpenseList, ExpenseStatus } from "../lib/types";
import { monthStart } from "./WithholdingTax";

export function ExpensesList() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { confirm, toast } = useFeedback();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const q = new URLSearchParams({ from, to, pageSize: "100" });
  if (status) q.set("status", status);
  const list = useResource<ExpenseList>(`/api/v1/expenses?${q}`);

  async function act(id: string, action: "approve" | "reject" | "post" | "reverse", body?: object) {
    try {
      await api(`/api/v1/expenses/${id}/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) });
      toast(action === "approve" ? "Expense approved and posted" : action === "reject" ? "Expense rejected" : action === "post" ? "Expense posted" : "Expense reversed");
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Expense list"
        description="Draft, submit, approve and post operating expenses."
        back={{ to: "/expenses", label: "Expenses" }}
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
            list.reload();
          }}
        />
      )}
      <div className="filter-bar no-print">
        <Field label="From">
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || monthStart())} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || isoDay())} />
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={setStatus}
            options={[{ value: "", label: "All statuses" }, ...Object.entries(EXPENSE_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
            searchable={false}
          />
        </Field>
      </div>

      <Loadable resource={list}>
        {(d) =>
          d.rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No expenses" body="Nothing matches this period and status." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Expense</th>
                    <th>Category</th>
                    <th className="hide-sm">How paid</th>
                    <th className="num">Amount ({currency})</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((e) => (
                    <tr key={e.id} className={e.status === "REVERSED" || e.status === "REJECTED" ? "row-inactive" : undefined}>
                      <td className="nowrap">{date(e.expenseDate)}</td>
                      <td>
                        {e.number}
                        <span className="sub">
                          {e.payeeName || e.employeeName || e.description || "—"}
                        </span>
                      </td>
                      <td>{e.categoryName}</td>
                      <td className="hide-sm">{PAYMENT_MODE_LABELS[e.paymentMode]}</td>
                      <td className="num">{amount(e.grossAmount)}</td>
                      <td>
                        <Badge tone={EXPENSE_STATUS[e.status as ExpenseStatus].tone}>{EXPENSE_STATUS[e.status as ExpenseStatus].label}</Badge>
                      </td>
                      <td className="num nowrap">
                        {e.status === "SUBMITTED" && can("expense:approve") && (
                          <>
                            <button type="button" className="btn" onClick={() => void act(e.id, "approve")}>
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={async () => {
                                const ok = await confirm({ title: `Reject ${e.number}?`, body: "The claim or expense returns to the submitter.", confirmLabel: "Reject", danger: true });
                                if (ok) void act(e.id, "reject", { reason: "Rejected from expense list" });
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {(e.status === "DRAFT" || e.status === "APPROVED") && can("expense:manage") && (
                          <button type="button" className="btn" onClick={() => void act(e.id, "post")}>
                            Post
                          </button>
                        )}
                        {e.status === "POSTED" && can("expense:manage") && (
                          <button
                            type="button"
                            className="btn"
                            onClick={async () => {
                              const ok = await confirm({ title: `Reverse ${e.number}?`, body: "A reversing journal will be posted.", confirmLabel: "Reverse", danger: true });
                              if (ok) void act(e.id, "reverse", { reason: "Reversed from expense list" });
                            }}
                          >
                            Reverse
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

import { Plus } from "lucide-react";
import { useState } from "react";
import { TaxPaymentForm } from "../components/TaxForms";
import { useFeedback } from "../components/feedback";
import { Badge, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import { TAX_TYPE_LABELS } from "../lib/tax";
import type { TaxPaymentList } from "../lib/types";
import { monthStart } from "./WithholdingTax";

export function TaxPayments() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { confirm, toast } = useFeedback();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const [open, setOpen] = useState(false);
  const list = useResource<TaxPaymentList>(`/api/v1/tax/payments?from=${from}&to=${to}&pageSize=100`);

  async function reverse(id: string, number: string) {
    const ok = await confirm({
      title: `Reverse ${number}?`,
      body: "A reversing journal will be posted. The payment stays on the register as reversed.",
      confirmLabel: "Reverse",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/tax/payments/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "Reversed from Tax payments" }) });
      toast("Payment reversed");
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Tax payments"
        description="Settlements paid to (or refunded by) the tax authority."
        back={{ to: "/tax", label: "Tax" }}
        actions={
          can("tax:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Record payment
            </button>
          )
        }
      />
      {open && (
        <TaxPaymentForm
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
      </div>

      <Loadable resource={list}>
        {(d) =>
          d.rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No tax payments" body="Record a payment when you settle VAT or withholding with the authority." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payment</th>
                    <th>Type</th>
                    <th className="num">Amount ({currency})</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((p) => (
                    <tr key={p.id} className={p.status === "REVERSED" ? "row-inactive" : undefined}>
                      <td className="nowrap">{date(p.paymentDate)}</td>
                      <td>
                        {p.number}
                        {p.reference && <span className="sub">{p.reference}</span>}
                        {p.isRefund && <span className="sub">Refund</span>}
                      </td>
                      <td>{TAX_TYPE_LABELS[p.taxType]}</td>
                      <td className="num">{amount(p.isRefund ? -p.amount : p.amount)}</td>
                      <td>
                        <Badge tone={p.status === "REVERSED" ? "neutral" : "positive"}>{p.status === "REVERSED" ? "Reversed" : "Posted"}</Badge>
                      </td>
                      <td className="num">
                        {can("tax:manage") && p.status === "POSTED" && (
                          <button type="button" className="btn" onClick={() => void reverse(p.id, p.number)}>
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

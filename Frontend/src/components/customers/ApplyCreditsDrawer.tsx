import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../forms";
import { Drawer, EmptyState, Loadable } from "../ui";
import { amount, date, isoDay } from "../../lib/format";
import { useResource, useSession } from "../../lib/session";
import type { CustomerCredits, CustomerCreditSource } from "../../lib/types";

const SOURCE_LABEL: Record<CustomerCreditSource, string> = { PAYMENT: "Payment", CREDIT_NOTE: "Credit note", DEPOSIT: "Deposit" };

type Credit = CustomerCredits["credits"][number];
type Invoice = CustomerCredits["invoices"][number];

const key = (c: Pick<Credit, "type" | "id">) => `${c.type}:${c.id}`;

/** Oldest credit to the oldest due invoice, same currency only. */
function autoPlan(credits: Credit[], invoices: Invoice[]) {
  const left = new Map(invoices.map((i) => [i.id, i.open]));
  const plan: Record<string, Record<string, string>> = {};
  for (const c of credits) {
    let avail = c.available;
    for (const inv of invoices) {
      if (avail <= 0.005) break;
      if (inv.currency !== c.currency) continue;
      const open = left.get(inv.id) ?? 0;
      if (open <= 0.005) continue;
      const take = Math.round(Math.min(avail, open) * 100) / 100;
      (plan[key(c)] ??= {})[inv.id] = amount(take, take % 1 ? 2 : 0);
      left.set(inv.id, open - take);
      avail -= take;
    }
  }
  return plan;
}

/**
 * Sets a customer's unapplied payments, credit notes and deposits against open invoices,
 * like QuickBooks' Receive payment → credits. Totals are checked again on the server.
 */
export function ApplyCreditsDrawer({ customerId, onClose, onSaved }: { customerId: string; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const data = useResource<CustomerCredits>(`/api/v1/ar/customers/${customerId}/credits`);
  const [selected, setSelected] = useState<string>("");
  // plan[creditKey][invoiceId] = amount text
  const [plan, setPlan] = useState<Record<string, Record<string, string>>>({});
  const [applyDate, setApplyDate] = useState(isoDay());
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    if (data.data && !selected && data.data.credits[0]) setSelected(key(data.data.credits[0]));
  }, [data.data, selected]);

  const credits = useMemo(() => data.data?.credits ?? [], [data.data]);
  const invoices = useMemo(() => data.data?.invoices ?? [], [data.data]);
  const credit = credits.find((c) => key(c) === selected);

  const num = (t: string | undefined) => {
    const n = parseAmount(t ?? "");
    return Number.isFinite(n) ? n : 0;
  };
  const usedOf = (c: Credit) => Object.values(plan[key(c)] ?? {}).reduce((s, t) => s + num(t), 0);
  const appliedTo = (inv: Invoice) => Object.values(plan).reduce((s, row) => s + num(row[inv.id]), 0);
  const total = Object.values(plan).reduce((s, row) => s + Object.values(row).reduce((t, v) => t + num(v), 0), 0);

  const problems: string[] = [];
  for (const c of credits) if (usedOf(c) - c.available > 0.005) problems.push(`${SOURCE_LABEL[c.type]} ${c.number} only has ${amount(c.available, 2)} to apply`);
  for (const inv of invoices) if (appliedTo(inv) - inv.open > 0.005) problems.push(`Invoice ${inv.number} only has ${amount(inv.open, 2)} open`);

  function setAmount(invoiceId: string, value: string) {
    if (!credit) return;
    setPlan((p) => ({ ...p, [key(credit)]: { ...(p[key(credit)] ?? {}), [invoiceId]: value } }));
  }

  function fillSelected() {
    if (!credit) return;
    const others: Record<string, Record<string, string>> = { ...plan, [key(credit)]: {} };
    const left = (inv: Invoice) => inv.open - Object.values(others).reduce((s, row) => s + num(row[inv.id]), 0);
    let avail = credit.available;
    const row: Record<string, string> = {};
    for (const inv of invoices) {
      if (avail <= 0.005 || inv.currency !== credit.currency) continue;
      const take = Math.round(Math.min(avail, left(inv)) * 100) / 100;
      if (take <= 0.005) continue;
      row[inv.id] = amount(take, take % 1 ? 2 : 0);
      avail -= take;
    }
    setPlan({ ...others, [key(credit)]: row });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length) return setError(problems[0]);
    const applications = credits.flatMap((c) =>
      Object.entries(plan[key(c)] ?? {})
        .map(([invoiceId, t]) => ({ source: c.type, sourceId: c.id, invoiceId, amount: num(t) }))
        .filter((a) => a.amount > 0),
    );
    if (!applications.length) return setError("Enter an amount against at least one invoice.");
    void run(async () => {
      const res = await api<{ total: number }>(`/api/v1/ar/customers/${customerId}/apply-credits`, {
        method: "POST",
        body: JSON.stringify({ applications, date: applyDate }),
      });
      onSaved();
      return `${amount(res.total, 2)} of credit applied`;
    });
  }

  return (
    <Drawer
      title="Apply credits"
      subtitle="Settle open invoices with money the customer already has with you. Payments and credit notes are already off the balance; applying a deposit lowers it."
      wide
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={total > 0 ? `Apply ${amount(total, total % 1 ? 2 : 0)}` : "Apply"} formId="apply-credits-form" />}
    >
      <Loadable resource={data}>
        {(d) =>
          !d.credits.length ? (
            <EmptyState title="No credits to apply" body="Unapplied payments, credit notes and deposits will show here." />
          ) : !d.invoices.length ? (
            <EmptyState title="No open invoices" body="This customer has credit but nothing to apply it to. You can refund deposits from the Payments tab." />
          ) : (
            <form id="apply-credits-form" className="ac" onSubmit={submit}>
              <FormError message={error} />
              <div className="ac-head">
                <span className="field-label">Credits available</span>
                <button type="button" className="link-button" onClick={() => setPlan(autoPlan(d.credits, d.invoices))}>
                  Apply all, oldest first
                </button>
              </div>
              <div className="ac-credits" role="radiogroup" aria-label="Credit to apply">
                {d.credits.map((c) => {
                  const used = usedOf(c);
                  return (
                    <button
                      key={key(c)}
                      type="button"
                      role="radio"
                      aria-checked={selected === key(c)}
                      className={`ac-credit ${selected === key(c) ? "on" : ""} ${used - c.available > 0.005 ? "over" : ""}`}
                      onClick={() => setSelected(key(c))}
                    >
                      <span className="strong">
                        {SOURCE_LABEL[c.type]} {c.number}
                      </span>
                      <span className="sub">
                        {date(c.date)}
                        {c.description ? ` · ${c.description}` : ""}
                      </span>
                      <span className="ac-credit-amt">
                        <span className="num strong">{amount(c.available - used, 2)}</span>
                        <span className="sub">of {amount(c.available, 2)} left</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {credit && (
                <>
                  <div className="ac-head">
                    <span className="field-label">
                      Apply {SOURCE_LABEL[credit.type].toLowerCase()} {credit.number} to
                    </span>
                    <button type="button" className="link-button" onClick={fillSelected}>
                      Fill oldest first
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th className="hide-sm">Due</th>
                          <th className="num">Open</th>
                          <th className="num" style={{ width: 150 }}>
                            Apply
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.invoices.map((inv) => {
                          const sameCcy = inv.currency === credit.currency;
                          const remaining = inv.open - appliedTo(inv);
                          return (
                            <tr key={inv.id}>
                              <td>
                                <span className="strong">{inv.isOpening ? "Opening balance" : "Invoice"} {inv.number}</span>
                                {!sameCcy && <span className="sub">In {inv.currency}; this credit is in {credit.currency}</span>}
                              </td>
                              <td className="hide-sm nowrap">{date(inv.dueDate)}</td>
                              <td className="num">
                                {amount(inv.open, 2)}
                                {Math.abs(remaining - inv.open) > 0.005 && <span className="sub">{amount(Math.max(0, remaining), 2)} after</span>}
                              </td>
                              <td className="num">
                                <MoneyInput
                                  aria-label={`Amount to apply to ${inv.number}`}
                                  value={plan[key(credit)]?.[inv.id] ?? ""}
                                  onChange={(v) => setAmount(inv.id, v)}
                                  disabled={!sameCcy}
                                  invalid={remaining < -0.005}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="form-grid" style={{ marginTop: 14 }}>
                <label className="field">
                  <span className="field-label">Date</span>
                  <input className="input" type="date" value={applyDate} max={isoDay()} onChange={(e) => setApplyDate(e.target.value)} />
                  <span className="field-hint">Used for any realized FX entry on foreign-currency payments</span>
                </label>
              </div>
              {problems.length > 0 && <p className="text-negative small">{problems[0]}</p>}
            </form>
          )
        }
      </Loadable>
    </Drawer>
  );
}

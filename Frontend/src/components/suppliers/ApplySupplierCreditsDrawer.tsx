import { type FormEvent, useEffect, useMemo, useState } from "react";
import { amount, date, isoDay } from "../../lib/format";
import { useResource, useSession } from "../../lib/session";
import type { SupplierCreditSource, SupplierOpenItems } from "../../lib/types";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../forms";
import { Drawer, EmptyState, Loadable } from "../ui";

const SOURCE_LABEL: Record<SupplierCreditSource, string> = { CREDIT_NOTE: "Supplier credit", PAYMENT: "Unapplied payment", ADVANCE: "Advance" };

type Credit = SupplierOpenItems["credits"][number];
type Bill = SupplierOpenItems["bills"][number];
type Plan = Record<string, Record<string, string>>;

const key = (c: Pick<Credit, "source" | "id">) => `${c.source}:${c.id}`;
const text = (n: number) => amount(n, n % 1 ? 2 : 0);

/** Oldest credit to the oldest due bill, same currency only. */
function autoPlan(credits: Credit[], bills: Bill[]): Plan {
  const left = new Map(bills.map((b) => [b.id, b.open]));
  const plan: Plan = {};
  for (const c of credits) {
    let avail = c.available;
    for (const b of bills) {
      if (avail <= 0.005) break;
      if (b.currency !== c.currency) continue;
      const open = left.get(b.id) ?? 0;
      if (open <= 0.005) continue;
      const take = Math.round(Math.min(avail, open) * 100) / 100;
      (plan[key(c)] ??= {})[b.id] = text(take);
      left.set(b.id, open - take);
      avail -= take;
    }
  }
  return plan;
}

/**
 * Sets a supplier's credits, unapplied payments and advances against open bills (QuickBooks "apply credits").
 * Totals are checked again on the server, which applies the whole set or nothing.
 */
export function ApplySupplierCreditsDrawer({
  supplierId,
  initialSource,
  onClose,
  onSaved,
}: {
  supplierId: string;
  /** Start with this credit selected, e.g. from a row on the Supplier credits tab. */
  initialSource?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const data = useResource<SupplierOpenItems>(`/api/v1/ap/suppliers/${supplierId}/open-items`);
  const [selected, setSelected] = useState<string>(initialSource ?? "");
  const [plan, setPlan] = useState<Plan>({});
  const [applyDate, setApplyDate] = useState(isoDay());
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    const first = data.data?.credits[0];
    if (first && (!selected || !data.data!.credits.some((c) => key(c) === selected))) setSelected(key(first));
  }, [data.data, selected]);

  const credits = useMemo(() => data.data?.credits ?? [], [data.data]);
  const bills = useMemo(() => data.data?.bills ?? [], [data.data]);
  const credit = credits.find((c) => key(c) === selected);

  const num = (t: string | undefined) => {
    const n = parseAmount(t ?? "");
    return Number.isFinite(n) ? n : 0;
  };
  const usedOf = (c: Credit) => Object.values(plan[key(c)] ?? {}).reduce((s, t) => s + num(t), 0);
  const appliedTo = (b: Bill) => Object.values(plan).reduce((s, row) => s + num(row[b.id]), 0);
  const total = Object.values(plan).reduce((s, row) => s + Object.values(row).reduce((t, v) => t + num(v), 0), 0);

  const problems: string[] = [];
  for (const c of credits) if (usedOf(c) - c.available > 0.005) problems.push(`${SOURCE_LABEL[c.source]} ${c.number} only has ${amount(c.available, 2)} to apply`);
  for (const b of bills) if (appliedTo(b) - b.open > 0.005) problems.push(`Bill ${b.number} only has ${amount(b.open, 2)} left to pay`);

  function setAmount(billId: string, value: string) {
    if (!credit) return;
    setPlan((p) => ({ ...p, [key(credit)]: { ...(p[key(credit)] ?? {}), [billId]: value } }));
  }

  function fillSelected() {
    if (!credit) return;
    const others: Plan = { ...plan, [key(credit)]: {} };
    const left = (b: Bill) => b.open - Object.values(others).reduce((s, row) => s + num(row[b.id]), 0);
    let avail = credit.available;
    const row: Record<string, string> = {};
    for (const b of bills) {
      if (avail <= 0.005 || b.currency !== credit.currency) continue;
      const take = Math.round(Math.min(avail, left(b)) * 100) / 100;
      if (take <= 0.005) continue;
      row[b.id] = text(take);
      avail -= take;
    }
    setPlan({ ...others, [key(credit)]: row });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length) return setError(problems[0]);
    const applications = credits.flatMap((c) =>
      Object.entries(plan[key(c)] ?? {})
        .map(([billId, t]) => ({ source: c.source, sourceId: c.id, billId, amount: num(t) }))
        .filter((a) => a.amount > 0),
    );
    if (!applications.length) return setError("Enter an amount against at least one bill.");
    void run(async () => {
      const res = await api<{ total: number }>(`/api/v1/ap/suppliers/${supplierId}/apply-credits`, {
        method: "POST",
        body: JSON.stringify({ applications, date: applyDate }),
      });
      onSaved();
      return `${amount(res.total, 2)} of credit applied to bills`;
    });
  }

  return (
    <Drawer
      title="Apply credits"
      subtitle="Settle open bills with credits the supplier already owes you. Supplier credits and unapplied payments are already off the balance; applying an advance lowers it."
      wide
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={total > 0 ? `Apply ${text(total)}` : "Apply"} formId="apply-supplier-credits-form" />}
    >
      <Loadable resource={data}>
        {(d) =>
          !d.credits.length ? (
            <EmptyState title="No credits to apply" body="Supplier credits, unapplied payments and advances show here until they're used." />
          ) : !d.bills.length ? (
            <EmptyState title="No open bills" body="This supplier has credit but no bill to set it against. Advances can be refunded from the Payments tab." />
          ) : (
            <form id="apply-supplier-credits-form" className="ac" onSubmit={submit}>
              <FormError message={error} />
              <div className="ac-head">
                <span className="field-label">Credits available</span>
                <button type="button" className="link-button" onClick={() => setPlan(autoPlan(d.credits, d.bills))}>
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
                        {SOURCE_LABEL[c.source]} {c.number}
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
                      Apply {SOURCE_LABEL[credit.source].toLowerCase()} {credit.number} to
                    </span>
                    <button type="button" className="link-button" onClick={fillSelected}>
                      Fill oldest first
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Bill</th>
                          <th className="hide-sm">Due</th>
                          <th className="num">Open</th>
                          <th className="num" style={{ width: 150 }}>
                            Apply
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.bills.map((b) => {
                          const sameCcy = b.currency === credit.currency;
                          const remaining = b.open - appliedTo(b);
                          return (
                            <tr key={b.id}>
                              <td>
                                <span className="strong">
                                  {b.isOpening ? "Opening balance" : "Bill"} {b.number}
                                </span>
                                {b.supplierInvoiceNumber && <span className="sub">Inv. {b.supplierInvoiceNumber}</span>}
                                {!sameCcy && <span className="sub">In {b.currency}; this credit is in {credit.currency}</span>}
                              </td>
                              <td className="hide-sm nowrap">{date(b.dueDate)}</td>
                              <td className="num">
                                {amount(b.open, 2)}
                                {Math.abs(remaining - b.open) > 0.005 && <span className="sub">{amount(Math.max(0, remaining), 2)} after</span>}
                              </td>
                              <td className="num">
                                <MoneyInput
                                  aria-label={`Amount to apply to ${b.number}`}
                                  value={plan[key(credit)]?.[b.id] ?? ""}
                                  onChange={(v) => setAmount(b.id, v)}
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
                  <span className="field-hint">Used for advance journals and any realized FX on foreign-currency payments</span>
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

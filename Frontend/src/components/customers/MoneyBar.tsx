import { amount, plural } from "../../lib/format";
import type { MoneyBarData } from "../../lib/types";

type Segment = "unbilled" | "overdue" | "notDue" | "paid30";

/**
 * Receivables at a glance, in the QuickBooks money-bar layout: an Unpaid group (overdue, not due yet)
 * and a Paid group (last 30 days). Figures come from the server; segments can act as filters.
 */
export function MoneyBar({
  data,
  currency,
  active,
  onSelect,
  loading,
}: {
  data?: MoneyBarData;
  currency: string;
  active?: Segment | null;
  onSelect?: (segment: Segment) => void;
  loading?: boolean;
}) {
  const unpaid = (data?.overdue.amount ?? 0) + (data?.notDue.amount ?? 0);
  const overduePct = unpaid > 0 ? Math.max(data!.overdue.amount > 0 ? 4 : 0, (data!.overdue.amount / unpaid) * 100) : 0;

  const cell = (seg: Segment, label: string, value: number | undefined, count: number | undefined, unit: string) => {
    const body = (
      <>
        <span className="mb-amount">
          <span className="mb-ccy">{currency}</span>
          {loading || value === undefined ? "…" : amount(value)}
        </span>
        <span className="mb-label">
          {label}
          {count !== undefined && !loading && <span className="mb-count"> · {plural(count, unit)}</span>}
        </span>
      </>
    );
    return onSelect ? (
      <button type="button" className={`mb-cell ${seg} ${value ? "has-value" : ""} ${active === seg ? "on" : ""}`} aria-pressed={active === seg} onClick={() => onSelect(seg)}>
        {body}
      </button>
    ) : (
      <div className={`mb-cell ${seg} ${value ? "has-value" : ""}`}>{body}</div>
    );
  };

  return (
    <section className="money-bar" aria-label="Receivables summary">
      <div className="mb-group unbilled">
        <div className="mb-head">
          <span className="mb-title">Unbilled</span>
          <span className="mb-sub">Delayed charges</span>
        </div>
        <div className="mb-cells">{cell("unbilled", "Not invoiced yet", data?.unbilled?.amount, data?.unbilled?.count, "charge")}</div>
        <div className="mb-track" aria-hidden="true">
          <span className="mb-fill unbilled" style={{ width: (data?.unbilled?.amount ?? 0) > 0 ? "100%" : "0%" }} />
        </div>
      </div>
      <div className="mb-group unpaid">
        <div className="mb-head">
          <span className="mb-title">Unpaid</span>
          <span className="mb-sub">
            {currency} {loading ? "…" : amount(unpaid)}
          </span>
        </div>
        <div className="mb-cells">
          {cell("overdue", "Overdue", data?.overdue.amount, data?.overdue.count, "invoice")}
          {cell("notDue", "Not due yet", data?.notDue.amount, data?.notDue.count, "invoice")}
        </div>
        <div className="mb-track" aria-hidden="true">
          <span className="mb-fill overdue" style={{ width: `${overduePct}%` }} />
          <span className="mb-fill notDue" style={{ width: `${unpaid > 0 ? 100 - overduePct : 0}%` }} />
        </div>
      </div>
      <div className="mb-group paid">
        <div className="mb-head">
          <span className="mb-title">Paid</span>
          <span className="mb-sub">Last 30 days</span>
        </div>
        <div className="mb-cells">{cell("paid30", "Received", data?.paid30.amount, data?.paid30.count, "payment")}</div>
        <div className="mb-track" aria-hidden="true">
          <span className="mb-fill paid30" style={{ width: (data?.paid30.amount ?? 0) > 0 ? "100%" : "0%" }} />
        </div>
      </div>
    </section>
  );
}

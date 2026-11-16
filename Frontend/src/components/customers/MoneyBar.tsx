import { amount, plural } from "../../lib/format";
import type { MoneyBarData } from "../../lib/types";

type Segment = "unbilled" | "overdue" | "notDue" | "paid30";

/** Wording for each part of the bar. Receivables wording is the default; payables pass `PAYABLES_LABELS`. */
export type MoneyBarLabels = {
  aria: string;
  firstTitle: string;
  firstSub: string;
  firstCell: string;
  firstUnit: string;
  documentUnit: string;
  paidCell: string;
};

const RECEIVABLES_LABELS: MoneyBarLabels = {
  aria: "Receivables summary",
  firstTitle: "Unbilled",
  firstSub: "Delayed charges",
  firstCell: "Not invoiced yet",
  firstUnit: "charge",
  documentUnit: "invoice",
  paidCell: "Received",
};

export const PAYABLES_LABELS: MoneyBarLabels = {
  aria: "Payables summary",
  firstTitle: "Ordered",
  firstSub: "Open purchase orders",
  firstCell: "Not billed yet",
  firstUnit: "order",
  documentUnit: "bill",
  paidCell: "Paid",
};

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
  labels = RECEIVABLES_LABELS,
}: {
  labels?: MoneyBarLabels;
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
    <section className="money-bar" aria-label={labels.aria}>
      <div className="mb-group unbilled">
        <div className="mb-head">
          <span className="mb-title">{labels.firstTitle}</span>
          <span className="mb-sub">{labels.firstSub}</span>
        </div>
        <div className="mb-cells">{cell("unbilled", labels.firstCell, data?.unbilled?.amount, data?.unbilled?.count, labels.firstUnit)}</div>
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
          {cell("overdue", "Overdue", data?.overdue.amount, data?.overdue.count, labels.documentUnit)}
          {cell("notDue", "Not due yet", data?.notDue.amount, data?.notDue.count, labels.documentUnit)}
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
        <div className="mb-cells">{cell("paid30", labels.paidCell, data?.paid30.amount, data?.paid30.count, "payment")}</div>
        <div className="mb-track" aria-hidden="true">
          <span className="mb-fill paid30" style={{ width: (data?.paid30.amount ?? 0) > 0 ? "100%" : "0%" }} />
        </div>
      </div>
    </section>
  );
}

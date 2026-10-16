import { DownloadCloud } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { useFeedback } from "../components/feedback";
import { EmptyState, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, money, plural } from "../lib/format";
import { KIND_LABELS, METHOD_LABELS } from "../lib/inventory";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { InventoryDashboard } from "../lib/types";

type Attention = { key: string; tone: "negative" | "warning" | "info"; what: string; why: string; value?: string; to: string };

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Horizontal bars for a value breakdown, largest first. */
function ValueBars({ rows, currency, empty }: { rows: Array<{ name: string; value: number }>; currency: string; empty: string }) {
  if (!rows.length) return <p className="all-clear">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <>
      {rows.slice(0, 6).map((r) => (
        <div className="bar-row" key={r.name}>
          <span className="muted" title={r.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.name}
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </div>
          <span className="num">{amount(r.value)}</span>
        </div>
      ))}
      {rows.length > 6 && <p className="muted small">and {plural(rows.length - 6, "more")}</p>}
      <div className="bar-total">
        <span>Total</span>
        <span className="amount">{money(total, currency)}</span>
      </div>
    </>
  );
}

export function Inventory() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const { confirm, toast } = useFeedback();
  const dash = useResource<InventoryDashboard>("/api/v1/inventory/dashboard");
  const [requesting, setRequesting] = useState(false);

  async function loadOpening() {
    const ok = await confirm({
      title: "Load opening stock from Excel Edge?",
      body: (
        <>
          <p>
            Excel Edge will send the quantity it holds for every product at every branch, valued at each branch's average batch cost. Accounting records it as opening stock
            against the suspense account for your accountant to clear.
          </p>
          <p className="muted">Items and branches that already have opening stock are left as they are, so this is safe to run again for new branches.</p>
        </>
      ),
      confirmLabel: "Request snapshot",
    });
    if (!ok) return;
    setRequesting(true);
    try {
      const result = await api<{ queued: boolean; lines: number; uncosted: number } | null>("/api/v1/inventory/opening-snapshot", { method: "POST" });
      if (result && !result.queued) toast("Excel Edge has no stock on hand to send.");
      else
        toast(
          result
            ? `Excel Edge queued ${plural(result.lines, "item-branch", "item-branches")}${result.uncosted ? `, ${result.uncosted} without a batch cost` : ""}. They'll appear here within a few minutes.`
            : "Snapshot requested. It will appear here within a few minutes.",
        );
      window.setTimeout(dash.reload, 5000);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        description={dash.data ? `Stock value from every Excel Edge movement · ${METHOD_LABELS[dash.data.valuationMethod]}` : "Stock value from every Excel Edge movement"}
        actions={
          <>
            <Link to="/reports/inventory-valuation" className="btn">
              Valuation report
            </Link>
            {can("inventory:manage") && (
              <button type="button" className="btn btn-primary" onClick={loadOpening} disabled={requesting}>
                <DownloadCloud size={16} aria-hidden="true" />
                {requesting ? "Requesting…" : "Load opening stock"}
              </button>
            )}
          </>
        }
      />

      <Loadable resource={dash}>
        {(d) => {
          const r = d.reconciliation;
          const attention: Attention[] = [];
          if (!d.openingLoaded) {
            attention.push({
              key: "opening",
              tone: "warning",
              what: "Opening stock hasn't been loaded",
              why: "Stock that was on hand before Accounting started has no value yet. Load it from Excel Edge once.",
              to: "/inventory/reconciliation",
            });
          }
          if (Math.abs(r.difference) >= 0.01) {
            attention.push({
              key: "difference",
              tone: "negative",
              what: "Inventory in the ledger doesn't match stock value",
              why: "The general ledger inventory account and the item values differ.",
              value: money(r.difference, currency),
              to: "/inventory/reconciliation",
            });
          }
          if (r.failedEvents) {
            attention.push({
              key: "failed",
              tone: "negative",
              what: `${plural(r.failedEvents, "stock movement")} couldn't be recorded`,
              why: "Usually a closed period or an unmapped account. Fix the cause, then retry from posting exceptions.",
              to: "/inventory/reconciliation",
            });
          }
          if (r.uncostedMovements) {
            attention.push({
              key: "uncosted",
              tone: "warning",
              what: `${plural(r.uncostedMovements, "movement")} recorded without a cost`,
              why: "Excel Edge sent no cost and there was no valued stock to average. Check batch costs in Excel Edge.",
              to: "/inventory/movements?costSource=UNCOSTED",
            });
          }

          const lossesAndWriteOffs = d.month.losses + d.month.writeOffs;
          const maxTrend = Math.max(1, ...d.trend.map((t) => Math.abs(t.value)));
          return (
            <>
              <section className="figures" aria-label="Inventory position" style={{ "--cols": 4 } as CSSProperties}>
                <Figure
                  lead
                  label="Stock value"
                  currency={currency}
                  value={amount(d.totalValue)}
                  note={d.averageUnitCost !== null ? `Average ${amount(d.averageUnitCost, 2)} a unit` : "Nothing on hand"}
                />
                <Figure
                  label="Units on hand"
                  value={amount(d.totalQuantity)}
                  note={`${plural(d.itemCount, "item")} across ${plural(d.locationCount, "branch", "branches")}`}
                />
                <Figure label="Cost of goods sold" currency={currency} value={amount(d.month.costOfSales)} note={`Since ${date(d.month.from)}`} />
                <Figure
                  label="Losses and write-offs"
                  currency={currency}
                  value={amount(lossesAndWriteOffs)}
                  tone={lossesAndWriteOffs > 0 ? "warning" : undefined}
                  note={d.month.gains ? `Gains ${amount(d.month.gains)} · this month` : "This month"}
                />
              </section>

              <div className="overview-grid">
                <section>
                  <div className="section-head">
                    <h2 className="section-title">Needs your attention</h2>
                    <Link to="/inventory/reconciliation" className="small">
                      Reconciliation
                    </Link>
                  </div>
                  <div className="panel">
                    {attention.length ? (
                      <ul className="attention">
                        {attention.map((a) => (
                          <li key={a.key}>
                            <Link to={a.to}>
                              <span className={`dot ${a.tone}`} />
                              <span>
                                <span className="what">{a.what}</span>
                                <span className="why">{a.why}</span>
                              </span>
                              <span className="how-much">{a.value ?? <span className="muted">Review →</span>}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="all-clear">Stock value agrees with the ledger ({money(r.glValue, currency)}). Nothing needs attention.</p>
                    )}
                  </div>
                </section>

                <section>
                  <div className="section-head">
                    <h2 className="section-title">Stock value by month end</h2>
                    <span className="small muted">{d.turnover.ratio !== null ? `Turnover ${d.turnover.ratio}× over 12 months` : "Turnover needs a year of sales"}</span>
                  </div>
                  <div className="panel bars">
                    {d.trend.map((t) => (
                      <div className="bar-row" key={t.month}>
                        <span className="muted">{monthLabel(t.month)}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(Math.abs(t.value) / maxTrend) * 100}%` }} />
                        </div>
                        <span className="num">{amount(t.value)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="overview-grid section">
                <section>
                  <div className="section-head">
                    <h2 className="section-title">Value by branch</h2>
                  </div>
                  <div className="panel bars">
                    <ValueBars rows={d.byLocation} currency={currency} empty="No stock recorded at any branch yet." />
                  </div>
                </section>
                <section>
                  <div className="section-head">
                    <h2 className="section-title">Value by category</h2>
                  </div>
                  <div className="panel bars">
                    <ValueBars rows={d.byCategory} currency={currency} empty="No stock recorded yet." />
                  </div>
                </section>
              </div>

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Latest stock movements</h2>
                  <Link to="/inventory/movements" className="small">
                    All movements
                  </Link>
                </div>
                <div className="table-wrap">
                  {d.recentMovements.length === 0 ? (
                    <EmptyState
                      title="No stock movements yet"
                      body="Goods received, sales, adjustments and transfers in Excel Edge appear here as they happen, each with its value."
                    />
                  ) : (
                    <table className="table">
                      <tbody>
                        {d.recentMovements.map((m) => (
                          <tr key={m.id} className="clickable" onClick={() => navigate(`/inventory/movements?itemId=${m.item.id}`)}>
                            <td className="muted nowrap" style={{ width: 110 }}>
                              {date(m.movementDate)}
                            </td>
                            <td>
                              {m.item.name}
                              <span className="sub">
                                {KIND_LABELS[m.kind]} · {m.location.name}
                              </span>
                            </td>
                            <td className="num hide-sm">{m.quantityIn ? `+${amount(m.quantityIn)}` : `−${amount(m.quantityOut)}`}</td>
                            <td className={`num ${m.value < 0 ? "" : "text-positive"}`}>{amount(m.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

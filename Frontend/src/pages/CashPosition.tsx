import { Printer } from "lucide-react";
import { useState } from "react";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { ACCOUNT_KIND_LABELS, ACCOUNT_KIND_ORDER } from "../lib/banking";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { Link } from "../lib/router";
import { useResource } from "../lib/session";
import type { CashPositionReport } from "../lib/types";

export function CashPosition() {
  const { name, currency } = useCompany();
  const [asOf, setAsOf] = useState(isoDay());
  const report = useResource<CashPositionReport>(`/api/v1/banking/cash-position?asOf=${asOf}`);

  return (
    <>
      <PageHeader
        title="Cash position"
        description="Opening balance, money in, money out and closing balance of every bank and cash account for a day."
        actions={
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            Print
          </button>
        }
      />
      <div className="filter-bar no-print">
        <Field label="Day">
          <input className="input" type="date" value={asOf} max={isoDay()} onChange={(e) => setAsOf(e.target.value || isoDay())} />
        </Field>
      </div>

      <Loadable resource={report}>
        {(r) => (
          <div className="report">
            <div className="report-head">
              <div className="company">{name}</div>
              <div className="title">Daily cash position</div>
              <div className="period">
                {date(r.asOf)} · Amounts in {currency}
              </div>
            </div>
            {r.rows.length === 0 ? (
              <EmptyState title="No bank or cash accounts" body="Add accounts under Bank & cash to see their daily position." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table pin-first">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="num">Opening</th>
                      <th className="num">Money in</th>
                      <th className="num">Money out</th>
                      <th className="num">Closing</th>
                    </tr>
                  </thead>
                  {ACCOUNT_KIND_ORDER.map((kind) => {
                    const rows = r.rows.filter((x) => x.kind === kind);
                    if (!rows.length) return null;
                    const sum = (k: "opening" | "moneyIn" | "moneyOut" | "closing") => rows.reduce((s, x) => s + x[k], 0);
                    return (
                      <tbody key={kind}>
                        <tr className="group-row">
                          <td colSpan={5}>{ACCOUNT_KIND_LABELS[kind]}</td>
                        </tr>
                        {rows.map((x) => (
                          <tr key={x.id} className={x.isActive ? undefined : "row-inactive"}>
                            <td>
                              <Link to={`/banking/accounts/${x.id}?from=${r.asOf}&to=${r.asOf}`} style={{ color: "inherit" }}>
                                {x.name}
                              </Link>
                              {x.currency !== currency && <span className="sub">{x.currency}</span>}
                            </td>
                            <td className="num">{amount(x.opening)}</td>
                            <td className="num">{x.moneyIn ? amount(x.moneyIn) : ""}</td>
                            <td className="num">{x.moneyOut ? amount(x.moneyOut) : ""}</td>
                            <td className={`num strong ${x.closing < 0 ? "text-negative" : ""}`}>{amount(x.closing)}</td>
                          </tr>
                        ))}
                        {rows.length > 1 && (
                          <tr className="subtotal">
                            <td>Total {ACCOUNT_KIND_LABELS[kind].toLowerCase()}</td>
                            <td className="num">{amount(sum("opening"))}</td>
                            <td className="num">{amount(sum("moneyIn"))}</td>
                            <td className="num">{amount(sum("moneyOut"))}</td>
                            <td className="num">{amount(sum("closing"))}</td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })}
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{amount(r.totals.opening)}</td>
                      <td className="num">{amount(r.totals.moneyIn)}</td>
                      <td className="num">{amount(r.totals.moneyOut)}</td>
                      <td className="num">{amount(r.totals.closing)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="report-foot">
              <span>Balances come from the ledger account behind each bank and cash account. Transfers between your own accounts show on both sides.</span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}

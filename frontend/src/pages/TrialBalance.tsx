import { Printer } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, toNumber } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource } from "../lib/session";
import type { Account } from "../lib/types";
import { TYPE_LABELS, TYPE_ORDER } from "./Accounts";

export function TrialBalance() {
  const { name, tin, currency } = useCompany();
  const accounts = useResource<Account[]>("/api/v1/coa");
  const [showZero, setShowZero] = useState(false);

  const groups = useMemo(() => {
    const list = (accounts.data ?? []).filter((a) => showZero || Math.abs(toNumber(a.currentBalance)) > 0.005);
    return TYPE_ORDER.map((t) => {
      const rows = list.filter((a) => a.type === t).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      const debit = rows.reduce((s, a) => s + Math.max(0, toNumber(a.currentBalance)), 0);
      const credit = rows.reduce((s, a) => s + Math.max(0, -toNumber(a.currentBalance)), 0);
      return { type: t, rows, debit, credit };
    }).filter((g) => g.rows.length);
  }, [accounts.data, showZero]);

  const totalDebit = groups.reduce((s, g) => s + g.debit, 0);
  const totalCredit = groups.reduce((s, g) => s + g.credit, 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;

  return (
    <>
      <PageHeader
        title="Trial balance"
        description="Closing balance of every account from posted entries, as at today."
        actions={
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            Print
          </button>
        }
      />

      <div className="filter-bar no-print">
        <label className="check">
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
          Include accounts with a zero balance
        </label>
      </div>

      <Loadable resource={accounts}>
        {() => (
          <div className="report">
            <div className="report-head">
              <div className="company">{name}</div>
              <div className="title">Trial balance</div>
              <div className="period">
                As at {date(new Date())} · Amounts in {currency}
                {tin && ` · TIN ${tin}`}
              </div>
            </div>

            {groups.length === 0 ? (
              <EmptyState title="Nothing has been posted yet" body="Account balances will appear here once transactions are posted to the ledger." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Code</th>
                      <th>Account</th>
                      <th className="num" style={{ width: 160 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 160 }}>
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.type}>
                        <tr className="group-row">
                          <td colSpan={4}>{TYPE_LABELS[g.type]}</td>
                        </tr>
                        {g.rows.map((a) => {
                          const b = toNumber(a.currentBalance);
                          return (
                            <tr key={a.id} className="clickable" onClick={() => navigate(`/ledger?account=${a.id}`)}>
                              <td className="mono muted">{a.code}</td>
                              <td>{a.name}</td>
                              <td className="num">{b > 0.005 ? amount(b) : ""}</td>
                              <td className="num">{b < -0.005 ? amount(-b) : ""}</td>
                            </tr>
                          );
                        })}
                        <tr className="subtotal">
                          <td />
                          <td>Total {TYPE_LABELS[g.type].toLowerCase()}</td>
                          <td className="num">{g.debit ? amount(g.debit) : ""}</td>
                          <td className="num">{g.credit ? amount(g.credit) : ""}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Total</td>
                      <td className="num">{amount(totalDebit)}</td>
                      <td className="num">{amount(totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="report-foot">
              <span className={difference === 0 ? undefined : "text-negative strong"}>
                {difference === 0 ? "Debits equal credits." : `Out of balance by ${currency} ${amount(Math.abs(difference))}. Review recent postings.`}
              </span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}

import { Printer } from "lucide-react";
import { Fragment, useMemo } from "react";
import { addDimensionParams, DimensionFilters } from "../components/DimensionFilters";
import { ExportButtons } from "../components/ExportButtons";
import { Select } from "../components/Select";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, calendarDate, date, isoDay } from "../lib/format";
import { navigate, setQueryParam, useLocation } from "../lib/router";
import { useResource } from "../lib/session";
import type { AccountType } from "../lib/types";
import { TYPE_LABELS, TYPE_ORDER } from "./Accounts";

type Mode = "STANDARD" | "UNADJUSTED" | "ADJUSTED" | "POST_CLOSING" | "COMPARATIVE" | "COLUMNS";
type Row = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  priorDebit?: number;
  priorCredit?: number;
  openingDebit?: number;
  openingCredit?: number;
  movementDebit?: number;
  movementCredit?: number;
};
type Report = {
  mode: Mode;
  rows: Row[];
  debit: number;
  credit: number;
  difference: number;
  from?: string;
  totals?: { openingDebit: number; openingCredit: number; movementDebit: number; movementCredit: number };
};

const MODES: Array<{ value: Mode; label: string; note: string }> = [
  { value: "STANDARD", label: "Standard", note: "Every posted journal." },
  { value: "UNADJUSTED", label: "Unadjusted", note: "Excludes adjusting journals." },
  { value: "ADJUSTED", label: "Adjusted", note: "Includes adjusting journals." },
  { value: "POST_CLOSING", label: "Post-closing", note: "Balance sheet accounts only, as after the year-end close." },
  { value: "COMPARATIVE", label: "Comparative", note: "Side by side with an earlier date." },
  { value: "COLUMNS", label: "Opening, movement, closing", note: "Balance before the start date, debits and credits in the range, then the closing balance." },
];

const SUM_KEYS = ["debit", "credit", "priorDebit", "priorCredit", "openingDebit", "openingCredit", "movementDebit", "movementCredit"] as const;
type SumKey = (typeof SUM_KEYS)[number];

export function TrialBalance() {
  const { name, tin, currency } = useCompany();
  const { query } = useLocation();
  const mode = (MODES.find((m) => m.value === query.get("mode"))?.value ?? "STANDARD") as Mode;
  const asOf = query.get("asOf") || isoDay();
  const from = query.get("from") ?? "";
  const compareAsOf = query.get("compareAsOf") || `${Number(asOf.slice(0, 4)) - 1}-12-31`;
  const comparative = mode === "COMPARATIVE";
  const columns = mode === "COLUMNS";

  const params = new URLSearchParams({ mode, asOf });
  if (comparative) params.set("compareAsOf", compareAsOf);
  if (columns && from) params.set("from", from);
  addDimensionParams(params, query);
  const path = `/api/v1/books/trial-balance?${params}`;
  const report = useResource<Report>(path);

  const groups = useMemo(() => {
    const rows = report.data?.rows ?? [];
    return TYPE_ORDER.map((t) => {
      const list = rows.filter((r) => r.type === t);
      const sums = Object.fromEntries(SUM_KEYS.map((k) => [k, list.reduce((s, r) => s + (r[k] ?? 0), 0)])) as Record<SumKey, number>;
      return { type: t, rows: list, ...sums };
    }).filter((g) => g.rows.length);
  }, [report.data]);

  const priorDebit = groups.reduce((s, g) => s + g.priorDebit, 0);
  const priorCredit = groups.reduce((s, g) => s + g.priorCredit, 0);
  const cols = columns ? 8 : comparative ? 6 : 4;
  const cell = (n: number | undefined) => (Math.abs(n ?? 0) > 0.005 ? amount(n ?? 0) : "");
  const numberCells = (r: Partial<Record<SumKey, number>>, muted = false) =>
    (columns
      ? (["openingDebit", "openingCredit", "movementDebit", "movementCredit", "debit", "credit"] as const)
      : comparative
        ? (["debit", "credit", "priorDebit", "priorCredit"] as const)
        : (["debit", "credit"] as const)
    ).map((k) => (
      <td key={k} className={`num${muted && (k === "priorDebit" || k === "priorCredit") ? " muted" : ""}`}>
        {cell(r[k])}
      </td>
    ));

  return (
    <>
      <PageHeader
        title="Trial balance"
        description="Closing balance of every account from posted journals."
        actions={
          <>
            <ExportButtons path={path} filename={`trial-balance-${asOf}`} />
            <button type="button" className="btn" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" />
              Print
            </button>
          </>
        }
      />

      <div className="filter-bar no-print" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="View">
          <Select value={mode} onChange={(v) => setQueryParam("mode", v === "STANDARD" ? null : v)} options={MODES.map((m) => ({ value: m.value, label: m.label }))} style={{ minWidth: 200 }} />
        </Field>
        {columns && (
          <Field label="From">
            <input className="input" type="date" value={from} max={asOf} onChange={(e) => setQueryParam("from", e.target.value || null)} />
          </Field>
        )}
        <Field label={columns ? "To" : "As at"}>
          <input className="input" type="date" value={asOf} onChange={(e) => setQueryParam("asOf", e.target.value || null)} />
        </Field>
        {comparative && (
          <Field label="Compare with">
            <input className="input" type="date" value={compareAsOf} max={asOf} onChange={(e) => setQueryParam("compareAsOf", e.target.value || null)} />
          </Field>
        )}
        <DimensionFilters query={query} />
        <span className="muted small grow" style={{ paddingBottom: 8 }}>
          {MODES.find((m) => m.value === mode)?.note}
        </span>
      </div>

      <Loadable resource={report}>
        {(d) => {
          const difference = Math.round(d.difference * 100) / 100;
          return (
            <div className="report">
              <div className="report-head">
                <div className="company">{name}</div>
                <div className="title">Trial balance{mode !== "STANDARD" ? ` (${MODES.find((m) => m.value === mode)?.label.toLowerCase()})` : ""}</div>
                <div className="period">
                  {columns && d.from ? `${calendarDate(d.from)} to ${calendarDate(asOf)}` : `As at ${calendarDate(asOf)}`}
                  {comparative && ` compared with ${calendarDate(compareAsOf)}`} · Amounts in {currency}
                  {tin && ` · TIN ${tin}`}
                </div>
              </div>

              {groups.length === 0 ? (
                <EmptyState title="Nothing posted by this date" body="Account balances appear here once journals are posted to the ledger." />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 90 }}>Code</th>
                        <th>Account</th>
                        {columns ? (
                          <>
                            <th className="num">
                              Debit<span className="sub">Opening</span>
                            </th>
                            <th className="num">
                              Credit<span className="sub">Opening</span>
                            </th>
                            <th className="num">
                              Debits<span className="sub">In period</span>
                            </th>
                            <th className="num">
                              Credits<span className="sub">In period</span>
                            </th>
                            <th className="num">
                              Debit<span className="sub">Closing</span>
                            </th>
                            <th className="num">
                              Credit<span className="sub">Closing</span>
                            </th>
                          </>
                        ) : (
                          <>
                            <th className="num" style={{ width: 140 }}>
                              Debit{comparative && <span className="sub">{calendarDate(asOf)}</span>}
                            </th>
                            <th className="num" style={{ width: 140 }}>
                              Credit{comparative && <span className="sub">{calendarDate(asOf)}</span>}
                            </th>
                          </>
                        )}
                        {comparative && (
                          <>
                            <th className="num" style={{ width: 140 }}>
                              Debit<span className="sub">{calendarDate(compareAsOf)}</span>
                            </th>
                            <th className="num" style={{ width: 140 }}>
                              Credit<span className="sub">{calendarDate(compareAsOf)}</span>
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <Fragment key={g.type}>
                          <tr className="group-row">
                            <td colSpan={cols}>{TYPE_LABELS[g.type]}</td>
                          </tr>
                          {g.rows.map((r) => (
                            <tr key={r.accountId} className="clickable" onClick={() => navigate(`/ledger?account=${r.accountId}${columns && d.from ? `&from=${d.from.slice(0, 10)}&to=${asOf}` : ""}`)}>
                              <td className="mono muted">{r.code}</td>
                              <td>{r.name}</td>
                              {numberCells(r, true)}
                            </tr>
                          ))}
                          <tr className="subtotal">
                            <td />
                            <td>Total {TYPE_LABELS[g.type].toLowerCase()}</td>
                            {numberCells(g)}
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td />
                        <td>Total</td>
                        {columns && d.totals ? (
                          <>
                            <td className="num">{amount(d.totals.openingDebit)}</td>
                            <td className="num">{amount(d.totals.openingCredit)}</td>
                            <td className="num">{amount(d.totals.movementDebit)}</td>
                            <td className="num">{amount(d.totals.movementCredit)}</td>
                          </>
                        ) : null}
                        <td className="num">{amount(d.debit)}</td>
                        <td className="num">{amount(d.credit)}</td>
                        {comparative && (
                          <>
                            <td className="num">{amount(priorDebit)}</td>
                            <td className="num">{amount(priorCredit)}</td>
                          </>
                        )}
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
          );
        }}
      </Loadable>
    </>
  );
}

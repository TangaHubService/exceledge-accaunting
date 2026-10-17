import { Printer } from "lucide-react";
import type { CSSProperties } from "react";
import { ExportButtons } from "../components/ExportButtons";
import { EmptyState, Field, Figure, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, calendarDate, date, isoDay } from "../lib/format";
import { Link, setQueryParam, useLocation } from "../lib/router";
import { useResource } from "../lib/session";

type Line = { accountId?: string; code: string; name: string; amount: number; comparative: number; classification?: "CURRENT" | "NON_CURRENT" };
type IncomeTotals = { totalRevenue: number; totalCostOfSales: number; grossProfit: number; totalExpenses: number; profit: number };
type PositionTotals = {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanced: boolean;
  totals: { currentAssets: number; nonCurrentAssets: number; currentLiabilities: number; nonCurrentLiabilities: number };
};
type CashFlow = { operating: number; investing: number; financing: number; netChange: number; cashChange: number; depreciation: number; profit: number };
type Ratios = { currentRatio: number | null; grossMargin: number | null; netMargin: number | null; debtToEquity: number | null };
type EquityStatement = {
  from: string;
  to: string;
  components: Array<{ key: string; code: string; name: string }>;
  rows: Array<{ key: string; label: string; amounts: Record<string, number>; total: number }>;
  reconciles: boolean;
};

type StatementPack = {
  from: string;
  to: string;
  financialYear: { name: string; start: string; end: string };
  income: IncomeTotals & { revenue: Line[]; costOfSales: Line[]; operatingExpenses: Line[]; otherExpenses: Line[] };
  position: PositionTotals & { equity: Line[]; currentAssets: Line[]; nonCurrentAssets: Line[]; currentLiabilities: Line[]; nonCurrentLiabilities: Line[] };
  earnings: { retainedEarnings: number; currentYearEarnings: number };
  equityStatement: EquityStatement;
  cashFlow: CashFlow;
  ratios: Ratios;
  notes: { basis: string[]; policies: Array<{ title: string; text: string }>; items: Array<{ ref: number; title: string; lines: Line[]; total: number; comparative: number }> };
  comparative: { from: string; to: string; income: IncomeTotals; position: PositionTotals; equityStatement: EquityStatement; cashFlow: CashFlow; ratios: Ratios };
};

const TABS = [
  { key: "income", label: "Income statement" },
  { key: "position", label: "Financial position" },
  { key: "equity", label: "Changes in equity" },
  { key: "cashflow", label: "Cash flow" },
  { key: "notes", label: "Notes" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const percent = (n: number | null) => (n == null ? "—" : `${amount(n * 100, 1)}%`);
const ratio = (n: number | null) => (n == null ? "—" : amount(n, 2));
const cell = (n: number) => (Math.abs(n) > 0.005 ? amount(n) : "–");

function Lines({ title, rows }: { title: string; rows: Line[] }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={4}>{title}</td>
      </tr>
      {rows.length === 0 ? (
        <tr>
          <td />
          <td className="muted">Nothing posted</td>
          <td />
          <td />
        </tr>
      ) : (
        rows.map((r) => (
          <tr key={r.code + r.name}>
            <td className="mono muted">{r.code}</td>
            <td>{r.accountId ? <Link to={`/ledger?account=${r.accountId}`}>{r.name}</Link> : r.name}</td>
            <td className="num">{cell(r.amount)}</td>
            <td className="num muted">{cell(r.comparative)}</td>
          </tr>
        ))
      )}
    </>
  );
}

function Total({ label, value, comparative, strong }: { label: string; value: number; comparative: number; strong?: boolean }) {
  return (
    <tr className="subtotal" style={strong ? { fontWeight: 700 } : undefined}>
      <td />
      <td>{label}</td>
      <td className="num">{amount(value)}</td>
      <td className="num">{amount(comparative)}</td>
    </tr>
  );
}

function Head({ current, prior }: { current: string; prior: string }) {
  return (
    <thead>
      <tr>
        <th style={{ width: 90 }}>Code</th>
        <th>Line</th>
        <th className="num" style={{ width: 150 }}>
          {current}
        </th>
        <th className="num" style={{ width: 150 }}>
          {prior}
        </th>
      </tr>
    </thead>
  );
}

function EquityTable({ e }: { e: EquityStatement }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th />
            {e.components.map((c) => (
              <th key={c.key} className="num">
                {c.name}
                <span className="sub">{c.code}</span>
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {e.rows.map((r) => (
            <tr key={r.key} className={r.key === "OPENING" || r.key === "CLOSING" ? "subtotal" : undefined}>
              <td>{r.label}</td>
              {e.components.map((c) => (
                <td key={c.key} className="num">
                  {cell(r.amounts[c.key] ?? 0)}
                </td>
              ))}
              <td className="num strong">{amount(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Statements() {
  const { name, tin, currency } = useCompany();
  const { query } = useLocation();
  const tab = (TABS.find((t) => t.key === query.get("tab"))?.key ?? "income") as Tab;
  const to = query.get("to") || isoDay();
  const from = query.get("from") ?? "";
  const compareFrom = query.get("compareFrom") ?? "";
  const compareTo = query.get("compareTo") ?? "";

  const params = new URLSearchParams({ to });
  if (from) params.set("from", from);
  if (compareFrom) params.set("compareFrom", compareFrom);
  if (compareTo) params.set("compareTo", compareTo);
  const pack = useResource<StatementPack>(`/api/v1/books/statements?${params}`);

  return (
    <>
      <PageHeader
        title="Financial statements"
        description="Profit for the period, financial position, changes in equity, cash flow and notes from posted journals, with comparatives."
        actions={
          <>
            <ExportButtons path={`/api/v1/books/statements?${params}&statement=${tab}`} filename={`${tab}-${to}`} />
            <button type="button" className="btn" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" />
              Print
            </button>
          </>
        }
      />

      <div className="filter-bar no-print" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="From" hint="Blank: start of the financial year">
          <input className="input" type="date" value={from} max={to} onChange={(e) => setQueryParam("from", e.target.value || null)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setQueryParam("to", e.target.value || null)} />
        </Field>
        <Field label="Compare from" hint="Blank: same dates a year earlier">
          <input className="input" type="date" value={compareFrom} max={compareTo || undefined} onChange={(e) => setQueryParam("compareFrom", e.target.value || null)} />
        </Field>
        <Field label="Compare to">
          <input className="input" type="date" value={compareTo} min={compareFrom || undefined} onChange={(e) => setQueryParam("compareTo", e.target.value || null)} />
        </Field>
      </div>

      <Loadable resource={pack}>
        {(d) => {
          const current = calendarDate(d.to);
          const prior = calendarDate(d.comparative.to);
          const range = `${calendarDate(d.from)} to ${calendarDate(d.to)}`;
          const priorRange = `${calendarDate(d.comparative.from)} to ${calendarDate(d.comparative.to)}`;
          const reconciled = Math.abs(d.cashFlow.netChange - d.cashFlow.cashChange) < 0.5;
          const c = d.comparative;
          return (
            <>
              <section className="figures" aria-label="Headline figures" style={{ "--cols": 4, marginBottom: 16 } as CSSProperties}>
                <Figure lead label="Profit for the period" currency={currency} value={amount(d.income.profit)} tone={d.income.profit < 0 ? "negative" : undefined} note={`Comparative ${amount(c.income.profit)}`} />
                <Figure label="Total assets" currency={currency} value={amount(d.position.totalAssets)} note={`Comparative ${amount(c.position.totalAssets)}`} />
                <Figure label="Net margin" value={percent(d.ratios.netMargin)} note={`Gross margin ${percent(d.ratios.grossMargin)}`} />
                <Figure label="Current ratio" value={ratio(d.ratios.currentRatio)} note={`Debt to equity ${ratio(d.ratios.debtToEquity)}`} />
              </section>

              <div className="tabs section no-print" role="tablist">
                {TABS.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "on" : ""}`} onClick={() => setQueryParam("tab", t.key === "income" ? null : t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="report">
                <div className="report-head">
                  <div className="company">{name}</div>
                  <div className="title">{TABS.find((t) => t.key === tab)?.label}</div>
                  <div className="period">
                    {tab === "position" ? `As at ${current}, compared with ${prior}` : `${range}, compared with ${priorRange}`} · Amounts in {currency}
                    {tin && ` · TIN ${tin}`}
                  </div>
                </div>

                {tab === "income" && (
                  <table className="table">
                    <Head current={range} prior={priorRange} />
                    <tbody>
                      <Lines title="Revenue and other income" rows={d.income.revenue} />
                      <Total label="Total revenue" value={d.income.totalRevenue} comparative={c.income.totalRevenue} />
                      <Lines title="Cost of sales" rows={d.income.costOfSales} />
                      <Total label="Gross profit" value={d.income.grossProfit} comparative={c.income.grossProfit} />
                      <Lines title="Operating expenses" rows={d.income.operatingExpenses} />
                      {d.income.otherExpenses.length > 0 && <Lines title="Other expenses" rows={d.income.otherExpenses} />}
                      <Total label="Total costs and expenses" value={d.income.totalExpenses} comparative={c.income.totalExpenses} />
                    </tbody>
                    <tfoot>
                      <tr>
                        <td />
                        <td>Profit for the period</td>
                        <td className="num">{amount(d.income.profit)}</td>
                        <td className="num">{amount(c.income.profit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {tab === "position" && (
                  <>
                    <table className="table">
                      <Head current={current} prior={prior} />
                      <tbody>
                        <Lines title="Non-current assets" rows={d.position.nonCurrentAssets} />
                        <Total label="Total non-current assets" value={d.position.totals.nonCurrentAssets} comparative={c.position.totals.nonCurrentAssets} />
                        <Lines title="Current assets" rows={d.position.currentAssets} />
                        <Total label="Total current assets" value={d.position.totals.currentAssets} comparative={c.position.totals.currentAssets} />
                        <Total label="Total assets" value={d.position.totalAssets} comparative={c.position.totalAssets} strong />
                        <Lines title="Non-current liabilities" rows={d.position.nonCurrentLiabilities} />
                        <Total label="Total non-current liabilities" value={d.position.totals.nonCurrentLiabilities} comparative={c.position.totals.nonCurrentLiabilities} />
                        <Lines title="Current liabilities" rows={d.position.currentLiabilities} />
                        <Total label="Total current liabilities" value={d.position.totals.currentLiabilities} comparative={c.position.totals.currentLiabilities} />
                        <Total label="Total liabilities" value={d.position.totalLiabilities} comparative={c.position.totalLiabilities} strong />
                        <Lines title="Equity" rows={d.position.equity} />
                        <Total label="Total equity" value={d.position.totalEquity} comparative={c.position.totalEquity} strong />
                      </tbody>
                      <tfoot>
                        <tr>
                          <td />
                          <td>Liabilities and equity</td>
                          <td className="num">{amount(d.position.totalLiabilities + d.position.totalEquity)}</td>
                          <td className="num">{amount(c.position.totalLiabilities + c.position.totalEquity)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="report-foot">
                      <span className={d.position.balanced && c.position.balanced ? undefined : "text-negative strong"}>
                        {d.position.balanced && c.position.balanced ? "Assets equal liabilities plus equity." : "Assets do not equal liabilities plus equity. Review the trial balance."}
                      </span>
                      <span>
                        Retained earnings {amount(d.earnings.retainedEarnings)} · current year earnings {amount(d.earnings.currentYearEarnings)}
                      </span>
                    </div>
                  </>
                )}

                {tab === "equity" && (
                  <>
                    <EquityTable e={d.equityStatement} />
                    <div className="report-foot">
                      <span className={d.equityStatement.reconciles ? undefined : "text-negative strong"}>
                        {d.equityStatement.reconciles ? "Closing equity agrees with the statement of financial position." : "Closing equity does not agree with the statement of financial position."}
                      </span>
                    </div>
                    <h3 className="section-title" style={{ margin: "16px 0 8px" }}>
                      Comparative: {priorRange}
                    </h3>
                    <EquityTable e={c.equityStatement} />
                  </>
                )}

                {tab === "cashflow" && (
                  <>
                    <table className="table">
                      <thead>
                        <tr>
                          <th />
                          <th className="num" style={{ width: 150 }}>
                            {range}
                          </th>
                          <th className="num" style={{ width: 150 }}>
                            {priorRange}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Profit for the period", (f: CashFlow) => f.profit, false],
                            ["Add back depreciation", (f: CashFlow) => f.depreciation, false],
                            ["Working capital movements", (f: CashFlow) => f.operating - f.profit - f.depreciation, false],
                            ["Cash from operating activities", (f: CashFlow) => f.operating, true],
                            ["Cash from investing activities", (f: CashFlow) => f.investing, true],
                            ["Cash from financing activities", (f: CashFlow) => f.financing, true],
                          ] as const
                        ).map(([label, pick, sub]) => (
                          <tr key={label} className={sub ? "subtotal" : undefined}>
                            <td>{label}</td>
                            <td className="num">{amount(pick(d.cashFlow))}</td>
                            <td className="num">{amount(pick(c.cashFlow))}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Net change in cash and bank</td>
                          <td className="num">{amount(d.cashFlow.netChange)}</td>
                          <td className="num">{amount(c.cashFlow.netChange)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="report-foot">
                      <span className={reconciled ? undefined : "text-negative strong"}>
                        {reconciled
                          ? `Agrees with the movement on cash and bank accounts (${amount(d.cashFlow.cashChange)}).`
                          : `Cash and bank accounts moved by ${amount(d.cashFlow.cashChange)}. The difference needs review.`}
                      </span>
                    </div>
                  </>
                )}

                {tab === "notes" && (
                  <div className="panel-body">
                    <h3 className="section-title">Basis of preparation</h3>
                    {d.notes.basis.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    <h3 className="section-title" style={{ marginTop: 16 }}>
                      Accounting policies
                    </h3>
                    {d.notes.policies.length === 0 ? (
                      <p className="muted">No policies recorded. Add them under Company setup, accounting policies.</p>
                    ) : (
                      d.notes.policies.map((p) => (
                        <p key={p.title}>
                          <strong>{p.title}.</strong> {p.text}
                        </p>
                      ))
                    )}
                    {d.notes.items.length === 0 ? (
                      <EmptyState title="Nothing posted in this period" />
                    ) : (
                      d.notes.items.map((n) => (
                        <div key={n.ref} style={{ marginTop: 16 }}>
                          <h3 className="section-title">
                            {n.ref}. {n.title}
                          </h3>
                          <table className="table">
                            <Head current={current} prior={prior} />
                            <tbody>
                              {n.lines.map((l) => (
                                <tr key={l.code + l.name}>
                                  <td className="mono muted">{l.code}</td>
                                  <td>{l.name}</td>
                                  <td className="num">{cell(l.amount)}</td>
                                  <td className="num muted">{cell(l.comparative)}</td>
                                </tr>
                              ))}
                              <Total label="Total" value={n.total} comparative={n.comparative} />
                            </tbody>
                          </table>
                        </div>
                      ))
                    )}
                  </div>
                )}
                <div className="report-foot">
                  <span>Financial year {d.financialYear.name}</span>
                  <span>Printed {date(new Date())}</span>
                </div>
              </div>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

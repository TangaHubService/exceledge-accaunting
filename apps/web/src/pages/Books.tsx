import { Plus, Printer } from "lucide-react";
import { type CSSProperties, type FormEvent, Fragment, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Figure, Loadable, PageHeader, type Tone } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, calendarDate, date, dateTime, humanize } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { Account } from "../lib/types";

type Line = { code: string; name: string; amount: number };

type StatementPack = {
  periodStart: string;
  asOf: string;
  income: { revenue: Line[]; expenses: Line[]; totalRevenue: number; totalExpenses: number; profit: number };
  position: { assets: Line[]; liabilities: Line[]; equity: Line[]; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean };
  cashFlow: { operating: number; investing: number; financing: number; netChange: number; cashChange: number; depreciation: number; profit: number };
  ratios: { currentRatio: number | null; grossMargin: number | null; netMargin: number | null; debtToEquity: number | null };
};

const percent = (n: number | null) => (n == null ? "—" : `${amount(n * 100, 1)}%`);
const ratio = (n: number | null) => (n == null ? "—" : amount(n, 2));

function StatementSection({ title, rows, total, totalLabel }: { title: string; rows: Line[]; total: number; totalLabel: string }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={3}>{title}</td>
      </tr>
      {rows.length === 0 ? (
        <tr>
          <td />
          <td className="muted">Nothing posted</td>
          <td />
        </tr>
      ) : (
        rows.map((r) => (
          <tr key={r.code + r.name}>
            <td className="mono muted">{r.code}</td>
            <td>{r.name}</td>
            <td className="num">{amount(r.amount)}</td>
          </tr>
        ))
      )}
      <tr className="subtotal">
        <td />
        <td>{totalLabel}</td>
        <td className="num">{amount(total)}</td>
      </tr>
    </>
  );
}

export function Statements() {
  const { name, tin, currency } = useCompany();
  const pack = useResource<StatementPack>("/api/v1/books/statements");
  return (
    <>
      <PageHeader
        title="Financial statements"
        description="Profit, financial position and cash flow from posted journals."
        actions={
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            Print
          </button>
        }
      />
      <Loadable resource={pack}>
        {(d) => {
          const reconciled = Math.abs(d.cashFlow.netChange - d.cashFlow.cashChange) < 0.5;
          return (
            <>
              <section className="figures" aria-label="Headline figures" style={{ "--cols": 4, marginBottom: 16 } as CSSProperties}>
                <Figure lead label="Profit" currency={currency} value={amount(d.income.profit)} tone={d.income.profit < 0 ? "negative" : undefined} />
                <Figure label="Total assets" currency={currency} value={amount(d.position.totalAssets)} />
                <Figure label="Net margin" value={percent(d.ratios.netMargin)} note={`Gross margin ${percent(d.ratios.grossMargin)}`} />
                <Figure label="Current ratio" value={ratio(d.ratios.currentRatio)} note={`Debt to equity ${ratio(d.ratios.debtToEquity)}`} />
              </section>

              <div className="report" style={{ marginBottom: 16 }}>
                <div className="report-head">
                  <div className="company">{name}</div>
                  <div className="title">Income statement</div>
                  <div className="period">
                    To {date(d.asOf)} · Amounts in {currency}
                    {tin && ` · TIN ${tin}`}
                  </div>
                </div>
                <table className="table">
                  <tbody>
                    <StatementSection title="Revenue" rows={d.income.revenue} total={d.income.totalRevenue} totalLabel="Total revenue" />
                    <StatementSection title="Costs and expenses" rows={d.income.expenses} total={d.income.totalExpenses} totalLabel="Total costs and expenses" />
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Profit</td>
                      <td className="num">{amount(d.income.profit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="report" style={{ marginBottom: 16 }}>
                <div className="report-head">
                  <div className="title">Statement of financial position</div>
                  <div className="period">As at {date(d.asOf)}</div>
                </div>
                <table className="table">
                  <tbody>
                    <StatementSection title="Assets" rows={d.position.assets} total={d.position.totalAssets} totalLabel="Total assets" />
                    <StatementSection title="Liabilities" rows={d.position.liabilities} total={d.position.totalLiabilities} totalLabel="Total liabilities" />
                    <StatementSection title="Equity" rows={d.position.equity} total={d.position.totalEquity} totalLabel="Total equity" />
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td>Liabilities and equity</td>
                      <td className="num">{amount(d.position.totalLiabilities + d.position.totalEquity)}</td>
                    </tr>
                  </tfoot>
                </table>
                <div className="report-foot">
                  <span className={d.position.balanced ? undefined : "text-negative strong"}>
                    {d.position.balanced ? "Assets equal liabilities plus equity." : "Assets do not equal liabilities plus equity. Review the trial balance."}
                  </span>
                </div>
              </div>

              <div className="report">
                <div className="report-head">
                  <div className="title">Cash flow (indirect)</div>
                  <div className="period">
                    {date(d.periodStart)} to {date(d.asOf)}
                  </div>
                </div>
                <table className="table">
                  <tbody>
                    <tr>
                      <td>Profit for the period</td>
                      <td className="num">{amount(d.cashFlow.profit)}</td>
                    </tr>
                    <tr>
                      <td>Add back depreciation</td>
                      <td className="num">{amount(d.cashFlow.depreciation)}</td>
                    </tr>
                    <tr>
                      <td>Working capital movements</td>
                      <td className="num">{amount(d.cashFlow.operating - d.cashFlow.profit - d.cashFlow.depreciation)}</td>
                    </tr>
                    <tr className="subtotal">
                      <td>Cash from operating activities</td>
                      <td className="num">{amount(d.cashFlow.operating)}</td>
                    </tr>
                    <tr className="subtotal">
                      <td>Cash from investing activities</td>
                      <td className="num">{amount(d.cashFlow.investing)}</td>
                    </tr>
                    <tr className="subtotal">
                      <td>Cash from financing activities</td>
                      <td className="num">{amount(d.cashFlow.financing)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Net change in cash and bank</td>
                      <td className="num">{amount(d.cashFlow.netChange)}</td>
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
              </div>
            </>
          );
        }}
      </Loadable>
    </>
  );
}

type Period = { id: string; name: string; sequence: number; startDate: string; endDate: string; status: string; reopenReason: string | null };
type Year = { id: string; name: string; startDate: string; endDate: string; periods: Period[] };
type Checklist = {
  canClose: boolean;
  blockers: string[];
  drafts: number;
  openExceptions: number;
  pendingApprovals: number;
  earlierOpen: number;
  lastOfYear: boolean;
  difference: number;
};

const PERIOD_TONE: Record<string, Tone> = { OPEN: "positive", REOPENED: "warning", CLOSED: "neutral", FUTURE: "neutral", TEMPORARILY_LOCKED: "warning" };

export function PeriodClose() {
  const { can } = useSession();
  const years = useResource<Year[]>("/api/v1/books/periods");
  const [reviewing, setReviewing] = useState<Period | null>(null);
  const [reopening, setReopening] = useState<Period | null>(null);

  return (
    <>
      <PageHeader title="Period close" description="Close a month once the trial balance is clean. Closing the last month of the year moves profit to retained earnings." />
      <Loadable resource={years}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No financial years" body="Set up a financial year in Company setup first." />
            </div>
          ) : (
            rows.map((y) => (
              <div className="table-wrap" key={y.id} style={{ marginBottom: 16 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{y.name}</th>
                      <th>Dates</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {y.periods.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="nowrap">
                          {calendarDate(p.startDate)} – {calendarDate(p.endDate)}
                        </td>
                        <td>
                          <Badge tone={PERIOD_TONE[p.status] ?? "neutral"}>{humanize(p.status)}</Badge>
                          {p.reopenReason && <span className="sub">{p.reopenReason}</span>}
                        </td>
                        <td className="num">
                          {can("close:manage") && (p.status === "OPEN" || p.status === "REOPENED") && (
                            <button type="button" className="btn" onClick={() => setReviewing(p)}>
                              Review close
                            </button>
                          )}
                          {can("close:manage") && p.status === "CLOSED" && (
                            <button type="button" className="btn" onClick={() => setReopening(p)}>
                              Reopen
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )
        }
      </Loadable>
      {reviewing && (
        <CloseDrawer
          period={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            years.reload();
          }}
        />
      )}
      {reopening && (
        <ReopenDrawer
          period={reopening}
          onClose={() => setReopening(null)}
          onDone={() => {
            setReopening(null);
            years.reload();
          }}
        />
      )}
    </>
  );
}

function CloseDrawer({ period, onClose, onDone }: { period: Period; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const { confirm } = useFeedback();
  const check = useResource<Checklist>(`/api/v1/books/close/checklist?periodId=${period.id}`);
  const { busy, error, run } = useSubmit(onDone);
  const lastOfYear = check.data?.lastOfYear ?? false;
  const kind = lastOfYear ? "YEAR" : "MONTH";

  async function close() {
    const ok = await confirm({
      title: lastOfYear ? `Close ${period.name} and the year?` : `Close ${period.name}?`,
      body: lastOfYear
        ? "Profit and loss balances will be moved to retained earnings, and no more journals can be posted to this period."
        : "No more journals can be posted to this period until it is reopened.",
      confirmLabel: lastOfYear ? "Close year" : "Close month",
    });
    if (!ok) return;
    void run(async () => {
      await api("/api/v1/books/close", { method: "POST", body: JSON.stringify({ periodId: period.id, kind }) });
      return `${period.name} closed`;
    });
  }

  return (
    <Drawer
      title={`Close ${period.name}`}
      subtitle={`${calendarDate(period.startDate)} – ${calendarDate(period.endDate)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !check.data?.canClose} onClick={() => void close()}>
            {busy ? "Closing…" : lastOfYear ? "Close year" : "Close month"}
          </button>
        </>
      }
    >
      <FormError message={error} />
      <Loadable resource={check}>
        {(c) => (
          <>
            <div className={`notice ${c.canClose ? "info" : "error"}`} role="status">
              {c.canClose ? "Everything is in place to close this period." : "Fix these before closing:"}
            </div>
            <table className="table" style={{ marginTop: 16 }}>
              <tbody>
                <tr>
                  <td>Earlier periods still open</td>
                  <td className="num">{c.earlierOpen}</td>
                </tr>
                <tr>
                  <td>Draft journals in the period</td>
                  <td className="num">{c.drafts}</td>
                </tr>
                <tr>
                  <td>Open posting exceptions</td>
                  <td className="num">{c.openExceptions}</td>
                </tr>
                <tr>
                  <td>Approvals waiting</td>
                  <td className="num">{c.pendingApprovals}</td>
                </tr>
                <tr>
                  <td>Trial balance difference</td>
                  <td className="num">{amount(c.difference)}</td>
                </tr>
              </tbody>
            </table>
            {c.blockers.length > 0 && (
              <ul style={{ marginTop: 12 }}>
                {c.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

function ReopenDrawer({ period, onClose, onDone }: { period: Period; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSubmit(onDone);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/books/close/reopen", { method: "POST", body: JSON.stringify({ periodId: period.id, reason: reason.trim() }) });
      return `${period.name} reopened`;
    });
  }
  return (
    <Drawer title={`Reopen ${period.name}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Reopen" formId="reopen-form" />}>
      <FormError message={error} />
      <form id="reopen-form" onSubmit={submit}>
        <Field label="Reason" required hint="Recorded in the audit log.">
          <textarea className="input" required minLength={3} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Late supplier invoice for January" />
        </Field>
      </form>
    </Drawer>
  );
}

type Budget = { id: string; name: string; status: string; financialYearId: string | null; createdAt: string; lines: { accountId: string; amount: string | number }[] };
type Variance = { budget: { name: string; year: string | null }; rows: { key: string; budget: number; actual: number; variance: number; variancePercent: number | null; favorable: boolean }[] };

const PNL = new Set(["INCOME", "OTHER_INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);

export function Budgets() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const budgets = useResource<Budget[]>("/api/v1/books/budgets");
  const [creating, setCreating] = useState(false);
  const [variance, setVariance] = useState<Budget | null>(null);

  async function approve(b: Budget) {
    try {
      await api(`/api/v1/books/budgets/${b.id}/approve`, { method: "POST", body: "{}" });
      toast(`${b.name} approved`);
      budgets.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Plan income and spending by account, approve the plan, then compare it with what was posted."
        actions={
          can("budget:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              New budget
            </button>
          )
        }
      />
      <Loadable resource={budgets}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No budgets yet" body="Create a budget to compare planned and actual income and spending." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Budget</th>
                    <th className="num">Lines</th>
                    <th className="num">Total ({currency})</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.name}
                        <span className="sub">Created {date(b.createdAt)}</span>
                      </td>
                      <td className="num">{b.lines.length}</td>
                      <td className="num">{amount(b.lines.reduce((s, l) => s + Number(l.amount), 0))}</td>
                      <td>
                        <Badge tone={b.status === "APPROVED" ? "positive" : "neutral"}>{humanize(b.status)}</Badge>
                      </td>
                      <td className="num nowrap">
                        <button type="button" className="btn" onClick={() => setVariance(b)}>
                          Budget vs actual
                        </button>{" "}
                        {b.status === "DRAFT" && can("budget:manage") && (
                          <button type="button" className="btn" onClick={() => void approve(b)}>
                            Approve
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
      {creating && (
        <BudgetForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            budgets.reload();
          }}
        />
      )}
      {variance && <VarianceDrawer budget={variance} onClose={() => setVariance(null)} />}
    </>
  );
}

function BudgetForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const accounts = useResource<Account[]>("/api/v1/coa");
  const years = useResource<Year[]>("/api/v1/books/periods");
  const [name, setName] = useState("");
  const [yearId, setYearId] = useState("");
  const [lines, setLines] = useState([{ accountId: "", amount: "" }]);
  const { busy, error, setError, run } = useSubmit(onSaved);

  const options = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a) => a.isActive && PNL.has(a.type))
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: humanize(a.type) })),
    [accounts.data],
  );

  function update(i: number, patch: Partial<{ accountId: string; amount: string }>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, amount: parseAmount(l.amount) }));
    if (!name.trim()) return setError("Give the budget a name.");
    if (parsed.length === 0) return setError("Add at least one account.");
    if (parsed.some((l) => !(l.amount > 0))) return setError("Every line needs an amount above zero.");
    void run(async () => {
      await api("/api/v1/books/budgets", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), financialYearId: yearId || undefined, lines: parsed }),
      });
      return "Budget saved as draft";
    });
  }

  return (
    <Drawer title="New budget" wide onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save draft" formId="budget-form" />}>
      <FormError message={error} />
      <form id="budget-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="FY 2026 operating budget" />
        </Field>
        <Field label="Financial year" hint="Actuals are taken from this year.">
          <Select
            value={yearId}
            onChange={setYearId}
            options={[{ value: "", label: "Current year" }, ...(years.data ?? []).map((y) => ({ value: y.id, label: y.name }))]}
          />
        </Field>
        <div className="span-2">
          <table className="table lines-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num" style={{ width: 200 }}>
                  Annual amount
                </th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <Select value={l.accountId} onChange={(v) => update(i, { accountId: v })} options={options} placeholder="Choose an income or expense account" aria-label={`Account for line ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={l.amount} onChange={(v) => update(i, { amount: v })} aria-label={`Amount for line ${i + 1}`} />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="icon-button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setLines((ls) => [...ls, { accountId: "", amount: "" }])}>
            <Plus size={16} aria-hidden="true" />
            Add line
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function VarianceDrawer({ budget, onClose }: { budget: Budget; onClose: () => void }) {
  const { currency } = useCompany();
  const report = useResource<Variance>(`/api/v1/books/budgets/${budget.id}/variance`);
  return (
    <Drawer title={`${budget.name}: budget vs actual`} subtitle={`Amounts in ${currency}`} wide onClose={onClose}>
      <Loadable resource={report}>
        {(r) => (
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Budget</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.key}</td>
                  <td className="num">{amount(row.budget)}</td>
                  <td className="num">{amount(row.actual)}</td>
                  <td className={`num ${row.favorable ? "text-positive" : "text-negative"}`}>
                    {amount(row.variance)}
                    {row.variancePercent != null && <span className="sub">{percent(row.variancePercent)}</span>}
                  </td>
                  <td>
                    <Badge tone={row.favorable ? "positive" : "negative"}>{row.favorable ? "Favourable" : "Unfavourable"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
    </Drawer>
  );
}

type Rate = { id: string; currency: string; rate: string; rateDate: string; source: string | null };

export function Currencies() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const company = useCompany();
  const rates = useResource<Rate[]>("/api/v1/books/fx/rates");
  const [adding, setAdding] = useState(false);

  const latest = useMemo(() => {
    const seen = new Map<string, Rate>();
    for (const r of rates.data ?? []) if (!seen.has(r.currency)) seen.set(r.currency, r);
    return [...seen.values()];
  }, [rates.data]);

  async function revalue(code: string) {
    const ok = await confirm({
      title: `Revalue ${code} balances?`,
      body: "Accounts held in this currency are restated at the latest rate, and the gain or loss is posted to the ledger.",
      confirmLabel: "Revalue",
    });
    if (!ok) return;
    try {
      const res = await api<{ gainLoss?: string | number }>("/api/v1/books/fx/revalue", { method: "POST", body: JSON.stringify({ currency: code }) });
      const gl = Number(res.gainLoss ?? 0);
      toast(gl === 0 ? `No ${code} balances needed revaluing` : `${code} revalued: ${gl > 0 ? "gain" : "loss"} of ${amount(Math.abs(gl))} ${company.currency}`);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Currencies"
        description={`Exchange rates against ${company.currency}. Revaluation restates accounts held in a foreign currency.`}
        actions={
          can("fx:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              Add rate
            </button>
          )
        }
      />
      <Loadable resource={rates}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No exchange rates" body="Add a closing rate for each foreign currency you hold." />
            </div>
          ) : (
            <>
              <div className="table-wrap" style={{ marginBottom: 16 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th className="num">Latest rate</th>
                      <th>Rate date</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((r) => (
                      <tr key={r.currency}>
                        <td>{r.currency}</td>
                        <td className="num">{amount(Number(r.rate), 4)}</td>
                        <td>{date(r.rateDate)}</td>
                        <td className="num">
                          {can("fx:manage") && (
                            <button type="button" className="btn" onClick={() => void revalue(r.currency)}>
                              Revalue
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className="section-title" style={{ marginBottom: 8 }}>
                Rate history
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Currency</th>
                      <th className="num">Rate</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{date(r.rateDate)}</td>
                        <td>{r.currency}</td>
                        <td className="num">{amount(Number(r.rate), 4)}</td>
                        <td>{r.source ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </Loadable>
      {adding && (
        <RateForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            rates.reload();
          }}
        />
      )}
    </>
  );
}

function RateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency: functional } = useCompany();
  const [form, setForm] = useState({ currency: "USD", rateDate: new Date().toISOString().slice(0, 10), rate: "", source: "BNR" });
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const rate = parseAmount(form.rate);
    if (!/^[A-Z]{3}$/.test(form.currency)) return setError("Use a three-letter currency code such as USD.");
    if (form.currency === functional) return setError(`${functional} is the reporting currency and has no rate.`);
    if (!(rate > 0)) return setError("Enter a rate above zero.");
    void run(async () => {
      await api("/api/v1/books/fx/rates", { method: "POST", body: JSON.stringify({ ...form, rate }) });
      return `${form.currency} rate saved`;
    });
  }
  return (
    <Drawer title="Add exchange rate" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save rate" formId="rate-form" />}>
      <FormError message={error} />
      <form id="rate-form" onSubmit={submit} className="form-grid">
        <Field label="Currency" required>
          <input className="input" required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Rate date" required>
          <input className="input" type="date" required value={form.rateDate} onChange={(e) => setForm({ ...form, rateDate: e.target.value })} />
        </Field>
        <Field label={`1 ${form.currency || "unit"} in ${functional}`} required>
          <MoneyInput value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} required />
        </Field>
        <Field label="Source">
          <input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </Field>
      </form>
    </Drawer>
  );
}

type Control = { id: string; code: string; title: string; category: string; status: string; notes: string | null; updatedAt: string };
type Approval = { id: string; entityType: string; entityId: string; amount: string; status: string; reason: string | null; requestedByErpUserId: number | null; createdAt: string };

const CONTROL_TONE: Record<string, Tone> = { EFFECTIVE: "positive", DEFICIENT: "negative", OPEN: "warning" };

export function Controls() {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const controls = useResource<Control[]>("/api/v1/books/controls");
  const approvals = useResource<Approval[]>("/api/v1/books/approvals");
  const [editing, setEditing] = useState<Control | "new" | null>(null);

  async function decide(a: Approval, status: "APPROVED" | "REJECTED") {
    try {
      await api(`/api/v1/books/approvals/${a.id}/decide`, { method: "POST", body: JSON.stringify({ status }) });
      toast(status === "APPROVED" ? "Approved" : "Rejected");
      approvals.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Controls and approvals"
        description="Keep a register of internal controls and decide pending approvals. The person who asked for an approval cannot give it."
        actions={
          can("control:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" />
              Add control
            </button>
          )
        }
      />
      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Control register
      </h2>
      <Loadable resource={controls}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel" style={{ marginBottom: 20 }}>
              <EmptyState title="No controls recorded" body="Record checks such as segregation of duties or monthly bank reconciliation, and rate how well they work." />
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Control</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.code}</td>
                      <td>
                        {c.title}
                        {c.notes && <span className="sub">{c.notes}</span>}
                      </td>
                      <td>{c.category}</td>
                      <td>
                        <Badge tone={CONTROL_TONE[c.status] ?? "neutral"}>{humanize(c.status)}</Badge>
                      </td>
                      <td className="num">
                        {can("control:manage") && (
                          <button type="button" className="btn" onClick={() => setEditing(c)}>
                            Update
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
      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Approvals
      </h2>
      <Loadable resource={approvals}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="Nothing waiting for approval" />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Item</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">
                        {dateTime(a.createdAt)}
                        {a.requestedByErpUserId && <span className="sub">User #{a.requestedByErpUserId}</span>}
                      </td>
                      <td>
                        {humanize(a.entityType)} {a.entityId}
                        {a.reason && <span className="sub">{a.reason}</span>}
                      </td>
                      <td className="num">{amount(Number(a.amount))}</td>
                      <td>
                        <Badge tone={a.status === "APPROVED" ? "positive" : a.status === "REJECTED" ? "negative" : "warning"}>{humanize(a.status)}</Badge>
                      </td>
                      <td className="num nowrap">
                        {a.status === "PENDING" && can("control:manage") && (
                          <>
                            <button type="button" className="btn" onClick={() => void decide(a, "APPROVED")}>
                              Approve
                            </button>{" "}
                            <button type="button" className="btn" onClick={() => void decide(a, "REJECTED")}>
                              Reject
                            </button>
                          </>
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
      {editing && (
        <ControlForm
          control={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            controls.reload();
          }}
        />
      )}
    </>
  );
}

function ControlForm({ control, onClose, onSaved }: { control?: Control; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({
    code: control?.code ?? "",
    title: control?.title ?? "",
    category: control?.category ?? "",
    status: control?.status ?? "OPEN",
    notes: control?.notes ?? "",
  });
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/books/controls", {
        method: "POST",
        body: JSON.stringify({ ...form, code: form.code.trim(), title: form.title.trim(), category: form.category.trim(), notes: form.notes.trim() || undefined }),
      });
      return "Control saved";
    });
  }
  return (
    <Drawer title={control ? `Update ${control.code}` : "Add control"} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="control-form" />}>
      <FormError message={error} />
      <form id="control-form" onSubmit={submit} className="form-grid">
        <Field label="Code" required>
          <input className="input" required disabled={!!control} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BANK-01" />
        </Field>
        <Field label="Area" required>
          <input className="input" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Banking" />
        </Field>
        <Field label="Control" required className="span-2">
          <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Bank accounts are reconciled every month" />
        </Field>
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
            options={[
              { value: "OPEN", label: "Not yet tested" },
              { value: "EFFECTIVE", label: "Effective" },
              { value: "DEFICIENT", label: "Deficient" },
            ]}
          />
        </Field>
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </form>
    </Drawer>
  );
}

type Notice = { id: string; title: string; body: string; severity: string; readAt: string | null; createdAt: string };
type Group = { id: string; name: string; members: { id: string; name: string; ownershipPercent: string }[] };
type ApiKey = { id: string; name: string; prefix: string; revokedAt: string | null; createdAt: string };
type Forecast = { name: string; horizonMonths: number; resultJson: { months?: string[]; history: number[]; forecast: number[] } };

const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function monthsAfter(last: string | undefined, count: number): string[] {
  const [y, m] = (last ?? new Date().toISOString().slice(0, 7)).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => monthLabel.format(new Date(Date.UTC(y, m + i, 1))));
}
type Consolidated = { rows: { code: string; name: string; debit: number; credit: number }[]; totals: { debit: number; credit: number; difference: number } };

export function Platform() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const notes = useResource<Notice[]>("/api/v1/books/notifications");
  const groups = useResource<Group[]>("/api/v1/books/groups");
  const keys = useResource<ApiKey[]>(can("platform:manage") ? "/api/v1/books/api-keys" : null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; token: string } | null>(null);
  const [consolidated, setConsolidated] = useState<{ group: Group; data: Consolidated } | null>(null);

  async function act<T>(fn: () => Promise<T>, onOk: (v: T) => void) {
    try {
      onOk(await fn());
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader title="Insights and integrations" description="Ask questions of the posted books, forecast profit, manage alerts, groups and API keys." />

      <div className="panel panel-body" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Ask the books</h2>
        <p className="muted" style={{ margin: "4px 0 12px" }}>
          Answers come from posted totals for profit, cash, receivables and payables.
        </p>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            if (!question.trim()) return;
            setAsking(true);
            void act(
              () => api<{ answer: string }>("/api/v1/books/assistant", { method: "POST", body: JSON.stringify({ question: question.trim() }) }),
              (r) => setAnswer(r.answer),
            ).finally(() => setAsking(false));
          }}
        >
          <input className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How much cash do we have?" aria-label="Question" />
          <button className="btn btn-primary" type="submit" disabled={asking}>
            {asking ? "Asking…" : "Ask"}
          </button>
        </form>
        {answer && <div className="notice info">{answer}</div>}
      </div>

      <div className="panel panel-body" style={{ marginBottom: 16 }}>
        <div className="filter-bar">
          <h2 className="section-title grow">Profit forecast</h2>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void act(
                () => api<Forecast>("/api/v1/books/forecast", { method: "POST", body: JSON.stringify({ name: "Next 3 months", horizonMonths: 3 }) }),
                setForecast,
              )
            }
          >
            Forecast next 3 months
          </button>
        </div>
        {!forecast ? (
          <p className="muted">A straight-line trend of monthly profit from posted journals.</p>
        ) : forecast.resultJson.history.length < 2 ? (
          <p className="muted">At least two completed months of posted income and expenses are needed for a trend.</p>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 8 }}>
              Based on {forecast.resultJson.history.length} completed months of posted profit, including months with no activity.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Projected profit ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {monthsAfter(forecast.resultJson.months?.at(-1), forecast.resultJson.forecast.length).map((label, i) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num">{amount(forecast.resultJson.forecast[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="panel panel-body" style={{ marginBottom: 16 }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Alerts
        </h2>
        <Loadable resource={notes}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No alerts.</p>
            ) : (
              <table className="table">
                <tbody>
                  {rows.map((n) => (
                    <tr key={n.id} className={n.readAt ? "row-inactive" : undefined}>
                      <td className="nowrap">{dateTime(n.createdAt)}</td>
                      <td>
                        <strong>{n.title}</strong>
                        <span className="sub">{n.body}</span>
                      </td>
                      <td className="num">
                        {!n.readAt && (
                          <button type="button" className="btn" onClick={() => void act(() => api(`/api/v1/books/notifications/${n.id}/read`, { method: "POST", body: "{}" }), () => notes.reload())}>
                            Mark read
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loadable>
      </div>

      <div className="panel panel-body" style={{ marginBottom: 16 }}>
        <div className="filter-bar">
          <h2 className="section-title grow">Company groups</h2>
          {can("platform:manage") && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void act(
                  () => api("/api/v1/books/groups", { method: "POST", body: JSON.stringify({ name: "Group", members: [{ name: "This company", ownershipPercent: 100 }] }) }),
                  () => groups.reload(),
                )
              }
            >
              <Plus size={16} aria-hidden="true" />
              New group
            </button>
          )}
        </div>
        <Loadable resource={groups}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No groups. A group combines the books of related companies by ownership share.</p>
            ) : (
              <table className="table">
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id}>
                      <td>
                        {g.name}
                        <span className="sub">{g.members.map((m) => `${m.name} (${amount(Number(m.ownershipPercent))}%)`).join(", ")}</span>
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void act(() => api<Consolidated>(`/api/v1/books/groups/${g.id}/consolidate`), (data) => setConsolidated({ group: g, data }))}
                        >
                          Consolidated trial balance
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loadable>
      </div>

      {can("platform:manage") && (
        <div className="panel panel-body">
          <div className="filter-bar">
            <h2 className="section-title grow">API keys</h2>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void act(
                  () => api<{ name: string; token: string }>("/api/v1/books/api-keys", { method: "POST", body: JSON.stringify({ name: "Integration" }) }),
                  (k) => {
                    setNewKey(k);
                    keys.reload();
                  },
                )
              }
            >
              <Plus size={16} aria-hidden="true" />
              Issue key
            </button>
          </div>
          {newKey && (
            <div className="notice info" style={{ marginBottom: 12 }}>
              Copy this key now. It will not be shown again: <code className="mono">{newKey.token}</code>
            </div>
          )}
          <Loadable resource={keys}>
            {(rows) =>
              rows.length === 0 ? (
                <p className="muted">No API keys issued.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {rows.map((k) => (
                      <tr key={k.id} className={k.revokedAt ? "row-inactive" : undefined}>
                        <td>
                          {k.name}
                          <span className="sub mono">{k.prefix}…</span>
                        </td>
                        <td>{k.revokedAt ? `Revoked ${date(k.revokedAt)}` : `Issued ${date(k.createdAt)}`}</td>
                        <td className="num">
                          {!k.revokedAt && (
                            <button
                              type="button"
                              className="btn"
                              onClick={async () => {
                                if (!(await confirm({ title: `Revoke ${k.name}?`, body: "Anything using this key will stop working.", confirmLabel: "Revoke", danger: true }))) return;
                                void act(() => api(`/api/v1/books/api-keys/${k.id}/revoke`, { method: "POST", body: "{}" }), () => keys.reload());
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Loadable>
        </div>
      )}

      {consolidated && (
        <Drawer title={`${consolidated.group.name}: consolidated trial balance`} subtitle={`Amounts in ${currency}`} wide onClose={() => setConsolidated(null)}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {consolidated.data.rows.map((r) => (
                <Fragment key={r.code}>
                  <tr>
                    <td className="mono muted">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.debit ? amount(r.debit) : ""}</td>
                    <td className="num">{r.credit ? amount(r.credit) : ""}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Total</td>
                <td className="num">{amount(consolidated.data.totals.debit)}</td>
                <td className="num">{amount(consolidated.data.totals.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </Drawer>
      )}
    </>
  );
}

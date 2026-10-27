import { CheckCircle2, Plus } from "lucide-react";
import { type FormEvent, Fragment, useMemo, useRef, useState } from "react";
import { BudgetEditor as MatrixBudgetEditor } from "../components/budgets/BudgetEditor";
import { BudgetSetupModal } from "../components/budgets/BudgetSetupModal";
import { SpreadsheetSyncModal } from "../components/budgets/SpreadsheetSyncModal";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader, type Tone } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, humanize } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account } from "../lib/types";

type BudgetLine = { id: string; accountId: string; periodSequence: number; amount: string | number; costCentre: string | null; project: string | null; branchId: string | null };
type Budget = {
  id: string;
  name: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "ACTIVE" | "REVISED";
  version: number;
  familyId: string | null;
  financialYearId: string | null;
  createdAt: string;
  activatedAt: string | null;
  lines: BudgetLine[];
};
type BudgetDetail = Budget & { versions: Array<{ id: string; version: number; status: Budget["status"]; createdAt: string; activatedAt: string | null }> };
type Year = { id: string; name: string; periods: Array<{ id: string; name: string; sequence: number }> };
type Dimension = { id: string; kind: "COST_CENTRE" | "PROJECT"; code: string; name: string; isActive: boolean };
type Cell = { sequence: number; budget: number; actual: number; variance: number };
type VarianceRow = {
  key: string;
  accountCode: string | null;
  accountName: string | null;
  kind: "INCOME" | "EXPENSE";
  costCentre: string | null;
  project: string | null;
  branchId: string | null;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  favorable: boolean;
  months: Cell[];
};
type Total = { budget: number; actual: number; variance: number; months: Cell[] };
type Variance = {
  budget: { name: string; version: number; year: string | null };
  periods: Array<{ sequence: number; name: string }>;
  rows: VarianceRow[];
  totals: { income: Total; expense: Total };
};

const PNL = new Set(["INCOME", "OTHER_INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);
const STATUS_TONE: Record<Budget["status"], Tone> = { DRAFT: "neutral", SUBMITTED: "warning", APPROVED: "info", ACTIVE: "positive", REVISED: "neutral" };
const total = (lines: Array<{ amount: string | number }>) => lines.reduce((s, l) => s + Number(l.amount), 0);
const dims = (l: { costCentre: string | null; project: string | null; branchId?: string | null }) =>
  [l.costCentre && `Cost centre ${l.costCentre}`, l.project && `Project ${l.project}`, l.branchId && `Branch ${l.branchId}`].filter(Boolean).join(" · ");

export function Budgets() {
  const { can } = useSession();
  const { currency } = useCompany();
  const { toast } = useFeedback();
  const budgets = useResource<Budget[]>("/api/v1/books/budgets");
  const years = useResource<Year[]>("/api/v1/books/periods");
  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Tools Ribbons Modes: "workspace" (Mockup 78) | "editor" (Mockup 81) | "list"
  const [budgetMode, setBudgetMode] = useState<"workspace" | "editor" | "list">("workspace");
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  const yearName = (id: string | null) => years.data?.find((y) => y.id === id)?.name ?? "—";

  // If in FY26 Matrix Editor mode (Mockup 81)
  if (budgetMode === "editor") {
    return (
      <MatrixBudgetEditor
        onClose={() => setBudgetMode("workspace")}
        onOpenSpreadsheetSync={() => setSyncModalOpen(true)}
      />
    );
  }

  return (
    <div className="ee-budget-workspace">
      {/* Clean full-width budget hero — no inner sub-sidebar */}
      {budgetMode === "workspace" && (
        <div className="ee-budget-hero-wrap">
          {/* Top breadcrumb row */}
          <div className="ee-budget-breadcrumb">
            <span className="ee-budget-bc-section">REPORTS &amp; ANALYTICS</span>
            <span className="ee-budget-bc-sep">›</span>
            <span className="ee-budget-bc-current">Budgets</span>
            {budgets.data && budgets.data.length > 0 && (
              <button
                type="button"
                className="ee-btn-outline"
                style={{ marginLeft: "auto", height: 32, fontSize: 13, padding: "0 14px" }}
                onClick={() => setBudgetMode("list")}
              >
                View all budgets ({budgets.data.length})
              </button>
            )}
          </div>

          {/* Hero card — matches mockup exactly */}
          <div className="ee-budget-hero-card">
            {/* Left: text + CTAs */}
            <div className="ee-budget-hero-body">
              <h1 className="ee-budget-hero-title">
                Plan your finances<br />and stay ahead
              </h1>
              <p className="ee-budget-hero-sub">
                Having visibility into your finances and prioritising expenses will give you the confidence to run your business smoothly.
              </p>

              <a
                href="#learn-more-budgets"
                className="ee-budget-hero-learn"
                onClick={(e) => { e.preventDefault(); toast("Learn more about budgeting documentation."); }}
              >
                Learn more about budgets
              </a>

              <ul className="ee-budget-hero-bullets">
                <li>
                  <CheckCircle2 size={18} strokeWidth={2} />
                  <span>Create budgets using financial data available in Excel Edge ERP.</span>
                </li>
                <li>
                  <CheckCircle2 size={18} strokeWidth={2} />
                  <span>Compare actual performance against budgeted numbers.</span>
                </li>
                <li>
                  <CheckCircle2 size={18} strokeWidth={2} />
                  <span>Use spreadsheets and sync changes back to Excel Edge ERP.</span>
                </li>
              </ul>

              <div className="ee-budget-hero-actions">
                <button
                  type="button"
                  className="ee-btn-blue"
                  onClick={() => setSetupModalOpen(true)}
                >
                  Create a budget
                </button>
                <button
                  type="button"
                  className="ee-btn-outline"
                  onClick={() => setSyncModalOpen(true)}
                >
                  Create in Spreadsheet Sync
                </button>
              </div>

              <p className="ee-budget-hero-import">
                Already have a budget in a spreadsheet? Bring it in.{" "}
                <button
                  type="button"
                  className="ee-budget-hero-import-link"
                  onClick={() => navigate("/import-data")}
                >
                  Import budget
                </button>
              </p>
            </div>

            {/* Right: illustration */}
            <div className="ee-budget-hero-illustration">
              <div className="ee-budget-hero-img-wrap">
                <img
                  src="/illustrations/budget-hero.png"
                  alt="Financial planning illustration"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                {/* Fallback decorative SVG when image is missing */}
                <svg viewBox="0 0 340 280" fill="none" xmlns="http://www.w3.org/2000/svg" className="ee-budget-hero-svg" aria-hidden="true">
                  <rect x="20" y="40" width="300" height="200" rx="16" fill="#f0f6ff" />
                  <rect x="40" y="80" width="80" height="120" rx="6" fill="#bfdbfe" />
                  <rect x="140" y="60" width="80" height="140" rx="6" fill="#93c5fd" />
                  <rect x="240" y="100" width="60" height="100" rx="6" fill="#3b82f6" />
                  <line x1="20" y1="200" x2="320" y2="200" stroke="#cbd5e1" strokeWidth="1.5" />
                  <circle cx="80" cy="110" r="18" fill="#dbeafe" />
                  <circle cx="180" cy="90" r="18" fill="#bfdbfe" />
                  <circle cx="270" cy="130" r="18" fill="#93c5fd" />
                  <path d="M80 110 Q130 75 180 90 Q225 105 270 130" stroke="#2563eb" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Existing List View */}
      {budgetMode === "list" && (
        <div className="ee-tools-page">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0c1c38", margin: "0 0 6px" }}>
                Budgets
              </h1>
              <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>
                Compare planned and actual income and spending month by month.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="ee-btn-outline" onClick={() => setBudgetMode("workspace")}>
                Back to workspace
              </button>
              <button type="button" className="ee-btn-blue" onClick={() => setSetupModalOpen(true)}>
                <Plus size={16} /> New budget
              </button>
            </div>
          </div>

          <Loadable resource={budgets}>
            {(rows) =>
              rows.length === 0 ? (
                <div className="panel">
                  <EmptyState title="No budgets yet" body="Create a budget to compare planned and actual income and spending month by month." />
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Budget</th>
                        <th>Year</th>
                        <th className="num">Version</th>
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
                          <td>{yearName(b.financialYearId)}</td>
                          <td className="num">v{b.version}</td>
                          <td className="num">{amount(total(b.lines))}</td>
                          <td>
                            <Badge tone={STATUS_TONE[b.status]}>{humanize(b.status)}</Badge>
                          </td>
                          <td className="num nowrap">
                            <button type="button" className="btn" onClick={() => setOpenId(b.id)}>
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loadable>
        </div>
      )}

      {/* Mockup 79: Budget Setup Modal */}
      <BudgetSetupModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        onNext={() => { setSetupModalOpen(false); setBudgetMode("editor"); }}
        onOpenSpreadsheetSync={() => { setSetupModalOpen(false); setSyncModalOpen(true); }}
      />

      {/* Mockup 80: Spreadsheet Sync Modal */}
      <SpreadsheetSyncModal open={syncModalOpen} onClose={() => setSyncModalOpen(false)} />

      {editing && (
        <ClassicBudgetEditor
          budget={editing === "new" ? null : editing}
          years={years.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); budgets.reload(); setOpenId(id); }}
        />
      )}
      {openId && !editing && (
        <BudgetDrawer
          id={openId}
          years={years.data ?? []}
          onClose={() => setOpenId(null)}
          onEdit={(b) => { setOpenId(null); setEditing(b); }}
          onOpen={setOpenId}
          onChanged={() => budgets.reload()}
        />
      )}
    </div>
  );
}

function BudgetDrawer({
  id,
  years,
  onOpen,
  onEdit,
  onChanged,
  onClose,
}: {
  id: string;
  years: Year[];
  onOpen: (id: string) => void;
  onEdit: (b: Budget) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const detail = useResource<BudgetDetail>(`/api/v1/books/budgets/${id}`);
  const [tab, setTab] = useState<"variance" | "lines">("variance");
  const [busy, setBusy] = useState(false);
  const manage = can("budget:manage");

  async function act(action: "submit" | "activate" | "revise", label: string) {
    setBusy(true);
    try {
      const res = await api<{ id: string }>(`/api/v1/books/budgets/${id}/${action}`, { method: "POST", body: "{}" });
      toast(label);
      onChanged();
      if (action === "revise") onOpen(res.id);
      else detail.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  const b = detail.data;
  return (
    <Drawer title={b ? `${b.name} · v${b.version}` : "Budget"} subtitle={b && years.find((y) => y.id === b.financialYearId)?.name} wide onClose={onClose}>
      <Loadable resource={detail}>
        {(budget) => (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <Badge tone={STATUS_TONE[budget.status]}>{humanize(budget.status)}</Badge>
              {budget.status === "SUBMITTED" && <span className="muted small">Waiting for approval in the approvals queue.</span>}
              {budget.status === "REVISED" && <span className="muted small">Replaced by a later version.</span>}
              <span style={{ flex: 1 }} />
              {manage && budget.status === "DRAFT" && (
                <>
                  <button type="button" className="btn" disabled={busy} onClick={() => onEdit(budget)}>
                    Edit lines
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act("submit", "Budget submitted for approval")}>
                    Submit for approval
                  </button>
                </>
              )}
              {manage && budget.status === "APPROVED" && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act("activate", "Budget activated")}>
                  Activate
                </button>
              )}
              {manage && budget.status === "ACTIVE" && (
                <button type="button" className="btn" disabled={busy} onClick={() => void act("revise", "New draft version created")}>
                  Revise
                </button>
              )}
            </div>
            {budget.versions.length > 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }} aria-label="Versions">
                {budget.versions.map((v) => (
                  <button key={v.id} type="button" className={`btn ${v.id === budget.id ? "btn-primary" : ""}`} onClick={() => onOpen(v.id)}>
                    v{v.version} · {humanize(v.status)}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }} role="tablist">
              {(["variance", "lines"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
                  {t === "variance" ? "Budget vs actual by month" : "Budget lines"}
                </button>
              ))}
            </div>
            {tab === "variance" ? <VarianceTable id={budget.id} /> : <LinesTable budget={budget} years={years} />}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

function useAccounts() {
  const accounts = useResource<Account[]>("/api/v1/coa");
  const byId = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  return { accounts, byId };
}

function LinesTable({ budget, years }: { budget: Budget; years: Year[] }) {
  const { byId } = useAccounts();
  const periods = years.find((y) => y.id === budget.financialYearId)?.periods ?? [];
  const groups = groupLines(budget.lines);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Account</th>
            <th className="num">Whole year</th>
            {periods.map((p) => (
              <th key={p.sequence} className="num">
                {p.name}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const account = byId.get(g.accountId);
            return (
              <tr key={g.key}>
                <td className="nowrap">
                  {account ? `${account.code} ${account.name}` : g.accountId}
                  {dims(g) && <span className="sub">{dims(g)}</span>}
                </td>
                <td className="num">{g.amounts[0] ? amount(Number(g.amounts[0])) : ""}</td>
                {periods.map((p) => (
                  <td key={p.sequence} className="num">
                    {g.amounts[p.sequence] ? amount(Number(g.amounts[p.sequence])) : ""}
                  </td>
                ))}
                <td className="num strong">{amount(Object.values(g.amounts).reduce((s, v) => s + Number(v || 0), 0))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VarianceTable({ id }: { id: string }) {
  const { currency } = useCompany();
  const report = useResource<Variance>(`/api/v1/books/budgets/${id}/variance`);
  return (
    <Loadable resource={report}>
      {(r) => {
        const cell = (c: Cell, income: boolean) => {
          const bad = income ? c.actual < c.budget : c.actual > c.budget;
          return (
            <td key={c.sequence} className="num">
              <span className={c.budget || c.actual ? (bad ? "text-negative" : "") : "muted"}>{amount(c.actual)}</span>
              <span className="sub">of {amount(c.budget)}</span>
            </td>
          );
        };
        const totalRow = (label: string, t: Total, income: boolean) => (
          <tr className="subtotal">
            <td>{label}</td>
            {t.months.map((c) => cell(c, income))}
            <td className="num">{amount(t.budget)}</td>
            <td className="num">{amount(t.actual)}</td>
            <td className="num">{amount(t.variance)}</td>
          </tr>
        );
        const kinds = (["INCOME", "EXPENSE"] as const).filter((k) => r.rows.some((row) => row.kind === k));
        return r.rows.length === 0 ? (
          <EmptyState title="No lines in this budget" />
        ) : (
          <div className="table-wrap">
            <p className="muted small">Actual posted against budget, in {currency}. Each month shows the actual with the budget below it.</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  {r.periods.map((p) => (
                    <th key={p.sequence} className="num">
                      {p.name}
                    </th>
                  ))}
                  <th className="num">Budget</th>
                  <th className="num">Actual</th>
                  <th className="num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((kind) => (
                  <Fragment key={kind}>
                    <tr className="group-row">
                      <td colSpan={r.periods.length + 4}>{kind === "INCOME" ? "Income" : "Spending"}</td>
                    </tr>
                    {r.rows
                      .filter((row) => row.kind === kind)
                      .map((row) => (
                        <tr key={`${row.key}|${dims(row)}`}>
                          <td className="nowrap">
                            {row.key}
                            {dims(row) && <span className="sub">{dims(row)}</span>}
                          </td>
                          {row.months.map((c) => cell(c, kind === "INCOME"))}
                          <td className="num">{amount(row.budget)}</td>
                          <td className="num">{amount(row.actual)}</td>
                          <td className={`num ${row.favorable ? "text-positive" : "text-negative"}`}>{amount(row.variance)}</td>
                        </tr>
                      ))}
                    {totalRow(kind === "INCOME" ? "Total income" : "Total spending", kind === "INCOME" ? r.totals.income : r.totals.expense, kind === "INCOME")}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </Loadable>
  );
}

type Group = { key: string; accountId: string; costCentre: string | null; project: string | null; branchId: string | null; amounts: Record<number, string> };

function groupLines(lines: BudgetLine[]): Group[] {
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const key = [l.accountId, l.costCentre ?? "", l.project ?? "", l.branchId ?? ""].join("|");
    const g = groups.get(key) ?? { key, accountId: l.accountId, costCentre: l.costCentre, project: l.project, branchId: l.branchId, amounts: {} };
    g.amounts[l.periodSequence] = String(Number(l.amount));
    groups.set(key, g);
  }
  return [...groups.values()];
}

let rowSeq = 0;
const blankRow = (): Group => ({ key: `new-${++rowSeq}`, accountId: "", costCentre: null, project: null, branchId: null, amounts: {} });

type BranchOption = { id: string; name: string | null; code: string | null; isActive: boolean };

function ClassicBudgetEditor({ budget, years, onClose, onSaved }: { budget: Budget | null; years: Year[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { api } = useSession();
  const { accounts } = useAccounts();
  const dimensions = useResource<Dimension[]>("/api/v1/books/dimensions");
  const branches = useResource<BranchOption[]>("/api/v1/setup/branches");
  const [name, setName] = useState(budget?.name ?? "");
  const [yearId, setYearId] = useState(budget?.financialYearId ?? years[0]?.id ?? "");
  const [rows, setRows] = useState<Group[]>(() => (budget ? groupLines(budget.lines) : [blankRow()]));
  const savedId = useRef(budget?.id ?? "");
  const { busy, error, setError, run } = useSubmit(() => onSaved(savedId.current));
  const periods = years.find((y) => y.id === yearId)?.periods ?? [];

  const accountOptions = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a) => a.isActive && PNL.has(a.type))
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: humanize(a.type) })),
    [accounts.data],
  );
  const dimensionOptions = (kind: Dimension["kind"], current: string | null) => [
    { value: "", label: "All" },
    ...(dimensions.data ?? []).filter((d) => d.kind === kind && (d.isActive || d.code === current)).map((d) => ({ value: d.code, label: d.name, prefix: d.code })),
  ];
  const branchOptions = useMemo(() => {
    const list = branches.data ?? [];
    const selected = new Set(rows.map((r) => r.branchId).filter(Boolean) as string[]);
    return [
      { value: "", label: "All" },
      ...list
        .filter((b) => b.isActive || selected.has(b.id))
        .map((b) => ({ value: b.id, label: b.name ?? b.code ?? b.id, prefix: b.code ?? undefined })),
    ];
  }, [branches.data, rows]);

  function update(i: number, patch: Partial<Group>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function setAmount(i: number, sequence: number, value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, amounts: { ...r.amounts, [sequence]: value } } : r)));
  }
  function spread(i: number) {
    const yearly = parseAmount(rows[i].amounts[0] ?? "");
    if (!(yearly > 0) || !periods.length) return setError("Enter a whole-year amount to spread it across the months.");
    const each = Math.floor((yearly / periods.length) * 100) / 100;
    const amounts: Record<number, string> = {};
    periods.forEach((p, idx) => (amounts[p.sequence] = String(idx === periods.length - 1 ? Math.round((yearly - each * (periods.length - 1)) * 100) / 100 : each)));
    update(i, { amounts });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the budget a name.");
    const lines: Array<{ accountId: string; periodSequence: number; amount: number; costCentre: string | null; project: string | null; branchId: string | null }> = [];
    for (const [i, r] of rows.entries()) {
      if (!r.accountId) continue;
      for (const [seq, text] of Object.entries(r.amounts)) {
        if (!text?.trim()) continue;
        const value = parseAmount(text);
        if (!(value >= 0)) return setError(`Row ${i + 1}: amounts must be zero or more.`);
        if (value > 0) lines.push({ accountId: r.accountId, periodSequence: Number(seq), amount: value, costCentre: r.costCentre, project: r.project, branchId: r.branchId });
      }
    }
    if (!lines.length) return setError("Enter at least one amount.");
    void run(async () => {
      if (budget) {
        await api(`/api/v1/books/budgets/${budget.id}`, { method: "PUT", body: JSON.stringify({ name: name.trim(), lines }) });
        return "Budget saved";
      }
      const created = await api<{ id: string }>("/api/v1/books/budgets", { method: "POST", body: JSON.stringify({ name: name.trim(), financialYearId: yearId || undefined, lines }) });
      savedId.current = created.id;
      return "Budget saved as draft";
    });
  }

  return (
    <Drawer title={budget ? `Edit ${budget.name} · v${budget.version}` : "New budget"} wide onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save draft" formId="budget-form" />}>
      <FormError message={error} />
      <form id="budget-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="FY 2026 operating budget" />
        </Field>
        <Field label="Financial year" hint={budget ? "A version stays in its year." : "Months and actuals come from this year."}>
          <Select value={yearId} onChange={setYearId} disabled={Boolean(budget)} options={years.map((y) => ({ value: y.id, label: y.name }))} />
        </Field>
        <div className="span-2 table-wrap">
          <table className="table lines-table">
            <thead>
              <tr>
                <th style={{ minWidth: 240 }}>Account</th>
                <th style={{ minWidth: 150 }}>Cost centre</th>
                <th style={{ minWidth: 150 }}>Project</th>
                <th style={{ minWidth: 150 }}>Branch</th>
                <th className="num" style={{ minWidth: 130 }}>
                  Whole year
                </th>
                {periods.map((p) => (
                  <th key={p.sequence} className="num" style={{ minWidth: 120 }}>
                    {p.name}
                  </th>
                ))}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td>
                    <Select value={r.accountId} onChange={(v) => update(i, { accountId: v })} options={accountOptions} placeholder="Income or expense account" aria-label={`Account for row ${i + 1}`} />
                  </td>
                  <td>
                    <Select value={r.costCentre ?? ""} onChange={(v) => update(i, { costCentre: v || null })} options={dimensionOptions("COST_CENTRE", r.costCentre)} aria-label={`Cost centre for row ${i + 1}`} />
                  </td>
                  <td>
                    <Select value={r.project ?? ""} onChange={(v) => update(i, { project: v || null })} options={dimensionOptions("PROJECT", r.project)} aria-label={`Project for row ${i + 1}`} />
                  </td>
                  <td>
                    <Select value={r.branchId ?? ""} onChange={(v) => update(i, { branchId: v || null })} options={branchOptions} aria-label={`Branch for row ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={r.amounts[0] ?? ""} onChange={(v) => setAmount(i, 0, v)} aria-label={`Whole-year amount for row ${i + 1}`} />
                    {periods.length > 0 && (
                      <button type="button" className="btn btn-link small" onClick={() => spread(i)}>
                        Spread by month
                      </button>
                    )}
                  </td>
                  {periods.map((p) => (
                    <td key={p.sequence}>
                      <MoneyInput value={r.amounts[p.sequence] ?? ""} onChange={(v) => setAmount(i, p.sequence, v)} aria-label={`${p.name} amount for row ${i + 1}`} />
                    </td>
                  ))}
                  <td>
                    {rows.length > 1 && (
                      <button type="button" className="icon-button" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Plus size={16} aria-hidden="true" />
            Add row
          </button>
          <p className="muted small">
            A whole-year amount is checked against spending for the year; monthly amounts against each month. Spread by month moves the whole-year amount into the months.
          </p>
        </div>
      </form>
    </Drawer>
  );
}

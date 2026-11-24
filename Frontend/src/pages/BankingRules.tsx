import { ChevronDown, HelpCircle, List, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { FormError } from "../components/forms";
import { Select } from "../components/Select";
import { Menu } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { FinancialAccount } from "../lib/types";

type Condition = { field: "DESCRIPTION" | "REFERENCE" | "AMOUNT"; op: "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "GREATER" | "LESS"; value: string };
type Split = { accountId: string; percent: string };
type Rule = {
  id: string;
  name: string;
  priority: number;
  direction: "IN" | "OUT";
  financialAccountId: string | null;
  matchAll: boolean;
  conditions: Condition[];
  splits: Array<{ accountId: string; percent: number }>;
  payee: string | null;
  memo: string | null;
  keepMemo: boolean;
  autoPost: boolean;
  isActive: boolean;
};
type Form = Omit<Rule, "id" | "priority" | "splits" | "payee" | "memo" | "financialAccountId"> & { id?: string; priority: string; splits: Split[]; payee: string; memo: string; financialAccountId: string };
type Preview = { count: number; lines: Array<{ id: string; date: string; description: string; amount: number }> };
type Applied = { posted: number; alreadyInBooks: number; failed: Array<{ error: string }> };

const FIELD = { DESCRIPTION: "Description", REFERENCE: "Reference", AMOUNT: "Amount" } as const;
const OP = { CONTAINS: "contains", NOT_CONTAINS: "doesn't contain", EQUALS: "is exactly", GREATER: "is greater than", LESS: "is less than" } as const;
const opsFor = (f: Condition["field"]): Condition["op"][] => (f === "AMOUNT" ? ["EQUALS", "GREATER", "LESS"] : ["CONTAINS", "NOT_CONTAINS", "EQUALS"]);
const conditionText = (c: Condition) => `${FIELD[c.field]} ${OP[c.op]} “${c.value}”`;

const payloadOf = (f: Form) => ({
  ...f,
  id: undefined,
  priority: Number(f.priority),
  financialAccountId: f.financialAccountId || null,
  conditions: f.conditions.map((c) => ({ ...c, value: c.field === "AMOUNT" ? c.value.replace(/,/g, "") : c.value })),
  splits: f.splits.map((s) => ({ accountId: s.accountId, percent: f.splits.length === 1 ? 100 : Number(s.percent) })),
});

export function BankingRules() {
  const { toast, confirm } = useFeedback();
  const { api, can } = useSession();
  const { accounts } = useCompany();
  const res = useResource<Rule[]>("/api/v1/banking/rules");
  const banks = useResource<FinancialAccount[]>("/api/v1/banking/accounts");
  const [activeTab, setActiveTab] = useState<"bank" | "integration">("bank");
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [ruleTypeFilter, setRuleTypeFilter] = useState("All rules");
  const manage = can("bank:manage");

  const rules = useMemo(() => res.data ?? [], [res.data]);
  const bankName = (id: string | null) => (id ? (banks.data?.find((b) => b.id === id)?.name ?? "—") : "All accounts");
  const categories = useMemo(() => {
    const linked = new Set((banks.data ?? []).map((b) => b.glAccountId));
    return accounts.filter((a) => a.isActive && !linked.has(a.id)).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  }, [accounts, banks.data]);
  const categoryName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  const rows = rules.filter((r) => {
    if (ruleTypeFilter === "Money in" && r.direction !== "IN") return false;
    if (ruleTypeFilter === "Money out" && r.direction !== "OUT") return false;
    if (ruleTypeFilter === "Active" && !r.isActive) return false;
    if (ruleTypeFilter === "Disabled" && r.isActive) return false;
    const q = searchQuery.trim().toLowerCase();
    return !q || `${r.name} ${r.conditions.map(conditionText).join(" ")}`.toLowerCase().includes(q);
  });

  const change = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setPreview(null);
    setError("");
  };
  function open(rule?: Rule) {
    setPreview(null);
    setError("");
    setForm(
      rule
        ? { ...rule, priority: String(rule.priority), financialAccountId: rule.financialAccountId ?? "", payee: rule.payee ?? "", memo: rule.memo ?? "", splits: rule.splits.map((s) => ({ accountId: s.accountId, percent: String(s.percent) })) }
        : {
            name: "",
            priority: String(Math.max(0, ...rules.map((r) => r.priority)) + 1),
            direction: "OUT",
            financialAccountId: "",
            matchAll: true,
            conditions: [{ field: "DESCRIPTION", op: "CONTAINS", value: "" }],
            splits: [{ accountId: "", percent: "100" }],
            payee: "",
            memo: "",
            keepMemo: false,
            autoPost: false,
            isActive: true,
          },
    );
  }

  function problem(f: Form) {
    if (!f.name.trim()) return "Name the rule";
    if (!(Number.isInteger(Number(f.priority)) && Number(f.priority) >= 1)) return "Priority must be a whole number from 1";
    if (f.conditions.some((c) => !c.value.trim())) return "Fill in every condition";
    if (f.conditions.some((c) => c.field === "AMOUNT" && !(Number(c.value.replace(/,/g, "")) >= 0))) return "Enter condition amounts as numbers";
    if (f.splits.some((s) => !s.accountId)) return "Choose a category";
    if (f.splits.length > 1 && Math.abs(f.splits.reduce((t, s) => t + Number(s.percent), 0) - 100) > 0.001) return "Splits must add up to 100%";
    return "";
  }

  async function submit(action: "save" | "preview") {
    if (!form) return;
    const issue = problem(form);
    if (issue) return setError(issue);
    setBusy(true);
    try {
      const body = JSON.stringify(payloadOf(form));
      if (action === "preview") setPreview(await api<Preview>("/api/v1/banking/rules/preview", { method: "POST", body }));
      else {
        await api(form.id ? `/api/v1/banking/rules/${form.id}` : "/api/v1/banking/rules", { method: form.id ? "PUT" : "POST", body });
        toast(`Rule "${form.name.trim()}" saved`);
        setForm(null);
        res.reload();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<string | null>) {
    try {
      const done = await action();
      if (done) toast(done);
      res.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }
  const apply = (r: Rule) =>
    run(async () => {
      const { id: _id, ...rule } = r;
      const found = await api<Preview>("/api/v1/banking/rules/preview", { method: "POST", body: JSON.stringify(rule) });
      if (!found.count) return "No unmatched statement lines meet this rule";
      if (!(await confirm({ title: `Apply ${r.name}?`, body: `${found.count} statement line${found.count === 1 ? "" : "s"} meet this rule and will be posted to the books. Lines already in the books, or claimed by a higher-priority rule, are skipped.`, confirmLabel: "Apply rule" }))) return null;
      const out = await api<Applied>(`/api/v1/banking/rules/${r.id}/apply`, { method: "POST", body: "{}" });
      if (out.failed.length) toast(`${out.failed.length} couldn't be posted: ${out.failed[0].error}`, { error: true });
      return `${out.posted} posted${out.alreadyInBooks ? `, ${out.alreadyInBooks} already in the books` : ""}`;
    });
  const toggle = (r: Rule) =>
    run(async () => {
      const { id, ...rule } = r;
      await api(`/api/v1/banking/rules/${id}`, { method: "PUT", body: JSON.stringify({ ...rule, isActive: !r.isActive }) });
      return r.isActive ? `${r.name} turned off` : `${r.name} turned on`;
    });
  const remove = (r: Rule) =>
    run(async () => {
      if (!(await confirm({ title: `Delete ${r.name}?`, body: "Transactions it already posted stay in the books.", confirmLabel: "Delete", danger: true }))) return null;
      await api(`/api/v1/banking/rules/${r.id}`, { method: "DELETE" });
      return `${r.name} deleted`;
    });

  return (
    <div className="ee-rules-container">
      {/* Top breadcrumb matching mockup 69 */}
      <div className="ee-rules-top-bar">
        <span>Accounting</span>
        <span style={{ margin: "0 6px" }}>/</span>
        <span style={{ color: "#0c1c38", fontWeight: 500 }}>Rules</span>
      </div>

      {/* Header row */}
      <div className="ee-rules-header-row">
        <h1 className="ee-lists-title" style={{ margin: 0 }}>
          Rules
        </h1>

        <div className="ee-rules-header-right">
          <div className="ee-split-btn">
            <button
              type="button"
              className="ee-split-btn-main"
              disabled={!manage}
              onClick={() => open()}
            >
              New rule
            </button>
            <button
              type="button"
              className="ee-split-btn-caret"
              disabled={!manage}
              onClick={() => open()}
              aria-label="New rule options"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs matching mockup 69 */}
      <div className="ee-rules-tabs">
        <button
          type="button"
          className={`ee-rules-tab ${activeTab === "bank" ? "active" : ""}`}
          onClick={() => setActiveTab("bank")}
        >
          Bank rules
        </button>
        <button
          type="button"
          className={`ee-rules-tab ${activeTab === "integration" ? "active" : ""}`}
          onClick={() => setActiveTab("integration")}
        >
          Integration rules
        </button>
      </div>

      {/* Filter toolbar matching mockup 69 */}
      <div className="ee-table-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="ee-search-input-wrap">
            <Search size={16} className="ee-search-icon" />
            <input
              type="text"
              className="ee-search-input"
              placeholder="Search by name or conditions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 340 }}
            />
          </div>

          <div style={{ position: "relative" }}>
            <select
              className="ee-input-select"
              style={{ height: 38, width: 140, padding: "6px 12px", fontSize: "var(--fs-md)" }}
              value={ruleTypeFilter}
              onChange={(e) => setRuleTypeFilter(e.target.value)}
            >
              <option value="All rules">All rules</option>
              <option value="Money in">Money in</option>
              <option value="Money out">Money out</option>
              <option value="Active">Active</option>
              <option value="Disabled">Disabled</option>
            </select>
          </div>
        </div>

      </div>

      {/* Table matching mockup 69 */}
      <div className="ee-mockup-table-wrap">
        <table className="ee-mockup-table">
          <thead>
            <tr>
              <th>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>Priority</span>
                  <HelpCircle size={13} color="#64748b" />
                  <span style={{ fontSize: "var(--fs-2xs)" }}>▲</span>
                </div>
              </th>
              <th>Rule name</th>
              <th>Applied to</th>
              <th>Conditions</th>
              <th>Settings</th>
              <th>Auto-post</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeTab === "bank"
              ? rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.priority}</td>
                    <td>{r.name}</td>
                    <td>{r.direction === "IN" ? "Money in" : "Money out"} · {bankName(r.financialAccountId)}</td>
                    <td>{r.conditions.map(conditionText).join(r.matchAll ? " and " : " or ")}</td>
                    <td>{r.splits.map((s) => (r.splits.length > 1 ? `${categoryName(s.accountId)} ${s.percent}%` : categoryName(s.accountId))).join(", ")}</td>
                    <td>{r.autoPost ? "On" : "Off"}</td>
                    <td>{r.isActive ? "Active" : "Disabled"}</td>
                    <td>
                      {manage ? (
                        <Menu
                          label="Actions"
                          triggerClassName="ee-link-btn"
                          items={[
                            { label: "Edit", onSelect: () => open(r) },
                            r.isActive && { label: "Apply now", onSelect: () => void apply(r) },
                            { label: r.isActive ? "Turn off" : "Turn on", onSelect: () => void toggle(r) },
                            { label: "Delete", onSelect: () => void remove(r) },
                          ]}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))
              : null}
            {activeTab === "bank" && rows.length ? null : (
              <tr className="ee-table-empty-row">
                <td colSpan={8}>
                  {activeTab === "integration"
                    ? "Integration rules apply to connected apps. None are connected."
                    : (res.error ?? (res.loading ? "Loading…" : rules.length ? "We couldn't find rules that match your search. Expand your search and try again." : "No rules yet. Create one to categorise statement lines automatically."))}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="ee-table-pagination">
          <span>{activeTab === "bank" ? rows.length : 0} of {activeTab === "bank" ? rules.length : 0} rules</span>
        </div>
      </div>

      {/* Drawer: Create rule matching mockup 70 */}
      {form ? (
        <>
          <div className="ee-drawer-backdrop" onClick={() => setForm(null)} />
          <div className="ee-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="rule-drawer-title">
            <div className="ee-drawer-header">
              <h2 id="rule-drawer-title" className="ee-drawer-title">{form.id ? "Edit rule" : "Create rule"}</h2>
              <button type="button" className="ee-drawer-close-btn" onClick={() => setForm(null)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="ee-drawer-body">
              <FormError message={error} />
              <div className="ee-rule-field">
                <label className="ee-field-label" htmlFor="rule-name">Rule name</label>
                <input id="rule-name" className="ee-input-text" maxLength={80} value={form.name} onChange={(e) => change({ name: e.target.value })} />
              </div>

              <div className="ee-rule-drawer-top-actions">
                <button type="button" className="ee-link-btn" disabled={form.conditions.length >= 5} onClick={() => change({ conditions: [...form.conditions, { field: "DESCRIPTION", op: "CONTAINS", value: "" }] })}>
                  + Add a condition
                </button>
                <button type="button" className="ee-btn-test-rule" disabled={busy} onClick={() => void submit("preview")}>
                  Test rule
                </button>
              </div>

              <div className="ee-priority-row">
                <div style={{ display: "flex", alignItems: "center", fontSize: "var(--fs-md)", color: "#1e293b", fontWeight: 600 }}>
                  <span>Priority</span>
                  <input type="number" min={1} className="ee-priority-input" aria-label="Priority" value={form.priority} onChange={(e) => change({ priority: e.target.value })} />
                  <span>of {rules.length + (form.id ? 0 : 1)}</span>
                </div>
                <button type="button" className="ee-preview-link ee-link-btn" disabled={busy} onClick={() => void submit("preview")}>
                  <List size={16} />
                  <span>Preview</span>
                </button>
              </div>

              {preview ? (
                <div className="ee-rule-preview" role="status">
                  <strong>{preview.count} unmatched statement line{preview.count === 1 ? "" : "s"} meet this rule</strong>
                  {preview.lines.slice(0, 8).map((l) => (
                    <div key={l.id}>
                      <span>{date(l.date)} · {l.description}</span>
                      <span>{amount(l.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <h3 className="ee-criteria-section-title">For transactions that meet these criteria...</h3>
              <div className="ee-rule-line">
                <select className="ee-input-select" aria-label="Bank account" value={form.financialAccountId} onChange={(e) => change({ financialAccountId: e.target.value })}>
                  <option value="">All accounts</option>
                  {(banks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select className="ee-input-select" aria-label="Match conditions" value={form.matchAll ? "all" : "any"} onChange={(e) => change({ matchAll: e.target.value === "all" })}>
                  <option value="all">All conditions</option>
                  <option value="any">Any condition</option>
                </select>
              </div>
              {form.conditions.map((c, i) => {
                const set = (patch: Partial<Condition>) => change({ conditions: form.conditions.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
                return (
                  <div className="ee-rule-line" key={i}>
                    <select className="ee-input-select" aria-label={`Condition ${i + 1} field`} value={c.field} onChange={(e) => { const field = e.target.value as Condition["field"]; set({ field, op: opsFor(field).includes(c.op) ? c.op : opsFor(field)[0] }); }}>
                      {Object.entries(FIELD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select className="ee-input-select" aria-label={`Condition ${i + 1} test`} value={c.op} onChange={(e) => set({ op: e.target.value as Condition["op"] })}>
                      {opsFor(c.field).map((o) => <option key={o} value={o}>{OP[o]}</option>)}
                    </select>
                    <input className="ee-input-text" aria-label={`Condition ${i + 1} value`} value={c.value} onChange={(e) => set({ value: e.target.value })} />
                    {form.conditions.length > 1 ? (
                      <button type="button" className="ee-icon-btn" aria-label={`Remove condition ${i + 1}`} onClick={() => change({ conditions: form.conditions.filter((_, n) => n !== i) })}><X size={16} /></button>
                    ) : null}
                  </div>
                );
              })}

              <div className="ee-criteria-auto-row">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "var(--fs-md)", fontWeight: 500, color: "#1e293b" }}>Auto-post</span>
                  <button type="button" className={`ee-switch-toggle ${form.autoPost ? "on" : ""}`} onClick={() => change({ autoPost: !form.autoPost })} role="switch" aria-checked={form.autoPost} aria-label="Auto-post">
                    <div className="ee-switch-toggle-knob" />
                  </button>
                </div>
                <span className="muted small">{form.autoPost ? "Posts when a statement is imported" : "Posts only when you choose Apply now"}</span>
              </div>

              <div className="ee-rule-field">
                <label className="ee-field-label" htmlFor="rule-type">Transaction type</label>
                <select id="rule-type" className="ee-input-select" value={form.direction} onChange={(e) => change({ direction: e.target.value as Rule["direction"] })}>
                  <option value="OUT">Expense (money out)</option>
                  <option value="IN">Deposit (money in)</option>
                </select>
              </div>

              <div className="ee-rule-field">
                <span className="ee-field-label">Category</span>
                {form.splits.map((s, i) => {
                  const set = (patch: Partial<Split>) => change({ splits: form.splits.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
                  return (
                    <div className="ee-rule-line" key={i}>
                      <Select value={s.accountId} onChange={(v) => set({ accountId: v })} options={categories} placeholder="Select a category" aria-label={`Category ${i + 1}`} />
                      {form.splits.length > 1 ? (
                        <>
                          <input className="ee-input-text ee-rule-pct" inputMode="decimal" aria-label={`Percent ${i + 1}`} value={s.percent} onChange={(e) => set({ percent: e.target.value })} />
                          <span>%</span>
                          <button type="button" className="ee-icon-btn" aria-label={`Remove split ${i + 1}`} onClick={() => change({ splits: form.splits.filter((_, n) => n !== i) })}><X size={16} /></button>
                        </>
                      ) : null}
                    </div>
                  );
                })}
                <button type="button" className="ee-link-btn" disabled={form.splits.length >= 10} onClick={() => change({ splits: [...form.splits, { accountId: "", percent: "" }] })}>
                  + Add a split
                </button>
              </div>

              <div className="ee-rule-field">
                <label className="ee-field-label" htmlFor="rule-payee">Payee</label>
                <input id="rule-payee" className="ee-input-text" placeholder="(Recommended)" maxLength={200} value={form.payee} onChange={(e) => change({ payee: e.target.value })} />
              </div>

              <div className="ee-rule-field">
                <label className="ee-field-label" htmlFor="rule-memo">Replace bank memo</label>
                <input id="rule-memo" className="ee-input-text" placeholder="(Optional)" maxLength={300} value={form.memo} onChange={(e) => change({ memo: e.target.value })} />
                <label className="check" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={form.keepMemo} onChange={(e) => change({ keepMemo: e.target.checked })} />
                  Also keep existing bank memo.
                </label>
              </div>
            </div>

            <div className="ee-drawer-footer">
              <button type="button" className="ee-btn-ghost-cancel" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="ee-btn-primary-blue" disabled={busy} onClick={() => void submit("save")}>{busy ? "Working…" : "Save"}</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

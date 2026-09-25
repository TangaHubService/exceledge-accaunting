import { Download, Plus } from "lucide-react";
import { type FormEvent, Fragment, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Select, type SelectOption } from "../components/Select";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { drCr, toNumber } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account, AccountType, CoaDashboard } from "../lib/types";

export const TYPE_ORDER: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"];

export const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  COST_OF_SALES: "Cost of sales",
  EXPENSE: "Operating expenses",
  OTHER_INCOME: "Other income",
  OTHER_EXPENSE: "Other expenses",
};

/** Accounts as dropdown options, grouped by type in chart order. */
export function accountOptions(accounts: Account[]): SelectOption[] {
  return TYPE_ORDER.flatMap((t) =>
    accounts.filter((a) => a.type === t).map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: TYPE_LABELS[t] })),
  );
}

type TreeNode = Account & { children: TreeNode[] };
type FlatRow = { account: Account; depth: number; isParent: boolean };

function flatten(nodes: TreeNode[], depth = 0, out: FlatRow[] = []) {
  for (const n of [...nodes].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))) {
    out.push({ account: n, depth, isParent: Boolean(n.children?.length) });
    flatten(n.children ?? [], depth + 1, out);
  }
  return out;
}

export function Accounts() {
  const { can, download } = useSession();
  const { toast } = useFeedback();
  const tree = useResource<TreeNode[]>("/api/v1/coa/tree");
  const dash = useResource<CoaDashboard>("/api/v1/coa/dashboard");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<AccountType | "">("");
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const flat = flatten(tree.data ?? []);
    const q = search.trim().toLowerCase();
    return flat.filter(
      ({ account: a }) =>
        (showInactive || a.isActive) &&
        (!type || a.type === type) &&
        (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)),
    );
  }, [tree.data, search, type, showInactive]);

  const byType = TYPE_ORDER.map((t) => ({ type: t, rows: rows.filter((r) => r.account.type === t) })).filter((g) => g.rows.length);

  async function exportCsv() {
    try {
      await download("/api/v1/coa/export?format=csv", "chart-of-accounts.csv");
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description={dash.data ? `${dash.data.active} active accounts${dash.data.inactive ? ` · ${dash.data.inactive} inactive` : ""}` : "The accounts your transactions are posted to."}
        actions={
          <>
            {can("coa:export") && (
              <button type="button" className="btn" onClick={() => void exportCsv()}>
                <Download size={16} aria-hidden="true" />
                Export CSV
              </button>
            )}
            {can("coa:create") && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" />
                New account
              </button>
            )}
          </>
        }
      />

      <div className="filter-bar">
        <input className="input search" type="search" placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search accounts" />
        <Select
          style={{ width: 210 }}
          value={type}
          onChange={(v) => setType(v as AccountType | "")}
          aria-label="Account type"
          searchable={false}
          options={[{ value: "", label: "All account types" }, ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABELS[t] }))]}
        />
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <Loadable resource={tree} skeleton={<SkeletonRows rows={10} cols={3} />}>
        {() => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Code</th>
                  <th>Account</th>
                  <th className="num" style={{ width: 180 }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {byType.map((g) => (
                  <Fragment key={g.type}>
                    <tr className="type-group">
                      <td colSpan={3}>
                        {TYPE_LABELS[g.type]} <span className="muted">· {g.rows.length}</span>
                      </td>
                    </tr>
                    {g.rows.map(({ account: a, depth, isParent }) => (
                      <tr
                        key={a.id}
                        className={`clickable ${a.isActive ? "" : "row-inactive"}`}
                        tabIndex={0}
                        onClick={() => navigate(`/ledger?account=${a.id}`)}
                        onKeyDown={(e) => e.key === "Enter" && navigate(`/ledger?account=${a.id}`)}
                      >
                        <td className="mono">{a.code}</td>
                        <td className={depth ? `indent-${Math.min(depth, 3)}` : undefined}>
                          <span className={isParent ? "strong" : undefined}>{a.name}</span>{" "}
                          {!a.isActive && <Badge>Inactive</Badge>}
                        </td>
                        <td className="num">{toNumber(a.currentBalance) ? drCr(a.currentBalance) : <span className="subtle">—</span>}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {byType.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 0 }}>
                      <EmptyState title="No accounts match" body="Try a different search or account type." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Loadable>

      {creating && dash.data && (
        <NewAccountForm
          categories={dash.data.categories}
          accounts={flatten(tree.data ?? []).map((r) => r.account)}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            tree.reload();
            dash.reload();
          }}
        />
      )}
    </>
  );
}

function NewAccountForm({
  categories,
  accounts,
  onClose,
  onSaved,
}: {
  categories: CoaDashboard["categories"];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { reload: reloadCompany } = useCompany();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("EXPENSE");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ranges = useMemo(
    () =>
      categories.map((c) => {
        const [min, max] = c.range.split("-").map(Number);
        return { type: c.type, label: c.label, min, max };
      }),
    [categories],
  );
  const range = ranges.find((r) => r.type === type);
  const codeNumber = Number(code);
  const outOfRange = code !== "" && range && (!Number.isFinite(codeNumber) || codeNumber < range.min || codeNumber > range.max);
  const duplicate = accounts.some((a) => a.code === code);
  const parents = accounts.filter((a) => a.type === type && a.isActive);

  function onCode(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    const n = Number(digits);
    const inferred = digits.length >= 4 ? ranges.find((r) => n >= r.min && n <= r.max) : undefined;
    if (inferred && inferred.type !== type) {
      setType(inferred.type);
      setParentId("");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (outOfRange || duplicate) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/coa", {
        method: "POST",
        body: JSON.stringify({ code, name: name.trim(), type, parentId: parentId || undefined, description: description || undefined }),
      });
      toast(`Account ${code} ${name} created`);
      reloadCompany();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title="New account"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="account-form" className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit}>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid">
          <Field
            label="Code"
            required
            error={duplicate ? "An account with this code already exists" : outOfRange && range ? `${range.label} use codes ${range.min}–${range.max}` : null}
            hint={range ? `${range.label}: ${range.min}–${range.max}` : undefined}
          >
            <input className={`input mono ${outOfRange || duplicate ? "invalid" : ""}`} value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" required />
          </Field>
          <Field label="Type" required>
            <Select
              value={type}
              onChange={(v) => {
                setType(v as AccountType);
                setParentId("");
              }}
              searchable={false}
              options={TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            />
          </Field>
          <Field label="Account name" required className="span-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office rent" required />
          </Field>
          <Field label="Sub-account of" className="span-2" hint="Optional — group this account under another">
            <Select
              value={parentId}
              onChange={setParentId}
              options={[{ value: "", label: "None (top level)" }, ...parents.map((a) => ({ value: a.id, label: a.name, prefix: a.code }))]}
            />
          </Field>
          <Field label="Description" className="span-2">
            <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

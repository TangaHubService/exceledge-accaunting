import {
  ChevronDown,
  Pencil,
  Plus,
  Printer,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { NewAccountDrawer } from "../components/coa/NewAccountDrawer";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Badge, EmptyState, Loadable, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { ALL_ACCOUNT_TYPE_LABELS, decodeReportingGroup } from "../lib/coa-taxonomy";
import { money, toNumber } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account, AccountType, CoaDashboard } from "../lib/types";

export const TYPE_ORDER: AccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "COST_OF_SALES",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
];

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
export function accountOptions(accounts: Account[]) {
  return TYPE_ORDER.flatMap((t) =>
    accounts
      .filter((a) => a.type === t)
      .map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: TYPE_LABELS[t] })),
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

function accountMeta(a: Account) {
  const decoded = decodeReportingGroup(a.reportingGroup);
  return {
    accountType: decoded.accountType || TYPE_LABELS[a.type] || a.type,
    detailType: decoded.detailType || a.description || "—",
  };
}

export function Accounts() {
  const { can, download } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const tree = useResource<TreeNode[]>("/api/v1/coa/tree");
  const dash = useResource<CoaDashboard>("/api/v1/coa/dashboard");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const newMenuRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const flat = flatten(tree.data ?? []);
    const q = search.trim().toLowerCase();
    return flat.filter(({ account: a }) => {
      if (!showInactive && !a.isActive) return false;
      const meta = accountMeta(a);
      if (typeFilter && meta.accountType !== typeFilter && a.type !== typeFilter) return false;
      if (!q) return true;
      return (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        meta.accountType.toLowerCase().includes(q) ||
        meta.detailType.toLowerCase().includes(q)
      );
    });
  }, [tree.data, search, typeFilter, showInactive]);

  const allSelected = rows.length > 0 && rows.every((r) => selected[r.account.id]);

  function toggleAll(on: boolean) {
    if (!on) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.account.id] = true;
    setSelected(next);
  }

  async function exportCsv() {
    try {
      await download("/api/v1/coa/export?format=csv", "chart-of-accounts.csv");
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  function printPage() {
    window.print();
  }

  return (
    <div className="ee-coa-page">
        <nav className="ee-cust-crumbs" aria-label="Breadcrumb">
          <span>Accounting</span>
          <span className="ee-cust-crumbs-sep">/</span>
          <span>Chart of accounts</span>
        </nav>

        <header className="ee-coa-head">
          <h1>Chart of accounts</h1>
          <div className="ee-coa-head-actions">
            {can("coa:export") && (
              <button type="button" className="btn ee-btn-outline-blue" onClick={() => void exportCsv()}>
                Run report
              </button>
            )}
            {can("coa:create") && (
              <div className="ee-coa-new-wrap" ref={newMenuRef}>
                <button type="button" className="btn btn-primary ee-coa-new-btn" onClick={() => setCreating(true)}>
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  New account
                </button>
                <button
                  type="button"
                  className="btn btn-primary ee-coa-new-more"
                  aria-label="More new account options"
                  aria-expanded={newMenuOpen}
                  onClick={() => setNewMenuOpen((v) => !v)}
                >
                  <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                {newMenuOpen && (
                  <div className="ee-coa-new-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setNewMenuOpen(false);
                        toast("Import chart of accounts — use Settings → Advanced or contact support for bulk import.");
                      }}
                    >
                      Import chart of accounts
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setNewMenuOpen(false);
                        toast("Clean up is available after reviewing inactive accounts.");
                        setShowInactive(true);
                      }}
                    >
                      Clean up chart of accounts
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="ee-coa-toolbar">
          <label className="ee-coa-search">
            <Search size={15} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or number"
              aria-label="Filter by name or number"
            />
          </label>
          <Select
            className="ee-coa-filter-select"
            value={typeFilter}
            onChange={setTypeFilter}
            aria-label="Filter by account type"
            searchable
            options={[
              { value: "", label: "All" },
              ...ALL_ACCOUNT_TYPE_LABELS.map((l) => ({ value: l, label: l, group: "Account type" })),
              ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABELS[t], group: "Backend type" })),
            ]}
          />
          <label className="ee-coa-inactive">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <div className="ee-coa-tools">
            <button type="button" className="ee-coa-tool" onClick={() => toast("Edit mode coming soon")}>
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> Edit mode
            </button>
            {can("coa:export") && (
              <button type="button" className="ee-coa-tool" onClick={() => void exportCsv()}>
                <Upload size={14} strokeWidth={1.75} aria-hidden="true" /> Export
              </button>
            )}
            <button type="button" className="ee-coa-tool" onClick={printPage}>
              <Printer size={14} strokeWidth={1.75} aria-hidden="true" /> Print
            </button>
            <button type="button" className="ee-coa-tool" onClick={() => navigate("/settings/advanced")}>
              <Settings size={14} strokeWidth={1.75} aria-hidden="true" /> Settings
            </button>
          </div>
        </div>

        <Loadable resource={tree} skeleton={<SkeletonRows rows={10} cols={6} />}>
          {() => (
            <div className="ee-coa-table-wrap">
              <table className="ee-coa-table">
                <thead>
                  <tr>
                    <th className="ee-coa-check-col">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                        aria-label="Select all accounts"
                      />
                    </th>
                    <th className="ee-coa-no">No.</th>
                    <th>Name</th>
                    <th>
                      Account type <span className="ee-coa-sort" aria-hidden="true">↕</span>
                    </th>
                    <th>Detail type</th>
                    <th>Currency</th>
                    <th>Default tax code</th>
                    <th className="num">ERP balance</th>
                    <th className="num">Bank balance</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ account: a, depth }) => {
                    const meta = accountMeta(a);
                    const bal = toNumber(a.currentBalance);
                    return (
                      <Fragment key={a.id}>
                        <tr className={`${selected[a.id] ? "selected" : ""} ${a.isActive ? "" : "inactive"}`}>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(selected[a.id])}
                              onChange={(e) => setSelected((s) => ({ ...s, [a.id]: e.target.checked }))}
                              aria-label={`Select ${a.name}`}
                            />
                          </td>
                          <td className="mono ee-coa-no">{a.code}</td>
                          <td>
                            <button
                              type="button"
                              className="ee-coa-name"
                              style={{ paddingLeft: depth ? depth * 14 : 0 }}
                              onClick={() => navigate(`/ledger?account=${a.id}`)}
                            >
                              {a.name}
                              {!a.isActive && (
                                <>
                                  {" "}
                                  <Badge>Inactive</Badge>
                                </>
                              )}
                            </button>
                          </td>
                          <td>
                            <span className="ee-coa-atype">
                              {meta.accountType}
                              {(a.type === "ASSET" || a.type === "LIABILITY" || a.type === "EQUITY") && (
                                <span className="ee-coa-bal-badge">BAL</span>
                              )}
                            </span>
                          </td>
                          <td>{meta.detailType}</td>
                          <td>{a.currency || currency || "RWF"}</td>
                          <td>{a.taxMapping || <span className="subtle">—</span>}</td>
                          <td className="num">{money(bal, a.currency || currency || "RWF")}</td>
                          <td className="num">
                            {a.isCashAccount ? <span className="subtle">—</span> : <span className="subtle">—</span>}
                          </td>
                          <td>
                            <div className="ee-coa-row-actions">
                              <button type="button" className="ee-link-btn" onClick={() => navigate(`/ledger?account=${a.id}`)}>
                                Account history
                              </button>
                              <button type="button" className="ee-coa-action-more" aria-label="More actions" onClick={() => toast(`Actions for ${a.code}`)}>
                                <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <EmptyState title="No accounts match" body="Try a different search or account type." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Loadable>

        {dash.data && (
          <p className="ee-coa-caption">
            {dash.data.active} active accounts
            {dash.data.inactive ? ` · ${dash.data.inactive} inactive` : ""}
          </p>
        )}

      {creating && dash.data && (
        <NewAccountDrawer
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
    </div>
  );
}

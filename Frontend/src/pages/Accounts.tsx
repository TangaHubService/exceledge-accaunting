import {
  ChevronDown,
  Lock,
  Pencil,
  Plus,
  Printer,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { NewAccountDrawer } from "../components/coa/NewAccountDrawer";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Pagination } from "../components/Pagination";
import { Badge, EmptyState, Loadable, SkeletonRows } from "../components/ui";
import { usePagedResource } from "../lib/pagination";
import { useCompany } from "../lib/company";
import { useCoaSettings } from "../lib/coa-settings";
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

export const BALANCE_SHEET = new Set<AccountType>(["ASSET", "LIABILITY", "EQUITY"]);
const DEBIT_NORMAL = new Set<AccountType>(["ASSET", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);

/** Balances are stored debit-positive; show them on the account's normal side, as QuickBooks does. */
export function naturalBalance(a: Pick<Account, "type" | "currentBalance">) {
  const raw = toNumber(a.currentBalance);
  return DEBIT_NORMAL.has(a.type) ? raw : -raw;
}

type TreeNode = Account & { children: TreeNode[] };

/** Allow a line break after "/" (e.g. "Advertising/Promotional") without breaking inside words. */
function breakable(text: string) {
  const parts = text.split("/");
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}
type FlatRow = { account: Account; depth: number; isParent: boolean };
/** A row of the paged list from /api/v1/coa/rows. */
type AccountRow = Account & { depth: number; hasChildren: boolean };
type SortKey = "code" | "name" | "type" | "balance";
type Sort = { key: SortKey; dir: 1 | -1 };

export function accountMeta(a: Account) {
  const decoded = decodeReportingGroup(a.reportingGroup);
  if (!decoded.accountType && a.type === "ASSET" && a.isCashAccount) {
    // Older bank / cash accounts created from Banking carry no QuickBooks type; infer it.
    return {
      accountType: "Cash and cash equivalents",
      detailType: a.bankReconciliationRequired ? "Bank" : "Cash on hand",
    };
  }
  return {
    accountType: decoded.accountType || TYPE_LABELS[a.type] || a.type,
    // The description is free text, never a detail type.
    detailType: decoded.detailType || "—",
  };
}

/** QuickBooks lists account types in a fixed order (Bank, A/R, current assets, …), the order of the type picker. */
function qbTypeRank(label: string) {
  const i = ALL_ACCOUNT_TYPE_LABELS.indexOf(label);
  return i < 0 ? ALL_ACCOUNT_TYPE_LABELS.length : i;
}

function compare(a: Account, b: Account, sort: Sort) {
  let d = 0;
  if (sort.key === "code") d = a.code.localeCompare(b.code, undefined, { numeric: true });
  else if (sort.key === "name") d = a.name.localeCompare(b.name);
  else if (sort.key === "type")
    d = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || qbTypeRank(accountMeta(a).accountType) - qbTypeRank(accountMeta(b).accountType) || accountMeta(a).accountType.localeCompare(accountMeta(b).accountType) || a.name.localeCompare(b.name);
  else d = naturalBalance(a) - naturalBalance(b);
  return (d || a.code.localeCompare(b.code, undefined, { numeric: true })) * sort.dir;
}

/** Sorts siblings only, so subaccounts always stay under their parent. */
function flatten(nodes: TreeNode[], sort: Sort, depth = 0, out: FlatRow[] = []) {
  for (const n of [...nodes].sort((a, b) => compare(a, b, sort))) {
    out.push({ account: n, depth, isParent: Boolean(n.children?.length) });
    flatten(n.children ?? [], sort, depth + 1, out);
  }
  return out;
}

/** Never used: no postings, zero balance, not a system account — safe to make inactive. */
function isUnused(a: Account) {
  return a.isActive && !a.systemProtected && !a.hasPostedTransactions && toNumber(a.currentBalance) === 0;
}

type RowMenu = { account: Account; anchor: HTMLElement; top: number; left: number };
const ROW_MENU_WIDTH = 200;

function menuPosition(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.right - ROW_MENU_WIDTH, window.innerWidth - ROW_MENU_WIDTH - 8)) };
}
type Draft = Record<string, { code: string; name: string }>;

/** Columns the table settings can hide, as in QuickBooks' chart of accounts gear menu. */
const OPTIONAL_COLUMNS = [
  { key: "type", label: "Account type" },
  { key: "detail", label: "Detail type" },
  { key: "currency", label: "Currency" },
  { key: "tax", label: "Tax code" },
  { key: "balance", label: "Balance" },
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]["key"];
const HIDDEN_COLUMNS_KEY = "coa-hidden-columns";

function readHiddenColumns(): Set<OptionalColumn> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export function Accounts() {
  const { can, api, download } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency, reload: reloadCompany } = useCompany();
  // QuickBooks "Enable account numbers": when off, the Number column and number boxes are hidden.
  const { useAccountNumbers: numbersOn } = useCoaSettings();
  const tree = useResource<TreeNode[]>("/api/v1/coa/tree");
  const dash = useResource<CoaDashboard>("/api/v1/coa/dashboard");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "code", dir: 1 });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<OptionalColumn>>(readHiddenColumns);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const batchRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const show = (c: OptionalColumn) => !hidden.has(c) && (c !== "currency" || multiCurrency);

  function toggleColumn(c: OptionalColumn) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      try {
        localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...next]));
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  }

  const allAccounts = useMemo(() => flatten(tree.data ?? [], { key: "code", dir: 1 }).map((r) => r.account), [tree.data]);
  const byId = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
  // Like QuickBooks, the Currency column only exists once accounts use more than one currency.
  const multiCurrency = useMemo(() => new Set(allAccounts.map((a) => a.currency || currency || "RWF")).size > 1, [allAccounts, currency]);
  const columnOptions = OPTIONAL_COLUMNS.filter((c) => c.key !== "currency" || multiCurrency);
  const visibleOptional = columnOptions.filter((c) => !hidden.has(c.key)).length;

  // Wait for a pause in typing before asking the server for the filtered page.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // The table is paged on the server: it filters, sorts (keeping subaccounts under their parent) and slices.
  // With account numbers off there is no Number column: like QuickBooks, order by account type, then name.
  const effectiveSort = !numbersOn && sort.key === "code" ? "type" : sort.key;
  const list = usePagedResource<AccountRow>(
    "/api/v1/coa/rows",
    {
      q: query,
      type: typeFilter,
      includeInactive: showInactive || undefined,
      unused: cleanup || undefined,
      searchNumbers: numbersOn ? undefined : false,
      sort: effectiveSort,
      dir: sort.dir === 1 ? "asc" : "desc",
    },
    // QuickBooks' rows-per-page choices for the chart of accounts.
    { key: "chart-of-accounts", defaultPageSize: 50, pageSizeOptions: [50, 75, 100, 150, 300] },
  );
  const rows: FlatRow[] = useMemo(() => list.rows.map((a) => ({ account: a, depth: a.depth, isParent: a.hasChildren })), [list.rows]);

  const selectedIds = Object.keys(selected).filter((id) => selected[id] && byId.has(id));
  const allSelected = rows.length > 0 && rows.every((r) => selected[r.account.id]);

  // Close the floating menus on outside click, scroll or Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (newMenuRef.current && !newMenuRef.current.contains(t)) setNewMenuOpen(false);
      if (batchRef.current && !batchRef.current.contains(t)) setBatchOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(t)) setSettingsOpen(false);
      if (!(t as HTMLElement).closest?.(".ee-coa-row-menu, .ee-coa-action-more")) setRowMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNewMenuOpen(false);
        setBatchOpen(false);
        setSettingsOpen(false);
        setRowMenu(null);
      }
    }
    // Keep the row menu pinned to its button while anything scrolls; close it once the button leaves the screen.
    function onScroll() {
      setRowMenu((m) => {
        if (!m) return m;
        const r = m.anchor.getBoundingClientRect();
        if (!m.anchor.isConnected || r.bottom < 0 || r.top > window.innerHeight) return null;
        return { ...m, ...menuPosition(m.anchor) };
      });
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  function reloadAll() {
    tree.reload();
    list.reload();
    dash.reload();
    reloadCompany();
  }

  function toggleAll(on: boolean) {
    if (!on) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.account.id] = true;
    setSelected(next);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function sortMark(key: SortKey) {
    if (sort.key !== key) return <span className="ee-coa-sort" aria-hidden="true">↕</span>;
    return <span className="ee-coa-sort on" aria-hidden="true">{sort.dir === 1 ? "↑" : "↓"}</span>;
  }

  function ariaSort(key: SortKey) {
    return sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none";
  }

  async function exportCsv() {
    try {
      await download("/api/v1/coa/export?format=csv", "chart-of-accounts.csv");
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  function subaccountCount(a: Account) {
    let n = 0;
    const walk = (id: string) => {
      for (const c of allAccounts) {
        if (c.parentId === id && c.isActive) {
          n++;
          walk(c.id);
        }
      }
    };
    walk(a.id);
    return n;
  }

  async function setActive(a: Account, isActive: boolean) {
    if (!isActive) {
      const subs = subaccountCount(a);
      const bal = naturalBalance(a);
      const ok = await confirm({
        title: `Make ${label(a)} inactive?`,
        body: (
          <>
            Nothing new can be posted to an inactive account. Its history stays in your reports.
            {subs > 0 && <> Its {subs} subaccount{subs === 1 ? "" : "s"} will also be made inactive.</>}
            {bal !== 0 && (
              <>
                {" "}
                It still has a balance of {money(bal, a.currency || currency || "RWF")}; consider moving it with a journal entry first.
              </>
            )}
          </>
        ),
        confirmLabel: "Make inactive",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api(`/api/v1/coa/${a.id}/${isActive ? "reactivate" : "deactivate"}`, { method: "POST", body: "{}" });
      toast(`${label(a)} is now ${isActive ? "active" : "inactive"}`);
      reloadAll();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  async function remove(a: Account) {
    const ok = await confirm({
      title: `Delete ${label(a)}?`,
      body: "This account has never been used, so it can be removed for good. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/coa/${a.id}`, { method: "DELETE" });
      toast(`${label(a)} deleted`);
      reloadAll();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  async function batch(isActive: boolean) {
    setBatchOpen(false);
    const ids = selectedIds.filter((id) => byId.get(id)!.isActive !== isActive);
    if (!ids.length) {
      toast(`The selected accounts are already ${isActive ? "active" : "inactive"}`);
      return;
    }
    if (!isActive) {
      const ok = await confirm({
        title: `Make ${ids.length} account${ids.length === 1 ? "" : "s"} inactive?`,
        body: "Their subaccounts are made inactive too. History stays in your reports.",
        confirmLabel: "Make inactive",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api<{ updated: number; results: Array<{ id: string; ok: boolean; error?: string }> }>(
        `/api/v1/coa/batch/${isActive ? "reactivate" : "deactivate"}`,
        { method: "POST", body: JSON.stringify({ ids }) },
      );
      const failed = res.results.filter((r) => !r.ok);
      toast(`${res.updated} account${res.updated === 1 ? "" : "s"} made ${isActive ? "active" : "inactive"}`);
      if (failed.length) {
        const first = failed[0];
        const acc = byId.get(first.id);
        toast(`${failed.length} not changed — ${acc ? `${acc.code}: ` : ""}${first.error}`, { error: true });
      }
      setSelected({});
      reloadAll();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  function startEditMode() {
    const d: Draft = {};
    for (const a of allAccounts) d[a.id] = { code: a.code, name: a.name };
    setDraft(d);
    setRowErrors({});
    setEditMode(true);
    setCleanup(false);
  }

  /** How an account is named in messages: with its number only when account numbers are on. */
  const label = (a: Account) => (numbersOn ? `${a.code} ${a.name}` : a.name);

  /** A sibling (same parent) that already uses this name, if any. */
  function siblingNamed(a: Account, name: string) {
    const key = name.trim().toLowerCase();
    return allAccounts.find((o) => o.id !== a.id && (o.parentId ?? null) === (a.parentId ?? null) && o.name.trim().toLowerCase() === key);
  }

  /** QuickBooks merge: same parent, same account type and detail type; the renamed account folds into the other. */
  async function offerMerge(a: Account, into: Account): Promise<"merged" | "declined" | "not-allowed"> {
    if (a.systemProtected || a.type !== into.type || (a.reportingGroup ?? "") !== (into.reportingGroup ?? "")) return "not-allowed";
    const ok = await confirm({
      title: `Merge ${a.name} into ${into.name}?`,
      body: (
        <>
          That name is already used by {numbersOn ? `${into.code} ` : ""}
          {into.name}. Merging moves all of {a.name}&apos;s transactions, balance and subaccounts into {into.name}, and {a.name} is removed. This
          cannot be undone.
        </>
      ),
      confirmLabel: "Merge accounts",
      danger: true,
    });
    if (!ok) return "declined";
    await api(`/api/v1/coa/${a.id}/merge`, { method: "POST", body: JSON.stringify({ targetId: into.id }) });
    toast(`${a.name} merged into ${into.name}`);
    return "merged";
  }

  async function saveEditMode() {
    const changes = allAccounts.filter((a) => {
      const d = draft[a.id];
      return d && (d.code.trim() !== a.code || d.name.trim() !== a.name);
    });
    if (!changes.length) {
      setEditMode(false);
      return;
    }
    setBusy(true);
    const errors: Record<string, string> = {};
    let saved = 0;
    for (const a of changes) {
      const d = draft[a.id];
      const body: Record<string, string> = {};
      if (d.code.trim() !== a.code) body.code = d.code.trim();
      if (d.name.trim() !== a.name) body.name = d.name.trim();
      try {
        const twin = body.name ? siblingNamed(a, body.name) : undefined;
        if (twin) {
          const outcome = await offerMerge(a, twin);
          if (outcome === "merged") {
            saved++;
            continue;
          }
          errors[a.id] =
            outcome === "declined"
              ? "Another account under the same parent already has this name"
              : "That name is taken by an account of a different type, so they can't be merged";
          continue;
        }
        await api(`/api/v1/coa/${a.id}`, { method: "PATCH", body: JSON.stringify(body) });
        saved++;
      } catch (e) {
        errors[a.id] = (e as Error).message;
      }
    }
    setBusy(false);
    setRowErrors(errors);
    if (saved) {
      toast(`${saved} account${saved === 1 ? "" : "s"} updated`);
      reloadAll();
    }
    if (Object.keys(errors).length) {
      toast(`${Object.keys(errors).length} change${Object.keys(errors).length === 1 ? "" : "s"} could not be saved — see the highlighted rows`, { error: true });
    } else {
      setEditMode(false);
    }
  }

  function openRowMenu(a: Account, el: HTMLElement) {
    setRowMenu((m) => (m?.account.id === a.id ? null : { account: a, anchor: el, ...menuPosition(el) }));
  }

  const unusedCount = useMemo(() => allAccounts.filter(isUnused).length, [allAccounts]);

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
          {can("report:view") && (
            <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/reports/view/account-list")} title="Open the Account List report">
              Run report
            </button>
          )}
          {can("coa:create") && (
            <div className="ee-coa-new-wrap" ref={newMenuRef}>
              <button type="button" className="btn btn-primary ee-coa-new-btn" onClick={() => setCreating(true)}>
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                New
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
                  {can("coa:import") && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setNewMenuOpen(false);
                        // QuickBooks: Import opens Import data, where "Chart of accounts" continues the import.
                        navigate("/import-data");
                      }}
                    >
                      Import chart of accounts
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNewMenuOpen(false);
                      setEditMode(false);
                      setCleanup(true);
                      setSelected({});
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

      {cleanup && (
        <div className="ee-coa-banner" role="status">
          <div>
            <strong>Clean up chart of accounts</strong>
            <span>
              {unusedCount === 0
                ? "Every active account has been used — nothing to clean up."
                : `${unusedCount} account${unusedCount === 1 ? " has" : "s have"} never been used. Select the ones you don't need and make them inactive.`}
            </span>
          </div>
          <button type="button" className="btn ee-btn-outline-blue" onClick={() => { setCleanup(false); setSelected({}); }}>
            Done
          </button>
        </div>
      )}

      <div className="ee-coa-toolbar">
        {selectedIds.length > 0 && !editMode ? (
          <div className="ee-coa-batch" ref={batchRef}>
            <span className="ee-coa-batch-count">{selectedIds.length} selected</span>
            <div className="ee-coa-new-wrap">
              <button type="button" className="btn ee-btn-outline-blue" disabled={busy} aria-expanded={batchOpen} onClick={() => setBatchOpen((v) => !v)}>
                Batch actions <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              {batchOpen && (
                <div className="ee-coa-new-menu ee-coa-batch-menu" role="menu">
                  {can("coa:deactivate") && (
                    <button type="button" role="menuitem" onClick={() => void batch(false)}>
                      Make inactive
                    </button>
                  )}
                  {can("coa:edit") && (
                    <button type="button" role="menuitem" onClick={() => void batch(true)}>
                      Make active
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="ee-coa-tool" onClick={() => setSelected({})}>
              Clear selection
            </button>
          </div>
        ) : (
          <>
            <label className="ee-coa-search">
              <Search size={15} strokeWidth={1.75} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={numbersOn ? "Filter by name or number" : "Filter by name"}
                aria-label={numbersOn ? "Filter by name or number" : "Filter by name"}
                disabled={cleanup}
              />
            </label>
            <Select
              className="ee-coa-filter-select"
              value={typeFilter}
              onChange={setTypeFilter}
              aria-label="Filter by account type"
              searchable
              disabled={cleanup}
              options={[
                { value: "", label: "All account types" },
                ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABELS[t], group: "Category" })),
                ...ALL_ACCOUNT_TYPE_LABELS.map((l) => ({ value: l, label: l, group: "Account type" })),
              ]}
            />
          </>
        )}
        <div className="ee-coa-tools">
          {editMode ? (
            <>
              <button type="button" className="btn ee-btn-outline-blue" disabled={busy} onClick={() => { setEditMode(false); setRowErrors({}); }}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveEditMode()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <>
              {can("coa:edit") && (
                <button type="button" className="ee-coa-tool" onClick={startEditMode} title={numbersOn ? "Edit account numbers and names in the list" : "Edit account names in the list"}>
                  <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> Edit mode
                </button>
              )}
              {can("coa:export") && (
                <button type="button" className="ee-coa-tool" onClick={() => void exportCsv()}>
                  <Upload size={14} strokeWidth={1.75} aria-hidden="true" /> Export
                </button>
              )}
              <button type="button" className="ee-coa-tool" onClick={() => window.print()}>
                <Printer size={14} strokeWidth={1.75} aria-hidden="true" /> Print
              </button>
              <div className="ee-coa-new-wrap" ref={settingsRef}>
                <button type="button" className="ee-coa-tool" aria-haspopup="true" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
                  <Settings size={14} strokeWidth={1.75} aria-hidden="true" /> Settings
                </button>
                {settingsOpen && (
                  <div className="ee-coa-new-menu ee-coa-settings-menu" role="group" aria-label="Table settings">
                    <div className="ee-coa-settings-title">Columns</div>
                    {columnOptions.map((c) => (
                      <label key={c.key} className="ee-coa-settings-opt">
                        <input type="checkbox" checked={show(c.key)} onChange={() => toggleColumn(c.key)} />
                        {c.label}
                      </label>
                    ))}
                    <div className="ee-coa-settings-title">Rows</div>
                    <label className="ee-coa-settings-opt">
                      <input type="checkbox" checked={showInactive} disabled={cleanup} onChange={(e) => setShowInactive(e.target.checked)} />
                      Include inactive
                    </label>
                    {can("setup:view") && (
                      <button type="button" className="ee-coa-settings-link" onClick={() => { setSettingsOpen(false); navigate("/settings/advanced"); }}>
                        Account numbers and other settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Loadable resource={list} skeleton={<SkeletonRows rows={10} cols={6} />}>
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
                      disabled={editMode}
                    />
                  </th>
                  {numbersOn && (
                    <th className="ee-coa-no" aria-sort={ariaSort("code")}>
                      <button type="button" className="ee-coa-th-sort" onClick={() => toggleSort("code")}>Number {sortMark("code")}</button>
                    </th>
                  )}
                  <th className="ee-coa-name-col" aria-sort={ariaSort("name")}>
                    <button type="button" className="ee-coa-th-sort" onClick={() => toggleSort("name")}>Name {sortMark("name")}</button>
                  </th>
                  {show("type") && (
                    <th aria-sort={ariaSort("type")}>
                      <button type="button" className="ee-coa-th-sort" onClick={() => toggleSort("type")}>Account type {sortMark("type")}</button>
                    </th>
                  )}
                  {show("detail") && <th className="ee-coa-detail">Detail type</th>}
                  {show("currency") && <th>Currency</th>}
                  {show("tax") && <th>Tax code</th>}
                  {show("balance") && (
                    <th className="num" aria-sort={ariaSort("balance")}>
                      <button type="button" className="ee-coa-th-sort" onClick={() => toggleSort("balance")}>Balance {sortMark("balance")}</button>
                    </th>
                  )}
                  <th className="ee-coa-print-hide">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ account: a, depth }) => {
                  const meta = accountMeta(a);
                  const cur = a.currency || currency || "RWF";
                  const isBs = BALANCE_SHEET.has(a.type);
                  const d = draft[a.id];
                  const err = rowErrors[a.id];
                  return (
                    <tr key={a.id} className={`${selected[a.id] ? "selected" : ""} ${a.isActive ? "" : "inactive"} ${err ? "has-error" : ""}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[a.id])}
                          onChange={(e) => setSelected((s) => ({ ...s, [a.id]: e.target.checked }))}
                          aria-label={`Select ${a.name}`}
                          disabled={editMode}
                        />
                      </td>
                      {numbersOn && (
                        <td className="mono ee-coa-no">
                          {editMode && d ? (
                            <input
                              className="input mono ee-coa-inline"
                              value={d.code}
                              disabled={a.systemProtected}
                              title={a.systemProtected ? "System account number is fixed" : undefined}
                              // QuickBooks numbers: up to 7 letters, digits, "." or "-"; they can change at any time.
                              onChange={(e) => setDraft((x) => ({ ...x, [a.id]: { ...x[a.id], code: e.target.value.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 7) } }))}
                              aria-label={`Number for ${a.name}`}
                            />
                          ) : (
                            a.code
                          )}
                        </td>
                      )}
                      <td>
                        {editMode && d ? (
                          <div style={{ paddingLeft: depth ? depth * 14 : 0 }}>
                            <input
                              className="input ee-coa-inline ee-coa-inline-name"
                              value={d.name}
                              disabled={a.systemProtected}
                              onChange={(e) => setDraft((x) => ({ ...x, [a.id]: { ...x[a.id], name: e.target.value } }))}
                              aria-label={`Name for ${a.code}`}
                            />
                            {err && <div className="field-error" role="alert">{err}</div>}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="ee-coa-name"
                            style={{ paddingLeft: depth ? depth * 14 : 0 }}
                            onClick={() => navigate(`/ledger?account=${a.id}`)}
                          >
                            {breakable(a.name)}
                            {!a.allowManualPost && (
                              <span className="ee-coa-lock-mark" title="Locked: manual journal entries are blocked" aria-label="Locked">
                                <Lock size={12} strokeWidth={2} aria-hidden="true" />
                              </span>
                            )}
                            {!a.isActive && (
                              <>
                                {" "}
                                <Badge>Inactive</Badge>
                              </>
                            )}
                          </button>
                        )}
                      </td>
                      {show("type") && (
                        <td>
                          <span className="ee-coa-atype">{meta.accountType}</span>
                        </td>
                      )}
                      {show("detail") && <td className="ee-coa-detail">{breakable(meta.detailType)}</td>}
                      {show("currency") && <td>{cur}</td>}
                      {show("tax") && <td>{a.taxMapping || <span className="subtle">—</span>}</td>}
                      {show("balance") && <td className="num">{isBs ? money(naturalBalance(a), cur) : <span className="subtle">—</span>}</td>}
                      <td className="ee-coa-print-hide">
                        <div className="ee-coa-row-actions">
                          <button type="button" className="ee-link-btn" onClick={() => navigate(`/ledger?account=${a.id}`)}>
                            {isBs ? "Account history" : "Run report"}
                          </button>
                          <button
                            type="button"
                            className="ee-coa-action-more"
                            aria-label={`More actions for ${label(a)}`}
                            aria-haspopup="menu"
                            aria-expanded={rowMenu?.account.id === a.id}
                            disabled={editMode}
                            onClick={(e) => openRowMenu(a, e.currentTarget)}
                          >
                            <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={(numbersOn ? 4 : 3) + visibleOptional} style={{ padding: 0 }}>
                      {cleanup ? (
                        <EmptyState title="Nothing to clean up" body="Every active account has postings or is a system account." />
                      ) : (
                        <EmptyState title="No accounts match" body="Try a different search or account type." />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Loadable>

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPage={list.setPage}
        onPageSize={list.setPageSize}
        pageSizeOptions={list.pageSizeOptions}
        label="Chart of accounts pages"
      />

      {dash.data && (
        <p className="ee-coa-caption">
          {dash.data.active} active accounts
          {dash.data.inactive ? ` · ${dash.data.inactive} inactive` : ""}
        </p>
      )}

      {rowMenu && (
        <div className="ee-coa-new-menu ee-coa-row-menu" role="menu" style={{ position: "fixed", top: rowMenu.top, left: rowMenu.left, right: "auto", width: ROW_MENU_WIDTH }}>
          {can("coa:edit") && (
            <button type="button" role="menuitem" onClick={() => { setEditing(rowMenu.account); setRowMenu(null); }}>
              Edit
            </button>
          )}
          {rowMenu.account.isActive
            ? can("coa:deactivate") && !rowMenu.account.systemProtected && (
                <button type="button" role="menuitem" onClick={() => { const a = rowMenu.account; setRowMenu(null); void setActive(a, false); }}>
                  Make inactive
                </button>
              )
            : can("coa:edit") && (
                <button type="button" role="menuitem" onClick={() => { const a = rowMenu.account; setRowMenu(null); void setActive(a, true); }}>
                  Make active
                </button>
              )}
          {/* QuickBooks: balance sheet rows add "Run report" here; income and expense rows already lead with it. */}
          {BALANCE_SHEET.has(rowMenu.account.type) && (
            <button type="button" role="menuitem" onClick={() => { const a = rowMenu.account; setRowMenu(null); navigate(`/ledger?account=${a.id}`); }}>
              Run report
            </button>
          )}
          {can("coa:deactivate") &&
            !rowMenu.account.systemProtected &&
            !rowMenu.account.hasPostedTransactions &&
            !allAccounts.some((c) => c.parentId === rowMenu.account.id) && (
              <button type="button" role="menuitem" className="danger" onClick={() => { const a = rowMenu.account; setRowMenu(null); void remove(a); }}>
                Delete
              </button>
            )}
        </div>
      )}

      {/* Open straight away: categories only seed number suggestions, so a slow or failed dashboard must not swallow the click. */}
      {(creating || editing) && (
        <NewAccountDrawer
          categories={dash.data?.categories ?? []}
          accounts={allAccounts}
          account={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            reloadAll();
          }}
        />
      )}

    </div>
  );
}

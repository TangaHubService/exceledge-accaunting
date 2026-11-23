import { capabilitiesForRole, type AccountingCapability } from "@exceledge/accounting-domain-web";

/**
 * Manage users (QuickBooks model). People and their roles live in Excel Edge ERP; the accounting
 * API at /api/v1/users passes each call through with the signed-in user's own session.
 */

export type ManagedUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string | null;
  customRole: { id: string; name: string } | null;
  firmName: string | null;
};

export type PendingInvitation = {
  id: number;
  email: string;
  role: string;
  status: "INVITED" | "EXPIRED";
  invitedAt: string;
  expiresAt: string;
  invitedBy: string | null;
  branchId: number | null;
  customRole: { id: string; name: string } | null;
  firmName: string | null;
};

export type UsersPayload = { users: ManagedUser[]; invitations: PendingInvitation[] };

/** Roles an admin can give someone (the ERP never lets anyone assign System owner). */
export const ASSIGNABLE_ROLES = ["ADMIN", "ACCOUNTANT", "BRANCH_MANAGER", "SELLER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

type RoleInfo = { label: string; description: string };

/** Names and one-line descriptions in QuickBooks' wording. */
export const ROLE_INFO: Record<string, RoleInfo> = {
  SYSTEM_OWNER: { label: "System owner", description: "Excel Edge platform owner with full access to every company." },
  ADMIN: { label: "Company admin", description: "Full access to the books, settings and user administration." },
  ACCOUNTANT: {
    label: "Accountant",
    description: "Bookkeeping, banking, tax, reports and period close. No user administration.",
  },
  BRANCH_MANAGER: {
    label: "Branch manager",
    description: "Views the books and reports, records expenses and edits the chart of accounts. Cannot post journal entries or approve.",
  },
  SELLER: { label: "Sales only (no Accounting)", description: "Uses Excel Edge point of sale only. Cannot open Accounting." },
};

export function roleLabel(role: string) {
  return ROLE_INFO[role]?.label ?? role.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** Plain-language areas a role can view or change, derived from the real permission list. */
const AREAS: Array<{ label: string; view: AccountingCapability; manage?: AccountingCapability }> = [
  { label: "Sales and customers", view: "ar:view", manage: "ar:manage" },
  { label: "Expenses and suppliers", view: "ap:view", manage: "ap:manage" },
  { label: "Banking", view: "bank:view", manage: "bank:manage" },
  { label: "Products and inventory", view: "inventory:view", manage: "inventory:manage" },
  { label: "Journal entries", view: "journal:view", manage: "journal:post" },
  { label: "Chart of accounts", view: "coa:view", manage: "coa:edit" },
  { label: "Tax", view: "tax:view", manage: "tax:manage" },
  { label: "Fixed assets", view: "fa:view", manage: "fa:manage" },
  { label: "Budgets", view: "budget:view", manage: "budget:manage" },
  { label: "Period close", view: "close:view", manage: "close:manage" },
  { label: "Reports", view: "report:view" },
  { label: "Company settings", view: "setup:view", manage: "setup:approve" },
  { label: "Manage users", view: "setup:approve" },
];

export type AreaAccess = { label: string; access: "Full" | "View only" | "None" };

export function roleAccess(role: string): AreaAccess[] {
  return accessFromCapabilities(capabilitiesForRole(role));
}

/** The same plain-language summary for any list of capabilities (custom roles). */
export function accessFromCapabilities(list: readonly string[]): AreaAccess[] {
  const caps = new Set(list);
  return AREAS.map((a) => {
    if (a.manage && caps.has(a.manage)) return { label: a.label, access: "Full" };
    if (caps.has(a.view)) return { label: a.label, access: a.manage ? "View only" : "Full" };
    return { label: a.label, access: "None" };
  });
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

/** A role choice in the pickers: a built-in Excel Edge role, or a company custom role. */
export type RoleChoice = { role: AssignableRole; customRoleId?: undefined } | { role?: undefined; customRoleId: string };

export const usersApi = {
  list: (api: Api) => api<UsersPayload>("/api/v1/users"),
  invite: (api: Api, input: RoleChoice & { email: string; branchId?: number | null }) =>
    api<{ message: string }>("/api/v1/users/invite", json("POST", input)),
  update: (api: Api, id: number, patch: { role?: AssignableRole; customRoleId?: string; isActive?: boolean }) =>
    api<void>(`/api/v1/users/${id}`, json("PATCH", patch)),
  transferPrimaryAdmin: (api: Api, id: number) => api<void>(`/api/v1/users/${id}/transfer-primary-admin`, json("POST")),
  roles: (api: Api) => api<{ roles: CustomRole[]; grantable: string[]; adminOnly: string[] }>("/api/v1/users/roles"),
  createRole: (api: Api, input: RoleInput) => api<CustomRole>("/api/v1/users/roles", json("POST", input)),
  updateRole: (api: Api, id: string, input: RoleInput) =>
    api<CustomRole & { holdersUpdated: number }>(`/api/v1/users/roles/${id}`, json("PUT", input)),
  deleteRole: (api: Api, id: string) => api<void>(`/api/v1/users/roles/${id}`, json("DELETE")),
  firms: (api: Api) => api<AccountingFirm[]>("/api/v1/users/firms"),
  inviteFirm: (api: Api, input: { firmName: string; email: string }) => api<AccountingFirm>("/api/v1/users/firms", json("POST", input)),
  removeFirm: (api: Api, id: string) => api<void>(`/api/v1/users/firms/${id}`, json("DELETE")),
  remove: (api: Api, id: number) => api<void>(`/api/v1/users/${id}`, json("DELETE")),
  cancelInvite: (api: Api, id: number) => api<void>(`/api/v1/users/invitations/${id}`, json("DELETE")),
  resendInvite: (api: Api, id: number) => api<void>(`/api/v1/users/invitations/${id}/resend`, json("POST")),
};

const AVATAR_COLORS = ["#2f6fed", "#7c3aed", "#0e9384", "#c4320a", "#b42318", "#3538cd", "#027a48"];

export function avatarFor(nameOrEmail: string) {
  const parts = nameOrEmail.split(/[\s@.]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  let hash = 0;
  for (const ch of nameOrEmail) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return { initials, color: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] };
}

/* ── Custom roles (QuickBooks model) ───────────────────────────────────────────── */

export type CustomRoleErpRole = "ACCOUNTANT" | "BRANCH_MANAGER" | "SELLER";

export type CustomRole = {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  erpRole: CustomRoleErpRole;
  users: number;
  pendingInvites: number;
  updatedAt: string;
};

export type RoleInput = { name: string; description?: string | null; capabilities: string[]; erpRole: CustomRoleErpRole };

export type AccountingFirm = {
  id: string;
  firmName: string;
  email: string;
  invitedAt: string;
  status: "ACTIVE" | "INACTIVE" | "INVITED" | "EXPIRED" | "NOT_CONNECTED";
  userId: number | null;
  contactName: string | null;
  invitationId: number | null;
};

/** What a custom role's holder can do inside Excel Edge itself (outside Accounting). */
export const CUSTOM_ROLE_ERP_ROLES: Array<{ value: CustomRoleErpRole; label: string; description: string }> = [
  { value: "ACCOUNTANT", label: "Back office", description: "No point-of-sale selling. Typical for finance staff." },
  { value: "BRANCH_MANAGER", label: "Branch manager", description: "Runs a branch in Excel Edge (stock, staff, sales)." },
  { value: "SELLER", label: "Point of sale", description: "Sells at the till in Excel Edge." },
];

type PermissionItem = { capability: AccountingCapability; label: string };
export type PermissionArea = { key: string; label: string; description: string; items: PermissionItem[] };

/** Every permission a custom role can hold, grouped and worded like QuickBooks. */
export const PERMISSION_AREAS: PermissionArea[] = [
  {
    key: "sales",
    label: "Sales and customers",
    description: "Customers, estimates, invoices, receipts and credit notes.",
    items: [
      { capability: "ar:view", label: "View customers and sales" },
      { capability: "ar:manage", label: "Create and edit sales transactions" },
      { capability: "ar:credit-override", label: "Sell over a customer's credit limit" },
    ],
  },
  {
    key: "expenses",
    label: "Expenses and suppliers",
    description: "Suppliers, bills, payments and expense claims.",
    items: [
      { capability: "ap:view", label: "View suppliers and bills" },
      { capability: "ap:manage", label: "Create and edit bills and payments" },
      { capability: "expense:view", label: "View expenses" },
      { capability: "expense:manage", label: "Record expenses" },
      { capability: "expense:approve", label: "Approve expenses" },
    ],
  },
  {
    key: "banking",
    label: "Banking",
    description: "Bank accounts, transactions, rules and reconciliation.",
    items: [
      { capability: "bank:view", label: "View bank accounts and transactions" },
      { capability: "bank:manage", label: "Categorise, match and reconcile" },
      { capability: "bank:approve", label: "Approve bank transactions" },
    ],
  },
  {
    key: "inventory",
    label: "Products and inventory",
    description: "Products, services and stock movements.",
    items: [
      { capability: "inventory:view", label: "View products and stock" },
      { capability: "inventory:manage", label: "Add and edit products, adjust stock" },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    description: "Journal entries, chart of accounts and the general ledger.",
    items: [
      { capability: "journal:view", label: "View journal entries" },
      { capability: "journal:create", label: "Create journal entries" },
      { capability: "journal:post", label: "Post journal entries" },
      { capability: "journal:approve", label: "Approve journal entries" },
      { capability: "journal:reverse", label: "Reverse journal entries" },
      { capability: "gl:view", label: "View the general ledger" },
      { capability: "coa:view", label: "View the chart of accounts" },
      { capability: "coa:create", label: "Add accounts" },
      { capability: "coa:edit", label: "Edit accounts" },
      { capability: "coa:deactivate", label: "Make accounts inactive" },
      { capability: "coa:import", label: "Import accounts" },
      { capability: "coa:export", label: "Export accounts" },
      { capability: "fx:manage", label: "Manage currencies and exchange rates" },
      { capability: "exceptions:view", label: "View integration exceptions" },
      { capability: "exceptions:retry", label: "Retry integration exceptions" },
    ],
  },
  {
    key: "tax",
    label: "Tax",
    description: "Tax codes, returns and payments.",
    items: [
      { capability: "tax:view", label: "View tax" },
      { capability: "tax:manage", label: "Manage tax codes and adjustments" },
      { capability: "tax:file", label: "File tax returns" },
    ],
  },
  {
    key: "assets",
    label: "Fixed assets",
    description: "Asset register and depreciation.",
    items: [
      { capability: "fa:view", label: "View fixed assets" },
      { capability: "fa:manage", label: "Add and edit fixed assets" },
      { capability: "fa:post", label: "Run and post depreciation" },
    ],
  },
  {
    key: "planning",
    label: "Budgets and period close",
    description: "Budgets, forecasts and closing the books.",
    items: [
      { capability: "budget:view", label: "View budgets" },
      { capability: "budget:manage", label: "Create and edit budgets" },
      { capability: "close:view", label: "View period close" },
      { capability: "close:manage", label: "Close and reopen periods" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    description: "Financial and management reports, and the audit log.",
    items: [
      { capability: "report:view", label: "View reports" },
      { capability: "audit:view", label: "View the audit log" },
    ],
  },
  {
    key: "projects",
    label: "Projects and team",
    description: "Projects, tasks, employees and time.",
    items: [
      { capability: "project:view", label: "View projects and tasks" },
      { capability: "project:manage", label: "Manage projects and tasks" },
      { capability: "team:view", label: "View employees and time" },
      { capability: "team:manage", label: "Manage employees and time" },
    ],
  },
  {
    key: "settings",
    label: "Company settings",
    description: "Company setup, controls and integrations. User administration stays with company admins.",
    items: [
      { capability: "setup:view", label: "View company settings" },
      { capability: "setup:prepare", label: "Edit company settings" },
      { capability: "control:view", label: "View controls" },
      { capability: "control:manage", label: "Manage controls" },
      { capability: "platform:view", label: "View integrations and API keys" },
      { capability: "platform:manage", label: "Manage integrations and API keys" },
    ],
  },
];

const ALL_ITEMS = PERMISSION_AREAS.flatMap((a) => a.items.map((i) => i.capability));

/** "x:manage" etc. need "x:view" where that exists; ticking one adds its view, unticking a view removes dependents. */
export function viewFor(capability: string) {
  const prefix = capability.split(":")[0];
  const view = `${prefix}:view`;
  return capability !== view && ALL_ITEMS.includes(view as AccountingCapability) ? view : null;
}

export function toggleCapability(current: readonly string[], capability: string, on: boolean): string[] {
  const set = new Set(current);
  if (on) {
    set.add(capability);
    const view = viewFor(capability);
    if (view) set.add(view);
  } else {
    set.delete(capability);
    for (const c of [...set]) if (viewFor(c) === capability) set.delete(c);
  }
  return [...set];
}

/** Starting points offered when adding a role (QuickBooks "suggested roles"). */
export const ROLE_TEMPLATES: Array<{ key: string; name: string; description: string; capabilities: AccountingCapability[]; erpRole: CustomRoleErpRole }> = [
  {
    key: "invoices",
    name: "Invoices only",
    description: "Creates customer invoices and receives payments.",
    capabilities: ["ar:view", "ar:manage", "inventory:view"],
    erpRole: "ACCOUNTANT",
  },
  {
    key: "bills",
    name: "Bills only",
    description: "Enters supplier bills and pays them.",
    capabilities: ["ap:view", "ap:manage", "inventory:view"],
    erpRole: "ACCOUNTANT",
  },
  {
    key: "reports",
    name: "Sales and expense reports",
    description: "Sees sales, expenses and reports without changing anything.",
    capabilities: ["ar:view", "ap:view", "expense:view", "report:view"],
    erpRole: "ACCOUNTANT",
  },
  {
    key: "viewonly",
    name: "View only",
    description: "Sees everything, changes nothing.",
    capabilities: ALL_ITEMS.filter((c) => c.endsWith(":view")),
    erpRole: "ACCOUNTANT",
  },
];

/** Label for a person's role: the custom role's name when they have one. */
export function personRoleLabel(p: { role: string; customRole: { name: string } | null }) {
  return p.customRole ? p.customRole.name : roleLabel(p.role);
}

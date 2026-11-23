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
  const caps = new Set(capabilitiesForRole(role));
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

export const usersApi = {
  list: (api: Api) => api<UsersPayload>("/api/v1/users"),
  invite: (api: Api, input: { email: string; role: AssignableRole; branchId?: number | null }) =>
    api<{ message: string }>("/api/v1/users/invite", json("POST", input)),
  update: (api: Api, id: number, patch: { role?: AssignableRole; isActive?: boolean }) =>
    api<void>(`/api/v1/users/${id}`, json("PATCH", patch)),
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

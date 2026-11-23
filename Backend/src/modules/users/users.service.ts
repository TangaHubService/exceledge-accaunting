import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

/**
 * Manage users (QuickBooks model) on top of Excel Edge ERP.
 *
 * Accounting keeps no user table: people, their sign-in and their role in a company live in the
 * ERP database (`users`, `user_organizations`, `organization_invitations`). Every call here is
 * made with the signed-in user's own ERP token, so the ERP's own rules decide who may invite,
 * change roles or remove people. Each change is also written to the accounting audit log.
 */

export const ASSIGNABLE_ROLES = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "SELLER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

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

export class ErpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function organizationId(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { externalErpOrganizationId: true } });
  if (!company.externalErpOrganizationId) throw new ErpError("This company is not linked to an Excel Edge organization", 400);
  return company.externalErpOrganizationId;
}

async function erp<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${env.erpApiUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) throw new ErpError("Excel Edge could not be reached. Check ERP_API_URL and that the ERP is running.", 502);
  const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok) {
    const message = body?.error || body?.message || `Excel Edge refused the request (HTTP ${res.status})`;
    throw new ErpError(message, res.status >= 500 ? 502 : res.status);
  }
  return body as T;
}

async function audit(companyId: string, actor: Actor, action: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType: "User", entityId, afterJson, beforeJson, ...actor.meta });
}

type ErpUserRow = { id: number; name?: string | null; email: string; role: string; isOwner?: boolean; isActive?: boolean; createdAt?: string | null };
type ErpInvitationRow = {
  id: number;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  branchId?: number | null;
  inviter?: { name?: string | null } | null;
};

export async function listUsers(companyId: string, token: string) {
  const org = await organizationId(companyId);
  const [usersBody, invitesBody] = await Promise.all([
    erp<{ users: ErpUserRow[] }>(token, `/users/${org}?status=all&limit=500`),
    erp<{ invitations: ErpInvitationRow[] }>(token, `/organizations/${org}/invitations`).catch((e: ErpError) => {
      // Branch managers can list users; only fail the whole page on a real outage.
      if (e.status === 403) return { invitations: [] };
      throw e;
    }),
  ]);
  const now = Date.now();
  const users: ManagedUser[] = usersBody.users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || u.email,
    email: u.email,
    role: u.role,
    isOwner: Boolean(u.isOwner),
    status: u.isActive === false ? "INACTIVE" : "ACTIVE",
    createdAt: u.createdAt ?? null,
  }));
  const invitations: PendingInvitation[] = invitesBody.invitations.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    status: new Date(i.expiresAt).getTime() < now ? "EXPIRED" : "INVITED",
    invitedAt: i.createdAt,
    expiresAt: i.expiresAt,
    invitedBy: i.inviter?.name ?? null,
    branchId: i.branchId ?? null,
  }));
  return { users, invitations };
}

export async function inviteUser(companyId: string, token: string, input: { email: string; role: AssignableRole; branchId?: number | null }, actor: Actor) {
  const org = await organizationId(companyId);
  const email = input.email.trim().toLowerCase();
  const body = await erp<{ message?: string; invitation?: { id: number } }>(token, `/organizations/${org}/invite`, {
    method: "POST",
    body: { email, role: input.role, app: "accounting", ...(input.branchId ? { branchId: input.branchId } : {}) },
  });
  await audit(companyId, actor, "USER_INVITE", String(body.invitation?.id ?? email), { email, role: input.role, branchId: input.branchId ?? null });
  return { message: body.message ?? "Invitation sent", invitationId: body.invitation?.id ?? null };
}

export async function updateUser(companyId: string, token: string, userId: number, input: { role?: AssignableRole; isActive?: boolean }, actor: Actor) {
  const org = await organizationId(companyId);
  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) patch.role = input.role;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (Object.keys(patch).length === 0) throw new ErpError("Nothing to change", 400);
  await erp(token, `/users/${org}/update/${userId}`, { method: "PUT", body: patch });
  const action = input.role !== undefined ? "USER_ROLE_CHANGE" : input.isActive ? "USER_REACTIVATE" : "USER_DEACTIVATE";
  await audit(companyId, actor, action, String(userId), patch);
}

export async function removeUser(companyId: string, token: string, userId: number, actor: Actor) {
  const org = await organizationId(companyId);
  await erp(token, `/organizations/${org}/users/${userId}`, { method: "DELETE" });
  await audit(companyId, actor, "USER_REMOVE", String(userId), { removedFromOrganization: org });
}

export async function cancelInvitation(companyId: string, token: string, invitationId: number, actor: Actor) {
  const org = await organizationId(companyId);
  // The ERP's cancel endpoint does not check the organization, so confirm the invitation is ours first.
  const { invitations } = await erp<{ invitations: ErpInvitationRow[] }>(token, `/organizations/${org}/invitations`);
  const invite = invitations.find((i) => i.id === invitationId);
  if (!invite) throw new ErpError("Invitation not found", 404);
  await erp(token, `/organizations/cancel-invitation/${invitationId}`, { method: "PUT" });
  await audit(companyId, actor, "USER_INVITE_CANCEL", String(invitationId), { email: invite.email, role: invite.role });
}

export async function resendInvitation(companyId: string, token: string, invitationId: number, actor: Actor) {
  const org = await organizationId(companyId);
  const { invitations } = await erp<{ invitations: ErpInvitationRow[] }>(token, `/organizations/${org}/invitations`);
  const invite = invitations.find((i) => i.id === invitationId);
  if (!invite) throw new ErpError("Invitation not found", 404);
  // The ERP has no resend: cancel the old invitation and send a fresh one (new link, new 7-day expiry).
  await erp(token, `/organizations/cancel-invitation/${invitationId}`, { method: "PUT" });
  const body = await erp<{ invitation?: { id: number } }>(token, `/organizations/${org}/invite`, {
    method: "POST",
    body: { email: invite.email, role: invite.role, app: "accounting", ...(invite.branchId ? { branchId: invite.branchId } : {}) },
  });
  await audit(companyId, actor, "USER_INVITE_RESEND", String(body.invitation?.id ?? invitationId), { email: invite.email, role: invite.role });
}

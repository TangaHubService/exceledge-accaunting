import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { clearAccessCache } from "./access.service";
import { getRole, roleHolders } from "./roles.service";

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

/** A role choice: a built-in Excel Edge role, or one of this company's custom roles. */
export type RoleChoice = { role: AssignableRole; customRoleId?: undefined } | { role?: undefined; customRoleId: string };

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
  const [assignments, pending, firms] = await Promise.all([
    prisma.userRoleAssignment.findMany({ where: { companyId }, include: { customRole: { select: { id: true, name: true } } } }),
    prisma.inviteRoleAssignment.findMany({ where: { companyId }, include: { customRole: { select: { id: true, name: true } } } }),
    prisma.accountingFirm.findMany({ where: { companyId } }),
  ]);
  const roleByUser = new Map(assignments.map((a) => [a.erpUserId, a.customRole]));
  const roleByEmail = new Map(pending.map((p) => [p.email, p.customRole]));
  const firmByEmail = new Map(firms.map((f) => [f.email, f.firmName]));
  const now = Date.now();
  const users: ManagedUser[] = usersBody.users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || u.email,
    email: u.email,
    role: u.role,
    isOwner: Boolean(u.isOwner),
    status: u.isActive === false ? "INACTIVE" : "ACTIVE",
    createdAt: u.createdAt ?? null,
    // Custom roles never apply to company admins (see access.service).
    customRole: u.role === "ADMIN" ? null : (roleByUser.get(u.id) ?? roleByEmail.get(u.email.toLowerCase()) ?? null),
    firmName: firmByEmail.get(u.email.toLowerCase()) ?? null,
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
    customRole: roleByEmail.get(i.email.toLowerCase()) ?? null,
    firmName: firmByEmail.get(i.email.toLowerCase()) ?? null,
  }));
  return { users, invitations };
}

/** The ERP role to use for a choice, and the custom role (if any). */
async function resolveChoice(companyId: string, choice: RoleChoice) {
  if (choice.customRoleId) {
    const custom = await getRole(companyId, choice.customRoleId);
    return { erpRole: custom.erpRole, custom };
  }
  return { erpRole: choice.role!, custom: null };
}

export async function inviteUser(
  companyId: string,
  token: string,
  input: RoleChoice & { email: string; branchId?: number | null },
  actor: Actor,
) {
  const org = await organizationId(companyId);
  const email = input.email.trim().toLowerCase();
  const { erpRole, custom } = await resolveChoice(companyId, input);
  const body = await erp<{ message?: string; invitation?: { id: number } }>(token, `/organizations/${org}/invite`, {
    method: "POST",
    body: { email, role: erpRole, app: "accounting", ...(input.branchId ? { branchId: input.branchId } : {}) },
  });
  if (custom) {
    await prisma.inviteRoleAssignment.upsert({
      where: { companyId_email: { companyId, email } },
      update: { customRoleId: custom.id, createdByErpUserId: actor.erpUserId ?? 0 },
      create: { companyId, email, customRoleId: custom.id, createdByErpUserId: actor.erpUserId ?? 0 },
    });
  } else {
    await prisma.inviteRoleAssignment.deleteMany({ where: { companyId, email } });
  }
  await audit(companyId, actor, "USER_INVITE", String(body.invitation?.id ?? email), {
    email,
    role: erpRole,
    customRole: custom?.name ?? null,
    branchId: input.branchId ?? null,
  });
  return { message: body.message ?? "Invitation sent", invitationId: body.invitation?.id ?? null };
}

export async function updateUser(
  companyId: string,
  token: string,
  userId: number,
  input: { role?: AssignableRole; customRoleId?: string; isActive?: boolean },
  actor: Actor,
) {
  const org = await organizationId(companyId);
  const changingRole = input.role !== undefined || input.customRoleId !== undefined;
  if (!changingRole && input.isActive === undefined) throw new ErpError("Nothing to change", 400);

  if (changingRole) {
    const { erpRole, custom } = await resolveChoice(companyId, input as RoleChoice);
    const { users } = await erp<{ users: ErpUserRow[] }>(token, `/users/${org}?status=all&limit=500`);
    const target = users.find((u) => u.id === userId);
    if (!target) throw new ErpError("User not found", 404);
    if (target.isOwner && erpRole !== "ADMIN") {
      throw new ErpError("Transfer primary admin to someone else before changing this person's role", 400);
    }
    if (target.role !== erpRole) await erp(token, `/users/${org}/update/${userId}`, { method: "PUT", body: { role: erpRole } });
    if (custom) {
      await prisma.userRoleAssignment.upsert({
        where: { companyId_erpUserId: { companyId, erpUserId: userId } },
        update: { customRoleId: custom.id, assignedByErpUserId: actor.erpUserId ?? 0 },
        create: { companyId, erpUserId: userId, customRoleId: custom.id, assignedByErpUserId: actor.erpUserId ?? 0 },
      });
    } else {
      await prisma.userRoleAssignment.deleteMany({ where: { companyId, erpUserId: userId } });
    }
    await prisma.inviteRoleAssignment.deleteMany({ where: { companyId, email: target.email.toLowerCase() } });
    clearAccessCache();
    await audit(companyId, actor, "USER_ROLE_CHANGE", String(userId), { role: erpRole, customRole: custom?.name ?? null }, {
      role: target.role,
    });
  }

  if (input.isActive !== undefined) {
    await erp(token, `/users/${org}/update/${userId}`, { method: "PUT", body: { isActive: input.isActive } });
    await audit(companyId, actor, input.isActive ? "USER_REACTIVATE" : "USER_DEACTIVATE", String(userId), { isActive: input.isActive });
  }
}

export async function removeUser(companyId: string, token: string, userId: number, actor: Actor) {
  const org = await organizationId(companyId);
  await erp(token, `/organizations/${org}/users/${userId}`, { method: "DELETE" });
  await prisma.userRoleAssignment.deleteMany({ where: { companyId, erpUserId: userId } });
  clearAccessCache();
  await audit(companyId, actor, "USER_REMOVE", String(userId), { removedFromOrganization: org });
}

/** QuickBooks "Transfer primary admin": only the current primary admin, only to another admin. */
export async function transferPrimaryAdmin(companyId: string, token: string, userId: number, actor: Actor) {
  const org = await organizationId(companyId);
  await erp(token, `/organizations/${org}/transfer-ownership`, { method: "POST", body: { userId } });
  await audit(companyId, actor, "USER_PRIMARY_ADMIN_TRANSFER", String(userId), { newPrimaryAdmin: userId }, { previousPrimaryAdmin: actor.erpUserId });
}

/** Bring every holder of a custom role onto its ERP role after the role was edited. */
export async function syncRoleHolders(companyId: string, token: string, roleId: string, erpRole: string) {
  const org = await organizationId(companyId);
  const holders = await roleHolders(companyId, roleId);
  if (holders.length === 0) return { updated: 0 };
  const { users } = await erp<{ users: ErpUserRow[] }>(token, `/users/${org}?status=all&limit=500`);
  let updated = 0;
  for (const id of holders) {
    const u = users.find((x) => x.id === id);
    if (u && u.role !== erpRole && u.role !== "ADMIN") {
      await erp(token, `/users/${org}/update/${id}`, { method: "PUT", body: { role: erpRole } });
      updated += 1;
    }
  }
  return { updated };
}

/* ── Accounting firms (QuickBooks "Accounting firms" tab) ───────────────────────── */

export async function inviteFirm(companyId: string, token: string, input: { firmName: string; email: string }, actor: Actor) {
  const email = input.email.trim().toLowerCase();
  const firmName = input.firmName.trim();
  const existing = await prisma.accountingFirm.findUnique({ where: { companyId_email: { companyId, email } } });
  if (existing) throw new ErpError(`${existing.firmName} is already invited with that email`, 409);
  await inviteUser(companyId, token, { email, role: "ACCOUNTANT" }, actor);
  const firm = await prisma.accountingFirm.create({ data: { companyId, firmName, email, invitedByErpUserId: actor.erpUserId ?? 0 } });
  await audit(companyId, actor, "FIRM_INVITE", firm.id, { firmName, email });
  return firm;
}

export async function listFirms(companyId: string, token: string) {
  const firms = await prisma.accountingFirm.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
  if (firms.length === 0) return [];
  const { users, invitations } = await listUsers(companyId, token);
  return firms.map((f) => {
    const user = users.find((u) => u.email.toLowerCase() === f.email);
    const invite = invitations.find((i) => i.email.toLowerCase() === f.email);
    const status = user ? user.status : invite ? invite.status : "NOT_CONNECTED";
    return {
      id: f.id,
      firmName: f.firmName,
      email: f.email,
      invitedAt: f.createdAt.toISOString(),
      status,
      userId: user?.id ?? null,
      contactName: user?.name ?? null,
      invitationId: invite?.id ?? null,
    };
  });
}

export async function removeFirm(companyId: string, token: string, firmId: string, actor: Actor) {
  const firm = await prisma.accountingFirm.findFirst({ where: { id: firmId, companyId } });
  if (!firm) throw new ErpError("Accounting firm not found", 404);
  const { users, invitations } = await listUsers(companyId, token);
  const user = users.find((u) => u.email.toLowerCase() === firm.email);
  const invite = invitations.find((i) => i.email.toLowerCase() === firm.email);
  if (user) await removeUser(companyId, token, user.id, actor);
  else if (invite) await cancelInvitation(companyId, token, invite.id, actor);
  await prisma.accountingFirm.delete({ where: { id: firm.id } });
  await audit(companyId, actor, "FIRM_REMOVE", firm.id, null, { firmName: firm.firmName, email: firm.email });
}

export async function cancelInvitation(companyId: string, token: string, invitationId: number, actor: Actor) {
  const org = await organizationId(companyId);
  // The ERP's cancel endpoint does not check the organization, so confirm the invitation is ours first.
  const { invitations } = await erp<{ invitations: ErpInvitationRow[] }>(token, `/organizations/${org}/invitations`);
  const invite = invitations.find((i) => i.id === invitationId);
  if (!invite) throw new ErpError("Invitation not found", 404);
  await erp(token, `/organizations/cancel-invitation/${invitationId}`, { method: "PUT" });
  await prisma.inviteRoleAssignment.deleteMany({ where: { companyId, email: invite.email.toLowerCase() } });
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

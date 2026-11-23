import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { GRANTABLE_CAPABILITIES, clearAccessCache } from "./access.service";

/**
 * Custom roles (QuickBooks model): a company names a role and ticks exactly which areas it can
 * view or change. Built-in roles stay as they are; custom roles never include user administration
 * or company activation, which remain with company admins.
 */

/** ERP roles a custom role may sit on (the person's access inside Excel Edge itself). */
export const CUSTOM_ROLE_ERP_ROLES = ["ACCOUNTANT", "BRANCH_MANAGER", "SELLER"] as const;
export type CustomRoleErpRole = (typeof CUSTOM_ROLE_ERP_ROLES)[number];

export type RoleInput = { name: string; description?: string | null; capabilities: string[]; erpRole: CustomRoleErpRole };
type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

export class RoleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function audit(companyId: string, actor: Actor, action: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType: "CustomRole", entityId, afterJson, beforeJson, ...actor.meta });
}

function clean(input: RoleInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new RoleError("Give the role a name");
  if (name.length > 60) throw new RoleError("Keep the role name under 60 characters");
  const unknown = input.capabilities.filter((c) => !(GRANTABLE_CAPABILITIES as readonly string[]).includes(c));
  if (unknown.length) throw new RoleError(`These permissions can't be given to a custom role: ${unknown.join(", ")}`);
  const capabilities = [...new Set(input.capabilities)].sort();
  if (capabilities.length === 0) throw new RoleError("Choose at least one thing this role can do");
  return { name, description: input.description?.trim() || null, capabilities, erpRole: input.erpRole };
}

export async function listRoles(companyId: string) {
  const roles = await prisma.customRole.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    include: { _count: { select: { assignments: true, invites: true } } },
  });
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    capabilities: r.capabilities,
    erpRole: r.erpRole,
    users: r._count.assignments,
    pendingInvites: r._count.invites,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getRole(companyId: string, id: string) {
  const role = await prisma.customRole.findFirst({ where: { id, companyId } });
  if (!role) throw new RoleError("Role not found", 404);
  return role;
}

async function assertNameFree(companyId: string, name: string, exceptId?: string) {
  const clash = await prisma.customRole.findFirst({ where: { companyId, name: { equals: name, mode: "insensitive" }, NOT: exceptId ? { id: exceptId } : undefined } });
  if (clash) throw new RoleError(`There's already a role called "${clash.name}"`, 409);
}

export async function createRole(companyId: string, input: RoleInput, actor: Actor) {
  const data = clean(input);
  await assertNameFree(companyId, data.name);
  const row = await prisma.customRole.create({ data: { ...data, companyId, createdByErpUserId: actor.erpUserId ?? 0 } });
  await audit(companyId, actor, "ROLE_CREATE", row.id, data);
  return row;
}

/** Returns the role before and after, so the caller can bring holders' ERP role in line. */
export async function updateRole(companyId: string, id: string, input: RoleInput, actor: Actor) {
  const before = await getRole(companyId, id);
  const data = clean(input);
  await assertNameFree(companyId, data.name, id);
  const row = await prisma.customRole.update({ where: { id }, data });
  clearAccessCache();
  await audit(companyId, actor, "ROLE_UPDATE", id, data, {
    name: before.name,
    description: before.description,
    capabilities: before.capabilities,
    erpRole: before.erpRole,
  });
  return { before, after: row };
}

export async function deleteRole(companyId: string, id: string, actor: Actor) {
  const role = await prisma.customRole.findFirst({ where: { id, companyId }, include: { _count: { select: { assignments: true, invites: true } } } });
  if (!role) throw new RoleError("Role not found", 404);
  if (role._count.assignments > 0) {
    throw new RoleError(`${role._count.assignments} ${role._count.assignments === 1 ? "person has" : "people have"} this role. Give them another role first.`, 409);
  }
  if (role._count.invites > 0) {
    throw new RoleError("A pending invitation uses this role. Cancel it or wait until it's accepted.", 409);
  }
  await prisma.customRole.delete({ where: { id } });
  clearAccessCache();
  await audit(companyId, actor, "ROLE_DELETE", id, null, { name: role.name, capabilities: role.capabilities });
}

/** Holders of a role (ERP user ids), e.g. to update their ERP role after the role changes. */
export async function roleHolders(companyId: string, id: string) {
  const rows = await prisma.userRoleAssignment.findMany({ where: { companyId, customRoleId: id }, select: { erpUserId: true } });
  return rows.map((r) => r.erpUserId);
}

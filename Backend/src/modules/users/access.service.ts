import { type AccountingCapability, capabilitiesForRole } from "@exceledge/accounting-domain";
import { prisma } from "../../lib/prisma";

/**
 * Effective accounting access for a signed-in person.
 *
 * - Company admins (and the Excel Edge system owner) always get their full built-in access;
 *   custom roles never apply to them, so no one can lock an admin out.
 * - Anyone else gets the exact capabilities of their custom role in this company if they have
 *   one, otherwise the built-in capabilities of their ERP role.
 * - A custom role chosen at invite time is attached the first time the person signs in.
 *
 * Results are cached briefly per company + user; any role change clears the cache.
 */

export const ALL_CAPABILITIES: readonly AccountingCapability[] = capabilitiesForRole("ADMIN");

/** Kept for company admins: user administration and company activation. */
export const ADMIN_ONLY_CAPABILITIES: readonly AccountingCapability[] = ["setup:approve", "setup:activate"];

export const GRANTABLE_CAPABILITIES: readonly AccountingCapability[] = ALL_CAPABILITIES.filter(
  (c) => !ADMIN_ONLY_CAPABILITIES.includes(c),
);

const ADMIN_ROLES = new Set(["ADMIN", "SYSTEM_OWNER"]);

export function isAdminRole(role: string | undefined | null) {
  return ADMIN_ROLES.has((role ?? "").toUpperCase());
}

export type EffectiveAccess = {
  capabilities: AccountingCapability[];
  customRole: { id: string; name: string } | null;
};

type CacheEntry = EffectiveAccess & { expires: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

export function clearAccessCache() {
  cache.clear();
}

export async function effectiveAccess(input: {
  erpOrganizationId: number | undefined;
  erpUserId: number;
  email?: string;
  erpRole?: string;
}): Promise<EffectiveAccess> {
  const builtIn: EffectiveAccess = { capabilities: capabilitiesForRole(input.erpRole), customRole: null };
  if (!input.erpOrganizationId || isAdminRole(input.erpRole)) return builtIn;

  const key = `${input.erpOrganizationId}:${input.erpUserId}:${input.erpRole ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit;

  const company = await prisma.company.findUnique({
    where: { externalErpOrganizationId: String(input.erpOrganizationId) },
    select: { id: true },
  });
  if (!company) return builtIn;

  let assignment = await prisma.userRoleAssignment.findUnique({
    where: { companyId_erpUserId: { companyId: company.id, erpUserId: input.erpUserId } },
    include: { customRole: true },
  });

  if (!assignment && input.email) {
    const pending = await prisma.inviteRoleAssignment.findUnique({
      where: { companyId_email: { companyId: company.id, email: input.email.toLowerCase() } },
    });
    if (pending) {
      assignment = await prisma.userRoleAssignment.upsert({
        where: { companyId_erpUserId: { companyId: company.id, erpUserId: input.erpUserId } },
        update: {},
        create: {
          companyId: company.id,
          erpUserId: input.erpUserId,
          customRoleId: pending.customRoleId,
          assignedByErpUserId: pending.createdByErpUserId,
        },
        include: { customRole: true },
      });
      await prisma.inviteRoleAssignment.delete({ where: { id: pending.id } }).catch(() => undefined);
    }
  }

  const result: EffectiveAccess = assignment
    ? {
        capabilities: assignment.customRole.capabilities.filter((c): c is AccountingCapability =>
          (GRANTABLE_CAPABILITIES as readonly string[]).includes(c),
        ),
        customRole: { id: assignment.customRole.id, name: assignment.customRole.name },
      }
    : builtIn;
  cache.set(key, { ...result, expires: Date.now() + TTL_MS });
  return result;
}

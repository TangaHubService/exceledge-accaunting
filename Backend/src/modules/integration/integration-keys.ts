import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };
const sha = (value: string) => createHash("sha256").update(value).digest();

/** A company with its own key accepts only that one; the shared key serves the rest. */
export async function integrationKeyAccepted(presented: string | undefined, externalOrganizationId: string | undefined) {
  if (!presented) return false;
  const own = externalOrganizationId
    ? await prisma.integrationKey.findMany({ where: { revokedAt: null, company: { externalErpOrganizationId: String(externalOrganizationId) } }, select: { tokenHash: true } })
    : [];
  if (own.length) return own.some((k) => timingSafeEqual(Buffer.from(k.tokenHash, "hex"), sha(presented)));
  return Boolean(env.integrationApiKey) && timingSafeEqual(sha(presented), sha(env.integrationApiKey));
}

/** The key is shown once; only its hash is kept. Issuing a new one retires the old. */
export async function issueIntegrationKey(companyId: string, actor: Actor) {
  const token = `exi_${randomBytes(32).toString("base64url")}`;
  await prisma.integrationKey.updateMany({ where: { companyId, revokedAt: null }, data: { revokedAt: new Date() } });
  const row = await prisma.integrationKey.create({ data: { companyId, prefix: token.slice(0, 8), tokenHash: sha(token).toString("hex"), createdByErpUserId: actor.erpUserId } });
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "ISSUE", entityType: "IntegrationKey", entityId: row.id, afterJson: { prefix: row.prefix }, ...actor.meta });
  return { id: row.id, token, prefix: row.prefix, createdAt: row.createdAt };
}

export async function currentIntegrationKey(companyId: string) {
  const row = await prisma.integrationKey.findFirst({ where: { companyId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, prefix: true, createdAt: true } });
  return { ownKey: row };
}

export async function revokeIntegrationKey(companyId: string, actor: Actor) {
  const { count } = await prisma.integrationKey.updateMany({ where: { companyId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw new Error("This company has no key of its own");
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "REVOKE", entityType: "IntegrationKey", ...actor.meta });
  return { revoked: count };
}

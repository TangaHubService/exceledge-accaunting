import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

async function audit(companyId: string, actor: Actor, action: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType: "CompanyBranch", entityId, afterJson, beforeJson: beforeJson ?? undefined, ...actor.meta });
}

/** Branches with how many ledger lines carry each one. */
export async function listBranches(companyId: string) {
  const [branches, usage] = await Promise.all([
    prisma.companyBranch.findMany({ where: { companyId }, orderBy: [{ isActive: "desc" }, { code: "asc" }, { name: "asc" }] }),
    prisma.glEntry.groupBy({ by: ["branchId"], where: { companyId, branchId: { not: null } }, _count: { _all: true } }),
  ]);
  const counts = new Map(usage.map((u) => [u.branchId, u._count._all]));
  return branches.map((b) => ({ ...b, postings: (counts.get(b.id) ?? 0) + (counts.get(b.externalErpBranchId) ?? 0) }));
}

export async function createBranch(companyId: string, input: { externalErpBranchId: string; name: string; code?: string | null }, actor: Actor) {
  const externalErpBranchId = input.externalErpBranchId.trim();
  if (!externalErpBranchId) throw new Error("The Excel Edge branch id is required");
  if (await prisma.companyBranch.findUnique({ where: { companyId_externalErpBranchId: { companyId, externalErpBranchId } } })) {
    throw new Error(`Branch ${externalErpBranchId} is already set up`);
  }
  const row = await prisma.companyBranch.create({ data: { companyId, externalErpBranchId, name: input.name.trim(), code: input.code?.trim() || null } });
  await audit(companyId, actor, "CREATE", row.id, { externalErpBranchId, name: row.name, code: row.code });
  return row;
}

export async function updateBranch(companyId: string, id: string, input: { name?: string; code?: string | null; isActive?: boolean }, actor: Actor) {
  const before = await prisma.companyBranch.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Branch not found");
  const row = await prisma.companyBranch.update({
    where: { id },
    data: { name: input.name?.trim() ?? undefined, code: input.code === undefined ? undefined : input.code?.trim() || null, isActive: input.isActive },
  });
  await audit(companyId, actor, "UPDATE", id, input, { name: before.name, code: before.code, isActive: before.isActive });
  return row;
}

type ErpBranch = { id: number | string; name?: string | null; code?: string | null; status?: string | null; isActive?: boolean | null };

function erpBranchActive(b: ErpBranch) {
  if (b.isActive === false) return false;
  if (typeof b.status === "string" && b.status.toUpperCase() !== "ACTIVE") return false;
  return true;
}

/**
 * Adds and refreshes branches from Excel Edge. A branch missing from the ERP (or marked inactive
 * there) is deactivated here so it stays on past postings but cannot be used on new ones. Rows are
 * never deleted.
 */
export async function syncBranchesFromErp(companyId: string, bearerToken: string, actor: Actor) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.externalErpOrganizationId) throw new Error("This company is not linked to an Excel Edge organization");
  const res = await fetch(`${env.erpApiUrl}/branches/${company.externalErpOrganizationId}?includeInactive=true`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) throw new Error("Excel Edge could not be reached. Check ERP_API_URL and that the ERP is running.");
  const body = (await res.json().catch(() => null)) as ErpBranch[] | { data?: ErpBranch[]; error?: string } | null;
  if (!res.ok) throw new Error((body && !Array.isArray(body) && body.error) || `Excel Edge refused the request (HTTP ${res.status})`);
  const list = Array.isArray(body) ? body : (body?.data ?? []);
  const seen = new Set<string>();
  const summary = { added: 0, updated: 0, deactivated: 0, unchanged: 0 };
  for (const b of list) {
    const externalErpBranchId = String(b.id);
    seen.add(externalErpBranchId);
    const name = b.name ?? null;
    const code = b.code ?? null;
    const isActive = erpBranchActive(b);
    const existing = await prisma.companyBranch.findUnique({ where: { companyId_externalErpBranchId: { companyId, externalErpBranchId } } });
    if (!existing) {
      await prisma.companyBranch.create({ data: { companyId, externalErpBranchId, name, code, isActive } });
      summary.added += 1;
    } else if (existing.name !== name || existing.code !== code || existing.isActive !== isActive) {
      await prisma.companyBranch.update({ where: { id: existing.id }, data: { name, code, isActive } });
      if (existing.isActive && !isActive) summary.deactivated += 1;
      else summary.updated += 1;
    } else summary.unchanged += 1;
  }
  const missing = await prisma.companyBranch.findMany({ where: { companyId, isActive: true, externalErpBranchId: { notIn: [...seen] } } });
  if (missing.length) {
    await prisma.companyBranch.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { isActive: false } });
    summary.deactivated += missing.length;
  }
  await audit(companyId, actor, "SYNC_BRANCHES", companyId, summary);
  return summary;
}

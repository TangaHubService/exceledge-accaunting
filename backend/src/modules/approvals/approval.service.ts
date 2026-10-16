import {
  approvalPlan,
  asDatePolicy,
  hasCapability,
  parseApprovalTiers,
  roleForLevel,
  type AccountingCapability,
  type ApprovalPlan,
} from "@exceledge/accounting-domain";
import type { ApprovalDecisionKind, ApprovalRequest, ApprovalStatus, Prisma } from "@prisma/client";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { isSignable, recordSignature } from "../books/signatures.service";
import { notify } from "../notifications/notification.service";

export type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

export const APPROVAL_ENTITY_TYPES = ["Journal", "Expense", "ApBill", "Budget", "TaxAdjustment", "FixedAssetImpairment", "PeriodClose"] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number];

/** Documents that post on creation unless setup lists them in `approvalRequiredFor`. */
export const GATED_ENTITY_TYPES = ["ApBill", "TaxAdjustment", "FixedAssetImpairment"] as const;
export type GatedEntityType = (typeof GATED_ENTITY_TYPES)[number];

/** Who may decide an approval depends on what is being approved. */
const DECIDE_CAPABILITY: Record<ApprovalEntityType, AccountingCapability> = {
  Journal: "journal:approve",
  Expense: "expense:approve",
  ApBill: "ap:manage",
  Budget: "budget:manage",
  TaxAdjustment: "tax:manage",
  FixedAssetImpairment: "fa:post",
  PeriodClose: "close:manage",
};

export async function approvalControls(companyId: string) {
  const row = await prisma.approvalPostingControls.findUnique({ where: { companyId } });
  let tiers;
  try {
    tiers = parseApprovalTiers(row?.amountBasedApprovalLimits ?? null);
  } catch (e) {
    throw new Error(`Approval limits in setup are invalid: ${(e as Error).message}`);
  }
  return {
    enabled: row?.approvalWorkflowEnabled ?? false,
    approvalLevels: row?.approvalLevels ?? 1,
    tiers,
    requireDifferentPoster: row?.requireDifferentPoster ?? false,
    supportingDocumentRequired: row?.supportingDocumentRequired ?? false,
    backdated: asDatePolicy(row?.backdatedTransactionPolicy, "ALLOW"),
    futureDated: asDatePolicy(row?.futureDatedTransactionPolicy, "ALLOW"),
    requiredFor: row?.approvalRequiredFor ?? [],
  };
}

export async function planFor(companyId: string, amount: number, forceApproval = false): Promise<ApprovalPlan> {
  const controls = await approvalControls(companyId);
  return approvalPlan({ amount, enabled: controls.enabled, approvalLevels: controls.approvalLevels, tiers: controls.tiers, forceApproval });
}

/**
 * The approval a new document of `entityType` needs before it posts, or null when it posts at once:
 * the workflow is on, setup lists the type, and the levels/tiers ask for at least one approval.
 */
export async function documentApprovalPlan(companyId: string, entityType: GatedEntityType, amount: number): Promise<ApprovalPlan | null> {
  const controls = await approvalControls(companyId);
  if (!controls.enabled || !controls.requiredFor.includes(entityType)) return null;
  const plan = approvalPlan({ amount, enabled: true, approvalLevels: controls.approvalLevels, tiers: controls.tiers });
  return plan.levels >= 1 ? plan : null;
}

async function entitySummary(companyId: string, entityType: string, id: string): Promise<{ summary: string; createdBy: number | null } | null> {
  const where = { id, companyId };
  switch (entityType) {
    case "Journal": {
      const j = await prisma.journal.findFirst({ where, select: { journalNumber: true, description: true, createdByErpUserId: true } });
      return j && { summary: [j.journalNumber, j.description].filter(Boolean).join(" — "), createdBy: j.createdByErpUserId };
    }
    case "Expense": {
      const e = await prisma.expense.findFirst({ where, select: { number: true, description: true, createdByErpUserId: true } });
      return e && { summary: [e.number, e.description].filter(Boolean).join(" — "), createdBy: e.createdByErpUserId };
    }
    case "ApBill": {
      const b = await prisma.apBill.findFirst({ where, select: { billNumber: true, supplierInvoiceNumber: true, createdByErpUserId: true, supplier: { select: { name: true } } } });
      return b && { summary: [b.billNumber, b.supplier.name, b.supplierInvoiceNumber].filter(Boolean).join(" — "), createdBy: b.createdByErpUserId };
    }
    case "Budget": {
      const b = await prisma.budget.findFirst({ where, select: { name: true, createdByErpUserId: true } });
      return b && { summary: b.name, createdBy: b.createdByErpUserId };
    }
    case "TaxAdjustment": {
      const t = await prisma.taxAdjustment.findFirst({ where, select: { number: true, reason: true, createdByErpUserId: true } });
      return t && { summary: `${t.number} — ${t.reason}`, createdBy: t.createdByErpUserId };
    }
    case "FixedAssetImpairment": {
      const f = await prisma.fixedAssetImpairment.findFirst({ where, select: { createdByErpUserId: true, asset: { select: { number: true, name: true } } } });
      return f && { summary: `Impairment of ${f.asset.number} ${f.asset.name}`, createdBy: f.createdByErpUserId };
    }
    case "PeriodClose": {
      const c = await prisma.periodClose.findFirst({ where, select: { kind: true, periodId: true, requestedByErpUserId: true } });
      if (!c) return null;
      const period = await prisma.accountingPeriod.findUnique({ where: { id: c.periodId }, select: { name: true } });
      return { summary: `${c.kind === "YEAR" ? "Year-end close" : "Close"} of ${period?.name ?? c.periodId}`, createdBy: c.requestedByErpUserId };
    }
    default:
      return null;
  }
}

/** Effects on the approved record. Only records waiting for approval move; others keep their status. */
async function applyToEntity(row: ApprovalRequest, outcome: "PROGRESS" | ApprovalStatus, actor: Actor, note?: string) {
  const where = { id: row.entityId, companyId: row.companyId };
  if (row.entityType === "Journal") {
    const waiting = { ...where, status: { in: ["SUBMITTED", "UNDER_REVIEW"] as Array<"SUBMITTED" | "UNDER_REVIEW"> } };
    if (outcome === "PROGRESS") await prisma.journal.updateMany({ where: waiting, data: { status: "UNDER_REVIEW" } });
    if (outcome === "APPROVED") await prisma.journal.updateMany({ where: waiting, data: { status: "APPROVED", approvedByErpUserId: actor.erpUserId } });
    if (outcome === "REJECTED") await prisma.journal.updateMany({ where: waiting, data: { status: "CANCELLED" } });
    if (outcome === "RETURNED") await prisma.journal.updateMany({ where: waiting, data: { status: "DRAFT" } });
  } else if (row.entityType === "Budget") {
    await (await import("../books/budget.service")).applyBudgetApproval(row.companyId, row.entityId, outcome);
  } else if (row.entityType === "Expense") {
    if (outcome === "APPROVED") {
      await prisma.expense.updateMany({
        where: { ...where, status: "SUBMITTED" },
        data: { status: "APPROVED", approvedAt: new Date(), approvedByErpUserId: actor.erpUserId, rejectionReason: null },
      });
    }
    if (outcome === "REJECTED") {
      await prisma.expense.updateMany({
        where: { ...where, status: { in: ["SUBMITTED", "APPROVED"] } },
        data: { status: "REJECTED", rejectedAt: new Date(), rejectedByErpUserId: actor.erpUserId, rejectionReason: note ?? "Rejected" },
      });
    }
    if (outcome === "RETURNED") await prisma.expense.updateMany({ where: { ...where, status: "SUBMITTED" }, data: { status: "DRAFT" } });
  } else if (row.entityType === "ApBill") {
    if (outcome === "APPROVED") await (await import("../ap/ap.service")).postPendingBill(row.companyId, row.entityId, actor);
    if (outcome === "REJECTED") await prisma.apBill.updateMany({ where: { ...where, status: "PENDING_APPROVAL" }, data: { status: "REJECTED" } });
  } else if (row.entityType === "TaxAdjustment") {
    if (outcome === "APPROVED") await (await import("../tax/tax.service")).postPendingTaxAdjustment(row.companyId, row.entityId, actor);
    if (outcome === "REJECTED") await prisma.taxAdjustment.updateMany({ where: { ...where, status: "PENDING_APPROVAL" }, data: { status: "REJECTED" } });
  } else if (row.entityType === "FixedAssetImpairment") {
    if (outcome === "APPROVED") await (await import("../fixed-assets/fa.service")).postPendingImpairment(row.companyId, row.entityId, actor);
    if (outcome === "REJECTED") await prisma.fixedAssetImpairment.updateMany({ where: { ...where, status: "PENDING_APPROVAL" }, data: { status: "REJECTED" } });
  } else if (row.entityType === "PeriodClose") {
    const close = await import("../books/close.service");
    if (outcome === "APPROVED") await close.approveCloseRequest(row.companyId, row.entityId, actor);
    if (outcome === "REJECTED" || outcome === "RETURNED") await close.rejectCloseRequest(row.companyId, row.entityId, note);
  }
}

function isOpenRequestConflict(e: unknown) {
  const err = e as { code?: string; message?: string };
  return err?.code === "P2002" || /approval_requests_one_open_per_entity/.test(err?.message ?? "");
}

async function audit(companyId: string, actor: Actor, action: string, id: string, afterJson?: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType: "ApprovalRequest", entityId: id, beforeJson, afterJson, ...actor.meta });
}

async function notifyLevel(row: ApprovalRequest, summary: string) {
  const level = row.approvedLevels + 1;
  const role = roleForLevel(row.levelRoles, level);
  await notify({
    companyId: row.companyId,
    title: "Approval waiting",
    body: `${row.entityType} ${summary || row.entityId} needs approval (level ${level} of ${row.requiredLevels}${role ? `, ${role}` : ""}).`,
    severity: "WARNING",
    targetRole: role,
    entityType: row.entityType,
    entityId: row.entityId,
  });
}

/**
 * Raises an approval for a record. An explicit request always needs at least one approval; the
 * amount decides how many levels and which roles.
 */
export async function requestApproval(
  companyId: string,
  input: { entityType: ApprovalEntityType; entityId: string; amount: number; reason?: string; plan?: ApprovalPlan },
  actor: Actor = {},
) {
  const target = await entitySummary(companyId, input.entityType, input.entityId);
  if (!target) throw new Error(`${input.entityType} ${input.entityId} was not found`);
  const open = await prisma.approvalRequest.findFirst({
    where: { companyId, entityType: input.entityType, entityId: input.entityId, status: { in: ["PENDING", "RETURNED"] } },
  });
  if (open?.status === "PENDING") throw new Error(`${input.entityType} ${input.entityId} already has a pending approval`);
  if (open?.status === "RETURNED") throw new Error(`${input.entityType} ${input.entityId} was returned for correction; resubmit it`);
  const plan = input.plan ?? (await planFor(companyId, input.amount, true));
  if (plan.levels < 1) throw new Error("No approval is required");
  return inTransaction(async () => {
    let row: ApprovalRequest;
    try {
      row = await prisma.approvalRequest.create({
        data: {
          companyId,
          entityType: input.entityType,
          entityId: input.entityId,
          amount: input.amount,
          reason: input.reason,
          requestedByErpUserId: actor.erpUserId,
          requiredLevels: plan.levels,
          levelRoles: plan.roles,
        },
      });
    } catch (e) {
      if (isOpenRequestConflict(e)) throw new Error(`${input.entityType} ${input.entityId} already has a pending approval`);
      throw e;
    }
    await notifyLevel(row, target.summary);
    await audit(companyId, actor, "REQUEST_APPROVAL", row.id, { entityType: row.entityType, entityId: row.entityId, amount: input.amount, levels: plan.levels, roles: plan.roles });
    return row;
  });
}

/** Approvals given in the current round, i.e. since the last resubmission. */
function currentRound(decisions: Array<{ decision: ApprovalDecisionKind; erpUserId: number; createdAt: Date }>) {
  const sorted = [...decisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lastResubmit = sorted.map((d) => d.decision).lastIndexOf("RESUBMITTED");
  return sorted.slice(lastResubmit + 1);
}

/** Why `actor` cannot decide the next level of `row` now, or null when they can. */
function blockReason(
  row: ApprovalRequest & { decisions: Array<{ decision: ApprovalDecisionKind; erpUserId: number; createdAt: Date }> },
  createdBy: number | null,
  actor: Actor,
): string | null {
  if (row.status !== "PENDING") return `This approval was already ${row.status.toLowerCase()}`;
  const capability = DECIDE_CAPABILITY[row.entityType as ApprovalEntityType];
  if (!capability || !hasCapability(actor.erpRole, capability)) return `Missing capability: ${capability ?? "unknown entity"}`;
  if (actor.erpUserId && row.requestedByErpUserId === actor.erpUserId) return "The requester cannot approve their own item";
  if (actor.erpUserId && createdBy === actor.erpUserId) return `You created this ${row.entityType.toLowerCase()}; someone else must approve it`;
  if (currentRound(row.decisions).some((d) => d.decision === "APPROVED" && d.erpUserId === actor.erpUserId)) {
    return "You already approved an earlier level; another approver must take the next one";
  }
  const role = roleForLevel(row.levelRoles, row.approvedLevels + 1);
  if (role && role !== actor.erpRole?.toUpperCase()) return `Level ${row.approvedLevels + 1} must be approved by a ${role}`;
  return null;
}

export async function decideApproval(
  companyId: string,
  id: string,
  decision: "APPROVED" | "REJECTED" | "RETURNED",
  actor: Actor = {},
  note?: string,
) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  const trimmed = note?.trim() || undefined;
  if (decision !== "APPROVED" && (!trimmed || trimmed.length < 3)) {
    throw new Error(decision === "REJECTED" ? "Give a reason for rejecting" : "Say what needs correcting");
  }
  return inTransaction(async () => {
    const row = await prisma.approvalRequest.findFirst({ where: { id, companyId }, include: { decisions: true } });
    if (!row) throw new Error("Approval not found");
    const target = await entitySummary(companyId, row.entityType, row.entityId);
    const blocked = blockReason(row, target?.createdBy ?? null, actor);
    if (blocked) throw new Error(blocked);

    const level = row.approvedLevels + 1;
    const final = decision !== "APPROVED" || level >= row.requiredLevels;
    const status: ApprovalStatus = decision === "APPROVED" ? (final ? "APPROVED" : "PENDING") : decision;
    const claimed = await prisma.approvalRequest.updateMany({
      where: { id, status: "PENDING", approvedLevels: row.approvedLevels },
      data: {
        status,
        approvedLevels: decision === "APPROVED" ? level : row.approvedLevels,
        decisionNote: trimmed ?? row.decisionNote,
        ...(final ? { decidedByErpUserId: actor.erpUserId, decidedAt: new Date() } : {}),
      },
    });
    if (!claimed.count) throw new Error("This approval was decided by someone else a moment ago");
    await prisma.approvalDecision.create({
      data: { approvalRequestId: id, level, decision, erpUserId: actor.erpUserId!, erpRole: actor.erpRole, note: trimmed },
    });
    if (decision === "APPROVED" && isSignable(row.entityType)) {
      await recordSignature(
        companyId,
        { entityType: row.entityType, entityId: row.entityId, statement: `Approved at level ${level} of ${row.requiredLevels}${trimmed ? `: ${trimmed}` : ""}`, approvalRequestId: id },
        actor,
      );
    }
    const updated = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    await applyToEntity(updated, status === "PENDING" ? "PROGRESS" : status, actor, trimmed);

    const summary = target?.summary || row.entityId;
    if (status === "PENDING") await notifyLevel(updated, summary);
    else if (row.requestedByErpUserId) {
      const verb = { APPROVED: "approved", REJECTED: "rejected", RETURNED: "returned for correction" }[decision];
      await notify({
        companyId,
        title: `Approval ${verb}`,
        body: `${row.entityType} ${summary} was ${verb}${trimmed ? `: ${trimmed}` : "."}`,
        severity: decision === "APPROVED" ? "INFO" : "WARNING",
        targetErpUserId: row.requestedByErpUserId,
        entityType: row.entityType,
        entityId: row.entityId,
      });
    }
    const action = { APPROVED: final ? "APPROVE" : "APPROVE_LEVEL", REJECTED: "REJECT", RETURNED: "RETURN" }[decision];
    await audit(companyId, actor, action, id, { status, level, note: trimmed }, { status: row.status, approvedLevels: row.approvedLevels });
    return getApproval(companyId, id);
  });
}

/** Sends a returned request back for approval from level 1, re-planned for the current amount. */
export async function resubmitApproval(companyId: string, id: string, actor: Actor = {}, input: { note?: string; amount?: number; plan?: ApprovalPlan } = {}) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  return inTransaction(async () => {
    const row = await prisma.approvalRequest.findFirst({ where: { id, companyId } });
    if (!row) throw new Error("Approval not found");
    if (row.status !== "RETURNED") throw new Error("Only an approval returned for correction can be resubmitted");
    if (row.entityType === "PeriodClose") throw new Error("Request the period close again instead of resubmitting it");
    const amount = input.amount ?? Number(row.amount);
    const plan = input.plan ?? (await planFor(companyId, amount, true));
    const claimed = await prisma.approvalRequest.updateMany({
      where: { id, status: "RETURNED" },
      data: {
        status: "PENDING",
        amount,
        approvedLevels: 0,
        requiredLevels: Math.max(plan.levels, 1),
        levelRoles: plan.roles,
        requestedByErpUserId: actor.erpUserId,
        resubmitCount: { increment: 1 },
        decidedAt: null,
        decidedByErpUserId: null,
      },
    });
    if (!claimed.count) throw new Error("This approval was resubmitted by someone else a moment ago");
    await prisma.approvalDecision.create({
      data: { approvalRequestId: id, level: 0, decision: "RESUBMITTED", erpUserId: actor.erpUserId!, erpRole: actor.erpRole, note: input.note?.trim() || undefined },
    });
    const updated = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    const target = await entitySummary(companyId, row.entityType, row.entityId);
    await notifyLevel(updated, target?.summary ?? row.entityId);
    await audit(companyId, actor, "RESUBMIT_APPROVAL", id, { amount, levels: updated.requiredLevels }, { status: row.status });
    return updated;
  });
}

async function present(companyId: string, rows: Array<ApprovalRequest & { decisions: Array<{ id: string; level: number; decision: ApprovalDecisionKind; erpUserId: number; erpRole: string | null; note: string | null; createdAt: Date }> }>) {
  return Promise.all(
    rows.map(async (row) => {
      const target = await entitySummary(companyId, row.entityType, row.entityId);
      return {
        ...row,
        amount: Number(row.amount),
        nextRole: row.status === "PENDING" ? roleForLevel(row.levelRoles, row.approvedLevels + 1) : null,
        summary: target?.summary ?? null,
        decisions: [...row.decisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      };
    }),
  );
}

export async function listApprovals(companyId: string, filters: { status?: ApprovalStatus; entityType?: string; entityId?: string } = {}) {
  const where: Prisma.ApprovalRequestWhereInput = { companyId };
  if (filters.status) where.status = filters.status;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  const rows = await prisma.approvalRequest.findMany({ where, include: { decisions: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return present(companyId, rows);
}

/** Pending requests the actor could decide right now. */
export async function approvalQueue(companyId: string, actor: Actor) {
  const rows = await prisma.approvalRequest.findMany({
    where: { companyId, status: "PENDING" },
    include: { decisions: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const mine = [];
  for (const row of rows) {
    const target = await entitySummary(companyId, row.entityType, row.entityId);
    if (!blockReason(row, target?.createdBy ?? null, actor)) mine.push(row);
  }
  return present(companyId, mine);
}

export async function getApproval(companyId: string, id: string) {
  const row = await prisma.approvalRequest.findFirst({ where: { id, companyId }, include: { decisions: true } });
  if (!row) throw new Error("Approval not found");
  return (await present(companyId, [row]))[0];
}

export async function latestApprovalFor(companyId: string, entityType: ApprovalEntityType, entityId: string) {
  const row = await prisma.approvalRequest.findFirst({
    where: { companyId, entityType, entityId },
    include: { decisions: true },
    orderBy: { createdAt: "desc" },
  });
  return row ? (await present(companyId, [row]))[0] : null;
}

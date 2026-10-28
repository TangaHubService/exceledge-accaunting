import { riskRating, riskScore } from "@exceledge/accounting-domain";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = { erpUserId?: number; erpRole?: string };

export const RISK_STATUSES = ["OPEN", "MITIGATING", "ACCEPTED", "CLOSED"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export type RiskInput = {
  code: string;
  title: string;
  category: string;
  description?: string | null;
  likelihood: number;
  impact: number;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
  status?: RiskStatus;
  ownerName?: string | null;
  ownerErpUserId?: number | null;
  reviewDate?: Date | null;
  controlIds?: string[];
};

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType, entityId, afterJson, beforeJson: beforeJson ?? undefined });
}

function scored<T extends { likelihood: number; impact: number; residualLikelihood: number | null; residualImpact: number | null }>(risk: T) {
  const inherent = riskScore(risk.likelihood, risk.impact);
  const residual = risk.residualLikelihood && risk.residualImpact ? riskScore(risk.residualLikelihood, risk.residualImpact) : null;
  return { ...risk, inherentScore: inherent, inherentRating: riskRating(inherent), residualScore: residual, residualRating: residual === null ? null : riskRating(residual) };
}

const riskInclude = { controls: { include: { control: { select: { id: true, code: true, title: true, status: true, lastTestedAt: true } } } } } as const;

/** Risks, highest inherent score first, each with its controls and whether its review is overdue. */
export async function listRisks(companyId: string, now = new Date()) {
  const rows = await prisma.riskItem.findMany({ where: { companyId }, include: riskInclude, orderBy: { code: "asc" } });
  return rows
    .map((r) => ({
      ...scored(r),
      controls: r.controls.map((l) => l.control),
      reviewOverdue: !!r.reviewDate && r.reviewDate < now && r.status !== "CLOSED",
    }))
    .sort((a, b) => b.inherentScore - a.inherentScore || a.code.localeCompare(b.code));
}

function validate(input: RiskInput) {
  riskScore(input.likelihood, input.impact);
  if ((input.residualLikelihood == null) !== (input.residualImpact == null)) throw new Error("Give both residual likelihood and impact, or neither");
  if (input.residualLikelihood != null && input.residualImpact != null) riskScore(input.residualLikelihood, input.residualImpact);
}

async function linkControls(companyId: string, riskId: string, controlIds: string[]) {
  const unique = [...new Set(controlIds)];
  const found = await prisma.controlItem.count({ where: { companyId, id: { in: unique } } });
  if (found !== unique.length) throw new Error("A linked control was not found");
  await prisma.riskControlLink.deleteMany({ where: { riskId } });
  if (unique.length) await prisma.riskControlLink.createMany({ data: unique.map((controlId) => ({ riskId, controlId })) });
}

export async function createRisk(companyId: string, input: RiskInput, actor: Actor) {
  validate(input);
  const code = input.code.trim().toUpperCase();
  if (await prisma.riskItem.findUnique({ where: { companyId_code: { companyId, code } } })) throw new Error(`Risk ${code} already exists`);
  return inTransaction(async () => {
    const { controlIds, ...fields } = input;
    const row = await prisma.riskItem.create({ data: { ...fields, code, companyId, createdByErpUserId: actor.erpUserId } });
    if (controlIds?.length) await linkControls(companyId, row.id, controlIds);
    await audit(companyId, actor, "CREATE", "RiskItem", row.id, { ...fields, code, controlIds });
    return row;
  });
}

export async function updateRisk(companyId: string, id: string, input: Partial<RiskInput>, actor: Actor) {
  const before = await prisma.riskItem.findFirst({ where: { id, companyId }, include: { controls: true } });
  if (!before) throw new Error("Risk not found");
  const merged: RiskInput = {
    code: before.code,
    title: before.title,
    category: before.category,
    likelihood: before.likelihood,
    impact: before.impact,
    residualLikelihood: before.residualLikelihood,
    residualImpact: before.residualImpact,
    ...input,
  };
  validate(merged);
  const { controlIds, code: _code, ...fields } = input;
  return inTransaction(async () => {
    const row = await prisma.riskItem.update({ where: { id }, data: fields });
    if (controlIds) await linkControls(companyId, id, controlIds);
    await audit(
      companyId,
      actor,
      "UPDATE",
      "RiskItem",
      id,
      { ...fields, controlIds },
      { likelihood: before.likelihood, impact: before.impact, status: before.status, controlIds: before.controls.map((c) => c.controlId) },
    );
    return row;
  });
}

/** Controls with their latest test and how many risks they address. */
export async function listControlsWithTests(companyId: string) {
  const rows = await prisma.controlItem.findMany({
    where: { companyId },
    include: { tests: { orderBy: { testedAt: "desc" }, take: 1 }, _count: { select: { risks: true, tests: true } } },
    orderBy: { code: "asc" },
  });
  return rows.map(({ tests, _count, ...c }) => ({ ...c, lastTest: tests[0] ?? null, riskCount: _count.risks, testCount: _count.tests }));
}

export async function listControlTests(companyId: string, controlId: string) {
  const control = await prisma.controlItem.findFirst({ where: { id: controlId, companyId } });
  if (!control) throw new Error("Control not found");
  return prisma.controlTest.findMany({ where: { companyId, controlId }, orderBy: { testedAt: "desc" } });
}

/**
 * Records a test of a control. A failed test makes the control DEFICIENT; a pass makes it EFFECTIVE
 * unless a later test has already been recorded.
 */
export async function recordControlTest(
  companyId: string,
  controlId: string,
  input: { testedAt: Date; result: "PASS" | "FAIL"; sampleSize?: number | null; notes?: string | null },
  actor: Actor,
  now = new Date(),
) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  if (input.testedAt > now) throw new Error("The test date cannot be in the future");
  if (input.result === "FAIL" && !input.notes?.trim()) throw new Error("Describe what failed");
  return inTransaction(async () => {
    const control = await prisma.controlItem.findFirst({ where: { id: controlId, companyId } });
    if (!control) throw new Error("Control not found");
    const test = await prisma.controlTest.create({
      data: { companyId, controlId, testedAt: input.testedAt, result: input.result, sampleSize: input.sampleSize, notes: input.notes, testedByErpUserId: actor.erpUserId!, testedByErpRole: actor.erpRole },
    });
    const latest = !control.lastTestedAt || input.testedAt >= control.lastTestedAt;
    if (latest) {
      await prisma.controlItem.update({ where: { id: controlId }, data: { lastTestedAt: input.testedAt, status: input.result === "PASS" ? "EFFECTIVE" : "DEFICIENT" } });
    }
    await audit(companyId, actor, "TEST", "ControlItem", controlId, { testId: test.id, result: input.result, testedAt: input.testedAt, statusChanged: latest }, { status: control.status });
    return test;
  });
}

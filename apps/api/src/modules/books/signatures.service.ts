import { createHash } from "node:crypto";
import { canonicalJson, changedKeys } from "@exceledge/accounting-domain";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

type Actor = { erpUserId?: number; erpRole?: string };

/** Records that can be signed; the snapshot covers their content, with lines where they have them. */
export const SIGNABLE_TYPES = [
  "Journal",
  "ArInvoice",
  "ApBill",
  "Expense",
  "Budget",
  "FixedAsset",
  "BankReconciliation",
  "TaxAdjustment",
  "TaxFiling",
  "FixedAssetImpairment",
  "AccountingPeriod",
] as const;
export type SignableType = (typeof SIGNABLE_TYPES)[number];

export function isSignable(value: string): value is SignableType {
  return (SIGNABLE_TYPES as readonly string[]).includes(value);
}

/**
 * Workflow and running-total fields change after sign-off without changing what was signed (a journal
 * is posted, an invoice is paid, an asset depreciates), so they are left out of the snapshot.
 */
const VOLATILE = new Set([
  "updatedAt",
  "status",
  "postingDate",
  "journalId",
  "voidJournalId",
  "amountPaid",
  "amountCredited",
  "unallocated",
  "remaining",
  "lastUsedAt",
  "reopenReason",
  "reopenedAt",
  "reopenedByErpUserId",
  "closedAt",
  "closedByErpUserId",
]);
const VOLATILE_PATTERN = /^(approved|posted|decided|rejected|voided|reversed|submitted|accumulated|carrying|lastDepreciat|bookValue|netBookValue)/i;

function content(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (VOLATILE.has(key) || VOLATILE_PATTERN.test(key)) continue;
    out[key] = Array.isArray(value) ? value.map((v) => (v && typeof v === "object" ? content(v as Record<string, unknown>) : v)) : value;
  }
  return out;
}

const byLine = { orderBy: { id: "asc" as const } };

async function loadRecord(companyId: string, entityType: SignableType, entityId: string): Promise<Record<string, unknown> | null> {
  const where = { id: entityId, companyId };
  switch (entityType) {
    case "Journal":
      return prisma.journal.findFirst({ where, include: { lines: byLine } });
    case "ArInvoice":
      return prisma.arInvoice.findFirst({ where, include: { lines: byLine } });
    case "ApBill":
      return prisma.apBill.findFirst({ where, include: { lines: byLine } });
    case "Expense":
      return prisma.expense.findFirst({ where, include: { allocations: byLine } });
    case "Budget":
      return prisma.budget.findFirst({ where, include: { lines: byLine } });
    case "FixedAsset":
      return prisma.fixedAsset.findFirst({ where });
    case "BankReconciliation":
      return prisma.bankReconciliation.findFirst({ where });
    case "TaxAdjustment":
      return prisma.taxAdjustment.findFirst({ where });
    case "TaxFiling":
      return prisma.taxFiling.findFirst({ where });
    case "FixedAssetImpairment":
      return prisma.fixedAssetImpairment.findFirst({ where });
    case "AccountingPeriod":
      return prisma.accountingPeriod.findFirst({ where: { id: entityId, financialYear: { companyId } } });
  }
}

/** The signed content of a record: canonical JSON of its non-volatile fields, and its SHA-256. */
export async function snapshotOf(companyId: string, entityType: SignableType, entityId: string) {
  const row = await loadRecord(companyId, entityType, entityId);
  if (!row) return null;
  const snapshot = JSON.parse(canonicalJson(content(row))) as Record<string, unknown>;
  return { snapshot, contentHash: sha256(canonicalJson(snapshot)) };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function signatureHashOf(s: { entityType: string; entityId: string; statement: string; signerErpUserId: number; signedAt: Date; contentHash: string | null; approvalRequestId: string | null }) {
  return sha256(
    canonicalJson({
      entityType: s.entityType,
      entityId: s.entityId,
      statement: s.statement,
      signerErpUserId: s.signerErpUserId,
      signedAt: s.signedAt,
      contentHash: s.contentHash,
      approvalRequestId: s.approvalRequestId,
    }),
  );
}

/** Signs the record as it is now. Runs in the caller's transaction when there is one. */
export async function recordSignature(
  companyId: string,
  input: { entityType: string; entityId: string; statement: string; approvalRequestId?: string },
  actor: Actor,
) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  if (!isSignable(input.entityType)) throw new Error(`Records that can be signed: ${SIGNABLE_TYPES.join(", ")}`);
  const statement = input.statement.trim();
  if (statement.length < 3) throw new Error("Write the statement you are signing");
  const snap = await snapshotOf(companyId, input.entityType, input.entityId);
  if (!snap) throw new Error("The record does not exist");
  const signedAt = new Date();
  const approvalRequestId = input.approvalRequestId ?? null;
  const row = await prisma.signatureRecord.create({
    data: {
      companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      statement,
      signerErpUserId: actor.erpUserId,
      signerErpRole: actor.erpRole,
      contentHash: snap.contentHash,
      snapshot: snap.snapshot as object,
      approvalRequestId,
      signedAt,
      signatureHash: signatureHashOf({ ...input, statement, signerErpUserId: actor.erpUserId, signedAt, contentHash: snap.contentHash, approvalRequestId }),
    },
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "SIGN",
    entityType: input.entityType,
    entityId: input.entityId,
    afterJson: { signatureId: row.id, statement, contentHash: snap.contentHash, approvalRequestId },
  });
  return present(row);
}

function present<T extends { snapshot?: unknown }>(row: T) {
  const { snapshot: _snapshot, ...rest } = row;
  return rest;
}

export async function listSignatures(companyId: string, filter: { entityType?: string; entityId?: string } = {}) {
  const rows = await prisma.signatureRecord.findMany({
    where: { companyId, ...(filter.entityType ? { entityType: filter.entityType } : {}), ...(filter.entityId ? { entityId: filter.entityId } : {}) },
    orderBy: { signedAt: "desc" },
    take: 500,
  });
  return rows.map(present);
}

/**
 * Checks that the signature row is as it was written and that the record still has the content that was
 * signed. Lists the fields that changed since, when the record was changed.
 */
export async function verifySignature(companyId: string, id: string) {
  const row = await prisma.signatureRecord.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("Signature not found");
  if (!row.contentHash || !row.signatureHash) {
    return { signature: present(row), valid: false, signatureIntact: null, contentUnchanged: null, changedFields: [], reason: "Signed before content hashing; there is nothing to verify against" };
  }
  const signatureIntact = signatureHashOf(row) === row.signatureHash;
  const storedSnapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  const snapshotMatches = sha256(canonicalJson(storedSnapshot)) === row.contentHash;
  const current = isSignable(row.entityType) ? await snapshotOf(companyId, row.entityType, row.entityId) : null;
  const contentUnchanged = current ? current.contentHash === row.contentHash : false;
  const changedFields = current ? changedKeys(storedSnapshot, current.snapshot) : [];
  const valid = signatureIntact && snapshotMatches && contentUnchanged;
  const reason = valid
    ? "The signature and the signed content are unchanged"
    : !signatureIntact || !snapshotMatches
      ? "The signature record was altered after signing"
      : !current
        ? "The signed record no longer exists"
        : `The record changed after it was signed (${changedFields.join(", ") || "content"})`;
  return { signature: present(row), valid, signatureIntact: signatureIntact && snapshotMatches, contentUnchanged, changedFields, reason };
}

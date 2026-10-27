import type { Prisma } from "@prisma/client"

/**
 * Training receipts (CIS §5.3): TS = TRAINING + SALE, TR = TRAINING + REFUND.
 *
 * They go through the same VSDC data flow as normal receipts (CIS §6) but as
 * `salesTyCd: "T"`: the RRA reference VSDC (rraVsdcSandbox 3.0.2) then returns
 * its own training counter (shared by TS and TR) and the shared total counter,
 * with empty `intrlData` / `rcptSign` — training receipts carry no signature.
 * They never touch real stock, batches, customer debt, payments or accounting.
 */
export const TRAINING_RECEIPT_LABELS = ["TS", "TR"] as const

export type ReceiptMode = "TRAINING" | "NORMAL"

export function isTrainingLabel(label: string | null | undefined): boolean {
  return label === "TS" || label === "TR"
}

/** VSDC `salesTyCd` (code table 4.8: C/N/P/T) for a CIS receipt label. */
export function vsdcSalesTyCdForLabel(label: string | null | undefined): "T" | "P" | "N" {
  if (isTrainingLabel(label)) return "T"
  return label === "PS" ? "P" : "N"
}

/**
 * Receipts VSDC confirms without `intrlData` / `rcptSign` (CIS §6.3.6: no
 * signature for TRAINING or PROFORMA receipts).
 */
export function isUnsignedLabel(label: string | null | undefined): boolean {
  return isTrainingLabel(label) || label === "PS"
}

/** A refund always takes the training-ness of the receipt it refunds. */
export function refundLabelForOriginal(originalLabel: string | null | undefined): "TR" | "NR" {
  return originalLabel === "TS" ? "TR" : "NR"
}

/**
 * Wrap a `Sale` where-clause so production reports never include TS/TR rows.
 * Legacy rows with no label (NULL) are kept — they predate labelling and were
 * never training receipts.
 */
export function excludeTrainingReceipts<T extends Prisma.SaleWhereInput>(where: T): Prisma.SaleWhereInput {
  return {
    AND: [
      where,
      { OR: [{ rcptLabel: null }, { rcptLabel: { notIn: [...TRAINING_RECEIPT_LABELS] } }] },
    ],
  }
}

export class ReceiptModeMismatchError extends Error {
  status = 409
  code = "RECEIPT_MODE_CHANGED"
  constructor(expected: ReceiptMode, actual: ReceiptMode) {
    super(
      `Receipt mode changed to ${actual === "TRAINING" ? "TRAINING" : "NORMAL"} while this screen was in ${expected} mode. ` +
        "Nothing was recorded — reload the page and try again.",
    )
    this.name = "ReceiptModeMismatchError"
  }
}

export function parseExpectedReceiptMode(value: unknown): ReceiptMode | null {
  return value === "TRAINING" || value === "NORMAL" ? value : null
}

/**
 * A client that states which mode it was showing must be refused when the
 * organization has switched since — otherwise a cashier on a stale screen would
 * silently issue a real NS while believing it is training (or vice versa).
 */
export function assertExpectedReceiptMode(expected: ReceiptMode | null, trainingMode: boolean): void {
  if (!expected) return
  const actual: ReceiptMode = trainingMode ? "TRAINING" : "NORMAL"
  if (expected !== actual) throw new ReceiptModeMismatchError(expected, actual)
}

function receiptModeLockKey(organizationId: number): string {
  return `receipt-mode:${organizationId}`
}

/**
 * Read the organization's receipt mode inside the sale/refund transaction while
 * holding a shared advisory lock, so `setTrainingModeLocked` cannot flip the
 * mode between the read and the commit of this receipt.
 */
export async function readReceiptModeLocked(
  tx: Prisma.TransactionClient,
  organizationId: number,
): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${receiptModeLockKey(organizationId)}))`
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { trainingMode: true } })
  return org?.trainingMode === true
}

/** Exclusive counterpart of `readReceiptModeLocked`: waits for in-flight receipts. */
export async function lockReceiptModeForChange(tx: Prisma.TransactionClient, organizationId: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptModeLockKey(organizationId)}))`
}

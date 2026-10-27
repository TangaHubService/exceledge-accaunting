/**
 * Copy Sale (CS) / Copy Refund (CR) rules — CIS spec §5.3, §6 and §15.
 *
 * A copy is a reprint of an existing, VSDC-confirmed Normal Sale (NS) or
 * Normal Refund (NR). It is NOT a new fiscal transaction: VSDC API v1.0.5
 * `TrnsSalesSaveWrReq.salesTyCd` accepts only "N", so nothing is submitted to
 * VSDC and no new sale, refund, stock movement, payment, tax or accounting
 * entry is created. The printed copy reproduces the original receipt's fiscal
 * identity exactly (SDC ID, A/B receipt counter, internal data, signature,
 * VSDC timestamp, MRC, QR) and is marked only by the COPY header title.
 *
 * Pure functions only (no DB) so the rules are unit-testable.
 */
import type { RenderInvoicePayload } from "./invoice-render.service"

export type CopyLabel = "CS" | "CR"

export class ReceiptCopyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:
      | "COPY_NOT_ALLOWED"
      | "FISCAL_RECORD_MISSING"
      | "FISCAL_DATA_INCOMPLETE"
      | "FISCAL_DATA_MISMATCH",
    message: string,
  ) {
    super(message)
    this.name = "ReceiptCopyError"
  }
}

export const COPY_LABEL_TEXT: Record<CopyLabel, string> = {
  CS: "Copy Sale",
  CR: "Copy Refund",
}

/** Statuses an issued NS/NR receipt can be in. Voided, draft, pending and converted documents are excluded. */
const COPYABLE_STATUSES = new Set([
  "COMPLETED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "PARTIALLY_PAID",
  "OVERPAID",
  "UNPAID",
])

export interface CopySource {
  rcptLabel: string | null
  isProforma: boolean
  originalSaleId: number | null
  status: string
}

/**
 * CS for a Normal Sale, CR for a Normal Refund. Derived from the receipt's own
 * label — never from the sale's refund status, since an NS that was later
 * refunded is still a sale receipt and its copy is CS. Legacy rows without a
 * label are NR when they reference an original sale, NS otherwise.
 */
export function resolveCopyLabel(source: CopySource): CopyLabel {
  const label = source.rcptLabel?.trim().toUpperCase() || null
  if (source.isProforma || label === "PS") {
    throw new ReceiptCopyError(422, "COPY_NOT_ALLOWED", "A proforma is not a fiscal receipt — CS/CR copies apply only to Normal Sale (NS) and Normal Refund (NR) receipts")
  }
  if (label === "TS" || label === "TR") {
    throw new ReceiptCopyError(422, "COPY_NOT_ALLOWED", "Training receipts cannot be copied as CS/CR — only Normal Sale (NS) and Normal Refund (NR) receipts can")
  }
  if (label === "CS" || label === "CR") {
    throw new ReceiptCopyError(422, "COPY_NOT_ALLOWED", "This document is itself a copy — select the original NS/NR receipt")
  }
  if (source.status === "CANCELLED") {
    throw new ReceiptCopyError(422, "COPY_NOT_ALLOWED", "This receipt was voided — a voided receipt cannot be copied")
  }
  if (!COPYABLE_STATUSES.has(source.status)) {
    throw new ReceiptCopyError(422, "COPY_NOT_ALLOWED", `Only an issued NS/NR receipt can be copied (status is ${source.status})`)
  }
  if (label === "NR") return "CR"
  if (label === "NS") return "CS"
  return source.originalSaleId != null ? "CR" : "CS"
}

/** Non-throwing variant for callers that only need to know whether CS/CR applies. */
export function copyLabelFor(source: CopySource): CopyLabel | null {
  try {
    return resolveCopyLabel(source)
  } catch {
    return null
  }
}

export interface StoredFiscalRecord {
  submissionStatus: string | null
  operation: string | null
  sdcId: string | null
  sdcRcptNo: number | null
  totalRcptNo: number | null
  internalData: string | null
  receiptSignature: string | null
  sdcDateTime: Date | string | null
  rcptLabel: string | null
}

const isPositiveInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0
const hasText = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0

/**
 * The stored VSDC confirmation of the original receipt must be complete before
 * a copy can be printed. A copy reproduces these values — it never fills a gap
 * with a configured device value, a local counter or a fabricated signature.
 */
export function assertCopyableFiscalRecord(tx: StoredFiscalRecord | null | undefined, copyLabel: CopyLabel): void {
  const sourceLabel = copyLabel === "CS" ? "NS" : "NR"
  if (!tx || tx.submissionStatus !== "SUCCESS") {
    throw new ReceiptCopyError(
      409,
      "FISCAL_RECORD_MISSING",
      `The original ${sourceLabel} receipt has no VSDC confirmation on record — a ${copyLabel} copy can only reproduce a receipt VSDC has signed`,
    )
  }
  const expectedOperation = copyLabel === "CS" ? "SALE" : "REFUND"
  if (tx.operation && tx.operation !== expectedOperation) {
    throw new ReceiptCopyError(
      409,
      "FISCAL_DATA_MISMATCH",
      `The stored VSDC record is a ${tx.operation} transaction, not the ${expectedOperation} expected for a ${copyLabel} copy`,
    )
  }
  const txLabel = tx.rcptLabel?.trim().toUpperCase() || null
  if (txLabel && txLabel !== sourceLabel) {
    throw new ReceiptCopyError(
      409,
      "FISCAL_DATA_MISMATCH",
      `The stored VSDC record is labelled ${txLabel}, not ${sourceLabel} — refusing to print a ${copyLabel} copy`,
    )
  }

  const missing: string[] = []
  if (!hasText(tx.sdcId)) missing.push("sdcId")
  if (!isPositiveInt(tx.sdcRcptNo)) missing.push("rcptNo")
  if (!isPositiveInt(tx.totalRcptNo)) missing.push("totRcptNo")
  if (!hasText(tx.internalData)) missing.push("intrlData")
  if (!hasText(tx.receiptSignature)) missing.push("rcptSign")
  const dt = tx.sdcDateTime instanceof Date ? tx.sdcDateTime : tx.sdcDateTime ? new Date(tx.sdcDateTime) : null
  if (!dt || Number.isNaN(dt.getTime())) missing.push("vsdcRcptPbctDate")
  if (missing.length) {
    throw new ReceiptCopyError(
      409,
      "FISCAL_DATA_INCOMPLETE",
      `The original ${sourceLabel} receipt is missing VSDC fields (${missing.join(", ")}) — a ${copyLabel} copy cannot be printed without them`,
    )
  }
  if ((tx.totalRcptNo as number) < (tx.sdcRcptNo as number)) {
    throw new ReceiptCopyError(
      409,
      "FISCAL_DATA_INCOMPLETE",
      `The stored VSDC counters are inconsistent (rcptNo ${tx.sdcRcptNo} > totRcptNo ${tx.totalRcptNo}) — a ${copyLabel} copy cannot be printed`,
    )
  }
}

/**
 * Marks a composed original receipt as its CS/CR copy. Only the designation
 * fields change — items, totals, taxes, payments, customer, SDC information
 * and QR are carried over untouched from the original.
 */
export function applyCopyDesignation(
  payload: RenderInvoicePayload,
  copy: { label: CopyLabel; copyNumber: number | null },
): RenderInvoicePayload {
  return {
    ...payload,
    invoice: {
      ...payload.invoice,
      isCopy: true,
      copyLabel: copy.label,
      copyNumber: copy.copyNumber,
      copyOfReceiptNumber: payload.sdcInformation.receiptNumber ?? payload.invoice.receiptNumber ?? null,
      rcptLabelText: COPY_LABEL_TEXT[copy.label],
    },
  }
}

/** Number to store in `reprintCount` after one more copy: the original always counts as issued. */
export function nextReprintCountForCopy(current: number | null | undefined): number {
  return Math.max(current ?? 0, 1) + 1
}

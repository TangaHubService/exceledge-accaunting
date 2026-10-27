import backendPackage from "../../package.json"

export const SYSTEM_NAME = "Excledge ERP"
export const SYSTEM_VERSION = backendPackage.version
export const SYSTEM_POWERED_BY = `${SYSTEM_NAME} v${SYSTEM_VERSION}`
export const SYSTEM_FOOTER = `${SYSTEM_POWERED_BY} Powered by RRA VSDC EBM 2.1.`

/**
 * CIS/VSDC certification requirement §21: "CIS software must have a version
 * number which can be verified and printed on each receipt." This is the
 * labelled string printed in the fiscal block of every receipt renderer; the
 * same value is served verifiably at `GET /api/version`.
 */
export const CIS_VERSION_LABEL = `Software version: v${SYSTEM_VERSION}`

/** RRA EBM refund receipt labels — kept as a single named source rather than inline literals. */
export const REFUND_DOCUMENT_LABEL = "REFUND"
export const REFUND_NOTICE = "REFUND IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT"

/** CIS/VSDC spec §16: the literal title text printed for receipt labels TS/TR. */
export const TRAINING_MODE_LABEL = "TRAINING MODE"

/**
 * CIS/VSDC spec §11: required below the amount totals on COPY, TRAINING, and
 * PROFORMA receipts specifically (regardless of certification) — a genuine
 * NS/NR original must never carry it. Also shown as a fallback for any
 * receipt RRA has not (yet) certified.
 */
export const NOT_OFFICIAL_RECEIPT_NOTICE = "THIS IS NOT AN OFFICIAL RECEIPT"

/**
 * Printed on a real (NS/NR) invoice that a user chose to download/print before
 * VSDC confirmed the sale. Such a document is deliberately not a fiscal receipt
 * — it carries no SDC signature, receipt number, or QR — so it is stamped
 * unmistakably as provisional. `_TITLE` is the watermark/title; `_NOTICE` is the
 * explanatory line shown with the "not an official receipt" block.
 */
export const NOT_FISCALIZED_TITLE = "NOT FISCALISED"
export const NOT_FISCALIZED_NOTICE = "SALE NOT YET CONFIRMED BY RRA VSDC — NOT A VALID TAX RECEIPT"

/**
 * Single source of truth for the composed ERP sales-invoice payload
 * produced by GET /api/sales/:orgId/invoices/:saleId.
 *
 * The backend owns all invoice values and the authoritative PDF. These types
 * describe the metadata envelope used for status and filenames in the UI.
 */

import type { InvoicePdfFormat } from "./invoice-pdf"

export interface InvoiceCompany {
  logo?: string | null
  name: string
  address?: string | null
  branchName?: string | null
  bhfId?: string | null
  phone?: string | null
  email?: string | null
  tin?: string | null
  vrn?: string | null
  mrc?: string | null
  website?: string | null
  currency?: string | null
  /** Whether the branch/org is actually configured with RRA/EBM device credentials. */
  ebmLinked?: boolean
}

export interface InvoiceCustomer {
  name: string
  tin?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  vatNo?: string | null
}

export interface InvoiceLineItem {
  id: string
  line: number
  code?: string | null
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discountPct: number
  discountAmt: number
  taxCode?: string | null
  vatPct: number
  taxAmount: number
  subtotal: number
  net: number
  total: number
}

export interface InvoiceTotals {
  subtotal: number
  discount: number
  taxable: number
  vat: number
  tax: number
  shipping: number
  paid: number
  balance: number
  grandTotal: number
}

/**
 * Raw sale-level charges (as stored on the Sale row). The derived `totals` are
 * computed from these + the line items via {@link calculateInvoiceTotals} so the
 * displayed numbers can never drift from the lines being rendered.
 */
export interface InvoiceCharges {
  vatAmount: number
  taxableAmount: number
  discountAmount: number
  cashAmount: number
  insuranceAmount: number
  debtAmount: number
  totalAmount: number
  shipping: number
}

export interface InvoicePayment {
  method?: string | null
  methodLabel?: string | null
  reference?: string | null
  bank?: string | null
  cashAmount?: number
  insuranceAmount?: number
  debtAmount?: number
  /** One row per means of payment (R1). Empty/absent = legacy single line. */
  lines?: Array<{ method: string; label: string; amount: number }>
}

export interface SdcInformation {
  sdcId?: string | null
  mrcNo?: string | null
  receiptNumber?: string | null
  receiptSignature?: string | null
  internalData?: string | null
  sdcDateTime?: string | null
  date?: string | null
  time?: string | null
  ebmInvoiceNumber?: string | null
  rcptLabel?: string | null
  poweredBy?: string | null
  /** §21: CIS software version, printed on every receipt. */
  softwareVersion?: string | null
}

export interface InvoiceCertification {
  isCertified: boolean
  certificateImage?: string | null
  certificateText?: string | null
}

export interface InvoiceVerification {
  qrCodeImage?: string | null
  qrPayload?: string | null
  verificationUrl?: string | null
}

export interface InvoiceBranding {
  primaryColor?: string | null
  rraLogo?: string | null
  poweredBy?: string | null
}

export interface InvoiceInvoice {
  id: string
  saleNumber: string
  invoiceNumber: string
  receiptNumber: string
  invoiceDate: string
  time: string
  paymentMethod: string
  cashier: string
  status: string
  rcptLabel?: string | null
  rcptLabelText?: string | null
  isProforma: boolean
  isCopy: boolean
  /** CS (copy of an NS) or CR (copy of an NR) — set only on a CS/CR copy. */
  copyLabel?: 'CS' | 'CR' | null
  copyNumber?: number | null
  /** The copied receipt's own VSDC counter, e.g. `168/258 NS`. */
  copyOfReceiptNumber?: string | null
  /**
   * Set when this is a real sale downloaded before VSDC confirmed it
   * ("pending" — still syncing, or "failed" — permanently dead-lettered). The
   * document is watermarked NOT FISCALISED and is not a valid tax receipt.
   */
  notFiscalized?: 'pending' | 'failed' | null
  currency: string
  /** Refunds: printed as REF. NORMAL RECEIPT# — the original sale's SDC `rcptNo` (e.g. `201`). */
  originalReceiptNumber?: string | null
  /** Refunds: the original sale's invcNo, submitted to VSDC as `orgInvcNo`. */
  originalInvoiceNumber?: string | null
  refundReason?: string | null
  refundReasonCode?: string | null
  refundRecipient?: string | null
}

export interface InvoiceFooterNote {
  message?: string | null
  note?: string | null
}

export interface EbmInvoice {
  company: InvoiceCompany
  customer: InvoiceCustomer
  invoice: InvoiceInvoice
  items: InvoiceLineItem[]
  totals: InvoiceTotals
  charges: InvoiceCharges
  payment: InvoicePayment
  sdcInformation: SdcInformation
  certification: InvoiceCertification
  verification: InvoiceVerification
  branding: InvoiceBranding
  footer?: InvoiceFooterNote
  renderedHtml?: string | null
}

/**
 * Half-up 2-decimal rounding for RWF display math (mirrors the backend
 * money.service round2; the backend stays authoritative for fiscal values).
 * The +1e-9 nudge absorbs binary-float boundary error (e.g. 1.005*100).
 */
export function round2(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  const sign = v < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(v) * 100 + 1e-9)) / 100
}

/**
 * Single shared source of truth for all money arithmetic used by the invoice
 * preview and every export. Totals are derived from the fetched line items and
 * sale-level charges rather than trusting a separately-sent total, so they can
 * never drift from what is actually rendered.
 */
export function calculateInvoiceTotals(
  items: InvoiceLineItem[],
  charges: InvoiceCharges,
): InvoiceTotals {
  const toNumber = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const gross = items.reduce((sum, i) => sum + toNumber(i.quantity) * toNumber(i.unitPrice), 0)
  const itemDiscount = items.reduce((sum, i) => sum + toNumber(i.discountAmt), 0)
  const lineTax = items.reduce((sum, i) => sum + toNumber(i.taxAmount), 0)

  const vatAmount = toNumber(charges?.vatAmount)
  const taxableAmount = toNumber(charges?.taxableAmount)
  const discountAmount = toNumber(charges?.discountAmount)
  const cashAmount = toNumber(charges?.cashAmount)
  const insuranceAmount = toNumber(charges?.insuranceAmount)
  const debtAmount = toNumber(charges?.debtAmount)
  const totalAmount = toNumber(charges?.totalAmount)
  const shipping = toNumber(charges?.shipping)

  return {
    subtotal: round2(gross),
    discount: Math.max(0, round2(itemDiscount + discountAmount)),
    taxable: round2(taxableAmount),
    vat: round2(vatAmount),
    tax: round2(lineTax),
    shipping: round2(shipping),
    paid: round2(cashAmount + insuranceAmount),
    balance: round2(debtAmount),
    grandTotal: round2(totalAmount),
  }
}

/** Unwrap `{ success: true, data: {...} }` envelopes returned by the backend. */
export function unwrapInvoice(payload: unknown): EbmInvoice {
  let raw = payload
  if (raw && typeof raw === "object") {
    const r = raw as { success?: boolean; data?: unknown }
    if (r.success === true && r.data != null) raw = r.data
  }
  return raw as EbmInvoice
}

/** A safe, recognisable filename for downloaded or shared sales invoices. */
export function getInvoiceFilename(
  invoice: EbmInvoice | null | undefined,
  fallback = "invoice",
  format: InvoicePdfFormat = "A4",
): string {
  const toFilenamePart = (value: unknown): string => String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  const invoiceNumber = toFilenamePart(invoice?.invoice?.invoiceNumber || invoice?.invoice?.saleNumber)
  const fallbackName = toFilenamePart(fallback) || "invoice"
  const name = invoiceNumber || fallbackName
  const suffix = format === "80mm" ? "-80mm" : format === "A5" ? "-A5" : ""

  return `EBM-Invoice-${name}${suffix}.pdf`
}

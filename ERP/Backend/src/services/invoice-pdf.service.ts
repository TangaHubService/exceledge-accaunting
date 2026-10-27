import PDFDocument from "pdfkit"
import type { RenderInvoiceLineItem, RenderInvoicePayload } from "./invoice-render.service"
import { formatInvoiceAmount, formatInvoiceDateTime, formatInvoiceQuantity, formatItemTaxLabel, formatReceiptQuantity, groupFiscalValue } from "./invoice-format.service"
import { getOrganizationLogo, getRraCertificationLogo } from "./invoice-logo.service"
import { NOT_FISCALIZED_NOTICE, NOT_FISCALIZED_TITLE, NOT_OFFICIAL_RECEIPT_NOTICE, REFUND_DOCUMENT_LABEL, REFUND_NOTICE, SYSTEM_FOOTER, TRAINING_MODE_LABEL } from "./system-branding.service"
import { TAX_RATE_BY_SLOT } from "./rra-ebm.service"
import { Decimal } from "@prisma/client/runtime/library"
import { bandTaxFromNet } from "./money.service"

// The layout below is authored in A4 coordinate space. A5 output renders the
// exact same layout scaled down to fit an A5 sheet (RRA checklist §18: the CIS
// may print the invoice on different formats as long as every required field
// is present).
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const A5_WIDTH = 419.53
const A5_HEIGHT = 595.28
/** Scale factor that fits the A4 layout onto an A5 page (by width). */
const A5_SCALE = A5_WIDTH / PAGE_WIDTH
const LEFT = 25
const RIGHT = 570
const TABLE_TOP = 152
const TABLE_HEADER_HEIGHT = 22
const FINAL_TABLE_BOTTOM = 622
const FULL_TABLE_BOTTOM = 808
const FONT = "Courier"
const FONT_BOLD = "Courier-Bold"
const TRAINING_DESIGNATION_SIZE_A4 = 13

/** The paper sizes a downloaded/printed invoice can be produced in. */
export type InvoicePdfFormat = "A4" | "A5" | "80mm"

interface MeasuredLine {
  item: RenderInvoiceLineItem
  height: number
}

export interface TaxGroup {
  code: string
  rate: number
  total: number
  tax: number
}

export function safe(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim()
  return text || fallback
}

function filenamePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function getEbmInvoiceFilename(data: RenderInvoicePayload, format: InvoicePdfFormat = "A4"): string {
  const number = filenamePart(data.invoice.invoiceNumber || data.invoice.saleNumber || "invoice") || "invoice"
  const suffix = format === "80mm" ? "-80mm" : format === "A5" ? "-A5" : ""
  if (data.invoice.copyLabel) {
    const copyNo = data.invoice.copyNumber ? `-${data.invoice.copyNumber}` : ""
    return `EBM-${data.invoice.copyLabel}-Copy${copyNo}-${number}${suffix}.pdf`
  }
  return `EBM-Invoice-${number}${suffix}.pdf`
}

export function dataUrlBuffer(value?: string | null): Buffer | null {
  if (!value) return null
  const match = value.match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i)
  if (!match) return null
  try {
    return Buffer.from(match[1], "base64")
  } catch {
    return null
  }
}

/**
 * The designation title printed on the receipt. PROFORMA and TRAINING MODE take
 * priority over COPY — reprinting a training/proforma receipt must never lose
 * that designation and start looking like an ordinary copied transaction.
 * COPY (§15) only applies to reprints of a NORMAL receipt in the first place.
 *
 * Every designation is printed once, as the title at the top, plus the "not an
 * official receipt" notice (EBM spec receipt examples 15.1 CR, 16.1 TS, 17.1 PS).
 */
export function documentIndicator(data: RenderInvoicePayload): string {
  const label = safe(data.invoice.rcptLabel).toUpperCase()
  if (data.invoice.isProforma || label === "PS") return "PROFORMA"
  if (label === "TS" || label === "TR") return TRAINING_MODE_LABEL
  if (data.invoice.isCopy || label === "CS" || label === "CR") return "COPY"
  // A real sale downloaded before VSDC confirmed it: the title makes clear the
  // document is provisional. Ranks below COPY/TRAINING/PROFORMA (which can't be
  // pending anyway) and above the plain refund/blank case.
  if (data.invoice.notFiscalized) return NOT_FISCALIZED_TITLE
  if (label === "NR" || (!label && data.invoice.status === "REFUNDED")) return REFUND_DOCUMENT_LABEL
  return ""
}

/**
 * Whether the refund-specific content (REF. NORMAL RECEIPT# + refund notice)
 * should print — independent of the watermark title above. A *copied* refund
 * (NR reprinted, watermark title "COPY") is still a refund and must keep
 * showing its reference to the original sale, per spec §15's own CR example.
 */
export function isRefundTransaction(data: RenderInvoicePayload): boolean {
  const label = safe(data.invoice.rcptLabel).toUpperCase()
  return label === "NR" || label === "TR" || (!label && data.invoice.status === "REFUNDED")
}

/** TS/TR — printed purely for practice (CIS §16), never an official receipt. */
export function isTrainingDocument(data: RenderInvoicePayload): boolean {
  const label = safe(data.invoice.rcptLabel).toUpperCase()
  return label === "TS" || label === "TR"
}

/** Proforma (PS): a quotation, so it carries no payment lines. */
export function isProformaDocument(data: RenderInvoicePayload): boolean {
  return !!data.invoice.isProforma || safe(data.invoice.rcptLabel).toUpperCase() === "PS"
}

/**
 * Reference from a refund to the receipt it reverses. The spec uses the same
 * "REF. NORMAL RECEIPT#" wording on every refund sample (NR §14, CR §15); for
 * a TR the referenced counter itself carries the TS label.
 */
export function refundReferenceLine(data: RenderInvoicePayload, separator = ": "): string {
  const ref = safe(data.invoice.originalReceiptNumber)
  return ref ? `REF. NORMAL RECEIPT#${separator}${ref}` : ""
}

/** CS/CR reprint of an original receipt. */
export function isCopyDocument(data: RenderInvoicePayload): boolean {
  return documentIndicator(data) === "COPY"
}

/** Title printed at the top of the receipt (spec 15.1: a copy is titled COPY). */
export function headerIndicator(data: RenderInvoicePayload): string {
  return documentIndicator(data)
}

/**
 * QR code on signed receipts: NS/NR and their CS/CR reprints, which carry the
 * original's QR unchanged. TS/PS are unsigned and carry none.
 */
export function printsQrCode(data: RenderInvoicePayload): boolean {
  return !isTrainingDocument(data) && !isProformaDocument(data)
}

/**
 * Title printed under a COPY / TRAINING MODE heading: REFUND for a CR or TR
 * (spec 15.1: COPY, then REFUND). A sale copy/TS has none, like an NS.
 */
export function transactionSubTitle(data: RenderInvoicePayload): string {
  const indicator = documentIndicator(data)
  if (indicator !== "COPY" && indicator !== TRAINING_MODE_LABEL) return ""
  return isRefundTransaction(data) ? REFUND_DOCUMENT_LABEL : ""
}


/**
 * TRAINING MODE and PROFORMA carry the "not an official receipt" notice
 * between the items and TOTAL. A COPY is marked only by its header title, and
 * a genuine NORMAL sale/refund (label "" or REFUND) carries no notice.
 */
export function isFormalNoticeIndicator(indicator: string): boolean {
  return indicator !== "" && indicator !== REFUND_DOCUMENT_LABEL && indicator !== "COPY"
}

function drawImageFit(
  doc: PDFKit.PDFDocument,
  image: Buffer | null,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!image) return
  try {
    doc.image(image, x, y, { fit: [width, height], align: "center", valign: "center" })
  } catch (error) {
    console.warn("[INVOICE-PDF] Image could not be rendered:", error instanceof Error ? error.message : error)
  }
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  data: RenderInvoicePayload,
  companyLogo: Buffer | null,
  certificationLogo: Buffer | null,
  pageNumber: number,
  pageCount: number,
): void {
  doc.fillColor("#000000").strokeColor("#000000").lineWidth(0.55)
  drawImageFit(doc, companyLogo, LEFT, 20, 64, 64)
  drawImageFit(doc, certificationLogo, 507, 19, 62, 62)

  const companyLines = [
    safe(data.company.name),
    safe(data.company.address),
    data.company.phone ? `TEL: ${safe(data.company.phone)}` : "",
    data.company.tin ? `TIN: ${safe(data.company.tin)}` : "",
  ].filter(Boolean)

  let companyY = 29
  for (let index = 0; index < companyLines.length; index += 1) {
    doc
      .font(index === 0 ? FONT_BOLD : FONT)
      .fontSize(index === 0 ? 7.2 : 6.3)
      .text(companyLines[index], 122, companyY, { width: 350, align: "center", lineBreak: false })
    companyY += index === 0 ? 10 : 8
  }

  const indicator = headerIndicator(data)
  const isRefundDoc = isRefundTransaction(data)
  const subTitle = transactionSubTitle(data)
  const isTraining = isTrainingDocument(data)
  if (subTitle) {
    // TR: TRAINING MODE heading, then the REFUND title; every refund keeps
    // its reference to the original sale.
    let y = 64
    doc.font(FONT_BOLD).fontSize(TRAINING_DESIGNATION_SIZE_A4).text(indicator, 225, y, { width: 145, align: "center", characterSpacing: 1.7 })
    y += 14
    doc.font(FONT_BOLD).fontSize(6.8).text(subTitle, 225, y, { width: 145, align: "center", characterSpacing: 1.2 })
    y += 8
    if (isRefundDoc) {
      const refLine = refundReferenceLine(data)
      if (refLine) {
        doc.font(FONT).fontSize(5.6).text(refLine, LEFT, y, {
          width: RIGHT - LEFT,
          align: "center",
        })
        y += 7
      }
      doc.font(FONT_BOLD).fontSize(5.8).text(REFUND_NOTICE, LEFT, y, { width: RIGHT - LEFT, align: "center" })
    }
  } else if (indicator && isTraining) {
    // CIS §11: at least twice the largest amount text (table lines, 6.1 pt).
    doc.font(FONT_BOLD).fontSize(TRAINING_DESIGNATION_SIZE_A4).text(indicator, 225, 87, {
      width: 145,
      align: "center",
      characterSpacing: 1.7,
    })
  } else if (indicator) {
    doc.font(FONT_BOLD).fontSize(9.5).text(indicator, 225, isRefundDoc ? 76 : 91, {
      width: 145,
      align: "center",
      characterSpacing: 1.7,
    })
  }
  if (isRefundDoc && !subTitle) {
    const refLine = refundReferenceLine(data)
    if (refLine) {
      doc.font(FONT).fontSize(5.6).text(refLine, LEFT, 89, {
        width: RIGHT - LEFT,
        align: "center",
      })
    }
    doc.font(FONT_BOLD).fontSize(5.8).text(REFUND_NOTICE, LEFT, 97, { width: RIGHT - LEFT, align: "center" })
  }

  doc.moveTo(LEFT, 104).lineTo(RIGHT, 104).dash(2, { space: 1.5 }).stroke().undash()

  doc.font(FONT_BOLD).fontSize(5.7).text("INVOICE TO", LEFT, 109, { width: 150 })
  doc.rect(LEFT, 118, 151, 29).stroke()
  doc.font(FONT).fontSize(5.5)
  doc.text(`TIN   : ${safe(data.customer.tin)}`, LEFT + 5, 121, { width: 141, height: 7, ellipsis: true })
  doc.text(`Name  : ${safe(data.customer.name)}`, LEFT + 5, 129, { width: 141, height: 7, ellipsis: true })
  doc.text(`Phone : ${safe(data.customer.phone)}`, LEFT + 5, 137, { width: 141, height: 8, ellipsis: true })

  doc.rect(447, 118, 123, 29).stroke()
  doc.font(FONT_BOLD).fontSize(5.4).text(`INVOICE NO : ${safe(data.invoice.invoiceNumber, "-")}`, 452, 123, {
    width: 113,
    height: 9,
    ellipsis: true,
  })
  const invoiceDate = formatInvoiceDateTime(data.invoice.invoiceDate)
  doc.font(FONT).fontSize(5.6).text(`Date : ${invoiceDate.date}`, 452, 135, { width: 113, height: 8, ellipsis: true })

  if (pageCount > 1) {
    doc.font(FONT).fontSize(5).text(`Page ${pageNumber}/${pageCount}`, 390, 109, { width: 180, align: "right" })
  }
}

const COLUMN_WIDTHS = [22, 92, 132, 43, 43, 90, 123]
const COLUMN_HEADERS = ["#", "Item Code", "Item Description", "Qty", "Tax", "Unit Price", "Total Price"]

function columnPositions(): number[] {
  const positions = [LEFT]
  for (const width of COLUMN_WIDTHS) positions.push(positions[positions.length - 1] + width)
  return positions
}

/** Item description plus the spec's discount line ("discount -25%"), as on the roll receipt. */
function itemDescription(item: RenderInvoiceLineItem): string {
  const name = safe(item.description, "-")
  return item.discountPct > 0 ? `${name}\ndiscount -${formatInvoiceQuantity(item.discountPct)}%` : name
}

function measureLines(doc: PDFKit.PDFDocument, items: RenderInvoiceLineItem[]): MeasuredLine[] {
  doc.font(FONT).fontSize(6.2)
  return items.map((item) => {
    const codeHeight = doc.heightOfString(safe(item.code, "-"), { width: COLUMN_WIDTHS[1] - 7 })
    const descriptionHeight = doc.heightOfString(itemDescription(item), { width: COLUMN_WIDTHS[2] - 7 })
    return {
      item,
      height: Math.min(120, Math.max(18, Math.ceil(Math.max(codeHeight, descriptionHeight)) + 7)),
    }
  })
}

function paginateLines(lines: MeasuredLine[]): MeasuredLine[][] {
  if (!lines.length) return [[]]
  const finalCapacity = FINAL_TABLE_BOTTOM - TABLE_TOP - TABLE_HEADER_HEIGHT
  const fullCapacity = FULL_TABLE_BOTTOM - TABLE_TOP - TABLE_HEADER_HEIGHT
  const totalHeight = lines.reduce((sum, line) => sum + line.height, 0)
  if (totalHeight <= finalCapacity) return [lines]

  let finalStart = lines.length
  let finalHeight = 0
  while (finalStart > 0 && finalHeight + lines[finalStart - 1].height <= finalCapacity) {
    finalStart -= 1
    finalHeight += lines[finalStart].height
  }
  if (finalStart === lines.length) finalStart = lines.length - 1

  const pages: MeasuredLine[][] = []
  let page: MeasuredLine[] = []
  let height = 0
  for (const line of lines.slice(0, finalStart)) {
    if (page.length && height + line.height > fullCapacity) {
      pages.push(page)
      page = []
      height = 0
    }
    page.push(line)
    height += line.height
  }
  if (page.length) pages.push(page)
  pages.push(lines.slice(finalStart))
  return pages
}

function drawTable(
  doc: PDFKit.PDFDocument,
  lines: MeasuredLine[],
  isFinalPage: boolean,
): void {
  const positions = columnPositions()
  const naturalBottom = TABLE_TOP + TABLE_HEADER_HEIGHT + lines.reduce((sum, line) => sum + line.height, 0)
  const tableBottom = isFinalPage ? Math.max(FINAL_TABLE_BOTTOM, naturalBottom) : FULL_TABLE_BOTTOM

  doc.strokeColor("#000000").fillColor("#000000").lineWidth(0.65)
  doc.rect(LEFT, TABLE_TOP, RIGHT - LEFT, tableBottom - TABLE_TOP).stroke()
  doc.moveTo(LEFT, TABLE_TOP + TABLE_HEADER_HEIGHT).lineTo(RIGHT, TABLE_TOP + TABLE_HEADER_HEIGHT).stroke()
  for (const x of positions.slice(1, -1)) doc.moveTo(x, TABLE_TOP).lineTo(x, tableBottom).stroke()

  doc.font(FONT_BOLD).fontSize(6.3)
  COLUMN_HEADERS.forEach((header, index) => {
    doc.text(header, positions[index] + 3, TABLE_TOP + 7, {
      width: COLUMN_WIDTHS[index] - 6,
      height: 9,
      align: index === 0 || index >= 3 ? "center" : "left",
      ellipsis: true,
      lineBreak: false,
    })
  })

  let y = TABLE_TOP + TABLE_HEADER_HEIGHT
  doc.font(FONT).fontSize(6.1)
  for (const { item, height } of lines) {
    const tax = formatItemTaxLabel(safe(item.taxCode)) || (Number(item.vatPct) ? `${formatInvoiceQuantity(item.vatPct)}%` : "-")
    const values = [
      formatInvoiceQuantity(item.line),
      safe(item.code, "-"),
      itemDescription(item),
      // Spec 14.1: on a refund only the total is negative, not the quantity.
      formatReceiptQuantity(Math.abs(item.quantity)),
      tax,
      formatInvoiceAmount(item.unitPrice),
      formatInvoiceAmount(item.total),
    ]
    values.forEach((value, index) => {
      doc.text(value, positions[index] + 3, y + 5, {
        width: COLUMN_WIDTHS[index] - 6,
        height: height - 7,
        align: index === 0 || index === 3 || index === 4 ? "center" : index >= 5 ? "right" : "left",
        ellipsis: true,
      })
    })
    y += height
  }
}

export function taxGroups(data: RenderInvoicePayload): TaxGroup[] {
  const grouped = new Map<string, TaxGroup>()
  const programmed = programmedRates(data)
  const codes = ['A', 'B', 'C', 'D'] as const
  for (const item of data.items) {
    const actualCode = safe(item.taxCode).toUpperCase()
    const key = actualCode || `TAX-${formatInvoiceQuantity(item.vatPct)}%`
    const slot = codes.indexOf(key as typeof codes[number])
    const rate = slot >= 0 ? programmed[slot] : (Number(item.vatPct) || 0)
    const existing = grouped.get(key) ?? { code: key, rate, total: 0, tax: 0 }
    existing.total += Number(item.total) || 0
    grouped.set(key, existing)
  }
  const derived = bandTaxAmounts(data.items, programmed)
  for (const [code, tax] of Object.entries(derived)) {
    const band = grouped.get(code)
    if (band && ["A", "B", "C", "D"].includes(code)) band.tax = tax
  }
  const order = ["A", "B", "C", "D"]
  return [...grouped.values()].sort((a, b) => {
    const ai = order.indexOf(a.code)
    const bi = order.indexOf(b.code)
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    return a.code.localeCompare(b.code)
  })
}

export function salesBands(data: RenderInvoicePayload): TaxGroup[] {
  return taxGroups(data).filter((g) => Math.abs(g.total) > 0)
}

export function taxBandRows(data: RenderInvoicePayload): TaxGroup[] {
  return taxGroups(data).filter((g) => Math.abs(g.total) > 0 && (Math.abs(g.tax) > 0 || g.rate > 0))
}

/** R3 receipt label for a band's sales row: `TOTAL A-EX`, `TOTAL B-18.00%`. */
export function bandSalesLabel(code: string, rate: number): string {
  return `TOTAL ${bandSalesSuffix(code, rate)}`
}

/** R3 band suffix shared by every renderer (`A-EX`, `B-18.00%`). */
export function bandSalesSuffix(code: string, rate: number): string {
  return code === "A" ? `${code}-EX` : `${code}-${rate.toFixed(2)}%`
}

/** Programmed A/B/C/D rates (percent) carried on the composed payload. */
export function programmedRates(data: RenderInvoicePayload): [number, number, number, number] {
  const t = (data as { taxRates?: unknown }).taxRates
  if (Array.isArray(t) && t.length === 4 && t.every((r) => typeof r === "number" && Number.isFinite(r))) {
    return [t[0], t[1], t[2], t[3]]
  }
  return [...TAX_RATE_BY_SLOT] as [number, number, number, number]
}

export interface BandTaxItem {
  total: number
  taxCode?: string | null
  vatPct?: number
  taxAmount?: number
}

/**
 * Band-level taxes derived from each band's NET (money.service policy:
 * derived, never summed from per-line cents). `rates` is the programmed
 * A/B/C/D tuple; non-A/B/C/D codes fall back to summing stored line taxes.
 * Signed nets (refunds) yield signed taxes.
 */
export function bandTaxAmounts(
  items: BandTaxItem[],
  rates: [number, number, number, number],
): Record<string, number> {
  const nets: Record<string, Decimal> = {}
  for (const it of items) {
    const code = (it.taxCode ?? "").toUpperCase() || "A"
    // Exact Decimal accumulation per line leg (each leg string-normalized),
    // so binary-float dust in the legs can never reach the band derivation.
    nets[code] = (nets[code] ?? new Decimal(0)).plus(new Decimal(String(Number(it.total) || 0)))
  }
  const out: Record<string, number> = {}
  for (const [code, net] of Object.entries(nets)) {
    const slot = ["A", "B", "C", "D"].indexOf(code)
    if (slot >= 0) {
      out[code] = rates[slot] > 0 ? bandTaxFromNet(net, rates[slot]) : 0
    } else {
      out[code] = items
        .filter((it) => ((it.taxCode ?? "").toUpperCase() || "A") === code)
        .reduce((s, it) => s + (Number(it.taxAmount) || 0), 0)
    }
  }
  return out
}

/** Draws the totals box and returns the y just below it. */
function drawSummary(doc: PDFKit.PDFDocument, data: RenderInvoicePayload): number {
  const currency = safe(data.invoice.currency || data.company.currency, "RWF")
  const currencyLabel = currency.toUpperCase() === "RWF" ? "" : ` ${currency.toUpperCase()}`
  const groups = taxBandRows(data)
  const totalTax = taxGroups(data).reduce((sum, group) => sum + group.tax, 0)
  const rows: Array<[string, number | string]> = [[`Total${currencyLabel}`, data.totals.grandTotal]]
  for (const group of salesBands(data)) {
    rows.push([`Total ${bandSalesSuffix(group.code, group.rate)}${currencyLabel}`, group.total])
  }
  for (const group of groups) {
    rows.push([`Total Tax ${group.code}${currencyLabel}`, group.tax])
  }
  rows.push([`Total Tax${currencyLabel}`, totalTax])
  // Spec order: payment method(s), then ITEMS NUMBER. A proforma (spec 17.1)
  // prints neither.
  if (!isProformaDocument(data)) {
    // R1: every means of payment with its amount; single line legacy otherwise.
    if (data.payment.lines?.length) {
      for (const pl of data.payment.lines) {
        rows.push([safe(pl.label, "-"), pl.amount])
      }
    } else {
      rows.push([safe(data.invoice.paymentMethod, "CASH").toUpperCase(), data.totals.grandTotal])
    }
    // Item counter is a count, not money — print it as a plain integer ("4",
    // never "4.00").
    rows.push(["Items Number", String(data.items.length)])
  }

  const x = 341
  const y = 649
  const width = 229
  const labelWidth = 136
  const rowHeight = Math.min(14, 105 / Math.max(rows.length, 1))
  const height = rowHeight * rows.length
  doc.lineWidth(0.6).rect(x, y, width, height).stroke()
  doc.moveTo(x + labelWidth, y).lineTo(x + labelWidth, y + height).stroke()
  rows.forEach(([label, value], index) => {
    const rowY = y + index * rowHeight
    if (index) doc.moveTo(x, rowY).lineTo(x + width, rowY).stroke()
    doc.font(FONT).fontSize(5.5).text(label, x + 6, rowY + 4, { width: labelWidth - 10, height: rowHeight - 4, ellipsis: true })
    doc.text(typeof value === "number" ? formatInvoiceAmount(value) : safe(value), x + labelWidth + 6, rowY + 4, {
      width: width - labelWidth - 11,
      height: rowHeight - 4,
      align: "right",
      ellipsis: true,
    })
  })
  return y + height
}

/** Draws the SDC block and returns the y just below its last line. */
function drawFiscalInformation(doc: PDFKit.PDFDocument, data: RenderInvoicePayload): number {
  const sdc = data.sdcInformation
  // Slips still awaiting VSDC confirmation (including proforma/training
  // originals printed via allowPending) carry no VSDC signature yet, but the
  // printout must still show the transaction's date/time and receipt number —
  // fall back to the invoice-level values whenever the fiscal-specific fields
  // are absent.
  const sdcDate = formatInvoiceDateTime(sdc.sdcDateTime || sdc.date || data.invoice.invoiceDate)
  const sdcReceiptNo = safe(sdc.receiptNumber) || safe(data.invoice.receiptNumber)
  const invoiceDate = formatInvoiceDateTime(data.invoice.invoiceDate)
  const indicator = documentIndicator(data)
  const lines = [
    sdcDate.date || sdcDate.time ? `Date: ${sdcDate.date} Time: ${sdcDate.time}` : "",
    sdc.sdcId ? `SDC ID: ${safe(sdc.sdcId)}` : "",
    sdcReceiptNo ? `RECEIPT NUMBER: ${sdcReceiptNo}` : "",
    sdc.internalData ? `Internal Data:${groupFiscalValue(sdc.internalData)}` : "",
    sdc.receiptSignature ? `Receipt Signature:${groupFiscalValue(sdc.receiptSignature)}` : "",
  ].filter(Boolean)

  doc.fillColor("#000000").font(FONT).fontSize(5.2)

  // Start below the "not official" notice block when present so we don't
  // stack a second divider on top of the notice's closing line.
  const hasNotice = isFormalNoticeIndicator(indicator) || !data.certification.isCertified
  const sdcTop = hasNotice ? 648 : 650

  // RRA sample heading — single divider under it.
  doc.font(FONT_BOLD).fontSize(5.4).text("SDC INFORMATION", LEFT, sdcTop, {
    width: 230,
    height: 10,
    ellipsis: true,
  })
  doc.moveTo(LEFT, sdcTop + 11).lineTo(176, sdcTop + 11).dash(2, { space: 1.5 }).stroke().undash()
  let y = sdcTop + 15
  doc.font(FONT).fontSize(5.2)
  for (const line of lines) {
    const lineHeight = Math.max(8, doc.heightOfString(line, { width: 230 }))
    doc.text(line, LEFT, y, { width: 230, height: lineHeight, ellipsis: true })
    y += lineHeight + 2
  }

  // Bottom block: same as RRA sample — "RECEIPT NUMBER:8" (VSDC invcNo),
  // not the SDC A/B counter printed above.
  const extraLines = [
    `RECEIPT NUMBER: ${safe(data.invoice.invoiceNumber, "-")}`,
    invoiceDate.date ? `DATE: ${invoiceDate.date} TIME: ${data.invoice.time ? safe(data.invoice.time) : invoiceDate.time}` : "",
    (sdc.mrcNo || data.company.mrc) ? `MRC: ${safe(sdc.mrcNo || data.company.mrc)}` : "",
  ].filter(Boolean)
  if (extraLines.length) {
    doc.moveTo(LEFT, y + 1).lineTo(176, y + 1).dash(2, { space: 1.5 }).stroke().undash()
    y += 6
    for (const line of extraLines) {
      doc.text(line, LEFT, y, { width: 230, height: 8, ellipsis: true })
      y += 9
    }
  }
  return y
}

function drawFinalFooter(doc: PDFKit.PDFDocument, data: RenderInvoicePayload): void {
  // §11: TRAINING MODE/PROFORMA always carry this notice; an uncertified
  // NORMAL sale/refund falls back to it too since it isn't official yet either.
  if (isFormalNoticeIndicator(documentIndicator(data)) || !data.certification.isCertified) {
    doc.moveTo(LEFT, 625).lineTo(RIGHT, 625).dash(2, { space: 1.5 }).stroke().undash()
    // CIS §11: "THIS IS NOT AN OFFICIAL RECEIPT" must be at least twice the
    // amount text size (amount lines use ~6–7.5 pt → notice ≥ 14–15 pt).
    doc.font(FONT_BOLD).fontSize(15).text(NOT_OFFICIAL_RECEIPT_NOTICE, LEFT, 628, {
      width: RIGHT - LEFT,
      align: "center",
      characterSpacing: 0.3,
    })
    if (data.invoice.notFiscalized) {
      doc.font(FONT_BOLD).fontSize(6).text(NOT_FISCALIZED_NOTICE, LEFT, 638, {
        width: RIGHT - LEFT,
        align: "center",
        characterSpacing: 0.2,
      })
    }
    doc.moveTo(LEFT, 642).lineTo(RIGHT, 642).dash(2, { space: 1.5 }).stroke().undash()
  }

  const fiscalBottom = drawFiscalInformation(doc, data)
  if (printsQrCode(data)) {
    drawImageFit(doc, dataUrlBuffer(data.verification.qrCodeImage), 267, 655, 62, 62)
  }
  const summaryBottom = drawSummary(doc, data)

  // Spec 13.1–17.1 end with the THANK YOU commercial message.
  let y = Math.min(Math.max(fiscalBottom, summaryBottom) + 5, PAGE_HEIGHT - 40)
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).dash(2, { space: 1.5 }).stroke().undash()
  y += 4
  doc.font(FONT_BOLD).fontSize(6.4).text("THANK YOU", LEFT, y, { width: RIGHT - LEFT, align: "center", lineBreak: false })
  y += 9
  if (data.footer?.message) {
    doc.font(FONT).fontSize(5.8).text(safe(data.footer.message), LEFT, y, { width: RIGHT - LEFT, align: "center", height: 8, ellipsis: true })
    y += 8
  }

  doc
    .font(FONT)
    .fontSize(5.1)
    .text(safe(data.sdcInformation.poweredBy, SYSTEM_FOOTER), LEFT, Math.min(Math.max(771, y + 2), PAGE_HEIGHT - 14), {
      width: 300,
      height: 10,
      ellipsis: true,
    })
}

/**
 * Generate the authoritative portrait EBM invoice entirely on the backend.
 * `paper` is "A4" (default) or "A5" — A5 renders the identical layout scaled to
 * fit the smaller sheet.
 */
export async function generateEbmInvoicePdf(
  data: RenderInvoicePayload,
  paper: "A4" | "A5" = "A4",
): Promise<Buffer> {
  const isA5 = paper === "A5"
  const sheetW = isA5 ? A5_WIDTH : PAGE_WIDTH
  const sheetH = isA5 ? A5_HEIGHT : PAGE_HEIGHT
  const applyScale = (doc: PDFKit.PDFDocument) => {
    if (!isA5) return
    doc.scale(A5_SCALE, A5_SCALE, { origin: [0, 0] })
    // Layout y is in A4 space: give wrapped text the A4 page bottom, or PDFKit
    // breaks anything below y≈595 onto a spurious extra page.
    doc.page.margins.bottom = sheetH - PAGE_HEIGHT
  }

  const [companyLogo, certificationLogo] = await Promise.all([
    getOrganizationLogo(),
    getRraCertificationLogo(),
  ])

  const invoiceTimestamp = new Date(data.invoice.invoiceDate)
  const stableTimestamp = Number.isNaN(invoiceTimestamp.getTime()) ? new Date(0) : invoiceTimestamp
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [sheetW, sheetH],
    margin: 0,
    compress: true,
    info: {
      Title: `EBM Invoice ${data.invoice.invoiceNumber}`,
      Author: data.company.name,
      Subject: `RRA VSDC EBM 2.1 fiscal invoice (${paper})`,
      Creator: "Excel Edge backend invoice service",
      Producer: "PDFKit",
      CreationDate: stableTimestamp,
      ModDate: stableTimestamp,
    },
  })

  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })

  // A page is required for PDFKit text measurement. It becomes page one.
  doc.addPage({ size: [sheetW, sheetH], margin: 0 })
  const pages = paginateLines(measureLines(doc, data.items))
  pages.forEach((lines, index) => {
    if (index > 0) doc.addPage({ size: [sheetW, sheetH], margin: 0 })
    const finalPage = index === pages.length - 1
    // A5: draw the A4-space layout under a scale transform so every field is
    // reproduced exactly, just smaller.
    doc.save()
    applyScale(doc)
    drawHeader(doc, data, companyLogo, certificationLogo, index + 1, pages.length)
    drawTable(doc, lines, finalPage)
    if (finalPage) drawFinalFooter(doc, data)
    doc.restore()
  })

  doc.end()
  return output
}

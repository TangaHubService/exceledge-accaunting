import PDFDocument from "pdfkit"
import type { RenderInvoicePayload } from "./invoice-render.service"
import { formatInvoiceAmount, formatInvoiceDateTime, formatInvoiceQuantity, formatItemTaxLabel, formatReceiptQuantity, groupFiscalValue } from "./invoice-format.service"
import { getOrganizationLogo, getRraCertificationLogo } from "./invoice-logo.service"
import { NOT_FISCALIZED_NOTICE, NOT_OFFICIAL_RECEIPT_NOTICE, REFUND_NOTICE, SYSTEM_FOOTER } from "./system-branding.service"
import { dataUrlBuffer, documentIndicator, headerIndicator, isCopyDocument, isFormalNoticeIndicator, isProformaDocument, isRefundTransaction, isTrainingDocument, printsQrCode, refundReferenceLine, safe, bandSalesLabel, salesBands, taxBandRows, taxGroups, transactionSubTitle } from "./invoice-pdf.service"

/**
 * Narrow, continuous "thermal roll" layout for 80mm POS printers — the
 * classic CIS/VSDC receipt format shown in the technical spec's own worked
 * examples (§13–17), as an alternative to the A4 sheet from
 * invoice-pdf.service.ts. Both renderers consume the same RenderInvoicePayload,
 * so nothing about how a sale is composed changes between formats.
 */

// 80mm paper at 72pt/inch, with a small margin on each side for the printer's
// unprintable edge — matches what real thermal printers leave blank.
const PAGE_WIDTH = 226.77
const MARGIN = 10
const CONTENT_LEFT = MARGIN
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN
const FONT = "Courier"
const FONT_BOLD = "Courier-Bold"
// Generous scratch height for the measuring pass; the real page is sized to
// the exact content height this pass reports.
const MEASURE_HEIGHT = 4000
// CIS §11: TRAINING designation/notice at least twice the amount text (6.2 pt).
const TRAINING_TEXT_SIZE = 13

function dashedLine(doc: PDFKit.PDFDocument, y: number): void {
  doc.moveTo(CONTENT_LEFT, y).lineTo(CONTENT_RIGHT, y).dash(1.5, { space: 1.2 }).stroke().undash()
}

function centeredText(doc: PDFKit.PDFDocument, text: string, y: number, bold = false, size = 6.4): number {
  doc.font(bold ? FONT_BOLD : FONT).fontSize(size)
  doc.text(text, CONTENT_LEFT, y, { width: CONTENT_WIDTH, align: "center" })
  return y + doc.heightOfString(text, { width: CONTENT_WIDTH }) + 1
}

/**
 * Left-aligned label + right-aligned value on the same line, like a receipt
 * column pair. When the value is too wide to share the line (very large
 * totals), the value drops to its own right-aligned line instead of
 * overprinting the label.
 */
function labelValueLine(doc: PDFKit.PDFDocument, label: string, value: string, y: number, bold = false): number {
  doc.font(bold ? FONT_BOLD : FONT).fontSize(6.2)
  const labelWidth = CONTENT_WIDTH - doc.widthOfString(value) - 6
  if (labelWidth >= CONTENT_WIDTH * 0.35) {
    doc.text(label, CONTENT_LEFT, y, { width: labelWidth, align: "left" })
    doc.text(value, CONTENT_LEFT, y, { width: CONTENT_WIDTH, align: "right" })
    return y + Math.max(doc.heightOfString(label, { width: labelWidth }), 8) + 1
  }
  doc.text(label, CONTENT_LEFT, y, { width: CONTENT_WIDTH, align: "left" })
  y += Math.max(doc.heightOfString(label, { width: CONTENT_WIDTH }), 8) + 1
  doc.text(value, CONTENT_LEFT, y, { width: CONTENT_WIDTH, align: "right" })
  return y + Math.max(doc.heightOfString(value, { width: CONTENT_WIDTH }), 8) + 1
}

function wrappedLine(doc: PDFKit.PDFDocument, text: string, y: number, size = 6.2): number {
  doc.font(FONT).fontSize(size)
  doc.text(text, CONTENT_LEFT, y, { width: CONTENT_WIDTH })
  return y + doc.heightOfString(text, { width: CONTENT_WIDTH }) + 1
}

/**
 * Draws the whole receipt starting at `startY` and returns the final y
 * position. Called twice: once on a tall scratch page purely to learn the
 * total content height, then again on the real, exactly-sized page.
 */
function drawReceipt(
  doc: PDFKit.PDFDocument,
  data: RenderInvoicePayload,
  companyLogo: Buffer | null,
  certificationLogo: Buffer | null,
  startY: number,
): number {
  let y = startY

  // Same two logos as the A4 layout (invoice-pdf.service.ts drawHeader):
  // the RRA logo on the left, the EBM certification seal on the right —
  // just stacked side by side instead of flanking the full-width company
  // block, since 80mm paper has no room for that.
  const logoSize = 28
  let usedLogoRow = false
  if (companyLogo) {
    try {
      doc.image(companyLogo, CONTENT_LEFT, y, { fit: [logoSize, logoSize] })
      usedLogoRow = true
    } catch {
      // Logo is best-effort on the compact layout; text content always prints.
    }
  }
  if (certificationLogo) {
    try {
      doc.image(certificationLogo, CONTENT_RIGHT - logoSize, y, { fit: [logoSize, logoSize] })
      usedLogoRow = true
    } catch {
      // Logo is best-effort on the compact layout; text content always prints.
    }
  }
  if (usedLogoRow) y += logoSize + 4

  y = centeredText(doc, safe(data.company.name, "—"), y, true, 7.5)
  if (data.company.address) y = centeredText(doc, safe(data.company.address), y)
  if (data.company.phone) y = centeredText(doc, `TEL: ${safe(data.company.phone)}`, y)
  y = centeredText(doc, `TIN: ${safe(data.company.tin, "-")}`, y)

  const indicator = documentIndicator(data)
  const title = headerIndicator(data)
  const isTraining = isTrainingDocument(data)
  if (title) {
    y += 2
    // CIS §11: designation TRAINING/PROFORMA must dominate amount text.
    y = centeredText(doc, title, y, true, isTraining ? TRAINING_TEXT_SIZE : 12)
  }
  const subTitle = transactionSubTitle(data)
  if (subTitle) y = centeredText(doc, subTitle, y, true, 8)
  // Real sale printed before VSDC confirmed it — spell out that the slip is
  // provisional right under the NOT FISCALISED title.
  if (data.invoice.notFiscalized) {
    y = centeredText(doc, NOT_FISCALIZED_NOTICE, y, true, 6)
  }
  // A copied refund (COPY watermark) is still a refund and keeps its
  // reference to the original sale, independent of which title printed above.
  if (isRefundTransaction(data)) {
    const refLine = refundReferenceLine(data)
    if (refLine) y = centeredText(doc, refLine, y)
  }

  y += 2
  dashedLine(doc, y)
  y += 5
  // Spec 14.1/15.1: the approval notice opens the client section.
  if (isRefundTransaction(data)) y = centeredText(doc, REFUND_NOTICE, y, true)
  // RRA checklist §35: TIN, name, and mobile contact must always be shown,
  // labels included even when a field is blank — never drop the whole line.
  y = centeredText(doc, `Client: ${safe(data.customer.name)}`, y)
  y = centeredText(doc, `Client TIN: ${safe(data.customer.tin)}`, y)
  y = centeredText(doc, `Client Tel: ${safe(data.customer.phone)}`, y)
  y += 2
  dashedLine(doc, y)
  y += 6

  for (const item of data.items) {
    y = wrappedLine(doc, safe(item.description, "-"), y, 6.3)
    const taxSuffix = formatItemTaxLabel(safe(item.taxCode))
    // Spec 14.1: on a refund only the total is negative ("9000.00x 5.354 -48186.00B").
    const priceLine = `${formatInvoiceAmount(item.unitPrice)}x ${formatReceiptQuantity(Math.abs(item.quantity))}`
    const totalLine = `${formatInvoiceAmount(item.subtotal)}${taxSuffix}`
    y = labelValueLine(doc, priceLine, totalLine, y)
    if (item.discountPct > 0) {
      y = labelValueLine(doc, `discount -${formatInvoiceQuantity(item.discountPct)}%`, formatInvoiceAmount(item.total), y)
    }
  }

  y += 2
  dashedLine(doc, y)
  y += 5
  const requiresNotice = isFormalNoticeIndicator(indicator) || !data.certification.isCertified
  if (requiresNotice) {
    // Spec 15.1/16.1/17.1: the notice sits between the items and TOTAL.
    // CIS §11: at least twice the amount-line size (~6.2 pt → ≥ 12.4 pt).
    y = centeredText(doc, NOT_OFFICIAL_RECEIPT_NOTICE, y, true, isTraining ? TRAINING_TEXT_SIZE : 12.4)
    y += 2
    dashedLine(doc, y)
    y += 5
  }

  const currency = safe(data.invoice.currency || data.company.currency, "RWF")
  const currencyLabel = currency.toUpperCase() === "RWF" ? "" : ` ${currency.toUpperCase()}`
  const groups = taxBandRows(data)
  const totalTax = taxGroups(data).reduce((sum, group) => sum + group.tax, 0)

  y = labelValueLine(doc, `TOTAL${currencyLabel}`, formatInvoiceAmount(data.totals.grandTotal), y, true)
  for (const group of salesBands(data)) {
    y = labelValueLine(doc, `${bandSalesLabel(group.code, group.rate)}${currencyLabel}`, formatInvoiceAmount(group.total), y)
  }
  for (const group of groups) {
    y = labelValueLine(doc, `TOTAL TAX ${group.code}`, formatInvoiceAmount(group.tax), y)
  }
  y = labelValueLine(doc, "TOTAL TAX", formatInvoiceAmount(totalTax), y)

  y += 2
  dashedLine(doc, y)
  y += 5
  // R1: every means of payment prints with its amount. Split tenders print
  // one row each; otherwise the single payment-type line (legacy behavior).
  // A proforma (spec 17.1) prints neither payment nor ITEMS NUMBER.
  if (!isProformaDocument(data)) {
    const payLines = data.payment.lines?.length
      ? data.payment.lines.map((l) => ({ label: l.label, amount: l.amount }))
      : [{ label: safe(data.invoice.paymentMethod, "CASH"), amount: data.totals.grandTotal }]
    for (const pl of payLines) {
      y = labelValueLine(doc, safe(pl.label, "CASH").toUpperCase(), formatInvoiceAmount(pl.amount), y)
    }
    y = labelValueLine(doc, "ITEMS NUMBER", String(data.items.length), y)
    y += 2
    dashedLine(doc, y)
    y += 6
  }

  const sdc = data.sdcInformation
  // Spec samples: "SDC INFORMATION" heading directly followed by the fiscal
  // fields. CIS branding (SYSTEM_FOOTER) prints once more at the very bottom.
  y = centeredText(doc, "SDC INFORMATION", y, true, 5.6)
  y += 1

  const sdcDate = formatInvoiceDateTime(sdc.sdcDateTime || sdc.date || data.invoice.invoiceDate)
  const sdcReceiptNo = safe(sdc.receiptNumber) || safe(data.invoice.receiptNumber)
  if (sdcDate.date || sdcDate.time) {
    y = wrappedLine(doc, `Date: ${sdcDate.date} Time: ${sdcDate.time}`, y)
  }
  if (sdc.sdcId) y = wrappedLine(doc, `SDC ID: ${safe(sdc.sdcId)}`, y)
  if (sdcReceiptNo) y = wrappedLine(doc, `RECEIPT NUMBER: ${sdcReceiptNo}`, y)
  if (sdc.internalData) {
    y = wrappedLine(doc, `Internal Data:${groupFiscalValue(sdc.internalData)}`, y)
  }
  if (sdc.receiptSignature) {
    y = wrappedLine(doc, `Receipt Signature:${groupFiscalValue(sdc.receiptSignature)}`, y)
  }

  const qr = printsQrCode(data) ? dataUrlBuffer(data.verification.qrCodeImage) : null
  if (qr) {
    y += 3
    try {
      doc.image(qr, PAGE_WIDTH / 2 - 27, y, { fit: [54, 54] })
      y += 58
    } catch {
      // QR is best-effort — the printed fiscal text above is the fallback.
    }
  }

  y += 2
  dashedLine(doc, y)
  y += 5
  // Bottom block matches RRA sample: plain CIS/VSDC sequence under
  // "RECEIPT NUMBER" (e.g. "RECEIPT NUMBER:8"), distinct from the SDC
  // counter pair printed above ("1190/1190 NS").
  y = wrappedLine(doc, `RECEIPT NUMBER: ${safe(data.invoice.invoiceNumber, "-")}`, y)
  const invoiceDate = formatInvoiceDateTime(data.invoice.invoiceDate)
  if (invoiceDate.date || invoiceDate.time) {
    y = wrappedLine(doc, `DATE: ${invoiceDate.date} TIME: ${invoiceDate.time}`, y)
  }
  const mrc = safe(sdc.mrcNo) || safe(data.company.mrc)
  if (mrc) y = wrappedLine(doc, `MRC: ${mrc}`, y)

  y += 3
  dashedLine(doc, y)
  y += 6
  y = centeredText(doc, "THANK YOU", y, true)
  if (data.footer?.message) y = centeredText(doc, safe(data.footer.message), y)
  y += 4
  y = centeredText(doc, safe(sdc.poweredBy, SYSTEM_FOOTER), y, false, 4.6)

  return y
}

/** Generate the alternative 80mm thermal-roll EBM invoice/receipt. */
export async function generateEbmReceiptPdf80mm(data: RenderInvoicePayload): Promise<Buffer> {
  const [companyLogo, certificationLogo] = await Promise.all([
    getOrganizationLogo(),
    getRraCertificationLogo(),
  ])

  const invoiceTimestamp = new Date(data.invoice.invoiceDate)
  const stableTimestamp = Number.isNaN(invoiceTimestamp.getTime()) ? new Date(0) : invoiceTimestamp
  const documentInfo = {
    Title: `EBM Invoice ${data.invoice.invoiceNumber}`,
    Author: data.company.name,
    Subject: "RRA VSDC EBM 2.1 fiscal invoice (80mm)",
    Creator: "Excel Edge backend invoice service",
    Producer: "PDFKit",
    CreationDate: stableTimestamp,
    ModDate: stableTimestamp,
  }

  // Pass 1: measure on a generously tall scratch page — its output is discarded.
  const scratch = new PDFDocument({ autoFirstPage: false, size: [PAGE_WIDTH, MEASURE_HEIGHT], margin: 0 })
  scratch.on("data", () => {})
  scratch.addPage({ size: [PAGE_WIDTH, MEASURE_HEIGHT], margin: 0 })
  const measuredHeight = drawReceipt(scratch, data, companyLogo, certificationLogo, MARGIN)
  scratch.end()

  // Pass 2: the real page, sized to exactly what was measured (+ bottom margin).
  const pageHeight = Math.ceil(measuredHeight) + MARGIN
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [PAGE_WIDTH, pageHeight],
    margin: 0,
    compress: true,
    info: documentInfo,
  })

  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })

  doc.addPage({ size: [PAGE_WIDTH, pageHeight], margin: 0 })
  drawReceipt(doc, data, companyLogo, certificationLogo, MARGIN)
  doc.end()
  return output
}

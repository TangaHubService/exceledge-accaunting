import { describe, expect, it, vi } from "vitest"
import PDFDocument from "pdfkit"
import QRCode from "qrcode"
import { documentIndicator, generateEbmInvoicePdf } from "../src/services/invoice-pdf.service"
import type { RenderInvoicePayload } from "../src/services/invoice-render.service"
import { NOT_FISCALIZED_TITLE, SYSTEM_FOOTER } from "../src/services/system-branding.service"

function invoiceFixture(itemCount = 1): RenderInvoicePayload {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    line: index + 1,
    code: `ITEM-${String(index + 1).padStart(4, "0")}`,
    description: index === 0
      ? "A deliberately long product description that must wrap safely inside the official EBM item table without escaping its column"
      : `Product ${index + 1}`,
    quantity: 1,
    unit: "PCS",
    unitPrice: index === itemCount - 1 ? 9_999_999.75 : 1_180,
    discountPct: 0,
    discountAmt: 0,
    taxCode: index % 2 === 0 ? "B" : "A",
    vatPct: index % 2 === 0 ? 18 : 0,
    taxAmount: index % 2 === 0 ? 180 : 0,
    subtotal: index === itemCount - 1 ? 9_999_999.75 : 1_180,
    net: index === itemCount - 1 ? 9_999_999.75 : 1_180,
    total: index === itemCount - 1 ? 9_999_999.75 : 1_180,
  }))
  const total = items.reduce((sum, item) => sum + item.total, 0)
  const tax = items.reduce((sum, item) => sum + item.taxAmount, 0)

  return {
    company: {
      logo: null,
      name: "Configured Taxpayer",
      address: "Kigali, Rwanda",
      phone: "+250 700 000 000",
      tin: "100000000",
      currency: "RWF",
      ebmLinked: true,
    },
    customer: { name: "Customer Without TIN", tin: null, address: "Kigali" },
    invoice: {
      id: "42",
      saleNumber: "SALE-42",
      invoiceNumber: "INV-2026-000042",
      receiptNumber: "12/20 NS",
      invoiceDate: "2026-08-26T10:30:00.000Z",
      time: "12:30:00",
      paymentMethod: "Cash",
      cashier: "Cashier",
      status: "COMPLETED",
      rcptLabel: "NS",
      isProforma: false,
      isCopy: true,
      currency: "RWF",
    },
    items,
    totals: { subtotal: total, discount: 0, taxable: total - tax, vat: tax, tax, shipping: 0, paid: total, balance: 0, grandTotal: total },
    charges: { vatAmount: tax, taxableAmount: total - tax, discountAmount: 0, cashAmount: total, insuranceAmount: 0, debtAmount: 0, totalAmount: total, shipping: 0 },
    payment: { method: "CASH", methodLabel: "Cash", cashAmount: total, insuranceAmount: 0, debtAmount: 0 },
    sdcInformation: {
      sdcId: "SDC010000001",
      mrcNo: "MRC010000001",
      receiptNumber: "12/20 NS",
      receiptSignature: "A1B2C3D4E5F6G7H8",
      internalData: "ABCDEFGH12345678",
      sdcDateTime: "2026-08-26T10:30:00.000Z",
      ebmInvoiceNumber: "42",
      rcptLabel: "NS",
      poweredBy: SYSTEM_FOOTER,
    },
    certification: { isCertified: true },
    verification: { qrCodeImage: null, qrPayload: null, verificationUrl: null },
    branding: {},
  }
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length
}

describe("backend EBM A4 PDF generation", () => {
  it("generates a printable one-page A4 invoice without a company logo", async () => {
    const invoice = invoiceFixture()
    invoice.verification.qrPayload = "26082026#123000#SDC010000001#12#ABCDEFGH12345678#A1B2C3D4E5F6G7H8"
    invoice.verification.qrCodeImage = await QRCode.toDataURL(invoice.verification.qrPayload, { width: 220, margin: 1 })
    const pdf = await generateEbmInvoicePdf(invoice, "A4")
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(10_000)
    expect(pageCount(pdf)).toBe(1)
  })

  it("paginates 55 items and keeps the fiscal summary on a final page", async () => {
    const pdf = await generateEbmInvoicePdf(invoiceFixture(55), "A4")
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pageCount(pdf)).toBeGreaterThan(1)
  })

  // RRA checklist §18: the CIS may print the invoice on different formats
  // (A4, A5, paper roll) as long as every required field is present.
  it("renders the same layout on an A5 sheet", async () => {
    const pdf = await generateEbmInvoicePdf(invoiceFixture(3), "A5")
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    // A5 portrait MediaBox is 419.53 x 595.28 pt.
    expect(pdf.toString("latin1")).toMatch(/MediaBox\s*\[\s*0\s+0\s+419\.53\s+595\.28/)
  })

  // RRA checklist §19: a transaction of at least 13 digits including 2 decimals
  // (e.g. 99,999,999,999.99) must be representable and printable.
  it("renders a 13-digit transaction amount without truncation", async () => {
    const big = 99_999_999_999.99
    const invoice = invoiceFixture(1)
    invoice.items[0].unitPrice = big
    invoice.items[0].subtotal = big
    invoice.items[0].net = big
    invoice.items[0].total = big
    invoice.totals = { ...invoice.totals, grandTotal: big, subtotal: big, taxable: big, paid: big }
    const pdf = await generateEbmInvoicePdf(invoice, "A4")
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(10_000)
  })
})

describe("per-tax-type sales totals (Total A/B/C/D)", () => {
  function bandFixture(): RenderInvoicePayload {
    const invoice = normalOriginalFixture()
    const bands: Array<{ code: string; total: number; tax: number; vat: number }> = [
      { code: "A", total: 1500, tax: 0, vat: 0 },
      { code: "B", total: 1180, tax: 180, vat: 18 },
      { code: "C", total: 2000, tax: 0, vat: 0 },
      { code: "D", total: 750, tax: 0, vat: 0 },
    ]
    invoice.items = bands.map((b, i) => ({
      line: i + 1,
      code: `ITEM-${b.code}`,
      description: `Band ${b.code} item`,
      quantity: 1,
      unit: "PCS",
      unitPrice: b.total,
      discountPct: 0,
      discountAmt: 0,
      taxCode: b.code,
      vatPct: b.vat,
      taxAmount: b.tax,
      subtotal: b.total,
      net: b.total,
      total: b.total,
    }))
    return invoice
  }

  it("A4 prints one sales-total row per band that has items", async () => {
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(bandFixture(), "A4"))
    const blob = drawn.join("\n")
    for (const label of ["Total A-EX", "Total B-18.00%", "Total C-0.00%", "Total D-0.00%"]) {
      expect(drawn).toContain(label)
    }
    expect(blob).not.toMatch(/Rwf/i)
  })

  it("A4 omits unused bands entirely (no empty Total A/C/D on a B-only invoice)", async () => {
    const invoice = normalOriginalFixture()
    invoice.items = invoice.items.filter((i) => i.taxCode === "B")
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(invoice, "A4"))
    const blob = drawn.join("\n")
    expect(drawn).toContain("Total B-18.00%")
    expect(blob).not.toMatch(/Total A-EX/)
    expect(blob).not.toMatch(/Total C-/)
    expect(blob).not.toMatch(/Total D-/)
  })
})

/** Collect every string drawn into the PDF, regardless of stream compression. */
function captureDrawnText(run: () => Promise<Buffer>): Promise<string[]> {
  const drawn: string[] = []
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: any, text: unknown, ...rest: unknown[]) {
    drawn.push(String(text))
    return this
  })
  return run().finally(() => spy.mockRestore()).then(() => drawn)
}

function normalOriginalFixture(): RenderInvoicePayload {
  const invoice = invoiceFixture(1)
  invoice.invoice.isCopy = false
  invoice.invoice.rcptLabel = "NS"
  invoice.invoice.notFiscalized = null
  invoice.invoice.receiptNumber = "12/20 NS"
  invoice.sdcInformation.receiptNumber = "12/20 NS"
  invoice.sdcInformation.rcptLabel = "NS"
  return invoice
}

describe("no center stamp (designation lives in the header title only)", () => {
  it("a fiscalized NORMAL original prints no designation at all", async () => {
    const invoice = normalOriginalFixture()
    expect(documentIndicator(invoice)).toBe("")
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(invoice, "A4"))
    const blob = drawn.join("\n")
    expect(blob).not.toContain("COPY")
    expect(blob).not.toContain("TRAINING MODE")
    expect(blob).not.toContain("PROFORMA")
    expect(blob).not.toContain(NOT_FISCALIZED_TITLE)
  })

  it("a COPY reprint: title at the top only (no repeat before SDC INFORMATION), no center watermark", async () => {
    const invoice = normalOriginalFixture()
    invoice.invoice.isCopy = true
    expect(documentIndicator(invoice)).toBe("COPY")
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(invoice, "A4"))
    expect(drawn.filter((t) => t === "COPY")).toHaveLength(1)
  })

  it("a fiscalized TRAINING original: header title only (no repeat below the totals), no center stamp", async () => {
    const invoice = normalOriginalFixture()
    invoice.invoice.rcptLabel = "TS"
    invoice.invoice.receiptNumber = "12/9 TS"
    invoice.sdcInformation.receiptNumber = "12/9 TS"
    invoice.sdcInformation.rcptLabel = "TS"
    expect(documentIndicator(invoice)).toBe("TRAINING MODE")
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(invoice, "A4"))
    expect(drawn.filter((t) => t === "TRAINING MODE")).toHaveLength(1)
    expect(drawn.filter((t) => t === "TRAINING")).toHaveLength(0)
  })

  it("a fiscalized PROFORMA original: title at the top only (no repeat before SDC INFORMATION), no center stamp", async () => {
    const invoice = normalOriginalFixture()
    invoice.invoice.isProforma = true
    invoice.invoice.rcptLabel = "PS"
    invoice.invoice.receiptNumber = "7/4 PS"
    invoice.sdcInformation.receiptNumber = "7/4 PS"
    invoice.sdcInformation.rcptLabel = "PS"
    expect(documentIndicator(invoice)).toBe("PROFORMA")
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(invoice, "A4"))
    expect(drawn.filter((t) => t === "PROFORMA")).toHaveLength(1)
  })

  it("a NOT FISCALISED provisional document designates in the title only (no center stamp)", async () => {
    const invoice = normalOriginalFixture()
    invoice.invoice.notFiscalized = "pending"
    expect(documentIndicator(invoice)).toBe(NOT_FISCALIZED_TITLE)
    const drawn = await captureDrawnText(() => generateEbmInvoicePdf(invoice, "A4"))
    expect(drawn.filter((t) => t === NOT_FISCALIZED_TITLE)).toHaveLength(1)
  })
})

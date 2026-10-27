/**
 * Manual verification script (NOT part of the automated suite):
 * generates every invoice type end-to-end through the REAL code paths and
 * dumps the artefacts for inspection:
 *
 *   temp/invoice-samples/<scenario>.vsdc-payload.json  — exact JSON POSTed to VSDC
 *   temp/invoice-samples/<scenario>.A4.pdf              — authoritative A4 invoice
 *   temp/invoice-samples/<scenario>.80mm.pdf            — thermal-roll receipt
 *   temp/invoice-samples/<scenario>.html                — HTML preview
 *
 * Run:  npx tsx scripts/generate-invoice-samples.ts
 * (from Backend/). No database needed — fixtures are built in-memory.
 */
import { promises as fs } from "fs"
import path from "path"
import QRCode from "qrcode"
import { Decimal } from "@prisma/client/runtime/library"
import {
  buildRraSendReceiptPayload,
  type SaleWithRelations,
} from "../src/services/rra-ebm.service"
import {
  documentIndicator,
  generateEbmInvoicePdf,
} from "../src/services/invoice-pdf.service"
import { generateEbmReceiptPdf80mm } from "../src/services/invoice-receipt-pdf.service"
import {
  renderSalesInvoiceHtml,
  type RenderInvoicePayload,
} from "../src/services/invoice-render.service"
import { SYSTEM_FOOTER } from "../src/services/system-branding.service"

const OUT = path.resolve(process.cwd(), "temp/invoice-samples")

const ORG = { TIN: "100000001", name: "Showwithus Ltd", address: "KG 7 Ave, Kigali", phone: "+250788123456" }
const SDC_ID = "SDC010000001"
const MRC = "MRC010000001"
const SIGNED_AT = "2026-09-15T10:30:00.000Z"
const INTERNAL_DATA = "ABCD1234EFGH5678"
const SIGNATURE = "SIGNA9876TURE5432"

// ---------------------------------------------------------------------------
// VSDC-side fixture (what the sale row looks like when the outbox builds it)
// ---------------------------------------------------------------------------
function vsdcSale(over: {
  id: number
  saleNumber: string
  vsdcInvcNo: number
  rcptLabel: string
  sign: 1 | -1
  buyer: { TIN?: string | null; phone?: string | null; name?: string; customerType?: string }
}): SaleWithRelations {
  const s = over.sign
  const D = (n: number) => new Decimal(s * n)
  return {
    id: over.id,
    saleNumber: over.saleNumber,
    invoiceNumber: `INV-0001-B1-2026-${String(over.vsdcInvcNo).padStart(6, "0")}`,
    vsdcInvcNo: over.vsdcInvcNo,
    prcOrdCd: "ABC123",
    rcptLabel: over.rcptLabel,
    createdAt: new Date(SIGNED_AT),
    status: "COMPLETED",
    paymentType: "CASH",
    cashAmount: D(1180),
    debtAmount: new Decimal(0),
    insuranceAmount: new Decimal(0),
    totalAmount: D(1180),
    taxableAmount: D(1000),
    vatAmount: D(180),
    branchId: 1,
    branch: { id: 1, name: "Main", code: "M", bhfId: "00", ebmDeviceId: SDC_ID, ebmSerialNo: MRC },
    customer: {
      id: 9,
      name: over.buyer.name ?? "Buyer",
      phone: over.buyer.phone ?? "",
      TIN: over.buyer.TIN ?? null,
      customerType: over.buyer.customerType ?? "INDIVIDUAL",
      email: null,
    },
    user: { id: 1, name: "Cashier" },
    saleItems: [
      {
        productId: 10,
        quantity: s * 1,
        unitPrice: new Decimal(1180),
        totalPrice: D(1180),
        taxRate: new Decimal(18),
        taxAmount: D(180),
        taxCode: "B",
        dcRate: new Decimal(0),
        dcAmt: new Decimal(0),
        measurementUnit: "PCS",
        product: {
          name: "Widget",
          itemCd: "RW2CTU0000001",
          itemClsCd: "5059690800",
          pkgUnitCd: "CT",
          qtyUnitCd: "U",
          packagingQty: null,
        },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Display-side fixture (what composeInvoicePayload produces for the renderers)
// ---------------------------------------------------------------------------
async function displayPayload(over: {
  invoiceNumber: string
  receiptNumber: string
  rcptLabel: string
  isProforma: boolean
  isCopy: boolean
  notFiscalized?: "pending" | "failed" | null
  certified: boolean
  buyerName: string
  buyerTin?: string | null
  buyerPhone?: string | null
  sign: 1 | -1
}): Promise<RenderInvoicePayload> {
  const s = over.sign
  const fiscal = over.certified
  const qrRaw = fiscal
    ? `15092026#103000#${SDC_ID}#12#${INTERNAL_DATA}#${SIGNATURE}`
    : null
  return {
    company: {
      logo: null,
      name: ORG.name,
      address: ORG.address,
      phone: ORG.phone,
      tin: ORG.TIN,
      currency: "RWF",
      ebmLinked: true,
    },
    customer: { name: over.buyerName, tin: over.buyerTin ?? null, phone: over.buyerPhone ?? null },
    invoice: {
      id: "7",
      saleNumber: "SALE-7",
      invoiceNumber: over.invoiceNumber,
      receiptNumber: over.receiptNumber,
      invoiceDate: SIGNED_AT,
      time: "12:30:00",
      paymentMethod: "Cash",
      cashier: "Cashier",
      status: s < 0 ? "REFUNDED" : "COMPLETED",
      rcptLabel: over.rcptLabel,
      isProforma: over.isProforma,
      isCopy: over.isCopy,
      notFiscalized: over.notFiscalized ?? null,
      currency: "RWF",
    },
    items: [
      {
        line: 1,
        code: "RW2CTU0000001",
        description: "Widget",
        quantity: s * 1,
        unit: "PCS",
        unitPrice: 1180,
        discountPct: 0,
        discountAmt: 0,
        taxCode: "B",
        vatPct: 18,
        taxAmount: s * 180,
        subtotal: s * 1180,
        net: s * 1180,
        total: s * 1180,
      },
    ],
    totals: {
      subtotal: s * 1180,
      discount: 0,
      taxable: s * 1000,
      vat: s * 180,
      tax: s * 180,
      shipping: 0,
      paid: s * 1180,
      balance: 0,
      grandTotal: s * 1180,
    },
    charges: {
      vatAmount: s * 180,
      taxableAmount: s * 1000,
      discountAmount: 0,
      cashAmount: s * 1180,
      insuranceAmount: 0,
      debtAmount: 0,
      totalAmount: s * 1180,
      shipping: 0,
    },
    payment: { method: "CASH", methodLabel: "Cash", cashAmount: s * 1180, insuranceAmount: 0, debtAmount: 0 },
    sdcInformation: {
      sdcId: fiscal ? SDC_ID : null,
      mrcNo: MRC,
      receiptNumber: fiscal ? over.receiptNumber : s < 0 ? over.receiptNumber : null,
      receiptSignature: fiscal ? SIGNATURE : null,
      internalData: fiscal ? INTERNAL_DATA : null,
      sdcDateTime: fiscal ? SIGNED_AT : null,
      ebmInvoiceNumber: fiscal ? over.invoiceNumber : null,
      rcptLabel: over.rcptLabel,
      poweredBy: SYSTEM_FOOTER,
    },
    certification: { isCertified: fiscal },
    verification: {
      qrCodeImage: qrRaw ? await QRCode.toDataURL(qrRaw, { width: 220, margin: 1 }) : null,
      qrPayload: qrRaw,
      verificationUrl: null,
    },
    branding: {},
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
interface Scenario {
  file: string
  title: string
  note: string
  sale: SaleWithRelations
  payloadOpts?: { orgInvcNo?: number; rfdDt?: Date; rfdRsnCd?: string }
  display: () => Promise<RenderInvoicePayload>
}

const CORPORATE_BUYER = { TIN: "100000002", phone: "+250788428899", name: "Corporate Buyer Ltd", customerType: "CORPORATE" }

// ---------------------------------------------------------------------------
// 10 mixed-kind lines: every tax band (A/B/C/D), products + catalog/ad-hoc
// services, a discounted line, bulk packaging and an insured line.
// Gross 27000, discount 118 → net 26882; VAT (B) extracted: 1782.
// ---------------------------------------------------------------------------
interface MixedLine {
  qty: number
  unitPrice: number
  dcAmt: number
  dcRate: number
  taxCode: string
  taxRate: number
  taxAmount: number
  unit: string
  code: string
  cls: string
  description: string
  productId: number | null
  serviceName?: string
  packagingQty?: number | null
  qtyUnitCd?: string
  useInsurance?: boolean
}

const MIXED_LINES: MixedLine[] = [
  { qty: 2, unitPrice: 590, dcAmt: 0, dcRate: 0, taxCode: "B", taxRate: 18, taxAmount: 180, unit: "PCS", code: "RW1NTX0000001", cls: "5059690800", description: "Paracetamol 500mg", productId: 10 },
  { qty: 3, unitPrice: 500, dcAmt: 0, dcRate: 0, taxCode: "A", taxRate: 0, taxAmount: 0, unit: "PCS", code: "RW1NTX0000002", cls: "5059690800", description: "Exempt Bandage", productId: 11 },
  { qty: 5, unitPrice: 2000, dcAmt: 0, dcRate: 0, taxCode: "C", taxRate: 0, taxAmount: 0, unit: "KG", code: "RW1NTX0000003", cls: "5059690800", description: "Export Coffee 1kg", productId: 12, qtyUnitCd: "KG" },
  { qty: 1, unitPrice: 2360, dcAmt: 0, dcRate: 0, taxCode: "B", taxRate: 18, taxAmount: 360, unit: "PCS", code: "RW2SVC0000005", cls: "5059690800", description: "Consultation", productId: 21, serviceName: "Consultation" },
  { qty: 1, unitPrice: 1000, dcAmt: 0, dcRate: 0, taxCode: "A", taxRate: 0, taxAmount: 0, unit: "PCS", code: "RW2SVC0000006", cls: "5059690800", description: "Delivery fee", productId: 22, serviceName: "Delivery fee" },
  { qty: 4, unitPrice: 295, dcAmt: 118, dcRate: 10, taxCode: "B", taxRate: 18, taxAmount: 162, unit: "PCS", code: "RW1NTX0000006", cls: "5059690800", description: "Discounted Soap", productId: 13 },
  { qty: 2, unitPrice: 750, dcAmt: 0, dcRate: 0, taxCode: "D", taxRate: 0, taxAmount: 0, unit: "KG", code: "RW1NTX0000007", cls: "5059690800", description: "Maize flour 2kg", productId: 14, qtyUnitCd: "KG" },
  { qty: 1, unitPrice: 5900, dcAmt: 0, dcRate: 0, taxCode: "B", taxRate: 18, taxAmount: 900, unit: "BOX", code: "RW1NTX0000008", cls: "5059690800", description: "Syringes box", productId: 15 },
  { qty: 10, unitPrice: 120, dcAmt: 0, dcRate: 0, taxCode: "A", taxRate: 0, taxAmount: 0, unit: "MTR", code: "RW1NTX0000009", cls: "5059690800", description: "Bandage roll 10m", productId: 16, packagingQty: 10 },
  { qty: 1, unitPrice: 1180, dcAmt: 0, dcRate: 0, taxCode: "B", taxRate: 18, taxAmount: 180, unit: "PCS", code: "RW1NTX0000010", cls: "5059690800", description: "Insured Amoxicillin", productId: 30, useInsurance: true },
]

const MIXED_BUYER = { TIN: "100000004", phone: "+250788000100", name: "Good Care Insurance", customerType: "INSURANCE" }

function mixedVsdcSale(): SaleWithRelations {
  return {
    id: 16,
    saleNumber: "SALE-16",
    invoiceNumber: "INV-0001-B1-2026-000016",
    vsdcInvcNo: 16,
    prcOrdCd: "ABC123",
    rcptLabel: "NS",
    createdAt: new Date(SIGNED_AT),
    status: "COMPLETED",
    paymentType: "CASH",
    cashAmount: new Decimal(25702),
    debtAmount: new Decimal(0),
    insuranceAmount: new Decimal(1180),
    totalAmount: new Decimal(26882),
    taxableAmount: new Decimal(25100),
    vatAmount: new Decimal(1782),
    branchId: 1,
    branch: { id: 1, name: "Main", code: "M", bhfId: "00", ebmDeviceId: SDC_ID, ebmSerialNo: MRC },
    customer: {
      id: 10,
      name: MIXED_BUYER.name,
      phone: MIXED_BUYER.phone,
      TIN: MIXED_BUYER.TIN,
      customerType: MIXED_BUYER.customerType,
      email: null,
      isrccCd: "ISRCC01",
      isrcRt: 80,
    },
    user: { id: 1, name: "Cashier" },
    saleItems: MIXED_LINES.map((l) => ({
      productId: l.productId,
      quantity: l.qty,
      unitPrice: new Decimal(l.unitPrice),
      totalPrice: new Decimal(l.qty * l.unitPrice),
      taxRate: new Decimal(l.taxRate),
      taxAmount: new Decimal(l.taxAmount),
      taxCode: l.taxCode,
      dcRate: new Decimal(l.dcRate),
      dcAmt: new Decimal(l.dcAmt),
      measurementUnit: l.unit,
      serviceName: l.serviceName ?? null,
      product: l.productId != null
        ? {
            name: l.description,
            itemCd: l.code,
            itemClsCd: l.cls,
            pkgUnitCd: "CT",
            qtyUnitCd: l.qtyUnitCd ?? "U",
            packagingQty: l.packagingQty ?? null,
            useInsurance: l.useInsurance ?? false,
          }
        : null,
    })),
  }
}

async function mixedDisplayPayload(): Promise<RenderInvoicePayload> {
  const qrRaw = `15092026#103000#${SDC_ID}#14#${INTERNAL_DATA}#${SIGNATURE}`
  const items = MIXED_LINES.map((l, i) => {
    const gross = l.qty * l.unitPrice
    const net = gross - l.dcAmt
    return {
      line: i + 1,
      code: l.code,
      description: l.description,
      quantity: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountPct: l.dcRate,
      discountAmt: l.dcAmt,
      taxCode: l.taxCode,
      vatPct: l.taxRate,
      taxAmount: l.taxAmount,
      subtotal: gross,
      net,
      total: net,
    }
  })
  return {
    company: { logo: null, name: ORG.name, address: ORG.address, phone: ORG.phone, tin: ORG.TIN, currency: "RWF", ebmLinked: true },
    customer: { name: MIXED_BUYER.name, tin: MIXED_BUYER.TIN, phone: MIXED_BUYER.phone },
    invoice: {
      id: "16", saleNumber: "SALE-16", invoiceNumber: "16", receiptNumber: "14/24 NS",
      invoiceDate: SIGNED_AT, time: "12:30:00", paymentMethod: "Cash", cashier: "Cashier",
      status: "COMPLETED", rcptLabel: "NS", isProforma: false, isCopy: false, currency: "RWF",
    },
    items,
    totals: { subtotal: 27000, discount: 118, taxable: 25100, vat: 1782, tax: 1782, shipping: 0, paid: 26882, balance: 0, grandTotal: 26882 },
    charges: { vatAmount: 1782, taxableAmount: 25100, discountAmount: 0, cashAmount: 25702, insuranceAmount: 1180, debtAmount: 0, totalAmount: 26882, shipping: 0 },
    payment: { method: "CASH", methodLabel: "Cash", cashAmount: 25702, insuranceAmount: 1180, debtAmount: 0 },
    sdcInformation: {
      sdcId: SDC_ID, mrcNo: MRC, receiptNumber: "14/24 NS",
      receiptSignature: SIGNATURE, internalData: INTERNAL_DATA, sdcDateTime: SIGNED_AT,
      ebmInvoiceNumber: "16", rcptLabel: "NS", poweredBy: SYSTEM_FOOTER,
    },
    certification: { isCertified: true },
    verification: {
      qrCodeImage: await QRCode.toDataURL(qrRaw, { width: 220, margin: 1 }),
      qrPayload: qrRaw,
      verificationUrl: null,
    },
    branding: {},
  }
}

async function main(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true })

  const scenarios: Scenario[] = [
    {
      file: "01-NS-normal-original",
      title: "NS normal sale — fiscalized original (no watermark)",
      note: "First print of a VSDC-confirmed sale. No center watermark.",
      sale: vsdcSale({ id: 11, saleNumber: "SALE-11", vsdcInvcNo: 11, rcptLabel: "NS", sign: 1, buyer: CORPORATE_BUYER }),
      display: () =>
        displayPayload({
          invoiceNumber: "11", receiptNumber: "12/20 NS", rcptLabel: "NS",
          isProforma: false, isCopy: false, certified: true,
          buyerName: CORPORATE_BUYER.name!, buyerTin: CORPORATE_BUYER.TIN, buyerPhone: CORPORATE_BUYER.phone, sign: 1,
        }),
    },
    {
      file: "02-NS-copy-reprint",
      title: "NS reprint — COPY watermark (same VSDC payload, not resubmitted)",
      note: "Second download of the same sale. Reprints never resubmit to VSDC — the payload below is the ORIGINAL submission, shown for comparison.",
      sale: vsdcSale({ id: 11, saleNumber: "SALE-11", vsdcInvcNo: 11, rcptLabel: "NS", sign: 1, buyer: CORPORATE_BUYER }),
      display: () =>
        displayPayload({
          invoiceNumber: "11", receiptNumber: "12/20 NS", rcptLabel: "NS",
          isProforma: false, isCopy: true, certified: true,
          buyerName: CORPORATE_BUYER.name!, buyerTin: CORPORATE_BUYER.TIN, buyerPhone: CORPORATE_BUYER.phone, sign: 1,
        }),
    },
    {
      file: "03-NR-refund",
      title: "NR refund — negative amounts referencing the original invoice",
      note: "Refund fiscalized as a fresh document (salesSttsCd 05, rcptTyCd R) with orgInvcNo pointing at the original.",
      sale: vsdcSale({ id: 12, saleNumber: "REFUND-SALE-11-1", vsdcInvcNo: 12, rcptLabel: "NR", sign: -1, buyer: CORPORATE_BUYER }),
      payloadOpts: { orgInvcNo: 11, rfdDt: new Date("2026-09-15T11:00:00.000Z"), rfdRsnCd: "06" },
      display: () =>
        displayPayload({
          invoiceNumber: "12", receiptNumber: "13/21 NR", rcptLabel: "NR",
          isProforma: false, isCopy: false, certified: true,
          buyerName: CORPORATE_BUYER.name!, buyerTin: CORPORATE_BUYER.TIN, buyerPhone: CORPORATE_BUYER.phone, sign: -1,
        }),
    },
    {
      file: "04-TS-training",
      title: "TS training sale — phone-only buyer, fiscalized, no center stamp",
      note: "Training receipts are submitted to VSDC like normal sales; designation lives in the title + counter.",
      sale: vsdcSale({
        id: 13, saleNumber: "SALE-13", vsdcInvcNo: 13, rcptLabel: "TS", sign: 1,
        buyer: { TIN: null, phone: "788428899", name: "Walk-in Trainee", customerType: "INDIVIDUAL" },
      }),
      display: () =>
        displayPayload({
          invoiceNumber: "13", receiptNumber: "4/22 TS", rcptLabel: "TS",
          isProforma: false, isCopy: false, certified: true,
          buyerName: "Walk-in Trainee", buyerTin: null, buyerPhone: "788428899", sign: 1,
        }),
    },
    {
      file: "05-PS-proforma",
      title: "PS proforma — TIN-only buyer, fiscalized, no center stamp",
      note: "Proforma receipts are submitted to VSDC; designation lives in the title + counter.",
      sale: vsdcSale({
        id: 14, saleNumber: "SALE-14", vsdcInvcNo: 14, rcptLabel: "PS", sign: 1,
        buyer: { TIN: "100000003", phone: "", name: "Quoted Client", customerType: "INDIVIDUAL" },
      }),
      display: () =>
        displayPayload({
          invoiceNumber: "14", receiptNumber: "5/23 PS", rcptLabel: "PS",
          isProforma: true, isCopy: false, certified: true,
          buyerName: "Quoted Client", buyerTin: "100000003", buyerPhone: null, sign: 1,
        }),
    },
    {
      file: "06-NS-pending-not-fiscalised",
      title: "NS pending — NOT FISCALISED provisional print (allowPending view)",
      note: "Printed before VSDC confirmed. Payload below is what WILL be sent (outbox still pending).",
      sale: vsdcSale({
        id: 15, saleNumber: "SALE-15", vsdcInvcNo: 15, rcptLabel: "NS", sign: 1,
        buyer: { TIN: null, phone: "", name: "Anonymous Walk-in", customerType: "INDIVIDUAL" },
      }),
      display: () =>
        displayPayload({
          invoiceNumber: "15", receiptNumber: "SALE-15", rcptLabel: "NS",
          isProforma: false, isCopy: false, notFiscalized: "pending", certified: false,
          buyerName: "Anonymous Walk-in", buyerTin: null, buyerPhone: null, sign: 1,
        }),
    },
    {
      file: "07-mixed-10-items",
      title: "NS mixed sale — 10 lines across tax bands A/B/C/D with per-type totals",
      note: "Products + catalog/ad-hoc services, one discounted line, bulk packaging and one insured line. Per-band sales AND tax totals on the invoice match taxblAmt/taxAmt A/B/C/D in the payload.",
      sale: mixedVsdcSale(),
      display: () => mixedDisplayPayload(),
    },
  ]

  console.log(`\nGenerating ${scenarios.length} invoice scenarios → ${OUT}\n`)
  for (const sc of scenarios) {
    // 1. Exact VSDC request payload through the real builder.
    const payload = buildRraSendReceiptPayload(sc.sale, ORG, "01", sc.payloadOpts ?? {}) as Record<string, unknown>
    const receipt = payload.receipt as Record<string, unknown>
    await fs.writeFile(path.join(OUT, `${sc.file}.vsdc-payload.json`), `${JSON.stringify(payload, null, 2)}\n`)

    // 2. Display payload through the real renderers.
    const display = await sc.display()
    const a4 = await generateEbmInvoicePdf(display, "A4")
    const roll = await generateEbmReceiptPdf80mm(display)
    const html = renderSalesInvoiceHtml(display)
    for (const [buf, ext] of [[a4, "A4.pdf"], [roll, "80mm.pdf"]] as const) {
      if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error(`${sc.file}: invalid PDF generated`)
      await fs.writeFile(path.join(OUT, `${sc.file}.${ext}`), buf)
    }
    await fs.writeFile(path.join(OUT, `${sc.file}.html`), `${html}\n`)

    console.log(`── ${sc.file}`)
    console.log(`   ${sc.title}`)
    console.log(`   VSDC buyer: top custTin=${JSON.stringify(payload.custTin)} | receipt.custTin=${JSON.stringify(receipt.custTin)} | receipt.custMblNo=${JSON.stringify(receipt.custMblNo)} | topMsg=${JSON.stringify(receipt.topMsg)}`)
    console.log(`   Display: title="${documentIndicator(display) || "INVOICE"}" | QR=${display.verification.qrCodeImage ? "yes" : "no"} | PDF A4=${(a4.length / 1024).toFixed(1)}KB 80mm=${(roll.length / 1024).toFixed(1)}KB`)
  }
  console.log(`\nDone. Open ${OUT} to inspect the payloads, PDFs and HTML previews.\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

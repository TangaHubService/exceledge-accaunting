/**
 * Data parity: what was sent to VSDC (`/trnsSales/saveSales` request) and what
 * VSDC returned must be exactly what the receipt prints — 80mm, A4 and HTML.
 *
 * The request is produced by the real buildRraSendReceiptPayload, the reply is
 * persisted the way the outbox persists it, and the receipt is composed by the
 * real composeInvoicePayload against a mocked Prisma. Every fiscal value is a
 * TEST fixture standing in for what VSDC returned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PDFDocument from "pdfkit"
import { Decimal } from "@prisma/client/runtime/library"

type Row = Record<string, any>
const db: { sales: Map<number, Row> } = { sales: new Map() }
let catalogRates: [number, number, number, number] = [0, 18, 0, 0]

const device = vi.hoisted(() => ({ mrcNo: null as string | null }))

vi.mock("../src/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get(_t, model: string) {
      const models: Record<string, any> = {
        sale: { findFirst: vi.fn(async ({ where }: any) => db.sales.get(where.id) ?? null) },
        ebmOutbox: { findFirst: vi.fn(async () => ({ status: "SUCCEEDED", operation: "SALE" })) },
        organization: {
          findUnique: vi.fn(async () => ({
            name: "Test Seller Ltd", avatar: null, address: "KG 123 St, Kigali", phone: "+250788000000", email: null,
            TIN: "999945560", VRN: null, currency: "RWF", ebmDeviceId: "TESTSDC-CONFIGURED", ebmSerialNo: "TESTMRC-CONFIGURED",
          })),
        },
        branch: {
          findUnique: vi.fn(async () => ({ name: "Main", bhfId: "00", ebmDeviceId: "TESTSDC-CONFIGURED", ebmSerialNo: "TESTMRC-CONFIGURED", mrcNo: device.mrcNo, address: null })),
        },
      }
      if (model in models) return models[model]
      return new Proxy({}, { get: () => async () => null })
    },
  }),
}))
vi.mock("../src/services/invoice-logo.service", () => ({
  getOrganizationLogo: vi.fn(async () => null),
  getRraCertificationLogo: vi.fn(async () => null),
}))
vi.mock("../src/services/rra-code.service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getTaxRatesBySlot: vi.fn(async () => catalogRates),
}))

import { buildRraSendReceiptPayload, type SaleWithRelations } from "../src/services/rra-ebm.service"
import { parseVsdcResponse } from "../src/services/vsdc-api.service"
import { assertNrWirePayload } from "../src/services/refund-calculation.service"
import { composeInvoicePayload } from "../src/controllers/sales.controller"
import { generateEbmInvoicePdf } from "../src/services/invoice-pdf.service"
import { generateEbmReceiptPdf80mm } from "../src/services/invoice-receipt-pdf.service"
import { renderSalesInvoiceHtml, type RenderInvoicePayload } from "../src/services/invoice-render.service"
import { readVsdcRecord, vsdcPrintedTextErrors, vsdcReceiptParityErrors } from "../src/services/vsdc-receipt-parity.service"

// ── fixtures ────────────────────────────────────────────────────────────────

const ORG = { TIN: "999945560", name: "Test Seller Ltd", address: "KG 123 St, Kigali", phone: "+250788000000" }
const CUSTOMER = {
  id: 7, name: "Walk-in Customer", phone: "+250788333001", TIN: null, email: null, address: null,
  customerType: "INDIVIDUAL", custPrvncNm: null, custDstrtNm: null, custSctrNm: null, custLocDesc: null,
}

function item(over: Row): Row {
  return {
    dcAmt: new Decimal(0), dcRate: new Decimal(0), measurementUnit: "PCS", itemType: "PRODUCT",
    serviceName: null, serviceDescription: null, ...over,
  }
}

const NS_ITEMS = [
  item({ id: 1, productId: 21, quantity: new Decimal(1), unitPrice: new Decimal(3000), totalPrice: new Decimal(3000), taxRate: new Decimal(18), taxAmount: new Decimal(457.63), taxCode: "B", itemType: "SERVICE", serviceName: "Lab test (service alias)", product: { name: "Lab test", itemCd: "TESTVU3NTU021", itemClsCd: "5612180500", pkgUnitCd: "NT", qtyUnitCd: "U", packagingQty: null } }),
  item({ id: 2, productId: 4, quantity: new Decimal(1), unitPrice: new Decimal(2500), totalPrice: new Decimal(2500), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: "A", product: { name: "Hand Sanitizer 500ml", itemCd: "TESTCN2NTU004", itemClsCd: "5059690800", pkgUnitCd: "NT", qtyUnitCd: "U", packagingQty: null } }),
  item({ id: 3, productId: 10, quantity: new Decimal(1), unitPrice: new Decimal(5500), totalPrice: new Decimal(5500), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: "A", measurementUnit: "LTR", product: { name: "Glycerin USP", itemCd: "TESTUG1NTL010", itemClsCd: "5059690800", pkgUnitCd: "NT", qtyUnitCd: "LTR", packagingQty: null } }),
]

function negate(it: Row): Row {
  return { ...it, id: it.id + 100, quantity: it.quantity.neg(), totalPrice: it.totalPrice.neg(), taxAmount: it.taxAmount.neg() }
}

function nsSale(): Row {
  return {
    id: 68, organizationId: 1, branchId: 1, saleNumber: "SALE-68", invoiceNumber: "INV-B1-2026-000072", vsdcInvcNo: 72,
    status: "REFUNDED", rcptLabel: "NS", isProforma: false, originalSaleId: null, reprintCount: 1, prcOrdCd: "TESTPC0545",
    paymentType: "CASH", totalAmount: new Decimal(11000), cashAmount: new Decimal(11000), debtAmount: new Decimal(0),
    insuranceAmount: new Decimal(0), vatAmount: new Decimal(457.63), taxableAmount: new Decimal(10542.37),
    createdAt: new Date("2026-10-14T13:52:47.206Z"),
    localReceiptSeq: null, localReceiptTotalSeq: null, refundReason: null, rfdRsnCd: null, refundRecipient: null,
    customer: CUSTOMER, user: { id: 2, name: "Demo Admin" },
    saleItems: NS_ITEMS, salePayments: [{ paymentMethod: "CASH", amount: 11000 }],
    ebmTransactions: [], originalSale: null,
  }
}

function nrSale(): Row {
  return {
    ...nsSale(),
    id: 69, saleNumber: "REFUND-SALE-68-1", invoiceNumber: "INV-B1-2026-000073", vsdcInvcNo: 73,
    rcptLabel: "NR", originalSaleId: 68, prcOrdCd: "TESTPC0546",
    totalAmount: new Decimal(-11000), cashAmount: new Decimal(-11000), vatAmount: new Decimal(-457.63), taxableAmount: new Decimal(-10542.37),
    createdAt: new Date("2026-10-14T14:04:09.622Z"),
    refundReason: "items are dead", rfdRsnCd: "06", refundRecipient: "Walk-in Customer",
    saleItems: NS_ITEMS.map(negate), salePayments: [],
  }
}

function vsdcReply(rcptNo: number, totRcptNo: number, pbct: string, tag: string): Row {
  return {
    resultCd: "000", resultMsg: "It is succeeded", resultDt: pbct,
    data: { rcptNo, totRcptNo, vsdcRcptPbctDate: pbct, intrlData: `TESTINTL${tag}AAAABBBBCCCCDD`, rcptSign: `TESTSIGN${tag}EEEE`, sdcId: "TESTSDC012000250", mrcNo: "TESTWIS0102946" },
  }
}

/** Persist the exchange exactly like ebm-outbox does on success. */
function persistTx(saleId: number, operation: string, label: string, request: Row, reply: Row): Row {
  const vsdc = parseVsdcResponse(reply)
  return {
    id: saleId * 10, saleId, operation, submissionStatus: "SUCCESS", rcptLabel: label,
    ebmInvoiceNumber: vsdc.rcptNo, sdcDateTime: new Date(vsdc.sdcDateTime),
    sdcRcptNo: parseInt(vsdc.rcptNo, 10), totalRcptNo: parseInt(vsdc.totRcptNo, 10),
    sdcId: vsdc.sdcId, internalData: vsdc.intrlData, receiptSignature: vsdc.vsdcSignature, qrPayload: null,
    responseData: { raw: reply, normalized: vsdc, requestPayload: request },
    createdAt: new Date(),
  }
}

function fiscalize() {
  const ns = nsSale()
  const nsRequest = buildRraSendReceiptPayload(ns as unknown as SaleWithRelations, ORG, "01", { taxRates: [0, 18, 0, 0] })
  const nsReply = vsdcReply(201, 216, "20261014155249", "NS01")
  ns.ebmTransactions = [persistTx(68, "SALE", "NS", nsRequest, nsReply)]

  const nr = nrSale()
  // ebm-outbox: orgInvcNo is the original sale's vsdcInvcNo, rfdDt the refund's creation.
  const nrRequest = buildRraSendReceiptPayload(nr as unknown as SaleWithRelations, ORG, "01", {
    orgInvcNo: ns.vsdcInvcNo, rfdDt: nr.createdAt, rfdRsnCd: "06", taxRates: [0, 18, 0, 0],
  })
  nrRequest.remark = "items are dead"
  assertNrWirePayload(nrRequest)
  const nrReply = vsdcReply(202, 217, "20261014160409", "NR01")
  nr.ebmTransactions = [persistTx(69, "REFUND", "NR", nrRequest, nrReply)]
  nr.originalSale = {
    vsdcInvcNo: ns.vsdcInvcNo, invoiceNumber: ns.invoiceNumber, saleNumber: ns.saleNumber, rcptLabel: "NS",
    ebmTransactions: [{ sdcRcptNo: 201, operation: "SALE", responseData: ns.ebmTransactions[0].responseData }],
  }
  db.sales.set(68, ns)
  db.sales.set(69, nr)
  return { ns, nr, nsRequest, nrRequest, nsReply, nrReply }
}

const req = (saleId: number): any => ({ params: { organizationId: "1", saleId: String(saleId) }, query: {}, selectedBranchId: 1 })

function captureText() {
  const calls: string[] = []
  const original = PDFDocument.prototype.text
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: any, ...args: any[]) {
    calls.push(String(args[0]))
    return (original as any).apply(this, args)
  })
  return { joined: () => calls.join("\n"), restore: () => spy.mockRestore() }
}

async function renderedTexts(payload: RenderInvoicePayload): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [name, render] of [
    ["80mm", () => generateEbmReceiptPdf80mm(payload)],
    ["A4", () => generateEbmInvoicePdf(payload, "A4")],
    ["A5", () => generateEbmInvoicePdf(payload, "A5")],
  ] as const) {
    const cap = captureText()
    try { await render() } finally { cap.restore() }
    out[name] = cap.joined()
  }
  out.html = renderSalesInvoiceHtml(payload)
  return out
}

beforeEach(() => {
  device.mrcNo = null
  db.sales.clear()
  catalogRates = [0, 18, 0, 0]
})
afterEach(() => vi.restoreAllMocks())

// ── tests ───────────────────────────────────────────────────────────────────

describe("NS — printed receipt equals the VSDC request/response", () => {
  it("compose has zero parity mismatches against the persisted exchange", async () => {
    const { ns } = fiscalize()
    const p = (await composeInvoicePayload(req(68)))!
    expect(vsdcReceiptParityErrors(p, readVsdcRecord(ns.ebmTransactions[0].responseData))).toEqual([])
  })

  it("80mm and A4 print the VSDC counters, MRC, SDC ID, invcNo and both clocks", async () => {
    fiscalize()
    const p = (await composeInvoicePayload(req(68)))!
    const t = await renderedTexts(p)
    for (const fmt of ["80mm", "A4"]) {
      expect(t[fmt]).toContain("RECEIPT NUMBER: 201/216 NS")
      expect(t[fmt]).toContain("RECEIPT NUMBER: 72")
      expect(t[fmt]).toContain("SDC ID: TESTSDC012000250")
      expect(t[fmt]).toContain("MRC: TESTWIS0102946")
      expect(t[fmt]).not.toContain("TESTMRC-CONFIGURED")
      // SDC block = vsdcRcptPbctDate; bottom block = cfmDt (the sale's own time).
      expect(t[fmt]).toContain("Date: 14/10/2026 Time: 15:52:49")
      expect(t[fmt]).toContain("DATE: 14/10/2026 TIME: 15:52:47")
      expect(t[fmt]).not.toContain("00:00:00")
      // itemNm as submitted: the product name, never the service alias.
      expect(t[fmt]).toContain("Lab test")
      expect(t[fmt]).not.toContain("service alias")
    }
    expect(t.html).toContain("201/216 NS")
    expect(t.html).toContain("TESTWIS0102946")
  })

  it("a reprint after the catalog changed still prints what VSDC holds", async () => {
    const { ns } = fiscalize()
    ns.saleItems = ns.saleItems.map((it: Row) => ({ ...it, product: { ...it.product, name: `${it.product.name} (renamed)`, itemCd: `${it.product.itemCd}X` } }))
    ns.customer = { ...ns.customer, name: "Renamed Customer" }
    catalogRates = [0, 16, 0, 0]
    const p = (await composeInvoicePayload(req(68)))!
    expect(p.items.map((i) => [i.code, i.description])).toEqual([
      ["TESTVU3NTU021", "Lab test"], ["TESTCN2NTU004", "Hand Sanitizer 500ml"], ["TESTUG1NTL010", "Glycerin USP"],
    ])
    expect(p.customer.name).toBe("Walk-in Customer")
    expect(p.taxRates).toEqual([0, 18, 0, 0])
    expect(vsdcReceiptParityErrors(p, readVsdcRecord(ns.ebmTransactions[0].responseData))).toEqual([])
  })
})

describe("NR — refund references the original sale consistently", () => {
  it("orgInvcNo sent = original NS invcNo; REF. NORMAL RECEIPT# = original NS SDC rcptNo", async () => {
    const { ns, nsRequest, nrRequest, nsReply } = fiscalize()
    expect(nrRequest.orgInvcNo).toBe(nsRequest.invcNo)
    expect(nrRequest.orgInvcNo).toBe(ns.vsdcInvcNo)
    const p = (await composeInvoicePayload(req(69)))!
    expect(p.invoice.originalInvoiceNumber).toBe(String(nrRequest.orgInvcNo))
    expect(p.invoice.originalReceiptNumber).toBe(String(nrRequest.orgInvcNo))
  })

  it("the printed reference is the orgInvcNo, never the original's SDC rcptNo", async () => {
    const { nr } = fiscalize()
    nr.originalSale.ebmTransactions[0] = { ...nr.originalSale.ebmTransactions[0], sdcRcptNo: 999 }
    const p = (await composeInvoicePayload(req(69)))!
    expect(p.invoice.originalReceiptNumber).toBe("72")
  })

  it("compose has zero parity mismatches (negative print vs positive wire legs)", async () => {
    const { ns, nr } = fiscalize()
    const p = (await composeInvoicePayload(req(69)))!
    expect(p.totals.grandTotal).toBe(-11000)
    const original = readVsdcRecord(ns.ebmTransactions[0].responseData)
    expect(vsdcReceiptParityErrors(p, readVsdcRecord(nr.ebmTransactions[0].responseData), original)).toEqual([])
  })

  it("80mm, A4, A5 and HTML print REF. NORMAL RECEIPT# and the refund's real transaction time", async () => {
    fiscalize()
    const p = (await composeInvoicePayload(req(69)))!
    const t = await renderedTexts(p)
    for (const fmt of ["80mm", "A4", "A5", "html"]) {
      expect(t[fmt]).toContain("REF. NORMAL RECEIPT#: 72")
      expect(t[fmt]).not.toContain("REF. NORMAL RECEIPT#: 201")
      expect(t[fmt]).not.toContain("REF. NORMAL RECEIPT#: 72/")
    }
    for (const fmt of ["80mm", "A4"]) {
      expect(t[fmt]).toContain("RECEIPT NUMBER: 202/217 NR")
      expect(t[fmt]).toContain("RECEIPT NUMBER: 73")
      expect(t[fmt]).toContain("Date: 14/10/2026 Time: 16:04:09")
      expect(t[fmt]).toContain("DATE: 14/10/2026 TIME: 16:04:09")
      expect(t[fmt]).not.toContain("00:00:00")
    }
  })

  it("the CR copy keeps the same reference and the NR's own VSDC data", async () => {
    const { nr } = fiscalize()
    nr.reprintCount = 2
    const p = (await composeInvoicePayload(req(69)))!
    expect(p.invoice.copyLabel).toBe("CR")
    expect(vsdcReceiptParityErrors(p, readVsdcRecord(nr.ebmTransactions[0].responseData))).toEqual([])
    const t = await renderedTexts(p)
    for (const fmt of ["80mm", "A4", "A5"]) {
      expect(t[fmt]).toContain("REF. NORMAL RECEIPT#: 72")
      expect(t[fmt]).toContain("RECEIPT NUMBER: 202/217 NR")
    }
  })
})

describe("device MRC (CIS spec Art. 3.2.1)", () => {
  it("prints the MRC configured for the device instead of the one VSDC echoes, in every format", async () => {
    device.mrcNo = "ABC01000123"
    const { ns } = fiscalizeAll()
    const p = (await composeInvoicePayload(req(68)))!
    expect(p.sdcInformation.mrcNo).toBe("ABC01000123")
    const record = readVsdcRecord(ns.ebmTransactions[0].responseData)
    expect(vsdcReceiptParityErrors(p, record)).toEqual([])
    const t = await renderedTexts(p)
    for (const fmt of ["80mm", "A4", "A5", "html"]) {
      expect(t[fmt]).toContain("ABC01000123")
      expect(t[fmt]).not.toContain("TESTWIS0102946")
    }
    expect(vsdcPrintedTextErrors(t["80mm"], p, record)).toEqual([])
  })

  it("falls back to the MRC VSDC returned when the device has none configured", async () => {
    const { ns } = fiscalizeAll()
    const p = (await composeInvoicePayload(req(68)))!
    expect(p.sdcInformation.mrcNo).toBe("TESTWIS0102946")
  })
})

describe("parity checker flags every kind of drift", () => {
  it("reports wrong counters, MRC, clocks, items, taxes, sign and orgInvcNo", async () => {
    const { ns, nr } = fiscalize()
    const good = (await composeInvoicePayload(req(69)))!
    const record = readVsdcRecord(nr.ebmTransactions[0].responseData)
    const original = readVsdcRecord(ns.ebmTransactions[0].responseData)
    const bad: RenderInvoicePayload = structuredClone(good)
    bad.sdcInformation.receiptNumber = "73 NR"
    bad.invoice.invoiceNumber = "202"
    bad.invoice.time = "00:00:00"
    bad.invoice.originalInvoiceNumber = "201"
    bad.invoice.originalReceiptNumber = "201"
    bad.items[0].description = "Renamed"
    bad.items[1].total = 2500
    bad.totals.grandTotal = 11000
    const errors = vsdcReceiptParityErrors(bad, record, original).join("\n")
    for (const needle of ["rcptNo/totRcptNo", "invcNo 73", "cfmDt 16:04:09", "orgInvcNo 72", `REF. NORMAL RECEIPT# printed "201" ≠ orgInvcNo 72`, "itemNm", "item 2 total prints positive", "taxblAmtA 8000", "refund total prints positive"]) {
      expect(errors).toContain(needle)
    }
  })
})

/** Unsigned VSDC reply (training/proforma: no intrlData/rcptSign). */
function unsignedReply(rcptNo: number, totRcptNo: number, pbct: string): Row {
  const r = vsdcReply(rcptNo, totRcptNo, pbct, "X")
  delete r.data.intrlData
  delete r.data.rcptSign
  return r
}

function fiscalizeAll() {
  const base = fiscalize()
  const ts = { ...nsSale(), id: 70, saleNumber: "SALE-70", vsdcInvcNo: 80, rcptLabel: "TS", status: "REFUNDED", ebmTransactions: [] as Row[] }
  const tsRequest = buildRraSendReceiptPayload(ts as unknown as SaleWithRelations, ORG, "01", { taxRates: [0, 18, 0, 0] })
  ts.ebmTransactions = [persistTx(70, "SALE", "TS", tsRequest, unsignedReply(6, 220, "20261014155249"))]

  const tr = { ...nrSale(), id: 71, saleNumber: "REFUND-SALE-70-1", vsdcInvcNo: 81, rcptLabel: "TR", originalSaleId: 70, ebmTransactions: [] as Row[] }
  const trRequest = buildRraSendReceiptPayload(tr as unknown as SaleWithRelations, ORG, "01", {
    orgInvcNo: ts.vsdcInvcNo, rfdDt: tr.createdAt, rfdRsnCd: "06", taxRates: [0, 18, 0, 0],
  })
  tr.ebmTransactions = [persistTx(71, "REFUND", "TR", trRequest, unsignedReply(3, 221, "20261014160409"))]
  tr.originalSale = { vsdcInvcNo: 80, invoiceNumber: null, saleNumber: "SALE-70", rcptLabel: "TS", ebmTransactions: [{ sdcRcptNo: 6, operation: "SALE", responseData: ts.ebmTransactions[0].responseData }] }

  const ps = { ...nsSale(), id: 72, saleNumber: "SALE-72", vsdcInvcNo: 82, rcptLabel: "PS", isProforma: true, status: "COMPLETED", salePayments: [], ebmTransactions: [] as Row[] }
  const psRequest = buildRraSendReceiptPayload(ps as unknown as SaleWithRelations, ORG, "01", { taxRates: [0, 18, 0, 0] })
  ps.ebmTransactions = [persistTx(72, "SALE", "PS", psRequest, unsignedReply(25, 222, "20261014161741"))]

  for (const s of [ts, tr, ps]) db.sales.set(s.id, s)
  return { ...base, ts, tr, ps }
}

describe("every receipt type × 80mm / A4 / A5 prints exactly what VSDC holds (spec 13.1–17.1)", () => {
  const cases = [
    { type: "NS", id: 68, reprint: 1, orig: null },
    { type: "NR", id: 69, reprint: 1, orig: 68 },
    { type: "CS", id: 68, reprint: 2, orig: null },
    { type: "CR", id: 69, reprint: 2, orig: 68 },
    { type: "TS", id: 70, reprint: 1, orig: null },
    { type: "TR", id: 71, reprint: 1, orig: 70 },
    { type: "PS", id: 72, reprint: 1, orig: null },
  ] as const
  for (const c of cases) {
    it(`${c.type}`, async () => {
      fiscalizeAll()
      const sale = db.sales.get(c.id)!
      sale.reprintCount = c.reprint
      const p = (await composeInvoicePayload(req(c.id)))!
      const record = readVsdcRecord(sale.ebmTransactions[0].responseData)
      const original = c.orig ? readVsdcRecord(db.sales.get(c.orig)!.ebmTransactions[0].responseData) : null
      expect(vsdcReceiptParityErrors(p, record, original)).toEqual([])
      const t = await renderedTexts(p)
      for (const fmt of ["80mm", "A4", "A5"]) {
        expect({ fmt, errors: vsdcPrintedTextErrors(t[fmt], p, record, original) }).toEqual({ fmt, errors: [] })
      }
      // A short receipt fits one sheet in every format (A5 is the A4 layout scaled).
      for (const paper of ["A4", "A5"] as const) {
        const pdf = await generateEbmInvoicePdf(p, paper)
        expect({ paper, pages: pdf.toString("latin1").match(/\/MediaBox/g)?.length }).toEqual({ paper, pages: 1 })
      }
      // Spec 17.1: a proforma has no payment or ITEMS NUMBER lines.
      if (c.type === "PS") for (const fmt of ["80mm", "A4", "A5"]) expect(t[fmt]).not.toMatch(/ITEMS NUMBER|Items Number/)
      // QR only on NS/NR (spec 13.1/14.1).
      expect(!!p.verification.qrCodeImage && (c.type === "NS" || c.type === "NR")).toBe(c.type === "NS" || c.type === "NR")
    })
  }

  it("the printed-text check flags a missing VSDC value and a wrong designation", async () => {
    const { nr, ns } = fiscalizeAll()
    nr.reprintCount = 2
    const p = (await composeInvoicePayload(req(69)))!
    const t = (await renderedTexts(p))["80mm"]
    const record = readVsdcRecord(nr.ebmTransactions[0].responseData)
    const original = readVsdcRecord(ns.ebmTransactions[0].responseData)
    const tampered = t.replaceAll("MRC: TESTWIS0102946", "MRC: OTHER").replaceAll("REF. NORMAL RECEIPT#: 72", "REF. NORMAL RECEIPT#: 201").split("\n").filter((l) => l !== "COPY").join("\n")
    const errors = vsdcPrintedTextErrors(tampered, p, record, original).join("\n")
    for (const needle of ["MRC", "REF. NORMAL RECEIPT#: 72", "COPY printed 0×"]) expect(errors).toContain(needle)
  })
})

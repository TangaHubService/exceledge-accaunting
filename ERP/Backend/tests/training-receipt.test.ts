/**
 * TS (Training Sale) / TR (Training Refund) — CIS spec §5.3, §6, §10, §11, §16;
 * VSDC API v1.0.5 TrnsSalesSaveWrReq (salesTyCd code table 4.8: T = training).
 *
 * Covers mode/label rules, the VSDC wire payload, VSDC response handling
 * (success without signature, missing/malformed fields, timeouts, rejections,
 * 924 replays), refund eligibility, the electronic journal, the composed
 * receipt and the A4 / 80mm renderers — all against fixtures and a mocked
 * Prisma. No network, no database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PDFDocument from "pdfkit"
import { Decimal } from "@prisma/client/runtime/library"

// ── mocked persistence ──────────────────────────────────────────────────────

type Row = Record<string, any>
const db: { sales: Map<number, Row>; outbox: Map<number, Row>; trainingMode: boolean } = {
  sales: new Map(),
  outbox: new Map(),
  trainingMode: false,
}
const unexpected: string[] = []

const models: Record<string, any> = {
  sale: {
    findFirst: vi.fn(async ({ where }: any) => {
      const s = db.sales.get(where.id)
      if (!s || s.organizationId !== where.organizationId) return null
      return structuredClone(s)
    }),
  },
  ebmOutbox: {
    findFirst: vi.fn(async ({ where }: any) => db.outbox.get(where.saleId) ?? null),
  },
  organization: {
    findUnique: vi.fn(async () => ({
      name: "Test Seller Ltd", avatar: null, address: "KN 3 Rd, Kigali", phone: "+250788000000", email: null,
      TIN: "999945560", VRN: null, currency: "RWF", ebmDeviceId: null, ebmSerialNo: "WIS01029467",
      trainingMode: db.trainingMode,
    })),
  },
  branch: {
    findUnique: vi.fn(async () => ({ name: "Main", bhfId: "00", ebmDeviceId: null, ebmSerialNo: "WIS01029467", address: null })),
  },
  ebmTransaction: { findFirst: vi.fn(async () => null) },
}

vi.mock("../src/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get(_t, model: string) {
      if (model in models) return models[model]
      return new Proxy({}, {
        get(_m, method: string) {
          return async () => {
            unexpected.push(`${model}.${method}`)
            return null
          }
        },
      })
    },
  }),
}))
vi.mock("../src/services/invoice-logo.service", () => ({
  getOrganizationLogo: vi.fn(async () => null),
  getRraCertificationLogo: vi.fn(async () => null),
}))
vi.mock("../src/services/rra-code.service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getTaxRatesBySlot: vi.fn(async () => [0, 18, 0, 0]),
}))
vi.mock("../src/utils/auditLogger", () => ({
  auditLogger: { sales: vi.fn(async () => {}) },
}))

import {
  TRAINING_RECEIPT_LABELS,
  ReceiptModeMismatchError,
  assertExpectedReceiptMode,
  excludeTrainingReceipts,
  isTrainingLabel,
  parseExpectedReceiptMode,
  refundLabelForOriginal,
  vsdcSalesTyCdForLabel,
} from "../src/services/training-mode.service"
import {
  assertNrWirePayload,
  assertOriginalConfirmed,
  assertOriginalRefundable,
} from "../src/services/refund-calculation.service"
import { buildRraSendReceiptPayload, type SaleWithRelations } from "../src/services/rra-ebm.service"
import { assessVsdcReceiptConfirmation, decideNrFiscalResult } from "../src/services/vsdc-api.service"
import { buildElectronicJournal } from "../src/services/electronic-journal.service"
import { composeInvoicePayload, getInvoicePdf } from "../src/controllers/sales.controller"
import { generateEbmInvoicePdf } from "../src/services/invoice-pdf.service"
import { generateEbmReceiptPdf80mm } from "../src/services/invoice-receipt-pdf.service"
import { renderSalesInvoiceHtml } from "../src/services/invoice-render.service"

// ── VSDC fixtures ──────────────────────────────────────────────────────────

/**
 * Verbatim body returned by the RRA reference VSDC (rraVsdcSandbox 3.0.2) for
 * a salesTyCd "T" / rcptTyCd "S" submission on 2026-10-13: training counter 2,
 * shared total counter 203, and intrlData / rcptSign deliberately empty.
 */
const LIVE_TS_RESPONSE = {
  resultCd: "000",
  resultMsg: "It is succeeded",
  resultDt: "20261013221130",
  data: {
    rcptNo: 2,
    intrlData: "",
    rcptSign: "",
    totRcptNo: 203,
    vsdcRcptPbctDate: "20261013221130",
    sdcId: "SDC012000250",
    mrcNo: "WIS01029467",
  },
}
/** Same shape for the TR that follows it (training counter shared by TS/TR). */
const TR_RESPONSE = {
  ...LIVE_TS_RESPONSE,
  resultDt: "20261013221502",
  data: { ...LIVE_TS_RESPONSE.data, rcptNo: 3, totRcptNo: 204, vsdcRcptPbctDate: "20261013221502" },
}

// ── sale fixtures (stored rows, as the outbox writes them) ─────────────────

const TS_TX = {
  id: 701, submissionStatus: "SUCCESS", operation: "SALE", rcptLabel: "TS",
  sdcId: "SDC012000250", sdcRcptNo: 2, totalRcptNo: 203,
  internalData: null, receiptSignature: null,
  sdcDateTime: new Date("2026-10-13T22:11:30.000Z"), ebmInvoiceNumber: "61", qrPayload: null,
  responseData: { normalized: { mrcNo: "WIS01029467" } }, createdAt: new Date("2026-10-13T22:11:31.000Z"),
}
const TR_TX = {
  ...TS_TX, id: 702, operation: "REFUND", rcptLabel: "TR", sdcRcptNo: 3, totalRcptNo: 204,
  sdcDateTime: new Date("2026-10-13T22:15:02.000Z"), ebmInvoiceNumber: "62",
}
const NS_TX = {
  ...TS_TX, id: 703, rcptLabel: "NS", sdcRcptNo: 168, totalRcptNo: 258,
  internalData: "TESTINTLDATA0001AAAABBBBCCCC", receiptSignature: "TESTSIGN0001DDDDEEEE", ebmInvoiceNumber: "45",
}

function tsSale(over: Row = {}): Row {
  return {
    id: 10, organizationId: 1, branchId: 1, saleNumber: "SALE-10", invoiceNumber: "INV-61", vsdcInvcNo: 61,
    status: "COMPLETED", rcptLabel: "TS", isProforma: false, originalSaleId: null, reprintCount: 1,
    paymentType: "CASH", totalAmount: 2860, cashAmount: 2860, debtAmount: 0, insuranceAmount: 0,
    vatAmount: 360, taxableAmount: 2500, createdAt: new Date("2026-10-13T22:11:00.000Z"),
    localReceiptSeq: 7, localReceiptTotalSeq: 9, refundReason: null, rfdRsnCd: null, refundRecipient: null,
    customer: { id: 5, name: "Client Ltd", phone: "0788000000", TIN: "100000001", email: null, address: null, custPrvncNm: null, custDstrtNm: null, custSctrNm: null, custLocDesc: null },
    user: { id: 1, name: "Trainee Cashier" },
    saleItems: [
      { id: 1, productId: 100, quantity: 2, unitPrice: 1180, dcAmt: 0, dcRate: 0, taxAmount: 360, taxRate: 18, taxCode: "B", measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null, product: { itemCd: "RW2CTU0000001", name: "Widget" } },
      { id: 2, productId: 101, quantity: 1, unitPrice: 500, dcAmt: 0, dcRate: 0, taxAmount: 0, taxRate: 0, taxCode: "A", measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null, product: { itemCd: "RW2CTU0000002", name: "Exempt Book" } },
    ],
    salePayments: [],
    ebmTransactions: [structuredClone(TS_TX)],
    originalSale: null,
    ...over,
  }
}

function trSale(over: Row = {}): Row {
  return tsSale({
    id: 20, saleNumber: "REFUND-SALE-10-1", invoiceNumber: "INV-62", vsdcInvcNo: 62,
    status: "REFUNDED", rcptLabel: "TR", originalSaleId: 10,
    totalAmount: -2360, cashAmount: -2360, vatAmount: -360, taxableAmount: -2000,
    refundReason: "Practice return", rfdRsnCd: "06", refundRecipient: "Client Ltd",
    localReceiptSeq: null, localReceiptTotalSeq: null,
    saleItems: [
      { id: 3, productId: 100, quantity: -2, unitPrice: 1180, dcAmt: 0, dcRate: 0, taxAmount: -360, taxRate: 18, taxCode: "B", measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null, product: { itemCd: "RW2CTU0000001", name: "Widget" } },
    ],
    ebmTransactions: [structuredClone(TR_TX)],
    originalSale: {
      vsdcInvcNo: 61, invoiceNumber: "INV-61", saleNumber: "SALE-10", rcptLabel: "TS",
      ebmTransactions: [{ sdcRcptNo: 2, operation: "SALE", responseData: null }],
    },
    ...over,
  })
}

function seed(...rows: Row[]) {
  for (const r of rows) {
    db.sales.set(r.id, r)
    db.outbox.set(r.id, { status: "SUCCEEDED" })
  }
}

function mkReq(saleId: number, over: Row = {}): any {
  return { params: { organizationId: "1", saleId: String(saleId) }, query: {}, body: {}, selectedBranchId: 1, user: { id: 1, role: "SELLER" }, ...over }
}

function mkRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  res.send = (b: any) => { res.body = b; return res }
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v }
  return res
}

/** Captures every text() call (with the active font size) while still drawing the real PDF. */
function captureText() {
  const calls: Array<{ text: string; x?: number; y?: number; opts?: any; size: number }> = []
  const original = PDFDocument.prototype.text
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: any, ...args: any[]) {
    calls.push({ text: String(args[0]), x: args[1], y: args[2], opts: args[3], size: Number(this._fontSize) })
    return (original as any).apply(this, args)
  })
  return { calls, joined: () => calls.map((c) => c.text).join("\n"), restore: () => spy.mockRestore() }
}

function pageSizes(pdf: Buffer): Array<[number, number]> {
  return [...pdf.toString("latin1").matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])])
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
}
function round2(n: number) { return Math.round(n * 100) / 100 }

beforeEach(() => {
  db.sales.clear()
  db.outbox.clear()
  db.trainingMode = false
  unexpected.length = 0
})
afterEach(() => vi.restoreAllMocks())

// ── 1. mode + label rules ──────────────────────────────────────────────────

describe("training labels — TRAINING + SALE = TS, TRAINING + REFUND = TR", () => {
  it("only TS and TR are training receipts", () => {
    expect([...TRAINING_RECEIPT_LABELS]).toEqual(["TS", "TR"])
    for (const l of ["TS", "TR"]) expect(isTrainingLabel(l)).toBe(true)
    for (const l of ["NS", "NR", "CS", "CR", "PS", null, undefined, ""]) expect(isTrainingLabel(l as any)).toBe(false)
  })
  it("VSDC salesTyCd: T for TS/TR, P for PS, N for normal receipts", () => {
    expect(vsdcSalesTyCdForLabel("TS")).toBe("T")
    expect(vsdcSalesTyCdForLabel("TR")).toBe("T")
    expect(vsdcSalesTyCdForLabel("PS")).toBe("P")
    for (const l of ["NS", "NR", null]) expect(vsdcSalesTyCdForLabel(l)).toBe("N")
  })
  it("a refund takes the training-ness of the receipt it refunds, not the current mode", () => {
    expect(refundLabelForOriginal("TS")).toBe("TR")
    expect(refundLabelForOriginal("NS")).toBe("NR")
    expect(refundLabelForOriginal(null)).toBe("NR")
  })
})

describe("receipt mode handshake — stale screens are refused, never silently relabelled", () => {
  it("accepts a matching or absent expectation", () => {
    expect(() => assertExpectedReceiptMode("TRAINING", true)).not.toThrow()
    expect(() => assertExpectedReceiptMode("NORMAL", false)).not.toThrow()
    expect(() => assertExpectedReceiptMode(null, true)).not.toThrow()
  })
  it("409 RECEIPT_MODE_CHANGED when the mode flipped after the screen loaded", () => {
    for (const [expected, actual] of [["TRAINING", false], ["NORMAL", true]] as const) {
      try {
        assertExpectedReceiptMode(expected, actual)
        expect.unreachable()
      } catch (e: any) {
        expect(e).toBeInstanceOf(ReceiptModeMismatchError)
        expect(e.status).toBe(409)
        expect(e.code).toBe("RECEIPT_MODE_CHANGED")
        expect(e.message).toMatch(/Nothing was recorded/)
      }
    }
  })
  it("only TRAINING / NORMAL are accepted as an expectation", () => {
    expect(parseExpectedReceiptMode("TRAINING")).toBe("TRAINING")
    expect(parseExpectedReceiptMode("NORMAL")).toBe("NORMAL")
    for (const v of ["training", "TS", 1, true, null, undefined, {}]) expect(parseExpectedReceiptMode(v)).toBeNull()
  })
})

describe("production reports exclude TS/TR", () => {
  it("wraps the filter so NULL (legacy) labels stay and TS/TR are excluded", () => {
    expect(excludeTrainingReceipts({ organizationId: 1, isProforma: false })).toEqual({
      AND: [
        { organizationId: 1, isProforma: false },
        { OR: [{ rcptLabel: null }, { rcptLabel: { notIn: ["TS", "TR"] } }] },
      ],
    })
  })
})

// ── 2. refund eligibility ─────────────────────────────────────────────────

describe("TR refund eligibility", () => {
  const base = { id: 10, status: "COMPLETED", rcptLabel: "TS", isProforma: false, originalSaleId: null, vsdcInvcNo: 61 }
  const statusOf = (fn: () => void) => { try { fn(); return null } catch (e: any) { return e.status } }

  it("training on: a confirmed TS is refundable (partially refunded too)", () => {
    expect(() => assertOriginalRefundable(base, { trainingMode: true })).not.toThrow()
    expect(() => assertOriginalRefundable({ ...base, status: "PARTIALLY_REFUNDED" }, { trainingMode: true })).not.toThrow()
  })
  it("training on: an NS cannot be refunded (409) — a training session never issues a real NR", () => {
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: "NS" }, { trainingMode: true })).toThrowError(/Normal Sale \(NS\) cannot be refunded from a training session/)
    expect(statusOf(() => assertOriginalRefundable({ ...base, rcptLabel: "NS" }, { trainingMode: true }))).toBe(409)
    expect(statusOf(() => assertOriginalRefundable({ ...base, rcptLabel: null }, { trainingMode: true }))).toBe(409)
  })
  it("training off: a TS cannot be refunded (409) — it would otherwise become a real NR", () => {
    expect(() => assertOriginalRefundable(base, { trainingMode: false })).toThrowError(/only be refunded \(as TR\) while training mode is on/)
    expect(statusOf(() => assertOriginalRefundable(base))).toBe(409)
  })
  it("TR/NR/PS/CS can never be refund sources; status and orgInvcNo rules still apply", () => {
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: "TR", originalSaleId: 3 }, { trainingMode: true })).toThrowError(/NR\/TR receipt can never be the source/)
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: "PS" }, { trainingMode: true })).toThrowError(/Only a Training Sale \(TS\)/)
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: "CS" }, { trainingMode: true })).toThrowError(/Only a Training Sale \(TS\)/)
    expect(() => assertOriginalRefundable({ ...base, isProforma: true }, { trainingMode: true })).toThrowError(/proforma/)
    expect(() => assertOriginalRefundable({ ...base, status: "REFUNDED" }, { trainingMode: true })).toThrowError(/already refunded/)
    expect(() => assertOriginalRefundable({ ...base, status: "CANCELLED" }, { trainingMode: true })).toThrowError(/cancelled/)
    expect(() => assertOriginalRefundable({ ...base, vsdcInvcNo: null }, { trainingMode: true })).toThrowError(/orgInvcNo/)
  })

  const conf = {
    submissionStatus: "SUCCESS", rcptNo: 2, internalData: null, receiptSignature: null,
    sdcId: "SDC012000250", publishedAt: new Date("2026-10-13T22:11:30.000Z"),
  }
  it("a VSDC-confirmed TS has no signature and that is enough to issue a TR", () => {
    expect(() => assertOriginalConfirmed(conf, { training: true })).not.toThrow()
  })
  it("…but the same record would never pass as an NS original", () => {
    expect(() => assertOriginalConfirmed(conf)).toThrowError(/intrlData, rcptSign/)
  })
  it("an unconfirmed or incomplete TS cannot be refunded", () => {
    expect(() => assertOriginalConfirmed(null, { training: true })).toThrowError(/Training Sale has not been confirmed.*TR receipt/)
    expect(() => assertOriginalConfirmed({ ...conf, submissionStatus: "FAILED" }, { training: true })).toThrowError(/not been confirmed/)
    expect(() => assertOriginalConfirmed({ ...conf, rcptNo: null, sdcId: " ", publishedAt: null }, { training: true }))
      .toThrowError(/rcptNo, sdcId, vsdcRcptPbctDate.*TR cannot reference it/)
  })
})

// ── 3. VSDC request payload ────────────────────────────────────────────────

function saleDoc(label: "TS" | "TR" | "NS"): SaleWithRelations {
  const sign = label === "TR" ? -1 : 1
  return {
    id: label === "TR" ? 2 : 1, saleNumber: label === "TR" ? "REFUND-SALE-1-1" : "SALE-1", invoiceNumber: "INV-1",
    vsdcInvcNo: label === "TR" ? 62 : 61, prcOrdCd: "PC0001", rcptLabel: label, createdAt: new Date("2026-10-13T20:11:00.000Z"),
    status: label === "TR" ? "REFUNDED" : "COMPLETED", paymentType: "CASH",
    cashAmount: new Decimal(sign * 15000), debtAmount: new Decimal(0), insuranceAmount: new Decimal(0),
    totalAmount: new Decimal(sign * 15000), taxableAmount: new Decimal(sign * 12711.86), vatAmount: new Decimal(sign * 2288.14),
    branchId: 1,
    branch: { id: 1, name: "Main", code: "M", bhfId: "00", ebmDeviceId: "SDC012000250", ebmSerialNo: "WIS01029467" },
    customer: { id: 5, name: "Client", phone: "0788000000", TIN: "100000001", customerType: "INDIVIDUAL", email: null },
    user: { id: 1, name: "Trainee" },
    saleItems: [{
      productId: 10, quantity: sign * 3, unitPrice: new Decimal(5000), totalPrice: new Decimal(sign * 15000),
      taxRate: new Decimal(18), taxAmount: new Decimal(sign * 2288.14), taxCode: "B",
      dcRate: new Decimal(0), dcAmt: new Decimal(0), measurementUnit: "PCS",
      product: { name: "Widget", itemCd: "RW2CTU0000001", itemClsCd: "5059690800", pkgUnitCd: "CT", qtyUnitCd: "U", packagingQty: null },
    }],
  } as unknown as SaleWithRelations
}
const ORG = { TIN: "999945560", name: "Seller", address: "Kigali" }

describe("VSDC TrnsSalesSaveWrReq for TS / TR", () => {
  it("TS → salesTyCd T, rcptTyCd S, salesSttsCd 02, same amounts as an NS", () => {
    const ts = buildRraSendReceiptPayload(saleDoc("TS"), ORG, "01") as any
    const ns = buildRraSendReceiptPayload(saleDoc("NS"), ORG, "01") as any
    expect(ts).toMatchObject({ salesTyCd: "T", rcptTyCd: "S", salesSttsCd: "02", invcNo: 61, orgInvcNo: 0 })
    expect(ns.salesTyCd).toBe("N")
    const { salesTyCd: _a, ...tsRest } = ts
    const { salesTyCd: _b, ...nsRest } = ns
    expect(tsRest).toEqual(nsRest)
    expect(ts.totAmt).toBe(15000)
    expect(ts.taxblAmtB).toBe(15000)
    expect(ts.itemList[0].qty).toBe(3)
  })

  it("TR → salesTyCd T, rcptTyCd R, salesSttsCd 05, orgInvcNo = the TS invcNo, positive wire legs", () => {
    const p = buildRraSendReceiptPayload(saleDoc("TR"), ORG, "01", {
      orgInvcNo: 61, rfdDt: new Date("2026-10-13T20:15:00.000Z"), rfdRsnCd: "06",
    }) as any
    p.remark = "Practice return"
    expect(p).toMatchObject({ salesTyCd: "T", rcptTyCd: "R", salesSttsCd: "05", orgInvcNo: 61, rfdRsnCd: "06", invcNo: 62 })
    expect(p.itemList[0]).toMatchObject({ qty: 3, taxblAmt: 15000, taxAmt: 2288.14 })
    expect(p.totAmt).toBe(15000)
    expect(p.cnclDt).toBeNull()
    expect(p.rfdDt).toMatch(/^\d{14}$/)
    expect(() => assertNrWirePayload(p, { training: true })).not.toThrow()
  })

  it("a TR payload carrying N, or an NR payload carrying T, is refused before sending", () => {
    const tr = buildRraSendReceiptPayload(saleDoc("TR"), ORG, "01", {
      orgInvcNo: 61, rfdDt: new Date("2026-10-13T20:15:00.000Z"), rfdRsnCd: "06",
    }) as any
    tr.remark = "Practice return"
    expect(() => assertNrWirePayload(tr)).toThrowError(/salesTyCd must be N/)
    expect(() => assertNrWirePayload({ ...tr, salesTyCd: "N" }, { training: true })).toThrowError(/TR payload rejected.*salesTyCd must be T/)
    expect(() => assertNrWirePayload({ ...tr, orgInvcNo: 0 }, { training: true })).toThrowError(/original TS invoice number/)
    expect(() => assertNrWirePayload({ ...tr, rcptTyCd: "S" }, { training: true })).toThrowError(/rcptTyCd/)
    expect(() => assertNrWirePayload({ ...tr, remark: "" }, { training: true })).toThrowError(/remark/)
  })
})

// ── 4. VSDC response handling ──────────────────────────────────────────────

describe("VSDC response for TS / TR", () => {
  it("live sandbox TS body (empty intrlData/rcptSign) is a confirmation for a training receipt", () => {
    const d = decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: LIVE_TS_RESPONSE }, { training: true })
    expect(d.confirmed).toBe(true)
    if (!d.confirmed) return
    expect(d.data).toMatchObject({ rcptNo: "2", totRcptNo: "203", sdcId: "SDC012000250", mrcNo: "WIS01029467", intrlData: "", vsdcSignature: "" })
    expect(decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: TR_RESPONSE }, { training: true }).confirmed).toBe(true)
  })

  it("the same unsigned body is NOT accepted for a normal NS/NR — production rules are unchanged", () => {
    const assessed = assessVsdcReceiptConfirmation(LIVE_TS_RESPONSE)
    expect(assessed.ok).toBe(false)
    if (!assessed.ok) expect(assessed.error).toMatch(/data\.intrlData, data\.rcptSign/)
    expect(decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: LIVE_TS_RESPONSE }).confirmed).toBe(false)
  })

  it("missing / malformed counters, SDC ID, MRC or timestamp are never confirmed", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ rcptNo: 0 }, /data\.rcptNo/],
      [{ rcptNo: "two" }, /data\.rcptNo/],
      [{ totRcptNo: null }, /data\.totRcptNo/],
      [{ sdcId: "" }, /data\.sdcId/],
      [{ mrcNo: undefined }, /data\.mrcNo/],
      [{ vsdcRcptPbctDate: "2026-10-13" }, /data\.vsdcRcptPbctDate/],
      [{ vsdcRcptPbctDate: "20261399999999" }, /data\.vsdcRcptPbctDate/],
    ]
    for (const [patch, field] of cases) {
      const body = { ...LIVE_TS_RESPONSE, data: { ...LIVE_TS_RESPONSE.data, ...patch } }
      const d = decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: body }, { training: true })
      expect(d.confirmed).toBe(false)
      if (!d.confirmed) {
        expect(d.retryable).toBe(true)
        expect(d.error).toMatch(field)
      }
    }
    const noData = decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: { resultCd: "000", resultMsg: "It is succeeded" } }, { training: true })
    expect(noData.confirmed).toBe(false)
  })

  it("timeouts and non-JSON bodies stay retryable and unconfirmed", () => {
    expect(decideNrFiscalResult({ success: false, error: "The operation was aborted", rawStatus: 0, rawBody: null }, { training: true }))
      .toMatchObject({ confirmed: false, retryable: true })
    const t = decideNrFiscalResult({ success: false, rawStatus: 0, rawBody: null }, { training: true })
    if (!t.confirmed) expect(t.error).toMatch(/training receipt not confirmed/)
    const html = decideNrFiscalResult({ success: false, rawStatus: 502, rawBody: "<html>bad gateway</html>" }, { training: true })
    expect(html).toMatchObject({ confirmed: false, retryable: true })
    const arr = decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: [LIVE_TS_RESPONSE] }, { training: true })
    expect(arr.confirmed).toBe(false)
  })

  it("a business rejection is permanent and never yields a receipt", () => {
    const d = decideNrFiscalResult({
      success: false, error: "VSDC error 910: Request parameter error", rawStatus: 200,
      rawBody: { resultCd: "910", resultMsg: "Request parameter error", data: null },
    }, { training: true })
    expect(d).toMatchObject({ confirmed: false, retryable: false })
  })

  it("924 replay is accepted only with the full (unsigned) training receipt block", () => {
    const replay = decideNrFiscalResult({
      success: false, rawStatus: 200, rawBody: { ...LIVE_TS_RESPONSE, resultCd: "924", resultMsg: "Invoice number already exists." },
    }, { training: true })
    expect(replay.confirmed).toBe(true)
    const bare = decideNrFiscalResult({
      success: false, rawStatus: 200, rawBody: { resultCd: "924", resultMsg: "Invoice number already exists.", data: null },
    }, { training: true })
    expect(bare.confirmed).toBe(false)
    if (!bare.confirmed) {
      expect(bare.retryable).toBe(false)
      expect(bare.error).toMatch(/training receipt was not issued/)
    }
  })
})

// ── 5. electronic journal ──────────────────────────────────────────────────

describe("electronic journal keeps training receipts, clearly marked", () => {
  const sdc = {
    sdcId: "SDC012000250", mrcNo: "WIS01029467", sdcRcptNo: 2, internalData: "", receiptSignature: "",
    sdcDateTime: new Date("2026-10-13T20:11:30.000Z"),
  }
  it("TS journal: own counter + TYPE:TS, training notice, no INT_DATA/SIGNATURE lines", () => {
    const ej = buildElectronicJournal(saleDoc("TS"), "TS", sdc)
    expect(ej).toContain("RCPT_NO:2 TYPE:TS")
    expect(ej).toContain("TRAINING MODE - THIS IS NOT AN OFFICIAL RECEIPT")
    expect(ej).not.toMatch(/INT_DATA|SIGNATURE/)
  })
  it("TR journal references the original TS invoice", () => {
    const ej = buildElectronicJournal(saleDoc("TR"), "TR", { ...sdc, sdcRcptNo: 3, orgInvcNo: 61, rfdRsnCd: "06", refundReason: "Practice return" })
    expect(ej).toContain("RCPT_NO:3 TYPE:TR")
    expect(ej).toContain("ORG_INVC:61")
    expect(ej).toContain("TRAINING MODE - THIS IS NOT AN OFFICIAL RECEIPT")
  })
  it("NS journal is unchanged — still carries VSDC internal data and signature", () => {
    const ej = buildElectronicJournal(saleDoc("NS"), "NS", { ...sdc, internalData: "INTL", receiptSignature: "SIGN" })
    expect(ej).toContain("INT_DATA:INTL")
    expect(ej).toContain("SIGNATURE:SIGN")
    expect(ej).not.toContain("TRAINING")
  })
})

// ── 6. composed receipt ────────────────────────────────────────────────────

describe("composed TS/TR receipt — VSDC data only, never a fabricated signature", () => {
  it("TS prints the VSDC training counter and no signature, internal data or QR", async () => {
    seed(tsSale())
    const p = (await composeInvoicePayload(mkReq(10)))!
    expect(p.invoice.rcptLabel).toBe("TS")
    expect(p.invoice.receiptNumber).toBe("2/203 TS")
    expect(p.invoice.invoiceNumber).toBe("61")
    expect(p.sdcInformation).toMatchObject({ sdcId: "SDC012000250", receiptNumber: "2/203 TS", internalData: null, receiptSignature: null, mrcNo: "WIS01029467" })
    expect(p.verification.qrCodeImage).toBeNull()
    expect(p.certification.isCertified).toBe(false)
    expect(unexpected).toEqual([])
  })

  it("TR prints its own counter and references the TS it reverses", async () => {
    seed(trSale())
    const p = (await composeInvoicePayload(mkReq(20)))!
    expect(p.invoice.receiptNumber).toBe("3/204 TR")
    expect(p.invoice.originalReceiptNumber).toBe("61")
    expect(p.sdcInformation.receiptSignature).toBeNull()
    expect(p.certification.isCertified).toBe(false)
  })

  it("a legacy TS that VSDC once signed as N never prints that signature", async () => {
    seed(tsSale({ ebmTransactions: [{ ...TS_TX, internalData: "LEGACYINTL", receiptSignature: "LEGACYSIGN", qrPayload: "legacy-qr" }] }))
    const p = (await composeInvoicePayload(mkReq(10)))!
    expect(p.sdcInformation.internalData).toBeNull()
    expect(p.sdcInformation.receiptSignature).toBeNull()
    expect(p.verification.qrCodeImage).toBeNull()
  })

  it("no printing before VSDC answers: a pending TS is refused with 425 (CIS §10)", async () => {
    seed(tsSale())
    db.outbox.set(10, { status: "PROCESSING" })
    const res = mkRes()
    await getInvoicePdf(mkReq(10), res)
    expect(res.statusCode).toBe(425)
  })

  it("never substitutes the local counter for a VSDC counter", async () => {
    seed(tsSale({ ebmTransactions: [] }))
    db.outbox.delete(10)
    const p = (await composeInvoicePayload(mkReq(10)))!
    expect(p.invoice.receiptNumber).toBe("SALE-10")
    expect(p.invoice.receiptNumber).not.toMatch(/7\/9/)
    expect(p.sdcInformation.receiptNumber).toBeNull()
  })

  it("switching training mode on/off never alters an already-issued receipt", async () => {
    seed(tsSale(), trSale(), tsSale({ id: 30, rcptLabel: "NS", ebmTransactions: [structuredClone(NS_TX)] }))
    const snapshot = async () => Promise.all([10, 20, 30].map(async (id) => {
      const p = (await composeInvoicePayload(mkReq(id)))!
      return { label: p.invoice.rcptLabel, sdc: p.sdcInformation, certified: p.certification.isCertified, qr: !!p.verification.qrCodeImage }
    }))
    db.trainingMode = false
    const off = await snapshot()
    db.trainingMode = true
    const on = await snapshot()
    expect(on).toEqual(off)
    expect(off.map((r) => r.label)).toEqual(["TS", "TR", "NS"])
    expect(off[2]).toMatchObject({ certified: true, qr: true })
    expect(off[2].sdc.receiptSignature).toBe("TESTSIGN0001DDDDEEEE")
  })
})

// ── 7. A4 + 80mm rendering ─────────────────────────────────────────────────

const LONG_NAME = "Industrial grade stainless steel double-walled vacuum insulated beverage container with leak-proof lid (1.5 L)"

async function trainingPayload(label: "TS" | "TR", itemCount: number) {
  const sign = label === "TR" ? -1 : 1
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: i + 1, productId: 1000 + i, quantity: sign * (i + 1), unitPrice: 987654.32, dcAmt: 0, dcRate: 0,
    taxAmount: sign * round2(((i + 1) * 987654.32 * 18) / 118), taxRate: 18, taxCode: "B", measurementUnit: "PCS",
    itemType: "PRODUCT", serviceName: null, serviceDescription: null,
    product: { itemCd: `RW2CTU${String(i).padStart(7, "0")}`, name: i % 3 === 0 ? `${LONG_NAME} #${i}` : `Item ${i}` },
  }))
  const total = round2(items.reduce((s, it) => s + it.quantity * it.unitPrice, 0))
  const row = (label === "TS" ? tsSale : trSale)({
    id: 40, saleItems: items, totalAmount: total, cashAmount: total,
    vatAmount: round2((total * 18) / 118), taxableAmount: round2((total * 100) / 118),
    salePayments: [{ paymentMethod: "CASH", amount: total }],
    customer: { ...tsSale().customer, name: "A Very Long Registered Customer Company Name Limited Trading As Something Else" },
  })
  seed(row)
  return (await composeInvoicePayload(mkReq(40)))!
}

type Calls = ReturnType<typeof captureText>["calls"]

function assertTrainingMarks(calls: Calls, label: "TS" | "TR", grandTotal: number) {
  const t = calls.map((c) => c.text).join("\n")
  const amount = formatMoney(grandTotal)
  const amountCalls = calls.filter((c) => c.text === amount)
  expect(amountCalls.length).toBeGreaterThan(0)
  const amountSize = Math.max(...calls.filter((c) => /^-?\d+\.\d{2}[A-D]?$/.test(c.text)).map((c) => c.size))

  // Designation once, below the header, above the first item, ≥ 2x the amount text.
  const designations = calls.filter((c) => c.text === "TRAINING MODE")
  expect(designations.length).toBeGreaterThanOrEqual(1)
  const firstItem = calls.findIndex((c) => c.text.startsWith(LONG_NAME))
  expect(calls.indexOf(designations[0])).toBeLessThan(firstItem)
  for (const d of designations) expect(d.size).toBeGreaterThanOrEqual(2 * amountSize)

  // No center watermark.
  expect(calls.some((c) => c.text === "TRAINING")).toBe(false)

  // §16 sample order: items → THIS IS NOT AN OFFICIAL RECEIPT → TOTAL …
  // → CASH / ITEMS NUMBER → TRAINING MODE → SDC INFORMATION.
  const notices = calls.filter((c) => c.text === "THIS IS NOT AN OFFICIAL RECEIPT")
  expect(notices).toHaveLength(1)
  expect(notices[0].size).toBeGreaterThanOrEqual(2 * amountSize)
  const lastItem = calls.map((c) => c.text.startsWith("Item ") || c.text.startsWith(LONG_NAME)).lastIndexOf(true)
  const total = calls.find((c) => c.text === "TOTAL" || c.text === "Total")!
  expect(calls.indexOf(notices[0])).toBeGreaterThan(lastItem)
  expect(calls.indexOf(notices[0])).toBeLessThan(calls.indexOf(total))
  expect(notices[0].y!).toBeLessThan(total.y!)
  // No repeat after the totals / before SDC INFORMATION.
  const sdcHeading = calls.filter((c) => c.text === "SDC INFORMATION").pop()!
  expect(designations.every((d) => d.y! < notices[0].y!)).toBe(true)
  expect(designations.every((d) => calls.indexOf(d) < calls.lastIndexOf(sdcHeading))).toBe(true)

  // VSDC counter, never a signature.
  expect(t).toContain(label === "TS" ? "2/203 TS" : "3/204 TR")
  expect(t).not.toMatch(/Receipt Signature|Internal Data/)
  if (label === "TR") {
    // §14/§15 refund samples: REFUND title + REF. NORMAL RECEIPT# + approval notice.
    expect(calls.some((c) => c.text === "REFUND")).toBe(true)
    expect(t).toContain("REF. NORMAL RECEIPT#: 61")
    expect(t).toContain("REFUND IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT")
  } else {
    expect(calls.some((c) => c.text === "REFUND")).toBe(false)
  }
}

describe("A4 training layout", () => {
  it("TS/TR with long descriptions, 60 items and large amounts: all marks present, nothing clipped", async () => {
    for (const label of ["TS", "TR"] as const) {
      const payload = await trainingPayload(label, 60)
      const cap = captureText()
      let pdf: Buffer
      try { pdf = await generateEbmInvoicePdf(payload, "A4") } finally { cap.restore() }
      const pages = pageSizes(pdf!)
      expect(pages.length).toBeGreaterThan(1)
      expect(pages.every(([w, h]) => Math.abs(w - 595.28) < 0.01 && Math.abs(h - 841.89) < 0.01)).toBe(true)
      for (const c of cap.calls) {
        if (typeof c.x !== "number" || typeof c.opts?.width !== "number") continue
        expect(c.x).toBeGreaterThanOrEqual(24.9)
        expect(c.x + c.opts.width).toBeLessThanOrEqual(570.1)
        expect(c.y!).toBeLessThan(841.89 - 10)
      }
      assertTrainingMarks(cap.calls, label, payload.totals.grandTotal)
      expect(cap.joined()).toContain(formatMoney(payload.totals.grandTotal))
    }
  })

  it("the TRAINING MODE line after the totals pushes the footer down instead of overprinting it", async () => {
    const payload = await trainingPayload("TR", 2)
    const cap = captureText()
    try { await generateEbmInvoicePdf(payload, "A4") } finally { cap.restore() }
    const designations = cap.calls.filter((c) => c.text === "TRAINING MODE")
    const footer = cap.calls.find((c) => c.text.includes("Powered by RRA VSDC"))!
    expect(footer.y!).toBeGreaterThan(designations[designations.length - 1].y! + 13)
    expect(footer.y!).toBeLessThan(841.89 - 10)
  })
})

describe("80mm training layout", () => {
  it("TS/TR stress receipts on one roll page inside the printable width, all marks present", async () => {
    for (const label of ["TS", "TR"] as const) {
      const payload = await trainingPayload(label, 40)
      const cap = captureText()
      let pdf: Buffer
      try { pdf = await generateEbmReceiptPdf80mm(payload) } finally { cap.restore() }
      const pages = pageSizes(pdf!)
      expect(pages).toHaveLength(1)
      expect(pages[0][0]).toBeCloseTo(226.77, 1)
      for (const c of cap.calls) {
        if (typeof c.x !== "number" || typeof c.opts?.width !== "number") continue
        expect(c.x).toBeGreaterThanOrEqual(10)
        expect(c.x + c.opts.width).toBeLessThanOrEqual(216.78)
        expect(c.y!).toBeLessThan(pages[0][1])
      }
      // Measured once on a scratch page, then drawn for real — check the real pass.
      const realPass = cap.calls.slice(cap.calls.map((c) => c.text).lastIndexOf("Test Seller Ltd"))
      assertTrainingMarks(realPass, label, payload.totals.grandTotal)
    }
  })
})

describe("normal receipts are unchanged", () => {
  it("an NS prints signature + internal data with no training marks in A4, 80mm and HTML", async () => {
    seed(tsSale({ id: 30, rcptLabel: "NS", ebmTransactions: [structuredClone(NS_TX)] }))
    const payload = (await composeInvoicePayload(mkReq(30)))!
    const cap = captureText()
    try {
      await generateEbmInvoicePdf(payload, "A4")
      await generateEbmReceiptPdf80mm(payload)
    } finally { cap.restore() }
    const t = cap.joined()
    expect(t).toContain("Receipt Signature")
    expect(t).toContain("Internal Data")
    expect(t).not.toMatch(/TRAINING|THIS IS NOT AN OFFICIAL RECEIPT/)
    expect(renderSalesInvoiceHtml(payload)).not.toContain("TRAINING")
  })

  it("an NR still references a NORMAL receipt", async () => {
    seed(trSale({
      id: 31, rcptLabel: "NR", ebmTransactions: [{ ...NS_TX, operation: "REFUND", rcptLabel: "NR", sdcRcptNo: 41, totalRcptNo: 260 }],
      originalSale: { vsdcInvcNo: 45, invoiceNumber: "INV-45", saleNumber: "SALE-10", rcptLabel: "NS", ebmTransactions: [{ sdcRcptNo: 168, operation: "SALE", responseData: null }] },
    }))
    const payload = (await composeInvoicePayload(mkReq(31)))!
    const cap = captureText()
    try { await generateEbmReceiptPdf80mm(payload) } finally { cap.restore() }
    expect(cap.joined()).toContain("REF. NORMAL RECEIPT#: 45")
    expect(renderSalesInvoiceHtml(payload)).toContain("REF. NORMAL RECEIPT#: 45")
  })
})

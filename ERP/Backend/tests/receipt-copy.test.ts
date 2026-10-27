/**
 * CS (Copy Sale) / CR (Copy Refund) — CIS spec §5.3, §6, §15; VSDC API v1.0.5.
 *
 * Covers the copy rules (pure), the copy/reprint/pdf endpoints against a
 * mocked Prisma and a stubbed VSDC (a copy reprints the original's VSDC data
 * under a COPY watermark and never reaches VSDC; only the reprint counter and
 * the audit log may be written), and the A4 / 80mm renderers with stress
 * fixtures.
 *
 * Every fiscal value below is a TEST fixture (prefixed TEST…) standing in
 * for what VSDC returned — never a production value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PDFDocument from "pdfkit"

// ── mocked persistence ──────────────────────────────────────────────────────

type Row = Record<string, any>
const db: { sales: Map<number, Row>; outbox: Map<number, Row>; txs: Row[] } = { sales: new Map(), outbox: new Map(), txs: [] }
const writes: string[] = []
const unexpected: string[] = []

function txMatches(t: Row, where: Row): boolean {
  if (where.saleId !== undefined && t.saleId !== where.saleId) return false
  if (where.operation !== undefined && t.operation !== where.operation) return false
  if (where.submissionStatus !== undefined && t.submissionStatus !== where.submissionStatus) return false
  if (where.sdcRcptNo?.not === null && t.sdcRcptNo == null) return false
  return true
}

// ── stubbed VSDC ────────────────────────────────────────────────────────────

type VsdcReply = Row | "timeout"
const sent: Row[] = []
let replies: VsdcReply[] = []
let copyCounter = { rcptNo: 24, totRcptNo: 262 }
let nextInvcNo = 900

/** A complete, signed VSDC answer to a copy (own counter, timestamp, internal data, signature). */
function copyReply(over: Row = {}): Row {
  const n = copyCounter
  copyCounter = { rcptNo: n.rcptNo + 1, totRcptNo: n.totRcptNo + 1 }
  return {
    resultCd: "000", resultMsg: "It is succeeded", resultDt: "20261014140538",
    data: {
      rcptNo: n.rcptNo, totRcptNo: n.totRcptNo, vsdcRcptPbctDate: "20261014140538",
      intrlData: `TESTCOPYINTL${String(n.rcptNo).padStart(4, "0")}KKKKLLLL`, rcptSign: `TESTCOPYSIGN${String(n.rcptNo).padStart(4, "0")}`,
      sdcId: "TESTSDC010000001", mrcNo: "TESTMRC0001", ...over,
    },
  }
}

vi.mock("../src/services/vsdc-api.service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildVsdcEnvelope: vi.fn(async () => ({ tin: "999945560", bhfId: "00", sdcId: "TESTSDC010000001", mrcNo: "TESTMRC0001", dvcSrlNo: "TESTMRC0001" })),
  saveInvc: vi.fn(async (_env: unknown, payload: Row) => {
    sent.push(structuredClone(payload))
    const reply = replies.length ? replies.shift()! : copyReply()
    if (reply === "timeout") return { success: false, rawStatus: 0, rawBody: null, error: "This operation was aborted" }
    return { success: reply.resultCd === "000", rawStatus: 200, rawBody: reply }
  }),
}))
vi.mock("../src/services/rra-ebm.service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  generateInvoiceNumber: vi.fn(async () => {
    const vsdcInvcNo = nextInvcNo++
    return { invoiceNumber: `INV-COPY-${vsdcInvcNo}`, vsdcInvcNo }
  }),
}))

function matchesBranch(where: any, branchId: number): boolean {
  if (where.branchId === undefined) return true
  if (typeof where.branchId === "number") return where.branchId === branchId
  if (where.branchId?.in) return where.branchId.in.includes(branchId)
  return true
}

const models: Record<string, any> = {
  sale: {
    findFirst: vi.fn(async ({ where }: any) => {
      const s = db.sales.get(where.id)
      if (!s || s.organizationId !== where.organizationId || !matchesBranch(where, s.branchId)) return null
      return structuredClone(s)
    }),
    update: vi.fn(async ({ where, data }: any) => {
      writes.push(`sale.update:${Object.keys(data).join(",")}`)
      const s = db.sales.get(where.id)!
      if (data.reprintCount?.increment) s.reprintCount += data.reprintCount.increment
      else if (typeof data.reprintCount === "number") s.reprintCount = data.reprintCount
      return { reprintCount: s.reprintCount }
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      writes.push(`sale.updateMany:${Object.keys(data).join(",")}`)
      const s = db.sales.get(where.id)
      if (s && s.reprintCount < where.reprintCount.lt) {
        s.reprintCount = data.reprintCount
        return { count: 1 }
      }
      return { count: 0 }
    }),
  },
  ebmOutbox: {
    findFirst: vi.fn(async ({ where }: any) => db.outbox.get(where.saleId) ?? null),
  },
  organization: {
    findUnique: vi.fn(async () => ({
      name: "Test Seller Ltd", avatar: null, address: "KN 3 Rd, Kigali", phone: "+250788000000", email: null,
      TIN: "999945560", VRN: null, currency: "RWF", ebmDeviceId: null, ebmSerialNo: "TESTMRC0001",
    })),
  },
  branch: {
    findUnique: vi.fn(async () => ({ name: "Main", bhfId: "00", ebmDeviceId: null, ebmSerialNo: "TESTMRC0001", address: null })),
  },
  ebmTransaction: {
    findFirst: vi.fn(async ({ where }: any) => {
      const hit = db.txs.filter((t) => txMatches(t, where)).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)[0]
      return hit ? structuredClone(hit) : null
    }),
    create: vi.fn(async ({ data }: any) => {
      writes.push("ebmTransaction.create")
      const row = { id: 1000 + db.txs.length, createdAt: new Date(), retryCount: 0, sdcRcptNo: null, totalRcptNo: null, ...data }
      db.txs.push(row)
      return structuredClone(row)
    }),
    update: vi.fn(async ({ where, data }: any) => {
      writes.push("ebmTransaction.update")
      const row = db.txs.find((t) => t.id === where.id)!
      Object.assign(row, data)
      return structuredClone(row)
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      writes.push("ebmTransaction.updateMany")
      const row = db.txs.find((t) => t.id === where.id && t.submissionStatus === where.submissionStatus)
      if (!row) return { count: 0 }
      const { retryCount, ...rest } = data
      Object.assign(row, rest, { retryCount: row.retryCount + (retryCount?.increment ?? 0) })
      return { count: 1 }
    }),
  },
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
const auditCalls: any[] = []
vi.mock("../src/utils/auditLogger", () => ({
  auditLogger: { sales: vi.fn(async (_req: any, params: any) => { auditCalls.push(params) }) },
}))

import {
  COPY_LABEL_TEXT,
  ReceiptCopyError,
  applyCopyDesignation,
  assertCopyableFiscalRecord,
  nextReprintCountForCopy,
  resolveCopyLabel,
  type StoredFiscalRecord,
} from "../src/services/receipt-copy.service"
import { composeInvoicePayload, getInvoicePdf, printReceiptCopy, reprintSaleReceipt } from "../src/controllers/sales.controller"
import { generateEbmInvoicePdf, printsQrCode } from "../src/services/invoice-pdf.service"
import { generateEbmReceiptPdf80mm } from "../src/services/invoice-receipt-pdf.service"
import { renderSalesInvoiceHtml } from "../src/services/invoice-render.service"

// ── fixtures ───────────────────────────────────────────────────────────────

const NS_REQUEST = {
  invcNo: 45, orgInvcNo: 0, custTin: "100000001", prcOrdCd: "PC0045", custNm: "Client Ltd",
  salesTyCd: "N", rcptTyCd: "S", pmtTyCd: "01", salesSttsCd: "02",
  cfmDt: "20261001101530", salesDt: "20261001", stockRlsDt: "20261001101530",
  rfdDt: null, rfdRsnCd: null, totItemCnt: 2, taxblAmtB: 2360, taxAmtB: 360, totAmt: 2860,
  receipt: { custTin: "100000001", rptNo: 45, trdeNm: "Test Seller Ltd" },
  itemList: [{ itemSeq: 1, itemCd: "RW2CTU0000001", qty: 2, prc: 1180, taxTyCd: "B" }, { itemSeq: 2, itemCd: "RW2CTU0000002", qty: 1, prc: 500, taxTyCd: "A" }],
  idempotencyKey: "ebm-SALE-1-10",
}
const NR_REQUEST = {
  ...NS_REQUEST, invcNo: 46, orgInvcNo: 45, rcptTyCd: "R", salesSttsCd: "05", rfdDt: "20261002110005", rfdRsnCd: "03",
  totItemCnt: 1, totAmt: 2360, receipt: { ...NS_REQUEST.receipt, rptNo: 46 }, itemList: [NS_REQUEST.itemList[0]],
  idempotencyKey: "ebm-REFUND-1-20",
}
const NS_TX = {
  id: 501, saleId: 10, submissionStatus: "SUCCESS", operation: "SALE", rcptLabel: "NS",
  sdcId: "TESTSDC010000001", sdcRcptNo: 168, totalRcptNo: 258,
  internalData: "TESTINTLDATA0001AAAABBBBCCCC", receiptSignature: "TESTSIGN0001DDDDEEEE",
  sdcDateTime: new Date("2026-10-01T08:15:30.000Z"), ebmInvoiceNumber: "45", qrPayload: null,
  responseData: { normalized: { mrcNo: "TESTMRC0001" }, requestPayload: NS_REQUEST }, createdAt: new Date("2026-10-01T08:15:31.000Z"),
}
const NR_TX = {
  ...NS_TX, id: 502, saleId: 20, operation: "REFUND", rcptLabel: "NR",
  sdcRcptNo: 41, totalRcptNo: 260,
  internalData: "TESTINTLDATA0002FFFFGGGGHHHH", receiptSignature: "TESTSIGN0002IIIIJJJJ",
  sdcDateTime: new Date("2026-10-02T09:00:05.000Z"), ebmInvoiceNumber: "46",
  responseData: { normalized: { mrcNo: "TESTMRC0001" }, requestPayload: NR_REQUEST },
}

function nsSale(over: Row = {}): Row {
  return {
    id: 10, organizationId: 1, branchId: 1, saleNumber: "SALE-10", invoiceNumber: "INV-45", vsdcInvcNo: 45,
    status: "COMPLETED", rcptLabel: "NS", isProforma: false, originalSaleId: null, reprintCount: 1,
    paymentType: "CASH", totalAmount: 2860, cashAmount: 2860, debtAmount: 0, insuranceAmount: 0,
    vatAmount: 360, taxableAmount: 2500, createdAt: new Date("2026-10-01T08:15:00.000Z"),
    localReceiptSeq: null, localReceiptTotalSeq: null, refundReason: null, rfdRsnCd: null, refundRecipient: null,
    customer: { id: 5, name: "Client Ltd", phone: "0788000000", TIN: "100000001", email: null, address: null, custPrvncNm: null, custDstrtNm: null, custSctrNm: null, custLocDesc: null },
    user: { id: 1, name: "Cashier One" },
    saleItems: [
      { id: 1, productId: 100, quantity: 2, unitPrice: 1180, dcAmt: 0, dcRate: 0, taxAmount: 360, taxRate: 18, taxCode: "B", measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null, product: { itemCd: "RW2CTU0000001", name: "Widget" } },
      { id: 2, productId: 101, quantity: 1, unitPrice: 500, dcAmt: 0, dcRate: 0, taxAmount: 0, taxRate: 0, taxCode: "A", measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null, product: { itemCd: "RW2CTU0000002", name: "Exempt Book" } },
    ],
    salePayments: [{ paymentMethod: "CASH", amount: 2860 }],
    ebmTransactions: [structuredClone(NS_TX)],
    originalSale: null,
    ...over,
  }
}

function nrSale(over: Row = {}): Row {
  return nsSale({
    id: 20, saleNumber: "REFUND-SALE-10-1", invoiceNumber: "INV-46", vsdcInvcNo: 46,
    status: "REFUNDED", rcptLabel: "NR", originalSaleId: 10, reprintCount: 1,
    totalAmount: -2360, cashAmount: -2360, vatAmount: -360, taxableAmount: -2000,
    refundReason: "Customer returned damaged goods", rfdRsnCd: "03", refundRecipient: "Client Ltd",
    saleItems: [
      { id: 3, productId: 100, quantity: -2, unitPrice: 1180, dcAmt: 0, dcRate: 0, taxAmount: -360, taxRate: 18, taxCode: "B", measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null, product: { itemCd: "RW2CTU0000001", name: "Widget" } },
    ],
    salePayments: [{ paymentMethod: "CASH", amount: -2360 }],
    ebmTransactions: [structuredClone(NR_TX)],
    originalSale: {
      vsdcInvcNo: 45, invoiceNumber: "INV-45", saleNumber: "SALE-10", rcptLabel: "NS",
      ebmTransactions: [{ sdcRcptNo: 168, operation: "SALE", responseData: NS_TX.responseData }],
    },
    ...over,
  })
}

function seed(...rows: Row[]) {
  for (const r of rows) {
    db.sales.set(r.id, r)
    db.outbox.set(r.id, { status: "SUCCEEDED" })
    db.txs = db.txs.filter((t) => t.saleId !== r.id)
    for (const t of r.ebmTransactions ?? []) db.txs.push({ ...structuredClone(t), saleId: r.id })
  }
}

/** A copy VSDC already confirmed for a sale (what GET /pdf prints after a registered copy). */
function seedConfirmedCopy(saleId: number, label: "CS" | "CR", rcptNo = 24, totRcptNo = 262) {
  db.txs.push({
    id: 2000 + db.txs.length, saleId, operation: "COPY", submissionStatus: "SUCCESS", rcptLabel: label,
    sdcId: "TESTSDC010000001", sdcRcptNo: rcptNo, totalRcptNo: totRcptNo, ebmInvoiceNumber: String(rcptNo),
    internalData: `TESTCOPYINTL${String(rcptNo).padStart(4, "0")}KKKKLLLL`, receiptSignature: `TESTCOPYSIGN${String(rcptNo).padStart(4, "0")}`,
    sdcDateTime: new Date("2026-10-14T12:05:38.000Z"), createdAt: new Date("2026-10-14T12:05:39.000Z"),
    responseData: { normalized: { mrcNo: "TESTMRC0001" }, requestPayload: { invcNo: 900, salesTyCd: "C" } },
  })
}

function mkReq(saleId: number | string, over: Row = {}): any {
  return {
    params: { organizationId: "1", saleId: String(saleId) },
    query: {},
    body: {},
    selectedBranchId: 1,
    user: { id: 1, role: "SELLER" },
    ...over,
  }
}

function mkRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as any }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  res.send = (b: any) => { res.body = b; return res }
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v }
  return res
}

/** Captures every text() call while still drawing the real PDF. */
function captureText() {
  const calls: Array<{ text: string; x?: number; y?: number; opts?: any }> = []
  const original = PDFDocument.prototype.text
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: any, ...args: any[]) {
    calls.push({ text: String(args[0]), x: args[1], y: args[2], opts: args[3] })
    return (original as any).apply(this, args)
  })
  return { calls, joined: () => calls.map((c) => c.text).join("\n"), restore: () => spy.mockRestore() }
}

beforeEach(() => {
  db.sales.clear()
  db.outbox.clear()
  db.txs = []
  writes.length = 0
  unexpected.length = 0
  auditCalls.length = 0
  sent.length = 0
  replies = []
  copyCounter = { rcptNo: 24, totRcptNo: 262 }
  nextInvcNo = 900
})

afterEach(() => vi.restoreAllMocks())

// ── 1. copy rules ───────────────────────────────────────────────────────────

describe("CS/CR mapping — COPY + SALE = CS, COPY + REFUND = CR", () => {
  const base = { rcptLabel: "NS", isProforma: false, originalSaleId: null, status: "COMPLETED" }
  it("NS → CS, NR → CR", () => {
    expect(resolveCopyLabel(base)).toBe("CS")
    expect(resolveCopyLabel({ ...base, rcptLabel: "NR", originalSaleId: 10, status: "REFUNDED" })).toBe("CR")
  })
  it("an NS that was later refunded is still copied as CS (not CR)", () => {
    expect(resolveCopyLabel({ ...base, status: "REFUNDED" })).toBe("CS")
    expect(resolveCopyLabel({ ...base, status: "PARTIALLY_REFUNDED" })).toBe("CS")
  })
  it("legacy unlabeled rows: refund link → CR, otherwise CS", () => {
    expect(resolveCopyLabel({ ...base, rcptLabel: null })).toBe("CS")
    expect(resolveCopyLabel({ ...base, rcptLabel: null, originalSaleId: 3, status: "REFUNDED" })).toBe("CR")
  })
  it("refuses training, proforma, copies, voided and unissued documents", () => {
    for (const bad of [
      { ...base, rcptLabel: "TS" }, { ...base, rcptLabel: "TR" }, { ...base, rcptLabel: "PS" },
      { ...base, isProforma: true }, { ...base, rcptLabel: "CS" }, { ...base, rcptLabel: "CR" },
      { ...base, status: "CANCELLED" }, { ...base, status: "DRAFT" }, { ...base, status: "PENDING" },
    ]) {
      expect(() => resolveCopyLabel(bad)).toThrowError(ReceiptCopyError)
      try { resolveCopyLabel(bad) } catch (e: any) { expect(e.status).toBe(422) }
    }
  })
  it("display text", () => {
    expect(COPY_LABEL_TEXT).toEqual({ CS: "Copy Sale", CR: "Copy Refund" })
  })
})

describe("stored fiscal record must be complete — never invented", () => {
  const ok: StoredFiscalRecord = {
    submissionStatus: "SUCCESS", operation: "SALE", sdcId: "TESTSDC1", sdcRcptNo: 168, totalRcptNo: 258,
    internalData: "TESTINTL", receiptSignature: "TESTSIGN", sdcDateTime: new Date("2026-10-01T08:15:30Z"), rcptLabel: "NS",
  }
  const codeOf = (fn: () => void) => { try { fn(); return null } catch (e: any) { return `${e.status}:${e.code}` } }

  it("accepts a complete NS record for CS and a complete NR record for CR", () => {
    expect(() => assertCopyableFiscalRecord(ok, "CS")).not.toThrow()
    expect(() => assertCopyableFiscalRecord({ ...ok, operation: "REFUND", rcptLabel: "NR" }, "CR")).not.toThrow()
    expect(() => assertCopyableFiscalRecord({ ...ok, sdcDateTime: "2026-10-01T08:15:30" }, "CS")).not.toThrow()
  })
  it("missing / unconfirmed VSDC response", () => {
    expect(codeOf(() => assertCopyableFiscalRecord(null, "CS"))).toBe("409:FISCAL_RECORD_MISSING")
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, submissionStatus: "FAILED" }, "CS"))).toBe("409:FISCAL_RECORD_MISSING")
  })
  it("null / malformed fields are reported by their VSDC names", () => {
    const err = (() => { try { assertCopyableFiscalRecord({ ...ok, sdcId: " ", sdcRcptNo: null, totalRcptNo: 0, internalData: null, receiptSignature: "", sdcDateTime: "not-a-date" }, "CS") } catch (e: any) { return e } })()
    expect(err.code).toBe("FISCAL_DATA_INCOMPLETE")
    for (const f of ["sdcId", "rcptNo", "totRcptNo", "intrlData", "rcptSign", "vsdcRcptPbctDate"]) expect(err.message).toContain(f)
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, sdcRcptNo: 1.5 }, "CS"))).toBe("409:FISCAL_DATA_INCOMPLETE")
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, sdcRcptNo: 300, totalRcptNo: 258 }, "CS"))).toBe("409:FISCAL_DATA_INCOMPLETE")
  })
  it("a record of the wrong transaction or label is refused", () => {
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, operation: "REFUND" }, "CS"))).toBe("409:FISCAL_DATA_MISMATCH")
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, operation: "VOID" }, "CS"))).toBe("409:FISCAL_DATA_MISMATCH")
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, rcptLabel: "NR" }, "CS"))).toBe("409:FISCAL_DATA_MISMATCH")
    expect(codeOf(() => assertCopyableFiscalRecord({ ...ok, operation: "SALE", rcptLabel: "NS" }, "CR"))).toBe("409:FISCAL_DATA_MISMATCH")
  })
  it("reprint counter: the original always counts as issued", () => {
    expect(nextReprintCountForCopy(0)).toBe(2)
    expect(nextReprintCountForCopy(null)).toBe(2)
    expect(nextReprintCountForCopy(1)).toBe(2)
    expect(nextReprintCountForCopy(4)).toBe(5)
  })
})

// ── 2. endpoints ────────────────────────────────────────────────────────────

describe("POST /:org/:saleId/copy — CS from an existing NS", () => {
  it("sends nothing to VSDC and writes only the reprint counter", async () => {
    seed(nsSale({ reprintCount: 0 }))
    const res = mkRes()
    await printReceiptCopy(mkReq(10), res)
    expect(res.statusCode).toBe(200)
    expect(sent).toEqual([])
    expect(writes).toEqual(["sale.updateMany:reprintCount", "sale.update:reprintCount"])
    expect(unexpected).toEqual([])
    expect(db.txs.filter((t) => t.operation === "COPY")).toEqual([])
    expect(db.sales.get(10)!.reprintCount).toBe(2)
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]).toMatchObject({ type: "SALE_REPRINTED", metadata: { copyLabel: "CS", copyNumber: 1, sourceRcptLabel: "NS", copyOfReceiptNumber: "168/258 NS" } })
  })

  it("reprints the original's VSDC data: COPY title at the top only, no watermark, no copy counter", async () => {
    seed(nsSale())
    const cap = captureText()
    const res = mkRes()
    try {
      await printReceiptCopy(mkReq(10, { query: { format: "A4" } }), res)
    } finally { cap.restore() }

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("application/pdf")
    expect(res.headers["x-receipt-copy-label"]).toBe("CS")
    expect(res.headers["x-receipt-copy-number"]).toBe("1")
    expect(Buffer.isBuffer(res.body) && res.body.subarray(0, 5).toString()).toBe("%PDF-")

    const t = cap.joined()
    const copyCalls = cap.calls.filter((c) => c.text === "COPY")
    expect(copyCalls.filter((c) => c.x === 0 && c.opts?.width === 595.28)).toHaveLength(0)
    expect(copyCalls).toHaveLength(1)
    expect(t).not.toContain("ORIGINAL RECEIPT#")
    expect(t).not.toContain("THIS IS NOT AN OFFICIAL RECEIPT")
    expect(t).toContain("RECEIPT NUMBER: 168/258 NS")
    expect(t).toContain("Date: 01/10/2026 Time: 10:15:30")
    expect(t).toContain("SDC ID: TESTSDC010000001")
    expect(t).toContain("TEST-INTL-DATA-0001-AAAA-BBBB-CCCC")
    expect(t).toContain("TEST-SIGN-0001-DDDD-EEEE")
    expect(t).toContain("MRC: TESTMRC0001")
    expect(t).toContain("RECEIPT NUMBER: 45")
    expect(t).toContain("Widget")
    expect(t).toContain("Exempt Book")
    expect(t).toContain("2860.00")
    expect(t).toContain("Client Ltd")
    expect(t).toContain("100000001")
  })

  it("every copy reprints the same original: copy #1, #2, #3", async () => {
    const original = nsSale()
    seed(original)
    const before = structuredClone({ ...original, reprintCount: undefined })
    const numbers: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const res = mkRes()
      await printReceiptCopy(mkReq(10, { query: { format: i % 2 ? "80mm" : "A4" } }), res)
      expect(res.statusCode).toBe(200)
      numbers.push(res.headers["x-receipt-copy-number"])
    }
    expect(numbers).toEqual(["1", "2", "3"])
    expect(sent).toEqual([])
    expect(unexpected).toEqual([])
    expect({ ...db.sales.get(10)!, reprintCount: undefined }).toEqual(before)
  })
})

describe("POST /:org/:saleId/copy — CR from an existing NR", () => {
  it("prints the NR's own fiscal block and refund reference, without reason or recipient lines", async () => {
    seed(nrSale())
    for (const format of ["A4", "80mm"]) {
      const cap = captureText()
      const res = mkRes()
      try {
        await printReceiptCopy(mkReq(20, { query: { format } }), res)
      } finally { cap.restore() }
      expect(res.statusCode).toBe(200)
      expect(res.headers["x-receipt-copy-label"]).toBe("CR")
      const t = cap.joined()
      expect(t).toContain("COPY")
      expect(t).toContain("REFUND")
      expect(t).toContain("REF. NORMAL RECEIPT#: 45")
      expect(t).not.toContain("REFUND REASON")
      expect(t).not.toContain("REFUND TO")
      expect(t).not.toContain("THIS IS NOT AN OFFICIAL RECEIPT")
      expect(t).toContain("RECEIPT NUMBER: 41/260 NR")
      expect(t).toContain("TEST-SIGN-0002-IIII-JJJJ")
      expect(t).toContain("-2360.00")
    }
    expect(sent).toEqual([])
  })

  it("a CR is the NR payload with only the copy designation added", async () => {
    seed(nrSale())
    const original = await composeInvoicePayload(mkReq(20), {})
    const copy = await composeInvoicePayload(mkReq(20), { copy: "force" })
    expect(original!.invoice.isCopy).toBe(false)
    expect(copy!.invoice).toMatchObject({ isCopy: true, copyLabel: "CR", copyOfReceiptNumber: "41/260 NR", rcptLabel: "NR", rcptLabelText: "Copy Refund" })
    for (const k of ["items", "totals", "charges", "payment", "customer", "taxRates", "sdcInformation", "verification", "company"] as const) {
      expect(copy![k]).toEqual(original![k])
    }
    expect(copy!.invoice.invoiceNumber).toBe(original!.invoice.invoiceNumber)
  })
})

describe("copy endpoint — missing, invalid, unauthorized and unfiscalized sources", () => {
  it("404 when the receipt does not exist", async () => {
    const res = mkRes()
    await printReceiptCopy(mkReq(999), res)
    expect(res.statusCode).toBe(404)
    expect(writes).toEqual([])
  })
  it("400 for a malformed receipt id", async () => {
    const res = mkRes()
    await printReceiptCopy(mkReq("abc"), res)
    expect(res.statusCode).toBe(400)
  })
  it("404 for a receipt of another organization or another branch (no information leak)", async () => {
    seed(nsSale({ organizationId: 2 }))
    const r1 = mkRes()
    await printReceiptCopy(mkReq(10), r1)
    expect(r1.statusCode).toBe(404)
    db.sales.clear()
    seed(nsSale({ branchId: 7 }))
    const r2 = mkRes()
    await printReceiptCopy(mkReq(10, { selectedBranchId: 1 }), r2)
    expect(r2.statusCode).toBe(404)
    const r3 = mkRes()
    await printReceiptCopy(mkReq(10, { selectedBranchId: undefined, selectedBranchIds: [3, 4] }), r3)
    expect(r3.statusCode).toBe(404)
    expect(writes).toEqual([])
    expect(sent).toEqual([])
  })
  it("422 for training / proforma / voided receipts", async () => {
    seed(nsSale({ id: 11, rcptLabel: "TS" }), nsSale({ id: 12, rcptLabel: "PS", isProforma: true }), nsSale({ id: 13, status: "CANCELLED" }))
    for (const id of [11, 12, 13]) {
      const res = mkRes()
      await printReceiptCopy(mkReq(id), res)
      expect(res.statusCode).toBe(422)
      expect(res.body.code).toBe("COPY_NOT_ALLOWED")
    }
    expect(writes).toEqual([])
    expect(sent).toEqual([])
  })
  it("409 when the original's VSDC record is missing, unconfirmed or incomplete — nothing is counted", async () => {
    seed(
      nsSale({ id: 14, ebmTransactions: [] }),
      nsSale({ id: 15, ebmTransactions: [{ ...NS_TX, receiptSignature: null, internalData: "" }] }),
      nsSale({ id: 16, ebmTransactions: [{ ...NS_TX, submissionStatus: "FAILED" }] }),
      nsSale({ id: 17, ebmTransactions: [{ ...NS_TX, sdcRcptNo: null }] }),
    )
    const codes: string[] = []
    for (const id of [14, 15, 16, 17]) {
      const res = mkRes()
      await printReceiptCopy(mkReq(id), res)
      expect(res.statusCode).toBe(409)
      codes.push(res.body.code)
    }
    expect(codes).toEqual(["FISCAL_RECORD_MISSING", "FISCAL_DATA_INCOMPLETE", "FISCAL_RECORD_MISSING", "FISCAL_DATA_INCOMPLETE"])
    expect(writes).toEqual([])
    expect(sent).toEqual([])
    expect(auditCalls).toEqual([])
  })
})

describe("/reprint registration + GET /pdf (web download flow and mobile app)", () => {
  it("first registration is the original; the next one is a CS copy — neither reaches VSDC", async () => {
    seed(nsSale({ reprintCount: 0 }))
    const r1 = mkRes()
    await reprintSaleReceipt(mkReq(10), r1)
    expect(r1.body.data).toMatchObject({ isCopy: false, reprintCount: 1, copyLabel: null })
    const p1 = await composeInvoicePayload(mkReq(10))
    expect(p1!.invoice.isCopy).toBe(false)
    expect(p1!.invoice.copyLabel).toBeUndefined()

    const r2 = mkRes()
    await reprintSaleReceipt(mkReq(10), r2)
    expect(r2.body.data).toMatchObject({ isCopy: true, reprintCount: 2, copyLabel: "CS", rcptLabel: "CS" })
    db.sales.get(10)!.reprintCount = 2
    const p2 = await composeInvoicePayload(mkReq(10))
    expect(p2!.invoice).toMatchObject({ isCopy: true, copyLabel: "CS", copyNumber: 1, copyOfReceiptNumber: "168/258 NS" })
    expect(p2!.sdcInformation).toMatchObject({ receiptNumber: "168/258 NS", receiptSignature: "TESTSIGN0001DDDDEEEE" })
    expect(sent).toEqual([])
    expect(unexpected).toEqual([])
  })

  it("an NS that was later refunded registers as CS, not CR", async () => {
    seed(nsSale({ status: "REFUNDED" }))
    const res = mkRes()
    await reprintSaleReceipt(mkReq(10), res)
    expect(res.body.data.copyLabel).toBe("CS")
  })

  it("refuses to register a copy it cannot produce, without counting it", async () => {
    seed(nsSale({ ebmTransactions: [{ ...NS_TX, receiptSignature: null }] }))
    const res = mkRes()
    await reprintSaleReceipt(mkReq(10), res)
    expect(res.statusCode).toBe(409)
    expect(db.sales.get(10)!.reprintCount).toBe(1)
    expect(writes).toEqual([])
  })

  it("refuses to register an original VSDC has not confirmed yet", async () => {
    seed(nsSale({ reprintCount: 0 }))
    db.outbox.set(10, { status: "PROCESSING" })
    const res = mkRes()
    await reprintSaleReceipt(mkReq(10), res)
    expect(res.statusCode).toBe(425)
    expect(db.sales.get(10)!.reprintCount).toBe(0)
  })

  it("GET /pdf of a reprinted NR renders the CR copy with the NR's own fiscal block", async () => {
    seed(nrSale({ reprintCount: 2 }))
    const cap = captureText()
    const ok = mkRes()
    try { await getInvoicePdf(mkReq(20, { query: { format: "80mm" } }), ok) } finally { cap.restore() }
    expect(ok.statusCode).toBe(200)
    expect(cap.joined()).toContain("RECEIPT NUMBER: 41/260 NR")
    expect(cap.calls.some((c) => c.text === "COPY")).toBe(true)
    expect(sent).toEqual([])
  })

  it("training receipts keep their TRAINING designation and are never relabelled CS/CR", async () => {
    seed(nsSale({ rcptLabel: "TS", reprintCount: 3, ebmTransactions: [{ ...NS_TX, rcptLabel: "TS" }] }))
    const p = await composeInvoicePayload(mkReq(10))
    expect(p!.invoice.copyLabel).toBeUndefined()
    const res = mkRes()
    await reprintSaleReceipt(mkReq(10), res)
    expect(res.body.data.copyLabel).toBeNull()
    expect(sent).toEqual([])
  })
})

// ── 3. rendering: A4 + 80mm ────────────────────────────────────────────────

const LONG_NAME = "Industrial grade stainless steel double-walled vacuum insulated beverage container with leak-proof lid (1.5 L)"
const UNBROKEN_CODE = "RW2CTU00000000000000000000001234567890"

async function stressPayload(label: "CS" | "CR", itemCount: number) {
  const sign = label === "CR" ? -1 : 1
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: i + 1, productId: 1000 + i, quantity: sign * (i + 1), unitPrice: 987654.32, dcAmt: 0, dcRate: 0,
    taxAmount: sign * round2(((i + 1) * 987654.32 * 18) / 118), taxRate: 18, taxCode: "B", measurementUnit: "PCS",
    itemType: "PRODUCT", serviceName: null, serviceDescription: null,
    product: { itemCd: i % 5 === 0 ? UNBROKEN_CODE : `RW2CTU${String(i).padStart(7, "0")}`, name: i % 3 === 0 ? `${LONG_NAME} #${i}` : `Item ${i}` },
  }))
  const total = round2(items.reduce((s, it) => s + it.quantity * it.unitPrice, 0))
  const tx = {
    ...(label === "CS" ? NS_TX : NR_TX),
    internalData: "TESTINTL".repeat(12),
    receiptSignature: "TESTSIGN".repeat(10),
  }
  const row = (label === "CS" ? nsSale : nrSale)({
    id: 40, items: undefined, saleItems: items, totalAmount: total, cashAmount: total,
    vatAmount: round2((total * 18) / 118), taxableAmount: round2((total * 100) / 118),
    salePayments: [{ paymentMethod: "CASH", amount: total }], ebmTransactions: [tx],
    customer: { ...nsSale().customer, name: "A Very Long Registered Customer Company Name Limited Trading As Something Else" },
  })
  seed(row)
  return (await composeInvoicePayload(mkReq(40), { copy: "force" }))!
}
function round2(n: number) { return Math.round(n * 100) / 100 }

function pageSizes(pdf: Buffer): Array<[number, number]> {
  return [...pdf.toString("latin1").matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])])
}

/** Every text() call except the COPY titles. */
function bodyCalls(calls: Array<{ text: string; x?: number; y?: number; opts?: any }>) {
  return calls.filter((c) => c.text !== "COPY")
}

describe("A4 layout", () => {
  it("CS and CR with long names, unbroken codes, 60 items, long signatures and large totals stay inside the page", async () => {
    for (const label of ["CS", "CR"] as const) {
      const payload = await stressPayload(label, 60)
      const cap = captureText()
      let pdf: Buffer
      try { pdf = await generateEbmInvoicePdf(payload, "A4") } finally { cap.restore() }
      const pages = pageSizes(pdf!)
      expect(pages.length).toBeGreaterThan(1)
      expect(pages.length).toBeLessThanOrEqual(6)
      expect(pages.every(([w, h]) => Math.abs(w - 595.28) < 0.01 && Math.abs(h - 841.89) < 0.01)).toBe(true)
      for (const c of bodyCalls(cap.calls)) {
        if (typeof c.x !== "number" || typeof c.opts?.width !== "number") continue
        expect(c.x).toBeGreaterThanOrEqual(24.9)
        expect(c.x + c.opts.width).toBeLessThanOrEqual(570.1)
        expect(c.y!).toBeLessThan(841.89 - 10)
      }
      // One header title per page.
      expect(cap.calls.filter((c) => c.text === "COPY")).toHaveLength(pages.length)
      const t = cap.joined()
      expect(t).not.toContain("THIS IS NOT AN OFFICIAL RECEIPT")
      expect(t).toContain(formatMoney(payload.totals.grandTotal))
    }
  })

  it("a few-item copy fits on exactly one A4 page (no blank extra page)", async () => {
    seed(nsSale())
    const payload = (await composeInvoicePayload(mkReq(10), { copy: "force" }))!
    expect(pageSizes(await generateEbmInvoicePdf(payload, "A4"))).toHaveLength(1)
  })

  it("the powered-by footer is pushed below a long CR fiscal block instead of overprinting it", async () => {
    const payload = await stressPayload("CR", 2)
    const cap = captureText()
    try { await generateEbmInvoicePdf(payload, "A4") } finally { cap.restore() }
    const mrcLine = cap.calls.find((c) => c.text.startsWith("MRC:") && (c.y ?? 0) > 600)!
    const footer = cap.calls.find((c) => c.text.includes("Powered by RRA VSDC"))!
    expect(footer.y!).toBeGreaterThan(mrcLine.y!)
    // REF. NORMAL RECEIPT# prints once, under the title — never repeated in the bottom block.
    const refLines = cap.calls.filter((c) => c.text.startsWith("REF. NORMAL RECEIPT#"))
    expect(refLines).toHaveLength(1)
    expect(refLines[0].y!).toBeLessThan(120)
  })
})

describe("80mm thermal layout", () => {
  it("CS/CR stress receipts render on one roll page, inside the printable width", async () => {
    for (const label of ["CS", "CR"] as const) {
      const payload = await stressPayload(label, 40)
      const cap = captureText()
      let pdf: Buffer
      try { pdf = await generateEbmReceiptPdf80mm(payload) } finally { cap.restore() }
      const pages = pageSizes(pdf!)
      expect(pages).toHaveLength(1)
      expect(pages[0][0]).toBeCloseTo(226.77, 1)
      expect(pages[0][1]).toBeGreaterThan(400)
      for (const c of bodyCalls(cap.calls)) {
        if (typeof c.x !== "number" || typeof c.opts?.width !== "number") continue
        expect(c.x).toBeGreaterThanOrEqual(10)
        expect(c.x + c.opts.width).toBeLessThanOrEqual(216.78)
      }
      expect(cap.calls.filter((c) => c.text === "COPY").length).toBeGreaterThanOrEqual(1)
      const t = cap.joined()
      expect(t).not.toContain("THIS IS NOT AN OFFICIAL RECEIPT")
      expect(t).toContain("TEST-SIGN-TEST-SIGN")
      expect(t).toContain(formatMoney(payload.totals.grandTotal))
    }
  })

  it("long labels and large amounts never overprint each other", async () => {
    const payload = await stressPayload("CS", 1)
    const huge = 1e33
    payload.payment.lines = [
      { method: "CASH", label: "A very long tender description for split payment", amount: 123456789012345.67 },
      { method: "CARD", label: "Card tender with a long description", amount: huge },
    ]
    const cap = captureText()
    try { await generateEbmReceiptPdf80mm(payload) } finally { cap.restore() }
    const measure = new PDFDocument({ autoFirstPage: true })
    measure.font("Courier").fontSize(6.2)

    // Shares the line: the label column stops before the right-aligned value.
    const label1 = cap.calls.filter((c) => c.text === "A VERY LONG TENDER DESCRIPTION FOR SPLIT PAYMENT").pop()!
    const value1 = cap.calls.filter((c) => c.text === "123456789012345.67").pop()!
    expect(value1.y).toBe(label1.y)
    expect(label1.x! + label1.opts.width).toBeLessThanOrEqual(216.77 - measure.widthOfString(value1.text))

    // Too wide to share: the value drops to its own line below the label.
    const hugeText = formatMoney(huge)
    const label2 = cap.calls.filter((c) => c.text === "CARD TENDER WITH A LONG DESCRIPTION").pop()!
    const value2 = cap.calls.filter((c) => c.text === hugeText).pop()!
    expect(measure.widthOfString(hugeText)).toBeGreaterThan(216.77 - 10 - 206.77 * 0.35 - 6)
    expect(value2.y!).toBeGreaterThan(label2.y!)
  })

  it("A4 and 80mm print the same fiscal values for the same copy", async () => {
    seed(nrSale())
    const payload = (await composeInvoicePayload(mkReq(20), { copy: "force" }))!
    const a4 = captureText()
    try { await generateEbmInvoicePdf(payload, "A4") } finally { a4.restore() }
    const roll = captureText()
    try { await generateEbmReceiptPdf80mm(payload) } finally { roll.restore() }
    for (const v of ["RECEIPT NUMBER: 41/260 NR", "TESTSDC010000001", "TEST-SIGN-0002-IIII-JJJJ", "Date: 02/10/2026 Time: 11:00:05", "RECEIPT NUMBER: 46", "-2360.00", "REF. NORMAL RECEIPT#: 45"]) {
      expect(a4.joined()).toContain(v)
      expect(roll.joined()).toContain(v)
    }
  })
})

describe("HTML preview + regression of the originals", () => {
  it("HTML copy carries the COPY title and the REFUND sub-title, no watermark or notice", async () => {
    seed(nrSale())
    const html = renderSalesInvoiceHtml((await composeInvoicePayload(mkReq(20), { copy: "force" }))!)
    expect(html).not.toContain('class="copy-watermark"')
    expect(html).toContain('<h2 class="title">COPY</h2>')
    expect(html).toMatch(/<h3 class="subtitle"[^>]*>REFUND<\/h3>/)
    expect(html).not.toContain("THIS IS NOT AN OFFICIAL RECEIPT")
  })

  it("a copy carries the original's QR code, unchanged", async () => {
    seed(nsSale(), nrSale())
    for (const id of [10, 20]) {
      const original = (await composeInvoicePayload(mkReq(id)))!
      const copy = (await composeInvoicePayload(mkReq(id), { copy: "force" }))!
      expect(printsQrCode(copy)).toBe(true)
      expect(copy.verification.qrPayload).toBeTruthy()
      expect(copy.verification.qrPayload).toBe(original.verification.qrPayload)
      expect(copy.verification.qrCodeImage).toBe(original.verification.qrCodeImage)
    }
  })

  it("original NS and NR still render as originals (no COPY, no notice)", async () => {
    seed(nsSale({ reprintCount: 1 }), nrSale({ reprintCount: 0 }))
    for (const [id, title] of [[10, null], [20, "REFUND"]] as const) {
      const payload = (await composeInvoicePayload(mkReq(id)))!
      expect(payload.invoice.isCopy).toBe(false)
      const cap = captureText()
      try {
        await generateEbmInvoicePdf(payload, "A4")
        await generateEbmReceiptPdf80mm(payload)
      } finally { cap.restore() }
      const t = cap.joined()
      expect(t).not.toContain("COPY")
      expect(t).not.toContain("THIS IS NOT AN OFFICIAL RECEIPT")
      if (title) expect(t).toContain(title)
      expect(renderSalesInvoiceHtml(payload)).not.toContain('class="copy-watermark"')
    }
  })

  it("applyCopyDesignation never mutates the source payload", async () => {
    seed(nsSale())
    const original = (await composeInvoicePayload(mkReq(10)))!
    const snapshot = structuredClone(original)
    const copy = applyCopyDesignation(original, { label: "CS", copyNumber: 1 })
    expect(original).toEqual(snapshot)
    expect(copy.invoice.copyLabel).toBe("CS")
  })
})

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
}

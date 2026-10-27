/**
 * Receipt-signing lifecycle against VSDC API v1.0.5 `/trnsSales/saveSales`:
 * payload → HTTP → response decision → persisted fiscal record → composed
 * invoice → printed 80mm + A4 receipt.
 *
 * VSDC is a stubbed `fetch`; persistence is an in-memory Prisma stand-in.
 * The outbox worker, the response parser, the invoice composer and both PDF
 * renderers are the real code. Every fiscal value is a TEST fixture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import PDFDocument from "pdfkit"
import { Decimal } from "@prisma/client/runtime/library"

// ── in-memory persistence ──────────────────────────────────────────────────

type Row = Record<string, any>
const db = {
  sales: new Map<number, Row>(),
  outbox: new Map<number, Row>(),
  txs: [] as Row[],
  nextTxId: 1,
  nextVoidInvcNo: 100,
}

function apply(target: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) target[k] = (target[k] ?? 0) + v.increment
    else target[k] = v
  }
  target.updatedAt = new Date(Date.now() + Math.random())
}

function txMatches(t: Row, where: Row): boolean {
  if (where.saleId !== undefined && t.saleId !== where.saleId) return false
  if (where.operation !== undefined && t.operation !== where.operation) return false
  if (where.submissionStatus !== undefined && t.submissionStatus !== where.submissionStatus) return false
  if (where.sdcId?.not === null && t.sdcId == null) return false
  if (where.ebmInvoiceNumber?.not === null && t.ebmInvoiceNumber == null) return false
  return true
}

const models: Record<string, any> = {
  ebmOutbox: {
    findMany: vi.fn(async ({ where }: any) => {
      const staleBefore: Date = where.OR[1].updatedAt.lte
      return [...db.outbox.values()]
        .filter((r) => r.nextAttemptAt <= new Date() && r.retryCount < where.retryCount.lt)
        .filter((r) => ["PENDING", "FAILED"].includes(r.status) || (r.status === "PROCESSING" && r.updatedAt <= staleBefore))
        .map((r) => ({ ...r }))
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const r = db.outbox.get(where.id)
      if (!r || r.status !== where.status || r.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 }
      apply(r, data)
      return { count: 1 }
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const r = db.outbox.get(where.id)!
      apply(r, data)
      return { ...r }
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const rows = [...db.outbox.values()].filter((r) => r.saleId === where.saleId && (!where.operation || r.operation === where.operation))
      return rows.length ? { ...rows[rows.length - 1] } : null
    }),
  },
  ebmTransaction: {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = db.txs.find((t) => t.idempotencyKey === where.idempotencyKey)
      if (existing) {
        apply(existing, update)
        return { ...existing }
      }
      const row = { id: db.nextTxId++, retryCount: 0, createdAt: new Date(), sdcRcptNo: null, totalRcptNo: null, sdcId: null, internalData: null, receiptSignature: null, sdcDateTime: null, rcptLabel: null, responseData: null, qrPayload: null, ...create }
      db.txs.push(row)
      return { ...row }
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = db.txs.find((x) => x.id === where.id)!
      apply(t, data)
      return { ...t }
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const hit = [...db.txs].reverse().find((t) => txMatches(t, where))
      return hit ? { ...hit } : null
    }),
  },
  sale: {
    findFirst: vi.fn(async ({ where }: any) => {
      const s = db.sales.get(where.id)
      if (!s) return null
      const ebmTransactions = db.txs.filter((t) => t.saleId === s.id).reverse().map((t) => ({ ...t }))
      return { ...s, ebmTransactions }
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const s = db.sales.get(where.id)!
      Object.assign(s, data)
      return { ...s }
    }),
  },
  organization: {
    findUnique: vi.fn(async () => ({
      id: 1, TIN: "999945560", name: "Test Seller Ltd", address: "KN 3 Rd, Kigali", phone: "+250788000000",
      email: null, avatar: null, VRN: null, currency: "RWF", ebmDeviceId: null, ebmSerialNo: "TESTMRC0001",
    })),
    update: vi.fn(async () => ({})),
  },
  branch: {
    findUnique: vi.fn(async () => ({
      name: "Main", bhfId: "00", ebmDeviceId: "TESTSDC010000001", ebmSerialNo: "TESTMRC0001", vsdcUrl: null, address: null,
    })),
  },
  organizationPurchaseCode: { updateMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}

vi.mock("../src/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get(_t, model: string) {
      if (model in models) return models[model]
      throw new Error(`unexpected prisma.${model} access`)
    },
  }),
}))
vi.mock("../src/services/rra-code.service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getRraPaymentCode: vi.fn(async () => "01"),
  getTaxRatesBySlot: vi.fn(async () => [0, 18, 0, 0]),
  getTourismTaxRate: vi.fn(async () => 3),
}))
vi.mock("../src/services/rra-ebm.service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  generateInvoiceNumber: vi.fn(async () => {
    const vsdcInvcNo = db.nextVoidInvcNo++
    return { invoiceNumber: `INV-TEST-${vsdcInvcNo}`, vsdcInvcNo }
  }),
  consumeAnyOrgPurchaseCode: vi.fn(async () => "PCVOID"),
}))
vi.mock("../src/services/stock-movement-sync.service", () => ({ processStockSyncBatch: vi.fn(async () => undefined) }))
vi.mock("../src/services/invoice-logo.service", () => ({
  getOrganizationLogo: vi.fn(async () => null),
  getRraCertificationLogo: vi.fn(async () => null),
}))

import { config } from "../src/config"
import { processEbmOutboxBatch } from "../src/services/ebm-outbox.service"
import { decideVsdcReceiptResult, parseVsdcResponse } from "../src/services/vsdc-api.service"
import { generateInvoiceNumber } from "../src/services/rra-ebm.service"
import { composeInvoicePayload, FiscalizationPendingError } from "../src/controllers/sales.controller"
import { generateEbmInvoicePdf } from "../src/services/invoice-pdf.service"
import { generateEbmReceiptPdf80mm } from "../src/services/invoice-receipt-pdf.service"
import { formatItemTaxLabel, formatReceiptQuantity } from "../src/services/invoice-format.service"

// ── fixtures ───────────────────────────────────────────────────────────────

/** VSDC v1.0.5 §3.3.6.1 success body. 13:07:00 Kigali == 11:07:00Z. */
const SIGNED_BLOCK = {
  rcptNo: 168,
  intrlData: "TESTINTL0001AAAABBBBCCCC",
  rcptSign: "TESTSIGN0001DDDD",
  totRcptNo: 258,
  vsdcRcptPbctDate: "20261014130700",
  sdcId: "TESTSDC010000001",
  mrcNo: "TESTMRC0001",
}
const SIGNED = { resultCd: "000", resultMsg: "It is succeeded", resultDt: "20261014130700", data: SIGNED_BLOCK }

function nsSale(over: Row = {}): Row {
  return {
    id: 10, organizationId: 1, branchId: 1, saleNumber: "SALE-10", invoiceNumber: "INV-8", vsdcInvcNo: 8,
    prcOrdCd: "PC0001", rcptLabel: "NS", isProforma: false, status: "COMPLETED", originalSaleId: null, reprintCount: 0,
    createdAt: new Date("2026-10-14T11:06:55.000Z"), paymentType: "CASH",
    cashAmount: new Decimal(1180), debtAmount: new Decimal(0), insuranceAmount: new Decimal(0),
    totalAmount: new Decimal(1180), taxableAmount: new Decimal(1000), vatAmount: new Decimal(180),
    localReceiptSeq: null, localReceiptTotalSeq: null, refundReason: null, rfdRsnCd: null, refundRecipient: null,
    branch: { id: 1, name: "Main", code: "M", bhfId: "00", ebmDeviceId: "TESTSDC010000001", ebmSerialNo: "TESTMRC0001" },
    customer: { id: 5, name: "Client Ltd", phone: "0788000000", TIN: "100000001", customerType: "INDIVIDUAL", email: null, prcOrdCd: null, address: null, custPrvncNm: null, custDstrtNm: null, custSctrNm: null, custLocDesc: null },
    user: { id: 1, name: "Cashier One" },
    saleItems: [{
      id: 1, productId: 100, quantity: 1, unitPrice: new Decimal(1180), totalPrice: new Decimal(1180),
      taxRate: new Decimal(18), taxAmount: new Decimal(180), taxCode: "B", dcRate: new Decimal(0), dcAmt: new Decimal(0),
      measurementUnit: "PCS", itemType: "PRODUCT", serviceName: null, serviceDescription: null,
      product: { name: "Widget", itemCd: "RW2CTU0000001", itemClsCd: "5059690800", pkgUnitCd: "CT", qtyUnitCd: "U", packagingQty: null, barcode: null, useInsurance: false },
    }],
    salePayments: [{ paymentMethod: "CASH", amount: 1180 }],
    originalSale: null,
    ...over,
  }
}

function enqueue(sale: Row, operation: "SALE" | "VOID" = "SALE", over: Row = {}) {
  db.sales.set(sale.id, sale)
  const id = db.outbox.size + 1
  db.outbox.set(id, {
    id, organizationId: 1, saleId: sale.id, operation,
    idempotencyKey: `ebm-${operation}-1-${sale.id}`,
    payload: { version: 1, saleId: sale.id, organizationId: 1, operation },
    status: "PENDING", retryCount: 0, nextAttemptAt: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 1000),
    lastError: null, createdAt: new Date(), ...over,
  })
  return id
}

type Reply = Row | string | "timeout" | { status: number; body: unknown }
const sent: Row[] = []
let replies: Reply[] = []

function stubVsdc() {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body))
    const reply = replies.shift()
    if (reply === "timeout") {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")))
      })
    }
    if (reply && typeof reply === "object" && "status" in reply && "body" in reply) {
      return new Response(JSON.stringify(reply.body), { status: reply.status as number })
    }
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status: 200 })
  }))
}

const saved = { ...config.ebm }
beforeEach(() => {
  db.sales.clear(); db.outbox.clear(); db.txs = []; db.nextTxId = 1; db.nextVoidInvcNo = 100
  sent.length = 0; replies = []
  config.ebm.enabled = true
  config.ebm.useMock = false
  config.ebm.apiUrl = "http://vsdc.test"
  config.ebm.requestTimeoutMs = 50
  config.ebm.maxQueueRetries = 10
  config.ebm.ejSyncPath = ""
  stubVsdc()
})
afterEach(() => {
  Object.assign(config.ebm, saved)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const saleTxs = (saleId: number) => db.txs.filter((t) => t.saleId === saleId)
const req = (saleId: number): any => ({ params: { organizationId: "1", saleId: String(saleId) }, query: {}, body: {}, selectedBranchId: 1, user: { id: 1, role: "SELLER" } })

async function printed(payload: any, format: "80mm" | "A4"): Promise<string> {
  const drawn: string[] = []
  const original = PDFDocument.prototype.text
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: any, ...args: any[]) {
    drawn.push(String(args[0]))
    return (original as any).apply(this, args)
  })
  try {
    if (format === "80mm") await generateEbmReceiptPdf80mm(payload)
    else await generateEbmInvoicePdf(payload, "A4")
  } finally {
    spy.mockRestore()
  }
  return drawn.join("\n")
}

function expectNothingFiscalized(saleId: number) {
  expect(saleTxs(saleId).some((t) => t.submissionStatus === "SUCCESS")).toBe(false)
  for (const t of saleTxs(saleId)) {
    expect(t.sdcRcptNo).toBeNull()
    expect(t.totalRcptNo).toBeNull()
    expect(t.internalData).toBeNull()
    expect(t.receiptSignature).toBeNull()
    expect(t.sdcDateTime).toBeNull()
  }
}

// ── request ────────────────────────────────────────────────────────────────

describe("saveSales request", () => {
  it("sends the TrnsSalesSaveWrReq body with tin/bhfId, numeric invcNo and RRA date formats; no CIS-internal keys", async () => {
    enqueue(nsSale())
    replies = [SIGNED]
    await processEbmOutboxBatch(5)
    expect(sent).toHaveLength(1)
    const body = sent[0]
    expect(body).toMatchObject({ tin: "999945560", bhfId: "00", invcNo: 8, orgInvcNo: 0, salesTyCd: "N", rcptTyCd: "S", salesSttsCd: "02", pmtTyCd: "01", prcOrdCd: "PC0001" })
    for (const k of ["idempotencyKey", "sdcId", "mrcNo", "dvcSrlNo", "env"]) expect(body).not.toHaveProperty(k)
    // 11:06:55Z == 13:06:55 Kigali
    expect(body.cfmDt).toBe("20261014130655")
    expect(body.salesDt).toBe("20261014")
    expect(body.taxblAmtB).toBe(1180)
    expect(body.taxAmtB).toBe(180)
    expect(body.totAmt).toBe(1180)
    expect(body.itemList[0]).toMatchObject({ itemSeq: 1, itemCd: "RW2CTU0000001", itemClsCd: "5059690800", qty: 1, prc: 1180, splyAmt: 1180, taxTyCd: "B", taxblAmt: 1180, taxAmt: 180, totAmt: 1180 })
    expect(body.receipt).toMatchObject({ custTin: "100000001", rptNo: 8 })
  })
})

// ── valid response ─────────────────────────────────────────────────────────

describe("valid VSDC response", () => {
  it("persists exactly the returned fiscal block and the raw response, with the Kigali timestamp as a real instant", async () => {
    enqueue(nsSale())
    replies = [SIGNED]
    expect(await processEbmOutboxBatch(5)).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    expect(db.outbox.get(1)!.status).toBe("SUCCEEDED")
    const [tx] = saleTxs(10)
    expect(tx).toMatchObject({
      submissionStatus: "SUCCESS", ebmInvoiceNumber: "168", sdcRcptNo: 168, totalRcptNo: 258,
      sdcId: "TESTSDC010000001", internalData: "TESTINTL0001AAAABBBBCCCC", receiptSignature: "TESTSIGN0001DDDD", rcptLabel: "NS",
    })
    expect(tx.sdcDateTime.toISOString()).toBe("2026-10-14T11:07:00.000Z")
    expect(tx.responseData.raw).toEqual(SIGNED)
    expect(tx.responseData.requestPayload.invcNo).toBe(8)
    expect(tx.journalText).toContain("SIGNATURE:TESTSIGN0001DDDD")
  })

  it("prints the VSDC data identically on the 80mm and A4 layouts", async () => {
    enqueue(nsSale())
    replies = [SIGNED]
    await processEbmOutboxBatch(5)
    const payload = await composeInvoicePayload(req(10))
    expect(payload!.invoice.notFiscalized).toBeNull()
    expect(payload!.certification.isCertified).toBe(true)
    expect(payload!.verification.qrPayload).toBe("14102026#130700#TESTSDC010000001#168/258NS#TESTINTL0001AAAABBBBCCCC#TESTSIGN0001DDDD")
    for (const format of ["80mm", "A4"] as const) {
      const text = await printed(payload, format)
      expect(text, format).toContain("SDC INFORMATION")
      expect(text, format).toContain("Date: 14/10/2026 Time: 13:07:00")
      expect(text, format).toContain("SDC ID: TESTSDC010000001")
      expect(text, format).toContain("RECEIPT NUMBER: 168/258 NS")
      expect(text, format).toContain("Internal Data:TEST-INTL-0001-AAAA-BBBB-CCCC")
      expect(text, format).toContain("Receipt Signature:TEST-SIGN-0001-DDDD")
      expect(text, format).toContain("MRC: TESTMRC0001")
      expect(text, format).toContain("RECEIPT NUMBER: 8")
      expect(text, format).not.toContain("NOT FISCALISED")
    }
    expect(await printed(payload, "80mm")).toContain("1180.00x 1.00")
    expect(await printed(payload, "A4")).toMatch(/\n1\.00\nB\n/)
  })

  it("prints quantities with 2-3 decimals and exempt band A as A-EX (CIS §16, §24.4.1)", () => {
    expect([1, 3, 0.2, 2.5, 1.125, 1500].map(formatReceiptQuantity)).toEqual(["1.00", "3.00", "0.20", "2.50", "1.125", "1500.00"])
    expect(["A", "a", "B", "C", "D", "", null].map(formatItemTaxLabel)).toEqual(["A-EX", "A-EX", "B", "C", "D", "", ""])
  })

  it("an unsigned training (TS) confirmation is accepted without intrlData/rcptSign", async () => {
    enqueue(nsSale({ rcptLabel: "TS" }))
    replies = [{ ...SIGNED, data: { ...SIGNED_BLOCK, intrlData: "", rcptSign: "" } }]
    await processEbmOutboxBatch(5)
    expect(sent[0].salesTyCd).toBe("T")
    expect(db.outbox.get(1)!.status).toBe("SUCCEEDED")
  })

  it("a TS that VSDC answers with a signature (recorded as a normal sale) is never accepted as training", async () => {
    enqueue(nsSale({ rcptLabel: "TS" }))
    replies = [SIGNED]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("DEAD_LETTER")
    expect(db.outbox.get(1)!.lastError).toMatch(/recorded as a signed normal receipt/)
    expectNothingFiscalized(10)
  })
})

// ── responses that must never produce a receipt ────────────────────────────

describe("rejected, malformed, incomplete and timed-out responses", () => {
  it.each([
    ["910 request parameter error", { resultCd: "910", resultMsg: "Request parameter error", data: null }, "DEAD_LETTER", /910/],
    ["884 invalid customer TIN", { resultCd: "884", resultMsg: "Invalid customer TIN was provided", data: null }, "DEAD_LETTER", /884/],
    ["901 not a valid device", { resultCd: "901", resultMsg: "It is not valid device", data: null }, "FAILED", /901/],
  ])("rejected (%s) → %s, nothing fiscalized", async (_n, body, status, msg) => {
    enqueue(nsSale())
    replies = [body]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe(status)
    expect(db.outbox.get(1)!.lastError).toMatch(msg)
    expect(saleTxs(10)[0].submissionStatus).toBe("FAILED")
    expectNothingFiscalized(10)
  })

  it.each([
    ["non-JSON gateway page", "<html>bad gateway</html>"],
    ["JSON array", [SIGNED_BLOCK] as any],
    ["data block not an object", { resultCd: "000", data: "168" }],
    ["non-numeric rcptNo", { ...SIGNED, data: { ...SIGNED_BLOCK, rcptNo: "ABC" } }],
    ["ISO instead of yyyyMMddHHmmss", { ...SIGNED, data: { ...SIGNED_BLOCK, vsdcRcptPbctDate: "2026-10-14T13:07:00" } }],
    ["impossible calendar date", { ...SIGNED, data: { ...SIGNED_BLOCK, vsdcRcptPbctDate: "20260231130700" } }],
  ])("malformed (%s) → retried, nothing fiscalized", async (_n, body) => {
    enqueue(nsSale())
    replies = [body as Reply]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("FAILED")
    expectNothingFiscalized(10)
  })

  it.each(["rcptSign", "intrlData", "totRcptNo", "sdcId", "mrcNo", "vsdcRcptPbctDate"])(
    "incomplete resultCd 000 without data.%s → never SUCCEEDED",
    async (field) => {
      enqueue(nsSale())
      const data: Row = { ...SIGNED_BLOCK }
      delete data[field]
      replies = [{ ...SIGNED, data }]
      await processEbmOutboxBatch(5)
      expect(db.outbox.get(1)!.status).not.toBe("SUCCEEDED")
      expect(db.outbox.get(1)!.lastError).toContain(`data.${field}`)
      expectNothingFiscalized(10)
      await expect(composeInvoicePayload(req(10))).rejects.toBeInstanceOf(FiscalizationPendingError)
    },
  )

  it("resultCd 000 with only rcptNo (the old acceptance rule) is not a receipt", async () => {
    enqueue(nsSale())
    replies = [{ resultCd: "000", resultMsg: "It is succeeded", data: { rcptNo: 168 } }]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("FAILED")
    expectNothingFiscalized(10)
  })

  it("HTTP 5xx is not a confirmation even if the body looks signed", async () => {
    enqueue(nsSale())
    replies = [{ status: 500, body: SIGNED }]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("FAILED")
    expect(db.outbox.get(1)!.lastError).toMatch(/HTTP 500/)
    expectNothingFiscalized(10)
  })

  it("timeout → retryable FAILED; the receipt stays blocked (425) and the retry resends the same invcNo", async () => {
    enqueue(nsSale())
    replies = ["timeout"]
    await processEbmOutboxBatch(5)
    const row = db.outbox.get(1)!
    expect(row.status).toBe("FAILED")
    expect(row.lastError).toMatch(/abort/i)
    expect(row.retryCount).toBe(1)
    expectNothingFiscalized(10)
    await expect(composeInvoicePayload(req(10))).rejects.toBeInstanceOf(FiscalizationPendingError)

    row.nextAttemptAt = new Date(Date.now() - 1000)
    replies = [SIGNED]
    await processEbmOutboxBatch(5)
    expect(sent.map((b) => b.invcNo)).toEqual([8, 8])
    expect(db.outbox.get(1)!.status).toBe("SUCCEEDED")
    expect(saleTxs(10)).toHaveLength(1)
    expect(saleTxs(10)[0].sdcRcptNo).toBe(168)
  })
})

// ── duplicates and sequencing ──────────────────────────────────────────────

describe("duplicate control", () => {
  it("924 without the original receipt block dead-letters (no fabricated receipt, no new invcNo)", async () => {
    enqueue(nsSale())
    replies = [{ resultCd: "924", resultMsg: "Invoice number already exists.", data: { rcptNo: 168 } }]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("DEAD_LETTER")
    expect(db.outbox.get(1)!.lastError).toMatch(/924/)
    expectNothingFiscalized(10)
  })

  it("924 that echoes the complete original block is accepted with VSDC's own data", async () => {
    enqueue(nsSale())
    replies = [{ ...SIGNED, resultCd: "924", resultMsg: "Invoice number already exists." }]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("SUCCEEDED")
    expect(saleTxs(10)[0]).toMatchObject({ sdcRcptNo: 168, receiptSignature: "TESTSIGN0001DDDD" })
  })

  it("a stale PROCESSING lease is resent as the same document — never marked SUCCEEDED from a heartbeat", async () => {
    enqueue(nsSale(), "SALE", { status: "PROCESSING", updatedAt: new Date(Date.now() - 10 * 60_000) })
    replies = [{ resultCd: "000", resultMsg: "It is succeeded", data: { clsList: [] } }]
    await processEbmOutboxBatch(5)
    expect(sent).toHaveLength(1)
    expect(sent[0].invcNo).toBe(8)
    expect(db.outbox.get(1)!.status).toBe("FAILED")
    expectNothingFiscalized(10)
  })

  it("a row already claimed by another worker is not submitted twice", async () => {
    enqueue(nsSale())
    replies = [SIGNED, SIGNED]
    await Promise.all([processEbmOutboxBatch(5), processEbmOutboxBatch(5)])
    expect(sent).toHaveLength(1)
    expect(saleTxs(10)).toHaveLength(1)
  })

  it("a cancellation retry reuses the invcNo allocated on its first attempt", async () => {
    const sale = nsSale({ status: "CANCELLED" })
    db.txs.push({ id: db.nextTxId++, saleId: 10, operation: "SALE", submissionStatus: "SUCCESS", ebmInvoiceNumber: "168", idempotencyKey: "ebm-SALE-1-10" })
    enqueue(sale, "VOID")
    replies = ["timeout"]
    await processEbmOutboxBatch(5)
    expect(db.outbox.get(1)!.status).toBe("FAILED")
    db.outbox.get(1)!.nextAttemptAt = new Date(Date.now() - 1000)
    replies = [{ ...SIGNED, data: { ...SIGNED_BLOCK, rcptNo: 169, totRcptNo: 259 } }]
    await processEbmOutboxBatch(5)
    expect(sent.map((b) => [b.invcNo, b.salesSttsCd])).toEqual([[100, "04"], [100, "04"]])
    expect(vi.mocked(generateInvoiceNumber)).toHaveBeenCalledTimes(1)
    expect(db.outbox.get(1)!.status).toBe("SUCCEEDED")
  })
})

// ── parser / decision units ────────────────────────────────────────────────

describe("response parsing", () => {
  it("vsdcRcptPbctDate maps to the same instant regardless of server timezone", () => {
    const parsed = parseVsdcResponse(SIGNED)
    expect(parsed.sdcDateTime).toBe("2026-10-14T13:07:00+02:00")
    expect(new Date(parsed.sdcDateTime).toISOString()).toBe("2026-10-14T11:07:00.000Z")
  })

  it("numeric rcptNo/totRcptNo are carried as exact digit strings", () => {
    const d = decideVsdcReceiptResult({ success: true, rawStatus: 200, rawBody: SIGNED }, { docLabel: "NS receipt" })
    expect(d.confirmed).toBe(true)
    if (d.confirmed) expect(d.data).toMatchObject({ rcptNo: "168", totRcptNo: "258", sdcId: "TESTSDC010000001", mrcNo: "TESTMRC0001" })
  })
})

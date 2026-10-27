import { describe, expect, it, vi, beforeEach } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────
let stockItemsPayload: any = null
let stockMasterArgs: any = null
let savePurchasePayload: any = null
const ledgerUpdates: any[] = []
const addStockCalls: any[] = []
const sellingPriceCalls: any[] = []

vi.mock("../src/lib/prisma", () => {
  const purchase = {
    id: 7,
    organizationId: 1,
    spplrTin: "200000001",
    spplrNm: "ACME WHOLESALE",
    spplrBhfId: "00",
    spplrInvcNo: 4321n,
    rcptTyCd: "P",
    pmtTyCd: "01",
    prcOrdCd: "ABC123",
    remark: null,
    status: "PENDING",
    items: [
      { id: 11, itemSeq: 1, itemCd: "RW2CTU0000001", itemClsCd: "5059690800", itemNm: "Widget", bcd: null,
        pkgUnitCd: "CT", pkg: { toNumber: () => 10 }, qtyUnitCd: "U",
        qty: { toNumber: () => 10 }, prc: { toNumber: () => 118 }, splyAmt: { toNumber: () => 1180 },
        dcRt: null, dcAmt: null, taxTyCd: "B", taxblAmt: { toNumber: () => 1000 }, taxAmt: { toNumber: () => 180 }, totAmt: { toNumber: () => 1180 } },
    ],
  }
  const prisma: any = {
      rraSyncCursor: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
      rraPurchase: {
        findFirst: vi.fn(async () => purchase),
        update: vi.fn(async () => ({})),
        upsert: vi.fn(async () => ({})),
      },
      user: { findUnique: vi.fn(async () => ({ id: 3, name: "Buyer" })) },
      inventoryLedger: {
        findUnique: vi.fn(async () => ({
          id: 99, organizationId: 1, branchId: 1, movementType: "PURCHASE", direction: "IN",
          quantity: 10, unitCost: { toNumber: () => 118 }, createdAt: new Date("2026-08-31T08:00:00Z"),
          note: "PO receipt", ebmSyncStatus: "PENDING", ebmSarNo: null,
          product: { id: 5, name: "Widget", itemCd: "RW2CTU0000001", itemClsCd: "5059690800", pkgUnitCd: "CT", qtyUnitCd: "U", barcode: null, taxCode: "B", unitPrice: { toNumber: () => 118 } },
          user: { id: 3, name: "Buyer" },
        })),
        aggregate: vi.fn(async () => ({ _max: { ebmSarNo: 41 } })),
        update: vi.fn(async (a: any) => { ledgerUpdates.push(a); return {} }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
        groupBy: vi.fn(async () => []),
      },
      organization: { update: vi.fn(async () => ({})) },
      rraCode: {
        findMany: vi.fn(async ({ where }: any) => {
          if (where?.cdCls === '04') {
            return [
              { cd: 'A', cdNm: 'A-EX', userDfnCd1: '0', srtOrd: 1 },
              { cd: 'B', cdNm: 'B-18.00%', userDfnCd1: '18', srtOrd: 2 },
            ]
          }
          return []
        }),
        findUnique: vi.fn(async () => null),
        count: vi.fn(async () => 2),
      },
      product: {
        findMany: vi.fn(async () => [{ id: 5, itemCd: "RW2CTU0000001" }]),
        findFirst: vi.fn(async () => ({ id: 5, name: "Widget", itemCd: "RW2CTU0000001" })),
        create: vi.fn(async (a: any) => ({ id: 99, name: a.data.name, itemCd: a.data.itemCd })),
        update: vi.fn(async (a: any) => ({ id: a.where.id, name: a.data.name ?? "Widget", itemCd: "RW2CTU0000001" })),
      },
      $executeRaw: vi.fn(async () => 0),
      $transaction: vi.fn(async (ops: any) => (typeof ops === "function" ? ops(prisma) : Promise.all(ops))),
  }
  return { prisma }
})

vi.mock("../src/services/rra-ebm.service", async () => {
  const actual = await vi.importActual<any>("../src/services/rra-ebm.service")
  return { ...actual, isEbmEnabled: () => true }
})

vi.mock("../src/services/inventory-ledger.service", () => ({
  getCurrentStock: vi.fn(async () => 250),
  addStock: vi.fn(async (p: any) => { addStockCalls.push(p); return { id: 1000 + addStockCalls.length } }),
  resolveActiveBranchId: vi.fn(async (_org: number, preferred?: number | null) => preferred ?? 9),
  receiveStockOnBranch: vi.fn(async (p: any) => { addStockCalls.push(p); return { id: 1000 + addStockCalls.length } }),
}))

vi.mock("../src/services/item-code.service", async () => {
  const actual = await vi.importActual<any>("../src/services/item-code.service")
  return {
    ...actual,
    allocateItemCd: vi.fn(async () => "RW2CTU0000099"),
    getOriginNationCode: vi.fn(async () => "RW"),
  }
})

vi.mock("../src/services/product-sync.service", () => ({
  syncProductToRra: vi.fn(async () => ({ success: true })),
  applySellingPriceOnReceipt: vi.fn(async (...args: any[]) => { sellingPriceCalls.push(args) }),
}))

vi.mock("../src/services/vsdc-api.service", async () => {
  const actual = await vi.importActual<any>("../src/services/vsdc-api.service")
  return {
    ...actual,
    buildVsdcEnvelope: vi.fn(async () => ({ tin: "100000000", bhfId: "00", sdcId: "SDC1", mrcNo: "MRC1", dvcSrlNo: "MRC1", env: "sandbox" })),
    validateVsdcEnvelope: vi.fn(() => null),
    saveStockItems: vi.fn(async (_e: any, p: any) => { stockItemsPayload = p; return { success: true, data: { rcptNo: "1" }, rawStatus: 200, rawBody: {} } }),
    saveStockMaster: vi.fn(async (_e: any, itemCd: string, rsdQty: number, reg: any) => { stockMasterArgs = { itemCd, rsdQty, reg }; return { success: true, rawStatus: 200, rawBody: {} } }),
    savePurchase: vi.fn(async (_e: any, p: any) => { savePurchasePayload = p; return { success: true, rawStatus: 200, rawBody: {} } }),
  }
})

import { sarTyCdFor, stockMovementNeedsEbm, submitStockLedgerEntryToEbm } from "../src/services/stock-movement-sync.service"
import { confirmRraPurchase } from "../src/services/purchase-sync.service"

beforeEach(() => {
  stockItemsPayload = null
  stockMasterArgs = null
  savePurchasePayload = null
  ledgerUpdates.length = 0
  addStockCalls.length = 0
  sellingPriceCalls.length = 0
})

describe("sarTyCdFor (§4.19 stock in/out reason)", () => {
  it("maps incoming movements to IN reason codes", () => {
    expect(sarTyCdFor("PURCHASE", "IN")).toBe("02")
    expect(sarTyCdFor("RETURN_CUSTOMER", "IN")).toBe("03")
    expect(sarTyCdFor("TRANSFER_IN", "IN")).toBe("04")
    expect(sarTyCdFor("ADJUSTMENT_IN", "IN")).toBe("06")
  })
  it("maps outgoing movements to OUT reason codes", () => {
    expect(sarTyCdFor("TRANSFER_OUT", "OUT")).toBe("13")
    expect(sarTyCdFor("PRODUCTION_CONSUME", "OUT")).toBe("14")
    expect(sarTyCdFor("DAMAGE", "OUT")).toBe("15")
    expect(sarTyCdFor("ADJUSTMENT_OUT", "OUT")).toBe("16")
  })
  it("reports a SALE as sarTyCd 11 after its invoice (S8, v1.0.5)", () => {
    expect(sarTyCdFor("SALE", "OUT")).toBe("11")
    expect(stockMovementNeedsEbm("SALE")).toBe(true)
    expect(stockMovementNeedsEbm("PURCHASE")).toBe(true)
  })
  it("does not report INITIAL_STOCK (product create) to stock IO / master", () => {
    expect(stockMovementNeedsEbm("INITIAL_STOCK")).toBe(false)
  })
})

describe("submitStockLedgerEntryToEbm (§72/§73)", () => {
  it("sends a StockIoSaveReq then pushes the new on-hand quantity to the stock master", async () => {
    const r = await submitStockLedgerEntryToEbm(99)
    expect(r.success).toBe(true)

    expect(stockItemsPayload.sarNo).toBe(42) // 41 + 1
    expect(stockItemsPayload.sarTyCd).toBe("02")
    expect(stockItemsPayload.itemList[0].itemCd).toBe("RW2CTU0000001")
    expect(stockItemsPayload.itemList[0].qty).toBe(10)
    // input VAT extracted from the 118 x 10 supply
    expect(stockItemsPayload.itemList[0].taxAmt).toBeCloseTo(180, 0)
    // StockIOSaveReq sample: custTin/custBhfId null unless a real counterparty
    expect(stockItemsPayload.custTin).toBeNull()
    expect(stockItemsPayload.custBhfId).toBeNull()
    expect(stockItemsPayload.custNm).toBeNull()

    expect(stockMasterArgs.itemCd).toBe("RW2CTU0000001")
    expect(stockMasterArgs.rsdQty).toBe(250)

    expect(ledgerUpdates.at(-1).data.ebmSyncStatus).toBe("SYNCED")
  })
})

describe("confirmRraPurchase (§71)", () => {
  it("builds a TrnsPurchaseSaveReq with per-band tax and marks the purchase CONFIRMED", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3 })
    expect(r.success).toBe(true)

    expect(savePurchasePayload.spplrTin).toBe("200000001")
    expect(savePurchasePayload.spplrInvcNo).toBe(4321)
    expect(savePurchasePayload.pchsSttsCd).toBe("02")
    // VSDC §3.3.7.2 sample: tax-inclusive — totAmt == totTaxblAmt (not + tax)
    expect(savePurchasePayload.taxblAmtB).toBeCloseTo(1180, 0)
    expect(savePurchasePayload.taxAmtB).toBeCloseTo(180, 0)
    expect(savePurchasePayload.totAmt).toBeCloseTo(1180, 0)
    expect(savePurchasePayload.totAmt).toBe(savePurchasePayload.totTaxblAmt)
    expect(savePurchasePayload.itemList[0].taxTyCd).toBe("B")
    expect(savePurchasePayload.itemList[0].totAmt).toBe(savePurchasePayload.itemList[0].taxblAmt)
  })

  it("§74: books the received quantity into branch stock, without re-reporting it to the VSDC", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3, branchId: 4 })
    expect(r.success).toBe(true)

    expect(addStockCalls).toHaveLength(1)
    const booked = addStockCalls[0]
    expect(booked.productId).toBe(5)
    expect(booked.branchId).toBe(4)
    expect(booked.quantity).toBe(10)
    expect(booked.movementType).toBe("PURCHASE")
    // RRA already booked the stock-in from /trnsPurchase/savePurchases —
    // this ledger row must not be queued for /stock/saveStockItems too.
    expect(booked.skipEbmSync).toBe(true)

    // §73: remaining qty must still be pushed (savePurchases does not update master).
    expect(stockMasterArgs.itemCd).toBe("RW2CTU0000001")
    expect(stockMasterArgs.rsdQty).toBe(250)
  })

  it("rejects at VSDC with pchsSttsCd 04 (Canceled) and does not book stock", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3, reject: true, remark: "wrong goods" })
    expect(r.success).toBe(true)
    expect(savePurchasePayload.pchsSttsCd).toBe("04")
    expect(savePurchasePayload.cnclDt).toBeTruthy()
    expect(savePurchasePayload.remark).toBe("wrong goods")
    expect(addStockCalls).toHaveLength(0)
    expect(stockMasterArgs).toBeNull()
  })

  it("forwards the persisted purchase code on confirm (§38)", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3 })
    expect(r.success).toBe(true)
    expect(savePurchasePayload.prcOrdCd).toBe("ABC123")
  })

  it("lets the operator override prcOrdCd at confirm time", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3, prcOrdCd: "XYZ987" })
    expect(r.success).toBe(true)
    expect(savePurchasePayload.prcOrdCd).toBe("XYZ987")
  })

  it("falls back to the default branch when none is supplied so local stock still increments", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3 })
    expect(r.success).toBe(true)
    expect(addStockCalls).toHaveLength(1)
    expect(addStockCalls[0].branchId).toBe(9)
    expect(addStockCalls[0].quantity).toBe(10)
  })

  it("sends the operator's local name as itemNm and keeps the supplier name on spplrItemNm", async () => {
    const r = await confirmRraPurchase(1, 7, {
      userId: 3,
      items: [{ itemId: 11, itemNm: "House Blend Coffee" }],
    })
    expect(r.success).toBe(true)
    expect(savePurchasePayload.itemList[0].itemNm).toBe("House Blend Coffee")
    expect(savePurchasePayload.itemList[0].spplrItemNm).toBe("Widget")
    expect(savePurchasePayload.itemList[0].spplrItemCd).toBe("RW2CTU0000001")
  })

  it("books stock against a linked local product", async () => {
    const r = await confirmRraPurchase(1, 7, {
      userId: 3,
      branchId: 4,
      items: [{ itemSeq: 1, linkProductId: 5, itemNm: "Widget" }],
    })
    expect(r.success).toBe(true)
    expect(addStockCalls[0].productId).toBe(5)
  })

  it("applies the operator's selling price and expiry date when accepting stock", async () => {
    const r = await confirmRraPurchase(1, 7, {
      userId: 3,
      branchId: 4,
      items: [{ itemSeq: 1, linkProductId: 5, sellingPrice: 1500, expiryDate: new Date("2027-03-31T00:00:00Z") }],
    })
    expect(r.success).toBe(true)
    expect(sellingPriceCalls).toEqual([[1, 5, 1500, 3]])
    expect(savePurchasePayload.itemList[0].itemExprDt).toBe("20270331")
    expect(addStockCalls[0].expiryDate).toEqual(new Date("2027-03-31T00:00:00Z"))
  })

  it("leaves the selling price alone when none is given", async () => {
    const r = await confirmRraPurchase(1, 7, { userId: 3, branchId: 4 })
    expect(r.success).toBe(true)
    expect(sellingPriceCalls).toEqual([[1, 5, undefined, 3]])
    expect(savePurchasePayload.itemList[0].itemExprDt).toBeNull()
  })
})

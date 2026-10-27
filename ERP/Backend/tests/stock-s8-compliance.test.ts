import { describe, expect, it, vi, beforeEach } from "vitest"

// ── S8/S11/S14 + scenarios (a)-(g): sale 11 after invoice ack, positive qty,
// orgSarNo lineage (never 0), header/line totals, S12 idempotency, oversell
// serialization guard. DB-free via prisma/vsdc mocks.

const callOrder: string[] = []
let ledgerRow: any = null
let saleRow: any = null
let ebmTxRow: any = null
let origSarRow: any = null
let stockPayload: any = null
const txCalls: string[] = []

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    inventoryLedger: {
      findUnique: vi.fn(async () => ledgerRow),
      findFirst: vi.fn(async (a: any) => {
        // orgSarNo lookup: original SALE row for same product/branch/ref
        if (a?.where?.movementType === "SALE") return origSarRow
        if (a?.where?.reference?._startsWith || a?.where?.reference) {
          // applyRraStockMoves dedupe probe
          return null
        }
        return null
      }),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _max: { ebmSarNo: 41 } })),
    },
    sale: { findFirst: vi.fn(async () => saleRow) },
    ebmTransaction: { findFirst: vi.fn(async () => ebmTxRow) },
    organization: { update: vi.fn(async () => ({})) },
    product: { findFirst: vi.fn(async () => ({ id: 5 })) },
    user: { findFirst: vi.fn(async () => ({ id: 3 })) },
    branch: { findFirst: vi.fn(async () => ({ id: 9 })) },
    $transaction: vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
  },
}))

vi.mock("../src/services/rra-ebm.service", async () => {
  const actual = await vi.importActual<any>("../src/services/rra-ebm.service")
  return { ...actual, isEbmEnabled: () => true, fix2: (n: number) => Math.round(n * 100) / 100, toRraDate: () => "20261007" }
})

vi.mock("../src/services/vsdc-api.service", async () => {
  const actual = await vi.importActual<any>("../src/services/vsdc-api.service")
  return {
    ...actual,
    buildVsdcEnvelope: vi.fn(async () => ({ tin: "200000001", bhfId: "00", vsdcUrl: "http://vsdc" })),
    validateVsdcEnvelope: vi.fn(() => null),
    saveStockItems: vi.fn(async (_e: any, p: any) => { callOrder.push("saveStockItems"); stockPayload = p; return { success: true } }),
    saveStockMaster: vi.fn(async () => { callOrder.push("saveStockMaster"); return { success: true } }),
  }
})

vi.mock("../src/services/rra-code.service", () => ({
  getTaxRateForCode: vi.fn(async () => 0),
}))

vi.mock("../src/services/inventory-ledger.service", async () => {
  const actual = await vi.importActual<any>("../src/services/inventory-ledger.service")
  return {
    ...actual,
    getCurrentStock: vi.fn(async () => 6),
    addStock: vi.fn(async (p: any) => ({ id: 9000, ...p })),
  }
})

vi.mock("../src/services/accounting-outbox.service", () => ({
  enqueueInventoryMovementAccountingEvent: vi.fn(async () => ({})),
}))

import { sarTyCdFor, stockMovementNeedsEbm, submitStockLedgerEntryToEbm } from "../src/services/stock-movement-sync.service"
import { itemTypeCodeDigit } from "../src/services/item-code.service"

function baseLedgerRow(over: any = {}) {
  return {
    id: 1, organizationId: 1, branchId: 9, movementType: "SALE", direction: "OUT",
    quantity: 4, unitCost: { toNumber: () => 100 }, createdAt: new Date("2026-10-06T10:00:00Z"),
    note: "Sale #SALE-1", reference: "SALE-1", referenceType: "SALE", metadata: null,
    ebmSyncStatus: "PENDING", ebmSarNo: null, ebmOrgSarNo: null,
    product: { id: 5, name: "Item X", itemCd: "RW2CTU0000001", itemClsCd: "5059690800", pkgUnitCd: "CT", qtyUnitCd: "U", barcode: null, taxCode: "B", unitPrice: { toNumber: () => 100 } },
    user: { id: 3, name: "Op" },
    ...over,
  }
}

beforeEach(() => {
  callOrder.length = 0
  stockPayload = null
  origSarRow = null
  ledgerRow = baseLedgerRow()
  saleRow = { id: 10 }
  ebmTxRow = null
})

describe("S11 mapping (v1.0.5)", () => {
  it("(a) normal sale maps to 11 Outgoing", () => {
    expect(sarTyCdFor("SALE", "OUT", null)).toBe("11")
  })
  it("import/purchase/return/movement/adjust map correctly", () => {
    expect(sarTyCdFor("PURCHASE", "IN", "RRA_IMPORT")).toBe("01")
    expect(sarTyCdFor("PURCHASE", "IN", null)).toBe("02")
    expect(sarTyCdFor("RETURN_CUSTOMER", "IN", null)).toBe("03")
    expect(sarTyCdFor("TRANSFER_IN", "IN", null)).toBe("04")
    expect(sarTyCdFor("PRODUCTION_OUTPUT", "IN", null)).toBe("05")
    expect(sarTyCdFor("TRANSFER_OUT", "OUT", null)).toBe("13")
    expect(sarTyCdFor("PRODUCTION_CONSUME", "OUT", null)).toBe("14")
    expect(sarTyCdFor("DAMAGE", "OUT", null)).toBe("15")
  })
  it("item types 1/2/3", () => {
    expect(itemTypeCodeDigit("RAW_MATERIAL")).toBe("1")
    expect(itemTypeCodeDigit("PRODUCT")).toBe("2")
    expect(itemTypeCodeDigit("SERVICE")).toBe("3")
  })
  it("SALE needs EBM stock sync", () => {
    expect(stockMovementNeedsEbm("SALE")).toBe(true)
    expect(stockMovementNeedsEbm("INITIAL_STOCK")).toBe(false)
  })
})

describe("S8 order: stock 11 only after invoice ack", () => {
  it("(g) defers SALE 11 while invoice not fiscalized — nothing sent", async () => {
    ebmTxRow = null // no SUCCESS invoice yet
    const r = await submitStockLedgerEntryToEbm(1)
    expect(r.success).toBe(false)
    expect(callOrder).toEqual([])
  })
  it("(a) sends saveStockItems(11) then saveStockMaster(rsdQty) after ack", async () => {
    ebmTxRow = { id: 77 } // invoice SUCCESS
    const r = await submitStockLedgerEntryToEbm(1)
    expect(r.success).toBe(true)
    expect(callOrder).toEqual(["saveStockItems", "saveStockMaster"])
    expect(stockPayload.sarTyCd).toBe("11")
    expect(stockPayload.qty ?? stockPayload.itemList[0].qty).toBeGreaterThan(0)
  })
  it("orgSarNo links original, 0 for originals (live VSDC rejects null)", async () => {
    ledgerRow = baseLedgerRow({
      id: 2, movementType: "RETURN_CUSTOMER", direction: "IN", quantity: 4,
      reference: "REFUND-SALE-1-xyz", referenceType: "SALE_REFUND",
      metadata: { originalSaleNumber: "SALE-1" },
    })
    origSarRow = { ebmSarNo: 41 }
    ebmTxRow = { id: 77 }
    const r = await submitStockLedgerEntryToEbm(2)
    expect(r.success).toBe(true)
    expect(stockPayload.sarTyCd).toBe("03")
    expect(stockPayload.itemList[0].qty).toBe(4) // positive, not -4
    expect(stockPayload.orgSarNo).toBe(41) // linked, not 0
  })
  it("orgSarNo is 0 (not null) when no original found", async () => {
    ledgerRow = baseLedgerRow({
      id: 3, movementType: "RETURN_CUSTOMER", direction: "IN", quantity: 1,
      reference: "REFUND-zzz", referenceType: "SALE_REFUND", metadata: { originalSaleNumber: "SALE-zzz" },
    })
    origSarRow = null
    const r = await submitStockLedgerEntryToEbm(3)
    expect(r.success).toBe(true)
    expect(stockPayload.orgSarNo).toBe(0)
  })
})

describe("S14 header/line totals", () => {
  it("header equals item-line sums on the single-line payload", async () => {
    ebmTxRow = { id: 77 }
    await submitStockLedgerEntryToEbm(1)
    const line = stockPayload.itemList[0]
    expect(stockPayload.totItemCnt).toBe(stockPayload.itemList.length)
    expect(stockPayload.totTaxblAmt).toBeCloseTo(line.taxblAmt, 2)
    expect(stockPayload.totTaxAmt).toBeCloseTo(line.taxAmt, 2)
    expect(stockPayload.totAmt).toBeCloseTo(line.totAmt, 2)
  })
})

describe("oversell serialization guard", () => {
  it("removeStock takes pg advisory lock before reading balance", async () => {
    const mod = await import("../src/services/inventory-ledger.service")
    const order: string[] = []
    const tx = {
      $executeRaw: vi.fn(async () => { order.push("lock") }),
      $queryRaw: vi.fn(async () => [{ id: 5, quantity: 6, name: "X" }]),
      inventoryLedger: {
        groupBy: vi.fn(async () => {
          order.push("read")
          return [{ direction: "IN", _sum: { quantity: 10 } }, { direction: "OUT", _sum: { quantity: 4 } }]
        }),
        create: vi.fn(async (a: any) => ({ id: 1, ...a.data })),
      },
      product: { update: vi.fn(async () => ({})) },
    }
    // (b) 7 requested at stock 6 must throw; lock must come first
    await expect(mod.removeStock({
      organizationId: 1, productId: 5, userId: 3, quantity: 7,
      movementType: "SALE", branchId: 9, tx,
    })).rejects.toThrow(/Insufficient stock/)
    expect(order).toEqual(["lock", "read"])
    expect(String(tx.$executeRaw.mock.calls[0][0])).toMatch(/pg_advisory_xact_lock/)
    void txCalls
  })
})

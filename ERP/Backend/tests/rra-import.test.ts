import { describe, expect, it, vi, beforeEach } from "vitest"

let updatePayload: any = null
let addStockArgs: any = null
const importUpserts: any[] = []
let cursorValue = "20260101000000"
const cursorUpserts: any[] = []
let importLineStatus = "PENDING"

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    rraSyncCursor: {
      findUnique: vi.fn(async () => ({ lastReqDt: cursorValue })),
      upsert: vi.fn(async (a: any) => { cursorUpserts.push(a); return a.create }),
      updateMany: vi.fn(async (a: any) => { cursorUpserts.push({ touch: a }); return { count: 1 } }),
    },
    rraImportItem: {
      upsert: vi.fn(async (a: any) => { importUpserts.push(a); return a.create }),
      findFirst: vi.fn(async () => ({
        id: 1, organizationId: 1, taskCd: "TASK1", dclNo: "DCL9", dclDe: "20260815", itemSeq: 1,
        hsCd: "1234.56", itemNm: "Imported widget", itemCd: null, itemClsCd: null,
        orgnNatCd: "CN", pkgUnitCd: "CT", qtyUnitCd: "U",
        invcFcurAmt: { toNumber: () => 2000 },
        status: importLineStatus, qty: { toNumber: () => 40 },
      })),
      update: vi.fn(async () => ({})),
    },
    product: {
      findFirst: vi.fn(async ({ where }: any) => ({
        id: where?.id ?? 77,
        itemClsCd: "5059690800",
        itemCd: "RW2CTU0000009",
        itemType: "PRODUCT",
        ebmSyncStatus: "SYNCED",
        unitPrice: 100,
      })),
      create: vi.fn(async (a: any) => ({ id: 88, itemCd: a.data.itemCd, itemClsCd: a.data.itemClsCd })),
      update: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => ({ id: 2, name: "Importer" })) },
    organization: { update: vi.fn(async () => ({})) },
  },
}))

vi.mock("../src/services/rra-ebm.service", async () => {
  const actual = await vi.importActual<any>("../src/services/rra-ebm.service")
  return { ...actual, isEbmEnabled: () => true }
})

vi.mock("../src/services/inventory-ledger.service", () => ({
  addStock: vi.fn(async (a: any) => { addStockArgs = a; return { id: 5 } }),
  resolveActiveBranchId: vi.fn(async (_org: number, preferred?: number | null) => preferred ?? 9),
  receiveStockOnBranch: vi.fn(async (a: any) => { addStockArgs = a; return { id: 5, ebmSyncStatus: "PENDING" } }),
}))

vi.mock("../src/services/stock-movement-sync.service", () => ({
  submitStockLedgerEntryToEbm: vi.fn(async () => ({ success: true })),
}))

vi.mock("../src/services/item-code.service", async () => {
  const actual = await vi.importActual<any>("../src/services/item-code.service")
  return {
    ...actual,
    allocateItemCd: vi.fn(async () => "RW2CTU0000099"),
    getOriginNationCode: vi.fn(async () => "RW"),
  }
})

vi.mock("../src/services/rra-code.service", () => ({
  getTaxationTypes: vi.fn(async () => [
    { code: "A", rate: 0 },
    { code: "B", rate: 18 },
  ]),
}))

vi.mock("../src/services/tax.service", () => ({
  TaxService: { getTaxCategory: () => "STANDARD" },
}))

vi.mock("../src/services/vsdc-api.service", async () => {
  const actual = await vi.importActual<any>("../src/services/vsdc-api.service")
  return {
    ...actual,
    buildVsdcEnvelope: vi.fn(async () => ({ tin: "100000000", bhfId: "00", sdcId: "SDC1", mrcNo: "MRC1", dvcSrlNo: "MRC1", env: "sandbox" })),
    validateVsdcEnvelope: vi.fn(() => null),
    selectImportItems: vi.fn(async () => ({
      success: true, resultCd: "000", resultMsg: "ok", raw: null,
      data: { itemList: [
        { taskCd: "TASK1", dclDe: "20260815", itemSeq: 1, dclNo: "DCL9", hsCd: "1234.56", itemNm: "Imported widget",
          qty: 40, qtyUnitCd: "U", pkgUnitCd: "CT", spplrNm: "OVERSEAS CO", invcFcurAmt: 2000, invcFcurCd: "USD" },
      ] },
    })),
    updateImportItems: vi.fn(async (_e: any, p: any) => { updatePayload = p; return { success: true, rawStatus: 200, rawBody: {} } }),
  }
})

vi.mock("../src/services/product-sync.service", () => ({
  applySellingPriceOnReceipt: vi.fn(async () => undefined),
  syncProductToRra: vi.fn(async () => ({ success: true })),
  syncProductToRraAsync: vi.fn(),
}))

import { syncRraImports, actionRraImport } from "../src/services/rra-import.service"
import { selectImportItems } from "../src/services/vsdc-api.service"

beforeEach(() => {
  updatePayload = null
  addStockArgs = null
  importUpserts.length = 0
  cursorUpserts.length = 0
  cursorValue = "20260101000000"
  importLineStatus = "PENDING"
  vi.mocked(selectImportItems).mockReset()
  vi.mocked(selectImportItems).mockResolvedValue({
    success: true, resultCd: "000", resultMsg: "ok", raw: null,
    data: { itemList: [
      { taskCd: "TASK1", dclDe: "20260815", itemSeq: 1, dclNo: "DCL9", hsCd: "1234.56", itemNm: "Imported widget",
        qty: 40, qtyUnitCd: "U", pkgUnitCd: "CT", spplrNm: "OVERSEAS CO", invcFcurAmt: 2000, invcFcurCd: "USD" },
    ] },
  } as any)
})

describe("syncRraImports — request-date validation (§67)", () => {
  it("rejects a request date that is not later than the previous request", async () => {
    cursorValue = "20260201000000"
    const r = await syncRraImports(1, { requestDate: "2026-01-15" })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/later than the previous/)
  })

  it("accepts a later request date and caches the returned lines (§66)", async () => {
    cursorValue = "20260101000000"
    const r = await syncRraImports(1, { requestDate: "2026-08-01" })
    expect(r.ok).toBe(true)
    expect(r.cached).toBe(1)
    expect(importUpserts[0].where.organizationId_taskCd_dclDe_itemSeq).toEqual({
      organizationId: 1, taskCd: "TASK1", dclDe: "20260815", itemSeq: 1,
    })
    // Supplier name must be persisted for the imports table column.
    expect(importUpserts[0].create.spplrNm).toBe("OVERSEAS CO")
    expect(importUpserts[0].update.spplrNm).toBe("OVERSEAS CO")
    expect(importUpserts[0].create.invcFcurCd).toBe("USD")
    // cursor advances to the run time, not the request date
    expect(cursorUpserts.at(-1).create.lastResult).toMatch(/OK/)
    expect(cursorUpserts.at(-1).create.lastReqDt).toBe(r.lastReqDt)
    expect(r.lastReqDt > cursorValue).toBe(true)
  })

  it("uses the stored cursor when no request date is given", async () => {
    const r = await syncRraImports(1)
    expect(r.ok).toBe(true)
  })

  it("treats a blank requestDate as absent", async () => {
    const r = await syncRraImports(1, { requestDate: "   " })
    expect(r.ok).toBe(true)
    expect(r.cached).toBe(1)
    expect(r.lastReqDt > cursorValue).toBe(true)
  })

  it("does not advance lastReqDt when VSDC returns zero import lines", async () => {
    vi.mocked(selectImportItems).mockResolvedValueOnce({
      success: true, resultCd: "001", resultMsg: "There is no search result", raw: null, data: null,
    } as any)
    const r = await syncRraImports(1)
    expect(r.ok).toBe(true)
    expect(r.cached).toBe(0)
    expect(r.fetched).toBe(0)
    expect(r.lastReqDt).toBe(cursorValue)
    // Empty pull must only touch lastRunAt/lastResult — never upsert lastReqDt.
    expect(cursorUpserts.at(-1).touch?.data?.lastResult).toMatch(/OK: 0/)
    expect(cursorUpserts.at(-1).touch?.data?.lastReqDt).toBeUndefined()
    expect(cursorUpserts.some((c) => c.create?.lastReqDt)).toBe(false)
  })
})

describe("actionRraImport — approve/reject (§68)", () => {
  it("approves with imptItemSttsCd 3 and books the stock-in when a product is linked", async () => {
    const r = await actionRraImport(1, 1, "approve", { branchId: 3, userId: 2, itemClsCd: "5059690800", itemCd: "RW2CTU0000009", linkProductId: 77 })
    expect(r.success).toBe(true)
    expect(updatePayload.imptItemSttsCd).toBe("3")
    expect(updatePayload.taskCd).toBe("TASK1")
    expect(updatePayload.itemClsCd).toBe("5059690800")

    expect(addStockArgs.productId).toBe(77)
    expect(addStockArgs.quantity).toBe(40)
    expect(addStockArgs.referenceType).toBe("RRA_IMPORT")
    expect(addStockArgs.branchId).toBe(3)
  })

  it("books local stock on the default branch when none is supplied", async () => {
    const r = await actionRraImport(1, 1, "approve", { userId: 2, itemClsCd: "5059690800", linkProductId: 77 })
    expect(r.success).toBe(true)
    expect(addStockArgs.productId).toBe(77)
    expect(addStockArgs.quantity).toBe(40)
    expect(addStockArgs.branchId).toBe(9)
  })

  it("cancels with imptItemSttsCd 4 and does not touch stock", async () => {
    const r = await actionRraImport(1, 1, "reject", { branchId: 3, userId: 2, remark: "wrong HS code" })
    expect(r.success).toBe(true)
    expect(updatePayload.imptItemSttsCd).toBe("4")
    expect(addStockArgs).toBeNull()
  })

  it("refuses to action a line that is not pending", async () => {
    importLineStatus = "APPROVED"
    const r = await actionRraImport(1, 1, "approve", { branchId: 3 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/already approved/)
  })

  it("refuses approve when neither a product is linked nor createProduct is set", async () => {
    const r = await actionRraImport(1, 1, "approve", { branchId: 3, userId: 2, itemClsCd: "5059690800" })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/receiving product/)
  })

  it("creates a product from the declaration when createProduct is set (§68)", async () => {
    const { prisma } = await import("../src/lib/prisma")
    const { submitStockLedgerEntryToEbm } = await import("../src/services/stock-movement-sync.service")
    // create → then findFirst for linked/fresh after sync
    vi.mocked(prisma.product.findFirst)
      .mockResolvedValueOnce({ id: 88, itemClsCd: "5059690800", itemCd: "RW2CTU0000099", itemType: "PRODUCT", ebmSyncStatus: "SYNCED" } as any)
      .mockResolvedValueOnce({ id: 88, itemClsCd: "5059690800", itemCd: "RW2CTU0000099" } as any)
      .mockResolvedValueOnce({ id: 88, itemClsCd: "5059690800", itemCd: "RW2CTU0000099" } as any)

    const r = await actionRraImport(1, 1, "approve", {
      branchId: 3, userId: 2, itemClsCd: "5059690800", createProduct: true, itemNm: "House Import Widget",
    })
    expect(r.success).toBe(true)
    expect(prisma.product.create).toHaveBeenCalled()
    expect(addStockArgs.productId).toBe(88)
    expect(submitStockLedgerEntryToEbm).toHaveBeenCalledWith(5)
  })

  it("refuses approve when hsCd is missing", async () => {
    const { prisma } = await import("../src/lib/prisma")
    vi.mocked(prisma.rraImportItem.findFirst).mockResolvedValueOnce({
      id: 1, organizationId: 1, taskCd: "TASK1", dclNo: "DCL9", dclDe: "20260815", itemSeq: 1,
      hsCd: null, itemNm: "Imported widget", itemCd: null, itemClsCd: null,
      status: "PENDING", qty: { toNumber: () => 40 },
    } as any)
    const r = await actionRraImport(1, 1, "approve", { branchId: 3, userId: 2, itemClsCd: "5059690800", linkProductId: 77 })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/hsCd is required/)
  })

  it("pushes VSDC stock immediately after approve (§74)", async () => {
    const { submitStockLedgerEntryToEbm } = await import("../src/services/stock-movement-sync.service")
    const r = await actionRraImport(1, 1, "approve", { branchId: 3, userId: 2, itemClsCd: "5059690800", linkProductId: 77 })
    expect(r.success).toBe(true)
    expect(submitStockLedgerEntryToEbm).toHaveBeenCalledWith(5)
  })
})

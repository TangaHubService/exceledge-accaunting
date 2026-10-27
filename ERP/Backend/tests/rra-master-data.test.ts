import { describe, expect, it, vi, beforeEach } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────
const codeUpserts: any[] = []
const classUpserts: any[] = []
const cursorUpserts: any[] = []
let customerUpdateManyArgs: any = null

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    rraSyncCursor: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (a: any) => { cursorUpserts.push(a); return a.create }),
    },
    rraCode: { upsert: vi.fn(async (a: any) => { codeUpserts.push(a); return a.create }) },
    rraItemClass: { upsert: vi.fn(async (a: any) => { classUpserts.push(a); return a.create }) },
    rraNotice: { upsert: vi.fn(async () => ({})) },
    customer: { updateMany: vi.fn(async (a: any) => { customerUpdateManyArgs = a; return { count: 1 } }) },
    product: { findMany: vi.fn(async () => [
      { id: 1, name: "Widget", itemCd: "RW2CTU0000001", itemClsCd: "5059690800", taxCode: "B", unitPrice: 100, ebmSyncStatus: "SYNCED" },
      { id: 2, name: "Orphan", itemCd: "RW2CTU0000099", itemClsCd: null, taxCode: "A", unitPrice: 50, ebmSyncStatus: "PENDING" },
    ] ) },
  },
}))

vi.mock("../src/services/rra-ebm.service", () => ({ isEbmEnabled: () => true }))

vi.mock("../src/services/vsdc-api.service", async () => {
  const actual = await vi.importActual<any>("../src/services/vsdc-api.service")
  return {
    ...actual,
    buildVsdcEnvelope: vi.fn(async () => ({ tin: "100000000", bhfId: "00", sdcId: "SDC1", mrcNo: "MRC1", dvcSrlNo: "MRC1", env: "sandbox" })),
    selectCodes: vi.fn(async () => ({
      success: true, resultCd: "000", resultMsg: "ok", raw: null,
      data: { clsList: [
        { cdCls: "07", cdClsNm: "Payment Type", dtlList: [
          { cd: "01", cdNm: "CASH", srtOrd: 1 },
          { cd: "06", cdNm: "MOBILE MONEY", srtOrd: 2 },
        ] },
        { cdCls: "04", cdClsNm: "Taxation Type", dtlList: [{ cd: "B", cdNm: "B-18%" }] },
      ] },
    })),
    selectItemsClass: vi.fn(async () => ({
      success: true, resultCd: "000", resultMsg: "ok", raw: null,
      data: { itemClsList: [{ itemClsCd: "5059690800", itemClsNm: "Generic", itemClsLvl: 5, taxTyCd: "B", useYn: "Y" }] },
    })),
    selectCustomer: vi.fn(async (_env: any, tin: string) => ({
      success: true, resultCd: "000", resultMsg: "ok", raw: null,
      data: { custList: [{ tin, taxprNm: "REAL TAXPAYER LTD", taxprSttsCd: "A" }] },
    })),
    selectItems: vi.fn(async () => ({
      success: true, resultCd: "000", resultMsg: "ok", raw: null,
      data: { itemList: [
        { itemCd: "RW2CTU0000001", itemClsCd: "9999999999", taxTyCd: "B" },  // mismatched class
        { itemCd: "RW2CTU0000050", itemClsCd: "5059690800", taxTyCd: "A" },  // rra-only
      ] },
    })),
    selectNotices: vi.fn(async () => ({ success: true, resultCd: "000", resultMsg: "ok", raw: null, data: { noticeList: [] } })),
  }
})

import {
  syncRraCodes,
  syncRraItemClasses,
  verifyCustomerTin,
  pullRraItems,
} from "../src/services/rra-master-data.service"
import { toRraReqDt } from "../src/services/vsdc-api.service"

beforeEach(() => {
  codeUpserts.length = 0
  classUpserts.length = 0
  cursorUpserts.length = 0
  customerUpdateManyArgs = null
})

describe("toRraReqDt", () => {
  it("formats yyyyMMddHHmmss", () => {
    expect(toRraReqDt(new Date("2026-08-30T09:05:07"))).toBe("20260830090507")
  })
})

describe("syncRraCodes (§59)", () => {
  it("caches every code from every class and advances the cursor", async () => {
    const out = await syncRraCodes(1)
    expect(out.ok).toBe(true)
    expect(out.upserted).toBe(3)
    expect(codeUpserts.map((u) => u.create.cd).sort()).toEqual(["01", "06", "B"])
    expect(codeUpserts[0].where.organizationId_cdCls_cd).toEqual({ organizationId: 1, cdCls: "07", cd: "01" })
    expect(cursorUpserts.at(-1).create.resource).toBe("codes")
  })
})

describe("syncRraItemClasses (§61)", () => {
  it("caches the classification list", async () => {
    const out = await syncRraItemClasses(1)
    expect(out.ok).toBe(true)
    expect(out.upserted).toBe(1)
    expect(classUpserts[0].create.itemClsCd).toBe("5059690800")
  })
})

describe("verifyCustomerTin (§62)", () => {
  it("rejects a non-9-digit TIN without calling RRA", async () => {
    const r = await verifyCustomerTin(1, "123")
    expect(r.found).toBe(false)
    expect(r.error).toMatch(/9 digits/)
  })

  it("returns the RRA taxpayer name and stamps the customer row", async () => {
    const r = await verifyCustomerTin(1, "100000001", { customerId: 42 })
    expect(r.found).toBe(true)
    expect(r.taxprNm).toBe("REAL TAXPAYER LTD")
    expect(customerUpdateManyArgs.where).toEqual({ id: 42, organizationId: 1 })
    expect(customerUpdateManyArgs.data.rraVerifiedName).toBe("REAL TAXPAYER LTD")
  })
})

describe("pullRraItems (§64)", () => {
  it("diffs the RRA item registry against the local catalog", async () => {
    const r = await pullRraItems(1)
    expect(r.ok).toBe(true)
    expect(r.diff.rraOnly.map((i) => i.itemCd)).toEqual(["RW2CTU0000050"])
    expect(r.diff.localOnly).toEqual([
      { id: 2, name: "Orphan", itemCd: "RW2CTU0000099", ebmSyncStatus: "PENDING" },
    ])
    expect(r.diff.mismatched).toEqual([
      { productId: 1, productName: "Widget", itemCd: "RW2CTU0000001", field: "itemClsCd", rra: "9999999999", local: "5059690800" },
    ])
  })
})

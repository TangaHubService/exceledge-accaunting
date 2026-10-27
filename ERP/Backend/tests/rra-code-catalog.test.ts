import { describe, expect, it, vi, beforeEach } from "vitest"

const codeRows: any[] = []

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    rraCode: {
      findMany: vi.fn(async ({ where }: any) => codeRows.filter((r) => r.cdCls === where.cdCls && r.useYn === 'Y')),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.organizationId_cdCls_cd
        return codeRows.find((r) => r.organizationId === key.organizationId && r.cdCls === key.cdCls && r.cd === key.cd) ?? null
      }),
      count: vi.fn(async () => codeRows.length),
    },
  },
}))

import {
  RRA_CD_CLS,
  parseRraCodeRate,
  getTaxationTypes,
  getTaxRateForCode,
  getTaxRatesBySlot,
  getTourismTaxRate,
  getCountryCodes,
  isCachedCountryCode,
  isCachedTaxCode,
  getRraCodeCatalog,
  getRefundReasonCodesForOrg,
  validateRefundReasonCode,
  DEFAULT_RFD_RSN_CD,
} from "../src/services/rra-code.service"

beforeEach(() => {
  codeRows.length = 0
  codeRows.push(
    { organizationId: 1, cdCls: RRA_CD_CLS.TAXATION_TYPE, cd: 'A', cdNm: 'A-EX', cdDesc: 'A-EX', userDfnCd1: '0', useYn: 'Y', srtOrd: 1 },
    { organizationId: 1, cdCls: RRA_CD_CLS.TAXATION_TYPE, cd: 'B', cdNm: 'B-18.00%', cdDesc: 'B-18.00%', userDfnCd1: '18', useYn: 'Y', srtOrd: 2 },
    { organizationId: 1, cdCls: RRA_CD_CLS.TAXATION_TYPE, cd: 'C', cdNm: 'C', cdDesc: 'C', userDfnCd1: '0', useYn: 'Y', srtOrd: 3 },
    { organizationId: 1, cdCls: RRA_CD_CLS.TAXATION_TYPE, cd: 'D', cdNm: 'D', cdDesc: 'D', userDfnCd1: '0', useYn: 'Y', srtOrd: 4 },
    { organizationId: 1, cdCls: RRA_CD_CLS.TOURISM_TAX_CATEGORY, cd: 'TT', cdNm: 'TT-3%', cdDesc: 'Tourism Tax - 3%', userDfnCd1: '3', useYn: 'Y', srtOrd: 1 },
    { organizationId: 1, cdCls: RRA_CD_CLS.TOURISM_TAX_TYPE, cd: '1', cdNm: 'TT', cdDesc: null, userDfnCd1: null, useYn: 'Y', srtOrd: 1 },
    { organizationId: 1, cdCls: RRA_CD_CLS.COUNTRY, cd: 'RW', cdNm: 'RWANDA', cdDesc: null, userDfnCd1: null, useYn: 'Y', srtOrd: 193 },
    { organizationId: 1, cdCls: RRA_CD_CLS.COUNTRY, cd: 'KE', cdNm: 'KENYA', cdDesc: null, userDfnCd1: null, useYn: 'Y', srtOrd: 80 },
    { organizationId: 1, cdCls: RRA_CD_CLS.PROPERTY_TYPE, cd: '01', cdNm: 'Hotel', cdDesc: null, userDfnCd1: null, useYn: 'Y', srtOrd: 1 },
    { organizationId: 1, cdCls: RRA_CD_CLS.REFUND_REASON, cd: '06', cdNm: 'Refund', cdDesc: null, userDfnCd1: null, useYn: 'Y', srtOrd: 6 },
    { organizationId: 1, cdCls: RRA_CD_CLS.REFUND_REASON, cd: '13', cdNm: 'Other reason', cdDesc: null, userDfnCd1: null, useYn: 'Y', srtOrd: 13 },
  )
})

describe("live VSDC code-class IDs", () => {
  it("maps tax types, countries, tourism, and property to the sandbox class numbers", () => {
    expect(RRA_CD_CLS.TAXATION_TYPE).toBe('04')
    expect(RRA_CD_CLS.COUNTRY).toBe('05')
    expect(RRA_CD_CLS.TOURISM_TAX_CATEGORY).toBe('03')
    expect(RRA_CD_CLS.TOURISM_TAX_TYPE).toBe('08')
    expect(RRA_CD_CLS.PROPERTY_TYPE).toBe('02')
    expect(RRA_CD_CLS.PAYMENT_TYPE).toBe('07')
    expect(RRA_CD_CLS.QUANTITY_UNIT).toBe('10')
    expect(RRA_CD_CLS.PACKING_UNIT).toBe('17')
    expect(RRA_CD_CLS.REFUND_REASON).toBe('32')
  })
})

describe("parseRraCodeRate", () => {
  it("prefers userDfnCd1 then a percent in the name", () => {
    expect(parseRraCodeRate({ userDfnCd1: '18', cdNm: 'B-18.00%' })).toBe(18)
    expect(parseRraCodeRate({ userDfnCd1: '3', cdNm: 'TT-3%' })).toBe(3)
    expect(parseRraCodeRate({ userDfnCd1: null, cdNm: 'B-18.00%' })).toBe(18)
    expect(parseRraCodeRate({ userDfnCd1: null, cdNm: 'A-EX' })).toBe(0)
  })
})

describe("cached taxation types (class 04)", () => {
  it("reads rates from the selectCodes cache instead of hardcoded 18", async () => {
    const types = await getTaxationTypes(1)
    expect(types.map((t) => t.code)).toEqual(['A', 'B', 'C', 'D'])
    expect(await getTaxRateForCode(1, 'B')).toBe(18)
    expect(await getTaxRateForCode(1, 'A')).toBe(0)
    const slots = await getTaxRatesBySlot(1)
    expect(slots).toEqual([0, 18, 0, 0])
    expect(await isCachedTaxCode(1, 'B')).toBe(true)
    expect(await isCachedTaxCode(1, 'Z')).toBe(false)
  })
})

describe("cached countries / tourism / property", () => {
  it("serves countries from class 05 and does not invent RW when the cache has no match", async () => {
    const countries = await getCountryCodes(1)
    expect(countries.some((c) => c.code === 'RW')).toBe(true)
    expect(await isCachedCountryCode(1, 'KE')).toBe(true)
    expect(await isCachedCountryCode(1, 'XX')).toBe(false)
    expect(await getTourismTaxRate(1)).toBe(3)
    const catalog = await getRraCodeCatalog(1)
    expect(catalog.propertyTypes).toEqual([{ code: '01', label: 'Hotel' }])
    expect(catalog.tourismTaxCategories[0]).toEqual({ code: 'TT', label: 'TT-3%', rate: 3 })
  })
})

describe("refund reasons from class 32", () => {
  it("uses the cached list when present", async () => {
    const reasons = await getRefundReasonCodesForOrg(1)
    expect(reasons.map((r) => r.code)).toEqual(['06', '13'])
    expect(validateRefundReasonCode('06', reasons)).toBe('06')
    expect(() => validateRefundReasonCode('99', reasons)).toThrow(/Invalid RRA refund reason/)
    expect(DEFAULT_RFD_RSN_CD).toBe('06')
  })
})

describe("empty cache last-resort (no invented RW, rates still usable)", () => {
  it("does not invent a country and still returns last-resort tax/tourism rates", async () => {
    codeRows.length = 0
    expect(await getCountryCodes(1)).toEqual([])
    expect(await isCachedCountryCode(1, 'RW')).toBe(true) // ISO-2 accepted until class 05 syncs
    expect(await getTaxationTypes(1)).toEqual([])
    expect(await getTaxRateForCode(1, 'B')).toBe(18)
    expect(await getTaxRatesBySlot(1)).toEqual([0, 18, 0, 0])
    expect(await getTourismTaxRate(1)).toBe(3)
    const catalog = await getRraCodeCatalog(1)
    expect(catalog.countries).toEqual([])
    expect(catalog.taxTypes).toEqual([])
    expect(catalog.cachedCount).toBe(0)
  })
})

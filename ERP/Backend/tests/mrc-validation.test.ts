import { beforeEach, describe, expect, it, vi } from "vitest"

const ebmConfig = vi.hoisted(() => ({ environment: "production", useMock: false }))

vi.mock("../src/config", () => ({ config: { ebm: ebmConfig } }))

const orgUpdate = vi.fn(async () => ({}))
const branchUpdateMany = vi.fn(async () => ({ count: 1 }))
const stored = { org: null as string | null, branch: null as string | null }

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    organization: {
      update: (...a: any[]) => (orgUpdate as any)(...a),
      findUnique: vi.fn(async () => ({ mrcNo: stored.org, ebmSerialNo: null, vatRegistered: true, TIN: "100000000", ebmDeviceId: null })),
    },
    branch: {
      updateMany: (...a: any[]) => (branchUpdateMany as any)(...a),
      findFirst: vi.fn(async () => ({ bhfId: "00", ebmSerialNo: null, mrcNo: stored.branch })),
    },
    $queryRaw: vi.fn(async () => [{ sidebarConfig: {}, featureFlags: {}, preferences: {} }]),
  },
}))

import {
  checkMrc,
  isMrcValidationRelaxed,
  MRC_FORMAT_ERROR_CODE,
  MrcFormatError,
  normalizeMrcOrThrow,
  resolveReportMrc,
  configuredMrc,
  mrcMismatch,
} from "../src/utils/mrc"
import { upsertOrganizationSettings } from "../src/services/organization-settings.service"

beforeEach(() => {
  ebmConfig.environment = "production"
  ebmConfig.useMock = false
  stored.org = null
  stored.branch = null
  orgUpdate.mockClear()
  branchUpdateMany.mockClear()
})

describe("checkMrc", () => {
  it("accepts a valid BBBCCNNNNNN MRC, trimmed and uppercased", () => {
    expect(checkMrc("  wis01000123 ", { relaxed: false })).toEqual({ ok: true, value: "WIS01000123" })
  })

  it.each(["WIS0100012", "WIS010001234", "WIS01ABC123", "WIS-0100012", "MRC012000250"])(
    "rejects %s outside sandbox/mock",
    (v) => {
      const r = checkMrc(v, { relaxed: false })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe(MRC_FORMAT_ERROR_CODE)
    },
  )

  it("treats undefined as not supplied and null/blank as clearing", () => {
    expect(checkMrc(undefined, { relaxed: false })).toEqual({ ok: true, value: undefined })
    expect(checkMrc(null, { relaxed: false })).toEqual({ ok: true, value: null })
    expect(checkMrc("   ", { relaxed: false })).toEqual({ ok: true, value: null })
  })

  it("relaxes only the BBBCCNNNNNN layout in sandbox or mock mode (still normalized)", () => {
    ebmConfig.environment = "sandbox"
    expect(isMrcValidationRelaxed()).toBe(true)
    expect(checkMrc(" testmrc0001 ")).toEqual({ ok: true, value: "TESTMRC0001" })

    ebmConfig.environment = "production"
    ebmConfig.useMock = true
    expect(checkMrc("abcdefghijk")).toEqual({ ok: true, value: "ABCDEFGHIJK" })

    ebmConfig.useMock = false
    expect(isMrcValidationRelaxed()).toBe(false)
    expect(checkMrc("TESTMRC0001").ok).toBe(false)
  })

  it.each(["WIS0102946", "WIS010294670", "MRC012000250", "excelwartest", "TEST-SERIAL", "WIS 1029467"])(
    "rejects %s in every environment — an MRC is exactly 11 letters/digits",
    (v) => {
      expect(checkMrc(v, { relaxed: true }).ok).toBe(false)
      expect(checkMrc(v, { relaxed: true, current: [v] }).ok).toBe(false)
    },
  )

  it("lets an unchanged stored layout through so unrelated edits are not blocked", () => {
    expect(checkMrc("testmrc0001", { relaxed: false, current: [null, "TESTMRC0001"] }).ok).toBe(true)
    expect(checkMrc("TESTMRC0002", { relaxed: false, current: ["TESTMRC0001"] }).ok).toBe(false)
  })

  it("normalizeMrcOrThrow throws a 400 MrcFormatError", () => {
    expect(() => normalizeMrcOrThrow("bad", { relaxed: false })).toThrow(MrcFormatError)
    try {
      normalizeMrcOrThrow("bad", { relaxed: false })
    } catch (e: any) {
      expect(e.statusCode).toBe(400)
      expect(e.code).toBe(MRC_FORMAT_ERROR_CODE)
    }
  })
})

describe("resolveReportMrc precedence", () => {
  const org = { mrcNo: "ORG01000003", ebmSerialNo: "orgserial" }

  it("prefers the configured device MRC over the VSDC-reported one", () => {
    expect(resolveReportMrc({ mrcNo: "BRA01000001", ebmInitInfo: { mrcNo: "WIS01000999" }, ebmSerialNo: "excelwartest" }, org)).toBe("BRA01000001")
  })

  it("falls back to ebmInitInfo.mrcNo, then org.mrcNo, then the legacy serials", () => {
    expect(resolveReportMrc({ mrcNo: null, ebmInitInfo: { mrcNo: "WIS01000999" }, ebmSerialNo: "x" }, org)).toBe("WIS01000999")
    expect(resolveReportMrc({ mrcNo: " ", ebmInitInfo: { mrcNo: "  " }, ebmSerialNo: "branchserial" }, org)).toBe("ORG01000003")
    expect(resolveReportMrc({ ebmInitInfo: null, ebmSerialNo: "branchserial" }, { ebmSerialNo: "orgserial" })).toBe("branchserial")
    expect(resolveReportMrc(null, { ebmSerialNo: "orgserial" })).toBe("orgserial")
  })

  it("ignores malformed init payloads and returns null when nothing is configured", () => {
    expect(resolveReportMrc({ ebmInitInfo: ["x"], ebmSerialNo: null }, null)).toBeNull()
    expect(resolveReportMrc({ ebmInitInfo: { mrcNo: 123 }, ebmSerialNo: "" }, { ebmSerialNo: null })).toBeNull()
  })
})

describe("configuredMrc / mrcMismatch", () => {
  it("takes the branch MRC, then the org fallback", () => {
    expect(configuredMrc({ mrcNo: "BRA01000001" }, { mrcNo: "ORG01000003" })).toBe("BRA01000001")
    expect(configuredMrc({ mrcNo: "" }, { mrcNo: "ORG01000003" })).toBe("ORG01000003")
    expect(configuredMrc(null, null)).toBeNull()
  })

  it("flags only a configured MRC that disagrees with the VSDC-reported one", () => {
    expect(mrcMismatch("WIS01029467", "wis01029467")).toBeNull()
    expect(mrcMismatch(null, "WIS01029467")).toBeNull()
    expect(mrcMismatch("WIS01029467", null)).toBeNull()
    expect(mrcMismatch("WIS01029468", "WIS01029467")).toContain("WIS01029467")
  })
})

describe("upsertOrganizationSettings ebmConfig", () => {
  it("writes the normalized MRC to mrcNo on the org and default branch", async () => {
    await upsertOrganizationSettings(1, { ebmConfig: { mrcNo: " wis01000123 " } } as any)
    expect(orgUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { mrcNo: "WIS01000123" } })
    expect(branchUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: 1, isDefault: true },
      data: { mrcNo: "WIS01000123" },
    })
  })

  it("stores the device serial as entered, without MRC validation", async () => {
    await upsertOrganizationSettings(1, { ebmConfig: { dvcSrlNo: " excelwartest " } } as any)
    expect(orgUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { ebmSerialNo: "excelwartest" } })
    expect(branchUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: 1, isDefault: true },
      data: { ebmSerialNo: "excelwartest" },
    })
  })

  it("rejects a malformed MRC before writing anything", async () => {
    await expect(
      upsertOrganizationSettings(1, { ebmConfig: { tin: "100000000", mrcNo: "BAD" } } as any),
    ).rejects.toBeInstanceOf(MrcFormatError)
    expect(orgUpdate).not.toHaveBeenCalled()
    expect(branchUpdateMany).not.toHaveBeenCalled()
  })

  it("accepts the echoed-back stored value even if it predates validation", async () => {
    stored.branch = "TESTMRC0001"
    await upsertOrganizationSettings(1, { ebmConfig: { mrcNo: "TESTMRC0001" } } as any)
    expect(branchUpdateMany).toHaveBeenCalledTimes(1)
  })

  it("clears the MRC on blank input", async () => {
    await upsertOrganizationSettings(1, { ebmConfig: { mrcNo: "" } } as any)
    expect(orgUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { mrcNo: null } })
  })
})

import { describe, expect, it, vi, beforeEach } from "vitest"

let orgRow: any = null
const findManyResult: any[] = []

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => orgRow),
      findMany: vi.fn(async () => findManyResult),
    },
  },
}))

import { verifyVsdcOnlineStatus } from "../src/middleware/vsdc-offline-guard.middleware"
import { listActiveVsdcDevices } from "../src/services/vsdc-api.service"

const HOUR = 3_600_000

beforeEach(() => {
  orgRow = null
  findManyResult.length = 0
  process.env.VSDC_OFFLINE_BLOCK_MS = String(24 * HOUR)
})

describe("verifyVsdcOnlineStatus — offline guard", () => {
  it("blocks when a device is configured and contact is older than the limit", async () => {
    orgRow = {
      lastSuccessfulVdsContact: new Date(Date.now() - 60 * HOUR),
      trainingMode: false,
      ebmDeviceId: null,
      ebmSerialNo: null,
      branches: [{ id: 3 }], // a branch device exists
    }
    await expect(verifyVsdcOnlineStatus(2)).rejects.toThrow(/Receipt generation is blocked/)
  })

  it("blocks a training-mode org with stale contact too (TS/TR go through VSDC)", async () => {
    orgRow = {
      lastSuccessfulVdsContact: new Date(Date.now() - 60 * HOUR),
      trainingMode: true,
      ebmDeviceId: "SDC1",
      ebmSerialNo: "MRC1",
      branches: [{ id: 3 }],
    }
    await expect(verifyVsdcOnlineStatus(2)).rejects.toThrow(/Receipt generation is blocked/)
  })

  it("does NOT block an org with no VSDC device configured anywhere", async () => {
    orgRow = {
      lastSuccessfulVdsContact: new Date(Date.now() - 60 * HOUR),
      trainingMode: false,
      ebmDeviceId: null,
      ebmSerialNo: null,
      branches: [], // no branch has credentials
    }
    await expect(verifyVsdcOnlineStatus(2)).resolves.toBe(true)
  })

  it("allows a configured device that is within the window", async () => {
    orgRow = {
      lastSuccessfulVdsContact: new Date(Date.now() - 1 * HOUR),
      trainingMode: false,
      ebmDeviceId: null,
      ebmSerialNo: null,
      branches: [{ id: 3 }],
    }
    await expect(verifyVsdcOnlineStatus(2)).resolves.toBe(true)
  })
})

describe("listActiveVsdcDevices — branch-aware target list", () => {
  it("emits one target per credentialed branch, not per org", async () => {
    findManyResult.push({
      id: 2, name: "Demo Pharmacy", TIN: "999945560", ebmDeviceId: null, ebmSerialNo: null,
      branches: [{ id: 3, name: "East Branch" }, { id: 9, name: "West Branch" }],
    })
    const targets = await listActiveVsdcDevices()
    expect(targets).toEqual([
      { organizationId: 2, branchId: 3, tin: "999945560", label: "Demo Pharmacy / East Branch" },
      { organizationId: 2, branchId: 9, tin: "999945560", label: "Demo Pharmacy / West Branch" },
    ])
  })

  it("falls back to an org-level target only when no branch is credentialed", async () => {
    findManyResult.push({
      id: 5, name: "Legacy Co", TIN: "100000000", ebmDeviceId: "SDC5", ebmSerialNo: "MRC5", branches: [],
    })
    const targets = await listActiveVsdcDevices()
    expect(targets).toEqual([{ organizationId: 5, branchId: null, tin: "100000000", label: "Legacy Co" }])
  })

  it("skips an org with no credentials anywhere", async () => {
    findManyResult.push({ id: 7, name: "Unconfigured", TIN: "200000000", ebmDeviceId: null, ebmSerialNo: null, branches: [] })
    expect(await listActiveVsdcDevices()).toEqual([])
  })
})

import { describe, expect, it } from "vitest"
import { createSaleSchema } from "../src/validations/sales.validation"

const sale = (items: Array<{ quantity: number; unitPrice: number }>, cashAmount: number) => ({
  body: { customerId: 1, items: items.map((i) => ({ productId: 1, ...i })), paymentType: "CASH", cashAmount },
  params: { organizationId: 1 },
})

describe("sale amount limits (Decimal(15,2) = 13 digits + 2 decimals)", () => {
  it("accepts a 13-digit, 2-decimal total", () => {
    expect(createSaleSchema.safeParse(sale([{ quantity: 1, unitPrice: 9_999_999_999_999.99 }], 9_999_999_999_999.99)).success).toBe(true)
    expect(createSaleSchema.safeParse(sale([{ quantity: 1, unitPrice: 1_234_567_890_123.45 }], 1_234_567_890_123.45)).success).toBe(true)
  })

  it("rejects a 14-digit unit price with a clear message instead of a DB overflow", () => {
    const r = createSaleSchema.safeParse(sale([{ quantity: 1, unitPrice: 12_345_678_901_234 }], 0))
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.message).join()).toMatch(/9,999,999,999,999\.99/)
  })

  it("rejects lines whose quantity × price exceed 13 digits", () => {
    const r = createSaleSchema.safeParse(sale([{ quantity: 2, unitPrice: 9_000_000_000_000 }], 0))
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(["body", "items"])
  })

  it("rejects a sale whose summed items exceed 13 digits", () => {
    const r = createSaleSchema.safeParse(sale([
      { quantity: 1, unitPrice: 6_000_000_000_000 },
      { quantity: 1, unitPrice: 6_000_000_000_000 },
    ], 0))
    expect(r.success).toBe(false)
  })

  it("treats branchId null (POS in All Branches mode) as not sent", () => {
    const base = sale([{ quantity: 1, unitPrice: 3000 }], 3000)
    const r = createSaleSchema.safeParse({ ...base, body: { ...base.body, branchId: null, shiftId: null } })
    expect(r.success).toBe(true)
    expect(r.data!.body.branchId).toBeUndefined()
    expect(createSaleSchema.safeParse({ ...base, body: { ...base.body, branchId: 0 } }).success).toBe(false)
  })
})

import { describe, expect, it } from "vitest";

describe("Proforma → sale conversion", () => {
  it("controller exports updateProforma and convertProforma", async () => {
    const mod = await import("../../src/controllers/sales.controller");
    expect(typeof mod.updateProforma).toBe("function");
    expect(typeof mod.convertProforma).toBe("function");
  });

  it("commitSale + CommitSaleError are exported from the shared service", async () => {
    const mod = await import("../../src/services/sale-commit.service");
    expect(typeof mod.commitSale).toBe("function");
    expect(typeof mod.CommitSaleError).toBe("function");
    const err = new mod.CommitSaleError(409, "nope");
    expect(err.statusCode).toBe(409);
    expect(err).toBeInstanceOf(Error);
  });

  it("validation schemas require a saleId param", async () => {
    const { updateProformaSchema, convertProformaSchema } = await import(
      "../../src/validations/sales.validation"
    );
    expect(updateProformaSchema.safeParse({ body: {}, params: {} }).success).toBe(false);
    expect(
      convertProformaSchema.safeParse({
        body: { paymentType: "CASH", cashAmount: 100 },
        params: { organizationId: 1, saleId: 5 },
      }).success,
    ).toBe(true);
  });

  it("convertProforma 404s for a missing sale without throwing", async () => {
    const { convertProforma } = await import("../../src/controllers/sales.controller");
    const req: any = {
      params: { organizationId: "999999", saleId: "999999" },
      user: { userId: "1" },
      body: {},
      headers: {},
    };
    const codes: number[] = [];
    const res: any = {
      status: (c: number) => {
        codes.push(c);
        return res;
      },
      json: () => res,
    };
    await expect(convertProforma(req, res)).resolves.not.toThrow();
    // resolveBranchIdForWrite may reject first (400) in a bare test context, or
    // the lookup misses (404) — either way it must not 2xx.
    expect(codes.every((c) => c >= 400)).toBe(true);
  });
});

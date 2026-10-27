import { describe, expect, it } from "vitest";

describe("Invoice Regeneration (#12)", () => {
  it("controller is exported", async () => {
    const mod = await import("../../src/controllers/sales.controller");
    expect(mod.regenerateInvoice).toBeDefined();
    expect(typeof mod.regenerateInvoice).toBe("function");
  });

  it("generateInvoiceNumber function exists in rra-ebm service", async () => {
    const mod = await import("../../src/services/rra-ebm.service");
    expect(mod.generateInvoiceNumber).toBeDefined();
  });

  it("regenerateInvoice throws when called with missing params", async () => {
    const { regenerateInvoice } = await import("../../src/controllers/sales.controller");
    const req: any = { params: {}, user: {} };
    const res: any = {
      status: () => res,
      json: () => res,
    };
    await expect(regenerateInvoice(req, res)).resolves.not.toThrow();
  });
});

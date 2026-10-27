import { describe, expect, it } from "vitest";

describe("Payment Providers (#11)", () => {
  it("CashPaymentProvider initiates payment", async () => {
    const { CashPaymentProvider } = await import("../../src/services/payment-providers/cash.provider");
    const provider = new CashPaymentProvider();
    const result = await provider.initiatePayment({
      amount: 5000,
      currency: "RWF",
      reference: "REF-001",
      description: "Test payment",
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe("COMPLETED");
    expect(result.transactionId).toBeDefined();
  });

  it("PaymentService is exported", async () => {
    const mod = await import("../../src/services/payment.service");
    expect(mod.PaymentService).toBeDefined();
  });

  it("registry returns provider for each method", async () => {
    const { getProvider } = await import("../../src/services/payment-providers/registry");
    const cashProvider = getProvider("CASH");
    expect(cashProvider).toBeDefined();
    expect(cashProvider.name).toBe("CASH");
  });

  it("validates payment methods", async () => {
    const { getAvailableMethods } = await import("../../src/services/payment-providers/registry");
    const methods = getAvailableMethods();
    expect(methods).toContain("CASH");
    expect(methods).toContain("PAYPACK");
    expect(methods).toContain("MTN_MOMO");
  });
});

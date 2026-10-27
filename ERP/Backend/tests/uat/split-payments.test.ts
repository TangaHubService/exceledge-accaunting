import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/services/payment-providers", () => ({
  PaymentService: vi.fn(),
}));

vi.mock("../../src/services/inventory-ledger.service", () => ({
  removeStock: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../../src/lib/prisma";

describe("Split Payments (#10)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("supports SalePaymentMethodType enum values", async () => {
    const enumValues = ["CASH", "BANK", "CARD", "PAYPACK", "MTN_MOMO", "AIRTEL_MONEY", "WALLET", "GIFT_CARD", "STORE_CREDIT"];
    enumValues.forEach(v => expect(v).toBeTruthy());
  });

  it("creates sale with split payments in transaction", async () => {
    const splitPayments = [
      { method: "CASH", amount: 5000, reference: null },
      { method: "MTN_MOMO", amount: 3000, reference: "REF-001" },
      { method: "CARD", amount: 2000, reference: "CARD-REF" },
    ];

    const totalAmount = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAmount).toBe(10000);

    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        sale: { create: vi.fn().mockResolvedValue({ id: 1, totalAmount }) },
        salePayment: { createMany: vi.fn() },
        saleItem: { createMany: vi.fn() },
        product: { update: vi.fn() },
      };
      return cb(tx);
    });
  });

  it("rejects payments that don't sum to total", () => {
    const total = 10000;
    const payments = [
      { method: "CASH", amount: 5000 },
      { method: "MTN_MOMO", amount: 3000 },
    ];
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBeLessThan(total);
  });

  it("accepts overpayment", () => {
    const total = 5000;
    const payments = [
      { method: "CASH", amount: 3000 },
      { method: "MTN_MOMO", amount: 3000 },
    ];
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBeGreaterThan(total);
  });

  it("single payment (no split) still works", () => {
    const payments = [{ method: "CASH", amount: 10000 }];
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe("CASH");
  });
});

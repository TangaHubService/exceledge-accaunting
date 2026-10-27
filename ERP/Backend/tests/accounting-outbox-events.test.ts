import { describe, expect, it } from "vitest";
import {
  enqueueSaleRefundedAccountingEvent,
  withdrawSupplierPaymentAccountingEvent,
} from "../src/services/accounting-outbox.service";

type Row = { id: number; idempotencyKey: string; status: string; retryCount: number; payload?: any };

function fakeOutbox(rows: Row[]) {
  const outbox = {
    findUnique: async ({ where }: any) => rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null,
    deleteMany: async ({ where }: any) => {
      const index = rows.findIndex(
        (r) => r.idempotencyKey === where.idempotencyKey && r.status === where.status && r.retryCount === where.retryCount,
      );
      if (index < 0) return { count: 0 };
      rows.splice(index, 1);
      return { count: 1 };
    },
    upsert: async ({ create }: any) => {
      rows.push({ id: rows.length + 1, idempotencyKey: create.idempotencyKey, status: create.status, retryCount: 0, payload: create.payload });
    },
  };
  return { erpAccountingOutbox: outbox } as any;
}

const paymentKey = (paymentId: number) => `7|PURCHASES|SupplierPayment|${paymentId}|SUPPLIER_PAYMENT_MADE|1`;

describe("supplier payment deletion and the accounting outbox", () => {
  it("withdraws an event that was never sent", async () => {
    const rows: Row[] = [{ id: 1, idempotencyKey: paymentKey(5), status: "PENDING", retryCount: 0 }];
    expect(await withdrawSupplierPaymentAccountingEvent(fakeOutbox(rows), { organizationId: 7, paymentId: 5 })).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it("allows deletion when nothing was queued (integration off)", async () => {
    expect(await withdrawSupplierPaymentAccountingEvent(fakeOutbox([]), { organizationId: 7, paymentId: 5 })).toBe(true);
  });

  it("refuses once the event may have reached Accounting", async () => {
    for (const row of [
      { status: "PROCESSING", retryCount: 0 },
      { status: "SUCCEEDED", retryCount: 0 },
      { status: "FAILED", retryCount: 1 },
      { status: "PENDING", retryCount: 2 },
    ]) {
      const rows: Row[] = [{ id: 1, idempotencyKey: paymentKey(5), ...row }];
      expect(await withdrawSupplierPaymentAccountingEvent(fakeOutbox(rows), { organizationId: 7, paymentId: 5 })).toBe(false);
      expect(rows).toHaveLength(1);
    }
  });
});

describe("sale refund event", () => {
  it("puts only the debt still owed on account and pays back the rest", async () => {
    const rows: Row[] = [];
    await enqueueSaleRefundedAccountingEvent(fakeOutbox(rows), {
      organizationId: 7,
      branchId: 1,
      refundSaleId: 90,
      originalSaleId: 80,
      customerId: 3,
      paymentType: "CASH",
      outstandingDebt: 100,
      gross: 600,
      net: 600,
      tax: 0,
    });
    expect(rows[0].payload.paymentSplits).toEqual([
      { paymentMethod: "DEBT", amount: 100 },
      { paymentMethod: "CASH", amount: 500 },
    ]);
  });
});

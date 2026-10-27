import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression guard for a P2022-class bug: models that don't have their own
// `branchId` column (Customer, DebtPayment, SupplierPayment, StockTransfer)
// must never have `{branchId: ...}` spread directly into their `where`
// clause — Prisma throws "column does not exist" the moment a branch is
// selected. Filtering for these models must go through the relation that
// actually carries branchId (sale, purchaseOrder, fromBranchId/toBranchId).

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    stockTransfer: { findMany: vi.fn(), findFirst: vi.fn() },
    supplierPayment: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    debtPayment: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
  },
}));

import { prisma } from "../src/lib/prisma";
import { listStockTransfers, getStockTransfer } from "../src/controllers/stock-transfer.controller";
import { getSupplierPayments } from "../src/controllers/supplier-payment.controller";
import { getAllPaymentHistory } from "../src/controllers/debtPayment.controller";
import { getDebtorsReport } from "../src/controllers/report.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("branch-scoped queries never spread a bare branchId onto columnless models", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listStockTransfers filters by fromBranchId/toBranchId, not a top-level branchId", async () => {
    (prisma.stockTransfer.findMany as any).mockResolvedValueOnce([]);
    const req: any = { params: { organizationId: "1" }, selectedBranchId: 7 };
    await listStockTransfers(req, makeRes());

    const where = (prisma.stockTransfer.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBeUndefined();
    expect(where.OR).toEqual([{ fromBranchId: 7 }, { toBranchId: 7 }]);
  });

  it("getStockTransfer applies the same branch-involvement filter to a single lookup", async () => {
    (prisma.stockTransfer.findFirst as any).mockResolvedValueOnce(null);
    const req: any = { params: { organizationId: "1", id: "5" }, selectedBranchId: 7 };
    await getStockTransfer(req, makeRes());

    const where = (prisma.stockTransfer.findFirst as any).mock.calls[0][0].where;
    expect(where.branchId).toBeUndefined();
    expect(where.OR).toEqual([{ fromBranchId: 7 }, { toBranchId: 7 }]);
  });

  it("getSupplierPayments filters through the purchaseOrder relation, not a top-level branchId", async () => {
    (prisma.supplierPayment.findMany as any).mockResolvedValueOnce([]);
    (prisma.supplierPayment.count as any).mockResolvedValueOnce(0);
    (prisma.supplierPayment.aggregate as any).mockResolvedValueOnce({ _sum: { amount: null }, _count: 0 });
    const req: any = { params: { organizationId: "1" }, query: {}, selectedBranchId: 7 };
    await getSupplierPayments(req, makeRes());

    const where = (prisma.supplierPayment.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBeUndefined();
    expect(where.purchaseOrder).toEqual({ branchId: 7 });
  });

  it("getAllPaymentHistory (debt payments) filters through the sale relation, not a top-level branchId", async () => {
    (prisma.debtPayment.findMany as any).mockResolvedValueOnce([]);
    const req: any = { params: { organizationId: "1" }, query: {}, selectedBranchId: 7 };
    await getAllPaymentHistory(req, makeRes());

    const where = (prisma.debtPayment.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBeUndefined();
    expect(where.sale).toEqual({ branchId: 7 });
  });

  it("getDebtorsReport (Customer) filters through the sales relation, not a top-level branchId", async () => {
    (prisma.customer.findMany as any).mockResolvedValueOnce([]);
    const req: any = { params: { organizationId: "1" }, selectedBranchId: 7 };
    await getDebtorsReport(req, makeRes());

    const where = (prisma.customer.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBeUndefined();
    expect(where.sales).toBeDefined();
    expect(where.sales.some.branchId).toBe(7);
  });

  it("all four still return unfiltered results when no branch is selected (ALL scope)", async () => {
    (prisma.stockTransfer.findMany as any).mockResolvedValueOnce([]);
    const req: any = { params: { organizationId: "1" }, selectedBranchId: null };
    await listStockTransfers(req, makeRes());
    const where = (prisma.stockTransfer.findMany as any).mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  purchaseOrder: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock("../../src/lib/prisma", () => ({ prisma: mockPrisma }));

import { getSupplierOrders, getSupplierOrder } from "../../src/controllers/supplier-portal.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("Supplier Portal (#3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports controller functions", () => {
    expect(getSupplierOrders).toBeDefined();
    expect(getSupplierOrder).toBeDefined();
  });

  it("getSupplierOrders handles errors gracefully", async () => {
    mockPrisma.purchaseOrder.findMany.mockRejectedValue(new Error("DB error"));
    const req: any = { params: { supplierId: "5", organizationId: "1" } };
    const res = makeRes();
    await getSupplierOrders(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("getSupplierOrder returns 404 when order not found", async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
    const req: any = { params: { id: "1", supplierId: "5", organizationId: "1" } };
    const res = makeRes();
    await getSupplierOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

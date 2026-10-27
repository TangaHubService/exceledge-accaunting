import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    supplier: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("../src/utils/auditLogger", () => {
  const purchaseOrders = vi.fn().mockResolvedValue(undefined);
  return { auditLogger: { purchaseOrders }, default: { purchaseOrders } };
});

import { prisma } from "../src/lib/prisma";
import { getSuppliers, getSupplier, createSupplier } from "../src/controllers/supplier.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("supplier visibility is organization-wide, not branch-scoped (Issue 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a newly created supplier even under an active branch filter with zero purchase orders", async () => {
    const newSupplier = { id: 42, name: "Acme", organizationId: 1, isActive: true };
    (prisma.supplier.findMany as any).mockResolvedValueOnce([newSupplier]);

    const req: any = {
      params: { organizationId: "1" },
      query: {},
      // Simulates a branch-restricted user (post branchAuth) — the supplier
      // has no purchase orders in this branch yet, which previously hid it.
      selectedBranchId: 7,
    };
    const res = makeRes();

    await getSuppliers(req, res);

    const whereArg = (prisma.supplier.findMany as any).mock.calls[0][0].where;
    expect(whereArg).toEqual({ organizationId: 1, isActive: true });
    expect(whereArg.purchaseOrders).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith([newSupplier]);
  });

  it("fetches a single newly created supplier by id under an active branch filter", async () => {
    const supplier = { id: 42, name: "Acme", organizationId: 1 };
    (prisma.supplier.findFirst as any).mockResolvedValueOnce(supplier);

    const req: any = {
      params: { organizationId: "1", id: "42" },
      selectedBranchId: 7,
    };
    const res = makeRes();

    await getSupplier(req, res);

    expect(prisma.supplier.findFirst).toHaveBeenCalledWith({ where: { id: 42, organizationId: 1 } });
    expect(res.json).toHaveBeenCalledWith(supplier);
  });

  it("returns 404 (not silently empty) for a supplier that truly doesn't exist in the org", async () => {
    (prisma.supplier.findFirst as any).mockResolvedValueOnce(null);

    const req: any = { params: { organizationId: "1", id: "999" } };
    const res = makeRes();

    await getSupplier(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("creates a supplier scoped to the organization and returns it immediately", async () => {
    const created = { id: 99, name: "Beta Co", organizationId: 1, email: "beta@co.com" };
    (prisma.supplier.create as any).mockResolvedValueOnce(created);

    const req: any = {
      params: { organizationId: "1" },
      body: { name: "Beta Co", email: "beta@co.com" },
    };
    const res = makeRes();

    await createSupplier(req, res);

    expect(prisma.supplier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Beta Co", email: "beta@co.com", organizationId: 1 }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });
});

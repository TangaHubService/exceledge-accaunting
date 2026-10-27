import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  purchaseOrder: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  purchaseOrderItem: { findMany: vi.fn() },
  supplier: { findFirst: vi.fn() },
  product: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("../../src/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("../../src/utils/auditLogger", () => ({
  auditLogger: { purchaseOrders: vi.fn().mockResolvedValue(undefined) },
  default: { purchaseOrders: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../src/services/email.service", () => ({
  emailService: {
    sendPurchaseOrderToSupplier: vi.fn().mockResolvedValue(undefined),
    sendPurchaseOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
    sendPurchaseOrderUpdatedNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/services/inventory-ledger.service", () => ({
  addStock: vi.fn().mockResolvedValue(undefined),
  removeStock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/services/notification.service", () => ({
  default: class { createNotification = vi.fn().mockResolvedValue(undefined); },
}));

import { emailService } from "../../src/services/email.service";
import { updatePurchaseOrder } from "../../src/controllers/purchaseOrder.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("PO Update Email (#1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when order not found", async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
    const req: any = {
      params: { organizationId: "1", id: "999" },
      user: { userId: 9 },
      body: { notes: "test" },
      selectedBranchId: 7,
    };
    const res = makeRes();
    await updatePurchaseOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when order is not in updatable status", async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 1, orderNumber: "PO-001", status: "COMPLETED",
      organizationId: 1, supplierId: 1, userId: 1,
      supplier: { name: "S" }, user: { email: "u@t.com" },
      organization: { name: "O" }, items: [],
    });
    const req: any = {
      params: { organizationId: "1", id: "1" },
      user: { userId: 9 },
      body: { notes: "test" },
      selectedBranchId: 7,
    };
    const res = makeRes();
    await updatePurchaseOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("sends updated email to supplier when order is updated", async () => {
    const existingOrder = {
      id: 1, orderNumber: "PO-001", status: "PENDING",
      totalAmount: 500, notes: "Old", expectedDate: null,
      supplierId: 5, userId: 9,
      supplier: { name: "Acme Supplies", email: "supplier@acme.com" },
      user: { email: "creator@example.com", name: "Creator" },
      organization: { name: "My Org", email: "org@test.com" },
      items: [{ id: 1, productId: 10, quantity: 5, unitPrice: 100, totalPrice: 500 }],
    };
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(existingOrder);
    mockPrisma.purchaseOrderItem.findMany.mockResolvedValue(existingOrder.items);
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        purchaseOrder: { update: vi.fn().mockResolvedValue({ ...existingOrder, notes: "Updated" }) },
        purchaseOrderItem: { deleteMany: vi.fn(), createMany: vi.fn() },
      };
      return cb(tx);
    });

    const req: any = {
      params: { organizationId: "1", id: "1" },
      user: { userId: 9, name: "Updater", email: "updater@example.com" },
      body: { notes: "Updated" },
      selectedBranchId: 7,
    };
    const res = makeRes();
    await updatePurchaseOrder(req, res);

    expect(emailService.sendPurchaseOrderToSupplier).toHaveBeenCalledTimes(1);
    expect(emailService.sendPurchaseOrderUpdatedNotification).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalled();
  });
});

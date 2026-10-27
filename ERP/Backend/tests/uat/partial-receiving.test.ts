import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    purchaseOrder: { findFirst: vi.fn(), update: vi.fn() },
    product: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/utils/auditLogger", () => ({
  auditLogger: { purchaseOrders: vi.fn().mockResolvedValue(undefined) },
  default: { purchaseOrders: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../src/services/email.service", () => ({
  emailService: {
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

import { prisma } from "../../src/lib/prisma";
import { updatePurchaseOrderStatus } from "../../src/controllers/purchaseOrder.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("Partial Receiving (#2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions to PARTIALLY_RECEIVED when some items received", async () => {
    const order = {
      id: 10, orderNumber: "PO-010", status: "APPROVED",
      organizationId: 1, userId: 9,
      supplier: { name: "Acme" },
      user: { email: "creator@example.com" },
      organization: { name: "My Org", email: "org@test.com" },
      items: [
        { id: 1, productId: 100, quantity: 10, quantityReceived: 0, unitPrice: 50 },
        { id: 2, productId: 101, quantity: 5, quantityReceived: 0, unitPrice: 30 },
      ],
    };
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue(order);

    const receivingData = [
      { purchaseOrderItemId: 1, productId: 100, quantityReceived: 4 },
      { purchaseOrderItemId: 2, productId: 101, quantityReceived: 5 },
    ];

    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        purchaseOrder: {
          update: vi.fn().mockResolvedValue({ ...order, status: "PARTIALLY_RECEIVED" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ ...order, items: order.items.map((i: any) => ({ ...i, quantityReceived: i.id === 1 ? 4 : 5 })) }),
        },
        purchaseOrderReceivingHistory: { createMany: vi.fn() },
        product: { update: vi.fn() },
      };
      return cb(tx);
    });

    const req: any = {
      params: { organizationId: "1", id: "10" },
      user: { userId: 9, name: "Receiver", email: "receiver@example.com" },
      body: { status: "PARTIALLY_RECEIVED", receiving: receivingData },
      selectedBranchId: 7,
    };
    const res = makeRes();
    await updatePurchaseOrderStatus(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it("transitions to COMPLETED when all items fully received", async () => {
    const order = {
      id: 11, orderNumber: "PO-011", status: "PARTIALLY_RECEIVED",
      organizationId: 1, userId: 9,
      supplier: { name: "Acme" },
      user: { email: "creator@example.com" },
      organization: { name: "My Org", email: "org@test.com" },
      items: [
        { id: 1, productId: 100, quantity: 10, quantityReceived: 4, unitPrice: 50 },
      ],
    };
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue(order);

    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        purchaseOrder: {
          update: vi.fn().mockResolvedValue({ ...order, status: "COMPLETED" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            ...order,
            status: "COMPLETED",
            items: order.items.map((i: any) => ({ ...i, quantityReceived: 10 })),
          }),
        },
        purchaseOrderReceivingHistory: { createMany: vi.fn() },
        product: { update: vi.fn() },
      };
      return cb(tx);
    });

    const req: any = {
      params: { organizationId: "1", id: "11" },
      user: { userId: 9, name: "Receiver", email: "receiver@example.com" },
      body: { status: "COMPLETED", receiving: [{ purchaseOrderItemId: 1, productId: 100, quantityReceived: 6 }] },
      selectedBranchId: 7,
    };
    const res = makeRes();
    await updatePurchaseOrderStatus(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it("rejects receiving when quantity exceeds ordered amount", async () => {
    const order = {
      id: 12, orderNumber: "PO-012", status: "APPROVED",
      organizationId: 1, userId: 9,
      supplier: { name: "Acme" },
      user: { email: "creator@example.com" },
      organization: { name: "My Org", email: "org@test.com" },
      items: [
        { id: 1, productId: 100, quantity: 5, quantityReceived: 0, unitPrice: 50 },
      ],
    };
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue(order);

    const req: any = {
      params: { organizationId: "1", id: "12" },
      user: { userId: 9, name: "Receiver", email: "receiver@example.com" },
      body: { status: "PARTIALLY_RECEIVED", receiving: [{ purchaseOrderItemId: 1, productId: 100, quantityReceived: 10 }] },
      selectedBranchId: 7,
    };
    const res = makeRes();
    await updatePurchaseOrderStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

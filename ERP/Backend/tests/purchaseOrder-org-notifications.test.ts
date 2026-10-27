import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    supplier: { findFirst: vi.fn() },
    product: { findMany: vi.fn() },
    purchaseOrder: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/utils/auditLogger", () => {
  const purchaseOrders = vi.fn().mockResolvedValue(undefined);
  return { auditLogger: { purchaseOrders }, default: { purchaseOrders } };
});

vi.mock("../src/services/email.service", () => ({
  emailService: {
    sendPurchaseOrderToSupplier: vi.fn().mockResolvedValue(undefined),
    sendPurchaseOrderCreatedNotification: vi.fn().mockResolvedValue(undefined),
    sendPurchaseOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
    sendPurchaseOrderUpdatedNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../src/services/inventory-ledger.service", () => ({
  addStock: vi.fn().mockResolvedValue(undefined),
  removeStock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/services/notification.service", () => {
  return {
    default: class {
      createNotification = vi.fn().mockResolvedValue(undefined);
    },
  };
});

import { prisma } from "../src/lib/prisma";
import { emailService } from "../src/services/email.service";
import {
  createPurchaseOrder,
  updatePurchaseOrderStatus,
} from "../src/controllers/purchaseOrder.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("Purchase Order creation sends an organization-configured notification email", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emails the organization's configured address (not a hardcoded one) when it is set", async () => {
    (prisma.supplier.findFirst as any).mockResolvedValueOnce({ id: 5 });
    (prisma.purchaseOrder.count as any).mockResolvedValueOnce(0);

    const createdOrder = {
      id: 1,
      orderNumber: "PO-123-1",
      totalAmount: 500,
      notes: null,
      expectedDate: null,
      createdAt: new Date("2026-07-13T10:00:00Z"),
      supplierId: 5,
      supplier: { name: "Acme Supplies", email: "supplier@acme.com" },
      items: [],
      organization: { name: "My Org", email: "org-configured@example.com" },
    };
    (prisma.purchaseOrder.create as any).mockResolvedValueOnce(createdOrder);

    const req: any = {
      params: { organizationId: "1" },
      user: { userId: 9, name: "Jane Creator", email: "jane@example.com" },
      body: { supplierId: 5, items: [], notes: undefined, expectedDate: undefined },
      selectedBranchId: 7,
    };
    const res = makeRes();

    await createPurchaseOrder(req, res);

    expect(emailService.sendPurchaseOrderCreatedNotification).toHaveBeenCalledTimes(1);
    const args = (emailService.sendPurchaseOrderCreatedNotification as any).mock.calls[0];
    expect(args[0]).toBe("org-configured@example.com");
    expect(args[0]).not.toBe("exceledgecpa@gmail.com");
    expect(args[1]).toBe("My Org");
    expect(args[2]).toBe("PO-123-1");
    expect(args[4]).toBe(500);
    expect(args[5]).toBe("Jane Creator");

    // Supplier notification must still fire too (additive, not a replacement)
    expect(emailService.sendPurchaseOrderToSupplier).toHaveBeenCalledTimes(1);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("logs a warning and does not crash or send when the organization has no configured email", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (prisma.supplier.findFirst as any).mockResolvedValueOnce({ id: 5 });
    (prisma.purchaseOrder.count as any).mockResolvedValueOnce(0);

    const createdOrder = {
      id: 2,
      orderNumber: "PO-123-2",
      totalAmount: 100,
      notes: null,
      expectedDate: null,
      createdAt: new Date(),
      supplierId: 5,
      supplier: { name: "Acme Supplies", email: "supplier@acme.com" },
      items: [],
      organization: { name: "My Org", email: null },
    };
    (prisma.purchaseOrder.create as any).mockResolvedValueOnce(createdOrder);

    const req: any = {
      params: { organizationId: "1" },
      user: { userId: 9, name: "Jane Creator", email: "jane@example.com" },
      body: { supplierId: 5, items: [], notes: undefined, expectedDate: undefined },
      selectedBranchId: 7,
    };
    const res = makeRes();

    await createPurchaseOrder(req, res);

    expect(emailService.sendPurchaseOrderCreatedNotification).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    warnSpy.mockRestore();
  });
});

describe("Purchase Order status update sends an organization-configured notification email", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emails the organization's configured address on status change, alongside the existing creator email", async () => {
    const order = {
      id: 10,
      orderNumber: "PO-999-1",
      status: "PENDING",
      organizationId: 1,
      userId: 9,
      supplier: { name: "Acme Supplies" },
      user: { email: "creator@example.com" },
      organization: { name: "My Org", email: "org-configured@example.com" },
    };
    (prisma.purchaseOrder.findFirst as any).mockResolvedValueOnce(order);

    (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => {
      const tx = {
        purchaseOrder: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ ...order, items: [] }),
        },
      };
      return cb(tx);
    });

    const req: any = {
      params: { organizationId: "1", id: "10" },
      user: { userId: 9, name: "Jane Approver", email: "jane@example.com" },
      body: { status: "APPROVED" },
      selectedBranchId: 7,
    };
    const res = makeRes();

    await updatePurchaseOrderStatus(req, res);

    expect(emailService.sendPurchaseOrderStatusUpdate).toHaveBeenCalledTimes(1);
    expect(emailService.sendPurchaseOrderUpdatedNotification).toHaveBeenCalledTimes(1);
    const args = (emailService.sendPurchaseOrderUpdatedNotification as any).mock.calls[0];
    expect(args[0]).toBe("org-configured@example.com");
    expect(args[1]).toBe("My Org");
    expect(args[2]).toBe("PO-999-1");
    expect(args[4]).toBe("Jane Approver");
    expect(args[6]).toBe("APPROVED");
    expect(args[7]).toContain("PENDING");
    expect(args[7]).toContain("APPROVED");

    expect(res.json).toHaveBeenCalled();
  });

  it("logs a warning and still succeeds when the organization has no configured email", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const order = {
      id: 11,
      orderNumber: "PO-999-2",
      status: "PENDING",
      organizationId: 1,
      userId: 9,
      supplier: { name: "Acme Supplies" },
      user: { email: "creator@example.com" },
      organization: { name: "My Org", email: null },
    };
    (prisma.purchaseOrder.findFirst as any).mockResolvedValueOnce(order);

    (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => {
      const tx = {
        purchaseOrder: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ ...order, items: [] }),
        },
      };
      return cb(tx);
    });

    const req: any = {
      params: { organizationId: "1", id: "11" },
      user: { userId: 9, name: "Jane Approver", email: "jane@example.com" },
      body: { status: "REJECTED" },
      selectedBranchId: 7,
    };
    const res = makeRes();

    await updatePurchaseOrderStatus(req, res);

    expect(emailService.sendPurchaseOrderUpdatedNotification).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

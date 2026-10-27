import type { Response } from "express";
import { prisma } from "../lib/prisma";
import type { BranchAuthRequest } from "../middleware/branchAuth.middleware";
import { addStock, removeStock } from "../services/inventory-ledger.service";
import { success, error as apiError } from "../utils/apiResponse";

// StockTransfer spans two branches (fromBranchId/toBranchId), so it can't use
// the generic single-column BRANCH_AWARE_MODELS auto-injection — a transfer
// "belongs" to a branch if that branch is on either side of it.
function branchInvolvementFilter(req: BranchAuthRequest) {
  const id = req.selectedBranchId;
  if (id !== null && id !== undefined) {
    return { OR: [{ fromBranchId: id }, { toBranchId: id }] };
  }
  const ids = req.selectedBranchIds;
  if (ids && ids.length > 0) {
    return { OR: [{ fromBranchId: { in: ids } }, { toBranchId: { in: ids } }] };
  }
  return {};
}

export const listStockTransfers = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const transfers = await prisma.stockTransfer.findMany({
      where: { organizationId, ...branchInvolvementFilter(req) },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
        fromBranch: true,
        toBranch: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(success(transfers));
  } catch (e: any) {
    console.error("[listStockTransfers]", e);
    res.status(500).json(apiError("Failed to list stock transfers"));
  }
};

export const getStockTransfer = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const t = await prisma.stockTransfer.findFirst({
      where: { id, organizationId, ...branchInvolvementFilter(req) },
      include: {
        items: { include: { product: true } },
        fromBranch: true,
        toBranch: true,
      },
    });
    if (!t) return res.status(404).json(apiError("Stock transfer not found"));
    res.json(success(t));
  } catch (e: any) {
    console.error("[getStockTransfer]", e);
    res.status(500).json(apiError("Failed to get stock transfer"));
  }
};

export const createStockTransfer = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(String(req.user?.userId));
    const { fromBranchId, toBranchId, notes, items } = req.body;

    if (!fromBranchId || !toBranchId || parseInt(fromBranchId) === parseInt(toBranchId)) {
      return res.status(400).json(apiError("fromBranchId and toBranchId must differ"));
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json(apiError("items array required"));
    }

    const fromId = parseInt(fromBranchId);
    const toId = parseInt(toBranchId);
    const [fromB, toB] = await Promise.all([
      prisma.branch.findFirst({ where: { id: fromId, organizationId, status: "ACTIVE" } }),
      prisma.branch.findFirst({ where: { id: toId, organizationId, status: "ACTIVE" } }),
    ]);
    if (!fromB || !toB) {
      return res.status(400).json(apiError("Invalid or inactive branch"));
    }

    const productIds = items.map((i: { productId: number }) => parseInt(String(i.productId)));
    if (productIds.some((id: number) => Number.isNaN(id))) {
      return res.status(400).json(apiError("Invalid product in items"));
    }
    const validProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true },
    });
    if (validProducts.length !== new Set(productIds).size) {
      return res.status(400).json(apiError("One or more products were not found"));
    }

    const transfer = await prisma.stockTransfer.create({
      data: {
        organizationId,
        fromBranchId: fromId,
        toBranchId: toId,
        notes: notes ?? null,
        requestedById: userId,
        items: {
          create: items.map((i: { productId: number; quantity: number }) => ({
            productId: parseInt(String(i.productId)),
            quantity: parseInt(String(i.quantity)),
          })),
        },
      },
      include: { items: true, fromBranch: true, toBranch: true },
    });

    res.status(201).json(success(transfer));
  } catch (e: any) {
    console.error("[createStockTransfer]", e);
    res.status(500).json(apiError(e.message || "Failed to create stock transfer"));
  }
};

export const approveStockTransfer = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const userId = parseInt(String(req.user?.userId));

    const t = await prisma.stockTransfer.findFirst({ where: { id, organizationId } });
    if (!t) return res.status(404).json(apiError("Stock transfer not found"));
    if (t.status !== "PENDING") {
      return res.status(400).json(apiError("Only PENDING transfers can be approved"));
    }

    const updated = await prisma.stockTransfer.update({
      where: { id },
      data: { status: "APPROVED", approvedById: userId },
    });
    res.json(success(updated));
  } catch (e: any) {
    console.error("[approveStockTransfer]", e);
    res.status(500).json(apiError("Failed to approve stock transfer"));
  }
};

export const rejectStockTransfer = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);

    const t = await prisma.stockTransfer.findFirst({ where: { id, organizationId } });
    if (!t) return res.status(404).json(apiError("Stock transfer not found"));
    if (t.status !== "PENDING") {
      return res.status(400).json(apiError("Only PENDING transfers can be rejected"));
    }

    const updated = await prisma.stockTransfer.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    res.json(success(updated));
  } catch (e: any) {
    console.error("[rejectStockTransfer]", e);
    res.status(500).json(apiError("Failed to reject stock transfer"));
  }
};

export const completeStockTransfer = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const userId = parseInt(String(req.user?.userId));

    const t = await prisma.stockTransfer.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!t) return res.status(404).json(apiError("Stock transfer not found"));
    if (t.status !== "APPROVED") {
      return res.status(400).json(apiError("Only APPROVED transfers can be completed"));
    }

    await prisma.$transaction(async (tx) => {
      for (const item of t.items) {
        await removeStock({
          organizationId,
          productId: item.productId,
          userId,
          quantity: item.quantity,
          movementType: "TRANSFER_OUT",
          branchId: t.fromBranchId,
          reference: `ST-${t.id}`,
          referenceType: "STOCK_TRANSFER",
          note: `Stock transfer #${t.id} → branch ${t.toBranchId}`,
          tx,
        });
        await addStock({
          organizationId,
          productId: item.productId,
          userId,
          quantity: item.quantity,
          movementType: "TRANSFER_IN",
          branchId: t.toBranchId,
          reference: `ST-${t.id}`,
          referenceType: "STOCK_TRANSFER",
          note: `Stock transfer #${t.id} ← branch ${t.fromBranchId}`,
          tx,
        });
      }
      await tx.stockTransfer.update({
        where: { id: t.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    });

    const done = await prisma.stockTransfer.findFirst({
      where: { id },
      include: { items: true, fromBranch: true, toBranch: true },
    });
    res.json(success(done));
  } catch (e: any) {
    console.error("[completeStockTransfer]", e);
    const msg = e?.message?.includes("Insufficient") ? e.message : "Failed to complete stock transfer";
    res.status(400).json(apiError(msg));
  }
};

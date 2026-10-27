"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeStockTransfer = exports.rejectStockTransfer = exports.approveStockTransfer = exports.createStockTransfer = exports.getStockTransfer = exports.listStockTransfers = void 0;
const prisma_1 = require("../lib/prisma");
const inventory_ledger_service_1 = require("../services/inventory-ledger.service");
const apiResponse_1 = require("../utils/apiResponse");
// StockTransfer spans two branches (fromBranchId/toBranchId), so it can't use
// the generic single-column BRANCH_AWARE_MODELS auto-injection — a transfer
// "belongs" to a branch if that branch is on either side of it.
function branchInvolvementFilter(req) {
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
const listStockTransfers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const transfers = await prisma_1.prisma.stockTransfer.findMany({
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
        res.json((0, apiResponse_1.success)(transfers));
    }
    catch (e) {
        console.error("[listStockTransfers]", e);
        res.status(500).json((0, apiResponse_1.error)("Failed to list stock transfers"));
    }
};
exports.listStockTransfers = listStockTransfers;
const getStockTransfer = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const t = await prisma_1.prisma.stockTransfer.findFirst({
            where: { id, organizationId, ...branchInvolvementFilter(req) },
            include: {
                items: { include: { product: true } },
                fromBranch: true,
                toBranch: true,
            },
        });
        if (!t)
            return res.status(404).json((0, apiResponse_1.error)("Stock transfer not found"));
        res.json((0, apiResponse_1.success)(t));
    }
    catch (e) {
        console.error("[getStockTransfer]", e);
        res.status(500).json((0, apiResponse_1.error)("Failed to get stock transfer"));
    }
};
exports.getStockTransfer = getStockTransfer;
const createStockTransfer = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(String(req.user?.userId));
        const { fromBranchId, toBranchId, notes, items } = req.body;
        if (!fromBranchId || !toBranchId || parseInt(fromBranchId) === parseInt(toBranchId)) {
            return res.status(400).json((0, apiResponse_1.error)("fromBranchId and toBranchId must differ"));
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json((0, apiResponse_1.error)("items array required"));
        }
        const fromId = parseInt(fromBranchId);
        const toId = parseInt(toBranchId);
        const [fromB, toB] = await Promise.all([
            prisma_1.prisma.branch.findFirst({ where: { id: fromId, organizationId, status: "ACTIVE" } }),
            prisma_1.prisma.branch.findFirst({ where: { id: toId, organizationId, status: "ACTIVE" } }),
        ]);
        if (!fromB || !toB) {
            return res.status(400).json((0, apiResponse_1.error)("Invalid or inactive branch"));
        }
        const productIds = items.map((i) => parseInt(String(i.productId)));
        if (productIds.some((id) => Number.isNaN(id))) {
            return res.status(400).json((0, apiResponse_1.error)("Invalid product in items"));
        }
        const validProducts = await prisma_1.prisma.product.findMany({
            where: { id: { in: productIds }, organizationId },
            select: { id: true },
        });
        if (validProducts.length !== new Set(productIds).size) {
            return res.status(400).json((0, apiResponse_1.error)("One or more products were not found"));
        }
        const transfer = await prisma_1.prisma.stockTransfer.create({
            data: {
                organizationId,
                fromBranchId: fromId,
                toBranchId: toId,
                notes: notes ?? null,
                requestedById: userId,
                items: {
                    create: items.map((i) => ({
                        productId: parseInt(String(i.productId)),
                        quantity: parseInt(String(i.quantity)),
                    })),
                },
            },
            include: { items: true, fromBranch: true, toBranch: true },
        });
        res.status(201).json((0, apiResponse_1.success)(transfer));
    }
    catch (e) {
        console.error("[createStockTransfer]", e);
        res.status(500).json((0, apiResponse_1.error)(e.message || "Failed to create stock transfer"));
    }
};
exports.createStockTransfer = createStockTransfer;
const approveStockTransfer = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const userId = parseInt(String(req.user?.userId));
        const t = await prisma_1.prisma.stockTransfer.findFirst({ where: { id, organizationId } });
        if (!t)
            return res.status(404).json((0, apiResponse_1.error)("Stock transfer not found"));
        if (t.status !== "PENDING") {
            return res.status(400).json((0, apiResponse_1.error)("Only PENDING transfers can be approved"));
        }
        const updated = await prisma_1.prisma.stockTransfer.update({
            where: { id },
            data: { status: "APPROVED", approvedById: userId },
        });
        res.json((0, apiResponse_1.success)(updated));
    }
    catch (e) {
        console.error("[approveStockTransfer]", e);
        res.status(500).json((0, apiResponse_1.error)("Failed to approve stock transfer"));
    }
};
exports.approveStockTransfer = approveStockTransfer;
const rejectStockTransfer = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const t = await prisma_1.prisma.stockTransfer.findFirst({ where: { id, organizationId } });
        if (!t)
            return res.status(404).json((0, apiResponse_1.error)("Stock transfer not found"));
        if (t.status !== "PENDING") {
            return res.status(400).json((0, apiResponse_1.error)("Only PENDING transfers can be rejected"));
        }
        const updated = await prisma_1.prisma.stockTransfer.update({
            where: { id },
            data: { status: "REJECTED" },
        });
        res.json((0, apiResponse_1.success)(updated));
    }
    catch (e) {
        console.error("[rejectStockTransfer]", e);
        res.status(500).json((0, apiResponse_1.error)("Failed to reject stock transfer"));
    }
};
exports.rejectStockTransfer = rejectStockTransfer;
const completeStockTransfer = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const userId = parseInt(String(req.user?.userId));
        const t = await prisma_1.prisma.stockTransfer.findFirst({
            where: { id, organizationId },
            include: { items: true },
        });
        if (!t)
            return res.status(404).json((0, apiResponse_1.error)("Stock transfer not found"));
        if (t.status !== "APPROVED") {
            return res.status(400).json((0, apiResponse_1.error)("Only APPROVED transfers can be completed"));
        }
        await prisma_1.prisma.$transaction(async (tx) => {
            for (const item of t.items) {
                await (0, inventory_ledger_service_1.removeStock)({
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
                await (0, inventory_ledger_service_1.addStock)({
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
        const done = await prisma_1.prisma.stockTransfer.findFirst({
            where: { id },
            include: { items: true, fromBranch: true, toBranch: true },
        });
        res.json((0, apiResponse_1.success)(done));
    }
    catch (e) {
        console.error("[completeStockTransfer]", e);
        const msg = e?.message?.includes("Insufficient") ? e.message : "Failed to complete stock transfer";
        res.status(400).json((0, apiResponse_1.error)(msg));
    }
};
exports.completeStockTransfer = completeStockTransfer;

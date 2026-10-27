"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordCostPrice = recordCostPrice;
exports.getCostPriceHistory = getCostPriceHistory;
exports.getCurrentCostPrice = getCurrentCostPrice;
exports.getAverageCost = getAverageCost;
exports.getCostAtSale = getCostAtSale;
exports.updateBatchCostPrice = updateBatchCostPrice;
const prisma_1 = require("../lib/prisma");
/**
 * Record a cost price change for a batch
 */
async function recordCostPrice(params) {
    const { batchId, unitCost, quantity, reason, reference, userId } = params;
    // Verify batch exists
    const batch = await prisma_1.prisma.batch.findUnique({
        where: { id: batchId },
    });
    if (!batch) {
        throw new Error(`Batch with ID ${batchId} not found`);
    }
    // Create cost history entry
    return await prisma_1.prisma.costPriceHistory.create({
        data: {
            batchId,
            unitCost,
            quantity,
            reason: reason || 'Cost price update',
            reference: reference || undefined,
            recordedById: userId,
        },
    });
}
/**
 * Get cost price history for a batch
 */
async function getCostPriceHistory(batchId, limit = 50) {
    return await prisma_1.prisma.costPriceHistory.findMany({
        where: { batchId },
        include: {
            recordedBy: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
        orderBy: { recordedAt: 'desc' },
        take: limit,
    });
}
/**
 * Get current cost price for a batch
 */
async function getCurrentCostPrice(batchId) {
    const batch = await prisma_1.prisma.batch.findUnique({
        where: { id: batchId },
        select: {
            unitCost: true,
            quantity: true,
        },
    });
    if (!batch) {
        throw new Error(`Batch with ID ${batchId} not found`);
    }
    return {
        unitCost: batch.unitCost.toNumber(),
        quantity: batch.quantity,
    };
}
/**
 * Calculate weighted average cost for a product across all batches
 */
async function getAverageCost(productId, organizationId, branchId, tx // Optional transaction client for use within transactions
) {
    const where = {
        productId,
        organizationId,
        isActive: true,
        quantity: { gt: 0 },
    };
    if (branchId !== undefined) {
        where.branchId = branchId || null;
    }
    // Always use global prisma client for read operations
    // This is safe because getAverageCost is a read-only operation
    // and doesn't need to be part of the transaction
    const batches = await prisma_1.prisma.batch.findMany({
        where,
        select: {
            unitCost: true,
            quantity: true,
        },
    });
    if (batches.length === 0) {
        return null;
    }
    const totalCost = batches.reduce((sum, batch) => sum + batch.unitCost.toNumber() * batch.quantity, 0);
    const totalQuantity = batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (totalQuantity === 0) {
        return null;
    }
    return {
        averageCost: totalCost / totalQuantity,
        totalQuantity,
        totalCost,
        batchCount: batches.length,
    };
}
/**
 * Get cost price at time of sale (for profit calculation)
 * This uses the batch's cost at the time of sale
 */
async function getCostAtSale(batchId, saleDate) {
    // Get the cost history entry that was active at the time of sale
    const costHistory = await prisma_1.prisma.costPriceHistory.findFirst({
        where: {
            batchId,
            recordedAt: { lte: saleDate },
        },
        orderBy: { recordedAt: 'desc' },
    });
    if (costHistory) {
        return costHistory.unitCost.toNumber();
    }
    // If no history, get current batch cost
    const batch = await prisma_1.prisma.batch.findUnique({
        where: { id: batchId },
        select: { unitCost: true },
    });
    if (!batch) {
        throw new Error(`Batch with ID ${batchId} not found`);
    }
    return batch.unitCost.toNumber();
}
/**
 * Update batch cost price
 */
async function updateBatchCostPrice(batchId, newUnitCost, userId, reason) {
    return await prisma_1.prisma.$transaction(async (tx) => {
        const batch = await tx.batch.findUnique({
            where: { id: batchId },
        });
        if (!batch) {
            throw new Error(`Batch with ID ${batchId} not found`);
        }
        // Update batch cost
        const updatedBatch = await tx.batch.update({
            where: { id: batchId },
            data: {
                unitCost: newUnitCost,
            },
        });
        // Record cost history
        await tx.costPriceHistory.create({
            data: {
                batchId,
                unitCost: newUnitCost,
                quantity: batch.quantity,
                reason: reason || 'Cost price update',
                recordedById: userId,
            },
        });
        return updatedBatch;
    });
}

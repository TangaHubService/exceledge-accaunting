"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBatch = createBatch;
exports.getBatchesForProduct = getBatchesForProduct;
exports.selectBatchesForSale = selectBatchesForSale;
exports.updateBatchQuantity = updateBatchQuantity;
exports.getBatchById = getBatchById;
const prisma_1 = require("../lib/prisma");
/**
 * Create a new batch for a product
 */
async function createBatch(params) {
    const { productId, organizationId, batchNumber, quantity, unitCost, expiryDate, branchId, userId, reference, referenceType, } = params;
    // Validate product exists
    const product = await prisma_1.prisma.product.findFirst({
        where: {
            id: productId,
            organizationId,
        },
    });
    if (!product) {
        throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
    }
    // Check if batch already exists
    const existingBatch = await prisma_1.prisma.batch.findFirst({
        where: {
            productId,
            batchNumber,
            branchId: branchId,
            isActive: true,
        },
    });
    if (existingBatch) {
        throw new Error(`Batch ${batchNumber} already exists for this product`);
    }
    return await prisma_1.prisma.$transaction(async (tx) => {
        // Create batch
        const batch = await tx.batch.create({
            data: {
                productId,
                organizationId,
                branchId,
                batchNumber,
                quantity,
                unitCost,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                isActive: true,
            },
        });
        // Record cost history
        await tx.costPriceHistory.create({
            data: {
                batchId: batch.id,
                unitCost,
                quantity,
                reason: 'Initial batch creation',
                reference: reference || undefined,
                recordedById: userId,
            },
        });
        // Create inventory ledger entry for this batch
        const currentBalance = await getCurrentStockInTransaction(tx, organizationId, productId, branchId);
        await tx.inventoryLedger.create({
            data: {
                organizationId,
                productId,
                branchId,
                batchId: batch.id,
                userId,
                movementType: 'PURCHASE',
                direction: 'IN',
                quantity,
                runningBalance: currentBalance + quantity,
                unitCost,
                totalCost: quantity * unitCost,
                reference: reference || `BATCH_${batch.id}`,
                referenceType: referenceType || 'BATCH_CREATION',
                batchNumber: batchNumber,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                note: `Batch ${batchNumber} created`,
            },
        });
        // Update product quantity cache
        await tx.product.update({
            where: { id: productId },
            data: {
                quantity: { increment: quantity },
            },
        });
        return batch;
    });
}
/**
 * Get all batches for a product
 */
async function getBatchesForProduct(productId, organizationId, branchId, includeInactive = false) {
    const where = {
        productId,
        organizationId,
    };
    if (branchId !== undefined) {
        where.branchId = branchId || null;
    }
    if (branchId !== undefined) {
        where.branchId = branchId || null;
    }
    if (!includeInactive) {
        where.isActive = true;
    }
    return await prisma_1.prisma.batch.findMany({
        where,
        include: {
            branch: {
                select: {
                    id: true,
                    name: true,
                    code: true,
                },
            },
        },
        orderBy: [
            { expiryDate: 'asc' }, // Expiring soon first
            { receivedAt: 'asc' }, // Then by received date
        ],
    });
}
/**
 * Select batches for sale using FIFO, LIFO, or AVERAGE method
 */
async function selectBatchesForSale(params, tx // Optional transaction client for use within transactions
) {
    const { productId, organizationId, quantity, method, branchId } = params;
    // Use transaction client if provided, otherwise use global prisma
    const prismaClient = tx || prisma_1.prisma;
    // Get all active batches with available stock
    const batches = await prismaClient.batch.findMany({
        where: {
            productId,
            organizationId,
            branchId: branchId || undefined,
            isActive: true,
            quantity: { gt: 0 },
        },
        orderBy: method === 'FIFO'
            ? [{ receivedAt: 'asc' }, { expiryDate: 'asc' }] // First in, first out
            : method === 'LIFO'
                ? [{ receivedAt: 'desc' }, { expiryDate: 'desc' }] // Last in, first out
                : [{ expiryDate: 'asc' }, { receivedAt: 'asc' }], // For AVERAGE, still order by expiry
    });
    if (batches.length === 0) {
        throw new Error(`No active batches found for product ${productId}`);
    }
    const selectedBatches = [];
    let remainingQuantity = quantity;
    if (method === 'AVERAGE') {
        // Calculate weighted average cost
        const totalCost = batches.reduce((sum, b) => sum + b.unitCost.toNumber() * b.quantity, 0);
        const totalQuantity = batches.reduce((sum, b) => sum + b.quantity, 0);
        const averageCost = totalQuantity > 0 ? totalCost / totalQuantity : 0;
        // For average, we can use any batch, but we'll use FIFO order
        for (const batch of batches) {
            if (remainingQuantity <= 0)
                break;
            const batchQuantity = Math.min(batch.quantity, remainingQuantity);
            selectedBatches.push({
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                quantity: batchQuantity,
                unitCost: averageCost,
                expiryDate: batch.expiryDate || undefined,
            });
            remainingQuantity -= batchQuantity;
        }
    }
    else {
        // FIFO or LIFO
        for (const batch of batches) {
            if (remainingQuantity <= 0)
                break;
            const batchQuantity = Math.min(batch.quantity, remainingQuantity);
            selectedBatches.push({
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                quantity: batchQuantity,
                unitCost: batch.unitCost.toNumber(),
                expiryDate: batch.expiryDate || undefined,
            });
            remainingQuantity -= batchQuantity;
        }
    }
    if (remainingQuantity > 0) {
        throw new Error(`Insufficient stock. Available: ${quantity - remainingQuantity}, Requested: ${quantity}`);
    }
    return selectedBatches;
}
/**
 * Update batch quantity after sale
 */
async function deductBatchQuantityLocked(tx, batchId, quantityToDeduct, organizationId) {
    // Lock the row first so concurrent sales touching the same batch serialize
    // instead of both reading the same pre-deduction quantity (lost update).
    const [locked] = await tx.$queryRaw `
    SELECT id, quantity FROM batches
    WHERE id = ${batchId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
    if (!locked) {
        throw new Error(`Batch with ID ${batchId} not found`);
    }
    if (locked.quantity < quantityToDeduct) {
        throw new Error(`Insufficient batch quantity. Available: ${locked.quantity}, Requested: ${quantityToDeduct}`);
    }
    const newQuantity = locked.quantity - quantityToDeduct;
    return tx.batch.update({
        where: { id: batchId },
        data: {
            quantity: { decrement: quantityToDeduct },
            isActive: newQuantity > 0, // Deactivate if quantity reaches zero
        },
    });
}
async function updateBatchQuantity(batchId, quantityToDeduct, organizationId, tx // Optional transaction client for use within existing transactions
) {
    // If transaction client is provided, use it directly (we're already in a transaction)
    if (tx) {
        return deductBatchQuantityLocked(tx, batchId, quantityToDeduct, organizationId);
    }
    // Otherwise, create a new transaction
    return prisma_1.prisma.$transaction((tx) => deductBatchQuantityLocked(tx, batchId, quantityToDeduct, organizationId));
}
/**
 * Get batch by ID
 */
async function getBatchById(batchId, organizationId) {
    return await prisma_1.prisma.batch.findFirst({
        where: {
            id: batchId,
            organizationId,
        },
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                },
            },
            warehouse: {
                select: {
                    id: true,
                    name: true,
                    code: true,
                },
            },
            costHistory: {
                orderBy: { recordedAt: 'desc' },
                take: 10,
                include: {
                    recordedBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
            },
        },
    });
}
/**
 * Get current stock for a product (helper function)
 */
async function getCurrentStockInTransaction(tx, organizationId, productId, branchId) {
    const where = {
        organizationId,
        productId,
    };
    if (branchId !== undefined && branchId !== null) {
        where.branchId = branchId;
    }
    // Efficient aggregation using groupBy within transaction
    const stockAggregates = await tx.inventoryLedger.groupBy({
        by: ['direction'],
        where,
        _sum: {
            quantity: true,
        },
    });
    const inQty = stockAggregates.find((a) => a.direction === 'IN')?._sum.quantity || 0;
    const outQty = stockAggregates.find((a) => a.direction === 'OUT')?._sum.quantity || 0;
    return inQty - outQty;
}

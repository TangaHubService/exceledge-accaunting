"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTIONS = exports.MOVEMENT_TYPES = void 0;
exports.getCurrentStock = getCurrentStock;
exports.getStockAtDate = getStockAtDate;
exports.addStock = addStock;
exports.removeStock = removeStock;
exports.adjustStock = adjustStock;
exports.getLedger = getLedger;
exports.getInventorySummary = getInventorySummary;
exports.getCurrentStockInTransaction = getCurrentStockInTransaction;
exports.recalculateProductStock = recalculateProductStock;
exports.getInventoryHistory = getInventoryHistory;
const prisma_1 = require("../lib/prisma");
/**
 * RRA Stock In/Out reporting (RRA checklist §72/§73): every non-sale inventory
 * movement is queued for the VSDC by marking its ledger row PENDING; a cron
 * batch (stock-sync.job) submits them. SALE rows are never queued — RRA derives
 * stock-out from /trnsSales/saveSales, so `null` here means "not applicable".
 */
function ebmSyncStatusFor(movementType) {
    return movementType === 'SALE' ? null : 'PENDING';
}
/**
 * Inventory Ledger Service
 *
 * This service implements an append-only ledger pattern for inventory tracking.
 * Current stock is calculated from the ledger, not stored as a mutable value.
 *
 * Key principles:
 * - Append-only: No updates or deletes
 * - Immutable history: Every movement is permanently recorded
 * - Source of truth: Ledger is the authoritative record (per branch)
 * - Concurrent safe: Uses database transactions
 *
 * Note: `Product.quantity` is updated as a legacy cache when ledger rows change.
 * For multi-branch organizations it does not represent branch-specific stock;
 * use ledger aggregates (or APIs that call `getCurrentStock` with `branchId`).
 */
// Constants for movement types
exports.MOVEMENT_TYPES = {
    // Stock IN
    PURCHASE: 'PURCHASE',
    RETURN_CUSTOMER: 'RETURN_CUSTOMER',
    TRANSFER_IN: 'TRANSFER_IN',
    INITIAL_STOCK: 'INITIAL_STOCK',
    ADJUSTMENT_IN: 'ADJUSTMENT_IN',
    // Stock OUT
    SALE: 'SALE',
    DAMAGE: 'DAMAGE',
    EXPIRED: 'EXPIRED',
    TRANSFER_OUT: 'TRANSFER_OUT',
    ADJUSTMENT_OUT: 'ADJUSTMENT_OUT',
    // Special
    ADJUSTMENT: 'ADJUSTMENT',
    CORRECTION: 'CORRECTION',
};
exports.DIRECTIONS = {
    IN: 'IN',
    OUT: 'OUT',
};
/**
 * Get the current stock balance for a product (and optionally branch)
 * Calculated from ledger entries - this is the source of truth
 */
async function getCurrentStock(organizationId, productId, branchId) {
    const where = {
        organizationId,
        productId,
    };
    if (branchId !== undefined && branchId !== null) {
        where.branchId = branchId;
    }
    // Efficient stock calculation using database aggregation with groupBy
    // Groups by direction (IN/OUT) and sums quantities for each
    const stockAggregates = await prisma_1.prisma.inventoryLedger.groupBy({
        by: ['direction'],
        where,
        _sum: {
            quantity: true,
        },
    });
    const inQty = stockAggregates.find((a) => a.direction === 'IN')?._sum.quantity || 0;
    const outQty = stockAggregates.find((a) => a.direction === 'OUT')?._sum.quantity || 0;
    const currentStock = inQty - outQty;
    return currentStock;
}
/**
 * Get running balance at a specific point in time
 */
async function getStockAtDate(organizationId, productId, atDate, branchId) {
    const where = {
        organizationId,
        productId,
        createdAt: {
            lte: new Date(atDate),
        },
    };
    if (branchId !== undefined && branchId !== null) {
        where.branchId = branchId;
    }
    const ledgerEntries = await prisma_1.prisma.inventoryLedger.findMany({
        where,
        orderBy: {
            createdAt: 'asc',
        },
        select: {
            direction: true,
            quantity: true,
        },
    });
    let balance = 0;
    for (const entry of ledgerEntries) {
        if (entry.direction === 'IN') {
            balance += entry.quantity;
        }
        else {
            balance -= entry.quantity;
        }
    }
    return balance;
}
/**
 * Add stock to inventory (Stock IN)
 * This is the primary function for adding inventory
 */
async function addStock(params) {
    const { organizationId, productId, userId, quantity, movementType, branchId = null, warehouseId = null, unitCost, reference, referenceType, batchNumber, expiryDate, note, metadata, skipEbmSync = false, tx: providedTx, } = params;
    // Validate quantity
    if (quantity < 0) {
        throw new Error('Quantity must be non-negative for stock IN operations');
    }
    // Use provided transaction client or create a new one
    const executeInTransaction = async (tx) => {
        // Lock product row using FOR UPDATE to prevent race conditions
        const product = await tx.$queryRaw `
      SELECT id, quantity, name
      FROM products
      WHERE id = ${productId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
        if (!product || product.length === 0) {
            throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
        }
        // Get current balance before this movement
        const currentBalance = await getCurrentStockInTransaction(tx, organizationId, productId, branchId);
        // Calculate new balance
        const newBalance = currentBalance + quantity;
        // Calculate total cost if unit cost provided
        const totalCost = unitCost ? quantity * unitCost : null;
        // Create ledger entry
        const ledgerEntry = await tx.inventoryLedger.create({
            data: {
                organizationId,
                productId,
                branchId,
                warehouseId,
                userId,
                movementType,
                direction: 'IN',
                quantity,
                runningBalance: newBalance,
                unitCost: unitCost ? unitCost : null,
                totalCost,
                reference,
                referenceType,
                batchNumber,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                note,
                metadata: metadata ? metadata : null,
                ebmSyncStatus: skipEbmSync ? null : ebmSyncStatusFor(movementType),
            },
        });
        // Update product quantity cache (global aggregate across all branches)
        // Use incremental update so branch-specific operations don't overwrite
        // stock belonging to other branches
        await tx.product.update({
            where: { id: productId },
            data: {
                quantity: { increment: quantity },
            },
        });
        return ledgerEntry;
    };
    // If transaction client is provided, use it directly (we're already in a transaction)
    if (providedTx) {
        return await executeInTransaction(providedTx);
    }
    // Otherwise, validate outside transaction and create a new transaction
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
    // Validate branch if provided
    if (branchId !== null && branchId !== undefined) {
        const branch = await prisma_1.prisma.branch.findFirst({
            where: {
                id: branchId,
                organizationId,
                status: 'ACTIVE',
            },
        });
        if (!branch) {
            throw new Error(`Branch with ID ${branchId} not found or inactive`);
        }
    }
    // Use transaction to ensure atomicity and calculate running balance
    return await prisma_1.prisma.$transaction(async (tx) => {
        return await executeInTransaction(tx);
    });
}
/**
 * Remove stock from inventory (Stock OUT)
 * This is the primary function for removing inventory
 */
async function removeStock(params) {
    const { organizationId, productId, userId, quantity, movementType, branchId = null, warehouseId = null, batchId = null, reference, referenceType, note, metadata, tx: providedTx, } = params;
    // Validate quantity
    if (quantity <= 0) {
        throw new Error('Quantity must be positive for stock OUT operations');
    }
    // Use provided transaction client or create a new one
    const executeInTransaction = async (tx) => {
        // Lock product row using FOR UPDATE to prevent race conditions
        const product = await tx.$queryRaw `
      SELECT id, quantity, name
      FROM products
      WHERE id = ${productId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
        if (!product || product.length === 0) {
            throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
        }
        // Get current balance from ledger (source of truth)
        const currentBalance = await getCurrentStockInTransaction(tx, organizationId, productId, branchId);
        // Check if sufficient stock available
        if (currentBalance < quantity) {
            throw new Error(`Insufficient stock. Available: ${currentBalance}, Requested: ${quantity}`);
        }
        // Calculate new balance
        const newBalance = currentBalance - quantity;
        // Create ledger entry
        const ledgerEntry = await tx.inventoryLedger.create({
            data: {
                organizationId,
                productId,
                branchId,
                warehouseId,
                batchId,
                userId,
                movementType,
                direction: 'OUT',
                quantity,
                runningBalance: newBalance,
                reference,
                referenceType,
                note,
                metadata: metadata ? metadata : null,
                ebmSyncStatus: ebmSyncStatusFor(movementType),
            },
        });
        // Update product quantity cache (global aggregate across all branches)
        await tx.product.update({
            where: { id: productId },
            data: {
                quantity: { decrement: quantity },
            },
        });
        return ledgerEntry;
    };
    // If transaction client is provided, use it directly (we're already in a transaction)
    if (providedTx) {
        return await executeInTransaction(providedTx);
    }
    // Otherwise, validate outside transaction and create a new transaction
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
    // Validate branch if provided
    if (branchId !== null && branchId !== undefined) {
        const branch = await prisma_1.prisma.branch.findFirst({
            where: {
                id: branchId,
                organizationId,
                status: 'ACTIVE',
            },
        });
        if (!branch) {
            throw new Error(`Branch with ID ${branchId} not found or inactive`);
        }
    }
    // Use transaction to ensure atomicity with row-level locking
    return await prisma_1.prisma.$transaction(async (tx) => {
        return await executeInTransaction(tx);
    });
}
/**
 * Adjust stock (can be positive or negative)
 * Used for manual corrections and adjustments
 */
async function adjustStock(params) {
    const { organizationId, productId, userId, quantity, // Can be positive or negative
    branchId, warehouseId = null, unitCost, reference, referenceType, note, metadata, } = params;
    // Require branchId — no silent fallback to prevent cross-branch data leakage
    if (branchId === null || branchId === undefined) {
        throw new Error('Branch ID is required for stock adjustments');
    }
    // Validate quantity is not zero
    if (quantity === 0) {
        throw new Error('Adjustment quantity cannot be zero');
    }
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
    // Validate branch exists and is active
    const branch = await prisma_1.prisma.branch.findFirst({
        where: {
            id: branchId,
            organizationId,
            status: 'ACTIVE',
        },
    });
    if (!branch) {
        throw new Error(`Branch with ID ${branchId} not found or inactive`);
    }
    // Use transaction
    return await prisma_1.prisma.$transaction(async (tx) => {
        // Lock product row using FOR UPDATE to prevent race conditions — matches
        // addStock/removeStock so a concurrent sale/adjustment on the same product
        // can't read the same pre-adjustment balance and push stock negative.
        const lockedProduct = await tx.$queryRaw `
      SELECT id
      FROM products
      WHERE id = ${productId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
        if (!lockedProduct || lockedProduct.length === 0) {
            throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
        }
        // Get current balance for this specific branch
        const currentBalance = await getCurrentStockInTransaction(tx, organizationId, productId, branchId);
        // Determine direction and movement type
        const direction = quantity > 0 ? 'IN' : 'OUT';
        const movementType = quantity > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        const absoluteQuantity = Math.abs(quantity);
        // Check if negative adjustment would result in negative stock
        if (direction === 'OUT' && currentBalance < absoluteQuantity) {
            throw new Error(`Adjustment would result in negative stock. Available: ${currentBalance}, Adjustment: ${absoluteQuantity}`);
        }
        // Calculate new balance
        const newBalance = currentBalance + quantity; // quantity can be negative
        // Calculate total cost if unit cost provided
        const totalCost = unitCost ? absoluteQuantity * unitCost : null;
        // Create ledger entry
        const ledgerEntry = await tx.inventoryLedger.create({
            data: {
                organizationId,
                productId,
                branchId,
                userId,
                movementType,
                direction,
                quantity: absoluteQuantity, // Store as positive, direction indicates sign
                runningBalance: newBalance,
                unitCost: unitCost ? unitCost : null,
                totalCost,
                reference,
                referenceType,
                note: note || `Stock adjustment: ${quantity > 0 ? '+' : ''}${quantity}`,
                metadata: metadata ? metadata : undefined,
                ebmSyncStatus: ebmSyncStatusFor(movementType),
            },
        });
        // Update product quantity cache (global aggregate across all branches)
        // quantity may be positive (IN) or negative (OUT); { increment } handles both
        await tx.product.update({
            where: { id: productId },
            data: {
                quantity: { increment: quantity },
            },
        });
        return ledgerEntry;
    });
}
/**
 * Get ledger entries with pagination and filtering
 */
async function getLedger(params) {
    const { organizationId, productId, branchId, warehouseId, movementType, startDate, endDate, page = 1, limit = 50, } = params;
    const where = {
        organizationId,
    };
    if (productId) {
        where.productId = productId;
    }
    if (branchId !== undefined) {
        where.branchId = branchId;
    }
    if (warehouseId !== undefined && warehouseId !== null) {
        where.warehouseId = warehouseId;
    }
    if (movementType) {
        where.movementType = movementType;
    }
    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
            where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
            where.createdAt.lte = new Date(endDate);
        }
    }
    const skip = (page - 1) * limit;
    const [entries, total] = await Promise.all([
        prisma_1.prisma.inventoryLedger.findMany({
            where,
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                    },
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
            skip,
            take: limit,
        }),
        prisma_1.prisma.inventoryLedger.count({ where }),
    ]);
    return {
        entries,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}
/**
 * Get inventory summary since inception or from a specific date
 */
async function getInventorySummary(params) {
    const { organizationId, productId, warehouseId, fromDate = 'inception', } = params;
    const where = {
        organizationId,
    };
    if (productId) {
        where.productId = productId;
    }
    if (warehouseId !== undefined) {
        where.warehouseId = warehouseId;
    }
    if (fromDate !== 'inception') {
        where.createdAt = {
            gte: new Date(fromDate),
        };
    }
    // Get all ledger entries for aggregation
    const entries = await prisma_1.prisma.inventoryLedger.findMany({
        where: where,
        select: {
            productId: true,
            branchId: true,
            direction: true,
            quantity: true,
            movementType: true,
            unitCost: true,
            totalCost: true,
            createdAt: true,
        },
        orderBy: {
            createdAt: 'asc',
        },
    });
    // Aggregate by product (and optionally warehouse)
    const summary = {};
    for (const entry of entries) {
        const key = productId
            ? `product_${entry.productId}${entry.branchId ? `_branch_${entry.branchId}` : ''}`
            : `product_${entry.productId}${entry.branchId ? `_branch_${entry.branchId}` : ''}`;
        if (!summary[key]) {
            summary[key] = {
                productId: entry.productId,
                branchId: entry.branchId,
                totalIn: 0,
                totalOut: 0,
                currentStock: 0,
                totalCost: 0,
                movements: {
                    IN: 0,
                    OUT: 0,
                },
                byType: {},
            };
        }
        const item = summary[key];
        if (entry.direction === 'IN') {
            item.totalIn += entry.quantity;
            item.currentStock += entry.quantity;
            item.movements.IN += 1;
        }
        else {
            item.totalOut += entry.quantity;
            item.currentStock -= entry.quantity;
            item.movements.OUT += 1;
        }
        if (entry.totalCost) {
            if (entry.direction === 'IN') {
                item.totalCost += Number(entry.totalCost);
            }
            else {
                item.totalCost -= Number(entry.totalCost);
            }
        }
        // Track by movement type
        if (!item.byType[entry.movementType]) {
            item.byType[entry.movementType] = {
                count: 0,
                quantity: 0,
            };
        }
        item.byType[entry.movementType].count += 1;
        item.byType[entry.movementType].quantity +=
            entry.direction === 'IN' ? entry.quantity : -entry.quantity;
    }
    return {
        summary: Object.values(summary),
        fromDate: fromDate,
    };
}
/**
 * Helper function to get current stock within a transaction
 * Used internally to ensure consistency during ledger writes
 */
async function getCurrentStockInTransaction(tx, organizationId, productId, branchId, warehouseId) {
    const where = {
        organizationId,
        productId,
    };
    if (branchId !== undefined && branchId !== null) {
        where.branchId = branchId;
    }
    if (warehouseId !== undefined && warehouseId !== null) {
        where.warehouseId = warehouseId;
    }
    // Efficient aggregation using groupBy within transaction
    const stockAggregates = await tx.inventoryLedger.groupBy({
        by: ['direction'],
        where,
        _sum: {
            quantity: true,
        },
    });
    // If no ledger entries exist for this product+branch, return 0
    // (the product.quantity cache is a cross-branch aggregate and must not be
    // used as a branch-specific value)
    if (stockAggregates.length === 0) {
        return 0;
    }
    // Calculate from aggregated totals
    const inQty = stockAggregates.find((a) => a.direction === 'IN')?._sum.quantity || 0;
    const outQty = stockAggregates.find((a) => a.direction === 'OUT')?._sum.quantity || 0;
    const currentStock = inQty - outQty;
    return currentStock;
}
/**
 * Recalculate and update product quantity cache from ledger
 * Useful for data integrity checks or after manual ledger corrections
 */
async function recalculateProductStock(organizationId, productId, branchId) {
    const currentStock = await getCurrentStock(organizationId, productId, branchId);
    await prisma_1.prisma.product.update({
        where: { id: productId },
        data: {
            quantity: currentStock,
        },
    });
    return currentStock;
}
/**
 * Get inventory history for a product since inception
 */
async function getInventoryHistory(organizationId, productId, warehouseId, branchId) {
    const where = {
        organizationId,
        productId,
    };
    if (branchId !== undefined && branchId !== null) {
        where.branchId = branchId;
    }
    const entries = await prisma_1.prisma.inventoryLedger.findMany({
        where,
        include: {
            branch: {
                select: {
                    id: true,
                    name: true,
                    code: true,
                },
            },
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
        orderBy: {
            createdAt: 'asc',
        },
    });
    return entries;
}

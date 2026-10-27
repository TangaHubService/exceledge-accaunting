"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProduction = runProduction;
exports.getProductionRuns = getProductionRuns;
exports.getProductionRunById = getProductionRunById;
exports.reverseProductionRun = reverseProductionRun;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const inventory_ledger_service_1 = require("./inventory-ledger.service");
const bom_service_1 = require("./bom.service");
async function findBatchForConsumption(tx, organizationId, productId, branchId, quantityNeeded, expiryDate) {
    const batches = await tx.batch.findMany({
        where: {
            organizationId,
            productId,
            branchId,
            isActive: true,
            quantity: { gt: 0 },
            ...(expiryDate ? { expiryDate: { gte: new Date(expiryDate) } } : {}),
        },
        orderBy: [
            { expiryDate: 'asc' },
            { receivedAt: 'asc' },
        ],
        select: {
            id: true,
            batchNumber: true,
            quantity: true,
        },
    });
    let remaining = quantityNeeded;
    for (const batch of batches) {
        if (batch.quantity >= remaining) {
            return { batchId: batch.id, batchNumber: batch.batchNumber, quantity: remaining };
        }
        remaining -= batch.quantity;
    }
    return null;
}
async function consumeFromBatches(tx, organizationId, productId, branchId, quantityNeeded, userId, reference, referenceType, note, movementType, expiryDate) {
    const results = [];
    let remaining = quantityNeeded;
    const batches = await tx.batch.findMany({
        where: {
            organizationId,
            productId,
            branchId,
            isActive: true,
            quantity: { gt: 0 },
            ...(expiryDate ? { expiryDate: { gte: new Date(expiryDate) } } : {}),
        },
        orderBy: [
            { expiryDate: 'asc' },
            { receivedAt: 'asc' },
        ],
        select: {
            id: true,
            batchNumber: true,
            quantity: true,
            unitCost: true,
        },
    });
    for (const batch of batches) {
        if (remaining <= 0)
            break;
        const consumeQty = Math.min(batch.quantity, remaining);
        const ledgerEntry = await (0, inventory_ledger_service_1.removeStock)({
            organizationId,
            productId,
            userId,
            quantity: consumeQty,
            movementType,
            branchId,
            batchId: batch.id,
            reference,
            referenceType,
            note,
            tx,
        });
        await tx.batch.update({
            where: { id: batch.id },
            data: { quantity: { decrement: consumeQty } },
        });
        results.push({
            batchId: batch.id,
            quantity: consumeQty,
            ledgerEntryId: ledgerEntry.id,
        });
        remaining -= consumeQty;
    }
    if (remaining > 0) {
        throw new Error(`Insufficient stock in batches. Needed: ${quantityNeeded}, Available: ${quantityNeeded - remaining}`);
    }
    return results;
}
async function runProduction(input) {
    const { organizationId, branchId, productId, quantity, userId, note, batchNumber, expiryDate, } = input;
    if (quantity <= 0) {
        throw new Error('Production quantity must be positive');
    }
    return await prisma_1.prisma.$transaction(async (tx) => {
        const requirements = await (0, bom_service_1.checkProductionRequirements)(organizationId, productId, quantity, branchId, tx);
        if (!requirements.canProduce) {
            const limit = requirements.limitingComponent;
            throw new Error(`Insufficient stock for ${limit.componentName}. ` +
                `Required: ${limit.requiredQuantity}, Available: ${limit.availableStock}. ` +
                `Maximum producible: ${Math.floor(limit.availableStock / (limit.requiredQuantity / quantity))} units.`);
        }
        const bomCost = await (0, bom_service_1.calculateBomCost)(organizationId, productId, tx);
        const parentProduct = await tx.product.findUnique({
            where: { id: productId },
            select: { name: true, unitPrice: true, purchasePrice: true },
        });
        if (!parentProduct) {
            throw new Error('Parent product not found');
        }
        const productionRun = await tx.productionRun.create({
            data: {
                organizationId,
                productId,
                quantity,
                producedAt: new Date(),
                note: note || `Produced ${quantity} units of ${parentProduct.name}`,
                userId,
            },
        });
        const consumedComponents = [];
        for (const comp of requirements.components) {
            const consumed = await consumeFromBatches(tx, organizationId, comp.componentProductId, branchId, comp.requiredQuantity, userId, `PROD-${productionRun.id}-${comp.componentProductId}`, 'PRODUCTION_CONSUME', `Consumed for production run #${productionRun.id} (${parentProduct.name})`, 'PRODUCTION_CONSUME', expiryDate);
            consumedComponents.push({
                componentProductId: comp.componentProductId,
                componentName: comp.componentName,
                quantityConsumed: comp.requiredQuantity,
                ledgerEntryId: consumed[0].ledgerEntryId,
                batchId: consumed[0].batchId,
            });
        }
        const finishedGoodsBatchNumber = batchNumber || `PROD-${productionRun.id}-${Date.now()}`;
        const batchUnitCost = bomCost.totalCost / quantity;
        const finishedBatch = await tx.batch.upsert({
            where: {
                productId_batchNumber_branchId: {
                    productId,
                    batchNumber: finishedGoodsBatchNumber,
                    branchId,
                },
            },
            update: {
                quantity: { increment: quantity },
                unitCost: batchUnitCost,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                isActive: true,
            },
            create: {
                productId,
                organizationId,
                branchId,
                batchNumber: finishedGoodsBatchNumber,
                quantity,
                unitCost: batchUnitCost,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                isActive: true,
            },
        });
        const producedLedgerEntry = await (0, inventory_ledger_service_1.addStock)({
            organizationId,
            productId,
            userId,
            quantity,
            movementType: 'PRODUCTION_OUTPUT',
            branchId,
            batchId: finishedBatch.id,
            reference: `PROD-${productionRun.id}`,
            referenceType: 'PRODUCTION_OUTPUT',
            note: `Produced in production run #${productionRun.id}`,
            unitCost: batchUnitCost,
            expiryDate: expiryDate ? new Date(expiryDate) : undefined,
            tx,
        });
        return {
            productionRun: {
                id: productionRun.id,
                productId: productionRun.productId,
                quantity: productionRun.quantity,
                producedAt: productionRun.producedAt,
                note: productionRun.note,
            },
            consumedComponents,
            producedFinishedGoods: {
                productId,
                productName: parentProduct.name,
                quantityProduced: quantity,
                ledgerEntryId: producedLedgerEntry.id,
                batchId: finishedBatch.id,
            },
            totalCost: bomCost.totalCost,
        };
    }, {
        timeout: 30000,
        isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
    });
}
async function getProductionRuns(organizationId, branchId, productId, startDate, endDate, page = 1, limit = 50) {
    const where = { organizationId };
    if (branchId) {
        // ProductionRun has no branch relation; output ledger entries record the branch.
        const outputEntries = await prisma_1.prisma.inventoryLedger.findMany({
            where: { organizationId, branchId, referenceType: 'PRODUCTION_OUTPUT' },
            select: { reference: true },
        });
        const runIds = outputEntries
            .map((entry) => /^PROD-(\d+)$/.exec(entry.reference || '')?.[1])
            .filter((id) => !!id)
            .map(Number);
        where.id = { in: [...new Set(runIds)] };
    }
    if (productId)
        where.productId = productId;
    if (startDate || endDate) {
        where.producedAt = {};
        if (startDate)
            where.producedAt.gte = startDate;
        if (endDate)
            where.producedAt.lte = endDate;
    }
    const [runs, total] = await Promise.all([
        prisma_1.prisma.productionRun.findMany({
            where,
            include: {
                product: {
                    select: { id: true, name: true, sku: true, barcode: true },
                },
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
            orderBy: { producedAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma_1.prisma.productionRun.count({ where }),
    ]);
    return {
        runs,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}
async function getProductionRunById(organizationId, runId) {
    const run = await prisma_1.prisma.productionRun.findFirst({
        where: { id: runId, organizationId },
        include: {
            product: {
                select: { id: true, name: true, sku: true, barcode: true, unitPrice: true },
            },
            user: {
                select: { id: true, name: true, email: true },
            },
        },
    });
    if (!run)
        return null;
    const consumed = await prisma_1.prisma.inventoryLedger.findMany({
        where: {
            organizationId,
            reference: { startsWith: `PROD-${runId}-` },
            referenceType: 'PRODUCTION_CONSUME',
            direction: 'OUT',
        },
        include: {
            product: { select: { id: true, name: true, sku: true } },
            batch: { select: { id: true, batchNumber: true } },
        },
    });
    const produced = await prisma_1.prisma.inventoryLedger.findFirst({
        where: {
            organizationId,
            reference: `PROD-${runId}`,
            referenceType: 'PRODUCTION_OUTPUT',
            direction: 'IN',
        },
        include: {
            batch: { select: { id: true, batchNumber: true, unitCost: true } },
        },
    });
    return {
        ...run,
        consumedComponents: consumed,
        producedFinishedGoods: produced,
    };
}
async function reverseProductionRun(organizationId, runId, userId, note) {
    const run = await prisma_1.prisma.productionRun.findFirst({
        where: { id: runId, organizationId },
        include: { product: true },
    });
    if (!run) {
        throw new Error('Production run not found');
    }
    await prisma_1.prisma.$transaction(async (tx) => {
        const consumed = await tx.inventoryLedger.findMany({
            where: {
                organizationId,
                reference: { startsWith: `PROD-${runId}-` },
                referenceType: 'PRODUCTION_CONSUME',
                direction: 'OUT',
            },
            include: { batch: true },
        });
        for (const entry of consumed) {
            await (0, inventory_ledger_service_1.addStock)({
                organizationId,
                productId: entry.productId,
                userId,
                quantity: entry.quantity,
                movementType: 'ADJUSTMENT_IN',
                branchId: entry.branchId ?? 0,
                batchId: entry.batchId ?? undefined,
                reference: `REV-PROD-${runId}-${entry.productId}`,
                referenceType: 'PRODUCTION_REVERSAL',
                note: note || `Reversal of production run #${runId}`,
                tx,
            });
            if (entry.batchId) {
                await tx.batch.update({
                    where: { id: entry.batchId },
                    data: { quantity: { increment: entry.quantity } },
                });
            }
        }
        const produced = await tx.inventoryLedger.findFirst({
            where: {
                organizationId,
                reference: `PROD-${runId}`,
                referenceType: 'PRODUCTION_OUTPUT',
                direction: 'IN',
            },
        });
        if (produced) {
            await (0, inventory_ledger_service_1.removeStock)({
                organizationId,
                productId: produced.productId,
                userId,
                quantity: produced.quantity,
                movementType: 'ADJUSTMENT_OUT',
                branchId: produced.branchId ?? 0,
                batchId: produced.batchId ?? undefined,
                reference: `REV-PROD-${runId}`,
                referenceType: 'PRODUCTION_REVERSAL',
                note: note || `Reversal of production run #${runId}`,
                tx,
            });
            if (produced.batchId) {
                await tx.batch.update({
                    where: { id: produced.batchId },
                    data: { quantity: { decrement: produced.quantity } },
                });
            }
        }
        await tx.productionRun.update({
            where: { id: runId },
            data: { note: (run.note || '') + `\n[REVERSED] ${note || 'Reversed by user'}` },
        });
    });
}

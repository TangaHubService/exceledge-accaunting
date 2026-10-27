"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordStockMovement = void 0;
const prisma_1 = require("../lib/prisma");
/**
 * @deprecated Use inventory-ledger.service.ts functions instead
 * Records a stock movement and updates the product quantity.
 * @param params Movement details
 */
const recordStockMovement = async (params) => {
    const { organizationId, productId, userId, type, quantity, note, reference } = params;
    return await prisma_1.prisma.$transaction(async (tx) => {
        // 1. Get current product stock
        const product = await tx.product.findUnique({
            where: { id: productId },
            select: { quantity: true }
        });
        if (!product) {
            throw new Error(`Product with ID ${productId} not found`);
        }
        const previousStock = product.quantity;
        const newStock = previousStock + quantity;
        // 2. Create stock movement record
        const movement = await tx.stockMovement.create({
            data: {
                organizationId,
                productId,
                userId,
                branchId: params.branchId, // Added branchId
                type,
                quantity,
                previousStock,
                newStock,
                note,
                reference
            }
        });
        // 3. Update product quantity
        await tx.product.update({
            where: { id: productId },
            data: { quantity: newStock }
        });
        return movement;
    });
};
exports.recordStockMovement = recordStockMovement;

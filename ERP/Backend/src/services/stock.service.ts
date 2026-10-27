import { StockMovementType } from "@prisma/client";
import { prisma } from '../lib/prisma';

/**
 * @deprecated This service is deprecated. Use inventory-ledger.service.ts instead.
 * 
 * The StockMovement table is being phased out in favor of InventoryLedger
 * which provides better audit trails and data integrity.
 * 
 * This file is kept for backward compatibility but should not be used in new code.
 */

export interface RecordMovementParams {
    organizationId: number;
    productId: number;
    userId: number;
    branchId: number; // Added branchId
    type: StockMovementType;
    quantity: number;
    note?: string;
    reference?: string;
}

/**
 * @deprecated Use inventory-ledger.service.ts functions instead
 * Records a stock movement and updates the product quantity.
 * @param params Movement details
 */
export const recordStockMovement = async (params: RecordMovementParams) => {
    const { organizationId, productId, userId, type, quantity, note, reference } = params;

    return await prisma.$transaction(async (tx) => {
        // 1. Get current product stock
        const product = await tx.product.findUnique({
            where: { id: productId },
            select: { quantity: true }
        });

        if (!product) {
            throw new Error(`Product with ID ${productId} not found`);
        }

        const previousStock = Number(product.quantity);
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateProfit = calculateProfit;
exports.calculateAndStoreProfitForSale = calculateAndStoreProfitForSale;
exports.getSaleProfitSummary = getSaleProfitSummary;
exports.getProfitReport = getProfitReport;
const prisma_1 = require("../lib/prisma");
const cost_price_service_1 = require("./cost-price.service");
/**
 * Calculate profit for a sale item
 * Profit = (sellingPrice - costPrice) * quantity
 */
async function calculateProfit(params) {
    const { saleItemId, batchId, unitPrice, quantity, saleDate } = params;
    let costPrice = 0;
    if (batchId) {
        // Get cost from batch
        costPrice = await (0, cost_price_service_1.getCostAtSale)(batchId, saleDate);
    }
    else {
        // If no batch, try to get from product's average cost or ledger
        // This is a fallback for products without batch tracking
        const saleItem = await prisma_1.prisma.saleItem.findUnique({
            where: { id: saleItemId },
            include: {
                product: true,
            },
        });
        if (saleItem && saleItem.productId) {
            // Try to get average cost from batches
            const batches = await prisma_1.prisma.batch.findMany({
                where: {
                    productId: saleItem.productId,
                    organizationId: (await prisma_1.prisma.sale.findUnique({
                        where: { id: saleItem.saleId },
                        select: { organizationId: true },
                    }))?.organizationId || 0,
                    isActive: true,
                    quantity: { gt: 0 },
                },
                select: {
                    unitCost: true,
                    quantity: true,
                },
            });
            if (batches.length > 0) {
                const totalCost = batches.reduce((sum, b) => sum + b.unitCost.toNumber() * b.quantity, 0);
                const totalQuantity = batches.reduce((sum, b) => sum + b.quantity, 0);
                costPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
            }
            else {
                // Fallback: use 0 cost if no batches (for products without cost tracking)
                costPrice = 0;
            }
        }
    }
    const profit = (unitPrice - costPrice) * quantity;
    const profitMargin = unitPrice > 0 ? ((unitPrice - costPrice) / unitPrice) * 100 : 0;
    return {
        costPrice,
        profit,
        profitMargin,
    };
}
/**
 * Calculate and store profit for all items in a sale
 */
async function calculateAndStoreProfitForSale(saleId) {
    const sale = await prisma_1.prisma.sale.findUnique({
        where: { id: saleId },
        include: {
            saleItems: {
                include: {
                    product: true,
                },
            },
        },
    });
    if (!sale) {
        throw new Error(`Sale with ID ${saleId} not found`);
    }
    const updatedItems = [];
    for (const item of sale.saleItems) {
        const profitData = await calculateProfit({
            saleItemId: item.id,
            batchId: item.batchId || null,
            unitPrice: item.unitPrice.toNumber(),
            quantity: item.quantity,
            saleDate: sale.createdAt,
        });
        const updatedItem = await prisma_1.prisma.saleItem.update({
            where: { id: item.id },
            data: {
                costPrice: profitData.costPrice,
                profit: profitData.profit,
            },
        });
        updatedItems.push(updatedItem);
    }
    return updatedItems;
}
/**
 * Get profit summary for a sale
 */
async function getSaleProfitSummary(saleId) {
    const saleItems = await prisma_1.prisma.saleItem.findMany({
        where: { saleId },
        select: {
            unitPrice: true,
            costPrice: true,
            profit: true,
            quantity: true,
            totalPrice: true,
        },
    });
    const totalRevenue = saleItems.reduce((sum, item) => sum + item.totalPrice.toNumber(), 0);
    const totalCost = saleItems.reduce((sum, item) => sum + (item.costPrice?.toNumber() || 0) * item.quantity, 0);
    const totalProfit = saleItems.reduce((sum, item) => sum + (item.profit?.toNumber() || 0), 0);
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    return {
        totalRevenue,
        totalCost,
        totalProfit,
        profitMargin,
        itemCount: saleItems.length,
    };
}
/**
 * Get profit report for a date range
 */
async function getProfitReport(organizationId, startDate, endDate, productId) {
    const where = {
        sale: {
            organizationId,
            createdAt: {
                gte: startDate,
                lte: endDate,
            },
            status: {
                not: 'CANCELLED',
            },
        },
    };
    if (productId) {
        where.productId = productId;
    }
    const saleItems = await prisma_1.prisma.saleItem.findMany({
        where,
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                },
            },
            sale: {
                select: {
                    id: true,
                    saleNumber: true,
                    invoiceNumber: true,
                    createdAt: true,
                },
            },
        },
        orderBy: {
            sale: {
                createdAt: 'desc',
            },
        },
    });
    const totalRevenue = saleItems.reduce((sum, item) => sum + item.totalPrice.toNumber(), 0);
    const totalCost = saleItems.reduce((sum, item) => sum + (item.costPrice?.toNumber() || 0) * item.quantity, 0);
    const totalProfit = saleItems.reduce((sum, item) => sum + (item.profit?.toNumber() || 0), 0);
    // Group by product (skip service items which have no productId)
    const byProduct = saleItems.reduce((acc, item) => {
        const productId = item.productId;
        if (productId === null)
            return acc;
        if (!acc[productId]) {
            acc[productId] = {
                product: item.product,
                revenue: 0,
                cost: 0,
                profit: 0,
                quantity: 0,
            };
        }
        acc[productId].revenue += item.totalPrice.toNumber();
        acc[productId].cost += (item.costPrice?.toNumber() || 0) * item.quantity;
        acc[productId].profit += item.profit?.toNumber() || 0;
        acc[productId].quantity += item.quantity;
        return acc;
    }, {});
    return {
        summary: {
            totalRevenue,
            totalCost,
            totalProfit,
            profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
            itemCount: saleItems.length,
        },
        byProduct: Object.values(byProduct),
        items: saleItems,
    };
}

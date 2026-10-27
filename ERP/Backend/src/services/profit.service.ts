import { prisma } from '../lib/prisma';
import { getCostAtSale } from './cost-price.service';

export interface CalculateProfitParams {
  saleItemId: number;
  batchId: number | null;
  unitPrice: number;
  quantity: number;
  saleDate: Date;
}

/**
 * Calculate profit for a sale item
 * Profit = (sellingPrice - costPrice) * quantity
 */
export async function calculateProfit(params: CalculateProfitParams): Promise<{
  costPrice: number;
  profit: number;
  profitMargin: number; // Percentage
}> {
  const { saleItemId, batchId, unitPrice, quantity, saleDate } = params;

  let costPrice = 0;

  if (batchId) {
    // Get cost from batch
    costPrice = await getCostAtSale(batchId, saleDate);
  } else {
    // If no batch, try to get from product's average cost or ledger
    // This is a fallback for products without batch tracking
    const saleItem = await prisma.saleItem.findUnique({
      where: { id: saleItemId },
      include: {
        product: true,
      },
    });

    if (saleItem && saleItem.productId) {
      // Try to get average cost from batches
      const batches = await prisma.batch.findMany({
        where: {
          productId: saleItem.productId,
          organizationId: (await prisma.sale.findUnique({
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
        const totalCost = batches.reduce(
          (sum, b) => sum + b.unitCost.toNumber() * Number(b.quantity),
          0
        );
        const totalQuantity = batches.reduce((sum, b) => sum + Number(b.quantity), 0);
        costPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
      } else {
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
export async function calculateAndStoreProfitForSale(saleId: number) {
  const sale = await prisma.sale.findUnique({
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
      quantity: Number(item.quantity),
      saleDate: sale.createdAt,
    });

    const updatedItem = await prisma.saleItem.update({
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
export async function getSaleProfitSummary(saleId: number) {
  const saleItems = await prisma.saleItem.findMany({
    where: { saleId },
    select: {
      unitPrice: true,
      costPrice: true,
      profit: true,
      quantity: true,
      totalPrice: true,
    },
  });

  const totalRevenue = saleItems.reduce(
    (sum, item) => sum + item.totalPrice.toNumber(),
    0
  );
  const totalCost = saleItems.reduce(
    (sum, item) => sum + (item.costPrice?.toNumber() || 0) * Number(item.quantity),
    0
  );
  const totalProfit = saleItems.reduce(
    (sum, item) => sum + (item.profit?.toNumber() || 0),
    0
  );
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
export async function getProfitReport(
  organizationId: number,
  startDate: Date,
  endDate: Date,
  productId?: number
) {
  const where: any = {
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

  const saleItems = await prisma.saleItem.findMany({
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

  const totalRevenue = saleItems.reduce(
    (sum, item) => sum + item.totalPrice.toNumber(),
    0
  );
  const totalCost = saleItems.reduce(
    (sum, item) => sum + (item.costPrice?.toNumber() || 0) * Number(item.quantity),
    0
  );
  const totalProfit = saleItems.reduce(
    (sum, item) => sum + (item.profit?.toNumber() || 0),
    0
  );

  // Group by product (skip service items which have no productId)
  const byProduct = saleItems.reduce((acc, item) => {
    const productId = item.productId;
    if (productId === null) return acc;
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
    acc[productId].cost += (item.costPrice?.toNumber() || 0) * Number(item.quantity);
    acc[productId].profit += item.profit?.toNumber() || 0;
    acc[productId].quantity += Number(item.quantity);
    return acc;
  }, {} as Record<number, any>);

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

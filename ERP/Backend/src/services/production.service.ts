import { Prisma, ItemType, InventoryMovementType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  removeStock,
  addStock,
  getCurrentStockInTransaction,
} from './inventory-ledger.service';
import { checkProductionRequirements, calculateBomCost } from './bom.service';

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export interface ProductionRunInput {
  organizationId: number;
  branchId: number;
  productId: number;
  quantity: number;
  userId: number;
  note?: string;
  batchNumber?: string;
  expiryDate?: Date | string;
}

export interface ProductionRunResult {
  productionRun: {
    id: number;
    productId: number;
    quantity: Prisma.Decimal;
    producedAt: Date;
    note: string | null;
  };
  consumedComponents: Array<{
    componentProductId: number;
    componentName: string;
    quantityConsumed: number;
    ledgerEntryId: number;
    batchId: number | null;
  }>;
  producedFinishedGoods: {
    productId: number;
    productName: string;
    quantityProduced: number;
    ledgerEntryId: number;
    batchId: number;
  };
  totalCost: number;
}

async function findBatchForConsumption(
  tx: PrismaClientOrTx,
  organizationId: number,
  productId: number,
  branchId: number,
  quantityNeeded: number,
  expiryDate?: Date | string,
): Promise<{ batchId: number; batchNumber: string; quantity: number } | null> {
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
    const available = Number(batch.quantity);
    if (available >= remaining) {
      return { batchId: batch.id, batchNumber: batch.batchNumber, quantity: remaining };
    }
    remaining -= available;
  }

  return null;
}

async function consumeFromBatches(
  tx: PrismaClientOrTx,
  organizationId: number,
  productId: number,
  branchId: number,
  quantityNeeded: number,
  userId: number,
  reference: string,
  referenceType: string,
  note: string,
  movementType: InventoryMovementType,
  expiryDate?: Date | string,
): Promise<Array<{ batchId: number; quantity: number; ledgerEntryId: number }>> {
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
    if (remaining <= 0) break;

    const consumeQty = Math.min(Number(batch.quantity), remaining);

    const ledgerEntry = await removeStock({
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

export async function runProduction(input: ProductionRunInput): Promise<ProductionRunResult> {
  const {
    organizationId,
    branchId,
    productId,
    quantity,
    userId,
    note,
    batchNumber,
    expiryDate,
  } = input;

  if (quantity <= 0) {
    throw new Error('Production quantity must be positive');
  }

  return await prisma.$transaction(async (tx) => {
    const requirements = await checkProductionRequirements(
      organizationId,
      productId,
      quantity,
      branchId,
      tx,
    );

    if (!requirements.canProduce) {
      const limit = requirements.limitingComponent!;
      throw new Error(
        `Insufficient stock for ${limit.componentName}. ` +
        `Required: ${limit.requiredQuantity}, Available: ${limit.availableStock}. ` +
        `Maximum producible: ${Math.floor(limit.availableStock / (limit.requiredQuantity / quantity))} units.`
      );
    }

    const bomCost = await calculateBomCost(organizationId, productId, tx);

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
      const consumed = await consumeFromBatches(
        tx,
        organizationId,
        comp.componentProductId,
        branchId,
        comp.requiredQuantity,
        userId,
        `PROD-${productionRun.id}-${comp.componentProductId}`,
        'PRODUCTION_CONSUME',
        `Consumed for production run #${productionRun.id} (${parentProduct.name})`,
        'PRODUCTION_CONSUME' as InventoryMovementType,
        expiryDate,
      );

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

    const producedLedgerEntry = await addStock({
      organizationId,
      productId,
      userId,
      quantity,
      movementType: 'PRODUCTION_OUTPUT' as InventoryMovementType,
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
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function getProductionRuns(
  organizationId: number,
  branchId?: number,
  productId?: number,
  startDate?: Date,
  endDate?: Date,
  page = 1,
  limit = 50,
) {
  const where: any = { organizationId };

  if (branchId) {
    // ProductionRun has no branch relation; output ledger entries record the branch.
    const outputEntries = await prisma.inventoryLedger.findMany({
      where: { organizationId, branchId, referenceType: 'PRODUCTION_OUTPUT' },
      select: { reference: true },
    });
    const runIds = outputEntries
      .map((entry) => /^PROD-(\d+)$/.exec(entry.reference || '')?.[1])
      .filter((id): id is string => !!id)
      .map(Number);
    where.id = { in: [...new Set(runIds)] };
  }
  if (productId) where.productId = productId;
  if (startDate || endDate) {
    where.producedAt = {};
    if (startDate) where.producedAt.gte = startDate;
    if (endDate) where.producedAt.lte = endDate;
  }

  const [runs, total] = await Promise.all([
    prisma.productionRun.findMany({
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
    prisma.productionRun.count({ where }),
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

export async function getProductionRunById(
  organizationId: number,
  runId: number,
) {
  const run = await prisma.productionRun.findFirst({
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

  if (!run) return null;

  const consumed = await prisma.inventoryLedger.findMany({
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

  const produced = await prisma.inventoryLedger.findFirst({
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

export async function reverseProductionRun(
  organizationId: number,
  runId: number,
  userId: number,
  note?: string,
): Promise<void> {
  const run = await prisma.productionRun.findFirst({
    where: { id: runId, organizationId },
    include: { product: true },
  });

  if (!run) {
    throw new Error('Production run not found');
  }

  await prisma.$transaction(async (tx) => {
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
      await addStock({
        organizationId,
        productId: entry.productId,
        userId,
        quantity: Number(entry.quantity),
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
          data: { quantity: { increment: Number(entry.quantity) } },
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
      await removeStock({
        organizationId,
        productId: produced.productId,
        userId,
        quantity: Number(produced.quantity),
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

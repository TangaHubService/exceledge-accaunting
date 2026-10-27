import { InventoryMovementType, InventoryDirection } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { enqueueInventoryMovementAccountingEvent } from './accounting-outbox.service';

function ebmSyncStatusFor(movementType: InventoryMovementType): 'PENDING' | null {
  if (movementType === 'INITIAL_STOCK') return null;
  return 'PENDING';
}

export function queueStockSync(entry: { id?: number; ebmSyncStatus?: string | null } | null | undefined) {
  if (!entry?.id || entry.ebmSyncStatus !== 'PENDING') return;
  const ledgerId = entry.id;
  setImmediate(() => {
    import('./stock-movement-sync.service')
      .then((m) => m.submitStockLedgerEntryToEbmAsync(ledgerId))
      .catch(() => undefined);
  });
}

/**
 * Serialize concurrent writers for the same (org, product, branch) stock.
 * The availability check is a ledger aggregate (non-locking groupBy), so two
 * simultaneous sales could both pass and oversell. The products-row FOR UPDATE
 * below does not serialize the aggregate read. A transaction-scoped advisory
 * lock on the stock key closes the race; it is released at commit/rollback.
 */
export async function acquireStockLock(
  tx: any,
  organizationId: number,
  productId: number,
  branchId: number | null | undefined,
) {
  const key = `stock:${organizationId}:${productId}:${branchId ?? 'null'}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
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
export const MOVEMENT_TYPES = {
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
} as const;

export const DIRECTIONS = {
  IN: 'IN',
  OUT: 'OUT',
} as const;

// Type definitions
export interface AddStockParams {
  organizationId: number;
  productId: number;
  userId: number;
  quantity: number;
  movementType: InventoryMovementType;
  branchId: number | null;
  warehouseId?: number | null; // Deprecated
  unitCost?: number;
  reference?: string;
  referenceType?: string;
  batchNumber?: string;
  expiryDate?: Date | string;
  note?: string;
  metadata?: Record<string, any>;
  /**
   * Skip queuing this movement for the RRA Stock In/Out sync. Used when the
   * stock change has already been reported to the VSDC by another call — e.g.
   * a confirmed B2B purchase, whose stock-in RRA books from
   * /trnsPurchase/savePurchases, so re-sending it via /stock/saveStockItems
   * would double-count.
   */
  skipEbmSync?: boolean;
  batchId?: number | null;
  tx?: any; // Optional transaction client for use within existing transactions
}

export interface RemoveStockParams {
  organizationId: number;
  productId: number;
  userId: number;
  quantity: number;
  movementType: InventoryMovementType;
  branchId: number | null;
  warehouseId?: number | null; // Deprecated
  batchId?: number | null;
  reference?: string;
  referenceType?: string;
  note?: string;
  metadata?: Record<string, any>;
  /** Cost the caller already used for this stock (e.g. a sale's batch cost); passed to Accounting only. */
  unitCost?: number | null;
  tx?: any; // Optional transaction client for use within existing transactions
}

export interface AdjustStockParams {
  organizationId: number;
  productId: number;
  userId: number;
  quantity: number; // Can be positive or negative
  branchId: number | null;
  warehouseId?: number | null; // Deprecated
  unitCost?: number;
  reference?: string;
  referenceType?: string;
  note?: string;
  metadata?: Record<string, any>;
}

export interface GetLedgerParams {
  organizationId: number;
  productId?: number;
  branchId?: number | null;
  warehouseId?: number | null; // Deprecated
  movementType?: InventoryMovementType;
  startDate?: Date | string;
  endDate?: Date | string;
  page?: number;
  limit?: number;
}

export interface GetSummaryParams {
  organizationId: number;
  productId?: number;
  branchId?: number | null;
  warehouseId?: number | null; // Deprecated
  fromDate?: Date | string; // 'inception' or specific date
}

/**
 * Get the current stock balance for a product (and optionally branch)
 * Calculated from ledger entries - this is the source of truth
 */
export async function getCurrentStock(
  organizationId: number,
  productId: number,
  branchId?: number | null
): Promise<number> {
  const where: any = {
    organizationId,
    productId,
  };

  if (branchId !== undefined && branchId !== null) {
    where.branchId = branchId;
  }

  // Efficient stock calculation using database aggregation with groupBy
  // Groups by direction (IN/OUT) and sums quantities for each
  const stockAggregates = await prisma.inventoryLedger.groupBy({
    by: ['direction'],
    where,
    _sum: {
      quantity: true,
    },
  });

  const inQty = stockAggregates.find((a: any) => a.direction === 'IN')?._sum.quantity || 0;
  const outQty = stockAggregates.find((a: any) => a.direction === 'OUT')?._sum.quantity || 0;
  const currentStock = Number(inQty) - Number(outQty);

  return currentStock;
}

/**
 * Get running balance at a specific point in time
 */
export async function getStockAtDate(
  organizationId: number,
  productId: number,
  atDate: Date | string,
  branchId?: number | null
): Promise<number> {
  const where: any = {
    organizationId,
    productId,
    createdAt: {
      lte: new Date(atDate),
    },
  };

  if (branchId !== undefined && branchId !== null) {
    where.branchId = branchId;
  }

  const ledgerEntries = await prisma.inventoryLedger.findMany({
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
      balance += Number(entry.quantity);
    } else {
      balance -= Number(entry.quantity);
    }
  }

  return balance;
}

/**
 * Add stock to inventory (Stock IN)
 * This is the primary function for adding inventory
 */
export async function addStock(params: AddStockParams) {
  const {
    organizationId,
    productId,
    userId,
    quantity,
    movementType,
    branchId = null,
    warehouseId = null,
    unitCost,
    reference,
    referenceType,
    batchNumber,
    expiryDate,
    note,
    metadata,
    skipEbmSync = false,
    tx: providedTx,
  } = params;

  // Validate quantity
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Quantity must be non-negative for stock IN operations');
  }

  // Use provided transaction client or create a new one
  const executeInTransaction = async (tx: any) => {
    // Serialize writers for this stock key (oversell guard — S2/S14).
    await acquireStockLock(tx, organizationId, productId, branchId);
    // Lock product row using FOR UPDATE to prevent race conditions
    const product = await tx.$queryRaw<Array<{ id: number; quantity: number; name: string }>>`
      SELECT id, quantity, name
      FROM products
      WHERE id = ${productId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;

    if (!product || product.length === 0) {
      throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
    }

    // Get current balance before this movement
    const currentBalance = await getCurrentStockInTransaction(
      tx,
      organizationId,
      productId,
      branchId
    );

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
    await enqueueInventoryMovementAccountingEvent(tx, ledgerEntry);

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
  const product = await prisma.product.findFirst({
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
    const branch = await prisma.branch.findFirst({
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
  const entry = await prisma.$transaction(async (tx) => {
    return await executeInTransaction(tx);
  });
  queueStockSync(entry);
  return entry;
}

/**
 * Active branch to book stock against: an explicit id, otherwise the org default.
 */
export async function resolveActiveBranchId(
  organizationId: number,
  preferred?: number | null,
): Promise<number | null> {
  if (preferred != null) return preferred;
  const b = await prisma.branch.findFirst({
    where: { organizationId, status: 'ACTIVE' },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  return b?.id ?? null;
}

/**
 * Book a received quantity into both the ledger and the branch batch that POS
 * / inventory listings use as on-hand stock. `addStock` alone only updates the
 * ledger + Product.quantity cache, so EBM receipts would raise VSDC stock
 * without changing what cashiers see locally.
 */
export async function receiveStockOnBranch(params: AddStockParams) {
  const branchId = await resolveActiveBranchId(params.organizationId, params.branchId);
  if (branchId == null) {
    throw new Error('No active branch available to book received stock');
  }
  if (params.quantity <= 0) return null;

  const batchNumber = params.batchNumber || params.reference || `RCV-${params.productId}`;
  const unitCost = params.unitCost ?? 0;
  const expiryDate = params.expiryDate ? new Date(params.expiryDate) : null;

  const run = async (tx: any) => {
    await tx.batch.upsert({
      where: {
        productId_batchNumber_branchId: {
          productId: params.productId,
          batchNumber,
          branchId,
        },
      },
      update: {
        quantity: { increment: params.quantity },
        unitCost,
        isActive: true,
        ...(expiryDate ? { expiryDate } : {}),
      },
      create: {
        productId: params.productId,
        organizationId: params.organizationId,
        branchId,
        batchNumber,
        quantity: params.quantity,
        unitCost,
        isActive: true,
        expiryDate,
      },
    });
    return addStock({ ...params, branchId, batchNumber, unitCost, tx });
  };

  if (params.tx) return run(params.tx);
  // addStock skips queueStockSync when it receives an outer `tx`; queue here so
  // standalone receives (imports, PO receipts, etc.) still push to VSDC.
  const entry = await prisma.$transaction((tx) => run(tx));
  queueStockSync(entry);
  return entry;
}

/**
 * Remove stock from inventory (Stock OUT)
 * This is the primary function for removing inventory
 */
export async function removeStock(params: RemoveStockParams) {
  const {
    organizationId,
    productId,
    userId,
    quantity,
    movementType,
    branchId = null,
    warehouseId = null,
    batchId = null,
    reference,
    referenceType,
    note,
    metadata,
    unitCost,
    tx: providedTx,
  } = params;

  // Validate quantity
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be positive for stock OUT operations');
  }

  // Use provided transaction client or create a new one
  const executeInTransaction = async (tx: any) => {
    // Serialize writers for this stock key (oversell guard — S2/S14).
    await acquireStockLock(tx, organizationId, productId, branchId);
    // Lock product row using FOR UPDATE to prevent race conditions
    const product = await tx.$queryRaw<Array<{ id: number; quantity: number; name: string }>>`
      SELECT id, quantity, name
      FROM products
      WHERE id = ${productId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;

    if (!product || product.length === 0) {
      throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
    }

    // Get current balance from ledger (source of truth)
    const currentBalance = await getCurrentStockInTransaction(
      tx,
      organizationId,
      productId,
      branchId
    );

    // Check if sufficient stock available
    if (currentBalance < quantity) {
      throw new Error(
        `Insufficient stock. Available: ${currentBalance}, Requested: ${quantity}`
      );
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
    await enqueueInventoryMovementAccountingEvent(tx, ledgerEntry, { unitCost });

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
  const product = await prisma.product.findFirst({
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
    const branch = await prisma.branch.findFirst({
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
  const entry = await prisma.$transaction(async (tx) => {
    return await executeInTransaction(tx);
  });
  queueStockSync(entry);
  return entry;
}

/**
 * Adjust stock (can be positive or negative)
 * Used for manual corrections and adjustments
 */
export async function adjustStock(params: AdjustStockParams) {
  const {
    organizationId,
    productId,
    userId,
    quantity, // Can be positive or negative
    branchId,
    warehouseId = null,
    unitCost,
    reference,
    referenceType,
    note,
    metadata,
  } = params;

  // Require branchId — no silent fallback to prevent cross-branch data leakage
  if (branchId === null || branchId === undefined) {
    throw new Error('Branch ID is required for stock adjustments');
  }

  // Validate quantity is not zero
  if (quantity === 0) {
    throw new Error('Adjustment quantity cannot be zero');
  }

  // Validate product exists
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId,
    },
  });

  if (!product) {
    throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
  }

  // Validate branch exists and is active
  const branch = await prisma.branch.findFirst({
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
  const entry = await prisma.$transaction(async (tx) => {
    // Serialize writers for this stock key (oversell guard — S2/S14).
    await acquireStockLock(tx, organizationId, productId, branchId);
    // Lock product row using FOR UPDATE to prevent race conditions — matches
    // addStock/removeStock so a concurrent sale/adjustment on the same product
    // can't read the same pre-adjustment balance and push stock negative.
    const lockedProduct = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM products
      WHERE id = ${productId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;

    if (!lockedProduct || lockedProduct.length === 0) {
      throw new Error(`Product with ID ${productId} not found in organization ${organizationId}`);
    }

    // Get current balance for this specific branch
    const currentBalance = await getCurrentStockInTransaction(
      tx,
      organizationId,
      productId,
      branchId
    );

    // Determine direction and movement type
    const direction: InventoryDirection = quantity > 0 ? 'IN' : 'OUT';
    const movementType: InventoryMovementType =
      quantity > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
    const absoluteQuantity = Math.abs(quantity);

    // Check if negative adjustment would result in negative stock
    if (direction === 'OUT' && currentBalance < absoluteQuantity) {
      throw new Error(
        `Adjustment would result in negative stock. Available: ${currentBalance}, Adjustment: ${absoluteQuantity}`
      );
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
        metadata: metadata ? (metadata as any) : undefined,
        ebmSyncStatus: ebmSyncStatusFor(movementType),
      } as any,
    });
    await enqueueInventoryMovementAccountingEvent(tx, ledgerEntry);

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
  queueStockSync(entry);
  return entry;
}

/**
 * Get ledger entries with pagination and filtering
 */
export async function getLedger(params: GetLedgerParams) {
  const {
    organizationId,
    productId,
    branchId,
    warehouseId,
    movementType,
    startDate,
    endDate,
    page = 1,
    limit = 50,
  } = params;

  const where: any = {
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
    prisma.inventoryLedger.findMany({
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
        } as any,
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    }),
    prisma.inventoryLedger.count({ where }),
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
export async function getInventorySummary(params: GetSummaryParams) {
  const {
    organizationId,
    productId,
    warehouseId,
    fromDate = 'inception',
  } = params;

  const where: any = {
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
  const entries = await prisma.inventoryLedger.findMany({
    where: where as any,
    select: {
      productId: true,
      branchId: true,
      direction: true,
      quantity: true,
      movementType: true,
      unitCost: true,
      totalCost: true,
      createdAt: true,
    } as any,
    orderBy: {
      createdAt: 'asc',
    },
  }) as any[];

  // Aggregate by product (and optionally warehouse)
  const summary: Record<string, any> = {};

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
    } else {
      item.totalOut += entry.quantity;
      item.currentStock -= entry.quantity;
      item.movements.OUT += 1;
    }

    if (entry.totalCost) {
      if (entry.direction === 'IN') {
        item.totalCost += Number(entry.totalCost);
      } else {
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
export async function getCurrentStockInTransaction(
  tx: any,
  organizationId: number,
  productId: number,
  branchId?: number | null,
  warehouseId?: number | null
): Promise<number> {
  const where: any = {
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
  const inQty = stockAggregates.find((a: any) => a.direction === 'IN')?._sum.quantity || 0;
  const outQty = stockAggregates.find((a: any) => a.direction === 'OUT')?._sum.quantity || 0;
  const currentStock = Number(inQty) - Number(outQty);

  return currentStock;
}

/**
 * Recalculate and update product quantity cache from ledger
 * Useful for data integrity checks or after manual ledger corrections
 */
export async function recalculateProductStock(
  organizationId: number,
  productId: number,
  branchId?: number | null
) {
  const currentStock = await getCurrentStock(organizationId, productId, branchId);

  await prisma.product.update({
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
export async function getInventoryHistory(
  organizationId: number,
  productId: number,
  warehouseId?: number | null,
  branchId?: number | null
) {
  const where: any = {
    organizationId,
    productId,
  };

  if (branchId !== undefined && branchId !== null) {
    where.branchId = branchId;
  }

  const entries = await prisma.inventoryLedger.findMany({
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

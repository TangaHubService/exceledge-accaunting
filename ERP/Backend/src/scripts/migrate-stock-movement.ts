/**
 * Migration Script: StockMovement to InventoryLedger
 * 
 * This script migrates all data from the StockMovement table to InventoryLedger.
 * It preserves all historical data including timestamps, quantities, and references.
 * 
 * Usage:
 *   npx ts-node src/scripts/migrate-stock-movement.ts
 * 
 * Or with tsx:
 *   npx tsx src/scripts/migrate-stock-movement.ts
 */

import { PrismaClient, StockMovementType } from '@prisma/client';

const prisma = new PrismaClient();

interface StockMovementRecord {
  id: number;
  organizationId: number;
  productId: number;
  userId: number;
  type: StockMovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  note: string | null;
  reference: string | null;
  createdAt: Date;
}

/**
 * Map StockMovementType to InventoryMovementType and Direction
 */
function mapMovementType(type: StockMovementType): {
  movementType: string;
  direction: 'IN' | 'OUT';
} {
  const mapping: Record<StockMovementType, { movementType: string; direction: 'IN' | 'OUT' }> = {
    PURCHASE: { movementType: 'PURCHASE', direction: 'IN' },
    SALE: { movementType: 'SALE', direction: 'OUT' },
    RETURN: { movementType: 'RETURN_CUSTOMER', direction: 'IN' },
    ADJUSTMENT: { movementType: 'ADJUSTMENT', direction: 'IN' },
    DAMAGE: { movementType: 'DAMAGE', direction: 'OUT' },
    EXPIRED: { movementType: 'EXPIRED', direction: 'OUT' },
    //@ts-ignore
    TRANSFER: { movementType: 'TRANSFER_IN', direction: 'IN' },
  };

  const defaultMapping = mapping[type];
  if (defaultMapping) {
    return defaultMapping;
  }
  // Fallback: determine direction from quantity
  return { movementType: 'ADJUSTMENT', direction: 'IN' };
}

/**
 * Calculate running balance for a product up to a given date
 */
async function getRunningBalanceUpTo(
  organizationId: number,
  productId: number,
  upToDate: Date,
  excludeId?: number
): Promise<number> {
  const ledgerEntries = await prisma.inventoryLedger.findMany({
    where: {
      organizationId,
      productId,
      createdAt: { lte: upToDate },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
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
 * Migrate a single StockMovement record to InventoryLedger
 */
async function migrateStockMovement(record: StockMovementRecord): Promise<void> {
  try {
    // Check if already migrated (by reference)
    const existing = await prisma.inventoryLedger.findFirst({
      where: {
        organizationId: record.organizationId,
        productId: record.productId,
        reference: record.reference || `STOCK_MOVEMENT_${record.id}`,
        referenceType: 'STOCK_MOVEMENT',
      },
    });

    if (existing) {
      console.log(`  Skipping StockMovement ${record.id} - already migrated`);
      return;
    }

    // Determine movement type and direction
    const { movementType, direction } = mapMovementType(record.type);
    const absoluteQuantity = Math.abs(record.quantity);

    // Calculate running balance at this point in time
    // We need to get balance before this movement, then add/subtract
    const balanceBefore = await getRunningBalanceUpTo(
      record.organizationId,
      record.productId,
      new Date(record.createdAt.getTime() - 1) // Just before this movement
    );

    const runningBalance = direction === 'IN'
      ? balanceBefore + absoluteQuantity
      : balanceBefore - absoluteQuantity;

    // Get first branch for organization to use as default branchId (order by id to get oldest)
    const firstBranch = await prisma.branch.findFirst({
      where: { organizationId: record.organizationId },
      orderBy: { id: 'asc' },
      select: { id: true }
    });

    if (!firstBranch) {
      throw new Error(`No branch found for organization ${record.organizationId}`);
    }

    // Create InventoryLedger entry
    await prisma.inventoryLedger.create({
      data: {
        organizationId: record.organizationId,
        productId: record.productId,
        branchId: firstBranch.id, // Assign to first/primary branch
        warehouseId: null, // StockMovement didn't have warehouse
        userId: record.userId,
        movementType: movementType as any,
        direction,
        quantity: absoluteQuantity,
        runningBalance,
        reference: record.reference || `STOCK_MOVEMENT_${record.id}`,
        referenceType: 'STOCK_MOVEMENT',
        note: record.note || `Migrated from StockMovement ${record.id}`,
        metadata: {
          migratedFrom: 'StockMovement',
          originalId: record.id,
          originalType: record.type,
          previousStock: record.previousStock,
          newStock: record.newStock,
        },
        createdAt: record.createdAt,
      },
    });

    console.log(`  ✓ Migrated StockMovement ${record.id} -> InventoryLedger`);
  } catch (error: any) {
    console.error(`  ✗ Error migrating StockMovement ${record.id}:`, error.message);
    throw error;
  }
}

/**
 * Main migration function
 */
async function migrateStockMovements() {
  console.log('Starting StockMovement to InventoryLedger migration...\n');

  try {
    // Get all StockMovement records, ordered by creation date
    const stockMovements = await prisma.$queryRaw<StockMovementRecord[]>`
      SELECT 
        id,
        "organizationId",
        "productId",
        "userId",
        type,
        quantity,
        "previousStock",
        "newStock",
        note,
        reference,
        "createdAt"
      FROM "stock_movements"
      ORDER BY "createdAt" ASC, id ASC
    `;

    console.log(`Found ${stockMovements.length} StockMovement records to migrate\n`);

    if (stockMovements.length === 0) {
      console.log('No records to migrate. Exiting.');
      return;
    }

    // Migrate in batches to avoid memory issues
    const batchSize = 100;
    let migrated = 0;
    let errors = 0;

    for (let i = 0; i < stockMovements.length; i += batchSize) {
      const batch = stockMovements.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} records)...`);

      for (const record of batch) {
        try {
          await migrateStockMovement(record);
          migrated++;
        } catch (error) {
          errors++;
          console.error(`Failed to migrate StockMovement ${record.id}:`, error);
        }
      }

      console.log(`Batch complete. Progress: ${migrated}/${stockMovements.length} migrated, ${errors} errors\n`);
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total records: ${stockMovements.length}`);
    console.log(`Successfully migrated: ${migrated}`);
    console.log(`Errors: ${errors}`);
    console.log('\nMigration complete!');

    if (errors === 0) {
      console.log('\n⚠️  Next steps:');
      console.log('1. Verify the migrated data in InventoryLedger');
      console.log('2. Update product.quantity from InventoryLedger if needed');
      console.log('3. Once verified, you can drop the StockMovement table:');
      console.log('   DROP TABLE "stock_movements";');
    }
  } catch (error: any) {
    console.error('\nFatal error during migration:', error);
    throw error;
  }
}

// Run migration
if (require.main === module) {
  migrateStockMovements()
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { migrateStockMovements };

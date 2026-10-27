import { PrismaClient, BranchStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Migration script to convert existing warehouse data to branch-based system
 * 
 * This script:
 * 1. Creates a branch for each active warehouse
 * 2. Migrates batches from warehouseId to branchId
 * 3. Migrates inventory ledgers from warehouseId to branchId
 * 4. Assigns all organization users to all branches (can be refined later)
 * 5. Sets the first branch as primary for each user
 */
async function migrateWarehousesToBranches() {
    console.log('🚀 Starting warehouse to branch migration...\n');

    try {
        // Get all active warehouses
        const warehouses = await prisma.warehouse.findMany({
            where: { isActive: true },
            include: {
                organization: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        console.log(`📦 Found ${warehouses.length} active warehouses to migrate\n`);

        let migratedCount = 0;
        let skippedCount = 0;

        for (const warehouse of warehouses) {
            console.log(`\n📍 Processing warehouse: ${warehouse.name} (ID: ${warehouse.id})`);
            console.log(`   Organization: ${warehouse.organization.name}`);

            // Check if branch already exists for this warehouse
            const existingBranch = await prisma.branch.findFirst({
                where: {
                    organizationId: warehouse.organizationId,
                    code: warehouse.code || `WH-${warehouse.id}`,
                },
            });

            if (existingBranch) {
                console.log(`   ⚠️  Branch already exists, skipping...`);
                skippedCount++;
                continue;
            }

            await prisma.$transaction(async (tx) => {
                // 1. Create corresponding branch
                const branch = await tx.branch.create({
                    data: {
                        organizationId: warehouse.organizationId,
                        name: warehouse.name,
                        code: warehouse.code || `WH-${warehouse.id}`,
                        address: warehouse.address,
                        status: warehouse.isActive ? BranchStatus.ACTIVE : BranchStatus.INACTIVE,
                        metadata: {
                            migratedFromWarehouseId: warehouse.id,
                            migratedAt: new Date().toISOString(),
                        },
                    },
                });

                console.log(`   ✅ Created branch: ${branch.name} (ID: ${branch.id})`);

                // 2. Update batches
                const batchUpdateResult = await tx.batch.updateMany({
                    where: {
                        warehouseId: warehouse.id,
                        branchId: null, // Only update if not already migrated
                    },
                    data: {
                        branchId: branch.id,
                    },
                });

                console.log(`   📦 Updated ${batchUpdateResult.count} batches`);

                // 3. Update inventory ledgers
                const ledgerUpdateResult = await tx.inventoryLedger.updateMany({
                    where: {
                        warehouseId: warehouse.id,
                        branchId: null, // Only update if not already migrated
                    },
                    data: {
                        branchId: branch.id,
                    },
                });

                console.log(`   📊 Updated ${ledgerUpdateResult.count} inventory ledger entries`);

                // 4. Assign all organization users to this branch
                const orgUsers = await tx.userOrganization.findMany({
                    where: {
                        organizationId: warehouse.organizationId,
                    },
                    select: {
                        userId: true,
                    },
                });

                let assignedUsers = 0;
                for (const { userId } of orgUsers) {
                    // Check if user is already assigned to this branch
                    const existingAssignment = await tx.userBranch.findUnique({
                        where: {
                            userId_branchId: {
                                userId,
                                branchId: branch.id,
                            },
                        },
                    });

                    if (!existingAssignment) {
                        // Check if user has any primary branch
                        const hasPrimaryBranch = await tx.userBranch.findFirst({
                            where: {
                                userId,
                                isPrimary: true,
                            },
                        });

                        await tx.userBranch.create({
                            data: {
                                userId,
                                branchId: branch.id,
                                isPrimary: !hasPrimaryBranch, // Set as primary if user has no primary branch
                            },
                        });

                        assignedUsers++;
                    }
                }

                console.log(`   👥 Assigned ${assignedUsers} users to branch`);
            });

            migratedCount++;
        }

        console.log('\n\n✨ Migration Summary:');
        console.log(`   ✅ Successfully migrated: ${migratedCount} warehouses`);
        console.log(`   ⚠️  Skipped (already exists): ${skippedCount} warehouses`);
        console.log(`   📊 Total processed: ${warehouses.length} warehouses`);

        // Verify migration
        console.log('\n🔍 Verification:');
        const branchCount = await prisma.branch.count();
        const batchesWithBranch = await prisma.batch.count({
            where: { branchId: { not: null } },
        });
        const ledgersWithBranch = await prisma.inventoryLedger.count({
            where: { branchId: { not: null } },
        });

        console.log(`   📍 Total branches: ${branchCount}`);
        console.log(`   📦 Batches with branchId: ${batchesWithBranch}`);
        console.log(`   📊 Ledger entries with branchId: ${ledgersWithBranch}`);

        console.log('\n✅ Migration completed successfully!');
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run migration
migrateWarehousesToBranches()
    .then(() => {
        console.log('\n🎉 All done!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Fatal error:', error);
        process.exit(1);
    });

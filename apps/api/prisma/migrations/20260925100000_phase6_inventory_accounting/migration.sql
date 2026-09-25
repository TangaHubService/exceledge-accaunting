-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'CUSTOMER_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRED', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalBranchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "erpQuantity" DECIMAL(18,4),
    "erpQuantityAt" TIMESTAMP(3),
    "openingRecorded" BOOLEAN NOT NULL DEFAULT false,
    "lastMovementAt" TIMESTAMP(3),
    "lastIssueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "quantityIn" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityOut" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityAfter" DECIMAL(18,4) NOT NULL,
    "valueAfter" DECIMAL(18,4) NOT NULL,
    "costSource" TEXT NOT NULL,
    "erpMovementType" TEXT,
    "erpLedgerId" TEXT,
    "erpQuantityAfter" DECIMAL(18,4),
    "reference" TEXT,
    "referenceType" TEXT,
    "batchNumber" TEXT,
    "note" TEXT,
    "integrationEventId" TEXT,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_cost_layers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "remaining" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_items_companyId_name_idx" ON "inventory_items"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_companyId_externalProductId_key" ON "inventory_items"("companyId", "externalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_companyId_externalBranchId_key" ON "inventory_locations"("companyId", "externalBranchId");

-- CreateIndex
CREATE INDEX "inventory_balances_companyId_idx" ON "inventory_balances"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_itemId_locationId_key" ON "inventory_balances"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_movements_companyId_movementDate_idx" ON "inventory_movements"("companyId", "movementDate");

-- CreateIndex
CREATE INDEX "inventory_movements_companyId_kind_movementDate_idx" ON "inventory_movements"("companyId", "kind", "movementDate");

-- CreateIndex
CREATE INDEX "inventory_movements_itemId_locationId_movementDate_idx" ON "inventory_movements"("itemId", "locationId", "movementDate");

-- CreateIndex
CREATE INDEX "inventory_movements_integrationEventId_idx" ON "inventory_movements"("integrationEventId");

-- CreateIndex
CREATE INDEX "inventory_movements_reference_itemId_idx" ON "inventory_movements"("reference", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_companyId_sourceKey_key" ON "inventory_movements"("companyId", "sourceKey");

-- CreateIndex
CREATE INDEX "inventory_cost_layers_itemId_locationId_receivedAt_idx" ON "inventory_cost_layers"("itemId", "locationId", "receivedAt");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


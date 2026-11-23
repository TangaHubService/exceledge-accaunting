-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('SERVICE', 'NON_INVENTORY', 'INVENTORY');

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "expenseAccountId" TEXT,
ADD COLUMN     "incomeAccountId" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "preferredSupplierId" TEXT,
ADD COLUMN     "purchaseCost" DECIMAL(18,4),
ADD COLUMN     "purchaseDescription" TEXT,
ADD COLUMN     "purchaseTaxCode" TEXT,
ADD COLUMN     "reorderPoint" DECIMAL(18,4),
ADD COLUMN     "salesDescription" TEXT,
ADD COLUMN     "salesPrice" DECIMAL(18,4),
ADD COLUMN     "salesTaxCode" TEXT,
ADD COLUMN     "type" "ItemType" NOT NULL DEFAULT 'INVENTORY',
ALTER COLUMN "externalProductId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "inventory_items_companyId_type_isActive_idx" ON "inventory_items"("companyId", "type", "isActive");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

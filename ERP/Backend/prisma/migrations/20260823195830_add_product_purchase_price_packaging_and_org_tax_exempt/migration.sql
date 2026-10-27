-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "isTaxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxExemptionReason" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "packagingQty" INTEGER,
ADD COLUMN     "purchasePrice" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "products" DROP COLUMN "useBarcode",
DROP COLUMN "useExpiration",
ADD COLUMN     "additionalInfo" TEXT,
ADD COLUMN     "itemStandardName" TEXT,
ADD COLUMN     "l2SalePrice" DECIMAL(10,2),
ADD COLUMN     "l3SalePrice" DECIMAL(10,2),
ADD COLUMN     "l4SalePrice" DECIMAL(10,2),
ADD COLUMN     "l5SalePrice" DECIMAL(10,2);


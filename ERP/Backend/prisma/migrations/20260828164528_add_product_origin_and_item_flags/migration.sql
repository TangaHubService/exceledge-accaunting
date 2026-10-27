-- AlterTable
ALTER TABLE "products" ADD COLUMN     "l1SalePrice" DECIMAL(10,2),
ADD COLUMN     "origin" TEXT DEFAULT 'RW',
ADD COLUMN     "useBarcode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useExpiration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useInsurance" BOOLEAN NOT NULL DEFAULT false;

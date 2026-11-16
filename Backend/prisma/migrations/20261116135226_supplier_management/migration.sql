-- Supplier management redesign: QuickBooks-style vendor fields and a dated notes history.
-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('BUSINESS', 'INDIVIDUAL', 'GOVERNMENT', 'NON_PROFIT');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "alternateContact" TEXT,
ADD COLUMN     "bankAccountHolder" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "internalRemarks" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "preferredPaymentMethod" "ApPaymentMethod",
ADD COLUMN     "supplierType" "SupplierType" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "supplier_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_notes_companyId_supplierId_createdAt_idx" ON "supplier_notes"("companyId", "supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "supplier_notes" ADD CONSTRAINT "supplier_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_notes" ADD CONSTRAINT "supplier_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

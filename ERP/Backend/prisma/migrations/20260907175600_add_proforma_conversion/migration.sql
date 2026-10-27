-- AlterEnum
ALTER TYPE "SaleStatus" ADD VALUE 'CONVERTED';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "proforma_source_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "sales_proforma_source_id_key" ON "sales"("proforma_source_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_proforma_source_id_fkey" FOREIGN KEY ("proforma_source_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

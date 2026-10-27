-- Normal Refund (NR) record: capture the refund recipient on refund rows
-- (defaults to the original customer name) and index the original-sale link
-- used for remaining-refundable-quantity lookups.
-- Reversible: see down.sql.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "refund_recipient" TEXT;

-- CreateIndex
CREATE INDEX "sales_original_sale_id_idx" ON "sales"("original_sale_id");

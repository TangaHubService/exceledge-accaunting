-- Revert refund_recipient + original_sale_id index.

-- DropIndex
DROP INDEX "sales_original_sale_id_idx";

-- AlterTable
ALTER TABLE "sales" DROP COLUMN "refund_recipient";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "local_receipt_total_seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "local_receipt_total_seq" INTEGER;

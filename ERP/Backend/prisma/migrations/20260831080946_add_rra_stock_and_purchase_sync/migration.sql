-- CreateEnum
CREATE TYPE "RraPurchaseStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "inventory_ledger" ADD COLUMN     "ebmError" TEXT,
ADD COLUMN     "ebmSarNo" INTEGER,
ADD COLUMN     "ebmSyncStatus" "EbmSyncStatus",
ADD COLUMN     "ebmSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "TIN" TEXT;

-- CreateTable
CREATE TABLE "rra_purchases" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "spplrTin" TEXT NOT NULL,
    "spplrNm" TEXT,
    "spplrBhfId" TEXT,
    "spplrInvcNo" BIGINT NOT NULL,
    "rcptTyCd" TEXT,
    "pmtTyCd" TEXT,
    "salesDt" TEXT,
    "totItemCnt" INTEGER,
    "totTaxblAmt" DECIMAL(15,2),
    "totTaxAmt" DECIMAL(15,2),
    "totAmt" DECIMAL(15,2),
    "remark" TEXT,
    "status" "RraPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "purchaseOrderId" INTEGER,
    "rawResponse" JSONB,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rra_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rra_purchase_items" (
    "id" SERIAL NOT NULL,
    "rraPurchaseId" INTEGER NOT NULL,
    "itemSeq" INTEGER NOT NULL,
    "itemCd" TEXT,
    "itemClsCd" TEXT,
    "itemNm" TEXT,
    "bcd" TEXT,
    "pkgUnitCd" TEXT,
    "pkg" DECIMAL(15,2),
    "qtyUnitCd" TEXT,
    "qty" DECIMAL(15,2) NOT NULL,
    "prc" DECIMAL(15,2) NOT NULL,
    "splyAmt" DECIMAL(15,2) NOT NULL,
    "dcRt" DECIMAL(5,2),
    "dcAmt" DECIMAL(15,2),
    "taxTyCd" TEXT,
    "taxblAmt" DECIMAL(15,2),
    "taxAmt" DECIMAL(15,2),
    "totAmt" DECIMAL(15,2),

    CONSTRAINT "rra_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rra_purchases_organizationId_status_idx" ON "rra_purchases"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rra_purchases_organizationId_spplrTin_spplrInvcNo_key" ON "rra_purchases"("organizationId", "spplrTin", "spplrInvcNo");

-- CreateIndex
CREATE INDEX "rra_purchase_items_rraPurchaseId_idx" ON "rra_purchase_items"("rraPurchaseId");

-- CreateIndex
CREATE INDEX "inventory_ledger_organizationId_ebmSyncStatus_idx" ON "inventory_ledger"("organizationId", "ebmSyncStatus");

-- AddForeignKey
ALTER TABLE "rra_purchases" ADD CONSTRAINT "rra_purchases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rra_purchase_items" ADD CONSTRAINT "rra_purchase_items_rraPurchaseId_fkey" FOREIGN KEY ("rraPurchaseId") REFERENCES "rra_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "RraImportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "rra_import_items" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "taskCd" TEXT NOT NULL,
    "dclNo" TEXT,
    "dclDe" TEXT NOT NULL,
    "itemSeq" INTEGER NOT NULL,
    "hsCd" TEXT,
    "itemNm" TEXT,
    "orgnNatCd" TEXT,
    "exptNatCd" TEXT,
    "pkg" DECIMAL(15,3),
    "pkgUnitCd" TEXT,
    "qty" DECIMAL(15,3),
    "qtyUnitCd" TEXT,
    "totWt" DECIMAL(15,3),
    "netWt" DECIMAL(15,3),
    "spplrNm" TEXT,
    "agntNm" TEXT,
    "invcFcurAmt" DECIMAL(18,4),
    "invcFcurCd" TEXT,
    "invcFcurExcrt" DECIMAL(18,6),
    "itemCd" TEXT,
    "itemClsCd" TEXT,
    "status" "RraImportStatus" NOT NULL DEFAULT 'PENDING',
    "remark" TEXT,
    "actionedAt" TIMESTAMP(3),
    "linkedProductId" INTEGER,
    "rawResponse" JSONB,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rra_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rra_import_items_organizationId_status_idx" ON "rra_import_items"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rra_import_items_organizationId_taskCd_dclDe_itemSeq_key" ON "rra_import_items"("organizationId", "taskCd", "dclDe", "itemSeq");

-- AddForeignKey
ALTER TABLE "rra_import_items" ADD CONSTRAINT "rra_import_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

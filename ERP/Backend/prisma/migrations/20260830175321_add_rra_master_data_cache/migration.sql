-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "rraTaxprSttsCd" TEXT,
ADD COLUMN     "rraVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "rraVerifiedName" TEXT;

-- CreateTable
CREATE TABLE "rra_codes" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "cdCls" TEXT NOT NULL,
    "cdClsNm" TEXT,
    "cd" TEXT NOT NULL,
    "cdNm" TEXT,
    "cdDesc" TEXT,
    "useYn" TEXT NOT NULL DEFAULT 'Y',
    "srtOrd" INTEGER,
    "userDfnCd1" TEXT,
    "userDfnCd2" TEXT,
    "userDfnCd3" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rra_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rra_item_classes" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "itemClsCd" TEXT NOT NULL,
    "itemClsNm" TEXT,
    "itemClsLvl" INTEGER,
    "taxTyCd" TEXT,
    "mjrTgYn" TEXT,
    "useYn" TEXT NOT NULL DEFAULT 'Y',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rra_item_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rra_notices" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "noticeNo" INTEGER NOT NULL,
    "title" TEXT,
    "cont" TEXT,
    "dtlUrl" TEXT,
    "regrNm" TEXT,
    "regDt" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "rra_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rra_sync_cursors" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "resource" TEXT NOT NULL,
    "lastReqDt" TEXT NOT NULL DEFAULT '20200101000000',
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,

    CONSTRAINT "rra_sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rra_codes_organizationId_cdCls_idx" ON "rra_codes"("organizationId", "cdCls");

-- CreateIndex
CREATE UNIQUE INDEX "rra_codes_organizationId_cdCls_cd_key" ON "rra_codes"("organizationId", "cdCls", "cd");

-- CreateIndex
CREATE INDEX "rra_item_classes_organizationId_itemClsLvl_idx" ON "rra_item_classes"("organizationId", "itemClsLvl");

-- CreateIndex
CREATE UNIQUE INDEX "rra_item_classes_organizationId_itemClsCd_key" ON "rra_item_classes"("organizationId", "itemClsCd");

-- CreateIndex
CREATE INDEX "rra_notices_organizationId_readAt_idx" ON "rra_notices"("organizationId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "rra_notices_organizationId_noticeNo_key" ON "rra_notices"("organizationId", "noticeNo");

-- CreateIndex
CREATE UNIQUE INDEX "rra_sync_cursors_organizationId_resource_key" ON "rra_sync_cursors"("organizationId", "resource");

-- AddForeignKey
ALTER TABLE "rra_codes" ADD CONSTRAINT "rra_codes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rra_item_classes" ADD CONSTRAINT "rra_item_classes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rra_notices" ADD CONSTRAINT "rra_notices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rra_sync_cursors" ADD CONSTRAINT "rra_sync_cursors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

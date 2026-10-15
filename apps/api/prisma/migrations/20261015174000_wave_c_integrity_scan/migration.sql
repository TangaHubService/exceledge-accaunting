-- CreateTable
CREATE TABLE "integrity_scans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "runByErpUserId" INTEGER,
    "findingCount" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integrity_scans_companyId_createdAt_idx" ON "integrity_scans"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "integrity_scans" ADD CONSTRAINT "integrity_scans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

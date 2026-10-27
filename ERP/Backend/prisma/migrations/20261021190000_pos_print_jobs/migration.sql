-- CreateEnum
CREATE TYPE "PosPrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "pos_print_jobs" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "saleId" INTEGER NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "status" "PosPrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" INTEGER,
    "claimedById" INTEGER,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_print_jobs_organizationId_branchId_status_createdAt_idx" ON "pos_print_jobs"("organizationId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "pos_print_jobs_saleId_status_idx" ON "pos_print_jobs"("saleId", "status");

-- AddForeignKey
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

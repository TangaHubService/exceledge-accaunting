-- CreateEnum
CREATE TYPE "AccountingOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "erp_accounting_outbox" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "saleId" INTEGER,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AccountingOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_accounting_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "erp_accounting_outbox_idempotencyKey_key" ON "erp_accounting_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "erp_accounting_outbox_organizationId_status_idx" ON "erp_accounting_outbox"("organizationId", "status");

-- CreateIndex
CREATE INDEX "erp_accounting_outbox_status_nextAttemptAt_idx" ON "erp_accounting_outbox"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "erp_accounting_outbox" ADD CONSTRAINT "erp_accounting_outbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_accounting_outbox" ADD CONSTRAINT "erp_accounting_outbox_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "arRefundId" TEXT;

-- CreateTable
CREATE TABLE "ar_refunds" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "refundDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "sources" JSONB NOT NULL,
    "status" "ArDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_refunds_companyId_customerId_idx" ON "ar_refunds"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ar_refunds_companyId_refundNumber_key" ON "ar_refunds"("companyId", "refundNumber");

-- CreateIndex
CREATE INDEX "idempotency_records_createdAt_idx" ON "idempotency_records"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- AddForeignKey
ALTER TABLE "ar_refunds" ADD CONSTRAINT "ar_refunds_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


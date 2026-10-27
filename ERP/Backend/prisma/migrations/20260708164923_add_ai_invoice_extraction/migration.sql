-- CreateEnum
CREATE TYPE "PoMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'PARTIAL', 'MISMATCHED');

-- CreateEnum
CREATE TYPE "InvoiceJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "AiExtractionProvider" AS ENUM ('OPENAI_GPT4O');

-- AlterTable
ALTER TABLE "supplier_invoice_items" ADD COLUMN     "discrepancyNote" TEXT,
ADD COLUMN     "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "analysisFlags" JSONB,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "fraudRiskScore" INTEGER,
ADD COLUMN     "matchedPurchaseOrderId" INTEGER,
ADD COLUMN     "mathVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "poMatchStatus" "PoMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "vendorTIN" TEXT;

-- CreateTable
CREATE TABLE "invoice_processing_jobs" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "provider" "AiExtractionProvider" NOT NULL DEFAULT 'OPENAI_GPT4O',
    "status" "InvoiceJobStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultPayload" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_processing_jobs_organizationId_idx" ON "invoice_processing_jobs"("organizationId");

-- CreateIndex
CREATE INDEX "invoice_processing_jobs_invoiceId_idx" ON "invoice_processing_jobs"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_processing_jobs_status_nextAttemptAt_idx" ON "invoice_processing_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "supplier_invoices_matchedPurchaseOrderId_idx" ON "supplier_invoices"("matchedPurchaseOrderId");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_matchedPurchaseOrderId_fkey" FOREIGN KEY ("matchedPurchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_processing_jobs" ADD CONSTRAINT "invoice_processing_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_processing_jobs" ADD CONSTRAINT "invoice_processing_jobs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

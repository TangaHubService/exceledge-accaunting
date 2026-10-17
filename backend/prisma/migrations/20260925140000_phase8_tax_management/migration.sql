-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('OUTPUT_VAT', 'INPUT_VAT', 'ZERO_RATED', 'EXEMPT', 'WHT_PAYABLE', 'WHT_RECEIVABLE', 'EXCISE', 'IMPORT_VAT', 'PAYE', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxFilingKind" AS ENUM ('VAT', 'WHT', 'PAYE', 'EXCISE', 'ANNUAL');

-- CreateEnum
CREATE TYPE "TaxFilingStatus" AS ENUM ('DRAFT', 'PREPARED', 'FILED');

-- CreateEnum
CREATE TYPE "TaxPaymentStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "tax_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxAuthority" TEXT,
    "tin" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatFilingFrequency" TEXT,
    "taxCurrency" TEXT NOT NULL DEFAULT 'RWF',
    "roundingMethod" TEXT,
    "defaultOutputTaxCodeId" TEXT,
    "defaultInputTaxCodeId" TEXT,
    "defaultWhtTaxCodeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "ratePercent" DECIMAL(9,4) NOT NULL,
    "glAccountId" TEXT,
    "authority" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT,
    "notes" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "taxCodeId" TEXT,
    "taxAccountId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "financialAccountId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "description" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "filingId" TEXT,
    "status" "TaxPaymentStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "reversalJournalId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByErpUserId" INTEGER,
    "reversalReason" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "adjustmentDate" TIMESTAMP(3) NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "taxCodeId" TEXT,
    "taxAccountId" TEXT NOT NULL,
    "contraAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "increasesLiability" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "journalId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_filings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "TaxFilingKind" NOT NULL,
    "status" "TaxFilingStatus" NOT NULL DEFAULT 'DRAFT',
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "preparedByErpUserId" INTEGER,
    "filedAt" TIMESTAMP(3),
    "filedByErpUserId" INTEGER,
    "filingReference" TEXT,
    "summary" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceDocumentType" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceDocumentNumber" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'RWF',
    "vsdcInvoiceNumber" TEXT,
    "sdcReceiptNumber" TEXT,
    "receiptSignature" TEXT,
    "internalData" TEXT,
    "qrCode" TEXT,
    "journalId" TEXT,
    "integrationEventId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_settings_companyId_key" ON "tax_settings"("companyId");

-- CreateIndex
CREATE INDEX "tax_codes_companyId_taxType_isActive_idx" ON "tax_codes"("companyId", "taxType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_companyId_code_key" ON "tax_codes"("companyId", "code");

-- CreateIndex
CREATE INDEX "tax_payments_companyId_paymentDate_idx" ON "tax_payments"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "tax_payments_companyId_taxType_idx" ON "tax_payments"("companyId", "taxType");

-- CreateIndex
CREATE UNIQUE INDEX "tax_payments_companyId_number_key" ON "tax_payments"("companyId", "number");

-- CreateIndex
CREATE INDEX "tax_adjustments_companyId_adjustmentDate_idx" ON "tax_adjustments"("companyId", "adjustmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "tax_adjustments_companyId_number_key" ON "tax_adjustments"("companyId", "number");

-- CreateIndex
CREATE INDEX "tax_filings_companyId_kind_periodFrom_idx" ON "tax_filings"("companyId", "kind", "periodFrom");

-- CreateIndex
CREATE UNIQUE INDEX "tax_filings_companyId_number_key" ON "tax_filings"("companyId", "number");

-- CreateIndex
CREATE INDEX "fiscal_documents_companyId_occurredAt_idx" ON "fiscal_documents"("companyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_companyId_sourceDocumentType_sourceDocument_key" ON "fiscal_documents"("companyId", "sourceDocumentType", "sourceDocumentId");

-- AddForeignKey
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

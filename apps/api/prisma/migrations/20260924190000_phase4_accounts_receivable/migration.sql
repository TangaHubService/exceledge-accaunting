-- Phase 4: Customers & Accounts Receivable

CREATE TYPE "CustomerType" AS ENUM ('CASH', 'CREDIT', 'WALK_IN', 'GOVERNMENT', 'CORPORATE', 'NGO', 'INDIVIDUAL', 'EXPORT', 'FOREIGN');
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CreditStatus" AS ENUM ('GOOD', 'WATCH', 'ON_HOLD', 'BLOCKED');
CREATE TYPE "ArDocumentStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "ArPaymentMethod" AS ENUM ('CASH', 'BANK', 'MOBILE_MONEY', 'CARD', 'CHEQUE', 'ONLINE');

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL DEFAULT 'CREDIT',
    "category" TEXT,
    "tin" TEXT,
    "vatNumber" TEXT,
    "nationalId" TEXT,
    "registrationNumber" TEXT,
    "contactPerson" TEXT,
    "telephone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "physicalAddress" TEXT,
    "country" TEXT,
    "province" TEXT,
    "district" TEXT,
    "sector" TEXT,
    "cell" TEXT,
    "village" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "paymentTerms" TEXT,
    "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "arAccountId" TEXT,
    "taxCategory" TEXT,
    "defaultSalesAccountId" TEXT,
    "defaultPriceList" TEXT,
    "salesRepresentative" TEXT,
    "branchId" TEXT,
    "costCentre" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditStatus" "CreditStatus" NOT NULL DEFAULT 'GOOD',
    "riskCategory" TEXT,
    "collectionPriority" TEXT,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "externalErpCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ArDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountCredited" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "journalId" TEXT,
    "sourceModule" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentNumber" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ar_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "method" "ArPaymentMethod" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(18,4) NOT NULL,
    "unallocated" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ArDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT,
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ar_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_allocations" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ar_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_credit_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "creditNoteNumber" TEXT NOT NULL,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ArDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ar_credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_debit_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "debitNoteNumber" TEXT NOT NULL,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountSettled" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ArDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ar_debit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_deposits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "depositNumber" TEXT NOT NULL,
    "depositDate" TIMESTAMP(3) NOT NULL,
    "method" "ArPaymentMethod" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(18,4) NOT NULL,
    "remaining" DECIMAL(18,4) NOT NULL,
    "status" "ArDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT,
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ar_deposits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_deposit_allocations" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ar_deposit_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ar_ledger_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docNumber" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ar_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_companyId_code_key" ON "customers"("companyId", "code");
CREATE UNIQUE INDEX "customers_companyId_externalErpCustomerId_key" ON "customers"("companyId", "externalErpCustomerId");
CREATE INDEX "customers_companyId_status_idx" ON "customers"("companyId", "status");
CREATE INDEX "customers_companyId_name_idx" ON "customers"("companyId", "name");

CREATE UNIQUE INDEX "ar_invoices_companyId_invoiceNumber_key" ON "ar_invoices"("companyId", "invoiceNumber");
CREATE INDEX "ar_invoices_companyId_customerId_status_idx" ON "ar_invoices"("companyId", "customerId", "status");
CREATE INDEX "ar_invoices_companyId_dueDate_idx" ON "ar_invoices"("companyId", "dueDate");
CREATE INDEX "ar_invoices_companyId_sourceDocumentType_sourceDocumentId_idx" ON "ar_invoices"("companyId", "sourceDocumentType", "sourceDocumentId");

CREATE UNIQUE INDEX "ar_receipts_companyId_receiptNumber_key" ON "ar_receipts"("companyId", "receiptNumber");
CREATE INDEX "ar_receipts_companyId_customerId_idx" ON "ar_receipts"("companyId", "customerId");
CREATE INDEX "ar_allocations_invoiceId_idx" ON "ar_allocations"("invoiceId");

CREATE UNIQUE INDEX "ar_credit_notes_companyId_creditNoteNumber_key" ON "ar_credit_notes"("companyId", "creditNoteNumber");
CREATE INDEX "ar_credit_notes_companyId_customerId_idx" ON "ar_credit_notes"("companyId", "customerId");

CREATE UNIQUE INDEX "ar_debit_notes_companyId_debitNoteNumber_key" ON "ar_debit_notes"("companyId", "debitNoteNumber");
CREATE INDEX "ar_debit_notes_companyId_customerId_idx" ON "ar_debit_notes"("companyId", "customerId");

CREATE UNIQUE INDEX "ar_deposits_companyId_depositNumber_key" ON "ar_deposits"("companyId", "depositNumber");
CREATE INDEX "ar_deposits_companyId_customerId_idx" ON "ar_deposits"("companyId", "customerId");
CREATE INDEX "ar_deposit_allocations_invoiceId_idx" ON "ar_deposit_allocations"("invoiceId");
CREATE INDEX "ar_ledger_entries_companyId_customerId_entryDate_idx" ON "ar_ledger_entries"("companyId", "customerId", "entryDate");

ALTER TABLE "customers" ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_allocations" ADD CONSTRAINT "ar_allocations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ar_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_allocations" ADD CONSTRAINT "ar_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ar_debit_notes" ADD CONSTRAINT "ar_debit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_debit_notes" ADD CONSTRAINT "ar_debit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_deposits" ADD CONSTRAINT "ar_deposits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_deposits" ADD CONSTRAINT "ar_deposits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ar_deposit_allocations" ADD CONSTRAINT "ar_deposit_allocations_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "ar_deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_ledger_entries" ADD CONSTRAINT "ar_ledger_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_ledger_entries" ADD CONSTRAINT "ar_ledger_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

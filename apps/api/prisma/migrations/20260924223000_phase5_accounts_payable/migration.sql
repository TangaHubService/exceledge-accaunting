-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApDocumentStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ApPaymentMethod" AS ENUM ('CASH', 'BANK', 'MOBILE_MONEY', 'CHEQUE', 'EFT');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "tin" TEXT,
    "vatNumber" TEXT,
    "registrationNumber" TEXT,
    "contactPerson" TEXT,
    "telephone" TEXT,
    "mobile" TEXT,
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
    "creditPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "apAccountId" TEXT,
    "defaultExpenseAccountId" TEXT,
    "defaultInventoryAccountId" TEXT,
    "taxCategory" TEXT,
    "whtCategory" TEXT,
    "whtRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "branchId" TEXT,
    "costCentre" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "externalErpSupplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_bills" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "poReference" TEXT,
    "grnReference" TEXT,
    "status" "ApDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountCredited" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expenseAccountId" TEXT,
    "description" TEXT,
    "journalId" TEXT,
    "sourceModule" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentNumber" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "method" "ApPaymentMethod" NOT NULL DEFAULT 'BANK',
    "amount" DECIMAL(18,4) NOT NULL,
    "withholdingTax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocated" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ApDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT,
    "journalId" TEXT,
    "description" TEXT,
    "sourceModule" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_credit_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "billId" TEXT,
    "creditNoteNumber" TEXT NOT NULL,
    "supplierReference" TEXT,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ApDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_debit_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "debitNoteNumber" TEXT NOT NULL,
    "supplierReference" TEXT,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expenseAccountId" TEXT,
    "status" "ApDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_advances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "advanceNumber" TEXT NOT NULL,
    "advanceDate" TIMESTAMP(3) NOT NULL,
    "method" "ApPaymentMethod" NOT NULL DEFAULT 'BANK',
    "amount" DECIMAL(18,4) NOT NULL,
    "remaining" DECIMAL(18,4) NOT NULL,
    "refunded" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ApDocumentStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT,
    "journalId" TEXT,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_advance_allocations" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_advance_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_ledger_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docNumber" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_companyId_status_idx" ON "suppliers"("companyId", "status");

-- CreateIndex
CREATE INDEX "suppliers_companyId_name_idx" ON "suppliers"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_code_key" ON "suppliers"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_externalErpSupplierId_key" ON "suppliers"("companyId", "externalErpSupplierId");

-- CreateIndex
CREATE INDEX "ap_bills_companyId_supplierId_status_idx" ON "ap_bills"("companyId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "ap_bills_companyId_dueDate_idx" ON "ap_bills"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "ap_bills_companyId_sourceDocumentType_sourceDocumentId_idx" ON "ap_bills"("companyId", "sourceDocumentType", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_companyId_billNumber_key" ON "ap_bills"("companyId", "billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_companyId_supplierId_supplierInvoiceNumber_key" ON "ap_bills"("companyId", "supplierId", "supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "ap_payments_companyId_supplierId_idx" ON "ap_payments"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "ap_payments_companyId_paymentDate_idx" ON "ap_payments"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "ap_payments_companyId_sourceDocumentType_sourceDocumentId_idx" ON "ap_payments"("companyId", "sourceDocumentType", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payments_companyId_paymentNumber_key" ON "ap_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "ap_allocations_billId_idx" ON "ap_allocations"("billId");

-- CreateIndex
CREATE INDEX "ap_credit_notes_companyId_supplierId_idx" ON "ap_credit_notes"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_credit_notes_companyId_creditNoteNumber_key" ON "ap_credit_notes"("companyId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX "ap_debit_notes_companyId_supplierId_idx" ON "ap_debit_notes"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_debit_notes_companyId_debitNoteNumber_key" ON "ap_debit_notes"("companyId", "debitNoteNumber");

-- CreateIndex
CREATE INDEX "ap_advances_companyId_supplierId_idx" ON "ap_advances"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ap_advances_companyId_advanceNumber_key" ON "ap_advances"("companyId", "advanceNumber");

-- CreateIndex
CREATE INDEX "ap_advance_allocations_billId_idx" ON "ap_advance_allocations"("billId");

-- CreateIndex
CREATE INDEX "ap_ledger_entries_companyId_supplierId_entryDate_idx" ON "ap_ledger_entries"("companyId", "supplierId", "entryDate");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_allocations" ADD CONSTRAINT "ap_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ap_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_allocations" ADD CONSTRAINT "ap_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_debit_notes" ADD CONSTRAINT "ap_debit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_debit_notes" ADD CONSTRAINT "ap_debit_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advances" ADD CONSTRAINT "ap_advances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advances" ADD CONSTRAINT "ap_advances_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance_allocations" ADD CONSTRAINT "ap_advance_allocations_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "ap_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_advance_allocations" ADD CONSTRAINT "ap_advance_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_ledger_entries" ADD CONSTRAINT "ap_ledger_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_ledger_entries" ADD CONSTRAINT "ap_ledger_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


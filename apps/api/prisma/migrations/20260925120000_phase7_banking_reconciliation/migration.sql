-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('BANK', 'CASH', 'PETTY_CASH', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "BankTransactionKind" AS ENUM ('RECEIPT', 'PAYMENT', 'TRANSFER', 'BANK_CHARGE', 'INTEREST', 'CASH_COUNT');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'COMPLETED');

-- AlterTable
ALTER TABLE "ap_payments" ADD COLUMN     "financialAccountId" TEXT;

-- AlterTable
ALTER TABLE "ar_receipts" ADD COLUMN     "financialAccountId" TEXT;

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "FinancialAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "branchName" TEXT,
    "swiftCode" TEXT,
    "provider" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "glAccountId" TEXT NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "dateOpened" TIMESTAMP(3) NOT NULL,
    "reconcileFrom" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowOverdraft" BOOLEAN NOT NULL DEFAULT false,
    "custodian" TEXT,
    "notes" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "BankTransactionKind" NOT NULL,
    "transferType" TEXT,
    "financialAccountId" TEXT NOT NULL,
    "counterFinancialAccountId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "fee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "method" TEXT,
    "reference" TEXT,
    "chequeNumber" TEXT,
    "partyType" TEXT,
    "partyName" TEXT,
    "description" TEXT,
    "lines" JSONB,
    "countedAmount" DECIMAL(18,4),
    "bookAmount" DECIMAL(18,4),
    "statementLineId" TEXT,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'POSTED',
    "journalId" TEXT,
    "reversalJournalId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByErpUserId" INTEGER,
    "reversalReason" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "openingBalance" DECIMAL(18,4),
    "closingBalance" DECIMAL(18,4),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "importedByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "chequeNumber" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "runningBalance" DECIMAL(18,4),
    "fingerprint" TEXT NOT NULL,
    "matchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_matches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "clearedDate" TIMESTAMP(3) NOT NULL,
    "reconciliationId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_match_entries" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "glEntryId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_match_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "statementBalance" DECIMAL(18,4) NOT NULL,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "bookBalance" DECIMAL(18,4),
    "difference" DECIMAL(18,4),
    "summary" JSONB,
    "notes" TEXT,
    "preparedByErpUserId" INTEGER,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByErpUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "approvedByErpUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "completedByErpUserId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_companyId_kind_idx" ON "financial_accounts"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_companyId_glAccountId_key" ON "financial_accounts"("companyId", "glAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_companyId_name_key" ON "financial_accounts"("companyId", "name");

-- CreateIndex
CREATE INDEX "bank_transactions_companyId_financialAccountId_transactionD_idx" ON "bank_transactions"("companyId", "financialAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "bank_transactions_companyId_kind_idx" ON "bank_transactions"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_companyId_number_key" ON "bank_transactions"("companyId", "number");

-- CreateIndex
CREATE INDEX "bank_statements_companyId_financialAccountId_idx" ON "bank_statements"("companyId", "financialAccountId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_companyId_financialAccountId_transacti_idx" ON "bank_statement_lines"("companyId", "financialAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "bank_statement_lines_matchId_idx" ON "bank_statement_lines"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_financialAccountId_fingerprint_key" ON "bank_statement_lines"("financialAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "bank_matches_companyId_financialAccountId_idx" ON "bank_matches"("companyId", "financialAccountId");

-- CreateIndex
CREATE INDEX "bank_matches_reconciliationId_idx" ON "bank_matches"("reconciliationId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_match_entries_glEntryId_key" ON "bank_match_entries"("glEntryId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_companyId_financialAccountId_statement_idx" ON "bank_reconciliations"("companyId", "financialAccountId", "statementDate");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_companyId_number_key" ON "bank_reconciliations"("companyId", "number");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_counterFinancialAccountId_fkey" FOREIGN KEY ("counterFinancialAccountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "bank_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_match_entries" ADD CONSTRAINT "bank_match_entries_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "bank_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


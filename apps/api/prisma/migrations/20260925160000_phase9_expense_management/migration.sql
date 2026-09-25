-- Phase 9: Expense management (categories, expenses, allocations, recurring)

CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED');
CREATE TYPE "ExpensePaymentMode" AS ENUM ('IMMEDIATE', 'ON_ACCOUNT', 'REIMBURSEMENT');
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "glAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "expenseAccountId" TEXT,
    "paymentMode" "ExpensePaymentMode" NOT NULL DEFAULT 'IMMEDIATE',
    "frequency" "RecurringFrequency" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payeeName" TEXT,
    "supplierId" TEXT,
    "creditAccountId" TEXT,
    "financialAccountId" TEXT,
    "description" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "costCentre" TEXT,
    "project" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "lastGeneratedAt" TIMESTAMP(3),
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "paymentMode" "ExpensePaymentMode" NOT NULL DEFAULT 'IMMEDIATE',
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "payeeName" TEXT,
    "supplierId" TEXT,
    "employeeErpUserId" INTEGER,
    "employeeName" TEXT,
    "description" TEXT,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "taxCodeId" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'RWF',
    "creditAccountId" TEXT,
    "financialAccountId" TEXT,
    "paymentMethod" TEXT,
    "reference" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "costCentre" TEXT,
    "project" TEXT,
    "receiptReference" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedByErpUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "approvedByErpUserId" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByErpUserId" INTEGER,
    "postedAt" TIMESTAMP(3),
    "postedByErpUserId" INTEGER,
    "journalId" TEXT,
    "reversalJournalId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByErpUserId" INTEGER,
    "reversalReason" TEXT,
    "recurringExpenseId" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_allocations" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branch" TEXT,
    "department" TEXT,
    "costCentre" TEXT,
    "project" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "percent" DECIMAL(8,4) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "expense_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_categories_companyId_code_key" ON "expense_categories"("companyId", "code");
CREATE INDEX "expense_categories_companyId_isActive_idx" ON "expense_categories"("companyId", "isActive");

CREATE UNIQUE INDEX "recurring_expenses_companyId_number_key" ON "recurring_expenses"("companyId", "number");
CREATE INDEX "recurring_expenses_companyId_nextRunDate_isActive_idx" ON "recurring_expenses"("companyId", "nextRunDate", "isActive");

CREATE UNIQUE INDEX "expenses_companyId_number_key" ON "expenses"("companyId", "number");
CREATE INDEX "expenses_companyId_expenseDate_idx" ON "expenses"("companyId", "expenseDate");
CREATE INDEX "expenses_companyId_status_idx" ON "expenses"("companyId", "status");
CREATE INDEX "expenses_companyId_categoryId_idx" ON "expenses"("companyId", "categoryId");
CREATE INDEX "expenses_companyId_sourceDocumentType_sourceDocumentId_idx" ON "expenses"("companyId", "sourceDocumentType", "sourceDocumentId");

CREATE INDEX "expense_allocations_expenseId_idx" ON "expense_allocations"("expenseId");

ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

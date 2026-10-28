-- Budget lifecycle: DRAFT -> SUBMITTED -> APPROVED -> ACTIVE -> REVISED.
-- The enum is rebuilt rather than extended so the partial index below can use the new values in this transaction.
ALTER TYPE "BudgetStatus" RENAME TO "BudgetStatus_old";
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'REVISED');
ALTER TABLE "budgets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "budgets" ALTER COLUMN "status" TYPE "BudgetStatus" USING ("status"::text::"BudgetStatus");
ALTER TABLE "budgets" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "BudgetStatus_old";

ALTER TABLE "budgets" ADD COLUMN "familyId" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "revisedFromId" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "activatedByErpUserId" INTEGER;

ALTER TABLE "budget_lines" ADD COLUMN "branchId" TEXT;

ALTER TABLE "approval_posting_controls" ADD COLUMN "budgetControl" TEXT NOT NULL DEFAULT 'OFF';

CREATE INDEX "budgets_companyId_familyId_idx" ON "budgets"("companyId", "familyId");

-- One active budget per company and financial year.
CREATE UNIQUE INDEX "budgets_one_active_per_year" ON "budgets"("companyId", "financialYearId") WHERE "status" = 'ACTIVE';

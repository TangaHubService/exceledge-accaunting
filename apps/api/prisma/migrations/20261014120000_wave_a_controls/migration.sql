-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN "amountForeign" DECIMAL(18,4);

-- System accounts were seeded closed to manual journals. Manual posting is now enforced, so
-- open them again except the control accounts that only their modules may move.
UPDATE "accounts" SET "allowManualPost" = true
WHERE "systemProtected" = true AND "allowManualPost" = false AND "code" NOT IN ('1200', '2100', '1300', '3200');

-- Payroll payable shared 2300 with PAYE; net salaries go to 2320.
UPDATE "default_posting_accounts" d SET "payrollPayableId" = a."id"
FROM "accounts" a
WHERE a."companyId" = d."companyId" AND a."code" = '2320'
  AND d."payrollPayableId" IS NOT NULL AND d."payrollPayableId" = d."payrollTaxPayableId";

-- AlterTable
ALTER TABLE "api_credentials" ADD COLUMN "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "api_credentials_prefix_idx" ON "api_credentials"("prefix");

-- CreateTable
CREATE TABLE "elimination_lines" (
    "id" TEXT NOT NULL,
    "eliminationId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "elimination_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "elimination_lines_eliminationId_lineNumber_key" ON "elimination_lines"("eliminationId", "lineNumber");

-- AddForeignKey
ALTER TABLE "elimination_lines" ADD CONSTRAINT "elimination_lines_eliminationId_fkey" FOREIGN KEY ("eliminationId") REFERENCES "eliminations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "workflow_step_logs" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "erpRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_step_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_step_logs_instanceId_stepIndex_key" ON "workflow_step_logs"("instanceId", "stepIndex");

-- AddForeignKey
ALTER TABLE "workflow_step_logs" ADD CONSTRAINT "workflow_step_logs_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "job_locks" (
    "key" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("key")
);
-- AlterEnum: recreated rather than extended so the partial indexes below can use the new values in this transaction
ALTER TYPE "CloseStatus" RENAME TO "CloseStatus_old";
CREATE TYPE "CloseStatus" AS ENUM ('PENDING_APPROVAL', 'CLOSED', 'REOPENED', 'REJECTED');
ALTER TABLE "period_closes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "period_closes" ALTER COLUMN "status" TYPE "CloseStatus" USING ("status"::text::"CloseStatus");
ALTER TABLE "period_closes" ALTER COLUMN "status" SET DEFAULT 'CLOSED';
DROP TYPE "CloseStatus_old";

-- AlterTable
ALTER TABLE "approval_posting_controls" ADD COLUMN "closeApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "period_closes" ADD COLUMN "requestedByErpUserId" INTEGER,
ADD COLUMN "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "approvalRequestId" TEXT,
ADD COLUMN "approvedByErpUserId" INTEGER,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "decisionNote" TEXT,
ADD COLUMN "reopenedByErpUserId" INTEGER,
ADD COLUMN "reopenedAt" TIMESTAMP(3),
ALTER COLUMN "closedAt" DROP NOT NULL,
ALTER COLUMN "closedAt" DROP DEFAULT;

UPDATE "period_closes" SET "requestedAt" = "closedAt", "requestedByErpUserId" = "closedByErpUserId" WHERE "closedAt" IS NOT NULL;

-- Closes made before the period lock could leave two CLOSED rows for a period; the latest stays in force.
UPDATE "period_closes" p SET "status" = 'REOPENED'
WHERE p."status" = 'CLOSED' AND EXISTS (
    SELECT 1 FROM "period_closes" q
    WHERE q."periodId" = p."periodId" AND q."status" = 'CLOSED'
      AND (q."closedAt" > p."closedAt" OR (q."closedAt" = p."closedAt" AND q."id" > p."id"))
);

-- One close request waiting and one close in force per period, whichever path wrote it.
CREATE UNIQUE INDEX "period_closes_one_pending_per_period" ON "period_closes"("periodId") WHERE "status" = 'PENDING_APPROVAL';
CREATE UNIQUE INDEX "period_closes_one_closed_per_period" ON "period_closes"("periodId") WHERE "status" = 'CLOSED';

-- CreateTable
CREATE TABLE "period_close_overrides" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_close_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "period_close_overrides_periodId_item_key" ON "period_close_overrides"("periodId", "item");

-- CreateIndex
CREATE INDEX "period_close_overrides_companyId_idx" ON "period_close_overrides"("companyId");

-- AddForeignKey
ALTER TABLE "period_close_overrides" ADD CONSTRAINT "period_close_overrides_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

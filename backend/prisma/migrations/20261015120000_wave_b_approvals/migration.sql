-- CreateEnum
CREATE TYPE "ApprovalDecisionKind" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED', 'RESUBMITTED');

-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "approval_posting_controls" ADD COLUMN     "requireDifferentPoster" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "approvedLevels" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "levelRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requiredLevels" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "resubmitCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "gl_entries" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "costCentre" TEXT,
ADD COLUMN     "project" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "targetErpUserId" INTEGER,
ADD COLUMN     "targetRole" TEXT;

-- AlterTable
ALTER TABLE "number_sequences" ADD COLUMN     "legacyFloor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "opening_balance_batches" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByErpUserId" INTEGER,
ADD COLUMN     "createdByErpUserId" INTEGER,
ADD COLUMN     "journalId" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "number_sequence_counters" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL,

    CONSTRAINT "number_sequence_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "decision" "ApprovalDecisionKind" NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "erpRole" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "number_sequence_counters_sequenceId_periodKey_key" ON "number_sequence_counters"("sequenceId", "periodKey");

-- CreateIndex
CREATE INDEX "approval_decisions_approvalRequestId_createdAt_idx" ON "approval_decisions"("approvalRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_reads_erpUserId_idx" ON "notification_reads"("erpUserId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_reads_notificationId_erpUserId_key" ON "notification_reads"("notificationId", "erpUserId");

-- CreateIndex
CREATE INDEX "approval_requests_companyId_entityType_entityId_idx" ON "approval_requests"("companyId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "notifications_companyId_createdAt_idx" ON "notifications"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "number_sequence_counters" ADD CONSTRAINT "number_sequence_counters_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "number_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Numbers issued before per-period counters existed must not be issued again.
UPDATE "number_sequences" SET "legacyFloor" = "nextNumber";

-- Approved requests from before multi-level approvals count as one approved level.
UPDATE "approval_requests" SET "approvedLevels" = 1 WHERE "status" = 'APPROVED';

-- Dimensions now live on ledger entries; take them from the journal line, else the journal.
UPDATE "gl_entries" g SET
    "costCentre" = j."costCentre",
    "project" = j."project",
    "branchId" = j."branchId"
FROM "journals" j
WHERE g."journalId" = j."id";

UPDATE "gl_entries" g SET
    "costCentre" = COALESCE(l."costCentre", g."costCentre"),
    "project" = COALESCE(l."project", g."project"),
    "branchId" = COALESCE(l."branchId", g."branchId")
FROM "journal_lines" l
WHERE g."journalLineId" = l."id";

-- The audit trail is append-only. Deleting a company may still null its companyId (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION "audit_events_append_only"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."companyId" IS NULL
        AND (to_jsonb(NEW) - 'companyId') = (to_jsonb(OLD) - 'companyId') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_no_update" BEFORE UPDATE OR DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();

CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events"
    FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only"();

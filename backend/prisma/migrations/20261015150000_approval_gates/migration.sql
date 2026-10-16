-- CreateEnum
CREATE TYPE "ApprovalGateStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ApDocumentStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ApDocumentStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "approval_posting_controls" ADD COLUMN     "approvalRequiredFor" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "fixed_asset_impairments" ADD COLUMN     "status" "ApprovalGateStatus" NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE "tax_adjustments" ADD COLUMN     "status" "ApprovalGateStatus" NOT NULL DEFAULT 'POSTED';

-- Close duplicate open requests (keep the oldest per record) so the unique index below can be built.
UPDATE "approval_requests" AS r
SET "status" = 'REJECTED',
    "decisionNote" = 'Closed as a duplicate of an earlier open request',
    "decidedAt" = now()
WHERE r."status" IN ('PENDING', 'RETURNED')
  AND EXISTS (
    SELECT 1 FROM "approval_requests" AS o
    WHERE o."companyId" = r."companyId"
      AND o."entityType" = r."entityType"
      AND o."entityId" = r."entityId"
      AND o."status" IN ('PENDING', 'RETURNED')
      AND (o."createdAt", o."id") < (r."createdAt", r."id")
  );

-- One open (pending or returned) approval per record. Partial, so it lives here and not in schema.prisma.
CREATE UNIQUE INDEX "approval_requests_one_open_per_entity"
  ON "approval_requests" ("companyId", "entityType", "entityId")
  WHERE "status" IN ('PENDING', 'RETURNED');

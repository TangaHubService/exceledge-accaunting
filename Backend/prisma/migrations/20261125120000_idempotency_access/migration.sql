-- AlterTable
ALTER TABLE "idempotency_records" ADD COLUMN "accessHash" TEXT;

-- Answers saved so far may hold keys that should only ever have been shown once.
DELETE FROM "idempotency_records";

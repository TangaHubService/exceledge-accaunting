-- Revert the COPY value of "EbmOperation" (PostgreSQL cannot drop an enum value in place).

DELETE FROM "ebm_transactions" WHERE "operation" = 'COPY';

ALTER TYPE "EbmOperation" RENAME TO "EbmOperation_old";
CREATE TYPE "EbmOperation" AS ENUM ('SALE', 'REFUND', 'VOID');
ALTER TABLE "ebm_transactions" ALTER COLUMN "operation" DROP DEFAULT;
ALTER TABLE "ebm_transactions" ALTER COLUMN "operation" TYPE "EbmOperation" USING ("operation"::text::"EbmOperation");
ALTER TABLE "ebm_transactions" ALTER COLUMN "operation" SET DEFAULT 'SALE';
ALTER TABLE "ebm_outbox" ALTER COLUMN "operation" TYPE "EbmOperation" USING ("operation"::text::"EbmOperation");
DROP TYPE "EbmOperation_old";

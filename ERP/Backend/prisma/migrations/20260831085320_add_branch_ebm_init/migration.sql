-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "ebmInitInfo" JSONB,
ADD COLUMN     "ebmInitializedAt" TIMESTAMP(3);

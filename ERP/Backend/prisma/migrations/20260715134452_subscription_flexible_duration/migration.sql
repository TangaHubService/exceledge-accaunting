-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'GRACE_PERIOD';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingMode" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "gracePeriodDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "gracePeriodEndsAt" TIMESTAMP(3),
ADD COLUMN     "monthlyPrice" DOUBLE PRECISION,
ADD COLUMN     "monthsPurchased" INTEGER,
ADD COLUMN     "renewedFromSubscriptionId" INTEGER,
ADD COLUMN     "totalAmount" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "subscriptions_gracePeriodEndsAt_idx" ON "subscriptions"("gracePeriodEndsAt");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_renewedFromSubscriptionId_fkey" FOREIGN KEY ("renewedFromSubscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

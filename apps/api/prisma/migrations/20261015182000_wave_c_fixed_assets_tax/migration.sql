-- AlterEnum
ALTER TYPE "DepreciationMethod" ADD VALUE 'SUM_OF_YEARS_DIGITS';
ALTER TYPE "DepreciationMethod" ADD VALUE 'UNITS_OF_PRODUCTION';

-- CreateEnum
CREATE TYPE "DepreciationFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN "depreciationFrequency" "DepreciationFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "totalUnits" DECIMAL(18,4),
ADD COLUMN "unitsDepreciated" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN "depreciatedMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "depreciationBase" DECIMAL(18,4),
ADD COLUMN "depreciationBaseMonth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "revaluationSurplus" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN "revaluationLossInPl" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- Every depreciation posted before this migration covered one month.
UPDATE "fixed_assets" a SET "depreciatedMonths" = d.n
FROM (SELECT "assetId", COUNT(*)::int AS n FROM "fixed_asset_depreciations" GROUP BY "assetId") d
WHERE d."assetId" = a."id";

-- Earlier revaluations all went through the reserve.
UPDATE "fixed_assets" a SET "revaluationSurplus" = GREATEST(0, r.net)
FROM (
  SELECT "assetId", SUM(CASE WHEN "increase" THEN "amount" ELSE -"amount" END) AS net
  FROM "fixed_asset_revaluations" GROUP BY "assetId"
) r
WHERE r."assetId" = a."id";

-- AlterTable
ALTER TABLE "fixed_asset_revaluations" ADD COLUMN "reserveAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN "plAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

UPDATE "fixed_asset_revaluations" SET "reserveAmount" = "amount";

-- AlterTable
ALTER TABLE "default_posting_accounts" ADD COLUMN "revaluationLossId" TEXT;

-- CreateTable
CREATE TABLE "fixed_asset_usages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "units" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_usages_assetId_period_key" ON "fixed_asset_usages"("assetId", "period");

-- CreateIndex
CREATE INDEX "fixed_asset_usages_companyId_period_idx" ON "fixed_asset_usages"("companyId", "period");

-- AddForeignKey
ALTER TABLE "fixed_asset_usages" ADD CONSTRAINT "fixed_asset_usages_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

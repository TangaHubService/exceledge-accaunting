-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('REGISTERED', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "DisposalMethod" AS ENUM ('SALE', 'SCRAP', 'DONATION', 'THEFT', 'DESTRUCTION', 'RETIREMENT');

-- CreateEnum
CREATE TYPE "AssetAcquisitionMethod" AS ENUM ('PURCHASE', 'CAPITALIZATION', 'DONATION', 'TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "fixed_asset_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL DEFAULT 0,
    "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "residualPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "ratePercent" DECIMAL(9,4),
    "assetAccountId" TEXT,
    "accumDepAccountId" TEXT,
    "depExpenseAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "serialNumber" TEXT,
    "barcode" TEXT,
    "description" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "acquisitionCost" DECIMAL(18,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'RWF',
    "acquisitionMethod" "AssetAcquisitionMethod" NOT NULL DEFAULT 'PURCHASE',
    "residualValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL DEFAULT 0,
    "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "ratePercent" DECIMAL(9,4),
    "assetAccountId" TEXT,
    "accumDepAccountId" TEXT,
    "depExpenseAccountId" TEXT,
    "creditAccountId" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "costCentre" TEXT,
    "project" TEXT,
    "location" TEXT,
    "assignedEmployee" TEXT,
    "warrantyExpiry" TIMESTAMP(3),
    "insuranceDetails" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'REGISTERED',
    "capitalizedAt" TIMESTAMP(3),
    "capitalizationJournalId" TEXT,
    "accumulatedDepreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lastDepreciationPeriod" TEXT,
    "disposedAt" TIMESTAMP(3),
    "disposalMethod" "DisposalMethod",
    "disposalProceeds" DECIMAL(18,4),
    "disposalJournalId" TEXT,
    "disposalNotes" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciation_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "assetCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedByErpUserId" INTEGER,
    "notes" TEXT,

    CONSTRAINT "fixed_asset_depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_maintenances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "maintenanceDate" TIMESTAMP(3) NOT NULL,
    "maintenanceType" TEXT NOT NULL,
    "serviceProvider" TEXT,
    "description" TEXT,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "nextMaintenanceDate" TIMESTAMP(3),
    "expenseJournalId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_transfers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "fromBranch" TEXT,
    "toBranch" TEXT,
    "fromDepartment" TEXT,
    "toDepartment" TEXT,
    "fromCostCentre" TEXT,
    "toCostCentre" TEXT,
    "fromProject" TEXT,
    "toProject" TEXT,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "fromEmployee" TEXT,
    "toEmployee" TEXT,
    "notes" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_revaluations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "previousCarrying" DECIMAL(18,4) NOT NULL,
    "fairValue" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "increase" BOOLEAN NOT NULL,
    "valuationReference" TEXT,
    "journalId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_revaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_impairments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "impairmentDate" TIMESTAMP(3) NOT NULL,
    "recoverableAmount" DECIMAL(18,4) NOT NULL,
    "lossAmount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "journalId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_asset_impairments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fixed_asset_categories_companyId_isActive_idx" ON "fixed_asset_categories"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_categories_companyId_code_key" ON "fixed_asset_categories"("companyId", "code");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_status_idx" ON "fixed_assets"("companyId", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_categoryId_idx" ON "fixed_assets"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_sourceDocumentType_sourceDocumentId_idx" ON "fixed_assets"("companyId", "sourceDocumentType", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_companyId_number_key" ON "fixed_assets"("companyId", "number");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciation_runs_companyId_postedAt_idx" ON "fixed_asset_depreciation_runs"("companyId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciation_runs_companyId_period_key" ON "fixed_asset_depreciation_runs"("companyId", "period");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_companyId_period_idx" ON "fixed_asset_depreciations"("companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciations_assetId_period_key" ON "fixed_asset_depreciations"("assetId", "period");

-- CreateIndex
CREATE INDEX "fixed_asset_maintenances_companyId_assetId_idx" ON "fixed_asset_maintenances"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "fixed_asset_maintenances_companyId_nextMaintenanceDate_idx" ON "fixed_asset_maintenances"("companyId", "nextMaintenanceDate");

-- CreateIndex
CREATE INDEX "fixed_asset_transfers_companyId_assetId_idx" ON "fixed_asset_transfers"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "fixed_asset_revaluations_companyId_assetId_idx" ON "fixed_asset_revaluations"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "fixed_asset_impairments_companyId_assetId_idx" ON "fixed_asset_impairments"("companyId", "assetId");

-- AddForeignKey
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_runs" ADD CONSTRAINT "fixed_asset_depreciation_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "fixed_asset_depreciation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_maintenances" ADD CONSTRAINT "fixed_asset_maintenances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_maintenances" ADD CONSTRAINT "fixed_asset_maintenances_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transfers" ADD CONSTRAINT "fixed_asset_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_transfers" ADD CONSTRAINT "fixed_asset_transfers_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_revaluations" ADD CONSTRAINT "fixed_asset_revaluations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_revaluations" ADD CONSTRAINT "fixed_asset_revaluations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_impairments" ADD CONSTRAINT "fixed_asset_impairments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

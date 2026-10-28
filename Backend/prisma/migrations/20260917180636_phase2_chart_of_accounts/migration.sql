-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bankReconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "costCentre" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "currentBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "hasPostedTransactions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isCashAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isInventoryAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTaxAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "reportingGroup" TEXT,
ADD COLUMN     "requireApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxMapping" TEXT;

-- CreateIndex
CREATE INDEX "accounts_companyId_isActive_idx" ON "accounts"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "accounts_companyId_name_idx" ON "accounts"("companyId", "name");

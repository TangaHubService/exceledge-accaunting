-- CreateEnum
CREATE TYPE "SetupSectionKey" AS ENUM ('COMPANY_PROFILE', 'BUSINESS_ACCOUNTING_INFO', 'FINANCIAL_YEAR_PERIODS', 'CURRENCY', 'ACCOUNTING_POLICIES', 'LOCALIZATION', 'DEFAULT_POSTING_ACCOUNTS', 'INVENTORY_SETTINGS', 'PARTY_DEFAULTS', 'BANKING_PAYMENT', 'TRANSACTION_NUMBERING', 'APPROVAL_POSTING_CONTROLS', 'OPENING_BALANCES', 'REVIEW_ACTIVATION');

-- CreateEnum
CREATE TYPE "SetupSectionStatusValue" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'REQUIRES_REVIEW', 'APPROVED', 'CONFIGURATION_ERROR');

-- CreateEnum
CREATE TYPE "ActivationStatus" AS ENUM ('NOT_ACTIVATED', 'READY', 'ACTIVATED', 'CONFIGURATION_ERROR');

-- CreateEnum
CREATE TYPE "PeriodFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('FUTURE', 'OPEN', 'TEMPORARILY_LOCKED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COST_OF_SALES', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "AccountingBasis" AS ENUM ('ACCRUAL', 'CASH', 'MODIFIED_CASH');

-- CreateEnum
CREATE TYPE "ReportingFramework" AS ENUM ('IFRS', 'IFRS_SME', 'IPSAS', 'LOCAL_GAAP', 'INTERNAL');

-- CreateEnum
CREATE TYPE "InventoryValuationMethod" AS ENUM ('FIFO', 'WEIGHTED_AVERAGE', 'SPECIFIC_IDENTIFICATION');

-- CreateEnum
CREATE TYPE "OpeningBalanceBatchStatus" AS ENUM ('DRAFT', 'REQUIRES_REVIEW', 'APPROVED', 'POSTED', 'REJECTED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "externalErpOrganizationId" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_branches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalErpBranchId" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registeredName" TEXT,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "taxIdentificationNumber" TEXT,
    "logoUrl" TEXT,
    "businessEmail" TEXT,
    "telephone" TEXT,
    "website" TEXT,
    "registeredAddress" TEXT,
    "operatingAddress" TEXT,
    "country" TEXT,
    "region" TEXT,
    "district" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "industry" TEXT,
    "businessActivity" TEXT,
    "incorporationDate" TIMESTAMP(3),
    "operationsStartDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_accounting_info" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "businessType" TEXT,
    "legalStructure" TEXT,
    "industry" TEXT,
    "accountingCommencementDate" TIMESTAMP(3),
    "numberOfBranches" INTEGER,
    "headOffice" TEXT,
    "reportingStructure" TEXT,
    "accountingBasis" "AccountingBasis" NOT NULL DEFAULT 'ACCRUAL',
    "reportingFramework" "ReportingFramework" NOT NULL DEFAULT 'IFRS_SME',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "dateFormat" TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
    "numberFormat" TEXT NOT NULL DEFAULT '#,##0.00',
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Kigali',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_accounting_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "periodFrequency" "PeriodFrequency" NOT NULL DEFAULT 'MONTHLY',
    "closingPolicy" TEXT,
    "transactionLockDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'FUTURE',
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "functionalCurrency" TEXT NOT NULL,
    "reportingCurrency" TEXT,
    "multiCurrencyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "currencySymbol" TEXT,
    "displayFormat" TEXT,
    "decimalPrecision" INTEGER NOT NULL DEFAULT 2,
    "exchangeRateSource" TEXT,
    "exchangeRateUpdateFrequency" TEXT,
    "fxGainAccountId" TEXT,
    "fxLossAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_policies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountingBasis" "AccountingBasis" NOT NULL DEFAULT 'ACCRUAL',
    "inventoryValuationMethod" "InventoryValuationMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "depreciationPolicy" TEXT,
    "revenueRecognitionMethod" TEXT,
    "expenseRecognitionMethod" TEXT,
    "badDebtPolicy" TEXT,
    "fxRevaluationPolicy" TEXT,
    "documentRetentionPeriod" TEXT,
    "materialityThreshold" DECIMAL(18,4),
    "roundingPolicy" TEXT,
    "periodClosingPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "localization_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "countryOfRegistration" TEXT NOT NULL,
    "localizationPackage" TEXT NOT NULL,
    "taxAuthority" TEXT,
    "taxRegistrationNumbers" JSONB,
    "taxpayerCategory" TEXT,
    "taxFilingFrequency" TEXT,
    "electronicInvoicingRequired" BOOLEAN NOT NULL DEFAULT false,
    "governmentIntegrationStatus" TEXT,
    "statutoryReportingRequirements" JSONB,
    "payrollCompliancePackage" TEXT,
    "defaultTaxCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "localization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "systemProtected" BOOLEAN NOT NULL DEFAULT false,
    "allowManualPost" BOOLEAN NOT NULL DEFAULT true,
    "allowAutoPost" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_posting_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountsReceivableId" TEXT,
    "salesRevenueId" TEXT,
    "serviceRevenueId" TEXT,
    "salesDiscountsId" TEXT,
    "salesReturnsId" TEXT,
    "customerDepositsId" TEXT,
    "badDebtExpenseId" TEXT,
    "allowanceDoubtfulDebtsId" TEXT,
    "accountsPayableId" TEXT,
    "purchasesId" TEXT,
    "purchaseDiscountsId" TEXT,
    "purchaseReturnsId" TEXT,
    "supplierAdvancesId" TEXT,
    "accruedExpensesId" TEXT,
    "defaultCashAccountId" TEXT,
    "defaultBankAccountId" TEXT,
    "pettyCashAccountId" TEXT,
    "mobileMoneyClearingId" TEXT,
    "undepositedFundsId" TEXT,
    "bankChargesId" TEXT,
    "interestIncomeId" TEXT,
    "paymentProcessingChargesId" TEXT,
    "inventoryAssetId" TEXT,
    "costOfSalesId" TEXT,
    "inventoryAdjustmentId" TEXT,
    "inventoryGainId" TEXT,
    "inventoryLossId" TEXT,
    "inventoryWriteOffId" TEXT,
    "grniId" TEXT,
    "goodsInTransitId" TEXT,
    "outputTaxPayableId" TEXT,
    "inputTaxReceivableId" TEXT,
    "withholdingTaxPayableId" TEXT,
    "withholdingTaxReceivableId" TEXT,
    "payrollTaxPayableId" TEXT,
    "otherStatutoryLiabilitiesId" TEXT,
    "salariesWagesExpenseId" TEXT,
    "payrollPayableId" TEXT,
    "employeeBenefitsExpenseId" TEXT,
    "employeeDeductionsPayableId" TEXT,
    "employerContributionsExpenseId" TEXT,
    "fixedAssetCostId" TEXT,
    "accumulatedDepreciationId" TEXT,
    "depreciationExpenseId" TEXT,
    "assetDisposalId" TEXT,
    "gainOnDisposalId" TEXT,
    "lossOnDisposalId" TEXT,
    "assetRevaluationReserveId" TEXT,
    "retainedEarningsId" TEXT,
    "currentYearEarningsId" TEXT,
    "suspenseAccountId" TEXT,
    "roundingDifferenceId" TEXT,
    "fxGainId" TEXT,
    "fxLossId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "default_posting_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_accounting_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "valuationMethod" "InventoryValuationMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "automaticCogsPosting" BOOLEAN NOT NULL DEFAULT true,
    "negativeInventoryPolicy" TEXT NOT NULL DEFAULT 'PREVENT',
    "adjustmentRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "stockCountRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "inventoryAssetAccountId" TEXT,
    "costOfSalesAccountId" TEXT,
    "adjustmentAccountId" TEXT,
    "writeOffAccountId" TEXT,
    "gainAccountId" TEXT,
    "lossAccountId" TEXT,
    "grniAccountId" TEXT,
    "goodsInTransitAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_defaults" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "defaultArAccountId" TEXT,
    "customerPaymentTerms" TEXT,
    "defaultCreditLimit" DECIMAL(18,4),
    "defaultCustomerCurrency" TEXT,
    "defaultSalesTaxCode" TEXT,
    "defaultPriceList" TEXT,
    "customerNumberingFormat" TEXT,
    "creditControlPolicy" TEXT,
    "statementDeliveryMethod" TEXT,
    "defaultApAccountId" TEXT,
    "supplierPaymentTerms" TEXT,
    "defaultSupplierCurrency" TEXT,
    "defaultPurchaseTaxCode" TEXT,
    "supplierNumberingFormat" TEXT,
    "withholdingTaxStatus" TEXT,
    "supplierPaymentMethod" TEXT,
    "supplierApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "party_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banking_payment_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "defaultCashAccountId" TEXT,
    "defaultBankAccountId" TEXT,
    "pettyCashAccountId" TEXT,
    "mobileMoneyAccountId" TEXT,
    "creditCardClearingAccountId" TEXT,
    "paymentGatewayClearingId" TEXT,
    "undepositedFundsAccountId" TEXT,
    "bankChargesAccountId" TEXT,
    "interestIncomeAccountId" TEXT,
    "defaultReceiptMethod" TEXT,
    "defaultPaymentMethod" TEXT,
    "bankReconciliationMethod" TEXT,
    "paymentMethodAccountMap" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banking_payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "prefix" TEXT,
    "includeYear" BOOLEAN NOT NULL DEFAULT true,
    "includeMonth" BOOLEAN NOT NULL DEFAULT false,
    "includeBranch" BOOLEAN NOT NULL DEFAULT false,
    "sequenceLength" INTEGER NOT NULL DEFAULT 6,
    "startingNumber" INTEGER NOT NULL DEFAULT 1,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "resetFrequency" TEXT NOT NULL DEFAULT 'YEARLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_posting_controls" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "automaticPostingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "manualPostingRequired" BOOLEAN NOT NULL DEFAULT true,
    "approvalWorkflowEnabled" BOOLEAN NOT NULL DEFAULT true,
    "approvalLevels" INTEGER NOT NULL DEFAULT 1,
    "amountBasedApprovalLimits" JSONB,
    "backdatedTransactionPolicy" TEXT NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "futureDatedTransactionPolicy" TEXT NOT NULL DEFAULT 'ALLOW',
    "transactionEditingPolicy" TEXT NOT NULL DEFAULT 'DRAFT_ONLY',
    "transactionDeletionPolicy" TEXT NOT NULL DEFAULT 'DRAFT_ONLY',
    "supportingDocumentRequired" BOOLEAN NOT NULL DEFAULT false,
    "periodLockEnforcement" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_posting_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balance_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OpeningBalanceBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opening_balance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balance_lines" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT,
    "partyType" TEXT,
    "partyRef" TEXT,
    "memo" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opening_balance_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_section_statuses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sectionKey" "SetupSectionKey" NOT NULL,
    "status" "SetupSectionStatusValue" NOT NULL DEFAULT 'NOT_STARTED',
    "lastError" TEXT,
    "updatedByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_section_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_activations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "ActivationStatus" NOT NULL DEFAULT 'NOT_ACTIVATED',
    "activatedAt" TIMESTAMP(3),
    "activatedByErpUserId" INTEGER,
    "lastValidationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "erpUserId" INTEGER NOT NULL,
    "erpRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "sectionKey" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "sourceModule" TEXT NOT NULL DEFAULT 'ACCOUNTING',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_externalErpOrganizationId_key" ON "companies"("externalErpOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "company_branches_companyId_externalErpBranchId_key" ON "company_branches"("companyId", "externalErpBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_companyId_key" ON "company_profiles"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "business_accounting_info_companyId_key" ON "business_accounting_info"("companyId");

-- CreateIndex
CREATE INDEX "financial_years_companyId_startDate_endDate_idx" ON "financial_years"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "accounting_periods_financialYearId_status_idx" ON "accounting_periods"("financialYearId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_financialYearId_sequence_key" ON "accounting_periods"("financialYearId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "currency_settings_companyId_key" ON "currency_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_policies_companyId_key" ON "accounting_policies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "localization_settings_companyId_key" ON "localization_settings"("companyId");

-- CreateIndex
CREATE INDEX "accounts_companyId_type_idx" ON "accounts"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_companyId_code_key" ON "accounts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "default_posting_accounts_companyId_key" ON "default_posting_accounts"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_accounting_settings_companyId_key" ON "inventory_accounting_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "party_defaults_companyId_key" ON "party_defaults"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "banking_payment_settings_companyId_key" ON "banking_payment_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_companyId_documentType_key" ON "number_sequences"("companyId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "approval_posting_controls_companyId_key" ON "approval_posting_controls"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "setup_section_statuses_companyId_sectionKey_key" ON "setup_section_statuses"("companyId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_activations_companyId_key" ON "accounting_activations"("companyId");

-- CreateIndex
CREATE INDEX "audit_events_companyId_createdAt_idx" ON "audit_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_erpUserId_createdAt_idx" ON "audit_events"("erpUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_accounting_info" ADD CONSTRAINT "business_accounting_info_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "financial_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_settings" ADD CONSTRAINT "currency_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "localization_settings" ADD CONSTRAINT "localization_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "default_posting_accounts" ADD CONSTRAINT "default_posting_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_accounting_settings" ADD CONSTRAINT "inventory_accounting_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_defaults" ADD CONSTRAINT "party_defaults_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banking_payment_settings" ADD CONSTRAINT "banking_payment_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_posting_controls" ADD CONSTRAINT "approval_posting_controls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "opening_balance_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_section_statuses" ADD CONSTRAINT "setup_section_statuses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_activations" ADD CONSTRAINT "accounting_activations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

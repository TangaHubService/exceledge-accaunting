-- CreateTable
CREATE TABLE "recurring_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "every" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "nextDate" TIMESTAMP(3),
    "previousDate" TIMESTAMP(3),
    "daysInAdvance" INTEGER NOT NULL DEFAULT 0,
    "partyName" TEXT,
    "amount" DECIMAL(18,4),
    "payload" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "financialAccountId" TEXT,
    "matchAll" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "splits" JSONB NOT NULL,
    "payee" TEXT,
    "memo" TEXT,
    "keepMemo" BOOLEAN NOT NULL DEFAULT false,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_templates_companyId_isActive_nextDate_idx" ON "recurring_templates"("companyId", "isActive", "nextDate");

-- CreateIndex
CREATE INDEX "bank_rules_companyId_isActive_priority_idx" ON "bank_rules"("companyId", "isActive", "priority");

-- AddForeignKey
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


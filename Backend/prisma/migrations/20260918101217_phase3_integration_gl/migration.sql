-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED', 'POSTING_FAILED');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('AUTOMATIC', 'MANUAL', 'OPENING_BALANCE', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'POSTED', 'FAILED', 'REJECTED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "PostingExceptionStatus" AS ENUM ('OPEN', 'RETRYING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalOrganizationId" TEXT NOT NULL,
    "externalBranchId" TEXT,
    "sourceModule" TEXT NOT NULL,
    "sourceDocumentType" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceDocumentNumber" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_exceptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationEventId" TEXT,
    "journalId" TEXT,
    "reason" TEXT NOT NULL,
    "detailsJson" JSONB,
    "status" "PostingExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "journalNumber" TEXT NOT NULL,
    "journalDate" TIMESTAMP(3) NOT NULL,
    "postingDate" TIMESTAMP(3),
    "journalType" "JournalType" NOT NULL DEFAULT 'MANUAL',
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "referenceNumber" TEXT,
    "description" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'RWF',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "branchId" TEXT,
    "costCentre" TEXT,
    "project" TEXT,
    "totalDebit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdByErpUserId" INTEGER,
    "approvedByErpUserId" INTEGER,
    "postedByErpUserId" INTEGER,
    "reversedJournalId" TEXT,
    "reversesJournalId" TEXT,
    "sourceModule" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentNumber" TEXT,
    "integrationEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxCode" TEXT,
    "customerRef" TEXT,
    "supplierRef" TEXT,
    "project" TEXT,
    "costCentre" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "journalLineId" TEXT,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "journalNumber" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "sourceModule" TEXT,
    "sourceDocumentType" TEXT,
    "sourceDocumentId" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gl_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_document_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceDocumentType" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceDocumentNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_events_status_nextAttemptAt_idx" ON "integration_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "integration_events_companyId_eventType_idx" ON "integration_events"("companyId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_companyId_idempotencyKey_key" ON "integration_events"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "posting_exceptions_companyId_status_idx" ON "posting_exceptions"("companyId", "status");

-- CreateIndex
CREATE INDEX "journals_companyId_status_idx" ON "journals"("companyId", "status");

-- CreateIndex
CREATE INDEX "journals_companyId_journalDate_idx" ON "journals"("companyId", "journalDate");

-- CreateIndex
CREATE INDEX "journals_companyId_sourceDocumentType_sourceDocumentId_idx" ON "journals"("companyId", "sourceDocumentType", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "journals_companyId_journalNumber_key" ON "journals"("companyId", "journalNumber");

-- CreateIndex
CREATE INDEX "journal_lines_companyId_accountId_idx" ON "journal_lines"("companyId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journalId_lineNumber_key" ON "journal_lines"("journalId", "lineNumber");

-- CreateIndex
CREATE INDEX "gl_entries_companyId_accountId_postingDate_idx" ON "gl_entries"("companyId", "accountId", "postingDate");

-- CreateIndex
CREATE INDEX "gl_entries_companyId_journalId_idx" ON "gl_entries"("companyId", "journalId");

-- CreateIndex
CREATE INDEX "source_document_links_companyId_sourceDocumentType_sourceDo_idx" ON "source_document_links"("companyId", "sourceDocumentType", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "source_document_links_companyId_sourceModule_sourceDocument_key" ON "source_document_links"("companyId", "sourceModule", "sourceDocumentType", "sourceDocumentId", "journalId");

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_exceptions" ADD CONSTRAINT "posting_exceptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_document_links" ADD CONSTRAINT "source_document_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_document_links" ADD CONSTRAINT "source_document_links_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

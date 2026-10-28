-- Wave D: KPI targets, forecasts, anomaly rules and cases, signatures with content hashes, risk register and
-- control tests, API key rate limits and usage log, webhooks, notification email outbox, branch activation.

-- AlterTable
ALTER TABLE "anomaly_flags" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByErpUserId" INTEGER,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT NOT NULL DEFAULT 'Journal',
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "rule" TEXT NOT NULL DEFAULT 'AMOUNT_OUTLIER';

-- Existing flags are amount outliers on journals; repeated scans created several per journal.
UPDATE "anomaly_flags" SET "entityId" = "journalId" WHERE "entityId" IS NULL;

UPDATE "anomaly_flags" kept
SET "status" = 'DISMISSED'
WHERE kept."status" = 'OPEN'
  AND EXISTS (
    SELECT 1 FROM "anomaly_flags" d
    WHERE d."companyId" = kept."companyId" AND d."entityId" = kept."entityId" AND d."status" = 'DISMISSED' AND d."id" <> kept."id"
  );

DELETE FROM "anomaly_flags" a
USING "anomaly_flags" b
WHERE a."companyId" = b."companyId"
  AND a."rule" = b."rule"
  AND a."entityType" = b."entityType"
  AND a."entityId" = b."entityId"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

-- AlterTable
ALTER TABLE "api_credentials" ADD COLUMN     "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "company_branches" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "control_items" ADD COLUMN     "lastTestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "forecast_scenarios" ADD COLUMN     "createdByErpUserId" INTEGER;

-- AlterTable
ALTER TABLE "signature_records" ADD COLUMN     "approvalRequestId" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "signatureHash" TEXT,
ADD COLUMN     "signerErpRole" TEXT,
ADD COLUMN     "snapshot" JSONB;

-- CreateTable
CREATE TABLE "risk_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "residualLikelihood" INTEGER,
    "residualImpact" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ownerName" TEXT,
    "ownerErpUserId" INTEGER,
    "reviewDate" TIMESTAMP(3),
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_control_links" (
    "riskId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,

    CONSTRAINT "risk_control_links_pkey" PRIMARY KEY ("riskId","controlId")
);

-- CreateTable
CREATE TABLE "control_tests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL,
    "result" TEXT NOT NULL,
    "sampleSize" INTEGER,
    "notes" TEXT,
    "testedByErpUserId" INTEGER NOT NULL,
    "testedByErpRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_targets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "target" DECIMAL(18,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailMinSeverity" "NoticeSeverity" NOT NULL DEFAULT 'WARNING',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_emails" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientCount" INTEGER,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly_notes" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anomaly_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_usage" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "risk_items_companyId_code_key" ON "risk_items"("companyId", "code");

-- CreateIndex
CREATE INDEX "control_tests_companyId_controlId_testedAt_idx" ON "control_tests"("companyId", "controlId", "testedAt");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_targets_companyId_code_key" ON "kpi_targets"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_companyId_key" ON "notification_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_emails_notificationId_key" ON "notification_emails"("notificationId");

-- CreateIndex
CREATE INDEX "notification_emails_status_nextAttemptAt_idx" ON "notification_emails"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "anomaly_notes_flagId_createdAt_idx" ON "anomaly_notes"("flagId", "createdAt");

-- CreateIndex
CREATE INDEX "api_key_usage_credentialId_createdAt_idx" ON "api_key_usage"("credentialId", "createdAt");

-- CreateIndex
CREATE INDEX "api_key_usage_companyId_createdAt_idx" ON "api_key_usage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_endpoints_companyId_idx" ON "webhook_endpoints"("companyId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "anomaly_flags_companyId_rule_entityType_entityId_key" ON "anomaly_flags"("companyId", "rule", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "risk_items" ADD CONSTRAINT "risk_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_control_links" ADD CONSTRAINT "risk_control_links_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "risk_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_control_links" ADD CONSTRAINT "risk_control_links_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "control_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "control_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_notes" ADD CONSTRAINT "anomaly_notes_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "anomaly_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "api_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ar_credit_notes" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CREDIT';

-- CreateTable
CREATE TABLE "integration_keys" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_keys_companyId_idx" ON "integration_keys"("companyId");

-- AddForeignKey
ALTER TABLE "integration_keys" ADD CONSTRAINT "integration_keys_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trial balance and statements read the ledger by company and date.
CREATE INDEX "gl_entries_companyId_transactionDate_idx" ON "gl_entries"("companyId", "transactionDate");

-- NOT VALID: checked for every new or changed row, without failing on history.
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0)) NOT VALID;

-- Posted ledger rows never change. Deleting a whole company still works (its row is already gone when the cascade
-- arrives). Re-tagging a dimension is allowed; moving entries to another account only inside an account merge.
CREATE OR REPLACE FUNCTION "gl_entries_immutable"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM "companies" WHERE "id" = OLD."companyId") THEN
            RAISE EXCEPTION 'gl_entries cannot be deleted; reverse the journal instead';
        END IF;
        RETURN OLD;
    END IF;
    IF (to_jsonb(NEW) - 'accountId' - 'sourceDocumentId' - 'costCentre' - 'project' - 'branchId') IS DISTINCT FROM (to_jsonb(OLD) - 'accountId' - 'sourceDocumentId' - 'costCentre' - 'project' - 'branchId')
        OR ((NEW."accountId" IS DISTINCT FROM OLD."accountId" OR NEW."sourceDocumentId" IS DISTINCT FROM OLD."sourceDocumentId") AND COALESCE(current_setting('app.ledger_merge', true), '') <> 'on') THEN
        RAISE EXCEPTION 'gl_entries cannot be changed; reverse the journal instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gl_entries_immutable" BEFORE UPDATE OR DELETE ON "gl_entries"
    FOR EACH ROW EXECUTE FUNCTION "gl_entries_immutable"();

CREATE OR REPLACE FUNCTION "journals_posted_immutable"() RETURNS trigger AS $$
BEGIN
    IF OLD."status" NOT IN ('POSTED', 'REVERSED') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM "companies" WHERE "id" = OLD."companyId") THEN
            RAISE EXCEPTION 'A posted journal cannot be deleted; reverse it instead';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."status" NOT IN ('POSTED', 'REVERSED')
        OR NEW."journalNumber" IS DISTINCT FROM OLD."journalNumber" OR NEW."journalDate" IS DISTINCT FROM OLD."journalDate"
        OR NEW."totalDebit" IS DISTINCT FROM OLD."totalDebit" OR NEW."totalCredit" IS DISTINCT FROM OLD."totalCredit"
        OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode" OR NEW."exchangeRate" IS DISTINCT FROM OLD."exchangeRate" THEN
        RAISE EXCEPTION 'A posted journal cannot be changed; reverse it instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journals_posted_immutable" BEFORE UPDATE OR DELETE ON "journals"
    FOR EACH ROW EXECUTE FUNCTION "journals_posted_immutable"();

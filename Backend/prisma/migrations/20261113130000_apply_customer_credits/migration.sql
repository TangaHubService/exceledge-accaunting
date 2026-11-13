-- Apply customer credits: track the unapplied part of each credit note and where it was applied later.
ALTER TABLE "ar_credit_notes" ADD COLUMN "unapplied" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- Credit notes issued without an invoice have been sitting on account in full.
UPDATE "ar_credit_notes" SET "unapplied" = "gross" WHERE "invoiceId" IS NULL AND "status" = 'POSTED';

CREATE TABLE "ar_credit_applications" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "erpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ar_credit_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ar_credit_applications_creditNoteId_idx" ON "ar_credit_applications"("creditNoteId");
CREATE INDEX "ar_credit_applications_invoiceId_idx" ON "ar_credit_applications"("invoiceId");

ALTER TABLE "ar_credit_applications" ADD CONSTRAINT "ar_credit_applications_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "ar_credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ar_credit_applications" ADD CONSTRAINT "ar_credit_applications_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

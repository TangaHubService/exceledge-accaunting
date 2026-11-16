-- Apply supplier credits: track the unapplied part of each supplier credit note and where it was applied later.
-- AlterTable
ALTER TABLE "ap_credit_notes" ADD COLUMN     "unapplied" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- Supplier credits recorded without a bill have been sitting on account in full.
UPDATE "ap_credit_notes" SET "unapplied" = "gross" WHERE "billId" IS NULL AND "status" = 'POSTED';

-- CreateTable
CREATE TABLE "ap_credit_applications" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "erpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ap_credit_applications_creditNoteId_idx" ON "ap_credit_applications"("creditNoteId");

-- CreateIndex
CREATE INDEX "ap_credit_applications_billId_idx" ON "ap_credit_applications"("billId");

-- AddForeignKey
ALTER TABLE "ap_credit_applications" ADD CONSTRAINT "ap_credit_applications_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "ap_credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_credit_applications" ADD CONSTRAINT "ap_credit_applications_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

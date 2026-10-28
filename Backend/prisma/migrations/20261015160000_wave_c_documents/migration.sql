-- AlterEnum
ALTER TYPE "InventoryMovementKind" ADD VALUE 'SUPPLIER_RETURN';

-- AR receipts and credit notes created from ERP events or banking keep their source.
ALTER TABLE "ar_receipts" ADD COLUMN "sourceModule" TEXT,
ADD COLUMN "sourceDocumentType" TEXT,
ADD COLUMN "sourceDocumentId" TEXT;
CREATE INDEX "ar_receipts_companyId_sourceDocumentType_sourceDocumentId_idx" ON "ar_receipts"("companyId", "sourceDocumentType", "sourceDocumentId");

ALTER TABLE "ar_credit_notes" ADD COLUMN "sourceModule" TEXT,
ADD COLUMN "sourceDocumentType" TEXT,
ADD COLUMN "sourceDocumentId" TEXT;
CREATE INDEX "ar_credit_notes_companyId_sourceDocumentType_sourceDocumentId_idx" ON "ar_credit_notes"("companyId", "sourceDocumentType", "sourceDocumentId");

-- Sale cost now posts from the valuation subledger. Sales recorded before this had their cost in the sale journal.
ALTER TABLE "inventory_movements" ADD COLUMN "costInSaleJournal" BOOLEAN NOT NULL DEFAULT false;
UPDATE "inventory_movements" SET "costInSaleJournal" = true WHERE "kind" = 'SALE';

-- Goods received against purchase orders, matched by supplier bills to clear goods received not invoiced.
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT,
    "integrationEventId" TEXT,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "poReference" TEXT,
    "reference" TEXT,
    "value" DECIMAL(18,4) NOT NULL,
    "matchedValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "goods_receipts_integrationEventId_key" ON "goods_receipts"("integrationEventId");
CREATE INDEX "goods_receipts_companyId_supplierId_poReference_idx" ON "goods_receipts"("companyId", "supplierId", "poReference");
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bills: amount of goods received not invoiced the bill cleared, and void details.
ALTER TABLE "ap_bills" ADD COLUMN "grniCleared" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidJournalId" TEXT,
ADD COLUMN "voidedByErpUserId" INTEGER;

-- Invoice and bill line items.
CREATE TABLE "ar_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,4) NOT NULL,
    "taxCode" TEXT,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accountId" TEXT,

    CONSTRAINT "ar_invoice_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ar_invoice_lines_invoiceId_idx" ON "ar_invoice_lines"("invoiceId");
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ap_bill_lines" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,4) NOT NULL,
    "taxCode" TEXT,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accountId" TEXT,

    CONSTRAINT "ap_bill_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ap_bill_lines_billId_idx" ON "ap_bill_lines"("billId");
ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bank receipts and payments against a customer or supplier.
ALTER TABLE "bank_transactions" ADD COLUMN "customerId" TEXT,
ADD COLUMN "supplierId" TEXT,
ADD COLUMN "arReceiptId" TEXT,
ADD COLUMN "apPaymentId" TEXT;

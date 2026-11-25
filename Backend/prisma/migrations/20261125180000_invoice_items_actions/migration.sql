-- AlterTable
ALTER TABLE "ar_invoice_lines" ADD COLUMN "itemId" TEXT;

-- CreateTable
CREATE TABLE "invoice_actions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_actions_companyId_createdAt_idx" ON "invoice_actions"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_actions_invoiceId_kind_day_key" ON "invoice_actions"("invoiceId", "kind", "day");

-- AddForeignKey
ALTER TABLE "invoice_actions" ADD CONSTRAINT "invoice_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

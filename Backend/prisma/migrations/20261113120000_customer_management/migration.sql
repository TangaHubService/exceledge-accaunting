-- Customer management redesign: extra contact/billing fields and a dated notes history.
ALTER TABLE "customers" ADD COLUMN "companyName" TEXT;
ALTER TABLE "customers" ADD COLUMN "mobile" TEXT;
ALTER TABLE "customers" ADD COLUMN "shippingAddress" TEXT;
ALTER TABLE "customers" ADD COLUMN "preferredPaymentMethod" "ArPaymentMethod";

CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notes_companyId_customerId_createdAt_idx" ON "customer_notes"("companyId", "customerId", "createdAt");

ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

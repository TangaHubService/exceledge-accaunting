-- Sub-customers, tags, tax exemption, extra contacts, and refunds linked to customers for display.
ALTER TABLE "customers" ADD COLUMN "parentId" TEXT;
ALTER TABLE "customers" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "customers" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "taxExemptReason" TEXT;
CREATE INDEX "customers_companyId_parentId_idx" ON "customers"("companyId", "parentId");
ALTER TABLE "customers" ADD CONSTRAINT "customers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_contacts_companyId_customerId_idx" ON "customer_contacts"("companyId", "customerId");
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_transactions" ADD COLUMN "relatedCustomerId" TEXT;

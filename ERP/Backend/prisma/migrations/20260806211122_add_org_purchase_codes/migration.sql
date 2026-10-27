-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "prc_ord_cd" TEXT;

-- CreateTable
CREATE TABLE "organization_purchase_codes" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "buyerTin" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumed_sale_id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "organization_purchase_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_purchase_codes_organizationId_buyerTin_consume_idx" ON "organization_purchase_codes"("organizationId", "buyerTin", "consumed");

-- CreateIndex
CREATE UNIQUE INDEX "organization_purchase_codes_organizationId_code_key" ON "organization_purchase_codes"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "organization_purchase_codes" ADD CONSTRAINT "organization_purchase_codes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

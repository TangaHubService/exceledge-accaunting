-- Business VAT registration status. True (default) preserves the existing
-- behavior where a VAT-registered taxpayer applies the product's tax category
-- (A/B/C). When false, every sale must use RRA tax code D.
ALTER TABLE "organizations" ADD COLUMN "vatRegistered" BOOLEAN NOT NULL DEFAULT true;
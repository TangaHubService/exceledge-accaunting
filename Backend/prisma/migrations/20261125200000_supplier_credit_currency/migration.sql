-- AlterTable
ALTER TABLE "ap_credit_notes" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'RWF',
ADD COLUMN     "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1;

-- These were always in the company's own currency, but a company that doesn't keep its books in RWF had them marked RWF.
UPDATE "ap_credit_notes" d SET "currency" = upper(c."functionalCurrency") FROM "currency_settings" c WHERE c."companyId" = d."companyId" AND upper(c."functionalCurrency") <> 'RWF';
UPDATE "ar_deposits" d SET "currency" = upper(c."functionalCurrency") FROM "currency_settings" c WHERE c."companyId" = d."companyId" AND upper(c."functionalCurrency") <> 'RWF' AND d."currency" = 'RWF' AND d."exchangeRate" = 1;
UPDATE "ap_advances" d SET "currency" = upper(c."functionalCurrency") FROM "currency_settings" c WHERE c."companyId" = d."companyId" AND upper(c."functionalCurrency") <> 'RWF' AND d."currency" = 'RWF' AND d."exchangeRate" = 1;
UPDATE "ar_debit_notes" d SET "currency" = upper(c."functionalCurrency") FROM "currency_settings" c WHERE c."companyId" = d."companyId" AND upper(c."functionalCurrency") <> 'RWF' AND d."currency" = 'RWF' AND d."exchangeRate" = 1;
UPDATE "ap_debit_notes" d SET "currency" = upper(c."functionalCurrency") FROM "currency_settings" c WHERE c."companyId" = d."companyId" AND upper(c."functionalCurrency") <> 'RWF' AND d."currency" = 'RWF' AND d."exchangeRate" = 1;

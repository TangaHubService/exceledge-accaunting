-- Pharmacy insurance company fields on customers (VSDC BhfInsuranceSaveReq §3.3.3.3)
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isrccCd" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "isrcRt" DECIMAL(5,2);

-- RRA VSDC invoice compliance: structured buyer address on customers and
-- RRA refund-reason code on refund sales. Additive, nullable, no backfill.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "custPrvncNm" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "custDstrtNm" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "custSctrNm" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "custLocDesc" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "rfd_rsn_cd" TEXT;

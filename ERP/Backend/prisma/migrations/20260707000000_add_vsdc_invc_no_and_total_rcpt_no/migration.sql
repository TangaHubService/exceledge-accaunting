-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "vsdc_invc_no" INTEGER;

-- AlterTable
ALTER TABLE "ebm_transactions" ADD COLUMN     "totalRcptNo" INTEGER,
ADD COLUMN     "sdcId" TEXT;

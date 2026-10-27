/*
  Warnings:

  - You are about to drop the `invoice_processing_jobs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "invoice_processing_jobs" DROP CONSTRAINT "invoice_processing_jobs_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "invoice_processing_jobs" DROP CONSTRAINT "invoice_processing_jobs_organizationId_fkey";

-- DropTable
DROP TABLE "invoice_processing_jobs";

-- DropEnum
DROP TYPE "AiExtractionProvider";

-- DropEnum
DROP TYPE "InvoiceJobStatus";

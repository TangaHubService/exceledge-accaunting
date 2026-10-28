-- AlterTable
ALTER TABLE "accounting_documents" ADD COLUMN "storageKey" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "sizeBytes" INTEGER,
ADD COLUMN "sha256" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "accounting_documents_storageKey_key" ON "accounting_documents"("storageKey");

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'MERGED', 'NEW');

-- CreateEnum
CREATE TYPE "ImportItemStatus" AS ENUM ('PENDING', 'IMPORTED', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "supplierName" TEXT,
    "supplierAddress" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "subtotal" DECIMAL(10,2),
    "taxAmount" DECIMAL(10,2),
    "discount" DECIMAL(10,2),
    "totalAmount" DECIMAL(10,2),
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_items" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "sellingPrice" DECIMAL(10,2),
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "taxRate" DECIMAL(5,2),
    "category" TEXT,
    "manufacturer" TEXT,
    "confidence" DOUBLE PRECISION,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "importStatus" "ImportItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,

    CONSTRAINT "supplier_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_files" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoice_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_results" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "rawOutput" JSONB NOT NULL,
    "parsedData" JSONB,
    "confidence" DOUBLE PRECISION,
    "processingMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_import_logs" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "importedItems" INTEGER NOT NULL,
    "skippedItems" INTEGER NOT NULL,
    "errorItems" INTEGER NOT NULL,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_invoices_organizationId_idx" ON "supplier_invoices"("organizationId");
CREATE INDEX "supplier_invoices_branchId_idx" ON "supplier_invoices"("branchId");
CREATE INDEX "supplier_invoices_supplierId_idx" ON "supplier_invoices"("supplierId");
CREATE INDEX "supplier_invoices_status_idx" ON "supplier_invoices"("status");
CREATE INDEX "supplier_invoices_organizationId_status_idx" ON "supplier_invoices"("organizationId", "status");

CREATE INDEX "supplier_invoice_items_invoiceId_idx" ON "supplier_invoice_items"("invoiceId");
CREATE INDEX "supplier_invoice_items_productId_idx" ON "supplier_invoice_items"("productId");

CREATE INDEX "supplier_invoice_files_invoiceId_idx" ON "supplier_invoice_files"("invoiceId");

CREATE INDEX "ocr_results_invoiceId_idx" ON "ocr_results"("invoiceId");

CREATE INDEX "invoice_import_logs_invoiceId_idx" ON "invoice_import_logs"("invoiceId");
CREATE INDEX "invoice_import_logs_organizationId_idx" ON "invoice_import_logs"("organizationId");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_invoice_files" ADD CONSTRAINT "supplier_invoice_files_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_import_logs" ADD CONSTRAINT "invoice_import_logs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_import_logs" ADD CONSTRAINT "invoice_import_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_import_logs" ADD CONSTRAINT "invoice_import_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

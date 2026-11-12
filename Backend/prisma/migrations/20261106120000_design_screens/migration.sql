-- CreateEnum
CREATE TYPE "CommercialDocumentKind" AS ENUM ('ESTIMATE', 'PROPOSAL', 'SALES_ORDER', 'DELAYED_CHARGE', 'DELAYED_CREDIT', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "CommercialDocumentStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING', 'ACCEPTED', 'DECLINED', 'OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CONVERTED', 'CLOSED', 'VOID');

-- CreateEnum
CREATE TYPE "ItemReceiptStatus" AS ENUM ('RECEIVED', 'BILLED');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentType" AS ENUM ('QUANTITY', 'VALUE');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "commercial_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CommercialDocumentKind" NOT NULL,
    "series" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "CommercialDocumentStatus" NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "partyName" TEXT NOT NULL,
    "leadName" TEXT,
    "leadEmail" TEXT,
    "contact" TEXT,
    "billTo" TEXT,
    "shipTo" TEXT,
    "shipVia" TEXT,
    "terms" TEXT,
    "docDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "acceptedDate" TIMESTAMP(3),
    "memo" TEXT,
    "note" TEXT,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "discountPct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,4) NOT NULL,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL,
    "deposit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "convertedToType" TEXT,
    "convertedToId" TEXT,
    "convertedToNumber" TEXT,
    "meta" JSONB,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_document_lines" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3),
    "itemId" TEXT,
    "accountId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,4) NOT NULL,
    "taxCode" TEXT,
    "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "commercial_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "goodsReceiptId" TEXT,
    "journalId" TEXT,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "value" DECIMAL(18,4) NOT NULL,
    "status" "ItemReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
    "billId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "description" TEXT,
    "purchaseOrderLineId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "taxCode" TEXT,

    CONSTRAINT "item_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "InventoryAdjustmentType" NOT NULL,
    "status" "InventoryAdjustmentStatus" NOT NULL,
    "adjustmentDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "memo" TEXT,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "journalId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustment_lines" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "change" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4),
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerAddress" TEXT,
    "email" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "budget" DECIMAL(18,4),
    "customFields" JSONB,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assignee" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT,
    "links" JSONB,
    "files" JSONB,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "preferredName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "gender" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "employmentType" TEXT,
    "joiningDate" TIMESTAMP(3),
    "workLocation" TEXT,
    "reportingManager" TEXT,
    "employmentStatus" TEXT NOT NULL DEFAULT 'active',
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "probation" TEXT,
    "workSchedule" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationalId" TEXT,
    "payFrequency" TEXT,
    "currency" TEXT,
    "basicSalary" DECIMAL(18,4),
    "effectiveFrom" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "bankName" TEXT,
    "accountHolder" TEXT,
    "accountNumber" TEXT,
    "tin" TEXT,
    "rssb" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_activities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "personName" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "projectId" TEXT,
    "service" TEXT,
    "activityDate" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "hourlyRate" DECIMAL(18,4),
    "notes" TEXT,
    "batchId" TEXT,
    "createdByErpUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_records" (
    "companyId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "ownerErpUserId" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_records_pkey" PRIMARY KEY ("companyId","collection","recordId","ownerErpUserId")
);

-- CreateIndex
CREATE INDEX "commercial_documents_companyId_kind_status_docDate_idx" ON "commercial_documents"("companyId", "kind", "status", "docDate");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_documents_companyId_series_number_key" ON "commercial_documents"("companyId", "series", "number");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_document_lines_documentId_lineNumber_key" ON "commercial_document_lines"("documentId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "item_receipts_goodsReceiptId_key" ON "item_receipts"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "item_receipts_companyId_supplierId_status_idx" ON "item_receipts"("companyId", "supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "item_receipts_companyId_number_key" ON "item_receipts"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "item_receipt_lines_receiptId_lineNumber_key" ON "item_receipt_lines"("receiptId", "lineNumber");

-- CreateIndex
CREATE INDEX "inventory_adjustments_companyId_status_adjustmentDate_idx" ON "inventory_adjustments"("companyId", "status", "adjustmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_adjustments_companyId_number_key" ON "inventory_adjustments"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_adjustment_lines_adjustmentId_lineNumber_key" ON "inventory_adjustment_lines"("adjustmentId", "lineNumber");

-- CreateIndex
CREATE INDEX "projects_companyId_status_idx" ON "projects"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_companyId_code_key" ON "projects"("companyId", "code");

-- CreateIndex
CREATE INDEX "project_links_projectId_idx" ON "project_links"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_links_companyId_kind_sourceId_key" ON "project_links"("companyId", "kind", "sourceId");

-- CreateIndex
CREATE INDEX "tasks_companyId_done_dueDate_idx" ON "tasks"("companyId", "done", "dueDate");

-- CreateIndex
CREATE INDEX "employees_companyId_employmentStatus_idx" ON "employees"("companyId", "employmentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_employeeNumber_key" ON "employees"("companyId", "employeeNumber");

-- CreateIndex
CREATE INDEX "time_activities_companyId_activityDate_idx" ON "time_activities"("companyId", "activityDate");

-- CreateIndex
CREATE INDEX "time_activities_companyId_employeeId_activityDate_idx" ON "time_activities"("companyId", "employeeId", "activityDate");

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_documents" ADD CONSTRAINT "commercial_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_document_lines" ADD CONSTRAINT "commercial_document_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "commercial_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_document_lines" ADD CONSTRAINT "commercial_document_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "commercial_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipt_lines" ADD CONSTRAINT "item_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "item_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipt_lines" ADD CONSTRAINT "item_receipt_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_activities" ADD CONSTRAINT "time_activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_activities" ADD CONSTRAINT "time_activities_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_activities" ADD CONSTRAINT "time_activities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_activities" ADD CONSTRAINT "time_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_records" ADD CONSTRAINT "workspace_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ar_credit_notes_companyId_sourceDocumentType_sourceDocumentId_i" RENAME TO "ar_credit_notes_companyId_sourceDocumentType_sourceDocument_idx";


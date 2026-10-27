// Shared shape between the two client-side extraction paths (Tesseract
// heuristic in invoiceOcr.ts, AI vision call in aiInvoiceExtraction.ts) and
// what the backend's normalizeExtractedData (Backend/src/services/ocr.service.ts)
// consumes — keep these three in sync.

export interface ExtractedProduct {
  productName: string;
  description?: string;
  sku?: string;
  barcode?: string;
  batchNumber?: string;
  expiryDate?: string;
  quantity: number;
  unitPrice: number;
  sellingPrice?: number;
  totalPrice?: number;
  taxRate?: number;
  /** Absolute tax amount for this line, distinct from taxRate (%). */
  taxAmount?: number;
  category?: string;
  manufacturer?: string;
  confidence: number;
}

export interface ExtractedInvoiceData {
  supplierName?: string;
  supplierAddress?: string;
  /** Vendor's Tax Identification Number (RRA TIN or equivalent), if present on the document. */
  vendorTIN?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  currency?: string;
  paymentTerms?: string;
  dueDate?: string;
  /** Purchase order reference as printed on the invoice, for ERP PO matching. */
  poNumber?: string;
  subtotal?: number;
  taxAmount?: number;
  discount?: number;
  totalAmount?: number;
  products: ExtractedProduct[];
  rawText?: string;
  confidence: number;
  provider: string;
  processingMs: number;
}

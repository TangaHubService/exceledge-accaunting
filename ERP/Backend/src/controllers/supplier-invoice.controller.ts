import type { Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../lib/prisma';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { buildBranchFilter, getBranchIdForOperation } from '../middleware/branchAuth.middleware';
import { auditLogger } from '../utils/auditLogger';
import { success, error as apiError } from '../utils/apiResponse';
import { addStock } from '../services/inventory-ledger.service';
import { normalizeExtractedData, clampMoney, clampTaxRate } from '../services/ocr.service';
import { analyzeInvoice } from '../services/invoice-analysis.service';
import { config } from '../config';
import { getOrderBy } from '../utils/sorting';
import { enqueueScannedSupplierBillAccountingEvent } from '../services/accounting-outbox.service';
import {
  isLocalPurchaseRegistrationOn,
  queueLocalPurchase,
  registerLocalPurchaseAsync,
  type LocalPurchaseLine,
} from '../services/vsdc-local-purchase.service';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'invoices');

// ── Upload & OCR ──────────────────────────────────────────────────────────

export const uploadAndScanInvoice = async (req: BranchAuthRequest, res: Response) => {
  const start = Date.now();
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt((req as any).user?.userId);
    const branchId = getBranchIdForOperation(req);
    const file = req.file;

    if (!file) {
      return res.status(400).json(apiError('No file uploaded'));
    }

    const filePath = file.path;
    const mimeType = file.mimetype;

    // 1. Create the invoice record in PROCESSING state
    const invoice = await prisma.supplierInvoice.create({
      data: {
        organizationId,
        branchId,
        createdById: userId,
        status: 'PROCESSING',
      },
    });

    // 2. Save file metadata
    await prisma.supplierInvoiceFile.create({
      data: {
        invoiceId: invoice.id,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType,
        fileSize: file.size,
        filePath: filePath.replace(/\\/g, '/'),
      },
    });

    // 3. Parse the data extracted client-side (scanning runs in the browser)
    let extractedData;
    let ocrError: string | null = null;

    try {
      const raw = req.body.extractedData ? JSON.parse(req.body.extractedData) : null;
      if (!raw || !Array.isArray(raw.products)) {
        throw new Error('No scan data received');
      }
      extractedData = normalizeExtractedData(raw);
    } catch (err: any) {
      ocrError = err.message || 'No scan data received';
      extractedData = normalizeExtractedData(null);
      extractedData.processingMs = Date.now() - start;
    }

    // 4. Save OCR result (original is immutable)
    await prisma.ocrResult.create({
      data: {
        invoiceId: invoice.id,
        provider: extractedData.provider,
        rawOutput: extractedData as any,
        confidence: extractedData.confidence,
        processingMs: extractedData.processingMs,
      },
    });

    // 5. Create invoice items from extracted data
    const items = extractedData.products.map((p) => ({
      invoiceId: invoice.id,
      productName: p.productName,
      description: p.description || null,
      sku: p.sku || null,
      barcode: p.barcode || null,
      batchNumber: p.batchNumber || null,
      expiryDate: p.expiryDate ? new Date(p.expiryDate) : null,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      sellingPrice: p.sellingPrice || null,
      totalPrice: p.totalPrice ?? p.quantity * p.unitPrice,
      taxRate: p.taxRate || null,
      taxAmount: p.taxAmount || null,
      category: p.category || null,
      manufacturer: p.manufacturer || null,
      confidence: p.confidence,
    }));

    if (items.length > 0) {
      await prisma.supplierInvoiceItem.createMany({ data: items });
    }

    // 6. Update invoice with extracted header data and REVIEW status
    const updatedInvoice = await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        status: ocrError ? 'REVIEW' : 'REVIEW',
        supplierName: extractedData.supplierName || null,
        supplierAddress: extractedData.supplierAddress || null,
        vendorTIN: extractedData.vendorTIN || null,
        invoiceNumber: extractedData.invoiceNumber || null,
        invoiceDate: extractedData.invoiceDate ? new Date(extractedData.invoiceDate) : null,
        currency: extractedData.currency || 'RWF',
        paymentTerms: extractedData.paymentTerms || null,
        dueDate: extractedData.dueDate ? new Date(extractedData.dueDate) : null,
        poNumber: extractedData.poNumber || null,
        subtotal: extractedData.subtotal ?? null,
        taxAmount: extractedData.taxAmount ?? null,
        discount: extractedData.discount ?? null,
        totalAmount: extractedData.totalAmount ?? null,
      },
      include: {
        items: true,
        files: true,
        ocrResults: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });

    // Semantic analysis (math verification, duplicate lines, fraud score, PO
    // match) runs on whatever was just extracted, regardless of source — it
    // doesn't care whether the client used the AI call or the Tesseract
    // fallback. Non-fatal: a bug here shouldn't block the upload response.
    if (items.length > 0) {
      try {
        await analyzeInvoice(invoice.id);
      } catch (analysisErr) {
        console.error('[Invoice Analysis Error]:', analysisErr);
      }
    }

    await auditLogger.inventory(req, {
      type: 'OTHER',
      description: `Scanned supplier invoice: ${file.originalname}`,
      entityType: 'supplier_invoice',
      entityId: invoice.id,
      metadata: { provider: extractedData.provider, itemsFound: items.length, ocrError },
    });

    const finalInvoice = items.length > 0
      ? await prisma.supplierInvoice.findUnique({
          where: { id: invoice.id },
          include: {
            items: true,
            files: true,
            ocrResults: { orderBy: { createdAt: 'asc' }, take: 1 },
          },
        })
      : updatedInvoice;

    res.json(success(finalInvoice, ocrError
      ? `File uploaded. OCR unavailable: ${ocrError}. Please enter product details manually.`
      : `Invoice scanned successfully. Found ${items.length} products.`
    ));
  } catch (err: any) {
    console.error('[Upload Invoice Error]:', err);
    res.status(500).json(apiError('Failed to process invoice', undefined, err.message));
  }
};

// ── List invoices ─────────────────────────────────────────────────────────

export const getInvoices = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { status, page = '1', limit = '20', search } = req.query;
    const branchFilter = buildBranchFilter(req);

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { organizationId, ...branchFilter };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search as string, mode: 'insensitive' } },
        { supplierName: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.supplierInvoice.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          files: { select: { id: true, originalName: true, mimeType: true } },
          _count: { select: { items: true } },
        },
        orderBy: getOrderBy(req.query, {
          invoiceNumber: { invoiceNumber: '$direction' },
          supplierName: { supplierName: '$direction' },
          totalAmount: { totalAmount: '$direction' },
          status: { status: '$direction' },
          invoiceDate: { invoiceDate: '$direction' },
          createdAt: { createdAt: '$direction' },
        }, 'createdAt', 'desc'),
        skip,
        take: limitNum,
      }),
      prisma.supplierInvoice.count({ where }),
    ]);

    res.json(success({
      data: invoices,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limitNum),
        currentPage: pageNum,
        limit: limitNum,
      },
    }));
  } catch (err: any) {
    console.error('[Get Invoices Error]:', err);
    res.status(500).json(apiError('Failed to fetch invoices'));
  }
};

// ── Get single invoice ────────────────────────────────────────────────────

export const getInvoice = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const branchFilter = buildBranchFilter(req);

    const invoice = await prisma.supplierInvoice.findFirst({
      where: { id, organizationId, ...branchFilter },
      include: {
        supplier: true,
        createdBy: { select: { id: true, name: true, email: true } },
        items: { orderBy: { id: 'asc' } },
        files: true,
        ocrResults: { orderBy: { createdAt: 'asc' }, take: 1 },
        importLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!invoice) {
      return res.status(404).json(apiError('Invoice not found'));
    }

    res.json(success(invoice));
  } catch (err: any) {
    console.error('[Get Invoice Error]:', err);
    res.status(500).json(apiError('Failed to fetch invoice'));
  }
};

// ── Update invoice items (edit extracted data) ────────────────────────────

export const updateInvoiceItems = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const { items, invoiceHeader } = req.body;
    const branchFilter = buildBranchFilter(req);

    const invoice = await prisma.supplierInvoice.findFirst({
      where: { id, organizationId, ...branchFilter },
    });

    if (!invoice) {
      return res.status(404).json(apiError('Invoice not found'));
    }

    if (invoice.status === 'IMPORTED') {
      return res.status(400).json(apiError('Cannot edit an already imported invoice'));
    }

    await prisma.$transaction(async (tx) => {
      // Update invoice header fields if provided
      if (invoiceHeader) {
        await tx.supplierInvoice.update({
          where: { id },
          data: {
            invoiceNumber: invoiceHeader.invoiceNumber ?? invoice.invoiceNumber,
            invoiceDate: invoiceHeader.invoiceDate ? new Date(invoiceHeader.invoiceDate) : invoice.invoiceDate,
            supplierName: invoiceHeader.supplierName ?? invoice.supplierName,
            supplierId: invoiceHeader.supplierId ?? invoice.supplierId,
            vendorTIN: invoiceHeader.vendorTIN ?? invoice.vendorTIN,
            currency: invoiceHeader.currency ?? invoice.currency,
            paymentTerms: invoiceHeader.paymentTerms ?? invoice.paymentTerms,
            dueDate: invoiceHeader.dueDate ? new Date(invoiceHeader.dueDate) : invoice.dueDate,
            poNumber: invoiceHeader.poNumber ?? invoice.poNumber,
            notes: invoiceHeader.notes ?? invoice.notes,
            subtotal: invoiceHeader.subtotal != null ? clampMoney(Number(invoiceHeader.subtotal)) : invoice.subtotal,
            taxAmount: invoiceHeader.taxAmount != null ? clampMoney(Number(invoiceHeader.taxAmount)) : invoice.taxAmount,
            discount: invoiceHeader.discount != null ? clampMoney(Number(invoiceHeader.discount)) : invoice.discount,
            totalAmount: invoiceHeader.totalAmount != null ? clampMoney(Number(invoiceHeader.totalAmount)) : invoice.totalAmount,
          },
        });
      }

      if (!Array.isArray(items)) return;

      for (const item of items) {
        if (item._action === 'delete' && item.id) {
          await tx.supplierInvoiceItem.delete({ where: { id: item.id } });
        } else if (item._action === 'create' || !item.id) {
          await tx.supplierInvoiceItem.create({
            data: {
              invoiceId: id,
              productName: item.productName,
              description: item.description || null,
              sku: item.sku || null,
              barcode: item.barcode || null,
              batchNumber: item.batchNumber || null,
              expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
              quantity: parseInt(item.quantity) || 0,
              unitPrice: clampMoney(parseFloat(item.unitPrice) || 0),
              sellingPrice: item.sellingPrice ? clampMoney(parseFloat(item.sellingPrice)) : null,
              totalPrice: clampMoney(parseFloat(item.totalPrice) || 0),
              taxRate: item.taxRate ? clampTaxRate(parseFloat(item.taxRate)) : null,
              taxAmount: item.taxAmount ? clampMoney(parseFloat(item.taxAmount)) : null,
              category: item.category || null,
              manufacturer: item.manufacturer || null,
            },
          });
        } else if (item.id) {
          await tx.supplierInvoiceItem.update({
            where: { id: item.id },
            data: {
              productName: item.productName,
              description: item.description || null,
              sku: item.sku || null,
              barcode: item.barcode || null,
              batchNumber: item.batchNumber || null,
              expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
              quantity: parseInt(item.quantity) || 0,
              unitPrice: clampMoney(parseFloat(item.unitPrice) || 0),
              sellingPrice: item.sellingPrice ? clampMoney(parseFloat(item.sellingPrice)) : null,
              totalPrice: clampMoney(parseFloat(item.totalPrice) || 0),
              taxRate: item.taxRate ? clampTaxRate(parseFloat(item.taxRate)) : null,
              taxAmount: item.taxAmount ? clampMoney(parseFloat(item.taxAmount)) : null,
              category: item.category || null,
              manufacturer: item.manufacturer || null,
            },
          });
        }
      }
    });

    try {
      await analyzeInvoice(id);
    } catch (analysisErr) {
      console.error('[Invoice Analysis Error]:', analysisErr);
    }

    const updated = await prisma.supplierInvoice.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { id: 'asc' } } },
    });

    res.json(success(updated, 'Invoice updated successfully'));
  } catch (err: any) {
    console.error('[Update Invoice Items Error]:', err);
    res.status(500).json(apiError('Failed to update invoice'));
  }
};

// ── Match products against existing inventory ─────────────────────────────

export const matchProducts = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { items } = req.body as { items: Array<{ productName: string; barcode?: string; sku?: string }> };

    if (!Array.isArray(items) || items.length === 0) {
      return res.json(success([]));
    }

    const results = await Promise.all(
      items.map(async (item) => {
        // Priority 1: exact barcode match
        if (item.barcode) {
          const byBarcode = await prisma.product.findFirst({
            where: { organizationId, barcode: item.barcode, deletedAt: null, isActive: true },
            select: { id: true, name: true, barcode: true, sku: true, quantity: true, unitPrice: true },
          });
          if (byBarcode) return { item, match: byBarcode, matchType: 'barcode', confidence: 1.0 };
        }

        // Priority 2: exact SKU match
        if (item.sku) {
          const bySku = await prisma.product.findFirst({
            where: { organizationId, sku: item.sku, deletedAt: null, isActive: true },
            select: { id: true, name: true, barcode: true, sku: true, quantity: true, unitPrice: true },
          });
          if (bySku) return { item, match: bySku, matchType: 'sku', confidence: 0.95 };
        }

        // Priority 3: name contains search
        const byName = await prisma.product.findFirst({
          where: {
            organizationId,
            deletedAt: null,
            isActive: true,
            name: { contains: item.productName, mode: 'insensitive' },
          },
          select: { id: true, name: true, barcode: true, sku: true, quantity: true, unitPrice: true },
        });

        if (byName) {
          // Rough confidence based on name similarity
          const similarity = item.productName.toLowerCase().includes(byName.name.toLowerCase()) ? 0.8 : 0.6;
          return { item, match: byName, matchType: 'name', confidence: similarity };
        }

        return { item, match: null, matchType: 'none', confidence: 0 };
      })
    );

    res.json(success(results));
  } catch (err: any) {
    console.error('[Match Products Error]:', err);
    res.status(500).json(apiError('Failed to match products'));
  }
};

// ── Import products into inventory ────────────────────────────────────────

export const importInvoiceProducts = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const userId = parseInt((req as any).user?.userId);
    const branchId = getBranchIdForOperation(req);
    const { itemActions } = req.body as {
      itemActions: Array<{
        itemId: number;
        action: 'create' | 'update' | 'skip';
        productId?: number;
        data?: Record<string, any>;
      }>;
    };
    const branchFilter = buildBranchFilter(req);

    const invoice = await prisma.supplierInvoice.findFirst({
      where: { id, organizationId, ...branchFilter },
      include: { items: true },
    });

    if (!invoice) {
      return res.status(404).json(apiError('Invoice not found'));
    }

    if (invoice.status === 'IMPORTED') {
      return res.status(400).json(apiError('Invoice has already been imported'));
    }

    // Link (or create) the Supplier record so this supplier shows up in the
    // supplier list, without duplicating one that already exists by name.
    let supplierId = invoice.supplierId;
    const supplierName = invoice.supplierName?.trim();
    if (!supplierId && supplierName) {
      const existingSupplier = await prisma.supplier.findFirst({
        where: { organizationId, name: { equals: supplierName, mode: 'insensitive' } },
      });

      const supplier = existingSupplier || await prisma.supplier.create({
        data: {
          organizationId,
          name: supplierName,
          email: '',
          address: invoice.supplierAddress || null,
        },
      });

      supplierId = supplier.id;
      await prisma.supplierInvoice.update({ where: { id }, data: { supplierId } });
    }

    const actionsMap = new Map(itemActions.map((a) => [a.itemId, a]));

    let importedItems = 0;
    let receivedAtCost = 0;
    let skippedItems = 0;
    let errorItems = 0;
    const importErrors: Array<{ itemId: number; error: string }> = [];
    const vsdcPurchaseOn = await isLocalPurchaseRegistrationOn(organizationId);
    const receiptLines: LocalPurchaseLine[] = [];

    // Each item gets its own transaction: once a Postgres statement fails, the
    // whole transaction is aborted and refuses further commands (25P02), so a
    // single bad item can't be allowed to share a transaction with the others
    // (or with the ERROR-status write that records its own failure).
    for (const item of invoice.items) {
      const action = actionsMap.get(item.id);

      if (!action || action.action === 'skip') {
        await prisma.supplierInvoiceItem.update({
          where: { id: item.id },
          data: { importStatus: 'SKIPPED' },
        });
        skippedItems++;
        continue;
      }

      let committedLine: LocalPurchaseLine | null = null;
      try {
        await prisma.$transaction(
          async (tx) => {
            const mergedData = { ...item, ...(action.data || {}) };
            const qty = parseInt(String(mergedData.quantity)) || 0;
            const unitPrice = clampMoney(parseFloat(String(mergedData.unitPrice)) || 0);
            // Selling price must never default to cost — that's a zero-margin (or free)
            // product. Prefer the OCR-extracted selling price; if none was extracted,
            // fall back to a configured markup over cost rather than cost itself.
            const extractedSellingPrice = mergedData.sellingPrice != null
              ? clampMoney(parseFloat(String(mergedData.sellingPrice)))
              : 0;
            const sellingPrice = extractedSellingPrice > 0
              ? extractedSellingPrice
              : clampMoney(unitPrice * (1 + config.inventory.defaultMarkupPercent / 100));
            const batchNumber = mergedData.batchNumber || `INV-${id}-${item.id}`;
            const expiryDate = mergedData.expiryDate ? new Date(mergedData.expiryDate) : null;

            if (action.action === 'update' && action.productId) {
              // Update existing product — add stock via ledger
              const existing = await tx.product.findUnique({ where: { id: action.productId } });
              if (!existing) throw new Error('Product not found');

              await tx.batch.upsert({
                where: {
                  productId_batchNumber_branchId: {
                    productId: action.productId,
                    batchNumber,
                    branchId,
                  },
                },
                update: {
                  quantity: { increment: qty },
                  unitCost: unitPrice,
                  expiryDate,
                  isActive: true,
                },
                create: {
                  productId: action.productId,
                  organizationId,
                  branchId,
                  batchNumber,
                  quantity: qty,
                  unitCost: unitPrice,
                  expiryDate,
                },
              });

              await addStock({
                organizationId,
                productId: action.productId,
                userId,
                quantity: qty,
                movementType: 'PURCHASE',
                branchId,
                unitCost: unitPrice,
                reference: `INV-${invoice.invoiceNumber || id}`,
                referenceType: 'supplier_invoice',
                batchNumber,
                expiryDate: expiryDate || undefined,
                note: `Imported from invoice ${invoice.invoiceNumber || id}`,
                metadata: { invoiceId: id },
                skipEbmSync: vsdcPurchaseOn,
                tx,
              });
              committedLine = { productId: action.productId, quantity: qty, unitCost: unitPrice, expiryDate };

              // NOTE (stock S14): addStock above already increments
              // Product.quantity via the centralized ledger service. Do NOT
              // add a second product.update increment here — that would
              // double-count the cache (ledger runningBalance stays correct).

              await tx.supplierInvoiceItem.update({
                where: { id: item.id },
                data: {
                  importStatus: 'IMPORTED',
                  productId: action.productId,
                  matchStatus: 'MATCHED',
                },
              });

            } else {
              // Create new product — create with quantity 0; the addStock
              // below (centralized ledger service) performs the single
              // Product.quantity increment. Creating with qty AND calling
              // addStock would double-count (S14).
              const newProduct = await tx.product.create({
                data: {
                  name: String(mergedData.productName || 'Unknown Product'),
                  sku: mergedData.sku || null,
                  barcode: mergedData.barcode || null,
                  batchNumber,
                  quantity: 0,
                  unitPrice: sellingPrice,
                  expiryDate,
                  category: mergedData.category || null,
                  description: mergedData.description || null,
                  organizationId,
                  isActive: true,
                  measurementUnit: 'OTHER',
                  taxCategory: 'STANDARD',
                  itemType: 'PRODUCT',
                },
              });

              await tx.batch.create({
                data: {
                  productId: newProduct.id,
                  organizationId,
                  branchId,
                  batchNumber,
                  quantity: qty,
                  unitCost: unitPrice,
                  expiryDate,
                },
              });

              await addStock({
                organizationId,
                productId: newProduct.id,
                userId,
                quantity: qty,
                movementType: 'PURCHASE',
                branchId,
                unitCost: unitPrice,
                reference: `INV-${invoice.invoiceNumber || id}`,
                referenceType: 'supplier_invoice',
                batchNumber,
                expiryDate: expiryDate || undefined,
                note: `Created from invoice ${invoice.invoiceNumber || id}`,
                metadata: { invoiceId: id },
                skipEbmSync: vsdcPurchaseOn,
                tx,
              });
              committedLine = { productId: newProduct.id, quantity: qty, unitCost: unitPrice, expiryDate };

              await tx.supplierInvoiceItem.update({
                where: { id: item.id },
                data: {
                  importStatus: 'IMPORTED',
                  productId: newProduct.id,
                  matchStatus: 'NEW',
                },
              });
            }
          },
          { timeout: 30000 }
        );
        if (committedLine) receiptLines.push(committedLine);

        const merged = { ...item, ...(action.data || {}) };
        receivedAtCost += (parseInt(String(merged.quantity)) || 0) * clampMoney(parseFloat(String(merged.unitPrice)) || 0);
        importedItems++;
      } catch (itemErr: any) {
        console.error(`[Import Item ${item.id} Error]:`, itemErr);
        try {
          await prisma.supplierInvoiceItem.update({
            where: { id: item.id },
            data: { importStatus: 'ERROR', errorMessage: itemErr.message },
          });
        } catch (statusErr: any) {
          console.error(`[Import Item ${item.id} Status Update Error]:`, statusErr);
        }
        errorItems++;
        importErrors.push({ itemId: item.id, error: itemErr.message });
      }
    }

    // Mark invoice as imported and log the run (separate from the per-item
    // transactions above, so it always runs regardless of item-level errors)
    await prisma.$transaction([
      prisma.supplierInvoice.update({
        where: { id },
        data: { status: 'IMPORTED', importedAt: new Date() },
      }),
      prisma.invoiceImportLog.create({
        data: {
          invoiceId: id,
          organizationId,
          branchId,
          userId,
          totalItems: invoice.items.length,
          importedItems,
          skippedItems,
          errorItems,
          summary: { errors: importErrors },
        },
      }),
    ]);

    if (vsdcPurchaseOn && receiptLines.length > 0) {
      const supplier = supplierId
        ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { TIN: true, name: true } })
        : null;
      const queued = await queueLocalPurchase(prisma, {
        organizationId,
        branchId,
        sourceType: 'SUPPLIER_INVOICE',
        sourceId: id,
        receiptKey: `SI:${id}`,
        supplierTin: supplier?.TIN ?? invoice.vendorTIN,
        supplierName: supplier?.name ?? invoice.supplierName,
        supplierInvoiceRef: invoice.invoiceNumber,
        userId,
        lines: receiptLines,
      });
      if (queued) registerLocalPurchaseAsync(queued.id);
    }

    const accounting = await enqueueScannedSupplierBillAccountingEvent(id, receivedAtCost).catch((e: Error) => ({
      queued: false,
      reason: e.message,
    }));

    await auditLogger.inventory(req, {
      type: 'PRODUCT_CREATE',
      description: `Imported ${importedItems} products from invoice #${invoice.invoiceNumber || id}`,
      entityType: 'supplier_invoice',
      entityId: id,
      metadata: { importedItems, skippedItems, errorItems, accountingBillQueued: accounting.queued },
    });

    res.json(success({
      invoiceId: id,
      importedItems,
      skippedItems,
      errorItems,
      errors: importErrors,
      accounting,
    }, `Import complete. ${importedItems} products imported.`));
  } catch (err: any) {
    console.error('[Import Invoice Error]:', err);
    res.status(500).json(apiError('Failed to import invoice', undefined, err.message));
  }
};

// ── Delete invoice ────────────────────────────────────────────────────────

export const deleteInvoice = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const branchFilter = buildBranchFilter(req);

    const invoice = await prisma.supplierInvoice.findFirst({
      where: { id, organizationId, ...branchFilter },
      include: { files: true },
    });

    if (!invoice) {
      return res.status(404).json(apiError('Invoice not found'));
    }

    if (invoice.status === 'IMPORTED') {
      return res.status(400).json(apiError('Cannot delete an imported invoice'));
    }

    // Delete files from disk
    for (const file of invoice.files) {
      try {
        await fs.unlink(file.filePath);
      } catch {
        // Ignore file deletion errors
      }
    }

    await prisma.supplierInvoice.delete({ where: { id } });

    res.json(success(null, 'Invoice deleted'));
  } catch (err: any) {
    console.error('[Delete Invoice Error]:', err);
    res.status(500).json(apiError('Failed to delete invoice'));
  }
};

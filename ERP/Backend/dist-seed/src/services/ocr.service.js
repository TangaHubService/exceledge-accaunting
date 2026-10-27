"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampMoney = clampMoney;
exports.clampTaxRate = clampTaxRate;
exports.normalizeExtractedData = normalizeExtractedData;
// DB columns for these fields are Decimal(10,2) / Decimal(5,2) — clamp so a bad
// OCR read (e.g. a barcode misread as a price) can never overflow the column.
const MAX_MONEY = 99999999.99;
const MAX_TAX_RATE = 999.99;
function clampMoney(n) {
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.min(n, MAX_MONEY);
}
function clampTaxRate(n) {
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.min(n, MAX_TAX_RATE);
}
/** Best-effort coercion to YYYY-MM-DD. Both extraction paths (Tesseract heuristic
 *  and the browser AI call) are instructed to emit ISO dates already — this is a
 *  defensive backstop, not the primary source of correctness. */
function toIsoDate(raw) {
    if (!raw || typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
        return trimmed;
    const parts = trimmed.split(/[/\-.]/);
    if (parts.length === 3) {
        const [a, b, yearRaw] = parts;
        if (/^\d{4}$/.test(yearRaw) && /^\d{1,2}$/.test(a) && /^\d{1,2}$/.test(b)) {
            const day = a.padStart(2, '0');
            const month = b.padStart(2, '0');
            if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
                return `${yearRaw}-${month}-${day}`;
            }
        }
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}
// Invoice scanning runs client-side in the browser (Tesseract heuristic in
// Frontend/src/lib/invoiceOcr.ts, or the AI vision call in
// Frontend/src/lib/aiInvoiceExtraction.ts). This module only defines the
// shared data shape and defensively normalizes whatever the client sends
// before it touches the database.
function normalizeExtractedData(raw) {
    const products = Array.isArray(raw?.products)
        ? raw.products.map((p) => ({
            productName: String(p.productName || 'Unknown Product').trim(),
            description: p.description || undefined,
            sku: p.sku || undefined,
            barcode: p.barcode || undefined,
            batchNumber: p.batchNumber || undefined,
            expiryDate: p.expiryDate || undefined,
            quantity: Math.max(1, Number(p.quantity) || 1),
            unitPrice: clampMoney(Number(p.unitPrice)),
            sellingPrice: p.sellingPrice ? clampMoney(Number(p.sellingPrice)) : undefined,
            totalPrice: p.totalPrice ? clampMoney(Number(p.totalPrice)) : undefined,
            taxRate: p.taxRate ? clampTaxRate(Number(p.taxRate)) : undefined,
            taxAmount: p.taxAmount ? clampMoney(Number(p.taxAmount)) : undefined,
            category: p.category || undefined,
            manufacturer: p.manufacturer || undefined,
            confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
        }))
        : [];
    return {
        supplierName: raw?.supplierName || undefined,
        supplierAddress: raw?.supplierAddress || undefined,
        vendorTIN: raw?.vendorTIN || undefined,
        invoiceNumber: raw?.invoiceNumber || undefined,
        invoiceDate: toIsoDate(raw?.invoiceDate),
        currency: raw?.currency || 'RWF',
        paymentTerms: raw?.paymentTerms || undefined,
        dueDate: toIsoDate(raw?.dueDate),
        poNumber: raw?.poNumber || undefined,
        subtotal: raw?.subtotal ? clampMoney(Number(raw.subtotal)) : undefined,
        taxAmount: raw?.taxAmount ? clampMoney(Number(raw.taxAmount)) : undefined,
        discount: raw?.discount ? clampMoney(Number(raw.discount)) : undefined,
        totalAmount: raw?.totalAmount ? clampMoney(Number(raw.totalAmount)) : undefined,
        products,
        confidence: Math.min(1, Math.max(0, Number(raw?.confidence) || 0)),
        provider: raw?.provider || 'client',
        processingMs: Number(raw?.processingMs) || 0,
    };
}

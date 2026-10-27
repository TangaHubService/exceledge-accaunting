import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { ExtractedInvoiceData, ExtractedProduct } from './invoiceExtraction.types';

// ── Structured-output schema ────────────────────────────────────────────────
// Every field is `.nullable()` rather than `.optional()` — OpenAI's strict
// JSON Schema mode requires every property to be listed in `required`, so
// "not on this invoice" is expressed as `null`, never a missing key.

const VendorSchema = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  /** Tax Identification Number as printed on the invoice (RRA TIN or equivalent). */
  tin: z.string().nullable(),
});

const LineItemSchema = z.object({
  description: z.string(),
  sku: z.string().nullable(),
  quantity: z.number(),
  unitPrice: z.number(),
  /** Percent, e.g. 18 for 18% VAT. */
  taxRate: z.number().nullable(),
  taxAmount: z.number().nullable(),
  lineTotal: z.number(),
});

const TotalsSchema = z.object({
  subtotal: z.number().nullable(),
  taxTotal: z.number().nullable(),
  discount: z.number().nullable(),
  grandTotal: z.number().nullable(),
});

const InvoiceExtractionSchema = z.object({
  vendor: VendorSchema,
  invoiceNumber: z.string().nullable(),
  /** ISO 8601 date string (YYYY-MM-DD), or null if illegible/absent. */
  invoiceDate: z.string().nullable(),
  currency: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  dueDate: z.string().nullable(),
  /** Purchase order reference as printed on the invoice, for ERP PO matching. */
  poNumber: z.string().nullable(),
  lineItems: z.array(LineItemSchema),
  totals: TotalsSchema,
  /** Model's own calibrated confidence in the overall extraction, 0-1. */
  extractionConfidence: z.number(),
});

type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

const SYSTEM_PROMPT = `You are an invoice-data extraction engine for a multi-tenant ERP platform in East Africa.
Read the attached document (a scanned/photographed supplier invoice — PDF, PNG, or JPEG) and extract it into the
given structured schema exactly. Rules:
- Every line item on the invoice must appear as one lineItems entry — do not summarize or merge distinct items.
- lineTotal is the amount printed for that line (quantity * unitPrice as shown), not your own recomputation.
- Dates must be normalized to ISO 8601 (YYYY-MM-DD). If a date is ambiguous or illegible, return null.
- vendor.tin is the vendor's Tax Identification Number (RRA TIN or equivalent) if printed anywhere on the document.
- If a field is not present on the document, return null for it — never fabricate a value.
- extractionConfidence is your own calibrated confidence (0-1) in the overall extraction, not a fixed default.`;

export function isAiExtractionConfigured(): boolean {
  return !!import.meta.env.VITE_OPENAI_API_KEY;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    // The key ships inside this bundle by design (see VITE_OPENAI_API_KEY in
    // .env.example) — there is no backend proxy for this call. Treat the key
    // as public: scope it to a low-spend project and rotate it if abused.
    client = new OpenAI({
      apiKey: import.meta.env.VITE_OPENAI_API_KEY,
      dangerouslyAllowBrowser: true,
    });
  }
  return client;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is a full data URL ("data:<mime>;base64,<data>") — strip the prefix.
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ── Defensive normalization ─────────────────────────────────────────────────
// Structured outputs guarantees the *shape* of the response, not that the
// values are sane — clamp money/tax to the backend's DB column bounds and
// coerce dates to ISO before anything reaches the review UI.

const MAX_MONEY = 99_999_999.99;
const MAX_TAX_RATE = 999.99;

function clampMoney(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_MONEY);
}

function clampTaxRate(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_TAX_RATE);
}

function toIsoDate(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

const LINE_MATH_TOLERANCE_RATIO = 0.02;
const LINE_MATH_TOLERANCE_MIN = 1;

function lineReconciles(quantity: number, unitPrice: number, taxAmount: number | null, lineTotal: number): boolean {
  const expected = quantity * unitPrice + (taxAmount ?? 0);
  const tolerance = Math.max(LINE_MATH_TOLERANCE_MIN, Math.abs(lineTotal) * LINE_MATH_TOLERANCE_RATIO);
  return Math.abs(expected - lineTotal) <= tolerance;
}

function normalize(raw: InvoiceExtraction, provider: string, processingMs: number): ExtractedInvoiceData {
  const products: ExtractedProduct[] = raw.lineItems.map((item) => {
    const quantity = Math.max(0, Math.round(item.quantity) || 0);
    const unitPrice = clampMoney(item.unitPrice);
    const taxAmount = item.taxAmount != null ? clampMoney(item.taxAmount) : undefined;
    const lineTotal = clampMoney(item.lineTotal);
    const verified = lineReconciles(quantity, unitPrice, taxAmount ?? null, lineTotal);

    return {
      productName: item.description,
      sku: item.sku ?? undefined,
      quantity,
      unitPrice,
      totalPrice: lineTotal,
      taxRate: item.taxRate != null ? clampTaxRate(item.taxRate) : undefined,
      taxAmount,
      // Line math is checked client-side too (the backend re-checks at header
      // level) so a bad extraction is visibly flagged in the review table
      // before the user commits to it, not just after the fact.
      confidence: verified ? raw.extractionConfidence : Math.min(raw.extractionConfidence, 0.4),
    };
  });

  return {
    supplierName: raw.vendor.name ?? undefined,
    supplierAddress: raw.vendor.address ?? undefined,
    vendorTIN: raw.vendor.tin ?? undefined,
    invoiceNumber: raw.invoiceNumber ?? undefined,
    invoiceDate: toIsoDate(raw.invoiceDate),
    currency: (raw.currency || 'RWF').trim().toUpperCase().slice(0, 8) || 'RWF',
    paymentTerms: raw.paymentTerms ?? undefined,
    dueDate: toIsoDate(raw.dueDate),
    poNumber: raw.poNumber ?? undefined,
    subtotal: raw.totals.subtotal != null ? clampMoney(raw.totals.subtotal) : undefined,
    taxAmount: raw.totals.taxTotal != null ? clampMoney(raw.totals.taxTotal) : undefined,
    discount: raw.totals.discount != null ? clampMoney(raw.totals.discount) : undefined,
    totalAmount: raw.totals.grandTotal != null ? clampMoney(raw.totals.grandTotal) : undefined,
    products,
    confidence: Math.min(1, Math.max(0, raw.extractionConfidence || 0)),
    provider,
    processingMs,
  };
}

/**
 * Extracts a supplier invoice using OpenAI vision + structured outputs,
 * called directly from the browser. Throws if VITE_OPENAI_API_KEY is not
 * configured or the API call fails — callers should fall back to
 * scanInvoiceLocally (Tesseract) on error.
 */
export async function extractInvoiceWithAI(
  file: File,
  onProgress?: (pct: number, message: string) => void
): Promise<ExtractedInvoiceData> {
  if (!isAiExtractionConfigured()) {
    throw new Error('AI extraction is not configured (VITE_OPENAI_API_KEY missing)');
  }

  const start = Date.now();
  onProgress?.(10, 'Reading file...');
  const base64 = await readFileAsBase64(file);

  const fileContent =
    file.type === 'application/pdf'
      ? ({ type: 'input_file', filename: file.name, file_data: `data:application/pdf;base64,${base64}` } as const)
      : ({ type: 'input_image', detail: 'high', image_url: `data:${file.type};base64,${base64}` } as const);

  onProgress?.(30, 'Analyzing invoice with AI...');
  const model = import.meta.env.VITE_OPENAI_VISION_MODEL || 'gpt-4o';

  const response = await getClient().responses.parse({
    model,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Extract this supplier invoice into the structured schema.' },
          fileContent as never,
        ],
      },
    ],
    text: { format: zodTextFormat(InvoiceExtractionSchema, 'invoice_extraction') },
  });

  const parsed = response.output_parsed;
  if (!parsed) {
    throw new Error('AI extraction returned no parseable output (the model may have refused)');
  }

  onProgress?.(90, 'Finalizing...');
  return normalize(parsed, `openai:${model}`, Date.now() - start);
}

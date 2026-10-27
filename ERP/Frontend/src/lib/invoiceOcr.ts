import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExtractedProduct, ExtractedInvoiceData } from './invoiceExtraction.types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const MAX_PDF_PAGES = 5;

export type { ExtractedProduct, ExtractedInvoiceData };

// ── Text extraction (OCR) ───────────────────────────────────────────────────

async function renderPdfToCanvases(file: File): Promise<HTMLCanvasElement[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const canvases: HTMLCanvasElement[] = [];
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) continue;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

export async function extractTextFromFile(
  file: File,
  onProgress?: (pct: number, message: string) => void
): Promise<string> {
  const worker = await createWorker('eng', undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100), 'Reading text...');
      }
    },
  });

  try {
    if (file.type === 'application/pdf') {
      onProgress?.(0, 'Rendering PDF pages...');
      const canvases = await renderPdfToCanvases(file);
      let text = '';
      for (let i = 0; i < canvases.length; i++) {
        onProgress?.(Math.round((i / Math.max(canvases.length, 1)) * 100), `Scanning page ${i + 1} of ${canvases.length}...`);
        const { data } = await worker.recognize(canvases[i]);
        text += `${data.text}\n`;
      }
      return text;
    }

    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// ── Heuristic text → structured invoice parsing ─────────────────────────────

const NOISE_WORDS = /^(qty|quantity|price|unit price|total|item|product|description|amount|s\/?no|no\.?)$/i;

function normalizeDate(raw: string): string | undefined {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  const parts = raw.split(/[/\-.]/);
  if (parts.length !== 3) return undefined;

  let [day, month, year] = parts;
  if (year.length === 2) year = `20${year}`;
  if (year.length !== 4) return undefined;

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Matches lines like: "Paracetamol 500mg   10   1200   12000"
// (name, then 2-3 trailing numeric columns separated by whitespace)
const LINE_ITEM_RE = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)(?:\s+(\d+(?:[.,]\d+)?))?$/;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, '')) || 0;
}

// Matches the backend's Decimal(10,2) column limit — an OCR misread (e.g. a
// barcode read as a price) shouldn't silently blow past what the DB can store.
const MAX_MONEY = 99_999_999.99;

export function parseInvoiceText(rawText: string): ExtractedInvoiceData {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const invoiceNumberMatch = rawText.match(/inv(?:oice)?\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9\-/]{3,})/i);
  const dateMatch = rawText.match(/(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/);
  const currencyMatch = rawText.match(/\b(RWF|USD|EUR|GBP|KES|UGX|TZS)\b/i);
  const totalMatch = rawText.match(/total\s*(?:amount)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i);

  const products: ExtractedProduct[] = [];

  for (const line of lines) {
    const match = line.match(LINE_ITEM_RE);
    if (!match) continue;

    const name = match[1].trim().replace(/\s{2,}/g, ' ');
    if (name.length < 2 || NOISE_WORDS.test(name)) continue;

    const quantity = Math.max(1, Math.round(toNumber(match[2])) || 1);
    const rawUnitPrice = Math.max(0, toNumber(match[3]));
    const rawTotalPrice = match[4] ? toNumber(match[4]) : quantity * rawUnitPrice;
    // A price this large is almost certainly a misread barcode/serial, not a real amount.
    const looksBogus = rawUnitPrice > MAX_MONEY || rawTotalPrice > MAX_MONEY;

    products.push({
      productName: name,
      quantity,
      unitPrice: Math.min(rawUnitPrice, MAX_MONEY),
      totalPrice: Math.min(rawTotalPrice, MAX_MONEY),
      confidence: looksBogus ? 0.1 : 0.5,
    });
  }

  if (products.length === 0) {
    products.push({ productName: '', quantity: 1, unitPrice: 0, totalPrice: 0, confidence: 0 });
  }

  return {
    supplierName: lines[0],
    invoiceNumber: invoiceNumberMatch?.[1],
    invoiceDate: dateMatch ? normalizeDate(dateMatch[1]) : undefined,
    currency: currencyMatch?.[1]?.toUpperCase() || 'RWF',
    totalAmount: totalMatch ? toNumber(totalMatch[1]) : undefined,
    products,
    rawText,
    confidence: products.some((p) => p.confidence > 0) ? 0.5 : 0,
    provider: 'client-tesseract',
    processingMs: 0,
  };
}

export async function scanInvoiceLocally(
  file: File,
  onProgress?: (pct: number, message: string) => void
): Promise<ExtractedInvoiceData> {
  const start = Date.now();
  const rawText = await extractTextFromFile(file, onProgress);
  const extracted = parseInvoiceText(rawText);
  extracted.processingMs = Date.now() - start;
  return extracted;
}

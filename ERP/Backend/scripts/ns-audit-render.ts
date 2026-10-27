/** Render sample NS receipts (80mm + A4) for audit evidence. Run: npx tsx scripts/ns-audit-render.ts */
import { promises as fs } from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { generateEbmReceiptPdf80mm } from '../src/services/invoice-receipt-pdf.service';
import { generateEbmInvoicePdf } from '../src/services/invoice-pdf.service';
import { renderSalesInvoiceHtml, type RenderInvoicePayload } from '../src/services/invoice-render.service';
import { SYSTEM_FOOTER, SYSTEM_POWERED_BY } from '../src/services/system-branding.service';

async function qrImage(raw: string) {
  return QRCode.toDataURL(raw, { errorCorrectionLevel: 'M', margin: 1, width: 220, color: { dark: '#000000', light: '#FFFFFF' } });
}

function basePayload(): RenderInvoicePayload {
  const qrRaw = '01102026#102030#SDC010000005#168#ABCD1234EFGH5678IJKL9012MNOP3456#SIGN1234DATA5678EFGH9012IJKL3456';
  return {
    company: { name: 'Test Trader Ltd', address: 'KN 3 Rd, Kigali', phone: '+250788000000', tin: '999945560', mrc: 'WIS01006230', currency: 'RWF', ebmLinked: true },
    customer: { name: 'Walk-in Client', tin: '100000001', phone: '0788000000' },
    invoice: {
      id: '1', saleNumber: 'SALE-NS-1', invoiceNumber: '8', receiptNumber: '168/258 NS',
      invoiceDate: new Date('2026-10-01T10:20:30Z').toISOString(), time: '10:20:30',
      paymentMethod: 'Cash', cashier: 'Cashier', status: 'COMPLETED', rcptLabel: 'NS',
      rcptLabelText: 'Normal Sale', isProforma: false, isCopy: false, currency: 'RWF',
    },
    items: [
      { line: 1, code: 'RW2CTU0000001', description: 'Widget', quantity: 2, unit: 'PCS', unitPrice: 1180, discountPct: 0, discountAmt: 0, taxCode: 'B', vatPct: 18, taxAmount: 360, subtotal: 2360, net: 2360, total: 2360 },
      { line: 2, code: 'RW2CTU0000002', description: 'Exempt goods', quantity: 1, unit: 'PCS', unitPrice: 500, discountPct: 0, discountAmt: 0, taxCode: 'A', vatPct: 0, taxAmount: 0, subtotal: 500, net: 500, total: 500 },
      { line: 3, code: 'RW2CTU0000003', description: 'Discounted goods', quantity: 1, unit: 'PCS', unitPrice: 620, discountPct: 16.13, discountAmt: 100, taxCode: 'B', vatPct: 18, taxAmount: 79.32, subtotal: 620, net: 520, total: 520 },
      { line: 4, code: 'RW2CTU0000099', description: 'Delivery service', quantity: 1, unit: 'PCS', unitPrice: 100, discountPct: 0, discountAmt: 0, taxCode: 'A', vatPct: 0, taxAmount: 0, subtotal: 100, net: 100, total: 100 },
    ],
    totals: { subtotal: 3580, discount: 100, taxable: 1000, vat: 439.32, tax: 439.32, shipping: 0, paid: 3480, balance: 0, grandTotal: 3480 },
    charges: { vatAmount: 439.32, taxableAmount: 1000, discountAmount: 100, cashAmount: 2000, insuranceAmount: 0, debtAmount: 1480, totalAmount: 3480, shipping: 0 },
    taxRates: [0, 18, 0, 0],
    payment: { method: 'MIXED', methodLabel: 'Mixed', lines: [{ method: 'CASH', label: 'Cash', amount: 2000 }, { method: 'DEBT', label: 'Credit', amount: 1480 }] },
    sdcInformation: {
      sdcId: 'SDC010000005', mrcNo: 'WIS01006230', receiptNumber: '168/258 NS',
      receiptSignature: 'SIGN1234DATA5678EFGH9012IJKL3456', internalData: 'ABCD1234EFGH5678IJKL9012MNOP3456',
      sdcDateTime: new Date('2026-10-01T10:20:30Z').toISOString(),
      date: new Date('2026-10-01T10:20:30Z').toISOString(), time: '10:20:30',
      ebmInvoiceNumber: '168', rcptLabel: 'NS', poweredBy: SYSTEM_FOOTER, softwareVersion: 'CIS v1.0',
    },
    certification: { isCertified: true, certificateText: 'Fiscalized EBM receipt.' },
    verification: { qrCodeImage: '', qrPayload: qrRaw },
    branding: { primaryColor: '#1565C0', rraLogo: null, poweredBy: SYSTEM_POWERED_BY },
    footer: { message: 'Thank you for your business.', note: null },
  } as unknown as RenderInvoicePayload;
}

async function main() {
  const out = '/tmp/ns-audit';
  await fs.mkdir(out, { recursive: true });
  const data = basePayload();
  data.verification.qrCodeImage = await qrImage(data.verification.qrPayload as string);
  const [pdf80, pdfA4] = await Promise.all([generateEbmReceiptPdf80mm(data), generateEbmInvoicePdf(data, 'A4')]);
  await fs.writeFile(path.join(out, 'NS-sample-80mm.pdf'), pdf80);
  await fs.writeFile(path.join(out, 'NS-sample-A4.pdf'), pdfA4);
  await fs.writeFile(path.join(out, 'NS-sample.html'), renderSalesInvoiceHtml(data));
  // COPY reprint variant: same payload with isCopy=true
  const copy = { ...data, invoice: { ...data.invoice, isCopy: true } };
  const pdfCopy = await generateEbmReceiptPdf80mm(copy);
  await fs.writeFile(path.join(out, 'NS-sample-80mm-COPY.pdf'), pdfCopy);
  await fs.writeFile(path.join(out, 'NS-sample-payload.json'), JSON.stringify({ ...data, verification: { ...data.verification, qrCodeImage: '<data-url>' } }, null, 2));
  console.log(`wrote ${out}: 80mm=${pdf80.length}B A4=${pdfA4.length}B COPY=${pdfCopy.length}B`);
}
main().catch((e) => { console.error(e); process.exit(1); });

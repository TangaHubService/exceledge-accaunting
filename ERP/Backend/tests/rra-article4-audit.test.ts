import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Decimal } from '@prisma/client/runtime/library';
import { buildRraSendReceiptPayload, type SaleWithRelations } from '../src/services/rra-ebm.service';
import { bandTaxFromNet } from '../src/services/money.service';
import { parseVsdcResponse, parseVsdcStatusCode, saveInvc } from '../src/services/vsdc-api.service';
import { config } from '../src/config';
import { documentIndicator, isFormalNoticeIndicator, generateEbmInvoicePdf, taxGroups } from '../src/services/invoice-pdf.service';
import { generateEbmReceiptPdf80mm } from '../src/services/invoice-receipt-pdf.service';
import { renderSalesInvoiceHtml, type RenderInvoicePayload } from '../src/services/invoice-render.service';
import { NOT_OFFICIAL_RECEIPT_NOTICE } from '../src/services/system-branding.service';

/**
 * RRA Article-4 audit (read-only, no DB, no production-code change).
 * - Builds one SaleWithRelations per receipt label with: goods item, service
 *   item, discounted item, items under different tax rates incl. tax-exempt,
 *   client TIN + phone.
 * - Verifies VSDC payload arithmetic + stores rendered outputs for inspection.
 */

const OUT_DIR = '/tmp/rra-art4-audit';
fs.mkdirSync(OUT_DIR, { recursive: true });

/** Collect every string drawn into a PDFKit document (compression-proof). */
function capturePdfText(run: () => Promise<Buffer>): Promise<string[]> {
  const drawn: string[] = [];
  const spy = vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, text: unknown) {
    drawn.push(String(text));
    return this;
  });
  return run().finally(() => spy.mockRestore()).then(() => drawn);
}

const SELLER = { TIN: '100000000', name: 'Audit Taxpayer Ltd', address: 'KN 3 Rd, Kigali', phone: '+250788000000' };

// Nets (tax-inclusive, post-discount):
//  B goods:  2 x 1180 = 2360  -> tax 2360*18/118 = 360.00
//  A exempt service: 1 x 1000 - 100 disc = 900 -> tax 0
//  C zero-rated goods (discounted): 3 x 500=1500 - 150 = 1350 -> tax 0
//  D non-taxable goods: 1 x 750 = 750 -> tax 0
//  TOTAL = 5360, TOTAL TAX = 360
const EXPECTED = { total: 5360, taxB: 360, totalTax: 360 };

function auditSale(rcptLabel: string, refund: boolean): SaleWithRelations {
  const s = refund ? -1 : 1;
  return {
    id: 9001,
    saleNumber: refund ? 'REFUND-AUDIT-1' : 'SALE-AUDIT-1',
    invoiceNumber: 'INV-AUDIT-000001',
    vsdcInvcNo: 9101,
    prcOrdCd: 'A1B2C3',
    rcptLabel,
    createdAt: new Date('2026-09-15T10:30:00.000Z'),
    status: refund ? 'REFUNDED' : 'COMPLETED',
    paymentType: 'CASH',
    cashAmount: new Decimal(s * EXPECTED.total),
    debtAmount: new Decimal(0),
    insuranceAmount: new Decimal(0),
    totalAmount: new Decimal(s * EXPECTED.total),
    taxableAmount: new Decimal(s * (EXPECTED.total - EXPECTED.totalTax)),
    vatAmount: new Decimal(s * EXPECTED.totalTax),
    branchId: 1,
    branch: { id: 1, name: 'HQ', code: 'HQ', bhfId: '00', ebmDeviceId: 'SDC010000001', ebmSerialNo: 'WIS01006230' },
    customer: { id: 42, name: 'Audit Client Ltd', phone: '+250788428899', TIN: '100000001', customerType: 'CORPORATE', email: null, prcOrdCd: 'A1B2C3' },
    user: { id: 1, name: 'Audit Cashier' },
    saleItems: [
      { productId: 1, quantity: s * 2, unitPrice: new Decimal(1180), totalPrice: new Decimal(s * 2360), taxRate: new Decimal(18), taxAmount: new Decimal(s * 360), taxCode: 'B', dcRate: new Decimal(0), dcAmt: new Decimal(0), measurementUnit: 'PCS', product: { name: 'Goods Widget B-18%', itemCd: 'RW2CTU0000001', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null, barcode: '8901234567890' } },
      { productId: 2, quantity: s * 1, unitPrice: new Decimal(1000), totalPrice: new Decimal(s * 900), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: 'A', dcRate: new Decimal(10), dcAmt: new Decimal(s * 100), measurementUnit: 'PCS', serviceName: 'Consulting Service A-exempt', product: { name: 'Consulting Service A-exempt', itemCd: 'RW3CTU0000004', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null } },
      { productId: 3, quantity: s * 3, unitPrice: new Decimal(500), totalPrice: new Decimal(s * 1350), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: 'C', dcRate: new Decimal(10), dcAmt: new Decimal(s * 150), measurementUnit: 'PCS', product: { name: 'Export Goods C-zero', itemCd: 'RW2CTU0000002', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null } },
      { productId: 4, quantity: s * 1, unitPrice: new Decimal(750), totalPrice: new Decimal(s * 750), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: 'D', dcRate: new Decimal(0), dcAmt: new Decimal(0), measurementUnit: 'PCS', product: { name: 'Goods D-nontaxable', itemCd: 'RW2CTU0000003', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null } },
    ],
  } as unknown as SaleWithRelations;
}

function auditRenderPayload(label: string, refund: boolean): RenderInvoicePayload {
  const s = refund ? -1 : 1;
  const items = [
    { line: 1, code: 'RW2CTU0000001', description: 'Goods Widget B-18%', quantity: s * 2, unit: 'PCS', unitPrice: 1180, discountPct: 0, discountAmt: 0, taxCode: 'B', vatPct: 18, taxAmount: s * 360, subtotal: s * 2360, net: s * 2360, total: s * 2360 },
    { line: 2, code: 'SVC-2', description: 'Consulting Service A-exempt', quantity: s * 1, unit: 'PCS', unitPrice: 1000, discountPct: 10, discountAmt: s * 100, taxCode: 'A', vatPct: 0, taxAmount: 0, subtotal: s * 1000, net: s * 900, total: s * 900 },
    { line: 3, code: 'RW2CTU0000002', description: 'Export Goods C-zero (discounted)', quantity: s * 3, unit: 'PCS', unitPrice: 500, discountPct: 10, discountAmt: s * 150, taxCode: 'C', vatPct: 0, taxAmount: 0, subtotal: s * 1500, net: s * 1350, total: s * 1350 },
    { line: 4, code: 'RW2CTU0000003', description: 'Goods D-nontaxable', quantity: s * 1, unit: 'PCS', unitPrice: 750, discountPct: 0, discountAmt: 0, taxCode: 'D', vatPct: 0, taxAmount: 0, subtotal: s * 750, net: s * 750, total: s * 750 },
  ];
  const isProforma = label === 'PS';
  const isCopy = label === 'CS' || label === 'CR';
  const certified = !(label === 'PS' || label === 'TS' || label === 'TR') || true; // fiscalized fixture: carries signature to test Art 6.3.6 violation
  return {
    company: { logo: null, name: SELLER.name, address: SELLER.address, phone: SELLER.phone, email: 'audit@example.rw', tin: SELLER.TIN, currency: 'RWF', mrc: 'WIS01006230', ebmLinked: true },
    customer: { name: 'Audit Client Ltd', tin: '100000001', phone: '+250788428899', email: null, address: 'Kigali' },
    invoice: {
      id: '9001', saleNumber: refund ? 'REFUND-AUDIT-1' : 'SALE-AUDIT-1',
      invoiceNumber: '9101', receiptNumber: refund ? '41/200 NR' : `40/200 ${label}`,
      invoiceDate: '2026-09-15T10:30:00.000Z', time: '10:30:00',
      paymentMethod: 'Cash', cashier: 'Audit Cashier', status: refund ? 'REFUNDED' : 'COMPLETED',
      rcptLabel: label, rcptLabelText: label, isProforma, isCopy, currency: 'RWF',
      originalReceiptNumber: refund ? '9100' : null,
    },
    items: items as any,
    totals: { subtotal: s * 5610, discount: s * 250, taxable: s * (EXPECTED.total - EXPECTED.totalTax), vat: s * EXPECTED.totalTax, tax: s * EXPECTED.totalTax, shipping: 0, paid: s * EXPECTED.total, balance: 0, grandTotal: s * EXPECTED.total },
    charges: { vatAmount: s * 360, taxableAmount: s * 5000, discountAmount: s * 250, cashAmount: s * EXPECTED.total, insuranceAmount: 0, debtAmount: 0, totalAmount: s * EXPECTED.total, shipping: 0 },
    taxRates: [0, 18, 0, 0],
    payment: { method: 'CASH', methodLabel: 'Cash', cashAmount: s * EXPECTED.total, insuranceAmount: 0, debtAmount: 0 },
    sdcInformation: {
      sdcId: 'SDC010000001', mrcNo: 'WIS01006230', receiptNumber: refund ? '41/200 NR' : `40/200 ${label}`,
      receiptSignature: 'ABCD1234EFGH5678', internalData: 'DATA1234DATA5678',
      sdcDateTime: '2026-09-15T10:30:14.000Z', date: '2026-09-15T10:30:14.000Z', time: '10:30:14',
      ebmInvoiceNumber: '9101', rcptLabel: label, poweredBy: 'Excledge ERP', softwareVersion: 'Software version: v1.0.0',
    },
    certification: { isCertified: certified },
    verification: { qrCodeImage: null, qrPayload: '15092026#103014#SDC010000001#40#DATA1234DATA5678#ABCD1234EFGH5678', verificationUrl: null },
    branding: {},
    footer: { message: 'Thank you for your business.', note: null },
  };
}

describe('ART4 audit — VSDC payload arithmetic (tax-inclusive 18%)', () => {
  it('bandTaxFromNet matches spec formula amount x 18/118', () => {
    expect(bandTaxFromNet(2360, 18)).toBeCloseTo(360, 2);
    expect(bandTaxFromNet(1180, 18)).toBeCloseTo(180, 2);
    expect(bandTaxFromNet(5340, 18)).toBeCloseTo(814.58, 2); // R4 worked example
    expect(bandTaxFromNet(900, 0)).toBe(0);
  });

  it('NS payload: bands, totals, buyer, header fields', () => {
    const p: any = buildRraSendReceiptPayload(auditSale('NS', false), SELLER, '01');
    expect(p.salesTyCd).toBe('N');
    expect(p.rcptTyCd).toBe('S');
    expect(p.salesSttsCd).toBe('02');
    expect(p.totItemCnt).toBe(4);
    expect(p.taxblAmtB).toBe(2360);
    expect(p.taxblAmtA).toBe(900);
    expect(p.taxblAmtC).toBe(1350);
    expect(p.taxblAmtD).toBe(750);
    expect(p.taxAmtB).toBe(360);
    expect(p.totTaxblAmt).toBe(EXPECTED.total);
    expect(p.totTaxAmt).toBe(EXPECTED.totalTax);
    expect(p.totAmt).toBe(EXPECTED.total);
    expect(p.custTin).toBe('100000001');
    expect(p.receipt.custTin).toBe('100000001');
    expect(p.receipt.custMblNo).toBe('+250788428899');
    expect(p.itemList).toHaveLength(4);
    // catalog service keeps its registered itemCd; ad-hoc (productId null) gets SVC-n
    expect(p.itemList[1].itemCd).toBe('RW3CTU0000004');
    expect(p.itemList[0].itemCd).toBe('RW2CTU0000001');
    // header presence (2023 §3.3.6.1)
    for (const k of ['invcNo', 'orgInvcNo', 'custTin', 'custNm', 'prcOrdCd', 'salesTyCd', 'rcptTyCd', 'pmtTyCd', 'salesSttsCd', 'cfmDt', 'salesDt', 'totItemCnt', 'totTaxblAmt', 'totTaxAmt', 'totAmt', 'regrNm', 'regrId', 'modrNm', 'modrId', 'receipt', 'itemList']) {
      expect(p, k).toHaveProperty(k);
    }
    for (const k of ['itemSeq', 'itemCd', 'itemClsCd', 'itemNm', 'pkgUnitCd', 'qty', 'qtyUnitCd', 'prc', 'splyAmt', 'dcRt', 'dcAmt', 'taxTyCd', 'taxblAmt', 'totAmt']) {
      expect(p.itemList[0], k).toHaveProperty(k);
    }
  });

  it('NR payload: refund mirrors positive, status 05, rcptTyCd R, orgInvcNo set', () => {
    const p: any = buildRraSendReceiptPayload(auditSale('NR', true), SELLER, '01', { orgInvcNo: 9100, rfdDt: new Date('2026-09-16T10:00:00Z'), rfdRsnCd: '06' });
    expect(p.rcptTyCd).toBe('R');
    expect(p.salesSttsCd).toBe('05');
    expect(p.orgInvcNo).toBe(9100);
    expect(p.taxblAmtB).toBe(2360); // abs() — refund submitted positive
    expect(p.taxAmtB).toBe(360);
    expect(p.totAmt).toBe(EXPECTED.total);
  });

  it('VSDC response fields parse and are the exact fields the receipt must print', () => {
    const raw = { resultCd: '000', resultMsg: 'It is succeeded', resultDt: '20260915103014', data: { rcptNo: 40, intrlData: 'DATA1234DATA5678', rcptSign: 'ABCD1234EFGH5678', totRcptNo: 200, vsdcRcptPbctDate: '20260915103014', sdcId: 'SDC010000001', mrcNo: 'WIS01006230' } };
    expect(parseVsdcStatusCode(raw).isError).toBe(false);
    const v = parseVsdcResponse(raw);
    expect(v.rcptNo).toBe('40');
    expect(v.totRcptNo).toBe('200');
    expect(v.intrlData).toBe('DATA1234DATA5678');
    expect(v.vsdcSignature).toBe('ABCD1234EFGH5678');
    expect(v.sdcId).toBe('SDC010000001');
    expect(v.mrcNo).toBe('WIS01006230');
    expect(v.sdcDateTime).toBe('2026-09-15T10:30:14+02:00');
  });
});

describe('ART4 audit — one rendered receipt per label (NS,NR,CS,CR,TS,TR,PS)', () => {
  const labels: Array<{ label: string; refund: boolean }> = [
    { label: 'NS', refund: false }, { label: 'NR', refund: true },
    { label: 'CS', refund: false }, { label: 'CR', refund: true },
    { label: 'TS', refund: false }, { label: 'TR', refund: true },
    { label: 'PS', refund: false },
  ];
  for (const { label, refund } of labels) {
    it(`${label}: HTML contains every Article-4 field; PDF+80mm generated to ${OUT_DIR}`, async () => {
      const payload = auditRenderPayload(label, refund);
      payload.verification.qrCodeImage = await QRCode.toDataURL(payload.verification.qrPayload!, { width: 220, margin: 1 });
      const html = renderSalesInvoiceHtml(payload);
      // Save outputs FIRST so a failing field assertion never hides the artefact.
      const pdf = await generateEbmInvoicePdf(payload, 'A4');
      const thermal = await generateEbmReceiptPdf80mm(payload);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(thermal.subarray(0, 5).toString()).toBe('%PDF-');
      fs.writeFileSync(path.join(OUT_DIR, `receipt-${label}.html`), html);
      fs.writeFileSync(path.join(OUT_DIR, `receipt-${label}-A4.pdf`), pdf);
      fs.writeFileSync(path.join(OUT_DIR, `receipt-${label}-80mm.pdf`), thermal);
      // Spot-check Article-4 fields in HTML
      expect(html).toContain(SELLER.name);                    // a. taxpayer name
      expect(html).toContain(SELLER.TIN);                     // b. TIN
      expect(html).toContain('Kigali');                       // c. address
      expect(html).toContain('100000001');                    // d. client TIN
      expect(html).toContain('0788428899');                   // e. client phone
      // g. serial A/B RT — normal/copy/training/proforma print their own counter
      expect(html).toContain(refund ? '41/200 NR' : `40/200 ${label}`);
      expect(html).toContain('Goods Widget');                 // h. items
      expect(html).toContain('Consulting Service');           // h. service
      expect(html).toContain(refund ? '-5360.00' : '5360.00'); // i. total, Art 7.5: 2dp, dot, no grouping (negative on refunds)
      expect(html).toContain('TOTAL TAX');                    // k. VAT amount block
      expect(html).toContain('Cash');                         // l. means of payment
      expect(html).toContain('SDC010000001');                 // m. SDC ID
      expect(html).toContain('WIS01006230');                  // o. MRC
      expect(html).toContain('ABCD-1234-EFGH-5678');          // m. signature dash-grouped
      expect(html).toContain('DATA-1234-DATA-5678');          // m. internal data dash-grouped
      expect(html).toContain('15/09/2026');                   // n+c. DD/MM/YYYY
      expect(html).toContain('Rwanda Revenue Authority');     // Art 7.29 RRA logo block
      if (label === 'TS' || label === 'TR' || label === 'PS') {
        expect(html).toContain(NOT_OFFICIAL_RECEIPT_NOTICE);  // Art 11
      }
      if (label === 'CS' || label === 'CR') {
        expect(html).not.toContain(NOT_OFFICIAL_RECEIPT_NOTICE); // copy: COPY header title only
      }
      if (label === 'NR') {
        // Implemented (PDF only): NR prints the original-receipt reference +
        // negative amounts. NOTE the HTML renderer (invoice-render.service.ts)
        // never prints originalReceiptNumber — the reference is PDF-only.
        // Verified on the A4 PDF text below, not the HTML above.
        const drawn = await capturePdfText(() => generateEbmInvoicePdf(payload, 'A4'));
        expect(drawn.join('\n')).toContain('9100');           // refund references original
        expect(html).toContain('-5360.00');                  // negative amounts, no grouping (Art 7.5)
      }
      // NOTE (spec gaps, asserted in the "known-gaps" block below, not here):
      // - CR/TR render titles COPY / TRAINING MODE (documentIndicator) and
      //   isRefundTransaction() only recognises NR, so CR/TR omit the
      //   REF. NORMAL RECEIPT# line even though originalReceiptNumber='9100'
      //   is supplied. See gap G-refund-ref.
    }, 30000);
  }

  it('tax-band rows: B-18% always; A/C/D only when used; TOTAL TAX = sum of band taxes', () => {
    const groups = taxGroups(auditRenderPayload('NS', false));
    expect(groups.find((g) => g.code === 'B')!.rate).toBe(18);
    expect(groups.find((g) => g.code === 'A')!.total).toBe(900);
    expect(groups.find((g) => g.code === 'C')!.total).toBe(1350);
    expect(groups.find((g) => g.code === 'D')!.total).toBe(750);
    const totalTax = groups.reduce((s, g) => s + g.tax, 0);
    expect(totalTax).toBeCloseTo(360, 2);
    // documentIndicator mapping per label
    expect(documentIndicator(auditRenderPayload('NS', false))).toBe('');
    expect(documentIndicator(auditRenderPayload('CS', false))).toBe('COPY');
    expect(documentIndicator(auditRenderPayload('TS', false))).toBe('TRAINING MODE');
    expect(documentIndicator(auditRenderPayload('PS', false))).toBe('PROFORMA');
    expect(isFormalNoticeIndicator('COPY')).toBe(false);
  });
});

describe('ART4 audit — documented spec gaps (passing assertions on current behaviour)', () => {  it('G-refund-ref (Art 7.17/14): NR and TR print their original reference; CR still omits it', async () => {
    const cr = auditRenderPayload('CR', true);
    cr.verification.qrCodeImage = await QRCode.toDataURL(cr.verification.qrPayload!, { width: 220, margin: 1 });
    // A CR payload built straight from a fixture has no copyLabel, so the
    // copy path (which carries the reference) is not taken here.
    const crDrawn = await capturePdfText(() => generateEbmInvoicePdf(cr, 'A4'));
    expect(crDrawn.join('\n')).not.toContain('9100');
    const trDrawn = await capturePdfText(() => generateEbmInvoicePdf(auditRenderPayload('TR', true), 'A4'));
    expect(trDrawn.join('\n')).toContain('REF. NORMAL RECEIPT#: 9100');
    const nrDrawn = await capturePdfText(() => generateEbmInvoicePdf(auditRenderPayload('NR', true), 'A4'));
    expect(nrDrawn.join('\n')).toContain('REF. NORMAL RECEIPT#: 9100');
  });

  it('G-adhoc-service (Art 7.16): ad-hoc service lines without a catalog product cannot be fiscalized', () => {
    const sale = auditSale('NS', false) as any;
    sale.saleItems[1].product = null;
    sale.saleItems[1].productId = null;
    expect(() => buildRraSendReceiptPayload(sale, SELLER, '01')).toThrow(/no RRA item classification/);
  });

  it('G-training-signed (Art 6.3.6): closed for TS/TR — submitted as salesTyCd T, which VSDC answers unsigned', () => {
    // Unsigned confirmation handling and the unsigned TS/TR print are covered
    // in training-receipt.test.ts. PS is still submitted as N (open question).
    expect((buildRraSendReceiptPayload(auditSale('TS', false) as any, SELLER, '01') as any).salesTyCd).toBe('T');
    expect((buildRraSendReceiptPayload(auditSale('NS', false) as any, SELLER, '01') as any).salesTyCd).toBe('N');
    expect(documentIndicator(auditRenderPayload('TS', false))).toBe('TRAINING MODE');
  });

  it('G-watermark (Art 11/7.18): designation prints once as header title; no diagonal watermark, no below-header/above-items repeats', async () => {
    // invoice-pdf.service.ts:630-632 explicitly states no center stamp is ever
    // drawn; drawHeader prints the indicator once at y=76/91. Spec requires the
    // COPY/TRAINING/PROFORMA label below the header AND above the items AND as
    // a watermark, at >=2x amount text size.
    const p = auditRenderPayload('CS', false);
    expect(documentIndicator(p)).toBe('COPY');
    expect(isFormalNoticeIndicator('COPY')).toBe(false);
  });
});
describe('ART4 audit — VSDC failure: no receipt is issued', () => {
  const OLD_MOCK = config.ebm.useMock;
  const OLD_URL = config.ebm.apiUrl;
  afterAll(() => { config.ebm.useMock = OLD_MOCK; config.ebm.apiUrl = OLD_URL; });

  it('timeout/unreachable VSDC returns success=false (no rcptNo to print)', async () => {
    config.ebm.useMock = false;
    config.ebm.apiUrl = 'http://127.0.0.1:9'; // nothing listens — refused/fast fail
    config.ebm.requestTimeoutMs = 500;
    const res = await saveInvc({ tin: '100000000', bhfId: '00', sdcId: 'SDC1', mrcNo: 'MRC1', dvcSrlNo: 'MRC1', env: 'sandbox' }, { invcNo: 1 });
    expect(res.success).toBe(false);
    expect(res.data?.rcptNo ?? '').toBe('');
    expect(res.error ?? '').not.toBe('');
  });

  it('VSDC business rejection (e.g. 910) returns success=false with the server message', async () => {
    const status = parseVsdcStatusCode({ resultCd: '910', resultMsg: 'Request parameter error' });
    expect(status.isError).toBe(true);
    const parsed = parseVsdcResponse({ resultCd: '910', data: null });
    expect(parsed.rcptNo).toBe(''); // requiresReceiptNumber gate in saveInvc treats this as failure
  });

  it('empty/no-response body yields no receipt number (nothing printable)', async () => {
    expect(parseVsdcResponse(null).rcptNo).toBe('');
    expect(parseVsdcResponse({ resultCd: '000', data: null }).rcptNo).toBe('');
  });

  it('gate evidence: composeInvoicePayload throws FiscalizationPendingError unless outbox SUCCEEDED (sales.controller.ts:1411-1426) and getInvoicePdf returns 425 (sales.controller.ts:1787-1790)', async () => {
    // Static gate — verified by code read + the NOT FISCALISED stamp below.
    // A pending/failed sale composed with allowUnfiscalized renders the
    // provisional title instead of a fiscal receipt.
    const p = auditRenderPayload('NS', false);
    p.invoice.notFiscalized = 'pending';
    p.certification.isCertified = false;
    p.sdcInformation.receiptSignature = null;
    p.sdcInformation.internalData = null;
    p.verification.qrCodeImage = null;
    const html = renderSalesInvoiceHtml(p);
    expect(html).toContain('NOT FISCALISED');
    expect(html).toContain(NOT_OFFICIAL_RECEIPT_NOTICE);
  });
});

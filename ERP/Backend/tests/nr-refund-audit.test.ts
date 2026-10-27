/**
 * NR (Normal Refund) audit tests — pure logic (no DB, no network).
 *
 * Covers the refund business rules end to end at the calculation level:
 * remaining quantities, over-refund rejection, duplicate protection (math
 * level), reason/justification rules, negative-leg consistency, original
 * eligibility, and the VSDC payload shape for full + partial refunds.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import {
  assertNrWirePayload,
  assertOriginalConfirmed,
  assertOriginalRefundable,
  assertRefundReason,
  consumedByKey,
  formatOriginalReceiptReference,
  planRefundLines,
  refundLineKey,
  remainingByLine,
  summarizeRefund,
  RefundRuleError,
  type OriginalRefundLine,
} from '../src/services/refund-calculation.service';
import { buildRraSendReceiptPayload, type SaleWithRelations } from '../src/services/rra-ebm.service';
import { assessVsdcReceiptConfirmation, decideNrFiscalResult, saveInvc } from '../src/services/vsdc-api.service';
import { config } from '../src/config';

function line(over: Partial<OriginalRefundLine> = {}): OriginalRefundLine {
  return {
    saleItemId: 1,
    productId: 10,
    serviceName: null,
    serviceDescription: null,
    quantity: 10,
    unitPrice: 1180,
    totalPrice: 11800,
    taxRate: 18,
    taxAmount: 1800,
    taxCode: 'B',
    dcRate: 0,
    dcAmt: 0,
    measurementUnit: 'PCS',
    itemType: 'PRODUCT',
    ...over,
  };
}

describe('NR remaining quantities (Tests 2, 3)', () => {
  it('Test 2 — 10 sold, 3 refunded → 7 remain', () => {
    const rem = remainingByLine([line()], [{ productId: 10, serviceName: null, absQuantity: 3 }]);
    expect(rem).toEqual([{ saleItemId: 1, remaining: 7 }]);
  });

  it('Test 3 — 10 sold, 3 + 4 refunded → 3 remain', () => {
    const rem = remainingByLine([line()], [
      { productId: 10, serviceName: null, absQuantity: 3 },
      { productId: 10, serviceName: null, absQuantity: 4 },
    ]);
    expect(rem).toEqual([{ saleItemId: 1, remaining: 3 }]);
  });

  it('split original lines for one product share the remaining FIFO', () => {
    const orig = [line({ saleItemId: 1, quantity: 6, totalPrice: 7080, taxAmount: 1080 }), line({ saleItemId: 2, quantity: 4, totalPrice: 4720, taxAmount: 720 })];
    const rem = remainingByLine(orig, [{ productId: 10, serviceName: null, absQuantity: 8 }]);
    expect(rem).toEqual([
      { saleItemId: 1, remaining: 0 },
      { saleItemId: 2, remaining: 2 },
    ]);
  });

  it('service lines key on service name, not productId', () => {
    expect(refundLineKey({ productId: null, serviceName: 'Delivery' })).toBe('S:delivery');
    const rem = remainingByLine(
      [line({ saleItemId: 7, productId: null, serviceName: 'Delivery', quantity: 1, totalPrice: 100, taxAmount: 0, taxCode: 'A' })],
      [{ productId: null, serviceName: 'Delivery', absQuantity: 1 }],
    );
    expect(rem).toEqual([{ saleItemId: 7, remaining: 0 }]);
  });
});

describe('NR over-refund + duplicate protection (Tests 4, 5)', () => {
  it('Test 4 — 8 refunded, requesting 5 → rejected with remaining shown', () => {
    expect(() =>
      planRefundLines([line()], [{ productId: 10, serviceName: null, absQuantity: 8 }], [{ saleItemId: 1, quantity: 5 }]),
    ).toThrowError(/only 2 remain refundable/);
  });

  it('Test 5 — replaying the same refund after it applied → rejected (nothing left)', () => {
    const orig = [line()];
    const first = planRefundLines(orig, [], [{ saleItemId: 1, quantity: 10 }]);
    expect(first[0].quantity).toBe(-10);
    // Second identical submission now sees the consumed quantity:
    expect(() => planRefundLines(orig, [{ productId: 10, serviceName: null, absQuantity: 10 }], [{ saleItemId: 1, quantity: 10 }])).toThrowError(
      RefundRuleError,
    );
  });

  it('unknown saleItemId and non-positive quantities are rejected', () => {
    expect(() => planRefundLines([line()], [], [{ saleItemId: 999, quantity: 1 }])).toThrowError(/does not belong/);
    expect(() => planRefundLines([line()], [], [{ saleItemId: 1, quantity: 0 }])).toThrowError(/must be positive/);
    expect(() => planRefundLines([line()], [], [{ saleItemId: 1, quantity: -2 }])).toThrowError(/must be positive/);
  });

  it('full refund with no priors refunds everything; fully-refunded sale refuses again', () => {
    const planned = planRefundLines([line()], [], null);
    expect(planned).toHaveLength(1);
    expect(planned[0].quantity).toBe(-10);
    expect(() =>
      planRefundLines([line()], [{ productId: 10, serviceName: null, absQuantity: 10 }], null),
    ).toThrowError(/already fully refunded/);
  });
});

describe('NR reason + justification (Test 6)', () => {
  it('Test 6 — missing justification rejected; code 13 needs a real explanation', () => {
    expect(() => assertRefundReason('06', '')).toThrowError(/justification is required/);
    expect(() => assertRefundReason('06', null)).toThrowError(/justification is required/);
    expect(() => assertRefundReason('13', 'misc')).toThrowError(/requires an explanation/);
    expect(() => assertRefundReason('06', 'Customer returned damaged goods')).not.toThrow();
    expect(() => assertRefundReason('13', 'Customer moved abroad, contract cancelled')).not.toThrow();
  });
});

describe('NR negative calculation consistency (Test 9)', () => {
  it('Test 9 — full refund: every leg negated, totals reconcile', () => {
    const orig = [line({ quantity: 2, unitPrice: 5900, totalPrice: 11800, taxAmount: 1800 })]; // taxable 10000 + tax 1800
    const planned = planRefundLines(orig, [], null);
    expect(planned[0]).toMatchObject({ quantity: -2, unitPrice: 11800 / 2, totalPrice: -11800, taxAmount: -1800 });
    const t = summarizeRefund(planned);
    expect(t).toMatchObject({ totalRefundAmount: 11800, totalRefundVat: 1800, totalRefundTaxable: 10000 });
  });

  it('partial refund scales proportionally: 3 of 10 × 5000', () => {
    const orig = [line({ quantity: 10, unitPrice: 5000, totalPrice: 50000, taxAmount: 7627.12 })];
    const planned = planRefundLines(orig, [], [{ saleItemId: 1, quantity: 3 }]);
    expect(planned[0].quantity).toBe(-3);
    expect(planned[0].totalPrice).toBe(-15000);
    expect(planned[0].taxAmount).toBe(-2288.14); // 7627.12 × 0.3
    const t = summarizeRefund(planned);
    expect(t.totalRefundAmount).toBe(15000);
    expect(t.totalRefundVat).toBe(2288.14);
    expect(t.totalRefundTaxable).toBe(12711.86);
    expect(t.bands.B).toMatchObject({ net: 15000, tax: 2288.14 });
  });

  it('discount legs scale too — never positive-legs-with-negative-total', () => {
    const orig = [line({ quantity: 4, unitPrice: 620, totalPrice: 2480, taxAmount: 378.31, dcRate: 10, dcAmt: 248 })];
    const planned = planRefundLines(orig, [], [{ saleItemId: 1, quantity: 1 }]);
    expect(planned[0].dcAmt).toBe(-62);
    expect(planned[0].totalPrice).toBe(-620);
    for (const leg of planned) {
      expect(leg.quantity).toBeLessThan(0);
      expect(leg.totalPrice).toBeLessThan(0);
      expect(leg.taxAmount).toBeLessThanOrEqual(0);
      expect(leg.unitPrice).toBeGreaterThan(0); // unit price itself stays positive by convention
    }
  });
});

describe('NR original eligibility (rules 1–5)', () => {
  const base = { id: 1, status: 'COMPLETED', rcptLabel: 'NS' as string | null, isProforma: false, originalSaleId: null, vsdcInvcNo: 8 };
  it('accepts a COMPLETED or PARTIALLY_REFUNDED NS sale (legacy null label = NS)', () => {
    expect(() => assertOriginalRefundable(base)).not.toThrow();
    expect(() => assertOriginalRefundable({ ...base, status: 'PARTIALLY_REFUNDED' })).not.toThrow();
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: null })).not.toThrow();
  });
  it('rule 2 — cannot refund another refund (NR source)', () => {
    expect(() => assertOriginalRefundable({ ...base, originalSaleId: 7, rcptLabel: 'NR' })).toThrowError(/never be the source/);
  });
  it('rules 3–5 — cannot refund training / proforma / copy / cancelled / already-refunded / unnumbered', () => {
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: 'TS' })).toThrowError(/only be refunded \(as TR\) while training mode is on/);
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: 'TR' })).toThrowError(/Only a Normal Sale/);
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: 'PS' })).toThrowError(/Only a Normal Sale/);
    expect(() => assertOriginalRefundable({ ...base, rcptLabel: 'CS' })).toThrowError(/Only a Normal Sale/);
    expect(() => assertOriginalRefundable({ ...base, isProforma: true, rcptLabel: 'PS' })).toThrowError(/proforma/);
    expect(() => assertOriginalRefundable({ ...base, status: 'CANCELLED' })).toThrowError(/cancelled/);
    expect(() => assertOriginalRefundable({ ...base, status: 'REFUNDED' })).toThrowError(/already refunded/);
    expect(() => assertOriginalRefundable({ ...base, vsdcInvcNo: null })).toThrowError(/orgInvcNo/);
  });
  it('refuses an NS that has an invoice number but no VSDC receipt confirmation', () => {
    const ok = {
      submissionStatus: 'SUCCESS',
      rcptNo: 40,
      internalData: 'DATA1234DATA5678',
      receiptSignature: 'ABCD1234EFGH5678',
      sdcId: 'SDC010000001',
      publishedAt: new Date('2026-10-01T10:00:14.000Z'),
    };
    expect(() => assertOriginalConfirmed(ok)).not.toThrow();
    expect(() => assertOriginalConfirmed(null)).toThrowError(/not been confirmed/);
    expect(() => assertOriginalConfirmed({ ...ok, submissionStatus: 'FAILED' })).toThrowError(/not been confirmed/);
    expect(() => assertOriginalConfirmed({ ...ok, receiptSignature: '' })).toThrowError(/rcptSign/);
    expect(() => assertOriginalConfirmed({ ...ok, internalData: null })).toThrowError(/intrlData/);
  });
  it('prints the original sale\'s SDC rcptNo alone (spec 14.1 "NNNN"), not the n/m TYPE pair', () => {
    expect(formatOriginalReceiptReference(8)).toBe('8');
    expect(formatOriginalReceiptReference(201)).toBe('201');
    expect(formatOriginalReceiptReference(0)).toBeNull();
    expect(formatOriginalReceiptReference(1.5)).toBeNull();
    expect(formatOriginalReceiptReference(null)).toBeNull();
    expect(formatOriginalReceiptReference(undefined)).toBeNull();
  });
});

describe('NR VSDC mapping — partial refund is still R + orgInvcNo + rfdRsnCd', () => {
  function refundSaleDoc(): SaleWithRelations {
    return {
      id: 2, saleNumber: 'REFUND-SALE-1-1', invoiceNumber: 'INV-1', vsdcInvcNo: 9,
      prcOrdCd: 'PC0001', rcptLabel: 'NR', createdAt: new Date('2026-10-01T10:00:00.000Z'),
      status: 'REFUNDED', paymentType: 'CASH',
      cashAmount: new Decimal(-15000), debtAmount: new Decimal(0), insuranceAmount: new Decimal(0),
      totalAmount: new Decimal(-15000), taxableAmount: new Decimal(-12711.86), vatAmount: new Decimal(-2288.14),
      branchId: 1,
      branch: { id: 1, name: 'Main', code: 'M', bhfId: '00', ebmDeviceId: 'SDC1', ebmSerialNo: 'MRC1' },
      customer: { id: 5, name: 'Client', phone: '0788000000', TIN: '100000001', customerType: 'INDIVIDUAL', email: null },
      user: { id: 1, name: 'Cashier' },
      saleItems: [{
        productId: 10, quantity: -3, unitPrice: new Decimal(5000), totalPrice: new Decimal(-15000),
        taxRate: new Decimal(18), taxAmount: new Decimal(-2288.14), taxCode: 'B',
        dcRate: new Decimal(0), dcAmt: new Decimal(0), measurementUnit: 'PCS',
        product: { name: 'Widget', itemCd: 'RW2CTU0000001', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null },
      }],
    } as unknown as SaleWithRelations;
  }
  const org = { TIN: '999945560', name: 'Seller', address: 'Kigali' };
  it('partial NR submits positive wire legs with salesSttsCd 05 + original reference', () => {
    const p = buildRraSendReceiptPayload(refundSaleDoc(), org, '01', {
      orgInvcNo: 8, rfdDt: new Date('2026-10-02T10:00:00.000Z'), rfdRsnCd: '03',
    }) as any;
    expect(p.salesTyCd).toBe('N');
    expect(p.rcptTyCd).toBe('R');
    expect(p.salesSttsCd).toBe('05');
    expect(p.orgInvcNo).toBe(8);
    expect(p.rfdRsnCd).toBe('03');
    expect(p.itemList[0].qty).toBe(3);
    expect(p.itemList[0].taxblAmt).toBe(15000);
    expect(p.itemList[0].taxAmt).toBe(2288.14);
    expect(p.taxblAmtB).toBe(15000);
    expect(p.totTaxAmt).toBe(2288.14);
    // Stored sale is negative; the wire document is the positive refunded subset only.
    expect(p.totAmt).toBe(15000);
    expect(p.itemList).toHaveLength(1);
    expect(p.cnclDt).toBeNull();
    expect(p.rfdDt).toMatch(/^\d{14}$/);
    expect(p.cfmDt).toMatch(/^\d{14}$/);
    expect(p.salesDt).toMatch(/^\d{8}$/);
    p.remark = 'Customer returned 3 damaged units';
    expect(() => assertNrWirePayload(p)).not.toThrow();
  });

  it('full NR uses the same refund transaction shape for every remaining line', () => {
    const sale = refundSaleDoc();
    sale.saleItems = [
      sale.saleItems[0],
      {
        ...sale.saleItems[0],
        productId: 11,
        quantity: -2,
        unitPrice: new Decimal(1000),
        totalPrice: new Decimal(-2000),
        taxAmount: new Decimal(-305.08),
        taxCode: 'B',
        product: { ...sale.saleItems[0].product!, name: 'Bolt', itemCd: 'RW2CTU0000002' },
      },
    ] as any;
    (sale as any).totalAmount = new Decimal(-17000);
    const p = buildRraSendReceiptPayload(sale, org, '01', {
      orgInvcNo: 8, rfdDt: new Date('2026-10-02T10:00:00.000Z'), rfdRsnCd: '06',
    }) as any;
    p.remark = 'Full return of both lines';
    expect(p.totItemCnt).toBe(2);
    expect(p.itemList.map((i: any) => i.qty)).toEqual([3, 2]);
    expect(p.totAmt).toBe(17000);
    expect(() => assertNrWirePayload(p)).not.toThrow();
  });

  it('rejects a payload that is not a refund of an original NS', () => {
    const p = buildRraSendReceiptPayload(refundSaleDoc(), org, '01', {
      orgInvcNo: 8, rfdDt: new Date('2026-10-02T10:00:00.000Z'), rfdRsnCd: '06',
    }) as any;
    p.remark = 'Customer returned damaged goods';
    expect(() => assertNrWirePayload({ ...p, orgInvcNo: 0 })).toThrowError(/orgInvcNo/);
    expect(() => assertNrWirePayload({ ...p, rcptTyCd: 'S', salesSttsCd: '02' })).toThrowError(/rcptTyCd/);
    expect(() => assertNrWirePayload({ ...p, rfdDt: '2026-10-02' })).toThrowError(/rfdDt/);
    expect(() => assertNrWirePayload({ ...p, rfdRsnCd: '6' })).toThrowError(/rfdRsnCd/);
    expect(() => assertNrWirePayload({ ...p, remark: '' })).toThrowError(/remark/);
    expect(() => assertNrWirePayload({ ...p, itemList: [{ ...p.itemList[0], qty: -3, taxblAmt: -15000 }] })).toThrowError(/qty/);
    expect(() => assertNrWirePayload({ ...p, orgInvcNo: p.invcNo })).toThrowError(/not this refund invoice/);
  });
});

const CONFIRMED_NR = {
  resultCd: '000',
  resultMsg: 'It is succeeded',
  resultDt: '20261002120014',
  data: {
    rcptNo: 41,
    intrlData: 'ABCD1234EFGH5678',
    rcptSign: 'SIGN1234DATA5678',
    totRcptNo: 200,
    vsdcRcptPbctDate: '20261002120014',
    sdcId: 'SDC010000005',
    mrcNo: 'WIS01006230',
  },
};

describe('NR VSDC response — confirmation requires the receipt block', () => {
  it('accepts the spec success body and keeps every fiscal field', () => {
    const assessed = assessVsdcReceiptConfirmation(CONFIRMED_NR);
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.data).toMatchObject({
      rcptNo: '41',
      totRcptNo: '200',
      intrlData: 'ABCD1234EFGH5678',
      vsdcSignature: 'SIGN1234DATA5678',
      sdcId: 'SDC010000005',
      mrcNo: 'WIS01006230',
      sdcDateTime: '2026-10-02T12:00:14+02:00',
    });
    const decision = decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: CONFIRMED_NR });
    expect(decision.confirmed).toBe(true);
  });

  it('does not confirm resultCd 000 when the signature, counter, or timestamp is missing', () => {
    const bare = { resultCd: '000', resultMsg: 'It is succeeded', data: { rcptNo: 41 } };
    const assessed = assessVsdcReceiptConfirmation(bare);
    expect(assessed.ok).toBe(false);
    if (assessed.ok) return;
    expect(assessed.error).toMatch(/rcptSign/);
    expect(assessed.error).toMatch(/vsdcRcptPbctDate/);
    const decision = decideNrFiscalResult({ success: true, rawStatus: 200, rawBody: bare });
    expect(decision.confirmed).toBe(false);
  });

  it('treats a business rejection as a permanent failure and does not invent a receipt', () => {
    const rejected = { resultCd: '910', resultMsg: 'Request parameter error', data: null };
    const decision = decideNrFiscalResult({
      success: false,
      error: 'VSDC error 910: Request parameter error',
      rawStatus: 200,
      rawBody: rejected,
    });
    expect(decision.confirmed).toBe(false);
    if (decision.confirmed) return;
    expect(decision.retryable).toBe(false);
    expect(decision.error).toMatch(/910/);
  });

  it('treats a timeout with no body as retryable and unconfirmed', () => {
    const decision = decideNrFiscalResult({
      success: false,
      error: 'The operation was aborted',
      rawStatus: 0,
      rawBody: null,
    });
    expect(decision).toMatchObject({ confirmed: false, retryable: true });
  });

  it('does not accept resultCd 924 unless VSDC echoed the full receipt block', () => {
    const duplicate = decideNrFiscalResult({
      success: false,
      error: 'VSDC error 924: Invoice number already exists.',
      rawStatus: 200,
      rawBody: { resultCd: '924', resultMsg: 'Invoice number already exists.', data: null },
    });
    expect(duplicate.confirmed).toBe(false);
    if (!duplicate.confirmed) {
      expect(duplicate.retryable).toBe(false);
      expect(duplicate.error).toMatch(/924/);
      expect(duplicate.error).toMatch(/new invoice number/);
    }
    const replay = decideNrFiscalResult({
      success: false,
      rawStatus: 200,
      rawBody: { ...CONFIRMED_NR, resultCd: '924', resultMsg: 'Invoice number already exists.' },
    });
    expect(replay.confirmed).toBe(true);
    if (replay.confirmed) expect(replay.data.vsdcSignature).toBe('SIGN1234DATA5678');
  });

  it('rejects a non-object body instead of parsing a receipt out of it', () => {
    const decision = decideNrFiscalResult({
      success: false,
      error: 'Gateway HTTP 502',
      rawStatus: 502,
      rawBody: '<html>bad gateway</html>',
    });
    expect(decision.confirmed).toBe(false);
    if (!decision.confirmed) expect(decision.retryable).toBe(true);
  });
});

describe('NR wire body — internal fields stay off TrnsSalesSaveWrReq', () => {
  const OLD = { useMock: config.ebm.useMock, apiUrl: config.ebm.apiUrl };
  afterEach(() => {
    vi.unstubAllGlobals();
    config.ebm.useMock = OLD.useMock;
    config.ebm.apiUrl = OLD.apiUrl;
  });

  it('saveInvc strips idempotencyKey but keeps every spec field', async () => {
    config.ebm.useMock = false;
    config.ebm.apiUrl = 'http://vsdc.test';
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ resultCd: '910', resultMsg: 'stub', data: null }), { status: 200 });
    }));
    await saveInvc(
      { tin: '999945560', bhfId: '00', sdcId: 'SDC1', mrcNo: 'MRC1', dvcSrlNo: 'MRC1', env: 'sandbox' },
      { invcNo: 46, orgInvcNo: 45, rcptTyCd: 'R', rfdRsnCd: '06', idempotencyKey: 'ebm-REFUND-1-48' },
    );
    expect(sent).not.toHaveProperty('idempotencyKey');
    expect(sent).toMatchObject({ tin: '999945560', bhfId: '00', invcNo: 46, orgInvcNo: 45, rcptTyCd: 'R', rfdRsnCd: '06' });
  });
});

describe('NR consumed helper', () => {
  it('sums absolute quantities per key', () => {
    const m = consumedByKey([
      { productId: 10, serviceName: null, absQuantity: 3 },
      { productId: 10, serviceName: null, absQuantity: 4 },
    ]);
    expect(m.get('P:10')).toBe(7);
  });
});

describe('NR receipt content (Test 10) — real 80mm + A4 renderers', () => {
  async function nrDrawn(format: '80mm' | 'A4', isCopy = false): Promise<string> {
    const { generateEbmReceiptPdf80mm } = await import('../src/services/invoice-receipt-pdf.service');
    const { generateEbmInvoicePdf } = await import('../src/services/invoice-pdf.service');
    const { default: PDFDocument } = await import('pdfkit');
    const { vi } = await import('vitest');
    const payload: any = {
      company: { name: 'Seller Ltd', address: 'KN 3 Rd, Kigali', phone: '+250788000000', tin: '999945560', mrc: 'WIS01006230', currency: 'RWF', ebmLinked: true },
      customer: { name: 'Client Ltd', tin: '100000001', phone: '0788000000' },
      invoice: {
        id: '2', saleNumber: 'REFUND-SALE-1-1', invoiceNumber: '9', receiptNumber: '41/200 NR',
        invoiceDate: new Date('2026-10-02T10:00:00.000Z').toISOString(), time: '12:00:00',
        paymentMethod: 'Cash', cashier: 'Cashier', status: 'REFUNDED', rcptLabel: 'NR',
        rcptLabelText: 'Normal Refund', isProforma: false, isCopy, currency: 'RWF',
        originalReceiptNumber: '8',
        refundReasonCode: '03',
        refundReason: 'Customer returned damaged goods',
        refundRecipient: 'Client Ltd',
      },
      items: [
        { line: 1, code: 'RW2CTU0000001', description: 'Widget', quantity: -3, unit: 'PCS', unitPrice: 5000, discountPct: 0, discountAmt: 0, taxCode: 'B', vatPct: 18, taxAmount: -2288.14, subtotal: -15000, net: -15000, total: -15000 },
      ],
      totals: { subtotal: -15000, discount: 0, taxable: -12711.86, vat: -2288.14, tax: -2288.14, shipping: 0, paid: 0, balance: 0, grandTotal: -15000 },
      charges: { vatAmount: -2288.14, taxableAmount: -12711.86, discountAmount: 0, cashAmount: -15000, insuranceAmount: 0, debtAmount: 0, totalAmount: -15000, shipping: 0 },
      taxRates: [0, 18, 0, 0],
      payment: { method: 'CASH', methodLabel: 'Cash' },
      sdcInformation: {
        sdcId: 'SDC010000005', mrcNo: 'WIS01006230', receiptNumber: '41/200 NR',
        receiptSignature: 'SIGN1234DATA5678', internalData: 'ABCD1234EFGH5678',
        sdcDateTime: new Date('2026-10-02T10:00:14.000Z').toISOString(), date: new Date('2026-10-02T10:00:14.000Z').toISOString(), time: '12:00:14',
        ebmInvoiceNumber: '41', rcptLabel: 'NR', poweredBy: 'Excledge ERP', softwareVersion: 'Software version: v1.0.0',
      },
      certification: { isCertified: true },
      verification: { qrCodeImage: null, qrPayload: '02102026#120014#SDC010000005#41#ABCD1234EFGH5678#SIGN1234DATA5678' },
      branding: {}, footer: { message: 'Thank you for your business.', note: null },
    };
    const drawn: string[] = [];
    const spy = vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, text: unknown) {
      drawn.push(String(text));
      return this;
    });
    try {
      if (format === '80mm') await generateEbmReceiptPdf80mm(payload);
      else await generateEbmInvoicePdf(payload, 'A4');
    } finally {
      spy.mockRestore();
    }
    return drawn.join('\n');
  }

  it('Test 10 — 80mm NR identifies itself, references the original, shows negatives + VSDC block', async () => {
    const text = await nrDrawn('80mm');
    expect(text).toContain('REFUND'); // refund indication (title + notice)
    expect(text).toContain('REF. NORMAL RECEIPT#: 8');
    expect(text).not.toContain('REFUND REASON');
    expect(text).not.toContain('REFUND TO');
    expect(text).toContain('-15000.00'); // negative amounts, no grouping
    expect(text).toContain('41/200 NR'); // VSDC A/B counter for the NR itself
    expect(text).toContain('SDC INFORMATION');
    expect(text).toContain('SDC010000005');
    expect(text).toContain('WIS01006230'); // MRC
    expect(text).not.toContain('TRAINING MODE');
    expect(text).not.toContain('PROFORMA');
  });

  it('Test 10 — HTML NR carries the original reference and negatives, no reason/recipient lines', async () => {
    const { renderSalesInvoiceHtml } = await import('../src/services/invoice-render.service');
    const html = renderSalesInvoiceHtml({
      company: { name: 'Seller Ltd', address: 'KN 3 Rd, Kigali', phone: '+250788000000', tin: '999945560', mrc: 'WIS01006230', currency: 'RWF', ebmLinked: true },
      customer: { name: 'Client Ltd', tin: '100000001', phone: '0788000000' },
      invoice: {
        id: '2', saleNumber: 'REFUND-SALE-1-1', invoiceNumber: '9', receiptNumber: '41/200 NR',
        invoiceDate: new Date('2026-10-02T10:00:00.000Z').toISOString(), time: '12:00:00',
        paymentMethod: 'Cash', cashier: 'Cashier', status: 'REFUNDED', rcptLabel: 'NR',
        rcptLabelText: 'Normal Refund', isProforma: false, isCopy: false, currency: 'RWF',
        originalReceiptNumber: '8',
        refundReasonCode: '03', refundReason: 'Customer returned damaged goods', refundRecipient: 'Client Ltd',
      },
      items: [
        { line: 1, code: 'RW2CTU0000001', description: 'Widget', quantity: -3, unit: 'PCS', unitPrice: 5000, discountPct: 0, discountAmt: 0, taxCode: 'B', vatPct: 18, taxAmount: -2288.14, subtotal: -15000, net: -15000, total: -15000 },
      ],
      totals: { subtotal: -15000, discount: 0, taxable: -12711.86, vat: -2288.14, tax: -2288.14, shipping: 0, paid: 0, balance: 0, grandTotal: -15000 },
      charges: { vatAmount: -2288.14, taxableAmount: -12711.86, discountAmount: 0, cashAmount: -15000, insuranceAmount: 0, debtAmount: 0, totalAmount: -15000, shipping: 0 },
      taxRates: [0, 18, 0, 0] as [number, number, number, number],
      payment: { method: 'CASH', methodLabel: 'Cash' },
      sdcInformation: {
        sdcId: 'SDC010000005', mrcNo: 'WIS01006230', receiptNumber: '41/200 NR',
        receiptSignature: 'SIGN1234DATA5678', internalData: 'ABCD1234EFGH5678',
        sdcDateTime: new Date('2026-10-02T10:00:14.000Z').toISOString(),
        ebmInvoiceNumber: '41', rcptLabel: 'NR',
      },
      certification: { isCertified: true },
      verification: { qrPayload: '02102026#120014#SDC010000005#41#ABCD1234EFGH5678#SIGN1234DATA5678' },
      branding: {},
    } as any);
    expect(html).toContain('REFUND');
    expect(html).toContain('REF. NORMAL RECEIPT#: 8');
    expect(html).not.toContain('REFUND REASON:');
    expect(html).not.toContain('REFUND TO:');
    expect(html).toContain('-15000.00');
    expect(html).toContain('41/200 NR');
    expect(html).toContain('SIGN-1234-DATA-5678');
  });

  it('Test 10 — A4 NR likewise; a reprint renders COPY (never a second original)', async () => {
    const text = await nrDrawn('A4');
    expect(text).toContain('REFUND');
    expect(text).toContain('41/200 NR');
    expect(text).toContain('REF. NORMAL RECEIPT#: 8');
    expect(text).not.toContain('REFUND REASON');
    expect(text).not.toContain('THIS IS NOT AN OFFICIAL RECEIPT');
    const copy = await nrDrawn('A4', true);
    expect(copy).toContain('COPY');
    expect(copy).not.toContain('THIS IS NOT AN OFFICIAL RECEIPT');
  });
});

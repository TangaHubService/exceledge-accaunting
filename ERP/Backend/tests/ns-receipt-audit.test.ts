/**
 * NS (Normal Sale) receipt audit — requirement-under-test evidence.
 *
 * Covers Steps 5+6 of the audit without needing a DB or network:
 *  - VSDC payload shape for an NS sale (2023 spec §3.3.6.1)
 *  - tax-inclusive B-18% math (tax = amount x 18/118)
 *  - mixed A-EX/B/discount/service payload bands
 *  - buyer TIN/phone variants
 *  - payment codes incl. mixed tender
 *  - itemCd vs itemClsCd orientation
 *  - QR string format (§7.24.7)
 *  - EJ text block content
 *  - receipt-content print rules (B always printed, zero-rate only when used)
 *  - NS carries no COPY/TRAINING/PROFORMA title and no NOT-OFFICIAL notice
 *  - amount/date formatting, dash-every-4 grouping
 *  - VSDC response parsing + non-"000" error classification
 */
import { describe, it, expect } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import {
  buildRraSendReceiptPayload,
  type SaleWithRelations,
} from '../src/services/rra-ebm.service';
import {
  parseVsdcResponse,
  parseVsdcStatusCode,
} from '../src/services/vsdc-api.service';
import {
  taxGroups,
  documentIndicator,
  isFormalNoticeIndicator,
  bandSalesLabel,
} from '../src/services/invoice-pdf.service';
import type { RenderInvoicePayload, RenderInvoiceLineItem } from '../src/services/invoice-render.service';
import {
  formatInvoiceAmount,
  formatInvoiceDateTime,
  groupFiscalValue,
  kigaliWallParts,
} from '../src/services/invoice-format.service';
import { toRraDate, toRraTime, toRraDateTime } from '../src/services/rra-ebm.service';
import { bandTaxFromNet } from '../src/services/money.service';
import { buildElectronicJournal } from '../src/services/electronic-journal.service';

function nsItem(over: Record<string, any> = {}) {
  return {
    productId: 10,
    quantity: 1,
    unitPrice: new Decimal(1180),
    totalPrice: new Decimal(1180),
    taxRate: new Decimal(18),
    taxAmount: new Decimal(180),
    taxCode: 'B',
    dcRate: new Decimal(0),
    dcAmt: new Decimal(0),
    measurementUnit: 'PCS',
    product: {
      name: 'Widget',
      itemCd: 'RW2CTU0000001',
      itemClsCd: '5059690800',
      pkgUnitCd: 'CT',
      qtyUnitCd: 'U',
      packagingQty: null,
      barcode: '8901234567890',
    },
    ...over,
  };
}

function nsSale(over: Partial<SaleWithRelations> = {}): SaleWithRelations {
  return {
    id: 1,
    saleNumber: 'SALE-NS-1',
    invoiceNumber: 'INV-NS-1',
    vsdcInvcNo: 8,
    prcOrdCd: 'PC0001',
    rcptLabel: 'NS',
    createdAt: new Date('2026-10-01T10:20:30.000Z'),
    status: 'COMPLETED',
    paymentType: 'CASH',
    cashAmount: new Decimal(1180),
    debtAmount: new Decimal(0),
    insuranceAmount: new Decimal(0),
    totalAmount: new Decimal(1180),
    taxableAmount: new Decimal(1000),
    vatAmount: new Decimal(180),
    branchId: 1,
    branch: { id: 1, name: 'Main', code: 'M', bhfId: '00', ebmDeviceId: 'SDC010000005', ebmSerialNo: 'WIS01006230' },
    customer: { id: 5, name: 'Walk-in Client', phone: '0788000000', TIN: '100000001', customerType: 'INDIVIDUAL', email: null },
    user: { id: 1, name: 'Cashier' },
    saleItems: [nsItem()],
    ...over,
  } as unknown as SaleWithRelations;
}

const ORG = { TIN: '999945560', name: 'Test Trader Ltd', address: 'KN 3 Rd, Kigali', phone: '+250788000000' };

function renderItem(over: Partial<RenderInvoiceLineItem> = {}): RenderInvoiceLineItem {
  return {
    line: 1, code: 'RW2CTU0000001', description: 'Widget', quantity: 1, unit: 'PCS',
    unitPrice: 1180, discountPct: 0, discountAmt: 0, taxCode: 'B', vatPct: 18,
    taxAmount: 180, subtotal: 1180, net: 1180, total: 1180, ...over,
  };
}
function renderPayload(over: Partial<RenderInvoicePayload> = {}): RenderInvoicePayload {
  return {
    company: { name: 'Test Trader Ltd', address: 'KN 3 Rd', phone: '+250788000000', tin: '999945560', ebmLinked: true },
    customer: { name: 'Walk-in Client', tin: '100000001', phone: '0788000000' },
    invoice: {
      invoiceNumber: '8', receiptNumber: '168/258 NS', invoiceDate: new Date('2026-10-01T10:20:30Z').toISOString(),
      time: '10:20:30', paymentMethod: 'Cash', cashier: 'Cashier', status: 'COMPLETED',
      rcptLabel: 'NS', isProforma: false, isCopy: false, currency: 'RWF',
    },
    items: [renderItem()],
    totals: { subtotal: 1180, discount: 0, taxable: 1000, vat: 180, tax: 180, shipping: 0, paid: 1180, balance: 0, grandTotal: 1180 },
    charges: { vatAmount: 180, taxableAmount: 1000, discountAmount: 0, cashAmount: 1180, insuranceAmount: 0, debtAmount: 0, totalAmount: 1180, shipping: 0 },
    payment: {}, sdcInformation: {}, certification: { isCertified: true }, verification: {}, branding: {},
    ...over,
  } as RenderInvoicePayload;
}

describe('NS-1: single goods item at tax B (18%, tax-inclusive)', () => {
  it('tax = amount x 18/118 (1180 -> 180.00)', () => {
    expect(bandTaxFromNet(1180, 18)).toBe(180);
    expect(bandTaxFromNet(5340, 18)).toBe(814.58); // R4 sample value
  });

  it('payload carries salesTyCd N + rcptTyCd S, orgInvcNo 0', () => {
    const p = buildRraSendReceiptPayload(nsSale(), ORG, '01') as any;
    expect(p.salesTyCd).toBe('N');
    expect(p.rcptTyCd).toBe('S');
    expect(p.orgInvcNo).toBe(0);
    expect(p.salesSttsCd).toBe('02');
  });

  it('band B holds the inclusive base and extracted VAT', () => {
    const p = buildRraSendReceiptPayload(nsSale(), ORG, '01') as any;
    expect(p.taxblAmtB).toBe(1180);
    expect(p.taxAmtB).toBe(180);
    expect(p.totTaxblAmt).toBe(1180);
    expect(p.totTaxAmt).toBe(180);
    expect(p.totAmt).toBe(1180);
    expect(p.totItemCnt).toBe(1);
    expect(p.taxRtB).toBe(18);
  });
});

describe('NS-2: mixed items (A-EX + B + discounted + service)', () => {
  function mixedSale() {
    return nsSale({
      totalAmount: new Decimal(3380),
      saleItems: [
        nsItem({ productId: 11, unitPrice: new Decimal(500), totalPrice: new Decimal(500), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: 'A', product: { name: 'Exempt goods', itemCd: 'RW2CTU0000002', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null } }),
        nsItem({ productId: 10, quantity: 2, unitPrice: new Decimal(1180), totalPrice: new Decimal(2360), taxRate: new Decimal(18), taxAmount: new Decimal(360), taxCode: 'B' }),
        nsItem({ productId: 12, unitPrice: new Decimal(620), totalPrice: new Decimal(520), taxRate: new Decimal(18), taxAmount: new Decimal(79.32), taxCode: 'B', dcRate: new Decimal(16.13), dcAmt: new Decimal(100), product: { name: 'Discounted goods', itemCd: 'RW2CTU0000003', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null } }),
        { productId: 99, quantity: 1, unitPrice: new Decimal(100), totalPrice: new Decimal(100), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: 'A', dcRate: new Decimal(0), dcAmt: new Decimal(0), measurementUnit: 'PCS', serviceName: 'Delivery service', product: { name: 'Delivery service', itemCd: 'RW2CTU0000099', itemClsCd: '5059690800', pkgUnitCd: 'CT', qtyUnitCd: 'U', packagingQty: null } },
      ],
    });
  }
  it('discounted leg enters bands net of discount; service line accepted without product', () => {
    const p = buildRraSendReceiptPayload(mixedSale(), ORG, '01') as any;
    expect(p.totItemCnt).toBe(4);
    expect(p.itemList[2].dcAmt).toBe(100);
    expect(p.itemList[2].splyAmt).toBe(620); // gross kept for the dcAmt<=splyAmt check
    expect(p.itemList[2].taxblAmt).toBe(520); // net enters the band
    expect(p.itemList[3].itemCd).toBe('RW2CTU0000099'); // catalog service: registered itemCd
    expect(p.taxblAmtA).toBe(600); // 500 exempt goods + 100 service
    expect(p.taxblAmtB).toBe(2880); // 2360 + 520 net
  });
  it('GAP: ad-hoc service line without catalog classification cannot be fiscalized', () => {
    const s = nsSale({
      saleItems: [
        { productId: null, quantity: 1, unitPrice: new Decimal(100), totalPrice: new Decimal(100), taxRate: new Decimal(0), taxAmount: new Decimal(0), taxCode: 'A', dcRate: new Decimal(0), dcAmt: new Decimal(0), measurementUnit: 'PCS', serviceName: 'Ad-hoc service', product: null },
      ],
    });
    // Synthetic SVC-n itemCd is allocated but itemClsCd has no source → throws.
    expect(() => buildRraSendReceiptPayload(s, ORG, '01')).toThrow(/no RRA item classification/);
  });
});

describe('NS-3: buyer TIN/phone variants', () => {
  it('client with TIN+phone fills both receipt slots', () => {
    const p = buildRraSendReceiptPayload(nsSale(), ORG, '01') as any;
    expect(p.custTin).toBe('100000001');
    expect(p.receipt.custTin).toBe('100000001');
    expect(p.receipt.custMblNo).toBe('0788000000');
  });
  it('walk-in without TIN/phone submits JSON nulls, never ""', () => {
    const s = nsSale();
    (s.customer as any).TIN = null;
    (s.customer as any).phone = '';
    const p = buildRraSendReceiptPayload(s, ORG, '01') as any;
    expect(p.custTin).toBeNull();
    expect(p.receipt.custTin).toBeNull();
    expect(p.receipt.custMblNo).toBeNull();
  });
});

describe('NS-4: payment codes incl. mixed tender', () => {
  it('cash=01, debt=02, mixed=03, mobile=06 reach pmtTyCd', () => {
    expect(buildRraSendReceiptPayload(nsSale({ paymentType: 'CASH' }), ORG, '01') as any);
    const cash = buildRraSendReceiptPayload(nsSale({ paymentType: 'CASH' }), ORG, '01') as any;
    const debt = buildRraSendReceiptPayload(nsSale({ paymentType: 'DEBT' }), ORG, '02') as any;
    const mixed = buildRraSendReceiptPayload(nsSale({ paymentType: 'MIXED' }), ORG, '03') as any;
    const momo = buildRraSendReceiptPayload(nsSale({ paymentType: 'MOBILE_MONEY' }), ORG, '06') as any;
    expect(cash.pmtTyCd).toBe('01');
    expect(debt.pmtTyCd).toBe('02');
    expect(mixed.pmtTyCd).toBe('03');
    expect(momo.pmtTyCd).toBe('06');
  });
});

describe('NS-5: itemCd vs itemClsCd orientation', () => {
  it('itemCd = registered RRA item code, itemClsCd = UNSPSC classification', () => {
    const p = buildRraSendReceiptPayload(nsSale(), ORG, '01') as any;
    expect(p.itemList[0].itemCd).toBe('RW2CTU0000001');
    expect(p.itemList[0].itemClsCd).toBe('5059690800');
    expect(p.itemList[0].bcd).toBe('8901234567890');
    expect(p.itemList[0].taxTyCd).toBe('B');
  });
});

describe('NS-6: VSDC response storage + error handling', () => {
  it('parses rcptNo/totRcptNo/intrlData/rcptSign/vsdcRcptPbctDate/sdcId/mrcNo', () => {
    const r = parseVsdcResponse({
      resultCd: '000', resultMsg: 'It is succeeded', resultDt: '20261001102030',
      data: { rcptNo: 168, intrlData: 'ABCD1234EFGH5678', rcptSign: 'SIGN1234DATA5678', totRcptNo: 258, vsdcRcptPbctDate: '20261001102030', sdcId: 'SDC010000005', mrcNo: 'WIS01006230' },
    });
    expect(r.rcptNo).toBe('168');
    expect(r.totRcptNo).toBe('258');
    expect(r.intrlData).toBe('ABCD1234EFGH5678');
    expect(r.vsdcSignature).toBe('SIGN1234DATA5678');
    expect(r.sdcId).toBe('SDC010000005');
    expect(r.mrcNo).toBe('WIS01006230');
    expect(r.sdcDateTime).toBe('2026-10-01T10:20:30+02:00');
  });
  it('resultCd other than 000 is an error (e.g. 910)', () => {
    expect(parseVsdcStatusCode({ resultCd: '000' }).isError).toBe(false);
    const s = parseVsdcStatusCode({ resultCd: '910', resultMsg: 'Request parameter error' });
    expect(s.isError).toBe(true);
  });
});

describe('NS-7: QR string format (ddmmyyyy#hhmmss#sdc#rcptNo/totRcptNo+label#internal#signature)', () => {
  it('joins the six fields with # in spec order, on the Kigali wall clock', () => {
    // Mirrors buildRraQrString in sales.controller.ts (unit copy — keeps the
    // audit independent of the Express layer).
    const k = kigaliWallParts(new Date('2026-10-01T10:20:30.000Z'));
    const qr = [
      `${k.day}${k.month}${k.year}`,
      `${k.hour}${k.minute}${k.second}`,
      'SDC010000005', '168/258NS', 'ABCD1234EFGH5678', 'SIGN1234DATA5678',
    ].join('#');
    expect(qr).toBe('01102026#122030#SDC010000005#168/258NS#ABCD1234EFGH5678#SIGN1234DATA5678');
    expect(qr.split('#')).toHaveLength(6);
  });
});

describe('NS-8: EJ text block', () => {
  it('carries date/time, SDC+MRC, A/B label, items, totals, internal data + signature', () => {
    const ej = buildElectronicJournal(nsSale(), 'NS', {
      sdcId: 'SDC010000005', mrcNo: 'WIS01006230', sdcRcptNo: 168,
      internalData: 'ABCD1234EFGH5678', receiptSignature: 'SIGN1234DATA5678',
      sdcDateTime: new Date('2026-10-01T10:20:30'),
    });
    expect(ej).toContain('EJ_DATA');
    expect(ej).toContain('SDC_ID:SDC010000005');
    expect(ej).toContain('MRC:WIS01006230');
    expect(ej).toContain('RCPT_NO:168 TYPE:NS');
    expect(ej).toContain('TOTAL:1180');
    expect(ej).toContain('INT_DATA:ABCD1234EFGH5678');
    expect(ej).toContain('SIGNATURE:SIGN1234DATA5678');
    expect(ej).toContain('EJ_END');
  });
});

describe('NS-9: receipt content print rules', () => {
  it('band totals print only for tax codes used on line items', () => {
    const onlyA = taxGroups(renderPayload({ items: [renderItem({ taxCode: 'A', vatPct: 0, taxAmount: 0, total: 500, subtotal: 500, net: 500 })] }));
    expect(onlyA.find((g) => g.code === 'A')).toBeDefined();
    expect(onlyA.find((g) => g.code === 'B')).toBeUndefined();
    const onlyB = taxGroups(renderPayload({ items: [renderItem()] }));
    expect(onlyB.find((g) => g.code === 'B')).toBeDefined();
    expect(onlyB.find((g) => g.code === 'A')).toBeUndefined();
    expect(bandSalesLabel('A', 0)).toBe('TOTAL A-EX');
    expect(bandSalesLabel('B', 18)).toBe('TOTAL B-18.00%');
  });
  it('NS carries no COPY/TRAINING/PROFORMA title and no NOT-OFFICIAL notice', () => {
    const data = renderPayload();
    expect(documentIndicator(data)).toBe('');
    expect(isFormalNoticeIndicator(documentIndicator(data)) || !data.certification.isCertified).toBe(false);
  });
  it('amounts use 2 decimals with dot separator and NO thousands grouping; dates are DD/MM/YYYY (Kigali); fiscal values group by 4', () => {
    expect(formatInvoiceAmount(1180)).toBe('1180.00');
    expect(formatInvoiceAmount(5360)).toBe('5360.00');
    expect(formatInvoiceAmount(814.576)).toBe('814.58');
    // 10:20:30Z == 12:20:30 in Kigali (UTC+2, no DST) — same instant, taxpayer wall clock.
    const d = formatInvoiceDateTime(new Date('2026-10-01T10:20:30.000Z'));
    expect(d.date).toBe('01/10/2026');
    expect(d.time).toBe('12:20:30');
    expect(groupFiscalValue('ABCD1234EFGH5678')).toBe('ABCD-1234-EFGH-5678');
  });
  it('Kigali wall clock: UTC evening rolls the calendar day; midnight renders 00 not 24', () => {
    expect(kigaliWallParts(new Date('2026-10-01T22:30:00.000Z'))).toMatchObject({ day: '02', hour: '00', minute: '30' });
    expect(toRraDate(new Date('2026-10-01T22:30:00.000Z'))).toBe('20261002');
    expect(toRraTime(new Date('2026-10-01T10:20:30.000Z'))).toBe('122030');
    expect(toRraDateTime(new Date('2026-10-01T10:20:30.000Z'))).toBe('20261001122030');
  });
});

describe('FIX verification — audit gap closures', () => {
  it('EBM_STRICT_MODE defaults off; EJ sync path defaults unconfigured (journal stored, not sent)', async () => {
    const { config } = await import('../src/config');
    expect(config.ebm.strictMode).toBe(false);
    expect(config.ebm.ejSyncPath).toBe('');
  });

  it('correctSaleSchema accepts a correction and rejects a missing/short reason and empty items', async () => {
    const { correctSaleSchema } = await import('../src/validations/sales.validation');
    const body = {
      items: [{ quantity: 1, unitPrice: 1180, itemType: 'PRODUCT', productId: 10 }],
      reason: 'Wrong quantity entered',
      cashAmount: 1180, debtAmount: 0, insuranceAmount: 0,
    };
    const params = { organizationId: 1, saleId: 9 };
    expect(correctSaleSchema.safeParse({ body, params }).success).toBe(true);
    expect(correctSaleSchema.safeParse({ body: { ...body, reason: 'oops' }, params }).success).toBe(false);
    expect(correctSaleSchema.safeParse({ body: { ...body, items: [] }, params }).success).toBe(false);
  });
});

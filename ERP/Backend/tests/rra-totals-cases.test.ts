import { describe, expect, it } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { buildRraSendReceiptPayload, type SaleWithRelations } from '../src/services/rra-ebm.service';
import { computeFiscalTotals, bandTaxFromNet } from '../src/services/money.service';
import { bandTaxAmounts, salesBands, taxBandRows, taxGroups } from '../src/services/invoice-pdf.service';

/**
 * RRA CIS/VSDC totals — the three spec worked cases as exact-value tests,
 * plus R11 invariants, refund negation, zero-rate label behavior and the
 * per-line-cent vs band-derivation rule.
 *
 * Money math via the central money.service; wire shape via
 * buildRraSendReceiptPayload on receipt-shaped fakes (stored legs mimic the
 * DB-rounded Decimal(15,2) columns).
 */

const D = (v: number | string) => new Decimal(v);

function line(over: Record<string, unknown>) {
  return {
    productId: 1,
    quantity: 1,
    unitPrice: D(100),
    totalPrice: D(100),
    taxRate: D(0),
    taxAmount: D(0),
    taxCode: 'A',
    dcRate: D(0),
    dcAmt: D(0),
    measurementUnit: 'PCS',
    product: {
      name: 'Item',
      itemCd: 'RW2CTU0000001',
      itemClsCd: '5059690800',
      pkgUnitCd: 'CT',
      qtyUnitCd: 'U',
      packagingQty: null,
    },
    ...over,
  };
}

function sale(over: Record<string, unknown>): SaleWithRelations {
  return {
    id: 1,
    saleNumber: 'SALE-1',
    invoiceNumber: 'INV-1',
    vsdcInvcNo: 101,
    prcOrdCd: 'ABC123',
    rcptLabel: 'NS',
    createdAt: new Date('2026-10-06T10:00:00.000Z'),
    status: 'COMPLETED',
    paymentType: 'CASH',
    cashAmount: D(0),
    debtAmount: D(0),
    insuranceAmount: D(0),
    totalAmount: D(0),
    taxableAmount: D(0),
    vatAmount: D(0),
    branchId: 1,
    customer: { id: 9, name: 'Buyer', phone: '+250788000000', TIN: null, customerType: 'INDIVIDUAL' },
    user: { id: 1, name: 'Cashier' },
    saleItems: [],
    ...over,
  } as unknown as SaleWithRelations;
}

const seller = { TIN: '100000000', name: 'Seller', address: 'Kigali' };

describe('spec case (a) — NS mixed receipt with discount', () => {
  // Bread 1000.00 x1 [A]; Gouda 33600.00 x0.200 -25% [B]; gum 60.00 x5 [B].
  const lines = [
    { quantity: 1, unitPrice: 1000, discount: 0, taxCode: 'A' as const, taxRate: 0 },
    { quantity: 0.2, unitPrice: 33600, discount: 1680, taxCode: 'B' as const, taxRate: 18 },
    { quantity: 5, unitPrice: 60, discount: 0, taxCode: 'B' as const, taxRate: 18 },
  ];

  it('TOTAL 6340.00, A-EX 1000.00, B 5340.00, TAX B 814.58, ITEMS 3', () => {
    const t = computeFiscalTotals(lines, [0, 18, 0, 0]);
    expect(t.total).toBe(6340);
    expect(t.bands.A.sales).toBe(1000);
    expect(t.bands.B.sales).toBe(5340);
    expect(t.bands.B.tax).toBe(814.58);
    expect(t.totalTax).toBe(814.58);
    expect(t.totalTaxable).toBe(5525.42);
  });

  it('VSDC payload carries net bands with derived band tax (R9/R11)', () => {
    const s = sale({
      cashAmount: D(6340),
      totalAmount: D(6340),
      taxableAmount: D('5525.42'),
      vatAmount: D('814.58'),
      saleItems: [
        line({ quantity: 1, unitPrice: D(1000), totalPrice: D(1000), taxCode: 'A' }),
        line({
          quantity: 0.2, unitPrice: D(33600), totalPrice: D(5040),
          taxAmount: D('768.81'), taxCode: 'B', taxRate: D(18),
          dcRate: D(25), dcAmt: D(1680),
        }),
        line({
          quantity: 5, unitPrice: D(60), totalPrice: D(300),
          taxAmount: D('45.76'), taxCode: 'B', taxRate: D(18),
        }),
      ],
    });
    const p = buildRraSendReceiptPayload(s, seller, '01') as any;
    expect(p.totAmt).toBe(6340);
    expect(p.taxblAmtA).toBe(1000);
    expect(p.taxblAmtB).toBe(5340);
    // Band tax derived from the band NET — not summed per-line cents
    // (768.81 + 45.76 would give 814.57).
    expect(p.taxAmtB).toBe(814.58);
    expect(p.totTaxAmt).toBe(814.58);
    expect(p.totTaxblAmt).toBe(6340);
    expect(p.totItemCnt).toBe(3);
    // The discounted line rides gross with its discount leg…
    const gouda = p.itemList[1];
    expect(gouda.splyAmt).toBe(6720);
    expect(gouda.dcAmt).toBe(1680);
    expect(gouda.taxblAmt).toBe(5040);
    // …and R11 holds on the wire: TOTAL = Σ bands, TOTAL TAX = Σ band taxes.
    expect(p.totAmt).toBe(p.taxblAmtA + p.taxblAmtB + p.taxblAmtC + p.taxblAmtD);
    expect(p.totTaxAmt).toBe(p.taxAmtA + p.taxAmtB + p.taxAmtC + p.taxAmtD);
  });
});

describe('spec case (b) — NR refund, every amount negative', () => {
  // Gravel 9000.00 x5.354 -25% [B]: TOTAL -36139.50, TAX B -5512.81.
  it('money legs negate with the document', () => {
    const t = computeFiscalTotals(
      [{ quantity: -5.354, unitPrice: 9000, discount: -12046.5, taxCode: 'B', taxRate: 18 }],
      [0, 18, 0, 0],
    );
    expect(t.total).toBe(-36139.5);
    expect(t.bands.B.tax).toBe(-5512.81);
    expect(t.totalTax).toBe(-5512.81);
  });

  it('refund payload references the original and marks salesSttsCd=05', () => {
    const s = sale({
      rcptLabel: 'NR',
      status: 'REFUNDED',
      cashAmount: D('-36139.50'),
      totalAmount: D('-36139.50'),
      taxableAmount: D('-30626.69'),
      vatAmount: D('-5512.81'),
      saleItems: [
        line({
          quantity: -5.354, unitPrice: D(9000), totalPrice: D('-36139.50'),
          taxAmount: D('-5512.81'), taxCode: 'B', taxRate: D(18),
          dcRate: D(25), dcAmt: D('-12046.50'),
        }),
      ],
    });
    const p = buildRraSendReceiptPayload(
      s, seller, '01', { orgInvcNo: 77, rfdDt: new Date('2026-10-06T11:00:00.000Z'), rfdRsnCd: '01' },
    ) as any;
    // Wire policy (Q2): positive magnitudes + refund status, while receipt/DB
    // stay negative (asserted in the money-legs test above).
    expect(p.salesSttsCd).toBe('05');
    expect(p.orgInvcNo).toBe(77);
    expect(p.rfdRsnCd).toBe('01');
    expect(p.totAmt).toBe(36139.5);
    expect(p.taxblAmtB).toBe(36139.5);
    expect(p.taxAmtB).toBe(5512.81);
    expect(p.totItemCnt).toBe(1);
    expect(p.totAmt).toBe(p.taxblAmtA + p.taxblAmtB + p.taxblAmtC + p.taxblAmtD);
  });
});

describe('spec case (c) — training receipt math', () => {
  it('TOTAL 1300.00, B 300.00, TAX B 45.76', () => {
    const t = computeFiscalTotals(
      [
        { quantity: 1, unitPrice: 1000, taxCode: 'A', taxRate: 0 },
        { quantity: 5, unitPrice: 60, taxCode: 'B', taxRate: 18 },
      ],
      [0, 18, 0, 0],
    );
    expect(t.total).toBe(1300);
    expect(t.bands.B.sales).toBe(300);
    expect(t.bands.B.tax).toBe(45.76);
  });

  it('bandTaxFromNet matches the R4 sample exactly', () => {
    expect(bandTaxFromNet(5340, 18)).toBe(814.58);
    expect(bandTaxFromNet(300, 18)).toBe(45.76);
    expect(bandTaxFromNet(36139.5, 18)).toBe(5512.81);
    expect(bandTaxFromNet(1000, 0)).toBe(0);
  });
});

describe('band totals only for item tax codes in play', () => {
  const payloadOf = (items: any[], taxRates?: [number, number, number, number]) =>
    ({ items, totals: { grandTotal: 0 }, taxRates } as any);

  it('unused bands (including B) stay hidden when no items use them', () => {
    const data = payloadOf([{ taxCode: 'A', vatPct: 0, total: 1000, taxAmount: 0 }]);
    expect(salesBands(data).map((g) => g.code)).toEqual(['A']);
    expect(taxGroups(data).map((g) => g.code)).toEqual(['A']);
    expect(taxBandRows(data).map((g) => g.code)).toEqual([]);
  });

  it('only bands present on line items print, even if another rate is programmed', () => {
    const data = payloadOf([{ taxCode: 'B', vatPct: 18, total: 100, taxAmount: 15.25 }], [0, 18, 5, 0]);
    expect(salesBands(data).map((g) => g.code)).toEqual(['B']);
    expect(taxBandRows(data).map((g) => g.code)).toEqual(['B']);
    expect(salesBands(data).map((g) => g.code)).not.toContain('C');
    expect(salesBands(data).map((g) => g.code)).not.toContain('D');
  });

  it('bandTaxAmounts derives from nets, not from per-line cents', () => {
    const out = bandTaxAmounts(
      [
        { total: 5040, taxCode: 'B', vatPct: 18, taxAmount: 768.81 },
        { total: 300, taxCode: 'B', vatPct: 18, taxAmount: 45.76 },
      ],
      [0, 18, 0, 0],
    );
    expect(out.B).toBe(814.58);
  });
});

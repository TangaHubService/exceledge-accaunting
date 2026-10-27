import { describe, expect, it } from 'vitest';
import {
  aggregateSalesLegs,
  splitReportSales,
} from '../src/services/daily-report-aggregate.service';

/**
 * X/Z report totals against a set of sample receipts (R10/R11):
 * bucketing (NS/NR vs training/proforma/incomplete/copies) plus the
 * sales-vs-refund splits, per-rate legs, per-method legs and main groups.
 */

function item(over: Record<string, unknown> = {}) {
  return { taxCode: 'B', taxAmount: 180, totalPrice: 1180, dcAmt: 0, product: { category: 'Dairy' }, ...over };
}

function receipt(over: Record<string, unknown> = {}) {
  return {
    status: 'COMPLETED',
    isProforma: false,
    rcptLabel: 'NS',
    reprintCount: 0,
    paymentType: 'CASH',
    totalAmount: 1180,
    saleItems: [item()],
    ...over,
  };
}

describe('splitReportSales — receipt bucketing', () => {
  const sales = [
    receipt({}), // NS
    receipt({ status: 'REFUNDED', rcptLabel: 'NR', totalAmount: -1180, saleItems: [item({ taxAmount: -180, totalPrice: -1180 })] }),
    receipt({ status: 'REFUNDED', rcptLabel: 'NS', totalAmount: 1180 }), // refunded ORIGINAL stays an NS sale
    receipt({ rcptLabel: 'TS' }), // training sale
    receipt({ status: 'REFUNDED', rcptLabel: 'TR' }), // training refund
    receipt({ isProforma: true, rcptLabel: 'PS' }), // proforma
    receipt({ status: 'CANCELLED' }), // void
    receipt({ status: 'DRAFT' }), // incomplete
    receipt({ reprintCount: 2 }), // copy of an NS
  ];

  it('routes every receipt type to its bucket', () => {
    const split = splitReportSales(sales);
    expect(split.normalSales).toHaveLength(3); // NS + refunded original + copy (copies stay counted, tracked separately)
    expect(split.normalRefunds).toHaveLength(1); // the NR row only — never the refunded original
    expect(split.trainingSales).toHaveLength(2);
    expect(split.proformaSales).toHaveLength(1);
    expect(split.copiedSales).toHaveLength(1);
    expect(split.incompleteDrafts).toBe(1);
  });

  it('never double-counts a refunded original in both buckets', () => {
    const original = receipt({ status: 'REFUNDED', rcptLabel: 'NS', totalAmount: 1180 });
    const refund = receipt({ status: 'REFUNDED', rcptLabel: 'NR', totalAmount: -1180 });
    const split = splitReportSales([original, refund]);
    expect(split.normalSales).toHaveLength(1);
    expect(split.normalRefunds).toHaveLength(1);
    const legs = aggregateSalesLegs(split.normalSales as any, split.normalRefunds as any, [0, 18, 0, 0]);
    expect(legs.grossSalesAmt).toBe(1180);
    expect(legs.grossRefundAmt).toBe(1180);
    expect(legs.netSalesAmt).toBe(0);
  });

  it('first download (reprintCount 1) is still the original, not a copy', () => {
    // Receipt semantics: only reprintCount > 1 renders COPY (composeInvoicePayload
    // isCopy); the X/Z copy bucket must use the same threshold.
    expect(splitReportSales([receipt({ reprintCount: 1 })]).copiedSales).toHaveLength(0);
    expect(splitReportSales([receipt({ reprintCount: 2 })]).copiedSales).toHaveLength(1);
  });
});

describe('aggregateSalesLegs — splits and reconciliation', () => {
  const normalSales = [
    receipt({ paymentType: 'CASH', totalAmount: 6340, saleItems: [
      item({ taxCode: 'A', taxAmount: 0, totalPrice: 1000, product: { category: 'Bakery' } }),
      item({ taxCode: 'B', taxAmount: 768.81, totalPrice: 5040, dcAmt: 1680, product: { category: 'Dairy' } }),
      item({ taxCode: 'B', taxAmount: 45.76, totalPrice: 300, product: { category: 'Dairy' } }),
    ] }),
    receipt({ paymentType: 'MTN_MOMO', totalAmount: 1180, saleItems: [item({ product: { category: 'Dairy' } })] }),
  ];
  const normalRefunds = [
    receipt({ paymentType: 'CASH', totalAmount: -1180, saleItems: [item({ taxAmount: -180, totalPrice: -1180, product: { category: 'Dairy' } })] }),
  ];

  it('headline totals reconcile: net = gross sales - gross refunds', () => {
    const legs = aggregateSalesLegs(normalSales, normalRefunds, [0, 18, 0, 0]);
    expect(legs.grossSalesAmt).toBe(7520);
    expect(legs.grossRefundAmt).toBe(1180);
    expect(legs.netSalesAmt).toBe(6340);
  });

  it('per-rate legs derive from band nets and reconcile (R11)', () => {
    const legs = aggregateSalesLegs(normalSales, normalRefunds, [0, 18, 0, 0]);
    // B net = 5040 + 300 + 1180 = 6520 → tax 6520 - 6520/1.18 = 994.58.
    expect(legs.taxBands.B.salesAmt).toBe(6520);
    expect(legs.taxBands.B.taxAmt).toBe(994.58);
    expect(legs.taxBands.A.salesAmt).toBe(1000);
    expect(legs.totalTaxAmt).toBe(994.58);
    // Refund legs stay signed and separate.
    expect(legs.refundBands.B.salesAmt).toBe(-1180);
    expect(legs.refundBands.B.taxAmt).toBe(-180);
    // net tax = sales tax + refund tax.
    expect(legs.totalTaxAmt + legs.refundBands.B.taxAmt).toBe(814.58);
  });

  it('payment and group splits separate sales from refunds', () => {
    const legs = aggregateSalesLegs(normalSales, normalRefunds, [0, 18, 0, 0]);
    expect(legs.paymentTotals).toEqual({ CASH: 6340, MTN_MOMO: 1180 });
    expect(legs.refundPaymentTotals).toEqual({ CASH: -1180 });
    expect(legs.groupTotals.Bakery).toEqual({ salesAmt: 1000, refundAmt: 0, itemCount: 1 });
    expect(legs.groupTotals.Dairy.salesAmt).toBe(5340 + 1180);
    expect(legs.groupTotals.Dairy.refundAmt).toBe(-1180);
    expect(legs.discountTotal).toBe(1680);
  });
});

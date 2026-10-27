import { describe, expect, it } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { computeFiscalLine, computeFiscalTotals, diff2, round2 } from '../src/services/money.service';

describe('central money module — rounding policy (exact per line, round once per rate)', () => {
  it('round2 is half-up on exact decimals (2.675 -> 2.68, no float error)', () => {
    expect(round2('2.675')).toBe(2.68);
    expect(round2('2.674')).toBe(2.67);
    expect(round2(0)).toBe(0);
  });

  it('diff2 subtracts exactly through floats (10.03 - 0.07 = 9.96)', () => {
    expect(diff2(10.03, 0.07)).toBe(9.96);
    expect(diff2(6720, 1680)).toBe(5040);
  });

  it('extracts inclusive tax: 5340 @18% -> tax 814.58, taxable 4525.42', () => {
    const r = computeFiscalLine({ quantity: 1, unitPrice: 5340, taxCode: 'B', taxRate: 18 });
    expect(round2(r.tax)).toBe(814.58);
    expect(round2(r.taxable)).toBe(4525.42);
    expect(round2(r.net)).toBe(5340);
  });

  it('discounted amount enters the totals: 33600 x0.200 -25% -> net 5040', () => {
    const r = computeFiscalLine({ quantity: 0.2, unitPrice: 33600, discount: 1680, taxCode: 'B', taxRate: 18 });
    expect(r.gross.toString()).toBe('6720');
    expect(r.net.toString()).toBe('5040');
    expect(round2(r.tax)).toBe(768.81);
  });

  it('exempt lines carry zero tax and keep their full amount as taxable', () => {
    const r = computeFiscalLine({ quantity: 1, unitPrice: 1000, taxCode: 'A', taxRate: 0 });
    expect(round2(r.tax)).toBe(0);
    expect(round2(r.taxable)).toBe(1000);
  });

  it('fractional quantities work exactly: 9000 x5.354 -25% -> net 36139.50', () => {
    const r = computeFiscalLine({ quantity: 5.354, unitPrice: 9000, discount: 12046.5, taxCode: 'B', taxRate: 18 });
    expect(r.gross.toString()).toBe('48186');
    expect(r.net.toString()).toBe('36139.5');
    expect(round2(r.tax)).toBe(5512.81);
  });

  it('per-line exactness beats per-line rounding: three 100/3 lines @18% sum exactly', () => {
    const lines = [0, 1, 2].map(() => ({ quantity: 1, unitPrice: '100', discount: '66.67', taxCode: 'B' as const, taxRate: 18 }));
    const t = computeFiscalTotals(lines, [0, 18, 0, 0]);
    // net per line = 33.33 exact (100-66.67); band sales rounded once = 99.99
    expect(t.bands.B.sales).toBe(99.99);
    expect(t.total).toBe(99.99);
    expect(t.totalTax).toBe(t.bands.B.tax);
  });

  it('R11 holds by construction: TOTAL = sum of bands, TOTAL TAX = sum of band taxes', () => {
    const t = computeFiscalTotals(
      [
        { quantity: 1, unitPrice: 1000, taxCode: 'A', taxRate: 0 },
        { quantity: 0.2, unitPrice: 33600, discount: 1680, taxCode: 'B', taxRate: 18 },
        { quantity: 5, unitPrice: 60, taxCode: 'B', taxRate: 18 },
      ],
      [0, 18, 0, 0],
    );
    expect(t.bands.A.sales).toBe(1000);
    expect(t.bands.B.sales).toBe(5340);
    expect(t.total).toBe(6340);
    expect(t.bands.B.tax).toBe(814.58);
    expect(t.totalTax).toBe(814.58);
    expect(new Decimal(t.totalTax).equals(new Decimal(t.bands.A.tax).plus(t.bands.B.tax).plus(t.bands.C.tax).plus(t.bands.D.tax))).toBe(true);
  });
});

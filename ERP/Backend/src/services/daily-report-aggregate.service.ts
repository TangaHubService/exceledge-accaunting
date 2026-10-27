import { Decimal } from '@prisma/client/runtime/library';
import { bandTaxFromNet } from './money.service';

/**
 * Pure aggregation of receipt legs for the X/Z daily report (R10/R11).
 *
 * Extracted from buildDailyReport so the money math over a set of sample
 * receipts is unit-testable without a database. Inputs are structural —
 * Prisma rows satisfy them directly (Decimal legs are coerced with Number()).
 *
 * Conventions (kept identical to the controller's historical behavior):
 *  - sales legs accumulate raw; refund legs accumulate SIGNED (negative) and
 *    are reported in separate `refund*` splits;
 *  - headline `grossRefundAmt` stays a positive magnitude (unchanged);
 *  - each receipt's band tax derives from the receipt's band NET
 *    (money.service policy — identical to its printed receipt), then sums
 *    across receipts, so R11 holds literally: report = sum of receipts;
 *  - every other accumulation rounds half-up to 2 dp per addition (fix2).
 */

export interface ReportSaleItemLeg {
  taxCode?: string | null;
  taxAmount: unknown;
  totalPrice: unknown;
  dcAmt?: unknown;
  product?: { category?: string | null } | null;
}

export interface ReportSaleLeg {
  paymentType: string;
  totalAmount: unknown;
  saleItems: ReportSaleItemLeg[];
}

export interface ReportBandLeg {
  taxableAmt: number;
  taxAmt: number;
  salesAmt: number;
}

export interface ReportGroupLeg {
  salesAmt: number;
  refundAmt: number;
  itemCount: number;
}

export interface AggregatedSalesLegs {
  taxBands: Record<string, ReportBandLeg>;
  refundBands: Record<string, ReportBandLeg>;
  groupTotals: Record<string, ReportGroupLeg>;
  paymentTotals: Record<string, number>;
  refundPaymentTotals: Record<string, number>;
  grossSalesAmt: number;
  grossRefundAmt: number;
  netSalesAmt: number;
  totalTaxAmt: number;
  discountTotal: number;
}

const BAND_CODES = ['A', 'B', 'C', 'D', 'E'];

function fix2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyBands(): Record<string, ReportBandLeg> {
  const bands: Record<string, ReportBandLeg> = {};
  for (const code of BAND_CODES) bands[code] = { taxableAmt: 0, taxAmt: 0, salesAmt: 0 };
  return bands;
}

const KNOWN_BAND_RATES = ['A', 'B', 'C', 'D'];

/**
 * Add ONE receipt's legs to the report bands. The receipt's band tax is
 * derived from the receipt's band NET (money.service policy — matches the
 * printed receipt and the VSDC payload for that receipt), then summed across
 * receipts, so R11 holds literally: report = sum of its receipts.
 * Non-A/B/C/D codes (no programmed rate) fall back to summed line taxes.
 */
function addReceiptBands(
  bands: Record<string, ReportBandLeg>,
  sale: ReportSaleLeg,
  bandRates: [number, number, number, number],
): void {
  const nets: Record<string, Decimal> = {};
  const lineTaxSums: Record<string, number> = {};
  for (const si of sale.saleItems) {
    const code = (si.taxCode ?? 'A').toUpperCase();
    // Exact per-leg accumulation (each 2 dp leg string-normalized) so float
    // dust can never reach the receipt's band derivation.
    nets[code] = (nets[code] ?? new Decimal(0)).plus(new Decimal(String(Number(si.totalPrice))));
    lineTaxSums[code] = (lineTaxSums[code] ?? 0) + Number(si.taxAmount);
  }
  for (const code of Object.keys(nets)) {
    if (!bands[code]) bands[code] = { taxableAmt: 0, taxAmt: 0, salesAmt: 0 };
    const net = nets[code];
    const slot = KNOWN_BAND_RATES.indexOf(code);
    const derived =
      slot >= 0 && bandRates[slot] > 0 ? bandTaxFromNet(net, bandRates[slot]) : fix2(lineTaxSums[code]);
    bands[code].salesAmt = fix2(bands[code].salesAmt + net.toNumber());
    bands[code].taxAmt = fix2(bands[code].taxAmt + derived);
    bands[code].taxableAmt = fix2(bands[code].salesAmt - bands[code].taxAmt);
  }
}

export function aggregateSalesLegs(
  normalSales: ReportSaleLeg[],
  normalRefunds: ReportSaleLeg[],
  bandRates: [number, number, number, number] = [0, 18, 0, 0],
): AggregatedSalesLegs {
  const taxBands = emptyBands();
  for (const sale of normalSales) addReceiptBands(taxBands, sale, bandRates);

  const refundBands = emptyBands();
  for (const sale of normalRefunds) addReceiptBands(refundBands, sale, bandRates);

  const groupTotals: Record<string, ReportGroupLeg> = {};
  const groupOf = (name: unknown) => {
    const key = String(name ?? '').trim() || 'Uncategorized';
    return groupTotals[key] ?? (groupTotals[key] = { salesAmt: 0, refundAmt: 0, itemCount: 0 });
  };
  for (const sale of normalSales) {
    for (const si of sale.saleItems) {
      const g = groupOf((si as ReportSaleItemLeg).product?.category);
      g.salesAmt = fix2(g.salesAmt + Number(si.totalPrice));
      g.itemCount += 1;
    }
  }
  for (const sale of normalRefunds) {
    for (const si of sale.saleItems) {
      const g = groupOf((si as ReportSaleItemLeg).product?.category);
      g.refundAmt = fix2(g.refundAmt + Number(si.totalPrice));
      g.itemCount += 1;
    }
  }

  const paymentTotals: Record<string, number> = {};
  for (const sale of normalSales) {
    paymentTotals[sale.paymentType] = fix2((paymentTotals[sale.paymentType] ?? 0) + Number(sale.totalAmount));
  }

  const refundPaymentTotals: Record<string, number> = {};
  for (const sale of normalRefunds) {
    refundPaymentTotals[sale.paymentType] = fix2((refundPaymentTotals[sale.paymentType] ?? 0) + Number(sale.totalAmount));
  }

  const grossSalesAmt = fix2(normalSales.reduce((s, sale) => s + Number(sale.totalAmount), 0));
  const grossRefundAmt = fix2(normalRefunds.reduce((s, sale) => s + Math.abs(Number(sale.totalAmount)), 0));
  const netSalesAmt = fix2(grossSalesAmt - grossRefundAmt);
  const totalTaxAmt = fix2(Object.values(taxBands).reduce((s, b) => s + b.taxAmt, 0));
  const discountTotal = fix2(
    normalSales.reduce(
      (s, sale) => s + sale.saleItems.reduce((a, si) => a + Math.abs(Number((si as ReportSaleItemLeg).dcAmt ?? 0)), 0),
      0,
    ),
  );

  return {
    taxBands,
    refundBands,
    groupTotals,
    paymentTotals,
    refundPaymentTotals,
    grossSalesAmt,
    grossRefundAmt,
    netSalesAmt,
    totalTaxAmt,
    discountTotal,
  };
}

export interface ReportSaleBucket {
  status: string;
  isProforma?: boolean;
  rcptLabel?: string | null;
  reprintCount?: number | null;
  paymentType: string;
  totalAmount: unknown;
  saleItems: ReportSaleItemLeg[];
}

export interface SplitReportSales {
  fiscalSales: ReportSaleBucket[];
  normalSales: ReportSaleBucket[];
  normalRefunds: ReportSaleBucket[];
  trainingSales: ReportSaleBucket[];
  proformaSales: ReportSaleBucket[];
  copiedSales: ReportSaleBucket[];
  incompleteDrafts: number;
}

/**
 * Bucket receipts the way buildDailyReport does.
 *
 * Bucketing is by RECEIPT TYPE (rcptLabel), not by row status: refunding an
 * original flips the original's status to REFUNDED but it REMAINS an NS
 * receipt (its label never changes), while the refund itself is the NR
 * receipt. Bucketing by status would count the original's positive legs in
 * the refund buckets a second time (double-count: grossRefund = 2x, net
 * goes wrong). So:
 *  - NS sales (COMPLETED originals AND REFUNDED originals) -> normalSales;
 *  - NR rows (status REFUNDED, label NR or legacy null) -> normalRefunds.
 * TS/TR (training) are excluded from legal totals, proforma (PS) and
 * incomplete (DRAFT/PENDING) are reported separately, copies are tracked via
 * reprintCount rather than as fiscal records.
 */
export function splitReportSales(sales: ReportSaleBucket[]): SplitReportSales {
  const fiscalSales = sales.filter((s) => s.status === 'COMPLETED' || s.status === 'REFUNDED');
  const isExcludedLabel = (s: ReportSaleBucket) =>
    s.rcptLabel === 'TR' || s.rcptLabel === 'TS' || s.rcptLabel === 'PS';
  const normalSales = fiscalSales.filter(
    (s) =>
      (s.status === 'COMPLETED' && !s.isProforma && !isExcludedLabel(s)) ||
      // A refunded ORIGINAL keeps its NS label: it stays an NS sale. (Legacy
      // null-label REFUNDED rows stay refunds-only, as before.)
      (s.status === 'REFUNDED' && s.rcptLabel === 'NS' && !s.isProforma),
  );
  const normalRefunds = fiscalSales.filter(
    (s) => s.status === 'REFUNDED' && s.rcptLabel !== 'TR' && s.rcptLabel !== 'TS' && s.rcptLabel !== 'NS',
  );
  const trainingSales = fiscalSales.filter((s) => s.rcptLabel === 'TS' || s.rcptLabel === 'TR');
  const proformaSales = sales.filter((s) => s.isProforma || s.rcptLabel === 'PS');
  // Copies are tracked via reprintCount rather than as fiscal records. The
  // threshold is > 1, matching receipt semantics: the first download
  // (reprintCount reaches 1) is still the original; only later downloads
  // render as COPY (see composeInvoicePayload isCopy).
  const copiedSales = fiscalSales.filter((s) => (s.reprintCount ?? 0) > 1);
  const incompleteDrafts = sales.filter((s) => s.status === 'DRAFT' || s.status === 'PENDING').length;
  return { fiscalSales, normalSales, normalRefunds, trainingSales, proformaSales, copiedSales, incompleteDrafts };
}

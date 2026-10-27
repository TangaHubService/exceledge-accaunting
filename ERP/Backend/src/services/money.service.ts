import { Decimal } from '@prisma/client/runtime/library';

/**
 * Central money + tax arithmetic for RRA CIS/VSDC totals (spec §R4/R11).
 *
 * Every receipt, VSDC payload and fiscal report MUST derive its amounts from
 * this module so the three can never disagree. Policy (chosen for R11):
 *
 *  1. Prices are tax-INCLUSIVE. Tax is extracted, never added on top:
 *       tax     = net − net / (1 + rate/100)
 *       taxable = net − tax
 *     where net = qty × unitPrice − discount (the DISCOUNTED amount is what
 *     goes into the totals).
 *  2. Exactness first: per-line math stays in exact `Decimal` arithmetic.
 *     Rounding (half-up, 2 dp) happens ONCE per tax-rate bucket and once for
 *     the receipt totals — never per line — so rounding drift cannot break
 *     the R11 invariants.
 *  3. Receipt totals are DEFINED as the sum of the rounded bands, so these
 *     hold by construction:
 *       TOTAL      = Σ band sales (incl. exempt)
 *       TOTAL TAX  = Σ band taxes
 *
 * Input price contract: `unitPrice` is the LIST (pre-discount) unit price and
 * `discount` the absolute tax-inclusive line discount. Callers that already
 * hold post-discount (charged) prices pass `discount: 0`. The POS sends
 * charged prices + a separate discount; `commitSale` reconstructs the list
 * price for storage while tax stays computed on the charged (net) leg.
 */

export type FiscalBandCode = 'A' | 'B' | 'C' | 'D';

export const FISCAL_BAND_CODES: readonly FiscalBandCode[] = ['A', 'B', 'C', 'D'];

export type MoneyInput = number | string | Decimal;

export interface FiscalLineInput {
  /** Fractional quantities allowed (kg, litres…) — Decimal(15,3) in storage. */
  quantity: MoneyInput;
  /** LIST unit price, tax-inclusive, pre-discount. */
  unitPrice: MoneyInput;
  /** Absolute tax-inclusive line discount. Defaults to 0 (already-charged prices). */
  discount?: MoneyInput;
  taxCode: FiscalBandCode;
  /** Percent, e.g. 18 for 18%. Non-positive rates carry zero tax. */
  taxRate: MoneyInput;
}

export interface FiscalLineResult {
  /** qty × unitPrice, exact. */
  gross: Decimal;
  /** gross − discount, exact — the amount that enters the totals. */
  net: Decimal;
  /** net − tax, exact. */
  taxable: Decimal;
  /** net × rate/(100+rate) extracted from the inclusive net, exact. */
  tax: Decimal;
  taxCode: FiscalBandCode;
  rate: Decimal;
}

export interface FiscalBandResult {
  code: FiscalBandCode;
  /** Statutory rate for the band (percent). Informational — not derived. */
  rate: number;
  /** Rounded band sales (incl. tax). */
  sales: number;
  /** Rounded band taxable amount. */
  taxable: number;
  /** Rounded band tax amount. */
  tax: number;
}

export interface FiscalTotalsResult {
  bands: Record<FiscalBandCode, FiscalBandResult>;
  /** Σ rounded band sales — the TOTAL to print and submit. */
  total: number;
  /** Σ rounded band taxable amounts. */
  totalTaxable: number;
  /** Σ rounded band taxes — the TOTAL TAX to print and submit. */
  totalTax: number;
}

function toDecimal(value: MoneyInput | undefined | null, fallback = 0): Decimal {
  if (value === undefined || value === null) return new Decimal(fallback);
  if (value instanceof Decimal) return value;
  // Through the shortest string form so binary-float inputs (0.2, 10.03)
  // enter the arithmetic exactly instead of carrying float residue that
  // could flip a half-cent boundary at rounding time.
  return typeof value === 'number' ? new Decimal(String(value)) : new Decimal(value);
}

/** Round half-up to 2 decimals, returned as a JS number (e.g. 814.58). */
export function round2(value: MoneyInput): number {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Exact difference of two money numbers, rounded half-up to 2 dp.
 * Converts through the shortest string form first so binary-float inputs
 * like 10.03 - 0.07 come out as exactly 9.96.
 */
export function diff2(a: MoneyInput, b: MoneyInput): number {
  const d = new Decimal(String(a)).minus(new Decimal(String(b)));
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Band-level tax for a rounded band NET and a percent rate, rounded half-up
 * once (policy ii). This is the R4 sample formula: 5340.00 x 18/118 = 814.58.
 *
 * A band's tax is ALWAYS derived this way — never summed from per-line
 * taxes. Per-line taxes are already rounded to cents by the Decimal(15,2)
 * storage columns, so summing them can land a cent away from the exact
 * band value (768.81 + 45.76 = 814.57 vs the exact 814.58). Receipts, VSDC
 * bands, Sale legs and reports all use this derivation and therefore agree.
 */
export function bandTaxFromNet(net: MoneyInput, ratePercent: MoneyInput): number {
  const n = toDecimal(net);
  const rate = toDecimal(ratePercent);
  if (rate.lte(0)) return 0;
  const divisor = new Decimal(1).plus(rate.div(100));
  const tax = n.minus(n.div(divisor));
  return tax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function computeFiscalLine(line: FiscalLineInput): FiscalLineResult {
  const qty = toDecimal(line.quantity);
  const price = toDecimal(line.unitPrice);
  // No sign clamp: refund legs carry negative gross AND negative discount
  // (mirrored storage), so net = gross − discount stays correct for both
  // signs. Input policing (discount ≥ 0 on sales) belongs to validation.
  const discount = toDecimal(line.discount, 0);
  const rate = toDecimal(line.taxRate, 0);

  const gross = qty.mul(price);
  const net = gross.minus(discount);
  let taxable = net;
  let tax = new Decimal(0);
  if (rate.gt(0)) {
    const divisor = new Decimal(1).plus(rate.div(100));
    taxable = net.div(divisor);
    tax = net.minus(taxable);
  }
  return { gross, net, taxable, tax, taxCode: line.taxCode, rate };
}

const BAND_INDEX: Record<FiscalBandCode, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Aggregate exact per-line results into rounded per-rate bands.
 * `bandRates` carries the statutory percent per slot (informational only).
 */
export function computeFiscalTotals(
  lines: FiscalLineInput[],
  bandRates: [number, number, number, number] = [0, 18, 0, 0],
): FiscalTotalsResult {
  const exact: Array<{ sales: Decimal; taxable: Decimal; tax: Decimal }> = FISCAL_BAND_CODES.map(() => ({
    sales: new Decimal(0),
    taxable: new Decimal(0),
    tax: new Decimal(0),
  }));

  for (const line of lines) {
    const r = computeFiscalLine(line);
    const slot = exact[BAND_INDEX[r.taxCode]];
    slot.sales = slot.sales.plus(r.net);
    slot.taxable = slot.taxable.plus(r.taxable);
    slot.tax = slot.tax.plus(r.tax);
  }

  const bands = Object.fromEntries(
    FISCAL_BAND_CODES.map((code, i) => [
      code,
      {
        code,
        rate: bandRates[i],
        sales: round2(exact[i].sales),
        taxable: round2(exact[i].taxable),
        tax: round2(exact[i].tax),
      } as FiscalBandResult,
    ]),
  ) as FiscalTotalsResult['bands'];

  // Totals are the sum of the ROUNDED bands, so R11 holds by construction.
  const total = round2(FISCAL_BAND_CODES.reduce((s, c) => s + bands[c].sales, 0));
  const totalTaxable = round2(FISCAL_BAND_CODES.reduce((s, c) => s + bands[c].taxable, 0));
  const totalTax = round2(FISCAL_BAND_CODES.reduce((s, c) => s + bands[c].tax, 0));

  return { bands, total, totalTaxable, totalTax };
}

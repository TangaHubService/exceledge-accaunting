import { round2 } from './money.service';

/**
 * Pure Normal Refund (NR) calculation + eligibility rules.
 *
 * Everything here is intentionally free of Prisma/Express so the refund math
 * and business rules (spec Art. 7.17, 12) are unit-testable without a DB:
 *  - remaining refundable quantity per original line (partial refunds)
 *  - negated refund legs scaled from the original lines (never "positive
 *    legs with a negative total")
 *  - original-receipt eligibility (NS only — never NR/copy/training/proforma)
 *  - refund-reason/justification requirements
 *
 * Money arrives as plain numbers (the controller normalizes Decimals before
 * calling in); every monetary leg is rounded once with round2.
 */

export interface OriginalRefundLine {
  saleItemId: number;
  productId: number | null;
  serviceName: string | null;
  serviceDescription: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  taxAmount: number;
  taxCode: string | null;
  dcRate: number;
  dcAmt: number;
  measurementUnit: string;
  itemType: string;
}

export interface PriorRefundLeg {
  productId: number | null;
  serviceName: string | null;
  /** Absolute refunded quantity (refund rows store negatives — pass abs). */
  absQuantity: number;
}

export interface RequestedRefundLine {
  saleItemId: number;
  quantity: number;
}

export interface PlannedRefundLine {
  saleItemId: number;
  productId: number | null;
  serviceName: string | null;
  serviceDescription: string | null;
  /** Negated refunded quantity. */
  quantity: number;
  /** Unit price stays positive — qty × unitPrice yields the negative total. */
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  taxAmount: number;
  taxCode: string | null;
  dcRate: number;
  dcAmt: number;
  measurementUnit: string;
  itemType: string;
}

export interface RefundTotals {
  /** Positive magnitudes (amounts to return). The stored sale negates them. */
  totalRefundAmount: number;
  totalRefundVat: number;
  totalRefundTaxable: number;
  bands: Record<string, { net: number; tax: number }>;
}

/** Thrown for refund business-rule violations; the controller maps it to HTTP. */
export class RefundRuleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RefundRuleError';
    this.status = status;
  }
}

/**
 * Identity of a refundable line. productId when present, otherwise the
 * service name (ad-hoc service lines have no product). Two original lines
 * for the same product share a key — remaining is tracked per key so split
 * lines can never jointly exceed what was sold.
 */
export function refundLineKey(line: { productId: number | null; serviceName: string | null }): string {
  if (line.productId != null) return `P:${line.productId}`;
  return `S:${(line.serviceName ?? '').trim().toLowerCase() || '?'}`;
}

/**
 * Guard an original sale before any refund math. Throws RefundRuleError when
 * the receipt may not be refunded:
 *  - nonexistent / wrong status (only COMPLETED or PARTIALLY_REFUNDED)
 *  - itself a refund (NR — originalSaleId set) or any non-NS label
 *    (NR/TR/CR/TS/PS/CS) — legacy rows with no label are treated as NS
 *  - proforma (quotes are edited/converted, never refunded)
 *  - no VSDC invoice number (nothing was ever fiscalized under it, so no
 *    orgInvcNo could reference it)
 *
 * Training mode: only a Training Sale (TS) is refundable (as TR), and a TS
 * only while training mode is on — a real NS can never be refunded from a
 * training session, nor a TS from normal mode.
 */
export function assertOriginalRefundable(sale: {
  id: number;
  status: string;
  rcptLabel: string | null;
  isProforma: boolean;
  originalSaleId: number | null;
  vsdcInvcNo: number | null;
}, opts: { trainingMode?: boolean } = {}): void {
  if (sale.isProforma) {
    throw new RefundRuleError(400, 'A proforma is a quote, not a fiscal receipt — it cannot be refunded');
  }
  if (sale.originalSaleId != null) {
    throw new RefundRuleError(400, 'Cannot refund a refund — an NR/TR receipt can never be the source of another refund');
  }
  const label = sale.rcptLabel ?? 'NS';
  if (opts.trainingMode) {
    if (label === 'NS') {
      throw new RefundRuleError(
        409,
        'Training mode is on — a Normal Sale (NS) cannot be refunded from a training session. Turn training mode off to issue a real NR.',
      );
    }
    if (label !== 'TS') {
      throw new RefundRuleError(400, `Only a Training Sale (TS) receipt can be refunded in training mode — this is a ${label} receipt`);
    }
  } else {
    if (label === 'TS') {
      throw new RefundRuleError(
        409,
        'This is a Training Sale (TS) — it can only be refunded (as TR) while training mode is on',
      );
    }
    if (label !== 'NS') {
      throw new RefundRuleError(
        400,
        `Only a Normal Sale (NS) receipt can be refunded — this is a ${label} receipt`,
      );
    }
  }
  if (sale.status === 'REFUNDED') {
    throw new RefundRuleError(400, 'Sale already refunded');
  }
  if (sale.status === 'CANCELLED') {
    throw new RefundRuleError(400, 'Cannot refund a cancelled sale');
  }
  if (sale.status !== 'COMPLETED' && sale.status !== 'PARTIALLY_REFUNDED') {
    throw new RefundRuleError(400, `Only a completed sale can be refunded (status is ${sale.status})`);
  }
  if (sale.vsdcInvcNo == null) {
    throw new RefundRuleError(
      400,
      'This sale was never assigned a VSDC invoice number, so no refund can reference it (orgInvcNo)',
    );
  }
}

/**
 * The original NS must already carry a real VSDC confirmation. An allocated
 * `vsdcInvcNo` is only the CIS sequence — it is not a receipt. Refunding
 * before that confirmation dead-letters the original sale (the worker refuses
 * to submit a SALE once its status is REFUNDED) and leaves the NR with nothing
 * to reference, so no signed refund receipt is ever issued.
 *
 * `training`: a TS is confirmed by VSDC without intrlData/rcptSign (CIS §6),
 * so only those two are not required — the VSDC counter, SDC ID and VSDC
 * timestamp still are.
 */
export function assertOriginalConfirmed(conf: {
  submissionStatus: string | null;
  rcptNo: string | number | null;
  internalData: string | null;
  receiptSignature: string | null;
  sdcId: string | null;
  publishedAt: string | Date | null;
} | null | undefined, opts: { training?: boolean } = {}): void {
  const [origName, refundLabel] = opts.training ? ['Training Sale', 'TR'] : ['Normal Sale', 'NR'];
  if (!conf || conf.submissionStatus !== 'SUCCESS') {
    throw new RefundRuleError(
      409,
      `The original ${origName} has not been confirmed by VSDC — a ${refundLabel} receipt cannot be issued until that confirmation exists`,
    );
  }
  const rcpt = conf.rcptNo == null ? '' : String(conf.rcptNo).trim();
  const missing: string[] = [];
  if (!/^\d+$/.test(rcpt) || Number(rcpt) <= 0) missing.push('rcptNo');
  if (!opts.training && !String(conf.internalData ?? '').trim()) missing.push('intrlData');
  if (!opts.training && !String(conf.receiptSignature ?? '').trim()) missing.push('rcptSign');
  if (!String(conf.sdcId ?? '').trim()) missing.push('sdcId');
  if (conf.publishedAt == null || String(conf.publishedAt).trim() === '') missing.push('vsdcRcptPbctDate');
  if (missing.length) {
    throw new RefundRuleError(
      409,
      `The original ${origName} is missing VSDC receipt fields (${missing.join(', ')}) — a ${refundLabel} cannot reference it`,
    );
  }
}

/**
 * Printed REF. NORMAL RECEIPT# of a refund: the original sale's invoice number
 * (`orgInvcNo`, e.g. `149`), the same value the VSDC prints on its own NR —
 * not the original's SDC `rcptNo` and not the "n/m NS" counter pair.
 */
export function formatOriginalReceiptReference(originalInvcNo: number | null | undefined): string | null {
  return typeof originalInvcNo === 'number' && Number.isInteger(originalInvcNo) && originalInvcNo > 0
    ? String(originalInvcNo)
    : null;
}

/**
 * VSDC API v1.0.5 `TrnsSalesSaveWrReq` shape for a Normal Refund.
 *
 * The sandbox rejects a negative supply amount with resultCd 910, so the wire
 * document is a fresh positive sales transaction (`salesTyCd=N`, `rcptTyCd=R`,
 * `salesSttsCd=05`) whose magnitudes are only the refunded lines. The CIS
 * receipt and the stored sale keep those same amounts negative. `orgInvcNo` is
 * the original NS `invcNo`, never the SDC receipt counter and never 0.
 *
 * `training`: a TR is the same document with `salesTyCd=T`, referencing the
 * original TS `invcNo`.
 */
export function assertNrWirePayload(payload: Record<string, unknown>, opts: { training?: boolean } = {}): void {
  const errors: string[] = [];
  const str = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : '');
  const expectedSalesTyCd = opts.training ? 'T' : 'N';
  const docLabel = opts.training ? 'TR' : 'NR';
  if (payload.salesTyCd !== expectedSalesTyCd) errors.push(`salesTyCd must be ${expectedSalesTyCd}`);
  if (payload.rcptTyCd !== 'R') errors.push('rcptTyCd must be R (refund after sale)');
  if (payload.salesSttsCd !== '05') errors.push('salesSttsCd must be 05 (refunded)');
  if (typeof payload.invcNo !== 'number' || !Number.isInteger(payload.invcNo) || payload.invcNo <= 0) {
    errors.push('invcNo must be a positive integer');
  }
  if (typeof payload.orgInvcNo !== 'number' || !Number.isInteger(payload.orgInvcNo) || payload.orgInvcNo <= 0) {
    errors.push(`orgInvcNo must be the original ${opts.training ? 'TS' : 'NS'} invoice number (positive integer, never 0)`);
  } else if (payload.orgInvcNo === payload.invcNo) {
    errors.push('orgInvcNo must reference the original sale, not this refund invoice');
  }
  if (!/^\d{2}$/.test(str('rfdRsnCd'))) errors.push('rfdRsnCd must be a 2-digit code class 32 value');
  if (!/^\d{14}$/.test(str('rfdDt'))) errors.push('rfdDt must be yyyyMMddHHmmss');
  if (!/^\d{14}$/.test(str('cfmDt'))) errors.push('cfmDt must be yyyyMMddHHmmss');
  if (!/^\d{8}$/.test(str('salesDt'))) errors.push('salesDt must be yyyyMMdd');
  if (payload.cnclDt != null || payload.cnclReqDt != null) errors.push('a refund must not carry cancellation timestamps');
  if (!str('remark').trim()) errors.push('remark must carry the refund justification');
  const items = payload.itemList;
  if (!Array.isArray(items) || items.length === 0) errors.push('itemList must contain only the refunded lines');
  else {
    if (payload.totItemCnt !== items.length) errors.push('totItemCnt must equal itemList.length');
    for (const [i, raw] of items.entries()) {
      const it = raw as Record<string, unknown>;
      if (typeof it.qty !== 'number' || !(it.qty > 0)) errors.push(`itemList[${i}].qty must be a positive number`);
      for (const k of ['splyAmt', 'dcAmt', 'taxblAmt', 'taxAmt', 'totAmt', 'prc'] as const) {
        const v = it[k];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          errors.push(`itemList[${i}].${k} must be a non-negative number (wire magnitudes are positive)`);
        }
      }
    }
  }
  for (const k of ['totTaxblAmt', 'totTaxAmt', 'totAmt'] as const) {
    const v = payload[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      errors.push(`${k} must be a non-negative number`);
    }
  }
  if (errors.length) {
    throw new RefundRuleError(400, `${docLabel} payload rejected: ${errors.join('; ')}`);
  }
}

/** Total already-refunded (absolute) quantity per line key. */
export function consumedByKey(prior: PriorRefundLeg[]): Map<string, number> {
  const consumed = new Map<string, number>();
  for (const leg of prior) {
    const key = refundLineKey(leg);
    consumed.set(key, round2((consumed.get(key) ?? 0) + Math.abs(leg.absQuantity)));
  }
  return consumed;
}

/**
 * Remaining refundable quantity per original line. When several original
 * lines share a key, already-refunded quantity is consumed FIFO across them
 * so the per-line figures always sum to the key's true remaining.
 */
export function remainingByLine(
  original: OriginalRefundLine[],
  prior: PriorRefundLeg[],
): Array<{ saleItemId: number; remaining: number }> {
  const consumed = consumedByKey(prior);
  const running = new Map<string, number>();
  return original.map((line) => {
    const key = refundLineKey(line);
    const usedBefore = running.get(key) ?? 0;
    const totalConsumed = consumed.get(key) ?? 0;
    const consumedOnThisLine = Math.min(Math.max(totalConsumed - usedBefore, 0), line.quantity);
    running.set(key, usedBefore + consumedOnThisLine);
    return { saleItemId: line.saleItemId, remaining: round2(Math.max(line.quantity - consumedOnThisLine, 0)) };
  });
}

/**
 * Build the negated refund legs. `requested` is null/empty for a full refund
 * (every line's full remaining); otherwise each entry refunds part of one
 * original line. Every requested quantity must be > 0 and within that line's
 * remaining — anything else is an over-refund and throws.
 *
 * Scaling is proportional per line (q/Q): a 3-of-10 partial refund of a
 * 50000/9000-tax line yields exactly -15000 total / -2700 tax, so the legs
 * stay mathematically consistent at any quantity.
 */
export function planRefundLines(
  original: OriginalRefundLine[],
  prior: PriorRefundLeg[],
  requested: RequestedRefundLine[] | null | undefined,
): PlannedRefundLine[] {
  const remaining = new Map(remainingByLine(original, prior).map((r) => [r.saleItemId, r.remaining]));
  const byId = new Map(original.map((l) => [l.saleItemId, l]));

  // Aggregate the request per key first: several request entries may target
  // lines sharing one product, and jointly they must not exceed the key's
  // remaining either.
  const want: Array<{ line: OriginalRefundLine; qty: number }> = [];
  if (!requested || requested.length === 0) {
    for (const line of original) {
      const left = remaining.get(line.saleItemId) ?? 0;
      if (left > 0) want.push({ line, qty: left });
    }
    if (want.length === 0) {
      throw new RefundRuleError(400, 'Nothing left to refund — every line was already fully refunded');
    }
  } else {
    for (const req of requested) {
      const line = byId.get(req.saleItemId);
      if (!line) {
        throw new RefundRuleError(400, `Sale item #${req.saleItemId} does not belong to the original sale`);
      }
      const qty = Number(req.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new RefundRuleError(400, `Refund quantity for "${lineLabel(line)}" must be positive`);
      }
      const left = remaining.get(line.saleItemId) ?? 0;
      if (qty - left > 1e-9) {
        throw new RefundRuleError(
          400,
          `Cannot refund ${qty} of "${lineLabel(line)}" — only ${left} remain refundable`,
        );
      }
      want.push({ line, qty });
    }
    const perKey = new Map<string, number>();
    for (const { line, qty } of want) {
      const key = refundLineKey(line);
      perKey.set(key, (perKey.get(key) ?? 0) + qty);
    }
    const remainingKeyTotal = new Map<string, number>();
    for (const line of original) {
      const key = refundLineKey(line);
      remainingKeyTotal.set(key, (remainingKeyTotal.get(key) ?? 0) + (remaining.get(line.saleItemId) ?? 0));
    }
    for (const [key, total] of perKey) {
      if (total - (remainingKeyTotal.get(key) ?? 0) > 1e-9) {
        throw new RefundRuleError(400, 'Requested refund exceeds the remaining refundable quantity');
      }
    }
  }

  return want.map(({ line, qty }) => {
    if (!(line.quantity > 0)) {
      throw new RefundRuleError(400, `Original line "${lineLabel(line)}" has no positive quantity to refund from`);
    }
    const ratio = qty / line.quantity;
    return {
      saleItemId: line.saleItemId,
      productId: line.productId,
      serviceName: line.serviceName,
      serviceDescription: line.serviceDescription,
      quantity: -qty,
      unitPrice: line.unitPrice,
      totalPrice: -round2(line.totalPrice * ratio),
      taxRate: line.taxRate,
      taxAmount: -round2(line.taxAmount * ratio),
      taxCode: line.taxCode,
      dcRate: line.dcRate,
      dcAmt: -round2(line.dcAmt * ratio),
      measurementUnit: line.measurementUnit,
      itemType: line.itemType,
    };
  });
}

/** Positive-magnitude totals + per-rate bands for planned (negated) legs. */
export function summarizeRefund(planned: PlannedRefundLine[]): RefundTotals {
  let total = 0;
  let vat = 0;
  const bands: Record<string, { net: number; tax: number }> = {};
  for (const leg of planned) {
    const net = Math.abs(leg.totalPrice);
    const tax = Math.abs(leg.taxAmount);
    total = round2(total + net);
    vat = round2(vat + tax);
    const code = String(leg.taxCode ?? 'A').toUpperCase();
    const slot = bands[code] ?? { net: 0, tax: 0 };
    slot.net = round2(slot.net + net);
    slot.tax = round2(slot.tax + tax);
    bands[code] = slot;
  }
  return { totalRefundAmount: total, totalRefundVat: vat, totalRefundTaxable: round2(total - vat), bands };
}

/**
 * Refund reason + justification rules. The RRA code itself is validated
 * against code class 32 by the controller (DB-backed); here: a justification
 * is always required, and code 13 ("Other reason") additionally requires a
 * real explanation (min 5 chars) instead of a one-word note.
 */
export function assertRefundReason(rfdRsnCd: string, justification: string | null | undefined): void {
  const text = (justification ?? '').trim();
  if (!text) {
    throw new RefundRuleError(400, 'A refund justification is required — record why this refund is being made');
  }
  if (rfdRsnCd === '13' && text.length < 5) {
    throw new RefundRuleError(400, 'Refund reason "13 — Other reason" requires an explanation (at least 5 characters)');
  }
}

function lineLabel(line: OriginalRefundLine): string {
  return line.serviceName ?? `item #${line.saleItemId}`;
}

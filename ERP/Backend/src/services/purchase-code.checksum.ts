/**
 * RRA VSDC purchase-code checksum (replica of the sandbox WAR's
 * CheckApiConnection.decryptPurchaseCode). The sandbox rejects any purchase
 * code (resultCd 882 "Purchase code is invalid") unless the code embeds a
 * checksum derived from the buyer TIN and the seller's (org) TIN. Codes we
 * pool ourselves must therefore be generated with this algorithm, not just
 * sequential numbers.
 *
 * The real algorithm (decompiled from rraVsdcSandbox3.0.2.war):
 *   decryptPurchaseCode(prcOrdCd, custTin, tin)
 *     v1 = validateNumber( abs(custTin - tin) % 1000 )         // 3-digit
 *     if reverseStringSuper(prcOrdCd, v1)  return true
 *     if reverseStringSuperNew(prcOrdCd, v1) return true
 *     v2 = (tin - custTin) * 6 % 1000  (or abs(diff)+5 when negative)
 *     v2 = validateNumber(v2)
 *     if reverseStringSuper(prcOrdCd, v2)  return true
 *     return reverseStringSuperNew(prcOrdCd, v2)
 *
 * reverseStringSuper / reverseStringSuperNew permute the 3-digit value and
 * compare against slices of the 6-char code, with digit-pair tables
 * (validateSecondNumber / validateSecondNumberNew). This module exposes a
 * checker and a generator so the purchase-code pool can be topped up with
 * codes the sandbox will actually accept.
 */

/** validateNumber: pad single/double-digit checksums to 3 digits. */
function validateNumber(n: number): number {
  if (n > 0 && n < 10) return n * 100;
  if (n >= 10 && n < 100) return n * 10;
  if (n === 0) return 100;
  return n;
}

/** validateSecondNumber: pair table for reverseStringSuper. */
const SECOND_NUMBER: Record<string, string[]> = {
  '0': ['1', '7', '4'],
  '1': ['2', '5', '8'],
  '2': ['7', '4', '9'],
  '3': ['0', '5', '8'],
  '4': ['1', '8', '5'],
  '5': ['2', '6', '9'],
  '6': ['3', '7', '0'],
  '7': ['0', '4', '8'],
  '8': ['1', '5', '3'],
  '9': ['0', '4', '8'],
};

/** validateSecondNumberNew: pair table for reverseStringSuperNew. */
const SECOND_NUMBER_NEW: Record<string, string[]> = {
  '0': ['1', '7', '4', '6', '9', '8'],
  '1': ['2', '5', '8', '6', '7', '3'],
  '2': ['7', '4', '9', '5', '2', '8'],
  '3': ['0', '5', '8', '1', '7', '3'],
  '4': ['1', '7', '4', '6', '9', '8'],
  '5': ['2', '6', '9', '0', '4', '8'],
  '6': ['3', '7', '0', '1', '6', '8'],
  '7': ['3', '4', '8', '7', '9', '0'],
  '8': ['1', '5', '3', '6', '7', '9'],
  '9': ['0', '4', '8', '6', '5', '1'],
};

/**
 * Decode which digit-3 candidate strings are expected for a (buyerTin, tin)
 * pair. Returns the two 3-char candidates used by reverse* comparisons.
 */
export function purchaseCodeChecksumCandidates(buyerTin: string, sellerTin: string): string[] {
  const cust = parseInt(buyerTin, 10);
  const seller = parseInt(sellerTin, 10);
  const v1 = validateNumber(Math.abs(cust - seller) % 1000);
  let diff = BigInt(sellerTin) - BigInt(buyerTin);
  if (diff < 0n) diff = -diff + 5n;
  else diff = diff * 6n;
  const v2 = validateNumber(Number(diff % 1000n));
  return [String(v1), String(v2)];
}

function validPair(a: string, b: string, table: Record<string, string[]>): boolean {
  return !!table[a]?.includes(b);
}

/** reverseStringSuper replica: checks code.substring(3) against a permutation of candidate. */
function reverseStringSuper(code: string, num: string): boolean {
  let flag = false;
  let str3 = '';
  const c0 = code.charAt(0);
  const c1 = code.charAt(1);
  const c2 = code.charAt(2);
  const check = (allowed: string[]) => {
    if (allowed.includes(c0) && validPair(c0, c1, SECOND_NUMBER)) flag = true;
  };
  switch (c2) {
    case '1': check(['0', '1', '2', '3']); str3 = num[2] + num[0] + num[1]; break;
    case '2': check(['3', '4', '5', '6']); str3 = num[0] + num[2] + num[1]; break;
    case '3': check(['1', '2', '3', '4']); str3 = num[1] + num[0] + num[2]; break;
    case '4': check(['4', '5', '6', '7']); str3 = num[1] + num[2] + num[0]; break;
    case '5': check(['2', '3', '4', '5']); str3 = num[0] + num[0] + num[0]; break;
    case '6': check(['0', '1', '2', '3']); str3 = num[2] + num[1] + num[0]; break;
    case '7': check(['5', '6', '7', '8']); str3 = num[2] + num[2] + num[2]; break;
    case '8': check(['5', '6', '7', '8']); str3 = num[0] + num[2] + num[2]; break;
    case '9': check(['2', '3', '4', '5']); str3 = num[1] + num[2] + num[1]; break;
    default: check(['4', '5', '6', '7']); str3 = num[0] + num[0] + num[1]; break;
  }
  return flag && code.substring(3) === str3;
}

/** reverseStringSuperNew replica: checks code.charAt(3) against a single candidate digit. */
function reverseStringSuperNew(code: string, num: string): boolean {
  if (code.length < 5) return false;
  let flag = false;
  let str3 = '';
  const c0 = code.charAt(0);
  const c1 = code.charAt(1);
  const c3 = code.charAt(3);
  const c4 = code.charAt(4);
  const check = () => {
    if (validPair(c0, c1, SECOND_NUMBER_NEW) && validPair(c3, c4, SECOND_NUMBER_NEW)) flag = true;
  };
  switch (code.charAt(2)) {
    case '1': check(); str3 = num[2]; break;
    case '2': check(); str3 = num[0]; break;
    case '3': check(); str3 = num[1]; break;
    case '4': check(); str3 = num[1]; break;
    case '5': check(); str3 = num[0]; break;
    case '6': check(); str3 = num[2]; break;
    case '7': check(); str3 = num[2]; break;
    case '8': check(); str3 = num[0]; break;
    case '9': check(); str3 = num[1]; break;
    default: check(); str3 = num[0]; break;
  }
  return flag && String(code.charAt(3)) === str3;
}

/** Verify a purchase code against the sandbox checksum for a (buyerTin, sellerTin). */
export function isValidPurchaseCode(code: string, buyerTin: string, sellerTin: string): boolean {
  const [v1, v2] = purchaseCodeChecksumCandidates(buyerTin, sellerTin);
  if (reverseStringSuper(code, v1) || reverseStringSuperNew(code, v1)) return true;
  return reverseStringSuper(code, v2) || reverseStringSuperNew(code, v2);
}

/**
 * Generate purchase codes the sandbox accepts for a (buyerTin, sellerTin).
 * Uses the reverseStringSuperNew fast path (c[2]='0', c[3]=candidate[0], valid
 * digit pairs). Each generated code is unique within the returned batch.
 *
 * Starts at a time-based offset into the candidate space so repeated DB resets
 * don't keep minting the same early codes VSDC already burned (resultCd 883).
 */
export function generateValidPurchaseCodes(
  buyerTin: string,
  sellerTin: string,
  count: number,
  existing: Set<string> = new Set(),
): string[] {
  const [v1, v2] = purchaseCodeChecksumCandidates(buyerTin, sellerTin);
  const candidates: string[] = [];
  for (const num of [v1, v2]) {
    const target = num[0];
    for (const c0 of Object.keys(SECOND_NUMBER_NEW)) {
      for (const c1 of SECOND_NUMBER_NEW[c0]) {
        for (const c4 of SECOND_NUMBER_NEW[target]) {
          for (const c5 of '0123456789') {
            const code = `${c0}${c1}0${target}${c4}${c5}`;
            if (existing.has(code)) continue;
            if (!isValidPurchaseCode(code, buyerTin, sellerTin)) continue;
            existing.add(code);
            candidates.push(code);
          }
        }
      }
    }
  }
  if (!candidates.length) return [];
  // Rotate so each process/session prefers a different slice of the space.
  const offset = Date.now() % candidates.length;
  const rotated = candidates.slice(offset).concat(candidates.slice(0, offset));
  return rotated.slice(0, count);
}

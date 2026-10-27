import { prisma } from '../lib/prisma';
import logger from '../utils/logger';

/**
 * Centralized RRA master-data code service.
 *
 * Source of truth is `/code/selectCodes` (RRA checklist §59), cached in
 * `rra_codes`. Class IDs below were verified live against the VSDC sandbox
 * (`rraVsdcSandbox`, 2026-09-18) — do not "correct" them from older spec
 * tables (those numbered tax types as 24 and countries as 14).
 */

/** VSDC code-class IDs as returned by `/code/selectCodes`. */
export const RRA_CD_CLS = {
  PROPERTY_TYPE: '02',
  TOURISM_TAX_CATEGORY: '03',
  TAXATION_TYPE: '04',
  COUNTRY: '05',
  ROOM_TYPE: '06',
  PAYMENT_TYPE: '07',
  TOURISM_TAX_TYPE: '08',
  QUANTITY_UNIT: '10',
  SALE_STATUS: '11',
  STOCK_IO_TYPE: '12',
  TRANSACTION_TYPE: '14',
  PACKING_UNIT: '17',
  ITEM_TYPE: '24',
  IMPORT_ITEM_STATUS: '26',
  REFUND_REASON: '32',
  PURCHASE_STATUS: '34',
  SALES_RECEIPT_TYPE: '37',
  PURCHASE_RECEIPT_TYPE: '38',
} as const;

export type RraCodeClass = (typeof RRA_CD_CLS)[keyof typeof RRA_CD_CLS] | string;

export interface RraCodeEntry {
  cd: string;
  cdNm: string | null;
  cdDesc: string | null;
  userDfnCd1?: string | null;
  srtOrd?: number | null;
}

export interface PaymentMethodMapping {
  erpMethod: string;
  rraCode: string;
  rraCodeName: string;
}

export interface RefundReasonCode {
  code: string;
  name: string;
  description: string | null;
}

export interface TaxationType {
  code: string;
  label: string;
  rate: number;
  category: string;
}

export interface RraCodeCatalog {
  taxTypes: TaxationType[];
  tourismTaxCategories: Array<{ code: string; label: string; rate: number }>;
  tourismTaxTypes: Array<{ code: string; label: string }>;
  countries: Array<{ code: string; label: string }>;
  propertyTypes: Array<{ code: string; label: string }>;
  roomTypes: Array<{ code: string; label: string }>;
  qtyUnits: Array<{ code: string; label: string }>;
  pkgUnits: Array<{ code: string; label: string }>;
  refundReasons: RefundReasonCode[];
  paymentTypes: Array<{ code: string; label: string }>;
  itemTypes: Array<{ code: string; label: string }>;
  cachedCount: number;
}

/** ERP payment method → RRA payment code class '07' mapping.
 *
 * Verified against the live RRA code list (`POST /code/selectCodes`, class
 * '07 Payment Type'): 01 CASH, 02 CREDIT, 03 CASH/CREDIT (mixed tender on one
 * receipt), 04 BANK CHECK, 05 DEBIT&CREDIT CARD, 06 MOBILE MONEY, 07 OTHER.
 * A sale on credit (DEBT — nothing collected at checkout) is RRA '02', not
 * '07'. A MIXED tender (cash + debt/insurance on one receipt) is '03'.
 */
const ERP_TO_RRA_PAYMENT_METHOD: Record<string, string> = {
  CASH: '01',
  CREDIT_CARD: '05',
  MOBILE_MONEY: '06',
  MTN_MOMO: '06',
  AIRTEL_MONEY: '06',
  BANK_TRANSFER: '04',
  BANK: '04',
  BANK_CHECK: '04',
  CHEQUE: '04',
  CARD: '05',
  PAYPACK: '06',
  WALLET: '06',
  GIFT_CARD: '07',
  STORE_CREDIT: '07',
  INSURANCE: '07',
  DEBT: '02',
  MIXED: '03',
  STRIPE: '05',
  PESAPA: '06',
};

/**
 * Last-resort refund reasons when class 32 has not been synced yet.
 * Prefer `getRefundReasonCodesForOrg()` which reads the cache.
 */
export const RRA_REFUND_REASON_CODES: RefundReasonCode[] = [
  { code: '01', name: 'Missing Quantity', description: null },
  { code: '02', name: 'Missing Waiting', description: null },
  { code: '03', name: 'Damaged', description: null },
  { code: '04', name: 'Wasted', description: null },
  { code: '05', name: 'Raw Material Shortage', description: null },
  { code: '06', name: 'Refund', description: 'Generic refund' },
  { code: '07', name: 'Wrong Customer TIN', description: null },
  { code: '08', name: 'Wrong Customer name', description: null },
  { code: '09', name: 'Wrong Amount/price', description: null },
  { code: '10', name: 'Wrong Quantity', description: null },
  { code: '11', name: 'Wrong Item(s)', description: null },
  { code: '12', name: 'Wrong tax type', description: null },
  { code: '13', name: 'Other reason', description: null },
];

/** Default refund reason when the operator picks none: '06 Refund'. */
export const DEFAULT_RFD_RSN_CD = '06';

const TAX_CATEGORY_BY_CODE: Record<string, string> = {
  A: 'EXEMPT',
  B: 'STANDARD',
  C: 'ZERO_RATED',
  D: 'NON_TAXABLE',
};

/**
 * Get all active codes for a given RRA code class from the local cache.
 * Returns [] when the class has never been synced (callers decide fallback).
 */
export async function getRraCodes(
  organizationId: number,
  cdCls: RraCodeClass,
): Promise<RraCodeEntry[]> {
  return prisma.rraCode.findMany({
    where: {
      organizationId,
      cdCls,
      useYn: 'Y',
    },
    orderBy: [{ srtOrd: 'asc' }, { cd: 'asc' }],
    select: { cd: true, cdNm: true, cdDesc: true, userDfnCd1: true, srtOrd: true },
  });
}

/**
 * Get a specific RRA code by class and code value.
 */
export async function getRraCode(
  organizationId: number,
  cdCls: RraCodeClass,
  cd: string,
): Promise<RraCodeEntry | null> {
  return prisma.rraCode.findUnique({
    where: { organizationId_cdCls_cd: { organizationId, cdCls, cd } },
    select: { cd: true, cdNm: true, cdDesc: true, userDfnCd1: true, srtOrd: true },
  });
}

/** Parse a percent rate from VSDC `userDfnCd1` ("18") or a name ("B-18.00%", "TT-3%"). */
export function parseRraCodeRate(entry: Pick<RraCodeEntry, 'cdNm' | 'cdDesc' | 'userDfnCd1'>): number {
  const fromDef = Number.parseFloat(String(entry.userDfnCd1 ?? '').replace(',', '.'));
  if (Number.isFinite(fromDef)) return fromDef;
  const blob = `${entry.cdNm ?? ''} ${entry.cdDesc ?? ''}`;
  const m = blob.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number.parseFloat(m[1]) : 0;
}

function asOptions(entries: RraCodeEntry[]): Array<{ code: string; label: string }> {
  return entries.map((e) => ({
    code: e.cd,
    label: (e.cdNm ?? e.cd).trim() || e.cd,
  }));
}

/** Last-resort A/B/C/D rates when class 04 has not been synced. Never invent a code. */
const LAST_RESORT_TAX_RATES: Record<string, number> = { A: 0, B: 18, C: 0, D: 0 };
const LAST_RESORT_TOURISM_TAX_RATE = 3;

export async function getTaxationTypes(organizationId: number): Promise<TaxationType[]> {
  const rows = await getRraCodes(organizationId, RRA_CD_CLS.TAXATION_TYPE);
  if (rows.length === 0) {
    logger.warn(`[RRA][CODES] tax types (class ${RRA_CD_CLS.TAXATION_TYPE}) empty for org ${organizationId} — UI/payloads will use last-resort A/B/C/D`);
    return [];
  }
  return rows.map((e) => ({
    code: e.cd,
    label: (e.cdNm ?? e.cd).trim(),
    rate: parseRraCodeRate(e),
    category: TAX_CATEGORY_BY_CODE[e.cd] ?? 'STANDARD',
  }));
}

export async function getTaxRateForCode(organizationId: number, taxTyCd: string): Promise<number> {
  const code = taxTyCd.trim().toUpperCase();
  const types = await getTaxationTypes(organizationId);
  const hit = types.find((t) => t.code.toUpperCase() === code);
  if (hit) return hit.rate;
  if (types.length === 0) {
    logger.warn(`[RRA][CODES] tax rate for ${code} using last-resort (class ${RRA_CD_CLS.TAXATION_TYPE} empty) org=${organizationId}`);
    return LAST_RESORT_TAX_RATES[code] ?? 0;
  }
  return 0;
}

export async function getTaxRatesBySlot(organizationId: number): Promise<[number, number, number, number]> {
  const types = await getTaxationTypes(organizationId);
  const rate = (code: string) => types.find((t) => t.code.toUpperCase() === code)?.rate
    ?? (types.length === 0 ? LAST_RESORT_TAX_RATES[code] ?? 0 : 0);
  if (types.length === 0) {
    return [
      LAST_RESORT_TAX_RATES.A,
      LAST_RESORT_TAX_RATES.B,
      LAST_RESORT_TAX_RATES.C,
      LAST_RESORT_TAX_RATES.D,
    ];
  }
  return [rate('A'), rate('B'), rate('C'), rate('D')];
}

export async function getTourismTaxRate(organizationId: number): Promise<number> {
  const cats = await getRraCodes(organizationId, RRA_CD_CLS.TOURISM_TAX_CATEGORY);
  if (cats.length === 0) {
    logger.warn(
      `[RRA][CODES] tourism tax (class ${RRA_CD_CLS.TOURISM_TAX_CATEGORY}) empty for org ${organizationId} — last-resort taxRtTt=${LAST_RESORT_TOURISM_TAX_RATE}`,
    );
    return LAST_RESORT_TOURISM_TAX_RATE;
  }
  return parseRraCodeRate(cats[0]);
}

export async function isCachedTaxCode(organizationId: number, taxTyCd: string): Promise<boolean> {
  const types = await getTaxationTypes(organizationId);
  if (types.length === 0) return ['A', 'B', 'C', 'D'].includes(taxTyCd.trim().toUpperCase());
  return types.some((t) => t.code.toUpperCase() === taxTyCd.trim().toUpperCase());
}

export async function getCountryCodes(organizationId: number): Promise<Array<{ code: string; label: string }>> {
  const rows = await getRraCodes(organizationId, RRA_CD_CLS.COUNTRY);
  if (rows.length === 0) {
    logger.warn(`[RRA][CODES] countries (class ${RRA_CD_CLS.COUNTRY}) empty for org ${organizationId}`);
  }
  return asOptions(rows);
}

export async function isCachedCountryCode(organizationId: number, code: string): Promise<boolean> {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return false;
  const countries = await getCountryCodes(organizationId);
  if (countries.length === 0) return true; // cache not synced yet — accept ISO-2
  return countries.some((c) => c.code.toUpperCase() === trimmed);
}

export async function getRraCodeCatalog(organizationId: number): Promise<RraCodeCatalog> {
  const [
    taxTypes,
    tourismCats,
    tourismTypes,
    countries,
    propertyTypes,
    roomTypes,
    qtyUnits,
    pkgUnits,
    refundRows,
    paymentTypes,
    itemTypes,
    cachedCount,
  ] = await Promise.all([
    getTaxationTypes(organizationId),
    getRraCodes(organizationId, RRA_CD_CLS.TOURISM_TAX_CATEGORY),
    getRraCodes(organizationId, RRA_CD_CLS.TOURISM_TAX_TYPE),
    getCountryCodes(organizationId),
    getRraCodes(organizationId, RRA_CD_CLS.PROPERTY_TYPE),
    getRraCodes(organizationId, RRA_CD_CLS.ROOM_TYPE),
    getRraCodes(organizationId, RRA_CD_CLS.QUANTITY_UNIT),
    getRraCodes(organizationId, RRA_CD_CLS.PACKING_UNIT),
    getRraCodes(organizationId, RRA_CD_CLS.REFUND_REASON),
    getRraCodes(organizationId, RRA_CD_CLS.PAYMENT_TYPE),
    getRraCodes(organizationId, RRA_CD_CLS.ITEM_TYPE),
    prisma.rraCode.count({ where: { organizationId } }),
  ]);

  const refundReasons = refundRows.length
    ? refundRows.map((e) => ({ code: e.cd, name: (e.cdNm ?? e.cd).trim(), description: e.cdDesc }))
    : RRA_REFUND_REASON_CODES;

  logger.info(
    `[RRA][CODES] catalog org=${organizationId} cached=${cachedCount} ` +
    `tax=${taxTypes.length} tourismCat=${tourismCats.length} tourismTy=${tourismTypes.length} ` +
    `country=${countries.length} property=${propertyTypes.length} qty=${qtyUnits.length} pkg=${pkgUnits.length} refund=${refundReasons.length}`,
  );

  return {
    taxTypes,
    tourismTaxCategories: tourismCats.map((e) => ({
      code: e.cd,
      label: (e.cdNm ?? e.cd).trim(),
      rate: parseRraCodeRate(e),
    })),
    tourismTaxTypes: asOptions(tourismTypes),
    countries,
    propertyTypes: asOptions(propertyTypes),
    roomTypes: asOptions(roomTypes),
    qtyUnits: asOptions(qtyUnits),
    pkgUnits: asOptions(pkgUnits),
    refundReasons,
    paymentTypes: asOptions(paymentTypes),
    itemTypes: asOptions(itemTypes),
    cachedCount,
  };
}

/**
 * Validate that an ERP payment method has a valid RRA payment code mapping.
 * Returns the RRA code or throws a descriptive error.
 */
export async function getRraPaymentCode(
  organizationId: number,
  erpPaymentMethod: string,
): Promise<string> {
  const mappedCode = ERP_TO_RRA_PAYMENT_METHOD[erpPaymentMethod];
  if (!mappedCode) {
    throw new Error(
      `No RRA payment code mapping exists for ERP payment method '${erpPaymentMethod}'. ` +
      `Supported methods: ${Object.keys(ERP_TO_RRA_PAYMENT_METHOD).join(', ')}`,
    );
  }

  const codeEntry = await getRraCode(organizationId, RRA_CD_CLS.PAYMENT_TYPE, mappedCode);
  if (!codeEntry) {
    const cached = await getRraCodes(organizationId, RRA_CD_CLS.PAYMENT_TYPE);
    if (cached.length === 0) {
      logger.warn(
        `[RRA][CODES] payment class ${RRA_CD_CLS.PAYMENT_TYPE} not synced for org ${organizationId}; ` +
        `using mapped code ${mappedCode} for ${erpPaymentMethod}`,
      );
      return mappedCode;
    }
    throw new Error(
      `RRA payment code '${mappedCode}' (mapped from '${erpPaymentMethod}') not found in local cache. ` +
      `Run master-data sync to populate payment type codes (class '${RRA_CD_CLS.PAYMENT_TYPE}').`,
    );
  }

  return codeEntry.cd;
}

/**
 * Get all available ERP → RRA payment method mappings with their RRA names.
 * Useful for UI dropdowns and validation.
 */
export async function getPaymentMethodMappings(
  organizationId: number,
): Promise<PaymentMethodMapping[]> {
  const rraCodes = await getRraCodes(organizationId, RRA_CD_CLS.PAYMENT_TYPE);
  const rraCodeMap = new Map(rraCodes.map((c) => [c.cd, c]));

  return Object.entries(ERP_TO_RRA_PAYMENT_METHOD).map(([erpMethod, rraCode]) => {
    const rraEntry = rraCodeMap.get(rraCode);
    return {
      erpMethod,
      rraCode,
      rraCodeName: rraEntry?.cdNm ?? rraCode,
    };
  });
}

export async function getRefundReasonCodesForOrg(organizationId: number): Promise<RefundReasonCode[]> {
  const rows = await getRraCodes(organizationId, RRA_CD_CLS.REFUND_REASON);
  if (rows.length === 0) {
    logger.warn(`[RRA][CODES] refund reasons (class ${RRA_CD_CLS.REFUND_REASON}) empty for org ${organizationId} — using last-resort list`);
    return RRA_REFUND_REASON_CODES;
  }
  return rows.map((e) => ({ code: e.cd, name: (e.cdNm ?? e.cd).trim(), description: e.cdDesc }));
}

/**
 * Validate a refund reason code against the RRA code-class-32 list.
 * Returns the code if valid, throws if not.
 */
export function validateRefundReasonCode(code: string, cached?: RefundReasonCode[]): string {
  const list = cached?.length ? cached : RRA_REFUND_REASON_CODES;
  const valid = list.find((r) => r.code === code);
  if (!valid) {
    throw new Error(
      `Invalid RRA refund reason code '${code}'. Valid codes (RRA code class ${RRA_CD_CLS.REFUND_REASON}): ` +
      `${list.map((r) => r.code).join(', ')}`,
    );
  }
  return valid.code;
}

export async function validateRefundReasonCodeForOrg(organizationId: number, code: string): Promise<string> {
  const list = await getRefundReasonCodesForOrg(organizationId);
  return validateRefundReasonCode(code, list);
}

/**
 * Get all valid refund reason codes for UI selection (last-resort static list).
 * Prefer `getRefundReasonCodesForOrg` when an organization id is available.
 */
export function getRefundReasonCodes(): RefundReasonCode[] {
  return RRA_REFUND_REASON_CODES;
}

/**
 * Last-resort quantity/packing unit sets used only when class 10/17 have not
 * been synced. Prefer `getQtyUnitSet` / `getPkgUnitSet`.
 */
export const RRA_QTY_UNIT_CODES: ReadonlySet<string> = new Set([
  '4B', 'AV', 'BA', 'BE', 'BG', 'BL', 'BLL', 'BX', 'CA', 'CEL', 'CMT', 'CR',
  'DR', 'DZ', 'GLL', 'GRM', 'GRO', 'KG', 'KTM', 'KWT', 'L', 'LBR', 'LK',
  'LTR', 'M', 'M2', 'M3', 'MGM', 'MTR', 'MWT', 'NO', 'NX', 'PA', 'PG', 'PR',
  'RL', 'RO', 'SET', 'ST', 'TNE', 'TU', 'U', 'YRD',
]);

export const RRA_PKG_UNIT_CODES: ReadonlySet<string> = new Set([
  'AM', 'BA', 'BC', 'BE', 'BF', 'BG', 'BJ', 'BK', 'BL', 'BQ', 'BR', 'BV',
  'BZ', 'CA', 'CH', 'CJ', 'CL', 'CR', 'CS', 'CT', 'CTN', 'CY', 'DR', 'GT',
  'HH', 'IZ', 'JR', 'JU', 'JY', 'KZ', 'LZ', 'ML', 'NT', 'OU', 'PD', 'PG',
  'PI', 'PO', 'PU', 'RL', 'RO', 'RZ', 'SK', 'TN', 'TY', 'VG', 'VL', 'VO',
  'VQ', 'VR', 'VT', 'VY',
]);

/** Fallbacks used when a product has no usable unit code of its own. */
export const FALLBACK_PKG_UNIT_CD = 'CT';
export const FALLBACK_QTY_UNIT_CD = 'U';

export async function getQtyUnitSet(organizationId: number): Promise<ReadonlySet<string>> {
  const rows = await getRraCodes(organizationId, RRA_CD_CLS.QUANTITY_UNIT);
  if (rows.length === 0) return RRA_QTY_UNIT_CODES;
  return new Set(rows.map((r) => r.cd.toUpperCase()));
}

export async function getPkgUnitSet(organizationId: number): Promise<ReadonlySet<string>> {
  const rows = await getRraCodes(organizationId, RRA_CD_CLS.PACKING_UNIT);
  if (rows.length === 0) return RRA_PKG_UNIT_CODES;
  return new Set(rows.map((r) => r.cd.toUpperCase()));
}

/**
 * Resolve a product's quantity-unit code to an RRA-accepted value: the stored
 * code when it is a real RRA code, otherwise the code derived from the sale
 * line's measurement unit, otherwise the generic 'U'.
 */
export function resolveQtyUnitCd(
  stored: string | null | undefined,
  measurementUnit: string | null | undefined,
  derive: (unit: string | null | undefined) => string,
  allowed: ReadonlySet<string> = RRA_QTY_UNIT_CODES,
): string {
  const s = (stored ?? '').trim().toUpperCase();
  if (s && allowed.has(s)) return s;
  const derived = derive(measurementUnit);
  if (derived && allowed.has(derived)) return derived;
  return allowed.has(FALLBACK_QTY_UNIT_CD) ? FALLBACK_QTY_UNIT_CD : (derived || s);
}

/**
 * Resolve a product's packing-unit code to an RRA-accepted value: the stored
 * code when it is a real RRA code, otherwise 'CT'.
 */
export function resolvePkgUnitCd(
  stored: string | null | undefined,
  allowed: ReadonlySet<string> = RRA_PKG_UNIT_CODES,
): string {
  const s = (stored ?? '').trim().toUpperCase();
  if (s && allowed.has(s)) return s;
  return allowed.has(FALLBACK_PKG_UNIT_CD) ? FALLBACK_PKG_UNIT_CD : s;
}

/**
 * Check if a payment method requires a purchase code (business TIN).
 * Business TINs are non-7-prefix; individual TINs start with 7.
 */
export function requiresPurchaseCode(custTin: string): boolean {
  const tin = custTin.trim();
  return tin.length === 9 && !tin.startsWith('7');
}

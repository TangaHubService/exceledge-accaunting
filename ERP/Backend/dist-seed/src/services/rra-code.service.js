"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_QTY_UNIT_CD = exports.FALLBACK_PKG_UNIT_CD = exports.RRA_PKG_UNIT_CODES = exports.RRA_QTY_UNIT_CODES = exports.DEFAULT_RFD_RSN_CD = exports.RRA_REFUND_REASON_CODES = void 0;
exports.getRraCodes = getRraCodes;
exports.getRraCode = getRraCode;
exports.getRraPaymentCode = getRraPaymentCode;
exports.getPaymentMethodMappings = getPaymentMethodMappings;
exports.validateRefundReasonCode = validateRefundReasonCode;
exports.getRefundReasonCodes = getRefundReasonCodes;
exports.resolveQtyUnitCd = resolveQtyUnitCd;
exports.resolvePkgUnitCd = resolvePkgUnitCd;
exports.requiresPurchaseCode = requiresPurchaseCode;
const prisma_1 = require("../lib/prisma");
/** ERP payment method → RRA payment code class '07' mapping.
 *
 * Verified against the live RRA code list (`POST /code/selectCodes`, class
 * '07 Payment Type'): 01 CASH, 02 CREDIT, 03 CASH/CREDIT (mixed tender on one
 * receipt), 04 BANK CHECK, 05 DEBIT&CREDIT CARD, 06 MOBILE MONEY, 07 OTHER.
 * A sale on credit (DEBT — nothing collected at checkout) is RRA '02', not
 * '07'. A MIXED tender (cash + debt/insurance on one receipt) is '03'.
 */
const ERP_TO_RRA_PAYMENT_METHOD = {
    CASH: '01',
    CREDIT_CARD: '05',
    MOBILE_MONEY: '06',
    MTN_MOMO: '06',
    AIRTEL_MONEY: '06',
    BANK_TRANSFER: '04',
    BANK: '04',
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
 * RRA refund reason codes — the authoritative code class '32 Refund Reason'
 * from `POST /code/selectCodes` (verified live against the RRA VSDC sandbox;
 * the sandbox rejects any other rfdRsnCd with resultCd 910). Do NOT extend
 * this list: every entry must exist in RRA's list.
 */
exports.RRA_REFUND_REASON_CODES = [
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
exports.DEFAULT_RFD_RSN_CD = '06';
/**
 * Get all active codes for a given RRA code class from the local cache.
 * Throws if the class has never been synced for this organization.
 */
async function getRraCodes(organizationId, cdCls) {
    const codes = await prisma_1.prisma.rraCode.findMany({
        where: {
            organizationId,
            cdCls,
            useYn: 'Y',
        },
        orderBy: [{ srtOrd: 'asc' }, { cd: 'asc' }],
        select: { cd: true, cdNm: true, cdDesc: true },
    });
    if (codes.length === 0) {
        throw new Error(`RRA code class '${cdCls}' has no active codes cached for organization ${organizationId}. ` +
            `Run a master-data sync (POST /rra/codes/sync) first.`);
    }
    return codes;
}
/**
 * Get a specific RRA code by class and code value.
 */
async function getRraCode(organizationId, cdCls, cd) {
    return prisma_1.prisma.rraCode.findUnique({
        where: { organizationId_cdCls_cd: { organizationId, cdCls, cd } },
        select: { cd: true, cdNm: true, cdDesc: true },
    });
}
/**
 * Validate that an ERP payment method has a valid RRA payment code mapping.
 * Returns the RRA code or throws a descriptive error.
 */
async function getRraPaymentCode(organizationId, erpPaymentMethod) {
    const mappedCode = ERP_TO_RRA_PAYMENT_METHOD[erpPaymentMethod];
    if (!mappedCode) {
        throw new Error(`No RRA payment code mapping exists for ERP payment method '${erpPaymentMethod}'. ` +
            `Supported methods: ${Object.keys(ERP_TO_RRA_PAYMENT_METHOD).join(', ')}`);
    }
    const codeEntry = await getRraCode(organizationId, '07', mappedCode);
    if (!codeEntry) {
        throw new Error(`RRA payment code '${mappedCode}' (mapped from '${erpPaymentMethod}') not found in local cache. ` +
            `Run master-data sync to populate payment type codes (class '07').`);
    }
    return codeEntry.cd;
}
/**
 * Get all available ERP → RRA payment method mappings with their RRA names.
 * Useful for UI dropdowns and validation.
 */
async function getPaymentMethodMappings(organizationId) {
    const rraCodes = await getRraCodes(organizationId, '07');
    const rraCodeMap = new Map(rraCodes.map(c => [c.cd, c]));
    return Object.entries(ERP_TO_RRA_PAYMENT_METHOD).map(([erpMethod, rraCode]) => {
        const rraEntry = rraCodeMap.get(rraCode);
        return {
            erpMethod,
            rraCode,
            rraCodeName: rraEntry?.cdNm ?? rraCode,
        };
    });
}
/**
 * Validate a refund reason code against the RRA code-class-32 list.
 * Returns the code if valid, throws if not.
 */
function validateRefundReasonCode(code) {
    const valid = exports.RRA_REFUND_REASON_CODES.find(r => r.code === code);
    if (!valid) {
        throw new Error(`Invalid RRA refund reason code '${code}'. Valid codes (RRA code class 32): ` +
            `${exports.RRA_REFUND_REASON_CODES.map(r => r.code).join(', ')}`);
    }
    return valid.code;
}
/**
 * Get all valid refund reason codes for UI selection.
 */
function getRefundReasonCodes() {
    return exports.RRA_REFUND_REASON_CODES;
}
/**
 * RRA quantity-unit codes (`/code/selectCodes` class '10 Quantity Unit') and
 * packing-unit codes (class '17 Packing Unit'), verified live against the RRA
 * VSDC sandbox. The sandbox rejects any other qtyUnitCd/pkgUnitCd on a sale
 * line with resultCd 913, so line units are checked against these sets before
 * submission. Kept centrally here — never scatter unit codes across services.
 */
exports.RRA_QTY_UNIT_CODES = new Set([
    '4B', 'AV', 'BA', 'BE', 'BG', 'BL', 'BLL', 'BX', 'CA', 'CEL', 'CMT', 'CR',
    'DR', 'DZ', 'GLL', 'GRM', 'GRO', 'KG', 'KTM', 'KWT', 'L', 'LBR', 'LK',
    'LTR', 'M', 'M2', 'M3', 'MGM', 'MTR', 'MWT', 'NO', 'NX', 'PA', 'PG', 'PR',
    'RL', 'RO', 'SET', 'ST', 'TNE', 'TU', 'U', 'YRD',
]);
exports.RRA_PKG_UNIT_CODES = new Set([
    'AM', 'BA', 'BC', 'BE', 'BF', 'BG', 'BJ', 'BK', 'BL', 'BQ', 'BR', 'BV',
    'BZ', 'CA', 'CH', 'CJ', 'CL', 'CR', 'CS', 'CT', 'CTN', 'CY', 'DR', 'GT',
    'HH', 'IZ', 'JR', 'JU', 'JY', 'KZ', 'LZ', 'ML', 'NT', 'OU', 'PD', 'PG',
    'PI', 'PO', 'PU', 'RL', 'RO', 'RZ', 'SK', 'TN', 'TY', 'VG', 'VL', 'VO',
    'VQ', 'VR', 'VT', 'VY',
]);
/** Fallbacks used when a product has no usable unit code of its own. */
exports.FALLBACK_PKG_UNIT_CD = 'CT';
exports.FALLBACK_QTY_UNIT_CD = 'U';
/**
 * Resolve a product's quantity-unit code to an RRA-accepted value: the stored
 * code when it is a real RRA code, otherwise the code derived from the sale
 * line's measurement unit, otherwise the generic 'U'.
 */
function resolveQtyUnitCd(stored, measurementUnit, derive) {
    const s = (stored ?? '').trim().toUpperCase();
    if (s && exports.RRA_QTY_UNIT_CODES.has(s))
        return s;
    const derived = derive(measurementUnit);
    if (derived && exports.RRA_QTY_UNIT_CODES.has(derived))
        return derived;
    return exports.FALLBACK_QTY_UNIT_CD;
}
/**
 * Resolve a product's packing-unit code to an RRA-accepted value: the stored
 * code when it is a real RRA code, otherwise 'CT'.
 */
function resolvePkgUnitCd(stored) {
    const s = (stored ?? '').trim().toUpperCase();
    if (s && exports.RRA_PKG_UNIT_CODES.has(s))
        return s;
    return exports.FALLBACK_PKG_UNIT_CD;
}
/**
 * Check if a payment method requires a purchase code (business TIN).
 * Business TINs are non-7-prefix; individual TINs start with 7.
 */
function requiresPurchaseCode(custTin) {
    const tin = custTin.trim();
    return tin.length === 9 && !tin.startsWith('7');
}

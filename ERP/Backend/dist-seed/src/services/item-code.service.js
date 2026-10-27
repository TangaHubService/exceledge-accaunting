"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PKG_UNIT_CD = exports.DEFAULT_ITEM_CLASSIFICATION_CD = void 0;
exports.getOriginNationCode = getOriginNationCode;
exports.itemTypeCodeDigit = itemTypeCodeDigit;
exports.deriveQtyUnitCd = deriveQtyUnitCd;
exports.buildItemCd = buildItemCd;
exports.allocateItemCd = allocateItemCd;
exports.allocateItemCdBlock = allocateItemCdBlock;
exports.isItemCdConflict = isItemCdConflict;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
/**
 * Generates and validates the RRA `itemCd` (VSDC API Documentation v1.0.5,
 * §4.17) and derives the `qtyUnitCd` companion field from the product's
 * measurement unit, since the UI only ever asks for `measurementUnit` and
 * `pkgUnitCd` — never the raw RRA codes.
 */
/**
 * Gets the origin nation code for an organization's product registration.
 * Falls back to 'RW' (Rwanda) if not configured.
 * Stored in OrganizationSetting.preferences.originCountryCode
 */
async function getOriginNationCode(organizationId, client = prisma_1.prisma) {
    const settings = await client.organizationSetting.findUnique({
        where: { organizationId },
        select: { preferences: true },
    });
    const prefs = settings?.preferences ?? {};
    return prefs.originCountryCode ?? 'RW';
}
/**
 * Fallback RRA item-classification code (§3.3.2.2) used when a product has
 * none set. There is no synced RRA classification-code list in this system
 * yet (that's a separate feature: pulling and caching `/itemClass/selectItemsClass`),
 * so this generic code is a known, documented compliance gap — not a bug.
 * It's shared across item registration and sale-time invoice lines, so both
 * always agree on classification even when no real code has been entered.
 *
 * Value verified live against the local RRA VSDC sandbox (POST
 * /items/saveItems, 2026-08-26): the previous placeholder here,
 * '5020230302', comes back `resultCd: "910"` ("Invalid item class code").
 * '5059690800' — the code used in the VSDC spec's own JSON examples — is
 * accepted (`resultCd: "000"`). Products can still override this via the
 * `itemClsCd` field. Product create/sync now require an explicit classification —
 * this constant remains only for legacy sale-line fallbacks that still need one.
 */
exports.DEFAULT_ITEM_CLASSIFICATION_CD = '5059690800';
// Fallback only for building itemCd when an older row lacks pkgUnitCd.
// New creates require an explicit packaging unit; product-sync refuses to invent one.
exports.DEFAULT_PKG_UNIT_CD = 'CT';
/** VSDC §4.3 Product Type: 1=Raw Material, 2=Finished Product, 3=Service. */
function itemTypeCodeDigit(itemType) {
    if (itemType === 'SERVICE')
        return '3';
    if (itemType === 'RAW_MATERIAL')
        return '1';
    return '2';
}
/**
 * Maps the app's MeasurementUnit enum to an RRA quantity-unit code (§4.6).
 * RRA's table has no millilitre code, so ML (and the catch-all OTHER) fall
 * back to the generic "unit/piece" code rather than a wrong volume unit.
 */
const QTY_UNIT_CD_BY_MEASUREMENT_UNIT = {
    PCS: 'U',
    KG: 'KG',
    LTR: 'LTR',
    MTR: 'MTR',
    BOX: 'BX',
    PAIR: 'PR',
    DOZEN: 'DZ',
    GRAM: 'GRM',
    ML: 'U',
    OTHER: 'U',
};
function deriveQtyUnitCd(measurementUnit) {
    return QTY_UNIT_CD_BY_MEASUREMENT_UNIT[measurementUnit ?? 'OTHER'] ?? 'U';
}
/**
 * Builds the itemCd candidate string per §4.17:
 *   <origin> + productTypeDigit + pkgUnitCd + qtyUnitCd + 7-digit sequence
 * e.g. "RW2CTKG0000012", "UG2NTBA0000013", "KE1CTKG0000014"
 *
 * Exported (as well as wrapped by `allocateItemCd` below) so bulk-import
 * flows can allocate a contiguous block of sequence numbers for one
 * `createMany` call instead of counting per row.
 */
function buildItemCd(itemType, pkgUnitCd, qtyUnitCd, seq, origin) {
    const typeDigit = itemTypeCodeDigit(itemType);
    const pkg = pkgUnitCd || exports.DEFAULT_PKG_UNIT_CD;
    return `${origin}${typeDigit}${pkg}${qtyUnitCd}${String(seq).padStart(7, '0')}`;
}
/**
 * Atomically reserves `increment` more sequence numbers for this org's
 * itemCd counter and returns the *last* one in the newly reserved block
 * (so a single allocation's number is the return value itself, and an
 * N-sized block is [returned-N+1 .. returned]).
 *
 * Uses the same INSERT..ON CONFLICT..RETURNING pattern as
 * VsdcDeviceCounter/OrganizationInvoiceCounter (rra-ebm.service.ts) —
 * Postgres has no native per-key auto-increment, so this hand-rolls one
 * scoped to `organizationId`. The first-ever call for an org seeds past the
 * count of items already carrying an itemCd (allocated under the older
 * count()-based scheme, or otherwise present), so a pre-existing sequence
 * is never reissued/collided with. Callers should run this inside the same
 * transaction as the row(s) that consume the number(s), so a reserved
 * sequence is never left unused (a permanent gap) if that insert fails.
 */
async function nextItemCdSequence(organizationId, increment, client = prisma_1.prisma) {
    const seed = await client.product.count({
        where: { organizationId, itemCd: { not: null } },
    });
    const rows = await client.$queryRaw `
    INSERT INTO "product_itemcd_counters" ("organizationId", "nextSequence", "updatedAt")
    VALUES (${organizationId}, ${seed + increment}, NOW())
    ON CONFLICT ("organizationId") DO UPDATE
    SET "nextSequence" = "product_itemcd_counters"."nextSequence" + ${increment},
        "updatedAt" = NOW()
    RETURNING "nextSequence"
  `;
    return Number(rows[0]?.nextSequence ?? 0);
}
/**
 * Allocates a fresh, unique itemCd for a product about to be created.
 * Pass the transaction's `tx` as `client` when creating the product inside a
 * `prisma.$transaction`, so the allocation rolls back together with it.
 */
async function allocateItemCd(organizationId, itemType, pkgUnitCd, qtyUnitCd, origin, client = prisma_1.prisma) {
    const seq = await nextItemCdSequence(organizationId, 1, client);
    return buildItemCd(itemType, pkgUnitCd, qtyUnitCd, seq, origin);
}
/**
 * Atomically reserves a contiguous block of `count` sequence numbers for a
 * bulk create — returns the base such that item `i` (0-indexed) uses
 * `base + i + 1`, matching `allocateItemCd`'s single-item numbering.
 * Note: The origin parameter is not used here since the block allocation
 * only reserves sequence numbers. The caller must use buildItemCd with
 * the appropriate origin for each product.
 */
async function allocateItemCdBlock(organizationId, count, client = prisma_1.prisma) {
    const last = await nextItemCdSequence(organizationId, count, client);
    return last - count;
}
/** True if `err` is a P2002 conflict on the (organizationId, itemCd) unique index. */
function isItemCdConflict(err) {
    if (!(err instanceof client_1.Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
        return false;
    }
    const target = err.meta?.target;
    const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return targetStr.includes('itemCd');
}

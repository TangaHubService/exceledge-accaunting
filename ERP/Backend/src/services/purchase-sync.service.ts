import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { isEbmEnabled, fix2, toRraDate, toRraDateTime } from './rra-ebm.service';
import {
  buildVsdcEnvelope,
  selectPurchases,
  savePurchase,
  saveStockMaster,
  validateVsdcEnvelope,
  toRraReqDt,
  type VsdcEnvelope,
} from './vsdc-api.service';
import { getCurrentStock, receiveStockOnBranch, resolveActiveBranchId } from './inventory-ledger.service';
import { allocateItemCd, getOriginNationCode, DEFAULT_PKG_UNIT_CD } from './item-code.service';
import { TaxService } from './tax.service';
import { getTaxationTypes } from './rra-code.service';
import { syncProductToRra, applySellingPriceOnReceipt } from './product-sync.service';
import { allocatePurchaseInvcNo } from './vsdc-purchase-counter.service';
import logger from '../utils/logger';

/**
 * RRA B2B purchases (RRA checklist §70, §71).
 *
 *  §70  syncRraPurchases()   — pull the B2B sales issued to this taxpayer
 *                              (/trnsPurchase/selectTrnsPurchaseSales) and
 *                              cache them for review.
 *  §71  confirmRraPurchase() — record/confirm a received purchase
 *                              (/trnsPurchase/savePurchases, pchsSttsCd='02'),
 *                              which also books the stock-in at RRA; then push
 *                              /stockMaster/saveStockMaster for remaining qty.
 *                              Reject sends pchsSttsCd='04' (Canceled) to VSDC.
 */

/** §4.11 Transaction Progress — used as pchsSttsCd. */
const PCHS_STTS = { APPROVED: '02', CANCELED: '04' } as const;

const CURSOR_RESOURCE = 'purchases';
/** Default VSDC lastReqDt when no purchases cursor row exists yet. */
/** VSDC §3.3.7.1 JSON sample uses 20190524000000 — use the same default when no cursor exists. */
export const PURCHASES_DEFAULT_LAST_REQ_DT = '20190524000000';

async function getCursor(organizationId: number): Promise<string> {
  const row = await prisma.rraSyncCursor.findUnique({
    where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
  });
  return row?.lastReqDt ?? PURCHASES_DEFAULT_LAST_REQ_DT;
}

/** Normalize a UI/API request date (yyyy-mm-dd or yyyyMMddHHmmss) to VSDC lastReqDt. */
function normalizePurchaseReqDt(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 14) return digits.slice(0, 14);
  if (digits.length >= 8) return `${digits.slice(0, 8)}000000`;
  return null;
}

async function saveCursor(organizationId: number, lastReqDt: string, result: string): Promise<void> {
  await prisma.rraSyncCursor.upsert({
    where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
    create: { organizationId, resource: CURSOR_RESOURCE, lastReqDt, lastRunAt: new Date(), lastResult: result },
    update: { lastReqDt, lastRunAt: new Date(), lastResult: result },
  });
}

/** Record a pull outcome without changing lastReqDt (empty / failed pulls).
 *  Creates the cursor row with the default lastReqDt if none exists yet so the UI can show it. */
async function touchCursorResult(organizationId: number, result: string): Promise<void> {
  const existing = await prisma.rraSyncCursor.findUnique({
    where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
    select: { id: true },
  });
  if (!existing) {
    await prisma.rraSyncCursor.create({
      data: {
        organizationId,
        resource: CURSOR_RESOURCE,
        lastReqDt: PURCHASES_DEFAULT_LAST_REQ_DT,
        lastRunAt: new Date(),
        lastResult: result,
      },
    });
    return;
  }
  await prisma.rraSyncCursor.updateMany({
    where: { organizationId, resource: CURSOR_RESOURCE },
    data: { lastRunAt: new Date(), lastResult: result },
  });
}

function mapPurchaseItems(itemList: any[] | undefined) {
  return (itemList ?? []).map((it: any, idx: number) => ({
    itemSeq: it.itemSeq ?? idx + 1,
    itemCd: it.itemCd ?? null,
    itemClsCd: it.itemClsCd ?? null,
    itemNm: it.itemNm ?? null,
    bcd: it.bcd ?? null,
    pkgUnitCd: it.pkgUnitCd ?? null,
    pkg: it.pkg ?? null,
    qtyUnitCd: it.qtyUnitCd ?? null,
    qty: it.qty ?? 0,
    prc: it.prc ?? 0,
    splyAmt: it.splyAmt ?? 0,
    dcRt: it.dcRt ?? null,
    dcAmt: it.dcAmt ?? null,
    taxTyCd: it.taxTyCd ?? null,
    taxblAmt: it.taxblAmt ?? null,
    taxAmt: it.taxAmt ?? null,
    totAmt: it.totAmt ?? null,
  }));
}

// ── §70: pull received purchases ─────────────────────────────

export async function syncRraPurchases(
  organizationId: number,
  opts: { branchId?: number | null; requestDate?: string } | number | null = {},
): Promise<{ ok: boolean; fetched: number; cached: number; lastReqDt: string; error?: string }> {
  if (!isEbmEnabled()) return { ok: false, fetched: 0, cached: 0, lastReqDt: '', error: 'EBM is not enabled' };

  // Backward compatible: syncRraPurchases(orgId, branchId) from the master-data job.
  const normalized =
    typeof opts === 'number' || opts === null
      ? { branchId: opts, requestDate: undefined as string | undefined }
      : opts;

  const prevCursor = await getCursor(organizationId);
  const requestDate = normalized.requestDate?.trim() || undefined;
  let since = prevCursor;
  if (requestDate) {
    const parsed = normalizePurchaseReqDt(requestDate);
    if (!parsed) {
      return { ok: false, fetched: 0, cached: 0, lastReqDt: prevCursor, error: 'Request date must be yyyy-mm-dd' };
    }
    since = parsed;
    // Persist an earlier/manual cursor so the UI "Last request" matches what VSDC will receive.
    if (since !== prevCursor) {
      await saveCursor(organizationId, since, `RESET: pull from ${since}`);
    }
  }

  const runAt = toRraReqDt(new Date());
  const envelope = await buildVsdcEnvelope(organizationId, normalized.branchId ?? null);
  const res = await selectPurchases(envelope, since);
  if (!res.success) {
    await touchCursorResult(organizationId, `FAILED: ${res.resultMsg}`);
    return { ok: false, fetched: 0, cached: 0, lastReqDt: since, error: `${res.resultCd}: ${res.resultMsg}` };
  }

  // The sandbox returns the list under `saleList` (per TrnsPurchaseSalesRes).
  const list = (res.data as any)?.saleList ?? (res.data as any)?.trnsPurchaseSalesList ?? [];
  let cached = 0;
  for (const p of list) {
    const spplrInvcNo = BigInt(p.spplrInvcNo ?? 0);
    const spplrTin = p.spplrTin ?? '';
    const prcOrdCd = typeof p.prcOrdCd === 'string' && p.prcOrdCd.trim() ? p.prcOrdCd.trim() : null;
    const existing = await prisma.rraPurchase.findUnique({
      where: { organizationId_spplrTin_spplrInvcNo: { organizationId, spplrTin, spplrInvcNo } },
      select: { id: true, status: true },
    });

    if (!existing) {
      await prisma.rraPurchase.create({
        data: {
          organizationId,
          spplrTin,
          spplrNm: p.spplrNm ?? null,
          spplrBhfId: p.spplrBhfId ?? null,
          spplrInvcNo,
          rcptTyCd: p.rcptTyCd ?? null,
          pmtTyCd: p.pmtTyCd ?? null,
          prcOrdCd,
          salesDt: p.salesDt ?? null,
          totItemCnt: p.totItemCnt ?? null,
          totTaxblAmt: p.totTaxblAmt ?? null,
          totTaxAmt: p.totTaxAmt ?? null,
          totAmt: p.totAmt ?? null,
          remark: p.remark ?? null,
          rawResponse: p as Prisma.InputJsonValue,
          items: { create: mapPurchaseItems(p.itemList) },
        },
      });
    } else {
      // Do not clobber a purchase the operator has already actioned.
      await prisma.rraPurchase.update({
        where: { id: existing.id },
        data: {
          rawResponse: p as Prisma.InputJsonValue,
          spplrNm: p.spplrNm ?? null,
          ...(prcOrdCd ? { prcOrdCd } : {}),
        },
      });
      // Refresh line items while still PENDING so a re-pull stays accurate.
      if (existing.status === 'PENDING') {
        await prisma.rraPurchaseItem.deleteMany({ where: { rraPurchaseId: existing.id } });
        await prisma.rraPurchaseItem.createMany({
          data: mapPurchaseItems(p.itemList).map((it) => ({ ...it, rraPurchaseId: existing.id })),
        });
      }
    }
    cached += 1;
  }

  if (cached === 0) {
    await touchCursorResult(organizationId, `OK: 0 purchases`);
    return { ok: true, fetched: 0, cached: 0, lastReqDt: since };
  }

  await saveCursor(organizationId, runAt, `OK: ${cached} purchases`);
  return { ok: true, fetched: list.length, cached, lastReqDt: runAt };
}

// ── §71: confirm / record a received purchase ────────────────

const A_D = ['A', 'B', 'C', 'D'] as const;
const TAX_RATES: Record<string, number> = { A: 0, B: 18, C: 0, D: 0 };

const QTY_UNIT_TO_MEASUREMENT: Record<string, string> = {
  U: 'PCS', KG: 'KG', LTR: 'LTR', MTR: 'MTR', BX: 'BOX', PR: 'PAIR', DZ: 'DOZEN', GRM: 'GRAM',
};

/** Per-line overrides sent when the operator confirms a purchase. */
export type PurchaseItemOverride = {
  itemId?: number;
  itemSeq?: number;
  /** Buyer's catalog name — sent to VSDC as `itemNm`; supplier name stays on `spplrItemNm`. */
  itemNm?: string;
  /** Existing local product to receive this line's stock. */
  linkProductId?: number;
  /** New selling price for the receiving product (supplier `prc` is the cost). */
  sellingPrice?: number;
  /** Expiry date of the received goods — sent to VSDC as `itemExprDt`. */
  expiryDate?: Date;
};

type PurchaseLine = {
  id: number;
  itemSeq: number;
  itemCd: string | null;
  itemClsCd: string | null;
  itemNm: string | null;
  bcd: string | null;
  pkgUnitCd: string | null;
  qtyUnitCd: string | null;
  taxTyCd: string | null;
  prc: { toNumber: () => number };
};

type ResolvedProduct = { id: number; name: string; itemCd: string | null };

function overrideFor(it: PurchaseLine, items?: PurchaseItemOverride[]): PurchaseItemOverride | undefined {
  if (!items?.length) return undefined;
  return items.find((o) =>
    (o.itemId != null && o.itemId === it.id) || (o.itemSeq != null && o.itemSeq === it.itemSeq),
  );
}

function localNameFor(it: PurchaseLine, ov?: PurchaseItemOverride): string {
  const named = ov?.itemNm?.trim();
  return named || it.itemNm?.trim() || 'Item';
}

async function createProductFromPurchaseLine(
  organizationId: number,
  it: PurchaseLine,
  localNm: string,
  sellingPrice?: number,
): Promise<ResolvedProduct> {
  const pkgUnitCd = it.pkgUnitCd?.trim() || DEFAULT_PKG_UNIT_CD;
  const qtyUnitCd = it.qtyUnitCd?.trim() || 'U';
  // §4.17: an itemCd starts with its 2-letter origin, so the supplier's RRA
  // code is a documented source when the organization has no default origin.
  const supplierOrigin = /^[A-Z]{2}(?=\d)/.exec(it.itemCd?.trim().toUpperCase() ?? '')?.[0] ?? null;
  const origin = (await getOriginNationCode(organizationId)) ?? supplierOrigin;
  const taxTyCd = (it.taxTyCd ?? '').trim().toUpperCase();
  const types = await getTaxationTypes(organizationId);
  const cachedTax = types.find((t) => t.code.toUpperCase() === taxTyCd);
  const taxCode = (cachedTax?.code ?? (types.find((t) => t.rate === 0)?.code) ?? taxTyCd) as 'A' | 'B' | 'C' | 'D';
  if (!taxCode) {
    throw new Error('Cannot create a product from this purchase line: no taxation type on the line and none cached (class 04)');
  }
  const prc = Math.abs(it.prc.toNumber());
  const itemCd = origin
    ? await allocateItemCd(organizationId, 'PRODUCT', pkgUnitCd, qtyUnitCd, origin)
    : null;
  const product = await prisma.product.create({
    data: {
      name: localNm,
      organizationId,
      unitPrice: sellingPrice && sellingPrice > 0 ? sellingPrice : prc,
      purchasePrice: prc,
      quantity: 0,
      taxCode,
      taxCategory: TaxService.getTaxCategory(taxCode),
      measurementUnit: (QTY_UNIT_TO_MEASUREMENT[qtyUnitCd] ?? 'PCS') as 'PCS' | 'KG' | 'LTR' | 'MTR' | 'BOX' | 'PAIR' | 'DOZEN' | 'GRAM' | 'OTHER',
      itemType: 'PRODUCT',
      itemCd,
      itemClsCd: it.itemClsCd ?? null,
      pkgUnitCd,
      qtyUnitCd,
      barcode: it.bcd?.trim() || null,
      origin,
    },
    select: { id: true, name: true, itemCd: true },
  });
  if (it.itemClsCd) {
    const sync = await syncProductToRra(product.id);
    if (!sync.success) {
      logger.warn(`[EBM] new product #${product.id} from purchase confirm did not sync to RRA: ${sync.error}`);
    }
  }
  return product;
}

async function resolvePurchaseLineProduct(
  organizationId: number,
  it: PurchaseLine,
  ov?: PurchaseItemOverride,
): Promise<{ product: ResolvedProduct; localNm: string } | { error: string }> {
  const localNm = localNameFor(it, ov);
  const select = { id: true, name: true, itemCd: true } as const;
  let product: ResolvedProduct | null = null;

  if (ov?.linkProductId != null) {
    product = await prisma.product.findFirst({
      where: { id: ov.linkProductId, organizationId, deletedAt: null },
      select,
    });
    if (!product) return { error: `Linked product ${ov.linkProductId} was not found` };
  }

  if (!product && it.itemCd) {
    product = await prisma.product.findFirst({
      where: { organizationId, itemCd: it.itemCd, deletedAt: null },
      select,
    });
  }

  if (!product) {
    product = await prisma.product.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        isActive: true,
        name: { equals: localNm, mode: 'insensitive' },
      },
      select,
    });
  }

  if (!product) {
    product = await createProductFromPurchaseLine(organizationId, it, localNm, ov?.sellingPrice);
  } else if (localNm !== product.name) {
    product = await prisma.product.update({
      where: { id: product.id },
      data: { name: localNm },
      select,
    });
  }

  return { product, localNm };
}

type PurchaseRow = {
  id: number;
  cisInvcNo?: number | null;
  spplrTin: string;
  spplrNm: string | null;
  spplrBhfId: string | null;
  spplrInvcNo: bigint;
  rcptTyCd: string | null;
  pmtTyCd: string | null;
  prcOrdCd?: string | null;
  remark: string | null;
  rawResponse: unknown;
  items: Array<PurchaseLine & {
    pkg: { toNumber: () => number } | null;
    qty: { toNumber: () => number };
    splyAmt: { toNumber: () => number } | null;
    dcRt: { toNumber: () => number } | null;
    dcAmt: { toNumber: () => number } | null;
    taxblAmt: { toNumber: () => number } | null;
    taxAmt: { toNumber: () => number } | null;
    totAmt: { toNumber: () => number } | null;
  }>;
};

/** Map sales rcptTyCd (S/R) from selectTrnsPurchaseSales → purchase rcptTyCd (P/R). */
function purchaseRcptTyCd(salesRcptTyCd: string | null): string {
  const PURCHASE_RCPT_TY_CD_BY_SALES_RCPT_TY_CD: Record<string, string> = { S: 'P', R: 'R' };
  return PURCHASE_RCPT_TY_CD_BY_SALES_RCPT_TY_CD[(salesRcptTyCd ?? '').toUpperCase()] ?? 'P';
}

function purchasePrcOrdCd(
  opts: { prcOrdCd?: string },
  rp: PurchaseRow,
): string | undefined {
  const fromOpts = opts.prcOrdCd?.trim();
  const fromRow = (rp as { prcOrdCd?: string }).prcOrdCd?.trim();
  const fromRaw = (rp.rawResponse as { prcOrdCd?: string } | null)?.prcOrdCd?.trim();
  const value = fromOpts || fromRow || fromRaw;
  return value || undefined;
}

/**
 * The CIS invcNo for this purchase document, allocated once and persisted so a
 * retry resends the same number. A confirm after a rejected attempt, or a
 * reject, reuses it too: it identifies the CIS's record of this purchase.
 */
async function cisInvcNoForRraPurchase(
  organizationId: number,
  rp: { id: number; cisInvcNo?: number | null },
  envelope: VsdcEnvelope,
  branchId: number | null | undefined,
): Promise<number> {
  if (rp.cisInvcNo && rp.cisInvcNo > 0) return rp.cisInvcNo;
  const allocated = await allocatePurchaseInvcNo(organizationId, envelope.bhfId, branchId);
  const claimed = await prisma.rraPurchase.updateMany({
    where: { id: rp.id, cisInvcNo: null },
    data: { cisInvcNo: allocated },
  });
  if (claimed.count === 1) return allocated;
  const current = await prisma.rraPurchase.findUnique({ where: { id: rp.id }, select: { cisInvcNo: true } });
  return current?.cisInvcNo ?? allocated;
}

/** spplrInvcNo is NUMBER(38) — only a purely numeric supplier reference fits. */
function numericSupplierInvcNo(ref: string | number | bigint | null | undefined): number | null {
  if (ref == null) return null;
  const s = String(ref).trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** §73 — refresh remaining qty after a stock change that skipped saveStockItems. */
async function pushStockMastersAfterPurchase(
  envelope: VsdcEnvelope,
  organizationId: number,
  branchId: number | null,
  products: Array<{ id: number; itemCd: string | null }>,
  regr: { id: string; name: string },
  rraPurchaseId: number,
): Promise<void> {
  const seen = new Set<number>();
  for (const product of products) {
    if (seen.has(product.id) || !product.itemCd) continue;
    seen.add(product.id);
    const onHand = await getCurrentStock(organizationId, product.id, branchId);
    const master = await saveStockMaster(envelope, product.itemCd, onHand, regr);
    if (!master.success) {
      logger.warn(
        `[EBM] purchase #${rraPurchaseId}: stock master push failed for ${product.itemCd}: ${master.error}`,
      );
    }
  }
}

/**
 * Reject a pending B2B purchase at VSDC (pchsSttsCd 04 Canceled) then mark local REJECTED.
 * When EBM is off, only the local status is updated.
 */
async function rejectRraPurchaseAtVsdc(
  organizationId: number,
  rp: PurchaseRow,
  opts: { branchId?: number | null; userId?: number; prcOrdCd?: string; remark?: string },
): Promise<{ success: boolean; error?: string }> {
  if (!isEbmEnabled()) {
    await prisma.rraPurchase.update({
      where: { id: rp.id },
      data: { status: 'REJECTED', remark: opts.remark?.trim() || rp.remark },
    });
    return { success: true };
  }

  const envelope = await buildVsdcEnvelope(organizationId, opts.branchId ?? null);
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
    : null;
  const regr = { id: String(user?.id ?? 'system'), name: user?.name ?? 'System' };
  const now = new Date();

  const taxblByBand: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const taxByBand: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const itemList = rp.items.map((it, idx) => {
    const band = (it.taxTyCd ?? '').toUpperCase();
    const slot = A_D.includes(band as typeof A_D[number]) ? band : 'A';
    const qty = Math.abs(it.qty.toNumber());
    const prc = Math.abs(it.prc.toNumber());
    const splyAmt = fix2(it.splyAmt != null ? Math.abs(it.splyAmt.toNumber()) : qty * prc);
    const taxAmt = it.taxAmt != null ? Math.abs(it.taxAmt.toNumber()) : 0;
    const lineTot = it.totAmt != null ? Math.abs(it.totAmt.toNumber()) : splyAmt;
    const taxblAmt = fix2(lineTot);
    taxblByBand[slot] = fix2(taxblByBand[slot] + taxblAmt);
    taxByBand[slot] = fix2(taxByBand[slot] + taxAmt);
    return {
      itemSeq: it.itemSeq ?? idx + 1,
      itemCd: it.itemCd ?? undefined,
      itemClsCd: it.itemClsCd ?? undefined,
      itemNm: it.itemNm ?? 'Item',
      bcd: it.bcd ?? undefined,
      spplrItemClsCd: it.itemClsCd ?? undefined,
      spplrItemCd: it.itemCd ?? undefined,
      spplrItemNm: it.itemNm ?? undefined,
      pkgUnitCd: it.pkgUnitCd ?? 'CT',
      pkg: it.pkg != null ? it.pkg.toNumber() : qty,
      qtyUnitCd: it.qtyUnitCd ?? 'U',
      qty,
      prc,
      splyAmt: taxblAmt,
      dcRt: it.dcRt != null ? it.dcRt.toNumber() : 0,
      dcAmt: it.dcAmt != null ? it.dcAmt.toNumber() : 0,
      taxblAmt,
      taxTyCd: slot,
      taxAmt,
      totAmt: taxblAmt,
      itemExprDt: null,
    };
  });

  const totTaxblAmt = fix2(A_D.reduce((s, b) => s + taxblByBand[b], 0));
  const totTaxAmt = fix2(A_D.reduce((s, b) => s + taxByBand[b], 0));
  const prcOrdCd = purchasePrcOrdCd(opts, rp);
  let invcNo: number;
  try {
    invcNo = await cisInvcNoForRraPurchase(organizationId, rp, envelope, opts.branchId);
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Purchase number allocation failed' };
  }

  const payload: Record<string, unknown> = {
    invcNo,
    orgInvcNo: 0,
    spplrTin: rp.spplrTin,
    spplrBhfId: rp.spplrBhfId ?? '00',
    spplrNm: rp.spplrNm ?? '',
    spplrInvcNo: numericSupplierInvcNo(rp.spplrInvcNo),
    regTyCd: 'M',
    pchsTyCd: 'N',
    ...(prcOrdCd ? { prcOrdCd } : {}),
    rcptTyCd: purchaseRcptTyCd(rp.rcptTyCd),
    pmtTyCd: rp.pmtTyCd ?? '01',
    pchsSttsCd: PCHS_STTS.CANCELED,
    cfmDt: toRraDateTime(now),
    pchsDt: toRraDate(now),
    wrhsDt: null,
    cnclReqDt: toRraDateTime(now),
    cnclDt: toRraDateTime(now),
    totItemCnt: itemList.length,
    taxblAmtA: taxblByBand.A, taxblAmtB: taxblByBand.B, taxblAmtC: taxblByBand.C, taxblAmtD: taxblByBand.D,
    taxRtA: TAX_RATES.A, taxRtB: TAX_RATES.B, taxRtC: TAX_RATES.C, taxRtD: TAX_RATES.D,
    taxAmtA: taxByBand.A, taxAmtB: taxByBand.B, taxAmtC: taxByBand.C, taxAmtD: taxByBand.D,
    totTaxblAmt,
    totTaxAmt,
    totAmt: totTaxblAmt,
    remark: opts.remark?.trim() || rp.remark || '',
    regrId: regr.id,
    regrNm: regr.name,
    modrId: regr.id,
    modrNm: regr.name,
    itemList,
  };

  try {
    const res = await savePurchase(envelope, payload);
    if (!res.success) {
      return { success: false, error: res.error ?? 'savePurchases (reject) failed' };
    }
    await prisma.rraPurchase.update({
      where: { id: rp.id },
      data: { status: 'REJECTED', remark: opts.remark?.trim() || rp.remark },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: { lastSuccessfulVdsContact: new Date() },
    });
    logger.info(`[EBM] rejected RRA purchase #${rp.id} at VSDC (pchsSttsCd=${PCHS_STTS.CANCELED})`);
    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Purchase rejection failed';
    logger.error(`[EBM] reject RRA purchase #${rp.id} failed`, e);
    return { success: false, error: message };
  }
}

export async function confirmRraPurchase(
  organizationId: number,
  rraPurchaseId: number,
  opts: {
    branchId?: number | null;
    userId?: number;
    reject?: boolean;
    prcOrdCd?: string;
    remark?: string;
    items?: PurchaseItemOverride[];
  } = {},
): Promise<{ success: boolean; error?: string }> {
  const rp = await prisma.rraPurchase.findFirst({
    where: { id: rraPurchaseId, organizationId },
    include: { items: { orderBy: { itemSeq: 'asc' } } },
  });
  if (!rp) return { success: false, error: 'Purchase not found' };
  if (rp.status !== 'PENDING') return { success: false, error: `Purchase already ${rp.status.toLowerCase()}` };

  if (opts.reject) {
    return rejectRraPurchaseAtVsdc(organizationId, rp as PurchaseRow, opts);
  }

  if (!isEbmEnabled()) return { success: false, error: 'EBM is not enabled' };

  const envelope = await buildVsdcEnvelope(organizationId, opts.branchId ?? null);
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
    : null;
  const regr = { id: String(user?.id ?? 'system'), name: user?.name ?? 'System' };

  const taxblByBand: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const taxByBand: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };

  const resolved: Array<{ product: ResolvedProduct; localNm: string }> = [];
  for (const it of rp.items) {
    const mapped = await resolvePurchaseLineProduct(organizationId, it, overrideFor(it, opts.items));
    if ('error' in mapped) return { success: false, error: mapped.error };
    resolved.push(mapped);
  }

  const itemList = rp.items.map((it, idx) => {
    const band = (it.taxTyCd ?? '').toUpperCase();
    const slot = A_D.includes(band as any) ? band : 'A';
    const qty = Math.abs(it.qty.toNumber());
    const prc = Math.abs(it.prc.toNumber());
    const splyAmt = fix2(it.splyAmt != null ? Math.abs(it.splyAmt.toNumber()) : qty * prc);
    const taxAmt = it.taxAmt != null ? Math.abs(it.taxAmt.toNumber()) : 0;
    // RRA TrnsPurchaseSaveReq sample (§3.3.7.2): tax-inclusive — taxblAmt == splyAmt == totAmt
    // with taxAmt extracted inside the gross (e.g. totTaxblAmt=10500, totTaxAmt=1890, totAmt=10500).
    const lineTot = it.totAmt != null ? Math.abs(it.totAmt.toNumber()) : splyAmt;
    const taxblAmt = fix2(lineTot);
    taxblByBand[slot] = fix2(taxblByBand[slot] + taxblAmt);
    taxByBand[slot] = fix2(taxByBand[slot] + taxAmt);
    const local = resolved[idx];
    const expiry = overrideFor(it, opts.items)?.expiryDate;
    // `itemNm` / `itemCd` are the buyer's catalog values; `spplr*` keep the
    // supplier's original name and code from the pulled sale.
    return {
      itemSeq: it.itemSeq ?? idx + 1,
      itemCd: local.product.itemCd ?? it.itemCd ?? undefined,
      itemClsCd: it.itemClsCd ?? undefined,
      itemNm: local.localNm,
      bcd: it.bcd ?? undefined,
      spplrItemClsCd: it.itemClsCd ?? undefined,
      spplrItemCd: it.itemCd ?? undefined,
      spplrItemNm: it.itemNm ?? undefined,
      pkgUnitCd: it.pkgUnitCd ?? 'CT',
      pkg: it.pkg != null ? it.pkg.toNumber() : qty,
      qtyUnitCd: it.qtyUnitCd ?? 'U',
      qty,
      prc,
      splyAmt: taxblAmt,
      dcRt: it.dcRt != null ? it.dcRt.toNumber() : 0,
      dcAmt: it.dcAmt != null ? it.dcAmt.toNumber() : 0,
      taxblAmt,
      taxTyCd: slot,
      taxAmt,
      totAmt: taxblAmt,
      itemExprDt: expiry ? toRraDate(expiry) : null,
    };
  });

  const totTaxblAmt = fix2(A_D.reduce((s, b) => s + taxblByBand[b], 0));
  const totTaxAmt = fix2(A_D.reduce((s, b) => s + taxByBand[b], 0));
  // Spec sample: totAmt equals totTaxblAmt (do NOT add totTaxAmt).
  const totAmt = totTaxblAmt;
  const now = new Date();
  const prcOrdCd = purchasePrcOrdCd(opts, rp as PurchaseRow);
  let invcNo: number;
  try {
    invcNo = await cisInvcNoForRraPurchase(organizationId, rp, envelope, opts.branchId);
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Purchase number allocation failed' };
  }

  const payload: Record<string, unknown> = {
    invcNo,
    orgInvcNo: 0,
    spplrTin: rp.spplrTin,
    spplrBhfId: rp.spplrBhfId ?? '00',
    spplrNm: rp.spplrNm ?? '',
    spplrInvcNo: numericSupplierInvcNo(rp.spplrInvcNo),
    regTyCd: 'M',
    pchsTyCd: 'N',
    // §38: purchase order code from the inbound sale (persisted on pull) or
    // an operator override supplied at confirm time.
    ...(prcOrdCd ? { prcOrdCd } : {}),
    rcptTyCd: purchaseRcptTyCd(rp.rcptTyCd),
    pmtTyCd: rp.pmtTyCd ?? '01',
    pchsSttsCd: PCHS_STTS.APPROVED, // §4.11 — 02 Approved (records the purchase + stock-in)
    cfmDt: toRraDateTime(now),
    pchsDt: toRraDate(now),
    wrhsDt: toRraDateTime(now),
    totItemCnt: itemList.length,
    taxblAmtA: taxblByBand.A, taxblAmtB: taxblByBand.B, taxblAmtC: taxblByBand.C, taxblAmtD: taxblByBand.D,
    taxRtA: TAX_RATES.A, taxRtB: TAX_RATES.B, taxRtC: TAX_RATES.C, taxRtD: TAX_RATES.D,
    taxAmtA: taxByBand.A, taxAmtB: taxByBand.B, taxAmtC: taxByBand.C, taxAmtD: taxByBand.D,
    totTaxblAmt,
    totTaxAmt,
    totAmt,
    remark: rp.remark ?? '',
    regrId: regr.id,
    regrNm: regr.name,
    modrId: regr.id,
    modrNm: regr.name,
    itemList,
  };

  try {
    const res = await savePurchase(envelope, payload);
    if (!res.success) {
      return { success: false, error: res.error ?? 'savePurchases failed' };
    }

    await prisma.rraPurchase.update({
      where: { id: rraPurchaseId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    // §74: a confirmed purchase must affect local stock in real time. RRA has
    // already booked the stock-in from /trnsPurchase/savePurchases (pchsSttsCd
    // 02), so these ledger rows are written with skipEbmSync — re-sending them
    // via /stock/saveStockItems would double-count the same receipt at the VSDC.
    // receiveStockOnBranch also upserts the branch batch POS/inventory read.
    const stockBranchId = await resolveActiveBranchId(organizationId, opts.branchId);
    let stockBooked = 0;
    if (stockBranchId != null) {
      for (let i = 0; i < rp.items.length; i++) {
        const it = rp.items[i];
        const ov = overrideFor(it, opts.items);
        await applySellingPriceOnReceipt(organizationId, resolved[i].product.id, ov?.sellingPrice, opts.userId);
        const qty = Math.round(Math.abs(it.qty.toNumber()) * 1000) / 1000;
        if (qty <= 0) continue;
        const reference = `RRA-PURCHASE-${rp.spplrTin}-${rp.spplrInvcNo}`;
        await receiveStockOnBranch({
          organizationId,
          productId: resolved[i].product.id,
          userId: opts.userId ?? 0,
          quantity: qty,
          movementType: 'PURCHASE',
          branchId: stockBranchId,
          unitCost: Math.abs(it.prc.toNumber()),
          reference,
          referenceType: 'RRA_PURCHASE',
          batchNumber: reference,
          expiryDate: ov?.expiryDate,
          note: `Confirmed RRA purchase from ${rp.spplrNm ?? rp.spplrTin}`,
          skipEbmSync: true,
        });
        stockBooked += 1;
      }

      // savePurchases books IO at RRA but not stock master — push remaining qty.
      await pushStockMastersAfterPurchase(
        envelope,
        organizationId,
        stockBranchId,
        resolved.map((r) => r.product),
        regr,
        rraPurchaseId,
      );
    } else {
      logger.warn(`[EBM] confirm RRA purchase #${rraPurchaseId}: no active branch — local stock not booked`);
    }

    await prisma.organization.update({
      where: { id: organizationId },
      data: { lastSuccessfulVdsContact: new Date() },
    });
    logger.info(`[EBM] confirmed RRA purchase #${rraPurchaseId} — ${stockBooked} item(s) booked into branch ${stockBranchId ?? '-'} stock`);
    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Purchase confirmation failed';
    logger.error(`[EBM] confirm RRA purchase #${rraPurchaseId} failed`, e);
    return { success: false, error: message };
  }
}

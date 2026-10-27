import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { config } from '../config';
import { isEbmEnabled, fix2, toRraDate, toRraDateTime } from './rra-ebm.service';
import { buildVsdcEnvelope, savePurchase, saveStockMaster, validateVsdcEnvelope } from './vsdc-api.service';
import { getCurrentStock } from './inventory-ledger.service';
import { getTaxRateForCode } from './rra-code.service';
import { bandTaxFromNet } from './money.service';
import { getOrganizationSettings } from './organization-settings.service';
import { allocatePurchaseInvcNo } from './vsdc-purchase-counter.service';
import logger from '../utils/logger';

/**
 * Local purchases from suppliers outside EBM (received purchase orders,
 * imported supplier invoices) registered at RRA through
 * /trnsPurchase/savePurchases with regTyCd 'M' (VSDC API v1.0.5 §3.3.7.2).
 *
 * Each receipt event is one row, written in the same transaction as its stock
 * so nothing is lost. savePurchases (pchsSttsCd 02) books the stock-in at RRA,
 * so the receipt's ledger rows are written with skipEbmSync — sending them
 * again through /stock/saveStockItems would double-count, exactly as for
 * confirmed EBM purchases. The CIS invcNo is allocated once and reused on
 * retry; a row already SYNCED is never resent.
 */

const A_D = ['A', 'B', 'C', 'D'] as const;

export type LocalPurchaseLine = {
  productId: number;
  quantity: number;
  /** Tax-inclusive unit cost paid to the supplier. */
  unitCost: number;
  expiryDate?: Date | string | null;
};

export type LocalPurchaseSource = 'PURCHASE_ORDER' | 'SUPPLIER_INVOICE';

/** Purchase registration follows the same switch as fiscal sales. */
export async function isLocalPurchaseRegistrationOn(organizationId: number): Promise<boolean> {
  if (!isEbmEnabled()) return false;
  const settings = await getOrganizationSettings(organizationId);
  return !!settings.featureFlags.ebmIntegrationEnabled;
}

export async function queueLocalPurchase(
  client: Prisma.TransactionClient | typeof prisma,
  input: {
    organizationId: number;
    branchId: number;
    sourceType: LocalPurchaseSource;
    sourceId: number;
    receiptKey: string;
    supplierTin?: string | null;
    supplierName?: string | null;
    supplierInvoiceRef?: string | null;
    userId?: number | null;
    lines: LocalPurchaseLine[];
  },
): Promise<{ id: number } | null> {
  const lines = input.lines.filter((l) => l.productId && l.quantity > 0);
  if (lines.length === 0) return null;
  return client.vsdcLocalPurchase.upsert({
    where: { receiptKey: input.receiptKey },
    create: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      receiptKey: input.receiptKey,
      spplrTin: input.supplierTin?.trim() || null,
      spplrNm: input.supplierName?.trim() || null,
      spplrInvcRef: input.supplierInvoiceRef?.trim() || null,
      userId: input.userId ?? null,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        expiryDate: l.expiryDate ? new Date(l.expiryDate).toISOString() : null,
      })) as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
    },
    update: {},
    select: { id: true },
  });
}

function numericRef(ref: string | null): number | null {
  const s = (ref ?? '').trim();
  return /^\d{1,15}$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

const inFlight = new Set<number>();

export async function registerLocalPurchase(id: number): Promise<{ success: boolean; error?: string }> {
  if (!isEbmEnabled()) return { success: true };
  if (inFlight.has(id)) return { success: false, error: 'Already being submitted' };
  inFlight.add(id);
  try {
    return await registerOne(id);
  } finally {
    inFlight.delete(id);
  }
}

async function fail(id: number, message: string): Promise<{ success: false; error: string }> {
  await prisma.vsdcLocalPurchase.update({
    where: { id },
    data: { status: 'FAILED', lastError: message, retryCount: { increment: 1 } },
  });
  return { success: false, error: message };
}

async function registerOne(id: number): Promise<{ success: boolean; error?: string }> {
  const row = await prisma.vsdcLocalPurchase.findUnique({ where: { id } });
  if (!row) return { success: false, error: 'Local purchase not found' };
  if (row.status === 'SYNCED') return { success: true };

  const envelope = await buildVsdcEnvelope(row.organizationId, row.branchId);
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return fail(id, envErr);

  const lines = (row.lines as unknown as LocalPurchaseLine[]) ?? [];
  const products = await prisma.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) }, organizationId: row.organizationId },
    select: { id: true, name: true, itemCd: true, itemClsCd: true, barcode: true, pkgUnitCd: true, qtyUnitCd: true, packagingQty: true, taxCode: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const taxblByBand: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const taxByBand: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const rateByBand: Record<string, number> = {};
  const itemList: Array<Record<string, unknown>> = [];
  for (const [idx, line] of lines.entries()) {
    const product = byId.get(line.productId);
    if (!product) return fail(id, `Product ${line.productId} not found`);
    if (!product.itemCd) return fail(id, `Product "${product.name}" has no itemCd — register it with RRA first`);
    if (!product.itemClsCd?.trim()) return fail(id, `Product "${product.name}" has no itemClsCd — select an RRA item classification first`);
    const band = (product.taxCode ?? '').toUpperCase();
    if (!A_D.includes(band as typeof A_D[number])) return fail(id, `Product "${product.name}" has no taxCode`);
    if (rateByBand[band] == null) rateByBand[band] = await getTaxRateForCode(row.organizationId, band);
    const qty = Math.abs(Number(line.quantity));
    const prc = fix2(Math.abs(Number(line.unitCost)));
    // Tax-inclusive, as on the confirmed-EBM-purchase payload: taxblAmt ==
    // splyAmt == totAmt, with the band VAT extracted from inside the gross.
    const splyAmt = fix2(qty * prc);
    const taxAmt = bandTaxFromNet(splyAmt, rateByBand[band]);
    taxblByBand[band] = fix2(taxblByBand[band] + splyAmt);
    taxByBand[band] = fix2(taxByBand[band] + taxAmt);
    const packSize = product.packagingQty && product.packagingQty > 0 ? product.packagingQty : 1;
    itemList.push({
      itemSeq: idx + 1,
      itemCd: product.itemCd,
      itemClsCd: product.itemClsCd,
      itemNm: product.name,
      bcd: product.barcode ?? null,
      spplrItemClsCd: null,
      spplrItemCd: null,
      spplrItemNm: null,
      pkgUnitCd: product.pkgUnitCd ?? 'CT',
      pkg: Math.ceil(qty / packSize),
      qtyUnitCd: product.qtyUnitCd ?? 'U',
      qty,
      prc,
      splyAmt,
      dcRt: 0,
      dcAmt: 0,
      taxblAmt: splyAmt,
      taxTyCd: band,
      taxAmt,
      totAmt: splyAmt,
      itemExprDt: line.expiryDate ? toRraDate(new Date(line.expiryDate)) : null,
    });
  }
  if (itemList.length === 0) return fail(id, 'Local purchase has no lines');

  let invcNo = row.cisInvcNo;
  if (!invcNo) {
    try {
      const allocated = await allocatePurchaseInvcNo(row.organizationId, envelope.bhfId, row.branchId);
      const claimed = await prisma.vsdcLocalPurchase.updateMany({ where: { id, cisInvcNo: null }, data: { cisInvcNo: allocated } });
      invcNo = claimed.count === 1
        ? allocated
        : (await prisma.vsdcLocalPurchase.findUnique({ where: { id }, select: { cisInvcNo: true } }))?.cisInvcNo ?? allocated;
    } catch (e: unknown) {
      return fail(id, e instanceof Error ? e.message : 'Purchase number allocation failed');
    }
  }

  const user = row.userId
    ? await prisma.user.findUnique({ where: { id: row.userId }, select: { id: true, name: true } })
    : null;
  const regr = { id: String(user?.id ?? 'system'), name: user?.name ?? 'System' };
  const taxRates = await Promise.all(A_D.map(async (b) => rateByBand[b] ?? getTaxRateForCode(row.organizationId, b)));
  const totTaxblAmt = fix2(A_D.reduce((s, b) => s + taxblByBand[b], 0));
  const totTaxAmt = fix2(A_D.reduce((s, b) => s + taxByBand[b], 0));
  const spplrTin = /^\d{9}$/.test(row.spplrTin ?? '') ? row.spplrTin : null;

  const payload: Record<string, unknown> = {
    invcNo,
    orgInvcNo: 0,
    spplrTin,
    spplrBhfId: null,
    spplrNm: row.spplrNm ? row.spplrNm.slice(0, 60) : null,
    spplrInvcNo: numericRef(row.spplrInvcRef),
    regTyCd: 'M',
    pchsTyCd: 'N',
    rcptTyCd: 'P',
    pmtTyCd: '01',
    pchsSttsCd: '02',
    cfmDt: toRraDateTime(row.createdAt),
    pchsDt: toRraDate(row.createdAt),
    wrhsDt: toRraDateTime(row.createdAt),
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: null,
    totItemCnt: itemList.length,
    taxblAmtA: taxblByBand.A, taxblAmtB: taxblByBand.B, taxblAmtC: taxblByBand.C, taxblAmtD: taxblByBand.D,
    taxRtA: taxRates[0], taxRtB: taxRates[1], taxRtC: taxRates[2], taxRtD: taxRates[3],
    taxAmtA: taxByBand.A, taxAmtB: taxByBand.B, taxAmtC: taxByBand.C, taxAmtD: taxByBand.D,
    totTaxblAmt,
    totTaxAmt,
    totAmt: totTaxblAmt,
    // A non-numeric supplier reference cannot go in spplrInvcNo (NUMBER).
    remark: row.spplrInvcRef ? `Supplier invoice ${row.spplrInvcRef}`.slice(0, 400) : null,
    regrId: regr.id,
    regrNm: regr.name,
    modrId: regr.id,
    modrNm: regr.name,
    itemList,
  };

  try {
    const res = await savePurchase(envelope, payload);
    if (!res.success) return fail(id, res.error ?? 'savePurchases failed');
    await prisma.$transaction([
      prisma.vsdcLocalPurchase.update({
        where: { id },
        data: { status: 'SYNCED', registeredAt: new Date(), lastError: null },
      }),
      prisma.organization.update({
        where: { id: row.organizationId },
        data: { lastSuccessfulVdsContact: new Date() },
      }),
    ]);
  } catch (e: unknown) {
    return fail(id, e instanceof Error ? e.message : 'savePurchases failed');
  }

  // savePurchases books the stock-in but not the stock master (§73).
  for (const product of products) {
    if (!product.itemCd) continue;
    const onHand = await getCurrentStock(row.organizationId, product.id, row.branchId);
    const master = await saveStockMaster(envelope, product.itemCd, onHand, regr);
    if (!master.success) {
      logger.warn(`[EBM] local purchase #${id}: stock master push failed for ${product.itemCd}: ${master.error}`);
    }
  }
  logger.info(`[EBM] local purchase #${id} (${row.sourceType} ${row.sourceId}) registered as CIS purchase ${invcNo}`);
  return { success: true };
}

export function registerLocalPurchaseAsync(id: number): void {
  registerLocalPurchase(id).catch((err) => logger.error(`[EBM] local purchase #${id} registration failed`, err));
}

/** Drain PENDING/FAILED local purchases (cron backstop). */
export async function processLocalPurchaseBatch(limit = 20): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (!isEbmEnabled()) return { processed: 0, succeeded: 0, failed: 0 };
  const rows = await prisma.vsdcLocalPurchase.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, retryCount: { lt: config.ebm.maxQueueRetries } },
    orderBy: [{ retryCount: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    const r = await registerLocalPurchase(row.id);
    if (r.success) succeeded += 1;
    else failed += 1;
  }
  return { processed: rows.length, succeeded, failed };
}

import { prisma } from '../lib/prisma';
import { isEbmEnabled } from './rra-ebm.service';
import { itemTypeCodeDigit } from './item-code.service';
import {
  buildVsdcEnvelope,
  toRraReqDt,
  selectCodes,
  selectItemsClass,
  selectCustomer,
  selectItems,
  selectNotices,
  type RraItemLVO,
} from './vsdc-api.service';
import logger from '../utils/logger';

/**
 * RRA VSDC master-data sync (RRA checklist §59, §61, §62, §64, §65).
 *
 * The Codes, Item-Classification and Notices lists are pulled incrementally
 * (each sync sends the stored `lastReqDt` so RRA only returns rows changed
 * since the last run) and cached locally so the CIS drives its own
 * dropdowns/enumerations from the authoritative list rather than hard-coded
 * tables. Customer lookup is on-demand (verify one TIN). Select-Item is a
 * reconciliation pull that diffs RRA's item registry against the local catalog.
 */

export type RraSyncResource = 'codes' | 'itemClasses' | 'notices' | 'items';

export interface RraSyncOutcome {
  resource: RraSyncResource;
  ok: boolean;
  fetched: number;
  upserted: number;
  error?: string;
  lastReqDt: string;
}

async function getCursor(organizationId: number, resource: RraSyncResource): Promise<string> {
  const row = await prisma.rraSyncCursor.findUnique({
    where: { organizationId_resource: { organizationId, resource } },
  });
  return row?.lastReqDt ?? '20200101000000';
}

async function saveCursor(
  organizationId: number,
  resource: RraSyncResource,
  lastReqDt: string,
  result: string,
): Promise<void> {
  await prisma.rraSyncCursor.upsert({
    where: { organizationId_resource: { organizationId, resource } },
    create: { organizationId, resource, lastReqDt, lastRunAt: new Date(), lastResult: result },
    update: { lastReqDt, lastRunAt: new Date(), lastResult: result },
  });
}

// ──────────────────────────────────────────────────────────────
// Codes (§59)
// ──────────────────────────────────────────────────────────────

export async function syncRraCodes(organizationId: number, branchId?: number | null): Promise<RraSyncOutcome> {
  const resource: RraSyncResource = 'codes';
  const since = await getCursor(organizationId, resource);
  const runAt = toRraReqDt(new Date());
  if (!isEbmEnabled()) {
    return { resource, ok: false, fetched: 0, upserted: 0, error: 'EBM is not enabled', lastReqDt: since };
  }

  const envelope = await buildVsdcEnvelope(organizationId, branchId ?? null);
  const res = await selectCodes(envelope, since);
  if (!res.success) {
    await saveCursor(organizationId, resource, since, `FAILED: ${res.resultMsg}`);
    return { resource, ok: false, fetched: 0, upserted: 0, error: `${res.resultCd}: ${res.resultMsg}`, lastReqDt: since };
  }

  const classes = res.data?.clsList ?? [];
  let fetched = 0;
  let upserted = 0;
  for (const cls of classes) {
    for (const dtl of cls.dtlList ?? []) {
      fetched += 1;
      await prisma.rraCode.upsert({
        where: { organizationId_cdCls_cd: { organizationId, cdCls: cls.cdCls, cd: dtl.cd } },
        create: {
          organizationId,
          cdCls: cls.cdCls,
          cdClsNm: cls.cdClsNm ?? null,
          cd: dtl.cd,
          cdNm: dtl.cdNm ?? null,
          cdDesc: dtl.cdDesc ?? null,
          useYn: dtl.useYn ?? 'Y',
          srtOrd: dtl.srtOrd ?? null,
          userDfnCd1: dtl.userDfnCd1 ?? null,
          userDfnCd2: dtl.userDfnCd2 ?? null,
          userDfnCd3: dtl.userDfnCd3 ?? null,
        },
        update: {
          cdClsNm: cls.cdClsNm ?? null,
          cdNm: dtl.cdNm ?? null,
          cdDesc: dtl.cdDesc ?? null,
          useYn: dtl.useYn ?? 'Y',
          srtOrd: dtl.srtOrd ?? null,
          userDfnCd1: dtl.userDfnCd1 ?? null,
          userDfnCd2: dtl.userDfnCd2 ?? null,
          userDfnCd3: dtl.userDfnCd3 ?? null,
          lastSyncedAt: new Date(),
        },
      });
      upserted += 1;
    }
  }

  const byClass = new Map<string, number>();
  for (const cls of classes) {
    byClass.set(cls.cdCls, (cls.dtlList ?? []).length);
  }
  logger.info(
    `[RRA][CODES] synced org=${organizationId} fetched=${fetched} upserted=${upserted} ` +
    `classes=${[...byClass.entries()].map(([id, n]) => `${id}:${n}`).join(',')}`,
  );

  await saveCursor(organizationId, resource, runAt, `OK: ${upserted} codes`);
  return { resource, ok: true, fetched, upserted, lastReqDt: runAt };
}

// ──────────────────────────────────────────────────────────────
// Item classification / UNSPSC (§61)
// ──────────────────────────────────────────────────────────────

export async function syncRraItemClasses(organizationId: number, branchId?: number | null): Promise<RraSyncOutcome> {
  const resource: RraSyncResource = 'itemClasses';
  const since = await getCursor(organizationId, resource);
  const runAt = toRraReqDt(new Date());
  if (!isEbmEnabled()) {
    return { resource, ok: false, fetched: 0, upserted: 0, error: 'EBM is not enabled', lastReqDt: since };
  }

  const envelope = await buildVsdcEnvelope(organizationId, branchId ?? null);
  const res = await selectItemsClass(envelope, since);
  if (!res.success) {
    await saveCursor(organizationId, resource, since, `FAILED: ${res.resultMsg}`);
    return { resource, ok: false, fetched: 0, upserted: 0, error: `${res.resultCd}: ${res.resultMsg}`, lastReqDt: since };
  }

  const list = res.data?.itemClsList ?? [];
  let upserted = 0;
  for (const cls of list) {
    await prisma.rraItemClass.upsert({
      where: { organizationId_itemClsCd: { organizationId, itemClsCd: cls.itemClsCd } },
      create: {
        organizationId,
        itemClsCd: cls.itemClsCd,
        itemClsNm: cls.itemClsNm ?? null,
        itemClsLvl: cls.itemClsLvl ?? null,
        taxTyCd: cls.taxTyCd ?? null,
        mjrTgYn: cls.mjrTgYn ?? null,
        useYn: cls.useYn ?? 'Y',
      },
      update: {
        itemClsNm: cls.itemClsNm ?? null,
        itemClsLvl: cls.itemClsLvl ?? null,
        taxTyCd: cls.taxTyCd ?? null,
        mjrTgYn: cls.mjrTgYn ?? null,
        useYn: cls.useYn ?? 'Y',
        lastSyncedAt: new Date(),
      },
    });
    upserted += 1;
  }

  await saveCursor(organizationId, resource, runAt, `OK: ${upserted} classes`);
  return { resource, ok: true, fetched: list.length, upserted, lastReqDt: runAt };
}

// ──────────────────────────────────────────────────────────────
// Notices (§65)
// ──────────────────────────────────────────────────────────────

export async function syncRraNotices(organizationId: number, branchId?: number | null): Promise<RraSyncOutcome> {
  const resource: RraSyncResource = 'notices';
  const since = await getCursor(organizationId, resource);
  const runAt = toRraReqDt(new Date());
  if (!isEbmEnabled()) {
    return { resource, ok: false, fetched: 0, upserted: 0, error: 'EBM is not enabled', lastReqDt: since };
  }

  const envelope = await buildVsdcEnvelope(organizationId, branchId ?? null);
  const res = await selectNotices(envelope, since);
  if (!res.success) {
    await saveCursor(organizationId, resource, since, `FAILED: ${res.resultMsg}`);
    return { resource, ok: false, fetched: 0, upserted: 0, error: `${res.resultCd}: ${res.resultMsg}`, lastReqDt: since };
  }

  const list = res.data?.noticeList ?? [];
  let upserted = 0;
  for (const n of list) {
    await prisma.rraNotice.upsert({
      where: { organizationId_noticeNo: { organizationId, noticeNo: n.noticeNo } },
      create: {
        organizationId,
        noticeNo: n.noticeNo,
        title: n.title ?? null,
        cont: n.cont ?? null,
        dtlUrl: n.dtlUrl ?? null,
        regrNm: n.regrNm ?? null,
        regDt: n.regDt ?? null,
      },
      update: {
        title: n.title ?? null,
        cont: n.cont ?? null,
        dtlUrl: n.dtlUrl ?? null,
        regrNm: n.regrNm ?? null,
        regDt: n.regDt ?? null,
      },
    });
    upserted += 1;
  }

  await saveCursor(organizationId, resource, runAt, `OK: ${upserted} notices`);
  return { resource, ok: true, fetched: list.length, upserted, lastReqDt: runAt };
}

// ──────────────────────────────────────────────────────────────
// Customer lookup (§62)
// ──────────────────────────────────────────────────────────────

export async function verifyCustomerTin(
  organizationId: number,
  custmTin: string,
  opts: { branchId?: number | null; customerId?: number } = {},
): Promise<{ found: boolean; taxprNm?: string; taxprSttsCd?: string; raw?: unknown; error?: string }> {
  if (!isEbmEnabled()) {
    return { found: false, error: 'EBM is not enabled' };
  }
  const tin = custmTin.trim();
  if (!/^\d{9}$/.test(tin)) {
    return { found: false, error: 'A customer TIN must be 9 digits' };
  }

  const envelope = await buildVsdcEnvelope(organizationId, opts.branchId ?? null);
  const res = await selectCustomer(envelope, tin);
  if (!res.success) {
    return { found: false, error: `${res.resultCd}: ${res.resultMsg}` };
  }
  const match = (res.data?.custList ?? []).find((c) => (c.tin ?? '').trim() === tin) ?? res.data?.custList?.[0];
  if (!match) {
    return { found: false, raw: res.raw };
  }

  if (opts.customerId != null) {
    await prisma.customer.updateMany({
      where: { id: opts.customerId, organizationId },
      data: {
        rraVerifiedName: match.taxprNm ?? null,
        rraTaxprSttsCd: match.taxprSttsCd ?? null,
        rraVerifiedAt: new Date(),
      },
    });
  }

  return { found: true, taxprNm: match.taxprNm, taxprSttsCd: match.taxprSttsCd, raw: res.raw };
}

// ──────────────────────────────────────────────────────────────
// Select Item — RRA-side reconciliation (§64)
// ──────────────────────────────────────────────────────────────

export interface RraItemDiff {
  rraOnly: RraItemLVO[];
  localOnly: Array<{ id: number; name: string; itemCd: string | null; ebmSyncStatus: string | null }>;
  mismatched: Array<{ productId: number; productName: string; itemCd: string; field: string; rra: string | number | null; local: string | number | null }>;
}

export async function pullRraItems(
  organizationId: number,
  branchId?: number | null,
): Promise<{ ok: boolean; items: RraItemLVO[]; diff: RraItemDiff; error?: string }> {
  const emptyDiff: RraItemDiff = { rraOnly: [], localOnly: [], mismatched: [] };
  if (!isEbmEnabled()) {
    return { ok: false, items: [], diff: emptyDiff, error: 'EBM is not enabled' };
  }

  const since = await getCursor(organizationId, 'items');
  const runAt = toRraReqDt(new Date());
  const envelope = await buildVsdcEnvelope(organizationId, branchId ?? null);
  const res = await selectItems(envelope, since);
  if (!res.success) {
    await saveCursor(organizationId, 'items', since, `FAILED: ${res.resultMsg}`);
    return { ok: false, items: [], diff: emptyDiff, error: `${res.resultCd}: ${res.resultMsg}` };
  }

  const rraItems = res.data?.itemList ?? [];
  const localProducts = await prisma.product.findMany({
    where: { organizationId },
    select: { id: true, name: true, itemCd: true, itemClsCd: true, itemType: true, taxCode: true, unitPrice: true, ebmSyncStatus: true, origin: true, pkgUnitCd: true, qtyUnitCd: true },
  });
  const localByCd = new Map(localProducts.filter((p) => p.itemCd).map((p) => [p.itemCd as string, p]));
  const rraByCd = new Map(rraItems.map((i) => [i.itemCd, i]));

  const diff: RraItemDiff = { rraOnly: [], localOnly: [], mismatched: [] };
  for (const item of rraItems) {
    const local = localByCd.get(item.itemCd);
    if (!local) {
      diff.rraOnly.push(item);
      continue;
    }
    if (item.itemClsCd && local.itemClsCd && item.itemClsCd !== local.itemClsCd) {
      diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'itemClsCd', rra: item.itemClsCd, local: local.itemClsCd });
    }
    if (item.itemTyCd && item.itemTyCd !== itemTypeCodeDigit(local.itemType)) {
      diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'itemTyCd', rra: item.itemTyCd, local: itemTypeCodeDigit(local.itemType) });
    }
    if (item.orgnNatCd && local.origin && item.orgnNatCd !== local.origin) {
      diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'orgnNatCd', rra: item.orgnNatCd, local: local.origin });
    }
    if (item.pkgUnitCd && local.pkgUnitCd && item.pkgUnitCd !== local.pkgUnitCd) {
      diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'pkgUnitCd', rra: item.pkgUnitCd, local: local.pkgUnitCd });
    }
    if (item.qtyUnitCd && local.qtyUnitCd && item.qtyUnitCd !== local.qtyUnitCd) {
      diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'qtyUnitCd', rra: item.qtyUnitCd, local: local.qtyUnitCd });
    }
    if (item.taxTyCd && local.taxCode && item.taxTyCd !== local.taxCode) {
      diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'taxTyCd', rra: item.taxTyCd, local: local.taxCode });
    }
  }
  for (const p of localProducts) {
    if (p.itemCd && !rraByCd.has(p.itemCd)) {
      diff.localOnly.push({ id: p.id, name: p.name, itemCd: p.itemCd, ebmSyncStatus: p.ebmSyncStatus ?? null });
    }
  }

  await saveCursor(organizationId, 'items', runAt, `OK: ${rraItems.length} items pulled`);
  return { ok: true, items: rraItems, diff };
}

// ──────────────────────────────────────────────────────────────
// Bulk sync (cron entry point)
// ──────────────────────────────────────────────────────────────

export async function syncAllRraMasterData(organizationId: number, branchId?: number | null): Promise<RraSyncOutcome[]> {
  const outcomes: RraSyncOutcome[] = [];
  for (const fn of [syncRraCodes, syncRraItemClasses, syncRraNotices]) {
    try {
      outcomes.push(await fn(organizationId, branchId));
    } catch (e) {
      logger.error(`[RRA-MASTER-DATA] org ${organizationId} ${fn.name} failed`, e);
      outcomes.push({
        resource: 'codes',
        ok: false,
        fetched: 0,
        upserted: 0,
        error: e instanceof Error ? e.message : 'sync failed',
        lastReqDt: '',
      });
    }
  }
  return outcomes;
}

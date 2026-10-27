import type { Response } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { prisma } from '../lib/prisma';
import { success, error as apiError } from '../utils/apiResponse';
import {
  syncRraCodes,
  syncRraItemClasses,
  syncRraNotices,
  syncAllRraMasterData,
  verifyCustomerTin,
  pullRraItems,
} from '../services/rra-master-data.service';
import { processStockSyncBatch, queuePendingStockForOrg } from '../services/stock-movement-sync.service';
import { syncRraPurchases, confirmRraPurchase } from '../services/purchase-sync.service';
import { syncRraImports, actionRraImport } from '../services/rra-import.service';
import { syncProductToRra } from '../services/product-sync.service';
import { RraTaxCode } from '@prisma/client';
import { getRefundReasonCodesForOrg, getPaymentMethodMappings, DEFAULT_RFD_RSN_CD, getRraCodeCatalog } from '../services/rra-code.service';
import {
  syncRraBranches,
  syncCustomerToRra,
  syncUserToRra,
  syncRraStockMoves,
  applyRraStockMoves,
  syncBomComponentToRra,
  syncInsuranceToRra,
} from '../services/rra-branch-sync.service';
import { getOrganizationSettings } from '../services/organization-settings.service';
import { config } from '../config';
import { isEbmEnabled } from '../services/rra-ebm.service';

const branchOf = (req: BranchAuthRequest): number | null => {
  const b = req.query.branchId ?? req.body?.branchId;
  return b != null && b !== '' ? parseInt(String(b)) : null;
};

const parsePositiveNumber = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const parseOptionalDate = (v: unknown): Date | undefined => {
  if (v == null || v === '') return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// ── Codes (§59) ───────────────────────────────────────────────

export async function syncCodes(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const outcome = await syncRraCodes(organizationId, branchOf(req));
    return outcome.ok ? res.json(success(outcome)) : res.status(502).json(apiError(outcome.error ?? 'Code sync failed', undefined, outcome));
  } catch (e: any) {
    console.error('[RRA codes sync]', e);
    res.status(500).json(apiError('Failed to sync RRA codes'));
  }
}

export async function listCodes(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const cdCls = req.query.cdCls as string | undefined;
    const rows = await prisma.rraCode.findMany({
      where: { organizationId, ...(cdCls ? { cdCls } : {}) },
      orderBy: [{ cdCls: 'asc' }, { srtOrd: 'asc' }, { cd: 'asc' }],
    });
    // Group by class for the caller's dropdowns.
    const byClass: Record<string, { cdClsNm: string | null; codes: typeof rows }> = {};
    for (const r of rows) {
      (byClass[r.cdCls] ??= { cdClsNm: r.cdClsNm, codes: [] as any }).codes.push(r);
    }
    res.json(success({ classes: byClass, count: rows.length }));
  } catch (e: any) {
    console.error('[RRA codes list]', e);
    res.status(500).json(apiError('Failed to list RRA codes'));
  }
}

// ── Item classification / UNSPSC (§61) ────────────────────────

export async function syncItemClasses(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const outcome = await syncRraItemClasses(organizationId, branchOf(req));
    return outcome.ok ? res.json(success(outcome)) : res.status(502).json(apiError(outcome.error ?? 'Item-class sync failed', undefined, outcome));
  } catch (e: any) {
    console.error('[RRA item-class sync]', e);
    res.status(500).json(apiError('Failed to sync RRA item classifications'));
  }
}

export async function searchItemClasses(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const q = (req.query.q as string | undefined)?.trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 100);
    const rows = await prisma.rraItemClass.findMany({
      where: {
        organizationId,
        useYn: 'Y',
        ...(q
          ? { OR: [{ itemClsCd: { contains: q } }, { itemClsNm: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: [{ itemClsLvl: 'desc' }, { itemClsCd: 'asc' }],
      take: limit,
    });
    const total = await prisma.rraItemClass.count({ where: { organizationId } });
    res.json(success({ items: rows, cachedTotal: total }));
  } catch (e: any) {
    console.error('[RRA item-class search]', e);
    res.status(500).json(apiError('Failed to search RRA item classifications'));
  }
}

// ── Notices (§65) ─────────────────────────────────────────────

export async function syncNotices(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const outcome = await syncRraNotices(organizationId, branchOf(req));
    return outcome.ok ? res.json(success(outcome)) : res.status(502).json(apiError(outcome.error ?? 'Notice sync failed', undefined, outcome));
  } catch (e: any) {
    console.error('[RRA notices sync]', e);
    res.status(500).json(apiError('Failed to sync RRA notices'));
  }
}

export async function listNotices(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const [notices, unread] = await Promise.all([
      prisma.rraNotice.findMany({ where: { organizationId }, orderBy: { noticeNo: 'desc' }, take: 200 }),
      prisma.rraNotice.count({ where: { organizationId, readAt: null } }),
    ]);
    res.json(success({ notices, unread }));
  } catch (e: any) {
    console.error('[RRA notices list]', e);
    res.status(500).json(apiError('Failed to list RRA notices'));
  }
}

export async function markNoticeRead(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const noticeNo = parseInt(req.params.noticeNo);
    const updated = await prisma.rraNotice.updateMany({
      where: { organizationId, noticeNo, readAt: null },
      data: { readAt: new Date() },
    });
    res.json(success({ updated: updated.count }));
  } catch (e: any) {
    console.error('[RRA notice read]', e);
    res.status(500).json(apiError('Failed to update the notice'));
  }
}

// ── Customer verification (§62) ───────────────────────────────

export async function verifyCustomer(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const tin = String(req.params.tin ?? req.query.tin ?? '').trim();
    const customerId = req.query.customerId ? parseInt(req.query.customerId as string) : undefined;
    const result = await verifyCustomerTin(organizationId, tin, { branchId: branchOf(req), customerId });
    if (result.error) return res.status(502).json(apiError(result.error));
    res.json(success(result));
  } catch (e: any) {
    console.error('[RRA customer verify]', e);
    res.status(500).json(apiError('Failed to verify the customer TIN with RRA'));
  }
}

// ── Select Item reconciliation (§64) ──────────────────────────

/**
 * POST /:organizationId/rra/items/:productId/sync
 * Force-register one product with RRA (used by the reconcile view to push a
 * local-only item, or to apply RRA's value on a mismatch then re-register).
 * Optional body: { itemClsCd?, taxCode? } — applied to the product first.
 */
export async function syncOneProduct(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const productId = parseInt(req.params.productId);
    const { itemClsCd, taxCode } = req.body ?? {};

    const product = await prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
    if (!product) return res.status(404).json(apiError('Product not found'));

    const data: any = { ebmSyncStatus: 'PENDING' }; // clear the SYNCED skip-guard so a re-register runs
    if (typeof itemClsCd === 'string' && itemClsCd.trim()) data.itemClsCd = itemClsCd.trim();
    if (typeof taxCode === 'string' && (RraTaxCode as any)[taxCode]) data.taxCode = taxCode;
    await prisma.product.update({ where: { id: productId }, data });

    const result = await syncProductToRra(productId, (req as any).user?.userId);
    return result.success
      ? res.json(success({ productId, ...result }))
      : res.status(502).json(apiError(result.error ?? 'Product sync failed'));
  } catch (e: any) {
    console.error('[RRA item sync]', e);
    res.status(500).json(apiError('Failed to sync the product with RRA'));
  }
}

export async function reconcileItems(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const result = await pullRraItems(organizationId, branchOf(req));
    if (!result.ok) return res.status(502).json(apiError(result.error ?? 'Item reconciliation failed'));
    res.json(success({
      pulled: result.items.length,
      diff: {
        rraOnly: result.diff.rraOnly.length,
        localOnly: result.diff.localOnly.length,
        mismatched: result.diff.mismatched.length,
      },
      details: result.diff,
    }));
  } catch (e: any) {
    console.error('[RRA item reconcile]', e);
    res.status(500).json(apiError('Failed to reconcile items with RRA'));
  }
}

// ── Combined sync + status ───────────────────────────────────

export async function syncAll(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const outcomes = await syncAllRraMasterData(organizationId, branchOf(req));
    res.json(success({ outcomes }));
  } catch (e: any) {
    console.error('[RRA master-data sync all]', e);
    res.status(500).json(apiError('Failed to sync RRA master data'));
  }
}

// ── Stock In/Out + Stock Master (§23, §72, §73) ──────────────

export async function syncStock(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const queued = await queuePendingStockForOrg(organizationId);
    const result = await processStockSyncBatch(50);
    res.json(success({ queued, ...result }));
  } catch (e: any) {
    console.error('[RRA stock sync]', e);
    res.status(500).json(apiError('Failed to sync stock with RRA'));
  }
}

export async function stockSyncStatus(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const ledgerSelect = {
      id: true,
      movementType: true,
      quantity: true,
      direction: true,
      reference: true,
      referenceType: true,
      ebmError: true,
      ebmSyncStatus: true,
      createdAt: true,
      product: { select: { name: true, itemCd: true } },
    } as const;
    const grouped = await prisma.inventoryLedger.groupBy({
      by: ['ebmSyncStatus'],
      where: { organizationId },
      _count: true,
    });
    const counts: Record<string, number> = { PENDING: 0, SYNCED: 0, FAILED: 0, NOT_APPLICABLE: 0 };
    for (const g of grouped) counts[g.ebmSyncStatus ?? 'NOT_APPLICABLE'] = (g as any)._count;
    const [failures, pending] = await Promise.all([
      prisma.inventoryLedger.findMany({
        where: { organizationId, ebmSyncStatus: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: ledgerSelect,
      }),
      prisma.inventoryLedger.findMany({
        where: { organizationId, ebmSyncStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: ledgerSelect,
      }),
    ]);
    const toRow = (r: (typeof failures)[number]) => ({
      ...r,
      quantity: r.quantity != null ? Number(r.quantity) : 0,
    });
    res.json(success({
      counts,
      failures: failures.map(toRow),
      pending: pending.map(toRow),
    }));
  } catch (e: any) {
    console.error('[RRA stock status]', e);
    res.status(500).json(apiError('Failed to read stock-sync status'));
  }
}

// ── B2B purchases (§70, §71) ─────────────────────────────────

async function loadPurchasesPayload(organizationId: number, status?: string) {
  const [rows, pending, cursor] = await Promise.all([
    prisma.rraPurchase.findMany({
      where: { organizationId, ...(status ? { status: status as any } : {}) },
      include: { items: { orderBy: { itemSeq: 'asc' } } },
      orderBy: { pulledAt: 'desc' },
      take: 200,
    }),
    prisma.rraPurchase.count({ where: { organizationId, status: 'PENDING' } }),
    prisma.rraSyncCursor.findUnique({
      where: { organizationId_resource: { organizationId, resource: 'purchases' } },
    }),
  ]);
  // Normalize Prisma Decimal / BigInt so the client always gets plain JSON.
  const purchases = rows.map((r) => ({
    ...r,
    spplrInvcNo: r.spplrInvcNo.toString(),
    totTaxblAmt: r.totTaxblAmt != null ? Number(r.totTaxblAmt) : null,
    totTaxAmt: r.totTaxAmt != null ? Number(r.totTaxAmt) : null,
    totAmt: r.totAmt != null ? Number(r.totAmt) : null,
    items: r.items.map((it) => ({
      ...it,
      pkg: it.pkg != null ? Number(it.pkg) : null,
      qty: Number(it.qty),
      prc: Number(it.prc),
      splyAmt: Number(it.splyAmt),
      dcRt: it.dcRt != null ? Number(it.dcRt) : null,
      dcAmt: it.dcAmt != null ? Number(it.dcAmt) : null,
      taxblAmt: it.taxblAmt != null ? Number(it.taxblAmt) : null,
      taxAmt: it.taxAmt != null ? Number(it.taxAmt) : null,
      totAmt: it.totAmt != null ? Number(it.totAmt) : null,
    })),
  }));
  return {
    purchases,
    pending,
    lastRequestDate: cursor?.lastReqDt ?? '20190524000000',
    lastRunAt: cursor?.lastRunAt ?? null,
    lastResult: cursor?.lastResult ?? null,
  };
}

export async function syncPurchases(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const rawDate = (req.body?.requestDate ?? req.query.requestDate) as string | undefined;
    const requestDate = typeof rawDate === 'string' && rawDate.trim() ? rawDate.trim() : undefined;
    const result = await syncRraPurchases(organizationId, { branchId: branchOf(req), requestDate });
    if (!result.ok) {
      return res.status(502).json(apiError(result.error ?? 'Purchase sync failed'));
    }
    // Return the refreshed list in the same response so the UI updates immediately.
    const payload = await loadPurchasesPayload(organizationId);
    return res.json(success({
      ...result,
      ...payload,
      lastRequestDate: payload.lastRequestDate ?? result.lastReqDt,
    }));
  } catch (e: any) {
    console.error('[RRA purchases sync]', e);
    res.status(500).json(apiError('Failed to pull purchases from RRA'));
  }
}

const RRA_PURCHASE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'REJECTED']);

export async function listRraPurchases(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const status = rawStatus ? rawStatus.toUpperCase() : undefined;
    if (status && !RRA_PURCHASE_STATUSES.has(status)) {
      return res.status(400).json(apiError('Invalid status filter — use PENDING, CONFIRMED, or REJECTED'));
    }
    res.json(success(await loadPurchasesPayload(organizationId, status)));
  } catch (e: any) {
    console.error('[RRA purchases list]', e);
    res.status(500).json(apiError('Failed to list RRA purchases'));
  }
}

export async function confirmPurchase(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const reject = req.query.reject === 'true' || req.body?.reject === true;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .map((it: any) => ({
        itemId: it?.itemId != null ? parseInt(String(it.itemId), 10) : undefined,
        itemSeq: it?.itemSeq != null ? parseInt(String(it.itemSeq), 10) : undefined,
        itemNm: typeof it?.itemNm === 'string' ? it.itemNm : undefined,
        linkProductId: it?.linkProductId != null ? parseInt(String(it.linkProductId), 10) : undefined,
        sellingPrice: parsePositiveNumber(it?.sellingPrice),
        expiryDate: parseOptionalDate(it?.expiryDate),
      }))
      .filter((it: { itemId?: number; itemSeq?: number }) => it.itemId != null || it.itemSeq != null);
    const result = await confirmRraPurchase(organizationId, id, {
      branchId: branchOf(req),
      userId: (req as any).user?.userId,
      reject,
      prcOrdCd: req.body?.prcOrdCd,
      remark: typeof req.body?.remark === 'string' ? req.body.remark : undefined,
      items: items.length ? items : undefined,
    });
    return result.success ? res.json(success(result)) : res.status(502).json(apiError(result.error ?? 'Purchase confirmation failed'));
  } catch (e: any) {
    console.error('[RRA purchase confirm]', e);
    res.status(500).json(apiError('Failed to confirm the purchase'));
  }
}

// ── Import declarations (§66, §67, §68) ──────────────────────

export async function syncImports(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const rawDate = (req.body?.requestDate ?? req.query.requestDate) as string | undefined;
    const requestDate = typeof rawDate === 'string' && rawDate.trim() ? rawDate.trim() : undefined;
    const result = await syncRraImports(organizationId, { branchId: branchOf(req), requestDate });
    return result.ok ? res.json(success(result)) : res.status(400).json(apiError(result.error ?? 'Import sync failed', undefined, result));
  } catch (e: any) {
    console.error('[RRA imports sync]', e);
    res.status(500).json(apiError('Failed to pull import declarations from RRA'));
  }
}

const RRA_IMPORT_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

export async function listRraImports(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const status = rawStatus ? rawStatus.toUpperCase() : undefined;
    if (status && !RRA_IMPORT_STATUSES.has(status)) {
      return res.status(400).json(apiError(`Invalid status filter — use PENDING, APPROVED, or REJECTED`));
    }
    const [rows, pending, cursor] = await Promise.all([
      prisma.rraImportItem.findMany({
        where: { organizationId, ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : {}) },
        orderBy: [{ dclDe: 'desc' }, { itemSeq: 'asc' }],
        take: 300,
      }),
      prisma.rraImportItem.count({ where: { organizationId, status: 'PENDING' } }),
      prisma.rraSyncCursor.findUnique({ where: { organizationId_resource: { organizationId, resource: 'imports' } } }),
    ]);
    res.json(success({
      imports: rows,
      pending,
      lastRequestDate: cursor?.lastReqDt ?? null,
      lastRunAt: cursor?.lastRunAt ?? null,
      lastResult: cursor?.lastResult ?? null,
    }));
  } catch (e: any) {
    console.error('[RRA imports list]', e);
    res.status(500).json(apiError('Failed to list import declarations'));
  }
}

export async function actionImport(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const action = req.params.action === 'reject' ? 'reject' : 'approve';
    const { itemClsCd, itemCd, linkProductId, remark, sellingPrice, expiryDate, createProduct, itemNm } = req.body ?? {};
    const result = await actionRraImport(organizationId, id, action, {
      branchId: branchOf(req),
      userId: (req as any).user?.userId,
      itemClsCd,
      itemCd,
      linkProductId: linkProductId != null ? parseInt(String(linkProductId)) : undefined,
      createProduct: createProduct === true || createProduct === 'true',
      itemNm: typeof itemNm === 'string' ? itemNm : undefined,
      remark,
      sellingPrice: parsePositiveNumber(sellingPrice),
      expiryDate: parseOptionalDate(expiryDate),
    });
    return result.success ? res.json(success(result)) : res.status(502).json(apiError(result.error ?? 'Import action failed'));
  } catch (e: any) {
    console.error('[RRA import action]', e);
    res.status(500).json(apiError('Failed to update the import declaration'));
  }
}

export async function masterDataStatus(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const [cursors, codeCount, classCount, noticeCount, unread] = await Promise.all([
      prisma.rraSyncCursor.findMany({ where: { organizationId } }),
      prisma.rraCode.count({ where: { organizationId } }),
      prisma.rraItemClass.count({ where: { organizationId } }),
      prisma.rraNotice.count({ where: { organizationId } }),
      prisma.rraNotice.count({ where: { organizationId, readAt: null } }),
    ]);
    res.json(success({
      cursors,
      counts: { codes: codeCount, itemClasses: classCount, notices: noticeCount, unreadNotices: unread },
    }));
  } catch (e: any) {
    console.error('[RRA master-data status]', e);
    res.status(500).json(apiError('Failed to read RRA master-data status'));
  }
}

// ── Fiscal document lookups (refund reasons / payment mappings) ──

/**
 * RRA refund reason codes (code class 32) for the refund-reason dropdown.
 * Served from the centralized RRA code service — the same list the fiscal
 * refund validator enforces, so the UI can never offer a code VSDC rejects.
 */
export async function listRefundReasons(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const reasons = await getRefundReasonCodesForOrg(organizationId);
    res.json(success({ reasons, default: DEFAULT_RFD_RSN_CD }));
  } catch (e: any) {
    console.error('[RRA refund reasons]', e);
    res.status(500).json(apiError('Failed to list RRA refund reasons'));
  }
}

export async function getCodeCatalog(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const catalog = await getRraCodeCatalog(organizationId);
    res.json(success(catalog));
  } catch (e: any) {
    console.error('[RRA code catalog]', e);
    res.status(500).json(apiError('Failed to load RRA code catalog'));
  }
}

/**
 * ERP → RRA payment-method mappings with the RRA code names, for checkout
 * display and operator validation.
 */
export async function listPaymentMappings(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const mappings = await getPaymentMethodMappings(organizationId);
    res.json(success({ mappings }));
  } catch (e: any) {
    console.error('[RRA payment mappings]', e);
    res.status(502).json(apiError(e instanceof Error ? e.message : 'Failed to list payment mappings'));
  }
}

// ── Branch / customer / user / composition / stock-move (§3.3.2–3.3.3, §3.3.8.1) ──

export async function syncBranches(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const result = await syncRraBranches(organizationId, branchOf(req));
    return result.ok
      ? res.json(success(result))
      : res.status(502).json(apiError(result.error ?? 'Branch sync failed', undefined, result));
  } catch (e: any) {
    console.error('[RRA branches sync]', e);
    res.status(500).json(apiError('Failed to sync RRA branches'));
  }
}

export async function syncStockMoves(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const branchId = branchOf(req);
    const result = await syncRraStockMoves(organizationId, branchId);
    if (!result.ok) {
      return res.status(502).json(apiError(result.error ?? 'Stock-move pull failed', undefined, result));
    }
    const userId = req.user?.userId != null ? parseInt(String(req.user.userId)) : undefined;
    const booked = await applyRraStockMoves(organizationId, result.stockList, { branchId, userId });
    return res.json(success({ ...result, ...booked }));
  } catch (e: any) {
    console.error('[RRA stock moves sync]', e);
    res.status(500).json(apiError('Failed to pull stock movements from RRA'));
  }
}

export async function pushCustomer(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const customerId = parseInt(req.params.customerId);
    const result = await syncCustomerToRra(organizationId, customerId, {
      branchId: branchOf(req),
      userId: (req as any).user?.userId,
    });
    return result.success
      ? res.json(success(result))
      : res.status(502).json(apiError(result.error ?? 'Customer push failed'));
  } catch (e: any) {
    console.error('[RRA customer push]', e);
    res.status(500).json(apiError('Failed to push customer to VSDC'));
  }
}

export async function pushUser(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.params.userId);
    const result = await syncUserToRra(organizationId, userId, {
      branchId: branchOf(req),
      actorUserId: (req as any).user?.userId,
    });
    return result.success
      ? res.json(success(result))
      : res.status(502).json(apiError(result.error ?? 'User push failed'));
  } catch (e: any) {
    console.error('[RRA user push]', e);
    res.status(500).json(apiError('Failed to push user to VSDC'));
  }
}

export async function pushBomComposition(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);
    const componentProductId = parseInt(req.params.componentId);
    const result = await syncBomComponentToRra(organizationId, parentProductId, componentProductId, {
      branchId: branchOf(req),
      userId: (req as any).user?.userId,
    });
    return result.success
      ? res.json(success(result))
      : res.status(502).json(apiError(result.error ?? 'Composition push failed'));
  } catch (e: any) {
    console.error('[RRA BOM composition push]', e);
    res.status(500).json(apiError('Failed to push item composition to VSDC'));
  }
}

/** POST /branches/saveBrancheInsurances — pharmacy insurer registration. */
export async function pushInsurance(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const customerId = parseInt(req.params.customerId);
    const result = await syncInsuranceToRra(organizationId, customerId, {
      branchId: branchOf(req),
      userId: (req as any).user?.userId,
    });
    if (result.skipped) return res.json(success({ ...result, message: 'Not an insurance customer — skipped' }));
    return result.success
      ? res.json(success(result))
      : res.status(502).json(apiError(result.error ?? 'Insurance push failed'));
  } catch (e: any) {
    console.error('[RRA insurance push]', e);
    res.status(500).json(apiError('Failed to push insurance company to VSDC'));
  }
}

/**
 * CIS §7.26 — auditor overview of software settings and fiscal database state.
 * GET /organizations/:organizationId/rra/audit-overview
 */
export async function getAuditOverview(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const branchId = branchOf(req);

    const [org, branches, settings, cursors, counters, outboxStats, lastSale] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          TIN: true,
          address: true,
          trainingMode: true,
          ebmDeviceId: true,
          ebmSerialNo: true,
          mrcNo: true,
          lastSuccessfulVdsContact: true,
        },
      }),
      prisma.branch.findMany({
        where: { organizationId, status: 'ACTIVE', ...(branchId != null ? { id: branchId } : {}) },
        select: {
          id: true,
          name: true,
          code: true,
          bhfId: true,
          ebmDeviceId: true,
          ebmSerialNo: true,
          mrcNo: true,
          vsdcUrl: true,
          ebmInitializedAt: true,
          isDefault: true,
        },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
      getOrganizationSettings(organizationId),
      prisma.rraSyncCursor.findMany({
        where: { organizationId },
        select: { resource: true, lastReqDt: true, lastRunAt: true, lastResult: true },
        orderBy: { resource: 'asc' },
      }),
      prisma.vsdcDeviceCounter.findMany({
        where: { organizationId },
        select: { deviceKey: true, nextSequence: true, updatedAt: true },
      }),
      prisma.ebmOutbox.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.sale.findFirst({
        where: { organizationId, ...(branchId != null ? { branchId } : {}), status: { in: ['COMPLETED', 'REFUNDED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, saleNumber: true, invoiceNumber: true, rcptLabel: true, createdAt: true, status: true },
      }),
    ]);

    return res.json(success({
      cis: {
        appName: config.appName,
        ebmEnabled: isEbmEnabled(),
        ebmProtocol: config.ebm.protocol,
        environment: config.ebm.environment,
        requestTimeoutMs: config.ebm.requestTimeoutMs,
      },
      organization: org,
      branches,
      settings: {
        featureFlags: settings.featureFlags,
        vatRegistered: settings.vatRegistered,
        preferences: {
          timezone: settings.preferences.timezone,
          dateFormat: settings.preferences.dateFormat,
          enabledPaymentMethods: settings.preferences.enabledPaymentMethods,
        },
      },
      syncCursors: cursors,
      invoiceCounters: counters,
      outboxByStatus: Object.fromEntries(outboxStats.map((r) => [r.status, r._count._all])),
      lastFiscalSale: lastSale,
      generatedAt: new Date().toISOString(),
    }));
  } catch (e: any) {
    console.error('[RRA audit overview]', e);
    res.status(500).json(apiError('Failed to load auditor overview'));
  }
}

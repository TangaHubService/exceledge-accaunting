import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { isEbmEnabled } from './rra-ebm.service';
import {
  buildVsdcEnvelope,
  selectImportItems,
  updateImportItems,
  validateVsdcEnvelope,
  toRraReqDt,
  bumpRraReqDt,
} from './vsdc-api.service';
import { receiveStockOnBranch, resolveActiveBranchId } from './inventory-ledger.service';
import { applySellingPriceOnReceipt, syncProductToRra } from './product-sync.service';
import { allocateItemCd, getOriginNationCode, DEFAULT_PKG_UNIT_CD } from './item-code.service';
import { TaxService } from './tax.service';
import { getTaxationTypes } from './rra-code.service';
import { submitStockLedgerEntryToEbm } from './stock-movement-sync.service';
import logger from '../utils/logger';

/**
 * RRA import declarations (RRA checklist §66, §67, §68).
 *
 *  §66  syncRraImports()          — pull import-declaration lines from RRA
 *                                   (/imports/selectImportItems) and cache them.
 *  §67  request-date validation   — each pull's request date must be strictly
 *                                   later than the previous one.
 *  §68  approveRraImport() /      — classify + approve or reject a line
 *       rejectRraImport()           (/imports/updateImportItems). An approval
 *                                   links/creates a product and books the
 *                                   stock-in as an Import (sarTyCd 01).
 *  §74  realtime stock            — after local booking, submit stock IO +
 *                                   stock master to VSDC immediately.
 */

const QTY_UNIT_TO_MEASUREMENT: Record<string, string> = {
  U: 'PCS', KG: 'KG', LTR: 'LTR', MTR: 'MTR', BX: 'BOX', PR: 'PAIR', DZ: 'DOZEN', GRM: 'GRAM',
};

const CURSOR_RESOURCE = 'imports';

/** VSDC §4.18: 1 Unsent · 2 Waiting · 3 Approved · 4 Cancelled */
const IMPT_STTS = { UNSENT: '1', WAITING: '2', APPROVED: '3', CANCELLED: '4' } as const;

function localStatusFromImptStts(code: string | undefined): 'PENDING' | 'APPROVED' | 'REJECTED' {
  const c = String(code ?? '').trim();
  if (c === IMPT_STTS.APPROVED) return 'APPROVED';
  if (c === IMPT_STTS.CANCELLED) return 'REJECTED';
  return 'PENDING';
}

async function getCursor(organizationId: number): Promise<string> {
  const row = await prisma.rraSyncCursor.findUnique({
    where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
  });
  return row?.lastReqDt ?? '20200101000000';
}

async function saveCursor(organizationId: number, lastReqDt: string, result: string): Promise<void> {
  await prisma.rraSyncCursor.upsert({
    where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
    create: { organizationId, resource: CURSOR_RESOURCE, lastReqDt, lastRunAt: new Date(), lastResult: result },
    update: { lastReqDt, lastRunAt: new Date(), lastResult: result },
  });
}

/** Record a pull outcome without changing lastReqDt (empty / failed pulls). */
async function touchCursorResult(organizationId: number, result: string): Promise<void> {
  await prisma.rraSyncCursor.updateMany({
    where: { organizationId, resource: CURSOR_RESOURCE },
    data: { lastRunAt: new Date(), lastResult: result },
  });
}

// ── §66 / §67: pull import declarations ──────────────────────

export async function syncRraImports(
  organizationId: number,
  opts: { branchId?: number | null; requestDate?: string } = {},
): Promise<{ ok: boolean; fetched: number; cached: number; lastReqDt: string; error?: string }> {
  if (!isEbmEnabled()) return { ok: false, fetched: 0, cached: 0, lastReqDt: '', error: 'EBM is not enabled' };

  const prevCursor = await getCursor(organizationId);

  // §67: a manually-specified request date must be strictly after the previous
  // request. `requestDate` is yyyy-mm-dd; the cursor is yyyyMMddHHmmss.
  // Blank / whitespace requestDate (e.g. Bruno `""`) means "use the stored cursor".
  const requestDate = opts.requestDate?.trim() || undefined;
  let lastReqDt: string;
  if (requestDate) {
    const digits = requestDate.replace(/\D/g, '');
    if (digits.length < 8) return { ok: false, fetched: 0, cached: 0, lastReqDt: prevCursor, error: 'Request date must be yyyy-mm-dd' };
    lastReqDt = `${digits.slice(0, 8)}000000`;
    if (lastReqDt <= prevCursor) {
      return {
        ok: false,
        fetched: 0,
        cached: 0,
        lastReqDt: prevCursor,
        error: `Request date must be later than the previous request (${prevCursor})`,
      };
    }
  } else {
    lastReqDt = prevCursor;
  }

  let runAt = toRraReqDt(new Date());
  if (runAt <= prevCursor) runAt = bumpRraReqDt(prevCursor);

  const envelope = await buildVsdcEnvelope(organizationId, opts.branchId ?? null);
  const res = await selectImportItems(envelope, lastReqDt);
  if (!res.success) {
    // Do not create/overwrite lastReqDt on failure — "Last request" stays as-is.
    await touchCursorResult(organizationId, `FAILED: ${res.resultMsg}`);
    return { ok: false, fetched: 0, cached: 0, lastReqDt: prevCursor, error: `${res.resultCd}: ${res.resultMsg}` };
  }

  const list = res.data?.itemList ?? [];
  let cached = 0;
  for (const it of list) {
    const stts = (it as { imptItemsttsCd?: string; imptItemSttsCd?: string }).imptItemSttsCd
      ?? (it as { imptItemsttsCd?: string }).imptItemsttsCd;
    const mappedStatus = localStatusFromImptStts(stts);
    const taskCd = String(it.taskCd ?? '').trim();
    const dclDe = String(it.dclDe ?? '').trim();
    if (!taskCd || !dclDe || it.itemSeq == null) {
      logger.warn(`[EBM] imports pull: skipping malformed line taskCd=${it.taskCd} dclDe=${it.dclDe} itemSeq=${it.itemSeq}`);
      continue;
    }
    await prisma.rraImportItem.upsert({
      where: {
        organizationId_taskCd_dclDe_itemSeq: {
          organizationId,
          taskCd,
          dclDe,
          itemSeq: it.itemSeq,
        },
      },
      create: {
        organizationId,
        taskCd,
        dclNo: it.dclNo ?? null,
        dclDe,
        itemSeq: it.itemSeq,
        hsCd: it.hsCd ?? null,
        itemNm: it.itemNm ?? null,
        orgnNatCd: it.orgnNatCd ?? null,
        exptNatCd: it.exptNatCd ?? null,
        pkg: it.pkg ?? null,
        pkgUnitCd: it.pkgUnitCd ?? null,
        qty: it.qty ?? null,
        qtyUnitCd: it.qtyUnitCd ?? null,
        totWt: it.totWt ?? null,
        netWt: it.netWt ?? null,
        spplrNm: it.spplrNm ?? null,
        agntNm: it.agntNm ?? null,
        invcFcurAmt: it.invcFcurAmt ?? null,
        invcFcurCd: it.invcFcurCd ?? null,
        invcFcurExcrt: it.invcFcurExcrt ?? null,
        itemCd: it.itemCd ?? null,
        itemClsCd: it.itemClsCd ?? null,
        status: mappedStatus,
        rawResponse: it as unknown as Prisma.InputJsonValue,
      },
      update: {
        rawResponse: it as unknown as Prisma.InputJsonValue,
        // Keep display fields fresh on re-pull (UI shows supplier / item / invoice).
        spplrNm: it.spplrNm ?? null,
        agntNm: it.agntNm ?? null,
        itemNm: it.itemNm ?? null,
        hsCd: it.hsCd ?? null,
        orgnNatCd: it.orgnNatCd ?? null,
        invcFcurAmt: it.invcFcurAmt ?? null,
        invcFcurCd: it.invcFcurCd ?? null,
        // Mirror RRA's terminal states; never downgrade a locally actioned line
        // back to PENDING when VSDC still echoes Waiting (2).
        ...(mappedStatus !== 'PENDING' ? { status: mappedStatus } : {}),
      },
    });
    cached += 1;
  }

  // Zero lines pulled → never advance (or invent) lastReqDt. Only note the run.
  if (cached === 0) {
    await touchCursorResult(organizationId, `OK: 0 import lines`);
    return { ok: true, fetched: 0, cached: 0, lastReqDt: prevCursor };
  }

  await saveCursor(organizationId, runAt, `OK: ${cached} import lines`);
  return { ok: true, fetched: list.length, cached, lastReqDt: runAt };
}

// ── §68 helpers: convert import line → local product ─────────

async function createProductFromImportLine(
  organizationId: number,
  line: {
    itemNm: string | null;
    itemCd: string | null;
    itemClsCd: string | null;
    hsCd: string | null;
    orgnNatCd: string | null;
    pkgUnitCd: string | null;
    qtyUnitCd: string | null;
    invcFcurAmt: { toNumber: () => number } | null;
    qty: { toNumber: () => number } | null;
  },
  opts: { itemNm?: string; itemClsCd?: string; sellingPrice?: number },
): Promise<{ id: number; itemCd: string | null; itemClsCd: string | null }> {
  const localNm = (opts.itemNm?.trim() || line.itemNm?.trim() || 'Imported item').slice(0, 200);
  const pkgUnitCd = line.pkgUnitCd?.trim() || DEFAULT_PKG_UNIT_CD;
  const qtyUnitCd = line.qtyUnitCd?.trim() || 'U';
  const origin =
    (line.orgnNatCd?.trim().toUpperCase() || null)
    ?? (await getOriginNationCode(organizationId))
    ?? (/^[A-Z]{2}(?=\d)/.exec(line.itemCd?.trim().toUpperCase() ?? '')?.[0] ?? null);
  const types = await getTaxationTypes(organizationId);
  const taxCode = ((types.find((t) => t.rate === 18)?.code)
    ?? (types.find((t) => t.code === 'B')?.code)
    ?? types[0]?.code
    ?? 'B') as 'A' | 'B' | 'C' | 'D';
  const qty = line.qty != null ? Math.abs(line.qty.toNumber()) : 0;
  const invoiceAmt = line.invcFcurAmt != null ? Math.abs(line.invcFcurAmt.toNumber()) : 0;
  const unitCost = qty > 0 && invoiceAmt > 0 ? Math.round((invoiceAmt / qty) * 100) / 100 : 0;
  const itemClsCd = (opts.itemClsCd || line.itemClsCd || '').trim();
  if (!itemClsCd) {
    throw new Error('itemClsCd is required to create a product from an import declaration');
  }
  const itemCd = origin
    ? await allocateItemCd(organizationId, 'PRODUCT', pkgUnitCd, qtyUnitCd, origin)
    : null;
  const product = await prisma.product.create({
    data: {
      name: localNm,
      organizationId,
      unitPrice: opts.sellingPrice && opts.sellingPrice > 0 ? opts.sellingPrice : unitCost,
      purchasePrice: unitCost,
      quantity: 0,
      taxCode,
      taxCategory: TaxService.getTaxCategory(taxCode),
      measurementUnit: (QTY_UNIT_TO_MEASUREMENT[qtyUnitCd] ?? 'PCS') as 'PCS' | 'KG' | 'LTR' | 'MTR' | 'BOX' | 'PAIR' | 'DOZEN' | 'GRAM' | 'OTHER',
      itemType: 'PRODUCT',
      itemCd,
      itemClsCd,
      pkgUnitCd,
      qtyUnitCd,
      origin,
    },
    select: { id: true, itemCd: true, itemClsCd: true },
  });
  const sync = await syncProductToRra(product.id);
  if (!sync.success) {
    logger.warn(`[EBM] new product #${product.id} from import approve did not sync to RRA: ${sync.error}`);
  }
  const fresh = await prisma.product.findFirst({
    where: { id: product.id },
    select: { id: true, itemCd: true, itemClsCd: true },
  });
  return fresh ?? product;
}

// ── §68: approve / reject an import line ─────────────────────

export async function actionRraImport(
  organizationId: number,
  importItemId: number,
  action: 'approve' | 'reject',
  opts: {
    branchId?: number | null;
    userId?: number;
    itemClsCd?: string;
    itemCd?: string;
    linkProductId?: number;
    /** When true (and no linkProductId), create a local product from the declaration. */
    createProduct?: boolean;
    itemNm?: string;
    remark?: string;
    sellingPrice?: number;
    expiryDate?: Date;
  } = {},
): Promise<{ success: boolean; error?: string; warning?: string }> {
  const line = await prisma.rraImportItem.findFirst({ where: { id: importItemId, organizationId } });
  if (!line) return { success: false, error: 'Import line not found' };
  if (line.status !== 'PENDING') return { success: false, error: `Import line already ${line.status.toLowerCase()}` };
  if (!isEbmEnabled()) return { success: false, error: 'EBM is not enabled' };

  const envelope = await buildVsdcEnvelope(organizationId, opts.branchId ?? null);
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
    : null;
  const modr = { id: String(user?.id ?? 'system'), name: user?.name ?? 'System' };

  let receivingProductId = opts.linkProductId;
  if (action === 'approve' && !receivingProductId && opts.createProduct) {
    try {
      const created = await createProductFromImportLine(organizationId, line, {
        itemNm: opts.itemNm,
        itemClsCd: opts.itemClsCd || line.itemClsCd || undefined,
        sellingPrice: opts.sellingPrice,
      });
      receivingProductId = created.id;
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Failed to create product from import' };
    }
  }

  const linked = action === 'approve' && receivingProductId
    ? await prisma.product.findFirst({
        where: { id: receivingProductId, organizationId, deletedAt: null },
        select: { id: true, itemClsCd: true, itemCd: true, itemType: true, ebmSyncStatus: true },
      })
    : null;
  if (action === 'approve' && receivingProductId && !linked) {
    return { success: false, error: `Product ${receivingProductId} was not found` };
  }
  if (linked?.itemType === 'SERVICE') {
    return { success: false, error: 'An import cannot be received into a service — pick a stocked product' };
  }
  if (action === 'approve' && !linked) {
    return {
      success: false,
      error: 'Approve requires a receiving product — link an existing one or create a new product from this declaration',
    };
  }

  // VSDC ImptItemSaveReq requires itemClsCd + itemCd. Register the receiving
  // product with RRA first when it is not yet synced.
  if (action === 'approve' && linked && linked.ebmSyncStatus !== 'SYNCED') {
    const synced = await syncProductToRra(linked.id, opts.userId, opts.branchId);
    if (!synced.success) {
      return {
        success: false,
        error: synced.error ?? 'Linked product must be registered with RRA before approving this import',
      };
    }
  }
  const linkedFresh = linked
    ? await prisma.product.findFirst({
        where: { id: linked.id },
        select: { itemClsCd: true, itemCd: true },
      })
    : null;

  const itemClsCd = (opts.itemClsCd || line.itemClsCd || linkedFresh?.itemClsCd || linked?.itemClsCd || '').trim();
  if (action === 'approve' && !itemClsCd) {
    return { success: false, error: 'itemClsCd is required to approve an import — pick an RRA item classification' };
  }
  const itemCd = (opts.itemCd || line.itemCd || linkedFresh?.itemCd || linked?.itemCd || '').trim();
  if (action === 'approve' && !itemCd) {
    return {
      success: false,
      error: 'itemCd is required to approve an import — link a product that has an RRA item code, or register the product with RRA first',
    };
  }
  const hsCd = (line.hsCd ?? '').trim();
  if (action === 'approve' && !hsCd) {
    return { success: false, error: 'hsCd is required to approve an import — the declaration line has no HS code from RRA' };
  }

  const payload: Record<string, unknown> = {
    taskCd: line.taskCd,
    dclDe: line.dclDe,
    itemSeq: line.itemSeq,
    hsCd,
    itemClsCd,
    itemCd,
    imptItemSttsCd: action === 'approve' ? IMPT_STTS.APPROVED : IMPT_STTS.CANCELLED,
    remark: opts.remark ?? '',
    modrId: modr.id,
    modrNm: modr.name,
  };

  try {
    const res = await updateImportItems(envelope, payload);
    if (!res.success) return { success: false, error: res.error ?? 'updateImportItems failed' };

    const nextStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await prisma.rraImportItem.update({
      where: { id: importItemId },
      data: {
        status: nextStatus,
        actionedAt: new Date(),
        remark: opts.remark ?? null,
        itemClsCd: itemClsCd || null,
        itemCd: itemCd || null,
        linkedProductId: action === 'approve' ? receivingProductId ?? null : null,
      },
    });

    // §74: book local stock then push /stock/saveStockItems + /stockMaster
    // immediately. Status is already saved so a stock failure becomes a warning.
    let warning: string | undefined;
    try {
      const stockBranchId = await resolveActiveBranchId(organizationId, opts.branchId);
      if (action === 'approve' && receivingProductId) {
        await applySellingPriceOnReceipt(organizationId, receivingProductId, opts.sellingPrice, opts.userId);
      }
      if (action === 'approve' && receivingProductId && stockBranchId != null && line.qty) {
        const qty = Math.round(line.qty.toNumber() * 1000) / 1000;
        if (qty > 0) {
          const reference = `IMPORT-${line.taskCd}-${line.dclNo ?? line.dclDe}`;
          // Book local stock with skipEbmSync so queueStockSync does not race
          // the explicit §74 push below (double submit → abort / deferred).
          const ledger = await receiveStockOnBranch({
            organizationId,
            productId: receivingProductId,
            userId: opts.userId ?? 0,
            quantity: qty,
            movementType: 'PURCHASE',
            branchId: stockBranchId,
            reference,
            referenceType: 'RRA_IMPORT',
            batchNumber: reference,
            expiryDate: opts.expiryDate,
            note: `Approved import declaration ${line.dclNo ?? line.taskCd} line ${line.itemSeq}`,
            skipEbmSync: true,
          });
          if (ledger?.id) {
            // Mark PENDING so submitStockLedgerEntryToEbm will push IO + master.
            await prisma.inventoryLedger.update({
              where: { id: ledger.id },
              data: { ebmSyncStatus: 'PENDING', ebmError: null },
            });
            const stockRes = await submitStockLedgerEntryToEbm(ledger.id);
            if (!stockRes.success && !stockRes.deferred) {
              warning = `Approved with RRA and local stock booked, but VSDC stock sync failed: ${stockRes.error ?? 'unknown'}. Use “Sync stock now” to retry.`;
              logger.warn(`[EBM] import action #${importItemId}: ${warning}`);
            }
          }
        }
      } else if (action === 'approve' && receivingProductId && stockBranchId == null) {
        warning = 'Approved with RRA, but no active branch was found so local stock was not booked';
        logger.warn(`[EBM] import action #${importItemId}: no active branch — local stock not booked`);
      }
    } catch (stockErr: unknown) {
      const stockMsg = stockErr instanceof Error ? stockErr.message : 'stock booking failed';
      warning = `Approved with RRA (${nextStatus}), but local stock was not booked: ${stockMsg}`;
      logger.error(`[EBM] import action #${importItemId}: status saved but stock failed`, stockErr);
    }

    await prisma.organization.update({
      where: { id: organizationId },
      data: { lastSuccessfulVdsContact: new Date() },
    });
    return { success: true, warning };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Import action failed';
    logger.error(`[EBM] import action #${importItemId} (${action}) failed`, e);
    return { success: false, error: message };
  }
}

import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { isEbmEnabled } from './rra-ebm.service';
import {
  buildVsdcEnvelope,
  validateVsdcEnvelope,
  toRraReqDt,
  selectBranches,
  saveBrancheCustomer,
  saveBrancheUser,
  saveBrancheInsurance,
  saveItemComposition,
  selectStockItems,
  type RraBranchLVO,
  type RraStockMoveLVO,
} from './vsdc-api.service';

/**
 * VSDC branch / customer / user / composition / stock-move sync
 * (RRA VSDC API v1.0.5 §3.3.2.4, §3.3.3.1–3.3.3.2, §3.3.4.2, §3.3.8.1).
 */

function clamp(s: string | null | undefined, max: number): string {
  return (s ?? '').slice(0, max);
}

function custNoFromId(id: number): string {
  // BhfCustSaveReq custNo is CHAR(9) — zero-pad the local customer id.
  return String(id).padStart(9, '0').slice(-9);
}

async function defaultBranchId(organizationId: number): Promise<number | null> {
  const b = await prisma.branch.findFirst({
    where: { organizationId, status: 'ACTIVE' },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  return b?.id ?? null;
}

async function getCursor(organizationId: number, resource: string): Promise<string> {
  const row = await prisma.rraSyncCursor.findUnique({
    where: { organizationId_resource: { organizationId, resource } },
  });
  return row?.lastReqDt ?? '20200101000000';
}

async function saveCursor(
  organizationId: number,
  resource: string,
  lastReqDt: string,
  result: string,
): Promise<void> {
  await prisma.rraSyncCursor.upsert({
    where: { organizationId_resource: { organizationId, resource } },
    create: { organizationId, resource, lastReqDt, lastRunAt: new Date(), lastResult: result },
    update: { lastReqDt, lastRunAt: new Date(), lastResult: result },
  });
}

/** POST /branches/selectBranches — align local Branch.bhfId with RRA. */
export async function syncRraBranches(
  organizationId: number,
  branchId?: number | null,
): Promise<{ ok: boolean; fetched: number; matched: number; error?: string; branches: RraBranchLVO[] }> {
  if (!isEbmEnabled()) return { ok: false, fetched: 0, matched: 0, error: 'EBM is not enabled', branches: [] };

  const since = await getCursor(organizationId, 'branches');
  const runAt = toRraReqDt(new Date());
  const envelope = await buildVsdcEnvelope(organizationId, branchId ?? (await defaultBranchId(organizationId)));
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { ok: false, fetched: 0, matched: 0, error: envErr, branches: [] };

  const res = await selectBranches(envelope, since);
  if (!res.success) {
    await saveCursor(organizationId, 'branches', since, `FAILED: ${res.resultMsg}`);
    return { ok: false, fetched: 0, matched: 0, error: `${res.resultCd}: ${res.resultMsg}`, branches: [] };
  }

  const list = res.data?.bhfList ?? [];
  let matched = 0;
  for (const bhf of list) {
    if (!bhf.bhfId) continue;
    const local = await prisma.branch.findFirst({
      where: { organizationId, bhfId: bhf.bhfId },
      select: { id: true },
    });
    if (local) {
      matched += 1;
      await prisma.branch.update({
        where: { id: local.id },
        data: {
          name: bhf.bhfNm || undefined,
          location: [bhf.prvncNm, bhf.dstrtNm, bhf.sctrNm].filter(Boolean).join(', ') || undefined,
          address: bhf.locDesc || undefined,
          phone: bhf.mgrTelNo || undefined,
          metadata: {
            rraBranch: bhf as unknown as Prisma.InputJsonValue,
            hqYn: bhf.hqYn,
            bhfSttsCd: bhf.bhfSttsCd,
            syncedAt: new Date().toISOString(),
          },
        },
      });
    }
  }

  await saveCursor(organizationId, 'branches', runAt, `OK: ${list.length} branches`);
  return { ok: true, fetched: list.length, matched, branches: list };
}

/** POST /branches/saveBrancheCustomers — push one CIS customer to VSDC. */
export async function syncCustomerToRra(
  organizationId: number,
  customerId: number,
  opts: { branchId?: number | null; userId?: number } = {},
): Promise<{ success: boolean; error?: string }> {
  if (!isEbmEnabled()) return { success: true };

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId, deletedAt: null },
  });
  if (!customer) return { success: false, error: 'Customer not found' };

  // Spec requires custTin CHAR(9). Walk-ins without a TIN cannot be pushed.
  const custTin = (customer.TIN ?? '').trim();
  if (!/^\d{9}$/.test(custTin)) {
    return { success: true }; // skip silently — not an RRA taxpayer customer yet
  }

  const envelope = await buildVsdcEnvelope(
    organizationId,
    opts.branchId ?? (await defaultBranchId(organizationId)),
  );
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
    : null;
  const regrNm = clamp(user?.name ?? 'System', 60);
  const regrId = clamp(user ? String(user.id) : 'system', 20);

  const payload = {
    custNo: custNoFromId(customer.id),
    custTin,
    custNm: clamp(customer.name, 60),
    adrs: clamp(customer.address, 300) || null,
    telNo: clamp(customer.phone, 20) || null,
    email: clamp(customer.email, 50) || null,
    faxNo: null,
    useYn: customer.isActive ? 'Y' : 'N',
    remark: null,
    regrNm,
    regrId,
    modrNm: regrNm,
    modrId: regrId,
  };

  const res = await saveBrancheCustomer(envelope, payload);
  return res.success ? { success: true } : { success: false, error: res.error };
}

export function syncCustomerToRraAsync(
  organizationId: number,
  customerId: number,
  opts: { branchId?: number | null; userId?: number } = {},
): void {
  syncCustomerToRra(organizationId, customerId, opts).catch((err) => {
    console.error(`[EBM][CustomerSync] customerId=${customerId}`, err);
  });
  // Pharmacy insurers also need BhfInsuranceSaveReq (§3.3.3.3).
  syncInsuranceToRra(organizationId, customerId, opts).catch((err) => {
    console.error(`[EBM][InsuranceSync] customerId=${customerId}`, err);
  });
}

/**
 * POST /branches/saveBrancheInsurances — push one pharmacy insurance company.
 * Only applies to CustomerType.INSURANCE with a non-empty isrccCd.
 */
export async function syncInsuranceToRra(
  organizationId: number,
  customerId: number,
  opts: { branchId?: number | null; userId?: number } = {},
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  if (!isEbmEnabled()) return { success: true, skipped: true };

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId, deletedAt: null },
  });
  if (!customer) return { success: false, error: 'Customer not found' };
  if (customer.customerType !== 'INSURANCE') return { success: true, skipped: true };

  const isrccCd = (customer.isrccCd ?? '').trim();
  if (!isrccCd) {
    return { success: false, error: 'Insurance customer requires isrccCd before VSDC sync' };
  }

  const envelope = await buildVsdcEnvelope(
    organizationId,
    opts.branchId ?? (await defaultBranchId(organizationId)),
  );
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
    : null;
  const regrNm = clamp(user?.name ?? 'System', 60);
  const regrId = clamp(user ? String(user.id) : 'system', 20);
  const isrcRt = customer.isrcRt != null ? Number(customer.isrcRt) : 0;

  const payload = {
    isrccCd: clamp(isrccCd, 10),
    isrccNm: clamp(customer.name, 100),
    isrcRt,
    useYn: customer.isActive ? 'Y' : 'N',
    regrNm,
    regrId,
    modrNm: regrNm,
    modrId: regrId,
  };

  const res = await saveBrancheInsurance(envelope, payload);
  return res.success ? { success: true } : { success: false, error: res.error };
}

export function syncInsuranceToRraAsync(
  organizationId: number,
  customerId: number,
  opts: { branchId?: number | null; userId?: number } = {},
): void {
  syncInsuranceToRra(organizationId, customerId, opts).catch((err) => {
    console.error(`[EBM][InsuranceSync] customerId=${customerId}`, err);
  });
}

/**
 * saveBrancheUsers requires a `pwd`. It is a random per-user value kept only
 * for this payload: never the login password, never derived from its hash,
 * and never logged. Created once and reused so re-syncs send the same value.
 */
async function vsdcRegistrationPassword(userId: number): Promise<string> {
  const existing = await prisma.vsdcUserCredential.findUnique({ where: { userId }, select: { pwd: true } });
  if (existing) return existing.pwd;
  const row = await prisma.vsdcUserCredential.upsert({
    where: { userId },
    create: { userId, pwd: randomBytes(18).toString('base64url') },
    update: {},
    select: { pwd: true },
  });
  return row.pwd;
}

/** POST /branches/saveBrancheUsers — push a branch cashier/user account. */
export async function syncUserToRra(
  organizationId: number,
  userId: number,
  opts: { branchId?: number | null; actorUserId?: number } = {},
): Promise<{ success: boolean; error?: string }> {
  if (!isEbmEnabled()) return { success: true };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      deletedAt: true,
      userBranches: { where: { branch: { organizationId } }, select: { branchId: true, isPrimary: true } },
    },
  });
  if (!user || user.deletedAt) return { success: false, error: 'User not found' };

  const branchId =
    opts.branchId
    ?? user.userBranches.find((b) => b.isPrimary)?.branchId
    ?? user.userBranches[0]?.branchId
    ?? (await defaultBranchId(organizationId));

  const envelope = await buildVsdcEnvelope(organizationId, branchId);
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const actor = opts.actorUserId
    ? await prisma.user.findUnique({ where: { id: opts.actorUserId }, select: { id: true, name: true } })
    : null;
  const regrNm = clamp(actor?.name ?? 'System', 60);
  const regrId = clamp(actor ? String(actor.id) : 'system', 20);

  const pwd = await vsdcRegistrationPassword(user.id);

  const payload = {
    userId: clamp(String(user.id), 20),
    userNm: clamp(user.name, 60),
    pwd,
    adrs: null,
    cntc: clamp(user.phone, 20) || null,
    authCd: null,
    remark: clamp(user.email, 2000) || null,
    useYn: user.isActive ? 'Y' : 'N',
    regrNm,
    regrId,
    modrNm: regrNm,
    modrId: regrId,
  };

  const res = await saveBrancheUser(envelope, payload);
  return res.success ? { success: true } : { success: false, error: res.error };
}

export function syncUserToRraAsync(
  organizationId: number,
  userId: number,
  opts: { branchId?: number | null; actorUserId?: number } = {},
): void {
  syncUserToRra(organizationId, userId, opts).catch((err) => {
    console.error(`[EBM][UserSync] userId=${userId}`, err);
  });
}

/** POST /items/saveItemComposition — push one BOM component to VSDC. */
export async function syncBomComponentToRra(
  organizationId: number,
  parentProductId: number,
  componentProductId: number,
  opts: { branchId?: number | null; userId?: number } = {},
): Promise<{ success: boolean; error?: string }> {
  if (!isEbmEnabled()) return { success: true };

  const [parent, component, bom] = await Promise.all([
    prisma.product.findFirst({
      where: { id: parentProductId, organizationId, deletedAt: null },
      select: { itemCd: true },
    }),
    prisma.product.findFirst({
      where: { id: componentProductId, organizationId, deletedAt: null },
      select: { itemCd: true },
    }),
    prisma.bomComponent.findUnique({
      where: {
        parentProductId_componentProductId: { parentProductId, componentProductId },
      },
    }),
  ]);

  if (!bom) return { success: false, error: 'BOM component not found' };
  if (!parent?.itemCd || !component?.itemCd) {
    return { success: false, error: 'Parent and component must both have RRA itemCd before composition sync' };
  }

  const envelope = await buildVsdcEnvelope(
    organizationId,
    opts.branchId ?? (await defaultBranchId(organizationId)),
  );
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { success: false, error: envErr };

  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
    : null;
  const regrNm = clamp(user?.name ?? 'System', 60);
  const regrId = clamp(user ? String(user.id) : 'system', 20);

  const res = await saveItemComposition(envelope, {
    itemCd: parent.itemCd,
    cpstItemCd: component.itemCd,
    cpstQty: Number(bom.quantity),
    regrId,
    regrNm,
    modrId: regrId,
    modrNm: regrNm,
  });
  return res.success ? { success: true } : { success: false, error: res.error };
}

export function syncBomComponentToRraAsync(
  organizationId: number,
  parentProductId: number,
  componentProductId: number,
  opts: { branchId?: number | null; userId?: number } = {},
): void {
  syncBomComponentToRra(organizationId, parentProductId, componentProductId, opts).catch((err) => {
    console.error(`[EBM][BomSync] parent=${parentProductId} component=${componentProductId}`, err);
  });
}

/** POST /stock/selectStockItems — pull HQ↔branch stock movements for audit. */
export async function syncRraStockMoves(
  organizationId: number,
  branchId?: number | null,
): Promise<{ ok: boolean; fetched: number; error?: string; stockList: RraStockMoveLVO[] }> {
  if (!isEbmEnabled()) return { ok: false, fetched: 0, error: 'EBM is not enabled', stockList: [] };

  const since = await getCursor(organizationId, 'stockMoves');
  const runAt = toRraReqDt(new Date());
  const envelope = await buildVsdcEnvelope(organizationId, branchId ?? (await defaultBranchId(organizationId)));
  const envErr = validateVsdcEnvelope(envelope);
  if (envErr) return { ok: false, fetched: 0, error: envErr, stockList: [] };

  const res = await selectStockItems(envelope, since);
  if (!res.success) {
    await saveCursor(organizationId, 'stockMoves', since, `FAILED: ${res.resultMsg}`);
    return { ok: false, fetched: 0, error: `${res.resultCd}: ${res.resultMsg}`, stockList: [] };
  }

  const list = res.data?.stockList ?? [];
  await saveCursor(organizationId, 'stockMoves', runAt, `OK: ${list.length} stock moves`);
  return { ok: true, fetched: list.length, stockList: list };
}

/**
 * S12: apply HQ↔branch movements from /stock/selectStockItems to local
 * inventory. Idempotent: each (sarNo, itemCd) is booked at most once, keyed by
 * reference `RRA-SAR-{sarNo}`. Incoming branch moves book as TRANSFER_IN
 * (sarTyCd 04) through the centralized ledger service. Movements for unknown
 * itemCd are skipped (counted) — never invent products from a stock move.
 */
export async function applyRraStockMoves(
  organizationId: number,
  stockList: RraStockMoveLVO[],
  opts: { branchId?: number | null; userId?: number } = {},
): Promise<{ applied: number; skipped: number }> {
  const { addStock } = await import('./inventory-ledger.service');
  let applied = 0;
  let skipped = 0;
  const branchId = opts.branchId ?? (await defaultBranchId(organizationId));
  if (branchId == null) return { applied: 0, skipped: stockList.length };
  let userId = opts.userId;
  if (userId == null) {
    const u = await prisma.user.findFirst({ where: { organizationId } as any, orderBy: { id: 'asc' }, select: { id: true } });
    userId = (u as any)?.id ?? null;
  }
  if (userId == null) return { applied: 0, skipped: stockList.length };
  for (const move of stockList) {
    // Transfers between this org's own branches are already booked locally
    // (TRANSFER_OUT + TRANSFER_IN); RRA echoes them back with our own sarNo.
    const ownMove = await prisma.inventoryLedger.findFirst({
      where: { organizationId, ebmSarNo: move.sarNo, movementType: 'TRANSFER_OUT' },
      select: { id: true },
    });
    if (ownMove) { skipped += (move.itemList ?? []).length; continue; }
    const ref = `RRA-SAR-${move.sarNo}`;
    for (const line of move.itemList ?? []) {
      if (!line.itemCd || !(line.qty > 0)) { skipped += 1; continue; }
      const product = await prisma.product.findFirst({
        where: { organizationId, itemCd: line.itemCd },
        select: { id: true },
      });
      if (!product) { skipped += 1; continue; }
      const existing = await prisma.inventoryLedger.findFirst({
        where: { organizationId, productId: product.id, reference: ref, referenceType: 'RRA_STOCK_MOVE' },
        select: { id: true },
      });
      if (existing) { skipped += 1; continue; }
      // Already on RRA via /stock/selectStockItems — do not re-queue as
      // TRANSFER_IN (sarTyCd 04) through /stock/saveStockItems.
      await addStock({
        organizationId,
        productId: product.id,
        userId,
        quantity: Number(line.qty),
        movementType: 'TRANSFER_IN',
        branchId,
        reference: ref,
        referenceType: 'RRA_STOCK_MOVE',
        note: `HQ/branch stock move sarNo ${move.sarNo}`,
        metadata: { rraSarNo: move.sarNo, itemSeq: line.itemSeq ?? null } as any,
        skipEbmSync: true,
      });
      applied += 1;
    }
  }
  return { applied, skipped };
}

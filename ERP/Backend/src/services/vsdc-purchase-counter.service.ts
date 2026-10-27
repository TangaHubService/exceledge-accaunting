import { prisma } from '../lib/prisma';

/**
 * The CIS's own purchase invoice number (TrnsPurchaseSaveReq.invcNo, VSDC API
 * v1.0.5 §3.3.7.2): a monotonic sequence per VSDC device, kept beside the sales
 * counter in vsdc_device_counters and seeded at init from lastPchsInvcNo. The
 * supplier's invoice number is a separate field (spplrInvcNo) and never used
 * as invcNo.
 */
export function purchaseCounterKey(bhfId: string | null | undefined, branchId: number | null | undefined): string {
  return `pchs:${bhfId ? `bhf:${bhfId}` : `branch:${branchId ?? 0}`}`;
}

/** Allocate the next purchase invcNo for a device. Each call consumes a number. */
export async function allocatePurchaseInvcNo(
  organizationId: number,
  bhfId: string | null | undefined,
  branchId: number | null | undefined,
): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ebmTinResetAt: true },
  });
  // First use of a device without an init seed: continue past every number
  // this organization has already issued since the last TIN reset.
  const since = org?.ebmTinResetAt ? { createdAt: { gte: org.ebmTinResetAt } } : {};
  const [rra, local] = await Promise.all([
    prisma.rraPurchase.aggregate({ where: { organizationId, cisInvcNo: { not: null }, ...(org?.ebmTinResetAt ? { pulledAt: { gte: org.ebmTinResetAt } } : {}) }, _max: { cisInvcNo: true } }),
    prisma.vsdcLocalPurchase.aggregate({ where: { organizationId, cisInvcNo: { not: null }, ...since }, _max: { cisInvcNo: true } }),
  ]);
  const seed = Math.max(rra._max.cisInvcNo ?? 0, local._max.cisInvcNo ?? 0) + 1;
  const key = purchaseCounterKey(bhfId, branchId);
  const rows = await prisma.$queryRaw<Array<{ nextSequence: number }>>`
    INSERT INTO "vsdc_device_counters" ("organizationId", "deviceKey", "nextSequence", "updatedAt")
    VALUES (${organizationId}, ${key}, ${seed}, NOW())
    ON CONFLICT ("organizationId", "deviceKey") DO UPDATE
      SET "nextSequence" = "vsdc_device_counters"."nextSequence" + 1,
          "updatedAt"    = NOW()
    RETURNING "nextSequence"
  `;
  const allocated = Number(rows[0]?.nextSequence ?? 0);
  if (!(allocated > 0)) throw new Error('Could not allocate a VSDC purchase invoice number');
  return allocated;
}

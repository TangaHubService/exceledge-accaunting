import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { error as apiError } from '../utils/apiResponse';

// C11: offline block threshold. The VSDC stops issuing receipt numbers after
// 24 hours without internet (2023 spec §2.2), so the CIS blocks new receipt
// generation past the same window — the guard mirrors the device, it does not
// invent a stricter one. Override with VSDC_OFFLINE_BLOCK_MS in .env.
// (A previous 2h default was stricter than the spec with no basis in it.)
// Read lazily (not at module load) so tests and process env changes apply.
function getOfflineBlockMs(): number {
  return Number(process.env.VSDC_OFFLINE_BLOCK_MS ?? 24 * 60 * 60 * 1000);
}

/**
 * Check whether the VSDC has been reachable within the configured window.
 *
 * - Returns `true` if contact was made within the allowed window.
 * - Logs a warning at 80% of the threshold.
 * - Throws a structured error beyond the block threshold (default 2h).
 */
export async function verifyVsdcOnlineStatus(organizationId: number): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      lastSuccessfulVdsContact: true,
      ebmDeviceId: true,
      ebmSerialNo: true,
      branches: {
        where: { OR: [{ ebmDeviceId: { not: null } }, { ebmSerialNo: { not: null } }, { bhfId: { not: null } }] },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!org) {
    throw Object.assign(new Error('Organization not found'), { statusCode: 404 });
  }

  // Training receipts (TS/TR) go through the VSDC like every other type
  // (CIS §6/§22), so training mode gets no exemption here.

  // No VSDC device configured anywhere (org or branch) — there is nothing to
  // be "offline" from. Fiscalisation itself still fails/queues per sale; the
  // hard block only makes sense once a device exists.
  const hasDevice = Boolean(org.ebmDeviceId || org.ebmSerialNo || org.branches.length > 0);
  if (!hasDevice) {
    return true;
  }

  const lastContact = org.lastSuccessfulVdsContact;
  if (!lastContact) {
    // No contact ever recorded — allow initial sales but flag it
    return true;
  }

  const elapsed = Date.now() - lastContact.getTime();
  const VSDC_OFFLINE_BLOCK_MS = getOfflineBlockMs();
  const VSDC_OFFLINE_WARN_MS = Math.floor(VSDC_OFFLINE_BLOCK_MS * 0.8);
  const blockHours = Math.round(VSDC_OFFLINE_BLOCK_MS / (60 * 60 * 1000));

  if (elapsed >= VSDC_OFFLINE_BLOCK_MS) {
    const hoursOffline = Math.floor(elapsed / (60 * 60 * 1000));
    throw Object.assign(
      new Error(
        `VSDC unreachable for ${hoursOffline}h (>${blockHours}h limit). ` +
        'Receipt generation is blocked. Contact system administrator to restore connectivity.',
      ),
      { statusCode: 503 },
    );
  }

  if (elapsed >= VSDC_OFFLINE_WARN_MS) {
    const minsOffline = Math.floor(elapsed / (60 * 1000));
    console.warn(
      `[VSDC] Organization ${organizationId}: ${minsOffline}min since last successful VSDC contact. ` +
      `Approaching the ${blockHours}h hard limit.`,
    );
  }

  return true;
}

/**
 * Express middleware — applies 24-hour offline guard to any route it's mounted on.
 *
 * Usage:
 *   router.post('/sales', vsdcOnlineGuard, salesController.createSale);
 *
 * Expects `req.params.organizationId` to be set (by param resolution middleware
 * or from the route path).
 */
export function vsdcOnlineGuard(req: Request, res: Response, next: NextFunction): void {
  const orgId = parseInt(req.params.organizationId, 10);
  if (!orgId || isNaN(orgId)) {
    res.status(400).json(apiError('Missing or invalid organizationId'));
    return;
  }

  verifyVsdcOnlineStatus(orgId)
    .then(() => next())
    .catch((err: Error & { statusCode?: number }) => {
      const status = err.statusCode || 503;
      res.status(status).json(apiError(err.message));
    });
}

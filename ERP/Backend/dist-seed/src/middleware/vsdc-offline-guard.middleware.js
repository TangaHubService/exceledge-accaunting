"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyVsdcOnlineStatus = verifyVsdcOnlineStatus;
exports.vsdcOnlineGuard = vsdcOnlineGuard;
const prisma_1 = require("../lib/prisma");
const apiResponse_1 = require("../utils/apiResponse");
// C11: configurable offline block threshold (default 2h per RRA operational guidance)
// Set VSDC_OFFLINE_BLOCK_MS in .env to override (e.g. "86400000" for legacy 24h behaviour)
const VSDC_OFFLINE_BLOCK_MS = Number(process.env.VSDC_OFFLINE_BLOCK_MS ?? 2 * 60 * 60 * 1000);
// Warn at 80% of the block threshold
const VSDC_OFFLINE_WARN_MS = Math.floor(VSDC_OFFLINE_BLOCK_MS * 0.8);
/**
 * Check whether the VSDC has been reachable within the configured window.
 *
 * - Returns `true` if contact was made within the allowed window.
 * - Logs a warning at 80% of the threshold.
 * - Throws a structured error beyond the block threshold (default 2h).
 */
async function verifyVsdcOnlineStatus(organizationId) {
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            lastSuccessfulVdsContact: true,
            trainingMode: true,
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
    // Training mode never talks to the VSDC — a stale heartbeat must not block it.
    if (org.trainingMode) {
        return true;
    }
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
    const blockHours = Math.round(VSDC_OFFLINE_BLOCK_MS / (60 * 60 * 1000));
    if (elapsed >= VSDC_OFFLINE_BLOCK_MS) {
        const hoursOffline = Math.floor(elapsed / (60 * 60 * 1000));
        throw Object.assign(new Error(`VSDC unreachable for ${hoursOffline}h (>${blockHours}h limit). ` +
            'Receipt generation is blocked. Contact system administrator to restore connectivity.'), { statusCode: 503 });
    }
    if (elapsed >= VSDC_OFFLINE_WARN_MS) {
        const minsOffline = Math.floor(elapsed / (60 * 1000));
        console.warn(`[VSDC] Organization ${organizationId}: ${minsOffline}min since last successful VSDC contact. ` +
            `Approaching the ${blockHours}h hard limit.`);
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
function vsdcOnlineGuard(req, res, next) {
    const orgId = parseInt(req.params.organizationId, 10);
    if (!orgId || isNaN(orgId)) {
        res.status(400).json((0, apiResponse_1.error)('Missing or invalid organizationId'));
        return;
    }
    verifyVsdcOnlineStatus(orgId)
        .then(() => next())
        .catch((err) => {
        const status = err.statusCode || 503;
        res.status(status).json((0, apiResponse_1.error)(err.message));
    });
}

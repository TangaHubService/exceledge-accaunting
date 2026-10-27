"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vsdcHeartbeatJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const vsdc_api_service_1 = require("../services/vsdc-api.service");
// Must run well inside the offline-block window (default 2h, see
// vsdc-offline-guard.middleware.ts) or a real overnight sales lull trips the
// guard even though the VSDC is actually still reachable. Runs 3x per window
// so one failed/skipped run doesn't let the guard go stale, clamped to a
// sane range regardless of how VSDC_OFFLINE_BLOCK_MS is configured.
const VSDC_OFFLINE_BLOCK_MS = Number(process.env.VSDC_OFFLINE_BLOCK_MS ?? 2 * 60 * 60 * 1000);
const HEARTBEAT_MINUTES = Math.max(5, Math.min(360, Math.floor(VSDC_OFFLINE_BLOCK_MS / 3 / 60000)));
/**
 * VSDC heartbeat — issues a state-check handshake to every configured VSDC
 * device (per branch, with an org-level fallback for legacy single-branch
 * tenants — see listActiveVsdcDevices). On the first success for an
 * organization, `lastSuccessfulVdsContact` is refreshed so the offline guard
 * stays accurate even during zero-sales intervals. Training-mode orgs are
 * included: their sales never hit the VSDC, so only the heartbeat can keep
 * their guard from tripping.
 */
exports.vsdcHeartbeatJob = node_cron_1.default.schedule(`*/${HEARTBEAT_MINUTES} * * * *`, async () => {
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return;
    }
    try {
        const devices = await (0, vsdc_api_service_1.listActiveVsdcDevices)({ includeTrainingMode: true });
        const refreshed = new Set();
        let successCount = 0;
        let failCount = 0;
        for (const dev of devices) {
            try {
                const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(dev.organizationId, dev.branchId);
                const result = await (0, vsdc_api_service_1.vsdcHeartbeat)(envelope);
                if (result.success) {
                    successCount += 1;
                    if (!refreshed.has(dev.organizationId)) {
                        refreshed.add(dev.organizationId);
                        await prisma_1.prisma.organization.update({
                            where: { id: dev.organizationId },
                            data: { lastSuccessfulVdsContact: new Date(), lastSyncCursor: new Date() },
                        });
                    }
                }
                else {
                    failCount += 1;
                    console.warn(`[VSDC heartbeat] ${dev.label} (${dev.tin}): ${result.error}`);
                }
            }
            catch (e) {
                failCount += 1;
                console.warn(`[VSDC heartbeat] ${dev.label} error:`, e);
            }
        }
        if (successCount > 0 || failCount > 0) {
            console.log(`[VSDC heartbeat] devices=${devices.length} succeeded=${successCount} failed=${failCount} orgs-refreshed=${refreshed.size}`);
        }
    }
    catch (e) {
        console.error('[VSDC heartbeat] job error:', e);
    }
});

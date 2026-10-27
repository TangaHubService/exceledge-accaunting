"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rraMasterDataJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const rra_master_data_service_1 = require("../services/rra-master-data.service");
const purchase_sync_service_1 = require("../services/purchase-sync.service");
const rra_import_service_1 = require("../services/rra-import.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Daily incremental pull of the RRA VSDC master data every EBM-enabled
 * organisation depends on — Codes (§59), item classifications / UNSPSC (§61)
 * and notices (§65). Each sync is incremental (sends the stored `lastReqDt`),
 * so a daily cadence keeps the local caches fresh without re-pulling
 * everything. Runs early morning, before trading, at a different minute from
 * the Z-report job.
 */
exports.rraMasterDataJob = node_cron_1.default.schedule('20 4 * * *', async () => {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return;
    try {
        const organizations = await prisma_1.prisma.organization.findMany({
            where: {
                isActive: true,
                TIN: { not: null },
                OR: [{ ebmDeviceId: { not: null } }, { ebmSerialNo: { not: null } }],
            },
            select: { id: true, TIN: true },
        });
        let ok = 0;
        let failed = 0;
        for (const org of organizations) {
            try {
                const outcomes = await (0, rra_master_data_service_1.syncAllRraMasterData)(org.id);
                // §70: also pull the day's B2B purchases issued to this taxpayer.
                await (0, purchase_sync_service_1.syncRraPurchases)(org.id).catch((e) => logger_1.default.warn(`[RRA-MASTER-DATA] org ${org.id} purchases pull failed`, e));
                // §66: pull any new import-declaration lines (cursor-driven — no manual request date here).
                await (0, rra_import_service_1.syncRraImports)(org.id).catch((e) => logger_1.default.warn(`[RRA-MASTER-DATA] org ${org.id} imports pull failed`, e));
                const bad = outcomes.filter((o) => !o.ok);
                if (bad.length) {
                    failed += 1;
                    logger_1.default.warn(`[RRA-MASTER-DATA] org ${org.id}: ${bad.map((b) => `${b.resource}=${b.error}`).join(', ')}`);
                }
                else {
                    ok += 1;
                }
            }
            catch (e) {
                failed += 1;
                logger_1.default.error(`[RRA-MASTER-DATA] org ${org.id} sync error`, e);
            }
        }
        if (ok || failed) {
            logger_1.default.info(`[RRA-MASTER-DATA] daily sync: ok=${ok} failed=${failed}`);
        }
    }
    catch (e) {
        logger_1.default.error('[RRA-MASTER-DATA] job failed', e);
    }
});

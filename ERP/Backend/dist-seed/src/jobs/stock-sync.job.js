"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockSyncJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const stock_movement_sync_service_1 = require("../services/stock-movement-sync.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Push queued (non-sale) inventory movements to the VSDC as Stock In/Out
 * records + Stock Master updates (RRA checklist §72/§73). Runs every 5 minutes
 * as a backstop; movement write paths mark rows PENDING and this drains them.
 */
exports.stockSyncJob = node_cron_1.default.schedule('*/5 * * * *', async () => {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return;
    try {
        const result = await (0, stock_movement_sync_service_1.processStockSyncBatch)(50);
        if (result.processed > 0) {
            logger_1.default.info(`[STOCK-SYNC] processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`);
        }
    }
    catch (e) {
        logger_1.default.error('[STOCK-SYNC] job failed', e);
    }
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ebmOutboxJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const ebm_outbox_service_1 = require("../services/ebm-outbox.service");
/**
 * Process the EBM transactional outbox every 2 minutes.
 * Handles PENDING, PROCESSING (orphan reconciliation), and FAILED retries.
 */
exports.ebmOutboxJob = node_cron_1.default.schedule('*/2 * * * *', async () => {
    if (!(0, ebm_outbox_service_1.isEbmEnabled)()) {
        return;
    }
    try {
        const { processed, succeeded, failed } = await (0, ebm_outbox_service_1.processEbmOutboxBatch)(40);
        if (processed > 0) {
            console.log(`[EBM outbox] processed=${processed} succeeded=${succeeded} failed=${failed}`);
        }
    }
    catch (e) {
        console.error('[EBM outbox] job error:', e);
    }
});

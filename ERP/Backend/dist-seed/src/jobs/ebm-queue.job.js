"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ebmQueueJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const rra_ebm_service_1 = require("../services/rra-ebm.service");
/**
 * Retries pending EBM/VSDC submissions every 2 minutes when EBM is enabled.
 */
exports.ebmQueueJob = node_cron_1.default.schedule("*/2 * * * *", async () => {
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return;
    }
    try {
        const { processed, succeeded, failed } = await (0, rra_ebm_service_1.processEbmQueueBatch)(40);
        if (processed > 0) {
            console.log(`[EBM queue] processed=${processed} succeeded=${succeeded} failed=${failed}`);
        }
    }
    catch (e) {
        console.error("[EBM queue] job error:", e);
    }
});

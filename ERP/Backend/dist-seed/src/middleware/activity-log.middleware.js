"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logManualActivity = logManualActivity;
const activity_log_service_1 = __importDefault(require("../services/activity-log.service"));
const prisma_1 = require("../lib/prisma");
/**
 * Manually log an activity
 */
async function logManualActivity(params) {
    try {
        const activityLogService = new activity_log_service_1.default(prisma_1.prisma);
        await activityLogService.createLog({
            userId: params.userId,
            organizationId: params.organizationId,
            module: params.module,
            status: params.status || 'SUCCESS',
            type: params.type,
            entityType: params.entityType,
            entityId: params.entityId,
            description: params.description,
            metadata: params.metadata || {},
            ipAddress: params.ipAddress || '0.0.0.0',
            userAgent: params.userAgent || 'system',
            branchId: params.branchId || null,
        });
        return { success: true };
    }
    catch (error) {
        console.error('Error in logManualActivity:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
exports.default = {
    logManualActivity
};

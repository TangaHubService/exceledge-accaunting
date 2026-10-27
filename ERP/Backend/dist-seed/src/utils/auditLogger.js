"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLogger = void 0;
const activity_log_middleware_1 = require("../middleware/activity-log.middleware");
/**
 * Standardized Audit Logger
 * Simplifies logging across different modules by automatically capturing request context.
 */
exports.auditLogger = {
    /**
     * Log an activity for any module
     */
    log: async (req, module, params) => {
        const userId = req.user?.userId;
        const organizationId = parseInt(req.params?.organizationId || req.user?.organizationId || '0');
        const branchId = req.selectedBranchId !== undefined && req.selectedBranchId !== null
            ? req.selectedBranchId
            : undefined;
        return (0, activity_log_middleware_1.logManualActivity)({
            userId: userId ? parseInt(userId) : 0,
            organizationId,
            module,
            type: params.type,
            status: params.status || 'SUCCESS',
            description: params.description,
            entityType: params.entityType,
            entityId: params.entityId,
            metadata: params.metadata,
            ipAddress: req.ip,
            userAgent: req.headers?.['user-agent'],
            branchId,
        });
    },
    // Convenience methods for each module
    sales: (req, params) => exports.auditLogger.log(req, 'SALES', params),
    inventory: (req, params) => exports.auditLogger.log(req, 'INVENTORY', params),
    customers: (req, params) => exports.auditLogger.log(req, 'CUSTOMERS', params),
    users: (req, params) => exports.auditLogger.log(req, 'USERS', params),
    purchaseOrders: (req, params) => exports.auditLogger.log(req, 'PURCHASE_ORDERS', params),
    system: (req, params) => exports.auditLogger.log(req, 'SYSTEM', params),
};
exports.default = exports.auditLogger;

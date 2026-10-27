import { ActivityType, LogModule, LogStatus } from '@prisma/client';
import { logManualActivity } from '../middleware/activity-log.middleware';

/**
 * Standardized Audit Logger
 * Simplifies logging across different modules by automatically capturing request context.
 */
export const auditLogger = {
    /**
     * Log an activity for any module
     */
    log: async (req: any, module: LogModule, params: {
        type: ActivityType,
        description: string,
        entityType?: string,
        entityId?: string | number,
        metadata?: any,
        status?: LogStatus
    }) => {
        const userId = req.user?.userId;
        const organizationId = parseInt(req.params?.organizationId || req.user?.organizationId || '0');
        const branchId = req.selectedBranchId !== undefined && req.selectedBranchId !== null
            ? req.selectedBranchId
            : undefined;

        return logManualActivity({
            userId: userId ? parseInt(userId as string) : 0,
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
    sales: (req: any, params: any) => auditLogger.log(req, 'SALES', params),
    inventory: (req: any, params: any) => auditLogger.log(req, 'INVENTORY', params),
    customers: (req: any, params: any) => auditLogger.log(req, 'CUSTOMERS', params),
    users: (req: any, params: any) => auditLogger.log(req, 'USERS', params),
    purchaseOrders: (req: any, params: any) => auditLogger.log(req, 'PURCHASE_ORDERS', params),
    system: (req: any, params: any) => auditLogger.log(req, 'SYSTEM', params),
};

export default auditLogger;

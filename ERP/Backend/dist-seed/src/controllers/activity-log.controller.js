"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const activity_log_service_1 = __importDefault(require("../services/activity-log.service"));
const prisma_1 = require("../lib/prisma");
const activityLogService = new activity_log_service_1.default(prisma_1.prisma);
class ActivityLogController {
    async getActivityLogs(req, res) {
        try {
            const { userId, module, status, type, entityType, entityId, startDate, endDate, page = '1', pageSize = '20' } = req.query;
            const organizationId = parseInt(req.params.organizationId);
            if (!organizationId) {
                return res.status(400).json({ error: 'Organization ID is required' });
            }
            const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
            const filters = {
                userId: userId ? parseInt(userId) : undefined,
                module: module,
                status: status,
                type: type,
                entityType: entityType,
                entityId: entityId ? parseInt(entityId) : undefined,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                branchId: branchFilter.branchId,
            };
            const pagination = {
                page: parseInt(page, 10) || 1,
                pageSize: parseInt(pageSize, 10) || 20,
            };
            const result = await activityLogService.getActivityLogs(organizationId, filters, pagination);
            return res.json(result);
        }
        catch (error) {
            console.error('Error fetching activity logs:', error);
            return res.status(500).json({ error: 'Failed to fetch activity logs' });
        }
    }
    async getActivityLogById(req, res) {
        try {
            const id = parseInt(req.params.id);
            const organizationId = parseInt(req.params.organizationId);
            if (!organizationId) {
                return res.status(400).json({ error: 'Organization ID is required' });
            }
            const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
            const activityLog = await prisma_1.prisma.activityLog.findFirst({
                where: {
                    id,
                    organizationId,
                    ...branchFilter,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true
                        },
                    },
                },
            });
            if (!activityLog) {
                return res.status(404).json({ error: 'Activity log not found' });
            }
            return res.json(activityLog);
        }
        catch (error) {
            console.error('Error fetching activity log:', error);
            return res.status(500).json({ error: 'Failed to fetch activity log' });
        }
    }
}
exports.default = new ActivityLogController();

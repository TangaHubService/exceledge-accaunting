import { Response } from 'express';
import { ActivityType, LogModule, LogStatus } from '@prisma/client';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { buildBranchFilter } from '../middleware/branchAuth.middleware';
import ActivityLogService from '../services/activity-log.service';
import { prisma } from '../lib/prisma';
const activityLogService = new ActivityLogService(prisma);

class ActivityLogController {
  async getActivityLogs(req: BranchAuthRequest, res: Response) {
    try {
      const {
        userId,
        module,
        status,
        type,
        entityType,
        entityId,
        startDate,
        endDate,
        page = '1',
        pageSize = '20'
      } = req.query;

      const organizationId = parseInt(req.params.organizationId);

      if (!organizationId) {
        return res.status(400).json({ error: 'Organization ID is required' });
      }

      const branchFilter = buildBranchFilter(req);

      const filters = {
        userId: userId ? parseInt(userId as string) : undefined,
        module: module as LogModule | undefined,
        status: status as LogStatus | undefined,
        type: type as ActivityType | undefined,
        entityType: entityType as string | undefined,
        entityId: entityId ? parseInt(entityId as string) : undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        branchId: branchFilter.branchId as number | undefined,
      };

      const pagination = {
        page: parseInt(page as string, 10) || 1,
        pageSize: parseInt(pageSize as string, 10) || 20,
      };

      const result = await activityLogService.getActivityLogs(
        organizationId,
        filters,
        pagination
      );

      return res.json(result);
    } catch (error) {
      console.error('Error fetching activity logs:', error);
      return res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
  }

  async getActivityLogById(req: BranchAuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id);
      const organizationId = parseInt(req.params.organizationId);

      if (!organizationId) {
        return res.status(400).json({ error: 'Organization ID is required' });
      }

      const branchFilter = buildBranchFilter(req);

      const activityLog = await prisma.activityLog.findFirst({
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
    } catch (error) {
      console.error('Error fetching activity log:', error);
      return res.status(500).json({ error: 'Failed to fetch activity log' });
    }
  }

  // Add more controller methods as needed...
}

export default new ActivityLogController();

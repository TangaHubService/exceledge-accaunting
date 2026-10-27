import { ActivityType, LogModule, LogStatus } from '@prisma/client';
import ActivityLogService from '../services/activity-log.service';
import { prisma } from '../lib/prisma';

// Interface for manual activity log parameters
export interface ManualActivityLogParams {
  userId: number;
  organizationId: number;
  module: LogModule;
  type: ActivityType;
  status?: LogStatus;
  description: string;
  entityType?: string;
  entityId?: string | number; // Can be string or number, will be converted to string
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  branchId?: number | null;
}

/**
 * Manually log an activity
 */
export async function logManualActivity(params: ManualActivityLogParams) {
  try {
    const activityLogService = new ActivityLogService(prisma);

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
  } catch (error) {
    console.error('Error in logManualActivity:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export default {
  logManualActivity
};

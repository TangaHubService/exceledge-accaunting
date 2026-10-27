import { PrismaClient, Prisma, ActivityType, LogModule, LogStatus } from '@prisma/client';
import { Request } from 'express';

type ActivityLogData = {
  organizationId?: number | null;
  userId?: number | null;
  module: LogModule;
  type: ActivityType;
  status?: LogStatus;
  entityType?: string;
  entityId?: string | number; // Can be string or number, will be converted to string
  description: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
  branchId?: number | null;
};

class ActivityLogService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private getClientInfo(req: Request) {
    return {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
  }

  async createLog(data: ActivityLogData) {
    try {
      const result = await this.prisma.activityLog.create({
        data: {
          ...data,
          organizationId: data.organizationId && data.organizationId !== 0 ? data.organizationId : null,
          userId: data.userId && data.userId !== 0 ? data.userId : null,
          status: data.status || 'SUCCESS',
          branchId: data.branchId || null,
          entityId: data.entityId !== undefined ? String(data.entityId) : null,
          metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        },
      });

      return result;
    } catch (error) {
      console.error('[ActivityLogService] Failed to create activity log:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data: {
          ...data,
          metadata: data.metadata ? '[Object]' : 'undefined',
        },
      });
      return null;
    }
  }

  async logUserActivity(
    req: Request,
    userId: number | null,
    organizationId: number | null,
    module: LogModule,
    type: ActivityType,
    description: string,
    entityType?: string,
    entityId?: number | string,
    metadata?: any,
    status: LogStatus = 'SUCCESS'
  ) {
    const { ipAddress, userAgent } = this.getClientInfo(req);

    return this.createLog({
      userId,
      organizationId,
      module,
      type,
      description,
      entityType,
      entityId,
      metadata,
      ipAddress,
      userAgent,
      status,
    });
  }

  async getActivityLogs(
    organizationId: number,
    filters: {
      userId?: number;
      module?: LogModule;
      type?: ActivityType;
      status?: LogStatus;
      entityType?: string;
      entityId?: number;
      startDate?: Date;
      endDate?: Date;
      branchId?: number;
    },
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 }
  ) {
    const { userId, module, type, status, entityType, entityId, startDate, endDate, branchId } = filters;
    const { page, pageSize } = pagination;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ActivityLogWhereInput = {
      organizationId,
      ...(branchId !== undefined && { branchId }),
      ...(userId && { userId }),
      ...(module && { module }),
      ...(type && { type }),
      ...(status && { status }),
      ...(entityType && { entityType }),
      ...(entityId && { entityId: String(entityId) }),
      ...((startDate || endDate) && {
        createdAt: {
          ...(startDate && {
            gte: (() => {
              const d = new Date(startDate);
              d.setUTCHours(0, 0, 0, 0);
              return d;
            })()
          }),
          ...(endDate && {
            lte: (() => {
              const d = new Date(endDate);
              d.setUTCHours(23, 59, 59, 999);
              return d;
            })()
          }),
        },
      }),
    };

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // Specific activity log methods
  async logUserLogin(req: Request, userId: number, organizationId: number) {
    return this.logUserActivity(
      req,
      userId,
      organizationId,
      'USERS',
      'USER_LOGIN',
      'User logged in',
      'User',
      userId
    );
  }

  async logProductUpdate(
    req: Request,
    userId: number,
    organizationId: number,
    productId: number,
    changes: Record<string, any>
  ) {
    return this.logUserActivity(
      req,
      userId,
      organizationId,
      'INVENTORY',
      'PRODUCT_UPDATE',
      'Product updated',
      'Product',
      productId,
      { changes }
    );
  }

  async logSaleCreation(
    req: Request,
    userId: number,
    organizationId: number,
    saleId: number,
    saleData: any
  ) {
    return this.logUserActivity(
      req,
      userId,
      organizationId,
      'SALES',
      'SALE_CREATE',
      'New sale created',
      'Sale',
      saleId,
      { saleData }
    );
  }

  async logPurchaseOrderCreation(
    req: Request,
    userId: number,
    organizationId: number,
    orderId: number,
    orderData: any
  ) {
    return this.logUserActivity(
      req,
      userId,
      organizationId,
      'PURCHASE_ORDERS',
      'PURCHASE_ORDER_CREATE',
      'New purchase order created',
      'PurchaseOrder',
      orderId,
      { orderData }
    );
  }

  // Add more specific log methods as needed...
}

export default ActivityLogService;

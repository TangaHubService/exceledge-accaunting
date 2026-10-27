import { PrismaClient, Prisma } from '@prisma/client';
import { getIO } from '../utils/socket';

class NotificationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createNotification(data: {
    organizationId: number;
    title: string;
    message: string;
    type?: Prisma.JsonValue | any;
    data?: any;
    recipientId?: number | null;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        organizationId: data.organizationId,
        title: data.title,
        message: data.message,
        type: (data.type as any) || 'GENERIC',
        data: data.data ? JSON.parse(JSON.stringify(data.data)) : undefined,
        recipientId: data.recipientId || null,
      },
    });

    // Emit notification via WebSocket to organization room
    try {
      const io = getIO();
      io.to(`org-${data.organizationId}`).emit('newNotification', notification);
      console.log(`Notification emitted to org-${data.organizationId}:`, notification.id);
    } catch (error) {
      console.error('Error emitting notification via WebSocket:', error);
      // Don't throw - notification was created successfully
    }

    return notification;
  }

  async getNotifications(
    organizationId: number,
    options: { unread?: boolean; page?: number; pageSize?: number } = {}
  ) {
    const { unread, page = 1, pageSize = 20 } = options;
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationWhereInput = {
      organizationId,
      ...(unread ? { isRead: false } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async markAsRead(organizationId: number, id: number) {
    return this.prisma.notification.updateMany({
      where: { id, organizationId },
      data: { isRead: true },
    });
  }
}

export default NotificationService;

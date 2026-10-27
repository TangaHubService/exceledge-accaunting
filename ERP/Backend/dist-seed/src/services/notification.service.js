"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const socket_1 = require("../utils/socket");
class NotificationService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createNotification(data) {
        const notification = await this.prisma.notification.create({
            data: {
                organizationId: data.organizationId,
                title: data.title,
                message: data.message,
                type: data.type || 'GENERIC',
                data: data.data ? JSON.parse(JSON.stringify(data.data)) : undefined,
                recipientId: data.recipientId || null,
            },
        });
        // Emit notification via WebSocket to organization room
        try {
            const io = (0, socket_1.getIO)();
            io.to(`org-${data.organizationId}`).emit('newNotification', notification);
            console.log(`Notification emitted to org-${data.organizationId}:`, notification.id);
        }
        catch (error) {
            console.error('Error emitting notification via WebSocket:', error);
            // Don't throw - notification was created successfully
        }
        return notification;
    }
    async getNotifications(organizationId, options = {}) {
        const { unread, page = 1, pageSize = 20 } = options;
        const skip = (page - 1) * pageSize;
        const where = {
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
    async markAsRead(organizationId, id) {
        return this.prisma.notification.updateMany({
            where: { id, organizationId },
            data: { isRead: true },
        });
    }
}
exports.default = NotificationService;

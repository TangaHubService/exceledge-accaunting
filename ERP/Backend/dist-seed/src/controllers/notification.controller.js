"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const notification_service_1 = __importDefault(require("../services/notification.service"));
const events_1 = require("../lib/events");
const prisma_1 = require("../lib/prisma");
const notificationService = new notification_service_1.default(prisma_1.prisma);
class NotificationController {
    async createNotification(req, res) {
        try {
            const organizationId = parseInt(req.params.organizationId);
            if (!organizationId)
                return res.status(400).json({ error: 'Organization ID is required' });
            const { title, message, type, data, recipientId } = req.body;
            if (!title || !message)
                return res.status(400).json({ error: 'title and message are required' });
            const result = await notificationService.createNotification({
                organizationId,
                title,
                message,
                type,
                data,
                recipientId,
            });
            return res.status(201).json(result);
        }
        catch (error) {
            console.error('Error creating notification:', error);
            return res.status(500).json({ error: 'Failed to create notification' });
        }
    }
    async getNotifications(req, res) {
        try {
            const organizationId = parseInt(req.params.organizationId);
            if (!organizationId)
                return res.status(400).json({ error: 'Organization ID is required' });
            const { unread, page = '1', pageSize = '20' } = req.query;
            const options = {
                unread: unread === 'true',
                page: parseInt(page, 10) || 1,
                pageSize: parseInt(pageSize, 10) || 20,
            };
            const result = await notificationService.getNotifications(organizationId, options);
            return res.json(result);
        }
        catch (error) {
            console.error('Error fetching notifications:', error);
            return res.status(500).json({ error: 'Failed to fetch notifications' });
        }
    }
    async markAsRead(req, res) {
        try {
            const organizationId = parseInt(req.params.organizationId);
            const id = parseInt(req.params.id);
            if (!organizationId)
                return res.status(400).json({ error: 'Organization ID is required' });
            if (!id)
                return res.status(400).json({ error: 'Notification ID is required' });
            await notificationService.markAsRead(organizationId, id);
            return res.json({ message: 'Notification marked as read' });
        }
        catch (error) {
            console.error('Error marking notification as read:', error);
            return res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    }
    async triggerEvent(req, res) {
        try {
            const { organizationId } = req.params;
            const { type, data, recipientId } = req.body;
            if (!organizationId || !type) {
                return res.status(400).json({ error: 'Organization ID and event type are required' });
            }
            await events_1.eventService.emit({
                organizationId,
                type,
                data,
                recipientId,
            });
            return res.json({ success: true });
        }
        catch (error) {
            console.error('Error triggering event:', error);
            return res.status(500).json({ error: 'Failed to trigger event' });
        }
    }
}
exports.default = new NotificationController();

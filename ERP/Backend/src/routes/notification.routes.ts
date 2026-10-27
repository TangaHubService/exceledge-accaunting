import { Router } from 'express';
import notificationController from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';

const router = Router();

const orgAccess = requireOrganizationAccess();

// Create a notification for an organization
router.post('/:organizationId', authenticate, orgAccess, notificationController.createNotification);

// Get notifications for an organization (supports ?unread=true & pagination)
router.get('/:organizationId', authenticate, orgAccess, notificationController.getNotifications);

// Mark a notification as read
router.patch('/:organizationId/:id/read', authenticate, orgAccess, notificationController.markAsRead);

// Trigger an event that might generate notifications
router.post('/:organizationId/events', authenticate, orgAccess, notificationController.triggerEvent);

export default router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notification_controller_1 = __importDefault(require("../controllers/notification.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// Create a notification for an organization
router.post('/:organizationId', auth_middleware_1.authenticate, orgAccess, notification_controller_1.default.createNotification);
// Get notifications for an organization (supports ?unread=true & pagination)
router.get('/:organizationId', auth_middleware_1.authenticate, orgAccess, notification_controller_1.default.getNotifications);
// Mark a notification as read
router.patch('/:organizationId/:id/read', auth_middleware_1.authenticate, orgAccess, notification_controller_1.default.markAsRead);
// Trigger an event that might generate notifications
router.post('/:organizationId/events', auth_middleware_1.authenticate, orgAccess, notification_controller_1.default.triggerEvent);
exports.default = router;

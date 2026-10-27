"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const system_owner_controller_1 = require("../controllers/system-owner.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require system owner authentication
router.use(auth_middleware_1.authenticate);
router.use(auth_middleware_1.requireSystemOwner);
// Dashboard stats
router.get("/dashboard/stats", system_owner_controller_1.systemOwnerController.getDashboardStats);
// Organization management
router.get("/organizations", system_owner_controller_1.systemOwnerController.getAllOrganizations);
router.get("/organizations/:id", system_owner_controller_1.systemOwnerController.getOrganizationDetails);
router.patch("/organizations/:id/status", system_owner_controller_1.systemOwnerController.updateOrganizationStatus);
// Subscription management
router.get("/subscriptions", system_owner_controller_1.systemOwnerController.getAllSubscriptions);
router.get("/subscriptions/expiring", system_owner_controller_1.systemOwnerController.getExpiringSubscriptions);
router.patch("/subscriptions/:id/extend", system_owner_controller_1.systemOwnerController.extendSubscription);
// Payment management
router.get("/payments", system_owner_controller_1.systemOwnerController.getAllPayments);
router.get("/payments/pending", system_owner_controller_1.systemOwnerController.getPendingPayments);
router.patch("/payments/:id/status", system_owner_controller_1.systemOwnerController.updatePaymentStatus);
router.post("/payments/:id/resend-invoice", system_owner_controller_1.systemOwnerController.resendInvoice);
// Analytics
router.get("/analytics/revenue", system_owner_controller_1.systemOwnerController.getRevenueAnalytics);
router.get("/analytics/growth", system_owner_controller_1.systemOwnerController.getGrowthAnalytics);
exports.default = router;

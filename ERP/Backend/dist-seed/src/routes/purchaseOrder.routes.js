"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const purchaseOrder_controller_1 = require("../controllers/purchaseOrder.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.authenticate);
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// Get all purchase orders
router.get("/:organizationId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, purchaseOrder_controller_1.getPurchaseOrders);
// Get single purchase order
router.get("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, purchaseOrder_controller_1.getPurchaseOrder);
// Create purchase order (Admin/Manager only)
router.post("/:organizationId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), purchaseOrder_controller_1.createPurchaseOrder);
// Update purchase order details (items, notes, expected date)
router.put("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), purchaseOrder_controller_1.updatePurchaseOrder);
// Update purchase order status (Admin/Manager only)
router.patch("/:organizationId/:id/status", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), purchaseOrder_controller_1.updatePurchaseOrderStatus);
// Delete purchase order (Admin only)
router.delete("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), purchaseOrder_controller_1.deletePurchaseOrder);
exports.default = router;

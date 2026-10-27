"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supplier_payment_controller_1 = require("../controllers/supplier-payment.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.authenticate);
router.use((0, organizationAccess_middleware_1.requireOrganizationAccess)());
router.use('/:organizationId', (0, feature_access_middleware_1.requireActiveSubscription)());
router.use(branchAuth_middleware_1.branchAuth);
/**
 * @route POST /api/supplier-payments/:organizationId
 * @desc Record a new supplier payment
 */
router.post("/:organizationId", (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_payment_controller_1.recordSupplierPayment);
/**
 * @route GET /api/supplier-payments/:organizationId
 * @desc Get all supplier payments for an organization
 */
router.get("/:organizationId", (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), supplier_payment_controller_1.getSupplierPayments);
/**
 * @route GET /api/supplier-payments/:organizationId/:id
 * @desc Get supplier payment by ID
 */
router.get("/:organizationId/:id", (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), supplier_payment_controller_1.getSupplierPaymentById);
/**
 * @route DELETE /api/supplier-payments/:organizationId/:id
 * @desc Delete supplier payment
 */
router.delete("/:organizationId/:id", (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_payment_controller_1.deleteSupplierPayment);
exports.default = router;

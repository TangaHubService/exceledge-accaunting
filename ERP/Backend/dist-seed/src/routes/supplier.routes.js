"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const supplier_controller_1 = require("../controllers/supplier.controller");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// All routes require authentication
router.use(auth_middleware_1.authenticate);
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// Get all suppliers
router.get("/:organizationId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, supplier_controller_1.getSuppliers);
// Get single supplier
router.get("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, supplier_controller_1.getSupplier);
// Create supplier (Admin/Manager only)
router.post("/:organizationId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_controller_1.createSupplier);
// Update supplier (Admin/Manager only)
router.put("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_controller_1.updateSupplier);
// Delete supplier (Admin only)
router.delete("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_controller_1.deleteSupplier);
// Import routes (legacy - kept for backward compatibility)
router.post("/:organizationId/import", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), upload.single("file"), supplier_controller_1.bulkImportSuppliers);
router.get("/:organizationId/import/template", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, supplier_controller_1.downloadSupplierTemplate);
// New preview/confirm import routes
router.post("/:organizationId/import/preview", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), upload.single("file"), supplier_controller_1.previewImportSuppliers);
router.post("/:organizationId/import/confirm", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_controller_1.confirmImportSuppliers);
router.get("/:organizationId/import/errors/:importId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), supplier_controller_1.downloadSupplierErrorFile);
exports.default = router;

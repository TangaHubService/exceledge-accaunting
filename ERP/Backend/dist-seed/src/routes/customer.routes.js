"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const customer_controller_1 = require("../controllers/customer.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
router.get("/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, customer_controller_1.getCustomers);
router.get("/:organizationId/:id", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, customer_controller_1.getCustomerById);
router.post("/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, customer_controller_1.createCustomer);
router.put("/:id/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, customer_controller_1.updateCustomer);
router.delete("/:id/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN"), customer_controller_1.deleteCustomer);
// Import routes (legacy - kept for backward compatibility)
router.post("/:organizationId/import", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT"), upload.single("file"), customer_controller_1.bulkImportCustomers);
router.get("/:organizationId/import/template", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, customer_controller_1.downloadCustomerTemplate);
// New preview/confirm import routes
router.post("/:organizationId/import/preview", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT"), upload.single("file"), customer_controller_1.previewImportCustomers);
router.post("/:organizationId/import/confirm", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT"), customer_controller_1.confirmImportCustomers);
router.get("/:organizationId/import/errors/:importId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT"), customer_controller_1.downloadCustomerErrorFile);
exports.default = router;

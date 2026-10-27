"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const batch_controller_1 = require("../controllers/batch.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.authenticate);
router.use((0, organizationAccess_middleware_1.requireOrganizationAccess)());
router.use('/:organizationId', (0, feature_access_middleware_1.requireActiveSubscription)());
router.use(branchAuth_middleware_1.branchAuth);
// Get batches for a product
router.get('/:organizationId/product/:productId', batch_controller_1.getProductBatches);
// Get single batch
router.get('/:organizationId/:id', batch_controller_1.getBatch);
// Create batch (Admin/Manager only)
router.post('/:organizationId', (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT'), batch_controller_1.createBatchController);
// Select batches for sale (used internally)
router.post('/:organizationId/select', batch_controller_1.selectBatches);
exports.default = router;

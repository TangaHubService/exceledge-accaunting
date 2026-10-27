"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bom_controller_1 = require("../controllers/bom.controller");
const production_controller_1 = require("../controllers/production.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// BOM Routes
router.post('/:organizationId/products/:productId/bom', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), bom_controller_1.addBomComponent);
router.get('/:organizationId/products/:productId/bom', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, bom_controller_1.listBomComponents);
router.get('/:organizationId/products/:productId/bom/:componentId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, bom_controller_1.getBomComponent);
router.put('/:organizationId/products/:productId/bom/:componentId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), bom_controller_1.updateBomComponentController);
router.delete('/:organizationId/products/:productId/bom/:componentId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), bom_controller_1.removeBomComponent);
router.get('/:organizationId/products/:productId/bom/cost', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, bom_controller_1.getBomCost);
router.get('/:organizationId/products/:productId/production/requirements', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, bom_controller_1.checkProductionRequirementsController);
// Production Routes
router.post('/:organizationId/production/runs', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), production_controller_1.createProductionRun);
router.get('/:organizationId/production/runs', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, production_controller_1.listProductionRuns);
router.get('/:organizationId/production/runs/:runId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, production_controller_1.getProductionRun);
router.post('/:organizationId/production/runs/:runId/reverse', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), production_controller_1.reverseProductionRunController);
exports.default = router;

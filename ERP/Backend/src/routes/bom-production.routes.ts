import { Router } from 'express';
import {
  addBomComponent,
  listBomComponents,
  getBomComponent,
  updateBomComponentController,
  removeBomComponent,
  getBomCost,
  checkProductionRequirementsController,
} from '../controllers/bom.controller';
import {
  createProductionRun,
  listProductionRuns,
  getProductionRun,
  reverseProductionRunController,
} from '../controllers/production.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import { branchAuth } from '../middleware/branchAuth.middleware';
import { requireActiveSubscription } from '../middleware/feature-access.middleware';

const router = Router();

const orgAccess = requireOrganizationAccess();

// BOM Routes
router.post(
  '/:organizationId/products/:productId/bom',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  addBomComponent,
);

router.get(
  '/:organizationId/products/:productId/bom',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  listBomComponents,
);

router.get(
  '/:organizationId/products/:productId/bom/:componentId',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  getBomComponent,
);

router.put(
  '/:organizationId/products/:productId/bom/:componentId',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  updateBomComponentController,
);

router.delete(
  '/:organizationId/products/:productId/bom/:componentId',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  removeBomComponent,
);

router.get(
  '/:organizationId/products/:productId/bom/cost',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  getBomCost,
);

router.get(
  '/:organizationId/products/:productId/production/requirements',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  checkProductionRequirementsController,
);

// Production Routes
router.post(
  '/:organizationId/production/runs',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  createProductionRun,
);

router.get(
  '/:organizationId/production/runs',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  listProductionRuns,
);

router.get(
  '/:organizationId/production/runs/:runId',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  getProductionRun,
);

router.post(
  '/:organizationId/production/runs/:runId/reverse',
  authenticate,
  orgAccess,
  requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  reverseProductionRunController,
);

export default router;
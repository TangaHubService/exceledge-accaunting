import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchAuth } from '../middleware/branchAuth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import {
  createHeldSaleController,
  listHeldSalesController,
  getHeldSaleController,
  resumeHeldSaleController,
  cancelHeldSaleController,
} from '../controllers/held-sale.controller';

const router = Router();
const orgAccess = requireOrganizationAccess();
const roles = authorize('ADMIN', 'SELLER', 'ACCOUNTANT', 'BRANCH_MANAGER');

router.use(authenticate);

router.post('/:organizationId', orgAccess, requireActiveSubscription(), branchAuth, roles, createHeldSaleController);
router.get('/:organizationId', orgAccess, requireActiveSubscription(), branchAuth, roles, listHeldSalesController);
router.get('/:organizationId/:id', orgAccess, requireActiveSubscription(), branchAuth, roles, getHeldSaleController);
router.post('/:organizationId/:id/resume', orgAccess, requireActiveSubscription(), branchAuth, roles, resumeHeldSaleController);
router.delete('/:organizationId/:id', orgAccess, requireActiveSubscription(), branchAuth, roles, cancelHeldSaleController);

export default router;

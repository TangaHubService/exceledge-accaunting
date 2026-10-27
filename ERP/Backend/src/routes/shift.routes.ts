import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchAuth } from '../middleware/branchAuth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import {
  openShiftController,
  getActiveShiftController,
  getShiftSummaryController,
  getShiftDetailsController,
  listShiftsController,
  startCloseController,
  submitCloseController,
  approveCloseController,
  rejectCloseController,
  reopenShiftController,
  cancelShiftController,
  createCashMovementController,
  getDailySummaryController,
  closeShiftLegacyController,
} from '../controllers/shift.controller';
import { prisma } from '../lib/prisma';
import type { Response, NextFunction } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';

const router = Router();
const orgAccess = requireOrganizationAccess();
const cashierRoles = authorize('ADMIN', 'SELLER', 'ACCOUNTANT', 'BRANCH_MANAGER');
const managerRoles = authorize('ADMIN', 'BRANCH_MANAGER');
const adminRoles = authorize('ADMIN');

router.use(authenticate);

/** A cashier must never approve/reject their own shift (business rule 9). */
const guardNotOwnShift = async (req: BranchAuthRequest, res: Response, next: NextFunction) => {
  try {
    const shift = await prisma.shift.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { userId: true, organizationId: true },
    });
    if (!shift || shift.organizationId !== parseInt(req.params.organizationId)) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (String(shift.userId) === String(req.user?.userId)) {
      return res.status(403).json({ error: 'You cannot review your own shift' });
    }
    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to verify shift ownership' });
  }
};

router.post('/:organizationId', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, openShiftController);
router.get('/:organizationId/active', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, getActiveShiftController);
router.get('/:organizationId', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, listShiftsController);
router.get('/:organizationId/daily', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, getDailySummaryController);
router.get('/:organizationId/:id/summary', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, getShiftSummaryController);
router.get('/:organizationId/:id/details', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, getShiftDetailsController);
router.post('/:organizationId/cash-movements', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, createCashMovementController);
router.post('/:organizationId/:id/start-close', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, startCloseController);
router.post('/:organizationId/:id/submit-close', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, submitCloseController);
router.put('/:organizationId/:id/close', orgAccess, requireActiveSubscription(), branchAuth, cashierRoles, closeShiftLegacyController);
router.post('/:organizationId/:id/approve', orgAccess, requireActiveSubscription(), branchAuth, managerRoles, guardNotOwnShift, approveCloseController);
router.post('/:organizationId/:id/reject', orgAccess, requireActiveSubscription(), branchAuth, managerRoles, guardNotOwnShift, rejectCloseController);
router.post('/:organizationId/:id/reopen', orgAccess, requireActiveSubscription(), branchAuth, adminRoles, reopenShiftController);
router.post('/:organizationId/:id/cancel', orgAccess, requireActiveSubscription(), branchAuth, adminRoles, cancelShiftController);

export default router;
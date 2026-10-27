import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import {
  getBranchesController,
  getBranch,
  getUserBranchesController,
  getUserPrimaryBranchController,
  createBranchController,
  updateBranchController,
  setDefaultBranchController,
  deleteBranchController,
  assignUserToBranchController,
  removeUserFromBranchController,
  getBranchUsersController,
} from '../controllers/branch.controller';

const router = Router();

const orgAccess = requireOrganizationAccess();

// All routes require authentication
router.use(authenticate);

// Static paths must be registered before /:organizationId
router.get('/user/all', getUserBranchesController);
router.get('/user/primary', getUserPrimaryBranchController);

// Get all branches
router.get('/:organizationId', orgAccess, requireActiveSubscription(), getBranchesController);

// Get single branch
router.get('/:organizationId/:id', orgAccess, requireActiveSubscription(), getBranch);

// Create branch (Admin/Manager only)
router.post('/:organizationId', orgAccess, requireActiveSubscription(), authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), createBranchController);

// Update branch (Admin/Manager only)
router.put('/:organizationId/:id', orgAccess, requireActiveSubscription(), authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), updateBranchController);

// Set default branch (Admin/Manager only)
router.put('/:organizationId/:id/default', orgAccess, requireActiveSubscription(), authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), setDefaultBranchController);

// Delete branch (Admin only)
router.delete('/:organizationId/:id', orgAccess, requireActiveSubscription(), authorize('ADMIN'), deleteBranchController);

// Assign user to branch
router.post('/:organizationId/:id/users', orgAccess, requireActiveSubscription(), authorize('ADMIN', 'BRANCH_MANAGER'), assignUserToBranchController);

// Remove user from branch
router.delete('/:organizationId/:id/users/:userId', orgAccess, requireActiveSubscription(), authorize('ADMIN', 'BRANCH_MANAGER'), removeUserFromBranchController);

// Get branch users
router.get('/:organizationId/:id/users', orgAccess, requireActiveSubscription(), authorize('ADMIN', 'BRANCH_MANAGER'), getBranchUsersController);

export default router;

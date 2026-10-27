import { Router } from 'express';
import activityLogController from '../controllers/activity-log.controller';
import { authenticate } from '../middleware/auth.middleware';
import { branchAuth } from '../middleware/branchAuth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';

const router = Router();

const orgAccess = requireOrganizationAccess();

// Get activity logs with filters
router.get('/:organizationId', authenticate, orgAccess, branchAuth, activityLogController.getActivityLogs);

// Get a specific activity log by ID
router.get('/:organizationId/:id', authenticate, orgAccess, branchAuth, activityLogController.getActivityLogById);

export default router;

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import {
  registerDeviceController,
  listDevicesController,
  deactivateDeviceController,
} from '../controllers/device.controller';

const router = Router();
const orgAccess = requireOrganizationAccess();

router.use(authenticate);

router.post('/:organizationId', orgAccess, registerDeviceController);
router.get('/:organizationId', orgAccess, authorize('ADMIN', 'BRANCH_MANAGER'), listDevicesController);
router.put('/:organizationId/:id/deactivate', orgAccess, authorize('ADMIN', 'BRANCH_MANAGER'), deactivateDeviceController);

export default router;

import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { branchAuth } from "../middleware/branchAuth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import {
  listStockTransfers,
  getStockTransfer,
  createStockTransfer,
  approveStockTransfer,
  rejectStockTransfer,
  completeStockTransfer,
} from "../controllers/stock-transfer.controller";

const router = Router();

const orgAccess = requireOrganizationAccess();

router.use(authenticate);

router.get("/:organizationId", orgAccess, requireActiveSubscription(), branchAuth, listStockTransfers);
router.get("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, getStockTransfer);
router.post(
  "/:organizationId",
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  createStockTransfer
);
router.post(
  "/:organizationId/:id/approve",
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  approveStockTransfer
);
router.post(
  "/:organizationId/:id/reject",
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  rejectStockTransfer
);
router.post(
  "/:organizationId/:id/complete",
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  completeStockTransfer
);

export default router;

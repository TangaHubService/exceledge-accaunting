import { Router } from "express";
import {
  getDashboardStats,
  getSalesTrend,
  getNotifications,
  topSellingProducts,
  getDetailedInventory,
  getBranchDashboardStats,
  getExecutiveDashboard,
  getOverviewDashboard,
} from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import { branchAuth } from "../middleware/branchAuth.middleware";

const router = Router();

const orgAccess = requireOrganizationAccess();

router.get("/overview/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getOverviewDashboard);
router.get("/stats/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getDashboardStats);
router.get("/sales-trend/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getSalesTrend);
router.get("/notifications/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getNotifications);
router.get("/:organizationId/top-selling-products", authenticate, orgAccess, requireActiveSubscription(), branchAuth, topSellingProducts);
router.get("/:organizationId/detailed-inventory", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getDetailedInventory);
router.get("/branch-stats/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getBranchDashboardStats);
router.get("/executive/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getExecutiveDashboard);

export default router;

import { Router } from "express"
import { authenticate, authorize } from "../middleware/auth.middleware"
import { branchAuth } from "../middleware/branchAuth.middleware"
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware"
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import {
    getPurchaseOrders,
    getPurchaseOrder,
    createPurchaseOrder,
    updatePurchaseOrder,
    updatePurchaseOrderStatus,
    deletePurchaseOrder,
} from "../controllers/purchaseOrder.controller"

const router = Router()

// All routes require authentication
router.use(authenticate)

const orgAccess = requireOrganizationAccess()

// Get all purchase orders
router.get("/:organizationId", orgAccess, requireActiveSubscription(), branchAuth, getPurchaseOrders)

// Get single purchase order
router.get("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, getPurchaseOrder)

// Create purchase order (Admin/Manager only)
router.post("/:organizationId", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), createPurchaseOrder)

// Update purchase order details (items, notes, expected date)
router.put("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), updatePurchaseOrder)

// Update purchase order status (Admin/Manager only)
router.patch("/:organizationId/:id/status", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), updatePurchaseOrderStatus)

// Delete purchase order (Admin only)
router.delete("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"), deletePurchaseOrder)

export default router

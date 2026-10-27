import { Router } from "express"
import multer from "multer"
import { authenticate, authorize } from "../middleware/auth.middleware"
import { branchAuth } from "../middleware/branchAuth.middleware"
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware"
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import {
    getSuppliers,
    getSupplier,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    bulkImportSuppliers,
    downloadSupplierTemplate,
    previewImportSuppliers,
    confirmImportSuppliers,
    downloadSupplierErrorFile,
} from "../controllers/supplier.controller"

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// All routes require authentication
router.use(authenticate)

const orgAccess = requireOrganizationAccess()

// Get all suppliers
router.get("/:organizationId", orgAccess, requireActiveSubscription(), branchAuth, getSuppliers)

// Get single supplier
router.get("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, getSupplier)

// Create supplier (Admin/Manager only)
router.post("/:organizationId", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), createSupplier)

// Update supplier (Admin/Manager only)
router.put("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), updateSupplier)

// Delete supplier (Admin only)
router.delete("/:organizationId/:id", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), deleteSupplier)

// Import routes (legacy - kept for backward compatibility)
router.post("/:organizationId/import", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), upload.single("file"), bulkImportSuppliers)
router.get("/:organizationId/import/template", orgAccess, requireActiveSubscription(), branchAuth, downloadSupplierTemplate)

// New preview/confirm import routes
router.post("/:organizationId/import/preview", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), upload.single("file"), previewImportSuppliers)
router.post("/:organizationId/import/confirm", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), confirmImportSuppliers)
router.get("/:organizationId/import/errors/:importId", orgAccess, requireActiveSubscription(), branchAuth, authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), downloadSupplierErrorFile)

export default router

import { Router } from "express";
import {
    recordSupplierPayment,
    getSupplierPayments,
    getSupplierPaymentById,
    deleteSupplierPayment
} from "../controllers/supplier-payment.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { branchAuth } from "../middleware/branchAuth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { requireActiveSubscription } from "../middleware/feature-access.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireOrganizationAccess());
router.use('/:organizationId', requireActiveSubscription());
router.use(branchAuth);

/**
 * @route POST /api/supplier-payments/:organizationId
 * @desc Record a new supplier payment
 */
router.post("/:organizationId", authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), recordSupplierPayment);

/**
 * @route GET /api/supplier-payments/:organizationId
 * @desc Get all supplier payments for an organization
 */
router.get("/:organizationId", authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), getSupplierPayments);

/**
 * @route GET /api/supplier-payments/:organizationId/:id
 * @desc Get supplier payment by ID
 */
router.get("/:organizationId/:id", authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), getSupplierPaymentById);

/**
 * @route DELETE /api/supplier-payments/:organizationId/:id
 * @desc Delete supplier payment
 */
router.delete("/:organizationId/:id", authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), deleteSupplierPayment);

export default router;

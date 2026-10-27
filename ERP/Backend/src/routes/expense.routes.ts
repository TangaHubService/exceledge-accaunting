import { Router } from "express";
import {
    createExpense,
    getExpenses,
    getExpenseById,
    updateExpense,
    deleteExpense
} from "../controllers/expense.controller";
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
 * @route POST /api/expenses/:organizationId
 * @desc Create a new expense
 */
router.post("/:organizationId", authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), createExpense);

/**
 * @route GET /api/expenses/:organizationId
 * @desc Get all expenses for an organization
 */
router.get("/:organizationId", authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), getExpenses);

/**
 * @route GET /api/expenses/:organizationId/:id
 * @desc Get expense by ID
 */
router.get("/:organizationId/:id", authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), getExpenseById);

/**
 * @route PUT /api/expenses/:organizationId/:id
 * @desc Update expense
 */
router.put("/:organizationId/:id", authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), updateExpense);

/**
 * @route DELETE /api/expenses/:organizationId/:id
 * @desc Delete expense
 */
router.delete("/:organizationId/:id", authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), deleteExpense);

export default router;

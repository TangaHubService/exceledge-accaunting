import { Router } from "express";
import {
  approveRun,
  cancelRun,
  createEmployee,
  createRun,
  getRun,
  listEmployees,
  listRuns,
  payRun,
  previewPayslip,
  recalculateRun,
  updateEmployee,
} from "../controllers/payroll.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { requireActiveSubscription } from "../middleware/feature-access.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";

const router = Router();

router.use(authenticate);
router.use(requireOrganizationAccess());
router.use("/:organizationId", requireActiveSubscription());

const payrollStaff = authorize("SYSTEM_OWNER", "ADMIN", "ACCOUNTANT");
const payrollApprovers = authorize("SYSTEM_OWNER", "ADMIN");

router.get("/:organizationId/employees", payrollStaff, listEmployees);
router.post("/:organizationId/employees", payrollStaff, createEmployee);
router.put("/:organizationId/employees/:id", payrollStaff, updateEmployee);
router.post("/:organizationId/preview", payrollStaff, previewPayslip);

router.get("/:organizationId/runs", payrollStaff, listRuns);
router.post("/:organizationId/runs", payrollStaff, createRun);
router.get("/:organizationId/runs/:id", payrollStaff, getRun);
router.post("/:organizationId/runs/:id/recalculate", payrollStaff, recalculateRun);
router.post("/:organizationId/runs/:id/cancel", payrollStaff, cancelRun);
router.post("/:organizationId/runs/:id/approve", payrollApprovers, approveRun);
router.post("/:organizationId/runs/:id/pay", payrollStaff, payRun);

export default router;

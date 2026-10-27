"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const shift_controller_1 = require("../controllers/shift.controller");
const prisma_1 = require("../lib/prisma");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
const cashierRoles = (0, auth_middleware_1.authorize)('ADMIN', 'SELLER', 'ACCOUNTANT', 'BRANCH_MANAGER');
const managerRoles = (0, auth_middleware_1.authorize)('ADMIN', 'BRANCH_MANAGER');
const adminRoles = (0, auth_middleware_1.authorize)('ADMIN');
router.use(auth_middleware_1.authenticate);
/** A cashier must never approve/reject their own shift (business rule 9). */
const guardNotOwnShift = async (req, res, next) => {
    try {
        const shift = await prisma_1.prisma.shift.findUnique({
            where: { id: parseInt(req.params.id) },
            select: { userId: true, organizationId: true },
        });
        if (!shift || shift.organizationId !== parseInt(req.params.organizationId)) {
            return res.status(404).json({ error: 'Shift not found' });
        }
        if (String(shift.userId) === String(req.user?.userId)) {
            return res.status(403).json({ error: 'You cannot review your own shift' });
        }
        next();
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'Failed to verify shift ownership' });
    }
};
router.post('/:organizationId', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.openShiftController);
router.get('/:organizationId/active', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.getActiveShiftController);
router.get('/:organizationId', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.listShiftsController);
router.get('/:organizationId/daily', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.getDailySummaryController);
router.get('/:organizationId/:id/summary', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.getShiftSummaryController);
router.get('/:organizationId/:id/details', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.getShiftDetailsController);
router.post('/:organizationId/cash-movements', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.createCashMovementController);
router.post('/:organizationId/:id/start-close', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.startCloseController);
router.post('/:organizationId/:id/submit-close', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.submitCloseController);
router.put('/:organizationId/:id/close', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, cashierRoles, shift_controller_1.closeShiftLegacyController);
router.post('/:organizationId/:id/approve', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, managerRoles, guardNotOwnShift, shift_controller_1.approveCloseController);
router.post('/:organizationId/:id/reject', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, managerRoles, guardNotOwnShift, shift_controller_1.rejectCloseController);
router.post('/:organizationId/:id/reopen', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, adminRoles, shift_controller_1.reopenShiftController);
router.post('/:organizationId/:id/cancel', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, adminRoles, shift_controller_1.cancelShiftController);
exports.default = router;

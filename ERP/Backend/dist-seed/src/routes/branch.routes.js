"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const branch_controller_1 = require("../controllers/branch.controller");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// All routes require authentication
router.use(auth_middleware_1.authenticate);
// Static paths must be registered before /:organizationId
router.get('/user/all', branch_controller_1.getUserBranchesController);
router.get('/user/primary', branch_controller_1.getUserPrimaryBranchController);
// Get all branches
router.get('/:organizationId', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branch_controller_1.getBranchesController);
// Get single branch
router.get('/:organizationId/:id', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branch_controller_1.getBranch);
// Create branch (Admin/Manager only)
router.post('/:organizationId', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), branch_controller_1.createBranchController);
// Update branch (Admin/Manager only)
router.put('/:organizationId/:id', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), branch_controller_1.updateBranchController);
// Set default branch (Admin/Manager only)
router.put('/:organizationId/:id/default', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), branch_controller_1.setDefaultBranchController);
// Delete branch (Admin only)
router.delete('/:organizationId/:id', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN'), branch_controller_1.deleteBranchController);
// Assign user to branch
router.post('/:organizationId/:id/users', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN', 'BRANCH_MANAGER'), branch_controller_1.assignUserToBranchController);
// Remove user from branch
router.delete('/:organizationId/:id/users/:userId', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN', 'BRANCH_MANAGER'), branch_controller_1.removeUserFromBranchController);
// Get branch users
router.get('/:organizationId/:id/users', orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)('ADMIN', 'BRANCH_MANAGER'), branch_controller_1.getBranchUsersController);
exports.default = router;

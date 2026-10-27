"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const activity_log_controller_1 = __importDefault(require("../controllers/activity-log.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// Get activity logs with filters
router.get('/:organizationId', auth_middleware_1.authenticate, orgAccess, branchAuth_middleware_1.branchAuth, activity_log_controller_1.default.getActivityLogs);
// Get a specific activity log by ID
router.get('/:organizationId/:id', auth_middleware_1.authenticate, orgAccess, branchAuth_middleware_1.branchAuth, activity_log_controller_1.default.getActivityLogById);
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const verification_controller_1 = require("../controllers/verification.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Auth routes
router.post("/login", auth_controller_1.login);
router.post("/signup", auth_controller_1.signup);
router.post("/refresh", auth_controller_1.refresh);
router.post("/logout", auth_middleware_1.authenticate, auth_controller_1.logout);
router.post("/change-password", auth_middleware_1.authenticate, auth_controller_1.changePassword);
router.get("/check-password/:userId", auth_controller_1.checkPasswordRequirement);
router.get("/me", auth_middleware_1.authenticate, auth_controller_1.getCurrentUser);
router.post("/switch-organization", auth_middleware_1.authenticate, auth_controller_1.switchOrganization);
// Verification routes
router.post("/verify-account", verification_controller_1.verifyAccount);
router.post("/resend-verification", verification_controller_1.resendVerification);
router.post("/request-password-reset", verification_controller_1.requestPasswordReset);
router.post("/verify-password-reset-code", verification_controller_1.verifyPasswordResetCode);
router.post("/reset-password", verification_controller_1.resetPassword);
exports.default = router;

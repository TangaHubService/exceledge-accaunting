import { Router } from "express"
import {
    login,
    signup,
    getCurrentUser,
    changePassword,
    checkPasswordRequirement,
    switchOrganization,
    refresh,
    logout
} from "../controllers/auth.controller"
import {
    verifyAccount,
    resendVerification,
    requestPasswordReset,
    verifyPasswordResetCode,
    resetPassword
} from "../controllers/verification.controller"
import { authenticate } from "../middleware/auth.middleware"

const router = Router()

// Auth routes
router.post("/login", login)
router.post("/signup", signup)
router.post("/refresh", refresh)
router.post("/logout", authenticate, logout)
router.post("/change-password", authenticate, changePassword)
router.get("/check-password/:userId", checkPasswordRequirement)
router.get("/me", authenticate, getCurrentUser)
router.post("/switch-organization", authenticate, switchOrganization)

// Verification routes
router.post("/verify-account", verifyAccount)
router.post("/resend-verification", resendVerification)
router.post("/request-password-reset", requestPasswordReset)
router.post("/verify-password-reset-code", verifyPasswordResetCode)
router.post("/reset-password", resetPassword)

export default router

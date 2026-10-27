"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyPasswordResetCode = exports.requestPasswordReset = exports.resendVerification = exports.verifyAccount = void 0;
const email_service_1 = require("../services/email.service");
const token_utils_1 = require("../utils/token.utils");
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
// Verify user's email with verification code
const verifyAccount = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ error: "Verification code is required" });
        }
        // Find user by email
        const user = await prisma_1.prisma.user.findFirst({
            where: { verificationToken: code },
        });
        if (!user) {
            return res.status(404).json({ error: "Invalid or expired verification code" });
        }
        // Check if user is already verified
        if (user.isEmailVerified) {
            return res.status(400).json({ error: "Email is already verified" });
        }
        // Check if verification code matches and is not expired
        if (user.verificationToken !== code ||
            !user.verificationExpiry ||
            (0, token_utils_1.isTokenExpired)(user.verificationExpiry)) {
            return res.status(400).json({ error: "Invalid or expired verification code" });
        }
        // Update user as verified
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                isEmailVerified: true,
                isActive: true,
                verificationToken: null,
                verificationExpiry: null,
            },
        });
        return res.json({ message: "Email verified successfully" });
    }
    catch (error) {
        console.error("[Verify Account Error]:", error);
        return res.status(500).json({ error: "Failed to verify account" });
    }
};
exports.verifyAccount = verifyAccount;
// Resend verification email
const resendVerification = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        // Find user by email
        const user = await prisma_1.prisma.user.findUnique({
            where: { email },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Check if user is already verified
        if (user.isEmailVerified) {
            return res.status(400).json({ error: "Email is already verified" });
        }
        // Generate new verification token
        const { token, expires } = (0, token_utils_1.generateVerificationToken)();
        // Update user with new verification token
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                verificationToken: token,
                verificationExpiry: expires,
            },
        });
        // Send verification email
        await email_service_1.emailService.sendVerificationEmail(user.email, user.name, token);
        return res.json({ message: "Verification email sent successfully" });
    }
    catch (error) {
        console.error("[Resend Verification Error]:", error);
        return res.status(500).json({ error: "Failed to resend verification email" });
    }
};
exports.resendVerification = resendVerification;
// Request password reset
const requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        // Find user by email
        const user = await prisma_1.prisma.user.findUnique({
            where: { email },
        });
        if (!user) {
            return res.status(404).json({ error: "No account found with this email address" });
        }
        // Generate a password reset OTP and only store its hash.
        const { token, expires } = (0, token_utils_1.generatePasswordResetToken)();
        const hashedToken = crypto_1.default.createHash('sha256').update(token).digest('hex');
        // Update user with password reset token
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordResetToken: hashedToken,
                passwordResetExpiry: expires,
            },
        });
        // Send password reset email
        await email_service_1.emailService.sendPasswordResetEmail(user.email, user.name, token);
        console.log(`[Password Reset] Requested for user=${user.email} userId=${user.id}`);
        return res.json({ message: "Password reset email sent successfully" });
    }
    catch (error) {
        console.error("[Request Password Reset Error]:", error);
        return res.status(500).json({ error: "Failed to process password reset request" });
    }
};
exports.requestPasswordReset = requestPasswordReset;
// Verify a mobile password-reset OTP without consuming it. The OTP is consumed
// only after the user submits a valid new password through resetPassword.
const verifyPasswordResetCode = async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: "Email and verification code are required" });
        }
        const normalizedCode = String(code).trim();
        if (!/^\d{6}$/.test(normalizedCode)) {
            return res.status(400).json({ error: "Enter the 6-digit verification code" });
        }
        const incomingTokenHash = crypto_1.default.createHash('sha256').update(normalizedCode).digest('hex');
        const user = await prisma_1.prisma.user.findFirst({
            where: {
                email,
                passwordResetToken: incomingTokenHash,
                passwordResetExpiry: { gt: new Date() },
            },
            select: { id: true },
        });
        if (!user) {
            return res.status(400).json({ error: "Invalid or expired verification code" });
        }
        return res.json({ message: "Verification code is valid" });
    }
    catch (error) {
        console.error("[Verify Password Reset Code Error]:", error);
        return res.status(500).json({ error: "Failed to verify password reset code" });
    }
};
exports.verifyPasswordResetCode = verifyPasswordResetCode;
// Reset password with the email-bound OTP.
const resetPassword = async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        if (!email || !code || !newPassword) {
            return res.status(400).json({ error: "Email, verification code, and new password are required" });
        }
        // Validate password strength
        if (newPassword.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters long" });
        }
        const normalizedCode = String(code).trim();
        if (!/^\d{6}$/.test(normalizedCode)) {
            return res.status(400).json({ error: "Enter the 6-digit verification code" });
        }
        // Hash incoming OTP and look up the matching user/reset request.
        const incomingTokenHash = crypto_1.default.createHash('sha256').update(normalizedCode).digest('hex');
        const user = await prisma_1.prisma.user.findFirst({
            where: {
                email,
                passwordResetToken: incomingTokenHash,
                passwordResetExpiry: { gt: new Date() },
            },
        });
        if (!user) {
            return res.status(400).json({ error: "Invalid or expired password reset code" });
        }
        // Hash new password
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        // Update password, clear reset token, revoke all sessions atomically
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                passwordResetToken: null,
                passwordResetExpiry: null,
                refreshToken: null,
                refreshTokenExpiry: null,
                requirePasswordChange: false,
            },
        });
        // Send password reset confirmation email (best-effort, don't roll back on failure)
        email_service_1.emailService.sendPasswordResetConfirmation(user.email, user.name).catch((err) => {
            console.error("[Reset Password] Confirmation email failed:", err);
        });
        return res.json({ message: "Password reset successful" });
    }
    catch (error) {
        console.error("[Reset Password Error]:", error);
        return res.status(500).json({ error: "Failed to reset password" });
    }
};
exports.resetPassword = resetPassword;

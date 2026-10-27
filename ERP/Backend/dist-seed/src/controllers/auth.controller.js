"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentUser = exports.checkPasswordRequirement = exports.changePassword = exports.switchOrganization = exports.logout = exports.refresh = exports.login = exports.signup = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const auditLogger_1 = require("../utils/auditLogger");
const email_service_1 = require("../services/email.service");
const token_utils_1 = require("../utils/token.utils");
const token_service_1 = require("../services/token.service");
const subscription_service_1 = require("../services/subscription.service");
const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
const signup = async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        if (!email || !password || !name) {
            return res.status(400).json({ error: "Email, password, and name are required" });
        }
        // Check if user exists
        const existingUser = await prisma_1.prisma.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            return res.status(400).json({ error: "User already exists" });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const { token: verificationToken, expires: verificationExpiry } = (0, token_utils_1.generateVerificationToken)();
        const user = await prisma_1.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                phone,
                requirePasswordChange: false,
                isActive: false,
                isEmailVerified: false,
                verificationToken,
                verificationExpiry,
            },
        });
        await email_service_1.emailService.sendVerificationEmail(user.email, user.name, verificationToken);
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_CREATED',
            description: `New user signup: ${user.email}`,
            entityType: 'User',
            entityId: user.id,
            metadata: {
                email: user.email,
                name: user.name,
            }
        });
        const authToken = jsonwebtoken_1.default.sign({
            userId: user.id,
            email: user.email,
            isVerified: false,
        }, process.env.JWT_SECRET, { expiresIn: "24h" });
        res.status(201).json({
            token: authToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                isEmailVerified: false,
                requirePasswordChange: false,
            },
            message: "Verification email sent. Please check your email to verify your account."
        });
    }
    catch (error) {
        console.error("[Signup Error]:", error);
        res.status(500).json({ error: "Signup failed" });
    }
};
exports.signup = signup;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await prisma_1.prisma.user.findUnique({
            where: { email },
            include: {
                userOrganizations: {
                    include: {
                        organization: true,
                    },
                },
            },
        });
        if (!user) {
            await auditLogger_1.auditLogger.users(req, {
                type: 'USER_LOGIN_FAILED',
                description: `Failed login attempt for email: ${email}`,
                status: 'FAILED',
                metadata: { email }
            });
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const isValidPassword = await bcryptjs_1.default.compare(password, user.password);
        if (!isValidPassword) {
            await auditLogger_1.auditLogger.users(req, {
                type: 'USER_LOGIN_FAILED',
                description: `Failed login attempt (wrong password) for: ${user.email}`,
                status: 'FAILED',
                entityType: 'User',
                entityId: user.id,
                metadata: { email: user.email }
            });
            return res.status(401).json({ error: "Invalid credentials" });
        }
        if (!user.isEmailVerified) {
            return res.status(403).json({
                error: "Email not verified. Please check your email for the verification link.",
                code: "EMAIL_NOT_VERIFIED",
                userId: user.id
            });
        }
        if (!user.isActive && user.role !== 'SYSTEM_OWNER') {
            return res.status(401).json({ error: "Account is inactive" });
        }
        const organizations = await Promise.all(user.userOrganizations.map(async (uo) => {
            const activeSubscription = await prisma_1.prisma.subscription.findFirst({
                where: {
                    organizationId: uo.organization.id,
                    status: { in: ['ACTIVE', 'TRIALING', 'GRACE_PERIOD'] },
                },
                orderBy: { endDate: 'desc' }
            });
            const subscriptionSummary = subscriptionService.computeSubscriptionSummary(activeSubscription);
            return {
                id: uo.organization.id,
                name: uo.organization.name,
                address: uo.organization.address,
                phone: uo.organization.phone,
                email: uo.organization.email,
                businessType: uo.organization.businessType,
                role: uo.role,
                isOwner: uo.isOwner,
                hasActiveSubscription: subscriptionSummary.hasActiveSubscription,
                subscriptionStatus: subscriptionSummary.subscriptionStatus || (uo.organization.isActive ? 'INACTIVE' : 'EXPIRED'),
                subscriptionEndDate: subscriptionSummary.subscriptionEndDate,
                daysUntilExpiry: subscriptionSummary.daysUntilExpiry,
                graceDaysRemaining: subscriptionSummary.graceDaysRemaining,
                graceDayLabel: subscriptionSummary.graceDayLabel,
                subscriptionWarningLevel: subscriptionSummary.warningLevel,
                subscriptionWarningMessage: subscriptionSummary.warningMessage,
            };
        }));
        const sortedUo = [...user.userOrganizations].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const primaryUo = sortedUo[0];
        const organizationIds = user.userOrganizations.map((uo) => uo.organizationId);
        // Fetch branch assignments for the primary organization
        let activeBranchId = null;
        let branchIds = [];
        if (primaryUo) {
            const userBranches = await prisma_1.prisma.userBranch.findMany({
                where: { userId: user.id },
                include: { branch: { select: { organizationId: true } } },
            });
            // Filter branches belonging to the primary organization
            const orgBranches = userBranches.filter(ub => ub.branch.organizationId === primaryUo.organizationId);
            branchIds = orgBranches.map(ub => ub.branchId);
            // Find primary branch, or use the first one
            const primaryBranch = orgBranches.find(ub => ub.isPrimary) ?? orgBranches[0];
            activeBranchId = primaryBranch?.branchId ?? null;
        }
        const tokenPayload = {
            userId: user.id,
            email: user.email,
            role: user.role,
            activeOrganizationId: primaryUo?.organizationId,
            organizationIds,
            organizationId: primaryUo?.organizationId ?? organizationIds,
            activeBranchId,
            branchIds,
        };
        const { accessToken, refreshToken } = (0, token_service_1.generateTokenPair)(tokenPayload);
        // Hash the refresh token before storing
        const hashedRefreshToken = crypto_1.default
            .createHash('sha256')
            .update(refreshToken)
            .digest('hex');
        // Store hashed refresh token and expiry in database
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: hashedRefreshToken,
                refreshTokenExpiry: (0, token_service_1.getRefreshTokenExpiry)(),
            },
        });
        const organizationId = user.userOrganizations[0]?.organizationId;
        if (organizationId) {
            await auditLogger_1.auditLogger.users(req, {
                type: 'USER_LOGIN',
                description: `User logged in to ${user.userOrganizations[0]?.organization.name}`,
                entityType: 'User',
                entityId: user.id,
                metadata: {
                    email: user.email,
                    organizationId,
                }
            });
        }
        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                requirePasswordChange: user.requirePasswordChange,
            },
            organizations: organizations.map((org, index) => ({
                ...org,
                branches: index === 0 ? branchIds : undefined,
                activeBranchId: index === 0 ? activeBranchId : undefined,
            })),
            hasOrganization: organizations.length > 0,
            activeBranchId,
            branchIds,
        });
    }
    catch (error) {
        console.error("[Login Error]:", error);
        res.status(500).json({ error: "Login failed" });
    }
};
exports.login = login;
const refresh = async (req, res) => {
    try {
        const { refreshToken: clientRefreshToken } = req.body;
        if (!clientRefreshToken) {
            return res.status(401).json({ error: "Refresh token required" });
        }
        // Verify the refresh token is valid
        let decoded;
        try {
            decoded = (0, token_service_1.verifyToken)(clientRefreshToken);
        }
        catch (error) {
            return res.status(401).json({ error: "Invalid or expired refresh token" });
        }
        // Hash the client refresh token to compare with stored hash
        const hashedRefreshToken = crypto_1.default
            .createHash('sha256')
            .update(clientRefreshToken)
            .digest('hex');
        // Find user and verify the refresh token matches
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                userOrganizations: {
                    include: {
                        organization: true,
                    },
                },
            },
        });
        if (!user || !user.refreshToken || user.refreshToken !== hashedRefreshToken) {
            return res.status(401).json({ error: "Invalid refresh token" });
        }
        if (!user.isActive && user.role !== 'SYSTEM_OWNER') {
            // Deactivated account — clear the stored token so this can't be replayed again.
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { refreshToken: null, refreshTokenExpiry: null },
            });
            return res.status(401).json({ error: "Account is deactivated" });
        }
        // Check if refresh token has expired
        if (user.refreshTokenExpiry && user.refreshTokenExpiry < new Date()) {
            return res.status(401).json({ error: "Refresh token has expired" });
        }
        const orgIdList = user.userOrganizations.map((uo) => uo.organizationId);
        let activeOrganizationId = decoded.activeOrganizationId ??
            (typeof decoded.organizationId === "number"
                ? decoded.organizationId
                : Array.isArray(decoded.organizationId)
                    ? decoded.organizationId[0]
                    : undefined);
        let roleForToken = decoded.role ?? user.role;
        if (activeOrganizationId != null) {
            const uo = user.userOrganizations.find((x) => x.organizationId === activeOrganizationId);
            if (uo) {
                roleForToken = uo.role;
            }
            else {
                activeOrganizationId = user.userOrganizations[0]?.organizationId;
                roleForToken = user.userOrganizations[0]?.role ?? user.role;
            }
        }
        else {
            activeOrganizationId = user.userOrganizations[0]?.organizationId;
            roleForToken = user.userOrganizations[0]?.role ?? user.role;
        }
        // Resolve branch context for the active organization
        let activeBranchId = decoded.activeBranchId ?? null;
        let branchIds = decoded.branchIds ?? [];
        if (activeOrganizationId != null) {
            const userBranches = await prisma_1.prisma.userBranch.findMany({
                where: { userId: user.id },
                include: { branch: { select: { organizationId: true } } },
            });
            const orgBranches = userBranches.filter(ub => ub.branch.organizationId === activeOrganizationId);
            branchIds = orgBranches.map(ub => ub.branchId);
            // If previously selected branch is no longer valid, pick the primary or first
            if (activeBranchId != null && !branchIds.includes(activeBranchId)) {
                const primaryBranch = orgBranches.find(ub => ub.isPrimary) ?? orgBranches[0];
                activeBranchId = primaryBranch?.branchId ?? null;
            }
        }
        const tokenPayload = {
            userId: user.id,
            email: user.email,
            role: roleForToken,
            activeOrganizationId,
            organizationIds: orgIdList,
            organizationId: activeOrganizationId ?? orgIdList,
            activeBranchId,
            branchIds,
        };
        const { accessToken, refreshToken: newRefreshToken } = (0, token_service_1.generateTokenPair)(tokenPayload);
        // Hash and store new refresh token
        const hashedNewRefreshToken = crypto_1.default
            .createHash('sha256')
            .update(newRefreshToken)
            .digest('hex');
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: hashedNewRefreshToken,
                refreshTokenExpiry: (0, token_service_1.getRefreshTokenExpiry)(),
            },
        });
        res.json({
            accessToken,
            refreshToken: newRefreshToken,
        });
    }
    catch (error) {
        console.error("[Refresh Token Error]:", error);
        res.status(500).json({ error: "Token refresh failed" });
    }
};
exports.refresh = refresh;
const logout = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        // Revoke refresh token by clearing it from database
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                refreshToken: null,
                refreshTokenExpiry: null,
            },
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_LOGOUT',
            description: `User logged out`,
            entityType: 'User',
            entityId: userId,
            status: 'SUCCESS',
        });
        res.json({ message: "Logged out successfully" });
    }
    catch (error) {
        console.error("[Logout Error]:", error);
        res.status(500).json({ error: "Logout failed" });
    }
};
exports.logout = logout;
const switchOrganization = async (req, res) => {
    try {
        //@ts-ignore
        const userId = req.user.userId;
        const { organizationId } = req.body;
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: parseInt(organizationId) },
            include: { userOrganizations: true },
        });
        if (!organization) {
            return res.status(403).json({ error: "Access denied to this organization" });
        }
        const userOrg = organization.userOrganizations.find((u) => u.userId === parseInt(userId));
        if (!userOrg) {
            return res.status(403).json({ error: "Access denied to this organization" });
        }
        const fullUser = await prisma_1.prisma.user.findUnique({
            where: { id: parseInt(userId) },
            include: { userOrganizations: true },
        });
        if (!fullUser) {
            return res.status(404).json({ error: "User not found" });
        }
        const organizationIds = fullUser.userOrganizations.map((uo) => uo.organizationId);
        // Fetch branch assignments for the new organization
        const userBranches = await prisma_1.prisma.userBranch.findMany({
            where: { userId: fullUser.id },
            include: { branch: { select: { organizationId: true } } },
        });
        const orgBranches = userBranches.filter(ub => ub.branch.organizationId === organization.id);
        const branchIds = orgBranches.map(ub => ub.branchId);
        const primaryBranch = orgBranches.find(ub => ub.isPrimary) ?? orgBranches[0];
        const activeBranchId = primaryBranch?.branchId ?? null;
        const { accessToken, refreshToken } = (0, token_service_1.generateTokenPair)({
            userId: parseInt(userId),
            email: fullUser.email,
            role: userOrg.role,
            activeOrganizationId: organization.id,
            organizationIds,
            organizationId: organization.id,
            activeBranchId,
            branchIds,
        });
        const hashedRefreshToken = crypto_1.default
            .createHash("sha256")
            .update(refreshToken)
            .digest("hex");
        await prisma_1.prisma.user.update({
            where: { id: parseInt(userId) },
            data: {
                refreshToken: hashedRefreshToken,
                refreshTokenExpiry: (0, token_service_1.getRefreshTokenExpiry)(),
            },
        });
        res.json({
            organization,
            accessToken,
            refreshToken,
            token: accessToken,
            user: {
                id: fullUser.id,
                email: fullUser.email,
                name: fullUser.name,
                role: fullUser.role,
            },
        });
    }
    catch (error) {
        console.error("[Switch Organization Error]:", error);
        res.status(500).json({ error: "Failed to switch organization" });
    }
};
exports.switchOrganization = switchOrganization;
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        //@ts-ignore
        const userId = req.user.userId;
        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: parseInt(userId) },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Verify current password
        const isValidPassword = await bcryptjs_1.default.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }
        // Hash new password
        const hashedPassword = await bcryptjs_1.default.hash(newPassword, 10);
        // Update password and remove requirement flag
        await prisma_1.prisma.user.update({
            where: { id: parseInt(userId) },
            data: {
                password: hashedPassword,
                requirePasswordChange: false,
                defaultPassword: null,
            },
        });
        res.json({ message: "Password changed successfully" });
    }
    catch (error) {
        console.error("[Change Password Error]:", error);
        res.status(500).json({ error: "Failed to change password" });
    }
};
exports.changePassword = changePassword;
const checkPasswordRequirement = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: parseInt(userId) },
            select: {
                requirePasswordChange: true,
            },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json({ requirePasswordChange: user.requirePasswordChange });
    }
    catch (error) {
        console.error("[Check Password Requirement Error]:", error);
        res.status(500).json({ error: "Failed to check password requirement" });
    }
};
exports.checkPasswordRequirement = checkPasswordRequirement;
const getCurrentUser = async (req, res) => {
    try {
        const authUser = req.user;
        //@ts-ignore
        const userId = authUser?.userId;
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: parseInt(userId) },
            include: {
                userOrganizations: {
                    include: {
                        organization: true,
                    },
                },
            },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        const organizations = await Promise.all(user.userOrganizations.map(async (uo) => {
            const activeSubscription = await prisma_1.prisma.subscription.findFirst({
                where: {
                    organizationId: uo.organization.id,
                    status: { in: ['ACTIVE', 'TRIALING', 'GRACE_PERIOD'] },
                },
                orderBy: { endDate: 'desc' }
            });
            const subscriptionSummary = subscriptionService.computeSubscriptionSummary(activeSubscription);
            // Fetch branch assignments for this organization
            const userBranches = await prisma_1.prisma.userBranch.findMany({
                where: { userId: user.id },
                include: { branch: { select: { organizationId: true } } },
            });
            const orgBranches = userBranches.filter(ub => ub.branch.organizationId === uo.organization.id);
            const branchIds = orgBranches.map(ub => ub.branchId);
            const primaryBranch = orgBranches.find(ub => ub.isPrimary) ?? orgBranches[0];
            return {
                id: uo.organization.id,
                name: uo.organization.name,
                address: uo.organization.address,
                phone: uo.organization.phone,
                email: uo.organization.email,
                businessType: uo.organization.businessType,
                role: uo.role,
                isOwner: uo.isOwner,
                hasActiveSubscription: subscriptionSummary.hasActiveSubscription,
                subscriptionStatus: subscriptionSummary.subscriptionStatus || (uo.organization.isActive ? 'INACTIVE' : 'EXPIRED'),
                subscriptionEndDate: subscriptionSummary.subscriptionEndDate,
                daysUntilExpiry: subscriptionSummary.daysUntilExpiry,
                graceDaysRemaining: subscriptionSummary.graceDaysRemaining,
                graceDayLabel: subscriptionSummary.graceDayLabel,
                subscriptionWarningLevel: subscriptionSummary.warningLevel,
                subscriptionWarningMessage: subscriptionSummary.warningMessage,
                branchIds,
                activeBranchId: primaryBranch?.branchId ?? null,
            };
        }));
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            phone: user.phone,
            isActive: user.isActive,
            organizations,
            profileImage: user.profileImage,
            requirePasswordChange: user.requirePasswordChange,
        });
    }
    catch (error) {
        console.error("[Get Current User Error]:", error);
        res.status(500).json({ error: "Failed to get user" });
    }
};
exports.getCurrentUser = getCurrentUser;

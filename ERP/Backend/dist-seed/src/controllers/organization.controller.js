"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOrganizationAvatar = exports.removeUserFromOrganization = exports.getOrganizationUsers = exports.acceptInvitation = exports.declineInvitation = exports.getInvitationDetails = exports.cancelInvitation = exports.bulkInviteUsers = exports.inviteUser = exports.deleteOrganization = exports.updateOrgSettings = exports.getOrgSettings = exports.updateOrganization = exports.createOrganization = exports.getOrganizationById = exports.getUserOrganizations = void 0;
const prisma_1 = require("../lib/prisma");
const XLSX = __importStar(require("xlsx"));
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const email_service_1 = require("../services/email.service");
const generatePassword_1 = require("../utils/generatePassword");
const auditLogger_1 = require("../utils/auditLogger");
const cloudinary_1 = require("../config/cloudinary");
const subscription_service_1 = require("../services/subscription.service");
const organization_settings_service_1 = require("../services/organization-settings.service");
const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
const getUserOrganizations = async (req, res) => {
    try {
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganizations = await prisma_1.prisma.userOrganization.findMany({
            where: { userId },
            include: {
                organization: {
                    include: {
                        subscriptions: true,
                    },
                },
            },
        });
        res.json({
            organizations: userOrganizations.map((uo) => ({
                id: uo.organization.id,
                name: uo.organization.name,
                businessType: uo.organization.businessType,
                address: uo.organization.address,
                phone: uo.organization.phone,
                email: uo.organization.email,
                role: uo.role,
                isActive: uo.organization.isActive,
                subscription: uo.organization.subscriptions,
            })),
        });
    }
    catch (error) {
        console.error("Error fetching user organizations:", error);
        res.status(500).json({ error: "Failed to fetch organizations" });
    }
};
exports.getUserOrganizations = getUserOrganizations;
const getOrganizationById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId: id,
            },
        });
        if (!userOrganization) {
            return res
                .status(403)
                .json({ error: "Access denied to this organization" });
        }
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id },
            include: {
                subscriptions: {
                    orderBy: {
                        createdAt: 'desc'
                    }
                },
            },
        });
        if (!organization) {
            return res.status(404).json({ error: "Organization not found" });
        }
        const organizationUsers = await prisma_1.prisma.userOrganization.findMany({
            where: { organizationId: id },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
        });
        // Check subscription status — the most recently-ending subscription that's
        // still ACTIVE/TRIALING/GRACE_PERIOD (grace-period rows have an endDate in
        // the past by definition, so this intentionally doesn't filter on endDate).
        const relevantSubscription = organization.subscriptions
            .filter(sub => sub.status === 'ACTIVE' || sub.status === 'TRIALING' || sub.status === 'GRACE_PERIOD')
            .sort((a, b) => (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0))[0] ?? null;
        const subscriptionSummary = subscriptionService.computeSubscriptionSummary(relevantSubscription);
        res.json({
            organization: {
                ...organization,
                hasActiveSubscription: subscriptionSummary.hasActiveSubscription,
                subscriptionStatus: subscriptionSummary.subscriptionStatus,
                subscriptionEndDate: subscriptionSummary.subscriptionEndDate,
                daysUntilExpiry: subscriptionSummary.daysUntilExpiry,
                graceDaysRemaining: subscriptionSummary.graceDaysRemaining,
                graceDayLabel: subscriptionSummary.graceDayLabel,
                subscriptionWarningLevel: subscriptionSummary.warningLevel,
                subscriptionWarningMessage: subscriptionSummary.warningMessage,
                role: userOrganization.role,
                isOwner: userOrganization.isOwner,
            },
            users: organizationUsers
        });
    }
    catch (error) {
        console.error("Error fetching organization:", error);
        res.status(500).json({ error: "Failed to fetch organization" });
    }
};
exports.getOrganizationById = getOrganizationById;
const createOrganization = async (req, res) => {
    try {
        const { name, businessType, address, phone, email } = req.body;
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        if (!name || !businessType || !address || !email) {
            return res.status(400).json({ error: "All fields are required" });
        }
        // Resolve the free-trial plan before creating anything, so a missing
        // plan can't leave behind an organization with no subscription.
        const freeTrialPlan = await prisma_1.prisma.subscriptionPlan.findFirst({
            where: { name: "Free Trial" }
        });
        if (!freeTrialPlan) {
            return res.status(400).json({ error: 'Free Trial plan not found. Please contact support.' });
        }
        const organization = await prisma_1.prisma.organization.create({
            data: {
                name,
                businessType,
                address,
                phone,
                email,
                isActive: true,
            },
        });
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.userOrganization.create({
                data: {
                    userId: userId,
                    organizationId: organization.id,
                    role: "ADMIN",
                    isOwner: true,
                },
            });
            await tx.user.update({
                where: { id: userId },
                data: { role: "ADMIN" },
            });
            // Create default branch
            const branch = await tx.branch.create({
                data: {
                    name: "Main Branch",
                    code: "MAIN-001",
                    organizationId: organization.id,
                    status: 'ACTIVE',
                },
            });
            // Assign user to branch as primary
            await tx.userBranch.create({
                data: {
                    userId: userId,
                    branchId: branch.id,
                    isPrimary: true,
                },
            });
        });
        try {
            await subscriptionService.createTrial(organization.id, freeTrialPlan.id);
        }
        catch (subscriptionError) {
            await prisma_1.prisma.organization.delete({ where: { id: organization.id } });
            return res.status(500).json({ error: 'Failed to create free trial subscription' });
        }
        // Fetch updated user data to include in response
        const updatedUser = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
            }
        });
        res.status(201).json({
            message: "Organization created successfully",
            organization: {
                id: organization.id,
                name: organization.name,
                businessType: organization.businessType,
                address: organization.address,
                phone: organization.phone,
                email: organization.email,
                role: "ADMIN",
                isOwner: true,
            },
            user: updatedUser, // Include updated user data
        });
    }
    catch (error) {
        console.error("Error creating organization:", error);
        res.status(500).json({ error: "Failed to create organization" });
    }
};
exports.createOrganization = createOrganization;
const updateOrganization = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, businessType, address, phone, email, TIN, VRN, vatRegistered, isTaxExempt, taxExemptionReason, currency, ebmDeviceId, ebmSerialNo, trainingMode, } = req.body;
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId: id,
                role: "ADMIN",
            },
        });
        if (!userOrganization) {
            return res
                .status(403)
                .json({ error: "Only admins can update organization details" });
        }
        if (ebmDeviceId !== undefined && ebmDeviceId !== null && typeof ebmDeviceId !== "string") {
            return res.status(400).json({ error: "ebmDeviceId must be a string" });
        }
        if (ebmSerialNo !== undefined && ebmSerialNo !== null && typeof ebmSerialNo !== "string") {
            return res.status(400).json({ error: "ebmSerialNo must be a string" });
        }
        const organization = await prisma_1.prisma.organization.update({
            where: { id },
            data: {
                name,
                businessType,
                address,
                phone,
                email,
                TIN,
                currency,
                ...(VRN !== undefined
                    ? { VRN: VRN === "" ? null : VRN }
                    : {}),
                ...(vatRegistered !== undefined
                    ? { vatRegistered: !!vatRegistered }
                    : {}),
                ...(isTaxExempt !== undefined
                    ? { isTaxExempt: !!isTaxExempt }
                    : {}),
                ...(taxExemptionReason !== undefined
                    ? { taxExemptionReason: taxExemptionReason === "" ? null : taxExemptionReason }
                    : {}),
                ...(ebmDeviceId !== undefined
                    ? { ebmDeviceId: ebmDeviceId === "" ? null : ebmDeviceId }
                    : {}),
                ...(ebmSerialNo !== undefined
                    ? { ebmSerialNo: ebmSerialNo === "" ? null : ebmSerialNo }
                    : {}),
                // CIS/VSDC spec §16: while on, every new sale/refund is recorded as a
                // TRAINING receipt (TS/TR) instead of a real NS/NR — excluded from
                // fiscal submission and the daily report's legal totals. Admin-only,
                // same as the other fiscal-behavior fields above.
                ...(trainingMode !== undefined
                    ? { trainingMode: !!trainingMode }
                    : {}),
            },
        });
        await auditLogger_1.auditLogger.system(req, {
            type: 'SETTINGS_UPDATE',
            description: `Organization "${organization.name}" details updated`,
            entityType: 'Organization',
            entityId: organization.id,
            metadata: { updates: req.body }
        });
        res.json({
            message: "Organization updated successfully",
            organization,
        });
    }
    catch (error) {
        console.error("Error updating organization:", error);
        res.status(500).json({ error: "Failed to update organization" });
    }
};
exports.updateOrganization = updateOrganization;
/** Any org member may read settings — the client needs them to render the sidebar/flags. */
const getOrgSettings = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.id);
        const settings = await (0, organization_settings_service_1.getOrganizationSettings)(organizationId);
        res.json({ settings });
    }
    catch (error) {
        console.error("Error fetching organization settings:", error);
        res.status(500).json({ error: "Failed to fetch organization settings" });
    }
};
exports.getOrgSettings = getOrgSettings;
function isPlainPatchObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Only admins may change workspace-shaping settings; SYSTEM_OWNER bypasses this check
 *  (their global role, not a per-org membership, grants access). */
const updateOrgSettings = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.id);
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        //@ts-ignore
        const isSystemOwner = req.user?.role === "SYSTEM_OWNER";
        if (!isSystemOwner) {
            const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
                where: { userId, organizationId, role: "ADMIN" },
            });
            if (!userOrganization) {
                return res
                    .status(403)
                    .json({ error: "Only admins can update organization settings" });
            }
        }
        const { sidebarConfig, featureFlags, preferences, ebmConfig } = req.body ?? {};
        const patch = {};
        for (const [key, value] of Object.entries({ sidebarConfig, featureFlags, preferences, ebmConfig })) {
            if (value === undefined)
                continue;
            if (!isPlainPatchObject(value) && key !== "ebmConfig") {
                return res.status(400).json({ error: `${key} must be an object` });
            }
            if (key === "ebmConfig") {
                patch.ebmConfig = value;
            }
            else {
                patch[key] = value;
            }
        }
        const settings = await (0, organization_settings_service_1.upsertOrganizationSettings)(organizationId, patch);
        await auditLogger_1.auditLogger.system(req, {
            type: "SETTINGS_UPDATE",
            description: `Organization settings updated`,
            entityType: "OrganizationSetting",
            entityId: organizationId,
            metadata: { patch },
        });
        res.json({ message: "Organization settings updated successfully", settings });
    }
    catch (error) {
        console.error("Error updating organization settings:", error);
        res.status(500).json({ error: "Failed to update organization settings" });
    }
};
exports.updateOrgSettings = updateOrgSettings;
const deleteOrganization = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId: id,
                role: "ADMIN",
            },
        });
        if (!userOrganization) {
            return res
                .status(403)
                .json({ error: "Only admins can delete organization" });
        }
        await prisma_1.prisma.organization.update({
            where: { id },
            data: { isActive: false },
        });
        res.json({ message: "Organization deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting organization:", error);
        res.status(500).json({ error: "Failed to delete organization" });
    }
};
exports.deleteOrganization = deleteOrganization;
const inviteUser = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { email, role, branchId } = req.body;
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const requiredFields = { email, role };
        for (const [key, value] of Object.entries(requiredFields)) {
            if (!value) {
                return res.status(400).json({ error: `${key} is required` });
            }
        }
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId,
                role: { in: ["ADMIN"] },
            },
        });
        if (!userOrganization) {
            return res.status(403).json({ error: "Only admins can invite users" });
        }
        // If branchId is provided, validate it belongs to the organization
        let validatedBranchId;
        if (branchId !== undefined && branchId !== null && branchId !== '') {
            const parsedBranchId = parseInt(String(branchId), 10);
            if (isNaN(parsedBranchId)) {
                return res.status(400).json({ error: "Invalid branch ID" });
            }
            const branch = await prisma_1.prisma.branch.findFirst({
                where: { id: parsedBranchId, organizationId },
            });
            if (!branch) {
                return res.status(400).json({ error: "Branch not found in this organization" });
            }
            validatedBranchId = parsedBranchId;
        }
        const existingUser = await prisma_1.prisma.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            const existingUserOrganization = await prisma_1.prisma.userOrganization.findFirst({
                where: {
                    userId: existingUser.id,
                    organizationId,
                },
            });
            if (existingUserOrganization) {
                return res
                    .status(400)
                    .json({ error: "User already exists in this organization" });
            }
            // For existing users, still create an invitation and send email
            // They need to accept it to join the organization
            const token = crypto_1.default.randomBytes(32).toString("hex");
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);
            // Fetch organization details
            const organization = await prisma_1.prisma.organization.findUnique({
                where: { id: organizationId },
                select: { name: true, email: true },
            });
            if (!organization) {
                return res.status(404).json({ error: "Organization not found" });
            }
            const invitation = await prisma_1.prisma.organizationInvitation.create({
                data: {
                    organizationId: organizationId,
                    email,
                    role,
                    token,
                    invitedBy: userId,
                    expiresAt,
                    invitedUserId: existingUser.id, // Link to existing user
                    defaultPassword: "",
                    ...(validatedBranchId !== undefined ? { branchId: validatedBranchId } : {}),
                },
            });
            await email_service_1.emailService.sendInvitationEmail(email, organization.name, role, token, null // No password needed for existing users
            );
            await auditLogger_1.auditLogger.users(req, {
                type: 'USER_INVITE',
                description: `Invitation sent to existing user: ${email}`,
                entityType: 'User',
                entityId: existingUser.id,
                metadata: {
                    email,
                    role,
                }
            });
            return res.json({
                message: "Invitation sent to existing user successfully. They need to accept it to join the organization.",
                invitation: {
                    id: invitation.id,
                    email: invitation.email,
                    role: invitation.role,
                    expiresAt: invitation.expiresAt,
                },
            });
        }
        const token = crypto_1.default.randomBytes(32).toString("hex");
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        const plainPassword = (0, generatePassword_1.generateStrongPassword)(12);
        const defaultPassword = await bcryptjs_1.default.hash(plainPassword, 10);
        const invitation = await prisma_1.prisma.organizationInvitation.create({
            data: {
                organizationId: organizationId,
                email,
                role,
                token,
                defaultPassword,
                invitedBy: userId,
                expiresAt,
                ...(validatedBranchId !== undefined ? { branchId: validatedBranchId } : {}),
            },
            include: {
                organization: true,
            },
        });
        await email_service_1.emailService.sendInvitationEmail(email, invitation.organization.name, role, token, plainPassword);
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_INVITE',
            description: `New user invitation sent: ${email}`,
            entityType: 'User',
            entityId: invitation.id,
            metadata: {
                email,
                role,
            }
        });
        res.status(201).json({
            message: "Invitation sent successfully",
            invitation: {
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                status: invitation.status,
            },
        });
    }
    catch (error) {
        console.error("Error inviting user:", error);
        res.status(500).json({ error: "Failed to send invitation" });
    }
};
exports.inviteUser = inviteUser;
const bulkInviteUsers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId,
                role: "ADMIN",
            },
        });
        if (!userOrganization) {
            return res.status(403).json({ error: "Only admins can invite users" });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Excel file is required" });
        }
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        const invitations = [];
        const errors = [];
        for (const row of data) {
            try {
                const email = row.email || row.Email;
                const role = row.role || row.Role;
                if (!email || !role) {
                    errors.push({ row, error: "Missing email or role" });
                    continue;
                }
                if (!["ADMIN", "MANAGER", "ACCOUNTANT", "STAFF"].includes(role.toUpperCase())) {
                    errors.push({ row, error: "Invalid role" });
                    continue;
                }
                const existingUser = await prisma_1.prisma.user.findUnique({
                    where: { email },
                });
                if (existingUser) {
                    const existingUserOrganization = await prisma_1.prisma.userOrganization.findFirst({
                        where: {
                            userId: existingUser.id,
                            organizationId,
                        },
                    });
                    if (existingUserOrganization) {
                        errors.push({
                            row,
                            error: "User already exists in this organization",
                        });
                        continue;
                    }
                }
                const token = crypto_1.default.randomBytes(32).toString("hex");
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 7);
                const plainPassword = crypto_1.default.randomBytes(8).toString("hex");
                const defaultPassword = await bcryptjs_1.default.hash(plainPassword, 10);
                const invitation = await prisma_1.prisma.organizationInvitation.create({
                    data: {
                        organizationId: organizationId,
                        email,
                        role: role.toUpperCase(),
                        token,
                        expiresAt,
                        defaultPassword: defaultPassword,
                        invitedBy: userId,
                    },
                    include: {
                        organization: true,
                    },
                });
                await email_service_1.emailService.sendInvitationEmail(email, invitation.organization.name, token, role.toUpperCase(), plainPassword);
                invitations.push({
                    email,
                    role: role.toUpperCase(),
                    status: "sent",
                });
            }
            catch (error) {
                errors.push({ row, error: "Failed to process invitation" });
            }
        }
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_INVITE',
            description: `Bulk invitations sent for organization ${organizationId}`,
            entityType: 'Organization',
            entityId: organizationId,
            metadata: {
                successful: invitations.length,
                failed: errors.length,
            }
        });
        res.status(201).json({
            message: "Bulk invitation completed",
            successful: invitations.length,
            failed: errors.length,
            invitations,
            errors,
        });
    }
    catch (error) {
        console.error("Error bulk inviting users:", error);
        res.status(500).json({ error: "Failed to process bulk invitations" });
    }
};
exports.bulkInviteUsers = bulkInviteUsers;
const cancelInvitation = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const invitation = await prisma_1.prisma.organizationInvitation.findUnique({
            where: { id },
        });
        if (!invitation) {
            return res.status(404).json({ error: "Invitation not found" });
        }
        await prisma_1.prisma.organizationInvitation.update({
            where: { id: invitation.id },
            data: { status: "CANCELLED" },
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_INVITE',
            description: `Invitation ${id} cancelled`,
            entityType: 'User',
            entityId: id,
            status: 'FAILED',
        });
        res.json({ message: "Invitation cancelled successfully" });
    }
    catch (error) {
        console.error("Error cancelling invitation:", error);
        res.status(500).json({ error: "Failed to cancel invitation" });
    }
};
exports.cancelInvitation = cancelInvitation;
const getInvitationDetails = async (req, res) => {
    try {
        const { token } = req.params;
        const invitation = await prisma_1.prisma.organizationInvitation.findUnique({
            where: { token },
            include: {
                organization: {
                    select: {
                        name: true,
                        email: true,
                        businessType: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                    },
                },
            },
        });
        if (!invitation) {
            return res.status(404).json({ error: "Invitation not found" });
        }
        res.json(invitation);
    }
    catch (error) {
        console.error("Error getting invitation details:", error);
        res.status(500).json({ error: "Failed to get invitation details" });
    }
};
exports.getInvitationDetails = getInvitationDetails;
const declineInvitation = async (req, res) => {
    try {
        const { token } = req.params;
        const invitation = await prisma_1.prisma.organizationInvitation.findUnique({
            where: { token },
            include: {
                organization: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
            },
        });
        if (!invitation) {
            return res.status(404).json({ error: "Invitation not found" });
        }
        if (invitation?.status !== "PENDING") {
            return res.status(400).json({ error: "Invitation already processed" });
        }
        await prisma_1.prisma.organizationInvitation.update({
            where: { id: invitation.id },
            data: { status: "DECLINED" },
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_INVITE',
            description: `Invitation ${invitation.id} declined by ${invitation.email}`,
            entityType: 'User',
            entityId: invitation.id,
            status: 'FAILED',
        });
        email_service_1.emailService.sendInvitationAcceptedOrDeclinedEmail(invitation.organization.email, invitation.organization.name, "DECLINED", invitation.email);
        res.json({ message: "Invitation declined successfully" });
    }
    catch (error) {
        console.error("Error declining invitation:", error);
        res.status(500).json({ error: "Failed to decline invitation" });
    }
};
exports.declineInvitation = declineInvitation;
const acceptInvitation = async (req, res) => {
    try {
        const { name } = req.body;
        const { token } = req.params;
        if (!token || !name) {
            return res.status(400).json({ error: "Token and name are required" });
        }
        const invitation = await prisma_1.prisma.organizationInvitation.findUnique({
            where: { token },
            include: {
                organization: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
            },
        });
        if (!invitation) {
            return res.status(404).json({ error: "Invitation not found" });
        }
        if (invitation.status !== "PENDING") {
            return res.status(400).json({ error: "Invitation already processed" });
        }
        if (invitation.expiresAt < new Date()) {
            await prisma_1.prisma.organizationInvitation.update({
                where: { id: invitation.id },
                data: { status: "EXPIRED" },
            });
            return res.status(400).json({ error: "Invitation has expired" });
        }
        let user = await prisma_1.prisma.user.findUnique({
            where: { email: invitation.email },
        });
        if (!user) {
            user = await prisma_1.prisma.user.create({
                data: {
                    email: invitation.email,
                    name,
                    role: invitation.role,
                    password: invitation.defaultPassword,
                    requirePasswordChange: true,
                    defaultPassword: invitation.defaultPassword,
                    isEmailVerified: true,
                    isActive: true,
                },
            });
        }
        // Check if user is already in the organization (for existing users)
        const existingUserOrg = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId: user.id,
                organizationId: invitation.organizationId,
            },
        });
        if (!existingUserOrg) {
            await prisma_1.prisma.userOrganization.create({
                data: {
                    userId: user.id,
                    organizationId: invitation.organizationId,
                    role: invitation.role,
                    isOwner: false,
                },
            });
        }
        // If invitation is branch-scoped, assign user to that specific branch
        if (invitation.branchId) {
            const branch = await prisma_1.prisma.branch.findFirst({
                where: { id: invitation.branchId, organizationId: invitation.organizationId },
            });
            if (branch) {
                const existingUserBranch = await prisma_1.prisma.userBranch.findFirst({
                    where: { userId: user.id, branchId: branch.id },
                });
                if (!existingUserBranch) {
                    await prisma_1.prisma.userBranch.create({
                        data: {
                            userId: user.id,
                            branchId: branch.id,
                            isPrimary: true,
                        },
                    });
                }
            }
        }
        // If no branchId, user has org-wide access (not restricted to any specific branch)
        await prisma_1.prisma.organizationInvitation.update({
            where: { id: invitation.id },
            data: {
                status: "ACCEPTED",
                invitedUserId: user.id,
            },
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_ACCEPT_INVITE',
            description: `Invitation accepted by ${user.email}`,
            entityType: 'User',
            entityId: user.id,
            metadata: { invitationId: invitation.id }
        });
        email_service_1.emailService.sendInvitationAcceptedOrDeclinedEmail(invitation.organization.email, invitation.organization.name, "ACCEPTED", invitation.email);
        res.json({
            message: "Invitation accepted successfully",
            organization: invitation.organization,
            requirePasswordChange: true,
        });
    }
    catch (error) {
        console.error("Error accepting invitation:", error);
        res.status(500).json({ error: "Failed to accept invitation" });
    }
};
exports.acceptInvitation = acceptInvitation;
const getOrganizationUsers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId,
            },
        });
        if (!userOrganization) {
            return res
                .status(403)
                .json({ error: "Access denied to this organization" });
        }
        const users = await prisma_1.prisma.userOrganization.findMany({
            where: { organizationId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
        });
        res.json({
            users: users.map((uo) => ({
                id: uo.user.id,
                email: uo.user.email,
                name: uo.user.name,
                role: uo.role,
            })),
        });
    }
    catch (error) {
        console.error("Error fetching organization users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
};
exports.getOrganizationUsers = getOrganizationUsers;
const removeUserFromOrganization = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const targetUserId = parseInt(req.params.userId);
        //@ts-ignore
        const userId = parseInt(req.user?.userId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId,
                role: "ADMIN",
            },
        });
        if (!userOrganization) {
            return res.status(403).json({ error: "Only admins can remove users" });
        }
        if (userId === targetUserId) {
            return res
                .status(400)
                .json({ error: "Cannot remove yourself from organization" });
        }
        await prisma_1.prisma.userOrganization.deleteMany({
            where: {
                userId: targetUserId,
                organizationId,
            },
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_ROLE_UPDATE',
            description: `User "${targetUserId}" removed from organization`,
            entityType: 'User',
            entityId: targetUserId,
            status: 'SUCCESS',
        });
        res.json({ message: "User removed successfully" });
    }
    catch (error) {
        console.error("Error removing user:", error);
        res.status(500).json({ error: "Failed to remove user" });
    }
};
exports.removeUserFromOrganization = removeUserFromOrganization;
const updateOrganizationAvatar = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const existingOrg = await prisma_1.prisma.organization.findUnique({ where: { id } });
        if (!existingOrg) {
            return res.status(404).json({ message: 'Organization not found' });
        }
        let avatar = existingOrg.avatar;
        if (req.file) {
            if (avatar) {
                await (0, cloudinary_1.deleteFromCloudinary)(avatar);
            }
            const result = await (0, cloudinary_1.uploadToCloudinary)(req.file);
            avatar = result.secure_url;
        }
        const updatedOrg = await prisma_1.prisma.organization.update({
            where: { id },
            data: {
                ...(avatar && { avatar }),
            },
        });
        res.json(updatedOrg);
    }
    catch (error) {
        console.error('Error updating organization:', error);
        res.status(500).json({ message: 'Error updating organization' });
    }
};
exports.updateOrganizationAvatar = updateOrganizationAvatar;

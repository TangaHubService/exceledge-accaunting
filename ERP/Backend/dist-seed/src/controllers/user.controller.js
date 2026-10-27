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
exports.updateUserProfileImage = exports.reactivateUser = exports.deleteUser = exports.updateUser = exports.createUser = exports.getUserById = exports.getUsers = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auditLogger_1 = require("../utils/auditLogger");
const cloudinary_1 = require("../config/cloudinary");
const prisma_1 = require("../lib/prisma");
const sorting_1 = require("../utils/sorting");
const getUsers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const search = req.query.search;
        const status = req.query.status;
        const { page = "1", limit = "50" } = req.query;
        const limitNum = Math.min(Math.max(Number.parseInt(limit) || 50, 1), 500);
        const pageNum = Math.max(Number.parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * limitNum;
        const whereClause = {
            organizationId,
            user: { deletedAt: null }
        };
        // Filter by status: active, disabled, or all
        if (status === 'active') {
            whereClause.user.isActive = true;
        }
        else if (status === 'disabled') {
            whereClause.user.isActive = false;
        }
        // 'all' or undefined shows both active and disabled
        if (search) {
            whereClause.OR = [
                { user: { name: { contains: search, mode: "insensitive" } } },
                { user: { email: { contains: search, mode: "insensitive" } } },
            ];
        }
        const [userOrganizations, totalCount] = await Promise.all([
            prisma_1.prisma.userOrganization.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            isActive: true,
                            createdAt: true,
                            disabledAt: true,
                            reactivatedAt: true,
                        },
                    },
                },
                orderBy: (0, sorting_1.getOrderBy)(req.query, {
                    name: { user: { name: '$direction' } },
                    email: { user: { email: '$direction' } },
                    status: { user: { isActive: '$direction' } },
                    role: { role: '$direction' },
                    createdAt: { user: { createdAt: '$direction' } },
                }, 'createdAt', 'desc'),
                skip,
                take: limitNum,
            }),
            prisma_1.prisma.userOrganization.count({ where: whereClause }),
        ]);
        const users = userOrganizations.map((uo) => ({
            ...uo.user,
            role: uo.role,
            isOwner: uo.isOwner,
        }));
        res.json({
            users,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
            },
        });
    }
    catch (error) {
        console.error("[Get Users Error]:", error);
        res.status(500).json({ error: "Failed to get users" });
    }
};
exports.getUsers = getUsers;
const getUserById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: {
                userId: id,
                organizationId,
                user: { deletedAt: null }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        isActive: true,
                        createdAt: true,
                    },
                },
            },
        });
        if (!userOrganization) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json({
            ...userOrganization.user,
            role: userOrganization.role,
            isOwner: userOrganization.isOwner,
        });
    }
    catch (error) {
        console.error("[Get User Error]:", error);
        res.status(500).json({ error: "Failed to get user" });
    }
};
exports.getUserById = getUserById;
const createUser = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { email, password, name, role } = req.body;
        const existingUser = await prisma_1.prisma.user.findUnique({
            where: { email, deletedAt: null },
        });
        if (existingUser) {
            return res.status(400).json({ error: "User already exists" });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma_1.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
            },
            select: {
                id: true,
                email: true,
                name: true,
                isActive: true,
                createdAt: true,
            },
        });
        await prisma_1.prisma.userOrganization.create({
            data: {
                userId: user.id,
                organizationId: organizationId,
                role,
                isOwner: false, // Default value for isOwner
            },
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_CREATED',
            description: `New user "${user.name}" created and added to organization`,
            entityType: 'User',
            entityId: user.id,
            metadata: {
                email: user.email,
                role,
            }
        });
        const { syncUserToRraAsync } = await Promise.resolve().then(() => __importStar(require('../services/rra-branch-sync.service')));
        syncUserToRraAsync(organizationId, user.id, {
            actorUserId: req.user?.userId ? Number(req.user.userId) : undefined,
        });
        res.status(201).json({ id: user.id, email: user.email, name: user.name });
    }
    catch (error) {
        console.error("[Create User Error]:", error);
        res.status(500).json({ error: "Failed to create user" });
    }
};
exports.createUser = createUser;
// Roles assignable to an organization member through the update-user endpoint.
// SYSTEM_OWNER is a platform-level role, not something granted within an
// organization, so it is intentionally excluded here.
const ASSIGNABLE_ROLES = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "SELLER"];
// Roles that only a SYSTEM_OWNER may ever modify (role or account status).
const PROTECTED_TARGET_ROLES = ["ADMIN", "SYSTEM_OWNER"];
const updateUser = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const requesterId = parseInt(String(req.user.userId));
        // `organizations` is a client-side convenience field on some payloads; never persisted.
        const { organizations, ...updateData } = req.body;
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: { userId: id, organizationId: organizationId, user: { deletedAt: null } },
        });
        if (!userOrganization) {
            return res.status(404).json({ error: "User not found" });
        }
        const isSystemOwner = req.user.role === "SYSTEM_OWNER";
        // Authoritative actor role for this organization — never trust a stale JWT role
        // for cross-checking permissions inside a specific org.
        const actorMembership = isSystemOwner
            ? null
            : await prisma_1.prisma.userOrganization.findFirst({
                where: { userId: requesterId, organizationId: organizationId },
                select: { role: true },
            });
        const actorRole = isSystemOwner ? "SYSTEM_OWNER" : actorMembership?.role;
        const isAdmin = isSystemOwner || actorRole === "ADMIN";
        const isSelf = requesterId === id;
        // Server-side authorization — never trust the frontend's hidden/disabled form fields.
        // Non-admins may only ever touch their own record, and only non-sensitive fields.
        if (!isSelf && !isAdmin) {
            return res.status(403).json({ error: "Forbidden: you don't have permission to update this user" });
        }
        const changingRole = Object.prototype.hasOwnProperty.call(updateData, "role");
        const changingStatus = Object.prototype.hasOwnProperty.call(updateData, "isActive");
        if (changingRole || changingStatus) {
            // Only admins/system owner may change roles or account status — ever.
            if (!isAdmin) {
                return res.status(403).json({ error: "Forbidden: only administrators can change roles or account status" });
            }
            // Prevent privilege escalation: an org Admin (not SYSTEM_OWNER) may never
            // modify another Admin's or a System Owner's role/status.
            if (!isSystemOwner && PROTECTED_TARGET_ROLES.includes(userOrganization.role)) {
                return res.status(403).json({ error: "Forbidden: only a System Owner can modify an Admin's role or account status" });
            }
            // Disallow self-service role/status changes to prevent self-escalation or self-lockout.
            if (isSelf) {
                return res.status(403).json({ error: "Forbidden: you cannot change your own role or account status" });
            }
            if (changingRole && !ASSIGNABLE_ROLES.includes(updateData.role)) {
                return res.status(400).json({ error: "Invalid role" });
            }
        }
        const { role: newRole, isActive, ...userFields } = updateData;
        if (Object.keys(userFields).length > 0) {
            await prisma_1.prisma.user.update({
                where: { id },
                data: { ...userFields, ...(changingStatus ? { isActive } : {}) },
            });
        }
        else if (changingStatus) {
            await prisma_1.prisma.user.update({ where: { id }, data: { isActive } });
        }
        if (changingRole && newRole !== userOrganization.role) {
            await prisma_1.prisma.userOrganization.update({
                where: { id: userOrganization.id },
                data: { role: newRole },
            });
        }
        if (changingRole || changingStatus) {
            await auditLogger_1.auditLogger.users(req, {
                type: changingRole ? 'USER_ROLE_UPDATE' : (isActive ? 'USER_ACCOUNT_ENABLED' : 'USER_ACCOUNT_DISABLED'),
                description: `User ${id} ${changingRole ? `role changed from "${userOrganization.role}" to "${newRole}"` : `account ${isActive ? 'enabled' : 'disabled'}`} by user ${requesterId}`,
                entityType: 'User',
                entityId: id,
                metadata: {
                    previousRole: userOrganization.role,
                    newRole: changingRole ? newRole : undefined,
                    isActive: changingStatus ? isActive : undefined,
                    actorId: requesterId,
                },
            });
        }
        else if (Object.keys(userFields).length > 0) {
            await auditLogger_1.auditLogger.users(req, {
                type: 'OTHER',
                description: `User "${id}" profile updated`,
                entityType: 'User',
                entityId: id,
                metadata: { updates: userFields },
            });
        }
        res.json({ message: "User updated successfully" });
    }
    catch (error) {
        console.error("[Update User Error]:", error);
        res.status(500).json({ error: "Failed to update user" });
    }
};
exports.updateUser = updateUser;
const deleteUser = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const requesterId = parseInt(String(req.user.userId));
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: { userId: id, organizationId, user: { deletedAt: null } },
        });
        if (!userOrganization) {
            return res.status(404).json({ error: "User not found" });
        }
        if (requesterId === id) {
            return res.status(400).json({ error: "You cannot disable your own account" });
        }
        const isSystemOwner = req.user.role === "SYSTEM_OWNER";
        if (!isSystemOwner && PROTECTED_TARGET_ROLES.includes(userOrganization.role)) {
            return res.status(403).json({ error: "Forbidden: only a System Owner can disable an Admin's account" });
        }
        await prisma_1.prisma.user.update({
            where: { id },
            data: { isActive: false, deletedAt: new Date(), disabledAt: new Date(), reactivatedAt: null }
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_ACCOUNT_DISABLED',
            description: `User account disabled: ${id} by user ${requesterId}`,
            entityType: 'User',
            entityId: id,
            metadata: { actorId: requesterId, disabledAt: new Date().toISOString() },
        });
        res.json({ message: "User deleted successfully" });
    }
    catch (error) {
        console.error("[Delete User Error]:", error);
        res.status(500).json({ error: "Failed to delete user" });
    }
};
exports.deleteUser = deleteUser;
const reactivateUser = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const requesterId = parseInt(String(req.user.userId));
        const userOrganization = await prisma_1.prisma.userOrganization.findFirst({
            where: { userId: id, organizationId },
        });
        if (!userOrganization) {
            return res.status(404).json({ error: "User not found in this organization" });
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        if (user.isActive) {
            return res.status(400).json({ error: "User is already active" });
        }
        await prisma_1.prisma.user.update({
            where: { id },
            data: { isActive: true, deletedAt: null, reactivatedAt: new Date() }
        });
        await auditLogger_1.auditLogger.users(req, {
            type: 'USER_ACCOUNT_ENABLED',
            description: `User account reactivated: ${id} by user ${requesterId}`,
            entityType: 'User',
            entityId: id,
            metadata: { actorId: requesterId, reactivatedAt: new Date().toISOString() },
        });
        res.json({ message: "User reactivated successfully" });
    }
    catch (error) {
        console.error("[Reactivate User Error]:", error);
        res.status(500).json({ error: "Failed to reactivate user" });
    }
};
exports.reactivateUser = reactivateUser;
const updateUserProfileImage = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const existingUser = await prisma_1.prisma.user.findUnique({ where: { id, deletedAt: null } });
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        let profileImage = existingUser.profileImage;
        if (req.file) {
            // Delete old image if exists
            if (profileImage) {
                await (0, cloudinary_1.deleteFromCloudinary)(profileImage);
            }
            // Upload new image
            const result = await (0, cloudinary_1.uploadToCloudinary)(req.file);
            profileImage = result.secure_url;
        }
        const updatedUser = await prisma_1.prisma.user.update({
            where: { id },
            data: {
                ...(profileImage && { profileImage }),
            },
            select: {
                id: true,
                email: true,
                name: true,
                profileImage: true,
                isActive: true,
                createdAt: true,
            },
        });
        res.json(updatedUser);
    }
    catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Error updating user' });
    }
};
exports.updateUserProfileImage = updateUserProfileImage;

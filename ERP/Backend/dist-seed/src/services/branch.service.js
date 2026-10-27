"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBranches = getBranches;
exports.getBranchById = getBranchById;
exports.createBranch = createBranch;
exports.updateBranch = updateBranch;
exports.setDefaultBranch = setDefaultBranch;
exports.deleteBranch = deleteBranch;
exports.assignUserToBranch = assignUserToBranch;
exports.removeUserFromBranch = removeUserFromBranch;
exports.getUserBranches = getUserBranches;
exports.getUserPrimaryBranch = getUserPrimaryBranch;
exports.getBranchUsers = getBranchUsers;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
/**
 * Get all branches for an organization
 */
async function getBranches(organizationId, includeInactive = false) {
    const where = {
        organizationId,
    };
    if (!includeInactive) {
        where.status = client_1.BranchStatus.ACTIVE;
    }
    return await prisma_1.prisma.branch.findMany({
        where,
        include: {
            _count: {
                select: {
                    userBranches: true,
                    sales: true,
                    batches: true,
                },
            },
        },
        orderBy: [
            { createdAt: 'desc' },
        ],
    });
}
/**
 * Get a single branch by ID
 */
async function getBranchById(branchId, organizationId) {
    return await prisma_1.prisma.branch.findFirst({
        where: {
            id: branchId,
            organizationId,
        },
        include: {
            _count: {
                select: {
                    userBranches: true,
                    sales: true,
                    batches: true,
                    stockMovements: true,
                    expenses: true,
                },
            },
        },
    });
}
/**
 * Create a new branch
 */
async function createBranch(params) {
    const { organizationId, name, code, location, address, phone, metadata } = params;
    // Check if code is unique within organization
    const existing = await prisma_1.prisma.branch.findFirst({
        where: {
            organizationId,
            code,
        },
    });
    if (existing) {
        throw new Error(`Branch code ${code} already exists in this organization`);
    }
    // Create branch
    return await prisma_1.prisma.branch.create({
        data: {
            organizationId,
            name,
            code,
            location,
            address,
            phone,
            metadata,
            status: client_1.BranchStatus.ACTIVE,
        },
    });
}
/**
 * Update a branch
 */
async function updateBranch(branchId, organizationId, data) {
    const branch = await prisma_1.prisma.branch.findFirst({
        where: {
            id: branchId,
            organizationId,
        },
    });
    if (!branch) {
        throw new Error(`Branch with ID ${branchId} not found`);
    }
    const patch = { ...data };
    // RRA bhfId is unique per org (@@unique([organizationId, bhfId])).
    // Normalize whitespace; empty → null so multiple unset branches don't collide.
    if (data.bhfId !== undefined) {
        const normalized = data.bhfId == null || String(data.bhfId).trim() === ''
            ? null
            : String(data.bhfId).trim();
        patch.bhfId = normalized;
        if (normalized != null) {
            const clash = await prisma_1.prisma.branch.findFirst({
                where: {
                    organizationId,
                    bhfId: normalized,
                    NOT: { id: branchId },
                },
                select: { id: true, code: true, name: true },
            });
            if (clash) {
                throw Object.assign(new Error(`Branch code (bhfId) "${normalized}" is already used by ${clash.name} (${clash.code}). Each branch needs a unique RRA branch id (e.g. MAIN=00, East=01).`), { statusCode: 409 });
            }
        }
    }
    if (data.ebmSerialNo !== undefined) {
        patch.ebmSerialNo =
            data.ebmSerialNo == null || String(data.ebmSerialNo).trim() === ''
                ? null
                : String(data.ebmSerialNo).trim().toUpperCase();
    }
    if (data.ebmDeviceId !== undefined) {
        patch.ebmDeviceId =
            data.ebmDeviceId == null || String(data.ebmDeviceId).trim() === ''
                ? null
                : String(data.ebmDeviceId).trim();
    }
    if (data.vsdcUrl !== undefined) {
        patch.vsdcUrl =
            data.vsdcUrl == null || String(data.vsdcUrl).trim() === ''
                ? null
                : String(data.vsdcUrl).trim();
    }
    try {
        return await prisma_1.prisma.branch.update({
            where: { id: branchId },
            data: patch,
        });
    }
    catch (err) {
        if (err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('bhfId')) {
            throw Object.assign(new Error(`Branch code (bhfId) "${patch.bhfId ?? ''}" is already used by another branch. Each branch needs a unique RRA branch id (e.g. MAIN=00, East=01).`), { statusCode: 409 });
        }
        throw err;
    }
}
/**
 * Set a branch as the organization's default branch, unsetting any other
 * branch previously marked as default.
 */
async function setDefaultBranch(branchId, organizationId) {
    const branch = await prisma_1.prisma.branch.findFirst({
        where: {
            id: branchId,
            organizationId,
        },
    });
    if (!branch) {
        throw new Error(`Branch with ID ${branchId} not found`);
    }
    await prisma_1.prisma.branch.updateMany({
        where: { organizationId, isDefault: true, NOT: { id: branchId } },
        data: { isDefault: false },
    });
    return await prisma_1.prisma.branch.update({
        where: { id: branchId },
        data: { isDefault: true },
    });
}
/**
 * Delete a branch (soft delete by setting status to INACTIVE)
 */
async function deleteBranch(branchId, organizationId) {
    const branch = await prisma_1.prisma.branch.findFirst({
        where: {
            id: branchId,
            organizationId,
        },
    });
    if (!branch) {
        throw new Error(`Branch with ID ${branchId} not found`);
    }
    // Check if branch has inventory
    const hasInventory = await prisma_1.prisma.batch.findFirst({
        where: {
            branchId: branchId,
            quantity: { gt: 0 },
        },
    });
    if (hasInventory) {
        // Soft delete - just deactivate
        return await prisma_1.prisma.branch.update({
            where: { id: branchId },
            data: {
                status: client_1.BranchStatus.INACTIVE,
            },
        });
    }
    else {
        // Hard delete if no inventory
        return await prisma_1.prisma.branch.delete({
            where: { id: branchId },
        });
    }
}
/**
 * Assign a user to a branch
 */
async function assignUserToBranch(userId, branchId, isPrimary = false) {
    // If setting as primary, unset other primary branches for this user
    if (isPrimary) {
        await prisma_1.prisma.userBranch.updateMany({
            where: {
                userId,
                isPrimary: true,
            },
            data: {
                isPrimary: false,
            },
        });
    }
    // Create or update user-branch assignment
    return await prisma_1.prisma.userBranch.upsert({
        where: {
            userId_branchId: {
                userId,
                branchId,
            },
        },
        create: {
            userId,
            branchId,
            isPrimary,
        },
        update: {
            isPrimary,
        },
    });
}
/**
 * Remove a user from a branch
 */
async function removeUserFromBranch(userId, branchId) {
    return await prisma_1.prisma.userBranch.delete({
        where: {
            userId_branchId: {
                userId,
                branchId,
            },
        },
    });
}
/**
 * Get all branches for a user
 */
async function getUserBranches(userId, organizationId, includeInactive = false) {
    const where = {
        userId,
    };
    const branchWhere = {};
    if (organizationId)
        branchWhere.organizationId = organizationId;
    if (!includeInactive)
        branchWhere.status = client_1.BranchStatus.ACTIVE;
    if (Object.keys(branchWhere).length > 0) {
        where.branch = branchWhere;
    }
    const userBranches = await prisma_1.prisma.userBranch.findMany({
        where,
        include: {
            branch: {
                include: {
                    _count: {
                        select: {
                            sales: true,
                            batches: true,
                        },
                    },
                },
            },
        },
        orderBy: [
            { isPrimary: 'desc' },
            { branch: { name: 'asc' } },
        ],
    });
    return userBranches.map((ub) => ({
        ...ub.branch,
        isPrimary: ub.isPrimary,
    }));
}
/**
 * Get primary branch for a user
 */
async function getUserPrimaryBranch(userId) {
    const userBranch = await prisma_1.prisma.userBranch.findFirst({
        where: {
            userId,
            isPrimary: true,
        },
        include: {
            branch: true,
        },
    });
    return userBranch?.branch || null;
}
/**
 * Get all users assigned to a branch
 */
async function getBranchUsers(branchId) {
    const userBranches = await prisma_1.prisma.userBranch.findMany({
        where: {
            branchId,
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                },
            },
        },
    });
    return userBranches.map((ub) => ({
        ...ub.user,
        isPrimary: ub.isPrimary,
    }));
}

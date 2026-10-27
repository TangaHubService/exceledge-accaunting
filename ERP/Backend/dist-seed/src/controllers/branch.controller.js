"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBranchUsersController = exports.removeUserFromBranchController = exports.assignUserToBranchController = exports.deleteBranchController = exports.setDefaultBranchController = exports.updateBranchController = exports.createBranchController = exports.getUserPrimaryBranchController = exports.getUserBranchesController = exports.getBranch = exports.getBranchesController = void 0;
const config_1 = require("../config");
const branch_service_1 = require("../services/branch.service");
const auditLogger_1 = require("../utils/auditLogger");
/**
 * Get all branches for an organization
 */
const getBranchesController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { includeInactive } = req.query;
        const branches = await (0, branch_service_1.getBranches)(organizationId, includeInactive === 'true');
        res.json(branches);
    }
    catch (error) {
        console.error('[Get Branches Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get branches' });
    }
};
exports.getBranchesController = getBranchesController;
/**
 * Get a single branch by ID
 */
const getBranch = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = parseInt(req.params.id);
        const branch = await (0, branch_service_1.getBranchById)(branchId, organizationId);
        if (!branch) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        res.json(branch);
    }
    catch (error) {
        console.error('[Get Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get branch' });
    }
};
exports.getBranch = getBranch;
/**
 * Get branches for current user
 */
const getUserBranchesController = async (req, res) => {
    try {
        const userId = parseInt(req.user?.userId);
        const organizationId = req.query.organizationId ? parseInt(req.query.organizationId) : undefined;
        const includeInactive = req.query.includeInactive === 'true';
        const branches = await (0, branch_service_1.getUserBranches)(userId, organizationId, includeInactive);
        res.json(branches);
    }
    catch (error) {
        console.error('[Get User Branches Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get user branches' });
    }
};
exports.getUserBranchesController = getUserBranchesController;
/**
 * Get primary branch for current user
 */
const getUserPrimaryBranchController = async (req, res) => {
    try {
        const userId = parseInt(req.user?.userId);
        const branch = await (0, branch_service_1.getUserPrimaryBranch)(userId);
        if (!branch) {
            return res.status(404).json({ error: 'No primary branch found' });
        }
        res.json(branch);
    }
    catch (error) {
        console.error('[Get User Primary Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get primary branch' });
    }
};
exports.getUserPrimaryBranchController = getUserPrimaryBranchController;
/**
 * Create a new branch
 */
const createBranchController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user?.userId);
        const { name, code, location, address, phone, metadata } = req.body;
        if (!name || !code) {
            return res.status(400).json({ error: 'Branch name and code are required' });
        }
        const branch = await (0, branch_service_1.createBranch)({
            organizationId,
            name,
            code,
            location,
            address,
            phone,
            metadata,
        });
        // Auto-assign the creator to the new branch so they can see it immediately
        await (0, branch_service_1.assignUserToBranch)(userId, branch.id, false);
        await auditLogger_1.auditLogger.system(req, {
            type: 'BRANCH_CREATE',
            description: `Branch "${name}" created`,
            entityType: 'Branch',
            entityId: branch.id.toString(),
            metadata: {
                name,
                code,
            },
        });
        res.status(201).json(branch);
    }
    catch (error) {
        console.error('[Create Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to create branch' });
    }
};
exports.createBranchController = createBranchController;
/**
 * Update a branch
 */
const updateBranchController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = parseInt(req.params.id);
        const { name, location, address, addressLine2, phone, status, metadata, bhfId, ebmDeviceId, ebmSerialNo, vsdcUrl } = req.body;
        // C10: MRC number format validation (RRA spec §2.1: BBBCCNNNNNN, 11 chars).
        // Relaxed in sandbox/mock: RRA test-issued device serials
        // can be configured via Organization Settings (EBM credentials section).
        if (ebmSerialNo !== undefined && ebmSerialNo !== null && ebmSerialNo !== '') {
            const isSandboxOrMock = config_1.config.ebm.environment === 'sandbox' || config_1.config.ebm.useMock;
            const MRC_PATTERN = /^[A-Z0-9]{3}[A-Z0-9]{2}[0-9]{6}$/;
            if (!isSandboxOrMock && !MRC_PATTERN.test(String(ebmSerialNo).toUpperCase())) {
                return res.status(400).json({
                    error: 'Invalid MRC number format. Must be BBBCCNNNNNN (3 developer + 2 certificate + 6 serial digits).',
                });
            }
        }
        const branch = await (0, branch_service_1.updateBranch)(branchId, organizationId, {
            name,
            location,
            address,
            addressLine2,
            phone,
            status,
            metadata,
            bhfId: bhfId === undefined ? undefined : bhfId,
            ebmDeviceId: ebmDeviceId === undefined ? undefined : ebmDeviceId,
            ebmSerialNo: ebmSerialNo === undefined ? undefined : ebmSerialNo,
            vsdcUrl: vsdcUrl === undefined ? undefined : vsdcUrl,
        });
        await auditLogger_1.auditLogger.system(req, {
            type: 'BRANCH_UPDATE',
            description: `Branch "${branch.name}" updated`,
            entityType: 'Branch',
            entityId: branch.id.toString(),
            metadata: {
                name: branch.name,
            },
        });
        res.json(branch);
    }
    catch (error) {
        const status = error?.statusCode === 409 || error?.code === 'P2002' ? 409 : 500;
        const message = error?.statusCode === 409
            ? error.message
            : error?.code === 'P2002'
                ? 'Branch code (bhfId) is already used by another branch in this organization. Each branch needs a unique RRA branch id (e.g. MAIN=00, East=01).'
                : error.message || 'Failed to update branch';
        if (status >= 500) {
            console.error('[Update Branch Error]:', error);
        }
        res.status(status).json({ error: message, message });
    }
};
exports.updateBranchController = updateBranchController;
/**
 * Set a branch as the organization's default branch
 */
const setDefaultBranchController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = parseInt(req.params.id);
        const branch = await (0, branch_service_1.setDefaultBranch)(branchId, organizationId);
        await auditLogger_1.auditLogger.system(req, {
            type: 'BRANCH_UPDATE',
            description: `Branch "${branch.name}" set as default`,
            entityType: 'Branch',
            entityId: branch.id.toString(),
            metadata: { name: branch.name },
        });
        res.json(branch);
    }
    catch (error) {
        console.error('[Set Default Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to set default branch' });
    }
};
exports.setDefaultBranchController = setDefaultBranchController;
/**
 * Delete a branch
 */
const deleteBranchController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = parseInt(req.params.id);
        const branch = await (0, branch_service_1.deleteBranch)(branchId, organizationId);
        await auditLogger_1.auditLogger.system(req, {
            type: 'BRANCH_UPDATE',
            description: `Branch "${branch.name}" archived`,
            entityType: 'Branch',
            entityId: branchId.toString(),
        });
        res.json({ message: 'Branch deleted successfully', branch });
    }
    catch (error) {
        console.error('[Delete Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to delete branch' });
    }
};
exports.deleteBranchController = deleteBranchController;
/**
 * Assign user to branch
 */
const assignUserToBranchController = async (req, res) => {
    try {
        const branchId = parseInt(req.params.id);
        const { userId, isPrimary } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const userBranch = await (0, branch_service_1.assignUserToBranch)(parseInt(userId), branchId, isPrimary === true);
        await auditLogger_1.auditLogger.system(req, {
            type: 'BRANCH_UPDATE',
            description: `User assigned to branch`,
            entityType: 'UserBranch',
            entityId: userBranch.id.toString(),
            metadata: {
                userId,
                branchId,
                isPrimary,
            },
        });
        res.json(userBranch);
    }
    catch (error) {
        console.error('[Assign User to Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to assign user to branch' });
    }
};
exports.assignUserToBranchController = assignUserToBranchController;
/**
 * Remove user from branch
 */
const removeUserFromBranchController = async (req, res) => {
    try {
        const branchId = parseInt(req.params.id);
        const userId = parseInt(req.params.userId);
        await (0, branch_service_1.removeUserFromBranch)(userId, branchId);
        await auditLogger_1.auditLogger.system(req, {
            type: 'BRANCH_UPDATE',
            description: `User removed from branch`,
            entityType: 'UserBranch',
            entityId: `${userId}-${branchId}`,
            metadata: {
                userId,
                branchId,
            },
        });
        res.json({ message: 'User removed from branch successfully' });
    }
    catch (error) {
        console.error('[Remove User from Branch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to remove user from branch' });
    }
};
exports.removeUserFromBranchController = removeUserFromBranchController;
/**
 * Get all users assigned to a branch
 */
const getBranchUsersController = async (req, res) => {
    try {
        const branchId = parseInt(req.params.id);
        const users = await (0, branch_service_1.getBranchUsers)(branchId);
        res.json(users);
    }
    catch (error) {
        console.error('[Get Branch Users Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get branch users' });
    }
};
exports.getBranchUsersController = getBranchUsersController;

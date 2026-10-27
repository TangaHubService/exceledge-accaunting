"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeShiftLegacyController = exports.getDailySummaryController = exports.createCashMovementController = exports.cancelShiftController = exports.reopenShiftController = exports.rejectCloseController = exports.approveCloseController = exports.submitCloseController = exports.startCloseController = exports.getShiftDetailsController = exports.getShiftSummaryController = exports.listShiftsController = exports.getActiveShiftController = exports.openShiftController = void 0;
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const shift_service_1 = require("../services/shift.service");
const auditLogger_1 = require("../utils/auditLogger");
const openShiftController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user.userId);
        const branchId = (0, branchAuth_middleware_1.getBranchIdForOperation)(req);
        const { openingFloat, deviceId, openingMobileMoney, openingNotes } = req.body;
        if (openingFloat === undefined || openingFloat === null || Number(openingFloat) < 0) {
            return res.status(400).json({ error: 'A valid opening float is required' });
        }
        if (openingMobileMoney !== undefined && openingMobileMoney !== null && Number(openingMobileMoney) < 0) {
            return res.status(400).json({ error: 'A valid opening mobile money balance is required' });
        }
        const shift = await (0, shift_service_1.openShift)({
            organizationId,
            branchId,
            userId,
            deviceId: deviceId ? parseInt(deviceId) : undefined,
            openingFloat: Number(openingFloat),
            openingMobileMoney: openingMobileMoney != null ? Number(openingMobileMoney) : 0,
            openingNotes,
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift ${shift.shiftNumber ?? `#${shift.id}`} opened with float ${openingFloat} and mobile money ${openingMobileMoney ?? 0}`,
            entityType: 'Shift',
            entityId: shift.id,
            metadata: { branchId, openingFloat, openingMobileMoney: openingMobileMoney ?? 0, shiftNumber: shift.shiftNumber },
        });
        res.status(201).json(shift);
    }
    catch (error) {
        console.error('[Open Shift Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to open shift' });
    }
};
exports.openShiftController = openShiftController;
const getActiveShiftController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user.userId);
        const shift = await (0, shift_service_1.getActiveShift)(organizationId, userId);
        if (!shift) {
            return res.status(404).json({ error: 'No open shift' });
        }
        res.json(shift);
    }
    catch (error) {
        console.error('[Get Active Shift Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get active shift' });
    }
};
exports.getActiveShiftController = getActiveShiftController;
const listShiftsController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { page, limit, startDate, endDate, userId, status, deviceId, search } = req.query;
        const where = {
            organizationId,
            ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
        };
        if (startDate || endDate) {
            where.openedAt = {
                ...(startDate ? { gte: new Date(String(startDate)) } : {}),
                ...(endDate ? { lte: new Date(new Date(String(endDate)).setHours(23, 59, 59, 999)) } : {}),
            };
        }
        if (userId)
            where.userId = parseInt(String(userId));
        if (status && status !== 'ALL')
            where.status = String(status);
        if (deviceId)
            where.deviceId = parseInt(String(deviceId));
        if (search) {
            where.OR = [
                { shiftNumber: { contains: String(search), mode: 'insensitive' } },
                { user: { name: { contains: String(search), mode: 'insensitive' } } },
            ];
        }
        const result = await (0, shift_service_1.listShifts)(organizationId, where, {
            page: page ? parseInt(String(page)) : undefined,
            limit: limit ? parseInt(String(limit)) : undefined,
        });
        res.json(result);
    }
    catch (error) {
        console.error('[List Shifts Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to list shifts' });
    }
};
exports.listShiftsController = listShiftsController;
const getShiftSummaryController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const shift = await (0, shift_service_1.getShiftById)(shiftId, organizationId);
        const summary = await (0, shift_service_1.computeShiftSummary)(shiftId, organizationId);
        res.json({ shift, summary });
    }
    catch (error) {
        console.error('[Get Shift Summary Error]:', error);
        res.status(404).json({ error: error.message || 'Shift not found' });
    }
};
exports.getShiftSummaryController = getShiftSummaryController;
const getShiftDetailsController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const result = await (0, shift_service_1.getShiftDetails)(shiftId, organizationId);
        res.json(result);
    }
    catch (error) {
        console.error('[Get Shift Details Error]:', error);
        res.status(404).json({ error: error.message || 'Shift not found' });
    }
};
exports.getShiftDetailsController = getShiftDetailsController;
const startCloseController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const userId = parseInt(req.user.userId);
        const result = await (0, shift_service_1.startClose)(shiftId, organizationId, userId);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift closing started`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: { summary: result.summary },
        });
        res.json(result);
    }
    catch (error) {
        console.error('[Start Shift Closing Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to start shift closing' });
    }
};
exports.startCloseController = startCloseController;
const submitCloseController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const userId = parseInt(req.user.userId);
        const { actualCash, actualMobileMoney, varianceReason, closingNotes, denominationCounts } = req.body;
        if (actualCash === undefined || actualCash === null || Number(actualCash) < 0) {
            return res.status(400).json({ error: 'A valid actual cash count is required' });
        }
        const result = await (0, shift_service_1.submitClose)({
            shiftId,
            organizationId,
            userId,
            actualCash: Number(actualCash),
            actualMobileMoney: actualMobileMoney != null ? Number(actualMobileMoney) : undefined,
            varianceReason,
            closingNotes,
            denominationCounts,
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift closing submitted. Difference: ${result.summary.difference}. Status: ${result.shift.status}`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: { summary: result.summary, status: result.shift.status },
        });
        res.json(result);
    }
    catch (error) {
        console.error('[Submit Shift Closing Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to submit shift closing' });
    }
};
exports.submitCloseController = submitCloseController;
const approveCloseController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const approverId = parseInt(req.user.userId);
        const { reason } = req.body;
        const closed = await (0, shift_service_1.approveClose)(shiftId, organizationId, approverId, reason);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift closing approved${reason ? `: ${reason}` : ''}`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: { reason, shiftNumber: closed.shiftNumber },
        });
        res.json({ shift: closed });
    }
    catch (error) {
        console.error('[Approve Shift Closing Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to approve shift closing' });
    }
};
exports.approveCloseController = approveCloseController;
const rejectCloseController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const reviewerId = parseInt(req.user.userId);
        const { reason } = req.body;
        const reopened = await (0, shift_service_1.rejectClose)(shiftId, organizationId, reviewerId, reason);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift closing rejected${reason ? `: ${reason}` : ''}. Shift reopened.`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: { reason, shiftNumber: reopened.shiftNumber },
        });
        res.json({ shift: reopened });
    }
    catch (error) {
        console.error('[Reject Shift Closing Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to reject shift closing' });
    }
};
exports.rejectCloseController = rejectCloseController;
const reopenShiftController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const { reason } = req.body;
        const reopened = await (0, shift_service_1.reopenShift)(shiftId, organizationId);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift reopened${reason ? `: ${reason}` : ''}`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: { reason, shiftNumber: reopened.shiftNumber },
        });
        res.json({ shift: reopened });
    }
    catch (error) {
        console.error('[Reopen Shift Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to reopen shift' });
    }
};
exports.reopenShiftController = reopenShiftController;
const cancelShiftController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const cancelled = await (0, shift_service_1.cancelShift)(shiftId, organizationId);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift ${cancelled.shiftNumber ?? cancelled.id} cancelled`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: { shiftNumber: cancelled.shiftNumber },
        });
        res.json({ shift: cancelled });
    }
    catch (error) {
        console.error('[Cancel Shift Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to cancel shift' });
    }
};
exports.cancelShiftController = cancelShiftController;
const createCashMovementController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user.userId);
        const branchId = (0, branchAuth_middleware_1.getBranchIdForOperation)(req);
        const { shiftId, type, amount, reason, reference } = req.body;
        if (!shiftId)
            return res.status(400).json({ error: 'Shift ID is required' });
        if (!type || !['CASH_IN', 'CASH_OUT'].includes(type)) {
            return res.status(400).json({ error: 'A valid cash movement type is required' });
        }
        const movement = await (0, shift_service_1.createCashMovement)({
            organizationId,
            branchId,
            shiftId: parseInt(shiftId),
            userId,
            type: type,
            amount: Number(amount),
            reason,
            reference,
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Cash movement ${type} of ${amount} recorded${reason ? `: ${reason}` : ''}`,
            entityType: 'Shift',
            entityId: parseInt(shiftId),
            metadata: { type, amount, reason, reference },
        });
        res.status(201).json({ movement });
    }
    catch (error) {
        console.error('[Create Cash Movement Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to record cash movement' });
    }
};
exports.createCashMovementController = createCashMovementController;
const getDailySummaryController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = (0, branchAuth_middleware_1.getBranchIdForOperation)(req);
        const date = req.query.date ? new Date(String(req.query.date)) : new Date();
        const result = await (0, shift_service_1.getDailySummary)(organizationId, branchId, date);
        res.json(result);
    }
    catch (error) {
        console.error('[Get Daily Shift Summary Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get daily shift summary' });
    }
};
exports.getDailySummaryController = getDailySummaryController;
const closeShiftLegacyController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const shiftId = parseInt(req.params.id);
        const userId = parseInt(req.user.userId);
        const { actualCash, actualMobileMoney, closingNotes, varianceReason, denominationCounts } = req.body;
        if (actualCash === undefined || actualCash === null || Number(actualCash) < 0) {
            return res.status(400).json({ error: 'A valid actual cash count is required' });
        }
        const result = await (0, shift_service_1.submitClose)({
            shiftId,
            organizationId,
            userId,
            actualCash: Number(actualCash),
            actualMobileMoney: actualMobileMoney != null ? Number(actualMobileMoney) : undefined,
            closingNotes,
            varianceReason,
            denominationCounts,
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Shift closed. Difference: ${result.summary.difference}. Status: ${result.shift.status}`,
            entityType: 'Shift',
            entityId: shiftId,
            metadata: result.summary,
        });
        res.json(result);
    }
    catch (error) {
        console.error('[Close Shift Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to close shift' });
    }
};
exports.closeShiftLegacyController = closeShiftLegacyController;

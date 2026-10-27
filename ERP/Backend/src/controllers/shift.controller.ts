import type { Response } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { getBranchIdForOperation, buildBranchFilter } from '../middleware/branchAuth.middleware';
import { Prisma, ShiftStatus, CashMovementType } from '@prisma/client';
import {
  openShift,
  getActiveShift,
  getShiftById,
  computeShiftSummary,
  submitClose,
  startClose,
  approveClose,
  rejectClose,
  reopenShift,
  cancelShift,
  createCashMovement,
  listShifts,
  getShiftDetails,
  getDailySummary,
} from '../services/shift.service';
import { auditLogger } from '../utils/auditLogger';

export const openShiftController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user!.userId);
    const branchId = getBranchIdForOperation(req);
    const { openingFloat, deviceId, openingMobileMoney, openingNotes } = req.body;

    if (openingFloat === undefined || openingFloat === null || Number(openingFloat) < 0) {
      return res.status(400).json({ error: 'A valid opening float is required' });
    }

    if (openingMobileMoney !== undefined && openingMobileMoney !== null && Number(openingMobileMoney) < 0) {
      return res.status(400).json({ error: 'A valid opening mobile money balance is required' });
    }

    const shift = await openShift({
      organizationId,
      branchId,
      userId,
      deviceId: deviceId ? parseInt(deviceId) : undefined,
      openingFloat: Number(openingFloat),
      openingMobileMoney: openingMobileMoney != null ? Number(openingMobileMoney) : 0,
      openingNotes,
    });

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift ${shift.shiftNumber ?? `#${shift.id}`} opened with float ${openingFloat} and mobile money ${openingMobileMoney ?? 0}`,
      entityType: 'Shift',
      entityId: shift.id,
      metadata: { branchId, openingFloat, openingMobileMoney: openingMobileMoney ?? 0, shiftNumber: shift.shiftNumber },
    });

    res.status(201).json(shift);
  } catch (error: any) {
    console.error('[Open Shift Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to open shift' });
  }
};

export const getActiveShiftController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user!.userId);

    const shift = await getActiveShift(organizationId, userId);
    if (!shift) {
      return res.status(404).json({ error: 'No open shift' });
    }

    res.json(shift);
  } catch (error: any) {
    console.error('[Get Active Shift Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to get active shift' });
  }
};

export const listShiftsController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { page, limit, startDate, endDate, userId, status, deviceId, search } = req.query;

    const where: Prisma.ShiftWhereInput = {
      organizationId,
      ...buildBranchFilter(req),
    };

    if (startDate || endDate) {
      where.openedAt = {
        ...(startDate ? { gte: new Date(String(startDate)) } : {}),
        ...(endDate ? { lte: new Date(new Date(String(endDate)).setHours(23, 59, 59, 999)) } : {}),
      };
    }
    if (userId) where.userId = parseInt(String(userId));
    if (status && status !== 'ALL') where.status = String(status) as ShiftStatus;
    if (deviceId) where.deviceId = parseInt(String(deviceId));
    if (search) {
      where.OR = [
        { shiftNumber: { contains: String(search), mode: 'insensitive' } },
        { user: { name: { contains: String(search), mode: 'insensitive' } } },
      ];
    }

    const result = await listShifts(organizationId, where, {
      page: page ? parseInt(String(page)) : undefined,
      limit: limit ? parseInt(String(limit)) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[List Shifts Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to list shifts' });
  }
};

export const getShiftSummaryController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);

    const shift = await getShiftById(shiftId, organizationId);
    const summary = await computeShiftSummary(shiftId, organizationId);

    res.json({ shift, summary });
  } catch (error: any) {
    console.error('[Get Shift Summary Error]:', error);
    res.status(404).json({ error: error.message || 'Shift not found' });
  }
};

export const getShiftDetailsController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const result = await getShiftDetails(shiftId, organizationId);
    res.json(result);
  } catch (error: any) {
    console.error('[Get Shift Details Error]:', error);
    res.status(404).json({ error: error.message || 'Shift not found' });
  }
};

export const startCloseController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const userId = parseInt(req.user!.userId);

    const result = await startClose(shiftId, organizationId, userId);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift closing started`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: { summary: result.summary },
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Start Shift Closing Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to start shift closing' });
  }
};

export const submitCloseController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const userId = parseInt(req.user!.userId);
    const { actualCash, actualMobileMoney, varianceReason, closingNotes, denominationCounts } = req.body;

    if (actualCash === undefined || actualCash === null || Number(actualCash) < 0) {
      return res.status(400).json({ error: 'A valid actual cash count is required' });
    }

    const result = await submitClose({
      shiftId,
      organizationId,
      userId,
      actualCash: Number(actualCash),
      actualMobileMoney: actualMobileMoney != null ? Number(actualMobileMoney) : undefined,
      varianceReason,
      closingNotes,
      denominationCounts,
    });

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift closing submitted. Difference: ${result.summary.difference}. Status: ${result.shift.status}`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: { summary: result.summary, status: result.shift.status },
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Submit Shift Closing Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to submit shift closing' });
  }
};

export const approveCloseController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const approverId = parseInt(req.user!.userId);
    const { reason } = req.body;

    const closed = await approveClose(shiftId, organizationId, approverId, reason);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift closing approved${reason ? `: ${reason}` : ''}`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: { reason, shiftNumber: closed.shiftNumber },
    });

    res.json({ shift: closed });
  } catch (error: any) {
    console.error('[Approve Shift Closing Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to approve shift closing' });
  }
};

export const rejectCloseController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const reviewerId = parseInt(req.user!.userId);
    const { reason } = req.body;

    const reopened = await rejectClose(shiftId, organizationId, reviewerId, reason);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift closing rejected${reason ? `: ${reason}` : ''}. Shift reopened.`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: { reason, shiftNumber: reopened.shiftNumber },
    });

    res.json({ shift: reopened });
  } catch (error: any) {
    console.error('[Reject Shift Closing Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to reject shift closing' });
  }
};

export const reopenShiftController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const { reason } = req.body;

    const reopened = await reopenShift(shiftId, organizationId);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift reopened${reason ? `: ${reason}` : ''}`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: { reason, shiftNumber: reopened.shiftNumber },
    });

    res.json({ shift: reopened });
  } catch (error: any) {
    console.error('[Reopen Shift Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to reopen shift' });
  }
};

export const cancelShiftController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);

    const cancelled = await cancelShift(shiftId, organizationId);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift ${cancelled.shiftNumber ?? cancelled.id} cancelled`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: { shiftNumber: cancelled.shiftNumber },
    });

    res.json({ shift: cancelled });
  } catch (error: any) {
    console.error('[Cancel Shift Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to cancel shift' });
  }
};

export const createCashMovementController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user!.userId);
    const branchId = getBranchIdForOperation(req);
    const { shiftId, type, amount, reason, reference } = req.body;

    if (!shiftId) return res.status(400).json({ error: 'Shift ID is required' });
    if (!type || !['CASH_IN', 'CASH_OUT'].includes(type)) {
      return res.status(400).json({ error: 'A valid cash movement type is required' });
    }

    const movement = await createCashMovement({
      organizationId,
      branchId,
      shiftId: parseInt(shiftId),
      userId,
      type: type as CashMovementType,
      amount: Number(amount),
      reason,
      reference,
    });

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Cash movement ${type} of ${amount} recorded${reason ? `: ${reason}` : ''}`,
      entityType: 'Shift',
      entityId: parseInt(shiftId),
      metadata: { type, amount, reason, reference },
    });

    res.status(201).json({ movement });
  } catch (error: any) {
    console.error('[Create Cash Movement Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to record cash movement' });
  }
};

export const getDailySummaryController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const branchId = getBranchIdForOperation(req);
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();

    const result = await getDailySummary(organizationId, branchId, date);
    res.json(result);
  } catch (error: any) {
    console.error('[Get Daily Shift Summary Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to get daily shift summary' });
  }
};

export const closeShiftLegacyController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const shiftId = parseInt(req.params.id);
    const userId = parseInt(req.user!.userId);
    const { actualCash, actualMobileMoney, closingNotes, varianceReason, denominationCounts } = req.body;

    if (actualCash === undefined || actualCash === null || Number(actualCash) < 0) {
      return res.status(400).json({ error: 'A valid actual cash count is required' });
    }

    const result = await submitClose({
      shiftId,
      organizationId,
      userId,
      actualCash: Number(actualCash),
      actualMobileMoney: actualMobileMoney != null ? Number(actualMobileMoney) : undefined,
      closingNotes,
      varianceReason,
      denominationCounts,
    });

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Shift closed. Difference: ${result.summary.difference}. Status: ${result.shift.status}`,
      entityType: 'Shift',
      entityId: shiftId,
      metadata: result.summary,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Close Shift Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to close shift' });
  }
};
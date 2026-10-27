import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  runProduction,
  getProductionRuns,
  getProductionRunById,
  reverseProductionRun,
} from '../services/production.service';
import { success, error as apiError } from '../utils/apiResponse';
import { auditLogger } from '../utils/auditLogger';

export const createProductionRun = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { branchId, productId, quantity, note, batchNumber, expiryDate } = req.body;
    const userId = parseInt((req as any).user?.userId as string);

    if (!branchId || !productId || !quantity) {
      return res.status(400).json(apiError('branchId, productId, and quantity are required'));
    }

    const result = await runProduction({
      organizationId,
      branchId: parseInt(branchId),
      productId: parseInt(productId),
      quantity: parseFloat(quantity),
      userId,
      note,
      batchNumber,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    });

    await auditLogger.inventory(req, {
      type: 'STOCK_INCREASED',
      description: `Production run completed: ${result.producedFinishedGoods.quantityProduced} units of ${result.producedFinishedGoods.productName} produced`,
      entityType: 'ProductionRun',
      entityId: result.productionRun.id,
      metadata: {
        productionRun: result.productionRun,
        consumedComponents: result.consumedComponents,
        producedFinishedGoods: result.producedFinishedGoods,
        totalCost: result.totalCost,
      },
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    console.error('[Create Production Run Error]:', err);
    res.status(400).json(apiError(err.message || 'Failed to run production'));
  }
};

export const listProductionRuns = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { branchId, productId, startDate, endDate, page = '1', limit = '50' } = req.query;

    const result = await getProductionRuns(
      organizationId,
      branchId ? parseInt(branchId as string) : undefined,
      productId ? parseInt(productId as string) : undefined,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined,
      parseInt(page as string),
      parseInt(limit as string),
    );

    res.json(success(result));
  } catch (err: any) {
    console.error('[List Production Runs Error]:', err);
    res.status(500).json(apiError('Failed to get production runs'));
  }
};

export const getProductionRun = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const runId = parseInt(req.params.runId);

    const run = await getProductionRunById(organizationId, runId);
    if (!run) {
      return res.status(404).json(apiError('Production run not found'));
    }

    res.json(success(run));
  } catch (err: any) {
    console.error('[Get Production Run Error]:', err);
    res.status(500).json(apiError('Failed to get production run'));
  }
};

export const reverseProductionRunController = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const runId = parseInt(req.params.runId);
    const { note } = req.body;
    const userId = parseInt((req as any).user?.userId as string);

    await reverseProductionRun(organizationId, runId, userId, note);

    await auditLogger.inventory(req, {
      type: 'STOCK_ADJUSTMENT',
      description: `Production run #${runId} reversed`,
      entityType: 'ProductionRun',
      entityId: runId,
    });

    res.json(success({ message: 'Production run reversed successfully' }));
  } catch (err: any) {
    console.error('[Reverse Production Run Error]:', err);
    res.status(400).json(apiError(err.message || 'Failed to reverse production run'));
  }
};
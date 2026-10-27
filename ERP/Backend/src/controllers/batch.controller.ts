import type { Response } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { buildBranchFilter, getBranchIdForOperation } from '../middleware/branchAuth.middleware';
import { PrismaClient, ActivityType } from '@prisma/client';
import {
  createBatch,
  getBatchesForProduct,
  getBatchById,
  selectBatchesForSale,
} from '../services/batch.service';
import { logManualActivity } from '../middleware/activity-log.middleware';

/**
 * Get all batches for a product
 */
export const getProductBatches = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const productId = parseInt(req.params.productId);
    const { warehouseId, includeInactive } = req.query;

    const batches = await getBatchesForProduct(
      productId,
      organizationId,
      getBranchIdForOperation(req),
      includeInactive === 'true'
    );

    res.json(batches);
  } catch (error: any) {
    console.error('[Get Product Batches Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to get batches' });
  }
};

/**
 * Get a single batch by ID
 */
export const getBatch = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const batchId = parseInt(req.params.id);

    const batch = await getBatchById(batchId, organizationId);

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    res.json(batch);
  } catch (error: any) {
    console.error('[Get Batch Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to get batch' });
  }
};

/**
 * Create a new batch
 */
export const createBatchController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user?.userId as string);
    const {
      productId,
      batchNumber,
      quantity,
      unitCost,
      expiryDate,
      warehouseId,
      reference,
      referenceType,
    } = req.body;

    if (!productId || !batchNumber || !quantity || unitCost === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: productId, batchNumber, quantity, unitCost',
      });
    }

    const qty = Math.round(parseFloat(String(quantity)) * 1000) / 1000;
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const batch = await createBatch({
      productId: parseInt(productId),
      organizationId,
      batchNumber,
      quantity: qty,
      unitCost: parseFloat(unitCost),
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      branchId: getBranchIdForOperation(req)!,
      userId,
      reference,
      referenceType,
    });

    await logManualActivity({
      userId,
      organizationId,
      module: 'INVENTORY',
      type: 'PRODUCT_CREATE',
      description: `Batch ${batchNumber} created for product`,
      entityType: 'Batch',
      entityId: String(batch.id),
      metadata: {
        batchNumber,
        productId: parseInt(productId),
        quantity: qty,
      },
    });

    res.status(201).json(batch);
  } catch (error: any) {
    console.error('[Create Batch Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to create batch' });
  }
};

/**
 * Select batches for sale (FIFO/LIFO/AVERAGE)
 */
export const selectBatches = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { productId, quantity, method, warehouseId } = req.body;

    if (!productId || !quantity || !method) {
      return res.status(400).json({
        error: 'Missing required fields: productId, quantity, method',
      });
    }

    if (!['FIFO', 'LIFO', 'AVERAGE'].includes(method)) {
      return res.status(400).json({
        error: 'Method must be FIFO, LIFO, or AVERAGE',
      });
    }

    const selectedBatches = await selectBatchesForSale({
      productId: parseInt(productId),
      organizationId,
      quantity: Math.round(parseFloat(String(quantity)) * 1000) / 1000,
      method: method as 'FIFO' | 'LIFO' | 'AVERAGE',
      branchId: getBranchIdForOperation(req),
    });

    res.json(selectedBatches);
  } catch (error: any) {
    console.error('[Select Batches Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to select batches' });
  }
};

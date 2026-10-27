import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  addStock,
  removeStock,
  adjustStock,
  getLedger,
  getInventorySummary,
  getCurrentStock,
  getInventoryHistory,
  recalculateProductStock,
} from '../services/inventory-ledger.service';
import { InventoryMovementType } from '@prisma/client';
import { getOrganizationSettings } from '../services/organization-settings.service';

const STOCK_ADJUSTMENT_APPROVER_ROLES = ['ADMIN', 'BRANCH_MANAGER'];

/** Ledger quantities are Decimal(15,3) — keep kg/litre fractions instead of truncating. */
const parseStockQty = (v: unknown): number => Math.round(parseFloat(String(v)) * 1000) / 1000;

/**
 * POST /inventory/in
 * Add stock to inventory (Stock IN)
 */
export const addStockToInventory = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user?.userId as string);

    const {
      productId,
      quantity,
      movementType,
      warehouseId,
      unitCost,
      reference,
      referenceType,
      batchNumber,
      expiryDate,
      note,
      metadata,
    } = req.body;

    // Validate required fields
    if (!productId || !quantity || !movementType) {
      return res.status(400).json({
        error: 'Missing required fields: productId, quantity, movementType',
      });
    }

    // Validate movement type
    const validInTypes: InventoryMovementType[] = [
      'PURCHASE',
      'RETURN_CUSTOMER',
      'TRANSFER_IN',
      'INITIAL_STOCK',
      'ADJUSTMENT_IN',
    ];

    if (!validInTypes.includes(movementType)) {
      return res.status(400).json({
        error: `Invalid movement type for stock IN. Valid types: ${validInTypes.join(', ')}`,
      });
    }

    const ledgerEntry = await addStock({
      organizationId,
      productId: parseInt(productId),
      userId,
      quantity: parseStockQty(quantity),
      movementType,
      branchId: req.body.branchId ? parseInt(req.body.branchId) : null,
      warehouseId: warehouseId ? parseInt(warehouseId) : null,
      unitCost: unitCost ? parseFloat(unitCost) : undefined,
      reference,
      referenceType,
      batchNumber,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      note,
      metadata,
    });

    res.status(201).json({
      message: 'Stock added successfully',
      ledgerEntry,
      currentStock: ledgerEntry.runningBalance,
    });
  } catch (error: any) {
    console.error('[Add Stock Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to add stock',
    });
  }
};

/**
 * POST /inventory/out
 * Remove stock from inventory (Stock OUT)
 */
export const removeStockFromInventory = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user?.userId as string);

    const {
      productId,
      quantity,
      movementType,
      warehouseId,
      reference,
      referenceType,
      note,
      metadata,
    } = req.body;

    // Validate required fields
    if (!productId || !quantity || !movementType) {
      return res.status(400).json({
        error: 'Missing required fields: productId, quantity, movementType',
      });
    }

    // Validate movement type
    const validOutTypes: InventoryMovementType[] = [
      'SALE',
      'DAMAGE',
      'EXPIRED',
      'TRANSFER_OUT',
      'ADJUSTMENT_OUT',
    ];

    if (!validOutTypes.includes(movementType)) {
      return res.status(400).json({
        error: `Invalid movement type for stock OUT. Valid types: ${validOutTypes.join(', ')}`,
      });
    }

    const ledgerEntry = await removeStock({
      organizationId,
      productId: parseInt(productId),
      userId,
      quantity: parseStockQty(quantity),
      movementType,
      branchId: req.body.branchId ? parseInt(req.body.branchId) : null,
      warehouseId: warehouseId ? parseInt(warehouseId) : null,
      reference,
      referenceType,
      note,
      metadata,
    });

    res.status(201).json({
      message: 'Stock removed successfully',
      ledgerEntry,
      currentStock: ledgerEntry.runningBalance,
    });
  } catch (error: any) {
    console.error('[Remove Stock Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to remove stock',
    });
  }
};

/**
 * POST /inventory/adjustment
 * Adjust stock (can be positive or negative)
 */
export const adjustInventoryStock = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user?.userId as string);

    const {
      productId,
      quantity, // Can be positive or negative
      warehouseId,
      unitCost,
      reference,
      referenceType,
      note,
      metadata,
    } = req.body;

    // Validate required fields
    if (!productId || quantity === undefined || quantity === null) {
      return res.status(400).json({
        error: 'Missing required fields: productId, quantity',
      });
    }

    if (quantity === 0) {
      return res.status(400).json({
        error: 'Adjustment quantity cannot be zero',
      });
    }

    // Branch ID is required for stock adjustments (multi-branch isolation)
    if (!req.body.branchId) {
      return res.status(400).json({
        error: 'branchId is required for stock adjustments',
      });
    }

    // When the org requires approval, only managers may apply an adjustment
    // directly — there's no pending-approval queue, so other roles are
    // simply blocked and must ask a manager to perform it themselves.
    const orgSettings = await getOrganizationSettings(organizationId);
    if (
      orgSettings.featureFlags.requireStockAdjustmentApproval &&
      !STOCK_ADJUSTMENT_APPROVER_ROLES.includes(req.user?.role as string)
    ) {
      return res.status(403).json({
        error: 'Stock adjustments require manager approval. Ask an admin or branch manager to make this adjustment.',
      });
    }

    // Parse quantity - can be positive or negative for adjustments
    const adjustmentQuantity = Number(quantity);
    if (isNaN(adjustmentQuantity)) {
      return res.status(400).json({
        error: 'Invalid quantity value',
      });
    }

    const ledgerEntry = await adjustStock({
      organizationId,
      productId: parseInt(productId),
      userId,
      quantity: adjustmentQuantity, // Can be positive or negative
      branchId: parseInt(req.body.branchId),
      warehouseId: warehouseId ? parseInt(warehouseId) : null,
      unitCost: unitCost ? parseFloat(unitCost) : undefined,
      reference,
      referenceType,
      note,
      metadata,
    });

    res.status(201).json({
      message: 'Stock adjusted successfully',
      ledgerEntry,
      currentStock: ledgerEntry.runningBalance,
    });
  } catch (error: any) {
    console.error('[Adjust Stock Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to adjust stock',
    });
  }
};

/**
 * GET /inventory/ledger
 * Get ledger entries with filtering and pagination
 */
export const getInventoryLedger = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);

    const {
      productId,
      warehouseId,
      movementType,
      startDate,
      endDate,
      page = '1',
      limit = '50',
    } = req.query;

    const result = await getLedger({
      organizationId,
      productId: productId ? parseInt(productId as string) : undefined,
      warehouseId:
        warehouseId === 'null' || warehouseId === null
          ? null
          : warehouseId
            ? parseInt(warehouseId as string)
            : undefined,
      movementType: movementType as InventoryMovementType | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Get Ledger Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to get ledger entries',
    });
  }
};

/**
 * GET /inventory/summary
 * Get inventory summary since inception or from a specific date
 */
export const getInventorySummaryReport = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);

    const { productId, warehouseId, from = 'inception' } = req.query;

    const fromDate = from === 'inception' ? 'inception' : new Date(from as string);

    const result = await getInventorySummary({
      organizationId,
      productId: productId ? parseInt(productId as string) : undefined,
      warehouseId:
        warehouseId === 'null' || warehouseId === null
          ? null
          : warehouseId
            ? parseInt(warehouseId as string)
            : undefined,
      fromDate,
    });

    // The service returns { summary: [...], fromDate }
    // Extract the summary array and use the fromDate from the result or request
    res.json({
      summary: result.summary || [],
      fromDate: result.fromDate === 'inception' ? 'inception' : (fromDate === 'inception' ? 'inception' : fromDate),
    });
  } catch (error: any) {
    console.error('[Get Summary Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to get inventory summary',
    });
  }
};

/**
 * GET /inventory/current-stock/:productId
 * Get current stock for a product (calculated from ledger)
 */
export const getCurrentStockLevel = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const productId = parseInt(req.params.productId);
    const { warehouseId } = req.query;

    const stock = await getCurrentStock(
      organizationId,
      productId,
      warehouseId === 'null' || warehouseId === null
        ? null
        : warehouseId
          ? parseInt(warehouseId as string)
          : undefined
    );

    res.json({
      productId,
      warehouseId: warehouseId || null,
      currentStock: stock,
    });
  } catch (error: any) {
    console.error('[Get Current Stock Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to get current stock',
    });
  }
};

/**
 * GET /inventory/history/:productId
 * Get complete inventory history for a product since inception
 */
export const getProductInventoryHistory = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const productId = parseInt(req.params.productId);
    const { warehouseId } = req.query;

    const history = await getInventoryHistory(
      organizationId,
      productId,
      warehouseId === 'null' || warehouseId === null
        ? null
        : warehouseId
          ? parseInt(warehouseId as string)
          : undefined
    );

    res.json({
      productId,
      warehouseId: warehouseId || null,
      history,
      totalMovements: history.length,
    });
  } catch (error: any) {
    console.error('[Get History Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to get inventory history',
    });
  }
};

/**
 * POST /inventory/recalculate/:productId
 * Recalculate product stock from ledger (useful for data integrity)
 */
export const recalculateStock = async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const productId = parseInt(req.params.productId);
    const { warehouseId } = req.body;

    const recalculatedStock = await recalculateProductStock(
      organizationId,
      productId,
      warehouseId === null || warehouseId === undefined
        ? null
        : parseInt(warehouseId)
    );

    res.json({
      message: 'Stock recalculated successfully',
      productId,
      warehouseId: warehouseId || null,
      recalculatedStock,
    });
  } catch (error: any) {
    console.error('[Recalculate Stock Error]:', error);
    res.status(500).json({
      error: error.message || 'Failed to recalculate stock',
    });
  }
};

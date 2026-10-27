import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  addStockToInventory,
  removeStockFromInventory,
  adjustInventoryStock,
  getInventoryLedger,
  getInventorySummaryReport,
  getCurrentStockLevel,
  getProductInventoryHistory,
  recalculateStock,
} from '../controllers/inventory-ledger.controller';

const router = Router();

/**
 * Inventory Ledger Routes
 * 
 * All routes are protected and require authentication
 * All routes require organizationId in params
 */

// Stock IN - Add stock to inventory
router.post(
  '/:organizationId/in',
  authenticate,
  addStockToInventory
);

// Stock OUT - Remove stock from inventory
router.post(
  '/:organizationId/out',
  authenticate,
  removeStockFromInventory
);

// Stock Adjustment - Adjust stock (positive or negative)
router.post(
  '/:organizationId/adjustment',
  authenticate,
  adjustInventoryStock
);

// Get ledger entries with filtering and pagination
router.get(
  '/:organizationId/ledger',
  authenticate,
  getInventoryLedger
);

// Get inventory summary since inception or from date
router.get(
  '/:organizationId/summary',
  authenticate,
  getInventorySummaryReport
);

// Get current stock for a product
router.get(
  '/:organizationId/current-stock/:productId',
  authenticate,
  getCurrentStockLevel
);

// Get complete inventory history for a product
router.get(
  '/:organizationId/history/:productId',
  authenticate,
  getProductInventoryHistory
);

// Recalculate product stock from ledger
router.post(
  '/:organizationId/recalculate/:productId',
  authenticate,
  recalculateStock
);

export default router;

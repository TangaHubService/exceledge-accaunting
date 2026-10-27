"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const inventory_ledger_controller_1 = require("../controllers/inventory-ledger.controller");
const router = (0, express_1.Router)();
/**
 * Inventory Ledger Routes
 *
 * All routes are protected and require authentication
 * All routes require organizationId in params
 */
// Stock IN - Add stock to inventory
router.post('/:organizationId/in', auth_middleware_1.authenticate, inventory_ledger_controller_1.addStockToInventory);
// Stock OUT - Remove stock from inventory
router.post('/:organizationId/out', auth_middleware_1.authenticate, inventory_ledger_controller_1.removeStockFromInventory);
// Stock Adjustment - Adjust stock (positive or negative)
router.post('/:organizationId/adjustment', auth_middleware_1.authenticate, inventory_ledger_controller_1.adjustInventoryStock);
// Get ledger entries with filtering and pagination
router.get('/:organizationId/ledger', auth_middleware_1.authenticate, inventory_ledger_controller_1.getInventoryLedger);
// Get inventory summary since inception or from date
router.get('/:organizationId/summary', auth_middleware_1.authenticate, inventory_ledger_controller_1.getInventorySummaryReport);
// Get current stock for a product
router.get('/:organizationId/current-stock/:productId', auth_middleware_1.authenticate, inventory_ledger_controller_1.getCurrentStockLevel);
// Get complete inventory history for a product
router.get('/:organizationId/history/:productId', auth_middleware_1.authenticate, inventory_ledger_controller_1.getProductInventoryHistory);
// Recalculate product stock from ledger
router.post('/:organizationId/recalculate/:productId', auth_middleware_1.authenticate, inventory_ledger_controller_1.recalculateStock);
exports.default = router;

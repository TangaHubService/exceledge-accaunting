"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateStock = exports.getProductInventoryHistory = exports.getCurrentStockLevel = exports.getInventorySummaryReport = exports.getInventoryLedger = exports.adjustInventoryStock = exports.removeStockFromInventory = exports.addStockToInventory = void 0;
const inventory_ledger_service_1 = require("../services/inventory-ledger.service");
const organization_settings_service_1 = require("../services/organization-settings.service");
const STOCK_ADJUSTMENT_APPROVER_ROLES = ['ADMIN', 'BRANCH_MANAGER'];
/**
 * POST /inventory/in
 * Add stock to inventory (Stock IN)
 */
const addStockToInventory = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user?.userId);
        const { productId, quantity, movementType, warehouseId, unitCost, reference, referenceType, batchNumber, expiryDate, note, metadata, } = req.body;
        // Validate required fields
        if (!productId || !quantity || !movementType) {
            return res.status(400).json({
                error: 'Missing required fields: productId, quantity, movementType',
            });
        }
        // Validate movement type
        const validInTypes = [
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
        const ledgerEntry = await (0, inventory_ledger_service_1.addStock)({
            organizationId,
            productId: parseInt(productId),
            userId,
            quantity: parseInt(quantity),
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
    }
    catch (error) {
        console.error('[Add Stock Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to add stock',
        });
    }
};
exports.addStockToInventory = addStockToInventory;
/**
 * POST /inventory/out
 * Remove stock from inventory (Stock OUT)
 */
const removeStockFromInventory = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user?.userId);
        const { productId, quantity, movementType, warehouseId, reference, referenceType, note, metadata, } = req.body;
        // Validate required fields
        if (!productId || !quantity || !movementType) {
            return res.status(400).json({
                error: 'Missing required fields: productId, quantity, movementType',
            });
        }
        // Validate movement type
        const validOutTypes = [
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
        const ledgerEntry = await (0, inventory_ledger_service_1.removeStock)({
            organizationId,
            productId: parseInt(productId),
            userId,
            quantity: parseInt(quantity),
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
    }
    catch (error) {
        console.error('[Remove Stock Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to remove stock',
        });
    }
};
exports.removeStockFromInventory = removeStockFromInventory;
/**
 * POST /inventory/adjustment
 * Adjust stock (can be positive or negative)
 */
const adjustInventoryStock = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user?.userId);
        const { productId, quantity, // Can be positive or negative
        warehouseId, unitCost, reference, referenceType, note, metadata, } = req.body;
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
        const orgSettings = await (0, organization_settings_service_1.getOrganizationSettings)(organizationId);
        if (orgSettings.featureFlags.requireStockAdjustmentApproval &&
            !STOCK_ADJUSTMENT_APPROVER_ROLES.includes(req.user?.role)) {
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
        const ledgerEntry = await (0, inventory_ledger_service_1.adjustStock)({
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
    }
    catch (error) {
        console.error('[Adjust Stock Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to adjust stock',
        });
    }
};
exports.adjustInventoryStock = adjustInventoryStock;
/**
 * GET /inventory/ledger
 * Get ledger entries with filtering and pagination
 */
const getInventoryLedger = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { productId, warehouseId, movementType, startDate, endDate, page = '1', limit = '50', } = req.query;
        const result = await (0, inventory_ledger_service_1.getLedger)({
            organizationId,
            productId: productId ? parseInt(productId) : undefined,
            warehouseId: warehouseId === 'null' || warehouseId === null
                ? null
                : warehouseId
                    ? parseInt(warehouseId)
                    : undefined,
            movementType: movementType,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            page: parseInt(page),
            limit: parseInt(limit),
        });
        res.json(result);
    }
    catch (error) {
        console.error('[Get Ledger Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to get ledger entries',
        });
    }
};
exports.getInventoryLedger = getInventoryLedger;
/**
 * GET /inventory/summary
 * Get inventory summary since inception or from a specific date
 */
const getInventorySummaryReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { productId, warehouseId, from = 'inception' } = req.query;
        const fromDate = from === 'inception' ? 'inception' : new Date(from);
        const result = await (0, inventory_ledger_service_1.getInventorySummary)({
            organizationId,
            productId: productId ? parseInt(productId) : undefined,
            warehouseId: warehouseId === 'null' || warehouseId === null
                ? null
                : warehouseId
                    ? parseInt(warehouseId)
                    : undefined,
            fromDate,
        });
        // The service returns { summary: [...], fromDate }
        // Extract the summary array and use the fromDate from the result or request
        res.json({
            summary: result.summary || [],
            fromDate: result.fromDate === 'inception' ? 'inception' : (fromDate === 'inception' ? 'inception' : fromDate),
        });
    }
    catch (error) {
        console.error('[Get Summary Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to get inventory summary',
        });
    }
};
exports.getInventorySummaryReport = getInventorySummaryReport;
/**
 * GET /inventory/current-stock/:productId
 * Get current stock for a product (calculated from ledger)
 */
const getCurrentStockLevel = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const productId = parseInt(req.params.productId);
        const { warehouseId } = req.query;
        const stock = await (0, inventory_ledger_service_1.getCurrentStock)(organizationId, productId, warehouseId === 'null' || warehouseId === null
            ? null
            : warehouseId
                ? parseInt(warehouseId)
                : undefined);
        res.json({
            productId,
            warehouseId: warehouseId || null,
            currentStock: stock,
        });
    }
    catch (error) {
        console.error('[Get Current Stock Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to get current stock',
        });
    }
};
exports.getCurrentStockLevel = getCurrentStockLevel;
/**
 * GET /inventory/history/:productId
 * Get complete inventory history for a product since inception
 */
const getProductInventoryHistory = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const productId = parseInt(req.params.productId);
        const { warehouseId } = req.query;
        const history = await (0, inventory_ledger_service_1.getInventoryHistory)(organizationId, productId, warehouseId === 'null' || warehouseId === null
            ? null
            : warehouseId
                ? parseInt(warehouseId)
                : undefined);
        res.json({
            productId,
            warehouseId: warehouseId || null,
            history,
            totalMovements: history.length,
        });
    }
    catch (error) {
        console.error('[Get History Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to get inventory history',
        });
    }
};
exports.getProductInventoryHistory = getProductInventoryHistory;
/**
 * POST /inventory/recalculate/:productId
 * Recalculate product stock from ledger (useful for data integrity)
 */
const recalculateStock = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const productId = parseInt(req.params.productId);
        const { warehouseId } = req.body;
        const recalculatedStock = await (0, inventory_ledger_service_1.recalculateProductStock)(organizationId, productId, warehouseId === null || warehouseId === undefined
            ? null
            : parseInt(warehouseId));
        res.json({
            message: 'Stock recalculated successfully',
            productId,
            warehouseId: warehouseId || null,
            recalculatedStock,
        });
    }
    catch (error) {
        console.error('[Recalculate Stock Error]:', error);
        res.status(500).json({
            error: error.message || 'Failed to recalculate stock',
        });
    }
};
exports.recalculateStock = recalculateStock;

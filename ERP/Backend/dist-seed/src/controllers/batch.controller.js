"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectBatches = exports.createBatchController = exports.getBatch = exports.getProductBatches = void 0;
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const batch_service_1 = require("../services/batch.service");
const activity_log_middleware_1 = require("../middleware/activity-log.middleware");
/**
 * Get all batches for a product
 */
const getProductBatches = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const productId = parseInt(req.params.productId);
        const { warehouseId, includeInactive } = req.query;
        const batches = await (0, batch_service_1.getBatchesForProduct)(productId, organizationId, (0, branchAuth_middleware_1.getBranchIdForOperation)(req), includeInactive === 'true');
        res.json(batches);
    }
    catch (error) {
        console.error('[Get Product Batches Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get batches' });
    }
};
exports.getProductBatches = getProductBatches;
/**
 * Get a single batch by ID
 */
const getBatch = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const batchId = parseInt(req.params.id);
        const batch = await (0, batch_service_1.getBatchById)(batchId, organizationId);
        if (!batch) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        res.json(batch);
    }
    catch (error) {
        console.error('[Get Batch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to get batch' });
    }
};
exports.getBatch = getBatch;
/**
 * Create a new batch
 */
const createBatchController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user?.userId);
        const { productId, batchNumber, quantity, unitCost, expiryDate, warehouseId, reference, referenceType, } = req.body;
        if (!productId || !batchNumber || !quantity || unitCost === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: productId, batchNumber, quantity, unitCost',
            });
        }
        const batch = await (0, batch_service_1.createBatch)({
            productId: parseInt(productId),
            organizationId,
            batchNumber,
            quantity: parseInt(quantity),
            unitCost: parseFloat(unitCost),
            expiryDate: expiryDate ? new Date(expiryDate) : undefined,
            branchId: (0, branchAuth_middleware_1.getBranchIdForOperation)(req),
            userId,
            reference,
            referenceType,
        });
        await (0, activity_log_middleware_1.logManualActivity)({
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
                quantity: parseInt(quantity),
            },
        });
        res.status(201).json(batch);
    }
    catch (error) {
        console.error('[Create Batch Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to create batch' });
    }
};
exports.createBatchController = createBatchController;
/**
 * Select batches for sale (FIFO/LIFO/AVERAGE)
 */
const selectBatches = async (req, res) => {
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
        const selectedBatches = await (0, batch_service_1.selectBatchesForSale)({
            productId: parseInt(productId),
            organizationId,
            quantity: parseInt(quantity),
            method: method,
            branchId: (0, branchAuth_middleware_1.getBranchIdForOperation)(req),
        });
        res.json(selectedBatches);
    }
    catch (error) {
        console.error('[Select Batches Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to select batches' });
    }
};
exports.selectBatches = selectBatches;

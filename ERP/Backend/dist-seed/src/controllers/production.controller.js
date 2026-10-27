"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reverseProductionRunController = exports.getProductionRun = exports.listProductionRuns = exports.createProductionRun = void 0;
const production_service_1 = require("../services/production.service");
const apiResponse_1 = require("../utils/apiResponse");
const auditLogger_1 = require("../utils/auditLogger");
const createProductionRun = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { branchId, productId, quantity, note, batchNumber, expiryDate } = req.body;
        const userId = parseInt(req.user?.userId);
        if (!branchId || !productId || !quantity) {
            return res.status(400).json((0, apiResponse_1.error)('branchId, productId, and quantity are required'));
        }
        const result = await (0, production_service_1.runProduction)({
            organizationId,
            branchId: parseInt(branchId),
            productId: parseInt(productId),
            quantity: parseFloat(quantity),
            userId,
            note,
            batchNumber,
            expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        });
        await auditLogger_1.auditLogger.inventory(req, {
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
        res.status(201).json((0, apiResponse_1.success)(result));
    }
    catch (err) {
        console.error('[Create Production Run Error]:', err);
        res.status(400).json((0, apiResponse_1.error)(err.message || 'Failed to run production'));
    }
};
exports.createProductionRun = createProductionRun;
const listProductionRuns = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { branchId, productId, startDate, endDate, page = '1', limit = '50' } = req.query;
        const result = await (0, production_service_1.getProductionRuns)(organizationId, branchId ? parseInt(branchId) : undefined, productId ? parseInt(productId) : undefined, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined, parseInt(page), parseInt(limit));
        res.json((0, apiResponse_1.success)(result));
    }
    catch (err) {
        console.error('[List Production Runs Error]:', err);
        res.status(500).json((0, apiResponse_1.error)('Failed to get production runs'));
    }
};
exports.listProductionRuns = listProductionRuns;
const getProductionRun = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const runId = parseInt(req.params.runId);
        const run = await (0, production_service_1.getProductionRunById)(organizationId, runId);
        if (!run) {
            return res.status(404).json((0, apiResponse_1.error)('Production run not found'));
        }
        res.json((0, apiResponse_1.success)(run));
    }
    catch (err) {
        console.error('[Get Production Run Error]:', err);
        res.status(500).json((0, apiResponse_1.error)('Failed to get production run'));
    }
};
exports.getProductionRun = getProductionRun;
const reverseProductionRunController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const runId = parseInt(req.params.runId);
        const { note } = req.body;
        const userId = parseInt(req.user?.userId);
        await (0, production_service_1.reverseProductionRun)(organizationId, runId, userId, note);
        await auditLogger_1.auditLogger.inventory(req, {
            type: 'STOCK_ADJUSTMENT',
            description: `Production run #${runId} reversed`,
            entityType: 'ProductionRun',
            entityId: runId,
        });
        res.json((0, apiResponse_1.success)({ message: 'Production run reversed successfully' }));
    }
    catch (err) {
        console.error('[Reverse Production Run Error]:', err);
        res.status(400).json((0, apiResponse_1.error)(err.message || 'Failed to reverse production run'));
    }
};
exports.reverseProductionRunController = reverseProductionRunController;

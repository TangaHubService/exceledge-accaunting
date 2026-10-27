"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelHeldSaleController = exports.resumeHeldSaleController = exports.getHeldSaleController = exports.listHeldSalesController = exports.createHeldSaleController = void 0;
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const held_sale_service_1 = require("../services/held-sale.service");
const auditLogger_1 = require("../utils/auditLogger");
const createHeldSaleController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.user.userId);
        const branchId = (0, branchAuth_middleware_1.getBranchIdForOperation)(req);
        const { items, customer, shiftId } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required to hold a sale' });
        }
        const heldSale = await (0, held_sale_service_1.createHeldSale)({
            organizationId,
            branchId,
            userId,
            shiftId: shiftId ? parseInt(shiftId) : undefined,
            items,
            customer,
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Sale held as ${heldSale.reference}`,
            entityType: 'HeldSale',
            entityId: heldSale.id,
            metadata: { reference: heldSale.reference, itemCount: heldSale.itemCount },
        });
        res.status(201).json(heldSale);
    }
    catch (error) {
        console.error('[Create Held Sale Error]:', error);
        res.status(400).json({ error: error.message || 'Failed to hold sale' });
    }
};
exports.createHeldSaleController = createHeldSaleController;
const listHeldSalesController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = req.selectedBranchId ?? null;
        const heldSales = await (0, held_sale_service_1.listHeldSales)(organizationId, branchId);
        res.json(heldSales);
    }
    catch (error) {
        console.error('[List Held Sales Error]:', error);
        res.status(500).json({ error: error.message || 'Failed to list held sales' });
    }
};
exports.listHeldSalesController = listHeldSalesController;
const getHeldSaleController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const heldSale = await (0, held_sale_service_1.getHeldSaleById)(id, organizationId);
        res.json(heldSale);
    }
    catch (error) {
        console.error('[Get Held Sale Error]:', error);
        res.status(404).json({ error: error.message || 'Held sale not found' });
    }
};
exports.getHeldSaleController = getHeldSaleController;
const resumeHeldSaleController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const heldSale = await (0, held_sale_service_1.resumeHeldSale)(id, organizationId);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Held sale ${heldSale.reference} resumed`,
            entityType: 'HeldSale',
            entityId: heldSale.id,
        });
        res.json(heldSale);
    }
    catch (error) {
        console.error('[Resume Held Sale Error]:', error);
        res.status(404).json({ error: error.message || 'Failed to resume held sale' });
    }
};
exports.resumeHeldSaleController = resumeHeldSaleController;
const cancelHeldSaleController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        await (0, held_sale_service_1.cancelHeldSale)(id, organizationId);
        await auditLogger_1.auditLogger.sales(req, {
            type: 'OTHER',
            description: `Held sale ${id} cancelled`,
            entityType: 'HeldSale',
            entityId: id,
        });
        res.json({ message: 'Held sale cancelled' });
    }
    catch (error) {
        console.error('[Cancel Held Sale Error]:', error);
        res.status(404).json({ error: error.message || 'Failed to cancel held sale' });
    }
};
exports.cancelHeldSaleController = cancelHeldSaleController;

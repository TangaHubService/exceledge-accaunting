"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkProductionRequirementsController = exports.getBomCost = exports.removeBomComponent = exports.updateBomComponentController = exports.getBomComponent = exports.listBomComponents = exports.addBomComponent = void 0;
const bom_service_1 = require("../services/bom.service");
const apiResponse_1 = require("../utils/apiResponse");
const auditLogger_1 = require("../utils/auditLogger");
const addBomComponent = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const { componentProductId, quantity, unit } = req.body;
        const userId = parseInt(req.user?.userId);
        if (!componentProductId || !quantity || !unit) {
            return res.status(400).json((0, apiResponse_1.error)('componentProductId, quantity, and unit are required'));
        }
        const data = {
            parentProductId,
            componentProductId: parseInt(componentProductId),
            quantity: parseFloat(quantity),
            unit,
        };
        const component = await (0, bom_service_1.createBomComponent)(organizationId, data);
        await auditLogger_1.auditLogger.inventory(req, {
            type: 'PRODUCT_UPDATE',
            description: `BOM component added to product ${parentProductId}: ${component.componentProduct.name} x${quantity} ${unit}`,
            entityType: 'BomComponent',
            entityId: component.id,
            metadata: { component },
        });
        // VSDC §3.3.4.2 — push item composition after local BOM save.
        const { syncBomComponentToRraAsync } = await Promise.resolve().then(() => __importStar(require('../services/rra-branch-sync.service')));
        syncBomComponentToRraAsync(organizationId, parentProductId, data.componentProductId, { userId });
        res.status(201).json((0, apiResponse_1.success)(component));
    }
    catch (err) {
        console.error('[Add BOM Component Error]:', err);
        res.status(400).json((0, apiResponse_1.error)(err.message || 'Failed to add BOM component'));
    }
};
exports.addBomComponent = addBomComponent;
const listBomComponents = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const components = await (0, bom_service_1.getBomComponents)(organizationId, parentProductId);
        res.json((0, apiResponse_1.success)(components));
    }
    catch (err) {
        console.error('[List BOM Components Error]:', err);
        res.status(500).json((0, apiResponse_1.error)('Failed to get BOM components'));
    }
};
exports.listBomComponents = listBomComponents;
const getBomComponent = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const componentProductId = parseInt(req.params.componentId);
        const component = await (0, bom_service_1.getBomComponentById)(organizationId, parentProductId, componentProductId);
        if (!component) {
            return res.status(404).json((0, apiResponse_1.error)('BOM component not found'));
        }
        res.json((0, apiResponse_1.success)(component));
    }
    catch (err) {
        console.error('[Get BOM Component Error]:', err);
        res.status(500).json((0, apiResponse_1.error)('Failed to get BOM component'));
    }
};
exports.getBomComponent = getBomComponent;
const updateBomComponentController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const componentProductId = parseInt(req.params.componentId);
        const { quantity, unit } = req.body;
        const userId = parseInt(req.user?.userId);
        const data = {};
        if (quantity !== undefined)
            data.quantity = parseFloat(quantity);
        if (unit !== undefined)
            data.unit = unit;
        if (Object.keys(data).length === 0) {
            return res.status(400).json((0, apiResponse_1.error)('quantity or unit is required'));
        }
        const component = await (0, bom_service_1.updateBomComponent)(organizationId, parentProductId, componentProductId, data);
        await auditLogger_1.auditLogger.inventory(req, {
            type: 'PRODUCT_UPDATE',
            description: `BOM component updated for product ${parentProductId}: ${component.componentProduct.name}`,
            entityType: 'BomComponent',
            entityId: component.id,
            metadata: { component },
        });
        const { syncBomComponentToRraAsync } = await Promise.resolve().then(() => __importStar(require('../services/rra-branch-sync.service')));
        syncBomComponentToRraAsync(organizationId, parentProductId, componentProductId, { userId });
        res.json((0, apiResponse_1.success)(component));
    }
    catch (err) {
        console.error('[Update BOM Component Error]:', err);
        res.status(400).json((0, apiResponse_1.error)(err.message || 'Failed to update BOM component'));
    }
};
exports.updateBomComponentController = updateBomComponentController;
const removeBomComponent = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const componentProductId = parseInt(req.params.componentId);
        const userId = parseInt(req.user?.userId);
        await (0, bom_service_1.deleteBomComponent)(organizationId, parentProductId, componentProductId);
        await auditLogger_1.auditLogger.inventory(req, {
            type: 'PRODUCT_UPDATE',
            description: `BOM component removed from product ${parentProductId}: component ${componentProductId}`,
            entityType: 'BomComponent',
            entityId: componentProductId,
        });
        res.json((0, apiResponse_1.success)({ message: 'BOM component removed successfully' }));
    }
    catch (err) {
        console.error('[Remove BOM Component Error]:', err);
        res.status(400).json((0, apiResponse_1.error)(err.message || 'Failed to remove BOM component'));
    }
};
exports.removeBomComponent = removeBomComponent;
const getBomCost = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const cost = await (0, bom_service_1.calculateBomCost)(organizationId, parentProductId);
        res.json((0, apiResponse_1.success)(cost));
    }
    catch (err) {
        console.error('[Get BOM Cost Error]:', err);
        res.status(500).json((0, apiResponse_1.error)('Failed to calculate BOM cost'));
    }
};
exports.getBomCost = getBomCost;
const checkProductionRequirementsController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const { quantity, branchId } = req.query;
        if (!quantity || !branchId) {
            return res.status(400).json((0, apiResponse_1.error)('quantity and branchId query parameters are required'));
        }
        const requirements = await (0, bom_service_1.checkProductionRequirements)(organizationId, parentProductId, parseFloat(quantity), parseInt(branchId));
        res.json((0, apiResponse_1.success)(requirements));
    }
    catch (err) {
        console.error('[Check Production Requirements Error]:', err);
        res.status(400).json((0, apiResponse_1.error)(err.message || 'Failed to check production requirements'));
    }
};
exports.checkProductionRequirementsController = checkProductionRequirementsController;

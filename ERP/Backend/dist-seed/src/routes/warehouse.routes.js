"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
router.use(auth_middleware_1.authenticate);
// Get all warehouses
router.get("/:organizationId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { includeInactive } = req.query;
        const where = { organizationId };
        if (includeInactive !== "true") {
            where.isActive = true;
        }
        const warehouses = await prisma_1.prisma.warehouse.findMany({
            where,
            orderBy: { name: "asc" },
        });
        res.json(warehouses);
    }
    catch (e) {
        console.error("[getWarehouses]", e);
        res.status(500).json({ error: "Failed to get warehouses" });
    }
});
// Get single warehouse
router.get("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const warehouse = await prisma_1.prisma.warehouse.findFirst({
            where: { id, organizationId },
        });
        if (!warehouse) {
            return res.status(404).json({ error: "Warehouse not found" });
        }
        res.json(warehouse);
    }
    catch (e) {
        console.error("[getWarehouse]", e);
        res.status(500).json({ error: "Failed to get warehouse" });
    }
});
// Create warehouse (Admin/Manager only)
router.post("/:organizationId", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { name, code, address, isDefault } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: "Warehouse name is required" });
        }
        // Check for duplicate code
        if (code) {
            const existing = await prisma_1.prisma.warehouse.findFirst({
                where: { organizationId, code },
            });
            if (existing) {
                return res.status(400).json({ error: "Warehouse code already exists" });
            }
        }
        // If setting as default, unset other defaults
        if (isDefault) {
            await prisma_1.prisma.warehouse.updateMany({
                where: { organizationId, isDefault: true },
                data: { isDefault: false },
            });
        }
        const warehouse = await prisma_1.prisma.warehouse.create({
            data: {
                name,
                code,
                address,
                isDefault: isDefault || false,
                organizationId,
            },
        });
        res.status(201).json(warehouse);
    }
    catch (e) {
        console.error("[createWarehouse]", e);
        res.status(500).json({ error: "Failed to create warehouse" });
    }
});
// Update warehouse (Admin/Manager only)
router.put("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const { name, code, address, isActive, isDefault } = req.body;
        const existing = await prisma_1.prisma.warehouse.findFirst({
            where: { id, organizationId },
        });
        if (!existing) {
            return res.status(404).json({ error: "Warehouse not found" });
        }
        // Check for duplicate code
        if (code && code !== existing.code) {
            const duplicate = await prisma_1.prisma.warehouse.findFirst({
                where: { organizationId, code, NOT: { id } },
            });
            if (duplicate) {
                return res.status(400).json({ error: "Warehouse code already exists" });
            }
        }
        // If setting as default, unset other defaults
        if (isDefault) {
            await prisma_1.prisma.warehouse.updateMany({
                where: { organizationId, isDefault: true, NOT: { id } },
                data: { isDefault: false },
            });
        }
        const warehouse = await prisma_1.prisma.warehouse.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(code !== undefined && { code }),
                ...(address !== undefined && { address }),
                ...(isActive !== undefined && { isActive }),
                ...(isDefault !== undefined && { isDefault }),
            },
        });
        res.json(warehouse);
    }
    catch (e) {
        console.error("[updateWarehouse]", e);
        res.status(500).json({ error: "Failed to update warehouse" });
    }
});
// Delete warehouse (Admin only) — soft delete
router.delete("/:organizationId/:id", orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), (0, auth_middleware_1.authorize)("ADMIN"), async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const warehouse = await prisma_1.prisma.warehouse.findFirst({
            where: { id, organizationId },
        });
        if (!warehouse) {
            return res.status(404).json({ error: "Warehouse not found" });
        }
        // Block deletion if legacy batches still reference this warehouse
        const batchCount = await prisma_1.prisma.batch.count({
            where: { warehouseId: id },
        });
        if (batchCount > 0) {
            return res.status(400).json({ error: "Cannot delete warehouse with batches" });
        }
        await prisma_1.prisma.warehouse.update({
            where: { id },
            data: { isActive: false },
        });
        res.json({ message: "Warehouse deleted" });
    }
    catch (e) {
        console.error("[deleteWarehouse]", e);
        res.status(500).json({ error: "Failed to delete warehouse" });
    }
});
exports.default = router;

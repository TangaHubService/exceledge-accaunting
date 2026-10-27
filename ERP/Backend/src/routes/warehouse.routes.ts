import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { requireActiveSubscription } from "../middleware/feature-access.middleware";

const router = Router();

const orgAccess = requireOrganizationAccess();

router.use(authenticate);

// Get all warehouses
router.get("/:organizationId", orgAccess, requireActiveSubscription(), async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const { includeInactive } = req.query;

    const where: any = { organizationId };

    if (includeInactive !== "true") {
      where.isActive = true;
    }

    const warehouses = await prisma.warehouse.findMany({
      where,
      orderBy: { name: "asc" },
    });

    res.json(warehouses);
  } catch (e: any) {
    console.error("[getWarehouses]", e);
    res.status(500).json({ error: "Failed to get warehouses" });
  }
});

// Get single warehouse
router.get("/:organizationId/:id", orgAccess, requireActiveSubscription(), async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);

    const warehouse = await prisma.warehouse.findFirst({
      where: { id, organizationId },
    });

    if (!warehouse) {
      return res.status(404).json({ error: "Warehouse not found" });
    }

    res.json(warehouse);
  } catch (e: any) {
    console.error("[getWarehouse]", e);
    res.status(500).json({ error: "Failed to get warehouse" });
  }
});

// Create warehouse (Admin/Manager only)
router.post(
  "/:organizationId",
  orgAccess,
  requireActiveSubscription(),
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  async (req, res) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const { name, code, address, isDefault } = req.body;

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: "Warehouse name is required" });
      }

      // Check for duplicate code
      if (code) {
        const existing = await prisma.warehouse.findFirst({
          where: { organizationId, code },
        });
        if (existing) {
          return res.status(400).json({ error: "Warehouse code already exists" });
        }
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await prisma.warehouse.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const warehouse = await prisma.warehouse.create({
        data: {
          name,
          code,
          address,
          isDefault: isDefault || false,
          organizationId,
        },
      });

      res.status(201).json(warehouse);
    } catch (e: any) {
      console.error("[createWarehouse]", e);
      res.status(500).json({ error: "Failed to create warehouse" });
    }
  }
);

// Update warehouse (Admin/Manager only)
router.put(
  "/:organizationId/:id",
  orgAccess,
  requireActiveSubscription(),
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  async (req, res) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const id = parseInt(req.params.id);
      const { name, code, address, isActive, isDefault } = req.body;

      const existing = await prisma.warehouse.findFirst({
        where: { id, organizationId },
      });

      if (!existing) {
        return res.status(404).json({ error: "Warehouse not found" });
      }

      // Check for duplicate code
      if (code && code !== existing.code) {
        const duplicate = await prisma.warehouse.findFirst({
          where: { organizationId, code, NOT: { id } },
        });
        if (duplicate) {
          return res.status(400).json({ error: "Warehouse code already exists" });
        }
      }

      // If setting as default, unset other defaults
      if (isDefault) {
        await prisma.warehouse.updateMany({
          where: { organizationId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const warehouse = await prisma.warehouse.update({
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
    } catch (e: any) {
      console.error("[updateWarehouse]", e);
      res.status(500).json({ error: "Failed to update warehouse" });
    }
  }
);

// Delete warehouse (Admin only) — soft delete
router.delete(
  "/:organizationId/:id",
  orgAccess,
  requireActiveSubscription(),
  authorize("ADMIN"),
  async (req, res) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const id = parseInt(req.params.id);

      const warehouse = await prisma.warehouse.findFirst({
        where: { id, organizationId },
      });

      if (!warehouse) {
        return res.status(404).json({ error: "Warehouse not found" });
      }

      // Block deletion if legacy batches still reference this warehouse
      const batchCount = await prisma.batch.count({
        where: { warehouseId: id },
      });

      if (batchCount > 0) {
        return res.status(400).json({ error: "Cannot delete warehouse with batches" });
      }

      await prisma.warehouse.update({
        where: { id },
        data: { isActive: false },
      });

      res.json({ message: "Warehouse deleted" });
    } catch (e: any) {
      console.error("[deleteWarehouse]", e);
      res.status(500).json({ error: "Failed to delete warehouse" });
    }
  }
);

export default router;

import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  createBomComponent,
  getBomComponents,
  getBomComponentById,
  updateBomComponent,
  deleteBomComponent,
  calculateBomCost,
  checkProductionRequirements,
  BomComponentInput,
} from '../services/bom.service';
import { success, error as apiError } from '../utils/apiResponse';
import { auditLogger } from '../utils/auditLogger';

export const addBomComponent = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);
    const { componentProductId, quantity, unit } = req.body;
    const userId = parseInt((req as any).user?.userId as string);

    if (!componentProductId || !quantity || !unit) {
      return res.status(400).json(apiError('componentProductId, quantity, and unit are required'));
    }

    const data: BomComponentInput = {
      parentProductId,
      componentProductId: parseInt(componentProductId),
      quantity: parseFloat(quantity),
      unit,
    };

    const component = await createBomComponent(organizationId, data);

    await auditLogger.inventory(req, {
      type: 'PRODUCT_UPDATE',
      description: `BOM component added to product ${parentProductId}: ${component.componentProduct.name} x${quantity} ${unit}`,
      entityType: 'BomComponent',
      entityId: component.id,
      metadata: { component },
    });

    // VSDC §3.3.4.2 — push item composition after local BOM save.
    const { syncBomComponentToRraAsync } = await import('../services/rra-branch-sync.service');
    syncBomComponentToRraAsync(organizationId, parentProductId, data.componentProductId, { userId });

    res.status(201).json(success(component));
  } catch (err: any) {
    console.error('[Add BOM Component Error]:', err);
    res.status(400).json(apiError(err.message || 'Failed to add BOM component'));
  }
};

export const listBomComponents = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);

    const components = await getBomComponents(organizationId, parentProductId);
    res.json(success(components));
  } catch (err: any) {
    console.error('[List BOM Components Error]:', err);
    res.status(500).json(apiError('Failed to get BOM components'));
  }
};

export const getBomComponent = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);
    const componentProductId = parseInt(req.params.componentId);

    const component = await getBomComponentById(organizationId, parentProductId, componentProductId);
    if (!component) {
      return res.status(404).json(apiError('BOM component not found'));
    }
    res.json(success(component));
  } catch (err: any) {
    console.error('[Get BOM Component Error]:', err);
    res.status(500).json(apiError('Failed to get BOM component'));
  }
};

export const updateBomComponentController = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);
    const componentProductId = parseInt(req.params.componentId);
    const { quantity, unit } = req.body;
    const userId = parseInt((req as any).user?.userId as string);

    const data: { quantity?: number; unit?: string } = {};
    if (quantity !== undefined) data.quantity = parseFloat(quantity);
    if (unit !== undefined) data.unit = unit;

    if (Object.keys(data).length === 0) {
      return res.status(400).json(apiError('quantity or unit is required'));
    }

    const component = await updateBomComponent(organizationId, parentProductId, componentProductId, data);

    await auditLogger.inventory(req, {
      type: 'PRODUCT_UPDATE',
      description: `BOM component updated for product ${parentProductId}: ${component.componentProduct.name}`,
      entityType: 'BomComponent',
      entityId: component.id,
      metadata: { component },
    });

    const { syncBomComponentToRraAsync } = await import('../services/rra-branch-sync.service');
    syncBomComponentToRraAsync(organizationId, parentProductId, componentProductId, { userId });

    res.json(success(component));
  } catch (err: any) {
    console.error('[Update BOM Component Error]:', err);
    res.status(400).json(apiError(err.message || 'Failed to update BOM component'));
  }
};

export const removeBomComponent = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);
    const componentProductId = parseInt(req.params.componentId);
    const userId = parseInt((req as any).user?.userId as string);

    await deleteBomComponent(organizationId, parentProductId, componentProductId);

    await auditLogger.inventory(req, {
      type: 'PRODUCT_UPDATE',
      description: `BOM component removed from product ${parentProductId}: component ${componentProductId}`,
      entityType: 'BomComponent',
      entityId: componentProductId,
    });

    res.json(success({ message: 'BOM component removed successfully' }));
  } catch (err: any) {
    console.error('[Remove BOM Component Error]:', err);
    res.status(400).json(apiError(err.message || 'Failed to remove BOM component'));
  }
};

export const getBomCost = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);

    const cost = await calculateBomCost(organizationId, parentProductId);
    res.json(success(cost));
  } catch (err: any) {
    console.error('[Get BOM Cost Error]:', err);
    res.status(500).json(apiError('Failed to calculate BOM cost'));
  }
};

export const checkProductionRequirementsController = async (req: Request, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const parentProductId = parseInt(req.params.productId);
    const { quantity, branchId } = req.query;

    if (!quantity || !branchId) {
      return res.status(400).json(apiError('quantity and branchId query parameters are required'));
    }

    const requirements = await checkProductionRequirements(
      organizationId,
      parentProductId,
      parseFloat(quantity as string),
      parseInt(branchId as string),
    );

    res.json(success(requirements));
  } catch (err: any) {
    console.error('[Check Production Requirements Error]:', err);
    res.status(400).json(apiError(err.message || 'Failed to check production requirements'));
  }
};
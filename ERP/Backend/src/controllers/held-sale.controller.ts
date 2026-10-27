import type { Response } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { getBranchIdForOperation } from '../middleware/branchAuth.middleware';
import {
  createHeldSale,
  listHeldSales,
  getHeldSaleById,
  resumeHeldSale,
  cancelHeldSale,
} from '../services/held-sale.service';
import { auditLogger } from '../utils/auditLogger';

export const createHeldSaleController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const userId = parseInt(req.user!.userId);
    const branchId = getBranchIdForOperation(req);
    const { items, customer, shiftId } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required to hold a sale' });
    }

    const heldSale = await createHeldSale({
      organizationId,
      branchId,
      userId,
      shiftId: shiftId ? parseInt(shiftId) : undefined,
      items,
      customer,
    });

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Sale held as ${heldSale.reference}`,
      entityType: 'HeldSale',
      entityId: heldSale.id,
      metadata: { reference: heldSale.reference, itemCount: heldSale.itemCount },
    });

    res.status(201).json(heldSale);
  } catch (error: any) {
    console.error('[Create Held Sale Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to hold sale' });
  }
};

export const listHeldSalesController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const branchId = req.selectedBranchId ?? null;

    const heldSales = await listHeldSales(organizationId, branchId);
    res.json(heldSales);
  } catch (error: any) {
    console.error('[List Held Sales Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to list held sales' });
  }
};

export const getHeldSaleController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);

    const heldSale = await getHeldSaleById(id, organizationId);
    res.json(heldSale);
  } catch (error: any) {
    console.error('[Get Held Sale Error]:', error);
    res.status(404).json({ error: error.message || 'Held sale not found' });
  }
};

export const resumeHeldSaleController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);

    const heldSale = await resumeHeldSale(id, organizationId);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Held sale ${heldSale.reference} resumed`,
      entityType: 'HeldSale',
      entityId: heldSale.id,
    });

    res.json(heldSale);
  } catch (error: any) {
    console.error('[Resume Held Sale Error]:', error);
    res.status(404).json({ error: error.message || 'Failed to resume held sale' });
  }
};

export const cancelHeldSaleController = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);

    await cancelHeldSale(id, organizationId);

    await auditLogger.sales(req, {
      type: 'OTHER',
      description: `Held sale ${id} cancelled`,
      entityType: 'HeldSale',
      entityId: id,
    });

    res.json({ message: 'Held sale cancelled' });
  } catch (error: any) {
    console.error('[Cancel Held Sale Error]:', error);
    res.status(404).json({ error: error.message || 'Failed to cancel held sale' });
  }
};

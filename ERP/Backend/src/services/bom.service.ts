import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getCurrentStockInTransaction } from './inventory-ledger.service';

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export interface BomComponentInput {
  parentProductId: number;
  componentProductId: number;
  quantity: number;
  unit: string;
}

export interface BomComponentWithDetails {
  id: number;
  parentProductId: number;
  componentProductId: number;
  quantity: Prisma.Decimal;
  unit: string;
  createdAt: Date;
  updatedAt: Date;
  componentProduct: {
    id: number;
    name: string;
    sku: string | null;
    barcode: string | null;
    itemType: ItemType;
    measurementUnit: string;
    unitPrice: Prisma.Decimal;
    quantity: number;
  };
}

export async function validateBomComponent(
  tx: PrismaClientOrTx,
  organizationId: number,
  parentProductId: number,
  componentProductId: number,
): Promise<{ parent: any; component: any }> {
  const [parent, component] = await Promise.all([
    tx.product.findFirst({
      where: { id: parentProductId, organizationId, deletedAt: null },
    }),
    tx.product.findFirst({
      where: { id: componentProductId, organizationId, deletedAt: null },
    }),
  ]);

  if (!parent) {
    throw new Error(`Parent product ${parentProductId} not found`);
  }
  if (!component) {
    throw new Error(`Component product ${componentProductId} not found`);
  }
  if (parent.itemType !== 'PRODUCT') {
    throw new Error('Parent product must be a Finished Product (itemType = PRODUCT)');
  }
  if (component.itemType !== 'RAW_MATERIAL') {
    throw new Error('Component product must be a Raw Material (itemType = RAW_MATERIAL)');
  }
  if (parent.id === component.id) {
    throw new Error('A product cannot be a component of itself');
  }

  return { parent, component };
}

export async function createBomComponent(
  organizationId: number,
  data: BomComponentInput,
  tx?: PrismaClientOrTx,
): Promise<BomComponentWithDetails> {
  const client = tx ?? prisma;

  await validateBomComponent(client, organizationId, data.parentProductId, data.componentProductId);

  const existing = await client.bomComponent.findUnique({
    where: {
      parentProductId_componentProductId: {
        parentProductId: data.parentProductId,
        componentProductId: data.componentProductId,
      },
    },
  });

  if (existing) {
    throw new Error('This raw material is already a component of this finished product');
  }

  const bomComponent = await client.bomComponent.create({
    data: {
      parentProductId: data.parentProductId,
      componentProductId: data.componentProductId,
      quantity: data.quantity,
      unit: data.unit,
      organizationId,
    },
    include: {
      componentProduct: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          itemType: true,
          measurementUnit: true,
          unitPrice: true,
          quantity: true,
        },
      },
    },
  });

  return bomComponent as any;
}

export async function getBomComponents(
  organizationId: number,
  parentProductId: number,
): Promise<BomComponentWithDetails[]> {
  const components = await prisma.bomComponent.findMany({
    where: {
      parentProductId,
      organizationId,
    },
    include: {
      componentProduct: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          itemType: true,
          measurementUnit: true,
          unitPrice: true,
          quantity: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return components as any;
}

export async function getBomComponentById(
  organizationId: number,
  parentProductId: number,
  componentProductId: number,
): Promise<BomComponentWithDetails | null> {
  const component = await prisma.bomComponent.findUnique({
    where: {
      parentProductId_componentProductId: {
        parentProductId,
        componentProductId,
      },
    },
    include: {
      componentProduct: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          itemType: true,
          measurementUnit: true,
          unitPrice: true,
          quantity: true,
        },
      },
    },
  });

  if (!component || component.organizationId !== organizationId) {
    return null;
  }

  return component as any;
}

export async function updateBomComponent(
  organizationId: number,
  parentProductId: number,
  componentProductId: number,
  data: { quantity?: number; unit?: string },
  tx?: PrismaClientOrTx,
): Promise<BomComponentWithDetails> {
  const client = tx ?? prisma;

  const existing = await client.bomComponent.findUnique({
    where: {
      parentProductId_componentProductId: {
        parentProductId,
        componentProductId,
      },
    },
  });

  if (!existing || existing.organizationId !== organizationId) {
    throw new Error('BOM component not found');
  }

  const updated = await client.bomComponent.update({
    where: {
      parentProductId_componentProductId: {
        parentProductId,
        componentProductId,
      },
    },
    data,
    include: {
      componentProduct: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          itemType: true,
          measurementUnit: true,
          unitPrice: true,
          quantity: true,
        },
      },
    },
  });

  return updated as any;
}

export async function deleteBomComponent(
  organizationId: number,
  parentProductId: number,
  componentProductId: number,
  tx?: PrismaClientOrTx,
): Promise<void> {
  const client = tx ?? prisma;

  const existing = await client.bomComponent.findUnique({
    where: {
      parentProductId_componentProductId: {
        parentProductId,
        componentProductId,
      },
    },
  });

  if (!existing || existing.organizationId !== organizationId) {
    throw new Error('BOM component not found');
  }

  await client.bomComponent.delete({
    where: {
      parentProductId_componentProductId: {
        parentProductId,
        componentProductId,
      },
    },
  });
}

export async function calculateBomCost(
  organizationId: number,
  parentProductId: number,
  tx?: PrismaClientOrTx,
): Promise<{ totalCost: number; components: Array<{ componentId: number; name: string; quantity: number; unitCost: number; totalCost: number }> }> {
  const client = tx ?? prisma;

  const components = await client.bomComponent.findMany({
    where: {
      parentProductId,
      organizationId,
    },
    include: {
      componentProduct: {
        select: {
          id: true,
          name: true,
          purchasePrice: true,
          unitPrice: true,
        },
      },
    },
  });

  let totalCost = 0;
  const componentCosts = [];

  for (const comp of components) {
    const unitCost = Number(comp.componentProduct.purchasePrice ?? comp.componentProduct.unitPrice ?? 0);
    const quantity = Number(comp.quantity);
    const compTotalCost = unitCost * quantity;
    totalCost += compTotalCost;
    componentCosts.push({
      componentId: comp.componentProductId,
      name: comp.componentProduct.name,
      quantity,
      unitCost,
      totalCost: compTotalCost,
    });
  }

  return { totalCost, components: componentCosts };
}

export interface ProductionRequirements {
  parentProductId: number;
  quantityToProduce: number;
  branchId: number;
  organizationId: number;
  components: Array<{
    componentProductId: number;
    componentName: string;
    requiredQuantity: number;
    requiredUnit: string;
    availableStock: number;
    unitCost: number;
    batchId?: number;
  }>;
  canProduce: boolean;
  limitingComponent?: {
    componentProductId: number;
    componentName: string;
    availableStock: number;
    requiredQuantity: number;
  };
}

export async function checkProductionRequirements(
  organizationId: number,
  parentProductId: number,
  quantityToProduce: number,
  branchId: number,
  tx?: PrismaClientOrTx,
): Promise<ProductionRequirements> {
  const client = tx ?? prisma;

  const parentProduct = await client.product.findFirst({
    where: { id: parentProductId, organizationId, deletedAt: null },
  });

  if (!parentProduct) {
    throw new Error('Parent product not found');
  }
  if (parentProduct.itemType !== 'PRODUCT') {
    throw new Error('Only Finished Products can be produced');
  }

  const bomComponents = await client.bomComponent.findMany({
    where: {
      parentProductId,
      organizationId,
    },
    include: {
      componentProduct: {
        select: {
          id: true,
          name: true,
          purchasePrice: true,
          unitPrice: true,
          measurementUnit: true,
        },
      },
    },
  });

  if (bomComponents.length === 0) {
    throw new Error('No BOM defined for this product. Add components first.');
  }

  const components = [];
  let canProduce = true;
  let limitingComponent = undefined;

  for (const comp of bomComponents) {
    const requiredQuantity = Number(comp.quantity) * quantityToProduce;
    const unitCost = Number(comp.componentProduct.purchasePrice ?? comp.componentProduct.unitPrice ?? 0);

    const availableStock = await getCurrentStockInTransaction(
      client,
      organizationId,
      comp.componentProductId,
      branchId,
    );

    const componentData = {
      componentProductId: comp.componentProductId,
      componentName: comp.componentProduct.name,
      requiredQuantity,
      requiredUnit: comp.unit,
      availableStock,
      unitCost,
    };

    components.push(componentData);

    if (availableStock < requiredQuantity) {
      canProduce = false;
      if (!limitingComponent || availableStock < limitingComponent.availableStock) {
        limitingComponent = {
          componentProductId: comp.componentProductId,
          componentName: comp.componentProduct.name,
          availableStock,
          requiredQuantity,
        };
      }
    }
  }

  return {
    parentProductId,
    quantityToProduce,
    branchId,
    organizationId,
    components,
    canProduce,
    limitingComponent,
  };
}
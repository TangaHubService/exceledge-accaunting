"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBomComponent = validateBomComponent;
exports.createBomComponent = createBomComponent;
exports.getBomComponents = getBomComponents;
exports.getBomComponentById = getBomComponentById;
exports.updateBomComponent = updateBomComponent;
exports.deleteBomComponent = deleteBomComponent;
exports.calculateBomCost = calculateBomCost;
exports.checkProductionRequirements = checkProductionRequirements;
const prisma_1 = require("../lib/prisma");
const inventory_ledger_service_1 = require("./inventory-ledger.service");
async function validateBomComponent(tx, organizationId, parentProductId, componentProductId) {
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
async function createBomComponent(organizationId, data, tx) {
    const client = tx ?? prisma_1.prisma;
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
    return bomComponent;
}
async function getBomComponents(organizationId, parentProductId) {
    const components = await prisma_1.prisma.bomComponent.findMany({
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
    return components;
}
async function getBomComponentById(organizationId, parentProductId, componentProductId) {
    const component = await prisma_1.prisma.bomComponent.findUnique({
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
    return component;
}
async function updateBomComponent(organizationId, parentProductId, componentProductId, data, tx) {
    const client = tx ?? prisma_1.prisma;
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
    return updated;
}
async function deleteBomComponent(organizationId, parentProductId, componentProductId, tx) {
    const client = tx ?? prisma_1.prisma;
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
async function calculateBomCost(organizationId, parentProductId, tx) {
    const client = tx ?? prisma_1.prisma;
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
async function checkProductionRequirements(organizationId, parentProductId, quantityToProduce, branchId, tx) {
    const client = tx ?? prisma_1.prisma;
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
        const availableStock = await (0, inventory_ledger_service_1.getCurrentStockInTransaction)(client, organizationId, comp.componentProductId, branchId);
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

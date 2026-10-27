"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHeldSale = createHeldSale;
exports.listHeldSales = listHeldSales;
exports.getHeldSaleById = getHeldSaleById;
exports.resumeHeldSale = resumeHeldSale;
exports.cancelHeldSale = cancelHeldSale;
const prisma_1 = require("../lib/prisma");
async function generateReference(branchId) {
    const count = await prisma_1.prisma.heldSale.count({ where: { branchId } });
    return `HS-${String(count + 1).padStart(6, '0')}`;
}
async function createHeldSale(params) {
    const { organizationId, branchId, userId, shiftId, items, customer } = params;
    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice - (item.discount ?? 0), 0);
    return prisma_1.prisma.heldSale.create({
        data: {
            organizationId,
            branchId,
            userId,
            shiftId,
            reference: await generateReference(branchId),
            cartSnapshot: items,
            customerSnapshot: customer,
            itemCount: items.length,
            totalAmount,
        },
    });
}
async function listHeldSales(organizationId, branchId, userId) {
    return prisma_1.prisma.heldSale.findMany({
        where: {
            organizationId,
            ...(branchId ? { branchId } : {}),
            ...(userId ? { userId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
    });
}
async function getHeldSaleById(id, organizationId) {
    const heldSale = await prisma_1.prisma.heldSale.findFirst({ where: { id, organizationId } });
    if (!heldSale)
        throw new Error('Held sale not found');
    return heldSale;
}
/** Resuming just hands the cart snapshot back to the client and removes the hold; the client re-enters the normal sale flow. */
async function resumeHeldSale(id, organizationId) {
    const heldSale = await getHeldSaleById(id, organizationId);
    await prisma_1.prisma.heldSale.delete({ where: { id } });
    return heldSale;
}
async function cancelHeldSale(id, organizationId) {
    await getHeldSaleById(id, organizationId);
    await prisma_1.prisma.heldSale.delete({ where: { id } });
}

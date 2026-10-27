import { prisma } from '../lib/prisma';

export interface HeldSaleItemInput {
  productId?: number;
  quantity: number;
  unitPrice: number;
  discount?: number;
  [key: string]: unknown;
}

export interface CreateHeldSaleParams {
  organizationId: number;
  branchId: number;
  userId: number;
  shiftId?: number;
  items: HeldSaleItemInput[];
  customer?: Record<string, unknown>;
}

async function generateReference(branchId: number): Promise<string> {
  const count = await prisma.heldSale.count({ where: { branchId } });
  return `HS-${String(count + 1).padStart(6, '0')}`;
}

export async function createHeldSale(params: CreateHeldSaleParams) {
  const { organizationId, branchId, userId, shiftId, items, customer } = params;

  const totalAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice - (item.discount ?? 0),
    0
  );

  return prisma.heldSale.create({
    data: {
      organizationId,
      branchId,
      userId,
      shiftId,
      reference: await generateReference(branchId),
      cartSnapshot: items as any,
      customerSnapshot: customer as any,
      itemCount: items.length,
      totalAmount,
    },
  });
}

export async function listHeldSales(organizationId: number, branchId: number | null, userId?: number) {
  return prisma.heldSale.findMany({
    where: {
      organizationId,
      ...(branchId ? { branchId } : {}),
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  });
}

export async function getHeldSaleById(id: number, organizationId: number) {
  const heldSale = await prisma.heldSale.findFirst({ where: { id, organizationId } });
  if (!heldSale) throw new Error('Held sale not found');
  return heldSale;
}

/** Resuming just hands the cart snapshot back to the client and removes the hold; the client re-enters the normal sale flow. */
export async function resumeHeldSale(id: number, organizationId: number) {
  const heldSale = await getHeldSaleById(id, organizationId);
  await prisma.heldSale.delete({ where: { id } });
  return heldSale;
}

export async function cancelHeldSale(id: number, organizationId: number) {
  await getHeldSaleById(id, organizationId);
  await prisma.heldSale.delete({ where: { id } });
}

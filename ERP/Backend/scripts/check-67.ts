import { PrismaClient } from '@prisma/client';
import { buildRraSendReceiptPayload } from '../src/services/rra-ebm.service';

const prisma = new PrismaClient();
async function main() {
  const sale = await prisma.sale.findUnique({
    where: { id: 67 },
    include: { saleItems: { include: { product: true } }, customer: true, user: true, branch: true },
  });
  const org = await prisma.organization.findUnique({ where: { id: 2 }, select: { TIN: true, name: true, address: true } });
  if (!sale || !org) { console.log('missing'); return; }
  const p = buildRraSendReceiptPayload(sale as any, org as any, '01');
  console.log('custTin:', p.custTin);
  console.log('prcOrdCd:', p.prcOrdCd);
  await prisma.$disconnect();
}
main();

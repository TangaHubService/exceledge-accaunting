import { PrismaClient } from '@prisma/client';
import { buildRraSendReceiptPayload } from '../src/services/rra-ebm.service';

const prisma = new PrismaClient();
async function main() {
  for (const saleId of [61, 65, 63]) {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId },
      include: { saleItems: { include: { product: true } }, customer: true, user: true, branch: true },
    });
    const org = await prisma.organization.findUnique({ where: { id: 2 }, select: { TIN: true, name: true, address: true } });
    if (!sale || !org) { console.log('missing', saleId); continue; }
    const p = buildRraSendReceiptPayload(sale as any, org as any);
    console.log('SALE', saleId, JSON.stringify({salesTyCd:p.salesTyCd,rcptTyCd:p.rcptTyCd,salesSttsCd:p.salesSttsCd,custTin:p.custTin,pmtTyCd:p.pmtTyCd,prcOrdCd:p.prcOrdCd,invcNo:p.invcNo}));
  }
  await prisma.$disconnect();
}
main();

import { PrismaClient } from '@prisma/client';
import { buildRraSendReceiptPayload } from '../src/services/rra-ebm.service';

const prisma = new PrismaClient();
async function main() {
  const saleId = parseInt(process.argv[2] || '61');
  const prcOrdOverride = process.argv[3];
  const sale = await prisma.sale.findFirst({
    where: { id: saleId },
    include: { saleItems: { include: { product: true } }, customer: true, user: true, branch: true },
  });
  const org = await prisma.organization.findUnique({ where: { id: 2 }, select: { TIN: true, name: true, address: true } });
  if (!sale || !org) { console.log('missing'); return; }
  const p = buildRraSendReceiptPayload(sale as any, org as any, '01');
  p.custTin = prcOrdOverride ? p.custTin : '100000001';
  p.prcOrdCd = prcOrdOverride ?? '010301';
  (p.receipt as any).custTin = p.custTin;
  const envelope = { tin: '999945560', bhfId: '00', dvcSrlNo: 'excelwartest' };
  const body = { ...envelope, ...p };
  const url = 'http://localhost:8085/trnsSales/saveSales';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log('HTTP', res.status);
  console.log((await res.text()).slice(0, 1000));
  await prisma.$disconnect();
}
main();

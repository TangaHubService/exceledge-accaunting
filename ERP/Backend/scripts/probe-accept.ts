import { PrismaClient } from '@prisma/client';
import { buildRraSendReceiptPayload } from '../src/services/rra-ebm.service';

const prisma = new PrismaClient();
async function main() {
  const sale = await prisma.sale.findFirst({
    where: { id: 68 },
    include: { saleItems: { include: { product: true } }, customer: true, user: true, branch: true },
  });
  const org = await prisma.organization.findUnique({ where: { id: 2 }, select: { TIN: true, name: true, address: true } });
  if (!sale || !org) { console.log('no sale'); return; }
  const invc = 9100 + Math.floor(Math.random()*900);
  const p = buildRraSendReceiptPayload(sale as any, org as any, '01', { invcNoOverride: invc });
  p.prcOrdCd = '000000';
  (p.receipt as any).custTin = '100000004';
  (p.receipt as any).prchrAcptcYn = process.argv[2] ?? 'Y';
  const body = { tin: '999945560', bhfId: '00', dvcSrlNo: 'excelwartest', ...p };
  const res = await fetch('http://localhost:8085/trnsSales/saveSales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await res.text();
  console.log(`prchrAcptcYn=${(p.receipt as any).prchrAcptcYn}:`, t.slice(0, 160));
  await prisma.$disconnect();
}
main();

import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const outbox = await p.ebmOutbox.findMany({
    where: { operation: 'SALE' },
    orderBy: { id: 'desc' },
    take: 15,
    select: { id: true, saleId: true, status: true, retryCount: true, lastError: true, nextAttemptAt: true },
  });
  console.log('=== EbmOutbox (recent SALE) ===');
  for (const r of outbox) console.log(`#${r.id} sale=${r.saleId} ${r.status} retry=${r.retryCount} next=${r.nextAttemptAt?.toISOString()} err=${r.lastError ?? ''}`);
  const free = await p.organizationPurchaseCode.findMany({ where: { organizationId: 2, consumed: false } });
  console.log('=== Pool free codes ===');
  console.log(free.length === 0 ? '(none)' : free.map(r => r.code).join(','));
  await p.$disconnect();
}
main();

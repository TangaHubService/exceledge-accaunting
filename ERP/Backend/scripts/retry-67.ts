import { PrismaClient } from '@prisma/client';
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service';

const prisma = new PrismaClient();
(async () => {
  await prisma.ebmOutbox.update({ where: { id: 52 }, data: { status: 'FAILED', retryCount: 0, nextAttemptAt: new Date(), lastError: null } });
  const res = await processEbmOutboxBatch(10);
  console.log('RESULT:', JSON.stringify(res));
  const row = await prisma.ebmOutbox.findUnique({ where: { id: 52 }, select: { status: true, lastError: true } });
  console.log('row52 now:', JSON.stringify(row));
  await prisma.$disconnect();
})();

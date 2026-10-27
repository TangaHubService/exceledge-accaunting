import { PrismaClient } from '@prisma/client';
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service';
import { generateInvoiceNumber } from '../src/services/rra-ebm.service';

const prisma = new PrismaClient();
(async () => {
  const sale = await prisma.sale.findUnique({ where: { id: 61 }, select: { id: true, vsdcInvcNo: true, branchId: true, organizationId: true } });
  if (sale) {
    const fresh = await generateInvoiceNumber(sale.organizationId, sale.branchId);
    await prisma.sale.update({
      where: { id: sale.id },
      data: { vsdcInvcNo: fresh.vsdcInvcNo, invoiceNumber: fresh.invoiceNumber },
    });
    console.log(`Sale 61 re-issued: vsdcInvcNo ${sale.vsdcInvcNo} -> ${fresh.vsdcInvcNo} (${fresh.invoiceNumber})`);
  }
  await prisma.ebmOutbox.updateMany({
    where: { id: { in: [46, 48, 49, 50, 51] } },
    data: { status: 'FAILED', retryCount: 0, nextAttemptAt: new Date(), lastError: null },
  });
  console.log('Reset 46,48,49,50,51 to retryable. Running batch...');
  const res = await processEbmOutboxBatch(50);
  console.log('RESULT:', JSON.stringify(res, null, 2));
  await prisma.$disconnect();
})();

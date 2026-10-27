/**
 * End-to-end RRA compliance run through the REAL stack against the live
 * sandbox WAR (http://localhost:8085):
 * commitSale -> EBM outbox -> /trnsSales/saveSales -> EbmTransaction ->
 * invoice payload -> PDF/HTML renderers, plus refund / void / copy /
 * proforma / failure paths. Mutates dev DB org 2; restores flags afterwards.
 * Run: npx tsx scripts/e2e-compliance.ts
 */
import { prisma } from '../src/lib/prisma';
import { commitSale } from '../src/services/sale-commit.service';
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service';
import { refundSale, cancelSale, reprintSaleReceipt, composeInvoicePayload } from '../src/controllers/sales.controller';
import { renderSalesInvoiceHtml } from '../src/services/invoice-render.service';
import { generateEbmInvoicePdf } from '../src/services/invoice-pdf.service';
import { generateEbmReceiptPdf80mm } from '../src/services/invoice-receipt-pdf.service';
import { generateValidPurchaseCodes } from '../src/services/purchase-code.checksum';

const ORG = 2, BRANCH = 3, USER = 4, PRODUCT = 25;
const req: any = { user: { userId: String(USER) }, params: { organizationId: String(ORG) }, ip: '127.0.0.1', headers: {} };
let pass = 0, fail = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { pass++; console.log(`PASS ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''}`); }
}
const mockRes: any = () => {
  const r: any = { statusCode: 200 };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
};

async function lastTx(saleId: number) {
  return prisma.ebmTransaction.findFirst({ where: { saleId }, orderBy: { createdAt: 'desc' } });
}

async function drainOutbox(times = 3) {
  // Mirrors the cron firing later: make every due-or-waiting row eligible,
  // then run the worker. Retries transient failures (e.g. pool top-up) to
  // success within the same run.
  for (let i = 0; i < times; i++) {
    await prisma.ebmOutbox.updateMany({ data: { nextAttemptAt: new Date() } });
    await processEbmOutboxBatch(10);
  }
}

async function waitForOutbox(saleId: number, op: string, timeoutMs = 60000) {
  // Controllers fire the worker fire-and-forget alongside our drains; poll
  // until the row reaches a terminal state instead of assuming one pass.
  const t0 = Date.now();
  for (;;) {
    await prisma.ebmOutbox.updateMany({
      where: { saleId, operation: op as any, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { gt: new Date() } },
      data: { nextAttemptAt: new Date() },
    });
    await processEbmOutboxBatch(10);
    const row = await prisma.ebmOutbox.findFirst({ where: { saleId, operation: op as any }, orderBy: { createdAt: 'desc' } });
    if (row && (row.status === 'SUCCEEDED' || row.status === 'DEAD_LETTER')) return row;
    if (Date.now() - t0 > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 500));
  }
}
async function outboxStatus(saleId: number, op: string) {
  return prisma.ebmOutbox.findFirst({ where: { saleId, operation: op as any }, orderBy: { createdAt: 'desc' } });
}

async function main() {
  // ── setup ──
  const orgBefore = await prisma.organization.findUnique({ where: { id: ORG }, select: { trainingMode: true } });
  const brBefore = await prisma.branch.findUnique({ where: { id: BRANCH }, select: { ebmSerialNo: true, ebmDeviceId: true } });
  const restore = async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: orgBefore?.trainingMode ?? true } });
    await prisma.branch.update({ where: { id: BRANCH }, data: { ebmSerialNo: brBefore?.ebmSerialNo ?? null, ebmDeviceId: brBefore?.ebmDeviceId ?? null } });
  };
  try {
  await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: false } });
  await prisma.branch.update({ where: { id: BRANCH }, data: { ebmSerialNo: 'WIS01029467', ebmDeviceId: 'SDC012000250' } });

  const walkin = await prisma.customer.create({
    data: { organizationId: ORG, name: 'E2E Walk-in', phone: '+250788111111', customerType: 'INDIVIDUAL' },
  });
  const walkTin = `1${String(walkin.id).padStart(8, '0')}`.slice(0, 9);
  const existingPool = await prisma.organizationPurchaseCode.findMany({
    where: { organizationId: ORG },
    select: { code: true },
  });
  const codes = generateValidPurchaseCodes(walkTin, '999945560', 12, new Set(existingPool.map((r) => r.code)));
  await prisma.organizationPurchaseCode.createMany({
    data: codes.map((code) => ({ organizationId: ORG, code, buyerTin: walkTin })),
    skipDuplicates: true,
  });
  const corp = await prisma.customer.create({
    data: { organizationId: ORG, name: 'E2E Corp Ltd', phone: '+250788222222', customerType: 'CORPORATE', TIN: '100000002' },
  });

  const item = { productId: PRODUCT, quantity: 1, unitPrice: 200, itemType: 'PRODUCT' as const };

  // ── 1. normal sales: CASH / MOBILE_MONEY / CREDIT_CARD / DEBT ──
  const payCases = [
    { paymentType: 'CASH', cashAmount: 200, debtAmount: 0, want: '01' },
    { paymentType: 'MOBILE_MONEY', cashAmount: 200, debtAmount: 0, want: '06' },
    { paymentType: 'CREDIT_CARD', cashAmount: 200, debtAmount: 0, want: '05' },
    { paymentType: 'DEBT', cashAmount: 0, debtAmount: 200, want: '02' },
  ];
  const saleIds: number[] = [];
  for (const c of payCases) {
    const { completeSale, fiscalization } = await commitSale({
      organizationId: ORG, branchId: BRANCH, userId: USER, customerId: walkin.id,
      items: [item], paymentType: c.paymentType, cashAmount: c.cashAmount,
      debtAmount: c.debtAmount, insuranceAmount: 0, req,
    });
    saleIds.push(completeSale.id);
    await drainOutbox();
    const tx = await lastTx(completeSale.id);
    const ob = await outboxStatus(completeSale.id, 'SALE');
    check(`${c.paymentType} fiscalized`, fiscalization.status === 'success' && ob?.status === 'SUCCEEDED', { sale: completeSale.id, invc: completeSale.vsdcInvcNo, rcpt: tx?.sdcRcptNo, status: fiscalization.status });
    const sent = (tx?.responseData as any)?.requestPayload;
    check(`${c.paymentType} pmtTyCd=${c.want}`, sent?.pmtTyCd === c.want, sent?.pmtTyCd);
    check(`${c.paymentType} SDC fields persisted`, !!(tx?.sdcRcptNo && tx?.totalRcptNo && tx?.sdcId && tx?.internalData && tx?.receiptSignature && tx?.ebmInvoiceNumber), { rcpt: tx?.sdcRcptNo, tot: tx?.totalRcptNo, sdc: tx?.sdcId });
    check(`${c.paymentType} salesTyCd/rcptTyCd/stts`, sent?.salesTyCd === 'N' && sent?.rcptTyCd === 'S' && sent?.salesSttsCd === '02');
  }

  // ── 2. corporate sale with TIN ──
  const corpSale = await commitSale({
    organizationId: ORG, branchId: BRANCH, userId: USER, customerId: corp.id,
    items: [item], paymentType: 'CASH', cashAmount: 200, debtAmount: 0, insuranceAmount: 0, req,
  });
  await drainOutbox();
  const corpTx = await lastTx(corpSale.completeSale.id);
  check('corporate sale fiscalized with real TIN', corpTx?.submissionStatus === 'SUCCESS' && (corpTx?.responseData as any)?.requestPayload?.custTin === '100000002');

  // ── 3. corporate without TIN blocked ──
  const badCorp = await prisma.customer.create({
    data: { organizationId: ORG, name: 'E2E NoTin Ltd', customerType: 'CORPORATE' },
  });
  let blocked = '';
  try {
    await commitSale({
      organizationId: ORG, branchId: BRANCH, userId: USER, customerId: badCorp.id,
      items: [item], paymentType: 'CASH', cashAmount: 200, debtAmount: 0, insuranceAmount: 0, req,
    });
  } catch (e: any) { blocked = e.message; }
  check('corporate without TIN blocked at checkout', /no valid 9-digit RRA TIN/.test(blocked), blocked);
  await prisma.customer.delete({ where: { id: badCorp.id } });

  // ── 4. refund with RRA reason code ──
  const rres = mockRes();
  await refundSale({ ...req, params: { id: String(saleIds[0]), organizationId: String(ORG) }, body: { reason: 'Wrong amount charged', rfdRsnCd: '09' } } as any, rres);
  await waitForOutbox(rres.body?.data?.refundSale?.id ?? -1, 'REFUND');
  const refundId = rres.body?.data?.refundSale?.id;
  const rtx = refundId ? await lastTx(refundId) : null;
  const rsent = (rtx?.responseData as any)?.requestPayload;
  const origInvc = (await prisma.sale.findUnique({ where: { id: saleIds[0] }, select: { vsdcInvcNo: true } }))?.vsdcInvcNo;
  const refundRow = refundId ? await prisma.sale.findUnique({ where: { id: refundId }, select: { vsdcInvcNo: true, rfdRsnCd: true } }) : null;
  check('refund fiscalized', rtx?.submissionStatus === 'SUCCESS', { refundId, rcpt: rtx?.sdcRcptNo });
  check('refund fresh invcNo + orgInvcNo + rfdRsnCd=09', rsent?.orgInvcNo === origInvc && rsent?.rfdRsnCd === '09' && rsent?.salesSttsCd === '05' && rsent?.rcptTyCd === 'R', { orgInvc: rsent?.orgInvcNo, rsn: rsent?.rfdRsnCd });
  check('refund stored invcNo + code', !!(refundRow?.vsdcInvcNo && refundRow.vsdcInvcNo !== origInvc && refundRow.rfdRsnCd === '09'), refundRow);

  // ── 5. void/cancel ──
  const cres = mockRes();
  await cancelSale({ ...req, params: { saleId: String(saleIds[1]), organizationId: String(ORG) }, body: { reason: 'entered twice by mistake' } } as any, cres);
  await waitForOutbox(saleIds[1], 'VOID');
  const voidOb = await outboxStatus(saleIds[1], 'VOID');
  const voidTx = await prisma.ebmTransaction.findFirst({ where: { saleId: saleIds[1], operation: 'VOID' }, orderBy: { createdAt: 'desc' } });
  const vsent = (voidTx?.responseData as any)?.requestPayload;
  const voidOrigInvc = (await prisma.sale.findUnique({ where: { id: saleIds[1] }, select: { vsdcInvcNo: true } }))?.vsdcInvcNo;
  check('void fiscalized with fresh invcNo + stts 04, orgInvcNo = original', voidOb?.status === 'SUCCEEDED' && vsent?.salesSttsCd === '04' && Number(vsent?.orgInvcNo) === Number(voidOrigInvc) && !!vsent?.cnclDt, { stts: vsent?.salesSttsCd, orgInvc: vsent?.orgInvcNo });

  // ── 6. copy/reprint submits nothing ──
  const obBefore = await prisma.ebmOutbox.count({ where: { saleId: saleIds[2] } });
  const pres = mockRes();
  await reprintSaleReceipt({ ...req, params: { saleId: String(saleIds[2]), organizationId: String(ORG) } } as any, mockRes());
  await reprintSaleReceipt({ ...req, params: { saleId: String(saleIds[2]), organizationId: String(ORG) } } as any, pres);
  const obAfter = await prisma.ebmOutbox.count({ where: { saleId: saleIds[2] } });
  check('reprint is display-only (isCopy, no new outbox)', pres.body?.data?.isCopy === true && obAfter === obBefore, pres.body?.data);

  // ── 7. proforma never fiscalized ──
  const pro = await commitSale({
    organizationId: ORG, branchId: BRANCH, userId: USER, customerId: walkin.id,
    items: [item], paymentType: 'CASH', cashAmount: 200, debtAmount: 0, insuranceAmount: 0, isProforma: true, req,
  });
  const proOb = await prisma.ebmOutbox.count({ where: { saleId: pro.sale.id } });
  const proRow = await prisma.sale.findUnique({ where: { id: pro.sale.id }, select: { vsdcInvcNo: true, rcptLabel: true, isProforma: true } });
  check('proforma local-only', proOb === 0 && proRow?.vsdcInvcNo === null && proRow?.rcptLabel === 'PS', proRow);

  // ── 8. invoice payload + PDF/HTML: fiscal data present, no Total-with-A ──
  const invReq: any = { ...req, params: { saleId: String(saleIds[2]), organizationId: String(ORG) }, query: {} };
  const payload = await composeInvoicePayload(invReq, { allowUnfiscalized: true });
  check('invoice payload composed + certified', !!payload && payload.certification.isCertified, { rcpt: payload?.invoice.receiptNumber });
  const html = renderSalesInvoiceHtml(payload!);
  const pdfA4 = await generateEbmInvoicePdf(payload!);
  const pdf80 = await generateEbmReceiptPdf80mm(payload!);
  const hasFiscal = html.includes('SDC ID') && html.includes('Receipt Signature') && html.includes('MRC') && html.includes('TIN');
  // per-band SALES totals look like "TOTAL A", "Total A-0%", "TOTAL B-18%" etc; tax rows "TOTAL TAX A" must stay
  const bandSalesRe = /(TOTAL|Total)\s+[A-D](-|%|\s)/;
  check('renderers carry fiscal data', hasFiscal && pdfA4.length > 5000 && pdf80.length > 2000, { a4: pdfA4.length, mm80: pdf80.length });
  check('no Total-with-A sales rows in HTML', !bandSalesRe.test(html));
  check('tax rows kept in HTML', /TOTAL TAX [A-D]/.test(html));

  // ── restore ──
  await restore();

  console.log(`\nE2E done: ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
  } catch (e) {
    try { await restore(); } catch { /* ignore */ }
    throw e;
  }
}
main().catch(async (e) => { console.error('E2E FATAL', e); await prisma.$disconnect(); process.exit(2); });

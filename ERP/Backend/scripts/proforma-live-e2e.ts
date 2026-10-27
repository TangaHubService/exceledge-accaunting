/**
 * Live PS (proforma) end-to-end run against the local RRA VSDC sandbox
 * (EBM_API_URL, TIN 999945560). A proforma goes through commitSale -> outbox ->
 * /trnsSales/saveSales as salesTyCd "P". Verifies the wire request, the VSDC
 * response, the stored fiscal record, isolation from stock/batches/payments/
 * debt/accounting, and the A4/80mm prints.
 *
 * Run (from Backend/):  node --import tsx scripts/proforma-live-e2e.ts
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { config } from '../src/config'
import { commitSale } from '../src/services/sale-commit.service'
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service'
import { composeInvoicePayload } from '../src/controllers/sales.controller'
import { generateEbmInvoicePdf } from '../src/services/invoice-pdf.service'
import { generateEbmReceiptPdf80mm } from '../src/services/invoice-receipt-pdf.service'

const OUT_DIR = path.join(__dirname, '..', 'tmp-proforma-live')

let pass = 0
let fail = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) pass++
  else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
}

async function waitForOutbox(saleId: number, timeoutMs = 90000) {
  const t0 = Date.now()
  for (;;) {
    await prisma.ebmOutbox.updateMany({
      where: { saleId, operation: 'SALE', status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { gt: new Date() } },
      data: { nextAttemptAt: new Date() },
    })
    await processEbmOutboxBatch(15)
    const row = await prisma.ebmOutbox.findFirst({ where: { saleId, operation: 'SALE' }, orderBy: { createdAt: 'desc' } })
    if (row && (row.status === 'SUCCEEDED' || row.status === 'DEAD_LETTER')) return row
    if (Date.now() - t0 > timeoutMs) return row
    await new Promise((r) => setTimeout(r, 600))
  }
}

async function production(orgId: number, productIds: number[], customerId: number) {
  const [batches, ledger, salePayments, payments, accounting, customer, debtPayments] = await Promise.all([
    prisma.batch.findMany({ where: { organizationId: orgId, productId: { in: productIds } }, select: { id: true, quantity: true }, orderBy: { id: 'asc' } }),
    prisma.inventoryLedger.count({ where: { organizationId: orgId } }),
    prisma.salePayment.count(),
    prisma.payment.count(),
    prisma.erpAccountingOutbox.count({ where: { organizationId: orgId } }),
    prisma.customer.findUnique({ where: { id: customerId }, select: { balance: true } }),
    prisma.debtPayment.count(),
  ])
  return JSON.parse(JSON.stringify({ batches, ledger, salePayments, payments, accounting, balance: customer?.balance, debtPayments }))
}

async function main() {
  console.log(`\n=== LIVE PS TEST — VSDC ${config.ebm.apiUrl} (mock=${config.ebm.useMock}, env=${process.env.EBM_ENVIRONMENT}) ===`)
  if (config.ebm.useMock) throw new Error('EBM_USE_MOCK=true — refusing: this run must hit the real VSDC')
  if (process.env.EBM_ENVIRONMENT !== 'sandbox') throw new Error('Refusing to run outside EBM_ENVIRONMENT=sandbox')

  const org = await prisma.organization.findFirst({ where: { TIN: '999945560' }, select: { id: true, name: true } })
  if (!org) throw new Error('No organization with sandbox TIN 999945560')
  const branch = (await prisma.branch.findFirst({ where: { organizationId: org.id, isDefault: true } }))
    ?? (await prisma.branch.findFirst({ where: { organizationId: org.id } }))
  if (!branch) throw new Error('No branch for org')
  const admin = await prisma.userOrganization.findFirst({ where: { organizationId: org.id, role: 'ADMIN' }, select: { userId: true } })
  if (!admin) throw new Error('No admin for org')
  const products = await prisma.product.findMany({
    where: { organizationId: org.id, isActive: true, deletedAt: null, itemCd: { not: null }, itemClsCd: { not: null }, itemType: { not: 'SERVICE' } },
    select: { id: true, unitPrice: true },
    take: 2,
  })
  if (!products.length) throw new Error('No fiscalizable product')

  const ORG = org.id, BRANCH = branch.id, USER = admin.userId
  mkdirSync(OUT_DIR, { recursive: true })
  const req: any = { user: { userId: String(USER) }, params: { organizationId: String(ORG) }, ip: '127.0.0.1', headers: {} }

  const customer = await prisma.customer.create({ data: { organizationId: ORG, name: 'Proforma Live Test Customer', phone: '+250788777888', customerType: 'INDIVIDUAL' } })
  const productIds = products.map((p) => p.id)
  const price = (p: any) => Math.max(100, Math.round(Number(p.unitPrice) || 500))
  const lines: any[] = products.map((p, i) => ({ productId: p.id, quantity: i + 2, unitPrice: price(p), itemType: 'PRODUCT' }))
  const gross = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const before = await production(ORG, productIds, customer.id)

  const ps = await commitSale({
    organizationId: ORG, branchId: BRANCH, userId: USER, customerId: customer.id, items: lines,
    paymentType: 'CASH', cashAmount: gross, debtAmount: 0, insuranceAmount: 0, isProforma: true,
    payments: [{ paymentMethod: 'CASH', amount: gross }], req,
  } as any)
  const psId = ps.completeSale.id
  const psRow = await prisma.sale.findUnique({ where: { id: psId }, select: { rcptLabel: true, isProforma: true, vsdcInvcNo: true } })
  check('sale recorded as PS', psRow?.rcptLabel === 'PS' && psRow.isProforma, psRow)

  const ob = await waitForOutbox(psId)
  const tx = await prisma.ebmTransaction.findFirst({ where: { saleId: psId, operation: 'SALE', submissionStatus: 'SUCCESS' }, orderBy: { createdAt: 'desc' } })
  const sent = (tx?.responseData as any)?.requestPayload
  const raw = (tx?.responseData as any)?.raw
  check('PS accepted by VSDC (outbox SUCCEEDED, tx SUCCESS)', ob?.status === 'SUCCEEDED' && !!tx, { saleId: psId, invcNo: psRow?.vsdcInvcNo, outbox: ob?.status, err: ob?.lastError })
  if (!tx) throw new Error('PS not fiscalized — cannot continue')
  console.log(`  VSDC PS raw: ${JSON.stringify(raw).slice(0, 500)}`)
  check('PS request: salesTyCd P / rcptTyCd S / salesSttsCd 02', sent?.salesTyCd === 'P' && sent?.rcptTyCd === 'S' && sent?.salesSttsCd === '02', { salesTyCd: sent?.salesTyCd, rcptTyCd: sent?.rcptTyCd, salesSttsCd: sent?.salesSttsCd })
  check('PS response: VSDC counters stored, no signature', !!tx.sdcRcptNo && !!tx.totalRcptNo && tx.rcptLabel === 'PS' && !tx.receiptSignature && !tx.internalData,
    { sdcId: tx.sdcId, rcptNo: tx.sdcRcptNo, totRcptNo: tx.totalRcptNo, intrlData: tx.internalData, rcptSign: tx.receiptSignature })
  check('PS journal stored, no signature lines', !!tx.journalText && tx.journalText.includes('TYPE:PS') && !/SIGNATURE:/.test(tx.journalText), tx.journalText?.split('\n').slice(0, 3))

  const after = await production(ORG, productIds, customer.id)
  check('PS moved no stock, batches, payments, debt or accounting', JSON.stringify(before) === JSON.stringify(after), { before, after })

  const payload = (await composeInvoicePayload({ ...req, params: { saleId: String(psId), organizationId: String(ORG) }, query: {}, body: {} } as any))!
  const counter = `${tx.sdcRcptNo}/${tx.totalRcptNo} PS`
  check(`PS prints VSDC counter ${counter}, not certified, no QR/signature`,
    payload.sdcInformation.receiptNumber === counter && !payload.certification.isCertified && !payload.verification.qrCodeImage && !payload.sdcInformation.receiptSignature,
    { receiptNumber: payload.sdcInformation.receiptNumber })
  writeFileSync(path.join(OUT_DIR, 'PS-A4.pdf'), await generateEbmInvoicePdf(payload, 'A4'))
  writeFileSync(path.join(OUT_DIR, 'PS-80mm.pdf'), await generateEbmReceiptPdf80mm(payload))

  console.log(`\nArtifacts: ${OUT_DIR}  (sale id ${psId})`)
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('PROFORMA LIVE E2E FATAL', e)
  await prisma.$disconnect()
  process.exit(2)
})

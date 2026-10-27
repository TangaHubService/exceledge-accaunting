/**
 * Live TS/TR (training) end-to-end run against the local RRA VSDC sandbox
 * (EBM_API_URL, TIN 999945560). Training mode is switched through the real
 * admin handler; a TS goes through commitSale -> outbox -> /trnsSales/saveSales
 * and is refunded as TR through the real refund handler. Verifies the wire
 * request, the VSDC response, the stored fiscal record, isolation from
 * production stock/payments/debt/accounting, and the A4/80mm prints.
 * Restores the organization's original training mode at the end.
 *
 * Run (from Backend/):  node --import tsx scripts/training-live-e2e.ts
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import PDFDocument from 'pdfkit'
import { prisma } from '../src/lib/prisma'
import { config } from '../src/config'
import { commitSale } from '../src/services/sale-commit.service'
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service'
import { refundSale, composeInvoicePayload } from '../src/controllers/sales.controller'
import { updateOrganization } from '../src/controllers/organization.controller'
import { generateEbmInvoicePdf } from '../src/services/invoice-pdf.service'
import { generateEbmReceiptPdf80mm } from '../src/services/invoice-receipt-pdf.service'

const OUT_DIR = path.join(__dirname, '..', 'tmp-training-live')

let pass = 0
let fail = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) pass++
  else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
}

const jsonRes = () => {
  const r: any = { statusCode: 200, headers: {} as Record<string, string> }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; return r }
  r.send = (b: any) => { r.body = b; return r }
  return r
}

async function waitForOutbox(saleId: number, op: string, timeoutMs = 90000) {
  const t0 = Date.now()
  for (;;) {
    await prisma.ebmOutbox.updateMany({
      where: { saleId, operation: op as any, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { gt: new Date() } },
      data: { nextAttemptAt: new Date() },
    })
    await processEbmOutboxBatch(15)
    const row = await prisma.ebmOutbox.findFirst({ where: { saleId, operation: op as any }, orderBy: { createdAt: 'desc' } })
    if (row && (row.status === 'SUCCEEDED' || row.status === 'DEAD_LETTER')) return row
    if (Date.now() - t0 > timeoutMs) return row
    await new Promise((r) => setTimeout(r, 600))
  }
}

async function successTx(saleId: number, operation: 'SALE' | 'REFUND') {
  return prisma.ebmTransaction.findFirst({ where: { saleId, operation, submissionStatus: 'SUCCESS' }, orderBy: { createdAt: 'desc' } })
}

/** Everything a training receipt must never move. */
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

/** Text drawn into a PDF, with font sizes. */
async function drawn(render: () => Promise<Buffer>) {
  const calls: Array<{ text: string; size: number }> = []
  const original = PDFDocument.prototype.text
  ;(PDFDocument.prototype as any).text = function (this: any, ...args: any[]) {
    calls.push({ text: String(args[0]), size: Number(this._fontSize) })
    return (original as any).apply(this, args)
  }
  try {
    const pdf = await render()
    return { pdf, calls, text: calls.map((c) => c.text).join('\n') }
  } finally {
    ;(PDFDocument.prototype as any).text = original
  }
}

async function main() {
  console.log(`\n=== LIVE TS/TR TEST — VSDC ${config.ebm.apiUrl} (mock=${config.ebm.useMock}, env=${process.env.EBM_ENVIRONMENT}) ===`)
  if (config.ebm.useMock) throw new Error('EBM_USE_MOCK=true — refusing: this run must hit the real VSDC')
  if (process.env.EBM_ENVIRONMENT !== 'sandbox') throw new Error('Refusing to run outside EBM_ENVIRONMENT=sandbox')

  const org = await prisma.organization.findFirst({ where: { TIN: '999945560' }, select: { id: true, name: true, trainingMode: true } })
  if (!org) throw new Error('No organization with sandbox TIN 999945560')
  const branch = (await prisma.branch.findFirst({ where: { organizationId: org.id, isDefault: true } }))
    ?? (await prisma.branch.findFirst({ where: { organizationId: org.id } }))
  if (!branch) throw new Error('No branch for org')
  const admin = await prisma.userOrganization.findFirst({ where: { organizationId: org.id, role: 'ADMIN' }, select: { userId: true } })
  if (!admin) throw new Error('No admin for org')
  const nonAdmin = await prisma.userOrganization.findFirst({ where: { organizationId: org.id, role: { not: 'ADMIN' } }, select: { userId: true, role: true } })
  const products = await prisma.product.findMany({
    where: { organizationId: org.id, isActive: true, deletedAt: null, itemCd: { not: null }, itemClsCd: { not: null }, itemType: { not: 'SERVICE' } },
    select: { id: true, name: true, unitPrice: true, taxCode: true },
    take: 2,
  })
  if (!products.length) throw new Error('No fiscalizable product')

  const ORG = org.id, BRANCH = branch.id, USER = admin.userId
  const originalMode = org.trainingMode
  console.log(`Org ${ORG} "${org.name}" | branch ${BRANCH} bhf=${branch.bhfId} | admin ${USER} | training was ${originalMode}`)
  mkdirSync(OUT_DIR, { recursive: true })

  const req: any = { user: { userId: String(USER) }, params: { organizationId: String(ORG) }, ip: '127.0.0.1', headers: {} }
  const reqFor = (saleId: number) => ({ ...req, params: { saleId: String(saleId), organizationId: String(ORG) }, query: {}, body: {} })
  const setMode = async (trainingMode: unknown, userId = USER) => {
    const res = jsonRes()
    await updateOrganization({ ...req, user: { userId: String(userId) }, params: { id: String(ORG) }, body: { trainingMode } } as any, res)
    return res
  }

  try {
    // ── 1. Enable / authorization ──
    console.log('\n--- 1. Training mode switch ---')
    if (nonAdmin) {
      const r = await setMode(true, nonAdmin.userId)
      check(`non-admin (${nonAdmin.role}) cannot switch training mode (403)`, r.statusCode === 403, { http: r.statusCode })
    }
    const bad = await setMode('yes')
    check('non-boolean trainingMode rejected (400)', bad.statusCode === 400, { http: bad.statusCode })
    const on = await setMode(true)
    const modeNow = (await prisma.organization.findUnique({ where: { id: ORG }, select: { trainingMode: true } }))?.trainingMode
    check('admin enables training mode', on.statusCode === 200 && modeNow === true, { http: on.statusCode, modeNow })
    const audit = await prisma.activityLog.findFirst({ where: { entityType: 'Organization', entityId: String(ORG), description: { contains: 'Training mode ENABLED' } }, orderBy: { id: 'desc' } })
    check('mode switch is audited', !!audit, audit?.description)

    const customer = await prisma.customer.create({ data: { organizationId: ORG, name: 'Training Live Test Customer', phone: '+250788555666', customerType: 'INDIVIDUAL' } })
    const productIds = products.map((p) => p.id)
    const price = (p: any) => Math.max(100, Math.round(Number(p.unitPrice) || 500))
    const lines: any[] = products.map((p, i) => ({ productId: p.id, quantity: i + 2, unitPrice: price(p), itemType: 'PRODUCT' }))
    const gross = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
    const before = await production(ORG, productIds, customer.id)

    // ── 2. Stale screen ──
    console.log('\n--- 2. Mode handshake ---')
    const salesBefore = await prisma.sale.count({ where: { organizationId: ORG } })
    let mismatch: any = null
    try {
      await commitSale({ organizationId: ORG, branchId: BRANCH, userId: USER, customerId: customer.id, items: lines, paymentType: 'CASH', cashAmount: gross, debtAmount: 0, insuranceAmount: 0, req, expectedReceiptMode: 'NORMAL' })
    } catch (e: any) { mismatch = e }
    const salesAfterMismatch = await prisma.sale.count({ where: { organizationId: ORG } })
    check('a NORMAL-mode screen is refused while training is on (409), nothing recorded', mismatch?.statusCode === 409 && salesAfterMismatch === salesBefore, { status: mismatch?.statusCode, msg: mismatch?.message })

    // ── 3. TS ──
    console.log('\n--- 3. Training Sale (TS) -> VSDC ---')
    const ts = await commitSale({ organizationId: ORG, branchId: BRANCH, userId: USER, customerId: customer.id, items: lines, paymentType: 'CASH', cashAmount: gross, debtAmount: 0, insuranceAmount: 0, req, expectedReceiptMode: 'TRAINING' })
    const tsId = ts.completeSale.id
    const tsRow = await prisma.sale.findUnique({ where: { id: tsId }, select: { rcptLabel: true, shiftId: true, vsdcInvcNo: true, localReceiptSeq: true } })
    check('sale recorded as TS, no shift, no local receipt counter', tsRow?.rcptLabel === 'TS' && tsRow.shiftId == null && tsRow.localReceiptSeq == null, tsRow)
    const tsOb = await waitForOutbox(tsId, 'SALE')
    const tsTx = await successTx(tsId, 'SALE')
    const tsSent = (tsTx?.responseData as any)?.requestPayload
    const tsRaw = (tsTx?.responseData as any)?.raw ?? (tsTx?.responseData as any)?.rawBody ?? (tsTx?.responseData as any)
    check('TS accepted by VSDC (outbox SUCCEEDED, tx SUCCESS)', tsOb?.status === 'SUCCEEDED' && !!tsTx, { saleId: tsId, invcNo: tsRow?.vsdcInvcNo, outbox: tsOb?.status, err: tsOb?.lastError })
    if (!tsTx) throw new Error('TS not fiscalized — cannot continue')
    check('TS request: salesTyCd T / rcptTyCd S / salesSttsCd 02', tsSent?.salesTyCd === 'T' && tsSent?.rcptTyCd === 'S' && tsSent?.salesSttsCd === '02', { salesTyCd: tsSent?.salesTyCd, rcptTyCd: tsSent?.rcptTyCd, salesSttsCd: tsSent?.salesSttsCd })
    check('TS response: VSDC counters, no internal data / signature', !!tsTx.sdcRcptNo && !!tsTx.totalRcptNo && !tsTx.internalData && !tsTx.receiptSignature && tsTx.rcptLabel === 'TS',
      { sdcId: tsTx.sdcId, rcptNo: tsTx.sdcRcptNo, totRcptNo: tsTx.totalRcptNo, intrlData: tsTx.internalData, rcptSign: tsTx.receiptSignature })
    console.log(`  VSDC TS raw: ${JSON.stringify(tsRaw).slice(0, 400)}`)
    check('TS journal stored, marked training, no signature lines', !!tsTx.journalText && tsTx.journalText.includes('TYPE:TS') && tsTx.journalText.includes('TRAINING MODE') && !/SIGNATURE:/.test(tsTx.journalText), tsTx.journalText?.split('\n').slice(0, 4))
    const afterTs = await production(ORG, productIds, customer.id)
    check('TS moved no stock, batches, payments, debt or accounting', JSON.stringify(before) === JSON.stringify(afterTs), { before, afterTs })

    // ── 4. Refund rules in training ──
    console.log('\n--- 4. Refund rules ---')
    const ns = await prisma.sale.findFirst({ where: { organizationId: ORG, rcptLabel: 'NS', status: 'COMPLETED', originalSaleId: null }, orderBy: { id: 'desc' }, select: { id: true } })
    if (ns) {
      const r = jsonRes()
      await refundSale({ ...req, params: { id: String(ns.id), organizationId: String(ORG) }, body: { reason: 'training probe', rfdRsnCd: '06', receiptMode: 'TRAINING' } } as any, r)
      check('an NS cannot be refunded while training is on (409)', r.statusCode === 409, { http: r.statusCode, err: r.body?.error ?? r.body?.message })
    }

    // ── 5. TR ──
    console.log('\n--- 5. Training Refund (TR) -> VSDC ---')
    const rres = jsonRes()
    await refundSale({ ...req, params: { id: String(tsId), organizationId: String(ORG) }, body: { reason: 'Practice return', rfdRsnCd: '06', receiptMode: 'TRAINING' } } as any, rres)
    const trId: number | undefined = rres.body?.data?.refundSale?.id
    check('TR created', !!trId, { http: rres.statusCode, err: rres.body?.error })
    if (!trId) throw new Error('TR failed — cannot continue')
    const trRow = await prisma.sale.findUnique({ where: { id: trId }, select: { rcptLabel: true, shiftId: true, originalSaleId: true } })
    check('refund recorded as TR referencing the TS', trRow?.rcptLabel === 'TR' && trRow.originalSaleId === tsId && trRow.shiftId == null, trRow)
    const trOb = await waitForOutbox(trId, 'REFUND')
    const trTx = await successTx(trId, 'REFUND')
    const trSent = (trTx?.responseData as any)?.requestPayload
    check('TR accepted by VSDC (outbox SUCCEEDED, tx SUCCESS)', trOb?.status === 'SUCCEEDED' && !!trTx, { outbox: trOb?.status, err: trOb?.lastError })
    if (!trTx) throw new Error('TR not fiscalized — cannot continue')
    check('TR request: salesTyCd T / rcptTyCd R / salesSttsCd 05 / orgInvcNo = TS invcNo', trSent?.salesTyCd === 'T' && trSent?.rcptTyCd === 'R' && trSent?.salesSttsCd === '05' && Number(trSent?.orgInvcNo) === Number(tsRow?.vsdcInvcNo),
      { salesTyCd: trSent?.salesTyCd, rcptTyCd: trSent?.rcptTyCd, orgInvcNo: trSent?.orgInvcNo, tsInvc: tsRow?.vsdcInvcNo })
    check('TR response: training counter follows TS, no signature', Number(trTx.sdcRcptNo) === Number(tsTx.sdcRcptNo) + 1 && !trTx.receiptSignature && !trTx.internalData,
      { ts: `${tsTx.sdcRcptNo}/${tsTx.totalRcptNo}`, tr: `${trTx.sdcRcptNo}/${trTx.totalRcptNo}` })
    const afterTr = await production(ORG, productIds, customer.id)
    check('TR moved no stock, batches, payments, debt or accounting', JSON.stringify(before) === JSON.stringify(afterTr), { before, afterTr })

    // ── 6. Prints ──
    console.log('\n--- 6. A4 / 80mm prints ---')
    const tsPayload = (await composeInvoicePayload(reqFor(tsId) as any))!
    const trPayload = (await composeInvoicePayload(reqFor(trId) as any))!
    for (const [label, payload, tx] of [['TS', tsPayload, tsTx], ['TR', trPayload, trTx]] as const) {
      const counter = `${tx.sdcRcptNo}/${tx.totalRcptNo} ${label}`
      check(`${label}: prints VSDC counter ${counter}, not certified, no QR`, payload.sdcInformation.receiptNumber === counter && !payload.certification.isCertified && !payload.verification.qrCodeImage,
        { receiptNumber: payload.sdcInformation.receiptNumber })
      for (const format of ['A4', '80mm'] as const) {
        const out = await drawn(() => (format === 'A4' ? generateEbmInvoicePdf(payload, 'A4') : generateEbmReceiptPdf80mm(payload)))
        writeFileSync(path.join(OUT_DIR, `${label}-${format}.pdf`), out.pdf)
        const amountSize = Math.max(...out.calls.filter((c) => /^-?\d+\.\d{2}[A-D]?$/.test(c.text)).map((c) => c.size))
        const marks = out.calls.filter((c) => c.text === 'TRAINING MODE' || c.text === 'THIS IS NOT AN OFFICIAL RECEIPT')
        check(`${label} ${format}: TRAINING MODE + NOT OFFICIAL (≥2x amount text), no watermark, no signature`,
          out.text.includes('TRAINING MODE') && !out.calls.some((c) => c.text === 'TRAINING') && out.text.includes('THIS IS NOT AN OFFICIAL RECEIPT')
          && marks.every((m) => m.size >= 2 * amountSize) && !/Receipt Signature|Internal Data/.test(out.text) && out.text.includes(counter)
          && (label === 'TS' || out.text.includes(`REF. NORMAL RECEIPT#: ${tsTx.sdcRcptNo}/${tsTx.totalRcptNo} TS`)),
          { amountSize, markSizes: [...new Set(marks.map((m) => m.size))] })
      }
    }

    // ── 7. Disable; existing receipts unchanged; TS no longer refundable ──
    console.log('\n--- 7. Training mode off ---')
    const off = await setMode(false)
    check('admin disables training mode', off.statusCode === 200, { http: off.statusCode })
    const tsAgain = (await composeInvoicePayload(reqFor(tsId) as any))!
    const trAgain = (await composeInvoicePayload(reqFor(trId) as any))!
    check('switching mode off leaves the issued TS/TR receipts identical', JSON.stringify(tsAgain) === JSON.stringify(tsPayload) && JSON.stringify(trAgain) === JSON.stringify(trPayload))
    const r2 = jsonRes()
    await refundSale({ ...req, params: { id: String(tsId), organizationId: String(ORG) }, body: { reason: 'after training', rfdRsnCd: '06', receiptMode: 'NORMAL' } } as any, r2)
    check('a TS cannot be refunded once training is off (409)', r2.statusCode === 409, { http: r2.statusCode, err: r2.body?.error ?? r2.body?.message })

    console.log(`\nArtifacts: ${OUT_DIR}`)
    console.log(`Sale ids: TS=${tsId} TR=${trId}`)
  } finally {
    await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: originalMode } })
    console.log(`training mode restored to ${originalMode}`)
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('TRAINING LIVE E2E FATAL', e)
  await prisma.$disconnect()
  process.exit(2)
})

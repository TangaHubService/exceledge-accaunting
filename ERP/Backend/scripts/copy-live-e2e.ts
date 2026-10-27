/**
 * Live CS/CR (copy receipt) end-to-end run against the RRA VSDC sandbox
 * (EBM_API_URL, TIN 999945560). Real NS and NR are fiscalized through the
 * normal commitSale -> outbox -> /trnsSales/saveSales path; copies are then
 * printed through the real POST /copy handler and checked against the stored
 * VSDC response. Copies must not reach VSDC or create any record.
 *
 * Run (from Backend/):  node --import tsx scripts/copy-live-e2e.ts
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { config } from '../src/config'
import { commitSale } from '../src/services/sale-commit.service'
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service'
import {
  refundSale,
  cancelSale,
  composeInvoicePayload,
  printReceiptCopy,
  reprintSaleReceipt,
} from '../src/controllers/sales.controller'
import { generateEbmInvoicePdf } from '../src/services/invoice-pdf.service'
import { renderSalesInvoiceHtml } from '../src/services/invoice-render.service'
import { generateEbmReceiptPdf80mm } from '../src/services/invoice-receipt-pdf.service'

const OUT_DIR = path.join(__dirname, '..', 'tmp-copy-live')

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

// Every outbound VSDC call made by this process is recorded so the copy
// phase can prove it made none.
const vsdcCalls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  if (config.ebm.apiUrl && url.startsWith(config.ebm.apiUrl)) vsdcCalls.push(url)
  return realFetch(input, init)
}) as typeof fetch

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
  return prisma.ebmTransaction.findFirst({
    where: { saleId, operation, submissionStatus: 'SUCCESS' },
    orderBy: { createdAt: 'desc' },
  })
}

async function snapshot(orgId: number) {
  const [sales, outbox, ebmTx, ledger, payments, saleItems] = await Promise.all([
    prisma.sale.count({ where: { organizationId: orgId } }),
    prisma.ebmOutbox.count(),
    prisma.ebmTransaction.count(),
    prisma.inventoryLedger.count({ where: { organizationId: orgId } }),
    prisma.salePayment.count(),
    prisma.saleItem.count(),
  ])
  return { sales, outbox, ebmTx, ledger, payments, saleItems }
}

/** Everything a copy may differ in from the original: the COPY designation only. */
function stripCopyDesignation(p: any) {
  const clone = JSON.parse(JSON.stringify(p))
  for (const k of ['isCopy', 'copyLabel', 'copyNumber', 'copyOfReceiptNumber', 'rcptLabelText']) delete clone.invoice[k]
  return clone
}

function diffPaths(a: any, b: any, prefix = ''): string[] {
  if (a === b) return []
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [prefix || '(root)']
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap((k) => diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k))
}

async function main() {
  console.log(`\n=== LIVE CS/CR TEST — VSDC ${config.ebm.apiUrl} (mock=${config.ebm.useMock}, env=${process.env.EBM_ENVIRONMENT}) ===`)
  if (config.ebm.useMock) throw new Error('EBM_USE_MOCK=true — refusing: this run must hit the real VSDC')
  if (process.env.EBM_ENVIRONMENT !== 'sandbox') throw new Error('Refusing to run outside EBM_ENVIRONMENT=sandbox')

  const org = await prisma.organization.findFirst({ where: { TIN: '999945560' }, select: { id: true, name: true, TIN: true, trainingMode: true } })
  if (!org) throw new Error('No organization with sandbox TIN 999945560')
  const branch = (await prisma.branch.findFirst({ where: { organizationId: org.id, isDefault: true } }))
    ?? (await prisma.branch.findFirst({ where: { organizationId: org.id } }))
  if (!branch) throw new Error('No branch for org')
  const uo = await prisma.userOrganization.findFirst({ where: { organizationId: org.id }, select: { userId: true } })
  if (!uo) throw new Error('No user linked to org')
  const products = await prisma.product.findMany({
    where: { organizationId: org.id, isActive: true, deletedAt: null, itemCd: { not: null }, itemClsCd: { not: null }, itemType: { not: 'SERVICE' } },
    select: { id: true, name: true, unitPrice: true, taxCode: true },
    take: 2,
  })
  if (!products.length) throw new Error('No fiscalizable product')

  const ORG = org.id, BRANCH = branch.id, USER = uo.userId
  console.log(`Org ${ORG} "${org.name}" TIN ${org.TIN} | branch ${BRANCH} bhf=${branch.bhfId} | user ${USER}`)
  console.log(`Products: ${products.map((p) => `${p.id}:${p.name}(${p.taxCode})`).join(', ')}`)

  const orgBefore = org.trainingMode
  const brBefore = { ebmSerialNo: branch.ebmSerialNo, ebmDeviceId: branch.ebmDeviceId, bhfId: branch.bhfId }
  const restore = async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: orgBefore } })
    await prisma.branch.update({ where: { id: BRANCH }, data: brBefore })
  }
  mkdirSync(OUT_DIR, { recursive: true })

  try {
    await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: false } })
    await prisma.branch.update({
      where: { id: BRANCH },
      data: { bhfId: branch.bhfId || '00', ebmSerialNo: branch.ebmSerialNo || 'excelwartest', ebmDeviceId: branch.ebmDeviceId || 'SDC012000250' },
    })
    for (const p of products) {
      await prisma.inventoryLedger.create({
        data: { organizationId: ORG, productId: p.id, branchId: BRANCH, userId: USER, movementType: 'ADJUSTMENT_IN', direction: 'IN', quantity: 20, runningBalance: 20, note: 'copy-live-e2e stock top-up', ebmSyncStatus: null },
      }).catch(() => undefined)
    }
    const customer = await prisma.customer.create({
      data: { organizationId: ORG, name: 'Copy Live Test Customer', phone: '+250788333444', customerType: 'INDIVIDUAL' },
    })
    const req: any = { user: { userId: String(USER) }, params: { organizationId: String(ORG) }, ip: '127.0.0.1', headers: {} }
    const reqFor = (saleId: number, query: any = {}) => ({ ...req, params: { saleId: String(saleId), organizationId: String(ORG) }, query, body: {} })

    // ── 1. Real NS (multi-line, with a line discount when the org allows it) ──
    console.log('\n--- 1. Normal sale (NS) -> VSDC ---')
    const price = (p: any) => Math.max(100, Math.round(Number(p.unitPrice) || 500))
    const lines: any[] = [{ productId: products[0].id, quantity: 2, unitPrice: price(products[0]), itemType: 'PRODUCT', discount: 50 }]
    if (products[1]) lines.push({ productId: products[1].id, quantity: 1, unitPrice: price(products[1]), itemType: 'PRODUCT' })
    const gross = lines.reduce((s, l) => s + l.quantity * l.unitPrice - (l.discount ?? 0), 0)
    let ns
    try {
      ns = await commitSale({ organizationId: ORG, branchId: BRANCH, userId: USER, customerId: customer.id, items: lines, paymentType: 'CASH', cashAmount: gross, debtAmount: 0, insuranceAmount: 0, req })
    } catch (e: any) {
      console.log(`  discounted sale rejected (${e.message}) — retrying without discount`)
      delete lines[0].discount
      const plain = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
      ns = await commitSale({ organizationId: ORG, branchId: BRANCH, userId: USER, customerId: customer.id, items: lines, paymentType: 'CASH', cashAmount: plain, debtAmount: 0, insuranceAmount: 0, req })
    }
    const nsId = ns.completeSale.id
    const nsOb = await waitForOutbox(nsId, 'SALE')
    const nsTx = await successTx(nsId, 'SALE')
    const nsSent = (nsTx?.responseData as any)?.requestPayload
    check('NS accepted by VSDC (outbox SUCCEEDED, tx SUCCESS)', nsOb?.status === 'SUCCEEDED' && !!nsTx, { saleId: nsId, invcNo: ns.completeSale.vsdcInvcNo, outbox: nsOb?.status, err: nsOb?.lastError })
    if (!nsTx) throw new Error('NS not fiscalized — cannot continue')
    check('NS request was salesTyCd N / rcptTyCd S / stts 02', nsSent?.salesTyCd === 'N' && nsSent?.rcptTyCd === 'S' && nsSent?.salesSttsCd === '02', { salesTyCd: nsSent?.salesTyCd, rcptTyCd: nsSent?.rcptTyCd })
    console.log(`  VSDC NS: sdcId=${nsTx.sdcId} rcptNo=${nsTx.sdcRcptNo}/${nsTx.totalRcptNo} intrlData=${nsTx.internalData} sign=${nsTx.receiptSignature} dt=${nsTx.sdcDateTime}`)

    // Original NS receipt (first issuance, not a copy).
    const nsOriginal = await composeInvoicePayload(reqFor(nsId) as any)
    check('NS original composes as NS, not a copy', nsOriginal?.invoice.rcptLabel === 'NS' && !nsOriginal?.invoice.isCopy, { label: nsOriginal?.invoice.rcptLabel })
    writeFileSync(path.join(OUT_DIR, 'NS-original-A4.pdf'), await generateEbmInvoicePdf(nsOriginal!))
    writeFileSync(path.join(OUT_DIR, 'NS-original-80mm.pdf'), await generateEbmReceiptPdf80mm(nsOriginal!))

    // ── 2. Real NR (full refund of the NS) ──
    console.log('\n--- 2. Refund (NR) -> VSDC ---')
    const rres = jsonRes()
    await refundSale({ ...req, params: { id: String(nsId), organizationId: String(ORG) }, body: { reason: 'Customer returned goods', rfdRsnCd: '06' } } as any, rres)
    const nrId: number | undefined = rres.body?.data?.refundSale?.id
    check('NR created', !!nrId, { http: rres.statusCode, err: rres.body?.error })
    if (!nrId) throw new Error('Refund failed — cannot continue')
    const nrOb = await waitForOutbox(nrId, 'REFUND')
    const nrTx = await successTx(nrId, 'REFUND')
    const nrSent = (nrTx?.responseData as any)?.requestPayload
    check('NR accepted by VSDC (outbox SUCCEEDED, tx SUCCESS)', nrOb?.status === 'SUCCEEDED' && !!nrTx, { refundId: nrId, outbox: nrOb?.status, err: nrOb?.lastError })
    if (!nrTx) throw new Error('NR not fiscalized — cannot continue')
    check('NR request was rcptTyCd R / stts 05 / orgInvcNo = NS invcNo', nrSent?.rcptTyCd === 'R' && nrSent?.salesSttsCd === '05' && Number(nrSent?.orgInvcNo) === Number(ns.completeSale.vsdcInvcNo), { orgInvcNo: nrSent?.orgInvcNo, nsInvc: ns.completeSale.vsdcInvcNo })
    console.log(`  VSDC NR: sdcId=${nrTx.sdcId} rcptNo=${nrTx.sdcRcptNo}/${nrTx.totalRcptNo} intrlData=${nrTx.internalData} sign=${nrTx.receiptSignature} dt=${nrTx.sdcDateTime}`)

    const nrOriginal = await composeInvoicePayload(reqFor(nrId) as any)
    check('NR original composes as NR, not a copy', nrOriginal?.invoice.rcptLabel === 'NR' && !nrOriginal?.invoice.isCopy, { label: nrOriginal?.invoice.rcptLabel })
    writeFileSync(path.join(OUT_DIR, 'NR-original-A4.pdf'), await generateEbmInvoicePdf(nrOriginal!))
    writeFileSync(path.join(OUT_DIR, 'NR-original-80mm.pdf'), await generateEbmReceiptPdf80mm(nrOriginal!))

    // ── 3. Copies: CS of the (now refunded) NS, CR of the NR ──
    console.log('\n--- 3. Copies (CS / CR) — must stay local ---')
    // Sale/refund stock sync to VSDC runs fire-and-forget; let it finish so it
    // is not attributed to the copies.
    for (let quiet = 0, seen = vsdcCalls.length; quiet < 5; ) {
      await new Promise((r) => setTimeout(r, 1000))
      if (vsdcCalls.length === seen) quiet++
      else { quiet = 0; seen = vsdcCalls.length }
    }
    const callsBefore = vsdcCalls.length
    const before = await snapshot(ORG)
    const nsSaleBefore = await prisma.sale.findUnique({ where: { id: nsId }, select: { status: true, totalAmount: true, rcptLabel: true, vsdcInvcNo: true } })
    const cases = [
      { id: nsId, tx: nsTx, original: nsOriginal!, want: 'CS', src: 'NS' },
      { id: nrId, tx: nrTx, original: nrOriginal!, want: 'CR', src: 'NR' },
    ] as const

    for (const c of cases) {
      for (const format of ['A4', '80mm'] as const) {
        const res = jsonRes()
        await printReceiptCopy(reqFor(c.id, { format }) as any, res)
        const pdf: Buffer | undefined = Buffer.isBuffer(res.body) ? res.body : undefined
        check(`${c.want} ${format}: 200 PDF`, res.statusCode === 200 && pdf && pdf.subarray(0, 5).toString() === '%PDF-', { http: res.statusCode, body: pdf ? `${pdf.length} bytes` : res.body })
        check(`${c.want} ${format}: label header ${c.want}`, res.headers['x-receipt-copy-label'] === c.want, res.headers['x-receipt-copy-label'])
        if (pdf) writeFileSync(path.join(OUT_DIR, `${c.want}-copy-${format}.pdf`), pdf)
      }

      const copy = await composeInvoicePayload(reqFor(c.id) as any, { copy: 'force' })
      const inv = copy!.invoice
      const sdc = copy!.sdcInformation
      check(`${c.want}: designation (isCopy, label, source ${c.src})`, inv.isCopy === true && inv.copyLabel === c.want && inv.rcptLabel === c.src, { isCopy: inv.isCopy, copyLabel: inv.copyLabel, rcptLabel: inv.rcptLabel, copyNumber: inv.copyNumber })
      check(`${c.want}: references original receipt ${sdc.receiptNumber}`, !!inv.copyOfReceiptNumber && inv.copyOfReceiptNumber === c.original.sdcInformation.receiptNumber, inv.copyOfReceiptNumber)
      const fiscal = {
        sdcId: sdc.sdcId === c.tx.sdcId,
        internalData: sdc.internalData === c.tx.internalData,
        signature: sdc.receiptSignature === c.tx.receiptSignature,
        rcptCounters: String(sdc.receiptNumber).includes(String(c.tx.sdcRcptNo)) && String(sdc.receiptNumber).includes(String(c.tx.totalRcptNo)),
        dateTime: new Date(sdc.date!).getTime() === new Date(c.tx.sdcDateTime as any).getTime(),
        qrHasSignature: !!copy!.verification.qrPayload && copy!.verification.qrPayload.includes(String(c.tx.receiptSignature)),
      }
      check(`${c.want}: SDC block equals VSDC response`, Object.values(fiscal).every(Boolean), fiscal)
      // The NS was composed before its refund; the refund legitimately moves the
      // sale's lifecycle fields, which print only on refund documents (NR/CR).
      const lifecycle = c.want === 'CS' ? ['invoice.status', 'invoice.refundReason'] : []
      const diffs = diffPaths(stripCopyDesignation(c.original), stripCopyDesignation(copy))
      check(`${c.want}: identical to original except COPY designation`, diffs.every((d) => lifecycle.includes(d)), diffs)
      if (c.want === 'CS') {
        const html = renderSalesInvoiceHtml(copy!)
        check('CS: refunded NS copy prints no refund block', !html.includes('REFUND REASON') && !html.includes('REF. NORMAL RECEIPT#'), { status: inv.status })
      }
      if (c.want === 'CR') {
        const neg = copy!.totals.grandTotal < 0 && copy!.items.every((i: any) => Number(i.total ?? i.amount ?? -1) <= 0)
        check('CR: amounts stay negative', neg, { grandTotal: copy!.totals.grandTotal })
      }
    }

    // Two-step reprint flow (mobile) also yields a copy without VSDC.
    const rp = jsonRes()
    await reprintSaleReceipt(reqFor(nrId) as any, rp)
    check('reprint endpoint returns CR copy', rp.statusCode === 200 && rp.body?.data?.isCopy === true && rp.body?.data?.copyLabel === 'CR', rp.body?.data)

    const after = await snapshot(ORG)
    const nsSaleAfter = await prisma.sale.findUnique({ where: { id: nsId }, select: { status: true, totalAmount: true, rcptLabel: true, vsdcInvcNo: true } })
    check('copies made ZERO VSDC calls', vsdcCalls.length === callsBefore, vsdcCalls.slice(callsBefore))
    check('copies created no sale/outbox/EBM tx/stock/payment/item rows', JSON.stringify(before) === JSON.stringify(after), { before, after })
    check('original NS row untouched (status/total/label/invcNo)', JSON.stringify(nsSaleBefore) === JSON.stringify(nsSaleAfter), nsSaleAfter)
    const counts = await prisma.sale.findMany({ where: { id: { in: [nsId, nrId] } }, select: { id: true, reprintCount: true } })
    check('reprint counters advanced (NS 3, NR 4)', counts.find((s) => s.id === nsId)?.reprintCount === 3 && counts.find((s) => s.id === nrId)?.reprintCount === 4, counts)
    const audits = await prisma.activityLog.count({ where: { entityType: 'Sale', entityId: { in: [String(nsId), String(nrId)] }, type: 'SALE_REPRINTED' as any } })
    check('each copy audited as SALE_REPRINTED (4 copies + 1 reprint)', audits === 5, audits)

    // ── 4. A voided sale cannot be copied ──
    console.log('\n--- 4. Rejection: copy of a cancelled (voided) sale ---')
    const vs = await commitSale({ organizationId: ORG, branchId: BRANCH, userId: USER, customerId: customer.id, items: [{ productId: products[0].id, quantity: 1, unitPrice: price(products[0]), itemType: 'PRODUCT' }], paymentType: 'CASH', cashAmount: price(products[0]), debtAmount: 0, insuranceAmount: 0, req })
    await waitForOutbox(vs.completeSale.id, 'SALE')
    await cancelSale({ ...req, params: { saleId: String(vs.completeSale.id), organizationId: String(ORG) }, body: { reason: 'copy-live-e2e void' } } as any, jsonRes())
    const voidOb = await waitForOutbox(vs.completeSale.id, 'VOID')
    check('void accepted by VSDC', voidOb?.status === 'SUCCEEDED', { saleId: vs.completeSale.id, status: voidOb?.status, err: voidOb?.lastError })
    const vCalls = vsdcCalls.length
    const vr = jsonRes()
    await printReceiptCopy(reqFor(vs.completeSale.id, { format: 'A4' }) as any, vr)
    check('copy of voided sale rejected 422 COPY_NOT_ALLOWED, no VSDC call', vr.statusCode === 422 && vr.body?.code === 'COPY_NOT_ALLOWED' && vsdcCalls.length === vCalls, { http: vr.statusCode, body: vr.body })

    console.log(`\nArtifacts: ${OUT_DIR}`)
    console.log(`Sale ids: NS=${nsId} NR=${nrId} voided=${vs.completeSale.id}`)
  } finally {
    await restore()
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('COPY LIVE E2E FATAL', e)
  await prisma.$disconnect()
  process.exit(2)
})

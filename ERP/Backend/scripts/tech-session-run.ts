/**
 * RRA Technical Session dry-run — same five flows promised in the reply email,
 * executed through the real ERP stack against the local VSDC sandbox.
 *
 * 1. Live sale → fiscalized receipt (SDC ID, rcpt, signature)
 * 2. Refund → NR fiscalized
 * 3. Void/cancel → salesSttsCd 04
 * 4. B2B sale with purchase code
 * 5. Invoice compose (QR / SDC block) — EBMVerify scan is manual on a phone
 *
 * Run: npx tsx scripts/tech-session-run.ts
 */
import { prisma } from '../src/lib/prisma'
import { commitSale } from '../src/services/sale-commit.service'
import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service'
import {
  refundSale,
  cancelSale,
  reprintSaleReceipt,
  composeInvoicePayload,
} from '../src/controllers/sales.controller'
import { generateValidPurchaseCodes } from '../src/services/purchase-code.checksum'

let pass = 0
let fail = 0
const results: Array<{ name: string; ok: boolean; detail?: unknown }> = []

function check(name: string, cond: unknown, detail?: unknown) {
  const ok = !!cond
  if (ok) {
    pass++
    console.log(`PASS  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
  }
  results.push({ name, ok, detail })
}

const mockRes: any = () => {
  const r: any = { statusCode: 200 }
  r.status = (c: number) => {
    r.statusCode = c
    return r
  }
  r.json = (b: any) => {
    r.body = b
    return r
  }
  return r
}

async function drainOutbox(times = 4) {
  for (let i = 0; i < times; i++) {
    await prisma.ebmOutbox.updateMany({ data: { nextAttemptAt: new Date() } })
    await processEbmOutboxBatch(15)
  }
}

async function waitForOutbox(saleId: number, op: string, timeoutMs = 90000) {
  const t0 = Date.now()
  for (;;) {
    await prisma.ebmOutbox.updateMany({
      where: {
        saleId,
        operation: op as any,
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { gt: new Date() },
      },
      data: { nextAttemptAt: new Date() },
    })
    await processEbmOutboxBatch(15)
    const row = await prisma.ebmOutbox.findFirst({
      where: { saleId, operation: op as any },
      orderBy: { createdAt: 'desc' },
    })
    if (row && (row.status === 'SUCCEEDED' || row.status === 'DEAD_LETTER')) return row
    if (Date.now() - t0 > timeoutMs) return row
    await new Promise((r) => setTimeout(r, 600))
  }
}

async function lastTx(saleId: number) {
  return prisma.ebmTransaction.findFirst({ where: { saleId }, orderBy: { createdAt: 'desc' } })
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { TIN: '999945560' },
    select: { id: true, name: true, TIN: true, trainingMode: true },
  })
  if (!org) throw new Error('No organization with TIN 999945560')

  const branch =
    (await prisma.branch.findFirst({
      where: { organizationId: org.id, isDefault: true },
    })) ??
    (await prisma.branch.findFirst({ where: { organizationId: org.id } }))
  if (!branch) throw new Error('No branch for org')

  const uo = await prisma.userOrganization.findFirst({
    where: { organizationId: org.id },
    select: { userId: true, user: { select: { id: true, email: true, name: true } } },
  })
  if (!uo) throw new Error('No user linked to org')

  const product = await prisma.product.findFirst({
    where: {
      organizationId: org.id,
      isActive: true,
      deletedAt: null,
      itemCd: { not: null },
      itemClsCd: { not: null },
      itemType: { not: 'SERVICE' },
    },
    select: { id: true, name: true, itemCd: true, itemClsCd: true, taxCode: true, unitPrice: true },
  })
  if (!product) throw new Error('No fiscalizable product (needs itemCd + itemClsCd)')

  const ORG = org.id
  const BRANCH = branch.id
  const USER = uo.userId
  const PRODUCT = product.id
  const unitPrice = Math.max(100, Number(product.unitPrice) || 200)
  const sellerTin = org.TIN!

  console.log('\n=== RRA TECHNICAL SESSION DRY-RUN ===')
  console.log(`Org ${ORG} ${org.name} TIN ${sellerTin}`)
  console.log(`Branch ${BRANCH} bhfId=${branch.bhfId} serial=${branch.ebmSerialNo} sdc=${branch.ebmDeviceId}`)
  console.log(`User ${USER} ${uo.user.email}`)
  console.log(`Product ${PRODUCT} ${product.name} ${product.itemCd} tax=${product.taxCode} @ ${unitPrice}`)
  console.log('VSDC http://localhost:8085\n')

  const orgBefore = org.trainingMode
  const brBefore = { ebmSerialNo: branch.ebmSerialNo, ebmDeviceId: branch.ebmDeviceId, bhfId: branch.bhfId }

  const restore = async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: orgBefore } })
    await prisma.branch.update({
      where: { id: BRANCH },
      data: {
        ebmSerialNo: brBefore.ebmSerialNo,
        ebmDeviceId: brBefore.ebmDeviceId,
        bhfId: brBefore.bhfId,
      },
    })
  }

  try {
    await prisma.organization.update({ where: { id: ORG }, data: { trainingMode: false } })
    await prisma.branch.update({
      where: { id: BRANCH },
      data: {
        bhfId: branch.bhfId || '00',
        ebmSerialNo: branch.ebmSerialNo || 'excelwartest',
        ebmDeviceId: branch.ebmDeviceId || 'SDC012000250',
      },
    })

    const walkin = await prisma.customer.create({
      data: {
        organizationId: ORG,
        name: 'Tech Session Walk-in',
        phone: '+250788111111',
        customerType: 'INDIVIDUAL',
      },
    })
    // Match current walkInCustTin: 19 + 7-digit id
    const walkTin = `19${String(walkin.id).padStart(7, '0')}`.slice(0, 9)

    // Mint buyer-scoped pools. Do NOT share a single `used` set across buyers:
    // generateValidPurchaseCodes mutates the set with the full candidate space
    // for that buyer, which starves the next buyer when string codes collide.
    async function ensureBuyerPool(buyerTin: string, want: number): Promise<string[]> {
      const existingForBuyer = await prisma.organizationPurchaseCode.findMany({
        where: { organizationId: ORG, buyerTin },
        select: { code: true, consumed: true },
      })
      const unconsumed = existingForBuyer.filter((r) => !r.consumed).map((r) => r.code)
      if (unconsumed.length >= want) return unconsumed.slice(0, want)

      // Exclude only this buyer's codes + globally unique codes already in the
      // org pool (unique on organizationId+code), so createMany does not no-op.
      const orgCodes = await prisma.organizationPurchaseCode.findMany({
        where: { organizationId: ORG },
        select: { code: true },
      })
      const used = new Set(orgCodes.map((r) => r.code))
      const minted = generateValidPurchaseCodes(buyerTin, sellerTin, want * 3, used)
      if (minted.length) {
        await prisma.organizationPurchaseCode.createMany({
          data: minted.map((code) => ({ organizationId: ORG, code, buyerTin })),
          skipDuplicates: true,
        })
      }
      const refreshed = await prisma.organizationPurchaseCode.findMany({
        where: { organizationId: ORG, buyerTin, consumed: false },
        select: { code: true },
        take: want,
      })
      return refreshed.map((r) => r.code)
    }

    await ensureBuyerPool(walkTin, 5)

    const corpTin = '100000002'
    const corpPool = await ensureBuyerPool(corpTin, 5)
    const corpCode = corpPool[0]
    if (!corpCode) {
      throw new Error('Could not mint an unconsumed purchase code for B2B corp TIN 100000002')
    }
    let corp = await prisma.customer.findFirst({
      where: { organizationId: ORG, TIN: corpTin },
    })
    if (!corp) {
      corp = await prisma.customer.create({
        data: {
          organizationId: ORG,
          name: 'Tech Session Corp Ltd',
          phone: '+250788222222',
          customerType: 'CORPORATE',
          TIN: corpTin,
          prcOrdCd: corpCode,
        },
      })
    } else {
      corp = await prisma.customer.update({
        where: { id: corp.id },
        data: { prcOrdCd: corpCode, customerType: 'CORPORATE' },
      })
    }

    // Ensure a little stock so SALE can deduct
    await prisma.inventoryLedger.create({
      data: {
        organizationId: ORG,
        productId: PRODUCT,
        branchId: BRANCH,
        userId: USER,
        movementType: 'ADJUSTMENT_IN',
        direction: 'IN',
        quantity: 50,
        runningBalance: 50,
        note: 'tech-session stock top-up',
        ebmSyncStatus: null,
      },
    }).catch(() => undefined)

    const req: any = {
      user: { userId: String(USER) },
      params: { organizationId: String(ORG) },
      ip: '127.0.0.1',
      headers: {},
    }
    const item = {
      productId: PRODUCT,
      quantity: 1,
      unitPrice,
      itemType: 'PRODUCT' as const,
    }

    // ── 1. LIVE SALE ──────────────────────────────────────────────
    console.log('\n--- 1. Live sale (NS) ---')
    const sale1 = await commitSale({
      organizationId: ORG,
      branchId: BRANCH,
      userId: USER,
      customerId: walkin.id,
      items: [item],
      paymentType: 'CASH',
      cashAmount: unitPrice,
      debtAmount: 0,
      insuranceAmount: 0,
      req,
    })
    await waitForOutbox(sale1.completeSale.id, 'SALE')
    const tx1 = await lastTx(sale1.completeSale.id)
    const ob1 = await prisma.ebmOutbox.findFirst({
      where: { saleId: sale1.completeSale.id, operation: 'SALE' },
      orderBy: { createdAt: 'desc' },
    })
    check('1. Sale fiscalized (resultCd 000 / SUCCEEDED)', ob1?.status === 'SUCCEEDED' && tx1?.submissionStatus === 'SUCCESS', {
      saleId: sale1.completeSale.id,
      invc: sale1.completeSale.vsdcInvcNo,
      rcpt: tx1?.sdcRcptNo,
      tot: tx1?.totalRcptNo,
      sdc: tx1?.sdcId,
      fiscal: sale1.fiscalization,
    })
    check('1. Receipt has SDC ID + signature + internal data', !!(tx1?.sdcId && tx1?.receiptSignature && tx1?.internalData), {
      sdc: tx1?.sdcId,
      mrc: (tx1?.responseData as any)?.normalized?.mrcNo,
      signed: !!tx1?.receiptSignature,
    })
    check('1. Counter A/B present (rcptNo/totRcptNo)', !!(tx1?.sdcRcptNo && tx1?.totalRcptNo), {
      A: tx1?.sdcRcptNo,
      B: tx1?.totalRcptNo,
    })

    // Compose invoice for QR / print evidence
    const invReq: any = {
      ...req,
      params: { saleId: String(sale1.completeSale.id), organizationId: String(ORG) },
      query: {},
    }
    let invoice: any = null
    try {
      invoice = await composeInvoicePayload(invReq)
    } catch (e: any) {
      check('1. Invoice compose', false, e.message)
    }
    if (invoice) {
      check('1. Invoice has QR payload', !!invoice.verification?.qrPayload || !!invoice.verification?.qrCodeImage, {
        hasQr: !!invoice.verification?.qrPayload,
        hasImage: !!invoice.verification?.qrCodeImage,
      })
      check('1. Invoice SDC block printable', !!(invoice.sdcInformation?.sdcId && invoice.sdcInformation?.receiptNumber), {
        sdc: invoice.sdcInformation?.sdcId,
        rcpt: invoice.sdcInformation?.receiptNumber,
        mrc: invoice.sdcInformation?.mrcNo,
      })
    }

    // ── 2. REFUND ─────────────────────────────────────────────────
    console.log('\n--- 2. Refund (NR) ---')
    const rres = mockRes()
    await refundSale(
      {
        ...req,
        params: { id: String(sale1.completeSale.id), organizationId: String(ORG) },
        body: { reason: 'Wrong amount charged', rfdRsnCd: '06' },
      } as any,
      rres,
    )
    const refundId = rres.body?.data?.refundSale?.id
    check('2. Refund sale created', !!refundId, { refundId, http: rres.statusCode, err: rres.body?.error })
    if (refundId) {
      await waitForOutbox(refundId, 'REFUND')
      const rtx = await lastTx(refundId)
      const rsent = (rtx?.responseData as any)?.requestPayload
      check('2. Refund fiscalized', rtx?.submissionStatus === 'SUCCESS', {
        rcpt: rtx?.sdcRcptNo,
        tot: rtx?.totalRcptNo,
        sdc: rtx?.sdcId,
      })
      check('2. Refund stts=05 rcptTyCd=R orgInvcNo set', rsent?.salesSttsCd === '05' && rsent?.rcptTyCd === 'R' && !!rsent?.orgInvcNo, {
        stts: rsent?.salesSttsCd,
        ty: rsent?.rcptTyCd,
        orgInvc: rsent?.orgInvcNo,
        rsn: rsent?.rfdRsnCd,
      })
    }

    // ── 3. VOID ───────────────────────────────────────────────────
    console.log('\n--- 3. Void / cancel ---')
    const sale2 = await commitSale({
      organizationId: ORG,
      branchId: BRANCH,
      userId: USER,
      customerId: walkin.id,
      items: [item],
      paymentType: 'CASH',
      cashAmount: unitPrice,
      debtAmount: 0,
      insuranceAmount: 0,
      req,
    })
    await waitForOutbox(sale2.completeSale.id, 'SALE')
    const cres = mockRes()
    await cancelSale(
      {
        ...req,
        params: { saleId: String(sale2.completeSale.id), organizationId: String(ORG) },
        body: { reason: 'entered twice by mistake' },
      } as any,
      cres,
    )
    await waitForOutbox(sale2.completeSale.id, 'VOID')
    const voidTx = await prisma.ebmTransaction.findFirst({
      where: { saleId: sale2.completeSale.id, operation: 'VOID' },
      orderBy: { createdAt: 'desc' },
    })
    const voidOb = await prisma.ebmOutbox.findFirst({
      where: { saleId: sale2.completeSale.id, operation: 'VOID' },
      orderBy: { createdAt: 'desc' },
    })
    const vsent = (voidTx?.responseData as any)?.requestPayload
    check('3. Void fiscalized', voidOb?.status === 'SUCCEEDED' && voidTx?.submissionStatus === 'SUCCESS', {
      status: voidOb?.status,
      err: voidOb?.lastError,
    })
    check('3. Void stts=04 fresh invc, orgInvcNo = original', vsent?.salesSttsCd === '04' && Number(vsent?.orgInvcNo) === Number(sale2.completeSale.vsdcInvcNo) && vsent?.invcNo !== vsent?.orgInvcNo && !!vsent?.cnclDt, {
      stts: vsent?.salesSttsCd,
      orgInvc: vsent?.orgInvcNo,
      cnclDt: vsent?.cnclDt,
    })

    // ── 4. B2B purchase code ───────────────────────────────────────
    console.log('\n--- 4. B2B sale with purchase code ---')
    const corpSale = await commitSale({
      organizationId: ORG,
      branchId: BRANCH,
      userId: USER,
      customerId: corp.id,
      items: [item],
      paymentType: 'CASH',
      cashAmount: unitPrice,
      debtAmount: 0,
      insuranceAmount: 0,
      req,
    })
    await waitForOutbox(corpSale.completeSale.id, 'SALE')
    const corpTx = await lastTx(corpSale.completeSale.id)
    const corpSent = (corpTx?.responseData as any)?.requestPayload
    check('4. B2B sale fiscalized', corpTx?.submissionStatus === 'SUCCESS', {
      saleId: corpSale.completeSale.id,
      rcpt: corpTx?.sdcRcptNo,
    })
    check('4. B2B custTin is corporate TIN', corpSent?.custTin === corpTin, { custTin: corpSent?.custTin })
    check('4. B2B prcOrdCd present (6 chars)', typeof corpSent?.prcOrdCd === 'string' && corpSent.prcOrdCd.length === 6, {
      prcOrdCd: corpSent?.prcOrdCd,
    })
    const consumed = await prisma.organizationPurchaseCode.findFirst({
      where: { organizationId: ORG, buyerTin: corpTin, consumedSaleId: corpSale.completeSale.id },
    })
    check('4. Purchase code marked consumed', !!consumed, { code: consumed?.code })

    // ── Reprint / COPY (bonus, not in email but checklist) ─────────
    console.log('\n--- Reprint (COPY) ---')
    const obBefore = await prisma.ebmOutbox.count({ where: { saleId: corpSale.completeSale.id } })
    const pres = mockRes()
    await reprintSaleReceipt(
      { ...req, params: { saleId: String(corpSale.completeSale.id), organizationId: String(ORG) } } as any,
      mockRes(),
    )
    await reprintSaleReceipt(
      { ...req, params: { saleId: String(corpSale.completeSale.id), organizationId: String(ORG) } } as any,
      pres,
    )
    const obAfter = await prisma.ebmOutbox.count({ where: { saleId: corpSale.completeSale.id } })
    check('Reprint is COPY, no new VSDC submit', pres.body?.data?.isCopy === true && obAfter === obBefore, {
      isCopy: pres.body?.data?.isCopy,
    })

    // Cleanup temp customers if needed — leave them for evidence
    console.log('\n=== TECHNICAL SESSION RESULT ===')
    console.log(`Passed: ${pass}`)
    console.log(`Failed: ${fail}`)
    console.log(`Total:  ${pass + fail}`)
    if (fail === 0) {
      console.log('\nReady for the live RRA call: sale, refund, void, B2B all signed by VSDC.')
      console.log('Still manual on the call: open POS UI and scan QR with EBMVerify app.')
    } else {
      console.log('\nFix FAIL lines before the RRA technical session.')
    }
  } finally {
    await restore()
    await prisma.$disconnect()
  }

  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('TECH SESSION FATAL', e)
  await prisma.$disconnect()
  process.exit(2)
})

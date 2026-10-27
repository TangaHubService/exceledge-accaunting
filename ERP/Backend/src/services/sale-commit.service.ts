import { prisma } from "../lib/prisma"
import { EbmOperation } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import { config } from "../config"
import { round2 } from "./money.service"
import { auditLogger } from "../utils/auditLogger"
import { removeStock } from "./inventory-ledger.service"
import {
  generateInvoiceNumber,
  consumeOrgPurchaseCode,
  isEbmEnabled,
  allocateLocalReceiptSequence,
  isValidRraTin,
} from "./rra-ebm.service"
import { buildVsdcEnvelope, vsdcHeartbeat, validateVsdcEnvelope } from "./vsdc-api.service"
import { processEbmOutboxBatch } from "./ebm-outbox.service"
import { selectBatchesForSale, updateBatchQuantity } from "./batch.service"
import { getAverageCost } from "./cost-price.service"
import { TaxService } from "./tax.service"
import { getOrganizationSettings } from "./organization-settings.service"
import {
  type ReceiptMode,
  ReceiptModeMismatchError,
  assertExpectedReceiptMode,
  readReceiptModeLocked,
} from "./training-mode.service"

/**
 * Shared "commit a sale" pipeline used by both the POS checkout
 * (`createSale`) and proforma conversion (`convertProforma`). It owns the
 * server-side gatekeeping, the atomic sale transaction (stock, batches, invoice
 * numbering, outbox) and the bounded inline fiscalization wait.
 *
 * Behaviour is identical to the original inline `createSale` body — the only
 * addition is `proformaSourceId`, stamped on the created sale when the sale is
 * the NS result of converting a proforma.
 */

export type CommitSaleItemInput = {
  productId?: number | string | null
  quantity: number
  unitPrice: number
  /** Line discount amount (absolute money, tax-inclusive). Accepted by the
   *  sales validation schema and read at commit time (dcAmt/dcRate
   *  reconstruction) — declared here so the server-side pipeline typechecks. */
  discount?: number
  itemType?: "PRODUCT" | "RAW_MATERIAL" | "SERVICE"
  serviceName?: string | null
  serviceDescription?: string | null
  measurementUnit?: string | null
  exemptionReference?: string | null
}

export type CommitSalePayment = {
  paymentMethod: string
  amount: number
  reference?: string | null
  metadata?: Record<string, unknown> | null
}

export interface CommitSaleParams {
  organizationId: number
  branchId: number
  userId: number
  customerId: number
  items: CommitSaleItemInput[]
  paymentType?: string
  cashAmount?: number
  debtAmount?: number
  insuranceAmount?: number
  payments?: CommitSalePayment[]
  shiftId?: number | string | null
  isProforma?: boolean
  /** Set when this NS sale is the conversion result of a proforma. */
  proformaSourceId?: number
  inventoryMethod?: "FIFO" | "LIFO" | "AVERAGE"
  /** Mode the client screen was in (TRAINING/NORMAL); a mismatch is refused. */
  expectedReceiptMode?: ReceiptMode | null
  /** Express request — used only for audit-log request context. */
  req: any
}

export interface CommitSaleResult {
  sale: any
  completeSale: any
  fiscalization: { status: "success" | "pending" | "failed"; sdcRcptNo: number | null; isCertified: boolean }
}

/** A client/business-rule failure that maps to a specific HTTP status. */
export class CommitSaleError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "CommitSaleError"
    this.statusCode = statusCode
  }
}

export async function commitSale(params: CommitSaleParams): Promise<CommitSaleResult> {
  const {
    organizationId,
    branchId,
    userId,
    customerId,
    items,
    paymentType,
    cashAmount,
    debtAmount,
    insuranceAmount,
    payments: splitPayments,
    shiftId,
    isProforma,
    proformaSourceId,
    expectedReceiptMode,
    req,
  } = params

  const orgSettings = await getOrganizationSettings(organizationId)

  if (!items || items.length === 0) {
    throw new CommitSaleError(400, "Sale must have at least one item")
  }

  // If a shiftId was supplied, it must be this user's own open shift — prevents
  // attributing a sale to someone else's till or an already-closed shift.
  let resolvedShiftId: number | undefined
  if (shiftId !== undefined && shiftId !== null && shiftId !== "") {
    const shift = await prisma.shift.findFirst({
      where: { id: parseInt(String(shiftId)), organizationId, userId, status: { in: ["OPEN", "REOPENED"] } },
      select: { id: true },
    })
    if (!shift) {
      throw new CommitSaleError(400, "Shift is not open or does not belong to you")
    }
    resolvedShiftId = shift.id
  } else {
    // Business rule: every transaction belongs to a shift. When the caller does
    // not supply one, attach this user's currently active shift (if any).
    const active = await prisma.shift.findFirst({
      where: { organizationId, userId, status: { in: ["OPEN", "REOPENED"] } },
      orderBy: { openedAt: "desc" },
      select: { id: true },
    })
    resolvedShiftId = active?.id
  }

  // ── B2B purchase-code pre-check ──
  // RRA rejects (resultCd 881/882, verified against the sandbox) any
  // business-buyer sale submitted without a valid 6-character prcOrdCd.
  // Catching this before the sale commits avoids completing a checkout
  // (payment taken, stock deducted) that can never be fiscalized. Skipped for
  // proforma: a quote stays editable/convertible and its code is allocated at
  // submission time (step 4b / outbox worker) instead of blocking creation.
  if (!isProforma && isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { TIN: true, prcOrdCd: true, customerType: true, name: true },
    })
    const custTin = customer?.TIN?.trim() ?? ""
    const customerType = (customer?.customerType ?? "INDIVIDUAL").toUpperCase()
    // Business buyers must present a real, valid RRA TIN: a fiscal receipt
    // without one can never be accepted (910/884), so fail fast at checkout
    // instead of completing a sale that can never be fiscalized. Walk-in
    // individuals without a TIN are still served (see resolveCustTinForVsdc).
    if (customerType !== "INDIVIDUAL" && !isValidRraTin(custTin)) {
      throw new CommitSaleError(
        400,
        `This ${customerType.toLowerCase()} customer ("${customer?.name ?? customerId}") has no valid 9-digit RRA TIN. Register the customer's real TIN before completing a fiscal sale.`,
      )
    }
    // B2B purchase-code pre-check: a business buyer needs a real 6-character
    // prcOrdCd on record (pool or customer fallback), otherwise the receipt
    // can never be accepted (881/882). Individuals skip this — their code is
    // allocated at submission time (sandbox mints buyer-scoped codes outside
    // production; production B2C requirements must be confirmed with RRA).
    const needsCode = customerType === "CORPORATE" || customerType === "INSURANCE"
    if (needsCode) {
      const poolCount = await prisma.organizationPurchaseCode.count({
        where: { organizationId, buyerTin: custTin, consumed: false },
      })
      const fallbackCode = customer?.prcOrdCd?.trim()
      const hasValidFallback = !!fallbackCode && fallbackCode.length === 6
      if (poolCount === 0 && !hasValidFallback) {
        throw new CommitSaleError(
          400,
          `This customer has a business TIN (${custTin}) but no RRA purchase order code on file. Add a 6-character purchase code for this customer before completing the sale.`,
        )
      }
    }
  }

  // The catalog itemType is authoritative for catalog lines: a client-supplied
  // "SERVICE" must never let goods skip the stock check (RRA CIS spec 7.30).
  const catalogIds = items
    .map((i: any) => parseInt(String(i.productId)))
    .filter((id: number) => !isNaN(id))
  const catalogTypes = catalogIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: catalogIds }, organizationId },
        select: { id: true, itemType: true, itemCd: true, itemClsCd: true, name: true },
      })
    : []
  const catalogTypeMap = new Map(catalogTypes.map((p) => [p.id, p.itemType]))
  const catalogMetaMap = new Map(catalogTypes.map((p) => [p.id, p]))
  for (const item of items) {
    const pid = parseInt(String(item.productId))
    const fromCatalog = catalogTypeMap.get(pid)
    if (fromCatalog) item.itemType = fromCatalog
  }

  // ── Fail-fast fiscal readiness ──
  // A sale whose lines lack an RRA itemCd/itemClsCd can never be fiscalized:
  // without this gate the checkout would commit (stock, payment) and only the
  // outbox worker would dead-letter afterwards. When fiscal submission is on,
  // reject such sales here with an actionable 400 instead. Ad-hoc service
  // lines (no catalog product) are likewise unfiscalizable — services must be
  // registered in the catalog with an RRA classification first.
  if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
    for (const item of items) {
      const pid = parseInt(String(item.productId))
      const meta = Number.isSafeInteger(pid) ? catalogMetaMap.get(pid) : undefined
      const label = (item.serviceName || (meta as any)?.name || `line (product #${item.productId ?? "?"})`) as string
      if (item.itemType === "SERVICE" && !meta) {
        throw new CommitSaleError(
          400,
          `Service "${label}" is not registered in the product catalog. Register it with an RRA item classification (itemClsCd) and sync it to RRA before selling — ad-hoc service lines cannot be fiscalized.`,
        )
      }
      if (meta && (!(meta as any).itemCd || !(meta as any).itemClsCd?.trim())) {
        const missing = !(meta as any).itemCd && !(meta as any).itemClsCd?.trim()
          ? "RRA item code (itemCd) and item classification (itemClsCd)"
          : !(meta as any).itemCd
            ? "RRA item code (itemCd)"
            : "RRA item classification (itemClsCd)"
        throw new CommitSaleError(
          400,
          `Cannot fiscalize: "${(meta as any).name ?? `product #${pid}`}" has no ${missing}. Open the product, save it so the code is allocated, sync it via POST /rra/items/:productId/sync, then retry the sale.`,
        )
      }
    }
  }

  // Separate product items from service items
  const productItems = items.filter((i: any) => i.itemType !== "SERVICE")

  // ── Server-side mathematical gatekeeper (Module 2.2) ──
  const clientTotal = items.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitPrice), 0)

  const calculatedDebt = clientTotal - (cashAmount || 0) - (insuranceAmount || 0)
  if (Math.abs(calculatedDebt - (debtAmount || 0)) > 0.01) {
    throw new CommitSaleError(
      400,
      "Payment amounts do not match total. Total must equal cashAmount + insuranceAmount + debtAmount",
    )
  }

  // Fetch all products once up-front for tax calculation
  const productIds = productItems
    .map((i: any) => parseInt(i.productId))
    .filter((id: number) => !isNaN(id))

  const products = productIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, organizationId },
        select: { id: true, unitPrice: true, taxCategory: true, taxCode: true, name: true },
      })
    : []

  const productMap = new Map(products.map((p) => [p.id, p]))

  // When the org disallows manual discounts, sellers may not submit a unit price
  // below the catalog price.
  if (!orgSettings.featureFlags.allowManualDiscounts) {
    for (const item of productItems) {
      const product = productMap.get(parseInt(String(item.productId)))
      if (!product) continue
      const catalogPrice = Number(product.unitPrice)
      if (Number(item.unitPrice) < catalogPrice - 0.01) {
        throw new CommitSaleError(
          400,
          `Manual price overrides are disabled for this organization. "${product.name}" must be sold at ${catalogPrice}.`,
        )
      }
    }
  }

  // Automatically determine paymentType if multiple payment methods are used
  let finalPaymentType = paymentType
  const hasCash = (cashAmount || 0) > 0
  const hasInsurance = (insuranceAmount || 0) > 0
  const hasDebt = (debtAmount || 0) > 0
  const paymentMethodCount = [hasCash, hasInsurance, hasDebt].filter(Boolean).length

  if (paymentType === "MOBILE_MONEY" || paymentType === "CREDIT_CARD") {
    if (hasCash && !hasInsurance && !hasDebt) {
      finalPaymentType = paymentType
    } else if (paymentMethodCount > 1) {
      finalPaymentType = "MIXED"
    }
  } else if (paymentMethodCount > 1 && paymentType !== "MIXED") {
    finalPaymentType = "MIXED"
  } else if (hasDebt && !hasCash && !hasInsurance) {
    finalPaymentType = "DEBT"
  } else if (hasInsurance && !hasCash && !hasDebt) {
    finalPaymentType = "INSURANCE"
  } else if (hasCash && !hasInsurance && !hasDebt && !paymentType) {
    finalPaymentType = "CASH"
  }

  // Sale number now; invoice number is allocated inside the transaction below so
  // that a rollback also rolls back the sequence increment.
  const saleNumber = `SALE-${Date.now()}`

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { vatRegistered: true, isTaxExempt: true },
  })

  // ── Strict fiscal mode (2018 spec Art. 10, strict reading) ──
  // When EBM_STRICT_MODE is on, the sale is not created at all unless the VSDC
  // is provably reachable: the device envelope is validated and the device is
  // probed with a live heartbeat BEFORE anything commits (stock, payments,
  // numbering). Default mode keeps the transactional-outbox behavior instead
  // (sale completes, official receipt withheld with HTTP 425 until confirmed).
  // Training receipts go through VSDC too (CIS §6/§10), so they are not exempt.
  if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled && config.ebm.strictMode) {
    const envelope = await buildVsdcEnvelope(organizationId, branchId)
    const envelopeError = validateVsdcEnvelope(envelope)
    if (envelopeError) {
      throw new CommitSaleError(503, `VSDC not ready (strict fiscal mode): ${envelopeError} Sale not created.`)
    }
    const probe = await vsdcHeartbeat(envelope)
    if (!probe.success) {
      throw new CommitSaleError(
        503,
        `VSDC unreachable (strict fiscal mode): ${probe.error ?? "no response"}. Sale not created — restore connectivity and retry.`,
      )
    }
  }

  const inventoryMethod = params.inventoryMethod || "FIFO"

  // ── Atomic transaction ──
  let trainingMode = false
  const sale = await prisma.$transaction(
    async (tx) => {
      // C6: receipt type label (NS/TS/PS). The mode is read under a shared
      // lock so an admin toggle cannot land between this read and the commit.
      trainingMode = await readReceiptModeLocked(tx, organizationId)
      try {
        assertExpectedReceiptMode(expectedReceiptMode ?? null, trainingMode)
      } catch (e) {
        if (e instanceof ReceiptModeMismatchError) throw new CommitSaleError(e.status, e.message)
        throw e
      }
      const rcptLabel = isProforma ? "PS" : trainingMode ? "TS" : "NS"

      // 1. Validate stock availability for PRODUCT items only
      for (const item of productItems) {
        const product = productMap.get(parseInt(String(item.productId)))

        if (!product) {
          throw new Error(`Product with ID ${item.productId} not found`)
        }

        const stockAggregates = await tx.inventoryLedger.groupBy({
          by: ["direction"],
          where: {
            productId: parseInt(String(item.productId)),
            organizationId: organizationId,
            branchId: { equals: branchId },
          },
          _sum: { quantity: true },
        })

        const inQty = stockAggregates.find((a) => a.direction === "IN")?._sum.quantity || 0
        const outQty = stockAggregates.find((a) => a.direction === "OUT")?._sum.quantity || 0
        const currentStock = Number(inQty) - Number(outQty)

        if (
          currentStock < item.quantity
          && !orgSettings.featureFlags.allowNegativeStock
          && !trainingMode
          && !isProforma
        ) {
          throw new Error(
            `Insufficient stock for product ${product.name}. Available: ${currentStock}, Requested: ${item.quantity}`,
          )
        }
      }

      // 2. Server-side tax computation with Decimal arithmetic.
      const allItemsForTax = items.map((i: any) => ({
        productId: i.productId ? parseInt(i.productId) : undefined,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        itemType: i.itemType || "PRODUCT",
      }))
      const taxSummary = await TaxService.calculateSaleTax(
        organizationId,
        allItemsForTax as any,
        org?.vatRegistered ?? false,
        org?.isTaxExempt ?? false,
      )

      // ── MODULE 2.2: Reconcile server-computed total vs client total ──
      const computedTotal = taxSummary.items.reduce(
        (sum, ti) => sum + Number(ti.taxableAmount) + Number(ti.taxAmount),
        0,
      )
      if (Math.abs(computedTotal - clientTotal) > 0.01) {
        throw new Error(
          `Total amount mismatch: server computed ${computedTotal.toFixed(2)}, client submitted ${clientTotal.toFixed(2)}`,
        )
      }

      // R9: per-rate legs for the server record, aggregated from the same
      // net-based item math as the VSDC payload (exact Decimal sums, rounded
      // once per band — money.service policy). NOTE on naming: RRA `taxblAmt`
      // is the VAT-INCLUSIVE band base (band NET sales, totTaxblAmt == totAmt),
      // not the VAT-exclusive figure in `taxableAmount`.
      const rateBands: Record<string, { net: Decimal; tax: Decimal }> = {}
      for (const ti of taxSummary.items) {
        const slot = rateBands[ti.taxCode] ?? { net: new Decimal(0), tax: new Decimal(0) }
        slot.net = slot.net.plus(ti.taxableAmount).plus(ti.taxAmount)
        slot.tax = slot.tax.plus(ti.taxAmount)
        rateBands[ti.taxCode] = slot
      }
      const bandOf = (code: string) => rateBands[code] ?? { net: new Decimal(0), tax: new Decimal(0) }

      // 3. Select batches and calculate costs for PRODUCT items only
      const saleItemsData: any[] = []

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const isService = item.itemType === "SERVICE"
        const quantity = item.quantity
        const chargedUnit = Number(item.unitPrice)
        const dcAmt = Math.max(0, Number(item.discount ?? 0))
        const unitPrice = quantity > 0 ? chargedUnit + dcAmt / quantity : chargedUnit
        const dcRate = unitPrice > 0 && quantity > 0 ? Math.round(((dcAmt / quantity) / unitPrice) * 10000) / 100 : 0
        const lineTotal = chargedUnit * quantity
        const itemTax = taxSummary.items[i]

        if (isService) {
          const serviceProductId =
            item.productId != null && String(item.productId).trim() !== ""
              ? parseInt(String(item.productId), 10)
              : NaN
          const hasCatalogService =
            Number.isSafeInteger(serviceProductId) && serviceProductId > 0

          saleItemsData.push({
            quantity,
            unitPrice,
            totalPrice: lineTotal,
            dcRate,
            dcAmt,
            costPrice: 0,
            profit: lineTotal,
            taxRate: itemTax?.taxRate || 0,
            taxAmount: itemTax?.taxAmount || 0,
            taxCode: itemTax?.taxCode || null,
            itemType: "SERVICE",
            serviceName: item.serviceName || null,
            serviceDescription: item.serviceDescription || null,
            measurementUnit: item.measurementUnit || "PCS",
            exemptionReference: item.exemptionReference || null,
            // Catalog services must keep productId so saveSales can send
            // itemCd / itemClsCd from the registered RRA item (VSDC §3.3.4.1).
            ...(hasCatalogService
              ? { product: { connect: { id: serviceProductId } } }
              : {}),
          })
          continue
        }

        const productId = parseInt(String(item.productId))
        let batchId: number | null = null
        let costPrice = 0

        try {
          // Training and proforma never deplete real batches (cost falls back to average).
          const selectedBatches = trainingMode || isProforma ? [] : await selectBatchesForSale(
            {
              productId,
              organizationId: organizationId,
              quantity,
              method: inventoryMethod,
              branchId: branchId,
            },
            tx,
          )

          if (selectedBatches.length > 0) {
            batchId = selectedBatches[0].batchId
            costPrice = selectedBatches[0].unitCost

            for (const batch of selectedBatches) {
              await updateBatchQuantity(batch.batchId, batch.quantity, organizationId, tx)
            }
          } else {
            const avgCost = await getAverageCost(productId, organizationId, branchId)
            costPrice = avgCost?.averageCost || 0
          }
        } catch (error: any) {
          const avgCost = await getAverageCost(productId, organizationId, branchId)
          costPrice = avgCost?.averageCost || 0
        }

        const profit = lineTotal - costPrice * quantity

        saleItemsData.push({
          quantity,
          unitPrice,
          totalPrice: lineTotal,
          dcRate,
          dcAmt,
          costPrice,
          profit,
          taxRate: itemTax.taxRate,
          taxAmount: itemTax.taxAmount,
          taxCode: itemTax.taxCode,
          itemType: item.itemType || "PRODUCT",
          measurementUnit: item.measurementUnit || "PCS",
          exemptionReference: item.exemptionReference || null,
          product: { connect: { id: productId } },
          ...(batchId !== null ? { batch: { connect: { id: batchId } } } : {}),
        })
      }

      // 4. Allocate an invoice/receipt number and create the sale together.
      //
      // EVERY receipt type — normal (NS), training (TS/TR) and proforma (PS) —
      // is submitted to RRA VSDC, so every sale draws from the real gapless
      // per-device sequence: the invoice number printed on the receipt is
      // exactly the invcNo sent to VSDC. Proforma additionally keeps its local
      // non-fiscal counter pair (localReceiptSeq / localReceiptTotalSeq) as the
      // fallback receipt number until VSDC confirms the submission. Training
      // does not: its TS/TR counter is issued by VSDC and never invented here.
      const generated = await generateInvoiceNumber(organizationId, branchId, tx)
      const invoiceNumber: string = generated.invoiceNumber
      const vsdcInvcNo: number = generated.vsdcInvcNo
      let localReceiptSeq: number | null = null
      let localReceiptTotalSeq: number | null = null
      if (isProforma) {
        const localSeq = await allocateLocalReceiptSequence(branchId, "PS", tx)
        localReceiptSeq = localSeq.typeSeq
        localReceiptTotalSeq = localSeq.totalSeq
      }

      const newSale = await tx.sale.create({
        data: {
          saleNumber,
          invoiceNumber,
          vsdcInvcNo,
          localReceiptSeq,
          localReceiptTotalSeq,
          customerId: customerId,
          userId: userId,
          organizationId: organizationId,
          branchId: branchId as any,
          paymentType: finalPaymentType,
          cashAmount: cashAmount || 0,
          insuranceAmount: insuranceAmount || 0,
          debtAmount: debtAmount || 0,
          // A training sale takes no real money, so it never joins a till shift.
          shiftId: trainingMode && !isProforma ? undefined : resolvedShiftId,
          totalAmount: computedTotal,
          vatAmount: taxSummary.vatAmount,
          taxableAmount: taxSummary.taxableAmount,
          taxblAmtA: round2(bandOf("A").net),
          taxblAmtB: round2(bandOf("B").net),
          taxblAmtC: round2(bandOf("C").net),
          taxblAmtD: round2(bandOf("D").net),
          taxAmtA: round2(bandOf("A").tax),
          taxAmtB: round2(bandOf("B").tax),
          taxAmtC: round2(bandOf("C").tax),
          taxAmtD: round2(bandOf("D").tax),
          status: "COMPLETED",
          isProforma: !!isProforma,
          rcptLabel: rcptLabel as any,
          ...(proformaSourceId != null ? { proformaSourceId } : {}),
          saleItems: { create: saleItemsData },
        },
        include: {
          saleItems: { include: { product: true, batch: true } },
          customer: true,
        },
      } as any)

      // 4b. Consume an organization-level RRA purchase code for business (B2B)
      // buyers — for every receipt type, since training and proforma are
      // fiscalized through VSDC like normal sales and need a code on record.
      const custTin = (newSale as any).customer?.TIN?.trim() ?? ""
      if (custTin && !custTin.startsWith("7")) {
        const allocated =
          (await consumeOrgPurchaseCode(organizationId, custTin, (newSale as any).id, tx)) ??
          ((newSale as any).customer?.prcOrdCd ?? null)
        if (allocated) {
          await tx.sale.update({
            where: { id: (newSale as any).id },
            data: { prcOrdCd: allocated },
          })
          ;(newSale as any).prcOrdCd = allocated
        }
      }

      // 5. Record stock movements for PRODUCT items only. Skipped for
      // proforma and training mode — neither is a real sale, so neither
      // may consume (or fail on) real stock.
      if (!isProforma && !trainingMode) {
        for (const item of productItems) {
          const saleItem = (newSale as any).saleItems?.find(
            (si: any) => si.productId === parseInt(String(item.productId)),
          )
          if (!saleNumber || saleNumber.trim().length === 0) {
            throw new Error("Stock movement reference cannot be empty")
          }
          await removeStock({
            organizationId: organizationId,
            productId: parseInt(String(item.productId)),
            userId: userId,
            quantity: item.quantity,
            movementType: "SALE",
            branchId: branchId as any,
            reference: saleNumber,
            referenceType: "SALE",
            note: `Sale #${saleNumber}`,
            batchId: saleItem?.batchId || null,
            unitCost: saleItem?.costPrice != null ? Number(saleItem.costPrice) : null,
            tx,
          })
        }
      }

      // 6. Update customer balance if debt (atomic with sale). Skipped for
      // proforma and training — neither creates a real receivable.
      if (!isProforma && !trainingMode) {
        const remainingDebt = computedTotal - (cashAmount || 0) - (insuranceAmount || 0)
        if (remainingDebt > 0) {
          await tx.customer.update({
            where: { id: customerId },
            data: { balance: { increment: remainingDebt } },
          })
        }
      }

      // 7. Write transactional outbox entry (atomic with the sale) for every
      // receipt type — normal, training and proforma are all fiscalized
      // through VSDC, so all of them need a submission row.
      if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
        const operation: EbmOperation = "SALE"
        const idempotencyKey = `ebm-${operation}-${organizationId}-${newSale.id}`
        await tx.ebmOutbox.create({
          data: {
            organizationId: organizationId,
            saleId: newSale.id,
            operation,
            idempotencyKey,
            payload: { version: 1, saleId: newSale.id, organizationId: organizationId, operation } as any,
            status: "PENDING",
            nextAttemptAt: new Date(),
          },
        })
      }

      return newSale
    },
    {
      maxWait: 30000,
      timeout: 60000,
    },
  )

  // Bounded wait for the outbox worker to attempt fiscalization before
  // returning, so the caller knows whether the receipt is safe to print.
  let fiscalization: CommitSaleResult["fiscalization"] = {
    status: "success",
    sdcRcptNo: null,
    isCertified: false,
  }

  if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
    const EBM_INLINE_WAIT_MS = 5000
    await Promise.race([
      processEbmOutboxBatch(5).catch((e) => {
        console.error("[EBM] immediate fiscalization error:", e)
      }),
      new Promise((resolve) => setTimeout(resolve, EBM_INLINE_WAIT_MS)),
    ])

    const [outboxRow, fiscalTx] = await Promise.all([
      prisma.ebmOutbox.findFirst({
        where: { saleId: sale.id, operation: "SALE" },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      }),
      prisma.ebmTransaction.findFirst({
        where: { saleId: sale.id, submissionStatus: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select: { sdcRcptNo: true },
      }),
    ])

    if (outboxRow?.status === "SUCCEEDED" && fiscalTx?.sdcRcptNo != null) {
      fiscalization = { status: "success", sdcRcptNo: fiscalTx.sdcRcptNo, isCertified: true }
    } else if (outboxRow?.status === "DEAD_LETTER" || outboxRow?.status === "SUCCEEDED") {
      fiscalization = { status: "failed", sdcRcptNo: null, isCertified: false }
    } else {
      fiscalization = { status: "pending", sdcRcptNo: null, isCertified: false }
    }
  }

  const isTrainingSale = (sale as any).rcptLabel === "TS"
  const isProformaSale = !!isProforma || (sale as any).rcptLabel === "PS"

  // Record split payments if provided. Training and proforma move no real money.
  if (!isTrainingSale && !isProformaSale && splitPayments && Array.isArray(splitPayments) && splitPayments.length > 0) {
    const validPaymentMethods = [
      "CASH", "BANK", "BANK_CHECK", "CARD", "PAYPACK", "MTN_MOMO", "AIRTEL_MONEY", "WALLET", "GIFT_CARD", "STORE_CREDIT",
    ]

    for (const pmt of splitPayments) {
      if (!validPaymentMethods.includes(pmt.paymentMethod)) continue
      const amount = Number(pmt.amount) || 0
      if (amount <= 0) continue

      await prisma.salePayment.create({
        data: {
          saleId: sale.id,
          organizationId,
          amount,
          paymentMethod: pmt.paymentMethod as any,
          reference: pmt.reference || null,
          status: "COMPLETED",
          processedAt: new Date(),
          metadata: (pmt.metadata as any) || null,
        },
      })
    }
  }

  // Log activity (after successful sale)
  await auditLogger.sales(req, {
    type: "SALE_COMPLETED",
    description: `${isTrainingSale ? "Training sale (TS)" : isProformaSale ? "Proforma (PS)" : "Sale"} completed (Invoice #${sale.invoiceNumber || saleNumber})`,
    entityType: "Sale",
    entityId: sale.id,
    metadata: {
      rcptLabel: (sale as any).rcptLabel ?? null,
      invoiceNumber: sale.invoiceNumber,
      totalAmount: sale.totalAmount,
      paymentType: sale.paymentType,
      splitPayments: splitPayments?.length || 0,
      ...(proformaSourceId != null ? { convertedFromProformaId: proformaSourceId } : {}),
    },
  })

  // Thin Accounting integration — enqueue only; Accounting owns journal posting.
  // Training and proforma sales are never posted to the books.
  if (!isTrainingSale && !isProformaSale) {
    try {
      const { enqueueSaleCompletedAccountingEvent } = await import("./accounting-outbox.service")
      const saleItemsForCogs = await prisma.saleItem.findMany({
        where: { saleId: sale.id },
        select: { quantity: true, costPrice: true },
      })
      const cogs = saleItemsForCogs.reduce(
        (sum, item) => sum + Number(item.costPrice || 0) * Number(item.quantity || 0),
        0,
      )
      // Accounting needs every part of the total: what was paid (by method), what is owed, and what insurance covers.
      const total = Number(sale.totalAmount)
      const debtPart = Number((sale as any).debtAmount ?? debtAmount ?? 0) || 0
      const insurancePart = Number((sale as any).insuranceAmount ?? insuranceAmount ?? 0) || 0
      const paidPart = Math.max(0, total - debtPart - insurancePart)
      const paidSplits = (splitPayments ?? [])
        .map((p) => ({ paymentMethod: String(p.paymentMethod), amount: Number(p.amount) || 0 }))
        .filter((p) => p.amount > 0)
      const paidSplitsTotal = paidSplits.reduce((sum, p) => sum + p.amount, 0)
      const paidMethod = ["MOBILE_MONEY", "CREDIT_CARD", "CARD", "BANK", "BANK_TRANSFER", "MTN_MOMO", "AIRTEL_MONEY"].includes(String(sale.paymentType))
        ? String(sale.paymentType)
        : "CASH"
      const accountingSplits = [
        ...(paidSplits.length && Math.abs(paidSplitsTotal - paidPart) <= 0.5
          ? paidSplits
          : paidPart > 0
            ? [{ paymentMethod: paidMethod, amount: paidPart }]
            : []),
        ...(debtPart > 0 ? [{ paymentMethod: "DEBT", amount: debtPart }] : []),
        ...(insurancePart > 0 ? [{ paymentMethod: "INSURANCE", amount: insurancePart }] : []),
      ]
      await enqueueSaleCompletedAccountingEvent({
        organizationId,
        branchId,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        invoiceNumber: sale.invoiceNumber,
        customerId: sale.customerId,
        totalAmount: Number(sale.totalAmount),
        taxableAmount: Number(sale.taxableAmount),
        vatAmount: Number(sale.vatAmount),
        paymentType: sale.paymentType,
        splitPayments: accountingSplits,
        cogs,
      })
    } catch (e) {
      console.error("[Accounting outbox] enqueue failed:", e)
    }
  }

  const completeSale = await prisma.sale.findUnique({
    where: { id: sale.id },
    include: {
      saleItems: { include: { product: true, batch: true } },
      customer: true,
      salePayments: true,
    },
  })

  return { sale, completeSale, fiscalization }
}

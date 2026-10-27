import { prisma } from "../lib/prisma"
import type { Response } from "express"
import type { BranchAuthRequest } from "../middleware/branchAuth.middleware"
import { Decimal } from "@prisma/client/runtime/library"
import { EbmOperation } from "@prisma/client"
import { auditLogger } from "../utils/auditLogger"
import { removeStock, addStock } from "../services/inventory-ledger.service"
import {
  generateInvoiceNumber,
  consumeOrgPurchaseCode,
  isEbmEnabled,
  allocateLocalReceiptSequence,
  resolveVsdcBuyerIdentity,
} from "../services/rra-ebm.service"
import { processEbmOutboxBatch } from "../services/ebm-outbox.service"
import { selectBatchesForSale, updateBatchQuantity } from "../services/batch.service"
import { calculateProfit } from "../services/profit.service"
import { getAverageCost } from "../services/cost-price.service"
import { buildBranchFilter, getBranchIdForOperation, resolveBranchIdForWrite } from "../middleware/branchAuth.middleware"
import { success, error as apiError } from "../utils/apiResponse"
import { configuredMrc, resolveReportMrc } from "../utils/mrc"
import { TaxService } from "../services/tax.service"
import { round2 } from "../services/money.service"
import { getOrganizationSettings } from "../services/organization-settings.service"
import { renderSalesInvoiceHtml, type RenderInvoicePayload } from "../services/invoice-render.service"
import { kigaliWallParts } from "../services/invoice-format.service"
import { generateEbmInvoicePdf, getEbmInvoiceFilename, type InvoicePdfFormat, bandTaxAmounts } from "../services/invoice-pdf.service"
import { generateEbmReceiptPdf80mm } from "../services/invoice-receipt-pdf.service"
import { commitSale, CommitSaleError } from "../services/sale-commit.service"
import {
  assertOriginalConfirmed,
  assertOriginalRefundable,
  assertRefundReason,
  formatOriginalReceiptReference,
  planRefundLines,
  remainingByLine,
  summarizeRefund,
  RefundRuleError,
} from "../services/refund-calculation.service"
import { getTaxRatesBySlot } from "../services/rra-code.service"
import { validateRefundReasonCodeForOrg, DEFAULT_RFD_RSN_CD } from "../services/rra-code.service"
import { SYSTEM_FOOTER, SYSTEM_POWERED_BY, CIS_VERSION_LABEL } from "../services/system-branding.service"
import { getOrganizationLogo } from "../services/invoice-logo.service"
import {
  ReceiptCopyError,
  applyCopyDesignation,
  assertCopyableFiscalRecord,
  copyLabelFor,
  nextReprintCountForCopy,
  resolveCopyLabel,
} from "../services/receipt-copy.service"
import {
  ReceiptModeMismatchError,
  assertExpectedReceiptMode,
  isTrainingLabel,
  isUnsignedLabel,
  parseExpectedReceiptMode,
  readReceiptModeLocked,
  refundLabelForOriginal,
} from "../services/training-mode.service"
import {
  readVsdcRecord,
  vsdcBuyer,
  vsdcInvoiceNumber,
  vsdcItemForLine,
  vsdcItems,
  vsdcMrcNo,
  vsdcOriginalInvoiceNumber,
  vsdcReceiptNumber,
  vsdcSdcId,
  vsdcTaxRates,
} from "../services/vsdc-receipt-parity.service"
import QRCode from "qrcode"
import { randomUUID } from "crypto"
import { enqueueCustomerPaymentAccountingEvent, enqueueSaleRefundedAccountingEvent } from "../services/accounting-outbox.service"

export const createSale = async (req: BranchAuthRequest, res: Response) => {
  try {
    const { customerId, items, paymentType, cashAmount, debtAmount, insuranceAmount, isProforma, payments: splitPayments, shiftId, inventoryMethod, receiptMode } = req.body
    // @ts-ignore
    const userId = parseInt(req.user?.userId as string)
    const organizationId = parseInt(req.params.organizationId)
    const branchId = await resolveBranchIdForWrite(req)

    const { sale, completeSale, fiscalization } = await commitSale({
      organizationId,
      branchId: branchId as number,
      userId,
      customerId: parseInt(customerId),
      items,
      paymentType,
      cashAmount,
      debtAmount,
      insuranceAmount,
      payments: splitPayments,
      shiftId,
      isProforma: !!isProforma,
      inventoryMethod,
      expectedReceiptMode: parseExpectedReceiptMode(receiptMode),
      req,
    })

    res.status(201).json(success({ ...(completeSale ?? sale), fiscalization }))
  } catch (error: any) {
    if (error instanceof CommitSaleError) {
      return res.status(error.statusCode).json(apiError(error.message))
    }

    console.error("[Create Sale Error]:", error)

    // Return appropriate status code based on error type
    if (error.message && error.message.includes('Insufficient stock')) {
      return res.status(400).json(apiError(error.message || "Insufficient stock"))
    }

    if (error.message && error.message.includes('not found')) {
      return res.status(404).json(apiError(error.message || "Resource not found"))
    }

    if (error.code === 'P2002' && error.message?.includes('invoice_number')) {
      return res.status(500).json(apiError("Invoice number conflict. Please try again."))
    }

    res.status(500).json(apiError("Failed to create sale"))
  }
}

/**
 * Recompute a proforma's line items / customer before it is converted.
 * A proforma never touched inventory or the customer balance, so this is a
 * pure recompute: replace saleItems, refresh totals. Only allowed while the
 * proforma has not been converted yet AND VSDC has not confirmed it — a
 * VSDC-signed proforma is immutable (like any fiscalized receipt), otherwise
 * the printed invoice would no longer match what was sent to RRA. Pass edited
 * lines to the convert endpoint instead.
 *
 * PUT /:organizationId/:saleId/proforma   body: { customerId?, items: [...] }
 */
export const updateProforma = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId)
    const saleId = parseInt(req.params.saleId)
    const { customerId, items } = req.body as {
customerId?: number
  items: Array<{ productId?: number; quantity: number; unitPrice: number; itemType?: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE'; serviceName?: string; serviceDescription?: string; measurementUnit?: string }>
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json(apiError("A proforma must have at least one item"))
    }

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      include: { convertedSale: { select: { id: true } } },
    })
    if (!sale) return res.status(404).json(apiError("Proforma not found"))
    if (!sale.isProforma) return res.status(400).json(apiError("Only a proforma can be edited this way"))
    if (sale.status === 'CONVERTED' || sale.convertedSale) {
      return res.status(409).json(apiError("This proforma has already been converted to a sale"))
    }
    // RRA checklist §28: a VSDC-signed receipt must never be modified. The
    // proforma is fiscalized at creation, so once its outbox row SUCCEEDED its
    // lines are frozen — convert with edited lines instead.
    const proformaOutbox = await prisma.ebmOutbox.findFirst({
      where: { saleId, operation: 'SALE' },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    if (proformaOutbox?.status === 'SUCCEEDED') {
      return res.status(409).json(apiError(
        "This proforma has already been confirmed by RRA VSDC and can no longer be edited. Convert it to a sale, passing the corrected lines in the convert request.",
      ))
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { vatRegistered: true, isTaxExempt: true },
    })

    const itemsForTax = items.map((i) => ({
      productId: i.productId ? Number(i.productId) : undefined,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      itemType: i.itemType || 'PRODUCT',
    }))
    const taxSummary = await TaxService.calculateSaleTax(
      organizationId,
      itemsForTax as any,
      org?.vatRegistered ?? false,
      org?.isTaxExempt ?? false,
    )
    const computedTotal = taxSummary.items.reduce(
      (sum, ti) => sum + Number(ti.taxableAmount) + Number(ti.taxAmount),
      0,
    )

    const saleItemsData = items.map((i, idx) => {
      const t = taxSummary.items[idx]
      const isService = (i.itemType || 'PRODUCT') === 'SERVICE'
      const quantity = Number(i.quantity)
      const unitPrice = Number(i.unitPrice)
      return {
        quantity,
        unitPrice,
        totalPrice: quantity * unitPrice,
        costPrice: 0,
        profit: 0,
        taxRate: t?.taxRate ?? 0,
        taxAmount: t?.taxAmount ?? 0,
        taxCode: (t?.taxCode as any) ?? null,
        itemType: isService ? 'SERVICE' : 'PRODUCT',
        measurementUnit: (i.measurementUnit as any) || 'PCS',
        serviceName: isService ? (i.serviceName || null) : null,
        serviceDescription: isService ? (i.serviceDescription || null) : null,
        // Services from the catalog still need productId for RRA itemClsCd/itemCd.
        ...(i.productId
          ? { product: { connect: { id: Number(i.productId) } } }
          : {}),
      }
    })

    const updated = await prisma.$transaction(async (tx) => {
      await tx.saleItem.deleteMany({ where: { saleId } })
      return tx.sale.update({
        where: { id: saleId },
        data: {
          ...(customerId ? { customerId: Number(customerId) } : {}),
          totalAmount: computedTotal,
          vatAmount: taxSummary.vatAmount,
          taxableAmount: taxSummary.taxableAmount,
          debtAmount: computedTotal,
          cashAmount: 0,
          insuranceAmount: 0,
          saleItems: { create: saleItemsData as any },
        },
        include: {
          saleItems: { include: { product: true } },
          customer: true,
        },
      })
    })

    await auditLogger.sales(req, {
      type: 'SALE_UPDATE',
      description: `Proforma #${sale.invoiceNumber ?? saleId} edited`,
      entityType: 'Sale',
      entityId: saleId,
      metadata: { itemCount: items.length, totalAmount: computedTotal },
    })

    res.json(success(updated))
  } catch (error: any) {
    console.error("[Update Proforma Error]:", error)
    res.status(500).json(apiError("Failed to update the proforma"))
  }
}

/**
 * Convert a proforma into a real NS sale: creates a fresh, fully-fiscalized sale
 * from the (optionally edited) proforma lines + the supplied payment, links it
 * back via proformaSourceId, and moves the proforma to status CONVERTED. The
 * proforma document itself is kept untouched.
 *
 * POST /:organizationId/:saleId/convert
 *   body: { paymentType?, cashAmount?, debtAmount?, insuranceAmount?, payments?,
 *           shiftId?, customerId?, items? }
 */
export const convertProforma = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId)
    const saleId = parseInt(req.params.saleId)
    // @ts-ignore
    const userId = parseInt(req.user?.userId as string)
    const branchId = await resolveBranchIdForWrite(req)
    const { paymentType, cashAmount, debtAmount, insuranceAmount, payments: splitPayments, shiftId, customerId, items } = req.body

    const proforma = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      include: {
        saleItems: true,
        convertedSale: { select: { id: true, invoiceNumber: true } },
      },
    })
    if (!proforma) return res.status(404).json(apiError("Proforma not found"))
    if (!proforma.isProforma) return res.status(400).json(apiError("This sale is not a proforma"))
    if (proforma.status === 'CONVERTED' || proforma.convertedSale) {
      return res.status(409).json(apiError("This proforma has already been converted", undefined, { convertedSaleId: proforma.convertedSale?.id ?? null }))
    }

    // Use the edited lines when supplied, otherwise the proforma's current lines.
    const resolvedItems = Array.isArray(items) && items.length > 0
      ? items
      : proforma.saleItems.map((si) => ({
          productId: si.productId ?? undefined,
          quantity: si.quantity,
          unitPrice: Number(si.unitPrice),
          itemType: si.itemType,
          serviceName: si.serviceName ?? undefined,
          serviceDescription: si.serviceDescription ?? undefined,
          measurementUnit: si.measurementUnit,
        }))

    const { sale, completeSale, fiscalization } = await commitSale({
      organizationId,
      branchId: branchId as number,
      userId,
      customerId: customerId ? Number(customerId) : proforma.customerId,
      items: resolvedItems,
      paymentType,
      cashAmount,
      debtAmount,
      insuranceAmount,
      payments: splitPayments,
      shiftId,
      isProforma: false,
      proformaSourceId: saleId,
      inventoryMethod: req.body?.inventoryMethod,
      req,
    })

    await prisma.sale.update({ where: { id: saleId }, data: { status: 'CONVERTED' } })

    res.status(201).json(success({ ...(completeSale ?? sale), fiscalization, proformaSourceId: saleId }))
  } catch (error: any) {
    if (error instanceof CommitSaleError) {
      return res.status(error.statusCode).json(apiError(error.message))
    }
    // proforma_source_id is unique — a concurrent convert loses this race.
    if (error.code === 'P2002' && String(error.meta?.target ?? '').includes('proforma_source_id')) {
      return res.status(409).json(apiError("This proforma has already been converted"))
    }
    if (error.message && error.message.includes('Insufficient stock')) {
      return res.status(400).json(apiError(error.message))
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json(apiError(error.message))
    }
    console.error("[Convert Proforma Error]:", error)
    res.status(500).json(apiError("Failed to convert the proforma"))
  }
}

export const getSales = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId)
    const { startDate, endDate, customerId, page, limit, search, status, paymentType, rcptLabel } = req.query
    const requestedPage = Number(page)
    const pageNumber = Number.isFinite(requestedPage) && requestedPage > 0
      ? Math.floor(requestedPage)
      : 1
    const requestedLimit = Number(limit)
    const pageSize = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 500)
      : 50

    const where: any = {
      organizationId,
      ...buildBranchFilter(req)
    }

    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string)
      }
      if (endDate) {
        const end = new Date(endDate as string)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    if (customerId) {
      where.customerId = parseInt(customerId as string)
    }

    if (status) {
      where.status = status as string
    }

    if (paymentType) {
      where.paymentType = paymentType as string
    }

    if (rcptLabel) {
      where.rcptLabel = rcptLabel as string
    }

    if (search) {
      where.OR = [
        { saleNumber: { contains: search as string, mode: "insensitive" } },
        { invoiceNumber: { contains: search as string, mode: "insensitive" } },
        {
          customer: {
            name: { contains: search as string, mode: "insensitive" }
          }
        }
      ]
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              TIN: true,
              customerType: true
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              role: true
            }
          },
          saleItems: {
            include: { product: true },
          },
          ebmTransactions: {
            where: { operation: { not: "COPY" } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          // Proforma-conversion links so the UI can badge "Converted".
          convertedSale: { select: { id: true, invoiceNumber: true, saleNumber: true } },
          proformaSource: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sale.count({ where }),
    ])

    res.json(success({
      data: sales,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    }))
  } catch (error) {
    console.error("[Get Sales Error]:", error)
    res.status(500).json(apiError("Failed to get sales"))
  }
}

export const getSaleById = async (req: BranchAuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    const organizationId = parseInt(req.params.organizationId)

    const sale = await prisma.sale.findFirst({
      where: {
        id,
        organizationId,
        ...buildBranchFilter(req)
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            TIN: true,
            customerType: true,
            email: true,
            address: true,
            custPrvncNm: true,
            custDstrtNm: true,
            custSctrNm: true,
            custLocDesc: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        saleItems: {
          include: { product: true },
        },
        salePayments: {
          orderBy: { createdAt: "asc" },
        },
        originalSale: {
          select: {
            id: true,
            saleNumber: true,
            invoiceNumber: true,
            createdAt: true,
          },
        },
        convertedSale: { select: { id: true, saleNumber: true, invoiceNumber: true, createdAt: true } },
        proformaSource: { select: { id: true, saleNumber: true, invoiceNumber: true, createdAt: true } },
        ebmTransactions: {
          where: { operation: { not: "COPY" } },
          orderBy: { createdAt: "desc" },
        },
      },
    })

    if (!sale) {
      return res.status(404).json(apiError("Sale not found"))
    }

    res.json(success(sale))
  } catch (error) {
    console.error("[Get Sale Error]:", error)
    res.status(500).json(apiError("Failed to get sale"))
  }
}

export const payDebt = async (req: BranchAuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    const organizationId = parseInt(req.params.organizationId)
    const amount = Number(req.body?.amount)
    const paymentMethod = typeof req.body?.paymentMethod === "string" && req.body.paymentMethod.trim() ? req.body.paymentMethod.trim().toUpperCase() : "CASH"
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json(apiError("Amount must be a positive number"))
    }
    const sale = await prisma.sale.findFirst({
      where: {
        id,
        organizationId,
        ...buildBranchFilter(req)
      },
      include: {
        customer: true,
        saleItems: true
      }
    })
    if (!sale) {
      return res.status(404).json(apiError("Sale not found"))
    }

    if (sale.status === 'REFUNDED' || sale.status === 'CANCELLED') {
      return res.status(400).json(apiError(`Cannot process payment for ${sale.status.toLowerCase()} sale`))
    }

    const remainingDebt = (sale.debtAmount as Decimal).toNumber() - amount
    if (remainingDebt < 0) {
      return res.status(400).json(apiError("Amount exceeds debt"))
    }

    const DEBT_EXCEEDED = "AMOUNT_EXCEEDS_DEBT"
    try {
    await prisma.$transaction(async (tx) => {
      // Conditional decrement: two payments at once cannot both take the same remaining debt.
      const updated = await tx.sale.updateMany({
        where: { id, debtAmount: { gte: amount } },
        data: {
          debtAmount: { decrement: amount },
          cashAmount: { increment: amount },
        },
      })
      if (updated.count !== 1) throw new Error(DEBT_EXCEEDED)

      await tx.customer.update({
        where: { id: sale.customerId },
        data: {
          balance: { decrement: amount },
        },
      })

      await enqueueCustomerPaymentAccountingEvent(tx, {
        organizationId,
        branchId: (sale as any).branchId,
        paymentId: `${id}:${randomUUID()}`,
        saleId: id,
        saleNumber: sale.saleNumber,
        customerId: sale.customerId,
        amount,
        paymentMethod,
      })
    })
    } catch (e) {
      if ((e as Error).message === DEBT_EXCEEDED) return res.status(400).json(apiError("Amount exceeds debt"))
      throw e
    }

    await auditLogger.sales(req, {
      type: 'PAYMENT_RECEIVED',
      description: `Payment of ${amount} received for debt on Sale #${sale.saleNumber}`,
      entityType: 'Sale',
      entityId: id,
      metadata: {
        amount,
        previousDebt: sale.debtAmount,
        newDebt: remainingDebt,
      }
    });


    res.json(success({ message: "Debt paid successfully" }))
  } catch (error) {
    console.error("[Pay Debt Error]:", error)
    res.status(500).json(apiError("Failed to pay debt"))
  }
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

const executeWithRetry = async (fn: () => Promise<any>, retries = 0): Promise<any> => {
  try {
    return await fn();
  } catch (error: any) {
    if (error.code === 'P2028' && retries < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retries);
      console.log(`Transaction timed out, retrying in ${delay}ms (attempt ${retries + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return executeWithRetry(fn, retries + 1);
    }
    throw error;
  }
};

export const refundSale = async (req: BranchAuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = parseInt(req.params.organizationId);
    const orgSettings = await getOrganizationSettings(organizationId);
    const result = await executeWithRetry(async () => {
      return await prisma.$transaction(async (prisma) => {
        const { reason, items: refundItems, rfdRsnCd: rfdRsnCdRaw, recipientName, receiptMode } = req.body;
        const userId = req.user?.userId;
        // Serialize concurrent refunds of the same NS so two requests cannot
        // both pass the remaining-quantity check and issue two NR documents.
        await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nr-refund:${organizationId}:${id}`}))`;

        // NR vs TR: the mode is read under a shared lock (no toggle can land
        // before this refund commits) and must match what the screen showed.
        const trainingMode = await readReceiptModeLocked(prisma, organizationId);
        try {
          assertExpectedReceiptMode(parseExpectedReceiptMode(receiptMode), trainingMode);
        } catch (e: unknown) {
          if (e instanceof ReceiptModeMismatchError) throw { status: e.status, message: e.message, code: e.code };
          throw e;
        }

        // RRA refund reason (code class 32): the operator's selection, validated
        // now so a bad code is a 400 instead of a dead-lettered fiscal refund.
        // Stored on the refund sale and carried on the outbox payload to VSDC
        // as rfdRsnCd; the free-text `reason` stays the human note (remark).
        let rfdRsnCd: string;
        try {
          rfdRsnCd = await validateRefundReasonCodeForOrg(
            organizationId,
            typeof rfdRsnCdRaw === 'string' && rfdRsnCdRaw.trim() ? rfdRsnCdRaw.trim() : DEFAULT_RFD_RSN_CD,
          );
        } catch (e: unknown) {
          throw { status: 400, message: e instanceof Error ? e.message : 'Invalid refund reason code' };
        }

        // Justification is always required; code 13 ("Other reason") needs a
        // real explanation. (The zod schema already requires a non-empty
        // reason; this enforces the code-13 rule with a precise message.)
        try {
          assertRefundReason(rfdRsnCd, reason);
        } catch (e: unknown) {
          if (e instanceof RefundRuleError) throw { status: e.status, message: e.message };
          throw e;
        }

        // Get the sale with items + every prior refund linked to it (for
        // remaining-quantity enforcement and the in-progress guard below).
        const sale = await prisma.sale.findFirst({
          where: {
            id,
            organizationId,
            ...buildBranchFilter(req)
          } as any,
          include: {
            saleItems: {
              include: {
                product: true,
                batch: true
              }
            },
            customer: true,
            refunds: {
              select: {
                id: true,
                status: true,
                totalAmount: true,
                saleItems: {
                  select: { productId: true, quantity: true, serviceName: true },
                },
              },
            },
          } as any
        });

        if (!sale) {
          throw { status: 404, message: "Sale not found" };
        }

        // The original must be a genuine Normal Sale: never an NR (or any
        // other label), never a proforma, never already refunded/cancelled,
        // and carrying the VSDC invoice number the refund will reference.
        try {
          assertOriginalRefundable({
            id,
            status: sale.status,
            rcptLabel: (sale as any).rcptLabel ?? null,
            isProforma: !!(sale as any).isProforma,
            originalSaleId: (sale as any).originalSaleId ?? null,
            vsdcInvcNo: (sale as any).vsdcInvcNo ?? null,
          }, { trainingMode });
        } catch (e: unknown) {
          if (e instanceof RefundRuleError) throw { status: e.status, message: e.message };
          throw e;
        }

        // A number allocated at checkout is not a receipt. When EBM is on, the
        // NS must already have VSDC's rcptNo, signature, internal data and
        // timestamp — otherwise the refund would mark the original REFUNDED,
        // the pending SALE submission would be dead-lettered, and the NR
        // would never be confirmed.
        if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
          const confirmed = await prisma.ebmTransaction.findFirst({
            where: { saleId: id, operation: 'SALE', submissionStatus: 'SUCCESS' },
            orderBy: { createdAt: 'desc' },
            select: {
              sdcRcptNo: true,
              ebmInvoiceNumber: true,
              internalData: true,
              receiptSignature: true,
              sdcId: true,
              sdcDateTime: true,
            },
          });
          try {
            assertOriginalConfirmed(confirmed ? {
              submissionStatus: 'SUCCESS',
              rcptNo: confirmed.sdcRcptNo ?? confirmed.ebmInvoiceNumber,
              internalData: confirmed.internalData,
              receiptSignature: confirmed.receiptSignature,
              sdcId: confirmed.sdcId,
              publishedAt: confirmed.sdcDateTime,
            } : null, { training: trainingMode });
          } catch (e: unknown) {
            if (e instanceof RefundRuleError) throw { status: e.status, message: e.message };
            throw e;
          }
        }

        // Ensure sale has items
        if (!sale.saleItems || sale.saleItems.length === 0) {
          throw { status: 400, message: "Sale has no items to refund" };
        }

        // Normalize the original lines once (SaleItem.quantity is
        // Decimal(15,3) — every consumer below needs plain numbers).
        const originalLines = ((sale as any).saleItems || []).map((item: any) => ({
          saleItemId: item.id,
          productId: item.productId ?? null,
          serviceName: item.serviceName || null,
          serviceDescription: item.serviceDescription || null,
          quantity: Number(item.quantity),
          unitPrice: item.unitPrice.toNumber(),
          totalPrice: item.totalPrice.toNumber(),
          taxRate: Number(item.taxRate ?? 0),
          taxAmount: Number(item.taxAmount ?? 0),
          taxCode: item.taxCode ?? null,
          dcRate: Number(item.dcRate ?? 0),
          dcAmt: Number(item.dcAmt ?? 0),
          measurementUnit: item.measurementUnit ?? 'PCS',
          batchId: item.batchId || item.batch?.id || null,
          itemType: item.itemType || 'PRODUCT',
        }));

        // Already-refunded legs from every prior refund linked to this sale
        // (refund rows store negated quantities — take abs). Linked refunds
        // can never be cancelled (cancelSale refuses REFUNDED rows), so every
        // linked row counts as consumed: conservative by design, re-refunding
        // the same quantity is impossible.
        const priorLegs = ((sale as any).refunds || []).flatMap((r: any) =>
          (r.saleItems || []).map((si: any) => ({
            productId: si.productId ?? null,
            serviceName: si.serviceName || null,
            absQuantity: Math.abs(Number(si.quantity)),
          })),
        );

        // Duplicate-submission guard: a refund for this original that is still
        // being fiscalized (or waiting to retry) blocks a new one. Without
        // this, a double-click / retry-after-timeout would create a second
        // refund record and restore the same stock twice.
        const linkedRefundIds = ((sale as any).refunds || []).map((r: any) => r.id);
        if (linkedRefundIds.length > 0) {
          const inFlight = await prisma.ebmOutbox.findFirst({
            where: {
              saleId: { in: linkedRefundIds },
              operation: 'REFUND',
              status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
            },
            select: { id: true },
          });
          if (inFlight) {
            throw {
              status: 409,
              message: 'A refund for this sale is already being processed — wait for it to complete before creating another',
            };
          }
        }

        // Plan the negated legs. No `items` (or an empty list) = full refund
        // of every remaining line; otherwise each entry refunds part of one
        // original line within its remaining quantity. Over-refunds throw.
        const requested = Array.isArray(refundItems) && refundItems.length > 0
          ? refundItems.map((r: any) => ({ saleItemId: Number(r.saleItemId), quantity: Number(r.quantity) }))
          : null;
        let planned: ReturnType<typeof planRefundLines>;
        try {
          planned = planRefundLines(originalLines, priorLegs, requested);
        } catch (e: unknown) {
          if (e instanceof RefundRuleError) throw { status: e.status, message: e.message };
          throw e;
        }
        const refundTotals = summarizeRefund(planned);
        const totalRefundAmount = refundTotals.totalRefundAmount;
        const totalRefundVat = refundTotals.totalRefundVat;
        const totalRefundTaxable = refundTotals.totalRefundTaxable;
        const refundBand = (code: string) => refundTotals.bands[code] ?? { net: 0, tax: 0 };

        // Original receipt status after THIS refund: REFUNDED only when
        // nothing remains refundable, otherwise PARTIALLY_REFUNDED.
        const consumedAfter = [...priorLegs];
        for (const leg of planned) {
          const orig = originalLines.find((l: any) => l.saleItemId === leg.saleItemId)!;
          consumedAfter.push({
            productId: orig.productId,
            serviceName: orig.serviceName,
            absQuantity: Math.abs(leg.quantity),
          });
        }
        const anythingLeft = remainingByLine(originalLines, consumedAfter).some((r) => r.remaining > 0);
        const newOriginalStatus = anythingLeft ? 'PARTIALLY_REFUNDED' : 'REFUNDED';

        // Update original sale status
        await prisma.sale.update({
          where: { id },
          data: {
            status: newOriginalStatus as any,
            refundedAt: new Date(),
            refundedById: parseInt(userId as string),
            refundReason: reason
          }
        });

        // Create a new REFUND sale record with negative amounts
        const refundSaleNumber = `REFUND-${sale.saleNumber}-${Date.now()}`;

        // C6: a TS is refunded as TR, an NS as NR (assertOriginalRefundable
        // already tied the original's label to the current mode).
        const refundRcptLabel = refundLabelForOriginal((sale as any).rcptLabel ?? 'NS');
        const isTrainingRefund = refundRcptLabel === 'TR';

        // A fiscal refund is a NEW sales-transaction document: allocate a fresh
        // VSDC invoice number for it (the sandbox rejects a resubmitted invcNo
        // with 924, and a refund with orgInvcNo=0 with 910). The original sale
        // is referenced via orgInvcNo at submission time (see outbox worker).
        const { invoiceNumber: refundInvoiceNumber, vsdcInvcNo: refundVsdcInvcNo } =
          await generateInvoiceNumber(organizationId!, (sale as any).branchId, prisma);

        const refundSale = await prisma.sale.create({
          data: {
            saleNumber: refundSaleNumber,
            invoiceNumber: refundInvoiceNumber,
            vsdcInvcNo: refundVsdcInvcNo,
            customerId: sale.customerId,
            userId: parseInt(userId as string),
            organizationId: organizationId!,
            branchId: (sale as any).branchId,
            paymentType: sale.paymentType,
            cashAmount: -totalRefundAmount, // Negative amount
            insuranceAmount: 0,
            debtAmount: 0,
            totalAmount: -totalRefundAmount, // Negative total
            vatAmount: -totalRefundVat,      // Negative — mirrors the original VAT being refunded
            taxableAmount: -totalRefundTaxable,
            taxblAmtA: -refundBand('A').net,
            taxblAmtB: -refundBand('B').net,
            taxblAmtC: -refundBand('C').net,
            taxblAmtD: -refundBand('D').net,
            taxAmtA: -refundBand('A').tax,
            taxAmtB: -refundBand('B').tax,
            taxAmtC: -refundBand('C').tax,
            taxAmtD: -refundBand('D').tax,
            status: 'REFUNDED',
            refundReason: reason,
            rfdRsnCd,
            // Person receiving the refund — explicit operator input, else the
            // original customer (the RRA refund record must name a recipient).
            refundRecipient: (typeof recipientName === 'string' && recipientName.trim())
              ? recipientName.trim()
              : ((sale as any).customer?.name ?? null),
            rcptLabel: refundRcptLabel as any,
            originalSaleId: id, // Link to original sale
            // Refund belongs to the original sale's shift (a TS never has one).
            shiftId: isTrainingRefund ? undefined : (sale as any).shiftId ?? undefined,
            saleItems: {
              create: planned.map((item) => ({
                productId: item.productId || undefined,
                // quantity negative x unitPrice positive = totalPrice negative;
                // unitPrice itself stays positive here so that identity holds —
                // the printed minus sign on the per-unit price (RRA checklist
                // §56) is applied at render time (composeInvoicePayload), not
                // stored, to avoid double-negating the line total.
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                // Tax + discount mirror the original line with the sign flipped so
                // the refund fiscalises with the correct tax code/amount and the
                // printed receipt shows every amount negative (RRA checklist §56).
                taxRate: item.taxRate,
                taxAmount: item.taxAmount,
                taxCode: item.taxCode ?? undefined,
                dcRate: item.dcRate,
                dcAmt: item.dcAmt,
                measurementUnit: item.measurementUnit,
                itemType: item.itemType,
                serviceName: item.serviceName,
                serviceDescription: item.serviceDescription,
              }))
            }
          } as any,
          include: {
            saleItems: { include: { product: true } },
            customer: true
          }
        });

        // Update product quantities (restore inventory) and record movements in ledger (Stock IN)
        // Only restore stock for PRODUCT items; SERVICE items have no inventory.
        // Exactly the refunded quantity is restored, once, against this refund
        // record — retrying the fiscal submission never touches stock again, so
        // a retry can neither duplicate nor miss the restoration.
        const batchBySaleItemId = new Map<number, number | null>(
          originalLines.map((l: any) => [l.saleItemId, l.batchId ?? null] as [number, number | null]),
        );
        // A TR restores nothing: its TS never took real stock or batches.
        for (const item of isTrainingRefund ? [] : planned) {
          if (item.itemType === 'SERVICE' || !item.productId) continue;
          const restoredQty = Math.abs(item.quantity);

          await addStock({
            organizationId: organizationId!,
            productId: item.productId,
            userId: parseInt(userId as string),
            quantity: restoredQty,
            movementType: 'RETURN_CUSTOMER',
            branchId: (sale as any).branchId,
            reference: refundSaleNumber,
            referenceType: 'SALE_REFUND',
            note: `Refund for Sale #${sale.saleNumber} (Partial)`,
            metadata: { originalSaleNumber: sale.saleNumber, originalSaleId: id },
            tx: prisma,
          });

          const batchId = batchBySaleItemId.get(item.saleItemId);
          if (batchId) {
            const existingBatch = await prisma.batch.findFirst({
              where: { id: batchId, organizationId: organizationId! },
            });
            if (existingBatch) {
              await prisma.batch.update({
                where: { id: batchId },
                data: {
                  quantity: Number(existingBatch.quantity) + restoredQty,
                  isActive: true,
                },
              });
            }
          }
        }

        // Update customer balance (a TS never booked a real receivable)
        if (!isTrainingRefund) {
          await prisma.customer.update({
            where: { id: sale.customerId },
            data: {
              balance: { decrement: totalRefundAmount }
            }
          });
          // Refunds clear outstanding debt on the original sale first (same order as the accounting event).
          const outstandingDebt = Math.max(0, Number((sale as any).debtAmount ?? 0));
          const debtCleared = Math.min(totalRefundAmount, outstandingDebt);
          if (debtCleared > 0) {
            const reduced = await prisma.sale.updateMany({
              where: { id, debtAmount: { gte: debtCleared } },
              data: { debtAmount: { decrement: debtCleared } },
            });
            if (!reduced.count) {
              throw { status: 409, message: "Sale debt changed while the refund was processing; retry" };
            }
          }
          await enqueueSaleRefundedAccountingEvent(prisma, {
            organizationId: organizationId!,
            branchId: (sale as any).branchId,
            refundSaleId: refundSale.id,
            refundNumber: refundInvoiceNumber || refundSaleNumber,
            originalSaleId: id,
            originalSaleNumber: sale.saleNumber,
            customerId: sale.customerId,
            paymentType: sale.paymentType,
            outstandingDebt,
            gross: totalRefundAmount,
            net: totalRefundTaxable,
            tax: totalRefundVat,
            reason,
          });
        }

        // Log the activity
        await auditLogger.sales(req, {
          type: 'SALE_REFUNDED',
          description: `${anythingLeft ? 'Partial' : 'Full'} ${isTrainingRefund ? 'training refund (TR)' : 'refund'} issued for Sale #${sale.saleNumber}${reason ? `: ${reason}` : ''}`,
          entityType: 'Sale',
          entityId: id,
          metadata: {
            rcptLabel: refundRcptLabel,
            refundSaleId: refundSale.id,
            refundSaleNumber: refundSaleNumber,
            refundAmount: totalRefundAmount,
            originalStatus: newOriginalStatus,
            reason,
            rfdRsnCd,
            recipient: (refundSale as any).refundRecipient ?? null,
            orgInvcNo: (sale as any).vsdcInvcNo ?? null,
            refundedLineCount: planned.length,
          }
        });

        // Write EBM outbox entry for REFUND atomically with the transaction.
        // This ensures the RRA is notified even if the process crashes after commit.
        if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
          const refundIdempotencyKey = `ebm-REFUND-${organizationId}-${refundSale.id}`;
          await prisma.ebmOutbox.create({
            data: {
              organizationId: organizationId!,
              saleId: refundSale.id,
              operation: 'REFUND',
              idempotencyKey: refundIdempotencyKey,
              payload: {
                version: 1,
                saleId: refundSale.id,
                organizationId: organizationId!,
                operation: 'REFUND',
                originalSaleId: id,
                rfdRsnCd,
                reason: typeof reason === 'string' ? reason.trim() : '',
              } as any,
              status: 'PENDING',
              nextAttemptAt: new Date(),
            },
          });
        }

        return {
          success: true,
          message: 'Refund transaction created successfully',
          refundAmount: totalRefundAmount,
          refundSale: refundSale,
          refundedItems: planned,
          originalStatus: newOriginalStatus,
        };
      }, {
        maxWait: 30000,   // 30 seconds
        timeout: 60000,   // 60 seconds
      });
    });

    // Bounded wait (same rationale as createSale — RRA checklist §16/§22: a
    // refund receipt must not be issued before VSDC confirms it either). The
    // outbox row stays the single source of truth; the 2-minute cron job
    // remains the retry/backstop if this wait times out.
    let refundFiscalization: { status: 'success' | 'pending' | 'failed' } = { status: 'success' };
    if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
      const EBM_INLINE_WAIT_MS = 5000;
      await Promise.race([
        processEbmOutboxBatch(5).catch((e) => {
          console.error('[EBM] immediate refund fiscalization error:', e);
        }),
        new Promise((resolve) => setTimeout(resolve, EBM_INLINE_WAIT_MS)),
      ]);

      const outboxRow = await prisma.ebmOutbox.findFirst({
        where: { saleId: result.refundSale.id, operation: 'REFUND' },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });
      refundFiscalization = {
        status: outboxRow?.status === 'SUCCEEDED' ? 'success' : outboxRow?.status === 'DEAD_LETTER' ? 'failed' : 'pending',
      };
    }

    res.status(200).json(success({ ...result, fiscalization: refundFiscalization }));
  } catch (error: any) {
    console.error("[Refund Error]:", error);
    const status = error.status || 500;
    const message = error.message || "Failed to process refund";
    res.status(status).json(apiError(message, error.code));
  }
};


/**
 * What can still be refunded on a sale — drives the refund UI (original
 * detail + per-line remaining + prior refunds + fiscal state).
 *
 * GET /:organizationId/:saleId/refundable
 *
 * Always 200 (except 404/500): `eligible` tells the UI whether a refund may
 * start, with machine-readable `errors` when not. Never exposes a path to
 * refund an ineligible receipt — `refundSale` re-enforces every rule.
 */
export const getRefundable = async (req: BranchAuthRequest, res: Response) => {
  try {
    const saleId = parseInt(req.params.saleId);
    const organizationId = parseInt(req.params.organizationId);

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      include: {
        customer: { select: { id: true, name: true, phone: true, TIN: true } },
        saleItems: { include: { product: { select: { id: true, name: true, itemCd: true } } } },
        refunds: {
          select: {
            id: true,
            saleNumber: true,
            invoiceNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            saleItems: { select: { productId: true, quantity: true, serviceName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!sale) {
      return res.status(404).json(apiError("Sale not found"));
    }

    const orgSettings = await getOrganizationSettings(organizationId);
    const trainingMode = (await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { trainingMode: true },
    }))?.trainingMode === true;
    const errors: string[] = [];
    try {
      assertOriginalRefundable({
        id: saleId,
        status: sale.status,
        rcptLabel: (sale as any).rcptLabel ?? null,
        isProforma: !!(sale as any).isProforma,
        originalSaleId: (sale as any).originalSaleId ?? null,
        vsdcInvcNo: (sale as any).vsdcInvcNo ?? null,
      }, { trainingMode });
    } catch (e: unknown) {
      errors.push(e instanceof RefundRuleError ? e.message : 'This sale cannot be refunded');
    }
    if (errors.length === 0 && isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
      const confirmed = await prisma.ebmTransaction.findFirst({
        where: { saleId, operation: 'SALE', submissionStatus: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: {
          sdcRcptNo: true,
          ebmInvoiceNumber: true,
          internalData: true,
          receiptSignature: true,
          sdcId: true,
          sdcDateTime: true,
        },
      });
      try {
        assertOriginalConfirmed(confirmed ? {
          submissionStatus: 'SUCCESS',
          rcptNo: confirmed.sdcRcptNo ?? confirmed.ebmInvoiceNumber,
          internalData: confirmed.internalData,
          receiptSignature: confirmed.receiptSignature,
          sdcId: confirmed.sdcId,
          publishedAt: confirmed.sdcDateTime,
        } : null, { training: trainingMode });
      } catch (e: unknown) {
        errors.push(e instanceof RefundRuleError ? e.message : 'Original receipt is not confirmed by VSDC');
      }
    }

    const originalLines = ((sale as any).saleItems || []).map((item: any) => ({
      saleItemId: item.id,
      productId: item.productId ?? null,
      productName: item.product?.name ?? null,
      serviceName: item.serviceName || null,
      serviceDescription: item.serviceDescription || null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      taxRate: Number(item.taxRate ?? 0),
      taxAmount: Number(item.taxAmount ?? 0),
      taxCode: item.taxCode ?? null,
      dcRate: Number(item.dcRate ?? 0),
      dcAmt: Number(item.dcAmt ?? 0),
      measurementUnit: item.measurementUnit ?? 'PCS',
      itemType: item.itemType || 'PRODUCT',
    }));
    const priorLegs = ((sale as any).refunds || []).flatMap((r: any) =>
      (r.saleItems || []).map((si: any) => ({
        productId: si.productId ?? null,
        serviceName: si.serviceName || null,
        absQuantity: Math.abs(Number(si.quantity)),
      })),
    );
    const remaining = new Map(remainingByLine(originalLines, priorLegs).map((r) => [r.saleItemId, r.remaining]));
    const lines = originalLines.map((l: any) => ({
      ...l,
      refunded: round2(l.quantity - (remaining.get(l.saleItemId) ?? l.quantity)),
      remaining: remaining.get(l.saleItemId) ?? 0,
    }));
    if (errors.length === 0 && !lines.some((l: any) => l.remaining > 0)) {
      errors.push('Nothing left to refund — every line was already fully refunded');
    }

    // Fiscal state of prior refunds (pending vs confirmed) for honest UI status.
    const refundIds = ((sale as any).refunds || []).map((r: any) => r.id);
    const outboxStates = refundIds.length
      ? await prisma.ebmOutbox.findMany({
          where: { saleId: { in: refundIds }, operation: 'REFUND' },
          select: { saleId: true, status: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const fiscalByRefund = new Map<number, string>();
    for (const row of outboxStates) {
      if (!fiscalByRefund.has(row.saleId)) fiscalByRefund.set(row.saleId, row.status);
    }
    const priorRefunds = ((sale as any).refunds || []).map((r: any) => ({
      id: r.id,
      saleNumber: r.saleNumber,
      invoiceNumber: r.invoiceNumber,
      status: r.status,
      totalAmount: Number(r.totalAmount),
      createdAt: r.createdAt,
      fiscalStatus: fiscalByRefund.get(r.id) ?? (r.status === 'REFUNDED' ? 'UNKNOWN' : r.status),
    }));
    const inProgress = priorRefunds.some((r: any) => ['PENDING', 'PROCESSING', 'FAILED'].includes(r.fiscalStatus));

    return res.json(success({
      eligible: errors.length === 0 && !inProgress,
      refundLabel: refundLabelForOriginal((sale as any).rcptLabel ?? 'NS'),
      trainingMode,
      errors: inProgress
        ? [...errors, 'A refund for this sale is already being processed — wait for it to complete']
        : errors,
      original: {
        id: sale.id,
        saleNumber: (sale as any).saleNumber,
        invoiceNumber: (sale as any).invoiceNumber,
        vsdcInvcNo: (sale as any).vsdcInvcNo ?? null,
        rcptLabel: (sale as any).rcptLabel ?? null,
        status: sale.status,
        createdAt: (sale as any).createdAt,
        totalAmount: Number((sale as any).totalAmount),
        customer: (sale as any).customer,
      },
      lines,
      priorRefunds,
      inProgress,
    }));
  } catch (error: any) {
    console.error("[Refundable Error]:", error);
    res.status(500).json(apiError("Failed to load refundable details"));
  }
};


/**
 * Registers one download/print of this sale's invoice PDF — called by the
 * frontend right before it fetches the actual PDF for every deliberate
 * download. CIS/VSDC spec §7.18: "print only one original receipt. Reprint
 * shall have a watermark with mention Copy." There's no separate "copy"
 * action: the FIRST registered download stays the original (reprintCount
 * reaches 1, isCopy stays false in getSaleInvoiceData); every one after that
 * is automatically rendered as a COPY (CS/CR) receipt.
 *
 * The explicit copy action is printReceiptCopy (POST .../copy), which renders
 * and records the copy in one request.
 */
export const reprintSaleReceipt = async (req: BranchAuthRequest, res: Response) => {
  try {
    const saleId = parseInt(req.params.saleId);
    const organizationId = parseInt(req.params.organizationId);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json(apiError("Invalid sale id"));
    }

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      select: { id: true, saleNumber: true, invoiceNumber: true, totalAmount: true, status: true, rcptLabel: true, isProforma: true, originalSaleId: true, reprintCount: true },
    });

    if (!sale) {
      return res.status(404).json(apiError("Sale not found"));
    }

    // C6: CS = copy of a Normal Sale, CR = copy of a Normal Refund — derived
    // from the receipt's own label (an NS that was later refunded is still a
    // sale receipt). Display-only: the sale's rcptLabel (NS/NR/TS/TR) stays
    // the fiscal record of what the original receipt was. Training/proforma
    // reprints are not CS/CR.
    const copyLabel = copyLabelFor({
      rcptLabel: sale.rcptLabel ?? null,
      isProforma: sale.isProforma,
      originalSaleId: sale.originalSaleId ?? null,
      status: sale.status,
    });
    const willBeCopy = (sale.reprintCount ?? 0) + 1 > 1;

    // Validate that the document this registration unlocks can actually be
    // produced before counting it — a failed registration must never inflate
    // the count. A CS/CR reprints the original's VSDC data under a COPY
    // watermark; nothing is sent to VSDC.
    await composeInvoicePayload(req, { copy: copyLabel && willBeCopy ? "force" : "auto" });

    const updated = await prisma.sale.update({
      where: { id: saleId },
      data: { reprintCount: { increment: 1 } },
      select: { reprintCount: true },
    });
    const isCopy = updated.reprintCount > 1;

    await auditLogger.sales(req, {
      type: 'SALE_REPRINTED',
      description: isCopy && copyLabel
        ? `${copyLabel} copy #${updated.reprintCount - 1} registered for Sale #${sale.saleNumber}`
        : `Invoice downloaded for Sale #${sale.saleNumber} (download #${updated.reprintCount})`,
      entityType: 'Sale',
      entityId: saleId,
      metadata: { reprintCount: updated.reprintCount, copyLabel: isCopy ? copyLabel : null },
    });

    res.json(success({
      id: sale.id,
      saleNumber: sale.saleNumber,
      invoiceNumber: sale.invoiceNumber,
      totalAmount: Number(sale.totalAmount),
      isCopy,
      reprintCount: updated.reprintCount,
      rcptLabel: isCopy ? copyLabel : null,
      copyLabel: isCopy ? copyLabel : null,
    }));
  } catch (error: any) {
    if (error instanceof FiscalizationPendingError) {
      return res.status(425).json({ success: false, status: "pending_fiscalization", reason: error.reason, error: error.message });
    }
    if (error instanceof ReceiptCopyError) return sendReceiptCopyError(res, error);
    console.error("[Reprint Sale Error]:", error);
    res.status(500).json(apiError("Failed to reprint receipt"));
  }
};

/**
 * Regenerate invoice for a sale — creates a new invoice number, updates the sale,
 * generates new EBM transaction, preserves history, and prevents duplicate numbers.
 */
export const regenerateInvoice = async (req: BranchAuthRequest, res: Response) => {
    try {
        const saleId = parseInt(req.params.saleId);
        const organizationId = parseInt(req.params.organizationId);
        const branchId = await resolveBranchIdForWrite(req);

        const sale = await prisma.sale.findFirst({
            where: { id: saleId, organizationId, ...buildBranchFilter(req) },
            include: { ebmTransactions: { orderBy: { createdAt: 'desc' } } },
        });

        if (!sale) {
            return res.status(404).json(apiError("Sale not found"));
        }

        if (sale.status === 'CANCELLED' || sale.status === 'REFUNDED') {
            return res.status(400).json(apiError(`Cannot regenerate invoice for a ${sale.status.toLowerCase()} sale`));
        }

        // RRA checklist §28: an approved (VSDC-signed) receipt must never be
        // modified — that includes re-numbering it. Regeneration is only for a
        // sale whose invoice number was never accepted by VSDC (still pending or
        // permanently failed). A fiscalised sale can only be corrected via a
        // refund against the original receipt.
        const alreadyFiscalised = sale.ebmTransactions.some(
            (t) => (t.operation === 'SALE' || !t.operation) && t.submissionStatus === 'SUCCESS' && t.ebmInvoiceNumber != null,
        );
        if (alreadyFiscalised) {
            return res.status(409).json(apiError(
                'This sale already has a VSDC-signed receipt and cannot be re-numbered. Issue a refund against the original receipt instead.',
            ));
        }

        const result = await prisma.$transaction(async (tx) => {
            // Generate new invoice number
            const { invoiceNumber, vsdcInvcNo } = await generateInvoiceNumber(organizationId, branchId as number, tx);

            // Update sale with new invoice number
            const updatedSale = await tx.sale.update({
                where: { id: saleId },
                data: {
                    invoiceNumber,
                    vsdcInvcNo,
                    reprintCount: { increment: 1 },
                    updatedAt: new Date(),
                },
            });

            // Supersede any still-pending SALE outbox rows for this sale: they
            // carry the previous (now replaced) invcNo, and letting the worker
            // submit them would fiscalize a stale number alongside the new one.
            await tx.ebmOutbox.updateMany({
              where: {
                saleId,
                organizationId,
                operation: 'SALE',
                status: { in: ['PENDING', 'FAILED', 'PROCESSING'] },
              },
              data: {
                status: 'DEAD_LETTER',
                lastError: `Superseded by invoice regeneration (${sale.invoiceNumber} → ${invoiceNumber})`,
              },
            });

            // Create a new EBM transaction record for the regenerated invoice
            if (isEbmEnabled()) {
                const idempotencyKey = `ebm-REGEN-${organizationId}-${saleId}-${Date.now()}`;
                await tx.ebmOutbox.create({
                    data: {
                        organizationId,
                        saleId,
                        operation: 'SALE',
                        idempotencyKey,
                        payload: {
                            version: 1,
                            saleId,
                            organizationId,
                            operation: 'SALE',
                            invoiceNumber,
                            regenerated: true,
                        } as any,
                        status: 'PENDING',
                        nextAttemptAt: new Date(),
                    },
                });
            }

            return updatedSale;
        });

        await auditLogger.sales(req, {
            type: 'SALE_UPDATE',
            description: `Invoice regenerated for Sale #${sale.saleNumber} - New invoice: ${result.invoiceNumber}`,
            entityType: 'Sale',
            entityId: saleId,
            metadata: {
                previousInvoice: sale.invoiceNumber,
                newInvoice: result.invoiceNumber,
                reprintCount: result.reprintCount,
            },
        });

        res.json(success({
            ...result,
            previousInvoiceNumber: sale.invoiceNumber,
            isRegenerated: true,
        }));
    } catch (error: any) {
        console.error("[Regenerate Invoice Error]:", error);
        if (error.code === 'P2002') {
            return res.status(500).json(apiError("Invoice number conflict. Please try again."));
        }
        res.status(500).json(apiError("Failed to regenerate invoice"));
    }
};

/**
 * E2/E3: GET /api/organizations/:orgId/sales/:saleId/ebm-receipt
 * Returns the latest successful SDC fiscalization data for a sale.
 * The frontend polls this after sale creation once the outbox worker has run.
 */
export const getEbmReceipt = async (req: BranchAuthRequest, res: Response) => {
  try {
    const saleId = parseInt(req.params.saleId);
    const organizationId = parseInt(req.params.organizationId);

    const tx = await prisma.ebmTransaction.findFirst({
      where: {
        saleId,
        organizationId,
        submissionStatus: 'SUCCESS',
        operation: { in: ['SALE', 'REFUND'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!tx) {
      return res.status(202).json({
        status: 'pending',
        message: 'Fiscal submission not yet complete',
      });
    }

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId },
      select: { rcptLabel: true, invoiceNumber: true, saleNumber: true, branchId: true },
    });

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { TIN: true, ebmDeviceId: true, ebmSerialNo: true, mrcNo: true },
    });

    const branch = sale?.branchId != null
      ? await prisma.branch.findFirst({
          where: { id: sale.branchId, organizationId },
          select: { bhfId: true, ebmDeviceId: true, ebmSerialNo: true, mrcNo: true, ebmInitInfo: true },
        })
      : null;

    const signedMrc = (tx.responseData as { normalized?: { mrcNo?: string } } | null)?.normalized?.mrcNo;
    const mrcNo = configuredMrc(branch, org) || signedMrc || resolveReportMrc(branch, org);
    // `tx` is this sale's own successful VSDC response — prefer the ID it was
    // actually stamped with over the (possibly still-unconfigured) device
    // setting, same precedence composeInvoicePayload uses.
    const sdcId = tx.sdcId ?? branch?.ebmDeviceId ?? org?.ebmDeviceId ?? null;

    res.json({
      status: 'success',
      ebm: {
        sdcId,
        mrcNo,
        sdcRcptNo:        tx.sdcRcptNo,
        internalData:     tx.internalData,
        receiptSignature: tx.receiptSignature,
        qrPayload:        tx.qrPayload,
        sdcDateTime:      tx.sdcDateTime,
        rcptLabel:        tx.rcptLabel ?? sale?.rcptLabel,
        ebmInvoiceNumber: tx.ebmInvoiceNumber,
      },
    });
  } catch (error: any) {
    console.error('[EBM Receipt Error]:', error);
    res.status(500).json(apiError('Failed to get EBM receipt data'));
  }
};

export const cancelSale = async (req: BranchAuthRequest, res: Response) => {
  try {
    const saleId = parseInt(req.params.saleId);
    const organizationId = parseInt(req.params.organizationId);
    const orgSettings = await getOrganizationSettings(organizationId);
    const { reason } = req.body;
    const userId = req.user?.userId;

    // Get the sale with items
    const sale = await prisma.sale.findFirst({
      where: {
        id: saleId,
        organizationId,
        ...buildBranchFilter(req)
      },
      include: {
        saleItems: {
          include: {
            product: true,
            batch: true
          }
        },
        customer: true,
        user: true
      }
    });

    if (!sale) {
      return res.status(404).json(apiError("Sale not found"));
    }

    if (sale.status === 'CANCELLED') {
      return res.status(400).json(apiError("Sale already cancelled"));
    }

    if (sale.status === 'REFUNDED' || sale.status === 'PARTIALLY_REFUNDED') {
      return res.status(400).json(apiError(`Cannot cancel a ${sale.status.toLowerCase()} sale`));
    }

    // Start a transaction
    await prisma.$transaction(async (prisma) => {
      // Update sale status
      await prisma.sale.update({
        where: { id: saleId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: parseInt(userId as string),
          cancellationReason: reason
        }
      });

      // Return items to inventory ONLY when the original sale actually
      // released stock (RRA v1.0.5: cancellation is a sales-status 04 event;
      // a 03 Return/Incoming movement is emitted only if inventory comes back
      // — e.g. never for proforma/training/service-only sales that never
      // deducted stock).
      const deducted = await prisma.inventoryLedger.findMany({
        where: {
          organizationId: organizationId!,
          movementType: 'SALE',
          reference: sale.saleNumber,
        },
        select: { productId: true },
      });
      const deductedIds = new Set(deducted.map((d: any) => d.productId));
      for (const item of sale.saleItems) {
        const isService = (item as any).itemType === 'SERVICE' || !item.productId;
        if (isService) continue;
        if (!deductedIds.has(item.productId)) continue;

        const productId = item.productId!;
        await addStock({
          organizationId: organizationId!,
          productId,
          userId: parseInt(userId as string),
          quantity: Number(item.quantity),
          movementType: 'RETURN_CUSTOMER',
          branchId: (sale as any).branchId,
          reference: sale.saleNumber,
          referenceType: 'SALE_CANCELLATION',
          note: `Sale cancellation: ${sale.saleNumber}`,
          metadata: { originalSaleNumber: sale.saleNumber, originalSaleId: saleId },
          tx: prisma,
        });

        const batchId = (item as any).batchId || (item as any).batch?.id || null;
        if (batchId) {
          const existingBatch = await prisma.batch.findFirst({
            where: { id: batchId, organizationId: organizationId! },
          });
          if (existingBatch) {
            await prisma.batch.update({
              where: { id: batchId },
              data: {
                quantity: Number(existingBatch.quantity) + Number(item.quantity),
                isActive: true,
              },
            });
          }
        }
      }

      // Revert customer balance for debt portion only
      // During sale creation, we added the debt amount to customer balance
      // During cancellation, we need to subtract it
      const debtAmount = (sale as any).debtAmount?.toNumber?.() || 0;
      if (debtAmount > 0) {
        await prisma.customer.update({
          where: { id: sale.customerId },
          data: {
            balance: { decrement: debtAmount }
          }
        });
      }

      // Log the activity
      await auditLogger.sales(req, {
        type: 'SALE_CANCELLED',
        description: `Sale #${sale.saleNumber} cancelled${reason ? `: ${reason}` : ''}`,
        entityType: 'Sale',
        entityId: saleId,
        metadata: { cancellationReason: reason }
      });

      // Write EBM outbox entry for VOID atomically with the transaction.
      // The outbox worker will notify RRA; this survives process crashes.
      if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
        const voidIdempotencyKey = `ebm-VOID-${organizationId}-${saleId}`;
        await prisma.ebmOutbox.create({
          data: {
            organizationId,
            saleId,
            operation: 'VOID',
            idempotencyKey: voidIdempotencyKey,
            payload: {
              version: 1,
              saleId,
              organizationId,
              operation: 'VOID',
              reason: reason ?? null,
            } as any,
            status: 'PENDING',
            nextAttemptAt: new Date(),
          },
        });
      }
    });

    // Fire the outbox worker immediately (fire-and-forget) so the void hits
    // the WAR right at cancel time instead of waiting for the cron tick. The
    // outbox row stays the single source of truth for idempotency; the cron
    // job remains a retry/backstop if this run fails or times out.
    if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
      void processEbmOutboxBatch(50).catch((e) => {
        console.error('[EBM] immediate void fiscalization error:', e);
      });
    }

    res.status(200).json(success({ message: "Sale cancelled successfully" }));
  } catch (error) {
    console.error("[Cancel Sale Error]:", error);
    res.status(500).json(apiError("Failed to cancel sale"));
  }
};

/**
 * Pre-approval correction (2018 spec Art. 12): replace a COMPLETED sale that
 * the VSDC has NOT yet confirmed with a corrected sale.
 *
 * Rules enforced:
 * - Only unfiscalized sales qualify: no SUCCEEDED outbox row and no SUCCESS
 *   fiscal transaction. An approved (VSDC-signed) receipt is immutable — issue
 *   a refund instead (409 otherwise).
 * - The original is cancelled first and referenced by the correction
 *   (cancellationReason carries the new sale number); a CANCELLED/REFUNDED
 *   sale cannot be corrected again (cancel-once rule).
 * - The original's VSDC invoice number was never submitted, so no VOID
 *   document is owed to RRA for it; a VOID outbox row is still recorded for
 *   the audit trail and the worker skips it as never-fiscalized.
 * - Proformas have their own edit endpoint (updateProforma).
 *
 * POST /:organizationId/:saleId/correct
 */
export const correctSale = async (req: BranchAuthRequest, res: Response) => {
  try {
    const saleId = parseInt(req.params.saleId);
    const organizationId = parseInt(req.params.organizationId);
    const userId = req.user?.userId;
    const branchId = await resolveBranchIdForWrite(req);
    const orgSettings = await getOrganizationSettings(organizationId);
    const { reason, items, customerId, paymentType, cashAmount, debtAmount, insuranceAmount, payments: splitPayments, shiftId } = req.body;

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      include: {
        saleItems: { include: { product: true, batch: true } },
        customer: true,
      },
    });

    if (!sale) {
      return res.status(404).json(apiError("Sale not found"));
    }
    if (sale.isProforma) {
      return res.status(400).json(apiError("A proforma is corrected with the proforma edit endpoint, not here"));
    }
    if (sale.status === 'CANCELLED') {
      return res.status(400).json(apiError("Sale already cancelled — an original can be cancelled only once"));
    }
    if (sale.status === 'REFUNDED' || sale.status === 'PARTIALLY_REFUNDED') {
      return res.status(400).json(apiError(`Cannot correct a ${sale.status.toLowerCase()} sale — issue a new sale instead`));
    }
    if (sale.status !== 'COMPLETED') {
      return res.status(400).json(apiError(`Only a completed sale can be corrected (status is ${sale.status})`));
    }

    // VSDC approval check: any SUCCEEDED fiscal record makes the receipt
    // immutable. (Outbox SUCCEEDED and fiscal SUCCESS are written together, so
    // either one blocks; checking both covers legacy rows.)
    const [outboxSuccess, fiscalSuccess] = await Promise.all([
      prisma.ebmOutbox.findFirst({ where: { saleId, status: 'SUCCEEDED' }, select: { id: true } }),
      prisma.ebmTransaction.findFirst({ where: { saleId, submissionStatus: 'SUCCESS' }, select: { id: true } }),
    ]);
    if (outboxSuccess || fiscalSuccess) {
      return res.status(409).json(apiError("Sale already confirmed by RRA VSDC and can no longer be corrected — issue a refund instead"));
    }

    // Pre-validate the corrected totals BEFORE cancelling the original, so a
    // correctable sale is never stranded by a correctable typo: the same
    // payment-identity gate commitSale enforces.
    const correctedTotal = (items as any[]).reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitPrice), 0);
    if (Math.abs(correctedTotal - (cashAmount || 0) - (insuranceAmount || 0) - (debtAmount || 0)) > 0.01) {
      return res.status(400).json(apiError("Payment amounts do not match total. Total must equal cashAmount + insuranceAmount + debtAmount"));
    }

    // Cancel the original first (stock restore + debt revert mirror cancelSale).
    await prisma.$transaction(async (prisma) => {
      await prisma.sale.update({
        where: { id: saleId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: parseInt(userId as string),
          cancellationReason: `Pre-approval correction: ${reason}`,
        },
      });

      const deducted = await prisma.inventoryLedger.findMany({
        where: { organizationId: organizationId!, movementType: 'SALE', reference: sale.saleNumber },
        select: { productId: true },
      });
      const deductedIds = new Set(deducted.map((d: any) => d.productId));
      for (const item of sale.saleItems) {
        const isService = (item as any).itemType === 'SERVICE' || !item.productId;
        if (isService) continue;
        if (!deductedIds.has(item.productId)) continue;
        await addStock({
          organizationId: organizationId!,
          productId: item.productId!,
          userId: parseInt(userId as string),
          quantity: Number(item.quantity),
          movementType: 'RETURN_CUSTOMER',
          branchId: (sale as any).branchId,
          reference: sale.saleNumber,
          referenceType: 'SALE_CORRECTION',
          note: `Pre-approval correction of Sale #${sale.saleNumber}`,
          metadata: { originalSaleNumber: sale.saleNumber, originalSaleId: saleId },
          tx: prisma,
        });
      }

      const debtAmount = (sale as any).debtAmount?.toNumber?.() || 0;
      if (debtAmount > 0) {
        await prisma.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: debtAmount } },
        });
      }

      // VOID outbox row for the audit trail. The original was never
      // fiscalized, so the worker marks this SUCCEEDED-skipped without
      // submitting anything to RRA.
      if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
        await prisma.ebmOutbox.create({
          data: {
            organizationId,
            saleId,
            operation: 'VOID',
            idempotencyKey: `ebm-VOID-${organizationId}-${saleId}`,
            payload: { version: 1, saleId, organizationId, operation: 'VOID', reason: `Pre-approval correction: ${reason}` } as any,
            status: 'PENDING',
            nextAttemptAt: new Date(),
          },
        });
      }
    });

    // Create the corrected sale through the standard pipeline (stock, tax,
    // numbering, fiscalization all apply exactly as for a new NS sale).
    let committed;
    try {
      committed = await commitSale({
        organizationId,
        branchId: branchId as number,
        userId: parseInt(userId as string),
        customerId: customerId ? Number(customerId) : sale.customerId,
        items,
        paymentType,
        cashAmount,
        debtAmount,
        insuranceAmount,
        payments: splitPayments,
        shiftId,
        isProforma: false,
        inventoryMethod: req.body?.inventoryMethod,
        req,
      });
    } catch (e: any) {
      // The original is already cancelled at this point (cancel-once rule), so
      // a failed correction must be re-entered as a brand-new sale — say so
      // explicitly instead of leaving the operator guessing.
      const status = e instanceof CommitSaleError ? e.statusCode : 500;
      return res.status(status).json(apiError(
        `Original sale #${sale.saleNumber} was cancelled, but the corrected sale could not be created: ${e.message}. Re-enter the corrected sale as a new sale.`,
      ));
    }

    await prisma.sale.update({
      where: { id: saleId },
      data: { cancellationReason: `Pre-approval correction: ${reason} [Corrected by ${committed.sale.saleNumber} (sale #${committed.sale.id})]` },
    });

    if (isEbmEnabled() && orgSettings.featureFlags.ebmIntegrationEnabled) {
      void processEbmOutboxBatch(50).catch((e) => {
        console.error('[EBM] immediate void fiscalization error:', e);
      });
    }

    await auditLogger.sales(req, {
      type: 'SALE_CORRECTED',
      description: `Sale #${sale.saleNumber} corrected before VSDC approval: ${reason}`,
      entityType: 'Sale',
      entityId: saleId,
      metadata: { correctionReason: reason, correctedSaleId: committed.sale.id, correctedSaleNumber: committed.sale.saleNumber },
    });

    res.status(201).json(success({ ...(committed.completeSale ?? committed.sale), fiscalization: committed.fiscalization, correctedFromSaleId: saleId }));
  } catch (error: any) {
    console.error("[Correct Sale Error]:", error);
    res.status(500).json(apiError("Failed to correct sale"));
  }
};

/**
 * Build the RRA QR string per CIS/VSDC spec (§4.2):
 * ddmmyyyy#hhmmss#sdcId#rcptNo/totRcptNo+label#internalData#receiptSignature,
 * the receipt number exactly as printed in RECEIPT NUMBER (e.g. 212/237NS).
 */
function buildRraQrString(p: {
  sdcDateTime?: string | Date | null
  sdcId?: string | null
  sdcRcptNo?: number | string | null
  totalRcptNo?: number | string | null
  rcptLabel?: string | null
  internalData?: string | null
  receiptSignature?: string | null
}): string | null {
  if (!p.sdcDateTime || !p.sdcId || p.sdcRcptNo == null || !p.internalData || !p.receiptSignature) return null
  const dt = p.sdcDateTime instanceof Date ? p.sdcDateTime : new Date(p.sdcDateTime)
  if (Number.isNaN(dt.getTime())) return null
  // QR date/time are Kigali wall time, same clock as the printed SDC block.
  const k = kigaliWallParts(dt)
  return [
    `${k.day}${k.month}${k.year}`,
    `${k.hour}${k.minute}${k.second}`,
    p.sdcId,
    `${p.sdcRcptNo}${p.totalRcptNo != null ? `/${p.totalRcptNo}` : ""}${p.rcptLabel ?? ""}`,
    p.internalData,
    p.receiptSignature,
  ].join("#")
}

const RCT_LABEL_DISPLAY: Record<string, string> = {
  NS: "Normal Sale",
  NR: "Normal Refund",
  CS: "Copy Sale",
  CR: "Copy Refund",
  TS: "Training Sale",
  TR: "Training Refund",
  PS: "Proforma Sale",
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile Money",
  MTN_MOMO: "MTN Mobile Money",
  CARD: "Card",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Debit Card",
  BANK_TRANSFER: "Bank Transfer",
  PAYPACK: "PayPack",
  CREDIT: "Credit",
  DEBT: "Credit",
  MIXED: "Mixed",
}

/**
 * Composed invoice payload used by the modern ERP invoice renderer.
 *
 * GET /api/organizations/:orgId/invoices/:saleId
 *
 * Returns a single, fully-mapped document so the frontend renders ONLY values
 * coming from the API — no hardcoded business data anywhere in the UI.
 * All money arithmetic (subtotal, discount, VAT, tax, paid, balance, grand
 * total) is performed here in the backend; the frontend merely displays it.
 */
/**
 * Thrown by composeInvoicePayload when a real (non-proforma) sale has not yet
 * been confirmed by VSDC — RRA VSDC spec forbids issuing/printing a receipt
 * without that confirmation (checklist §16/§22), so callers must surface this
 * distinctly instead of falling back to a degraded, unsigned receipt.
 */
export class FiscalizationPendingError extends Error {
  constructor(public readonly reason: "pending" | "failed") {
    super(`Sale not yet confirmed by VSDC (${reason})`)
    this.name = "FiscalizationPendingError"
  }
}

/**
 * `copy`:
 *  - "auto" (default): a sale whose original was already issued and then
 *    registered again (reprintCount > 1, see reprintSaleReceipt) renders as
 *    its CS/CR copy.
 *  - "force": always render the CS/CR copy (explicit copy request); throws
 *    ReceiptCopyError when the receipt is not an NS/NR or its stored VSDC
 *    record is incomplete.
 */
export async function composeInvoicePayload(
  req: BranchAuthRequest,
  opts: { allowUnfiscalized?: boolean; copy?: "auto" | "force" } = {},
): Promise<RenderInvoicePayload | null> {
  const saleId = parseInt(req.params.saleId ?? req.params.id)
  const organizationId = parseInt(req.params.organizationId)

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      include: {
        customer: { select: { id: true, name: true, phone: true, TIN: true, email: true, address: true, custPrvncNm: true, custDstrtNm: true, custSctrNm: true, custLocDesc: true } },
        user: { select: { id: true, name: true } },
        saleItems: { include: { product: true } },
        salePayments: { select: { paymentMethod: true, amount: true } },
        ebmTransactions: { orderBy: { createdAt: "desc" } },
        originalSale: {
          select: {
            vsdcInvcNo: true,
            invoiceNumber: true,
            saleNumber: true,
            rcptLabel: true,
            ebmTransactions: {
              where: { submissionStatus: "SUCCESS", sdcRcptNo: { not: null } },
              orderBy: { createdAt: "desc" },
              select: { sdcRcptNo: true, operation: true, responseData: true },
            },
          },
        },
      },
    })

    if (!sale) return null

    // Every receipt type — normal (NS/NR), training (TS/TR) and proforma (PS)
    // — is submitted to VSDC, so a sale that has an outbox row must have
    // reached SUCCEEDED before its receipt can be composed — anything else
    // (PENDING/PROCESSING/FAILED still retrying, or permanently DEAD_LETTER)
    // blocks here rather than silently degrading to an unsigned receipt.
    // (Proforma/training sales created before this guarantee shipped have no
    // outbox row at all and compose without a fiscal block, as before.)
    // Set when the sale is real but VSDC has not confirmed it yet. By default
    // that is a hard stop (RRA VSDC spec §16/§22 — no receipt without VSDC
    // confirmation); when the caller passes allowUnfiscalized (a deliberate,
    // user-initiated download/print), we instead compose the payload and stamp
    // it NOT FISCALISED so the document can never pass as a real tax receipt.
    let notFiscalized: "pending" | "failed" | null = null
    {
      // Not filtered to operation:"SALE" — a refund sale's outbox row is
      // written with operation:"REFUND" (see refundSale), and a voided sale's
      // with "VOID"; whichever applies to this sale is what must have SUCCEEDED.
      const outboxRow = await prisma.ebmOutbox.findFirst({
        where: { saleId: sale.id },
        orderBy: { createdAt: "desc" },
        select: { status: true, operation: true },
      })
      // A SALE/REFUND row is only "done" when the VSDC receipt it produced is
      // on record; a SUCCEEDED row without one has no fiscal data to print.
      // A forced copy is validated field by field by assertCopyableFiscalRecord.
      const confirmedReceipt = (sale.ebmTransactions ?? []).some(
        (t) => t.submissionStatus === "SUCCESS" && t.sdcRcptNo != null && (!t.operation || t.operation === "SALE" || t.operation === "REFUND"),
      )
      const missingReceipt =
        opts.copy !== "force" && outboxRow?.status === "SUCCEEDED" && outboxRow.operation !== "VOID" && !confirmedReceipt
      if (outboxRow && (outboxRow.status !== "SUCCEEDED" || missingReceipt)) {
        const reason = outboxRow.status === "DEAD_LETTER" || missingReceipt ? "failed" : "pending"
        if (!opts.allowUnfiscalized) throw new FiscalizationPendingError(reason)
        notFiscalized = reason
      }
    }

    const [org, branch] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, avatar: true, address: true, phone: true, email: true, TIN: true, VRN: true, currency: true, ebmDeviceId: true, ebmSerialNo: true, mrcNo: true },
      }),
      prisma.branch.findUnique({
        where: { id: sale.branchId },
        select: { name: true, bhfId: true, ebmDeviceId: true, ebmSerialNo: true, mrcNo: true, ebmInitInfo: true, address: true },
      }),
    ])

    // "Linked to RRA/EBM" means the VSDC device credentials actually used to
    // talk to RRA (see getOsdcCreds/getVsdcCreds: org.TIN + branch.ebmSerialNo,
    // falling back to org.ebmSerialNo) are configured — NOT ebmDeviceId, which
    // is just the SDC ID RRA hands back after a successful transaction and is
    // still empty for a freshly-registered device that hasn't fiscalized yet.
    // bhfId is sourced from branch.bhfId (configurable in Organization Settings),
    // falling back to config.ebm.defaultBhfId
    const isEbmLinked = Boolean(org?.TIN && (branch?.ebmSerialNo || org?.ebmSerialNo))

    const fiscalTx = (sale.ebmTransactions ?? []).find((t) => t.submissionStatus === "SUCCESS" && (!t.operation || t.operation === "SALE" || t.operation === "REFUND"))
    const responseData = fiscalTx?.responseData as { normalized?: { ebmInvoiceNumber?: string; verificationCode?: string; sdcDateTime?: string; intrlData?: string; vsdcSignature?: string; mrcNo?: string } } | null | undefined
    const norm = responseData?.normalized
    // The request/response actually exchanged with VSDC. Printed fiscal values
    // come from here first so a reprint/copy still matches VSDC after the
    // catalog, customer or tax settings change.
    const vsdcRecord = readVsdcRecord(fiscalTx?.responseData)

    // MRC: the device MRC configured in the CIS (spec Art. 3.2.1); the value
    // VSDC returned on the signed receipt is the fallback for unconfigured devices.
    const mrcNo = configuredMrc(branch, org) || vsdcMrcNo(vsdcRecord) || norm?.mrcNo || resolveReportMrc(branch, org)
    // Prefer the ID stamped in the successful RRA response. Configured device
    // values are a fallback only; this keeps the printed SDC identifier aligned
    // with the actual fiscal receipt.
    let sdcId = fiscalTx?.sdcId ?? vsdcSdcId(vsdcRecord) ?? branch?.ebmDeviceId ?? org?.ebmDeviceId ?? null
    // Proforma/training documents never get their own fiscalTx (never
    // submitted to VSDC), and the device may not have its ebmDeviceId
    // backfilled in Organization/Branch settings — but the SDC ID is a fixed
    // per-device identifier, so reuse the one this branch's device was last
    // handed back on any real, successfully-fiscalized sale.
    if (!sdcId) {
      const lastKnownDevice = await prisma.ebmTransaction.findFirst({
        where: { organizationId, sdcId: { not: null }, sale: { branchId: sale.branchId } },
        orderBy: { createdAt: "desc" },
        select: { sdcId: true },
      })
      sdcId = lastKnownDevice?.sdcId ?? null
    }
    const sdcRcptNo = fiscalTx?.sdcRcptNo ?? null
    const totalRcptNo = fiscalTx?.totalRcptNo ?? null
    // CIS §6.3.6/§16: training and proforma receipts print no Internal Data, no
    // signature and no QR — even legacy TS/PS rows that VSDC once signed as 'N'.
    const isTrainingReceipt = isTrainingLabel(fiscalTx?.rcptLabel ?? sale.rcptLabel ?? null)
    const isUnsignedReceipt = isUnsignedLabel(fiscalTx?.rcptLabel ?? sale.rcptLabel ?? null) || !!sale.isProforma
    const internalData = isUnsignedReceipt ? null : fiscalTx?.internalData ?? norm?.intrlData ?? null
    const receiptSignature = isUnsignedReceipt ? null : fiscalTx?.receiptSignature ?? norm?.vsdcSignature ?? norm?.verificationCode ?? null
    // A receipt with no fiscalTx yet (still pending VSDC confirmation, or a
    // proforma/training sale created before all receipt types were fiscalized)
    // has no VSDC-stamped time either — fall back to the CIS's own creation
    // time, same as the spec's own proforma example still prints a date/time
    // under SDC INFORMATION.
    const sdcDateTime = fiscalTx?.sdcDateTime ?? norm?.sdcDateTime ?? (sale.isProforma ? sale.createdAt : null)
    const ebmInvoiceNumber = fiscalTx?.ebmInvoiceNumber ?? norm?.ebmInvoiceNumber ?? sale.invoiceNumber ?? null
    const rcptLabel = fiscalTx?.rcptLabel ?? sale.rcptLabel ?? null
    // Until VSDC confirms (no fiscalTx/sdcRcptNo yet), a proforma or training
    // receipt prints its own local, non-fiscal counter pair instead:
    // localReceiptSeq (this type only) / localReceiptTotalSeq (every
    // locally-numbered type combined), the same distinct-A/B shape as a real
    // VSDC counter (spec §7.25's own example: "168/258 NS" — two different numbers).
    const fiscalReceiptNumber = sdcRcptNo != null
      ? `${sdcRcptNo}${totalRcptNo != null ? `/${totalRcptNo}` : ""}${rcptLabel ? ` ${rcptLabel}` : ""}`
      : sale.localReceiptSeq != null && !isTrainingReceipt
        ? `${sale.localReceiptSeq}/${sale.localReceiptTotalSeq ?? sale.localReceiptSeq}${rcptLabel ? ` ${rcptLabel}` : ""}`
        : sale.saleNumber
    // The invoice number is the sequence submitted to VSDC (invcNo), not the
    // SDC device identifier. SDC ID and receipt counters are printed separately.
    const sentInvcNo = vsdcInvoiceNumber(vsdcRecord) ?? sale.vsdcInvcNo
    const fiscalInvoiceNumber = sentInvcNo != null
      ? String(sentInvcNo)
      : ebmInvoiceNumber ?? sale.invoiceNumber ?? sale.saleNumber
    // The orgInvcNo this refund was submitted with (falls back to the linked
    // original before VSDC has confirmed the refund).
    const originalInvoiceNumber = vsdcOriginalInvoiceNumber(vsdcRecord) ?? sale.originalSale?.vsdcInvcNo ?? null
    // REF. NORMAL RECEIPT# prints the orgInvcNo the refund references — the
    // same value VSDC prints on its own NR journal (e.g. 149), not the
    // original's SDC rcptNo.
    const originalReceiptNumber = formatOriginalReceiptReference(originalInvoiceNumber)

    const currency = org?.currency ?? "RWF"
    const toNumber = (v: unknown): number => (v == null ? 0 : typeof v === "number" ? v : Number(String(v)))
    // R2: renderers print every programmed rate > 0 on every receipt — the
    // rates VSDC received for this receipt, else the currently programmed ones.
    const programmedRates: [number, number, number, number] = vsdcTaxRates(vsdcRecord) ?? await getTaxRatesBySlot(organizationId)
    const sentItems = vsdcItems(vsdcRecord)
    const saleLineCount = (sale.saleItems ?? []).length
    const totalAmount = toNumber(sale.totalAmount)
    const cashAmount = toNumber(sale.cashAmount)
    const debtAmount = toNumber(sale.debtAmount)
    const insuranceAmount = toNumber(sale.insuranceAmount)
    const vatAmount = toNumber(sale.vatAmount)
    const taxableAmount = toNumber(sale.taxableAmount)
    // A refund stores every amount negative; compute the residual sale-level
    // discount on magnitudes and re-apply the document's sign so a refund
    // receipt shows the discount negative too (RRA checklist §56) instead of a
    // spurious positive value.
    const docSign = totalAmount < 0 ? -1 : 1
    const discountAmount = docSign * Math.max(
      0,
      Math.abs(totalAmount) - Math.abs(cashAmount) - Math.abs(debtAmount) - Math.abs(insuranceAmount) - Math.abs(vatAmount) - Math.abs(taxableAmount),
    )

    const items = (sale.saleItems ?? []).map((line, index) => {
      const qty = toNumber(line.quantity)
      const unitPrice = toNumber(line.unitPrice)
      const gross = qty * unitPrice
      const dcAmt = toNumber(line.dcAmt)
      const dcRate = toNumber(line.dcRate)
      const taxAmt = toNumber(line.taxAmount)
      const taxRate = toNumber(line.taxRate)
      // Line money legs are 2 dp (DB columns are Decimal(15,2)); rounding here
      // keeps float dust out of every downstream band derivation.
      const net = round2(gross - dcAmt)
      const sent = vsdcItemForLine(sentItems, saleLineCount, index)
      return {
        id: String(line.id),
        line: index + 1,
        // Item code and name must be EXACTLY what was submitted to VSDC
        // (itemList[].itemCd / itemNm). Before submission the same values
        // buildRraSendReceiptPayload would send are used: registered itemCd
        // (or SVC-n for ad-hoc service lines) and product name before service
        // name. Never substitute sku/barcode here — those are never sent to
        // RRA. A catalog line still missing its itemCd prints blank (the
        // submission then dead-letters with an actionable message instead of
        // fiscalizing a code RRA never saw).
        code: sent?.itemCd ?? line.product?.itemCd ?? ((line as any).productId != null ? "" : `SVC-${index + 1}`),
        description: sent?.itemNm ?? line.product?.name ?? line.serviceName ?? line.serviceDescription ?? "",
        quantity: qty,
        unit: line.measurementUnit ?? "PCS",
        // Per-unit price always prints positive, refund or not — only qty and
        // the amounts derived from it (gross/net/total) carry the refund's
        // negative sign. qty is already stored negative for a refund line, so
        // qty*unitPrice still yields the correct negative line total below.
        unitPrice: Math.abs(unitPrice),
        discountPct: dcRate,
        discountAmt: dcAmt,
        taxCode: line.taxCode ?? null,
        vatPct: taxRate,
        taxAmount: taxAmt,
        subtotal: round2(gross),
        net,
        // Unit prices and `sale.totalAmount` are VAT-inclusive throughout the
        // checkout flow. The tax is an extraction from the gross line, not an
        // amount to add again on the printed invoice.
        total: net,
        itemType: line.itemType,
      }
    })

    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    const itemDiscount = items.reduce((s, i) => s + i.discountAmt, 0)
    // R4/R11: receipt-level tax is derived once per band from the band NETs
    // (money.service policy) — never summed from per-line cents — so the
    // printed TOTAL TAX matches the R4 sample (5340.00 x 18/118 = 814.58).
    const derivedBandTax = bandTaxAmounts(items, programmedRates)
    const receiptTax = round2(Object.values(derivedBandTax).reduce((s, t) => s + t, 0))
    // §56: keep the discount signed with the document (negative on a refund).
    // R11: two decimals everywhere — whole-unit Math.round destroyed cents.
    const discount = docSign * Math.max(0, round2(Math.abs(itemDiscount) + Math.abs(discountAmount)))
    const grandTotal = round2(totalAmount)
    const paid = round2(cashAmount + insuranceAmount)
    const balance = round2(debtAmount)

    // QR image is generated server-side — the frontend only renders the image returned by the API.
    const qrRaw = isUnsignedReceipt
      ? null
      : buildRraQrString({ sdcDateTime, sdcId, sdcRcptNo, totalRcptNo, rcptLabel, internalData, receiptSignature }) ?? fiscalTx?.qrPayload ?? null
    // CIS §7.29 — official RRA logo on every receipt type.
    const rraLogoBuf = await getOrganizationLogo()
    const rraLogo = rraLogoBuf
      ? `data:image/png;base64,${rraLogoBuf.toString("base64")}`
      : null
    const qrCodeImage = qrRaw
      ? await QRCode.toDataURL(qrRaw, { errorCorrectionLevel: "M", margin: 1, width: 220, color: { dark: "#000000", light: "#FFFFFF" } })
      : null

    // A VSDC-confirmed training or proforma receipt is still not a certified tax receipt.
    const isCertified = !!fiscalTx && !isUnsignedReceipt
    const verificationUrl = isCertified && sdcId ? `https://esbm.rra.gov.rw/tax-invoice/verification?sdcId=${encodeURIComponent(sdcId)}&receipt=${encodeURIComponent(String(sdcRcptNo))}` : null

    const dateObj = new Date(sale.createdAt)
    // CIS receipt clock is Kigali wall time, matching the SDC block and QR.
    const kigaliNow = kigaliWallParts(dateObj)
    const time = `${kigaliNow.hour}:${kigaliNow.minute}:${kigaliNow.second}`
    const invoiceDate = dateObj.toISOString()

    const paymentMethodLabel = PAYMENT_METHOD_LABEL[sale.paymentType] ?? sale.paymentType ?? ""
    // R1: every means of payment prints with its amount. Split tenders come
    // from the SalePayment rows; otherwise the single payment-type line with
    // the grand total (unchanged legacy behavior).
    const paymentLines = (sale.salePayments ?? [])
      .map((p) => {
        const method = String((p as any).paymentMethod ?? "")
        return {
          method,
          label: PAYMENT_METHOD_LABEL[method] ?? method,
          amount: round2(Number((p as any).amount ?? 0)),
        }
      })
      .filter((l) => l.method && l.amount !== 0)

    const sentBuyer = vsdcBuyer(vsdcRecord)
    const invoiceData: RenderInvoicePayload = {
      company: {
        logo: org?.avatar ?? null,
        name: org?.name ?? "",
        address: branch?.address ?? org?.address ?? "",
        branchName: branch?.name ?? null,
        bhfId: branch?.bhfId ?? null,
        phone: org?.phone ?? null,
        email: org?.email ?? null,
        tin: org?.TIN ?? null,
        vrn: org?.VRN ?? null,
        mrc: mrcNo,
        website: null,
        currency,
        ebmLinked: isEbmLinked,
      },
      customer: {
        name: sentBuyer?.name ?? sale.customer?.name ?? "",
        // The buyer TIN the VSDC payload carries (receipt.custTin) — blank
        // for a buyer without a TIN; the phone prints on its own line.
        tin: sentBuyer?.hasTin ? sentBuyer.tin : resolveVsdcBuyerIdentity(sale.customer).receiptCustTin,
        phone: sale.customer?.phone ?? null,
        email: sale.customer?.email ?? null,
        // Free-text legacy address first, then the structured RRA buyer
        // address parts (street/cell, sector, district, province) when set.
        address: [
          sale.customer?.address,
          sale.customer?.custLocDesc,
          sale.customer?.custSctrNm,
          sale.customer?.custDstrtNm,
          sale.customer?.custPrvncNm,
        ].filter((p) => p && String(p).trim()).join(', ') || null,
        vatNo: sale.customer?.TIN ?? null,
      },
      invoice: {
        id: String(sale.id),
        saleNumber: sale.saleNumber,
        invoiceNumber: fiscalInvoiceNumber,
        receiptNumber: fiscalReceiptNumber,
        invoiceDate,
        time,
        paymentMethod: paymentMethodLabel,
        cashier: sale.user?.name ?? "",
        status: sale.status,
        rcptLabel,
        rcptLabelText: rcptLabel ? RCT_LABEL_DISPLAY[rcptLabel] ?? rcptLabel : null,
        isProforma: sale.isProforma,
        notFiscalized,
        // CIS/VSDC spec §7.18/§15: only ONE original printout is allowed —
        // reprintCount is incremented on every deliberate "download" of this
        // invoice's PDF, so the first download (count reaches 1) stays the
        // original and every one after (count > 1) renders as a COPY.
        isCopy: (sale.reprintCount ?? 0) > 1,
        currency,
        originalReceiptNumber,
        originalInvoiceNumber: originalInvoiceNumber != null ? String(originalInvoiceNumber) : null,
        refundReason: (sale as { refundReason?: string | null }).refundReason ?? null,
        refundReasonCode: (sale as { rfdRsnCd?: string | null }).rfdRsnCd ?? null,
        refundRecipient: (sale as { refundRecipient?: string | null }).refundRecipient ?? null,
      },
      items,
      totals: {
        subtotal: round2(subtotal),
        discount,
        taxable: round2(taxableAmount),
        vat: receiptTax,
        tax: receiptTax,
        shipping: 0,
        paid,
        balance,
        grandTotal,
      },
      taxRates: programmedRates,
      charges: {
        vatAmount: round2(vatAmount),
        taxableAmount: round2(taxableAmount),
        discountAmount: round2(discountAmount),
        cashAmount: round2(cashAmount),
        insuranceAmount: round2(insuranceAmount),
        debtAmount: round2(debtAmount),
        totalAmount: round2(totalAmount),
        shipping: 0,
      },
      payment: {
        method: sale.paymentType ?? "",
        methodLabel: paymentMethodLabel,
        reference: null,
        bank: null,
        cashAmount: round2(cashAmount),
        insuranceAmount: round2(insuranceAmount),
        debtAmount: round2(debtAmount),
        lines: paymentLines,
      },
      sdcInformation: {
        sdcId,
        mrcNo,
        receiptNumber: (sdcRcptNo != null || sale.isProforma) ? fiscalReceiptNumber : null,
        receiptSignature,
        internalData,
        sdcDateTime: sdcDateTime ? String(sdcDateTime) : null,
        date: sdcDateTime ? new Date(sdcDateTime).toISOString() : null,
        time: sdcDateTime ? (() => { const k = kigaliWallParts(new Date(sdcDateTime)); return `${k.hour}:${k.minute}:${k.second}` })() : null,
        ebmInvoiceNumber: ebmInvoiceNumber,
        rcptLabel,
        poweredBy: SYSTEM_FOOTER,
        softwareVersion: CIS_VERSION_LABEL,
      },
      certification: {
        isCertified,
        certificateImage: null,
        certificateText: isCertified ? "This is a fiscalized EBM receipt certified by the Rwanda Revenue Authority." : null,
      },
      verification: {
        qrCodeImage,
        qrPayload: qrRaw,
        verificationUrl,
      },
      branding: {
        primaryColor: "#1565C0",
        rraLogo,
        poweredBy: SYSTEM_POWERED_BY,
      },
      footer: {
        message: "Thank you for your business.",
        note: null,
      },
    }

    const copySource = {
      rcptLabel: sale.rcptLabel ?? null,
      isProforma: sale.isProforma,
      originalSaleId: sale.originalSaleId ?? null,
      status: sale.status,
    }
    const forceCopy = opts.copy === "force"
    const autoCopy = !forceCopy && !notFiscalized && (sale.reprintCount ?? 0) > 1 && copyLabelFor(copySource) !== null
    if (forceCopy || autoCopy) {
      const copyLabel = resolveCopyLabel(copySource)
      assertCopyableFiscalRecord(fiscalTx ? {
        submissionStatus: fiscalTx.submissionStatus,
        operation: fiscalTx.operation ?? null,
        sdcId: fiscalTx.sdcId,
        sdcRcptNo: fiscalTx.sdcRcptNo,
        totalRcptNo: fiscalTx.totalRcptNo,
        internalData: fiscalTx.internalData,
        receiptSignature: fiscalTx.receiptSignature,
        sdcDateTime: fiscalTx.sdcDateTime,
        rcptLabel: fiscalTx.rcptLabel ?? null,
      } : null, copyLabel)
      const copyNumber = forceCopy
        ? nextReprintCountForCopy(sale.reprintCount) - 1
        : (sale.reprintCount ?? 0) - 1
      return applyCopyDesignation(invoiceData, { label: copyLabel, copyNumber })
    }

    return invoiceData
}

export const getInvoice = async (req: BranchAuthRequest, res: Response) => {
  try {
    // ?allowPending=1 — the caller wants the composed invoice even before VSDC
    // confirms it (to view/download it, stamped NOT FISCALISED). Without it the
    // endpoint keeps returning 425 while fiscalization is in flight, which the
    // POS/sales fiscalization poll relies on.
    const allowUnfiscalized = String(req.query.allowPending ?? "") === "1"
    const invoiceData = await composeInvoicePayload(req, { allowUnfiscalized })
    if (!invoiceData) return res.status(404).json(apiError("Sale not found"))

    return res.json(success({
      ...invoiceData,
      renderedHtml: renderSalesInvoiceHtml(invoiceData),
    }))
  } catch (error: any) {
    if (error instanceof FiscalizationPendingError) {
      return res.status(425).json({ success: false, status: "pending_fiscalization", reason: error.reason, error: error.message })
    }
    if (error instanceof ReceiptCopyError) return sendReceiptCopyError(res, error)
    console.error("[Get Invoice Error]:", error)
    return res.status(500).json(apiError("Failed to get invoice"))
  }
}

function sendReceiptCopyError(res: Response, error: ReceiptCopyError) {
  return res.status(error.status).json({ success: false, code: error.code, error: error.message })
}

function parsePdfFormat(value: unknown): InvoicePdfFormat {
  const q = String(value ?? "").toUpperCase()
  return q === "80MM" ? "80mm" : q === "A5" ? "A5" : "A4"
}

/**
 * CS/CR — print a copy of an existing NS/NR receipt.
 * POST /api/sales/:organizationId/:saleId/copy?format=A4|A5|80mm
 *
 * The copy reprints the original receipt's VSDC data (counter, timestamp,
 * internal data, signature, QR) under a COPY header title. Nothing is
 * sent to VSDC and no sale, refund, stock, payment, tax or accounting record
 * is created.
 */
export const printReceiptCopy = async (req: BranchAuthRequest, res: Response) => {
  try {
    const saleIdParam = Number(req.params.saleId)
    if (!Number.isInteger(saleIdParam) || saleIdParam <= 0) {
      return res.status(400).json(apiError("Invalid receipt id"))
    }
    const format = parsePdfFormat(req.query.format ?? req.body?.format)
    const visible = await prisma.sale.findFirst({
      where: { id: saleIdParam, organizationId: parseInt(req.params.organizationId), ...buildBranchFilter(req) },
      select: { id: true },
    })
    if (!visible) return res.status(404).json(apiError("Receipt not found"))
    const invoiceData = await composeInvoicePayload(req, { copy: "force" })
    if (!invoiceData) return res.status(404).json(apiError("Receipt not found"))

    const pdf = format === "80mm"
      ? await generateEbmReceiptPdf80mm(invoiceData)
      : await generateEbmInvoicePdf(invoiceData, format === "A5" ? "A5" : "A4")

    // Counted only after the copy rendered. Two atomic steps keep concurrent
    // copies from losing an increment: the original always counts as issued
    // (count >= 1), then this copy adds one.
    const saleId = Number(invoiceData.invoice.id)
    await prisma.sale.updateMany({ where: { id: saleId, reprintCount: { lt: 1 } }, data: { reprintCount: 1 } })
    const updated = await prisma.sale.update({
      where: { id: saleId },
      data: { reprintCount: { increment: 1 } },
      select: { reprintCount: true },
    })
    const copyNumber = updated.reprintCount - 1
    const copyData = { ...invoiceData, invoice: { ...invoiceData.invoice, copyNumber } }

    await auditLogger.sales(req, {
      type: 'SALE_REPRINTED',
      description: `${invoiceData.invoice.copyLabel} copy #${copyNumber} printed for Sale #${invoiceData.invoice.saleNumber} (original ${invoiceData.invoice.copyOfReceiptNumber ?? invoiceData.invoice.invoiceNumber})`,
      entityType: 'Sale',
      entityId: saleId,
      metadata: {
        copyLabel: invoiceData.invoice.copyLabel,
        copyNumber,
        reprintCount: updated.reprintCount,
        format,
        sourceRcptLabel: invoiceData.invoice.rcptLabel ?? null,
        copyOfReceiptNumber: invoiceData.invoice.copyOfReceiptNumber ?? null,
      },
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Length", String(pdf.length))
    res.setHeader("Content-Disposition", `inline; filename="${getEbmInvoiceFilename(copyData, format)}"`)
    res.setHeader("Cache-Control", "private, no-store")
    res.setHeader("X-Receipt-Copy-Label", String(invoiceData.invoice.copyLabel))
    res.setHeader("X-Receipt-Copy-Number", String(copyNumber))
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Receipt-Copy-Label, X-Receipt-Copy-Number")
    return res.status(200).send(pdf)
  } catch (error: any) {
    if (error instanceof FiscalizationPendingError) {
      return res.status(425).json({ success: false, status: "pending_fiscalization", reason: error.reason, error: "The original receipt has not been confirmed by VSDC yet — there is no original to copy" })
    }
    if (error instanceof ReceiptCopyError) return sendReceiptCopyError(res, error)
    console.error("[Print Receipt Copy Error]:", error)
    return res.status(500).json(apiError("Failed to print receipt copy"))
  }
}

/** Authoritative backend-generated invoice PDF (A4, A5 or 80mm) for download, preview, sharing, and printing. */
export const getInvoicePdf = async (req: BranchAuthRequest, res: Response) => {
  try {
    // CIS §16/§22: official receipts wait for VSDC signature (425 while pending).
    // ?allowPending=1 — POS/auto-print may request the composed PDF stamped
    // NOT FISCALISED so the slip still prints immediately after a sale.
    const allowUnfiscalized = String(req.query.allowPending ?? "") === "1"
    const invoiceData = await composeInvoicePayload(req, { allowUnfiscalized })
    if (!invoiceData) return res.status(404).json(apiError("Sale not found"))

    const format = parsePdfFormat(req.query.format)
    const pdf = format === "80mm"
      ? await generateEbmReceiptPdf80mm(invoiceData)
      : await generateEbmInvoicePdf(invoiceData, format === "A5" ? "A5" : "A4")
    const filename = getEbmInvoiceFilename(invoiceData, format)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Length", String(pdf.length))
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
    res.setHeader("Cache-Control", "private, no-store")
    return res.status(200).send(pdf)
  } catch (error: any) {
    if (error instanceof FiscalizationPendingError) {
      return res.status(425).json({ success: false, status: "pending_fiscalization", reason: error.reason, error: error.message })
    }
    if (error instanceof ReceiptCopyError) return sendReceiptCopyError(res, error)
    console.error("[Get Invoice PDF Error]:", error)
    return res.status(500).json(apiError("Failed to generate invoice PDF"))
  }
}

/**
 * CIS §7.28 — recover the last finalized receipt after power/paper failure so
 * the operator can reprint without re-entering the sale.
 * GET /api/sales/:organizationId/last-receipt
 */
export const getLastReceipt = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parseInt(req.params.organizationId)
    const branchFilter = buildBranchFilter(req)
    const sale = await prisma.sale.findFirst({
      where: {
        organizationId,
        ...branchFilter,
        status: { in: ["COMPLETED", "REFUNDED"] },
        OR: [
          { isProforma: true },
          { ebmTransactions: { some: { submissionStatus: "SUCCESS" } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        saleNumber: true,
        invoiceNumber: true,
        rcptLabel: true,
        status: true,
        totalAmount: true,
        reprintCount: true,
        createdAt: true,
        isProforma: true,
      },
    })
    if (!sale) return res.status(404).json(apiError("No recoverable receipt found for this branch"))
    return res.json(success({ sale }))
  } catch (error: any) {
    console.error("[Last Receipt Error]:", error)
    return res.status(500).json(apiError("Failed to load last receipt"))
  }
}

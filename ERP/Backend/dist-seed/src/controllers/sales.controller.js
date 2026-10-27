"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLastReceipt = exports.getInvoicePdf = exports.getInvoice = exports.FiscalizationPendingError = exports.cancelSale = exports.getEbmReceipt = exports.regenerateInvoice = exports.reprintSaleReceipt = exports.refundSale = exports.payDebt = exports.getSaleById = exports.getSales = exports.convertProforma = exports.updateProforma = exports.createSale = void 0;
exports.composeInvoicePayload = composeInvoicePayload;
const prisma_1 = require("../lib/prisma");
const auditLogger_1 = require("../utils/auditLogger");
const inventory_ledger_service_1 = require("../services/inventory-ledger.service");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const ebm_outbox_service_1 = require("../services/ebm-outbox.service");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const apiResponse_1 = require("../utils/apiResponse");
const tax_service_1 = require("../services/tax.service");
const organization_settings_service_1 = require("../services/organization-settings.service");
const invoice_render_service_1 = require("../services/invoice-render.service");
const invoice_pdf_service_1 = require("../services/invoice-pdf.service");
const invoice_receipt_pdf_service_1 = require("../services/invoice-receipt-pdf.service");
const sale_commit_service_1 = require("../services/sale-commit.service");
const rra_code_service_1 = require("../services/rra-code.service");
const system_branding_service_1 = require("../services/system-branding.service");
const invoice_logo_service_1 = require("../services/invoice-logo.service");
const qrcode_1 = __importDefault(require("qrcode"));
const createSale = async (req, res) => {
    try {
        const { customerId, items, paymentType, cashAmount, debtAmount, insuranceAmount, isProforma, payments: splitPayments, shiftId, inventoryMethod } = req.body;
        // @ts-ignore
        const userId = parseInt(req.user?.userId);
        const organizationId = parseInt(req.params.organizationId);
        const branchId = await (0, branchAuth_middleware_1.resolveBranchIdForWrite)(req);
        const { sale, completeSale, fiscalization } = await (0, sale_commit_service_1.commitSale)({
            organizationId,
            branchId: branchId,
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
            req,
        });
        res.status(201).json((0, apiResponse_1.success)({ ...(completeSale ?? sale), fiscalization }));
    }
    catch (error) {
        if (error instanceof sale_commit_service_1.CommitSaleError) {
            return res.status(error.statusCode).json((0, apiResponse_1.error)(error.message));
        }
        console.error("[Create Sale Error]:", error);
        // Return appropriate status code based on error type
        if (error.message && error.message.includes('Insufficient stock')) {
            return res.status(400).json((0, apiResponse_1.error)(error.message || "Insufficient stock"));
        }
        if (error.message && error.message.includes('not found')) {
            return res.status(404).json((0, apiResponse_1.error)(error.message || "Resource not found"));
        }
        if (error.code === 'P2002' && error.message?.includes('invoice_number')) {
            return res.status(500).json((0, apiResponse_1.error)("Invoice number conflict. Please try again."));
        }
        res.status(500).json((0, apiResponse_1.error)("Failed to create sale"));
    }
};
exports.createSale = createSale;
/**
 * Recompute a proforma's line items / customer before it is converted.
 * A proforma never touched inventory, VSDC or the customer balance, so this is a
 * pure recompute: replace saleItems, refresh totals. Only allowed while the
 * proforma has not been converted yet.
 *
 * PUT /:organizationId/:saleId/proforma   body: { customerId?, items: [...] }
 */
const updateProforma = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const saleId = parseInt(req.params.saleId);
        const { customerId, items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json((0, apiResponse_1.error)("A proforma must have at least one item"));
        }
        const sale = await prisma_1.prisma.sale.findFirst({
            where: { id: saleId, organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) },
            include: { convertedSale: { select: { id: true } } },
        });
        if (!sale)
            return res.status(404).json((0, apiResponse_1.error)("Proforma not found"));
        if (!sale.isProforma)
            return res.status(400).json((0, apiResponse_1.error)("Only a proforma can be edited this way"));
        if (sale.status === 'CONVERTED' || sale.convertedSale) {
            return res.status(409).json((0, apiResponse_1.error)("This proforma has already been converted to a sale"));
        }
        const org = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { vatRegistered: true, isTaxExempt: true },
        });
        const itemsForTax = items.map((i) => ({
            productId: i.productId ? Number(i.productId) : undefined,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            itemType: i.itemType || 'PRODUCT',
        }));
        const taxSummary = await tax_service_1.TaxService.calculateSaleTax(organizationId, itemsForTax, org?.vatRegistered ?? false, org?.isTaxExempt ?? false);
        const computedTotal = taxSummary.items.reduce((sum, ti) => sum + Number(ti.taxableAmount) + Number(ti.taxAmount), 0);
        const saleItemsData = items.map((i, idx) => {
            const t = taxSummary.items[idx];
            const isService = (i.itemType || 'PRODUCT') === 'SERVICE';
            const quantity = Number(i.quantity);
            const unitPrice = Number(i.unitPrice);
            return {
                quantity,
                unitPrice,
                totalPrice: quantity * unitPrice,
                costPrice: 0,
                profit: 0,
                taxRate: t?.taxRate ?? 0,
                taxAmount: t?.taxAmount ?? 0,
                taxCode: t?.taxCode ?? null,
                itemType: isService ? 'SERVICE' : 'PRODUCT',
                measurementUnit: i.measurementUnit || 'PCS',
                serviceName: isService ? (i.serviceName || null) : null,
                serviceDescription: isService ? (i.serviceDescription || null) : null,
                // Services from the catalog still need productId for RRA itemClsCd/itemCd.
                ...(i.productId
                    ? { product: { connect: { id: Number(i.productId) } } }
                    : {}),
            };
        });
        const updated = await prisma_1.prisma.$transaction(async (tx) => {
            await tx.saleItem.deleteMany({ where: { saleId } });
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
                    saleItems: { create: saleItemsData },
                },
                include: {
                    saleItems: { include: { product: true } },
                    customer: true,
                },
            });
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'SALE_UPDATE',
            description: `Proforma #${sale.invoiceNumber ?? saleId} edited`,
            entityType: 'Sale',
            entityId: saleId,
            metadata: { itemCount: items.length, totalAmount: computedTotal },
        });
        res.json((0, apiResponse_1.success)(updated));
    }
    catch (error) {
        console.error("[Update Proforma Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to update the proforma"));
    }
};
exports.updateProforma = updateProforma;
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
const convertProforma = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const saleId = parseInt(req.params.saleId);
        // @ts-ignore
        const userId = parseInt(req.user?.userId);
        const branchId = await (0, branchAuth_middleware_1.resolveBranchIdForWrite)(req);
        const { paymentType, cashAmount, debtAmount, insuranceAmount, payments: splitPayments, shiftId, customerId, items } = req.body;
        const proforma = await prisma_1.prisma.sale.findFirst({
            where: { id: saleId, organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) },
            include: {
                saleItems: true,
                convertedSale: { select: { id: true, invoiceNumber: true } },
            },
        });
        if (!proforma)
            return res.status(404).json((0, apiResponse_1.error)("Proforma not found"));
        if (!proforma.isProforma)
            return res.status(400).json((0, apiResponse_1.error)("This sale is not a proforma"));
        if (proforma.status === 'CONVERTED' || proforma.convertedSale) {
            return res.status(409).json((0, apiResponse_1.error)("This proforma has already been converted", undefined, { convertedSaleId: proforma.convertedSale?.id ?? null }));
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
            }));
        const { sale, completeSale, fiscalization } = await (0, sale_commit_service_1.commitSale)({
            organizationId,
            branchId: branchId,
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
        });
        await prisma_1.prisma.sale.update({ where: { id: saleId }, data: { status: 'CONVERTED' } });
        res.status(201).json((0, apiResponse_1.success)({ ...(completeSale ?? sale), fiscalization, proformaSourceId: saleId }));
    }
    catch (error) {
        if (error instanceof sale_commit_service_1.CommitSaleError) {
            return res.status(error.statusCode).json((0, apiResponse_1.error)(error.message));
        }
        // proforma_source_id is unique — a concurrent convert loses this race.
        if (error.code === 'P2002' && String(error.meta?.target ?? '').includes('proforma_source_id')) {
            return res.status(409).json((0, apiResponse_1.error)("This proforma has already been converted"));
        }
        if (error.message && error.message.includes('Insufficient stock')) {
            return res.status(400).json((0, apiResponse_1.error)(error.message));
        }
        if (error.message && error.message.includes('not found')) {
            return res.status(404).json((0, apiResponse_1.error)(error.message));
        }
        console.error("[Convert Proforma Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to convert the proforma"));
    }
};
exports.convertProforma = convertProforma;
const getSales = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, customerId, page, limit, search, status, paymentType, rcptLabel } = req.query;
        const requestedPage = Number(page);
        const pageNumber = Number.isFinite(requestedPage) && requestedPage > 0
            ? Math.floor(requestedPage)
            : 1;
        const requestedLimit = Number(limit);
        const pageSize = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(Math.floor(requestedLimit), 500)
            : 50;
        const where = {
            organizationId,
            ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
        };
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }
        if (customerId) {
            where.customerId = parseInt(customerId);
        }
        if (status) {
            where.status = status;
        }
        if (paymentType) {
            where.paymentType = paymentType;
        }
        if (rcptLabel) {
            where.rcptLabel = rcptLabel;
        }
        if (search) {
            where.OR = [
                { saleNumber: { contains: search, mode: "insensitive" } },
                { invoiceNumber: { contains: search, mode: "insensitive" } },
                {
                    customer: {
                        name: { contains: search, mode: "insensitive" }
                    }
                }
            ];
        }
        const [sales, total] = await Promise.all([
            prisma_1.prisma.sale.findMany({
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
            prisma_1.prisma.sale.count({ where }),
        ]);
        res.json((0, apiResponse_1.success)({
            data: sales,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                total,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
            },
        }));
    }
    catch (error) {
        console.error("[Get Sales Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to get sales"));
    }
};
exports.getSales = getSales;
const getSaleById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const sale = await prisma_1.prisma.sale.findFirst({
            where: {
                id,
                organizationId,
                ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
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
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!sale) {
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        }
        res.json((0, apiResponse_1.success)(sale));
    }
    catch (error) {
        console.error("[Get Sale Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to get sale"));
    }
};
exports.getSaleById = getSaleById;
const payDebt = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const { amount } = req.body;
        const sale = await prisma_1.prisma.sale.findFirst({
            where: {
                id,
                organizationId,
                ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
            },
            include: {
                customer: true,
                saleItems: true
            }
        });
        if (!sale) {
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        }
        if (sale.status === 'REFUNDED' || sale.status === 'CANCELLED') {
            return res.status(400).json((0, apiResponse_1.error)(`Cannot process payment for ${sale.status.toLowerCase()} sale`));
        }
        const remainingDebt = sale.debtAmount.toNumber() - amount;
        if (remainingDebt < 0) {
            return res.status(400).json((0, apiResponse_1.error)("Amount exceeds debt"));
        }
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.sale.update({
                where: { id },
                data: {
                    debtAmount: remainingDebt,
                    cashAmount: { increment: amount },
                },
            });
            await tx.customer.update({
                where: { id: sale.customerId },
                data: {
                    balance: { decrement: amount },
                },
            });
        });
        await auditLogger_1.auditLogger.sales(req, {
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
        res.json((0, apiResponse_1.success)({ message: "Debt paid successfully" }));
    }
    catch (error) {
        console.error("[Pay Debt Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to pay debt"));
    }
};
exports.payDebt = payDebt;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const executeWithRetry = async (fn, retries = 0) => {
    try {
        return await fn();
    }
    catch (error) {
        if (error.code === 'P2028' && retries < MAX_RETRIES) {
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, retries);
            console.log(`Transaction timed out, retrying in ${delay}ms (attempt ${retries + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return executeWithRetry(fn, retries + 1);
        }
        throw error;
    }
};
const refundSale = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const orgSettings = await (0, organization_settings_service_1.getOrganizationSettings)(organizationId);
        const result = await executeWithRetry(async () => {
            return await prisma_1.prisma.$transaction(async (prisma) => {
                const { reason, items: refundItems, rfdRsnCd: rfdRsnCdRaw } = req.body;
                const userId = req.user?.userId;
                // RRA refund reason (code class 32): the operator's selection, validated
                // now so a bad code is a 400 instead of a dead-lettered fiscal refund.
                // Stored on the refund sale and carried on the outbox payload to VSDC
                // as rfdRsnCd; the free-text `reason` stays the human note (remark).
                let rfdRsnCd;
                try {
                    rfdRsnCd = (0, rra_code_service_1.validateRefundReasonCode)(typeof rfdRsnCdRaw === 'string' && rfdRsnCdRaw.trim() ? rfdRsnCdRaw.trim() : rra_code_service_1.DEFAULT_RFD_RSN_CD);
                }
                catch (e) {
                    throw { status: 400, message: e instanceof Error ? e.message : 'Invalid refund reason code' };
                }
                // Get the sale with items
                const sale = await prisma.sale.findFirst({
                    where: {
                        id,
                        organizationId,
                        ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
                    },
                    include: {
                        saleItems: {
                            include: {
                                product: true,
                                batch: true
                            }
                        },
                        customer: true
                    }
                });
                if (!sale) {
                    throw { status: 404, message: "Sale not found" };
                }
                if (sale.status === 'REFUNDED') {
                    throw { status: 400, message: "Sale already refunded" };
                }
                if (sale.status === 'CANCELLED') {
                    throw { status: 400, message: "Cannot refund a cancelled sale" };
                }
                // Ensure sale has items
                if (!sale.saleItems || sale.saleItems.length === 0) {
                    throw { status: 400, message: "Sale has no items to refund" };
                }
                // Strict Rule: Partial refunds are not allowed
                if (refundItems && refundItems.length > 0 && refundItems.length < sale.saleItems.length) {
                    throw { status: 400, message: "Partial refunds are not allowed. Only full refunds are permitted." };
                }
                // Get all sale items for full refund — include batchId to restore batch quantities.
                // Tax code / rate / amount and any line discount are carried over from the
                // original line so the refund is fiscalised (and printed) as a true mirror
                // of the original — otherwise a refund of an 18% VAT sale would be reported
                // to RRA as a tax-exempt, zero-VAT refund (RRA checklist §9/§56).
                const itemsToRefund = (sale.saleItems || []).map((item) => ({
                    saleItemId: item.id,
                    productId: item.productId,
                    quantity: item.quantity,
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
                    serviceName: item.serviceName || null,
                    serviceDescription: item.serviceDescription || null,
                }));
                // Calculate total refund amount
                const totalRefundAmount = itemsToRefund.reduce((sum, item) => sum + item.totalPrice, 0);
                const totalRefundVat = itemsToRefund.reduce((sum, item) => sum + item.taxAmount, 0);
                const totalRefundTaxable = totalRefundAmount - totalRefundVat;
                // ── MODULE 2.3: Reject if refund exceeds original total (defense-in-depth) ──
                const originalTotal = Number(sale.totalAmount);
                if (totalRefundAmount > originalTotal + 0.01) {
                    throw {
                        status: 400,
                        message: `Refund total ${totalRefundAmount.toFixed(2)} exceeds original invoice total ${originalTotal.toFixed(2)}`,
                    };
                }
                // Update original sale status
                await prisma.sale.update({
                    where: { id },
                    data: {
                        status: 'REFUNDED',
                        refundedAt: new Date(),
                        refundedById: parseInt(userId),
                        refundReason: reason
                    }
                });
                // Create a new REFUND sale record with negative amounts
                const refundSaleNumber = `REFUND-${sale.saleNumber}-${Date.now()}`;
                // C6: determine NR vs TR based on training mode
                const refundOrg = await prisma.organization.findUnique({
                    where: { id: organizationId },
                    select: { trainingMode: true },
                });
                const refundRcptLabel = refundOrg?.trainingMode ? 'TR' : 'NR';
                // A fiscal refund is a NEW sales-transaction document: allocate a fresh
                // VSDC invoice number for it (the sandbox rejects a resubmitted invcNo
                // with 924, and a refund with orgInvcNo=0 with 910). The original sale
                // is referenced via orgInvcNo at submission time (see outbox worker).
                const { invoiceNumber: refundInvoiceNumber, vsdcInvcNo: refundVsdcInvcNo } = await (0, rra_ebm_service_1.generateInvoiceNumber)(organizationId, sale.branchId, prisma);
                const refundSale = await prisma.sale.create({
                    data: {
                        saleNumber: refundSaleNumber,
                        invoiceNumber: refundInvoiceNumber,
                        vsdcInvcNo: refundVsdcInvcNo,
                        customerId: sale.customerId,
                        userId: parseInt(userId),
                        organizationId: organizationId,
                        branchId: sale.branchId,
                        paymentType: sale.paymentType,
                        cashAmount: -totalRefundAmount, // Negative amount
                        insuranceAmount: 0,
                        debtAmount: 0,
                        totalAmount: -totalRefundAmount, // Negative total
                        vatAmount: -totalRefundVat, // Negative — mirrors the original VAT being refunded
                        taxableAmount: -totalRefundTaxable,
                        status: 'REFUNDED',
                        refundReason: reason,
                        rfdRsnCd,
                        rcptLabel: refundRcptLabel,
                        originalSaleId: id, // Link to original sale
                        shiftId: sale.shiftId ?? undefined, // Refund belongs to the original sale's shift
                        saleItems: {
                            create: itemsToRefund.map((item) => ({
                                productId: item.productId || undefined,
                                // quantity negative x unitPrice positive = totalPrice negative;
                                // unitPrice itself stays positive here so that identity holds —
                                // the printed minus sign on the per-unit price (RRA checklist
                                // §56) is applied at render time (composeInvoicePayload), not
                                // stored, to avoid double-negating the line total.
                                quantity: -item.quantity,
                                unitPrice: item.unitPrice,
                                totalPrice: -item.totalPrice,
                                // Tax + discount mirror the original line with the sign flipped so
                                // the refund fiscalises with the correct tax code/amount and the
                                // printed receipt shows every amount negative (RRA checklist §56).
                                taxRate: item.taxRate,
                                taxAmount: -item.taxAmount,
                                taxCode: item.taxCode ?? undefined,
                                dcRate: item.dcRate,
                                dcAmt: -item.dcAmt,
                                measurementUnit: item.measurementUnit,
                                itemType: item.itemType,
                                serviceName: item.serviceName,
                                serviceDescription: item.serviceDescription,
                            }))
                        }
                    },
                    include: {
                        saleItems: { include: { product: true } },
                        customer: true
                    }
                });
                // Update product quantities (restore inventory) and record movements in ledger (Stock IN)
                // Only restore stock for PRODUCT items; SERVICE items have no inventory
                for (const item of itemsToRefund) {
                    if (item.itemType === 'SERVICE' || !item.productId)
                        continue;
                    await (0, inventory_ledger_service_1.addStock)({
                        organizationId: organizationId,
                        productId: item.productId,
                        userId: parseInt(userId),
                        quantity: item.quantity,
                        movementType: 'RETURN_CUSTOMER',
                        branchId: sale.branchId,
                        reference: refundSaleNumber,
                        referenceType: 'SALE_REFUND',
                        note: `Refund for Sale #${sale.saleNumber} (Full)`,
                        tx: prisma,
                    });
                    if (item.batchId) {
                        const existingBatch = await prisma.batch.findFirst({
                            where: { id: item.batchId, organizationId: organizationId },
                        });
                        if (existingBatch) {
                            await prisma.batch.update({
                                where: { id: item.batchId },
                                data: {
                                    quantity: existingBatch.quantity + item.quantity,
                                    isActive: true,
                                },
                            });
                        }
                    }
                }
                // Update customer balance
                await prisma.customer.update({
                    where: { id: sale.customerId },
                    data: {
                        balance: { decrement: totalRefundAmount }
                    }
                });
                // Log the activity
                await auditLogger_1.auditLogger.sales(req, {
                    type: 'SALE_REFUNDED',
                    description: `Full refund issued for Sale #${sale.saleNumber}${reason ? `: ${reason}` : ''}`,
                    entityType: 'Sale',
                    entityId: id,
                    metadata: {
                        refundSaleId: refundSale.id,
                        refundAmount: totalRefundAmount,
                        reason,
                    }
                });
                // Write EBM outbox entry for REFUND atomically with the transaction.
                // This ensures the RRA is notified even if the process crashes after commit.
                if ((0, rra_ebm_service_1.isEbmEnabled)() && orgSettings.featureFlags.ebmIntegrationEnabled) {
                    const refundIdempotencyKey = `ebm-REFUND-${organizationId}-${refundSale.id}`;
                    await prisma.ebmOutbox.create({
                        data: {
                            organizationId: organizationId,
                            saleId: refundSale.id,
                            operation: 'REFUND',
                            idempotencyKey: refundIdempotencyKey,
                            payload: {
                                version: 1,
                                saleId: refundSale.id,
                                organizationId: organizationId,
                                operation: 'REFUND',
                                originalSaleId: id,
                                rfdRsnCd,
                            },
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
                    refundedItems: itemsToRefund
                };
            }, {
                maxWait: 30000, // 30 seconds
                timeout: 60000, // 60 seconds
            });
        });
        // Bounded wait (same rationale as createSale — RRA checklist §16/§22: a
        // refund receipt must not be issued before VSDC confirms it either). The
        // outbox row stays the single source of truth; the 2-minute cron job
        // remains the retry/backstop if this wait times out.
        let refundFiscalization = { status: 'success' };
        if ((0, rra_ebm_service_1.isEbmEnabled)() && orgSettings.featureFlags.ebmIntegrationEnabled) {
            const EBM_INLINE_WAIT_MS = 5000;
            await Promise.race([
                (0, ebm_outbox_service_1.processEbmOutboxBatch)(5).catch((e) => {
                    console.error('[EBM] immediate refund fiscalization error:', e);
                }),
                new Promise((resolve) => setTimeout(resolve, EBM_INLINE_WAIT_MS)),
            ]);
            const outboxRow = await prisma_1.prisma.ebmOutbox.findFirst({
                where: { saleId: result.refundSale.id, operation: 'REFUND' },
                orderBy: { createdAt: 'desc' },
                select: { status: true },
            });
            refundFiscalization = {
                status: outboxRow?.status === 'SUCCEEDED' ? 'success' : outboxRow?.status === 'DEAD_LETTER' ? 'failed' : 'pending',
            };
        }
        res.status(200).json((0, apiResponse_1.success)({ ...result, fiscalization: refundFiscalization }));
    }
    catch (error) {
        console.error("[Refund Error]:", error);
        const status = error.status || 500;
        const message = error.message || "Failed to process refund";
        res.status(status).json((0, apiResponse_1.error)(message, error.code));
    }
};
exports.refundSale = refundSale;
/**
 * Registers one download/print of this sale's invoice PDF — called by the
 * frontend right before it fetches the actual PDF for every deliberate
 * download. CIS/VSDC spec §7.18: "print only one original receipt. Reprint
 * shall have a watermark with mention Copy." There's no separate "copy"
 * action: the FIRST registered download stays the original (reprintCount
 * reaches 1, isCopy stays false in getSaleInvoiceData); every one after that
 * is automatically rendered as a COPY (CS/CR) receipt.
 */
const reprintSaleReceipt = async (req, res) => {
    try {
        const saleId = parseInt(req.params.saleId);
        const organizationId = parseInt(req.params.organizationId);
        const sale = await prisma_1.prisma.sale.findFirst({
            where: { id: saleId, organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) },
            select: { id: true, saleNumber: true, status: true, rcptLabel: true },
        });
        if (!sale) {
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        }
        // C6: CS = copy of a sale, CR = copy of a refund. This is a display-only
        // label for the printout being produced right now — it must NOT overwrite
        // the sale's own rcptLabel (NS/NR/TS/TR), which is the fiscal record of
        // what the original receipt actually was. Persisting CS/CR onto the sale
        // previously made reprinted TRAINING receipts (TS/TR) look like normal
        // sales/refunds everywhere the sale's rcptLabel is read from, including
        // the daily X/Z report's training exclusion filter.
        const copyLabel = (sale.status === 'REFUNDED' || sale.rcptLabel === 'NR' || sale.rcptLabel === 'TR')
            ? 'CR'
            : 'CS';
        const updated = await prisma_1.prisma.sale.update({
            where: { id: saleId },
            data: { reprintCount: { increment: 1 } },
        });
        await auditLogger_1.auditLogger.sales(req, {
            type: 'SALE_REPRINTED',
            description: `Invoice downloaded for Sale #${sale.saleNumber} (download #${updated.reprintCount})`,
            entityType: 'Sale',
            entityId: saleId,
            metadata: { reprintCount: updated.reprintCount, copyLabel },
        });
        res.json((0, apiResponse_1.success)({
            isCopy: updated.reprintCount > 1,
            reprintCount: updated.reprintCount,
            rcptLabel: copyLabel,
        }));
    }
    catch (error) {
        console.error("[Reprint Sale Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to reprint receipt"));
    }
};
exports.reprintSaleReceipt = reprintSaleReceipt;
/**
 * Regenerate invoice for a sale — creates a new invoice number, updates the sale,
 * generates new EBM transaction, preserves history, and prevents duplicate numbers.
 */
const regenerateInvoice = async (req, res) => {
    try {
        const saleId = parseInt(req.params.saleId);
        const organizationId = parseInt(req.params.organizationId);
        const branchId = await (0, branchAuth_middleware_1.resolveBranchIdForWrite)(req);
        const sale = await prisma_1.prisma.sale.findFirst({
            where: { id: saleId, organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) },
            include: { ebmTransactions: { orderBy: { createdAt: 'desc' } } },
        });
        if (!sale) {
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        }
        if (sale.status === 'CANCELLED' || sale.status === 'REFUNDED') {
            return res.status(400).json((0, apiResponse_1.error)(`Cannot regenerate invoice for a ${sale.status.toLowerCase()} sale`));
        }
        // RRA checklist §28: an approved (VSDC-signed) receipt must never be
        // modified — that includes re-numbering it. Regeneration is only for a
        // sale whose invoice number was never accepted by VSDC (still pending or
        // permanently failed). A fiscalised sale can only be corrected via a
        // refund against the original receipt.
        const alreadyFiscalised = sale.ebmTransactions.some((t) => (t.operation === 'SALE' || !t.operation) && t.submissionStatus === 'SUCCESS' && t.ebmInvoiceNumber != null);
        if (alreadyFiscalised) {
            return res.status(409).json((0, apiResponse_1.error)('This sale already has a VSDC-signed receipt and cannot be re-numbered. Issue a refund against the original receipt instead.'));
        }
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            // Generate new invoice number
            const { invoiceNumber, vsdcInvcNo } = await (0, rra_ebm_service_1.generateInvoiceNumber)(organizationId, branchId, tx);
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
            if ((0, rra_ebm_service_1.isEbmEnabled)()) {
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
                        },
                        status: 'PENDING',
                        nextAttemptAt: new Date(),
                    },
                });
            }
            return updatedSale;
        });
        await auditLogger_1.auditLogger.sales(req, {
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
        res.json((0, apiResponse_1.success)({
            ...result,
            previousInvoiceNumber: sale.invoiceNumber,
            isRegenerated: true,
        }));
    }
    catch (error) {
        console.error("[Regenerate Invoice Error]:", error);
        if (error.code === 'P2002') {
            return res.status(500).json((0, apiResponse_1.error)("Invoice number conflict. Please try again."));
        }
        res.status(500).json((0, apiResponse_1.error)("Failed to regenerate invoice"));
    }
};
exports.regenerateInvoice = regenerateInvoice;
/**
 * E2/E3: GET /api/organizations/:orgId/sales/:saleId/ebm-receipt
 * Returns the latest successful SDC fiscalization data for a sale.
 * The frontend polls this after sale creation once the outbox worker has run.
 */
const getEbmReceipt = async (req, res) => {
    try {
        const saleId = parseInt(req.params.saleId);
        const organizationId = parseInt(req.params.organizationId);
        const tx = await prisma_1.prisma.ebmTransaction.findFirst({
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
        const sale = await prisma_1.prisma.sale.findFirst({
            where: { id: saleId, organizationId },
            select: { rcptLabel: true, invoiceNumber: true, saleNumber: true },
        });
        const org = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { TIN: true, ebmDeviceId: true, ebmSerialNo: true },
        });
        const branch = sale
            ? await prisma_1.prisma.branch.findFirst({
                where: { id: sale.branchId },
                select: { bhfId: true, ebmDeviceId: true, ebmSerialNo: true },
            })
            : null;
        const mrcNo = branch?.ebmSerialNo ?? org?.ebmSerialNo ?? null;
        // `tx` is this sale's own successful VSDC response — prefer the ID it was
        // actually stamped with over the (possibly still-unconfigured) device
        // setting, same precedence composeInvoicePayload uses.
        const sdcId = tx.sdcId ?? branch?.ebmDeviceId ?? org?.ebmDeviceId ?? null;
        res.json({
            status: 'success',
            ebm: {
                sdcId,
                mrcNo,
                sdcRcptNo: tx.sdcRcptNo,
                internalData: tx.internalData,
                receiptSignature: tx.receiptSignature,
                qrPayload: tx.qrPayload,
                sdcDateTime: tx.sdcDateTime,
                rcptLabel: tx.rcptLabel ?? sale?.rcptLabel,
                ebmInvoiceNumber: tx.ebmInvoiceNumber,
            },
        });
    }
    catch (error) {
        console.error('[EBM Receipt Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to get EBM receipt data'));
    }
};
exports.getEbmReceipt = getEbmReceipt;
const cancelSale = async (req, res) => {
    try {
        const saleId = parseInt(req.params.saleId);
        const organizationId = parseInt(req.params.organizationId);
        const orgSettings = await (0, organization_settings_service_1.getOrganizationSettings)(organizationId);
        const { reason } = req.body;
        const userId = req.user?.userId;
        // Get the sale with items
        const sale = await prisma_1.prisma.sale.findFirst({
            where: {
                id: saleId,
                organizationId,
                ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
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
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        }
        if (sale.status === 'CANCELLED') {
            return res.status(400).json((0, apiResponse_1.error)("Sale already cancelled"));
        }
        if (sale.status === 'REFUNDED' || sale.status === 'PARTIALLY_REFUNDED') {
            return res.status(400).json((0, apiResponse_1.error)(`Cannot cancel a ${sale.status.toLowerCase()} sale`));
        }
        // Start a transaction
        await prisma_1.prisma.$transaction(async (prisma) => {
            // Update sale status
            await prisma.sale.update({
                where: { id: saleId },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: new Date(),
                    cancelledById: parseInt(userId),
                    cancellationReason: reason
                }
            });
            // Return items to inventory and record movements in ledger (Stock IN)
            // Only restore stock for PRODUCT items; SERVICE items have no inventory
            for (const item of sale.saleItems) {
                const isService = item.itemType === 'SERVICE' || !item.productId;
                if (isService)
                    continue;
                const productId = item.productId;
                await (0, inventory_ledger_service_1.addStock)({
                    organizationId: organizationId,
                    productId,
                    userId: parseInt(userId),
                    quantity: item.quantity,
                    movementType: 'RETURN_CUSTOMER',
                    branchId: sale.branchId,
                    reference: sale.saleNumber,
                    referenceType: 'SALE_CANCELLATION',
                    note: `Sale cancellation: ${sale.saleNumber}`,
                    tx: prisma,
                });
                const batchId = item.batchId || item.batch?.id || null;
                if (batchId) {
                    const existingBatch = await prisma.batch.findFirst({
                        where: { id: batchId, organizationId: organizationId },
                    });
                    if (existingBatch) {
                        await prisma.batch.update({
                            where: { id: batchId },
                            data: {
                                quantity: existingBatch.quantity + item.quantity,
                                isActive: true,
                            },
                        });
                    }
                }
            }
            // Revert customer balance for debt portion only
            // During sale creation, we added the debt amount to customer balance
            // During cancellation, we need to subtract it
            const debtAmount = sale.debtAmount?.toNumber?.() || 0;
            if (debtAmount > 0) {
                await prisma.customer.update({
                    where: { id: sale.customerId },
                    data: {
                        balance: { decrement: debtAmount }
                    }
                });
            }
            // Log the activity
            await auditLogger_1.auditLogger.sales(req, {
                type: 'SALE_CANCELLED',
                description: `Sale #${sale.saleNumber} cancelled${reason ? `: ${reason}` : ''}`,
                entityType: 'Sale',
                entityId: saleId,
                metadata: { cancellationReason: reason }
            });
            // Write EBM outbox entry for VOID atomically with the transaction.
            // The outbox worker will notify RRA; this survives process crashes.
            if ((0, rra_ebm_service_1.isEbmEnabled)() && orgSettings.featureFlags.ebmIntegrationEnabled) {
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
                        },
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
        if ((0, rra_ebm_service_1.isEbmEnabled)() && orgSettings.featureFlags.ebmIntegrationEnabled) {
            void (0, ebm_outbox_service_1.processEbmOutboxBatch)(50).catch((e) => {
                console.error('[EBM] immediate void fiscalization error:', e);
            });
        }
        res.status(200).json((0, apiResponse_1.success)({ message: "Sale cancelled successfully" }));
    }
    catch (error) {
        console.error("[Cancel Sale Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to cancel sale"));
    }
};
exports.cancelSale = cancelSale;
/** Build the RRA QR string per CIS/VSDC spec (§4.2): ddmmyyyy#hhmmss#sdcId#sdcRcptNo#internalData#receiptSignature */
function buildRraQrString(p) {
    if (!p.sdcDateTime || !p.sdcId || p.sdcRcptNo == null || !p.internalData || !p.receiptSignature)
        return null;
    const dt = p.sdcDateTime instanceof Date ? p.sdcDateTime : new Date(p.sdcDateTime);
    if (Number.isNaN(dt.getTime()))
        return null;
    const p2 = (x) => String(x).padStart(2, "0");
    return [
        `${p2(dt.getDate())}${p2(dt.getMonth() + 1)}${dt.getFullYear()}`,
        `${p2(dt.getHours())}${p2(dt.getMinutes())}${p2(dt.getSeconds())}`,
        p.sdcId,
        String(p.sdcRcptNo),
        p.internalData,
        p.receiptSignature,
    ].join("#");
}
const RCT_LABEL_DISPLAY = {
    NS: "Normal Sale",
    NR: "Normal Refund",
    CS: "Copy Sale",
    CR: "Copy Refund",
    TS: "Training Sale",
    TR: "Training Refund",
    PS: "Proforma Sale",
};
const PAYMENT_METHOD_LABEL = {
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
};
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
class FiscalizationPendingError extends Error {
    constructor(reason) {
        super(`Sale not yet confirmed by VSDC (${reason})`);
        this.reason = reason;
        this.name = "FiscalizationPendingError";
    }
}
exports.FiscalizationPendingError = FiscalizationPendingError;
async function composeInvoicePayload(req, opts = {}) {
    const saleId = parseInt(req.params.saleId ?? req.params.id);
    const organizationId = parseInt(req.params.organizationId);
    const sale = await prisma_1.prisma.sale.findFirst({
        where: { id: saleId, organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) },
        include: {
            customer: { select: { id: true, name: true, phone: true, TIN: true, email: true, address: true, custPrvncNm: true, custDstrtNm: true, custSctrNm: true, custLocDesc: true } },
            user: { select: { id: true, name: true } },
            saleItems: { include: { product: true } },
            ebmTransactions: { orderBy: { createdAt: "desc" } },
            originalSale: { select: { vsdcInvcNo: true, invoiceNumber: true, saleNumber: true } },
        },
    });
    if (!sale)
        return null;
    // Proforma sales are never submitted to VSDC by design and have no outbox
    // row to check. A real (NS/NR) sale that does have an outbox row must have
    // reached SUCCEEDED before its receipt can be composed — anything else
    // (PENDING/PROCESSING/FAILED still retrying, or permanently DEAD_LETTER)
    // blocks here rather than silently degrading to an unsigned receipt.
    // Set when the sale is real but VSDC has not confirmed it yet. By default
    // that is a hard stop (RRA VSDC spec §16/§22 — no receipt without VSDC
    // confirmation); when the caller passes allowUnfiscalized (a deliberate,
    // user-initiated download/print), we instead compose the payload and stamp
    // it NOT FISCALISED so the document can never pass as a real tax receipt.
    let notFiscalized = null;
    if (!sale.isProforma) {
        // Not filtered to operation:"SALE" — a refund sale's outbox row is
        // written with operation:"REFUND" (see refundSale), and a voided sale's
        // with "VOID"; whichever applies to this sale is what must have SUCCEEDED.
        const outboxRow = await prisma_1.prisma.ebmOutbox.findFirst({
            where: { saleId: sale.id },
            orderBy: { createdAt: "desc" },
            select: { status: true },
        });
        if (outboxRow && outboxRow.status !== "SUCCEEDED") {
            const reason = outboxRow.status === "DEAD_LETTER" ? "failed" : "pending";
            if (!opts.allowUnfiscalized)
                throw new FiscalizationPendingError(reason);
            notFiscalized = reason;
        }
    }
    const [org, branch] = await Promise.all([
        prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true, avatar: true, address: true, phone: true, email: true, TIN: true, VRN: true, currency: true, ebmDeviceId: true, ebmSerialNo: true },
        }),
        prisma_1.prisma.branch.findUnique({
            where: { id: sale.branchId },
            select: { name: true, bhfId: true, ebmDeviceId: true, ebmSerialNo: true, address: true },
        }),
    ]);
    // "Linked to RRA/EBM" means the VSDC device credentials actually used to
    // talk to RRA (see getOsdcCreds/getVsdcCreds: org.TIN + branch.ebmSerialNo,
    // falling back to org.ebmSerialNo) are configured — NOT ebmDeviceId, which
    // is just the SDC ID RRA hands back after a successful transaction and is
    // still empty for a freshly-registered device that hasn't fiscalized yet.
    // bhfId is sourced from branch.bhfId (configurable in Organization Settings),
    // falling back to config.ebm.defaultBhfId
    const isEbmLinked = Boolean(org?.TIN && (branch?.ebmSerialNo || org?.ebmSerialNo));
    const fiscalTx = (sale.ebmTransactions ?? []).find((t) => t.submissionStatus === "SUCCESS" && (!t.operation || t.operation === "SALE" || t.operation === "REFUND"));
    const responseData = fiscalTx?.responseData;
    const norm = responseData?.normalized;
    // MRC: device-serial configured on branch/org, falling back to the serial
    // the VSDC itself echoed back on the successful response.
    const mrcNo = branch?.ebmSerialNo ?? org?.ebmSerialNo ?? norm?.mrcNo ?? null;
    // Prefer the ID stamped in the successful RRA response. Configured device
    // values are a fallback only; this keeps the printed SDC identifier aligned
    // with the actual fiscal receipt.
    let sdcId = fiscalTx?.sdcId ?? branch?.ebmDeviceId ?? org?.ebmDeviceId ?? null;
    // Proforma/training documents never get their own fiscalTx (never
    // submitted to VSDC), and the device may not have its ebmDeviceId
    // backfilled in Organization/Branch settings — but the SDC ID is a fixed
    // per-device identifier, so reuse the one this branch's device was last
    // handed back on any real, successfully-fiscalized sale.
    if (!sdcId) {
        const lastKnownDevice = await prisma_1.prisma.ebmTransaction.findFirst({
            where: { organizationId, sdcId: { not: null }, sale: { branchId: sale.branchId } },
            orderBy: { createdAt: "desc" },
            select: { sdcId: true },
        });
        sdcId = lastKnownDevice?.sdcId ?? null;
    }
    const sdcRcptNo = fiscalTx?.sdcRcptNo ?? null;
    const totalRcptNo = fiscalTx?.totalRcptNo ?? null;
    const internalData = fiscalTx?.internalData ?? norm?.intrlData ?? null;
    const receiptSignature = fiscalTx?.receiptSignature ?? norm?.vsdcSignature ?? norm?.verificationCode ?? null;
    // Proforma has no fiscalTx (never sent to VSDC), so it has no VSDC-stamped
    // time either — fall back to the CIS's own creation time, same as the
    // spec's own proforma example still prints a date/time under SDC INFORMATION.
    const sdcDateTime = fiscalTx?.sdcDateTime ?? norm?.sdcDateTime ?? (sale.isProforma ? sale.createdAt : null);
    const ebmInvoiceNumber = fiscalTx?.ebmInvoiceNumber ?? norm?.ebmInvoiceNumber ?? sale.invoiceNumber ?? null;
    const rcptLabel = fiscalTx?.rcptLabel ?? sale.rcptLabel ?? null;
    // Proforma is never submitted to VSDC (see createSale step 4/7), so it never
    // has a fiscalTx/sdcRcptNo — it prints its own local, non-fiscal counter pair
    // instead: localReceiptSeq (this type only) / localReceiptTotalSeq (every
    // locally-numbered type combined), the same distinct-A/B shape as a real
    // VSDC counter (spec §7.25's own example: "168/258 NS" — two different numbers).
    const fiscalReceiptNumber = sdcRcptNo != null
        ? `${sdcRcptNo}/${totalRcptNo ?? sdcRcptNo}${rcptLabel ? ` ${rcptLabel}` : ""}`
        : sale.localReceiptSeq != null
            ? `${sale.localReceiptSeq}/${sale.localReceiptTotalSeq ?? sale.localReceiptSeq}${rcptLabel ? ` ${rcptLabel}` : ""}`
            : sale.saleNumber;
    // The invoice number is the sequence submitted to VSDC (invcNo), not the
    // SDC device identifier. SDC ID and receipt counters are printed separately.
    const fiscalInvoiceNumber = sale.vsdcInvcNo != null
        ? String(sale.vsdcInvcNo)
        : ebmInvoiceNumber ?? sale.invoiceNumber ?? sale.saleNumber;
    const originalReceiptNumber = sale.originalSale
        ? (sale.originalSale.vsdcInvcNo != null
            ? String(sale.originalSale.vsdcInvcNo)
            : sale.originalSale.invoiceNumber ?? sale.originalSale.saleNumber)
        : null;
    const currency = org?.currency ?? "RWF";
    const toNumber = (v) => (v == null ? 0 : typeof v === "number" ? v : Number(String(v)));
    const totalAmount = toNumber(sale.totalAmount);
    const cashAmount = toNumber(sale.cashAmount);
    const debtAmount = toNumber(sale.debtAmount);
    const insuranceAmount = toNumber(sale.insuranceAmount);
    const vatAmount = toNumber(sale.vatAmount);
    const taxableAmount = toNumber(sale.taxableAmount);
    // A refund stores every amount negative; compute the residual sale-level
    // discount on magnitudes and re-apply the document's sign so a refund
    // receipt shows the discount negative too (RRA checklist §56) instead of a
    // spurious positive value.
    const docSign = totalAmount < 0 ? -1 : 1;
    const discountAmount = docSign * Math.max(0, Math.abs(totalAmount) - Math.abs(cashAmount) - Math.abs(debtAmount) - Math.abs(insuranceAmount) - Math.abs(vatAmount) - Math.abs(taxableAmount));
    const items = (sale.saleItems ?? []).map((line, index) => {
        const qty = toNumber(line.quantity);
        const unitPrice = toNumber(line.unitPrice);
        const gross = qty * unitPrice;
        const dcAmt = toNumber(line.dcAmt);
        const dcRate = toNumber(line.dcRate);
        const taxAmt = toNumber(line.taxAmount);
        const taxRate = toNumber(line.taxRate);
        const net = gross - dcAmt;
        return {
            id: String(line.id),
            line: index + 1,
            code: line.product?.itemCd ?? line.product?.sku ?? line.product?.barcode ?? line.product?.name ?? line.serviceName ?? "",
            description: line.serviceName ?? line.product?.name ?? line.serviceDescription ?? "",
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
            subtotal: gross,
            net,
            // Unit prices and `sale.totalAmount` are VAT-inclusive throughout the
            // checkout flow. The tax is an extraction from the gross line, not an
            // amount to add again on the printed invoice.
            total: net,
            itemType: line.itemType,
        };
    });
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    const itemDiscount = items.reduce((s, i) => s + i.discountAmt, 0);
    const lineTax = items.reduce((s, i) => s + i.taxAmount, 0);
    // §56: keep the discount signed with the document (negative on a refund).
    const discount = docSign * Math.max(0, Math.round(Math.abs(itemDiscount) + Math.abs(discountAmount)));
    const grandTotal = Math.round(totalAmount);
    const paid = Math.round(cashAmount + insuranceAmount);
    const balance = Math.round(debtAmount);
    // QR image is generated server-side — the frontend only renders the image returned by the API.
    const qrRaw = fiscalTx?.qrPayload ?? buildRraQrString({ sdcDateTime, sdcId, sdcRcptNo, internalData, receiptSignature });
    // CIS §7.29 — official RRA logo on every receipt type.
    const rraLogoBuf = await (0, invoice_logo_service_1.getOrganizationLogo)();
    const rraLogo = rraLogoBuf
        ? `data:image/png;base64,${rraLogoBuf.toString("base64")}`
        : null;
    const qrCodeImage = qrRaw
        ? await qrcode_1.default.toDataURL(qrRaw, { errorCorrectionLevel: "M", margin: 1, width: 220, color: { dark: "#000000", light: "#FFFFFF" } })
        : null;
    const isCertified = !!fiscalTx;
    const verificationUrl = isCertified && sdcId ? `https://esbm.rra.gov.rw/tax-invoice/verification?sdcId=${encodeURIComponent(sdcId)}&receipt=${encodeURIComponent(String(sdcRcptNo))}` : null;
    const dateObj = new Date(sale.createdAt);
    const p2 = (x) => String(x).padStart(2, "0");
    const time = `${p2(dateObj.getHours())}:${p2(dateObj.getMinutes())}:${p2(dateObj.getSeconds())}`;
    const invoiceDate = dateObj.toISOString();
    const paymentMethodLabel = PAYMENT_METHOD_LABEL[sale.paymentType] ?? sale.paymentType ?? "";
    const invoiceData = {
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
            name: sale.customer?.name ?? "",
            tin: sale.customer?.TIN ?? null,
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
        },
        items,
        totals: {
            subtotal: Math.round(subtotal),
            discount,
            taxable: Math.round(taxableAmount),
            vat: Math.round(vatAmount),
            tax: Math.round(lineTax),
            shipping: 0,
            paid,
            balance,
            grandTotal,
        },
        charges: {
            vatAmount: Math.round(vatAmount),
            taxableAmount: Math.round(taxableAmount),
            discountAmount: Math.round(discountAmount),
            cashAmount: Math.round(cashAmount),
            insuranceAmount: Math.round(insuranceAmount),
            debtAmount: Math.round(debtAmount),
            totalAmount: Math.round(totalAmount),
            shipping: 0,
        },
        payment: {
            method: sale.paymentType ?? "",
            methodLabel: paymentMethodLabel,
            reference: null,
            bank: null,
            cashAmount: Math.round(cashAmount),
            insuranceAmount: Math.round(insuranceAmount),
            debtAmount: Math.round(debtAmount),
        },
        sdcInformation: {
            sdcId,
            mrcNo,
            receiptNumber: (sdcRcptNo != null || sale.isProforma) ? fiscalReceiptNumber : null,
            receiptSignature,
            internalData,
            sdcDateTime: sdcDateTime ? String(sdcDateTime) : null,
            date: sdcDateTime ? new Date(sdcDateTime).toISOString() : null,
            time: sdcDateTime ? `${p2(new Date(sdcDateTime).getHours())}:${p2(new Date(sdcDateTime).getMinutes())}:${p2(new Date(sdcDateTime).getSeconds())}` : null,
            ebmInvoiceNumber: ebmInvoiceNumber,
            rcptLabel,
            poweredBy: system_branding_service_1.SYSTEM_FOOTER,
            softwareVersion: system_branding_service_1.CIS_VERSION_LABEL,
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
            poweredBy: system_branding_service_1.SYSTEM_POWERED_BY,
        },
        footer: {
            message: "Thank you for your business.",
            note: null,
        },
    };
    return invoiceData;
}
const getInvoice = async (req, res) => {
    try {
        // ?allowPending=1 — the caller wants the composed invoice even before VSDC
        // confirms it (to view/download it, stamped NOT FISCALISED). Without it the
        // endpoint keeps returning 425 while fiscalization is in flight, which the
        // POS/sales fiscalization poll relies on.
        const allowUnfiscalized = String(req.query.allowPending ?? "") === "1";
        const invoiceData = await composeInvoicePayload(req, { allowUnfiscalized });
        if (!invoiceData)
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        return res.json((0, apiResponse_1.success)({
            ...invoiceData,
            renderedHtml: (0, invoice_render_service_1.renderSalesInvoiceHtml)(invoiceData),
        }));
    }
    catch (error) {
        if (error instanceof FiscalizationPendingError) {
            return res.status(425).json({ success: false, status: "pending_fiscalization", reason: error.reason, error: error.message });
        }
        console.error("[Get Invoice Error]:", error);
        return res.status(500).json((0, apiResponse_1.error)("Failed to get invoice"));
    }
};
exports.getInvoice = getInvoice;
/** Authoritative backend-generated invoice PDF (A4, A5 or 80mm) for download, preview, sharing, and printing. */
const getInvoicePdf = async (req, res) => {
    try {
        // A PDF download/print is always an explicit user action — allow it before
        // VSDC confirmation and let the renderer stamp it NOT FISCALISED, rather
        // than 425 and leave the user with no document at all.
        const invoiceData = await composeInvoicePayload(req, { allowUnfiscalized: true });
        if (!invoiceData)
            return res.status(404).json((0, apiResponse_1.error)("Sale not found"));
        const q = String(req.query.format ?? "").toUpperCase();
        const format = q === "80MM" ? "80mm" : q === "A5" ? "A5" : "A4";
        const pdf = format === "80mm"
            ? await (0, invoice_receipt_pdf_service_1.generateEbmReceiptPdf80mm)(invoiceData)
            : await (0, invoice_pdf_service_1.generateEbmInvoicePdf)(invoiceData, format === "A5" ? "A5" : "A4");
        const filename = (0, invoice_pdf_service_1.getEbmInvoiceFilename)(invoiceData, format);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(pdf.length));
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).send(pdf);
    }
    catch (error) {
        if (error instanceof FiscalizationPendingError) {
            return res.status(425).json({ success: false, status: "pending_fiscalization", reason: error.reason, error: error.message });
        }
        console.error("[Get Invoice PDF Error]:", error);
        return res.status(500).json((0, apiResponse_1.error)("Failed to generate invoice PDF"));
    }
};
exports.getInvoicePdf = getInvoicePdf;
/**
 * CIS §7.28 — recover the last finalized receipt after power/paper failure so
 * the operator can reprint without re-entering the sale.
 * GET /api/sales/:organizationId/last-receipt
 */
const getLastReceipt = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const sale = await prisma_1.prisma.sale.findFirst({
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
        });
        if (!sale)
            return res.status(404).json((0, apiResponse_1.error)("No recoverable receipt found for this branch"));
        return res.json((0, apiResponse_1.success)({ sale }));
    }
    catch (error) {
        console.error("[Last Receipt Error]:", error);
        return res.status(500).json((0, apiResponse_1.error)("Failed to load last receipt"));
    }
};
exports.getLastReceipt = getLastReceipt;

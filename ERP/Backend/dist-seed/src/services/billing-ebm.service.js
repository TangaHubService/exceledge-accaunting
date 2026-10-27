"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRraDateTime = void 0;
exports.buildPaymentSaleLikeObject = buildPaymentSaleLikeObject;
exports.fiscalizeSubscriptionPayment = fiscalizeSubscriptionPayment;
exports.requeueFailedPaymentFiscalization = requeueFailedPaymentFiscalization;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const config_1 = require("../config");
const rra_ebm_service_1 = require("./rra-ebm.service");
Object.defineProperty(exports, "toRraDateTime", { enumerable: true, get: function () { return rra_ebm_service_1.toRraDateTime; } });
const vsdc_api_service_1 = require("./vsdc-api.service");
const rra_osdc_service_1 = require("./rra-osdc.service");
const rra_code_service_1 = require("./rra-code.service");
/**
 * RRA EBM fiscalization for subscription (billing) receipts.
 *
 * Subscription plan payments are fiscalized exactly like sales receipts: the
 * tenant organization is the fiscal seller (it holds the EBM/VSDC device + TIN),
 * and the plan is issued as a single-line receipt. This reuses the same payload
 * builder, sequence allocator, and VSDC/OSDC submission paths as sales, so sandbox
 * and production behaviour stay consistent with the tested sales flow.
 */
const DEFAULT_BRANCH_LABEL = 'NS'; // Normal Sale
function paymentMethodToPaymentType(method) {
    switch (method) {
        case 'CASH': return 'CASH';
        case 'CARD': return 'CREDIT_CARD';
        case 'MOBILE_MONEY': return 'MOBILE_MONEY';
        case 'PAYPACK': return 'MOBILE_MONEY';
        case 'PESAPA': return 'MOBILE_MONEY';
        case 'BANK_TRANSFER': return 'BANK';
        case 'STRIPE': return 'CREDIT_CARD';
        default: return 'CASH';
    }
}
/**
 * Build a synthetic SaleWithRelations from a completed subscription payment so
 * the shared RRA payload builder + submission paths can be reused unchanged.
 */
async function buildPaymentSaleLikeObject(params) {
    const { payment, organizationId } = params;
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { TIN: true, name: true, address: true, phone: true },
    });
    if (!org) {
        throw new Error('Organization not found');
    }
    const subscription = await prisma_1.prisma.subscription.findFirst({
        where: { payments: { some: { id: payment.id } } },
        include: { plan: true },
    });
    const branchId = params.branchId ??
        (await resolveDefaultBranchId(organizationId));
    const { invoiceNumber, vsdcInvcNo } = await (0, rra_ebm_service_1.generateInvoiceNumber)(organizationId, branchId);
    const amount = new client_1.Prisma.Decimal(payment.amount);
    // Treat the paid amount as VAT-inclusive (18%, tax code B). Keep totals in
    // sync with the amount actually charged so totAmt == payment.amount.
    const taxAmt = new client_1.Prisma.Decimal(Number(amount.toNumber() - amount.div(1.18).toNumber()).toFixed(2));
    const taxblAmt = amount.sub(taxAmt);
    const sale = {
        id: payment.id,
        saleNumber: `SUB-${payment.id}`,
        invoiceNumber,
        vsdcInvcNo,
        rcptLabel: DEFAULT_BRANCH_LABEL,
        createdAt: payment.createdAt,
        status: 'COMPLETED',
        paymentType: paymentMethodToPaymentType(payment.paymentMethod),
        cashAmount: amount,
        debtAmount: new client_1.Prisma.Decimal(0),
        insuranceAmount: new client_1.Prisma.Decimal(0),
        totalAmount: amount,
        taxableAmount: taxblAmt,
        vatAmount: taxAmt,
        branchId,
        branch: {
            id: branchId,
            name: '',
            code: '',
            bhfId: null,
            ebmDeviceId: null,
            ebmSerialNo: null,
        },
        customer: {
            id: 0,
            name: org.name ?? 'Organization',
            phone: org.phone ?? '',
            TIN: org.TIN ?? null,
            customerType: 'CORPORATE',
            email: null,
        },
        user: { id: 0, name: 'Billing System' },
        saleItems: [
            {
                productId: null,
                quantity: 1,
                unitPrice: amount,
                totalPrice: amount,
                taxRate: new client_1.Prisma.Decimal(18),
                taxAmount: taxAmt,
                taxCode: 'B',
                dcRate: new client_1.Prisma.Decimal(0),
                dcAmt: new client_1.Prisma.Decimal(0),
                product: {
                    name: subscription?.plan?.name ?? 'Subscription',
                    itemCd: null,
                    itemClsCd: null,
                    pkgUnitCd: null,
                    qtyUnitCd: null,
                    packagingQty: null,
                },
            },
        ],
    };
    return { sale, branchId };
}
async function resolveDefaultBranchId(organizationId) {
    const branch = await prisma_1.prisma.branch.findFirst({
        where: { organizationId },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
        select: { id: true },
    });
    if (!branch) {
        throw new Error(`No branch configured for organization ${organizationId} — cannot fiscalize`);
    }
    return branch.id;
}
async function alreadyFiscalized(paymentId) {
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { ebmInvoiceNumber: true, submissionStatus: true },
    });
    return !!payment?.ebmInvoiceNumber && payment.submissionStatus === 'SUCCESS';
}
async function fiscalizeSubscriptionPayment(params) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return { success: true };
    }
    if (await alreadyFiscalized(params.paymentId)) {
        const existing = await prisma_1.prisma.payment.findUnique({
            where: { id: params.paymentId },
            select: { ebmInvoiceNumber: true },
        });
        return { success: true, ebmInvoiceNumber: existing?.ebmInvoiceNumber ?? undefined };
    }
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { id: params.paymentId },
        include: { subscription: { select: { organizationId: true, planId: true } } },
    });
    if (!payment) {
        return { success: false, error: 'Payment not found' };
    }
    if (payment.status !== 'COMPLETED') {
        return { success: false, error: `Payment status is ${payment.status} — only COMPLETED payments are fiscalized` };
    }
    let sale;
    let branchId;
    try {
        ({ sale, branchId } = await buildPaymentSaleLikeObject({
            payment: {
                id: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                paymentMethod: payment.paymentMethod,
                status: payment.status,
                createdAt: payment.createdAt,
            },
            organizationId: params.organizationId,
            branchId: params.branchId ?? null,
        }));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to prepare billing receipt';
        await markPaymentFailed(params.paymentId, msg);
        return { success: false, error: msg };
    }
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: params.organizationId },
        select: { TIN: true, name: true, address: true },
    });
    if (!org) {
        await markPaymentFailed(params.paymentId, 'Organization not found');
        return { success: false, error: 'Organization not found' };
    }
    let payload;
    try {
        // A subscription receipt is a fresh fiscal document for the org-as-buyer,
        // so it needs its own unconsumed purchase code — the sandbox rejects the
        // submission without one (resultCd 881/882).
        const buyerTin = (org.TIN ?? '').trim();
        const code = buyerTin
            ? await (0, rra_ebm_service_1.consumeAnyOrgPurchaseCode)(params.organizationId, payment.id, prisma_1.prisma, buyerTin)
            : null;
        if (code)
            sale.prcOrdCd = code;
        const rraPaymentCode = await (0, rra_code_service_1.getRraPaymentCode)(params.organizationId, sale.paymentType);
        payload = (0, rra_ebm_service_1.buildRraSendReceiptPayload)(sale, org, rraPaymentCode);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Invalid billing receipt payload';
        await markPaymentFailed(params.paymentId, msg);
        return { success: false, error: msg };
    }
    await prisma_1.prisma.payment.update({
        where: { id: params.paymentId },
        data: {
            submissionStatus: 'SUBMITTED',
            invoiceNumber: sale.invoiceNumber,
            submittedAt: new Date(),
            errorMessage: null,
        },
    });
    try {
        const isOsdc = config_1.config.ebm.protocol === 'osdc';
        if (isOsdc) {
            const osdc = await (0, rra_osdc_service_1.submitSalesToOsdc)({
                organizationId: params.organizationId,
                branchId,
                sale,
            });
            if (!osdc.success) {
                await markPaymentFailed(params.paymentId, osdc.error ?? 'OSDC gateway error');
                return { success: false, error: osdc.error };
            }
            await persistPaymentFiscalSuccess(params.paymentId, {
                ebmInvoiceNumber: osdc.ebmInvoiceNumber ?? '',
                sale,
                sdcDateTime: new Date(),
                qrPayload: undefined,
            });
            return { success: true, ebmInvoiceNumber: osdc.ebmInvoiceNumber };
        }
        const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(params.organizationId, branchId);
        const result = await (0, vsdc_api_service_1.saveInvc)(envelope, payload);
        if (!result.success || !result.data?.rcptNo) {
            const msg = result.error ?? 'VSDC gateway error';
            await markPaymentFailed(params.paymentId, msg);
            return { success: false, error: msg };
        }
        const vsdc = result.data;
        await persistPaymentFiscalSuccess(params.paymentId, {
            ebmInvoiceNumber: vsdc.rcptNo,
            sale,
            sdcDateTime: vsdc.sdcDateTime ? new Date(vsdc.sdcDateTime) : new Date(),
            sdcRcptNo: vsdc.rcptNo ? parseInt(vsdc.rcptNo, 10) || null : null,
            totalRcptNo: vsdc.totRcptNo ? parseInt(vsdc.totRcptNo, 10) || null : null,
            sdcId: vsdc.sdcId || null,
            internalData: vsdc.intrlData || null,
            receiptSignature: vsdc.vsdcSignature || null,
        });
        return { success: true, ebmInvoiceNumber: vsdc.rcptNo };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'EBM request failed';
        await markPaymentFailed(params.paymentId, msg);
        return { success: false, error: msg };
    }
}
async function persistPaymentFiscalSuccess(paymentId, data) {
    await prisma_1.prisma.payment.update({
        where: { id: paymentId },
        data: {
            submissionStatus: 'SUCCESS',
            ebmInvoiceNumber: data.ebmInvoiceNumber || null,
            sdcDateTime: data.sdcDateTime ?? null,
            sdcRcptNo: data.sdcRcptNo ?? null,
            totalRcptNo: data.totalRcptNo ?? null,
            sdcId: data.sdcId ?? null,
            internalData: data.internalData ?? null,
            receiptSignature: data.receiptSignature ?? null,
            qrPayload: data.qrPayload ?? null,
            rcptLabel: data.sale.rcptLabel ?? null,
            errorMessage: null,
        },
    });
}
async function markPaymentFailed(paymentId, message) {
    await prisma_1.prisma.payment.update({
        where: { id: paymentId },
        data: {
            submissionStatus: 'FAILED',
            errorMessage: message,
            retryCount: { increment: 1 },
        },
    });
}
/** Exported for parity with the sales helper (kept for future retry wiring). */
async function requeueFailedPaymentFiscalization(paymentId) {
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { subscription: { select: { organizationId: true } } },
    });
    if (!payment)
        return;
    await fiscalizeSubscriptionPayment({
        paymentId,
        organizationId: payment.subscription.organizationId,
    });
}

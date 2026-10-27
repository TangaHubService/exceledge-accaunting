import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import {
  buildRraSendReceiptPayload,
  consumeAnyOrgPurchaseCode,
  generateInvoiceNumber,
  isEbmEnabled,
  toRraDateTime,
  type SaleWithRelations,
} from './rra-ebm.service';
import { buildVsdcEnvelope, saveInvc, decideVsdcReceiptResult } from './vsdc-api.service';
import { submitSalesToOsdc } from './rra-osdc.service';
import { getRraPaymentCode } from './rra-code.service';

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

function paymentMethodToPaymentType(method: string): string {
  switch (method) {
    case 'CASH':            return 'CASH';
    case 'CARD':            return 'CREDIT_CARD';
    case 'MOBILE_MONEY':    return 'MOBILE_MONEY';
    case 'PAYPACK':         return 'MOBILE_MONEY';
    case 'PESAPA':          return 'MOBILE_MONEY';
    case 'BANK_TRANSFER':   return 'BANK';
    case 'STRIPE':          return 'CREDIT_CARD';
    default:                return 'CASH';
  }
}

/**
 * Build a synthetic SaleWithRelations from a completed subscription payment so
 * the shared RRA payload builder + submission paths can be reused unchanged.
 */
export async function buildPaymentSaleLikeObject(params: {
  payment: {
    id: number;
    amount: number;
    currency: string;
    paymentMethod: string;
    status: string;
    createdAt: Date;
  };
  organizationId: number;
  branchId: number | null;
}): Promise<{ sale: SaleWithRelations; branchId: number }> {
  const { payment, organizationId } = params;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { TIN: true, name: true, address: true, phone: true },
  });
  if (!org) {
    throw new Error('Organization not found');
  }

  const subscription = await prisma.subscription.findFirst({
    where: { payments: { some: { id: payment.id } } },
    include: { plan: true },
  });

  const branchId =
    params.branchId ??
    (await resolveDefaultBranchId(organizationId));

  const { invoiceNumber, vsdcInvcNo } = await generateInvoiceNumber(organizationId, branchId);

  const amount = new Prisma.Decimal(payment.amount);
  // Treat the paid amount as VAT-inclusive (18%, tax code B). Keep totals in
  // sync with the amount actually charged so totAmt == payment.amount.
  const taxAmt = new Prisma.Decimal(Number(amount.toNumber() - amount.div(1.18).toNumber()).toFixed(2));
  const taxblAmt = amount.sub(taxAmt);

  const sale: SaleWithRelations = {
    id: payment.id,
    saleNumber: `SUB-${payment.id}`,
    invoiceNumber,
    vsdcInvcNo,
    rcptLabel: DEFAULT_BRANCH_LABEL,
    createdAt: payment.createdAt,
    status: 'COMPLETED',
    paymentType: paymentMethodToPaymentType(payment.paymentMethod),
    cashAmount: amount,
    debtAmount: new Prisma.Decimal(0),
    insuranceAmount: new Prisma.Decimal(0),
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
        taxRate: new Prisma.Decimal(18),
        taxAmount: taxAmt,
        taxCode: 'B',
        dcRate: new Prisma.Decimal(0),
        dcAmt: new Prisma.Decimal(0),
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

async function resolveDefaultBranchId(organizationId: number): Promise<number> {
  const branch = await prisma.branch.findFirst({
    where: { organizationId },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!branch) {
    throw new Error(`No branch configured for organization ${organizationId} — cannot fiscalize`);
  }
  return branch.id;
}

async function alreadyFiscalized(paymentId: number): Promise<boolean> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { ebmInvoiceNumber: true, submissionStatus: true },
  });
  return !!payment?.ebmInvoiceNumber && payment.submissionStatus === 'SUCCESS';
}

export async function fiscalizeSubscriptionPayment(params: {
  paymentId: number;
  organizationId: number;
  branchId?: number | null;
}): Promise<{ success: boolean; ebmInvoiceNumber?: string; error?: string }> {
  if (!isEbmEnabled()) {
    return { success: true };
  }

  if (await alreadyFiscalized(params.paymentId)) {
    const existing = await prisma.payment.findUnique({
      where: { id: params.paymentId },
      select: { ebmInvoiceNumber: true },
    });
    return { success: true, ebmInvoiceNumber: existing?.ebmInvoiceNumber ?? undefined };
  }

  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    include: { subscription: { select: { organizationId: true, planId: true } } },
  });
  if (!payment) {
    return { success: false, error: 'Payment not found' };
  }
  if (payment.status !== 'COMPLETED') {
    return { success: false, error: `Payment status is ${payment.status} — only COMPLETED payments are fiscalized` };
  }

  let sale: SaleWithRelations;
  let branchId: number;
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to prepare billing receipt';
    await markPaymentFailed(params.paymentId, msg);
    return { success: false, error: msg };
  }

  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { TIN: true, name: true, address: true, phone: true },
  });
  if (!org) {
    await markPaymentFailed(params.paymentId, 'Organization not found');
    return { success: false, error: 'Organization not found' };
  }

  let payload: Record<string, unknown>;
  try {
    // A subscription receipt is a fresh fiscal document for the org-as-buyer,
    // so it needs its own unconsumed purchase code — the sandbox rejects the
    // submission without one (resultCd 881/882).
    const buyerTin = (org.TIN ?? '').trim();
    const code = buyerTin
      ? await consumeAnyOrgPurchaseCode(params.organizationId, payment.id, prisma, buyerTin)
      : null;
    if (code) sale.prcOrdCd = code;
    const rraPaymentCode = await getRraPaymentCode(params.organizationId, sale.paymentType);
    payload = buildRraSendReceiptPayload(sale, org, rraPaymentCode);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid billing receipt payload';
    await markPaymentFailed(params.paymentId, msg);
    return { success: false, error: msg };
  }

  await prisma.payment.update({
    where: { id: params.paymentId },
    data: {
      submissionStatus: 'SUBMITTED',
      invoiceNumber: sale.invoiceNumber,
      submittedAt: new Date(),
      errorMessage: null,
    },
  });

  try {
    const isOsdc = config.ebm.protocol === 'osdc';

    if (isOsdc) {
      const osdc = await submitSalesToOsdc({
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

    const envelope = await buildVsdcEnvelope(params.organizationId, branchId);
    const result = await saveInvc(envelope, payload);
    const decision = decideVsdcReceiptResult(result, { docLabel: 'billing receipt' });
    if (!decision.confirmed) {
      await markPaymentFailed(params.paymentId, decision.error);
      return { success: false, error: decision.error };
    }

    const vsdc = decision.data;
    await persistPaymentFiscalSuccess(params.paymentId, {
      ebmInvoiceNumber: vsdc.rcptNo,
      sale,
      sdcDateTime: new Date(vsdc.sdcDateTime),
      sdcRcptNo: parseInt(vsdc.rcptNo, 10),
      totalRcptNo: parseInt(vsdc.totRcptNo, 10),
      sdcId: vsdc.sdcId,
      internalData: vsdc.intrlData,
      receiptSignature: vsdc.vsdcSignature,
    });
    return { success: true, ebmInvoiceNumber: vsdc.rcptNo };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'EBM request failed';
    await markPaymentFailed(params.paymentId, msg);
    return { success: false, error: msg };
  }
}

async function persistPaymentFiscalSuccess(
  paymentId: number,
  data: {
    ebmInvoiceNumber: string;
    sale: SaleWithRelations;
    sdcDateTime?: Date | null;
    sdcRcptNo?: number | null;
    totalRcptNo?: number | null;
    sdcId?: string | null;
    internalData?: string | null;
    receiptSignature?: string | null;
    qrPayload?: string | null;
  },
): Promise<void> {
  await prisma.payment.update({
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
      rcptLabel: (data.sale.rcptLabel as any) ?? null,
      errorMessage: null,
    },
  });
}

async function markPaymentFailed(paymentId: number, message: string): Promise<void> {
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      submissionStatus: 'FAILED',
      errorMessage: message,
      retryCount: { increment: 1 },
    },
  });
}

/** Exported for parity with the sales helper (kept for future retry wiring). */
export async function requeueFailedPaymentFiscalization(paymentId: number): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { subscription: { select: { organizationId: true } } },
  });
  if (!payment) return;
  await fiscalizeSubscriptionPayment({
    paymentId,
    organizationId: payment.subscription.organizationId,
  });
}

export { toRraDateTime };

import type { Response } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { getProvider } from '../services/payment-providers/registry';
import { success, error as apiError } from '../utils/apiResponse';

type MobileMoneyProvider = 'MTN_MOMO' | 'AIRTEL_MONEY';
type PaymentRail = 'PAYPACK' | 'MTN_MOMO';

const PROVIDERS = new Set<MobileMoneyProvider>(['MTN_MOMO', 'AIRTEL_MONEY']);
const RAILS = new Set<PaymentRail>(['PAYPACK', 'MTN_MOMO']);

function cleanPhone(value: unknown): string {
  return String(value ?? '').replace(/[^\d+]/g, '');
}

function isRwandanMobile(value: string): boolean {
  const digits = value.replace(/^\+/, '');
  return /^(?:250|0)?7\d{8}$/.test(digits);
}

function directMtnPhone(value: string): string {
  const digits = value.replace(/^\+/, '');
  if (digits.startsWith('250')) return digits;
  if (digits.startsWith('0')) return `250${digits.slice(1)}`;
  return `250${digits}`;
}

function configuredRail(provider: MobileMoneyProvider): PaymentRail {
  const directMtnConfigured = Boolean(
    process.env.MTN_MOMO_SUBSCRIPTION_KEY &&
    process.env.MTN_MOMO_API_USER &&
    process.env.MTN_MOMO_API_KEY
  );
  return provider === 'MTN_MOMO' && directMtnConfigured ? 'MTN_MOMO' : 'PAYPACK';
}

function normalizeStatus(value: unknown): 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' {
  const status = String(value ?? '').toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PROCESSED'].includes(status)) return 'COMPLETED';
  if (['FAILED', 'REJECTED', 'DECLINED'].includes(status)) return 'FAILED';
  if (['CANCELLED', 'CANCELED'].includes(status)) return 'CANCELLED';
  return 'PENDING';
}

export const initiateMobileMoneyPayment = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = Number(req.params.organizationId);
    const amount = Number(req.body.amount);
    const provider = String(req.body.provider ?? '') as MobileMoneyProvider;
    const phone = cleanPhone(req.body.phone);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      return res.status(400).json(apiError('Invalid organization'));
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json(apiError('Payment amount must be greater than zero'));
    }
    if (!PROVIDERS.has(provider)) {
      return res.status(400).json(apiError('Unsupported mobile money provider'));
    }
    if (!isRwandanMobile(phone)) {
      return res.status(400).json(apiError('Enter a valid Rwanda mobile number'));
    }

    const rail = configuredRail(provider);
    const paymentProvider = getProvider(rail);
    if (!paymentProvider) {
      return res.status(503).json(apiError('Mobile money is not configured'));
    }

    const reference = String(req.body.reference ?? '').trim() || `POS-${organizationId}-${Date.now()}`;
    const providerPhone = rail === 'MTN_MOMO' ? directMtnPhone(phone) : phone;
    const result = await paymentProvider.initiatePayment({
      amount,
      currency: 'RWF',
      reference,
      description: `Excel Edge POS mobile money payment ${reference}`,
      metadata: {
        phoneNumber: providerPhone,
        mobileMoneyProvider: provider,
        organizationId,
      },
    });

    if (!result.success || !result.transactionId) {
      return res.status(502).json(apiError(result.message || 'Could not initiate mobile money payment'));
    }

    return res.status(202).json(success({
      transactionId: result.transactionId,
      reference: result.reference || reference,
      provider,
      rail,
      status: normalizeStatus(result.status),
      message: result.message,
    }));
  } catch (err: any) {
    console.error('[Mobile Money] initiation failed:', err?.message ?? err);
    return res.status(500).json(apiError('Could not initiate mobile money payment'));
  }
};

export const getMobileMoneyPaymentStatus = async (req: BranchAuthRequest, res: Response) => {
  try {
    const transactionId = String(req.params.transactionId ?? '');
    const rail = String(req.query.rail ?? '') as PaymentRail;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !RAILS.has(rail)) {
      return res.status(400).json(apiError('Invalid payment transaction'));
    }

    const paymentProvider = getProvider(rail);
    if (!paymentProvider) return res.status(503).json(apiError('Payment provider is unavailable'));

    const result = await paymentProvider.checkStatus(transactionId);
    return res.json(success({
      transactionId,
      status: normalizeStatus(result.status),
      amount: result.amount,
      currency: result.currency,
      message: result.message,
    }));
  } catch (err: any) {
    console.error('[Mobile Money] status check failed:', err?.message ?? err);
    return res.status(502).json(apiError('Could not check mobile money payment status'));
  }
};

export const cancelMobileMoneyPayment = async (req: BranchAuthRequest, res: Response) => {
  try {
    const transactionId = String(req.params.transactionId ?? '');
    const rail = String(req.body.rail ?? '') as PaymentRail;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !RAILS.has(rail)) {
      return res.status(400).json(apiError('Invalid payment transaction'));
    }

    const paymentProvider = getProvider(rail);
    if (!paymentProvider) return res.status(503).json(apiError('Payment provider is unavailable'));

    const result = await paymentProvider.cancelPayment(transactionId);
    return res.json(success({
      transactionId,
      status: normalizeStatus(result.status),
      message: result.message,
    }));
  } catch (err: any) {
    console.error('[Mobile Money] cancellation failed:', err?.message ?? err);
    return res.status(502).json(apiError('Could not cancel mobile money payment'));
  }
};

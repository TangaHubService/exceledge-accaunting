"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelMobileMoneyPayment = exports.getMobileMoneyPaymentStatus = exports.initiateMobileMoneyPayment = void 0;
const registry_1 = require("../services/payment-providers/registry");
const apiResponse_1 = require("../utils/apiResponse");
const PROVIDERS = new Set(['MTN_MOMO', 'AIRTEL_MONEY']);
const RAILS = new Set(['PAYPACK', 'MTN_MOMO']);
function cleanPhone(value) {
    return String(value ?? '').replace(/[^\d+]/g, '');
}
function isRwandanMobile(value) {
    const digits = value.replace(/^\+/, '');
    return /^(?:250|0)?7\d{8}$/.test(digits);
}
function directMtnPhone(value) {
    const digits = value.replace(/^\+/, '');
    if (digits.startsWith('250'))
        return digits;
    if (digits.startsWith('0'))
        return `250${digits.slice(1)}`;
    return `250${digits}`;
}
function configuredRail(provider) {
    const directMtnConfigured = Boolean(process.env.MTN_MOMO_SUBSCRIPTION_KEY &&
        process.env.MTN_MOMO_API_USER &&
        process.env.MTN_MOMO_API_KEY);
    return provider === 'MTN_MOMO' && directMtnConfigured ? 'MTN_MOMO' : 'PAYPACK';
}
function normalizeStatus(value) {
    const status = String(value ?? '').toUpperCase();
    if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PROCESSED'].includes(status))
        return 'COMPLETED';
    if (['FAILED', 'REJECTED', 'DECLINED'].includes(status))
        return 'FAILED';
    if (['CANCELLED', 'CANCELED'].includes(status))
        return 'CANCELLED';
    return 'PENDING';
}
const initiateMobileMoneyPayment = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const amount = Number(req.body.amount);
        const provider = String(req.body.provider ?? '');
        const phone = cleanPhone(req.body.phone);
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            return res.status(400).json((0, apiResponse_1.error)('Invalid organization'));
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json((0, apiResponse_1.error)('Payment amount must be greater than zero'));
        }
        if (!PROVIDERS.has(provider)) {
            return res.status(400).json((0, apiResponse_1.error)('Unsupported mobile money provider'));
        }
        if (!isRwandanMobile(phone)) {
            return res.status(400).json((0, apiResponse_1.error)('Enter a valid Rwanda mobile number'));
        }
        const rail = configuredRail(provider);
        const paymentProvider = (0, registry_1.getProvider)(rail);
        if (!paymentProvider) {
            return res.status(503).json((0, apiResponse_1.error)('Mobile money is not configured'));
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
            return res.status(502).json((0, apiResponse_1.error)(result.message || 'Could not initiate mobile money payment'));
        }
        return res.status(202).json((0, apiResponse_1.success)({
            transactionId: result.transactionId,
            reference: result.reference || reference,
            provider,
            rail,
            status: normalizeStatus(result.status),
            message: result.message,
        }));
    }
    catch (err) {
        console.error('[Mobile Money] initiation failed:', err?.message ?? err);
        return res.status(500).json((0, apiResponse_1.error)('Could not initiate mobile money payment'));
    }
};
exports.initiateMobileMoneyPayment = initiateMobileMoneyPayment;
const getMobileMoneyPaymentStatus = async (req, res) => {
    try {
        const transactionId = String(req.params.transactionId ?? '');
        const rail = String(req.query.rail ?? '');
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !RAILS.has(rail)) {
            return res.status(400).json((0, apiResponse_1.error)('Invalid payment transaction'));
        }
        const paymentProvider = (0, registry_1.getProvider)(rail);
        if (!paymentProvider)
            return res.status(503).json((0, apiResponse_1.error)('Payment provider is unavailable'));
        const result = await paymentProvider.checkStatus(transactionId);
        return res.json((0, apiResponse_1.success)({
            transactionId,
            status: normalizeStatus(result.status),
            amount: result.amount,
            currency: result.currency,
            message: result.message,
        }));
    }
    catch (err) {
        console.error('[Mobile Money] status check failed:', err?.message ?? err);
        return res.status(502).json((0, apiResponse_1.error)('Could not check mobile money payment status'));
    }
};
exports.getMobileMoneyPaymentStatus = getMobileMoneyPaymentStatus;
const cancelMobileMoneyPayment = async (req, res) => {
    try {
        const transactionId = String(req.params.transactionId ?? '');
        const rail = String(req.body.rail ?? '');
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !RAILS.has(rail)) {
            return res.status(400).json((0, apiResponse_1.error)('Invalid payment transaction'));
        }
        const paymentProvider = (0, registry_1.getProvider)(rail);
        if (!paymentProvider)
            return res.status(503).json((0, apiResponse_1.error)('Payment provider is unavailable'));
        const result = await paymentProvider.cancelPayment(transactionId);
        return res.json((0, apiResponse_1.success)({
            transactionId,
            status: normalizeStatus(result.status),
            message: result.message,
        }));
    }
    catch (err) {
        console.error('[Mobile Money] cancellation failed:', err?.message ?? err);
        return res.status(502).json((0, apiResponse_1.error)('Could not cancel mobile money payment'));
    }
};
exports.cancelMobileMoneyPayment = cancelMobileMoneyPayment;

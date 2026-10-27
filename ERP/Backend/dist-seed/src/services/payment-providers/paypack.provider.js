"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaypackPaymentProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const getAcessToken_1 = require("../../utils/getAcessToken");
const paypack_1 = require("../../lib/paypack");
class PaypackPaymentProvider {
    constructor() {
        this.name = 'PAYPACK';
        this.maxRetries = 3;
        this.retryDelay = 1000;
    }
    async initiatePayment(request) {
        const lastError = '';
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const { access } = await (0, getAcessToken_1.getAccessToken)();
                const response = await axios_1.default.post(`${paypack_1.paypackConfig.baseUrl}/transactions/cashin`, { amount: request.amount, number: request.metadata?.phoneNumber || '' }, {
                    headers: {
                        'Authorization': `Bearer ${access}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Webhook-Mode': paypack_1.paypackConfig.environment,
                    },
                    timeout: 30000,
                });
                return {
                    success: true,
                    transactionId: response.data?.ref || response.data?.transaction_id || `PAYPACK-${Date.now()}`,
                    reference: request.reference,
                    status: 'PENDING',
                    message: 'Payment initiated',
                    data: response.data,
                };
            }
            catch (error) {
                console.error(`[Paypack] Attempt ${attempt}/${this.maxRetries} failed:`, error.message);
                if (attempt === this.maxRetries) {
                    return {
                        success: false,
                        transactionId: '',
                        reference: request.reference,
                        status: 'FAILED',
                        message: error.message || 'Payment initiation failed after retries',
                    };
                }
                await new Promise(r => setTimeout(r, this.retryDelay * attempt));
            }
        }
        return { success: false, transactionId: '', reference: request.reference, status: 'FAILED', message: lastError };
    }
    async checkStatus(transactionId) {
        try {
            const { access } = await (0, getAcessToken_1.getAccessToken)();
            const response = await axios_1.default.get(`${paypack_1.paypackConfig.baseUrl}/transactions/status?ref=${transactionId}`, {
                headers: { 'Authorization': `Bearer ${access}` },
                timeout: 15000,
            });
            return {
                status: (response.data?.status || 'PENDING').toUpperCase(),
                transactionId,
                data: response.data,
            };
        }
        catch (error) {
            console.error('[Paypack] Status check failed:', error.message);
            return { status: 'FAILED', transactionId, message: error.message };
        }
    }
    async cancelPayment(transactionId) {
        return { success: true, transactionId, reference: '', status: 'CANCELLED', message: 'Payment cancelled' };
    }
    async refundPayment(transactionId, amount) {
        try {
            const { access } = await (0, getAcessToken_1.getAccessToken)();
            const response = await axios_1.default.post(`${paypack_1.paypackConfig.baseUrl}/transactions/cashout`, { amount: amount || 0, ref: transactionId }, {
                headers: { 'Authorization': `Bearer ${access}`, 'Content-Type': 'application/json' },
                timeout: 30000,
            });
            return {
                success: true,
                transactionId: response.data?.ref || transactionId,
                reference: transactionId,
                status: 'COMPLETED',
                message: 'Refund processed',
                data: response.data,
            };
        }
        catch (error) {
            console.error('[Paypack] Refund failed:', error.message);
            return { success: false, transactionId, reference: '', status: 'FAILED', message: error.message };
        }
    }
    async processWebhook(payload) {
        const ref = payload?.ref || payload?.reference || '';
        const status = payload?.status === 'success' ? 'COMPLETED' : 'FAILED';
        return {
            success: status === 'COMPLETED',
            transactionId: ref,
            reference: ref,
            status: status,
            data: payload,
        };
    }
}
exports.PaypackPaymentProvider = PaypackPaymentProvider;

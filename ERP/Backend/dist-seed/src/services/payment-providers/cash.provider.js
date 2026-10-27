"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashPaymentProvider = void 0;
class CashPaymentProvider {
    constructor() {
        this.name = 'CASH';
    }
    async initiatePayment(request) {
        return {
            success: true,
            transactionId: `CASH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            reference: request.reference,
            status: 'COMPLETED',
            message: 'Cash payment recorded',
        };
    }
    async checkStatus(transactionId) {
        return { status: 'COMPLETED', transactionId };
    }
    async cancelPayment(transactionId) {
        return { success: true, transactionId, reference: '', status: 'CANCELLED' };
    }
    async refundPayment(transactionId, amount) {
        return { success: true, transactionId, reference: '', status: 'REFUNDED', message: `Refunded ${amount || 'full'}` };
    }
    async processWebhook(payload) {
        return { success: true, transactionId: '', reference: '', status: 'COMPLETED' };
    }
}
exports.CashPaymentProvider = CashPaymentProvider;

import { PaymentProvider, PaymentRequest, PaymentResponse, PaymentStatusResponse } from './index';

export class CashPaymentProvider implements PaymentProvider {
    name = 'CASH';

    async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
        return {
            success: true,
            transactionId: `CASH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            reference: request.reference,
            status: 'COMPLETED',
            message: 'Cash payment recorded',
        };
    }

    async checkStatus(transactionId: string): Promise<PaymentStatusResponse> {
        return { status: 'COMPLETED', transactionId };
    }

    async cancelPayment(transactionId: string): Promise<PaymentResponse> {
        return { success: true, transactionId, reference: '', status: 'CANCELLED' };
    }

    async refundPayment(transactionId: string, amount?: number): Promise<PaymentResponse> {
        return { success: true, transactionId, reference: '', status: 'REFUNDED', message: `Refunded ${amount || 'full'}` };
    }

    async processWebhook(payload: any): Promise<PaymentResponse> {
        return { success: true, transactionId: '', reference: '', status: 'COMPLETED' };
    }
}

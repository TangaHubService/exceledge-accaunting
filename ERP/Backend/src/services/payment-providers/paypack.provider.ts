import { PaymentProvider, PaymentRequest, PaymentResponse, PaymentStatusResponse } from './index';
import axios from 'axios';
import { getAccessToken } from '../../utils/getAcessToken';
import { paypackConfig } from '../../lib/paypack';

export class PaypackPaymentProvider implements PaymentProvider {
    name = 'PAYPACK';
    private maxRetries = 3;
    private retryDelay = 1000;

    async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
        const lastError = '';
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const { access } = await getAccessToken();
                const response = await axios.post(
                    `${paypackConfig.baseUrl}/transactions/cashin`,
                    { amount: request.amount, number: request.metadata?.phoneNumber || '' },
                    {
                        headers: {
                            'Authorization': `Bearer ${access}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'X-Webhook-Mode': paypackConfig.environment,
                        },
                        timeout: 30000,
                    }
                );

                return {
                    success: true,
                    transactionId: response.data?.ref || response.data?.transaction_id || `PAYPACK-${Date.now()}`,
                    reference: request.reference,
                    status: 'PENDING',
                    message: 'Payment initiated',
                    data: response.data,
                };
            } catch (error: any) {
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

    async checkStatus(transactionId: string): Promise<PaymentStatusResponse> {
        try {
            const { access } = await getAccessToken();
            const response = await axios.get(
                `${paypackConfig.baseUrl}/transactions/status?ref=${transactionId}`,
                {
                    headers: { 'Authorization': `Bearer ${access}` },
                    timeout: 15000,
                }
            );
            return {
                status: (response.data?.status || 'PENDING').toUpperCase() as any,
                transactionId,
                data: response.data,
            };
        } catch (error: any) {
            console.error('[Paypack] Status check failed:', error.message);
            return { status: 'FAILED', transactionId, message: error.message };
        }
    }

    async cancelPayment(transactionId: string): Promise<PaymentResponse> {
        return { success: true, transactionId, reference: '', status: 'CANCELLED', message: 'Payment cancelled' };
    }

    async refundPayment(transactionId: string, amount?: number): Promise<PaymentResponse> {
        try {
            const { access } = await getAccessToken();
            const response = await axios.post(
                `${paypackConfig.baseUrl}/transactions/cashout`,
                { amount: amount || 0, ref: transactionId },
                {
                    headers: { 'Authorization': `Bearer ${access}`, 'Content-Type': 'application/json' },
                    timeout: 30000,
                }
            );
            return {
                success: true,
                transactionId: response.data?.ref || transactionId,
                reference: transactionId,
                status: 'COMPLETED',
                message: 'Refund processed',
                data: response.data,
            };
        } catch (error: any) {
            console.error('[Paypack] Refund failed:', error.message);
            return { success: false, transactionId, reference: '', status: 'FAILED', message: error.message };
        }
    }

    async processWebhook(payload: any): Promise<PaymentResponse> {
        const ref = payload?.ref || payload?.reference || '';
        const status = payload?.status === 'success' ? 'COMPLETED' : 'FAILED';
        return {
            success: status === 'COMPLETED',
            transactionId: ref,
            reference: ref,
            status: status as any,
            data: payload,
        };
    }
}

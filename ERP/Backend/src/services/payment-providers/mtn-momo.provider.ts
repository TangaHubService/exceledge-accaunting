import { PaymentProvider, PaymentRequest, PaymentResponse, PaymentStatusResponse } from './index';
import axios from 'axios';

export class MtnMoMoPaymentProvider implements PaymentProvider {
    name = 'MTN_MOMO';
    private baseUrl = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
    private subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY || '';
    private apiUser = process.env.MTN_MOMO_API_USER || '';
    private apiKey = process.env.MTN_MOMO_API_KEY || '';
    private token: string | null = null;
    private tokenExpiry: Date | null = null;

    private async getToken(): Promise<string> {
        if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) return this.token;
        const response = await axios.post(
            `${this.baseUrl}/collection/token/`,
            {},
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': this.subscriptionKey,
                    'Authorization': `Basic ${Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64')}`,
                },
            }
        );
        this.token = response.data.access_token;
        this.tokenExpiry = new Date(Date.now() + (response.data.expires_in || 3600) * 1000);
        return this.token!;
    }

    async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
        try {
            const token = await this.getToken();
            const ref = `MOMO-${Date.now()}`;
            const response = await axios.post(
                `${this.baseUrl}/collection/v1_0/requesttopay`,
                {
                    amount: String(request.amount),
                    currency: request.currency || 'EUR',
                    externalId: ref,
                    payer: { partyIdType: 'MSISDN', partyId: request.metadata?.phoneNumber || '' },
                    payerMessage: request.description || 'Payment',
                    payeeNote: 'Payment',
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Reference-Id': ref,
                        'X-Target-Environment': 'sandbox',
                        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
                        'Content-Type': 'application/json',
                    },
                }
            );
            return {
                success: response.status === 202,
                transactionId: ref,
                reference: request.reference,
                status: 'PENDING',
                data: response.data,
            };
        } catch (error: any) {
            console.error('[MTN MoMo] Initiation failed:', error.message);
            return { success: false, transactionId: '', reference: request.reference, status: 'FAILED', message: error.message };
        }
    }

    async checkStatus(transactionId: string): Promise<PaymentStatusResponse> {
        try {
            const token = await this.getToken();
            const response = await axios.get(
                `${this.baseUrl}/collection/v1_0/requesttopay/${transactionId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
                        'X-Target-Environment': 'sandbox',
                    },
                }
            );
            const status = response.data.status === 'SUCCESSFUL' ? 'COMPLETED'
                : response.data.status === 'FAILED' ? 'FAILED'
                : 'PENDING';
            return { status: status as any, transactionId, data: response.data };
        } catch (error: any) {
            return { status: 'FAILED', transactionId, message: error.message };
        }
    }

    async cancelPayment(transactionId: string): Promise<PaymentResponse> {
        return { success: true, transactionId, reference: '', status: 'CANCELLED' };
    }

    async refundPayment(transactionId: string, amount?: number): Promise<PaymentResponse> {
        return { success: false, transactionId, reference: '', status: 'FAILED', message: 'Refund not supported directly' };
    }

    async processWebhook(payload: any): Promise<PaymentResponse> {
        return {
            success: payload.status === 'SUCCESSFUL',
            transactionId: payload.externalId || '',
            reference: payload.externalId || '',
            status: payload.status === 'SUCCESSFUL' ? 'COMPLETED' : 'FAILED',
            data: payload,
        };
    }
}

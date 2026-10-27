import { PrismaClient } from '@prisma/client';
import { getProvider, getAvailableMethods } from './payment-providers/registry';
import { PaymentRequest } from './payment-providers/index';
import logger from '../utils/logger';

export class PaymentService {
    private prisma: PrismaClient;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    getAvailableMethods(): string[] {
        return getAvailableMethods();
    }

    async initiatePayment(params: {
        organizationId: number;
        amount: number;
        currency: string;
        paymentMethod: string;
        reference: string;
        description?: string;
        metadata?: Record<string, any>;
    }) {
        const provider = getProvider(params.paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${params.paymentMethod}" is not supported`);
        }

        const request: PaymentRequest = {
            amount: params.amount,
            currency: params.currency,
            reference: params.reference,
            description: params.description || `Payment ${params.reference}`,
            metadata: params.metadata,
        };

        const response = await provider.initiatePayment(request);

        await this.prisma.$transaction(async (tx) => {
            await tx.payment.create({
                data: {
                    amount: params.amount,
                    currency: params.currency,
                    paymentMethod: params.paymentMethod as any,
                    paymentId: response.transactionId,
                    status: response.status as any,
                    metadata: { ...params.metadata, providerResponse: response.data },
                    processedAt: response.status === 'COMPLETED' ? new Date() : null,
                    subscriptionId: 0,
                },
            });
        });

        return response;
    }

    async checkPaymentStatus(transactionId: string, paymentMethod: string) {
        const provider = getProvider(paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${paymentMethod}" is not supported`);
        }
        return provider.checkStatus(transactionId);
    }

    async processWebhook(paymentMethod: string, payload: any) {
        const provider = getProvider(paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${paymentMethod}" is not supported`);
        }
        return provider.processWebhook(payload);
    }

    async refundPayment(params: {
        transactionId: string;
        paymentMethod: string;
        amount?: number;
    }) {
        const provider = getProvider(params.paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${params.paymentMethod}" is not supported`);
        }
        return provider.refundPayment(params.transactionId, params.amount);
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const registry_1 = require("./payment-providers/registry");
class PaymentService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    getAvailableMethods() {
        return (0, registry_1.getAvailableMethods)();
    }
    async initiatePayment(params) {
        const provider = (0, registry_1.getProvider)(params.paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${params.paymentMethod}" is not supported`);
        }
        const request = {
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
                    paymentMethod: params.paymentMethod,
                    paymentId: response.transactionId,
                    status: response.status,
                    metadata: { ...params.metadata, providerResponse: response.data },
                    processedAt: response.status === 'COMPLETED' ? new Date() : null,
                    subscriptionId: 0,
                },
            });
        });
        return response;
    }
    async checkPaymentStatus(transactionId, paymentMethod) {
        const provider = (0, registry_1.getProvider)(paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${paymentMethod}" is not supported`);
        }
        return provider.checkStatus(transactionId);
    }
    async processWebhook(paymentMethod, payload) {
        const provider = (0, registry_1.getProvider)(paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${paymentMethod}" is not supported`);
        }
        return provider.processWebhook(payload);
    }
    async refundPayment(params) {
        const provider = (0, registry_1.getProvider)(params.paymentMethod);
        if (!provider) {
            throw new Error(`Payment method "${params.paymentMethod}" is not supported`);
        }
        return provider.refundPayment(params.transactionId, params.amount);
    }
}
exports.PaymentService = PaymentService;

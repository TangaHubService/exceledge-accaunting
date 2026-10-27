"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiatePaypackPayment = void 0;
const getAcessToken_1 = require("../utils/getAcessToken");
const axios_1 = __importDefault(require("axios"));
const paypack_1 = require("../lib/paypack");
const prisma_1 = require("../lib/prisma");
const socket_1 = require("../utils/socket");
const subscription_service_1 = require("../services/subscription.service");
const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
const initiatePaypackPayment = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const planId = Number(req.params.planId);
        const { phoneNumber, months, billingMode } = req.body;
        //@ts-ignore
        const userId = req.user?.userId ? Number(req.user.userId) : undefined;
        const { subscription, totalAmount } = await subscriptionService.preparePurchase({
            organizationId,
            planId,
            months: months !== undefined ? Number(months) : 1,
            billingMode: billingMode === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
            userId,
        });
        const initiatePayment = async ({ phoneNumber }) => {
            const { access } = await (0, getAcessToken_1.getAccessToken)();
            const response = await axios_1.default.post(`${paypack_1.paypackConfig.baseUrl}/transactions/cashin`, {
                amount: totalAmount,
                number: phoneNumber,
            }, {
                headers: {
                    'Authorization': `Bearer ${access}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Webhook-Mode': paypack_1.paypackConfig.environment
                }
            });
            // Paypack assigns its own transaction ref, which is what the webhook
            // looks up subscriptions by — overwrite our placeholder ref with it
            // while preserving the months/billingMode/totalAmount already stored.
            if (response.data?.ref) {
                await prisma_1.prisma.subscription.update({
                    where: { id: subscription.id },
                    data: {
                        paymentDetails: {
                            ...subscription.paymentDetails,
                            ref: response.data.ref,
                            amount: totalAmount,
                            currency: 'RWF',
                            status: 'PENDING'
                        },
                    }
                });
            }
            return response.data;
        };
        const result = await initiatePayment({
            phoneNumber
        });
        if (typeof result !== 'object' || result === null || Array.isArray(result)) {
            console.error('Unexpected Paypack response:', result);
            return res.status(502).json({ success: false, message: 'Invalid response from payment provider' });
        }
        // Emit socket event for payment initiation
        if (result?.ref) {
            console.log(`🚀 Payment initiated, emitting event for ref: ${result.ref}`);
            (0, socket_1.emitTransactionUpdate)(result.ref, {
                event: 'payment:initiated',
                status: 'pending',
                reference: result.ref,
                timestamp: new Date().toISOString()
            }, String(organizationId));
        }
        res.json({
            success: true,
            data: { ...result, totalAmount, subscriptionId: subscription.id }
        });
    }
    catch (error) {
        console.error('Error initiating Paypack payment:', error);
        const message = error.message || 'Failed to initiate payment';
        const status = /not found or inactive/i.test(message) ? 404
            : /months must|billingMode must|requires months/i.test(message) ? 400
                : 500;
        res.status(status).json({
            success: false,
            message
        });
    }
};
exports.initiatePaypackPayment = initiatePaypackPayment;

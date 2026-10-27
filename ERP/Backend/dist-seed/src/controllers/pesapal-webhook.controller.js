"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePesapalWebhook = void 0;
const prisma_1 = require("../lib/prisma");
const socket_1 = require("../utils/socket");
const getAcessToken_1 = require("../utils/getAcessToken");
const axios_1 = __importDefault(require("axios"));
const paypack_1 = require("../lib/paypack");
const subscription_service_1 = require("../services/subscription.service");
const PESAPAL_API_URL = paypack_1.pesapalConfig.baseUrl;
const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
const logWebhook = (message, data) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] PESAPAL WEBHOOK: ${message}`, data || '');
};
/**
 * Handle Pesapal webhook/callback
 * This is called when Pesapal sends a notification about a transaction
 */
const handlePesapalWebhook = async (req, res) => {
    try {
        logWebhook('Webhook received', req.body);
        const { OrderTrackingId, OrderNotificationType, OrderMerchantReference } = req.body;
        if (!OrderTrackingId) {
            logWebhook('Missing OrderTrackingId');
            return res.status(400).json({
                success: false,
                message: 'OrderTrackingId is required'
            });
        }
        // Fetch the transaction status from Pesapal
        const transactionStatus = await getTransactionStatus(OrderTrackingId);
        logWebhook('Transaction status fetched', transactionStatus);
        // Process the transaction if it's completed
        if (transactionStatus.payment_status_description === 'Completed') {
            await handleCompletedTransaction(transactionStatus);
        }
        // Acknowledge the webhook
        res.status(200).json({
            success: true,
            message: 'Webhook processed successfully',
            orderTrackingId: OrderTrackingId,
            orderNotificationType: OrderNotificationType || 'CALLBACK'
        });
        logWebhook('Webhook processed successfully');
    }
    catch (error) {
        console.error('Error processing Pesapal webhook:', error);
        res.status(500).json({
            error: 'Error processing webhook',
            message: error.message
        });
    }
};
exports.handlePesapalWebhook = handlePesapalWebhook;
/**
 * Get transaction status from Pesapal API
 */
async function getTransactionStatus(orderTrackingId) {
    try {
        const tokenData = await (0, getAcessToken_1.pesapalToken)();
        const response = await axios_1.default.get(`${PESAPAL_API_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`, {
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${tokenData.token}`
            }
        });
        return response.data;
    }
    catch (error) {
        console.error("Error getting transaction status:", error);
        throw error;
    }
}
/**
 * Handle completed transaction - similar to Paypack's handleProcessedTransaction
 */
async function handleCompletedTransaction(transactionStatus) {
    try {
        logWebhook('Processing completed transaction', {
            merchantRef: transactionStatus.merchant_reference,
            amount: transactionStatus.amount,
            status: transactionStatus.payment_status_description
        });
        // Find subscription by merchant reference
        const subscription = await prisma_1.prisma.subscription.findFirst({
            where: {
                paymentDetails: {
                    path: ['ref'],
                    equals: transactionStatus.merchant_reference
                }
            }
        });
        if (!subscription) {
            console.warn('No subscription found for merchant reference:', transactionStatus.merchant_reference);
            return;
        }
        logWebhook('Subscription found', { id: subscription.id, status: subscription.status });
        if (transactionStatus.payment_status_description !== 'Completed') {
            logWebhook('Transaction not completed, no subscription changes made', {
                status: transactionStatus.payment_status_description
            });
            return;
        }
        /** -------------------------------------------
         *   PAYMENT SUCCESS → NEW ACTIVATION OR RENEWAL
         *   via the shared, gateway-agnostic completion path
         *   (idempotency guard lives inside this call).
         *  ------------------------------------------- */
        const result = await subscriptionService.finalizeSubscriptionPurchase({
            subscriptionId: subscription.id,
            paymentId: transactionStatus.order_tracking_id,
            amount: transactionStatus.amount,
            currency: transactionStatus.currency,
            paymentMethod: 'PESAPA',
            metadata: {
                payment_method: transactionStatus.payment_method,
                confirmation_code: transactionStatus.confirmation_code,
                payment_account: transactionStatus.payment_account,
                description: transactionStatus.description,
                status_code: transactionStatus.status_code
            },
            processedAt: new Date(transactionStatus.created_date),
        });
        if (!result) {
            logWebhook('Payment for this order already processed. Skipping.', {
                orderTrackingId: transactionStatus.order_tracking_id,
            });
            return;
        }
        const payment = result.payments[0];
        logWebhook('Subscription updated', {
            id: result.id,
            status: result.status
        });
        // Emit WebSocket event for real-time updates
        const io = (0, socket_1.getIO)();
        const eventData = {
            event: 'payment:processed',
            status: transactionStatus.payment_status_description,
            subscription: {
                id: result.id,
                status: result.status,
                plan: result.planId,
                endDate: result.endDate
            },
            payment: {
                id: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                reference: payment.paymentId,
                status: payment.status,
                timestamp: new Date().toISOString()
            }
        };
        // Emit to the specific transaction room
        io.to(`trx-${transactionStatus.order_tracking_id}`).emit('transactionUpdate', eventData);
        logWebhook('WebSocket event emitted', {
            room: `trx-${transactionStatus.order_tracking_id}`
        });
    }
    catch (error) {
        console.error('Error processing completed transaction:', error);
        throw error;
    }
}

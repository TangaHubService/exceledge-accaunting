import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getIO } from '../utils/socket';
import { pesapalToken } from '../utils/getAcessToken';
import axios from 'axios';
import { pesapalConfig } from '../lib/paypack';
import { SubscriptionService } from '../services/subscription.service';

const PESAPAL_API_URL = pesapalConfig.baseUrl;
const subscriptionService = new SubscriptionService(prisma);

interface PesapalTransactionStatus {
    payment_method: string;
    amount: number;
    created_date: string;
    confirmation_code: string;
    order_tracking_id: string;
    payment_status_description: string;
    description: string;
    message: string;
    payment_account: string;
    call_back_url: string;
    status_code: number;
    merchant_reference: string;
    account_number: string | null;
    payment_status_code: string;
    currency: string;
    error: {
        error_type: string | null;
        code: string | null;
        message: string | null;
    };
    status: string;
}

const logWebhook = (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] PESAPAL WEBHOOK: ${message}`, data || '');
};

/**
 * Handle Pesapal webhook/callback
 * This is called when Pesapal sends a notification about a transaction
 */
export const handlePesapalWebhook = async (req: Request, res: Response) => {
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
    } catch (error: any) {
        console.error('Error processing Pesapal webhook:', error);
        res.status(500).json({
            error: 'Error processing webhook',
            message: error.message
        });
    }
};

/**
 * Get transaction status from Pesapal API
 */
async function getTransactionStatus(orderTrackingId: string): Promise<PesapalTransactionStatus> {
    try {
        const tokenData = await pesapalToken();
        const response = await axios.get(
            `${PESAPAL_API_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
            {
                headers: {
                    "Accept": "application/json",
                    "Authorization": `Bearer ${tokenData.token}`
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error("Error getting transaction status:", error);
        throw error;
    }
}

/**
 * Handle completed transaction - similar to Paypack's handleProcessedTransaction
 */
async function handleCompletedTransaction(transactionStatus: PesapalTransactionStatus) {
    try {
        logWebhook('Processing completed transaction', {
            merchantRef: transactionStatus.merchant_reference,
            amount: transactionStatus.amount,
            status: transactionStatus.payment_status_description
        });

        // Find subscription by merchant reference
        const subscription = await prisma.subscription.findFirst({
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
        const io = getIO();
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

    } catch (error) {
        console.error('Error processing completed transaction:', error);
        throw error;
    }
}

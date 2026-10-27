import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { getIO } from '../utils/socket';
import { PaymentStatus } from '@prisma/client';
import { SubscriptionService } from '../services/subscription.service';

const subscriptionService = new SubscriptionService(prisma);

interface PaypackWebhookPayload {
    event_id: string;
    kind: string;
    data: {
        ref: string;
        user_ref: string;
        kind: string;
        fee: number;
        merchant: string;
        client: string;
        amount: number;
        provider: string;
        status: string;
        metadata: any;
        created_at: string;
        processed_at: string;
    };
    webhooks: string[];
    created_at: string;
}

const logWebhook = (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] WEBHOOK: ${message}`, data || '');
};


export const handlePaypackWebhook = async (req: Request, res: Response) => {
    try {
        const signature = req.get("X-Paypack-Signature");
        const secret = process.env.PAYPACK_WEBHOOK_SECRET;

        if (!secret) {
            return res.status(500).send('Server configuration error');
        }

        // Get raw body for signature verification
        const rawBody = req.body.toString();
        if (!signature) {
            console.warn('Missing X-Paypack-Signature header');
            return res.status(401).send('Missing signature');
        }

        const hash = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("base64");

        if (hash !== signature) {
            return res.status(401).send('Invalid signature');
        }

        // Parse the JSON payload
        let payload: PaypackWebhookPayload;
        try {
            payload = JSON.parse(rawBody);
        } catch (error: any) {
            return res.status(400).send('Invalid JSON payload');
        }

        if (payload.kind === 'transaction:processed') {
            await handleProcessedTransaction(payload);
        }
        res.status(200).json({ received: true });
        logWebhook('Webhook processed successfully');
    } catch (error: any) {
        console.error('Error processing webhook:', error);
        res.status(500).json({
            error: 'Error processing webhook',
            message: error.message
        });
    }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function findSubscriptionWithRetry(ref: string, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        const subscription = await prisma.subscription.findFirst({
            where: {
                paymentDetails: {
                    path: ['ref'],
                    equals: ref,
                },
            },
            include: { plan: true },
        });

        if (subscription) {
            return subscription;
        }

        console.log(`Subscription for ref ${ref} not found. Retrying in ${delay}ms... (${i + 1}/${retries})`);
        await sleep(delay);
    }
    return null;
}

async function handleProcessedTransaction(payload: PaypackWebhookPayload) {
    const { data } = payload;

    try {
        const subscription = await findSubscriptionWithRetry(data.ref);

        if (!subscription) {
            console.warn('No subscription found for payment reference:', data.ref);
            return;
        }

        /** -------------------------------------------
         *   PAYMENT SUCCESS → NEW ACTIVATION OR RENEWAL
         *   via the shared, gateway-agnostic completion path.
         *  ------------------------------------------- */
        if (data.status === "successful") {
            const result = await subscriptionService.finalizeSubscriptionPurchase({
                subscriptionId: subscription.id,
                paymentId: data.ref,
                amount: data.amount,
                currency: 'RWF',
                paymentMethod: 'PAYPACK',
                metadata: {
                    provider: data.provider,
                    fee: data.fee,
                    client: data.client,
                    processedAt: data.processed_at,
                    merchant: data.merchant,
                },
                processedAt: new Date(data.processed_at),
            });

            if (!result) {
                console.log(`Payment for ref ${data.ref} already processed. Skipping.`);
                return;
            }

            const payment = result.payments[0];
            const io = getIO();
            io.to(`trx-${data.ref}`).emit('transactionUpdate', {
                event: 'payment:processed',
                status: data.status,
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
            });
            return;
        }

        // Map Paypack → internal status
        const mapPaypackStatusToPaymentStatus = (status: string): PaymentStatus => {
            const map: any = {
                successful: "COMPLETED",
                failed: "FAILED",
                pending: "PENDING",
                canceled: "CANCELED",
                cancelled: "CANCELLED",
                unpaid: "UNPAID",
                refunded: "REFUNDED",
            };
            return map[status.toLowerCase()] || "FAILED";
        };

        // Check if a payment for this ref already exists
        const existingPayment = await prisma.payment.findFirst({
            where: { paymentId: data.ref },
        });

        if (existingPayment) {
            console.log(`Payment for ref ${data.ref} already processed. Skipping creation.`);
            return;
        }

        // Record payment
        const payment = await prisma.payment.create({
            data: {
                amount: data.amount,
                currency: 'RWF',
                status: mapPaypackStatusToPaymentStatus(data.status),
                paymentMethod: 'PAYPACK',
                paymentId: data.ref,
                subscriptionId: subscription.id,
                metadata: {
                    provider: data.provider,
                    fee: data.fee,
                    client: data.client,
                    processedAt: data.processed_at,
                    merchant: data.merchant,
                }
            }
        });

        // Prepare update
        const updateData: any = {
            paymentDetails: {
                ...(subscription.paymentDetails as object),
                status: data.status,
                processedAt: new Date(data.processed_at),
                fee: data.fee,
                provider: data.provider,
                amount: data.amount,
                transactionRef: data.ref
            }
        };

        /** -------------------------------------------
         *   PAYMENT FAILED → DO NOT CANCEL subscription
         * ------------------------------------------- */
        if (data.status === "failed") {
            // Do NOT touch subscription.status if it was ACTIVE
            if (subscription.status !== "ACTIVE") {
                updateData.status = "CANCELLED";
            }
        }

        const updatedSubscription = await prisma.subscription.update({
            where: { id: subscription.id },
            data: updateData
        });
        // Emit WebSocket event
        const io = getIO();
        const eventData = {
            event: 'payment:processed',
            status: data.status,
            subscription: {
                id: updatedSubscription.id,
                status: updatedSubscription.status,
                plan: updatedSubscription.planId,
                endDate: updatedSubscription.endDate
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
        io.to(`trx-${data.ref}`).emit('transactionUpdate', eventData);

    } catch (error) {
        console.error('Error processing transaction:', error);
        throw error;
    }
}
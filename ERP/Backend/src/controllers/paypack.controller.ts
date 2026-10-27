import { Request, Response } from 'express';
import { getAccessToken } from '../utils/getAcessToken';
import axios from 'axios';
import { paypackConfig } from '../lib/paypack';
import { prisma } from '../lib/prisma';
import { emitTransactionUpdate } from '../utils/socket';
import { SubscriptionService } from '../services/subscription.service';

const subscriptionService = new SubscriptionService(prisma);

export const initiatePaypackPayment = async (req: Request, res: Response) => {
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

        const initiatePayment = async ({
            phoneNumber
        }: {
            phoneNumber: string;
        }) => {
            const { access } = await getAccessToken();
            const response = await axios.post(
                `${paypackConfig.baseUrl}/transactions/cashin`,
                {
                    amount: totalAmount,
                    number: phoneNumber,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${access}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Webhook-Mode': paypackConfig.environment
                    }
                }
            );

            // Paypack assigns its own transaction ref, which is what the webhook
            // looks up subscriptions by — overwrite our placeholder ref with it
            // while preserving the months/billingMode/totalAmount already stored.
            if (response.data?.ref) {
                await prisma.subscription.update({
                    where: { id: subscription.id },
                    data: {
                        paymentDetails: {
                            ...(subscription.paymentDetails as Record<string, unknown> | null),
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
            emitTransactionUpdate(result.ref, {
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
    } catch (error: any) {
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

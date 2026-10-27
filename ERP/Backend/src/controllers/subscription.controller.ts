// src/controllers/subscription.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import Stripe from 'stripe';
import {
    createCheckoutSession,
    cancelSubscription as stripeCancelSubscription,
    getSubscription,
} from '../services/stripe.service';
import { stripe } from '../lib/stripe';
import { convertUsdToRwf } from '../utils/currencyConverter';
import { config } from '../config';
import { isEbmEnabled } from '../services/rra-ebm.service';
import { fiscalizeSubscriptionPayment } from '../services/billing-ebm.service';

/**
 * Get all active subscription plans with features
 * @route GET /api/subscriptions/plans
 * @access Public
 */
export const getPlans = async (req: Request, res: Response) => {
    try {
        const plans = await prisma.subscriptionPlan.findMany({
            where: { isActive: true, name: { notIn: ["Free Trial", "Dev Test Plan"] } },
            include: {
                features: {
                    where: { isEnabled: true },
                    include: {
                        feature: {
                            select: {
                                id: true,
                                name: true,
                                description: true,
                                key: true,
                            },
                        },
                    },
                },
            },
            orderBy: { price: 'asc' },
        });

        // Transform data for better frontend consumption
        const formattedPlans = plans.map(plan => ({
            id: plan.id,
            name: plan.name,
            description: plan.description,
            price: plan.price,
            currency: plan.currency,
            billingCycle: plan.billingCycle,
            maxUsers: plan.maxUsers,
            features: plan.features.map(pf => ({
                id: pf.feature.id,
                name: pf.feature.name,
                description: pf.feature.description,
                key: pf.feature.key,
                limitValue: pf.limitValue,
            })),
        }));

        return res.json({
            success: true,
            data: formattedPlans,
        });
    } catch (error) {
        console.error('Get plans error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription plans',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get a specific plan by ID
 * @route GET /api/subscriptions/plans/:id
 * @access Public
 */
export const getPlanById = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);

        const plan = await prisma.subscriptionPlan.findUnique({
            where: { id },
            include: {
                features: {
                    where: { isEnabled: true },
                    include: {
                        feature: true,
                    },
                },
            },
        });

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Subscription plan not found',
            });
        }

        return res.json({
            success: true,
            data: plan,
        });
    } catch (error) {
        console.error('Get plan error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription plan',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Create Stripe checkout session for a subscription
 * @route POST /api/subscriptions/organizations/:organizationId/checkout
 * @access Private
 */
export const createCheckout = async (req: Request, res: Response) => {
    try {
        const planId = Number(req.body.planId);
        const organizationId = Number(req.params.organizationId);

        // Validate required fields
        if (!planId) {
            return res.status(400).json({
                success: false,
                message: 'Plan ID is required',
            });
        }

        // Get organization
        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        if (!organization.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Organization is not active',
            });
        }

        if (!organization.email) {
            return res.status(400).json({
                success: false,
                message: 'Organization email is required for payments. Please update your organization profile.',
            });
        }

        // Get and validate plan
        const plan = await prisma.subscriptionPlan.findUnique({
            where: { id: planId },
        });

        if (!plan || !plan.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Subscription plan not found or inactive',
            });
        }

        // Check if organization already has an active subscription
        const existingSubscription = await prisma.subscription.findFirst({
            where: {
                organizationId,
                status: 'ACTIVE',
            },
            include: {
                plan: true,
            },
        });

        if (existingSubscription) {
            return res.status(400).json({
                success: false,
                message: 'Organization already has an active subscription',
                data: {
                    currentPlan: existingSubscription.plan.name,
                    subscriptionId: existingSubscription.id,
                },
            });
        }

        // Create Stripe checkout session
        const successUrl = `${config.primaryFrontendUrl}/subscription/success`;
        const cancelUrl = `${config.primaryFrontendUrl}/subscription/cancel`;

        let priceInRwf = plan.price;
        if (plan.currency.toUpperCase() === 'USD') {
            priceInRwf = await convertUsdToRwf(plan.price);
        }

        const session = await createCheckoutSession({
            organizationId: organization.id,
            planId,
            successUrl,
            cancelUrl,
            amount: priceInRwf,
            currency: 'rwf',
        });

        return res.json({
            success: true,
            message: 'Checkout session created successfully',
            data: {
                sessionId: session.id,
                url: session.url,
            },
        });
    } catch (error) {
        console.error('Checkout creation error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to create checkout session',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Verify payment after successful checkout
 * @route GET /api/subscriptions/organizations/:organizationId/verify
 * @access Private
 */
export const verifyPayment = async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.query;
        const organizationId = Number(req.params.organizationId);

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required',
            });
        }

        // Verify the session with Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId as string, {
            expand: ['payment_intent', 'subscription'],
        });

        // If payment is not completed, return error
        if (session.payment_status !== 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Payment not completed',
            });
        }

        // Find the subscription by session ID
        const subscription = await prisma.subscription.findFirst({
            where: {
                paymentId: sessionId as string,
                organizationId,
            },
            include: {
                plan: true,
            },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found for this session',
            });
        }

        // If subscription is already active, return success
        if (subscription.status === 'ACTIVE') {
            return res.json({
                success: true,
                message: 'Payment already verified',
                data: subscription,
            });
        }

        // Calculate dates based on billing cycle
        const startDate = new Date();
        let endDate: Date | null = null;

        if (subscription.plan.billingCycle === 'MONTHLY') {
            endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 1);
        } else if (subscription.plan.billingCycle === 'YEARLY') {
            endDate = new Date(startDate);
            endDate.setFullYear(endDate.getFullYear() + 1);
        }

        // Update subscription and create payment record in a transaction
        const [updatedSubscription] = await prisma.$transaction([
            prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    status: 'ACTIVE',
                    startDate,
                    endDate,
                    paymentDetails: {
                        stripeSessionId: session.id,
                        stripeSubscriptionId: (session.subscription as Stripe.Subscription)?.id,
                        stripeCustomerId: session.customer as string,
                    },
                },
                include: {
                    plan: {
                        include: {
                            features: {
                                include: {
                                    feature: true,
                                },
                            },
                        },
                    },
                },
            }),
            prisma.payment.create({
                data: {
                    subscriptionId: subscription.id,
                    amount: session.amount_total! / 100,
                    currency: session.currency!.toUpperCase(),
                    paymentMethod: 'STRIPE',
                    paymentId: session.payment_intent?.toString() || session.id,
                    status: 'COMPLETED',
                    receiptUrl: (session as any).payment_intent?.charges?.data?.[0]?.receipt_url,
                    processedAt: new Date(),
                    metadata: {
                        stripeSessionId: session.id,
                        stripePaymentIntentId: session.payment_intent?.toString(),
                    },
                },
            }),
        ]);

        // Best-effort RRA EBM fiscalization of the subscription receipt.
        if (isEbmEnabled()) {
            try {
                const payment = await prisma.payment.findFirst({
                    where: { subscriptionId: subscription.id, paymentId: session.payment_intent?.toString() || session.id },
                    orderBy: { createdAt: 'desc' },
                });
                if (payment) {
                    await fiscalizeSubscriptionPayment({
                        paymentId: payment.id,
                        organizationId,
                    });
                }
            } catch (err) {
                console.error('Failed to fiscalize subscription payment:', err);
            }
        }

        return res.json({
            success: true,
            message: 'Payment verified and subscription activated',
            data: updatedSubscription,
        });
    } catch (error) {
        console.error('Payment verification error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to verify payment',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get all subscriptions for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/subscriptions
 * @access Private
 */
export const getUserSubscriptions = async (req: Request, res: Response) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const { status, page = '1', limit = '10' } = req.query;

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        // Build where clause
        const whereClause: any = { organizationId };
        if (status && typeof status === 'string') {
            whereClause.status = status;
        }

        // Pagination
        const skip = (Number(page) - 1) * Number(limit);

        // Get subscriptions and total count
        const [subscriptions, total] = await Promise.all([
            prisma.subscription.findMany({
                where: whereClause,
                include: {
                    plan: {
                        include: {
                            features: {
                                include: {
                                    feature: true,
                                },
                            },
                        },
                    },
                    payments: {
                        orderBy: { createdAt: 'desc' },
                        take: 5,
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            }),
            prisma.subscription.count({ where: whereClause }),
        ]);

        return res.json({
            success: true,
            data: {
                subscriptions,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            },
        });
    } catch (error) {
        console.error('Get subscriptions error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscriptions',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get current active subscription for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/current
 * @access Private
 */
export const getCurrentSubscription = async (req: Request, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        const subscription = await prisma.subscription.findFirst({
            where: {
                organizationId,
                status: 'ACTIVE',
            },
            include: {
                plan: {
                    include: {
                        features: {
                            include: {
                                feature: true,
                            },
                        },
                    },
                },
                payments: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
            },
            orderBy: { startDate: 'desc' },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'No active subscription found',
            });
        }

        return res.json({
            success: true,
            data: subscription,
        });
    } catch (error) {
        console.error('Get current subscription error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch current subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get subscription by ID
 * @route GET /api/subscriptions/organizations/:organizationId/subscriptions/:id
 * @access Private
 */
export const getSubscriptionById = async (req: Request, res: Response) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        const subscription = await getSubscription(Number(id));

        if (!subscription || subscription.organizationId !== organizationId) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found',
            });
        }

        return res.json({
            success: true,
            data: subscription,
        });
    } catch (error) {
        console.error('Get subscription error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Cancel subscription
 * @route POST /api/subscriptions/organizations/:organizationId/subscriptions/:id/cancel
 * @access Private
 */
export const cancelSubscription = async (req: Request, res: Response) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        const subscription = await prisma.subscription.findFirst({
            where: {
                id: Number(id),
                organizationId: Number(organizationId),
            },
            include: {
                plan: true,
            },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found',
            });
        }

        if (subscription.status === 'CANCELLED' || subscription.status === 'CANCELED') {
            return res.status(400).json({
                success: false,
                message: 'Subscription is already cancelled',
            });
        }

        // We allow cancelling (stopping auto-renew) for Active and Trialing
        if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel subscription with status: ${subscription.status}`,
            });
        }

        await stripeCancelSubscription(Number(id));

        const updatedSubscription = await prisma.subscription.findUnique({ where: { id: Number(id) } });

        return res.json({
            success: true,
            message: 'Subscription auto-renewal disabled. Access will continue until the end of the billing period.',
            data: updatedSubscription,
        });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to cancel subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Reactivate subscription
 * @route POST /api/subscriptions/organizations/:organizationId/subscriptions/:id/reactivate
 * @access Private
 */
export const reactivateSubscription = async (req: Request, res: Response) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        const subscription = await prisma.subscription.findFirst({
            where: {
                id,
                organizationId,
            },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found',
            });
        }

        // Can only reactivate if it hasn't expired yet
        if (subscription.endDate && new Date(subscription.endDate) < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Subscription has already expired. Please create a new subscription.',
            });
        }

        await import('../services/stripe.service').then(s => s.reactivateSubscription(id));

        const updatedSubscription = await prisma.subscription.findUnique({ where: { id: Number(id) } });

        return res.json({
            success: true,
            message: 'Subscription reactivated successfully',
            data: updatedSubscription,
        });
    } catch (error) {
        console.error('Reactivate subscription error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to reactivate subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Renew subscription
 * @route POST /api/subscriptions/organizations/:organizationId/subscriptions/:id/renew
 * @access Private
 */
export const renewSubscription = async (req: Request, res: Response) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);

        const subscription = await prisma.subscription.findFirst({
            where: {
                id: Number(id),
                organizationId: Number(organizationId),
            },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found',
            });
        }

        // Trigger renewal in Stripe service
        const newSubscription = await import('../services/stripe.service').then(s => s.renewSubscription(id));

        return res.json({
            success: true,
            message: 'Subscription renewed successfully',
            data: newSubscription,
        });
    } catch (error) {
        console.error('Renew subscription error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to renew subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Update subscription auto-renewal setting
 * @route PATCH /api/subscriptions/organizations/:organizationId/subscriptions/:id/auto-renew
 * @access Private
 */
export const updateAutoRenew = async (req: Request, res: Response) => {
    try {
        const { id, organizationId } = req.params;
        const { autoRenew } = req.body;

        if (typeof autoRenew !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'autoRenew must be a boolean value',
            });
        }

        const subscription = await prisma.subscription.findFirst({
            where: {
                id: Number(id),
                organizationId: Number(organizationId),
            },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found',
            });
        }

        if (subscription.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: 'Can only update auto-renewal for active subscriptions',
            });
        }

        const updated = await prisma.subscription.update({
            where: { id: Number(id) },
            data: { autoRenew },
            include: {
                plan: true,
            },
        });

        return res.json({
            success: true,
            message: `Auto-renewal ${autoRenew ? 'enabled' : 'disabled'} successfully`,
            data: updated,
        });
    } catch (error) {
        console.error('Update auto-renew error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to update auto-renewal setting',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get subscription statistics for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/stats
 * @access Private
 */
export const getSubscriptionStats = async (req: Request, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        const [
            activeCount,
            totalSubscriptions,
            totalSpent,
            subscriptionsByStatus,
            recentPayments,
            currentSubscription,
        ] = await Promise.all([
            // Active subscriptions count
            prisma.subscription.count({
                where: {
                    organizationId,
                    status: 'ACTIVE',
                },
            }),
            // Total subscriptions count
            prisma.subscription.count({
                where: { organizationId },
            }),
            // Total amount spent
            prisma.payment.aggregate({
                where: {
                    subscription: {
                        organizationId,
                    },
                    status: 'COMPLETED',
                },
                _sum: { amount: true },
            }),
            // Subscriptions grouped by status
            prisma.subscription.groupBy({
                by: ['status'],
                where: { organizationId },
                _count: true,
            }),
            // Recent payments
            prisma.payment.findMany({
                where: {
                    subscription: {
                        organizationId,
                    },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
                include: {
                    subscription: {
                        include: {
                            plan: true,
                        },
                    },
                },
            }),
            // Current active subscription
            prisma.subscription.findFirst({
                where: {
                    organizationId,
                    status: 'ACTIVE',
                },
                include: {
                    plan: {
                        include: {
                            features: {
                                include: {
                                    feature: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { startDate: 'desc' },
            }),
        ]);

        return res.json({
            success: true,
            data: {
                summary: {
                    activeSubscriptions: activeCount,
                    totalSubscriptions,
                    totalSpent: totalSpent._sum.amount || 0,
                    currency: currentSubscription?.plan.currency || 'USD',
                },
                subscriptionsByStatus: subscriptionsByStatus.map((item: any) => ({
                    status: item.status,
                    count: item._count,
                })),
                currentSubscription,
                recentPayments,
            },
        });
    } catch (error) {
        console.error('Get stats error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription statistics',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get payment history for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/payments
 * @access Private
 */
export const getPaymentHistory = async (req: Request, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { page = '1', limit = '20', status } = req.query;

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }

        const skip = (Number(page) - 1) * Number(limit);

        // Build where clause
        const whereClause: any = {
            subscription: {
                organizationId,
            },
        };

        if (status && typeof status === 'string') {
            whereClause.status = status;
        }

        const [payments, total, totalAmount] = await Promise.all([
            prisma.payment.findMany({
                where: whereClause,
                include: {
                    subscription: {
                        include: {
                            organization: {
                                select: {
                                    id: true,
                                    name: true,
                                    TIN: true,
                                    address: true,
                                },
                            },
                            plan: {
                                select: {
                                    id: true,
                                    name: true,
                                    price: true,
                                    currency: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            }),
            prisma.payment.count({ where: whereClause }),
            prisma.payment.aggregate({
                where: whereClause,
                _sum: { amount: true },
            }),
        ]);

        return res.json({
            success: true,
            data: {
                payments,
                summary: {
                    totalAmount: totalAmount._sum.amount || 0,
                    totalPayments: total,
                },
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            },
        });
    } catch (error) {
        console.error('Get payment history error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch payment history',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Check if organization has access to a specific feature
 * @route GET /api/subscriptions/organizations/:organizationId/features/:featureKey
 * @access Private
 */
export const checkFeatureAccess = async (req: Request, res: Response) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const featureKey = req.params.featureKey;

        const subscription: any = await (prisma.subscription as any).findFirst({
            where: {
                organizationId: Number(organizationId),
                status: 'ACTIVE',
            },
            include: {
                plan: {
                    include: {
                        features: {
                            where: {
                                isEnabled: true,
                                feature: {
                                    key: featureKey,
                                },
                            },
                            include: {
                                feature: true,
                            },
                        },
                    },
                },
            },
        });

        const hasAccess = subscription && subscription.plan && subscription.plan.features && subscription.plan.features.length > 0;

        return res.json({
            success: true,
            data: {
                hasAccess,
                feature: hasAccess ? subscription.plan.features[0].feature : null,
                limitValue: hasAccess ? subscription.plan.features[0].limitValue : null,
            },
        });
    } catch (error) {
        console.error('Check feature access error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check feature access',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

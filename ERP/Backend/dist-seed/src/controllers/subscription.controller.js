"use strict";
// src/controllers/subscription.controller.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFeatureAccess = exports.getPaymentHistory = exports.getSubscriptionStats = exports.updateAutoRenew = exports.renewSubscription = exports.reactivateSubscription = exports.cancelSubscription = exports.getSubscriptionById = exports.getCurrentSubscription = exports.getUserSubscriptions = exports.verifyPayment = exports.createCheckout = exports.getPlanById = exports.getPlans = void 0;
const prisma_1 = require("../lib/prisma");
const stripe_service_1 = require("../services/stripe.service");
const stripe_1 = require("../lib/stripe");
const currencyConverter_1 = require("../utils/currencyConverter");
const config_1 = require("../config");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const billing_ebm_service_1 = require("../services/billing-ebm.service");
/**
 * Get all active subscription plans with features
 * @route GET /api/subscriptions/plans
 * @access Public
 */
const getPlans = async (req, res) => {
    try {
        const plans = await prisma_1.prisma.subscriptionPlan.findMany({
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
    }
    catch (error) {
        console.error('Get plans error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription plans',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getPlans = getPlans;
/**
 * Get a specific plan by ID
 * @route GET /api/subscriptions/plans/:id
 * @access Public
 */
const getPlanById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const plan = await prisma_1.prisma.subscriptionPlan.findUnique({
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
    }
    catch (error) {
        console.error('Get plan error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription plan',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getPlanById = getPlanById;
/**
 * Create Stripe checkout session for a subscription
 * @route POST /api/subscriptions/organizations/:organizationId/checkout
 * @access Private
 */
const createCheckout = async (req, res) => {
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
        const organization = await prisma_1.prisma.organization.findUnique({
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
        const plan = await prisma_1.prisma.subscriptionPlan.findUnique({
            where: { id: planId },
        });
        if (!plan || !plan.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Subscription plan not found or inactive',
            });
        }
        // Check if organization already has an active subscription
        const existingSubscription = await prisma_1.prisma.subscription.findFirst({
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
        const successUrl = `${config_1.config.primaryFrontendUrl}/subscription/success`;
        const cancelUrl = `${config_1.config.primaryFrontendUrl}/subscription/cancel`;
        let priceInRwf = plan.price;
        if (plan.currency.toUpperCase() === 'USD') {
            priceInRwf = await (0, currencyConverter_1.convertUsdToRwf)(plan.price);
        }
        const session = await (0, stripe_service_1.createCheckoutSession)({
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
    }
    catch (error) {
        console.error('Checkout creation error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to create checkout session',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.createCheckout = createCheckout;
/**
 * Verify payment after successful checkout
 * @route GET /api/subscriptions/organizations/:organizationId/verify
 * @access Private
 */
const verifyPayment = async (req, res) => {
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
        const session = await stripe_1.stripe.checkout.sessions.retrieve(sessionId, {
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
        const subscription = await prisma_1.prisma.subscription.findFirst({
            where: {
                paymentId: sessionId,
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
        let endDate = null;
        if (subscription.plan.billingCycle === 'MONTHLY') {
            endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 1);
        }
        else if (subscription.plan.billingCycle === 'YEARLY') {
            endDate = new Date(startDate);
            endDate.setFullYear(endDate.getFullYear() + 1);
        }
        // Update subscription and create payment record in a transaction
        const [updatedSubscription] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    status: 'ACTIVE',
                    startDate,
                    endDate,
                    paymentDetails: {
                        stripeSessionId: session.id,
                        stripeSubscriptionId: session.subscription?.id,
                        stripeCustomerId: session.customer,
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
            prisma_1.prisma.payment.create({
                data: {
                    subscriptionId: subscription.id,
                    amount: session.amount_total / 100,
                    currency: session.currency.toUpperCase(),
                    paymentMethod: 'STRIPE',
                    paymentId: session.payment_intent?.toString() || session.id,
                    status: 'COMPLETED',
                    receiptUrl: session.payment_intent?.charges?.data?.[0]?.receipt_url,
                    processedAt: new Date(),
                    metadata: {
                        stripeSessionId: session.id,
                        stripePaymentIntentId: session.payment_intent?.toString(),
                    },
                },
            }),
        ]);
        // Best-effort RRA EBM fiscalization of the subscription receipt.
        if ((0, rra_ebm_service_1.isEbmEnabled)()) {
            try {
                const payment = await prisma_1.prisma.payment.findFirst({
                    where: { subscriptionId: subscription.id, paymentId: session.payment_intent?.toString() || session.id },
                    orderBy: { createdAt: 'desc' },
                });
                if (payment) {
                    await (0, billing_ebm_service_1.fiscalizeSubscriptionPayment)({
                        paymentId: payment.id,
                        organizationId,
                    });
                }
            }
            catch (err) {
                console.error('Failed to fiscalize subscription payment:', err);
            }
        }
        return res.json({
            success: true,
            message: 'Payment verified and subscription activated',
            data: updatedSubscription,
        });
    }
    catch (error) {
        console.error('Payment verification error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to verify payment',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.verifyPayment = verifyPayment;
/**
 * Get all subscriptions for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/subscriptions
 * @access Private
 */
const getUserSubscriptions = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const { status, page = '1', limit = '10' } = req.query;
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }
        // Build where clause
        const whereClause = { organizationId };
        if (status && typeof status === 'string') {
            whereClause.status = status;
        }
        // Pagination
        const skip = (Number(page) - 1) * Number(limit);
        // Get subscriptions and total count
        const [subscriptions, total] = await Promise.all([
            prisma_1.prisma.subscription.findMany({
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
            prisma_1.prisma.subscription.count({ where: whereClause }),
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
    }
    catch (error) {
        console.error('Get subscriptions error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscriptions',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getUserSubscriptions = getUserSubscriptions;
/**
 * Get current active subscription for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/current
 * @access Private
 */
const getCurrentSubscription = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }
        const subscription = await prisma_1.prisma.subscription.findFirst({
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
    }
    catch (error) {
        console.error('Get current subscription error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch current subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getCurrentSubscription = getCurrentSubscription;
/**
 * Get subscription by ID
 * @route GET /api/subscriptions/organizations/:organizationId/subscriptions/:id
 * @access Private
 */
const getSubscriptionById = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }
        const subscription = await (0, stripe_service_1.getSubscription)(Number(id));
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
    }
    catch (error) {
        console.error('Get subscription error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getSubscriptionById = getSubscriptionById;
/**
 * Cancel subscription
 * @route POST /api/subscriptions/organizations/:organizationId/subscriptions/:id/cancel
 * @access Private
 */
const cancelSubscription = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }
        const subscription = await prisma_1.prisma.subscription.findFirst({
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
        await (0, stripe_service_1.cancelSubscription)(Number(id));
        const updatedSubscription = await prisma_1.prisma.subscription.findUnique({ where: { id: Number(id) } });
        return res.json({
            success: true,
            message: 'Subscription auto-renewal disabled. Access will continue until the end of the billing period.',
            data: updatedSubscription,
        });
    }
    catch (error) {
        console.error('Cancel subscription error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to cancel subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.cancelSubscription = cancelSubscription;
/**
 * Reactivate subscription
 * @route POST /api/subscriptions/organizations/:organizationId/subscriptions/:id/reactivate
 * @access Private
 */
const reactivateSubscription = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }
        const subscription = await prisma_1.prisma.subscription.findFirst({
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
        await Promise.resolve().then(() => __importStar(require('../services/stripe.service'))).then(s => s.reactivateSubscription(id));
        const updatedSubscription = await prisma_1.prisma.subscription.findUnique({ where: { id: Number(id) } });
        return res.json({
            success: true,
            message: 'Subscription reactivated successfully',
            data: updatedSubscription,
        });
    }
    catch (error) {
        console.error('Reactivate subscription error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to reactivate subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.reactivateSubscription = reactivateSubscription;
/**
 * Renew subscription
 * @route POST /api/subscriptions/organizations/:organizationId/subscriptions/:id/renew
 * @access Private
 */
const renewSubscription = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const id = Number(req.params.id);
        const subscription = await prisma_1.prisma.subscription.findFirst({
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
        const newSubscription = await Promise.resolve().then(() => __importStar(require('../services/stripe.service'))).then(s => s.renewSubscription(id));
        return res.json({
            success: true,
            message: 'Subscription renewed successfully',
            data: newSubscription,
        });
    }
    catch (error) {
        console.error('Renew subscription error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to renew subscription',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.renewSubscription = renewSubscription;
/**
 * Update subscription auto-renewal setting
 * @route PATCH /api/subscriptions/organizations/:organizationId/subscriptions/:id/auto-renew
 * @access Private
 */
const updateAutoRenew = async (req, res) => {
    try {
        const { id, organizationId } = req.params;
        const { autoRenew } = req.body;
        if (typeof autoRenew !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'autoRenew must be a boolean value',
            });
        }
        const subscription = await prisma_1.prisma.subscription.findFirst({
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
        const updated = await prisma_1.prisma.subscription.update({
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
    }
    catch (error) {
        console.error('Update auto-renew error:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to update auto-renewal setting',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.updateAutoRenew = updateAutoRenew;
/**
 * Get subscription statistics for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/stats
 * @access Private
 */
const getSubscriptionStats = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const organization = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found',
            });
        }
        const [activeCount, totalSubscriptions, totalSpent, subscriptionsByStatus, recentPayments, currentSubscription,] = await Promise.all([
            // Active subscriptions count
            prisma_1.prisma.subscription.count({
                where: {
                    organizationId,
                    status: 'ACTIVE',
                },
            }),
            // Total subscriptions count
            prisma_1.prisma.subscription.count({
                where: { organizationId },
            }),
            // Total amount spent
            prisma_1.prisma.payment.aggregate({
                where: {
                    subscription: {
                        organizationId,
                    },
                    status: 'COMPLETED',
                },
                _sum: { amount: true },
            }),
            // Subscriptions grouped by status
            prisma_1.prisma.subscription.groupBy({
                by: ['status'],
                where: { organizationId },
                _count: true,
            }),
            // Recent payments
            prisma_1.prisma.payment.findMany({
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
            prisma_1.prisma.subscription.findFirst({
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
                subscriptionsByStatus: subscriptionsByStatus.map((item) => ({
                    status: item.status,
                    count: item._count,
                })),
                currentSubscription,
                recentPayments,
            },
        });
    }
    catch (error) {
        console.error('Get stats error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription statistics',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getSubscriptionStats = getSubscriptionStats;
/**
 * Get payment history for an organization
 * @route GET /api/subscriptions/organizations/:organizationId/payments
 * @access Private
 */
const getPaymentHistory = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { page = '1', limit = '20', status } = req.query;
        const organization = await prisma_1.prisma.organization.findUnique({
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
        const whereClause = {
            subscription: {
                organizationId,
            },
        };
        if (status && typeof status === 'string') {
            whereClause.status = status;
        }
        const [payments, total, totalAmount] = await Promise.all([
            prisma_1.prisma.payment.findMany({
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
            prisma_1.prisma.payment.count({ where: whereClause }),
            prisma_1.prisma.payment.aggregate({
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
    }
    catch (error) {
        console.error('Get payment history error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch payment history',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.getPaymentHistory = getPaymentHistory;
/**
 * Check if organization has access to a specific feature
 * @route GET /api/subscriptions/organizations/:organizationId/features/:featureKey
 * @access Private
 */
const checkFeatureAccess = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const featureKey = req.params.featureKey;
        const subscription = await prisma_1.prisma.subscription.findFirst({
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
    }
    catch (error) {
        console.error('Check feature access error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check feature access',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.checkFeatureAccess = checkFeatureAccess;

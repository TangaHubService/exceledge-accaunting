import { PrismaClient, PaymentStatus, PaymentMethodType, SubscriptionStatus, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { emailService } from './email.service';
import { config } from '../config';
import { isEbmEnabled } from './rra-ebm.service';
import { fiscalizeSubscriptionPayment } from './billing-ebm.service';

export type BillingMode = 'MONTHLY' | 'YEARLY';

export type SubscriptionWarningLevel = 'none' | 'yellow' | 'orange' | 'red' | 'expired';

export interface SubscriptionSummary {
    hasActiveSubscription: boolean;
    subscriptionStatus: SubscriptionStatus | null;
    subscriptionEndDate: Date | null;
    daysUntilExpiry: number | null;
    hoursUntilExpiry: number | null;
    graceDaysRemaining: number | null;
    graceDayLabel: string | null;
    warningLevel: SubscriptionWarningLevel;
    warningMessage: string | null;
}

interface PaypackPaymentResponse {
    transactionId: string;
    reference: string;
    status: string;
    message?: string;
    data?: {
        reference: string;
        status: string;
        amount: number;
        phone: string;
        transaction_id: string;
    };
}

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
    include: {
        plan: true;
        payments: true;
        organization: {
            include: {
                userOrganizations: {
                    include: {
                        user: true,
                    },
                },
            },
        }
    };
}>;

export class SubscriptionService {
    private prisma: PrismaClient;
    private stripe: Stripe;

    /**
     * Verifies a Stripe webhook event using the provided payload, signature, and secret
     */
    public verifyWebhookEvent(payload: any, signature: string, secret: string) {
        return this.stripe.webhooks.constructEvent(payload, signature, secret);
    }

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
            apiVersion: '2025-11-17.clover',
        });
    }

    /**
     * Server-authoritative total for a purchase/renewal. MONTHLY is a flat
     * monthlyPrice * months; YEARLY only accepts whole years (months must be a
     * multiple of 12) and applies the configured discount per year.
     */
    calculateTotal(params: { monthlyPrice: number; months: number; billingMode: BillingMode }): number {
        const { monthlyPrice, months, billingMode } = params;

        if (!Number.isInteger(months) || months < 1) {
            throw new Error('Months must be a whole number greater than or equal to 1');
        }

        if (billingMode === 'YEARLY') {
            if (months % 12 !== 0) {
                throw new Error('Yearly billing requires months to be a whole number of years (a multiple of 12)');
            }
            const years = months / 12;
            const discount = config.subscription.yearlyDiscountPercent / 100;
            const pricePerYear = monthlyPrice * 12 * (1 - discount);
            return Math.round(pricePerYear * years * 100) / 100;
        }

        if (billingMode !== 'MONTHLY') {
            throw new Error('billingMode must be MONTHLY or YEARLY');
        }

        return Math.round(monthlyPrice * months * 100) / 100;
    }

    /**
     * Renewal-vs-fresh rule: if the current subscription's endDate is still in
     * the future, extend from that endDate (startDate is unchanged). Otherwise
     * (already past endDate, whether EXPIRED or mid grace period) the new term
     * starts from now. This single rule reproduces both worked examples in the
     * spec without needing a separate branch for "in grace period".
     */
    resolveValidityWindow(params: {
        existingSubscription?: { startDate: Date | null; endDate: Date | null } | null;
        months: number;
        gracePeriodDays: number;
        now?: Date;
    }): { startDate: Date; endDate: Date; gracePeriodEndsAt: Date } {
        const now = params.now ?? new Date();
        const existing = params.existingSubscription;
        const stillActive = !!existing?.endDate && existing.endDate.getTime() > now.getTime();

        const startDate = stillActive && existing?.startDate ? existing.startDate : now;
        const baseDate = stillActive && existing?.endDate ? existing.endDate : now;

        const endDate = new Date(baseDate);
        endDate.setMonth(endDate.getMonth() + params.months);

        const gracePeriodEndsAt = new Date(endDate);
        gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + params.gracePeriodDays);

        return { startDate, endDate, gracePeriodEndsAt };
    }

    /**
     * Validates the purchase request, computes the server-side total, and
     * records the pending purchase intent on the subscription row so the
     * payment-gateway completion handler (finalizeSubscriptionPurchase) can
     * apply it once payment is confirmed. Never trusts a client-supplied total.
     */
    async preparePurchase(params: {
        organizationId: number;
        planId: number;
        months: number;
        billingMode: BillingMode;
        userId?: number;
    }) {
        const { organizationId, planId, months, billingMode, userId } = params;

        const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
        if (!plan || !plan.isActive) {
            throw new Error('Subscription plan not found or inactive');
        }

        const totalAmount = this.calculateTotal({ monthlyPrice: plan.price, months, billingMode });
        const gracePeriodDays = config.subscription.gracePeriodDays;
        const ref = `SUB-${Date.now()}`;
        const pendingIntent = {
            ref,
            months,
            billingMode,
            monthlyPriceAtPurchase: plan.price,
            totalAmount,
            status: 'PENDING',
        };

        // The row we mutate in place for this org+plan lineage (existing pattern
        // used by pesapalOrderRequest/initiatePaypackPayment) — reused rather than
        // creating a new row per purchase/renewal.
        const existingForPlan = await this.prisma.subscription.findFirst({
            where: {
                organizationId,
                planId,
                status: { notIn: ['CANCELLED', 'CANCELED'] },
            },
            orderBy: { createdAt: 'desc' },
        });

        let subscription;
        if (existingForPlan) {
            subscription = await this.prisma.subscription.update({
                where: { id: existingForPlan.id },
                data: {
                    monthsPurchased: months,
                    billingMode,
                    monthlyPrice: plan.price,
                    totalAmount,
                    gracePeriodDays,
                    createdById: existingForPlan.createdById ?? userId,
                    paymentDetails: {
                        ...(existingForPlan.paymentDetails as Record<string, unknown> | null),
                        ...pendingIntent,
                    },
                },
            });
        } else {
            // Only when a genuinely new row is created do we record renewal lineage,
            // pointing at the organization's immediately-prior subscription (if any).
            const latestForOrg = await this.prisma.subscription.findFirst({
                where: { organizationId },
                orderBy: { createdAt: 'desc' },
            });

            subscription = await this.prisma.subscription.create({
                data: {
                    organizationId,
                    planId,
                    status: 'PENDING',
                    monthsPurchased: months,
                    billingMode,
                    monthlyPrice: plan.price,
                    totalAmount,
                    gracePeriodDays,
                    createdById: userId,
                    renewedFromSubscriptionId: latestForOrg?.id,
                    paymentDetails: pendingIntent,
                },
            });
        }

        return { subscription, totalAmount, monthlyPrice: plan.price, ref };
    }

    /**
     * Single completion path shared by every payment rail's webhook/IPN
     * handler. Idempotent on paymentId — safe to call more than once for the
     * same transaction (Pesapal in particular can fire both an IPN and a
     * browser callback for the same payment).
     */
    async finalizeSubscriptionPurchase(params: {
        subscriptionId: number;
        paymentId: string;
        amount: number;
        currency: string;
        paymentMethod: PaymentMethodType;
        metadata?: Prisma.InputJsonValue;
        processedAt?: Date;
    }) {
        const { subscriptionId, paymentId, amount, currency, paymentMethod, metadata, processedAt } = params;

        const existingPayment = await this.prisma.payment.findFirst({ where: { paymentId } });
        if (existingPayment) {
            return null;
        }

        const subscription = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
        if (!subscription) {
            throw new Error('Subscription not found');
        }

        const pendingIntent = (subscription.paymentDetails as Record<string, any> | null) || {};
        const months = pendingIntent.months ?? subscription.monthsPurchased ?? 1;
        const billingMode = (pendingIntent.billingMode ?? subscription.billingMode) as BillingMode;
        const monthlyPrice = pendingIntent.monthlyPriceAtPurchase ?? subscription.monthlyPrice ?? 0;
        const totalAmount = pendingIntent.totalAmount ?? amount;
        const resolvedProcessedAt = processedAt ?? new Date();

        const { startDate, endDate, gracePeriodEndsAt } = this.resolveValidityWindow({
            existingSubscription: { startDate: subscription.startDate, endDate: subscription.endDate },
            months,
            gracePeriodDays: subscription.gracePeriodDays || config.subscription.gracePeriodDays,
            now: resolvedProcessedAt,
        });

        const updatedSubscription = await this.prisma.subscription.update({
            where: { id: subscriptionId },
            data: {
                status: 'ACTIVE',
                startDate,
                endDate,
                gracePeriodEndsAt,
                paymentMethod,
                monthsPurchased: months,
                billingMode,
                monthlyPrice,
                totalAmount,
                paymentDetails: {
                    ...pendingIntent,
                    status: 'COMPLETED',
                    processedAt: resolvedProcessedAt.toISOString(),
                },
            },
            include: {
                plan: true,
                payments: true,
                organization: {
                    include: {
                        userOrganizations: { include: { user: true } },
                    },
                },
            },
        });

        await this.prisma.organization.update({
            where: { id: subscription.organizationId },
            data: { isActive: true },
        });

        const payment = await this.prisma.payment.create({
            data: {
                subscriptionId,
                amount,
                currency,
                paymentMethod,
                paymentId,
                status: 'COMPLETED',
                processedAt: resolvedProcessedAt,
                metadata,
            },
        });

        const owner = updatedSubscription.organization.userOrganizations.find((uo) => uo.isOwner)?.user
            ?? updatedSubscription.organization.userOrganizations[0]?.user;
        if (owner) {
            try {
                await emailService.sendPaymentConfirmation(
                    owner.email,
                    updatedSubscription.organization.name,
                    amount,
                    billingMode === 'YEARLY' ? 'year' : 'month'
                );
            } catch (err) {
                console.error('Failed to send payment confirmation email:', err);
            }
        }

        // Best-effort RRA EBM fiscalization of the subscription receipt. Never
        // blocks payment completion: failures are recorded on the Payment row.
        if (isEbmEnabled()) {
            try {
                await fiscalizeSubscriptionPayment({
                    paymentId: payment.id,
                    organizationId: subscription.organizationId,
                });
            } catch (err) {
                console.error(`Failed to fiscalize subscription payment ${payment.id}:`, err);
            }
        }

        return { ...updatedSubscription, payments: [payment, ...updatedSubscription.payments] };
    }

    /**
     * Single source of truth for "does this org currently have access" plus the
     * human-facing warning copy from spec section 11. Replaces the
     * hasActiveSubscription/subscriptionStatus/subscriptionEndDate computation
     * that used to be duplicated across auth.controller.ts and organization.controller.ts.
     */
    computeSubscriptionSummary(
        subscription: { status: SubscriptionStatus; endDate: Date | null; gracePeriodEndsAt: Date | null; gracePeriodDays?: number | null } | null | undefined,
        now: Date = new Date()
    ): SubscriptionSummary {
        if (!subscription) {
            return {
                hasActiveSubscription: false,
                subscriptionStatus: null,
                subscriptionEndDate: null,
                daysUntilExpiry: null,
                hoursUntilExpiry: null,
                graceDaysRemaining: null,
                graceDayLabel: null,
                warningLevel: 'none',
                warningMessage: null,
            };
        }

        const msPerDay = 1000 * 60 * 60 * 24;
        const msPerHour = 1000 * 60 * 60;
        const diffMs = subscription.endDate ? subscription.endDate.getTime() - now.getTime() : 0;
        const daysUntilExpiry = subscription.endDate
            ? Math.ceil(diffMs / msPerDay)
            : null;
        const hoursUntilExpiry = subscription.endDate
            ? Math.max(0, Math.floor(diffMs / msPerHour))
            : null;

        const isGrace = subscription.status === 'GRACE_PERIOD';
        const isActive = subscription.status === 'ACTIVE' || subscription.status === 'TRIALING';
        const isExpired = subscription.status === 'EXPIRED';

        let graceDaysRemaining: number | null = null;
        let graceDayLabel: string | null = null;
        if (isGrace && subscription.gracePeriodEndsAt) {
            graceDaysRemaining = Math.max(0, Math.ceil((subscription.gracePeriodEndsAt.getTime() - now.getTime()) / msPerDay));
            const totalGraceDays = subscription.gracePeriodDays || config.subscription.gracePeriodDays;
            const dayNumber = Math.min(totalGraceDays, Math.max(1, totalGraceDays - graceDaysRemaining + 1));
            graceDayLabel = `Grace Day ${dayNumber} of ${totalGraceDays}`;
        }

        let warningLevel: SubscriptionWarningLevel = 'none';
        let warningMessage: string | null = null;

        if (isExpired) {
            warningLevel = 'expired';
            warningMessage = 'Your subscription has expired. Please renew your subscription to continue using the system.';
        } else if (isGrace || (isActive && daysUntilExpiry !== null && daysUntilExpiry <= 0)) {
            warningLevel = 'red';
            const daysAgo = daysUntilExpiry !== null ? Math.abs(daysUntilExpiry) : 0;
            const expiryPhrase = daysAgo === 0 ? 'expired today' : daysAgo === 1 ? 'expired yesterday' : `expired ${daysAgo} days ago`;
            if (isGrace && graceDaysRemaining !== null) {
                warningMessage = `Your subscription ${expiryPhrase}. You have ${graceDaysRemaining} grace day${graceDaysRemaining === 1 ? '' : 's'} remaining.`;
            } else {
                warningMessage = `Your subscription ${expiryPhrase}.`;
            }
        } else if (isActive && daysUntilExpiry !== null) {
            if (daysUntilExpiry <= 3) {
                warningLevel = 'orange';
                warningMessage = `Your subscription expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} (${hoursUntilExpiry} hours).`;
            } else if (daysUntilExpiry <= 7) {
                warningLevel = 'yellow';
                warningMessage = `Your subscription expires in ${daysUntilExpiry} days.`;
            }
        }

        return {
            hasActiveSubscription: isActive || isGrace,
            subscriptionStatus: subscription.status,
            subscriptionEndDate: subscription.endDate,
            daysUntilExpiry,
            hoursUntilExpiry,
            graceDaysRemaining,
            graceDayLabel,
            warningLevel,
            warningMessage,
        };
    }

    // Get all available subscription plans with features
    async getPlans() {
        return this.prisma.subscriptionPlan.findMany({
            where: {
                isActive: true,
                price: {
                    not: 100
                }
            },
            include: {
                features: {
                    include: {
                        feature: true,
                    },
                },
            },
        });
    }

    // Get organization's current subscription
    async getOrganizationSubscription(organizationId: number) {
        return this.prisma.subscription.findFirst({
            where: {
                organizationId,
                status: {
                    in: ['ACTIVE', 'TRIALING', 'GRACE_PERIOD']
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
                payments: {
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: 1,
                },
            },
        });
    }

    // Check if organization has access to a specific feature
    async hasFeatureAccess(organizationId: number, featureKey: string): Promise<boolean> {
        const subscription = await this.prisma.subscription.findFirst({
            where: {
                organizationId,
                status: {
                    in: ['ACTIVE', 'TRIALING', 'GRACE_PERIOD']
                },
                plan: {
                    features: {
                        some: {
                            isEnabled: true,
                            feature: {
                                key: featureKey,
                            },
                        },
                    },
                },
            },
        });

        return !!subscription;
    }


    async createTrial(organizationId: number, planId: number): Promise<SubscriptionWithPlan> {
        const existingSubscription = await this.prisma.subscription.findFirst({
            where: {
                organizationId,
                status: {
                    in: ['ACTIVE', 'TRIALING']
                }
            }
        });

        if (existingSubscription) {
            throw new Error('Organization already has an active or trial subscription');
        }

        const plan = await this.prisma.subscriptionPlan.findUnique({
            where: {
                id: planId,
                price: {
                    not: 100
                }
            },
            include: {
                features: {
                    include: {
                        feature: true
                    }
                }
            }
        });

        if (!plan) {
            throw new Error('Plan not found');
        }

        // Calculate trial end date: exactly 7 days from now, UTC-based for consistency
        const now = new Date();
        const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
        const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

        const organization = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            include: {
                userOrganizations: {
                    include: {
                        user: true
                    }
                }
            }
        });

        if (!organization) {
            throw new Error('Organization not found');
        }

        const [subscription] = await this.prisma.$transaction([
            this.prisma.subscription.create({
                data: {
                    organizationId,
                    planId,
                    status: 'TRIALING',
                    startDate,
                    endDate,
                    paymentMethod: 'TRIAL',
                    autoRenew: false,
                    payments: {
                        create: {
                            amount: 0,
                            currency: 'USD',
                            paymentMethod: 'TRIAL',
                            status: 'COMPLETED',
                            metadata: { type: 'TRIAL' }
                        }
                    }
                },
                include: {
                    plan: true,
                    payments: true
                }
            })
        ]);

        const fullSubscription = await this.prisma.subscription.findUnique({
            where: { id: subscription.id },
            include: {
                plan: true,
                payments: true,
                organization: {
                    include: {
                        userOrganizations: {
                            include: {
                                user: true
                            }
                        }
                    }
                }
            }
        });

        if (!fullSubscription) {
            throw new Error('Failed to create trial subscription');
        }

        const owner = organization.userOrganizations.find((uo: any) => uo.isOwner)?.user;
        if (owner) {
            await this.sendTrialExpiryNotification(
                owner.email,
                endDate,
                fullSubscription as unknown as SubscriptionWithPlan
            );
        }

        return fullSubscription as unknown as SubscriptionWithPlan;
    }

    async checkExpiringTrials() {
        const twoDaysFromNow = new Date();
        twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

        const expiringTrials = await this.prisma.subscription.findMany({
            where: {
                endDate: {
                    lte: twoDaysFromNow
                },
                status: "TRIALING",
            },
            include: {
                plan: true,
                payments: true,
                organization: {
                    include: {
                        userOrganizations: {
                            include: {
                                user: true
                            }
                        }
                    }
                }
            }
        });

        for (const subscription of expiringTrials) {
            await this.sendTrialExpiryNotification(
                subscription.organization.userOrganizations.find((uo) => uo.isOwner)?.user.email!,
                subscription.endDate!,
                subscription
            );
        }
    }

    private async sendNotification(type: 'email' | 'in-app', email: string, title: string, message: string, subscription: SubscriptionWithPlan) {
        if (type === 'email') {
            await emailService.sendTrialExpiryEmail(email, title, message, subscription.organization.name, subscription.endDate!);
        } else if (type === 'in-app') {
            await this.prisma.notification.create({
                data: {
                    organizationId: subscription?.organizationId,
                    title,
                    message,
                    type: 'INFO',
                    data: { expiryDate: subscription.endDate },
                    recipientId: subscription?.organization.userOrganizations.find((uo: any) => uo.isOwner)?.userId
                }
            });
        }
    }

    private async sendTrialExpiryNotification(email: string, expiryDate: Date, subscription: SubscriptionWithPlan) {
        const title = 'Your trial period is coming to an end';
        const organizationName = subscription.organization.name;
        const message = `We hope you've enjoyed your experience with ${organizationName}. Your trial is set to expire soon, and we'd love to help you continue growing your business with our full features.`;

        await this.sendNotification('email', email, title, message, subscription);
        await this.sendNotification('in-app', email, title, `Your trial will expire on ${expiryDate.toLocaleDateString()}.`, subscription);
    }

    // Create a new subscription with Stripe
    async createStripeSubscription(params: {
        organizationId: number;
        planId: number;
        customerEmail: string;
    }) {
        const { organizationId, planId, customerEmail } = params;

        // Get the plan
        const plan = await this.prisma.subscriptionPlan.findUnique({
            where: { id: planId },
        });

        if (!plan) {
            throw new Error('Plan not found');
        }

        // Check if organization already has an active subscription
        const existingSubscription = await this.prisma.subscription.findFirst({
            where: {
                organizationId,
                status: 'ACTIVE',
                endDate: {
                    gt: new Date(),
                },
            },
        });

        if (existingSubscription) {
            throw new Error('Organization already has an active subscription');
        }

        // Create or retrieve Stripe customer
        let customer: Stripe.Customer;
        const existingCustomers = await this.stripe.customers.list({
            email: customerEmail,
        });

        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
        } else {
            customer = await this.stripe.customers.create({
                email: customerEmail,
            });
        }

        // Check if Stripe price ID exists for the plan
        if (!plan.stripePriceId) {
            throw new Error('Stripe price ID is not configured for the selected plan');
        }

        // Create Stripe subscription
        const subscription = await this.stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: plan.stripePriceId }],
            expand: ['latest_invoice.payment_intent'],
        });

        const latestInvoice = subscription.latest_invoice as Stripe.Invoice & {
            payment_intent: Stripe.PaymentIntent | string | null;
        };
        const paymentIntent = typeof latestInvoice.payment_intent === 'string'
            ? null
            : latestInvoice.payment_intent;

        // Create subscription in database
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + (plan.billingCycle === 'YEARLY' ? 12 : plan.billingCycle === 'QUARTERLY' ? 3 : 1));

        const dbSubscription = await this.prisma.subscription.create({
            data: {
                organizationId,
                planId: plan.id,
                status: paymentIntent && paymentIntent.status === 'succeeded' ? 'ACTIVE' : 'PENDING',
                startDate: new Date(),
                endDate,
                paymentMethod: 'STRIPE',
                paymentId: subscription.id,
                payments: {
                    create: {
                        amount: plan.price,
                        currency: plan.currency,
                        paymentMethod: 'STRIPE',
                        paymentId: paymentIntent?.id,
                        status: this.mapStripeStatusToPaymentStatus(paymentIntent?.status || 'unknown'),
                        metadata: {
                            stripeSubscriptionId: subscription.id,
                            stripeCustomerId: customer.id,
                            stripePaymentIntentId: paymentIntent?.id,
                        },
                    },
                },
            },
            include: {
                plan: true,
                payments: true,
            },
        });

        return {
            subscription: dbSubscription,
            clientSecret: paymentIntent?.client_secret,
            requiresAction: paymentIntent?.status === 'requires_action',
        };
    }

    // Handle Stripe webhook events
    async handleStripeWebhook(event: Stripe.Event) {
        switch (event.type) {
            case 'payment_intent.succeeded':
                return this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
            case 'payment_intent.payment_failed':
                return this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
            case 'invoice.payment_succeeded':
                return this.handleInvoicePaid(event.data.object as Stripe.Invoice);
            case 'customer.subscription.updated':
                return this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
    }

    // Handle Paypack payment
    async createPaypackPayment(params: {
        organizationId: number;
        planId: number;
        phoneNumber: string;
    }) {
        const { organizationId, planId, phoneNumber } = params;

        // Get the plan
        const plan = await this.prisma.subscriptionPlan.findUnique({
            where: { id: planId },
        });

        if (!plan) {
            throw new Error('Plan not found');
        }

        // Create a pending subscription
        const subscription = await this.prisma.subscription.create({
            data: {
                organizationId,
                planId: plan.id,
                status: 'PENDING',
                paymentMethod: 'PAYPACK',
                startDate: new Date(),
                endDate: new Date(), // Will be updated when payment is confirmed
            },
        });

        // Create a payment record with a unique payment ID
        const paymentId = `pay_${Date.now()}`;
        const payment = await this.prisma.payment.create({
            data: {
                subscriptionId: subscription.id,
                amount: plan.price,
                status: 'PENDING',
                paymentMethod: 'PAYPACK',
                currency: 'RWF',
                paymentId: paymentId,
                metadata: {
                    reference: `PAY-${Date.now()}`,
                    paymentDate: new Date().toISOString()
                },
            },
        });

        // Integrate with Paypack API to initiate the payment
        const paymentResponse = await this.initiatePaypackPayment({
            amount: plan.price,
            phoneNumber,
            reference: paymentId,
            description: `Subscription for ${plan.name}`,
        });

        // Create payment record
        await this.prisma.payment.create({
            data: {
                subscriptionId: subscription.id,
                amount: plan.price,
                currency: plan.currency,
                paymentMethod: 'PAYPACK',
                paymentId: paymentResponse.transactionId,
                status: 'PENDING',
                metadata: {
                    paypackReference: paymentResponse.reference,
                    phoneNumber,
                },
            },
        });

        return {
            subscriptionId: subscription.id,
            paymentId: paymentResponse.transactionId,
            status: paymentResponse.status || 'PENDING',
            ...Object.fromEntries(
                Object.entries(paymentResponse).filter(([key]) => key !== 'status')
            )
        };
    }

    // Helper methods
    private async initiatePaypackPayment(params: {
        amount: number;
        phoneNumber: string;
        reference: string;
        description: string;
    }): Promise<PaypackPaymentResponse> {
        // This is a placeholder for the actual Paypack API integration
        // You'll need to implement this based on Paypack's API documentation
        try {
            const response = await fetch('https://api.paypack.rw/api/payments/collect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PAYPACK_API_KEY}`,
                },
                body: JSON.stringify({
                    amount: params.amount * 100, // Convert to smallest currency unit
                    phone: params.phoneNumber,
                    reference: params.reference,
                    description: params.description,
                }),
            });

            const data = await response.json() as PaypackPaymentResponse;

            if (!response.ok) {
                throw new Error(data.message || 'Failed to initiate Paypack payment');
            }

            // Map the response to our expected format
            const responseData: PaypackPaymentResponse = {
                transactionId: data.data?.transaction_id || data.reference,
                reference: data.reference,
                status: data.status || 'PENDING',
                message: data.message,
                data: data.data
            };

            return responseData;
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Paypack API error: ${error.message}`);
            }
            throw new Error('Unknown error occurred while processing Paypack payment');
        }
    }

    private mapStripeStatusToPaymentStatus(status: string): PaymentStatus {
        switch (status) {
            case 'succeeded':
                return 'COMPLETED';
            case 'processing':
                return 'PENDING';
            case 'requires_payment_method':
            case 'requires_confirmation':
            case 'requires_action':
            case 'canceled':
            default:
                return 'FAILED';
        }
    }

    private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
        // Update payment status in database
        await this.prisma.payment.updateMany({
            where: { paymentId: paymentIntent.id },
            data: {
                status: 'COMPLETED',
                processedAt: new Date(),
                metadata: {
                    ...paymentIntent.metadata,
                    stripePaymentIntentId: paymentIntent.id,
                },
            },
        });
    }

    private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
        await this.prisma.payment.updateMany({
            where: { paymentId: paymentIntent.id },
            data: {
                status: 'FAILED',
                processedAt: new Date(),
                metadata: {
                    ...paymentIntent.metadata,
                    error: paymentIntent.last_payment_error?.message,
                },
            },
        });
    }

    private async handleInvoicePaid(invoice: Stripe.Invoice) {
        // Access the subscription ID from the invoice
        const subscriptionId = (invoice as any).subscription;

        if (!subscriptionId) {
            console.error('No subscription ID found on invoice');
            return;
        }

        // Update subscription end date
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

        if (!('current_period_start' in subscription) || !('current_period_end' in subscription)) {
            throw new Error('Subscription period information is missing');
        }

        await this.prisma.subscription.updateMany({
            where: { paymentId: subscriptionId },
            data: {
                status: 'ACTIVE',
                startDate: new Date((subscription.current_period_start as number) * 1000),
                endDate: new Date((subscription.current_period_end as number) * 1000),
            },
        });
    }

    private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
        if (subscription.status === 'canceled') {
            await this.prisma.subscription.updateMany({
                where: { paymentId: subscription.id },
                data: {
                    status: 'CANCELED',
                    autoRenew: false,
                },
            });
        } else if (subscription.status === 'active') {
            const currentPeriodStart = (subscription as any).current_period_start;
            const currentPeriodEnd = (subscription as any).current_period_end;

            if (!currentPeriodStart || !currentPeriodEnd) {
                throw new Error('Subscription period information is missing');
            }

            await this.prisma.subscription.updateMany({
                where: { paymentId: subscription.id },
                data: {
                    status: 'ACTIVE',
                    startDate: new Date(currentPeriodStart * 1000),
                    endDate: new Date(currentPeriodEnd * 1000),
                    autoRenew: true,
                },
            });
        }
    }
}
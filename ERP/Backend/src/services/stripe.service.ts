// src/services/stripe.service.ts

import Stripe from 'stripe';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key', {
    apiVersion: '2025-11-17.clover',
});

/**
 * Get or create Stripe customer for an organization
 */
export const getOrCreateCustomer = async (
    organizationId: string | number,
    email: string,
    name?: string
): Promise<string> => {
    const organization = await prisma.organization.findUnique({
        where: { id: Number(organizationId) }
    });

    if (organization?.stripeCustomerId) {
        // Update customer email if it has changed
        try {
            const customer = await stripe.customers.retrieve(organization.stripeCustomerId) as Stripe.Customer;
            if (customer.email !== email) {
                await stripe.customers.update(organization.stripeCustomerId, {
                    email,
                    name: name || customer.name || undefined,
                    preferred_locales: ['en'], // Set preferred language for receipts
                });
            }
            return organization.stripeCustomerId;
        } catch (error) {
            console.error('Error updating customer:', error);
            // Continue to create new customer if update fails
        }
    }

    // Create new customer
    const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        metadata: { organizationId: String(organizationId) },
        preferred_locales: ['en'], // Set preferred language for receipts
    });

    await prisma.organization.update({
        where: { id: Number(organizationId) },
        data: {
            stripeCustomerId: customer.id,
            email, // Ensure email is up to date in our database
        },
    });

    return customer.id;
};

/**
 * Create or get Stripe product and price for a subscription plan
 */
export const createProductAndPrice = async (
    plan: SubscriptionPlan,
    convertedAmount?: number,
    convertedCurrency?: string
): Promise<{ productId: string; priceId: string }> => {
    // If already exists, return existing IDs
    if (plan.stripePriceId) {
        const price = await stripe.prices.retrieve(plan.stripePriceId);
        return {
            productId: price.product as string,
            priceId: plan.stripePriceId,
        };
    }

    // Create product
    const product = await stripe.products.create({
        name: plan.name,
        description: plan.description || undefined,
        metadata: {
            planId: plan.id,
            maxUsers: plan.maxUsers.toString(),
        },
    });

    // Create price based on billing cycle
    const priceData: Stripe.PriceCreateParams = {
        product: product.id,
        unit_amount: Math.round((convertedAmount || plan.price) * 100), // Convert to cents
        currency: (convertedCurrency || plan.currency).toLowerCase(),
        metadata: {
            planId: plan.id,
        },
    };

    // Map billing cycle to Stripe interval
    const billingCycleToStripeInterval: Record<string, 'month' | 'year' | 'week' | 'day'> = {
        'MONTHLY': 'month',
        'YEARLY': 'year',
        'WEEKLY': 'week',
        'DAILY': 'day'
    };

    // Add recurring if not one-time payment
    if (plan.billingCycle !== 'ONE_TIME') {
        priceData.recurring = {
            interval: billingCycleToStripeInterval[plan.billingCycle] || 'month', // default to month if not found
        };
    }

    const price = await stripe.prices.create(priceData);

    // Update plan with Stripe IDs
    await prisma.subscriptionPlan.update({
        where: { id: plan.id },
        data: { stripePriceId: price.id },
    });

    return {
        productId: product.id,
        priceId: price.id,
    };
};

/**
 * Create Stripe checkout session
 */
export const createCheckoutSession = async (params: {
    organizationId: string | number;
    planId: string | number;
    successUrl: string;
    cancelUrl: string;
    amount?: number;
    currency?: string;
}): Promise<Stripe.Checkout.Session> => {
    const { organizationId, planId, successUrl, cancelUrl, amount, currency } = params;

    const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: Number(organizationId) }
    });

    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
        where: { id: Number(planId) }
    });

    // Ensure Stripe product and price exist
    let priceId = plan.stripePriceId;
    if (!priceId) {
        const { priceId: newPriceId } = await createProductAndPrice(plan, amount, currency);
        priceId = newPriceId;
    }

    // Get or create customer
    const customerId = await getOrCreateCustomer(
        organizationId,
        organization.email!,
        organization.name
    );

    // Ensure customer's email is up to date in Stripe
    try {
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        if (customer.email !== organization.email) {
            await stripe.customers.update(customerId, {
                email: organization.email!,
                name: organization.name || undefined
            });
        }
    } catch (error) {
        console.error('Error updating customer email in Stripe:', error);
        // Continue with checkout even if email update fails
    }

    // Create pending subscription record
    const subscription = await prisma.subscription.create({
        data: {
            organizationId: Number(organizationId),
            planId: Number(planId),
            status: 'PENDING',
            paymentMethod: 'STRIPE',
        },
    });

    if (!organization.email) {
        throw new Error('Organization email is required');
    }

    // Create checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: customerId,
        mode: plan.billingCycle === 'ONE_TIME' ? 'payment' : 'subscription',
        payment_method_types: ['card'],
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        metadata: {
            organizationId,
            planId,
            subscriptionId: subscription.id,
        },
        subscription_data: plan.billingCycle !== 'ONE_TIME' ? {
            metadata: {
                organizationId,
                planId,
                subscriptionId: subscription.id,
            },
        } : undefined,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Update subscription with payment ID
    await prisma.subscription.update({
        where: { id: Number(subscription.id) },
        data: { paymentId: session.id },
    });

    return session;
};

/**
 * Handle successful payment
 */
export const handleSuccessfulPayment = async (sessionId: string) => {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent', 'subscription'],
    });

    const subscriptionId = session.metadata?.subscriptionId;
    if (!subscriptionId) {
        throw new Error('Subscription ID not found in session metadata');
    }

    const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: Number(subscriptionId) },
        include: {
            plan: true,
            organization: true
        },
    });

    const organization = subscription.organization;

    const paymentIntent = session.payment_intent as Stripe.PaymentIntent;

    // Ensure receipt email is set on the payment intent
    if (organization?.email && !paymentIntent.receipt_email) {
        try {
            await stripe.paymentIntents.update(paymentIntent.id, {
                receipt_email: organization.email,
            });
        } catch (error) {
            console.error('Error updating payment intent with receipt email:', error);
        }
    }

    // Calculate dates
    const startDate = new Date();
    let endDate: Date | undefined;

    if (subscription.plan.billingCycle === 'MONTHLY') {
        endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
    } else if (subscription.plan.billingCycle === 'YEARLY') {
        endDate = new Date(startDate);
        endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Create payment record and update subscription
    await prisma.$transaction([
        prisma.payment.create({
            data: {
                subscriptionId: subscription.id,
                amount: session.amount_total! / 100,
                currency: session.currency!.toUpperCase(),
                paymentMethod: 'STRIPE',
                paymentId: paymentIntent.id,
                status: 'COMPLETED',
                receiptUrl: (paymentIntent as any).charges?.data[0]?.receipt_url,
                processedAt: new Date(),
                metadata: {
                    stripeSessionId: session.id,
                    stripePaymentIntentId: paymentIntent.id,
                },
            },
        }),
        prisma.subscription.update({
            where: { id: Number(subscriptionId) },
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
        }),
    ]);

    return subscription;
};

/**
 * Handle subscription cancellation
 */
export const cancelSubscription = async (subscriptionId: string | number) => {
    const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: Number(subscriptionId) },
    });

    // Cancel in Stripe if it's a recurring subscription
    const paymentDetails = subscription.paymentDetails as any;
    if (paymentDetails?.stripeSubscriptionId) {
        try {
            await stripe.subscriptions.update(paymentDetails.stripeSubscriptionId, {
                cancel_at_period_end: true,
            });
        } catch (error) {
            console.error('Error updating Stripe subscription:', error);
            // Continue with local update even if Stripe fails
        }
    }

    // Update local subscription
    await prisma.subscription.update({
        where: { id: Number(subscriptionId) },
        data: {
            autoRenew: false,
            // We don't set status to CANCELLED yet, we let it run until end date
            // The webhook will handle the actual cancellation at period end
        },
    });
};

/**
 * Handle subscription reactivation (resume)
 */
export const reactivateSubscription = async (subscriptionId: string | number) => {
    const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: Number(subscriptionId) },
    });

    const paymentDetails = subscription.paymentDetails as any;

    // Only attempt to update Stripe if we have a Stripe Subscription ID
    if (paymentDetails?.stripeSubscriptionId) {
        try {
            await stripe.subscriptions.update(paymentDetails.stripeSubscriptionId, {
                cancel_at_period_end: false,
            });
        } catch (error) {
            console.error('Error reactivating Stripe subscription:', error);
            // We'll continue to update locally even if Stripe fails, 
            // but ideally we should alert the user if strict synchronization is required.
            // For now, assume optimistic local update is preferred.
        }
    } else {
        console.warn(`No Stripe subscription ID found for subscription ${subscriptionId}. Reactivating locally only.`);
    }

    // Update local subscription
    await prisma.subscription.update({
        where: { id: Number(subscriptionId) },
        data: {
            autoRenew: true,
            status: 'ACTIVE',
            cancelledAt: null,
        },
    });
};

/**
 * Renew an expired or canceled subscription
 * This creates a new subscription in Stripe using the customer's default payment method
 */
export const renewSubscription = async (subscriptionId: string | number) => {
    const subscription = await (prisma.subscription as any).findUniqueOrThrow({
        where: { id: Number(subscriptionId) },
        include: {
            plan: true,
            organization: true
        },
    });

    const { organization, plan } = subscription;
    const paymentDetails = subscription.paymentDetails as any;

    if (!organization.stripeCustomerId) {
        throw new Error('No Stripe customer found for this organization');
    }

    // Ensure Stripe product and price exist
    let priceId = plan.stripePriceId;
    if (!priceId) {
        const { priceId: newPriceId } = await createProductAndPrice(plan);
        priceId = newPriceId;
    }

    // Create new subscription in Stripe
    const stripeSubscription = await stripe.subscriptions.create({
        customer: organization.stripeCustomerId,
        items: [{ price: priceId }],
        expand: ['latest_invoice.payment_intent'],
        metadata: {
            organizationId: organization.id,
            planId: plan.id,
            renewingFrom: subscription.id
        }
    });

    // Update local subscription or create a new one?
    // The user probably wants the current one to show as renewed or a new record.
    // Usually, we create a new subscription record for the new period.
    const startDate = new Date();
    let endDate: Date | undefined;

    if (plan.billingCycle === 'MONTHLY') {
        endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
    } else if (plan.billingCycle === 'YEARLY') {
        endDate = new Date(startDate);
        endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const newSubscription = await prisma.subscription.create({
        data: {
            organizationId: organization.id,
            planId: plan.id,
            status: 'ACTIVE',
            startDate,
            endDate,
            paymentMethod: 'STRIPE',
            autoRenew: true,
            paymentDetails: {
                stripeSubscriptionId: stripeSubscription.id,
                stripeCustomerId: organization.stripeCustomerId,
            },
        },
    });

    return newSubscription;
};

/**
 * Handle webhook events from Stripe
 */
export const handleWebhook = async (event: Stripe.Event) => {
    console.log(`Processing webhook event: ${event.type}`);

    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
            break;

        case 'payment_intent.succeeded':
            await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
            break;

        case 'payment_intent.payment_failed':
            await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
            break;

        case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
            break;

        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
            break;

        case 'invoice.payment_succeeded':
            await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
            break;

        case 'invoice.payment_failed':
            await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
            break;

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }
};

/**
 * Handle checkout.session.completed webhook
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    try {
        await handleSuccessfulPayment(session.id);
        console.log(`Checkout completed for session: ${session.id}`);
    } catch (error) {
        console.error('Error handling checkout completion:', error);
        throw error;
    }
}

/**
 * Handle payment_intent.succeeded webhook
 */
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    console.log(`Payment succeeded: ${paymentIntent.id}`);

    // Find payment record and update if needed
    const payment = await prisma.payment.findFirst({
        where: { paymentId: paymentIntent.id },
    });

    if (payment && payment.status !== 'COMPLETED') {
        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: 'COMPLETED',
                processedAt: new Date(),
            },
        });
    }
}

/**
 * Handle payment_intent.payment_failed webhook
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    console.log(`Payment failed: ${paymentIntent.id}`);

    // Find and update payment record
    const payment = await prisma.payment.findFirst({
        where: { paymentId: paymentIntent.id },
    });

    if (payment) {
        await prisma.$transaction([
            prisma.payment.update({
                where: { id: payment.id },
                data: {
                    status: 'FAILED',
                    processedAt: new Date(),
                },
            }),
            prisma.subscription.update({
                where: { id: payment.subscriptionId },
                data: { status: 'UNPAID' },
            }),
        ]);
    }
}

// Extend the Stripe.Subscription type to include current_period_end
interface ExtendedSubscription extends Stripe.Subscription {
    current_period_end: number;
}

// Extend the Stripe.Invoice type to include subscription and payment_intent
interface ExtendedInvoice extends Stripe.Invoice {
    subscription: string | Stripe.Subscription;
    payment_intent?: string | Stripe.PaymentIntent;
}

/**
 * Handle customer.subscription.updated webhook
 */
async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
    const subscription = await prisma.subscription.findFirst({
        where: {
            paymentDetails: {
                path: ['stripeSubscriptionId'],
                equals: stripeSubscription.id,
            },
        },
    });

    if (subscription) {
        const status = mapStripeStatus(stripeSubscription.status);
        const extendedSubscription = stripeSubscription as unknown as ExtendedSubscription;

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                status,
                endDate: extendedSubscription.current_period_end
                    ? new Date(extendedSubscription.current_period_end * 1000)
                    : null,
            },
        });
    }
}

/**
 * Handle customer.subscription.deleted webhook
 */
async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
    const subscription = await prisma.subscription.findFirst({
        where: {
            paymentDetails: {
                path: ['stripeSubscriptionId'],
                equals: stripeSubscription.id,
            },
        },
    });

    if (subscription) {
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
            },
        });
    }
}

/**
 * Handle invoice.payment_succeeded webhook
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const extendedInvoice = invoice as unknown as ExtendedInvoice;
    if (!extendedInvoice.subscription) return;

    const subscription = await prisma.subscription.findFirst({
        where: {
            paymentDetails: {
                path: ['stripeSubscriptionId'],
                equals: typeof extendedInvoice.subscription === 'string'
                    ? extendedInvoice.subscription
                    : extendedInvoice.subscription.id,
            },
        },
    });

    if (subscription) {
        const paymentIntentId = typeof extendedInvoice.payment_intent === 'string'
            ? extendedInvoice.payment_intent
            : extendedInvoice.payment_intent?.id;

        await prisma.payment.create({
            data: {
                subscriptionId: subscription.id,
                amount: invoice.amount_paid / 100,
                currency: invoice.currency.toUpperCase(),
                paymentMethod: 'STRIPE',
                paymentId: paymentIntentId || `invoice_${invoice.id}`,
                status: 'COMPLETED',
                receiptUrl: invoice.hosted_invoice_url || null,
                processedAt: new Date(),
                metadata: {
                    stripeInvoiceId: invoice.id,
                },
            },
        });
    }
}

/**
 * Handle invoice.payment_failed webhook
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const extendedInvoice = invoice as unknown as ExtendedInvoice;
    if (!extendedInvoice.subscription) return;

    const subscription = await prisma.subscription.findFirst({
        where: {
            paymentDetails: {
                path: ['stripeSubscriptionId'],
                equals: typeof extendedInvoice.subscription === 'string'
                    ? extendedInvoice.subscription
                    : extendedInvoice.subscription.id,
            },
        },
    });

    if (subscription) {
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'PAST_DUE' },
        });
    }
}

/**
 * Map Stripe subscription status to our SubscriptionStatus enum
 */
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
    const statusMap: Record<string, SubscriptionStatus> = {
        active: 'ACTIVE',
        past_due: 'PENDING',
        unpaid: 'PENDING',
        canceled: 'CANCELED',
        incomplete: 'PENDING',
        incomplete_expired: 'CANCELED',
        trialing: 'ACTIVE',
    };

    return statusMap[stripeStatus] || 'PENDING';
}

/**
 * Get subscription with details
 */
export const getSubscription = async (subscriptionId: string | number) => {
    return prisma.subscription.findUnique({
        where: { id: Number(subscriptionId) },
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
            organization: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            payments: {
                orderBy: { createdAt: 'desc' },
                take: 10,
            },
        },
    });
};
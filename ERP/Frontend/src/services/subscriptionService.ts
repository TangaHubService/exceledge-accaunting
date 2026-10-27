import { apiClient } from "../lib/api-client";

export interface SubscriptionPlan {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    billingCycle: 'MONTHLY' | 'YEARLY' | 'WEEKLY' | 'DAILY' | 'ONE_TIME';
    maxUsers: number;
    features: Array<{
        name: string;
        description: string;
    }>;
    stripePriceId?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CheckoutSession {
    id: string;
    url: string;
}


export const subscriptionService = {
    // Get all available subscription plans
    getPlans: async (): Promise<{ data: SubscriptionPlan[] }> => {
        return apiClient.request('/subscriptions/plans', {
            method: 'GET',
        });
    },

    // Create a checkout session
    createCheckoutSession: async (
        organizationId: string,
        planId: string,
        successUrl: string,
        cancelUrl: string
    ): Promise<{ data: CheckoutSession }> => {
        return apiClient.request(`/subscriptions/organizations/${organizationId}/checkout`, {
            method: 'POST',
            body: JSON.stringify({ planId, successUrl, cancelUrl }),
        });
    },

    // Verify payment
    verifyPayment: async (organizationId: string, sessionId: string): Promise<{ success: boolean }> => {
        return apiClient.request(
            `/subscriptions/organizations/${organizationId}/verify?sessionId=${sessionId}`,
            { method: 'GET' }
        );
    },

    // Get organization's current subscription
    getCurrentSubscription: async (organizationId: string) => {
        return apiClient.request(
            `/subscriptions/organizations/${organizationId}/subscriptions`,
            { method: 'GET' }
        );
    },

    // Cancel subscription
    cancelSubscription: async (organizationId: string) => {
        return apiClient.request(
            `/subscriptions/organizations/${organizationId}/cancel`,
            { method: 'POST' }
        );
    },

    // Initiate mobile money payment via Paypack
    initiateMobilePayment: async (params: {
        organizationId: string;
        planId: string;
        phoneNumber: string;
        provider: 'MTN' | 'AIRTEL';
        months?: number;
        billingMode?: 'MONTHLY' | 'YEARLY';
    }) => {
        try {
            // Format phone number to remove any non-digit characters
            const formattedPhone = params.phoneNumber.replace(/\D/g, '');

            const response = await apiClient.request(
                `/subscriptions/organizations/${params.organizationId}/plans/${params.planId}/paypack/initiate`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        phoneNumber: formattedPhone,
                        months: params.months ?? 1,
                        billingMode: params.billingMode ?? 'MONTHLY',
                    }),
                }
            );

            return response;
        } catch (error: any) {
            // If the error is due to an existing subscription, rethrow it with a user-friendly message
            if (error.message && error.message.includes('already has an active subscription')) {
                throw new Error('You already have an active subscription to this plan. Please check your subscriptions or contact support.');
            }
            // For other errors, rethrow them as is
            throw error;
        }
    },

    // Initiate card payment
    initiateCardPayment: async (params: {
        organizationId: string;
        planId: string;
    }) => {
        try {
            const response = await apiClient.request(
                `/subscriptions/organizations/${params.organizationId}/plans/${params.planId}/stripe/checkout`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        successUrl: `${window.location.origin}/dashboard?payment=success`,
                        cancelUrl: `${window.location.origin}/subscription?cancelled=true`
                    }),
                }
            );

            return response;
        } catch (error: any) {
            // If the error is due to an existing subscription, rethrow it with a user-friendly message
            if (error.message && error.message.includes('already has an active subscription')) {
                throw new Error('You already have an active subscription to this plan. Please check your subscriptions or contact support.');
            }
            // For other errors, rethrow them as is
            throw error;
        }
    },
};

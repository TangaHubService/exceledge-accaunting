import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { subscriptionService } from '../services/subscriptionService';
import { useOrganization } from './OrganizationContext';

type SubscriptionContextType = {
    plans: any[];
    currentSubscription: any | null;
    isLoading: boolean;
    error: string | null;
    refreshSubscription: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
    const [plans, setPlans] = useState<any[]>([]);
    const [currentSubscription, setCurrentSubscription] = useState<any | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { organization } = useOrganization();
    const organizationId = organization?.id;

    const fetchSubscriptionData = async () => {
        setIsLoading(true);
        setError(null);

        try {
            // Always fetch plans (available to everyone)
            const plansResponse = await subscriptionService.getPlans();
            setPlans(plansResponse.data || []);

            // Fetch current subscription only if user is logged in with organization
            if (organizationId) {
                try {
                    const subResponse = await subscriptionService.getCurrentSubscription(String(organizationId));
                    setCurrentSubscription(subResponse.data || null);
                } catch (err) {
                    console.warn('No active subscription found');
                    setCurrentSubscription(null);
                }
            } else {
                setCurrentSubscription(null);
            }
        } catch (err) {
            console.error('Error fetching subscription data:', err);
            setError('Failed to load subscription data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSubscriptionData();
    }, [organizationId]);

    const value = {
        plans,
        currentSubscription,
        isLoading,
        error,
        refreshSubscription: fetchSubscriptionData,
    };

    return (
        <SubscriptionContext.Provider value={value}>
            {children}
        </SubscriptionContext.Provider>
    );
};

export const useSubscription = (): SubscriptionContextType => {
    const context = useContext(SubscriptionContext);
    if (context === undefined) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
};

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    XCircle,
    Loader2,
    CreditCard,
    RefreshCw,
    FileText,
    ShieldCheck,
    CalendarClock,
    ShoppingBag,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    AlertTriangle
} from 'lucide-react';
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from "../../components/ui/drawer";
import { apiClient } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import SubscriptionPage from '../SubscriptionPage';

interface Subscription {
    id: string;
    status: 'ACTIVE' | 'TRIALING' | 'GRACE_PERIOD' | 'PAST_DUE' | 'CANCELED' | 'CANCELLED' | 'UNPAID' | 'INCOMPLETE' | 'EXPIRED' | 'PENDING';
    startDate: string;
    endDate: string | null;
    gracePeriodEndsAt?: string | null;
    planId: string;
    plan: {
        id: string;
        name: string;
        description: string;
        price: number;
        currency: string;
        billingCycle: 'MONTHLY' | 'YEARLY';
        maxUsers: number;
        isActive: boolean;
        features: Array<{
            feature: {
                id: string;
                name: string;
                description: string;
                key: string;
            };
            isEnabled: boolean;
            limitValue: number | null;
        }>;
    };
    paymentMethod: string;
    autoRenew: boolean;
    createdAt: string;
    updatedAt: string;
    stripeCustomerId?: string;
}

const formatCurrency = (amount: number, currency: string = 'RWF'): string => {
    return new Intl.NumberFormat('en-RW', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
};

const formatDate = (dateString: string | null | undefined, locale: string = 'en-US'): string => {
    if (!dateString) return 'soon';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

// Colored Status Badges
const getStatusBadge = (status: string, t: any) => {
    const statusMap: Record<string, { text: string; color: string }> = {
        ACTIVE: { text: t('common.active'), color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
        TRIALING: { text: t('billing.trial'), color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
        GRACE_PERIOD: { text: t('billing.gracePeriod') || 'Grace Period', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
        PAST_DUE: { text: t('billing.pastDue'), color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
        CANCELED: { text: t('billing.canceled'), color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
        UNPAID: { text: t('billing.unpaid'), color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
        INCOMPLETE: { text: t('billing.incomplete'), color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
        EXPIRED: { text: t('billing.expired'), color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
        PENDING: { text: t('billing.pending'), color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
    };

    const info = statusMap[status] || { text: status, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' };
    return <span className={`px-2 py-1 text-xs rounded-full font-semibold ${info.color}`}>{info.text}</span>;
};

const SubscriptionManagementPage = () => {
    const { t, i18n } = useTranslation();
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [subscriptionToCancel, setSubscriptionToCancel] = useState<string | null>(null);
    const [renewTarget, setRenewTarget] = useState<{ planId: string; currentExpiryDate: string | null } | null>(null);

    useEffect(() => {
        const fetchSubscriptions = async () => {
            try {
                setIsLoading(true);
                const response = await apiClient.getOrganizationSubscriptions();
                const subs = Array.isArray(response.data.subscriptions)
                    ? response.data.subscriptions
                    : [response.data.subscriptions];
                setSubscriptions(subs);
            } catch (err) {
                console.error(err);
                setError(t('billing.fetchError') || 'Failed to load subscriptions. Please try again later.');
            } finally {
                setIsLoading(false);
            }
        };
        fetchSubscriptions();
    }, []);


    const confirmCancellation = async () => {
        if (!subscriptionToCancel || isUpdating) return;
        try {
            setIsUpdating(true);
            await apiClient.cancelSubscription(subscriptionToCancel);
            setSubscriptions(prev =>
                prev.map(sub =>
                    sub.id === subscriptionToCancel
                        ? { ...sub, autoRenew: false }
                        : sub
                )
            );
            setIsCancelModalOpen(false);
            setSubscriptionToCancel(null);
        } catch (err) {
            console.error(err);
            setError(t('billing.cancelError') || 'Failed to cancel subscription.');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleReactivateSubscription = async (subscriptionId: string) => {
        if (isUpdating) return;
        try {
            setIsUpdating(true);
            await apiClient.reactivateSubscription(subscriptionId);
            setSubscriptions(prev =>
                prev.map(sub =>
                    sub.id === subscriptionId
                        ? { ...sub, status: 'ACTIVE' as const, autoRenew: true }
                        : sub
                )
            );
        } catch (err) {
            console.error(err);
            setError(t('billing.reactivateError') || 'Failed to reactivate subscription.');
        } finally {
            setIsUpdating(false);
        }
    };

    // Renewal reuses the exact same duration-selection + payment flow as a new
    // purchase (rendered below via <SubscriptionPage preselectedPlanId .../>):
    // the backend already treats "buy more months for a plan you already have"
    // as a renewal-in-place, extending from the current endDate when it's
    // still in the future.
    const handleRenewSubscription = (subscription: Subscription) => {
        setRenewTarget({ planId: subscription.plan.id, currentExpiryDate: subscription.endDate });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-50 text-red-700 rounded-md mb-4 flex items-center">
                <XCircle className="mr-2 h-5 w-5" /> {error}
            </div>
        );
    }



    // Sort subscriptions: Active/Trialing first, then by creation date (newest first)
    const sortedSubscriptions = [...subscriptions].sort((a, b) => {
        const priorityStatus = ['ACTIVE', 'TRIALING'];
        const aPriority = priorityStatus.includes(a.status) ? 1 : 0;
        const bPriority = priorityStatus.includes(b.status) ? 1 : 0;

        if (aPriority !== bPriority) return bPriority - aPriority;

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const primarySubscription = sortedSubscriptions[0];
    const otherSubscriptions = sortedSubscriptions.slice(1);

    const renderSubscriptionCard = (subscription: Subscription) => {
        const isActive = subscription.status === 'ACTIVE' || subscription.status === 'TRIALING' || subscription.status === 'GRACE_PERIOD';
        const currentPlan = subscription.plan ? {
            id: subscription.plan.id,
            name: subscription.plan.name,
            description: subscription.plan.description,
            price: subscription.plan.price,
            currency: subscription.plan.currency,
            interval: subscription.plan.billingCycle === 'MONTHLY' ? 'month' : 'year',
            features: subscription.plan.features
                .filter(f => f.isEnabled)
                .map(f => f.feature.name)
        } : null;

        return (
            <Card key={subscription.id} className={`overflow-hidden border-2 transition-all duration-200 bg-white dark:bg-gray-800 ${isActive ? 'border-primary/20 shadow-md' : 'border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'}`}>
                <div className="p-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{currentPlan?.name || t('common.unknown')}</h3>
                                {getStatusBadge(subscription.status, t)}
                            </div>
                            <p className="text-muted-foreground">{currentPlan?.description}</p>
                        </div>
                        <div className="flex gap-3 w-full md:w-auto">
                            {!subscription.autoRenew && isActive ? (
                                <Button
                                    onClick={() => handleReactivateSubscription(subscription.id)}
                                    disabled={isUpdating}
                                    className="bg-green-600 hover:bg-green-700 flex-1 md:flex-none text-white shadow-sm"
                                >
                                    {isUpdating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : t('billing.reactivate')}
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => handleRenewSubscription(subscription)}
                                    disabled={isUpdating}
                                    className="bg-blue-600 hover:bg-blue-700 flex-1 md:flex-none text-white shadow-sm"
                                >
                                    {t('billing.renew')}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-gray-50/50 dark:bg-gray-700/30 rounded-xl border border-gray-100 dark:border-gray-600">
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                                <CreditCard className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-500 mb-1">{t('billing.pricingAndCycle')}</p>
                                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {currentPlan ? `${formatCurrency(currentPlan.price, currentPlan.currency)}/${currentPlan.interval === 'month' ? t('common.month') : t('common.year')}` : 'N/A'}
                                </p>
                                {subscription.autoRenew && isActive ? (
                                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                                        <CheckCircle2 className="h-3 w-3" /> {t('billing.autoRenewalOn')}
                                    </p>
                                ) : (
                                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                                        <CalendarClock className="h-3 w-3" /> {t('billing.autoRenewalOff')}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                                <CalendarClock className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-500 mb-1">
                                    {!isActive ? t('billing.endedOn') : t('billing.nextBillingDate')}
                                </p>
                                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {formatDate(subscription.endDate || undefined, i18n.language)}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {t('billing.usingPayment', { method: subscription.paymentMethod || t('common.default') })}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 mb-1">{t('billing.planFeatures')}</p>
                                <div className="flex flex-wrap gap-2">
                                    {currentPlan?.features.slice(0, 3).map((feature, i) => (
                                        <span key={i} className="inline-flex items-center px-2 py-1 rounded bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-xs font-medium text-gray-600 dark:text-gray-300">
                                            {feature}
                                        </span>
                                    ))}
                                    {(currentPlan?.features.length || 0) > 3 && (
                                        <span className="inline-flex items-center px-2 py-1 rounded bg-gray-100 dark:bg-gray-600 text-xs font-medium text-gray-500 dark:text-gray-400">
                                            {t('billing.more', { count: currentPlan!.features.length - 3 })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </Card>
        );
    };

    return (
        <div className="container mx-auto px-4 py-8 space-y-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
            <div>
                <h1 className="text-3xl font-bold mb-1 text-gray-900 dark:text-white">{t('billing.title')}</h1>
                <p className="text-muted-foreground">{t('billing.description')}</p>
            </div>

            {/* Current Subscriptions */}
            <div className="grid gap-6">
                {subscriptions.length > 0 ? (
                    <>
                        {/* Primary Subscription */}
                        {primarySubscription && renderSubscriptionCard(primarySubscription)}

                        {/* Other Subscriptions Toggle */}
                        {otherSubscriptions.length > 0 && (
                            <div className="flex justify-center">
                                <Button
                                    variant="ghost"
                                    onClick={() => setIsExpanded(!isExpanded)}
                                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                                >
                                    {isExpanded ? (
                                        <>
                                            {t('billing.hidePrevious')}
                                            <ChevronUp className="h-4 w-4" />
                                        </>
                                    ) : (
                                        <>
                                            {t('billing.showPrevious', { count: otherSubscriptions.length })}
                                            <ChevronDown className="h-4 w-4" />
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}

                        {/* Expanded List */}
                        {isExpanded && (
                            <div className="grid gap-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                {otherSubscriptions.map(sub => renderSubscriptionCard(sub))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-600">
                        <div className="bg-white dark:bg-gray-700 p-4 rounded-full inline-flex mb-4 shadow-sm">
                            <ShoppingBag className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">{t('billing.noActiveSubscriptions')}</h3>
                        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
                            {t('billing.choosePlanBelow')}
                        </p>
                    </div>
                )}
            </div>

            {/* Available Plans */}
            <div>
                <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">{t('billing.availablePlans')}</h2>

                <SubscriptionPage
                    preselectedPlanId={renewTarget?.planId ?? null}
                    renewalCurrentExpiryDate={renewTarget?.currentExpiryDate ?? null}
                />
            </div>

            {/* Billing History */}
            <div className="flex justify-end mt-6">
                <Button variant="outline" asChild>
                    <a href="/dashboard/history" className="flex items-center space-x-1">
                        <FileText className="h-4 w-4" />
                        <span>{t('billing.viewBillingHistory')}</span>
                    </a>
                </Button>
            </div>

            <Drawer open={isCancelModalOpen} onOpenChange={setIsCancelModalOpen}>
                <DrawerContent className="sm:max-w-md bg-white dark:bg-gray-800">
                    <DrawerHeader>
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-full bg-red-100 flex items-center justify-center">
                                <AlertTriangle className="h-6 w-6 text-red-600" />
                            </div>
                            <div>
                                <DrawerTitle className="text-xl text-red-600">{t('billing.confirmCancelTitle')}</DrawerTitle>
                                <DrawerDescription className="mt-2 text-gray-600">
                                    {t('billing.confirmCancelDesc')}
                                </DrawerDescription>
                            </div>
                        </div>
                    </DrawerHeader>

                    <div className="py-4">
                        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/50 rounded-lg text-sm text-red-800 dark:text-red-200">
                            <p className="font-medium flex items-center gap-2 mb-1">
                                <ShieldCheck className="h-4 w-4" />
                                {t('billing.premiumAccessWarning')}
                            </p>
                            <p>
                                {t('billing.premiumAccessWarningDesc')}
                            </p>
                        </div>
                        <p className="text-sm text-gray-500 mt-4 px-1">
                            {t('billing.undoneWarning')}
                        </p>
                    </div>

                    <DrawerFooter className="gap-2">
                        <Button variant="outline" onClick={() => setIsCancelModalOpen(false)} className="border-gray-300">
                            {t('billing.keepSubscription')}
                        </Button>
                        <Button variant="destructive" onClick={confirmCancellation} disabled={isUpdating} className="bg-red-600 hover:bg-red-700">
                            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : t('billing.cancelSolution')}
                        </Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
};

export default SubscriptionManagementPage;

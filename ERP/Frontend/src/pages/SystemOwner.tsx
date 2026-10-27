import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { systemOwnerService } from '../services/systemOwnerService';
import Overview from '../components/system-owner/Overview';
import Subscriptions from '../components/system-owner/Subscriptions';
import Payments from '../components/system-owner/Payments';
import Analytics from '../components/system-owner/Analytics';
import type { DashboardStats, Subscription, Payment } from '../services/systemOwnerService';

export const SystemOwnerDashboard: React.FC = () => {
    const location = useLocation();

    // Dashboard Stats
    const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [revenueData, setRevenueData] = useState<Array<{ period: string; total: number; count: number }>>([]);
    const [growthData, setGrowthData] = useState<Array<{ month: string; organizations: number; users: number }>>([]);

    // Loading and error states
    const [isLoading, setIsLoading] = useState({
        dashboard: false,
        subscriptions: false,
        payments: false,
        analytics: false,
    });

    const [error, setError] = useState({
        dashboard: '',
        subscriptions: '',
        payments: '',
        analytics: '',
    });


    // Fetch dashboard stats
    const fetchDashboardStats = async () => {
        setIsLoading(prev => ({ ...prev, dashboard: true }));
        try {
            const data = await systemOwnerService.getDashboardStats();
            setDashboardStats(data);
        } catch (err) {
            setError(prev => ({ ...prev, dashboard: 'Failed to load dashboard data' }));
            console.error('Error fetching dashboard stats:', err);
        } finally {
            setIsLoading(prev => ({ ...prev, dashboard: false }));
        }
    };

    // Fetch subscriptions
    const fetchSubscriptions = async () => {
        setIsLoading(prev => ({ ...prev, subscriptions: true }));
        try {
            const data = await systemOwnerService.getSubscriptions();
            setSubscriptions(data.subscriptions || []);
        } catch (err) {
            setError(prev => ({ ...prev, subscriptions: 'Failed to load subscriptions' }));
            console.error('Error fetching subscriptions:', err);
        } finally {
            setIsLoading(prev => ({ ...prev, subscriptions: false }));
        }
    };

    // Fetch payments
    const fetchPayments = async () => {
        setIsLoading(prev => ({ ...prev, payments: true }));
        try {
            const data = await systemOwnerService.getPayments();
            setPayments(data.payments || []);
        } catch (err) {
            setError(prev => ({ ...prev, payments: 'Failed to load payments' }));
            console.error('Error fetching payments:', err);
        } finally {
            setIsLoading(prev => ({ ...prev, payments: false }));
        }
    };

    // Extend subscription
    const handleExtendSubscription = async (id: number, data: { endDate?: string; monthsToAdd?: number }) => {
        try {
            await systemOwnerService.extendSubscription(id, data);
            // Refresh subscriptions after extension
            await fetchSubscriptions();
        } catch (err) {
            console.error('Error extending subscription:', err);
        }
    };

    // Update payment status
    const handleUpdatePaymentStatus = async (id: string | number, status: string) => {
        try {
            await systemOwnerService.updatePaymentStatus(id, status);
            // Refresh payments after status change
            await fetchPayments();
        } catch (err) {
            console.error('Error updating payment status:', err);
        }
    };

    // Resend invoice to subscriber email
    const handleResendInvoice = async (id: string | number) => {
        try {
            await systemOwnerService.resendInvoice(id);
        } catch (err) {
            console.error('Error resending invoice:', err);
            throw err;
        }
    };

    // Calculate analytics from existing data
    const calculateAnalytics = () => {
        // Calculate revenue by month from payments
        const revenueByMonth: { [key: string]: { total: number; count: number } } = {};
        payments.forEach(payment => {
            if (payment.status === 'COMPLETED') {
                const date = new Date(payment.createdAt);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!revenueByMonth[monthKey]) {
                    revenueByMonth[monthKey] = { total: 0, count: 0 };
                }
                revenueByMonth[monthKey].total += payment.amount;
                revenueByMonth[monthKey].count += 1;
            }
        });

        const calculatedRevenue = Object.entries(revenueByMonth)
            .map(([period, data]) => ({
                period,
                total: data.total,
                count: data.count
            }))
            .sort((a, b) => a.period.localeCompare(b.period));

        // Calculate growth by month from organizations
        const growthByMonth: { [key: string]: { organizations: number; users: number } } = {};
        if (dashboardStats?.recentOrganizations) {
            dashboardStats.recentOrganizations.forEach(org => {
                const date = new Date(org.createdAt);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!growthByMonth[monthKey]) {
                    growthByMonth[monthKey] = { organizations: 0, users: 0 };
                }
                growthByMonth[monthKey].organizations += 1;
                growthByMonth[monthKey].users += 1; // Assuming 1 user per org for now
            });
        }

        const calculatedGrowth = Object.entries(growthByMonth)
            .map(([month, data]) => ({
                month,
                organizations: data.organizations,
                users: data.users
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

        setRevenueData(calculatedRevenue);
        setGrowthData(calculatedGrowth);
    };


    // Calculate analytics when payments or organizations change
    useEffect(() => {
        if (payments.length > 0 || dashboardStats?.recentOrganizations) {
            calculateAnalytics();
        }
    }, [payments, dashboardStats]);

    // Load data based on current route
    useEffect(() => {
        const path = location.pathname;

        // Always load dashboard stats for overview
        fetchDashboardStats();

        // Load data based on current route
        if (path.includes('/subscriptions') && subscriptions.length === 0) {
            fetchSubscriptions();
        }
        if ((path.includes('/payments') || path.includes('/analytics')) && payments.length === 0) {
            fetchPayments();
        }
    }, [location.pathname]);

    // Prepare stats for Overview
    const stats = {
        totalOrganizations: dashboardStats?.stats.totalOrganizations || 0,
        activeSubscriptions: dashboardStats?.stats.activeSubscriptions || 0,
        totalRevenue: dashboardStats?.stats.totalRevenue || 0,
        pendingPayments: dashboardStats?.stats.pendingPayments || 0,
        totalUsers: dashboardStats?.stats.totalUsers || 0,
    };

    return (
        <Routes>
            <Route
                path="/overview"
                element={
                    <Overview
                        stats={stats}
                        recentOrganizations={dashboardStats?.recentOrganizations || []}
                        isLoading={isLoading.dashboard}
                        error={error.dashboard}
                    />
                }
            />
            <Route
                path="/subscriptions"
                element={
                    <Subscriptions
                        subscriptions={subscriptions}
                        isLoading={isLoading.subscriptions}
                        error={error.subscriptions}
                        onExtendSubscription={handleExtendSubscription}
                    />
                }
            />
            <Route
                path="/payments"
                element={
                    <Payments
                        payments={payments}
                        isLoading={isLoading.payments}
                        error={error.payments}
                        onUpdatePaymentStatus={handleUpdatePaymentStatus}
                        onResendInvoice={handleResendInvoice}
                    />
                }
            />
            <Route
                path="/analytics"
                element={
                    <Analytics
                        revenueData={revenueData}
                        growthData={growthData}
                        isLoading={isLoading.analytics}
                        error={error.analytics}
                    />
                }
            />
            <Route path="/" element={<Navigate to="overview" replace />} />
        </Routes>
    );
};


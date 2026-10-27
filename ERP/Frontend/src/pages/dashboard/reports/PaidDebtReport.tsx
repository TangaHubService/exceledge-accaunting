import { useState, useEffect } from 'react';
import { DollarSign, TrendingDown, Users, Calendar } from 'lucide-react';
import { TableSkeleton } from '../../../components/ui/TableSkeleton';
import { apiClient } from '../../../lib/api-client';
import { useTranslation } from 'react-i18next';

interface DebtPayment {
    id: string;
    customerName: string;
    customerPhone: string;
    amountPaid: number;
    paymentMethod: string;
    reference: string;
    paymentDate: string;
    recordedBy: string;
}

interface DebtSummary {
    totalPaid: number;
    paymentsCount: number;
    avgPayment: number;
    remainingDebt: number;
}

export const PaidDebtReport = () => {
    const { t } = useTranslation();
    const [payments, setPayments] = useState<DebtPayment[]>([]);
    const [summary, setSummary] = useState<DebtSummary>({
        totalPaid: 0,
        paymentsCount: 0,
        avgPayment: 0,
        remainingDebt: 0
    });
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState('2025-01-01');
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-RW', {
            style: 'currency',
            currency: 'RWF',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    useEffect(() => {
        fetchDebtPayments();
    }, [startDate, endDate]);

    const fetchDebtPayments = async () => {
        try {
            setLoading(true);
            const data = await apiClient.getDebtPaymentsReport(startDate, endDate);
            setPayments(data.payments || []);
            setSummary(data.summary || {
                totalPaid: 0,
                paymentsCount: 0,
                avgPayment: 0,
                remainingDebt: 0
            });
        } catch (error) {
            console.error('Error fetching debt payments:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 p-4 md:p-6">
            {/* Page Header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-lg">
                <div className="pointer-events-none absolute inset-0 bg-black/10" />
                <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                            <DollarSign className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">{t('debtReports.title') || 'Paid Debt Report'}</h1>
                            <p className="text-sm text-white/70 mt-0.5">{t('debtReports.description') || 'View history and metrics for collected debts'}</p>
                        </div>
                    </div>
                </div>
                <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
                <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
            </div>

            {/* Date Filters */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 dark:text-gray-400">
                        {t('debtReports.startDate') || 'Start Date'}
                    </label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 dark:text-gray-400">
                        {t('debtReports.endDate') || 'End Date'}
                    </label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    {
                        label: t('debtReports.totalPaid') || 'Total Paid',
                        value: formatCurrency(summary.totalPaid),
                        icon: DollarSign,
                        light: 'bg-emerald-50 dark:bg-emerald-900/20',
                        text: 'text-emerald-600 dark:text-emerald-400',
                    },
                    {
                        label: t('debtReports.payments') || 'Payments Count',
                        value: summary.paymentsCount,
                        icon: TrendingDown,
                        light: 'bg-blue-50 dark:bg-blue-900/20',
                        text: 'text-blue-600 dark:text-blue-400',
                    },
                    {
                        label: t('debtReports.avgPayment') || 'Avg Payment',
                        value: formatCurrency(summary.avgPayment),
                        icon: Users,
                        light: 'bg-purple-50 dark:bg-purple-900/20',
                        text: 'text-purple-600 dark:text-purple-400',
                    },
                    {
                        label: t('debtReports.remainingDebt') || 'Remaining Debt',
                        value: formatCurrency(summary.remainingDebt),
                        icon: Calendar,
                        light: 'bg-red-50 dark:bg-red-900/20',
                        text: 'text-red-600 dark:text-red-400',
                    },
                ].map(({ label, value, icon: Icon, light, text }) => (
                    <div
                        key={label}
                        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4"
                    >
                        <div className={`flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0 ${light}`}>
                            <Icon className={`h-5 w-5 ${text}`} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Payments Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                        {t('debtReports.paymentHistory') || 'Payment History'}
                    </h2>
                </div>

                {loading ? (
                    <div className="p-6">
                        <TableSkeleton rows={5} columns={6} />
                    </div>
                ) : payments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500 dark:text-gray-400">
                        <DollarSign className="h-12 w-12 text-gray-400 mb-2" />
                        <p className="text-base font-semibold">No debt payments found</p>
                        <p className="text-sm">Try adjusting your date filters.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-gray-50/50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-left">
                                    <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('debtReports.dateTime') || 'Date & Time'}</th>
                                    <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('common.customer') || 'Customer'}</th>
                                    <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('common.phone') || 'Phone'}</th>
                                    <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">{t('debtReports.amountPaid') || 'Amount Paid'}</th>
                                    <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('debtReports.paymentMethod') || 'Payment Method'}</th>
                                    <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('debtReports.recordedBy') || 'Recorded By'}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {payments.map((payment) => (
                                    <tr key={payment.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                                        <td className="py-3 px-4 text-gray-600 dark:text-gray-300 font-mono text-xs">
                                            {new Date(payment.paymentDate).toLocaleString('en-CA', {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                hour12: false
                                            })}
                                        </td>
                                        <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">{payment.customerName}</td>
                                        <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{payment.customerPhone}</td>
                                        <td className="py-3 px-4 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(payment.amountPaid)}
                                        </td>
                                        <td className="py-3 px-4 text-gray-600 dark:text-gray-300">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                                                {payment.paymentMethod}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{payment.recordedBy}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t bg-gray-50/50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
                                <tr className="font-semibold text-gray-900 dark:text-white">
                                    <td className="py-3 px-4" colSpan={3}>{t('debtReports.total') || 'Total'}</td>
                                    <td className="py-3 px-4 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                        {formatCurrency(payments.reduce((sum, p) => sum + p.amountPaid, 0))}
                                    </td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { apiClient } from '../../../lib/api-client';
import { PaymentModal } from '../../../components/dept/PaymentModal';
import { toast } from 'react-toastify';
import { Loader2, CreditCard, AlertCircle, Users, TrendingDown } from 'lucide-react';
import { PaymentHistory } from '../../../components/dept/PaymentHistory';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { useTranslation } from 'react-i18next';

export default function DebtManagement() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('outstanding');
    const [outstandingDebts, setOutstandingDebts] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSale, setSelectedSale] = useState<any>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
    const [filters, setFilters] = useState({
        paymentMethod: '',
        customerName: '',
        recordedByName: '',
        startDate: '',
        endDate: ''
    });
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);



    const fetchOutstandingDebts = async () => {
        try {
            setIsLoading(true);
            const response = await apiClient.getOutstandingDebts();
            setOutstandingDebts(response.data || []);
        } catch (error) {
            console.error('Error fetching outstanding debts:', error);
            toast.error(t('debtManagement.failedToLoadDebts'));
        } finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        fetchOutstandingDebts();
    }, []);

    const handlePaymentSuccess = () => {
        toast.success(t('debtManagement.paymentRecorded'));
        fetchOutstandingDebts();
    };
    const fetchPaymentHistory = async (filters = {}) => {
        try {
            setIsLoadingHistory(true);
            const response = await apiClient.getAllPaymentHistory(filters);
            setPaymentHistory(response.data || []);
        } catch (error) {
            console.error('Error fetching payment history:', error);
            toast.error(t('debtManagement.failedToLoadHistory'));
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Debounce filter changes to avoid too many API calls
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (activeTab === 'history') {
                // Convert empty strings to undefined to avoid sending empty filters
                const cleanedFilters = Object.fromEntries(
                    Object.entries(filters).map(([key, value]) => [key, value || undefined])
                );
                fetchPaymentHistory(cleanedFilters);
            }
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [filters, activeTab]);

    const handleFilterChange = (newFilters: any) => {
        setFilters(prev => ({
            ...prev,
            ...newFilters
        }));
    };

    const handleResetFilters = () => {
        setFilters({
            paymentMethod: '',
            customerName: '',
            recordedByName: '',
            startDate: '',
            endDate: ''
        });
    };

    const totalDebt = outstandingDebts.reduce((sum: number, s: any) => sum + (Number(s.debtAmount) || 0), 0);

    return (
        <div className="space-y-6 p-4 md:p-6">
            {/* Page Header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-pink-600 p-6 text-white shadow-lg">
                <div className="pointer-events-none absolute inset-0 bg-black/10" />
                <div className="relative flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                        <CreditCard className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('debtManagement.title')}</h1>
                        <p className="text-sm text-white/70 mt-0.5">
                            Track and manage outstanding customer debts and payment records
                        </p>
                    </div>
                </div>
                <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
                <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/20 flex-shrink-0">
                        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Outstanding Debts</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{outstandingDebts.length}</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-900/20 flex-shrink-0">
                        <TrendingDown className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Debt Amount</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                            {totalDebt.toLocaleString()} <span className="text-xs font-medium text-gray-400">RWF</span>
                        </p>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20 flex-shrink-0">
                        <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Customers with Debt</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                            {new Set(outstandingDebts.map((s: any) => s.customer?.id)).size}
                        </p>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                    <TabsTrigger
                        value="outstanding"
                        className="rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm data-[state=active]:text-red-600 font-medium"
                    >
                        {t('debtManagement.outstandingDebts')}
                    </TabsTrigger>
                    <TabsTrigger
                        value="history"
                        className="rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm data-[state=active]:text-blue-600 font-medium"
                    >
                        {t('debtManagement.paymentHistory')}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="outstanding" className="space-y-4">
                    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
                        <CardHeader className="border-b border-gray-100 dark:border-gray-700">
                            <CardTitle>{t('debtManagement.outstandingDebts')}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                </div>
                            ) : outstandingDebts.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    {t('debtManagement.noDebtsFound')}
                                </div>
                            ) : (
                                <div className="space-y-4">

                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-gray-50 dark:bg-gray-700/50">
                                                <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('debtManagement.saleNumber')}</TableHead>
                                                <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('debtManagement.customer')}</TableHead>
                                                <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('debtManagement.dueAmount')}</TableHead>
                                                <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">{t('debtManagement.action')}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {outstandingDebts.map((sale: any) => (
                                                <TableRow key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                                    <TableCell>
                                                        <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{sale.saleNumber}</span>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white text-xs font-bold flex-shrink-0">
                                                                {(sale.customer?.name || 'C').charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="font-medium text-sm text-gray-900 dark:text-white">{sale.customer?.name}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-red-600 dark:text-red-400 font-bold text-sm">
                                                            {Number(sale.debtAmount).toLocaleString()} RWF
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Button
                                                            size="sm"
                                                            onClick={() => {
                                                                setSelectedSale(sale);
                                                                setShowPaymentModal(true);
                                                            }}
                                                            className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                                                        >
                                                            {t('debtManagement.recordPayment')}
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>


                <TabsContent value="history" className="space-y-4">
                    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
                        <CardHeader className="border-b border-gray-100 dark:border-gray-700">
                            <CardTitle className="text-base font-semibold text-gray-900 dark:text-white">{t('debtManagement.paymentHistory')}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <PaymentHistory
                                payments={paymentHistory}
                                isLoading={isLoadingHistory}
                                filters={filters}
                                onFilterChange={handleFilterChange}
                                onResetFilters={handleResetFilters}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {showPaymentModal && selectedSale && (
                <PaymentModal
                    sale={selectedSale}
                    onClose={() => {
                        setShowPaymentModal(false);
                        setSelectedSale(null);
                    }}
                    onPaymentSuccess={handlePaymentSuccess}
                />
            )}
        </div>
    );

}

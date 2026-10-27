import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Clock, CheckCircle, XCircle, Loader2, AlertCircle, Download } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableRow, TableHeader } from '../../components/ui/table';
import { format } from 'date-fns';
import { apiClient } from '../../lib/api-client';
import { pdf } from '@react-pdf/renderer';
import { saveAs } from 'file-saver';
import InvoicePDF, { type BillingPayment } from '../../components/invoice/InvoicePDF';

type Payment = BillingPayment & { [key: string]: unknown };
type Profile = {
    id: string;
    name: string;
    email: string;
    role: string;
    profileImage?: string;
};

const BillingHistoryPage = () => {
    const { t } = useTranslation();
    const [payments, setPayments] = useState<Payment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState<string | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);


    useEffect(() => {
        const getData = async () => {
            try {
                // Get user profile
                const profileData = await apiClient.profile();
                setProfile(profileData as Profile);
            } catch (error) {
                console.error("Failed to fetch data:", error);
            }
        };

        getData();
    }, []);

    // Format currency
    const formatCurrency = (amount: number, currency: string = 'RWF'): string => {
        return new Intl.NumberFormat('en-RW', {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Get status icon based on payment status
    const getStatusIcon = (status: string) => {
        switch (status?.toUpperCase()) {
            case 'COMPLETED':
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case 'PENDING':
                return <Clock className="h-4 w-4 text-yellow-500" />;
            case 'FAILED':
                return <XCircle className="h-4 w-4 text-red-500" />;
            default:
                return null;
        }
    };

    // Get status color class
    const getStatusColor = (status: string): string => {
        switch (status?.toUpperCase()) {
            case 'COMPLETED':
                return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
            case 'PENDING':
                return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500';
            case 'FAILED':
                return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-500';
            default:
                return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
        }
    };

    // Format status text
    const formatStatus = (status: string): string => {
        const statusMap: { [key: string]: string } = {
            'SUCCEEDED': t('common.paid'),
            'COMPLETED': t('common.completed'),
            'PENDING': t('common.pending'),
            'FAILED': t('common.failed')
        };
        return statusMap[status] || status;
    };

    // Fetch payment history
    useEffect(() => {
        const fetchPayments = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const response = await apiClient.getPaymentHistory();
                if (response && Array.isArray(response.data.payments)) {
                    setPayments(response.data.payments);
                } else if (response?.data) {
                    setPayments(Array.isArray(response.data.payments) ? response.data.payments : []);
                } else {
                    setPayments([]);
                }
            } catch (err) {
                console.error('Error fetching payment history:', err);
                setError(t('billing.historyError'));
                setPayments([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPayments();
    }, []);

    // Handle invoice download
    const handleDownloadInvoice = async (payment: Payment) => {
        if (!payment || !profile) return;

        setIsDownloading(payment.id);
        try {
            // Generate PDF blob
            const blob = await pdf(<InvoicePDF payment={payment} profile={profile} />).toBlob();


            // Download the file
            saveAs(blob, `invoice-${payment.id}.pdf`);
        } catch (error) {
            console.error('Failed to generate invoice:', error);
            setError(t('billing.invoiceError'));
        } finally {
            setIsDownloading(null);
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">{t('billing.loadingHistory')}</p>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="p-4 bg-red-50 text-red-700 rounded-md flex items-center">
                <AlertCircle className="h-5 w-5 mr-2" />
                <span>{error}</span>
            </div>
        );
    }

    // Empty state
    if (payments.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center p-4">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-1">{t('billing.noHistory')}</h3>
                <p className="text-muted-foreground">
                    {t('billing.noHistoryDesc')}
                </p>
            </div>
        );
    }

    // Main content
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('billing.billingHistory')}</CardTitle>
                    <CardDescription>
                        {t('billing.description')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('common.date')}</TableHead>
                                    <TableHead>{t('common.description')}</TableHead>
                                    <TableHead>{t('billing.pricingAndCycle')}</TableHead>
                                    <TableHead>{t('debtManagement.amount')}</TableHead>
                                    <TableHead>{t('common.status')}</TableHead>
                                    <TableHead>{t('billing.invoice')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {payments.filter(Boolean).map((payment) => (
                                    <TableRow key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition border-b border-gray-100 dark:border-gray-700">
                                        <TableCell className="font-medium text-gray-900 dark:text-gray-200">
                                            {format(new Date(payment.createdAt), 'MMM d, yyyy')}
                                        </TableCell>
                                        <TableCell className="text-gray-700 dark:text-gray-300">
                                            {payment.subscription?.plan?.name || t('billing.subscriptionPayment')}
                                        </TableCell>
                                        <TableCell className="text-gray-600 dark:text-gray-400">
                                            {payment.metadata?.payment_method || payment.paymentMethod || '—'}
                                        </TableCell>
                                        <TableCell className="font-semibold text-gray-900 dark:text-gray-100">
                                            {formatCurrency(payment.amount, payment.currency)}
                                            {payment.metadata?.fee && (
                                                <span className="text-xs text-muted-foreground block">
                                                    + {formatCurrency(payment.metadata.fee, payment.currency)} {t('billing.fee')}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {getStatusIcon(payment.status)}
                                                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${getStatusColor(payment.status)}`}>
                                                    {formatStatus(payment.status)}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDownloadInvoice(payment)}
                                                disabled={isDownloading === payment.id}
                                                className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400"
                                            >
                                                {isDownloading === payment.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Download className="h-4 w-4" />
                                                )}
                                                <span className="sr-only">{t('billing.invoice')}</span>
                                            </Button>

                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default BillingHistoryPage;
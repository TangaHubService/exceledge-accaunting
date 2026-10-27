import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../context/ThemeContext';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { ArrowLeft, Loader2, Printer, Download, Share2, Copy } from 'lucide-react';
import { apiClient } from '../../../lib/api-client';
import { toast } from 'react-toastify';
import { saveAs } from 'file-saver';
import { getInvoiceFilename, unwrapInvoice } from '../../../lib/invoice';
import {
    canCopyReceipt,
    downloadReceiptCopy,
    issueInvoicePdfBlob,
    printReceiptCopy,
    shareInvoicePdf,
    type InvoicePdfFormat,
} from '../../../lib/invoice-pdf';
import type { SaleEbmTransaction } from '../../../utils/invoiceFiscal';
import { Badge } from '../../../components/ui/badge';

type Sale = {
    id: string;
    saleNumber: string;
    invoiceNumber?: string;
    customer: {
        name: string;
        email?: string;
        phone?: string;
    };
    user: {
        name: string;
    };
    paymentType: string;
    cashAmount: string;
    insuranceAmount: string;
    debtAmount: string;
    totalAmount: string;
    vatAmount?: string;
    taxableAmount?: string;
    createdAt: string;
    status: string;
    rcptLabel?: string | null;
    isProforma?: boolean;
    originalSaleId?: number | null;
    saleItems: Array<{
        id: string;
        product: {
            name: string;
            batchNumber?: string;
        };
        quantity: number;
        unitPrice: string;
        totalPrice: string;
        taxAmount?: string;
        taxCode?: string;
        costPrice?: string;
        profit?: string;
    }>;
    ebmTransactions?: SaleEbmTransaction[];
};

/** GET sale returns success(sale) → { success, data }. */
function saleFromApiResponse(res: unknown): Sale | null {
    if (!res || typeof res !== 'object') return null;
    const r = res as Record<string, unknown>;
    if (r.success === true && r.data != null && typeof r.data === 'object') {
        return r.data as Sale;
    }
    return res as Sale;
}

export default function SaleDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { theme } = useTheme();
    const [sale, setSale] = useState<Sale | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
    const [isPrintingInvoice, setIsPrintingInvoice] = useState(false);
    const [isSharingInvoice, setIsSharingInvoice] = useState(false);
    const [isCopying, setIsCopying] = useState<'print' | 'download' | null>(null);
    const [isSendingToPos, setIsSendingToPos] = useState(false);
    // Named distinctly from date-fns's `format` (imported above) to avoid shadowing it.
    const [invoiceFormat, setInvoiceFormat] = useState<InvoicePdfFormat>('A4');

    useEffect(() => {
        if (id) {
            fetchSaleDetails();
        }
    }, [id]);

    const fetchSaleDetails = async () => {
        try {
            setIsLoading(true);
            // Ensure we're using the ID from URL params (should be numeric)
            const saleId = id!;
            const saleData = await apiClient.getSale(saleId);
            setSale(saleFromApiResponse(saleData));
        } catch (error: any) {
            console.error('Failed to fetch sale details:', error);
            toast.error(error.message || t('sales.fetchError') || 'Failed to load sale details');
            navigate('/dashboard/sales');
        } finally {
            setIsLoading(false);
        }
    };

    const formatCurrency = (amount: string) => {
        return new Intl.NumberFormat('en-RW', {
            style: 'currency',
            currency: 'RWF',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(parseFloat(amount));
    };

    const formatTime = (dateString: string) => {
        return format(new Date(dateString), 'HH:mm');
    };

    /**
     * CIS/VSDC spec §7.18/§15: "print only one original receipt. Reprint shall
     * have a watermark with mention Copy." Registers this deliberate
     * download/print with the backend before fetching the PDF — the first
     * registered call for a sale renders as the original, every one after
     * automatically comes back watermarked COPY. No separate copy action needed.
     */
    const buildInvoicePdfBlob = async () => {
        if (!id) throw new Error('Sale ID is missing');

        const blob = await issueInvoicePdfBlob(id, invoiceFormat);
        const invoice = unwrapInvoice(await apiClient.getInvoice(id, { allowPending: true }));
        if (!invoice) throw new Error('Invoice was not returned by the backend.');
        return { blob, invoice };
    };

    /** CS/CR: explicit copy of this NS/NR receipt with its original VSDC fiscal data. */
    const handleReceiptCopy = async (mode: 'print' | 'download') => {
        if (!id) return;
        setIsCopying(mode);
        try {
            const label = mode === 'print'
                ? await printReceiptCopy(id, invoiceFormat)
                : await downloadReceiptCopy(id, invoiceFormat);
            toast.success(`${label ?? 'Copy'} receipt ${mode === 'print' ? 'sent to the printer' : 'downloaded'}`);
        } catch (error) {
            console.error('Failed to produce receipt copy:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to produce the receipt copy');
        } finally {
            setIsCopying(null);
        }
    };

    // Helper function to get payment method translation
    const getPaymentMethodLabel = (paymentType: string, t: (key: string, options?: any) => string): string => {
        if (!paymentType) return '';

        const translationKey = `pos.paymentMethods.${paymentType}`;
        const translated = t(translationKey, { defaultValue: paymentType });

        // If translation returns the key itself or starts with the namespace (not found), use fallback
        if (translated === translationKey || translated.startsWith('pos.paymentMethods.')) {
            // Fallback: format the payment type nicely (e.g., "MIXED" -> "Mixed", "CREDIT_CARD" -> "Credit Card")
            return paymentType
                .split('_')
                .map(word => word.charAt(0) + word.slice(1).toLowerCase())
                .join(' ');
        }
        return translated;
    };

    // Helper function to get payment methods as an array based on amounts
    const getPaymentMethods = (sale: Sale): Array<{ method: string; amount: number }> => {
        const methods: Array<{ method: string; amount: number }> = [];

        if (parseFloat(sale.cashAmount) > 0) {
            methods.push({ method: 'CASH', amount: parseFloat(sale.cashAmount) });
        }
        if (parseFloat(sale.insuranceAmount) > 0) {
            methods.push({ method: 'INSURANCE', amount: parseFloat(sale.insuranceAmount) });
        }
        if (parseFloat(sale.debtAmount) > 0) {
            methods.push({ method: 'DEBT', amount: parseFloat(sale.debtAmount) });
        }

        return methods;
    };

    const handleDownloadInvoice = async () => {
        if (!sale) return;

        setIsDownloadingInvoice(true);
        try {
            const { blob, invoice } = await buildInvoicePdfBlob();
            saveAs(blob, getInvoiceFilename(invoice, sale.saleNumber, invoiceFormat));
            toast.success(t('sales.invoiceDownloadSuccess') || 'Invoice downloaded successfully');
        } catch (error) {
            console.error('Failed to generate invoice:', error);
            toast.error(t('sales.invoiceGenerationError') || 'Failed to generate invoice');
        } finally {
            setIsDownloadingInvoice(false);
        }
    };

    const handleSendToPos = async () => {
        if (!id) return;
        setIsSendingToPos(true);
        try {
            const res = await apiClient.enqueuePosPrint(id, 1) as {
                success?: boolean;
                message?: string;
                data?: { alreadyQueued?: boolean };
            };
            if (res?.data?.alreadyQueued) {
                toast.info(res.message || 'Already queued — waiting for the POS to print');
            } else {
                toast.success(res?.message || 'Sent to POS printer — keep the POS app open');
            }
        } catch (error) {
            console.error('Failed to queue POS print:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to send print job to POS');
        } finally {
            setIsSendingToPos(false);
        }
    };

    const handlePrintInvoice = async () => {
        if (!sale) return;

        setIsPrintingInvoice(true);
        try {
            const { blob } = await buildInvoicePdfBlob();
            const url = URL.createObjectURL(blob);
            const printWindow = window.open(url, '_blank');
            if (printWindow) {
                printWindow.onload = () => {
                    printWindow.print();
                    URL.revokeObjectURL(url);
                };
            } else {
                toast.error(t('sales.printWindowError') || 'Failed to open print window');
            }
            toast.success(t('sales.invoicePrintSuccess') || 'Invoice sent to printer');
        } catch (error) {
            console.error('Failed to generate invoice for printing:', error);
            toast.error(t('sales.invoiceGenerationError') || 'Failed to generate invoice');
        } finally {
            setIsPrintingInvoice(false);
        }
    };

    const handleShareInvoice = async () => {
        if (!id || !sale) return;

        setIsSharingInvoice(true);
        try {
            const invoice = unwrapInvoice(await apiClient.getInvoice(id, { allowPending: true }));
            if (!invoice) throw new Error('Invoice was not returned by the backend.');
            const filename = getInvoiceFilename(invoice, sale.saleNumber, invoiceFormat);
            const shared = await shareInvoicePdf(id, filename, invoiceFormat);
            toast.success(shared ? 'Invoice ready to share' : 'Your browser downloaded the invoice instead');
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            console.error('Failed to share invoice:', error);
            toast.error(t('sales.invoiceGenerationError') || 'Failed to prepare invoice sharing');
        } finally {
            setIsSharingInvoice(false);
        }
    };

    const getStatusColor = (status: string) => {
        const colors: Record<string, string> = {
            'COMPLETED': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
            'PENDING': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
            'PROCESSING': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
            'CANCELLED': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
            'REFUNDED': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100',
            'PARTIALLY_REFUNDED': 'bg-purple-100 text-purple-500 dark:bg-purple-600 dark:text-purple-500',
        };
        return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    if (!sale) {
        return (
            <div className="p-6">
                <div className="text-center py-12">
                    <p className={`text-lg ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                        {t('sales.saleNotFound') || 'Sale not found'}
                    </p>
                    <Button
                        onClick={() => navigate('/dashboard/sales')}
                        variant="outline"
                        className="mt-4"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        {t('common.back') || 'Back to Sales'}
                    </Button>
                </div>
            </div>
        );
    }

    const lineItems = sale.saleItems ?? [];
    const totalProfit = lineItems.reduce((sum, item) => {
        const p = item.profit;
        const n = typeof p === 'number' ? p : parseFloat(String(p ?? '0'));
        return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    return (
        <div className="space-y-6 p-6">
            {/* Back Button */}
            <div>
                <Button
                    onClick={() => navigate('/dashboard/sales')}
                    variant="outline"
                    size="sm"
                    className={theme === 'dark'
                        ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('common.back') || 'Back'}
                </Button>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className={`text-2xl font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                        {t('sales.saleDetails') || 'Sale Details'}
                    </h1>
                    <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                        {sale.invoiceNumber || sale.saleNumber}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`flex items-center rounded-lg border p-0.5 ${theme === 'dark' ? 'border-gray-700' : 'border-gray-300'}`}>
                        {(['A4', 'A5', '80mm'] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setInvoiceFormat(option)}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    invoiceFormat === option
                                        ? 'bg-blue-600 text-white'
                                        : theme === 'dark'
                                            ? 'text-gray-300 hover:bg-gray-700'
                                            : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                    <Button
                        onClick={handlePrintInvoice}
                        disabled={isPrintingInvoice}
                        variant="outline"
                        size="sm"
                        className={theme === 'dark'
                            ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700 hover:text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                        }
                    >
                        {isPrintingInvoice ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Printer className="h-4 w-4 mr-2" />
                        )}
                        {t('sales.printInvoice') || 'Print Invoice'}
                    </Button>
                    <Button
                        onClick={handleSendToPos}
                        disabled={isSendingToPos}
                        variant="outline"
                        size="sm"
                        className={theme === 'dark'
                            ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700 hover:text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                        }
                        title="Queue this 80mm receipt on a logged-in POS device"
                    >
                        {isSendingToPos ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Printer className="h-4 w-4 mr-2" />
                        )}
                        {t('sales.sendToPos') || 'Send to POS'}
                    </Button>
                    <Button
                        onClick={handleDownloadInvoice}
                        disabled={isDownloadingInvoice}
                        variant="outline"
                        size="sm"
                        className={theme === 'dark'
                            ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700 hover:text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                        }
                    >
                        {isDownloadingInvoice ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4 mr-2" />
                        )}
                        {t('sales.downloadInvoice') || 'Download PDF'}
                    </Button>
                    <Button
                        onClick={handleShareInvoice}
                        disabled={isSharingInvoice}
                        variant="outline"
                        size="sm"
                        className={theme === 'dark'
                            ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700 hover:text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                        }
                    >
                        {isSharingInvoice ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Share2 className="h-4 w-4 mr-2" />
                        )}
                        Share Invoice
                    </Button>
                    {canCopyReceipt(sale) && (['print', 'download'] as const).map((mode) => (
                        <Button
                            key={mode}
                            onClick={() => handleReceiptCopy(mode)}
                            disabled={isCopying !== null}
                            variant="outline"
                            size="sm"
                            title="Reprint this receipt as a COPY (CS for a sale, CR for a refund) with its original fiscal data"
                            className={theme === 'dark'
                                ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700 hover:text-white'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                            }
                        >
                            {isCopying === mode ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Copy className="h-4 w-4 mr-2" />
                            )}
                            {mode === 'print' ? 'Print Copy' : 'Download Copy'} ({sale.rcptLabel === 'NR' || (!sale.rcptLabel && sale.originalSaleId != null) ? 'CR' : 'CS'})
                        </Button>
                    ))}
                </div>
            </div>

            {/* Sale Information */}
            <Card className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader>
                    <CardTitle className={theme === 'dark' ? 'text-white' : ''}>
                        {t('sales.saleInformation') || 'Sale Information'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div>
                            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('sales.saleNumber') || 'Sale Number'}
                            </p>
                            <p className={`mt-1 text-base font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {sale.saleNumber}
                            </p>
                        </div>
                        {sale.invoiceNumber && (
                            <div>
                                <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('sales.invoiceNumber') || 'Invoice Number'}
                                </p>
                                <p className={`mt-1 text-base font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                    {sale.invoiceNumber}
                                </p>
                            </div>
                        )}
                        <div>
                            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('sales.table.dateTime') || 'Date & Time'}
                            </p>
                            <p className={`mt-1 text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {format(new Date(sale.createdAt), 'MMM d, yyyy')} at {formatTime(sale.createdAt)}
                            </p>
                        </div>
                        <div>
                            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('sales.table.status') || 'Status'}
                            </p>
                            <Badge className={`mt-1 ${getStatusColor(sale.status)}`}>
                                {t(`sales.statuses.${sale.status}`, sale.status)}
                            </Badge>
                        </div>
                        <div>
                            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('sales.paymentMethod') || 'Payment Method'}
                            </p>
                            <p className={`mt-1 text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {getPaymentMethodLabel(sale.paymentType, t)}
                            </p>
                        </div>
                        <div>
                            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('sales.soldBy') || 'Sold By'}
                            </p>
                            <p className={`mt-1 text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {sale.user.name}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {sale.ebmTransactions && sale.ebmTransactions.length > 0 && (
                <Card className={theme === 'dark' ? 'bg-gray-800 border-blue-900/40 border' : 'border-blue-200 bg-blue-50/40'}>
                    <CardHeader>
                        <CardTitle className={theme === 'dark' ? 'text-white' : 'text-blue-950'}>
                            RRA EBM / VSDC
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {sale.ebmTransactions.map((tx) => (
                            <div
                                key={String(tx.id ?? `${tx.operation}-${tx.submissionStatus}`)}
                                className={`text-sm rounded-lg p-3 ${theme === 'dark' ? 'bg-gray-900/80' : 'bg-white'}`}
                            >
                                <p className={`font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                                    {tx.operation ?? 'SALE'} — {tx.submissionStatus}
                                </p>
                                {tx.ebmInvoiceNumber && (
                                    <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                                        EBM invoice #: {tx.ebmInvoiceNumber}
                                    </p>
                                )}
                                {tx.errorMessage && (
                                    <p className="text-red-600 dark:text-red-400 mt-1">{tx.errorMessage}</p>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* Customer Information */}
            <Card className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader>
                    <CardTitle className={theme === 'dark' ? 'text-white' : ''}>
                        {t('sales.customer') || 'Customer'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('sales.customerName') || 'Name'}
                            </p>
                            <p className={`mt-1 text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {sale.customer.name}
                            </p>
                        </div>
                        {sale.customer.phone && (
                            <div>
                                <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('sales.phone') || 'Phone'}
                                </p>
                                <p className={`mt-1 text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                    {sale.customer.phone}
                                </p>
                            </div>
                        )}
                        {sale.customer.email && (
                            <div>
                                <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('sales.email') || 'Email'}
                                </p>
                                <p className={`mt-1 text-base ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                    {sale.customer.email}
                                </p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Sale Items */}
            <Card className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader>
                    <CardTitle className={theme === 'dark' ? 'text-white' : ''}>
                        {t('sales.table.items') || 'Items'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className={theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'}>
                                <TableRow className={theme === 'dark' ? 'border-gray-600' : ''}>
                                    <TableHead className={theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}>
                                        {t('inventory.product') || 'Product'}
                                    </TableHead>
                                    <TableHead className={`text-right ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>
                                        {t('inventory.qty') || 'Quantity'}
                                    </TableHead>
                                    <TableHead className={`text-right ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>
                                        {t('inventory.unitPrice') || 'Unit Price'}
                                    </TableHead>
                                    <TableHead className={`text-right ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>
                                        {t('sales.table.tax') || 'Tax'}
                                    </TableHead>
                                    <TableHead className={`text-right ${theme === 'dark' ? 'text-gray-200' : 'text-gray-900'}`}>
                                        {t('common.total') || 'Total'}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lineItems.map((item) => (
                                    <TableRow
                                        key={item.id}
                                        className={theme === 'dark' ? 'border-gray-700 hover:bg-gray-800' : 'hover:bg-gray-50'}
                                    >
                                        <TableCell className={theme === 'dark' ? 'text-gray-300' : 'text-gray-900'}>
                                            <div>
                                                <p className="font-medium">
                                                    {item.product.name}
                                                    {item.taxCode && (
                                                        <span className="ml-1.5 text-[10px] font-medium px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                                            {item.taxCode}
                                                        </span>
                                                    )}
                                                </p>
                                                {item.product.batchNumber && (
                                                    <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                                                        {t('inventory.batchNumber')}: {item.product.batchNumber}
                                                    </p>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className={`text-right ${theme === 'dark' ? 'text-gray-300' : 'text-gray-900'}`}>
                                            {item.quantity}
                                        </TableCell>
                                        <TableCell className={`text-right ${theme === 'dark' ? 'text-gray-300' : 'text-gray-900'}`}>
                                            {formatCurrency(item.unitPrice)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {parseFloat(item.taxAmount ?? '0') > 0
                                                ? <span className="text-blue-600 dark:text-blue-400 font-medium">{formatCurrency(item.taxAmount!)}</span>
                                                : <span className={theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}>—</span>}
                                        </TableCell>
                                        <TableCell className={`text-right font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-gray-900'}`}>
                                            {formatCurrency(item.totalPrice)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Summary */}
            <Card className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader>
                    <CardTitle className={theme === 'dark' ? 'text-white' : ''}>
                        {t('sales.summary') || 'Summary'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {/* Show payment breakdown - always show if multiple methods or MIXED payment type */}
                        {(sale.paymentType === 'MIXED' || getPaymentMethods(sale).length > 1) && (
                            <div className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-gray-700 border-gray-600' : 'bg-blue-50 border-blue-200'}`}>
                                <p className={`text-sm font-semibold mb-3 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                    {t('sales.paymentBreakdown')}
                                </p>
                                <div className="space-y-2">
                                    {getPaymentMethods(sale).map((payment, index) => (
                                        <div key={index} className="flex justify-between items-center">
                                            <span className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                                                {getPaymentMethodLabel(payment.method, t)}:
                                            </span>
                                            <span className={`font-medium ${payment.method === 'DEBT'
                                                    ? 'text-amber-600 dark:text-amber-400'
                                                    : theme === 'dark' ? 'text-white' : 'text-gray-900'
                                                }`}>
                                                {formatCurrency(payment.amount.toString())}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Show individual payment amounts for non-MIXED payments */}
                        {sale.paymentType !== 'MIXED' && (
                            <>
                                {sale.paymentType === 'CASH' && parseFloat(sale.cashAmount) > 0 && (
                                    <div className="flex justify-between items-center">
                                        <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                            {t('sales.table.paid') || 'Cash Paid'}
                                        </span>
                                        <span className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                            {formatCurrency(sale.cashAmount)}
                                        </span>
                                    </div>
                                )}
                                {sale.paymentType === 'INSURANCE' && parseFloat(sale.insuranceAmount) > 0 && (
                                    <div className="flex justify-between items-center">
                                        <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                            {t('sales.insuranceAmount') || 'Insurance'}
                                        </span>
                                        <span className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                            {formatCurrency(sale.insuranceAmount)}
                                        </span>
                                    </div>
                                )}
                                {sale.paymentType === 'DEBT' && parseFloat(sale.debtAmount) > 0 && (
                                    <div className="flex justify-between items-center">
                                        <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                            {t('sales.table.debt') || 'Debt'}
                                        </span>
                                        <span className={`font-medium text-amber-600 dark:text-amber-400`}>
                                            {formatCurrency(sale.debtAmount)}
                                        </span>
                                    </div>
                                )}
                            </>
                        )}
                        {parseFloat(sale.vatAmount ?? '0') > 0 && (
                            <div className="border-t pt-4 flex justify-between items-center">
                                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('sales.table.tax') || 'Tax (VAT)'}
                                </span>
                                <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                                    {formatCurrency(sale.vatAmount!)}
                                </span>
                            </div>
                        )}
                        <div className="border-t pt-4 flex justify-between items-center">
                            <span className={`text-base font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {t('sales.table.total') || 'Grand Total'}
                            </span>
                            <span className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {formatCurrency(sale.totalAmount)}
                            </span>
                        </div>
                        {totalProfit !== 0 && (
                            <div className="border-t pt-4 flex justify-between items-center">
                                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('sales.table.profit')}
                                </span>
                                <span className={`text-base font-semibold ${totalProfit >= 0
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-red-600 dark:text-red-400'
                                    }`}>
                                    {formatCurrency(totalProfit.toString())}
                                </span>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

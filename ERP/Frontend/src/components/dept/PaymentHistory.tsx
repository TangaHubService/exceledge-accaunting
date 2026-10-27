import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '../ui/table';
import { format, parseISO } from 'date-fns';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { CalendarIcon, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from 'react-i18next';
interface Payment {
    id: string;
    amount: number;
    paymentDate: string;
    paymentMethod: string;
    customer: {
        name?: string;
    };
    reference?: string;
    notes?: string;
    recordedBy: {
        name: string;
    };
    sale?: {
        saleNumber: string;
    };
}

interface PaymentHistoryProps {
    payments: Payment[];
    isLoading?: boolean;
    onFilterChange: (filters: {
        paymentMethod?: string;
        customerName?: string;
        recordedByName?: string;
        startDate?: string;
        endDate?: string;
    }) => void;
    filters: {
        paymentMethod?: string;
        customerName?: string;
        recordedByName?: string;
        startDate?: string;
        endDate?: string;
    };
    onResetFilters: () => void;
}

// Payment method options
const PAYMENT_METHODS = [
    { value: 'CASH', label: 'Cash' },
    { value: 'MOBILE_MONEY', label: 'Mobile Money' },
    { value: 'CREDIT_CARD', label: 'Credit Card' },
    { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
    { value: 'OTHER', label: 'Other' },
];

export function PaymentHistory({
    payments,
    isLoading,
    onFilterChange,
    filters,
    onResetFilters
}: PaymentHistoryProps) {
    const { t } = useTranslation();
    const hasActiveFilters = Object.values(filters).some(value => value !== undefined && value !== '');
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                        <label className="text-sm font-medium mb-1 block">{t('debtManagement.paymentMethod')}</label>
                        <Select
                            value={filters.paymentMethod || 'all'}
                            onValueChange={(value) => onFilterChange({ ...filters, paymentMethod: value === 'all' ? undefined : value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('debtManagement.allMethods')} />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-gray-800 dark:text-white">
                                <SelectItem value="all">{t('debtManagement.allMethods')}</SelectItem>
                                {PAYMENT_METHODS.map((method) => (
                                    <SelectItem key={method.value} value={method.value}>
                                        {method.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">{t('debtManagement.customer')}</label>
                        <Input
                            placeholder={t('debtManagement.filterByCustomer')}
                            value={filters.customerName || ''}
                            onChange={(e) => onFilterChange({ ...filters, customerName: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">{t('debtManagement.recordedBy')}</label>
                        <Input
                            placeholder={t('debtManagement.filterByStaff')}
                            value={filters.recordedByName || ''}
                            onChange={(e) => onFilterChange({ ...filters, recordedByName: e.target.value })}
                        />
                    </div>

                    <div className="flex items-end gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onResetFilters}
                            disabled={!hasActiveFilters}
                            className="h-10"
                        >
                            <X className="h-4 w-4 mr-1" />
                            {t('debtManagement.reset')}
                        </Button>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label className="text-sm font-medium mb-1 block">{t('debtManagement.fromDate')}</label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !filters.startDate && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {filters.startDate ? format(parseISO(filters.startDate), "PPP") : <span>{t('debtManagement.pickStartDate')}</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <div className="p-2">
                                <input
                                    type="date"
                                    value={filters.startDate ? new Date(filters.startDate).toISOString().split('T')[0] : ''}
                                    onChange={(e) => onFilterChange({ ...filters, startDate: e.target.value })}
                                    className="w-full p-2 border rounded"
                                />
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                <div>
                    <label className="text-sm font-medium mb-1 block">{t('debtManagement.toDate')}</label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !filters.endDate && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {filters.endDate ? format(parseISO(filters.endDate), "PPP") : <span>{t('debtManagement.pickEndDate')}</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <div className="p-2">
                                <input
                                    type="date"
                                    value={filters.endDate ? new Date(filters.endDate).toISOString().split('T')[0] : ''}
                                    onChange={(e) => onFilterChange({ ...filters, endDate: e.target.value })}
                                    className="w-full p-2 border rounded"
                                />
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {isLoading ? (
                <div className="p-4 text-center text-muted-foreground flex items-center justify-center">
                    <div className="animate-spin inline-block mr-2 h-5 w-5 text-gray-300" role="status" aria-label="Loading payment history">
                        <span className="sr-only">{t('pos.processing')}</span>
                    </div>
                    <span>{t('debtManagement.failedToLoadHistory')}...</span>
                </div>
            ) : payments && payments.length > 0 ? (
                <Table>
                    <TableHeader className="bg-gray-100 dark:bg-gray-700 dark:border-gray-700">
                        <TableRow>
                            <TableHead>{t('debtManagement.date')}</TableHead>
                            <TableHead>{t('debtManagement.saleNumber')}</TableHead>
                            <TableHead>{t('debtManagement.amount')}</TableHead>
                            <TableHead>{t('debtManagement.method')}</TableHead>
                            <TableHead>{t('debtManagement.customer')}</TableHead>
                            <TableHead>{t('debtManagement.recordedBy')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="dark:text-gray-300">
                        {payments.map((payment) => (
                            <TableRow key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-700">
                                <TableCell className="dark:text-gray-300 dark:border-gray-700">
                                    {format(new Date(payment.paymentDate), 'MMM d, yyyy h:mm a')}
                                </TableCell>
                                <TableCell className="dark:text-white dark:border-gray-700">
                                    {payment.sale?.saleNumber || 'N/A'}
                                </TableCell>
                                <TableCell className="font-medium">
                                    {(payment.amount)} Frw
                                </TableCell>
                                <TableCell>
                                    {payment.paymentMethod.replace('_', ' ')}
                                </TableCell>
                                <TableCell>{payment.customer?.name || '-'}</TableCell>
                                <TableCell>{payment.recordedBy.name}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <div className="text-muted-foreground text-sm p-4 text-center flex items-center justify-center">
                    <span className="text-gray-300" aria-label="No payment history found">{t('debtManagement.noPaymentHistoryFound')}</span>
                </div>
            )}
        </div>
    );
}
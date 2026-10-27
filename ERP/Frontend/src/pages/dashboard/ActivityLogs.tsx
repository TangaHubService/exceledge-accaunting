import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDebounce } from 'use-debounce';
import { format, subDays } from 'date-fns';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../../components/ui/table';
import TableSkeleton from '../../components/ui/TableSkeleton';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Search, Filter, RefreshCw, Copy, X, Clock, User, Activity, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '../../components/ui/drawer';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { Skeleton } from '../../components/ui/skeleton';
import { Badge } from '../../components/ui/badge';
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider
} from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils';

type ActivityType =
    | 'USER_LOGIN' | 'USER_LOGOUT' | 'USER_LOGIN_FAILED' | 'USER_INVITE' | 'USER_ACCEPT_INVITE'
    | 'USER_ROLE_UPDATE' | 'USER_CREATED' | 'USER_PASSWORD_RESET' | 'USER_ACCOUNT_DISABLED' | 'USER_ACCOUNT_ENABLED'
    | 'PRODUCT_CREATE' | 'PRODUCT_UPDATE' | 'PRODUCT_DELETE' | 'PRODUCT_ARCHIVED'
    | 'STOCK_ADJUSTMENT' | 'STOCK_ADJUSTMENT_APPROVED' | 'STOCK_ADJUSTMENT_REJECTED'
    | 'LOW_STOCK_ALERT' | 'STOCK_INCREASED' | 'STOCK_DECREASED'
    | 'SALE_CREATE' | 'SALE_COMPLETED' | 'SALE_UPDATE' | 'SALE_DELETE' | 'SALE_REFUNDED' | 'SALE_CANCELLED'
    | 'DISCOUNT_APPLIED' | 'PAYMENT_RECEIVED' | 'PAYMENT_FAILED'
    | 'CUSTOMER_CREATE' | 'CUSTOMER_UPDATE' | 'CUSTOMER_DELETE' | 'CUSTOMER_ARCHIVED' | 'CUSTOMER_REACTIVATED'
    | 'SUPPLIER_CREATE' | 'SUPPLIER_UPDATE' | 'SUPPLIER_DELETE'
    | 'PURCHASE_ORDER_CREATE' | 'PURCHASE_ORDER_UPDATE' | 'PURCHASE_ORDER_DELETE'
    | 'PURCHASE_ORDER_APPROVED' | 'PURCHASE_ORDER_REJECTED' | 'PURCHASE_ORDER_COMPLETED' | 'PURCHASE_ORDER_CANCELLED'
    | 'SETTINGS_UPDATE' | 'TAX_CONFIG_CHANGED' | 'BRANCH_CREATE' | 'BRANCH_UPDATE' | 'BACKUP_RESTORE'
    | 'OTHER';

type EntityType = 'User' | 'Product' | 'Sale' | 'Purchase Order' | 'Customer' | 'Supplier' | 'Organization' | string;

interface ActivityLog {
    id: number;
    type: ActivityType;
    description: string;
    entityType: EntityType | null;
    entityId: number | null;
    user: {
        id: number;
        name: string;
        email: string;
    };
    metadata: {
        ip?: string;
        agent?: string;
        organization?: string;
        responseTime?: string | number;
        requestBody?: unknown;
        [key: string]: unknown;
    };
    ip: string;
    agent: string;
    createdAt: string;
    updatedAt: string;
}

interface ActivityLogsResponse {
    data: ActivityLog[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}

const ActivityLogs = () => {
    const { t } = useTranslation();
    // State

    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm] = useDebounce(searchTerm, 500);
    const [page, setPage] = useState(1);
    const limit = 10;
    const [activityType, setActivityType] = useState<string>('all');
    const [entityType, setEntityType] = useState<string>('all');
    const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({
        from: subDays(new Date(), 7),
        to: new Date(),
    });

    // Constants
    const activityTypes = useMemo(() => [
        'all',
        'USER_LOGIN',
        'USER_LOGOUT',
        'USER_LOGIN_FAILED',
        'USER_INVITE',
        'USER_ACCEPT_INVITE',
        'USER_ROLE_UPDATE',
        'USER_CREATED',
        'USER_PASSWORD_RESET',
        'USER_ACCOUNT_DISABLED',
        'USER_ACCOUNT_ENABLED',
        'PRODUCT_CREATE',
        'PRODUCT_UPDATE',
        'PRODUCT_DELETE',
        'PRODUCT_ARCHIVED',
        'STOCK_ADJUSTMENT',
        'STOCK_ADJUSTMENT_APPROVED',
        'STOCK_ADJUSTMENT_REJECTED',
        'LOW_STOCK_ALERT',
        'STOCK_INCREASED',
        'STOCK_DECREASED',
        'SALE_CREATE',
        'SALE_COMPLETED',
        'SALE_UPDATE',
        'SALE_DELETE',
        'SALE_REFUNDED',
        'SALE_CANCELLED',
        'DISCOUNT_APPLIED',
        'PAYMENT_RECEIVED',
        'PAYMENT_FAILED',
        'CUSTOMER_CREATE',
        'CUSTOMER_UPDATE',
        'CUSTOMER_DELETE',
        'CUSTOMER_ARCHIVED',
        'CUSTOMER_REACTIVATED',
        'SUPPLIER_CREATE',
        'SUPPLIER_UPDATE',
        'SUPPLIER_DELETE',
        'PURCHASE_ORDER_CREATE',
        'PURCHASE_ORDER_UPDATE',
        'PURCHASE_ORDER_DELETE',
        'PURCHASE_ORDER_APPROVED',
        'PURCHASE_ORDER_REJECTED',
        'PURCHASE_ORDER_COMPLETED',
        'PURCHASE_ORDER_CANCELLED',
        'SETTINGS_UPDATE',
        'TAX_CONFIG_CHANGED',
        'BRANCH_CREATE',
        'BRANCH_UPDATE',
        'BACKUP_RESTORE',
        'OTHER',
    ], []);

    const entityTypes = useMemo(() => [
        'all',
        'User',
        'Product',
        'Sale',
        'Purchase Order',
        'Customer',
        'Supplier',
        'Organization',
        'Branch',
        'Warehouse',
        'Batch',
    ], []);

    // API Query
    const {
        data,
        isLoading,
        error,
        refetch,
        isRefetching
    } = useQuery<ActivityLogsResponse>({
        queryKey: [
            'activityLogs',
            page,
            limit,
            debouncedSearchTerm,
            activityType,
            entityType,
            dateRange?.from,
            dateRange?.to
        ],
        queryFn: async () => {
            const params = {
                page,
                limit,
                ...(debouncedSearchTerm && { search: debouncedSearchTerm }),
                ...(activityType !== 'all' && { type: activityType }),
                ...(entityType !== 'all' && { entityType }),
                ...(dateRange?.from && { startDate: format(dateRange.from, 'yyyy-MM-dd') }),
                ...(dateRange?.to && { endDate: format(dateRange.to, 'yyyy-MM-dd') }),
            };

            try {
                const response = await apiClient.getActivityLogs(params);
                return {
                    data: response.data,
                    pagination: response.pagination || {
                        page,
                        pageSize: limit,
                        total: 0,
                        totalPages: 1,
                    }
                };
            } catch (error) {
                console.error('Error fetching activity logs:', error);
                throw error;
            }
        },
        placeholderData: (previousData) => previousData,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    // Derived state
    const logs = data?.data || [];
    const pagination = data?.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };
    const isRefreshing = isRefetching && !isLoading;

    // Handlers
    const handleSearchSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        refetch();
    }, [refetch]);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    const handleViewDetails = (log: ActivityLog) => {
        setSelectedLog(log);
        setIsDialogOpen(true);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success(t('common.copied'), {
            autoClose: 2000,
            position: 'top-right',
        });
    };


    const getActivityBadgeClass = (type: ActivityType) => {
        const baseClasses = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border';

        if (type.includes('CREATE') || type === 'USER_INVITE' || type === 'USER_ACCEPT_INVITE' || type.includes('INCREASED') || type.includes('APPROVED')) {
            return `${baseClasses} bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700`;
        }
        if (type.includes('UPDATE') || type.includes('ADJUSTMENT') || type === 'SETTINGS_UPDATE' || type === 'TAX_CONFIG_CHANGED') {
            return `${baseClasses} bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700`;
        }
        if (type.includes('DELETE') || type.includes('ARCHIVED') || type.includes('CANCELLED') || type.includes('REJECTED') || type.includes('FAILED') || type.includes('DISABLED') || type.includes('DECREASED') || type === 'LOW_STOCK_ALERT') {
            return `${baseClasses} bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700`;
        }
        if (type.includes('LOGIN') || type.includes('LOGOUT') || type.includes('PASSWORD') || type.includes('ROLE')) {
            return `${baseClasses} bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700`;
        }
        if (type.includes('COMPLETED') || type.includes('RECEIVED')) {
            return `${baseClasses} bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700`;
        }
        return `${baseClasses} bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600`;
    };

    const formatActivityType = (type: string) => {
        return type
            .toLowerCase()
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };

    // Loading skeleton
    if (isLoading && !isRefreshing) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <Skeleton className="h-9 w-64" />
                        <Skeleton className="h-5 w-80 mt-2" />
                    </div>
                    <Skeleton className="h-9 w-24" />
                </div>
                <Card>
                    <CardHeader>
                        <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between">
                            <Skeleton className="h-10 w-96" />
                            <div className="flex gap-2">
                                <Skeleton className="h-10 w-48" />
                                <Skeleton className="h-10 w-48" />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {[...Array(5)].map((_, i) => (
                                <Skeleton key={i} className="h-16 w-full" />
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                            <Activity className="h-8 w-8 text-primary" />
                            {t('logs.activityLogs')}
                        </h1>

                    </div>
                </div>
                <Card className="border-destructive/20">
                    <CardContent className="pt-6 text-center">
                        <div className="flex flex-col items-center gap-3">
                            <div className="rounded-full bg-destructive/10 p-3">
                                <AlertCircle className="h-6 w-6 text-destructive" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-destructive mb-1">
                                    {t('messages.logsLoadError')}
                                </h3>

                                <p className="text-sm text-muted-foreground">
                                    {error instanceof Error ? error.message : 'An unknown error occurred'}
                                </p>
                            </div>
                            <Button
                                onClick={() => refetch()}
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={isRefreshing}
                            >
                                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                {t('common.tryAgain')}
                            </Button>

                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6 dark:text-white">
            {/* Header */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
                            <Activity className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                            {t('logs.activityLogs')}
                        </h1>

                        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                            {t('logs.totalLogs', { count: pagination.total })} • {t('logs.lastUpdated', { date: format(new Date(), 'MMM d, yyyy h:mm a') })}
                        </p>

                    </div>
                    <div className="flex items-center gap-2 self-start">
                        <Button
                            onClick={() => {
                                setSearchTerm('');
                                setActivityType('all');
                                setEntityType('all');
                                setDateRange({
                                    from: subDays(new Date(), 7),
                                    to: new Date(),
                                });
                                setPage(1);
                            }}
                            variant="outline"
                            size="sm"
                            className="gap-2"
                        >
                            <X className="h-4 w-4" />
                            <span className="hidden sm:inline">{t('logs.clearFilters')}</span>
                            <span className="sm:hidden">{t('common.clear')}</span>
                        </Button>

                        <Button
                            onClick={() => refetch()}
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            disabled={isRefreshing}
                        >
                            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            <span className="hidden sm:inline">{t('logs.refresh')}</span>
                        </Button>

                    </div>
                </div>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader className="pb-4 bg-white dark:bg-gray-900 dark:text-white">
                    <div className="flex flex-col space-y-4">
                        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    type="search"
                                    placeholder={t('logs.searchPlaceholder')}
                                    className="pl-10"
                                    value={searchTerm}
                                    onChange={handleSearch}
                                />

                            </div>
                            <Button type="submit" size="default" disabled={isRefreshing} className="sm:w-auto w-full bg-blue-600 hover:bg-blue-700 text-white">
                                {t('common.search')}
                            </Button>

                        </form>

                        <div className="flex flex-col sm:flex-row gap-4">
                            {/* Date Range */}
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                <span className="text-sm font-medium text-muted-foreground sm:hidden">{t('logs.dateRange')}:</span>

                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                    <Input
                                        type="date"
                                        value={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''}
                                        onChange={(e) => {
                                            const date = e.target.value ? new Date(e.target.value) : undefined;
                                            setDateRange((prev) => ({
                                                ...prev,
                                                from: date,
                                                to: date ? (prev?.to || date) : prev?.to
                                            }));
                                        }}
                                        className="flex-1 sm:w-[140px]"
                                        disabled={isRefreshing}
                                    />
                                    <span className="text-muted-foreground hidden sm:inline">{t('logs.to')}</span>
                                    <span className="text-muted-foreground sm:hidden">-</span>

                                    <Input
                                        type="date"
                                        value={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : ''}
                                        onChange={(e) => {
                                            const date = e.target.value ? new Date(e.target.value) : undefined;
                                            setDateRange((prev) => ({
                                                ...prev,
                                                from: date ? (prev?.from || date) : prev?.from,
                                                to: date
                                            }));
                                        }}
                                        className="flex-1 sm:w-[140px]"
                                        disabled={isRefreshing}
                                    />
                                </div>
                            </div>

                            {/* Filters */}
                            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                <Select
                                    value={activityType}
                                    onValueChange={(val) => {
                                        setActivityType(val);
                                        setPage(1);
                                    }}
                                    disabled={isRefreshing}
                                >
                                    <SelectTrigger className="w-full sm:w-[160px] bg-white dark:bg-gray-800 dark:text-white">
                                        <Filter className="mr-2 h-4 w-4" />
                                        <SelectValue placeholder={t('logs.activityType')} />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white dark:bg-gray-800 dark:text-white">
                                        {activityTypes.map((type) => (
                                            <SelectItem key={type} value={type}>
                                                {t(`logs.types.${type}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>

                                </Select>

                                <Select
                                    value={entityType}
                                    onValueChange={(val) => {
                                        setEntityType(val);
                                        setPage(1);
                                    }}
                                    disabled={isRefreshing}
                                >
                                    <SelectTrigger className="w-full sm:w-[160px] bg-white dark:bg-gray-800 dark:text-white">
                                        <Filter className="mr-2 h-4 w-4" />
                                        <SelectValue placeholder={t('logs.entityType')} />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white dark:bg-gray-800 dark:text-white" >
                                        {entityTypes.map((type) => (
                                            <SelectItem key={type} value={type}>
                                                {type === 'all' ? t('logs.entities.all') : t(`logs.entities.${type}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>

                                </Select>
                            </div>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {/* Main Content */}
            <Card className="relative overflow-hidden">
                {isRefreshing && (
                    <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
                        <div className="flex items-center gap-2 bg-background border rounded-md px-4 py-2 shadow-lg">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span className="text-sm">{t('logs.updatingLogs')}</span>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <Table className="min-w-[800px] w-full">
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="w-[200px] min-w-[200px]">{t('logs.user')}</TableHead>
                                <TableHead className="min-w-[200px]">{t('logs.activity')}</TableHead>
                                <TableHead className="w-[120px] min-w-[120px]">{t('logs.type')}</TableHead>
                                <TableHead className="w-[100px] min-w-[100px]">{t('logs.entity')}</TableHead>
                                <TableHead className="w-[150px] min-w-[150px]">
                                    <div className="flex items-center justify-start gap-2">
                                        <Clock className="h-4 w-4" />
                                        <span className="hidden sm:inline">{t('logs.dateTime')}</span>
                                        <span className="sm:hidden">{t('common.date')}</span>
                                    </div>
                                </TableHead>
                                <TableHead className="w-[80px] min-w-[80px] text-right">{t('logs.actions')}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {isLoading || isRefetching ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="p-0">
                                        <TableSkeleton rows={10} columns={6} />
                                    </TableCell>
                                </TableRow>
                            ) : logs.length > 0 ? (
                                logs.map((log) => (
                                    <TableRow key={log.id} className="hover:bg-muted/30 border-b dark:border-gray-800">
                                        <TableCell className="py-3">
                                            <div className="flex items-center gap-2 sm:gap-3">
                                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
                                                    <User className="h-4 w-4 text-primary" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-semibold text-sm truncate dark:text-gray-200">{log.user?.name || 'System'}</div>
                                                    <div className="text-xs text-muted-foreground truncate hidden sm:block">
                                                        {log.user?.email || 'system@example.com'}
                                                    </div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-3 max-w-[200px]">
                                            <div className="line-clamp-2 text-sm dark:text-gray-300">{log.description || '—'}</div>
                                        </TableCell>
                                        <TableCell className="py-3">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    'whitespace-nowrap text-[10px] sm:text-xs font-semibold py-0.5',
                                                    getActivityBadgeClass(log.type)
                                                )}
                                            >
                                                <span className="hidden sm:inline">{formatActivityType(log.type)}</span>
                                                <span className="sm:hidden">{log.type.split('_')[0]}</span>
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="py-3">
                                            {log.entityType ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="whitespace-nowrap text-[10px] sm:text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-none shadow-none"
                                                >
                                                    <span className="hidden sm:inline">{t(`logs.entities.${log.entityType}`)}</span>
                                                    <span className="sm:hidden">{log.entityType}</span>
                                                </Badge>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            )}
                                        </TableCell>

                                        <TableCell className="py-3">
                                            <div className="flex flex-col items-start">
                                                <div className="text-xs sm:text-sm font-medium dark:text-gray-300">
                                                    {format(new Date(log.createdAt), 'MMM d, yyyy')}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {format(new Date(log.createdAt), 'h:mm a')}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-3 text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleViewDetails(log)}
                                                className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary transition-colors dark:text-gray-400"
                                            >
                                                <span className="sr-only">{t('common.view')}</span>
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center">
                                        <div className="flex flex-col items-center justify-center py-10">
                                            <Activity className="h-10 w-10 text-muted-foreground/30 mb-3" />
                                            <h3 className="text-lg font-medium dark:text-gray-200">{t('logs.noLogsFound')}</h3>
                                            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                                                {t('logs.adjustSearch')}
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="border-t dark:border-gray-800 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-sm text-muted-foreground order-2 sm:order-1">
                            {t('logs.showing')} <span className="font-semibold text-foreground dark:text-gray-200">{(page - 1) * limit + 1}</span> {t('logs.to')}{' '}
                            <span className="font-semibold text-foreground dark:text-gray-200">
                                {Math.min(page * limit, pagination.total)}
                            </span>{' '}
                            {t('logs.of')} <span className="font-semibold text-foreground dark:text-gray-200">{pagination.total}</span> {t('logs.logs')}
                        </div>

                        <div className="flex items-center space-x-2 order-1 sm:order-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1 || isRefreshing}
                                className="h-9 px-3 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
                            >
                                <ChevronLeft className="h-4 w-4 mr-1" />
                                {t('common.previous')}
                            </Button>

                            <div className="hidden md:flex items-center gap-1">
                                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                                    let pageNum;
                                    if (pagination.totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (page <= 3) {
                                        pageNum = i + 1;
                                    } else if (page >= pagination.totalPages - 2) {
                                        pageNum = pagination.totalPages - 4 + i;
                                    } else {
                                        pageNum = page - 2 + i;
                                    }

                                    return (
                                        <Button
                                            key={pageNum}
                                            variant={page === pageNum ? "default" : "ghost"}
                                            size="sm"
                                            className={cn(
                                                "h-9 w-9 p-0",
                                                page === pageNum
                                                    ? "bg-primary text-primary-foreground font-bold"
                                                    : "dark:text-gray-400 hover:bg-primary/10 hover:text-primary"
                                            )}
                                            onClick={() => setPage(pageNum)}
                                            disabled={isRefreshing}
                                        >
                                            {pageNum}
                                        </Button>
                                    );
                                })}
                            </div>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                disabled={page >= pagination.totalPages || isRefreshing}
                                className="h-9 px-3 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
                            >
                                {t('common.next')}
                                <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            {/* Details Dialog */}
            <Drawer open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DrawerContent className="max-w-2xl overflow-hidden flex flex-col p-0 border-none bg-white dark:bg-gray-900 shadow-2xl">
                    <DrawerHeader className="p-6 pb-4 border-b dark:border-gray-800">
                        <DrawerTitle className="flex items-center gap-3 text-xl font-bold dark:text-white">
                            <div className="p-2 rounded-lg bg-primary/10">
                                <Activity className="h-6 w-6 text-primary" />
                            </div>
                            {t('logs.logDetails')}
                        </DrawerTitle>
                    </DrawerHeader>

                    {selectedLog && (
                        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-800">
                            {/* Basic Info */}
                            <section className="space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    {t('logs.basicInfo')}
                                </h3>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 bg-muted/30 dark:bg-gray-800/50 p-4 rounded-xl">
                                    <DetailItem
                                        label={t('logs.activityType')}
                                        value={formatActivityType(selectedLog.type)}
                                        badge
                                        badgeClass={getActivityBadgeClass(selectedLog.type)}
                                    />

                                    <DetailItem
                                        label={t('logs.entityType')}
                                        value={selectedLog.entityType ? t(`logs.entities.${selectedLog.entityType}`) : t('common.na')}
                                    />

                                    <DetailItem
                                        label={t('logs.dateTime')}
                                        value={format(new Date(selectedLog.createdAt), 'PPpp')}
                                    />

                                    <DetailItem
                                        label={t('logs.ipAddress')}
                                        value={
                                            selectedLog.metadata?.ip === "::1"
                                                ? "127.0.0.1"
                                                : selectedLog.metadata?.ip?.startsWith("::ffff:")
                                                    ? selectedLog.metadata.ip.replace("::ffff:", "")
                                                    : selectedLog.metadata?.ip || t('common.na')
                                        }
                                        onCopy={() =>
                                            copyToClipboard(
                                                selectedLog.metadata?.ip === "::1"
                                                    ? "127.0.0.1"
                                                    : selectedLog.metadata?.ip?.startsWith("::ffff:")
                                                        ? selectedLog.metadata.ip.replace("::ffff:", "")
                                                        : selectedLog.metadata?.ip || t('common.na')
                                            )
                                        }
                                        mono
                                    />
                                </div>

                                <div className="bg-muted/30 dark:bg-gray-800/50 p-4 rounded-xl space-y-4">
                                    <DetailItem
                                        label={t('inventory.description')}
                                        value={selectedLog.description || t('common.na')}
                                        onCopy={() => selectedLog.description && copyToClipboard(selectedLog.description)}
                                        fullWidth
                                    />

                                    <DetailItem
                                        label={t('logs.userAgent')}
                                        value={selectedLog.metadata?.agent || t('common.na')}
                                        onCopy={() => copyToClipboard(selectedLog.metadata?.agent || t('common.na'))}
                                        mono
                                        fullWidth
                                    />
                                </div>
                            </section>

                            {/* User Info */}
                            <section className="space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    {t('logs.userInfo')}
                                </h3>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 bg-muted/30 dark:bg-gray-800/50 p-4 rounded-xl">
                                    <DetailItem
                                        label={t('common.name')}
                                        value={selectedLog.user?.name || 'System'}
                                    />

                                    <DetailItem
                                        label={t('common.email')}
                                        value={selectedLog.user?.email || 'system@example.com'}
                                        onCopy={() => selectedLog.user?.email && copyToClipboard(selectedLog.user.email)}
                                    />

                                    <DetailItem
                                        label={t('logs.userId')}
                                        value={selectedLog.user?.id || 'System'}
                                        onCopy={() => selectedLog.user?.id && copyToClipboard(String(selectedLog.user.id))}
                                        mono
                                        fullWidth
                                    />
                                </div>
                            </section>

                            {/* Metadata / Request Body */}
                            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                                <section className="space-y-4">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                        <Copy className="h-4 w-4" />
                                        {t('logs.requestData')}
                                    </h3>

                                    <div className="bg-muted/30 dark:bg-gray-800/50 p-1 rounded-xl overflow-hidden border dark:border-gray-800">
                                        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 dark:bg-gray-800 border-b dark:border-gray-700">
                                            <span className="text-xs font-mono text-muted-foreground">JSON Payload</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs gap-1"
                                                onClick={() => copyToClipboard(JSON.stringify(selectedLog.metadata, null, 2))}
                                            >
                                                <Copy className="h-3 w-3" />
                                                {t('common.copy')}
                                            </Button>
                                        </div>
                                        <div className="p-4 bg-white dark:bg-gray-900/50 overflow-x-auto">
                                            <pre className="text-xs font-mono text-gray-800 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-all">
                                                {JSON.stringify(selectedLog.metadata, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                </section>
                            )}
                        </div>
                    )}

                    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-t dark:border-gray-800 flex justify-end">
                        <Button variant="secondary" onClick={() => setIsDialogOpen(false)}>
                            {t('common.close')}
                        </Button>
                    </div>
                </DrawerContent>
            </Drawer>
        </div>
    );
};

// Helper component for detail items
const DetailItem = ({
    label,
    value,
    badge = false,
    badgeClass = '',
    mono = false,
    fullWidth = false,
    onCopy,
}: {
    label: string;
    value: React.ReactNode;
    badge?: boolean;
    badgeClass?: string;
    mono?: boolean;
    fullWidth?: boolean;
    onCopy?: () => void;
}) => (
    <div className={cn('space-y-1', fullWidth ? 'col-span-full' : '')}>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={cn(
            'flex items-center justify-between gap-2',
            badge ? 'h-6' : 'min-h-9'
        )}>
            {badge ? (
                <span className={cn(
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    badgeClass
                )}>
                    {String(value)}
                </span>
            ) : (
                <div className={cn(
                    'text-sm break-words',
                    mono ? 'font-mono text-sm' : '',
                    fullWidth ? 'break-all' : ''
                )}>
                    {value}
                </div>
            )}
            {onCopy && value !== 'N/A' && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={onCopy}
                            >
                                <Copy className="h-3.5 w-3.5" />
                                <span className="sr-only">Copy to clipboard</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Copy to clipboard</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    </div>
);

export default ActivityLogs;
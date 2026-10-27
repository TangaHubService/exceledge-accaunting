import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    Plus,
    Search,
    MoreVertical,
    X,
    Clock,
    Loader2,
    Package,
    Calendar,
    User,
    ExternalLink,
    CheckCircle2,
    XCircle,
    Truck,
    ChevronRight,
    AlertCircle,
    Trash2
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { TableSkeleton } from '../../../components/ui/TableSkeleton';
import ConfirmDialog from '../../../components/common/ConfirmDialog';
import { apiClient } from '../../../lib/api-client';
import { format } from 'date-fns';
import { useTheme } from '../../../context/ThemeContext';
import { useBranch } from '../../../context/BranchContext';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from '../../../components/ui/dropdown-menu';
import {
    Drawer,
    DrawerContent,
    DrawerFooter,
} from "../../../components/ui/drawer";
import { ScrollArea } from '../../../components/ui/scroll-area';
import type { OrdersListProps, Order } from '../suppliers/types/supplierTypes';

export const OrdersList: React.FC<OrdersListProps> = ({ organizationId }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { theme } = useTheme();
    const { selectedBranchId, primaryBranch } = useBranch();

    const [orders, setOrders] = useState<Order[]>([]);
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [updatingStatus, setUpdatingStatus] = useState<{ [key: string]: boolean }>({});
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [orderToDelete, setOrderToDelete] = useState<string | number | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [receiveModalOpen, setReceiveModalOpen] = useState(false);
    const [receivingOrder, setReceivingOrder] = useState<Order | null>(null);
    const [receivingQuantities, setReceivingQuantities] = useState<Record<number, number>>({});
    const [receivingPrices, setReceivingPrices] = useState<Record<number, string>>({});
    const [isReceiving, setIsReceiving] = useState(false);

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                setLoading(true);
                const ordersData = await apiClient.getPurchaseOrders(organizationId);
                const ordersList = Array.isArray(ordersData) ? ordersData : [];
                setOrders(ordersList);
                setFilteredOrders(ordersList);
            } catch (err) {
                console.error('Error fetching orders:', err);
                const errorMessage = err instanceof Error ? err.message : 'Failed to load orders';
                setError(errorMessage);
                toast.error(`${t('purchaseOrders.fetchError')}: ${errorMessage}`);
            } finally {
                setLoading(false);
            }
        };

        if (organizationId) {
            fetchOrders();
        }
    }, [organizationId, t]);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setFilteredOrders(orders);
        } else {
            const searchLower = searchTerm.toLowerCase();
            const filtered = orders.filter(order =>
                order.orderNumber.toLowerCase().includes(searchLower) ||
                order.supplier.name.toLowerCase().includes(searchLower) ||
                order.status.toLowerCase().includes(searchLower) ||
                order.items.some(item =>
                    item.productName.toLowerCase().includes(searchLower)
                )
            );
            setFilteredOrders(filtered);
        }
    }, [searchTerm, orders]);

    const handleStatusUpdate = async (orderId: string | number, newStatus: string) => {
        try {
            setUpdatingStatus(prev => ({ ...prev, [orderId]: true }));
            const branchIdForReceive = selectedBranchId ?? primaryBranch?.id ?? null;
            const response = await apiClient.updatePurchaseOrderStatus(
                orderId,
                newStatus,
                organizationId,
                {
                    branchId: newStatus === 'COMPLETED' ? branchIdForReceive : undefined
                }
            );

            if (response) {
                setOrders(prevOrders =>
                    prevOrders.map(order =>
                        String(order.id) === String(orderId)
                            ? { ...order, status: newStatus }
                            : order
                    )
                );

                if (String(selectedOrder?.id) === String(orderId)) {
                    setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
                }

                toast.success(t('purchaseOrders.statusUpdated', { status: newStatus.toLowerCase() }));
            } else {
                throw new Error(t('purchaseOrders.updateError'));
            }
        } catch (err) {
            console.error('Error updating status:', err);
            const errorMessage = err instanceof Error ? err.message : t('purchaseOrders.updateError');
            toast.error(`${t('common.error')}: ${errorMessage}`);
        } finally {
            setUpdatingStatus(prev => ({ ...prev, [orderId]: false }));
        }
    };

    const handleDeleteClick = (orderId: string | number) => {
        setOrderToDelete(orderId);
        setDeleteDialogOpen(true);
    };

    const handleDelete = async () => {
        if (!orderToDelete) return;

        setIsDeleting(true);
        try {
            const response = await apiClient.deletePurchaseOrder(orderToDelete);

            if (response) {
                setOrders(prev => prev.filter(order => String(order.id) !== String(orderToDelete)));
                toast.success(t('common.deletedSuccessfully'));
            } else {
                throw new Error(t('common.deleteError'));
            }
        } catch (error) {
            console.error('Error deleting order:', error);
            const errorMessage = error instanceof Error ? error.message : t('common.deleteError');
            toast.error(`${t('common.error')}: ${errorMessage}`);
        } finally {
            setIsDeleting(false);
            setDeleteDialogOpen(false);
            setOrderToDelete(null);
        }
    };

    const handleReceiveOpen = (order: Order) => {
        setReceivingOrder(order);
        const initial: Record<number, number> = {};
        const prices: Record<number, string> = {};
        order.items.forEach(item => {
            const alreadyReceived = item.quantityReceived || 0;
            initial[item.id] = Math.max(0, item.quantity - alreadyReceived);
            const current = (item as any).product?.unitPrice;
            prices[item.id] = current != null ? String(Number(current)) : '';
        });
        setReceivingQuantities(initial);
        setReceivingPrices(prices);
        setReceiveModalOpen(true);
    };

    const handleReceiveConfirm = async () => {
        if (!receivingOrder) return;
        setIsReceiving(true);
        try {
            const branchIdForReceive = selectedBranchId ?? primaryBranch?.id ?? null;
            const receivedItems = receivingOrder.items.map(item => {
                const sellingPrice = Number(receivingPrices[item.id]);
                return {
                    productId: (item as any).productId!,
                    quantity: receivingQuantities[item.id] ?? (item.quantity - (item.quantityReceived || 0)),
                    sellingPrice: Number.isFinite(sellingPrice) && sellingPrice > 0 ? sellingPrice : undefined,
                };
            }).filter(ri => ri.quantity > 0);

            if (receivedItems.length === 0) {
                toast.error(t('purchaseOrders.noItemsToReceive') || 'No items to receive');
                setIsReceiving(false);
                return;
            }

            const response = await apiClient.updatePurchaseOrderStatus(
                receivingOrder.id,
                'PARTIALLY_RECEIVED',
                organizationId,
                {
                    branchId: branchIdForReceive,
                    receivedItems,
                }
            );

            if (response) {
                setOrders(prevOrders =>
                    prevOrders.map(order =>
                        String(order.id) === String(receivingOrder.id)
                            ? { ...order, status: response.status || 'PARTIALLY_RECEIVED' }
                            : order
                    )
                );
                if (String(selectedOrder?.id) === String(receivingOrder.id)) {
                    setSelectedOrder(prev => prev ? { ...prev, status: response.status || 'PARTIALLY_RECEIVED' } : null);
                }
                toast.success(t('purchaseOrders.itemsReceived') || 'Items received successfully');
                setReceiveModalOpen(false);
                setReceivingOrder(null);
            } else {
                throw new Error(t('purchaseOrders.updateError'));
            }
        } catch (err) {
            console.error('Error receiving items:', err);
            const errorMessage = err instanceof Error ? err.message : t('purchaseOrders.updateError');
            toast.error(`${t('common.error')}: ${errorMessage}`);
        } finally {
            setIsReceiving(false);
        }
    };

    const getStatusStyles = (status: string) => {
        switch (status.toUpperCase()) {
            case 'COMPLETED':
                return {
                    bg: 'bg-green-100 dark:bg-green-900/30',
                    text: 'text-green-700 dark:text-green-400',
                    icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
                    label: t('common.completed')
                };
            case 'APPROVED':
                return {
                    bg: 'bg-sky-100 dark:bg-sky-900/30',
                    text: 'text-sky-700 dark:text-sky-400',
                    icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
                    label: t('common.approved') || 'Approved'
                };
            case 'PARTIALLY_RECEIVED':
                return {
                    bg: 'bg-orange-100 dark:bg-orange-900/30',
                    text: 'text-orange-700 dark:text-orange-400',
                    icon: <Package className="h-3 w-3 mr-1" />,
                    label: t('common.partiallyReceived') || 'Partial'
                };
            case 'PROCESSING':
                return {
                    bg: 'bg-blue-100 dark:bg-blue-900/30',
                    text: 'text-blue-700 dark:text-blue-400',
                    icon: <Clock className="h-3 w-3 mr-1" />,
                    label: t('common.processing')
                };
            case 'CANCELLED':
                return {
                    bg: 'bg-red-100 dark:bg-red-900/30',
                    text: 'text-red-700 dark:text-red-400',
                    icon: <XCircle className="h-3 w-3 mr-1" />,
                    label: t('common.cancelled')
                };
            default:
                return {
                    bg: 'bg-amber-100 dark:bg-amber-900/30',
                    text: 'text-amber-700 dark:text-amber-400',
                    icon: <Clock className="h-3 w-3 mr-1" />,
                    label: t('common.pending')
                };
        }
    };

    if (loading) {
        return (
            <div className={`p-4 min-h-screen ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50/50'}`}>
                <div className="max-w-7xl mx-auto space-y-6">
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-48 animate-pulse"></div>
                            <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-32 animate-pulse"></div>
                        </div>
                        <div className="h-9 bg-gray-200 dark:bg-gray-800 rounded w-36 animate-pulse"></div>
                    </div>
                    <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded w-full max-w-md animate-pulse"></div>
                    <Card className="border border-gray-200 dark:border-gray-700 shadow-sm rounded-md overflow-hidden">
                        <TableSkeleton rows={8} columns={7} />
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className={`p-4 min-h-screen ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-50/50 text-gray-900'} transition-colors duration-200`}>
            <ConfirmDialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                onConfirm={handleDelete}
                title={t('common.confirmDelete') || "Confirm Deletion"}
                message={`${t('messages.confirmDeleteOrder') || "Are you sure you want to delete this order"} #${orderToDelete}?`}
                confirmText={t('common.delete') || "Delete"}
                variant="destructive"
                loading={isDeleting}
            />

        <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-lg mb-6">
                    <div className="pointer-events-none absolute inset-0 bg-black/10" />
                    <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                                <Package className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">{t('purchaseOrders.title')}</h1>
                                <p className="text-sm text-white/70 mt-0.5">{t('purchaseOrders.description')}</p>
                            </div>
                        </div>
                        <Button
                            onClick={() => navigate('/dashboard/orders/new')}
                            className="gap-2 bg-white text-blue-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto"
                        >
                            <Plus className="h-4 w-4" />
                            {t('purchaseOrders.newOrder')}
                        </Button>
                    </div>
                    <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
                    <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
                </div>

                {/* Search & Filters Bar */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1 group">
                        <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 transition-colors duration-200 ${searchTerm ? 'text-blue-500' : 'text-gray-400 group-focus-within:text-blue-500'
                            }`} />
                        <input
                            type="text"
                            placeholder={t('purchaseOrders.searchPlaceholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={`w-full pl-9 pr-9 h-10 border rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm shadow-sm ${theme === 'dark'
                                ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
                                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 hover:border-gray-300'
                                }`}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Orders Table Card */}
                <Card className={`border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden rounded-md ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'
                    }`}>
                    <CardContent className="p-0">
                        {error ? (
                            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-full mb-3">
                                    <AlertCircle className="h-8 w-8 text-red-500" />
                                </div>
                                <h3 className="text-lg font-bold mb-1">{t('common.error')}</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">{error}</p>
                                <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="mt-4 rounded-md">
                                    {t('common.refresh')}
                                </Button>
                            </div>
                        ) : filteredOrders.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                                <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-full mb-4 border border-dashed border-gray-200 dark:border-gray-700">
                                    <Package className="h-10 w-10 text-gray-300" />
                                </div>
                                <h3 className="text-lg font-bold mb-1">{t('purchaseOrders.noOrdersFound')}</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                                    {searchTerm ? t('common.noSearchResults') : t('purchaseOrders.noOrdersFoundDesc') || 'No purchase orders yet.'}
                                </p>
                                {!searchTerm && (
                                    <Button size="sm" onClick={() => navigate('/dashboard/orders/new')} className="mt-6 rounded-md px-6 h-9 font-semibold shadow-sm bg-blue-600 hover:bg-blue-700 text-white">
                                        {t('purchaseOrders.createOrder')}
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className={`text-[10px] font-bold uppercase tracking-wider border-b ${theme === 'dark' ? 'bg-gray-800/50 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
                                            }`}>
                                            <th className="px-4 py-3">{t('common.id')}</th>
                                            <th className="px-4 py-3">{t('purchaseOrders.orderNumber')}</th>
                                            <th className="px-4 py-3">{t('purchaseOrders.supplier')}</th>
                                            <th className="px-4 py-3">{t('purchaseOrders.orderItems')}</th>
                                            <th className="px-4 py-3">{t('common.date')}</th>
                                            <th className="px-4 py-3">{t('common.total')}</th>
                                            <th className="px-4 py-3">{t('common.status')}</th>
                                            <th className="px-4 py-3 text-right">{t('common.actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                                        {filteredOrders.map((order) => {
                                            const status = getStatusStyles(order.status);
                                            return (
                                                <tr
                                                    key={order.id}
                                                    onClick={() => setSelectedOrder(order)}
                                                    className={`group cursor-pointer transition-colors ${theme === 'dark' ? 'hover:bg-gray-700/30' : 'hover:bg-blue-50/20'
                                                        }`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 group-hover:text-blue-600 transition-colors">
                                                            #{String(order.id).slice(0, 8)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`p-1.5 rounded-md transition-colors ${theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100 group-hover:bg-blue-100'
                                                                }`}>
                                                                <Package className={`h-3.5 w-3.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500 group-hover:text-blue-600'}`} />
                                                            </div>
                                                            <span className="font-bold font-mono text-xs tracking-tighter text-blue-600 dark:text-blue-400 hover:underline">
                                                                {order.orderNumber}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col">
                                                            <span className="font-semibold text-xs">{order.supplier.name}</span>
                                                            <span className="text-[9px] text-gray-400 uppercase font-bold tracking-tight">{order.supplier.email || 'N/A'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 dark:text-gray-300">
                                                            {order.items.length} {t('purchaseOrders.items').toLowerCase()}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-medium">{format(new Date(order.orderedAt), 'MMM d, yyyy')}</span>
                                                            <span className="text-[9px] text-gray-400 font-mono italic">{format(new Date(order.orderedAt), 'HH:mm')}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col items-start">
                                                            <span className="font-bold text-xs text-blue-600 dark:text-blue-400">
                                                                {parseInt(order.totalAmount).toLocaleString()}
                                                            </span>
                                                            <span className="text-[8px] font-black text-gray-400 tracking-tighter uppercase">{t('common.currencyRwf')}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Badge className={`${status.bg} ${status.text} border-none font-bold px-2 py-0.5 rounded-md text-[9px] uppercase tracking-tighter`}>
                                                            {status.icon}
                                                            {status.label}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 h-7 w-7">
                                                                    <MoreVertical className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-48 rounded-md p-1 shadow-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg">
                                                                <DropdownMenuLabel className="text-[9px] uppercase font-black tracking-widest text-gray-400 px-2 py-1.5">
                                                                    {t('common.actions')}
                                                                </DropdownMenuLabel>
                                                                <DropdownMenuItem onClick={() => setSelectedOrder(order)} className="rounded-md px-2 py-1.5 gap-2 cursor-pointer text-xs">
                                                                    <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                                                                    <span className="font-semibold">{t('purchaseOrders.orderDetails')}</span>
                                                                </DropdownMenuItem>
                                                                {['APPROVED', 'PARTIALLY_RECEIVED'].includes(order.status) && (
                                                                    <>
                                                                        <DropdownMenuSeparator className="my-1" />
                                                                        <DropdownMenuItem
                                                                            onSelect={() => handleReceiveOpen(order)}
                                                                            className="rounded-md px-2 py-1.5 gap-2 cursor-pointer text-xs text-green-600 focus:text-green-600 focus:bg-green-50 dark:focus:bg-green-900/20"
                                                                        >
                                                                            <Package className="h-3.5 w-3.5" />
                                                                            <span className="font-semibold">{t('purchaseOrders.receive') || 'Receive'}</span>
                                                                        </DropdownMenuItem>
                                                                    </>
                                                                )}
                                                                <DropdownMenuSeparator className="my-1" />

                                                                {['PENDING', 'APPROVED', 'PROCESSING', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED']
                                                                    .filter(s => s !== order.status)
                                                                    .map((s) => {
                                                                        const styles = getStatusStyles(s);
                                                                        return (
                                                                            <DropdownMenuItem
                                                                                key={s}
                                                                                onSelect={() => handleStatusUpdate(order.id, s)}
                                                                                disabled={updatingStatus[order.id]}
                                                                                className="rounded-md px-2 py-1.5 gap-2 cursor-pointer text-xs"
                                                                            >
                                                                                {updatingStatus[order.id] ? (
                                                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                                                                ) : (
                                                                                    <div className={`${styles.text}`}>
                                                                                        {styles.icon}
                                                                                    </div>
                                                                                )}
                                                                                <span className="font-semibold">
                                                                                    {t('purchaseOrders.markAs', { status: styles.label })}
                                                                                </span>
                                                                            </DropdownMenuItem>
                                                                        );
                                                                    })}

                                                                <DropdownMenuSeparator className="my-1" />
                                                                <DropdownMenuItem
                                                                    onSelect={() => handleDeleteClick(order.id)}
                                                                    className="rounded-md px-2 py-1.5 gap-2 cursor-pointer text-xs text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                    <span className="font-semibold">{t('common.delete')}</span>
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Improved Order Details Modal */}
            <Drawer open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
                <DrawerContent className={`max-w-3xl p-0 overflow-hidden border-none shadow-xl rounded-md ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'
                    }`}>
                    {selectedOrder && (
                        <>
                            <div className="relative">
                                {/* Modal Header Accent */}
                                <div className={`h-20 w-full absolute top-0 left-0 ${selectedOrder.status === 'COMPLETED' ? 'bg-green-600' :
                                    selectedOrder.status === 'CANCELLED' ? 'bg-red-600' :
                                        'bg-blue-600'
                                    }`} />

                                <div className="relative pt-8 px-6 pb-4">
                                    <div className={`p-5 rounded-md shadow-lg flex flex-col md:flex-row justify-between gap-4 ${theme === 'dark' ? 'bg-gray-800' : 'bg-white border border-gray-100'
                                        }`}>
                                        <div className="space-y-3">
                                            <div className="space-y-0.5">
                                                <div className="flex items-center gap-2">
                                                    <Badge className={`${getStatusStyles(selectedOrder.status).bg} ${getStatusStyles(selectedOrder.status).text} border-none font-bold rounded-md px-2 py-0.5 text-[9px] uppercase tracking-tight`}>
                                                        {getStatusStyles(selectedOrder.status).icon}
                                                        {getStatusStyles(selectedOrder.status).label}
                                                    </Badge>
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                                        {t('purchaseOrders.orderInformation')}
                                                    </span>
                                                </div>
                                                <h2 className="text-xl font-bold tracking-tight">{selectedOrder.orderNumber}</h2>
                                            </div>

                                            <div className="flex flex-wrap gap-4">
                                                <div className="space-y-0.5">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t('common.date')}</p>
                                                    <p className="font-semibold text-xs flex items-center gap-1">
                                                        <Calendar className="h-3 w-3 text-blue-500" />
                                                        {format(new Date(selectedOrder.orderedAt), 'MMMM d, yyyy')}
                                                    </p>
                                                </div>
                                                <div className="space-y-0.5">
                                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t('purchaseOrders.expectedDelivery')}</p>
                                                    <p className="font-semibold text-xs flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                                        <Truck className="h-3 w-3" />
                                                        {selectedOrder.expectedDeliveryDate
                                                            ? format(new Date(selectedOrder.expectedDeliveryDate), 'MMMM d, yyyy')
                                                            : 'TBD'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className={`p-4 rounded-md border flex flex-col justify-center items-end min-w-[160px] ${theme === 'dark' ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-50 border-gray-100'
                                            }`}>
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">{t('purchaseOrders.orderTotal')}</p>
                                            <div className="text-right">
                                                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400 leading-none">
                                                    {parseInt(selectedOrder.totalAmount).toLocaleString()}
                                                </span>
                                                <span className="text-xs font-black text-gray-400 ml-1">{t('common.currencyRwf')}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="px-6 pb-6 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Supplier Section */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-1.5 px-1">
                                            <User className="h-3.5 w-3.5 text-blue-500" />
                                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('purchaseOrders.supplierInfo')}</h3>
                                        </div>
                                        <div className={`p-4 rounded-md border transition-all ${theme === 'dark' ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-100 hover:bg-white hover:shadow-sm'
                                            }`}>
                                            <p className="text-base font-bold leading-tight mb-0.5">{selectedOrder.supplier.name}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-2.5">
                                                {selectedOrder.supplier.email || 'No email provided'}
                                            </p>
                                            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">{t('common.phone')}</p>
                                                <p className="font-semibold text-xs tracking-tight">{selectedOrder.supplier.phone || 'No phone provided'}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Order Status Summary */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-1.5 px-1">
                                            <Clock className="h-3.5 w-3.5 text-blue-500" />
                                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('purchaseOrders.orderSummary')}</h3>
                                        </div>
                                        <div className={`p-4 rounded-md border ${theme === 'dark' ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-100'
                                            }`}>
                                            <div className="space-y-2.5">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('purchaseOrders.itemsCount', { count: selectedOrder.items.length })}</span>
                                                    <span className="font-bold text-xs">{selectedOrder.items.length}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('common.status')}</span>
                                                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 ${getStatusStyles(selectedOrder.status).text}`}>
                                                        {selectedOrder.status}
                                                    </span>
                                                </div>
                                                <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
                                                    <span className="text-xs font-bold">{t('purchaseOrders.subtotal')}</span>
                                                    <span className="font-bold text-sm text-blue-600 dark:text-blue-400">
                                                        {parseInt(selectedOrder.totalAmount).toLocaleString()} {t('common.currencyRwf')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Items Table */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between px-1">
                                        <div className="flex items-center gap-1.5">
                                            <Package className="h-3.5 w-3.5 text-blue-500" />
                                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('purchaseOrders.orderItems')}</h3>
                                        </div>
                                        <Badge variant="outline" className="font-bold text-[9px] tracking-widest rounded-md px-1.5 py-0">
                                            {selectedOrder.items.length} {t('common.totalItems')}
                                        </Badge>
                                    </div>

                                    <div className={`rounded-md border overflow-hidden ${theme === 'dark' ? 'border-gray-700' : 'border-gray-100 shadow-sm'
                                        }`}>
                                        <ScrollArea className="max-h-48 w-full">
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className={`text-[9px] font-black uppercase tracking-widest border-b ${theme === 'dark' ? 'bg-gray-800/50 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
                                                        }`}>
                                                        <th className="px-4 py-2.5">{t('purchaseOrders.itemName')}</th>
                                                        <th className="px-4 py-2.5 text-right">{t('purchaseOrders.quantityShort')}</th>
                                                        <th className="px-4 py-2.5 text-right">{t('purchaseOrders.unitPrice')}</th>
                                                        <th className="px-4 py-2.5 text-right">{t('common.total')}</th>
                                                    </tr>
                                                </thead>
                                                <tbody className={`divide-y ${theme === 'dark' ? 'divide-gray-700' : 'divide-gray-100'}`}>
                                                    {selectedOrder.items.map((item) => (
                                                        <tr key={item.id} className={`${theme === 'dark' ? 'bg-gray-800/20' : 'bg-white'}`}>
                                                            <td className="px-4 py-2 font-semibold text-xs tracking-tight">{item.productName}</td>
                                                            <td className="px-4 py-2 text-right font-mono text-xs">
                                                                <span className={item.quantityReceived !== undefined ? 'text-orange-600 dark:text-orange-400' : ''}>
                                                                    {item.quantityReceived !== undefined ? `${item.quantityReceived}/${item.quantity}` : item.quantity}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2 text-right font-mono text-[11px] text-gray-500">{parseInt(item.unitPrice).toLocaleString()}</td>
                                                            <td className="px-4 py-2 text-right font-bold text-xs text-blue-600 dark:text-blue-400">
                                                                {parseInt(item.totalPrice).toLocaleString()}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </ScrollArea>
                                    </div>
                                </div>
                            </div>

                            <DrawerFooter className={`p-4 gap-2 ${theme === 'dark' ? 'bg-gray-800/50 border-t border-gray-700' : 'bg-gray-50 border-t border-gray-100'}`}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedOrder(null)}
                                    className="rounded-md font-bold px-4 h-8 text-xs"
                                >
                                    {t('common.close')}
                                </Button>
                                <div className="flex gap-2 ml-auto">
                                    {['APPROVED', 'PARTIALLY_RECEIVED'].includes(selectedOrder.status) && (
                                        <Button
                                            size="sm"
                                            onClick={() => { setSelectedOrder(null); handleReceiveOpen(selectedOrder); }}
                                            className="rounded-md font-bold px-4 h-8 bg-green-600 hover:bg-green-700 text-white text-xs gap-1 shadow-sm"
                                        >
                                            <Package className="h-3.5 w-3.5" />
                                            {t('purchaseOrders.receive') || 'Receive'}
                                        </Button>
                                    )}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button size="sm" className="rounded-md font-bold px-4 h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1 shadow-sm">
                                                {t('purchaseOrders.markAs', { status: '' })} <ChevronRight className="h-3.5 w-3.5" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-44 rounded-md p-1 shadow-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg">
                                            {['PENDING', 'APPROVED', 'PROCESSING', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED']
                                                .filter(s => s !== selectedOrder.status)
                                                .map((s) => {
                                                    const styles = getStatusStyles(s);
                                                    return (
                                                        <DropdownMenuItem
                                                            key={s}
                                                            onSelect={() => handleStatusUpdate(selectedOrder.id, s)}
                                                            className="rounded-md px-2 py-1.5 gap-2 cursor-pointer text-xs"
                                                        >
                                                            <div className={styles.text}>{styles.icon}</div>
                                                            <span className="font-semibold">{styles.label}</span>
                                                        </DropdownMenuItem>
                                                    );
                                                })}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </DrawerFooter>
                        </>
                    )}
                </DrawerContent>
            </Drawer>

            {/* Receive Items Modal */}
            <Drawer open={receiveModalOpen} onOpenChange={(open) => { if (!open) { setReceiveModalOpen(false); setReceivingOrder(null); } }}>
                <DrawerContent className={`max-w-3xl p-0 overflow-hidden border-none shadow-xl rounded-md ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}>
                    {receivingOrder && (
                        <>
                            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-bold">{t('purchaseOrders.receiveItems') || 'Receive Items'}</h2>
                                    <button onClick={() => { setReceiveModalOpen(false); setReceivingOrder(null); }} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    {receivingOrder.orderNumber}
                                </p>
                            </div>

                            <div className="p-6">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className={`text-[9px] font-black uppercase tracking-widest border-b ${theme === 'dark' ? 'border-gray-700 text-gray-400' : 'border-gray-100 text-gray-500'}`}>
                                            <th className="px-4 py-2.5">{t('purchaseOrders.itemName')}</th>
                                            <th className="px-4 py-2.5 text-right">{t('purchaseOrders.orderedQty') || 'Ordered'}</th>
                                            <th className="px-4 py-2.5 text-right">{t('purchaseOrders.previouslyReceived') || 'Received'}</th>
                                            <th className="px-4 py-2.5 text-right">{t('purchaseOrders.quantityToReceive') || 'To Receive'}</th>
                                            <th className="px-4 py-2.5 text-right">{t('purchaseOrders.sellingPrice') || 'Selling Price'}</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-gray-700' : 'divide-gray-100'}`}>
                                        {receivingOrder.items.map((item) => {
                                            const alreadyReceived = item.quantityReceived || 0;
                                            const remaining = item.quantity - alreadyReceived;
                                            return (
                                                <tr key={item.id} className={`${theme === 'dark' ? 'bg-gray-800/20' : 'bg-white'}`}>
                                                    <td className="px-4 py-3 font-semibold text-xs tracking-tight">{item.productName}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-xs">{item.quantity}</td>
                                                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-500">{alreadyReceived}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={remaining}
                                                            value={receivingQuantities[item.id] ?? remaining}
                                                            onChange={(e) => {
                                                                const val = Math.min(remaining, Math.max(0, parseInt(e.target.value) || 0));
                                                                setReceivingQuantities(prev => ({ ...prev, [item.id]: val }));
                                                            }}
                                                            className="w-20 text-right px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            inputMode="decimal"
                                                            value={receivingPrices[item.id] ?? ''}
                                                            onChange={(e) => setReceivingPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                            placeholder={t('purchaseOrders.keepCurrentPrice') || 'Keep current'}
                                                            disabled={!(item as any).productId}
                                                            className="w-28 text-right px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                                        />
                                                        {Number(receivingPrices[item.id]) > 0 && Number(receivingPrices[item.id]) < Number(item.unitPrice) && (
                                                            <div className="mt-1 text-[10px] text-amber-600">{t('purchaseOrders.belowCost') || 'Below cost'}</div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <DrawerFooter className={`p-4 gap-2 ${theme === 'dark' ? 'bg-gray-800/50 border-t border-gray-700' : 'bg-gray-50 border-t border-gray-100'}`}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setReceiveModalOpen(false); setReceivingOrder(null); }}
                                    className="rounded-md font-bold px-4 h-8 text-xs"
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleReceiveConfirm}
                                    disabled={isReceiving}
                                    className="rounded-md font-bold px-4 h-8 bg-green-600 hover:bg-green-700 text-white text-xs gap-1 shadow-sm"
                                >
                                    {isReceiving ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Package className="h-3.5 w-3.5" />
                                    )}
                                    {isReceiving ? t('common.receiving') || 'Receiving...' : t('purchaseOrders.confirmReceive') || 'Confirm Receive'}
                                </Button>
                            </DrawerFooter>
                        </>
                    )}
                </DrawerContent>
            </Drawer>
        </div>
    );
};

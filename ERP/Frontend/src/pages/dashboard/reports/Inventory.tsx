import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, AlertTriangle, Search, Clock, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { UserOptions } from 'jspdf-autotable';
import 'jspdf-autotable';
import { apiClient } from "../../../lib/api-client";
import { useBranch } from '../../../context/BranchContext';
import { useDebounce } from '../../../hooks/use-debounce';
import { TableSkeleton } from '../../../components/ui/TableSkeleton';
import { type ProductsReport } from '../../../types';




export const InventoryReport = () => {
    const { t } = useTranslation();
    const { selectedBranchId } = useBranch();
    const [inventoryData, setInventoryData] = useState<ProductsReport[]>([]);
    const [summary, setSummary] = useState({
        totalValue: 0,
        totalItems: 0,
        criticalItems: 0,
        lowStockItems: 0
    });
    const [categories, setCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 500);
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [selectedProduct, setSelectedProduct] = useState<ProductsReport | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const prepareExportData = () => {
        return filteredInventory.map(item => ({
            [t('inventory.product')]: item.product,
            'SKU': item.sku,
            [t('cashFlowReport.category')]: item.category,
            [t('inventoryReport.currentStock')]: item.currentStock,
            [t('inventoryReport.prev')]: item.previousStock,
            [t('inventory.minStock')]: item.minStock,
            [t('inventory.maxStock')]: item.maxStock,
            [t('salesReport.unitPrice')]: item.unitPrice,
            [t('inventoryReport.value')]: (item.currentStock * item.unitPrice).toFixed(2) + ' Frw',
            [t('common.status')]: t(`inventoryReport.${getStockStatus(item) === 'in-stock' ? 'inStock' : getStockStatus(item) === 'out-of-stock' ? 'outOfStock' : getStockStatus(item) === 'critical' ? 'criticalStock' : getStockStatus(item) === 'low' ? 'lowStock' : getStockStatus(item) === 'overstocked' ? 'overstocked' : getStockStatus(item) + 'Stock'}`)
        }));
    };

    const exportToExcel = () => {
        const data: any[] = prepareExportData();

        // Calculate totals
        const totalStock = filteredInventory.reduce((sum, item) => sum + item.currentStock, 0);
        const totalValue = filteredInventory.reduce((sum, item) => sum + (item.currentStock * item.unitPrice), 0);

        // Append totals row
        data.push({
            [t('inventory.product')]: t('common.total').toUpperCase(),
            'SKU': '',
            [t('cashFlowReport.category')]: '',
            [t('inventoryReport.currentStock')]: totalStock,
            [t('inventoryReport.prev')]: '',
            [t('inventory.minStock')]: '',
            [t('inventory.maxStock')]: '',
            [t('salesReport.unitPrice')]: '',
            [t('inventoryReport.value')]: totalValue.toLocaleString() + ' Frw',
            [t('common.status')]: ''
        });

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory Report');

        // Auto-size columns
        const wscols = [
            { wch: 25 }, // Product
            { wch: 15 }, // SKU
            { wch: 20 }, // Category
            { wch: 15 }, // Current Stock
            { wch: 15 }, // Previous Stock
            { wch: 12 }, // Min Stock
            { wch: 12 }, // Max Stock
            { wch: 12 }, // Unit Price
            { wch: 15 }, // Stock Value
            { wch: 15 }, // Status
        ];
        worksheet['!cols'] = wscols;

        XLSX.writeFile(workbook, `inventory_report_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const exportToPdf = () => {
        const data = prepareExportData();
        const doc = new jsPDF('landscape') as jsPDF & { autoTable: (options: UserOptions) => void };
        const date = new Date().toLocaleDateString();

        // Calculate totals
        const totalStock = filteredInventory.reduce((sum, item) => sum + item.currentStock, 0);
        const totalValue = filteredInventory.reduce((sum, item) => sum + (item.currentStock * item.unitPrice), 0);

        // Add title and date
        doc.setFontSize(18);
        doc.text(t('inventoryReport.title'), 14, 20);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated on: ${date}`, 14, 28);

        // Add the data table
        autoTable(doc, {
            head: [[t('inventory.product'), 'SKU', t('cashFlowReport.category'), t('inventoryReport.currentStock'), t('inventory.minStock'), t('inventory.maxStock'), t('salesReport.unitPrice'), t('inventoryReport.value'), t('common.status')]],
            body: data.map(item => [
                item[t('inventory.product')],
                item['SKU'],
                item[t('cashFlowReport.category')],
                item[t('inventoryReport.currentStock')],
                item[t('inventory.minStock')],
                item[t('inventory.maxStock')],
                item[t('salesReport.unitPrice')],
                item[t('inventoryReport.value')],
                item[t('common.status')]
            ]),
            foot: [[
                t('common.total').toUpperCase(),
                '',
                '',
                totalStock,
                '',
                '',
                '',
                totalValue.toLocaleString() + ' Frw',
                ''
            ]],
            startY: 35,
            styles: {
                fontSize: 8,
                cellPadding: 2,
                overflow: 'linebreak',
                cellWidth: 'wrap',
                valign: 'middle',
                halign: 'left',
            },
            headStyles: {
                fillColor: [41, 128, 185],
                textColor: 255,
                fontStyle: 'bold',
            },
            footStyles: {
                fillColor: [240, 240, 240],
                textColor: 0,
                fontStyle: 'bold',
            },
            columnStyles: {
                3: { halign: 'right' }, // Current Stock
                4: { halign: 'right' }, // Min Stock
                5: { halign: 'right' }, // Max Stock
                6: { halign: 'right' }, // Unit Price
                7: { halign: 'right' }, // Stock Value
            },
            alternateRowStyles: {
                fillColor: [245, 245, 245]
            },
        });

        // Save the PDF
        doc.save(`inventory_report_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    const getStockStatus = (item: ProductsReport): string => {
        if (item.currentStock <= 0) return 'out-of-stock';
        if (item.currentStock <= item.minStock * 0.3) return 'critical';
        if (item.currentStock <= item.minStock) return 'low';
        if (item.currentStock > item.maxStock) return 'overstocked';
        return 'in-stock';
    };

    useEffect(() => {
        const fetchInventory = async () => {
            try {
                setLoading(true);
                const queryParams: Record<string, string> = {};
                if (debouncedSearchTerm) queryParams.search = debouncedSearchTerm;
                if (filterCategory !== 'all') queryParams.category = filterCategory;
                if (filterStatus !== 'all') queryParams.status = filterStatus;
                if (selectedBranchId !== null) queryParams.branchId = selectedBranchId.toString();

                const response = await apiClient.getInventoryReport(queryParams);


                setInventoryData(response.inventoryData || []);
                setSummary({
                    totalValue: response.summary?.totalValue || 0,
                    totalItems: response.summary?.totalItems || 0,
                    criticalItems: response.summary?.criticalItems || 0,
                    lowStockItems: response.summary?.lowStockItems || 0
                });
                setCategories(response.categories || []);
                setError(null);
            } catch (err) {
                console.error('Error fetching inventory:', err);
                setError(t('inventoryReport.errorLoading'));
            } finally {
                setLoading(false);
            }
        };

        fetchInventory();
    }, [debouncedSearchTerm, filterCategory, filterStatus, selectedBranchId]);

    const filteredInventory = useMemo(() => {
        return inventoryData.filter(item => {
            const matchesSearch = searchTerm === '' ||
                item.product.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.sku.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesCategory = filterCategory === 'all' || item.category === filterCategory;

            const matchesStatus = filterStatus === 'all' ||
                (filterStatus === 'critical' && item.status === 'critical') ||
                (filterStatus === 'low' && (item.status === 'low' || item.status === 'critical')) ||
                (filterStatus === 'normal' && item.status === 'normal') ||
                (filterStatus === 'high' && item.status === 'high');

            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [inventoryData, searchTerm, filterCategory, filterStatus]);

    const paginatedInventory = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return filteredInventory.slice(startIndex, startIndex + itemsPerPage);
    }, [filteredInventory, currentPage, itemsPerPage]);

    const totalPages = Math.ceil(filteredInventory.length / itemsPerPage);

    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, filterCategory, filterStatus]);

    const getStockChange = (item: ProductsReport) => {
        return item.currentStock - item.previousStock;
    };
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'critical': return 'text-red-600 bg-red-100';
            case 'low': return 'text-orange-600 bg-orange-100';
            case 'high': return 'text-blue-600 bg-blue-100';
            case 'normal':
            default: return 'text-green-600 bg-green-100';
        }
    };


    if (loading) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-700">
                {loading ? (
                    <TableSkeleton
                        rows={8}
                        columns={8}
                        className="w-full"
                        rowHeight="h-4"
                    />
                ) : (
                    <></>
                )}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 sm:p-6">
                <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                        </div>
                        <div className="ml-3">
                            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                                {t('inventoryReport.errorLoading')}
                            </h3>
                            <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                                <p>{error}</p>
                            </div>
                            <div className="mt-4">
                                <button
                                    type="button"
                                    onClick={() => setLoading(true)}
                                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/40"
                                >
                                    {t('inventoryReport.tryAgain')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-4 md:p-6">
            {/* Page Header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-lg">
                <div className="pointer-events-none absolute inset-0 bg-black/10" />
                <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                            <TrendingUp className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">{t('inventoryReport.title') || 'Inventory Report'}</h1>
                            <p className="text-sm text-white/70 mt-0.5">
                                Monitor your stock levels, item values, and identify reorder points
                            </p>
                        </div>
                    </div>
                </div>
                <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
                <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    {
                        label: t('inventoryReport.totalValue'),
                        value: `${summary.totalValue.toLocaleString()} Frw`,
                        icon: TrendingUp,
                        light: 'bg-emerald-50 dark:bg-emerald-900/20',
                        text: 'text-emerald-600 dark:text-emerald-400',
                    },
                    {
                        label: t('inventoryReport.totalItems'),
                        value: summary.totalItems,
                        icon: Clock,
                        light: 'bg-blue-50 dark:bg-blue-900/20',
                        text: 'text-blue-600 dark:text-blue-400',
                    },
                    {
                        label: t('inventoryReport.lowStockItems'),
                        value: summary.lowStockItems,
                        icon: AlertTriangle,
                        light: 'bg-orange-50 dark:bg-orange-900/20',
                        text: 'text-orange-600 dark:text-orange-400',
                    },
                    {
                        label: t('inventoryReport.criticalStockItems'),
                        value: summary.criticalItems,
                        icon: AlertTriangle,
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

            {/* Filter Bar */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
                <div className="flex flex-col lg:flex-row justify-between gap-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-grow">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                            <input
                                type="text"
                                placeholder={t('inventoryReport.searchPlaceholder')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-205 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-850 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                            />
                        </div>

                        <div>
                            <select
                                value={filterCategory}
                                onChange={(e) => setFilterCategory(e.target.value)}
                                className="w-full border border-gray-205 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                            >
                                <option value="all">{t('inventoryReport.allCategories')}</option>
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="w-full border border-gray-205 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                            >
                                <option value="all">{t('inventoryReport.allStatus')}</option>
                                <option value="critical">{t('inventoryReport.criticalStock')}</option>
                                <option value="low">{t('inventoryReport.lowStock')}</option>
                                <option value="normal">{t('inventoryReport.normalStock')}</option>
                                <option value="high">{t('inventoryReport.highStock')}</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => exportToExcel()}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-xs"
                        >
                            <Download size={13} />
                            Excel
                        </button>
                        <button
                            onClick={exportToPdf}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-xs"
                        >
                            <Download size={13} />
                            PDF
                        </button>
                    </div>
                </div>
            </div>

            {/* Table Card */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 text-left">
                            <tr>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">ID</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('inventory.product')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('cashFlowReport.category')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">{t('inventoryReport.prev')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">{t('inventoryReport.currentStock')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">{t('inventory.minStock')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">{t('inventory.maxStock')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">{t('inventoryReport.change')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">{t('common.status')}</th>
                                <th className="py-3 px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">{t('inventoryReport.value')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {paginatedInventory.map((item: any) => {
                                const stockChange = getStockChange(item);
                                const status = getStockStatus(item);
                                const stockValue = item.currentStock * item.unitPrice;

                                return (
                                    <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition border-b border-gray-100 dark:border-gray-700">
                                        <td className="py-3 px-4 text-xs font-mono text-gray-500 dark:text-gray-400">#{item.id}</td>
                                        <td className="py-3 px-4 font-semibold text-gray-900 dark:text-white">{item.product}</td>
                                        <td className="py-3 px-4 whitespace-nowrap">
                                            <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                                                {item.category}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right font-medium text-gray-700 dark:text-gray-300">{item.previousStock.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-right font-semibold text-gray-900 dark:text-white">{item.currentStock.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-right text-gray-500 dark:text-gray-400">{item.minStock.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-right text-gray-500 dark:text-gray-400">{item.maxStock.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-center">
                                            <div className={`flex items-center justify-center gap-1 font-semibold text-xs ${stockChange > 0 ? 'text-green-600 dark:text-green-400' : stockChange < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                                                {stockChange > 0 ? (
                                                    <TrendingUp size={13} />
                                                ) : stockChange < 0 ? (
                                                    <TrendingDown size={13} />
                                                ) : null}
                                                <span>
                                                    {stockChange > 0 ? '+' : ''}{stockChange}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 text-center whitespace-nowrap">
                                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${getStatusColor(status)}`}>
                                                {status === 'critical' && <AlertTriangle size={11} />}
                                                {t(`inventoryReport.${status === 'in-stock' ? 'inStock' : status === 'out-of-stock' ? 'outOfStock' : status === 'critical' ? 'criticalStock' : status === 'low' ? 'lowStock' : status === 'overstocked' ? 'overstocked' : status + 'Stock'}`)}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right font-bold text-gray-900 dark:text-white font-mono">
                                            {stockValue.toLocaleString()} <span className="text-xxs font-medium text-gray-400">RWF</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-gray-50/50 dark:bg-gray-750/50 font-semibold border-t border-gray-200 dark:border-gray-600">
                            <tr className="text-gray-900 dark:text-white">
                                <td className="py-3 px-4" colSpan={3}>
                                    {t('common.total').toUpperCase()}
                                </td>
                                <td className="py-3 px-4 text-right font-bold">
                                    {filteredInventory.reduce((sum, item) => sum + item.previousStock, 0).toLocaleString()}
                                </td>
                                <td className="py-3 px-4 text-right font-bold">
                                    {filteredInventory.reduce((sum, item) => sum + item.currentStock, 0).toLocaleString()}
                                </td>
                                <td className="py-3 px-4 text-right">
                                    {filteredInventory.reduce((sum, item) => sum + item.minStock, 0).toLocaleString()}
                                </td>
                                <td className="py-3 px-4 text-right">
                                    {filteredInventory.reduce((sum, item) => sum + item.maxStock, 0).toLocaleString()}
                                </td>
                                <td className="py-3 px-4" colSpan={2}></td>
                                <td className="py-3 px-4 text-right font-bold text-blue-600 dark:text-blue-400 font-mono">
                                    {filteredInventory.reduce((sum, item) => sum + (item.currentStock * item.unitPrice), 0).toLocaleString()} <span className="text-xxs font-semibold">RWF</span>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xs gap-4">
                    <div className="flex items-center gap-6 w-full sm:w-auto justify-between">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                            {t('common.showing')} <span className="font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-semibold">{Math.min(currentPage * itemsPerPage, filteredInventory.length)}</span> of <span className="font-semibold">{filteredInventory.length}</span> {t('inventoryReport.results').toLowerCase()}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('common.rowsPerPage')}:</span>
                            <select
                                className="border border-gray-300 dark:border-gray-650 rounded-lg px-2 py-1 text-sm bg-white dark:bg-gray-750 dark:text-white focus:outline-none"
                                value={itemsPerPage}
                                onChange={(e) => {
                                    setItemsPerPage(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                            >
                                {[10, 20, 50, 100].map(size => (
                                    <option key={size} value={size}>{size}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {t('common.previous')}
                        </button>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {t('common.next')}
                        </button>
                    </div>
                </div>
            )}

            {/* Product detail Modal */}
            {selectedProduct && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden dark:bg-gray-800 border dark:border-gray-700 flex flex-col">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{selectedProduct.product}</h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">SKU: {selectedProduct.sku}</p>
                            </div>
                            <button
                                onClick={() => setSelectedProduct(null)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('inventoryReport.currentStock')}</p>
                                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{selectedProduct.currentStock}</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('inventoryReport.lastRestocked')}</p>
                                    <p className="text-base font-bold text-gray-800 dark:text-gray-200 mt-1.5">{selectedProduct.lastRestocked}</p>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Clock size={18} />
                                    {t('inventoryReport.stockMovement')}
                                </h3>

                                <div className="space-y-3">
                                    {selectedProduct.changes.map((change: any, idx) => (
                                        <div key={idx} className="border border-gray-150 dark:border-gray-700 rounded-xl p-4 hover:shadow-xs transition-shadow">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{change.date}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${change.type === 'restock' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                                                    {change.type === 'restock' ? t('inventoryReport.restock') : t('inventoryReport.sale')}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-4">
                                                <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{change.note}</p>
                                                <div className="text-right shrink-0">
                                                    <p className={`text-base font-bold ${change.quantity > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600'}`}>
                                                        {change.quantity > 0 ? '+' : ''}{change.quantity}
                                                    </p>
                                                    <p className="text-xs text-gray-400 mt-0.5">{t('inventoryReport.newStock')}: {change.newStock}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

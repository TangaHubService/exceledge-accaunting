import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ScanLine,
  Search,
  Trash2,
  Eye,
  FileText,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { CardContent } from '../../../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { apiClient } from '../../../lib/api-client';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { toast } from 'react-toastify';
import { format } from 'date-fns';

type InvoiceStatus = 'DRAFT' | 'PROCESSING' | 'REVIEW' | 'APPROVED' | 'IMPORTED' | 'FAILED';

interface SupplierInvoice {
  id: number;
  invoiceNumber?: string;
  supplierName?: string;
  currency: string;
  totalAmount?: number;
  status: InvoiceStatus;
  createdAt: string;
  importedAt?: string;
  _count: { items: number };
  supplier?: { id: number; name: string };
  createdBy: { id: number; name: string };
  files: Array<{ id: number; originalName: string; mimeType: string }>;
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; icon: React.ReactNode; className: string }> = {
  DRAFT: { label: 'Draft', icon: <FileText className="size-3" />, className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  PROCESSING: { label: 'Processing', icon: <Loader2 className="size-3 animate-spin" />, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  REVIEW: { label: 'Review', icon: <Clock className="size-3" />, className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  APPROVED: { label: 'Approved', icon: <CheckCircle2 className="size-3" />, className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  IMPORTED: { label: 'Imported', icon: <Package className="size-3" />, className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  FAILED: { label: 'Failed', icon: <AlertCircle className="size-3" />, className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

export const SupplierInvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const organizationId = apiClient.getOrganizationId();

  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 1, currentPage: 1 });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const isDark = theme === 'dark';

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getSupplierInvoices(organizationId, {
        status: statusFilter || undefined,
        page,
        limit: 15,
        search: search || undefined,
        sortBy,
        sortOrder,
      });
      setInvoices(res?.data?.data || []);
      setPagination(res?.data?.pagination || { totalItems: 0, totalPages: 1, currentPage: 1 });
    } catch {
      toast.error(t('invoiceScanner.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, statusFilter, page, search, sortBy, sortOrder]);

  const sortHeader = (label: string, key: string) => (
    <th
      className="px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none"
      aria-sort={sortBy === key ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
      onClick={() => {
        setSortOrder(sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc');
        setSortBy(key);
        setPage(1);
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy !== key ? <ChevronsUpDown className="size-3 opacity-40" /> : sortOrder === 'asc'
          ? <ChevronUp className="size-3 text-blue-600" />
          : <ChevronDown className="size-3 text-blue-600" />}
      </span>
    </th>
  );

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await apiClient.deleteSupplierInvoice(organizationId, id);
      toast.success(t('invoiceScanner.deleteSuccess'));
      setConfirmDeleteId(null);
      fetchInvoices();
    } catch (err: any) {
      toast.error(err.message || t('invoiceScanner.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <ScanLine className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('invoiceScanner.supplierInvoices')}</h1>
              <p className="text-sm text-white/70 mt-0.5">{t('invoiceScanner.subtitle')}</p>
            </div>
          </div>
          <Button
            onClick={() => navigate('/dashboard/scan-invoice')}
            className="gap-2 bg-white text-blue-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto"
          >
            <ScanLine className="size-4" />
            {t('invoiceScanner.scanInvoice')}
          </Button>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <Input
              className="pl-9"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <Filter className="size-4 mr-2 text-gray-400" />
              <SelectValue placeholder={t('common.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.allStatuses')}</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchInvoices} title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ScanLine className="size-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">{t('invoiceScanner.noInvoices')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('invoiceScanner.createFirst')}</p>
              <Button className="mt-4 gap-2" onClick={() => navigate('/dashboard/scan-invoice')}>
                <ScanLine className="size-4" />
                {t('invoiceScanner.scanInvoice')}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={cn('border-b text-left', isDark ? 'border-gray-700' : 'border-gray-200')}>
                    {sortHeader(t('invoiceScanner.invoiceNumber'), 'invoiceNumber')}
                    {sortHeader(t('invoiceScanner.supplierName'), 'supplierName')}
                    <th className="px-4 py-3 font-medium text-muted-foreground">{t('invoiceScanner.items')}</th>
                    {sortHeader(t('common.total'), 'totalAmount')}
                    {sortHeader(t('common.status'), 'status')}
                    {sortHeader(t('common.date'), 'createdAt')}
                    <th className="px-4 py-3 font-medium text-muted-foreground">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const sc = STATUS_CONFIG[inv.status];
                    return (
                      <tr
                        key={inv.id}
                        className={cn(
                          'border-b transition-colors',
                          isDark ? 'border-gray-700 hover:bg-gray-800/50' : 'border-gray-100 hover:bg-gray-50'
                        )}
                      >
                        <td className="px-4 py-3 font-mono text-xs">
                          {inv.invoiceNumber || `#${inv.id}`}
                        </td>
                        <td className="px-4 py-3">
                          {inv.supplierName || inv.supplier?.name || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1">
                            <Package className="size-3 text-muted-foreground" />
                            {inv._count.items}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {inv.totalAmount != null
                            ? `${inv.currency} ${Number(inv.totalAmount).toLocaleString()}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', sc.className)}>
                            {sc.icon}
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {format(new Date(inv.createdAt), 'dd MMM yyyy')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {inv.status === 'REVIEW' && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => navigate(`/dashboard/scan-invoice/${inv.id}`)}
                              >
                                {t('common.edit')}
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => navigate(`/dashboard/scan-invoice/${inv.id}`)}
                              title={t('common.view')}
                            >
                              <Eye className="size-4" />
                            </Button>
                            {inv.status !== 'IMPORTED' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setConfirmDeleteId(inv.id)}
                                title={t('common.delete')}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t('common.showing')} {(page - 1) * 15 + 1}–{Math.min(page * 15, pagination.totalItems)} {t('common.of')} {pagination.totalItems}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" disabled={page === pagination.totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDeleteId !== null} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('invoiceScanner.deleteConfirm')}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={deletingId === confirmDeleteId}
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
            >
              {deletingId === confirmDeleteId ? <Loader2 className="size-4 animate-spin" /> : t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplierInvoicesPage;

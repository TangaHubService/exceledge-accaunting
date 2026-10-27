import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, Search } from 'lucide-react';
import { Input } from '../../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { TableSkeleton } from '../../../components/ui/TableSkeleton';
import { apiClient } from '../../../lib/api-client';
import { getInvoiceFilename, unwrapInvoice } from '../../../lib/invoice';
import { downloadInvoicePdf, type InvoicePdfFormat } from '../../../lib/invoice-pdf';
import { cn } from '../../../lib/utils';
import { toast } from 'react-toastify';

// ── types ─────────────────────────────────────────────────────────────────────

type Invoice = {
  id: string;
  saleNumber: string;
  invoiceNumber?: string | null;
  rcptLabel?: string | null;
  /**
   * Number of times this invoice's PDF has been registered as downloaded.
   * CIS/VSDC spec §7.18/§15: the first download renders as the ORIGINAL;
   * every one after automatically comes back watermarked COPY — there's no
   * separate "download copy" action, the button just behaves differently
   * the second time it's clicked for the same invoice.
   */
  reprintCount?: number;
  customer: { name: string };
  totalAmount: string;
  createdAt: string;
  status: string;
};

type Pagination = { totalPages?: number; total?: number; totalItems?: number };
type SalesResponse = { success?: boolean; data?: Invoice[] | { data?: Invoice[]; pagination?: Pagination }; pagination?: Pagination };

const statusStyle: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  REFUNDED: 'bg-purple-100 text-purple-700',
  PARTIALLY_REFUNDED: 'bg-violet-100 text-violet-700',
};

const fmtCurrency = (amount: string | number) =>
  `RF ${Number(amount).toLocaleString('en-RW', { minimumFractionDigits: 0 })}`;

export default function InvoicesListPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [invoiceFormat, setInvoiceFormat] = useState<InvoicePdfFormat>('A4');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const pageSize = 15;

  const fetchInvoices = useCallback(async () => {
    try {
      setIsLoading(true);
      // Only completed/refunded sales actually carry a fiscal invoice —
      // proforma/training/cancelled sales never get an official receipt.
      const response = await apiClient.getSales({
        page: currentPage,
        limit: pageSize,
        search: searchTerm,
      }) as SalesResponse;

      const payload = Array.isArray(response?.data) ? undefined : response?.data;
      const list: Invoice[] = Array.isArray(payload?.data) ? payload.data
        : Array.isArray(response?.data) ? response.data
        : [];
      const pagination = payload?.pagination ?? response?.pagination;

      setInvoices(list.filter((sale) => sale.status === 'COMPLETED' || sale.status === 'REFUNDED' || sale.status === 'PARTIALLY_REFUNDED'));
      setTotalPages(pagination?.totalPages ?? 1);
      setTotalCount(pagination?.total ?? pagination?.totalItems ?? list.length);
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
      toast.error('Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchTerm]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  /**
   * CIS/VSDC spec §7.18/§15: "print only one original receipt. Reprint shall
   * have a watermark with mention Copy." downloadInvoicePdf registers this
   * download with the backend before fetching the PDF, so the first download
   * of a given invoice comes back original and every one after automatically
   * renders watermarked COPY — there's no separate copy button to press.
   */
  const handleDownload = async (invoice: Invoice) => {
    setDownloadingId(invoice.id);
    try {
      const data = unwrapInvoice(await apiClient.getInvoice(invoice.id, { allowPending: true }));
      const ok = await downloadInvoicePdf(
        invoice.id,
        getInvoiceFilename(data, invoice.saleNumber, invoiceFormat),
        invoiceFormat,
      );
      if (!ok) throw new Error('PDF generation failed');
      toast.success((invoice.reprintCount ?? 0) > 0 ? 'Copy receipt downloaded' : 'Invoice downloaded');
      setInvoices((prev) => prev.map((i) => i.id === invoice.id ? { ...i, reprintCount: (i.reprintCount ?? 0) + 1 } : i));
    } catch (error) {
      console.error('Failed to download invoice:', error);
      toast.error('Failed to generate invoice PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">
            Every fiscal invoice issued. Download once for the original — downloading the same invoice again automatically prints a watermarked COPY.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-gray-300 p-0.5">
            {(['A4', 'A5', '80mm'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setInvoiceFormat(option)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  invoiceFormat === option ? 'bg-[#1d57c8] text-white' : 'text-gray-500 hover:bg-gray-100'
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              placeholder="Search invoice #, sale #, or customer"
              className="pl-9 w-72"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} columns={6} />
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <FileText className="h-10 w-10" />
            <p className="text-sm font-medium">No invoices found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/dashboard/invoice/${invoice.id}`)}
                  >
                    <TableCell className="font-semibold text-gray-900">
                      {invoice.invoiceNumber || invoice.saleNumber}
                      {(invoice.reprintCount ?? 0) > 0 && (
                        <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                          downloaded {invoice.reprintCount}x
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-700">{invoice.customer?.name || 'Walk-in customer'}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{format(new Date(invoice.createdAt), 'dd MMM yyyy, HH:mm')}</TableCell>
                    <TableCell className="text-right font-medium text-gray-900">{fmtCurrency(invoice.totalAmount)}</TableCell>
                    <TableCell>
                      <span className={cn('inline-flex rounded-full px-2 py-1 text-[11px] font-semibold', statusStyle[invoice.status] ?? 'bg-gray-100 text-gray-600')}>
                        {invoice.status.replace('_', ' ')}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDownload(invoice)}
                        disabled={downloadingId === invoice.id}
                        title={(invoice.reprintCount ?? 0) > 0 ? 'Download again — this will be marked COPY' : 'Download original invoice'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        {downloadingId === invoice.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Download className="h-3.5 w-3.5" />}
                        Download
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && invoices.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">
              {totalCount} invoice{totalCount === 1 ? '' : 's'} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-gray-600">Page {currentPage} of {totalPages}</span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

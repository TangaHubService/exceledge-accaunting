import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../../lib/api-client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { Loader2, TrendingUp, TrendingDown, Package, DollarSign } from 'lucide-react';
import { toast } from 'react-toastify';
import { Badge } from '../../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { parseInventoryGetProductsResponse } from '../../../lib/inventory-response';

interface SummaryItem {
  productId: number;
  branchId: number | null;
  totalIn: number;
  totalOut: number;
  currentStock: number;
  totalCost: number;
  movements: {
    IN: number;
    OUT: number;
  };
  byType: Record<string, {
    count: number;
    quantity: number;
  }>;
}

interface InventorySummaryResponse {
  summary: SummaryItem[];
  fromDate: string;
}

export default function InventorySummaryDashboard() {
  const { t } = useTranslation();
  const [summaryData, setSummaryData] = useState<InventorySummaryResponse | null>(null);
  const [products, setProducts] = useState<Map<number, { name: string; sku?: string }>>(new Map());
  const [branches, setBranches] = useState<Map<number, { name: string; code?: string }>>(new Map());
  const [branchOptions, setBranchOptions] = useState<Array<{ id: number; name: string; code?: string }>>([]);
  const [productOptions, setProductOptions] = useState<Array<{ id: number; name: string; sku?: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [productId, setProductId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('inception');

  const orgId = localStorage.getItem('current_organization_id');

  useEffect(() => {
    apiClient.getBranches()
      .then((data: any) => setBranchOptions(Array.isArray(data) ? data : data?.branches ?? []))
      .catch(() => setBranchOptions([]));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    apiClient.getProducts({ organizationId: orgId, limit: 1000 })
      .then((res: any) => setProductOptions(parseInventoryGetProductsResponse(res).items as Array<{ id: number; name: string; sku?: string | null }>))
      .catch(() => setProductOptions([]));
  }, [orgId]);

  useEffect(() => {
    fetchSummary();
  }, [productId, branchId, fromDate]);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setError(null);

      const params: any = {};
      if (productId) params.productId = parseInt(productId);
      if (branchId) params.branchId = branchId === 'null' ? null : parseInt(branchId);
      params.from = fromDate;

      const data = await apiClient.getInventorySummary(params);

      // Normalize data structure - handle potential nesting
      // Backend might return { summary: { summary: [...], fromDate }, fromDate }
      // or { summary: [...], fromDate }
      let normalizedData: InventorySummaryResponse;
      if (Array.isArray(data.summary)) {
        // Direct array
        normalizedData = {
          summary: data.summary,
          fromDate: data.fromDate || (data as any).summary?.fromDate || 'inception',
        };
      } else if (data.summary?.summary && Array.isArray(data.summary.summary)) {
        // Nested structure
        normalizedData = {
          summary: data.summary.summary,
          fromDate: data.summary.fromDate || data.fromDate || 'inception',
        };
      } else {
        // Fallback to empty array
        normalizedData = {
          summary: [],
          fromDate: data.fromDate || 'inception',
        };
      }

      setSummaryData(normalizedData);

      // Fetch product names for display
      if (normalizedData.summary.length > 0) {
        const summaryArray = normalizedData.summary;
        const productIds = [...new Set(summaryArray.map(s => s.productId))];
        const branchIds = [...new Set(summaryArray.map(s => s.branchId).filter(id => id !== null))] as number[];

        // Fetch products
        const productPromises = productIds.map(id =>
          apiClient.getProducts({ id: id.toString() }).catch(() => null)
        );
        const productResults = await Promise.all(productPromises);
        const productMap = new Map<number, { name: string; sku?: string }>();
        productResults.forEach((result: any) => {
          if (result?.data?.[0]) {
            const p = result.data[0];
            productMap.set(p.id, { name: p.name, sku: p.sku });
          }
        });
        setProducts(productMap);

        // Fetch branches if needed
        if (branchIds.length > 0) {
          try {
            const branchesData = await apiClient.getBranches();
            const branchMap = new Map<number, { name: string; code?: string }>();
            branchesData.forEach((b: any) => {
              branchMap.set(b.id, { name: b.name, code: b.code });
            });
            setBranches(branchMap);
          } catch (err) {
            // Ignore warehouse fetch errors
          }
        }
      }
    } catch (err: any) {
      console.error('Error fetching inventory summary:', err);
      setError(err.message || 'Failed to load inventory summary');
      toast.error(err.message || 'Failed to load inventory summary');
    } finally {
      setLoading(false);
    }
  };

  const toNum = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const formatNumber = (num: unknown) => {
    return new Intl.NumberFormat().format(toNum(num));
  };

  const formatCurrency = (num: unknown) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'RWF',
      minimumFractionDigits: 0,
    }).format(toNum(num));
  };

  /** Shrink card totals so long figures stay inside the card. */
  const metricClassName = (display: string) => {
    const len = display.replace(/[^\d]/g, '').length;
    if (len >= 14) return 'text-sm sm:text-base';
    if (len >= 11) return 'text-base sm:text-lg';
    if (len >= 8) return 'text-lg sm:text-xl';
    return 'text-2xl';
  };

  const calculateTotals = () => {
    if (!summaryData?.summary || !Array.isArray(summaryData.summary) || summaryData.summary.length === 0) {
      return null;
    }

    return summaryData.summary.reduce((acc, item) => ({
      totalIn: acc.totalIn + toNum(item.totalIn),
      totalOut: acc.totalOut + toNum(item.totalOut),
      totalCost: acc.totalCost + toNum(item.totalCost),
      totalStock: acc.totalStock + toNum(item.currentStock),
      totalMovements:
        acc.totalMovements + toNum(item.movements?.IN) + toNum(item.movements?.OUT),
    }), { totalIn: 0, totalOut: 0, totalCost: 0, totalStock: 0, totalMovements: 0 });
  };

  const totals = calculateTotals();
  const totalInLabel = totals ? formatNumber(totals.totalIn) : '';
  const totalOutLabel = totals ? formatNumber(totals.totalOut) : '';
  const totalStockLabel = totals ? formatNumber(totals.totalStock) : '';
  const totalCostLabel = totals ? formatCurrency(totals.totalCost) : '';

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('inventory.inventorySummary') || 'Inventory Summary Dashboard'}
        </h1>
      </div>

      {/* Filters */}
      <Card className="border-none shadow-lg bg-white dark:bg-gray-800 overflow-hidden">
        <CardHeader className="border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-blue-600/5 to-indigo-600/5">
          <CardTitle className="text-gray-900 dark:text-white">
            {t('common.filters') || 'Filters'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('common.product') || 'Product'}</Label>
              <SearchableSelect
                value={productId}
                onChange={setProductId}
                placeholder={t('inventory.allProducts') || 'All products'}
                searchPlaceholder={t('inventory.searchProducts') || 'Type to search products...'}
                emptyText={t('inventory.noProductsFound') || 'No products found.'}
                options={[
                  { value: '', label: t('inventory.allProducts') || 'All products' },
                  ...productOptions.map((p) => ({
                    value: String(p.id),
                    label: p.name,
                    sublabel: p.sku ?? undefined,
                  })),
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('inventory.branch') || 'Branch'}</Label>
              <Select value={branchId || 'all'} onValueChange={(v) => setBranchId(v === 'all' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('inventory.allBranches') || 'All branches'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('inventory.allBranches') || 'All branches'}</SelectItem>
                  {branchOptions.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('common.fromDate') || 'From Date'}</Label>
              <Input
                type="date"
                value={fromDate === 'inception' ? '' : fromDate}
                onChange={(e) => setFromDate(e.target.value || 'inception')}
                placeholder={t('inventory.fromInception') || 'From inception'}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('inventory.leaveEmptyForInception') || 'Leave empty for "from inception"'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">{error}</div>
      ) : summaryData && Array.isArray(summaryData.summary) ? (
        <>
          {/* Summary Cards */}
          {totals && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="min-w-0 overflow-hidden border-none shadow-lg bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-gray-800 ring-1 ring-emerald-100 dark:ring-emerald-900/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    {t('inventory.totalStockIn') || 'Total Stock IN'}
                  </CardTitle>
                  <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 p-2 shrink-0">
                    <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div
                    className={`font-bold tabular-nums tracking-tight text-gray-900 dark:text-white break-all leading-tight ${metricClassName(totalInLabel)}`}
                    title={totalInLabel}
                  >
                    {totalInLabel}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-none shadow-lg bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/40 dark:to-gray-800 ring-1 ring-rose-100 dark:ring-rose-900/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-rose-700 dark:text-rose-400">
                    {t('inventory.totalStockOut') || 'Total Stock OUT'}
                  </CardTitle>
                  <div className="rounded-full bg-rose-100 dark:bg-rose-900/50 p-2 shrink-0">
                    <TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </div>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div
                    className={`font-bold tabular-nums tracking-tight text-gray-900 dark:text-white break-all leading-tight ${metricClassName(totalOutLabel)}`}
                    title={totalOutLabel}
                  >
                    {totalOutLabel}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-none shadow-lg bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/40 dark:to-gray-800 ring-1 ring-purple-100 dark:ring-purple-900/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-400">
                    {t('inventory.currentStock') || 'Current Stock'}
                  </CardTitle>
                  <div className="rounded-full bg-purple-100 dark:bg-purple-900/50 p-2 shrink-0">
                    <Package className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div
                    className={`font-bold tabular-nums tracking-tight text-gray-900 dark:text-white break-all leading-tight ${metricClassName(totalStockLabel)}`}
                    title={totalStockLabel}
                  >
                    {totalStockLabel}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-none shadow-lg bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/40 dark:to-gray-800 ring-1 ring-blue-100 dark:ring-blue-900/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-400">
                    {t('inventory.totalCost') || 'Total Cost'}
                  </CardTitle>
                  <div className="rounded-full bg-blue-100 dark:bg-blue-900/50 p-2 shrink-0">
                    <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div
                    className={`font-bold tabular-nums tracking-tight text-gray-900 dark:text-white break-all leading-tight ${metricClassName(totalCostLabel)}`}
                    title={totalCostLabel}
                  >
                    {totalCostLabel}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Summary Table */}
          <Card className="border-none shadow-lg bg-white dark:bg-gray-800 overflow-hidden">
            <CardHeader className="border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-indigo-600/5 to-purple-600/5">
              <CardTitle className="text-gray-900 dark:text-white">
                {t('inventory.inventorySummary') || 'Inventory Summary by Product & Branch'}
                {summaryData.fromDate && summaryData.fromDate !== 'inception' && (
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                    ({t('common.from') || 'From'} {summaryData.fromDate})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-100 dark:border-gray-700">
                      <TableHead>{t('common.product') || 'Product'}</TableHead>
                      <TableHead>{t('inventory.branch') || 'Branch'}</TableHead>
                      <TableHead className="text-right">{t('inventory.totalIn') || 'Total IN'}</TableHead>
                      <TableHead className="text-right">{t('inventory.totalOut') || 'Total OUT'}</TableHead>
                      <TableHead className="text-right">{t('inventory.currentStock') || 'Current Stock'}</TableHead>
                      <TableHead className="text-right">{t('inventory.totalCost') || 'Total Cost'}</TableHead>
                      <TableHead className="text-right">{t('inventory.movements') || 'Movements'}</TableHead>
                      <TableHead>{t('inventory.byType') || 'By Type'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData.summary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          {t('inventory.noSummaryData') || 'No summary data found'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      summaryData.summary.map((item, index) => {
                        const product = products.get(item.productId);
                        const branch = item.branchId ? branches.get(item.branchId) : null;

                        return (
                          <TableRow
                            key={`${item.productId}-${item.branchId}-${index}`}
                            className="border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          >
                            <TableCell className="font-medium">
                              {product?.name || `Product #${item.productId}`}
                              {product?.sku && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">SKU: {product.sku}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {branch ? branch.name : item.branchId === null ? (t('inventory.mainBranch') || 'Main Branch') : `Branch #${item.branchId}`}
                              {branch?.code && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">{branch.code}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-mono tabular-nums whitespace-nowrap">
                              +{formatNumber(item.totalIn)}
                            </TableCell>
                            <TableCell className="text-right text-rose-600 dark:text-rose-400 font-mono tabular-nums whitespace-nowrap">
                              -{formatNumber(item.totalOut)}
                            </TableCell>
                            <TableCell className="text-right font-semibold font-mono tabular-nums whitespace-nowrap">
                              {formatNumber(item.currentStock)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                              {formatCurrency(item.totalCost)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="space-y-1">
                                <div className="text-xs text-emerald-600 dark:text-emerald-400">
                                  IN: {toNum(item.movements?.IN)}
                                </div>
                                <div className="text-xs text-rose-600 dark:text-rose-400">
                                  OUT: {toNum(item.movements?.OUT)}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 max-w-xs">
                                {Object.entries(item.byType || {}).map(([type, stats]) => (
                                  <div key={type} className="text-xs">
                                    <Badge variant="outline" className="mr-1 border-purple-200 text-purple-700 dark:border-purple-800 dark:text-purple-300">
                                      {type.replace(/_/g, ' ')}
                                    </Badge>
                                    <span className="text-gray-500 dark:text-gray-400">
                                      {toNum(stats.count)} × {formatNumber(stats.quantity)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

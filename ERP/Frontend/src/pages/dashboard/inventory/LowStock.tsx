import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { apiClient } from "../../../lib/api-client";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import { type Product } from "../../../types";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  AlertTriangle,
  PackageX,
  Eye,
  ShieldAlert,
} from "lucide-react";
import ViewProductDialog from "./ViewProductDialog";
import { useDebounce } from "../../../hooks/use-debounce";
import { cn } from "../../../lib/utils";

export const LowStock = () => {
  const { t } = useTranslation();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [limit, setLimit] = useState(10);

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const fetchLowStockProducts = async () => {
      try {
        setLoading(true);
        const params: any = {
          page: currentPage,
          limit: limit,
        };

        if (debouncedSearchTerm.trim()) {
          params.search = debouncedSearchTerm.trim();
        }

        if (statusFilter !== "all") {
          params.status = statusFilter;
        }

        const response = await apiClient.getLowStockProducts(params);
        const parsed = parseInventoryGetProductsResponse(response);
        setProducts((parsed.items || []) as Product[]);
        setTotalPages(parsed.pagination.totalPages || 1);
        setTotalItems(parsed.pagination.totalItems || 0);
        setError(null);
      } catch (err) {
        console.error("Error fetching low stock products:", err);
        setError(t("messages.lowStockLoadError"));
      } finally {
        setLoading(false);
      }
    };

    fetchLowStockProducts();
  }, [currentPage, limit, debouncedSearchTerm, statusFilter, t]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, statusFilter]);

  const getStockStatus = (quantity: number, minStock: number) => {
    const percentage = (quantity / (minStock || 1)) * 100;
    if (percentage <= 25) return { label: "Critical", color: "bg-red-50 text-red-600 border border-red-100" };
    if (percentage <= 50) return { label: "Low", color: "bg-amber-50 text-amber-700 border border-amber-100" };
    return { label: "Warning", color: "bg-yellow-50 text-yellow-700 border border-yellow-100" };
  };

  const handleClearSearch = () => {
    setSearchTerm("");
    setStatusFilter("all");
  };

  const hasActiveFilters = debouncedSearchTerm.trim() !== "" || statusFilter !== "all";

  // KPI Calculations
  const criticalCount = products.filter((p) => (p.quantity / (p.minStock || 1)) * 100 <= 25).length;
  const lowCount = products.filter((p) => {
    const pct = (p.quantity / (p.minStock || 1)) * 100;
    return pct > 25 && pct <= 50;
  }).length;
  const warningCount = products.filter((p) => {
    const pct = (p.quantity / (p.minStock || 1)) * 100;
    return pct > 50;
  }).length;

  return (
    <div className="space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-50 dark:bg-amber-900/30">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Low Stock Products</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Monitor items running below minimum required threshold
            </p>
          </div>
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">CRITICAL LOW</p>
              <h3 className="text-3xl font-extrabold text-red-600 tracking-tight">{criticalCount}</h3>
              <p className="text-xs text-gray-400 mt-1">Stock ≤ 25% of minimum</p>
            </div>
            <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-red-600">
            <span>Requires urgent restock</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">LOW STOCK</p>
              <h3 className="text-3xl font-extrabold text-amber-600 tracking-tight">{lowCount}</h3>
              <p className="text-xs text-gray-400 mt-1">Stock 25% - 50% of minimum</p>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-amber-600">
            <span>Reorder soon</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">WARNING LEVEL</p>
              <h3 className="text-3xl font-extrabold text-yellow-600 tracking-tight">{warningCount}</h3>
              <p className="text-xs text-gray-400 mt-1">Stock 50% - 100% of minimum</p>
            </div>
            <div className="p-3 rounded-2xl bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600">
              <PackageX className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-yellow-600">
            <span>Monitor depletion</span>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Row ─────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by product name, SKU, or batch..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-9 h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all w-full sm:w-36"
            >
              <option value="all">All Levels</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
              <option value="warning">Warning</option>
            </select>

            {hasActiveFilters && (
              <button
                onClick={handleClearSearch}
                className="h-10 px-3.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table Container ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 w-full bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-gray-400 gap-2">
            <AlertTriangle className="h-10 w-10 text-gray-300" />
            <p className="text-sm font-medium">{t("messages.noData")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <TableRow className="hover:bg-transparent">
                {["ID", "Product Name", "Batch Number", "Current Stock", "Min Required", "Status", "Unit Price", "Valuation", "Action"].map((h) => (
                  <TableHead key={h} className="text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap py-3.5">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((prod) => {
                const status = getStockStatus(prod.quantity, prod.minStock);
                const valuation = prod.quantity * (Number(prod.unitPrice) || 0);

                return (
                  <TableRow
                    key={prod.id}
                    className="border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <TableCell className="py-3.5 text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                      #{prod.id}
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-bold text-gray-900 dark:text-white">
                      {prod.name}
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-mono text-gray-500">
                      {prod.batchNumber || "—"}
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-extrabold text-amber-600 tabular-nums">
                      {prod.quantity}
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-medium text-gray-500 tabular-nums">
                      {prod.minStock}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold", status.color)}>
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                      {(Number(prod.unitPrice) || 0).toLocaleString()} Frw
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                      {valuation.toLocaleString()} Frw
                    </TableCell>
                    <TableCell className="py-3.5">
                      <button
                        onClick={() => setViewProduct(prod)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* ── Pagination Footer ────────────────────────────────────────────── */}
        {!loading && products.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {(currentPage - 1) * limit + 1} to {Math.min(currentPage * limit, totalItems)} of {totalItems} low stock items
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pNum = i + 1;
                return (
                  <button
                    key={pNum}
                    onClick={() => setCurrentPage(pNum)}
                    className={cn(
                      "h-8 w-8 rounded-lg text-xs font-semibold transition-colors",
                      currentPage === pNum
                        ? "bg-blue-600 text-white shadow-sm"
                        : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    )}
                  >
                    {pNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-8 pl-2 pr-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all appearance-none"
              >
                {[10, 20, 50, 100].map((num) => (
                  <option key={num} value={num}>{num} / page</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <ViewProductDialog viewProduct={viewProduct} setViewProduct={setViewProduct} />
    </div>
  );
};

export default LowStock;

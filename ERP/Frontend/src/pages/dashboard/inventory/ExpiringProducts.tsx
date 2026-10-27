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
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, Eye, ShieldAlert } from "lucide-react";
import ViewProductDialog from "./ViewProductDialog";
import { type Product } from "../../../types";
import { cn } from "../../../lib/utils";

export const ExpiringProducts = () => {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const fetchExpiringProducts = async () => {
      try {
        setLoading(true);
        const response = await apiClient.getExpiringProducts({
          days,
          page: currentPage,
          limit: limit,
        });

        const parsed = parseInventoryGetProductsResponse(response);
        setProducts((parsed.items || []) as Product[]);
        setTotalPages(parsed.pagination.totalPages || 1);
        setTotalItems(parsed.pagination.totalItems || 0);
        setError(null);
      } catch (err) {
        console.error("Error fetching expiring products:", err);
        setError(t("messages.expiringLoadError"));
      } finally {
        setLoading(false);
      }
    };

    fetchExpiringProducts();
  }, [days, currentPage, limit, t]);

  const getDaysUntilExpiry = (expiryDate: string) => {
    return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const getExpiryStatus = (daysLeft: number) => {
    if (daysLeft <= 0) return { label: "Expired", color: "bg-red-50 text-red-600 border border-red-100" };
    if (daysLeft <= 7) return { label: "Critical", color: "bg-rose-50 text-rose-600 border border-rose-100 font-bold" };
    if (daysLeft <= 30) return { label: "Warning", color: "bg-amber-50 text-amber-700 border border-amber-100" };
    return { label: "Good", color: "bg-emerald-50 text-emerald-700 border border-emerald-100" };
  };

  // KPI Calculations
  const expiring7Days = products.filter((p) => getDaysUntilExpiry(p.expiryDate!) <= 7).length;
  const expiring30Days = products.filter((p) => {
    const d = getDaysUntilExpiry(p.expiryDate!);
    return d > 7 && d <= 30;
  }).length;

  return (
    <div className="space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30">
            <Clock className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Expiring Products</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Track upcoming product expirations to manage inventory turnover
            </p>
          </div>
        </div>

        {/* Days Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">Expiring in next:</span>
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all shadow-sm"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">TOTAL EXPIRING SOON</p>
              <h3 className="text-3xl font-extrabold text-emerald-600 tracking-tight">{totalItems}</h3>
              <p className="text-xs text-gray-400 mt-1">Within selected {days} day window</p>
            </div>
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600">
              <Clock className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">EXPIRING IN 7 DAYS</p>
              <h3 className="text-3xl font-extrabold text-rose-600 tracking-tight">{expiring7Days}</h3>
              <p className="text-xs text-gray-400 mt-1">Immediate discount/action needed</p>
            </div>
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-900/30 text-rose-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">EXPIRING IN 30 DAYS</p>
              <h3 className="text-3xl font-extrabold text-amber-600 tracking-tight">{expiring30Days}</h3>
              <p className="text-xs text-gray-400 mt-1">Prioritize in POS & sales</p>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
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
        ) : error ? (
          <div className="py-12 text-center text-rose-500 text-sm">{error}</div>
        ) : products.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-gray-400 gap-2">
            <Clock className="h-10 w-10 text-gray-300" />
            <p className="text-sm font-medium">{t("messages.noExpiringProducts")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <TableRow className="hover:bg-transparent">
                {["ID", "Product Name", "Batch Number", "Expiry Date", "Days Remaining", "Status", "Quantity", "Unit Price", "Action"].map((h) => (
                  <TableHead key={h} className="text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap py-3.5">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((prod) => {
                const daysLeft = getDaysUntilExpiry(prod.expiryDate!);
                const status = getExpiryStatus(daysLeft);

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
                    <TableCell className="py-3.5 text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {format(new Date(prod.expiryDate!), "MMM dd, yyyy")}
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-extrabold tabular-nums text-amber-600 whitespace-nowrap">
                      {daysLeft <= 0 ? "Expired" : `${daysLeft} days left`}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold", status.color)}>
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                      {prod.quantity}
                    </TableCell>
                    <TableCell className="py-3.5 text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                      {Number(prod.unitPrice).toLocaleString()} Frw
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
              Showing {(currentPage - 1) * limit + 1} to {Math.min(currentPage * limit, totalItems)} of {totalItems} expiring items
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

export default ExpiringProducts;

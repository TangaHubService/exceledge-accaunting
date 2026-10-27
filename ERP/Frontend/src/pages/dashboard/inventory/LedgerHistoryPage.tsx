import { useState, useEffect } from "react";
import { apiClient } from "../../../lib/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { SearchableSelect } from "../../../components/ui/SearchableSelect";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Filter,
  FileSpreadsheet,
  FileText,
  LineChart,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "react-toastify";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { UserOptions } from "jspdf-autotable";
import { saveAs } from "file-saver";
import { cn } from "../../../lib/utils";

interface LedgerEntry {
  id: number;
  product: {
    id: number;
    name: string;
    category?: string;
  };
  movementType: string;
  direction: "IN" | "OUT";
  quantity: number;
  runningBalance: number;
  reference?: string;
  referenceType?: string;
  note?: string;
  createdAt: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
  branch?: {
    id: number;
    name: string;
    code?: string;
  } | null;
}

export default function LedgerHistoryPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchOptions, setBranchOptions] = useState<Array<{ id: number; name: string; code?: string }>>([]);
  const [productOptions, setProductOptions] = useState<Array<{ id: number; name: string; sku?: string | null }>>([]);

  // Filters
  const [productId, setProductId] = useState<string>("");
  const [branchId, setBranchId] = useState<string>("");
  const [movementType, setMovementType] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const orgId = localStorage.getItem("current_organization_id");

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

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    fetchLedgerEntries();
  }, [currentPage, limit, productId, branchId, movementType, startDate, endDate]);

  const fetchLedgerEntries = async () => {
    try {
      setLoading(true);
      setError(null);

      const params: any = {
        page: currentPage,
        limit,
      };

      if (productId) params.productId = parseInt(productId);
      if (branchId) params.branchId = branchId === "null" ? null : parseInt(branchId);
      if (movementType) params.movementType = movementType;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const response = await apiClient.getInventoryLedger(params);
      setEntries(response.entries || []);
      setTotalPages(response.pagination?.totalPages || 1);
      setTotalItems(response.pagination?.totalItems || 0);
    } catch (err: any) {
      console.error("Error fetching ledger entries:", err);
      setError(err.message || "Failed to load stock movements");
      toast.error(err.message || "Failed to load stock movements");
    } finally {
      setLoading(false);
    }
  };

  const handleResetFilters = () => {
    setProductId("");
    setBranchId("");
    setMovementType("");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const time = d.toTimeString().split(" ")[0];
    return `${day}/${month}/${year}, ${time}`;
  };

  const getUserInitials = (name?: string) => {
    if (!name) return "DA";
    const parts = name.split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const exportToExcel = async () => {
    try {
      const params: any = { page: 1, limit: 10000 };
      if (productId) params.productId = parseInt(productId);
      if (branchId) params.branchId = branchId === "null" ? null : parseInt(branchId);
      if (movementType) params.movementType = movementType;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const response = await apiClient.getInventoryLedger(params);
      const allEntries = response.entries || [];

      const headers = [
        "Date", "Product", "Movement Type", "Direction",
        "Quantity Change", "Balance After", "Branch", "User", "Reference", "Note"
      ];
      const rows = allEntries.map((entry: LedgerEntry) => [
        formatDate(entry.createdAt),
        entry.product.name,
        entry.movementType.replace(/_/g, " "),
        entry.direction,
        entry.direction === "IN" ? entry.quantity : -entry.quantity,
        entry.runningBalance,
        entry.branch?.name || "Main Store",
        entry.user.name,
        entry.reference || "",
        entry.note || "",
      ]);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws["!cols"] = Array(10).fill({ wch: 20 });
      XLSX.utils.book_append_sheet(wb, ws, "Stock Movements");

      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      saveAs(blob, `stock-movement-history-${new Date().toISOString().split("T")[0]}.xlsx`);
      toast.success("Excel file exported successfully");
    } catch (error) {
      toast.error("Failed to export Excel file");
    }
  };

  const exportToPDF = async () => {
    try {
      const params: any = { page: 1, limit: 10000 };
      if (productId) params.productId = parseInt(productId);
      if (branchId) params.branchId = branchId === "null" ? null : parseInt(branchId);
      if (movementType) params.movementType = movementType;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const response = await apiClient.getInventoryLedger(params);
      const allEntries = response.entries || [];

      const doc = new jsPDF("landscape") as jsPDF & { autoTable: (options: UserOptions) => void };
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, pageWidth, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text("Stock Movement History", 14, 15);

      const tableData = allEntries.map((entry: LedgerEntry) => [
        formatDate(entry.createdAt),
        entry.product.name,
        entry.movementType.replace(/_/g, " "),
        entry.direction,
        entry.direction === "IN" ? `+${entry.quantity}` : `-${entry.quantity}`,
        entry.runningBalance.toString(),
        entry.branch?.name || "Main Store",
        entry.user.name,
        entry.reference || "-",
        entry.note || "-",
      ]);

      autoTable(doc, {
        head: [["Date", "Product", "Type", "Dir", "Change", "Balance", "Branch", "User", "Reference", "Note"]],
        body: tableData,
        startY: 34,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      });

      doc.save(`stock-movement-history-${new Date().toISOString().split("T")[0]}.pdf`);
      toast.success("PDF file exported successfully");
    } catch {
      toast.error("Failed to export PDF file");
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Breadcrumbs ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>Dashboard</span>
        <span>›</span>
        <span>Inventory</span>
        <span>›</span>
        <span className="text-gray-700 dark:text-gray-200 font-medium">Stock Movement History</span>
      </div>

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Stock Movement History
            <LineChart className="h-5 w-5 text-gray-400" />
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Track all stock movements and inventory transactions
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={exportToExcel}
            className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-2 shadow-sm transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export as Excel
          </button>
          <button
            type="button"
            onClick={exportToPDF}
            className="h-9 px-4 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs flex items-center gap-2 shadow-sm transition-colors"
          >
            <FileText className="h-4 w-4" />
            Export as PDF
          </button>
        </div>
      </div>

      {/* ── Filters Card ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-sm text-gray-800 dark:text-white">
          <Filter className="h-4 w-4 text-gray-400" />
          Filters
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 items-end">
          {/* Product */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Product</label>
            <SearchableSelect
              value={productId}
              onChange={setProductId}
              placeholder="All products"
              searchPlaceholder="Type to search..."
              emptyText="No products found."
              className="bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-xs rounded-xl h-9"
              options={[
                { value: "", label: "All products" },
                ...productOptions.map((p) => ({
                  value: String(p.id),
                  label: p.name,
                  sublabel: p.sku ?? undefined,
                })),
              ]}
            />
          </div>

          {/* Branch */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Branch</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            >
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Movement Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Movement Type</label>
            <input
              type="text"
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              placeholder="e.g., PURCHASE, SALE"
              className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>

          {/* Start Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>

          {/* Reset button */}
          <div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="w-full h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center justify-center gap-1.5 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 text-blue-600" />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* ── Table Card ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        {/* Table header bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">
            Stock Movements <span className="text-blue-600 font-bold">({totalItems})</span>
          </h2>

          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>
              Showing {(currentPage - 1) * limit + 1} to {Math.min(currentPage * limit, totalItems)} of {totalItems} results
            </span>
            <div className="flex items-center gap-1.5">
              <span>Rows per page</span>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setCurrentPage(1); }}
                className="h-8 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none"
              >
                {[10, 20, 50, 100].map((num) => (
                  <option key={num} value={num}>{num}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Table content */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-rose-500 text-sm">{error}</div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No stock movements found</div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <TableRow className="hover:bg-transparent">
                {["Date", "Product", "Movement Type", "Direction", "Quantity Change", "Balance After", "Branch", "User", "Reference", "Note"].map((h) => (
                  <TableHead key={h} className="text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap py-3.5">
                    <span className="flex items-center gap-1">
                      {h}
                      <svg className="h-3 w-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const isOut = entry.direction === "OUT";

                return (
                  <TableRow
                    key={entry.id}
                    className="border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    {/* Date */}
                    <TableCell className="py-3.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(entry.createdAt)}
                    </TableCell>

                    {/* Product Name (blue link) */}
                    <TableCell className="py-3.5 text-xs font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      {entry.product.name}
                    </TableCell>

                    {/* Movement Type Pill */}
                    <TableCell className="py-3.5 whitespace-nowrap">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide",
                        isOut
                          ? "bg-rose-100 text-rose-600"
                          : "bg-emerald-100 text-emerald-700"
                      )}>
                        {entry.movementType.replace(/_/g, " ")}
                      </span>
                    </TableCell>

                    {/* Direction */}
                    <TableCell className="py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {isOut ? (
                          <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                        ) : (
                          <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                        <span className={cn("text-xs font-bold", isOut ? "text-rose-500" : "text-emerald-600")}>
                          {entry.direction}
                        </span>
                      </div>
                    </TableCell>

                    {/* Quantity Change */}
                    <TableCell className={cn("py-3.5 text-xs font-bold tabular-nums whitespace-nowrap", isOut ? "text-rose-500" : "text-emerald-600")}>
                      {isOut ? `-${entry.quantity}` : `+${entry.quantity}`}
                    </TableCell>

                    {/* Balance After */}
                    <TableCell className="py-3.5 text-xs font-extrabold tabular-nums text-gray-900 dark:text-white whitespace-nowrap">
                      {entry.runningBalance}
                    </TableCell>

                    {/* Branch */}
                    <TableCell className="py-3.5 text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {entry.branch ? entry.branch.name : "Main Store"}
                    </TableCell>

                    {/* User Avatar + Name */}
                    <TableCell className="py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {getUserInitials(entry.user?.name)}
                        </div>
                        <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                          {entry.user?.name || "Demo Admin"}
                        </span>
                      </div>
                    </TableCell>

                    {/* Reference */}
                    <TableCell className="py-3.5 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {entry.reference || "—"}
                    </TableCell>

                    {/* Note */}
                    <TableCell className="py-3.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap max-w-[200px] truncate" title={entry.note || ""}>
                      {entry.note || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* ── Pagination Footer ────────────────────────────────────────────── */}
        {!loading && entries.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {(currentPage - 1) * limit + 1} to {Math.min(currentPage * limit, totalItems)} of {totalItems} results
            </p>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const page = i + 1;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      "h-8 w-8 rounded-lg text-xs font-semibold transition-colors",
                      currentPage === page
                        ? "bg-blue-600 text-white shadow-sm"
                        : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    )}
                  >
                    {page}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

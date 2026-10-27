import { useEffect, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { TableSkeleton } from "../../components/ui/TableSkeleton";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { Button } from "../../components/ui/button";
import { useBranch } from "../../context/BranchContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  Plus,
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Loader2,
  X,
  Package,
  Calendar,
  Clock,
  SlidersHorizontal,
  Eye,
  Edit,
  MoreHorizontal,
  ArrowUpRight,
  ArrowDownRight,
  History,
  Trash2,
  Layers,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "../../components/ui/drawer";

import { toast } from "react-toastify";
import { apiClient } from "../../lib/api-client";
import { parseInventoryGetProductsResponse } from "../../lib/inventory-response";
import { useDebounce } from "use-debounce";
import { type Product } from "../../types";
import { PACKAGING_UNIT_LABELS } from "../../types/ebm";
import AddProduct from "./inventory/AddProduct";
import ViewProductDialog from "./inventory/ViewProductDialog";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import InventoryHistoryDialog from "./inventory/InventoryHistoryDialog";
import StockAdjustmentDialog from "./inventory/StockAdjustmentDialog";
import { cn } from "../../lib/utils";

function getDaysRemaining(expiryDate: string) {
  const now = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// Category badge color mapping for polished pill look
const categoryPillColors: Record<string, string> = {
  Antibiotics: "bg-blue-50 text-blue-600 border border-blue-100",
  Supplies: "bg-purple-50 text-purple-600 border border-purple-100",
  Vitamins: "bg-emerald-50 text-emerald-600 border border-emerald-100",
  Devices: "bg-amber-50 text-amber-700 border border-amber-100",
  Hygiene: "bg-pink-50 text-pink-600 border border-pink-100",
  "Pain relief": "bg-orange-50 text-orange-600 border border-orange-100",
  Medication: "bg-indigo-50 text-indigo-600 border border-indigo-100",
  "First Aid": "bg-red-50 text-red-600 border border-red-100",
};

export const InventoryManagement = () => {
  const { t } = useTranslation();
  const { selectedBranchId } = useBranch();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("");
  const [expiryStatus, setExpiryStatus] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [totalProductsCount, setTotalProductsCount] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [debouncedSearchTerm] = useDebounce(searchTerm, 500);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState(0);
  const [expiredProducts, setExpiredProducts] = useState(0);
  const [expiringProducts, setExpiringProducts] = useState(0);
  const [sortBy, setSortBy] = useState('expiryDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Ledger dialogs state
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedProductForHistory, setSelectedProductForHistory] = useState<number | null>(null);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [selectedProductForAdjustment, setSelectedProductForAdjustment] = useState<{
    id: number;
    name: string;
    quantity: number;
  } | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    getProducts({
      search: debouncedSearchTerm,
      category,
      expiryStatus,
      page: currentPage,
      limit: itemsPerPage,
      branchId: selectedBranchId,
      sortBy,
      sortOrder,
    });
  }, [debouncedSearchTerm, category, expiryStatus, currentPage, itemsPerPage, selectedBranchId, sortBy, sortOrder]);

  // Close action menu on outside click
  useEffect(() => {
    if (!openActionMenuId) return;
    const handleOutsideClick = () => setOpenActionMenuId(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openActionMenuId]);

  const getProducts = async (params: any) => {
    setLoading(true);

    try {
      const response = await apiClient.getProducts(params);
      const parsed = parseInventoryGetProductsResponse(response);
      setProducts((parsed.items || []) as Product[]);
      setTotalProductsCount(parsed.pagination?.totalItems || parsed.items?.length || 0);
      setLowStockProducts(parsed.lowStockProducts);
      setExpiredProducts(parsed.expiredProducts);
      setExpiringProducts(parsed.expiringProducts);
      setTotalPages(parsed.pagination?.totalPages || 1);
      setCurrentPage(parsed.pagination?.currentPage || 1);
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error(t("messages.errorLoadingData"));
      setLowStockProducts(0);
      setExpiredProducts(0);
      setExpiringProducts(0);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const getExpiryStatusDisplay = (expiryDate?: string) => {
    if (!expiryDate) return { label: "N/A", color: "text-gray-400" };
    const daysRemaining = getDaysRemaining(expiryDate);
    if (isNaN(daysRemaining)) return { label: "N/A", color: "text-gray-400" };
    
    if (daysRemaining < 0) return { label: "Expired", color: "text-red-600 font-semibold" };
    if (daysRemaining <= 30) return { label: `${daysRemaining}d left`, color: "text-amber-600 font-semibold" };
    return { label: new Date(expiryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), color: "text-gray-600" };
  };

  const [uniqueCategories, setUniqueCategories] = useState<string[]>([]);

  useEffect(() => {
    const categories = Array.from(
      new Set(products.map((prod) => prod.category).filter(Boolean))
    ) as string[];
    setUniqueCategories(categories);
  }, [products]);

  const confirmDelete = async () => {
    if (!productToDelete) return;
    setLoading(true);
    try {
      await apiClient.deleteProduct(String(productToDelete.id));
      toast.success(t("messages.productDeleted"));
      await getProducts({
        search: debouncedSearchTerm,
        category,
        expiryStatus,
        page: currentPage,
        limit: itemsPerPage,
      });
    } catch (error: any) {
      toast.error(`${t("messages.deleteError")}: ${error.message}`);
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const downloadTemplate = () => {
    const templateData = [
      [
        "Product Name*",
        "Category*",
        "Unit Price*",
        "Quantity*",
        "Min Stock*",
        "Description",
        "Expiry Date (YYYY/MM/DD) - Optional",
        "Batch Number",
        "Purchase Price - Optional",
        "Barcode - Optional",
        "Packaging Unit Code - Optional (e.g. CT, BX, BO)",
        "Qty per Package - Optional",
      ],
      [
        "Paracetamol",
        "Medication",
        "5.99",
        "50",
        "100",
        "Pain reliever",
        "2025/12/31",
        "BATCH001",
        "3.50",
        "6001234567890",
        "CT",
        "24",
      ],
      [
        "Bandage",
        "First Aid",
        "2.50",
        "50",
        "200",
        "For wounds",
        "2025/12/31",
        "BATCH002",
        "1.20",
        "",
        "",
        "",
      ],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(templateData);

    ws["!cols"] = [
      { wch: 20 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 30 },
      { wch: 20 },
      { wch: 15 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 14 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Products Template");
    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const data = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(data, "Inventory_Upload_Template.xlsx");
  };

  const handleBulkUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const processedProducts: any[] = [];
      const errors: any[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as (string | number | null | undefined)[];
        if (!row || row.every((cell: any) => cell === null || cell === ""))
          continue;

        try {
          if (!row[0] || !row[1] || row[2] === undefined || row[3] === undefined) {
            errors.push(`Row ${i + 1}: Missing required fields`);
            continue;
          }
          let expiryDate: Date | null = null;
          const rawDate = row[6];

          if (rawDate) {
            if (typeof rawDate === "number") {
              const excelEpoch = new Date(1899, 11, 30);
              expiryDate = new Date(excelEpoch.getTime() + (rawDate - 1) * 24 * 60 * 60 * 1000);
            } else if (typeof rawDate === "string" && rawDate.trim() !== "") {
              const [year, month, day] = rawDate.split("/").map(Number);
              if (year && month && day) {
                const parsedDate = new Date(year, month - 1, day);
                if (!isNaN(parsedDate.getTime())) expiryDate = parsedDate;
              }
              if (!expiryDate) {
                const parsedDate = new Date(rawDate);
                if (!isNaN(parsedDate.getTime())) expiryDate = parsedDate;
              }
            }
          }

          if (expiryDate) {
            expiryDate.setHours(0, 0, 0, 0);
            if (expiryDate < today) {
              errors.push(`Row ${i + 1}: Product "${row[0]}" has an expiry date in the past`);
              continue;
            }
          }

          const purchasePriceRaw = row[8];
          const barcodeRaw = String(row[9] || "").trim();
          const pkgUnitCdRaw = String(row[10] || "").trim();
          const packagingQtyRaw = row[11];

          const product = {
            name: String(row[0] || "").trim(),
            category: String(row[1] || "").trim(),
            unitPrice: Number(row[2]) || 0,
            quantity: Number(row[3]) || 0,
            minStock: Number(row[4]) || 0,
            description: String(row[5] || "").trim(),
            expiryDate: expiryDate ? expiryDate.toISOString() : "",
            batchNumber: String(row[7] || `BATCH-${Date.now()}-${i}`).trim(),
            purchasePrice: purchasePriceRaw !== undefined && purchasePriceRaw !== "" && !isNaN(Number(purchasePriceRaw))
              ? Number(purchasePriceRaw)
              : undefined,
            barcode: barcodeRaw || undefined,
            pkgUnitCd: pkgUnitCdRaw || undefined,
            packagingQty: packagingQtyRaw !== undefined && packagingQtyRaw !== "" && !isNaN(Number(packagingQtyRaw))
              ? Number(packagingQtyRaw)
              : undefined,
          };

          processedProducts.push(product);
        } catch (error: any) {
          errors.push(`Error processing row ${i + 1}: ${error.message}`);
        }
      }

      if (processedProducts.length > 0) {
        if (!selectedBranchId) {
          toast.error("Please select a specific branch to import products");
        } else {
          try {
            await apiClient.createProducts(processedProducts, selectedBranchId);
            await getProducts({
              search: debouncedSearchTerm,
              category,
              expiryStatus,
              page: currentPage,
              limit: itemsPerPage,
            });
            toast.success(`Successfully imported ${processedProducts.length} product(s)`);
          } catch (error: any) {
            toast.error(error?.response?.data?.message || "Import failed");
          }
        }
      }
      event.target.value = "";
    } catch (error) {
      console.error("Error processing file:", error);
      toast.error("There was an error processing the file.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Inventory Management
            <Layers className="h-5 w-5 text-gray-400" />
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Track and manage product stock levels in real-time
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <label className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm">
            <input
              type="file"
              accept=".xlsx"
              onChange={handleBulkUpload}
              className="hidden"
              disabled={isUploading}
            />
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : <Upload className="h-4 w-4 text-gray-500" />}
            Import Products
          </label>

          <Button
            onClick={downloadTemplate}
            variant="outline"
            className="h-9 rounded-xl border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200 font-semibold text-sm shadow-sm hover:bg-gray-50"
          >
            <Download className="h-4 w-4 mr-1.5 text-gray-500" />
            Download Template
          </Button>

          <Button
            onClick={() => { setEditingProduct(null); setIsDialogOpen(true); }}
            className="h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-sm shadow-blue-500/20"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Add/Edit Product Drawer */}
      <Drawer open={isDialogOpen} onOpenChange={(open) => { if (!open) setEditingProduct(null); setIsDialogOpen(open); }}>
        <DrawerContent className="sm:max-w-[680px] h-full min-h-[60vh] overflow-y-auto bg-white dark:bg-gray-900">
          <DrawerHeader className="border-b border-gray-200 dark:border-gray-700 pb-4 rounded-tl-2xl rounded-tr-2xl">
            <DrawerTitle className="text-lg font-semibold">{editingProduct ? 'Edit Product' : 'Add New Product'}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            <AddProduct product={editingProduct} onSuccess={() => {
              getProducts({ search: debouncedSearchTerm, category, expiryStatus, page: currentPage, limit: itemsPerPage, branchId: selectedBranchId });
              setEditingProduct(null);
              setIsDialogOpen(false);
            }} />
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── 4 KPI Cards Grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Products */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                TOTAL PRODUCTS
              </p>
              <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                {(totalProductsCount || products.length || 0).toLocaleString()}
              </h3>
              <p className="text-xs text-gray-400 mt-1">All products in inventory</p>
            </div>
            <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <Package className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-emerald-600">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>12%</span>
            <span className="text-gray-400 font-normal">vs last month</span>
          </div>
        </div>

        {/* Low Stock */}
        <div
          onClick={() => navigate("/dashboard/low-stock")}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between cursor-pointer hover:shadow-md transition-all"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                LOW STOCK
              </p>
              <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                {lowStockProducts || 0}
              </h3>
              <p className="text-xs text-gray-400 mt-1">Items below minimum stock</p>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-emerald-600">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>8%</span>
            <span className="text-gray-400 font-normal">vs last month</span>
          </div>
        </div>

        {/* Expired */}
        <div
          onClick={() => navigate("/dashboard/expired")}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between cursor-pointer hover:shadow-md transition-all"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                EXPIRED
              </p>
              <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                {String(expiredProducts || 0).padStart(2, "0")}
              </h3>
              <p className="text-xs text-gray-400 mt-1">Items past expiry date</p>
            </div>
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
              <Calendar className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-rose-500">
            <ArrowDownRight className="h-3.5 w-3.5" />
            <span>3%</span>
            <span className="text-gray-400 font-normal">vs last month</span>
          </div>
        </div>

        {/* Expiring Soon */}
        <div
          onClick={() => navigate("/dashboard/expiring-products")}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex flex-col justify-between cursor-pointer hover:shadow-md transition-all"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                EXPIRING SOON
              </p>
              <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                {expiringProducts || 0}
              </h3>
              <p className="text-xs text-gray-400 mt-1">Items expiring within 90 days</p>
            </div>
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 text-xs font-semibold text-emerald-600">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>15%</span>
            <span className="text-gray-400 font-normal">vs last month</span>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Row ─────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, SKU, or batch number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-9 h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Category Dropdown */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-10 px-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all w-full md:w-44"
            >
              <option value="">All Categories</option>
              {uniqueCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {/* Expiry Status Dropdown */}
            <select
              value={expiryStatus}
              onChange={(e) => setExpiryStatus(e.target.value)}
              className="h-10 px-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all w-full md:w-36"
            >
              <option value="">All Status</option>
              <option value="expired">Expired</option>
              <option value="expiring">Expiring Soon</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Products Table ──────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={10} rowHeight="h-10" />
          </div>
        ) : products.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-gray-400 gap-3">
            <Package className="h-12 w-12 text-gray-300" />
            <p className="text-sm font-medium">{t("messages.noData")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <TableRow className="hover:bg-transparent">
                {[
                  { label: "ID", key: "id" },
                  { label: "Product Code", key: "" },
                  { label: "Product", key: "name" },
                  { label: "Batch Number", key: "batchNumber" },
                  { label: "Category", key: "category" },
                  { label: "Qty", key: "quantity" },
                  { label: "Price", key: "sellingPrice" },
                  { label: "Expiry Date", key: "expiryDate" },
                  { label: "Status", key: "" },
                  { label: "Actions", key: "" },
                ].map(({ label, key }) => (
                  <TableHead
                    key={label}
                    aria-sort={key && sortBy === key ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      "text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap py-3.5",
                      key && "cursor-pointer select-none hover:text-blue-600",
                    )}
                    onClick={() => {
                      if (!key) return;
                      setSortOrder(sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc');
                      setSortBy(key);
                      setCurrentPage(1);
                    }}
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {key && (
                        <svg className={cn("h-3 w-3", sortBy === key ? "text-blue-600" : "text-gray-400")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          {sortBy === key && sortOrder === 'desc'
                            ? <path d="M12 5v14m0 0 5-5m-5 5-5-5" />
                            : <path d="M12 19V5m0 0 5 5m-5-5-5 5" />}
                        </svg>
                      )}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((prod, idx) => {
                const expiry = getExpiryStatusDisplay(prod.expiryDate);
                const pillClass = categoryPillColors[prod.category || ""] || "bg-blue-50 text-blue-600 border border-blue-100";
                const isLow = prod.quantity <= (prod.minStock || 5);
                const codeId = `PRD-${String(prod.id).padStart(3, "0")}`;

                return (
                  <TableRow
                    key={prod.id}
                    className="border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    {/* ID */}
                    <TableCell className="py-3.5 text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                      <button onClick={() => setViewProduct(prod)} className="hover:underline">
                        {codeId}
                      </button>
                    </TableCell>

                    {/* RRA Product Code (itemCd) */}
                    <TableCell className="py-3.5 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {prod.itemCd || <span className="text-gray-300 dark:text-gray-600">Not registered</span>}
                    </TableCell>

                    {/* Product Name & Thumbnail */}
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 overflow-hidden flex items-center justify-center flex-shrink-0">
                          {prod.imageUrl ? (
                            <img src={prod.imageUrl} alt={prod.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                              {prod.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900 dark:text-white">{prod.name}</p>
                          <p className="text-[11px] text-gray-400 font-normal">{prod.category || "General"}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Batch Number */}
                    <TableCell className="py-3.5 text-xs font-mono text-gray-500 dark:text-gray-400">
                      {prod.batchNumber || `BTH-2024-${String(idx + 1).padStart(3, "0")}`}
                    </TableCell>

                    {/* Category Pill */}
                    <TableCell className="py-3.5">
                      <div className="flex flex-col gap-1">
                        <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold w-fit", pillClass)}>
                          {prod.category || "Unassigned"}
                        </span>
                        {prod.pkgUnitCd && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {PACKAGING_UNIT_LABELS[prod.pkgUnitCd] || prod.pkgUnitCd}
                            {prod.packagingQty ? ` × ${prod.packagingQty}` : ""}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Quantity */}
                    <TableCell className="py-3.5 text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                      {prod.quantity}
                    </TableCell>

                    {/* Price */}
                    <TableCell className="py-3.5 text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                      {(prod.unitPrice ?? 0).toLocaleString()} <span className="font-normal text-gray-400">Frw</span>
                      {prod.purchasePrice != null && (
                        <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">
                          Cost: {Number(prod.purchasePrice).toLocaleString()} Frw
                        </div>
                      )}
                    </TableCell>

                    {/* Expiry Date */}
                    <TableCell className="py-3.5 text-xs whitespace-nowrap">
                      <span className={expiry.color}>{expiry.label}</span>
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell className="py-3.5">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold",
                        prod.quantity <= 0
                          ? "bg-red-50 text-red-600 border border-red-100"
                          : isLow
                            ? "bg-amber-50 text-amber-700 border border-amber-100"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                      )}>
                        {prod.quantity <= 0 ? "Out of Stock" : isLow ? "Low Stock" : "In Stock"}
                      </span>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewProduct(prod)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="View product"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setEditingProduct(prod); setIsDialogOpen(true); }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Edit product"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenActionMenuId(openActionMenuId === String(prod.id) ? null : String(prod.id));
                            }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openActionMenuId === String(prod.id) && (
                            <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-30 py-1 text-xs">
                              <button
                                onClick={() => {
                                  setSelectedProductForHistory(Number(prod.id));
                                  setHistoryDialogOpen(true);
                                  setOpenActionMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                              >
                                <History className="h-3.5 w-3.5 text-blue-500" />
                                Movement History
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedProductForAdjustment({ id: Number(prod.id), name: prod.name, quantity: prod.quantity });
                                  setAdjustmentDialogOpen(true);
                                  setOpenActionMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5 text-purple-500" />
                                Stock Adjustment
                              </button>
                              <button
                                onClick={() => {
                                  setProductToDelete({ id: String(prod.id), name: prod.name });
                                  setDeleteDialogOpen(true);
                                  setOpenActionMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Product
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* ── Pagination ───────────────────────────────────────────────────── */}
        {!loading && products.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalProductsCount || products.length)} of {(totalProductsCount || products.length).toLocaleString()} results
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
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
                    onClick={() => handlePageChange(page)}
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
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <select
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
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

      {/* Modals & Dialogs */}
      {viewProduct && (
        <ViewProductDialog
          viewProduct={viewProduct}
          setViewProduct={setViewProduct}
          onStockUpdated={() => {
            getProducts({
              search: debouncedSearchTerm,
              category,
              expiryStatus,
              page: currentPage,
              limit: itemsPerPage,
              branchId: selectedBranchId,
            });
          }}
        />
      )}

      {historyDialogOpen && selectedProductForHistory && (
        <InventoryHistoryDialog
          productId={selectedProductForHistory}
          productName={products.find(p => p.id === selectedProductForHistory)?.name}
          open={historyDialogOpen}
          onOpenChange={setHistoryDialogOpen}
        />
      )}

      {adjustmentDialogOpen && selectedProductForAdjustment && (
        <StockAdjustmentDialog
          productId={selectedProductForAdjustment.id}
          productName={selectedProductForAdjustment.name}
          currentStock={selectedProductForAdjustment.quantity}
          open={adjustmentDialogOpen}
          onOpenChange={setAdjustmentDialogOpen}
          onSuccess={() => {
            getProducts({
              search: debouncedSearchTerm,
              category,
              expiryStatus,
              page: currentPage,
              limit: itemsPerPage,
              branchId: selectedBranchId,
            });
          }}
        />
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Product"
        message={`Are you sure you want to delete "${productToDelete?.name}"?`}
        confirmText="Delete"
        variant="destructive"
        loading={loading}
      />
    </div>
  );
};

export default InventoryManagement;

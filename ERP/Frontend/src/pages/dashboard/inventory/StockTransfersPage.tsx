import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  ArrowRight,
  ArrowRightLeft,
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { useBranch } from "../../../context/BranchContext";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { SearchableSelect } from "../../../components/ui/SearchableSelect";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  PENDING:
    "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED:
    "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  COMPLETED:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  REJECTED:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function statusBadgeClass(status: string) {
  return STATUS_BADGE_CLASSES[status] ?? "";
}

type TransferRow = {
  id: number;
  status: string;
  fromBranchId: number;
  toBranchId: number;
  notes: string | null;
  fromBranch: { name: string; code: string };
  toBranch: { name: string; code: string };
  items: Array<{
    quantity: number;
    product: { id: number; name: string };
  }>;
};

export default function StockTransfersPage() {
  const { selectedBranchId } = useBranch();
  const orgId = localStorage.getItem("current_organization_id");
  const [loading, setLoading] = useState(true);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>(
    []
  );
  const [products, setProducts] = useState<
    Array<{ id: number; name: string; sku?: string | null }>
  >([]);
  const [fromBranchId, setFromBranchId] = useState<string>("");
  const [toBranchId, setToBranchId] = useState<string>("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await apiClient.getStockTransfers(orgId, selectedBranchId);
      const list = (res as { data?: TransferRow[] })?.data ?? (res as TransferRow[]);
      setTransfers(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load transfers");
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedBranchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const fetchBranches = async () => {
      if (!orgId) return;
      try {
        const res = await apiClient.getBranches();
        const raw = (res as { data?: unknown })?.data ?? res;
        const arr = Array.isArray(raw) ? raw : [];
        setBranches(
          arr.map((b: { id: number; name: string }) => ({ id: b.id, name: b.name }))
        );
      } catch {
        setBranches([]);
      }
    };
    fetchBranches();
  }, [orgId]);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!orgId) return;
      try {
        const res = await apiClient.getProducts({
          organizationId: orgId,
          limit: 1000,
        });
        const items = parseInventoryGetProductsResponse(res).items as Array<{
          id: number;
          name: string;
          sku?: string | null;
        }>;
        setProducts(items);
      } catch {
        setProducts([]);
      }
    };
    fetchProducts();
  }, [orgId]);

  const approve = async (id: number) => {
    if (!orgId) return;
    try {
      await apiClient.approveStockTransfer(orgId, id, selectedBranchId);
      toast.success("Transfer approved");
      load();
    } catch (e: any) {
      toast.error(e.message || "Approve failed");
    }
  };

  const reject = async (id: number) => {
    if (!orgId) return;
    try {
      await apiClient.rejectStockTransfer(orgId, id, selectedBranchId);
      toast.success("Transfer rejected");
      load();
    } catch (e: any) {
      toast.error(e.message || "Reject failed");
    }
  };

  const complete = async (id: number) => {
    if (!orgId) return;
    try {
      await apiClient.completeStockTransfer(orgId, id, selectedBranchId);
      toast.success("Transfer completed");
      load();
    } catch (e: any) {
      toast.error(e.message || "Complete failed");
    }
  };

  const createTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!orgId) return;
    if (!fromBranchId) {
      toast.error("Select a from branch");
      return;
    }
    if (!toBranchId) {
      toast.error("Select a to branch");
      return;
    }
    if (fromBranchId === toBranchId) {
      toast.error("From and to branches must be different");
      return;
    }
    const pid = parseInt(productId, 10);
    const q = parseInt(qty, 10);
    if (!pid) {
      toast.error("Select a product");
      return;
    }
    if (!q || q < 1) {
      toast.error("Enter a valid quantity");
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.createStockTransfer(
        orgId,
        {
          fromBranchId: parseInt(fromBranchId, 10),
          toBranchId: parseInt(toBranchId, 10),
          items: [{ productId: pid, quantity: q }],
        },
        selectedBranchId
      );
      toast.success("Transfer created");
      setProductId("");
      setQty("1");
      setAttempted(false);
      setShowForm(false);
      load();
    } catch (err: any) {
      toast.error(err.message || "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!orgId) {
    return (
      <div className="p-6 text-muted-foreground">
        Select an organization to manage stock transfers.
      </div>
    );
  }

  const fromBranchName = branches.find((b) => String(b.id) === fromBranchId)?.name;
  const toBranchName = branches.find((b) => String(b.id) === toBranchId)?.name;

  const pending = transfers.filter((t) => t.status === "PENDING").length;
  const approved = transfers.filter((t) => t.status === "APPROVED").length;
  const completed = transfers.filter((t) => t.status === "COMPLETED").length;
  const rejected = transfers.filter((t) => t.status === "REJECTED").length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <ArrowRightLeft className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Stock Transfers</h1>
              <p className="text-sm text-white/70 mt-0.5">
                Move inventory between branches — approve, then complete to transfer stock
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowForm((v) => !v)}
            className="gap-2 bg-white text-violet-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            New Transfer
          </Button>
        </div>
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: "Total Transfers",
            value: transfers.length,
            icon: ArrowRightLeft,
            color: "from-violet-500 to-purple-600",
            light: "bg-violet-50 dark:bg-violet-900/20",
            text: "text-violet-600 dark:text-violet-400",
          },
          {
            label: "Pending",
            value: pending,
            icon: Clock,
            color: "from-amber-500 to-orange-500",
            light: "bg-amber-50 dark:bg-amber-900/20",
            text: "text-amber-600 dark:text-amber-400",
          },
          {
            label: "Approved",
            value: approved,
            icon: TrendingUp,
            color: "from-blue-500 to-cyan-500",
            light: "bg-blue-50 dark:bg-blue-900/20",
            text: "text-blue-600 dark:text-blue-400",
          },
          {
            label: "Completed",
            value: completed,
            icon: CheckCircle2,
            color: "from-emerald-500 to-green-500",
            light: "bg-emerald-50 dark:bg-emerald-900/20",
            text: "text-emerald-600 dark:text-emerald-400",
          },
        ].map(({ label, value, icon: Icon, light, text }) => (
          <div
            key={label}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4"
          >
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0", light)}>
              <Icon className={cn("h-5 w-5", text)} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* New Transfer Form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                New Transfer
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                One product per transfer. Create multiple for more lines.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg font-bold"
            >
              ✕
            </button>
          </div>
          <form onSubmit={createTransfer} className="p-6 space-y-4">
            {/* Branch row */}
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <Label>
                  From Branch <span className="text-red-500">*</span>
                </Label>
                <Select value={fromBranchId} onValueChange={setFromBranchId}>
                  <SelectTrigger
                    className={cn(
                      "w-full",
                      attempted &&
                        !fromBranchId &&
                        "border-red-400 ring-1 ring-red-300"
                    )}
                  >
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem
                        key={b.id}
                        value={String(b.id)}
                        disabled={String(b.id) === toBranchId}
                      >
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {attempted && !fromBranchId && (
                  <p className="text-xs text-red-500">Select a branch to transfer from.</p>
                )}
              </div>

              <div className="flex w-9 shrink-0 flex-col items-center pt-[26px]">
                <div className="relative flex h-9 w-full items-center justify-center">
                  <div className="absolute inset-x-0 h-px bg-gray-200 dark:bg-gray-700" />
                  <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-1.5">
                <Label>
                  To Branch <span className="text-red-500">*</span>
                </Label>
                <Select value={toBranchId} onValueChange={setToBranchId}>
                  <SelectTrigger
                    className={cn(
                      "w-full",
                      attempted &&
                        !toBranchId &&
                        "border-red-400 ring-1 ring-red-300"
                    )}
                  >
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem
                        key={b.id}
                        value={String(b.id)}
                        disabled={String(b.id) === fromBranchId}
                      >
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {attempted && !toBranchId && (
                  <p className="text-xs text-red-500">Select a branch to transfer to.</p>
                )}
              </div>
            </div>

            {fromBranchName && toBranchName && (
              <div className="flex items-center gap-2 rounded-lg bg-violet-50 dark:bg-violet-900/20 px-3 py-2 text-sm text-violet-700 dark:text-violet-300">
                <span className="font-semibold">{fromBranchName}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">{toBranchName}</span>
              </div>
            )}

            <div className="grid grid-cols-[1fr_120px] gap-4">
              <div className="space-y-1.5">
                <Label>
                  Product <span className="text-red-500">*</span>
                </Label>
                <SearchableSelect
                  value={productId}
                  onChange={setProductId}
                  placeholder="Search product by name..."
                  searchPlaceholder="Type to search products..."
                  emptyText="No products found."
                  className={cn(
                    attempted && !productId && "border-red-400 ring-1 ring-red-300"
                  )}
                  options={products.map((p) => ({
                    value: String(p.id),
                    label: p.name,
                    sublabel: p.sku ?? undefined,
                  }))}
                />
                {attempted && !productId && (
                  <p className="text-xs text-red-500">Select a product to transfer.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  inputMode="numeric"
                  min={1}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={submitting}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {submitting ? "Creating..." : "Create Transfer"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Transfers Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              All Transfers
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {transfers.length} total transfer{transfers.length !== 1 ? "s" : ""}
            </p>
          </div>
          {rejected > 0 && (
            <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
              {rejected} Rejected
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          </div>
        ) : transfers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-900/20">
              <ArrowRightLeft className="h-8 w-8 text-violet-400" />
            </div>
            <p className="text-base font-semibold text-gray-700 dark:text-gray-300">
              No transfers yet
            </p>
            <p className="text-sm text-gray-400">
              Create your first stock transfer using the button above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 dark:bg-gray-700/50">
                  <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    ID
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Route
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Items
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow
                    key={t.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-gray-400">
                      #{t.id}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-medium text-sm text-gray-900 dark:text-white">
                        <span className="truncate max-w-[100px]">{t.fromBranch?.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="truncate max-w-[100px]">{t.toBranch?.name}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs font-medium", statusBadgeClass(t.status))}>
                        {t.status === "COMPLETED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {t.status === "REJECTED" && <XCircle className="h-3 w-3 mr-1" />}
                        {t.status === "PENDING" && <Clock className="h-3 w-3 mr-1" />}
                        {t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      {t.items?.map((i) => (
                        <div key={i.product.id}>
                          {i.product.name}{" "}
                          <span className="text-gray-400">× {i.quantity}</span>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {t.status === "PENDING" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => approve(t.id)}
                              className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => reject(t.id)}
                              className="h-7 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {t.status === "APPROVED" && (
                          <Button
                            size="sm"
                            onClick={() => complete(t.id)}
                            className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            Complete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

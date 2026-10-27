import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import {
  Button,
} from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Input,
} from "../../../components/ui/input";
import {
  Label,
} from "../../../components/ui/label";
import { Loader2, CheckCircle, XCircle, History, Package, Settings } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import { toast } from "react-toastify";
import { useBranch } from "../../../context/BranchContext";
import { BomManagement } from "./BomManagement";

interface FinishedProduct {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  itemType: string;
  measurementUnit: string;
  unitPrice: number;
  quantity: number;
  minStock: number;
}

interface ProductionRun {
  id: number;
  productId: number;
  quantity: number;
  producedAt: string;
  note: string | null;
  userId: number;
  product: {
    id: number;
    name: string;
    sku: string | null;
    barcode: string | null;
  };
  user: {
    id: number;
    name: string;
    email: string;
  };
}

interface ProductionRequirements {
  parentProductId: number;
  quantityToProduce: number;
  branchId: number;
  organizationId: number;
  components: Array<{
    componentProductId: number;
    componentName: string;
    requiredQuantity: number;
    requiredUnit: string;
    availableStock: number;
    unitCost: number;
  }>;
  canProduce: boolean;
  limitingComponent?: {
    componentProductId: number;
    componentName: string;
    availableStock: number;
    requiredQuantity: number;
  };
}

export const ProductionPage = () => {
  const { selectedBranchId } = useBranch();

  const [finishedProducts, setFinishedProducts] = useState<FinishedProduct[]>([]);
  const [productionRuns, setProductionRuns] = useState<ProductionRun[]>([]);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
  const [productionLoading, setProductionLoading] = useState(false);
  
  const [selectedProduct, setSelectedProduct] = useState<FinishedProduct | null>(null);
  const [quantityToProduce, setQuantityToProduce] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const [requirements, setRequirements] = useState<ProductionRequirements | null>(null);
  const [showRequirements, setShowRequirements] = useState(false);

  useEffect(() => {
    if (selectedBranchId) {
      fetchFinishedProducts();
      fetchProductionRuns();
    }
  }, [selectedBranchId]);

  const fetchFinishedProducts = async () => {
    try {
      const response = await apiClient.getProducts({
        itemType: 'PRODUCT',
        limit: 500,
        branchId: selectedBranchId,
      });
      setFinishedProducts(parseInventoryGetProductsResponse(response).items as FinishedProduct[]);
    } catch (error) {
      console.error('Error fetching finished products:', error);
    }
  };

  const fetchProductionRuns = async () => {
    try {
      const response = await apiClient.getProductionRuns(apiClient.getOrganizationId(), {
        branchId: selectedBranchId ?? undefined,
        limit: 50,
      });
      setProductionRuns(response.data?.runs || []);
    } catch (error) {
      console.error('Error fetching production runs:', error);
    }
  };

  const checkRequirements = async () => {
    if (!selectedProduct || !quantityToProduce || !selectedBranchId) return;

    setRequirementsLoading(true);
    try {
      const response = await apiClient.checkProductionRequirements(apiClient.getOrganizationId(), selectedProduct.id, {
        quantity: Number(quantityToProduce),
        branchId: selectedBranchId,
      });
      setRequirements(response.data);
      setShowRequirements(true);
    } catch (error: any) {
      const message =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to check requirements';
      toast.error(message);
      setRequirements(null);
      setShowRequirements(false);
    } finally {
      setRequirementsLoading(false);
    }
  };

  const runProduction = async () => {
    if (!selectedProduct || !quantityToProduce || !selectedBranchId) {
      toast.error('Please select a product and enter quantity');
      return;
    }

    if (!requirements?.canProduce) {
      toast.error('Cannot produce - insufficient raw materials');
      return;
    }

    setProductionLoading(true);
    try {
      await apiClient.createProductionRun(apiClient.getOrganizationId(), {
          branchId: selectedBranchId,
          productId: selectedProduct.id,
          quantity: parseFloat(quantityToProduce),
          batchNumber: batchNumber || undefined,
          expiryDate: expiryDate || undefined,
          note: note || undefined,
        });
      toast.success(`Successfully produced ${quantityToProduce} units of ${selectedProduct.name}!`);
      setQuantityToProduce('');
      setBatchNumber('');
      setExpiryDate('');
      setNote('');
      setRequirements(null);
      setShowRequirements(false);
      setSelectedProduct(null);
      fetchFinishedProducts();
      fetchProductionRuns();
    } catch (error: any) {
      const message =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'Production failed';
      toast.error(message);
    } finally {
      setProductionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="h-6 w-6 text-blue-600" />
            Production
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Manufacture finished products from raw materials
          </p>
        </div>
      </div>

      {/* Production Form */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Create Production Run</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="product">Finished Product *</Label>
            <Select
              value={selectedProduct ? String(selectedProduct.id) : ''}
              onValueChange={(value) => {
                const product = finishedProducts.find(p => p.id === parseInt(value));
                setSelectedProduct(product || null);
                setRequirements(null);
                setShowRequirements(false);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a finished product" />
              </SelectTrigger>
              <SelectContent>
                {finishedProducts.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} {p.sku ? `(${p.sku})` : ''} - Stock: {p.quantity} {p.measurementUnit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quantityToProduce">Quantity to Produce *</Label>
            <Input
              id="quantityToProduce"
              type="number"
              step="0.001"
              min="0.001"
              value={quantityToProduce}
              onChange={(e) => setQuantityToProduce(e.target.value)}
              placeholder="Enter quantity"
              disabled={!selectedProduct}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="batchNumber">Batch Number (Optional)</Label>
            <Input
              id="batchNumber"
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="Auto-generated if empty"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiryDate">Expiry Date (Optional)</Label>
            <Input
              id="expiryDate"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <Label htmlFor="note">Notes (Optional)</Label>
          <Input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Production notes..."
          />
        </div>

        {selectedProduct && quantityToProduce && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={checkRequirements}
              disabled={requirementsLoading}
            >
              {requirementsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              <Settings className="h-4 w-4 mr-1.5" />
              Check Requirements
            </Button>
          </div>
        )}

        {/* Requirements Check Result */}
        {showRequirements && requirements && (
          <div className={`mt-6 p-4 rounded-xl border ${requirements.canProduce ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-rose-300 bg-rose-50 dark:bg-rose-900/20'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {requirements.canProduce ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-rose-600" />
                )}
                <h3 className={`font-semibold ${requirements.canProduce ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>
                  {requirements.canProduce ? 'Production Possible' : 'Insufficient Materials'}
                </h3>
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Total Cost: {requirements.components.reduce((sum, c) => sum + c.requiredQuantity * c.unitCost, 0).toLocaleString()} Frw
              </span>
            </div>

            <Table className="text-sm">
              <TableHeader className="bg-gray-50 dark:bg-gray-700/50">
                <TableRow>
                  <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-2">Raw Material</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 text-center">Required</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 text-center">Available</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 text-center">Unit Cost</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 text-center">Total Cost</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requirements.components.map((comp) => (
                  <TableRow key={comp.componentProductId}>
                    <TableCell className="px-4 py-2 font-medium">{comp.componentName}</TableCell>
                    <TableCell className="px-4 py-2 text-center font-mono">
                      {comp.requiredQuantity} {comp.requiredUnit}
                    </TableCell>
                    <TableCell className={`px-4 py-2 text-center font-mono ${comp.availableStock < comp.requiredQuantity ? 'text-rose-600' : ''}`}>
                      {comp.availableStock} {comp.requiredUnit}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      {comp.unitCost.toLocaleString()} Frw
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right font-medium">
                      {(comp.requiredQuantity * comp.unitCost).toLocaleString()} Frw
                    </TableCell>
                    <TableCell className="px-4 py-2 text-center">
                      {comp.availableStock >= comp.requiredQuantity ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                          ✓ OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
                          ✗ Short by {comp.requiredQuantity - comp.availableStock}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {requirements.canProduce && (
              <div className="mt-4 pt-4 border-t">
                <Button
                  onClick={runProduction}
                  disabled={productionLoading}
                  className="w-full"
                  size="lg"
                >
                  {productionLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                  Produce {quantityToProduce} units of {selectedProduct?.name}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedProduct && selectedBranchId != null && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <BomManagement
            productId={selectedProduct.id}
            organizationId={Number(apiClient.getOrganizationId())}
            branchId={selectedBranchId}
          />
        </div>
      )}

      {/* Production History */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <History className="h-5 w-5" />
            Production History
          </h2>
        </div>
        
        {productionRuns.length === 0 ? (
          <div className="py-12 text-center text-gray-500 dark:text-gray-400">
            <History className="mx-auto h-12 w-12 text-gray-300 mb-4" />
            <p>No production runs yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-700/50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Run ID</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Product</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3 text-center">Qty Produced</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Date</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Produced By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productionRuns.map((run) => (
                <TableRow key={run.id} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-700/30">
                  <TableCell className="px-4 py-3 font-mono text-blue-600 dark:text-blue-400">
                    PROD-{String(run.id).padStart(6, '0')}
                  </TableCell>
                  <TableCell className="px-4 py-3 font-medium">
                    {run.product.name}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-white">
                    {Number(run.quantity).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {new Date(run.producedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {run.user.name}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default ProductionPage;

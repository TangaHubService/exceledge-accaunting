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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
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
import { Plus, Trash2, Calculator, Loader2 } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import { toast } from "react-toastify";

interface BomComponent {
  id: number;
  parentProductId: number;
  componentProductId: number;
  quantity: number;
  unit: string;
  createdAt: string;
  updatedAt: string;
  componentProduct: {
    id: number;
    name: string;
    sku: string | null;
    barcode: string | null;
    itemType: string;
    measurementUnit: string;
    unitPrice: number;
    quantity: number;
  };
}

interface BomCost {
  totalCost: number;
  components: Array<{
    componentId: number;
    name: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }>;
}

export const BomManagement = ({ productId, organizationId, branchId }: {
  productId: number;
  organizationId: number;
  branchId: number;
  onClose?: () => void;
}) => {
  const [components, setComponents] = useState<BomComponent[]>([]);
  const [cost, setCost] = useState<BomCost | null>(null);
  const [loading, setLoading] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newComponent, setNewComponent] = useState({ componentProductId: '', quantity: '', unit: '' });
  const [availableRawMaterials, setAvailableRawMaterials] = useState<Array<{
    id: number;
    name: string;
    sku: string | null;
    measurementUnit: string;
    unitPrice: number;
    quantity: number;
  }>>([]);

  const fetchComponents = async () => {
    try {
      const response = await apiClient.getBomComponents(organizationId, productId);
      setComponents(response.data || []);
    } catch (error) {
      console.error('Error fetching BOM:', error);
      toast.error('Failed to load BOM components');
    }
  };

  const fetchCost = async () => {
    try {
      const response = await apiClient.getBomCost(organizationId, productId);
      setCost(response.data);
    } catch (error) {
      console.error('Error fetching BOM cost:', error);
    }
  };

  const fetchRawMaterials = async () => {
    try {
      const response = await apiClient.getProducts({
        itemType: 'RAW_MATERIAL',
        limit: 500,
        branchId,
      });
      const rawMaterials = (parseInventoryGetProductsResponse(response).items as Array<{ itemType?: string }>).filter((p) => p.itemType === 'RAW_MATERIAL');
      setAvailableRawMaterials(rawMaterials as typeof availableRawMaterials);
    } catch (error) {
      console.error('Error fetching raw materials:', error);
    }
  };

  useEffect(() => {
    fetchComponents();
    fetchCost();
    fetchRawMaterials();
  }, [productId, organizationId, branchId]);

  const handleAddComponent = async () => {
    if (!newComponent.componentProductId || !newComponent.quantity || !newComponent.unit) {
      toast.error('Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      await apiClient.addBomComponent(organizationId, productId, {
          componentProductId: parseInt(newComponent.componentProductId),
          quantity: parseFloat(newComponent.quantity),
          unit: newComponent.unit,
        });
      try {
        await apiClient.syncBomCompositionToRra(productId, newComponent.componentProductId);
        toast.success('BOM component added and synced to RRA');
      } catch (syncErr: any) {
        toast.success('BOM component added locally');
        toast.error(syncErr?.message ?? 'RRA composition sync failed — retry from Fiscal reports if needed');
      }
      setAddDialogOpen(false);
      setNewComponent({ componentProductId: '', quantity: '', unit: '' });
      fetchComponents();
      fetchCost();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to add component');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveComponent = async (componentProductId: number) => {
    if (!confirm('Are you sure you want to remove this component from the BOM?')) return;

    setLoading(true);
    try {
      await apiClient.removeBomComponent(organizationId, productId, componentProductId);
      toast.success('Component removed from BOM');
      fetchComponents();
      fetchCost();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to remove component');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Bill of Materials</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Define raw materials required to produce one unit of this finished product
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} disabled={loading}>
          <Plus className="h-4 w-4 mr-2" />
          Add Component
        </Button>
      </div>

      {/* Cost Summary */}
      {cost && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Production Cost per Unit</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {cost.totalCost.toLocaleString()} <span className="text-sm font-normal text-gray-400">Frw</span>
              </p>
            </div>
            <Button variant="outline" onClick={fetchCost} disabled={loading} size="sm">
              <Calculator className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {cost.components.map((comp, idx) => (
              <div key={idx} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">{comp.name}</p>
                <p className="font-semibold">{comp.quantity} × {comp.unitCost.toLocaleString()} = {comp.totalCost.toLocaleString()} Frw</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Components Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {components.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto h-12 w-12 text-gray-300">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="h-12 w-12"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            </div>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">No BOM Components</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Add raw materials to define the recipe for this finished product</p>
            <Button onClick={() => setAddDialogOpen(true)} className="mt-4">
              <Plus className="h-4 w-4 mr-2" />
              Add First Component
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-700/50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Raw Material</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Qty per Unit</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Unit</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Unit Cost</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3">Total Cost/Unit</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-4 py-3 w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.map((comp) => (
                <TableRow key={comp.componentProductId} className="border-t border-gray-100 dark:border-gray-700/50">
                  <TableCell className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{comp.componentProduct.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        SKU: {comp.componentProduct.sku || 'N/A'} • Stock: {comp.componentProduct.quantity} {comp.componentProduct.measurementUnit}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center font-mono text-gray-900 dark:text-white">
                    {Number(comp.quantity)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">
                    {comp.unit}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                    {Number(comp.componentProduct.unitPrice).toLocaleString()} Frw
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right font-semibold text-blue-600 dark:text-blue-400">
                    {(Number(comp.quantity) * Number(comp.componentProduct.unitPrice)).toLocaleString()} Frw
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                      onClick={() => handleRemoveComponent(comp.componentProductId)}
                      disabled={loading}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add Component Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add BOM Component</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="componentProductId">Raw Material *</Label>
              <Select
                value={newComponent.componentProductId}
                onValueChange={(value) => setNewComponent(prev => ({ ...prev, componentProductId: value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a raw material" />
                </SelectTrigger>
                <SelectContent>
                  {availableRawMaterials.map((rm) => (
                    <SelectItem key={rm.id} value={String(rm.id)}>
                      {rm.name} {rm.sku ? `(${rm.sku})` : ''} - Stock: {rm.quantity} {rm.measurementUnit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity per Unit *</Label>
                <Input
                  id="quantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={newComponent.quantity}
                  onChange={(e) => setNewComponent(prev => ({ ...prev, quantity: e.target.value }))}
                  placeholder="e.g. 2.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unit *</Label>
                <Input
                  id="unit"
                  value={newComponent.unit}
                  onChange={(e) => setNewComponent(prev => ({ ...prev, unit: e.target.value }))}
                  placeholder="e.g. KG, PCS, LTR"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleAddComponent} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Add Component
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BomManagement;

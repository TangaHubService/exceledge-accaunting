import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../../lib/api-client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Badge } from '../../../components/ui/badge';
import { AppToggle } from '../../../components/ui/AppToggle';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '../../../components/ui/drawer';
import {
  Loader2,
  Plus,
  Edit,
  Trash2,
  Warehouse as WarehouseIcon,
  MapPin,
  Star,
  Building2,
} from 'lucide-react';
import { toast } from 'react-toastify';
import ConfirmDialog from '../../../components/common/ConfirmDialog';

interface Warehouse {
  id: number;
  name: string;
  code?: string | null;
  address?: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function WarehouseManagement() {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    address: '',
    isDefault: false,
  });

  useEffect(() => {
    fetchWarehouses();
  }, []);

  const fetchWarehouses = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getWarehouses();
      setWarehouses(Array.isArray(data) ? data : (data as any).warehouses || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load warehouses');
      toast.error(err.message || 'Failed to load warehouses');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (warehouse?: Warehouse) => {
    if (warehouse) {
      setEditingWarehouse(warehouse);
      setFormData({
        name: warehouse.name,
        code: warehouse.code || '',
        address: warehouse.address || '',
        isDefault: warehouse.isDefault,
      });
    } else {
      setEditingWarehouse(null);
      setFormData({ name: '', code: '', address: '', isDefault: false });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingWarehouse(null);
    setFormData({ name: '', code: '', address: '', isDefault: false });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error(t('inventory.warehouseNameRequired') || 'Warehouse name is required');
      return;
    }
    try {
      if (editingWarehouse) {
        await apiClient.updateWarehouse(editingWarehouse.id, {
          name: formData.name,
          code: formData.code || undefined,
          address: formData.address || undefined,
          isDefault: formData.isDefault,
        });
        toast.success('Warehouse updated successfully');
      } else {
        await apiClient.createWarehouse({
          name: formData.name,
          code: formData.code || undefined,
          address: formData.address || undefined,
          isDefault: formData.isDefault,
        });
        toast.success('Warehouse created successfully');
      }
      handleCloseDialog();
      fetchWarehouses();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save warehouse');
    }
  };

  const handleDelete = async (warehouse: Warehouse) => {
    try {
      await apiClient.deleteWarehouse(warehouse.id);
      toast.success('Warehouse deleted successfully');
      fetchWarehouses();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete warehouse');
    }
  };

  const handleToggleActive = async (warehouse: Warehouse) => {
    setTogglingId(warehouse.id);
    try {
      await apiClient.updateWarehouse(warehouse.id, { isActive: !warehouse.isActive });
      toast.success('Warehouse updated successfully');
      await fetchWarehouses();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update warehouse');
    } finally {
      setTogglingId(null);
    }
  };

  const activeCount = warehouses.filter((w) => w.isActive).length;
  const defaultWarehouse = warehouses.find((w) => w.isDefault);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-700 via-gray-700 to-zinc-700 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <WarehouseIcon className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t('inventory.warehouseManagement') || 'Warehouse Management'}
              </h1>
              <p className="text-sm text-white/70 mt-0.5">
                Manage your storage locations and warehouse settings
              </p>
            </div>
          </div>
          <Button
            onClick={() => handleOpenDialog()}
            className="gap-2 bg-white text-gray-800 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            {t('inventory.addWarehouse') || 'Add Warehouse'}
          </Button>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            label: 'Total Warehouses',
            value: warehouses.length,
            icon: Building2,
            light: 'bg-slate-50 dark:bg-slate-900/30',
            text: 'text-slate-600 dark:text-slate-400',
          },
          {
            label: 'Active',
            value: activeCount,
            icon: WarehouseIcon,
            light: 'bg-emerald-50 dark:bg-emerald-900/20',
            text: 'text-emerald-600 dark:text-emerald-400',
          },
          {
            label: 'Default Warehouse',
            value: defaultWarehouse?.name ?? 'None set',
            icon: Star,
            light: 'bg-amber-50 dark:bg-amber-900/20',
            text: 'text-amber-600 dark:text-amber-400',
            isText: true,
          },
        ].map(({ label, value, icon: Icon, light, text, isText }) => (
          <div
            key={label}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center gap-4"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0 ${light}`}>
              <Icon className={`h-5 w-5 ${text}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
              {isText ? (
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{value}</p>
              ) : (
                <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Table Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('inventory.warehouses') || 'Warehouses'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {warehouses.length} warehouse{warehouses.length !== 1 ? 's' : ''} configured
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{error}</div>
        ) : warehouses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-900/30">
              <WarehouseIcon className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-base font-semibold text-gray-700 dark:text-gray-300">
              No warehouses found
            </p>
            <p className="text-sm text-gray-400">
              Create your first warehouse using the button above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 dark:bg-gray-700/50">
                  {['Name', 'Code', 'Address', 'Status', 'Default', 'Actions'].map((h) => (
                    <TableHead
                      key={h}
                      className="whitespace-nowrap text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouses.map((warehouse) => (
                  <TableRow
                    key={warehouse.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 flex-shrink-0">
                          <WarehouseIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        </div>
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">
                          {warehouse.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {warehouse.code ? (
                        <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                          {warehouse.code}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                      {warehouse.address ? (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          {warehouse.address}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <AppToggle
                          checked={warehouse.isActive}
                          onChange={() => handleToggleActive(warehouse)}
                          loading={togglingId === warehouse.id}
                          size="small"
                          aria-label={warehouse.isActive ? 'Deactivate' : 'Activate'}
                        />
                        <span
                          className={`text-xs font-medium ${
                            warehouse.isActive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-gray-400'
                          }`}
                        >
                          {warehouse.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {warehouse.isDefault && (
                        <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 gap-1">
                          <Star className="h-3 w-3" />
                          Default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDialog(warehouse)}
                          className="h-8 w-8 p-0 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setWarehouseToDelete(warehouse)}
                          className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create/Edit Drawer */}
      <Drawer open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DrawerContent className="sm:max-w-[500px]">
          <DrawerHeader className="border-b border-gray-100 dark:border-gray-700 pb-4">
            <DrawerTitle className="text-lg font-semibold">
              {editingWarehouse ? 'Edit Warehouse' : 'Add Warehouse'}
            </DrawerTitle>
          </DrawerHeader>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4 p-6">
              <div className="space-y-2">
                <Label htmlFor="wh-name">
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="wh-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Main Warehouse"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="wh-code">
                  Code{' '}
                  <span className="text-gray-400 text-xs">(optional)</span>
                </Label>
                <Input
                  id="wh-code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., WH-001"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="wh-address">
                  Address{' '}
                  <span className="text-gray-400 text-xs">(optional)</span>
                </Label>
                <Input
                  id="wh-address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Physical address"
                />
              </div>

              <div className="flex items-center gap-3 py-2">
                <AppToggle
                  id="wh-default"
                  size="small"
                  checked={formData.isDefault}
                  onChange={(checked) => setFormData({ ...formData, isDefault: checked })}
                />
                <Label htmlFor="wh-default" className="cursor-pointer text-sm">
                  Set as default warehouse
                </Label>
              </div>
            </div>

            <DrawerFooter className="border-t border-gray-100 dark:border-gray-700 flex-row gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseDialog}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1 bg-slate-700 hover:bg-slate-800 text-white">
                {editingWarehouse ? 'Save Changes' : 'Create Warehouse'}
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={warehouseToDelete !== null}
        onClose={() => setWarehouseToDelete(null)}
        onConfirm={() => { if (warehouseToDelete) handleDelete(warehouseToDelete); }}
        title="Delete Warehouse"
        message={warehouseToDelete ? `Are you sure you want to delete "${warehouseToDelete.name}"?` : ''}
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  );
}

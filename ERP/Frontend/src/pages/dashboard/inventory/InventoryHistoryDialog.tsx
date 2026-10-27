import { useState, useEffect } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "../../../components/ui/drawer";
import { Button } from "../../../components/ui/button";
import { useTheme } from "../../../context/ThemeContext";
import { useTranslation } from "react-i18next";
import { useBranch } from "../../../context/BranchContext";
import { apiClient } from "../../../lib/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "../../../components/ui/badge";

interface InventoryHistoryEntry {
  id: number;
  movementType: string;
  direction: 'IN' | 'OUT';
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

interface InventoryHistoryDialogProps {
  productId: number | null;
  productName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InventoryHistoryDialog({
  productId,
  productName,
  open,
  onOpenChange,
}: InventoryHistoryDialogProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { selectedBranchId } = useBranch();
  const [history, setHistory] = useState<InventoryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && productId) {
      fetchHistory();
    }
  }, [open, productId, selectedBranchId]);

  const fetchHistory = async () => {
    if (!productId) return;

    try {
      setLoading(true);
      setError(null);
      const branchId = selectedBranchId;
      const data = await apiClient.getInventoryHistory(productId, branchId);
      setHistory(data.history || []);
    } catch (err: any) {
      console.error('Error fetching inventory history:', err);
      setError(err.message || t('inventory.failedToLoadHistory') || 'Failed to load inventory history');
    } finally {
      setLoading(false);
    }
  };

  const getMovementTypeColor = (direction: string) => {
    if (direction === 'IN') {
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    } else {
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={`sm:max-w-[900px] overflow-hidden flex flex-col ${theme === "dark"
          ? "bg-gray-900 border-gray-700 text-gray-100"
          : "bg-white border-gray-200"
          }`}
      >
        <DrawerHeader>
          <DrawerTitle className={theme === "dark" ? "text-white" : "text-gray-900"}>
            {t('inventory.inventoryHistory')} {productName && `- ${productName}`}
          </DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-500">{error}</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {t('inventory.noHistory')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className={theme === "dark" ? "border-gray-700" : ""}>
                    <TableHead className="whitespace-nowrap">{t('common.date')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('inventory.movementType')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('inventory.direction')}</TableHead>
                    <TableHead className="whitespace-nowrap text-right">{t('common.quantity')}</TableHead>
                    <TableHead className="whitespace-nowrap text-right">{t('inventory.runningBalance')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('inventory.user')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('inventory.reference')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('common.note')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className={theme === "dark" ? "border-gray-700 hover:bg-gray-800" : "hover:bg-gray-50"}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDate(entry.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge className={getMovementTypeColor(entry.direction)}>
                          {t(`inventory.movementType.${entry.movementType}`) || entry.movementType.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {entry.direction === 'IN' ? (
                            <TrendingUp className="h-4 w-4 text-green-500" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                          )}
                          <span className={entry.direction === 'IN' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            {entry.direction}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                        {entry.direction === 'IN' ? '+' : '-'}{entry.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold whitespace-nowrap">
                        {entry.runningBalance}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {entry.user.name}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {entry.reference || '-'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={entry.note || ''}>
                        {entry.note || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DrawerFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={theme === "dark" ? "border-gray-700 hover:bg-gray-800" : ""}
          >
            {t('common.close')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

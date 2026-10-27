import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { apiClient } from '../../../lib/api-client';
import { Loader2, Package } from 'lucide-react';
import { format } from 'date-fns';

interface Batch {
  id: number;
  batchNumber: string;
  quantity: number;
  unitCost: number;
  expiryDate?: string;
  receivedAt: string;
  isActive: boolean;
  product: {
    id: number;
    name: string;
    sku?: string;
  };
}

export function BatchManagement() {
  const { t } = useTranslation();
  const { productId } = useParams<{ productId: string }>();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (productId) {
      loadBatches();
    }
  }, [productId]);

  const loadBatches = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getBatches(parseInt(productId!));
      setBatches(data);
    } catch (error: any) {
      console.error('Error loading batches:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t('batches.title') || 'Batch Management'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('batches.batchNumber') || 'Batch Number'}</TableHead>
                <TableHead>{t('batches.quantity') || 'Quantity'}</TableHead>
                <TableHead>{t('batches.unitCost') || 'Unit Cost'}</TableHead>
                <TableHead>{t('batches.expiryDate') || 'Expiry Date'}</TableHead>
                <TableHead>{t('batches.receivedAt') || 'Received At'}</TableHead>
                <TableHead>{t('batches.status') || 'Status'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t('batches.noBatches') || 'No batches found'}
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-medium">{batch.batchNumber}</TableCell>
                    <TableCell>{batch.quantity}</TableCell>
                    <TableCell>{batch.unitCost.toFixed(2)}</TableCell>
                    <TableCell>
                      {batch.expiryDate ? format(new Date(batch.expiryDate), 'MMM d, yyyy') : 'N/A'}
                    </TableCell>
                    <TableCell>{format(new Date(batch.receivedAt), 'MMM d, yyyy')}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${batch.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
                          }`}
                      >
                        {batch.isActive ? t('batches.active') || 'Active' : t('batches.inactive') || 'Inactive'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

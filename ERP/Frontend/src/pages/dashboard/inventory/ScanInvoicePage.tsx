import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Upload,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Package,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  Edit2,
  X,
  Loader2,
  Search,
  FileText,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Checkbox } from '../../../components/ui/checkbox';
import { apiClient } from '../../../lib/api-client';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { toast } from 'react-toastify';

// ── Types ──────────────────────────────────────────────────────────────────

type WizardStep = 'upload' | 'processing' | 'review' | 'match' | 'import' | 'done';

interface InvoiceItem {
  id?: number;
  productName: string;
  description?: string;
  sku?: string;
  barcode?: string;
  batchNumber?: string;
  expiryDate?: string;
  quantity: number;
  unitPrice: number;
  sellingPrice?: number;
  totalPrice?: number;
  taxRate?: number;
  taxAmount?: number;
  category?: string;
  manufacturer?: string;
  confidence?: number;
  _action?: 'create' | 'update' | 'delete';
  _errors?: string[];
  _selected?: boolean;
}

interface InvoiceHeader {
  invoiceNumber?: string;
  invoiceDate?: string;
  supplierName?: string;
  supplierId?: number;
  vendorTIN?: string;
  currency?: string;
  paymentTerms?: string;
  dueDate?: string;
  poNumber?: string;
  notes?: string;
  subtotal?: number;
  taxAmount?: number;
  discount?: number;
  totalAmount?: number;
}

interface MatchResult {
  item: { productName: string; barcode?: string; sku?: string };
  match: { id: number; name: string; quantity: number; unitPrice: number } | null;
  matchType: string;
  confidence: number;
}

interface ItemAction {
  itemId: number;
  action: 'create' | 'update' | 'skip';
  productId?: number;
}

// ── Step indicator ─────────────────────────────────────────────────────────

const STEPS: Array<{ key: WizardStep; label: string; icon: React.ReactNode }> = [
  { key: 'upload', label: 'Upload', icon: <Upload className="size-4" /> },
  { key: 'processing', label: 'Processing', icon: <Sparkles className="size-4" /> },
  { key: 'review', label: 'Review', icon: <Edit2 className="size-4" /> },
  { key: 'match', label: 'Match', icon: <Search className="size-4" /> },
  { key: 'import', label: 'Import', icon: <Package className="size-4" /> },
  { key: 'done', label: 'Done', icon: <CheckCircle2 className="size-4" /> },
];

const STEP_ORDER: WizardStep[] = ['upload', 'processing', 'review', 'match', 'import', 'done'];

// ── Main component ─────────────────────────────────────────────────────────

export const ScanInvoicePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: existingId } = useParams<{ id?: string }>();
  const { theme } = useTheme();
  const organizationId = apiClient.getOrganizationId();
  const isDark = theme === 'dark';
  const outlineBtnClass = isDark ? 'border-gray-700 text-gray-200 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50';
  const primaryBtnClass = 'bg-blue-600 hover:bg-blue-700 text-white';

  // Wizard state
  const [step, setStep] = useState<WizardStep>(existingId ? 'review' : 'upload');
  const [invoiceId, setInvoiceId] = useState<number | null>(existingId ? parseInt(existingId) : null);

  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data state
  const [invoiceHeader, setInvoiceHeader] = useState<InvoiceHeader>({});
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [itemActions, setItemActions] = useState<ItemAction[]>([]);
  const [importResult, setImportResult] = useState<any>(null);

  // Loading / UI state
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [bulkCategoryValue, setBulkCategoryValue] = useState('');
  const [showBulkDialog, setShowBulkDialog] = useState<'category' | 'expiry' | null>(null);

  // Load existing invoice
  useEffect(() => {
    if (existingId && invoiceId) {
      loadExistingInvoice(invoiceId);
    }
  }, [existingId, invoiceId]);

  const loadExistingInvoice = async (id: number) => {
    try {
      const res = await apiClient.getSupplierInvoice(organizationId, id);
      const inv = res?.data ?? res;
      setInvoiceHeader({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate ? inv.invoiceDate.split('T')[0] : undefined,
        supplierName: inv.supplierName,
        vendorTIN: inv.vendorTIN,
        currency: inv.currency,
        paymentTerms: inv.paymentTerms,
        dueDate: inv.dueDate ? inv.dueDate.split('T')[0] : undefined,
        poNumber: inv.poNumber,
        notes: inv.notes,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        discount: inv.discount,
        totalAmount: inv.totalAmount,
      });
      setItems((inv.items || []).map((item: any) => ({
        ...item,
        expiryDate: item.expiryDate ? item.expiryDate.split('T')[0] : undefined,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        sellingPrice: item.sellingPrice ? Number(item.sellingPrice) : undefined,
        taxAmount: item.taxAmount != null ? Number(item.taxAmount) : undefined,
      })));
      if (inv.status === 'IMPORTED') {
        setStep('done');
      } else {
        setStep('review');
      }
    } catch (err: any) {
      toast.error('Failed to load invoice');
    }
  };

  // ── Step 1: Upload ────────────────────────────────────────────────────────

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSetFile(file);
  }, []);

  const validateAndSetFile = (file: File) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      toast.error('Only PDF, JPG, JPEG, PNG files are supported');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File size cannot exceed 20MB');
      return;
    }
    setSelectedFile(file);
  };
  const handleManualEntry = () => {
    // Create empty invoice state for manual data entry
    setInvoiceId(null);
    setInvoiceHeader({});
    setItems([{ productName: '', quantity: 1, unitPrice: 0, totalPrice: 0, confidence: 1 }]);
    setStep('review');
    toast.info('Ready for manual product entry - click "Add row" to add products');
  };


  const handleUpload = async () => {
    if (!selectedFile) return;
    setStep('processing');
    setProcessingMsg('Reading invoice...');

    try {
      setUploadProgress(0);

      const { isAiExtractionConfigured, extractInvoiceWithAI } = await import('../../../lib/aiInvoiceExtraction');
      const onProgress = (pct: number, message: string) => {
        setUploadProgress(pct);
        setProcessingMsg(message);
      };

      let extracted;
      if (isAiExtractionConfigured()) {
        try {
          setProcessingMsg('Analyzing invoice with AI...');
          extracted = await extractInvoiceWithAI(selectedFile, onProgress);
        } catch (aiErr: any) {
          console.error('AI extraction failed, falling back to on-device OCR:', aiErr);
          toast.info('AI scan unavailable — falling back to on-device scanning');
        }
      }

      if (!extracted) {
        const { scanInvoiceLocally } = await import('../../../lib/invoiceOcr');
        extracted = await scanInvoiceLocally(selectedFile, onProgress);
      }

      setProcessingMsg('Uploading invoice...');
      setUploadProgress(0);
      const result = await apiClient.scanInvoice(organizationId, selectedFile, setUploadProgress, extracted);

      const inv = result?.data ?? result;
      setInvoiceId(inv.id);
      setInvoiceHeader({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate ? inv.invoiceDate.split('T')[0] : undefined,
        supplierName: inv.supplierName,
        vendorTIN: inv.vendorTIN,
        currency: inv.currency || 'RWF',
        paymentTerms: inv.paymentTerms,
        dueDate: inv.dueDate ? inv.dueDate.split('T')[0] : undefined,
        poNumber: inv.poNumber,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        discount: inv.discount,
        totalAmount: inv.totalAmount,
      });
      setItems((inv.items || []).map((item: any) => ({
        ...item,
        expiryDate: item.expiryDate ? item.expiryDate.split('T')[0] : undefined,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        taxAmount: item.taxAmount != null ? Number(item.taxAmount) : undefined,
      })));

      if (inv.items?.length === 0) {
        toast.info('No products detected. Please add products manually.');
      }

      setStep('review');
    } catch (err: any) {
      toast.error(err.message || t('invoiceScanner.uploadFailed'));
      setStep('upload');
    }
  };

  // ── Step 3: Review & Edit ─────────────────────────────────────────────────

  const validateItems = (): boolean => {
    const validated = items.map((item) => {
      const errors: string[] = [];
      if (!item.productName?.trim()) errors.push(t('invoiceScanner.missingName'));
      if (item.quantity < 0) errors.push(t('invoiceScanner.negativeQty'));
      if (item.expiryDate && new Date(item.expiryDate) < new Date()) errors.push(t('invoiceScanner.invalidExpiry'));
      return { ...item, _errors: errors };
    });
    setItems(validated);
    return validated.every((i) => (i._errors || []).length === 0);
  };

  const handleItemChange = (idx: number, field: keyof InvoiceItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        updated[idx].totalPrice = updated[idx].quantity * updated[idx].unitPrice;
      }
      return updated;
    });
  };

  const addNewRow = () => {
    setItems((prev) => [
      ...prev,
      { productName: '', quantity: 1, unitPrice: 0, totalPrice: 0, confidence: 1 },
    ]);
  };

  const deleteRow = (idx: number) => {
    setItems((prev) => {
      const updated = [...prev];
      if (updated[idx].id) {
        updated[idx] = { ...updated[idx], _action: 'delete' };
      } else {
        updated.splice(idx, 1);
      }
      return updated;
    });
  };

  const duplicateRow = (idx: number) => {
    setItems((prev) => {
      const copy = { ...prev[idx], id: undefined, _action: undefined };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleItems = items.filter((i) => i._action !== 'delete');
    const allSelected = visibleItems.every((i) => i._selected);
    setItems((prev) => prev.map((i) => (i._action !== 'delete' ? { ...i, _selected: !allSelected } : i)));
  };

  const bulkChangeCategory = (category: string) => {
    setItems((prev) => prev.map((i) => (i._selected && i._action !== 'delete' ? { ...i, category } : i)));
    setShowBulkDialog(null);
  };

  const bulkSetExpiry = (expiryDate: string) => {
    setItems((prev) => prev.map((i) => (i._selected && i._action !== 'delete' ? { ...i, expiryDate } : i)));
    setShowBulkDialog(null);
  };

  const bulkDelete = () => {
    setItems((prev) => prev.map((i) => {
      if (!i._selected || i._action === 'delete') return i;
      return i.id ? { ...i, _action: 'delete' } : { ...i, _action: 'delete', _hidden: true };
    }));
  };

  const saveReview = async () => {
    if (!invoiceId) return;
    if (!validateItems()) {
      toast.error('Please fix validation errors before proceeding');
      return;
    }
    setSaving(true);
    try {
      await apiClient.updateInvoiceItems(organizationId, invoiceId, {
        items: items.map((item) => ({
          id: item.id,
          _action: item._action,
          productName: item.productName,
          description: item.description,
          sku: item.sku,
          barcode: item.barcode,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          sellingPrice: item.sellingPrice,
          totalPrice: item.totalPrice,
          taxRate: item.taxRate,
          taxAmount: item.taxAmount,
          category: item.category,
          manufacturer: item.manufacturer,
        })),
        invoiceHeader,
      });

      // Reload fresh state
      await loadExistingInvoice(invoiceId);
      goToStep('match');
    } catch (err: any) {
      toast.error(err.message || t('invoiceScanner.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ── Step 4: Product Matching ──────────────────────────────────────────────

  const runMatching = async () => {
    if (!invoiceId) return;
    setMatching(true);
    try {
      const activeItems = items.filter((i) => i._action !== 'delete');
      const res = await apiClient.matchInvoiceProducts(
        organizationId,
        activeItems.map((i) => ({ productName: i.productName, barcode: i.barcode, sku: i.sku }))
      );
      const results: MatchResult[] = res?.data ?? res ?? [];
      setMatchResults(results);

      // Build default actions
      const actions: ItemAction[] = activeItems.map((item, idx) => {
        const match = results[idx];
        if (match?.match && match.confidence >= 0.8) {
          return { itemId: item.id!, action: 'update', productId: match.match.id };
        }
        return { itemId: item.id!, action: 'create' };
      });
      setItemActions(actions);
    } catch (err: any) {
      toast.error(err.message || t('invoiceScanner.matchFailed'));
    } finally {
      setMatching(false);
    }
  };

  useEffect(() => {
    if (step === 'match') {
      runMatching();
    }
  }, [step]);

  const updateItemAction = (itemId: number, action: 'create' | 'update' | 'skip', productId?: number) => {
    setItemActions((prev) => {
      const next = [...prev];
      const idx = next.findIndex((a) => a.itemId === itemId);
      if (idx >= 0) {
        next[idx] = { itemId, action, productId };
      } else {
        next.push({ itemId, action, productId });
      }
      return next;
    });
  };

  // ── Step 5: Import ────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!invoiceId) return;
    setImporting(true);
    try {
      const res = await apiClient.importInvoiceProducts(organizationId, invoiceId, itemActions);
      setImportResult(res?.data ?? res);
      setStep('done');
      toast.success(`Import complete! ${(res?.data ?? res).importedItems} products added.`);
    } catch (err: any) {
      toast.error(err.message || t('invoiceScanner.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  // ── Navigation helpers ────────────────────────────────────────────────────

  const goToStep = (s: WizardStep) => setStep(s);
  const currentStepIdx = STEP_ORDER.indexOf(step);
  const visibleItems = items.filter((i) => i._action !== 'delete');
  const selectedCount = visibleItems.filter((i) => i._selected).length;
  const errorCount = visibleItems.filter((i) => (i._errors || []).length > 0).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn('min-h-screen p-6', isDark ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900')}>
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" className="hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => navigate('/dashboard/supplier-invoices')}>
          <ChevronLeft className="size-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t('invoiceScanner.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('invoiceScanner.subtitle')}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-8">
        <div className="flex items-center">
          {STEPS.map((s, idx) => {
            const isActive = s.key === step;
            const isDone = STEP_ORDER.indexOf(s.key) < currentStepIdx;
            const isHidden = s.key === 'processing' && step !== 'processing';
            if (isHidden) return null;

            return (
              <React.Fragment key={s.key}>
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'flex items-center justify-center size-9 rounded-full border-2 transition-all text-xs font-bold',
                    isActive ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/30' :
                    isDone ? (isDark ? 'border-blue-500 bg-blue-900/30 text-blue-400' : 'border-blue-200 bg-blue-50 text-blue-600') :
                    (isDark ? 'border-gray-700 bg-transparent text-gray-500' : 'border-gray-200 bg-transparent text-gray-400')
                  )}>
                    {isDone ? <CheckCircle2 className="size-4" /> : s.icon}
                  </div>
                  <span className={cn(
                    'mt-1 text-xs font-medium hidden sm:block',
                    isActive ? 'text-blue-600 dark:text-blue-400' : isDone ? 'text-blue-600/70 dark:text-blue-400/70' : 'text-gray-400 dark:text-gray-500'
                  )}>{s.label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={cn('flex-1 h-0.5 mx-2', isDone ? 'bg-blue-600' : isDark ? 'bg-gray-700' : 'bg-gray-200')} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── STEP: Upload ──────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="max-w-xl mx-auto space-y-6">
          <Card className={cn(isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')}>
            <CardContent className="pt-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 cursor-pointer transition-all',
                  dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10 scale-[1.01]' :
                  selectedFile ? 'border-green-500 bg-green-50 dark:bg-green-900/10' :
                  isDark ? 'border-gray-700 hover:border-blue-500/60 hover:bg-gray-800/30' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                )}
              >
                {selectedFile ? (
                  <>
                    {selectedFile.type === 'application/pdf'
                      ? <FileText className="size-12 text-green-500 mb-3" />
                      : <ImageIcon className="size-12 text-green-500 mb-3" />}
                    <p className="font-semibold text-green-600 dark:text-green-400">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                    >
                      <X className="size-4 mr-1" /> Change file
                    </Button>
                  </>
                ) : (
                  <>
                    <Upload className="size-12 text-gray-500 dark:text-gray-400 mb-3" />
                    <p className="text-lg font-semibold">{t('invoiceScanner.dropzoneTitle')}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('invoiceScanner.dropzoneSubtitle')}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t('invoiceScanner.dropzoneHint')}</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => e.target.files?.[0] && validateAndSetFile(e.target.files[0])}
              />

              <div className={cn(
                'mt-4 p-3 rounded-lg border flex items-start gap-2 text-xs',
                isDark ? 'bg-blue-900/10 border-blue-900/30 text-blue-200/70' : 'bg-blue-50 border-blue-100 text-blue-900/70'
              )}>
                <Sparkles className="size-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Upload an invoice for on-device scanning, or click 'Manual Entry' to enter products directly without uploading a file.</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between gap-3">
            <Button
              variant="outline"
              onClick={handleManualEntry}
              className={cn('gap-2', outlineBtnClass)}
            >
              <Edit2 className="size-4" />
              Manual Entry (No Upload)
            </Button>
            <Button
              disabled={!selectedFile}
              onClick={handleUpload}
              className={cn('gap-2 min-w-[160px] disabled:bg-blue-600', primaryBtnClass)}
            >
              <ScanLine className="size-4" />
              {t('invoiceScanner.scanInvoice')}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: Processing ──────────────────────────────────────────────── */}
      {step === 'processing' && (
        <div className="max-w-sm mx-auto flex flex-col items-center gap-6 py-16 text-center">
          <div className="relative">
            <div className="size-20 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <ScanLine className="size-10 text-blue-600 dark:text-blue-400 animate-pulse" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-lg font-semibold">{t('invoiceScanner.processing')}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{processingMsg}</p>
          </div>
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="w-full space-y-1">
              <div className={cn('h-2 rounded-full overflow-hidden', isDark ? 'bg-gray-700' : 'bg-gray-200')}>
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{uploadProgress}%</p>
            </div>
          )}
        </div>
      )}

      {/* ── STEP: Review & Edit ───────────────────────────────────────────── */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* Invoice header card */}
          <Card className={cn(isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('invoiceScanner.invoiceNumber')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs">{t('invoiceScanner.invoiceNumber')}</Label>
                  <Input
                    value={invoiceHeader.invoiceNumber || ''}
                    onChange={(e) => setInvoiceHeader((h) => ({ ...h, invoiceNumber: e.target.value }))}
                    placeholder="INV-001"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('invoiceScanner.invoiceDate')}</Label>
                  <Input
                    type="date"
                    value={invoiceHeader.invoiceDate || ''}
                    onChange={(e) => setInvoiceHeader((h) => ({ ...h, invoiceDate: e.target.value }))}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('invoiceScanner.supplierName')}</Label>
                  <Input
                    value={invoiceHeader.supplierName || ''}
                    onChange={(e) => setInvoiceHeader((h) => ({ ...h, supplierName: e.target.value }))}
                    placeholder="Supplier name"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('invoiceScanner.currency')}</Label>
                  <Input
                    value={invoiceHeader.currency || 'RWF'}
                    onChange={(e) => setInvoiceHeader((h) => ({ ...h, currency: e.target.value }))}
                    placeholder="RWF"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{visibleItems.length} products</span>
              {errorCount > 0 && (
                <Badge className="text-xs border-transparent bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <AlertTriangle className="size-3 mr-1" /> {errorCount} errors
                </Badge>
              )}
              {selectedCount > 0 && (
                <Badge className="text-xs border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {selectedCount} selected
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedCount > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className={outlineBtnClass} onClick={() => setShowBulkDialog('category')}>
                    Change Category
                  </Button>
                  <Button size="sm" variant="outline" className={outlineBtnClass} onClick={() => setShowBulkDialog('expiry')}>
                    Set Expiry
                  </Button>
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={bulkDelete}>
                    <Trash2 className="size-3 mr-1" /> Delete
                  </Button>
                </div>
              )}
              <Button size="sm" variant="outline" className={outlineBtnClass} onClick={addNewRow}>
                <Plus className="size-4 mr-1" /> {t('invoiceScanner.addRow')}
              </Button>
            </div>
          </div>

          {/* Products table */}
          <Card className={cn(isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')}>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className={cn('border-b', isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50')}>
                      <th className="w-8 px-3 py-2">
                        <Checkbox
                          checked={visibleItems.length > 0 && visibleItems.every((i) => i._selected)}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 text-xs">Product Name *</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 text-xs">SKU</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 text-xs">Barcode</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 text-xs">Batch</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 text-xs">Expiry</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400 text-xs">Qty *</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400 text-xs">Unit Price *</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400 text-xs">Selling Price</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 text-xs">Category</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-500 dark:text-gray-400 text-xs">Conf.</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-500 dark:text-gray-400 text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const realIdx = items.indexOf(item);
                      const hasErrors = (item._errors || []).length > 0;
                      const lowConf = (item.confidence || 1) < 0.8;

                      return (
                        <tr
                          key={realIdx}
                          className={cn(
                            'border-b',
                            hasErrors ? (isDark ? 'bg-red-900/10' : 'bg-red-50') :
                            lowConf ? (isDark ? 'bg-yellow-900/10' : 'bg-yellow-50') :
                            isDark ? 'border-gray-700 hover:bg-gray-800/30' : 'border-gray-100 hover:bg-gray-50'
                          )}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={!!item._selected}
                              onCheckedChange={(v) => handleItemChange(realIdx, '_selected' as any, v)}
                            />
                          </td>
                          {editingItemIdx === realIdx ? (
                            // ── Inline edit mode ──
                            <td colSpan={10} className="px-3 py-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div>
                                  <Label className="text-xs">Product Name</Label>
                                  <Input value={item.productName} onChange={(e) => handleItemChange(realIdx, 'productName', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">SKU</Label>
                                  <Input value={item.sku || ''} onChange={(e) => handleItemChange(realIdx, 'sku', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Barcode</Label>
                                  <Input value={item.barcode || ''} onChange={(e) => handleItemChange(realIdx, 'barcode', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Batch Number</Label>
                                  <Input value={item.batchNumber || ''} onChange={(e) => handleItemChange(realIdx, 'batchNumber', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Expiry Date</Label>
                                  <Input type="date" value={item.expiryDate || ''} onChange={(e) => handleItemChange(realIdx, 'expiryDate', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Quantity</Label>
                                  <Input type="number" min="0" value={item.quantity} onChange={(e) => handleItemChange(realIdx, 'quantity', Number(e.target.value))} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Unit Price</Label>
                                  <Input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => handleItemChange(realIdx, 'unitPrice', Number(e.target.value))} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Selling Price</Label>
                                  <Input type="number" min="0" step="0.01" value={item.sellingPrice || ''} onChange={(e) => handleItemChange(realIdx, 'sellingPrice', e.target.value ? Number(e.target.value) : undefined)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Category</Label>
                                  <Input value={item.category || ''} onChange={(e) => handleItemChange(realIdx, 'category', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Manufacturer</Label>
                                  <Input value={item.manufacturer || ''} onChange={(e) => handleItemChange(realIdx, 'manufacturer', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                                <div>
                                  <Label className="text-xs">Description</Label>
                                  <Input value={item.description || ''} onChange={(e) => handleItemChange(realIdx, 'description', e.target.value)} className="h-7 text-xs mt-0.5" />
                                </div>
                              </div>
                              <Button size="sm" className="mt-2 h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setEditingItemIdx(null)}>
                                <CheckCircle2 className="size-3 mr-1" /> Done
                              </Button>
                            </td>
                          ) : (
                            // ── Read mode ──
                            <>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  {hasErrors && <AlertTriangle className="size-3 text-red-600 dark:text-red-400 shrink-0" />}
                                  {lowConf && !hasErrors && <AlertTriangle className="size-3 text-yellow-500 shrink-0" />}
                                  <span className={cn('font-medium', hasErrors ? 'text-red-600 dark:text-red-400' : '')}>{item.productName || <span className="text-gray-500 dark:text-gray-400 italic">Enter name</span>}</span>
                                </div>
                                {hasErrors && (
                                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{item._errors!.join(', ')}</p>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{item.sku || '—'}</td>
                              <td className="px-3 py-2 font-mono text-xs">{item.barcode || '—'}</td>
                              <td className="px-3 py-2">{item.batchNumber || '—'}</td>
                              <td className="px-3 py-2 text-xs">
                                {item.expiryDate
                                  ? <span className={item.expiryDate && new Date(item.expiryDate) < new Date() ? 'text-red-600 dark:text-red-400' : ''}>
                                      {item.expiryDate}
                                    </span>
                                  : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                              <td className="px-3 py-2 text-right font-mono">{Number(item.unitPrice).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-mono">{item.sellingPrice ? Number(item.sellingPrice).toLocaleString() : '—'}</td>
                              <td className="px-3 py-2 text-xs">{item.category || '—'}</td>
                              <td className="px-3 py-2 text-center">
                                {item.confidence != null ? (
                                  <span className={cn('text-xs font-medium', item.confidence >= 0.8 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400')}>
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                ) : '—'}
                              </td>
                            </>
                          )}
                          {editingItemIdx !== realIdx && (
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1 justify-center">
                                <button title={t('invoiceScanner.editRow')} onClick={() => setEditingItemIdx(realIdx)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                                  <Edit2 className="size-3.5 text-gray-500 dark:text-gray-400" />
                                </button>
                                <button title={t('invoiceScanner.duplicateRow')} onClick={() => duplicateRow(realIdx)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                                  <Copy className="size-3.5 text-gray-500 dark:text-gray-400" />
                                </button>
                                <button title={t('invoiceScanner.deleteRow')} onClick={() => deleteRow(realIdx)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                                  <Trash2 className="size-3.5 text-red-500/70 dark:text-red-400/70" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={12} className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                          No products yet. Click "Add row" to add products manually.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" className={outlineBtnClass} onClick={() => navigate('/dashboard/supplier-invoices')}>
              <ChevronLeft className="size-4 mr-1" /> Back to list
            </Button>
            <Button onClick={saveReview} disabled={saving} className={cn('min-w-[160px]', primaryBtnClass)}>
              {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Next: Match Products <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: Match ───────────────────────────────────────────────────── */}
      {step === 'match' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Review how each extracted product matches existing inventory. Choose whether to update an existing product or create a new one.
          </p>

          {matching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-8 animate-spin text-blue-600 dark:text-blue-400 mr-3" />
              <span className="text-gray-500 dark:text-gray-400">Searching inventory for matches...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item, visualIdx) => {
                const match = matchResults[visualIdx];
                const action = itemActions.find((a) => a.itemId === item.id);

                return (
                  <Card key={item.id || visualIdx} className={cn(
                    isDark ? 'bg-gray-900' : 'bg-white',
                    match?.match ? (isDark ? 'border-blue-800' : 'border-blue-200') : (isDark ? 'border-gray-800' : 'border-gray-200')
                  )}>
                    <CardContent className="pt-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Qty: {item.quantity} · Price: {Number(item.unitPrice).toLocaleString()}
                            {item.barcode && ` · Barcode: ${item.barcode}`}
                          </p>
                        </div>

                        {match?.match ? (
                          <div className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm', isDark ? 'bg-blue-900/20' : 'bg-blue-50')}>
                            <div>
                              <p className="font-medium text-blue-700 dark:text-blue-300 text-xs">
                                <Search className="size-3 inline mr-1" />
                                {t('invoiceScanner.existingProductFound')}: {match.match.name}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {t('invoiceScanner.currentStock')}: {match.match.quantity} · {t('invoiceScanner.incoming')}: {item.quantity} · {t('invoiceScanner.newStock')}: {match.match.quantity + item.quantity}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">Match: {match.matchType} ({Math.round(match.confidence * 100)}% confidence)</p>
                            </div>
                          </div>
                        ) : (
                          <div className={cn('px-3 py-2 rounded-lg text-xs', isDark ? 'bg-gray-800' : 'bg-gray-100')}>
                            <p className="text-gray-500 dark:text-gray-400">No existing product found</p>
                          </div>
                        )}

                        <div className="flex gap-2 shrink-0">
                          {match?.match && (
                            <>
                              <Button
                                size="sm"
                                variant={action?.action === 'update' ? 'default' : 'outline'}
                                className={action?.action === 'update' ? primaryBtnClass : outlineBtnClass}
                                onClick={() => updateItemAction(item.id!, 'update', match.match!.id)}
                              >
                                {t('invoiceScanner.updateExisting')}
                              </Button>
                              <Button
                                size="sm"
                                variant={action?.action === 'create' ? 'default' : 'outline'}
                                className={action?.action === 'create' ? primaryBtnClass : outlineBtnClass}
                                onClick={() => updateItemAction(item.id!, 'create')}
                              >
                                {t('invoiceScanner.createNew')}
                              </Button>
                            </>
                          )}
                          {!match?.match && (
                            <Button
                              size="sm"
                              variant={action?.action === 'create' ? 'default' : 'outline'}
                              className={action?.action === 'create' ? primaryBtnClass : outlineBtnClass}
                              onClick={() => updateItemAction(item.id!, 'create')}
                            >
                              {t('invoiceScanner.createNew')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={action?.action === 'skip' ? 'destructive' : 'ghost'}
                            className={action?.action === 'skip' ? 'bg-red-600 hover:bg-red-700 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}
                            onClick={() => updateItemAction(item.id!, 'skip')}
                          >
                            {t('invoiceScanner.skip')}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" className={outlineBtnClass} onClick={() => goToStep('review')}>
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <Button onClick={() => goToStep('import')} disabled={matching} className={primaryBtnClass}>
              Next: Import Summary <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: Import summary ──────────────────────────────────────────── */}
      {step === 'import' && (
        <div className="max-w-lg mx-auto space-y-6">
          <Card className={cn(isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')}>
            <CardHeader>
              <CardTitle className="text-base">{t('invoiceScanner.importSummary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className={cn('rounded-lg p-3', isDark ? 'bg-gray-800' : 'bg-gray-50')}>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">{t('invoiceScanner.supplierLabel')}</p>
                  <p className="font-medium mt-0.5">{invoiceHeader.supplierName || '—'}</p>
                </div>
                <div className={cn('rounded-lg p-3', isDark ? 'bg-gray-800' : 'bg-gray-50')}>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">{t('invoiceScanner.invoiceLabel')}</p>
                  <p className="font-medium mt-0.5">{invoiceHeader.invoiceNumber || '—'}</p>
                </div>
                <div className={cn('rounded-lg p-3', isDark ? 'bg-gray-800' : 'bg-gray-50')}>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">{t('invoiceScanner.productsLabel')}</p>
                  <p className="font-medium mt-0.5 text-lg">{visibleItems.length}</p>
                </div>
                <div className={cn('rounded-lg p-3', isDark ? 'bg-gray-800' : 'bg-gray-50')}>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">{t('invoiceScanner.newLabel')}</p>
                  <p className="font-medium mt-0.5 text-lg text-green-600 dark:text-green-400">
                    {itemActions.filter((a) => a.action === 'create').length}
                  </p>
                </div>
                <div className={cn('rounded-lg p-3', isDark ? 'bg-gray-800' : 'bg-gray-50')}>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">{t('invoiceScanner.existingLabel')}</p>
                  <p className="font-medium mt-0.5 text-lg text-blue-600 dark:text-blue-400">
                    {itemActions.filter((a) => a.action === 'update').length}
                  </p>
                </div>
                <div className={cn('rounded-lg p-3', isDark ? 'bg-gray-800' : 'bg-gray-50')}>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">Skipped</p>
                  <p className="font-medium mt-0.5 text-lg text-gray-500 dark:text-gray-400">
                    {itemActions.filter((a) => a.action === 'skip').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" className={outlineBtnClass} onClick={() => goToStep('match')}>
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing}
              className={cn('min-w-[200px] gap-2', primaryBtnClass)}
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
              {importing ? t('invoiceScanner.importing') : t('invoiceScanner.importProducts')}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP: Done ───────────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="max-w-sm mx-auto flex flex-col items-center gap-6 py-16 text-center">
          <div className="size-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="size-10 text-green-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{t('invoiceScanner.importSuccess')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              {importResult
                ? t('invoiceScanner.importSuccessDesc', { count: importResult.importedItems })
                : 'Invoice has been imported successfully'}
            </p>
            {importResult?.errorItems > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                {importResult.errorItems} items failed. Check activity logs.
              </p>
            )}
            {importResult?.accounting && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {importResult.accounting.queued
                  ? 'The supplier bill and scanned copy were sent to Accounting.'
                  : `Not sent to Accounting: ${importResult.accounting.reason}`}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Button onClick={() => navigate('/dashboard/inventory-all')} className={cn('gap-2', primaryBtnClass)}>
              <Package className="size-4" />
              {t('invoiceScanner.goToInventory')}
            </Button>
            <Button variant="outline" className={cn('gap-2', outlineBtnClass)} onClick={() => navigate('/dashboard/supplier-invoices')}>
              <FileText className="size-4" />
              {t('invoiceScanner.viewInvoice')}
            </Button>
            <Button variant="ghost" className="text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => {
              setStep('upload');
              setSelectedFile(null);
              setInvoiceId(null);
              setItems([]);
              setInvoiceHeader({});
              setMatchResults([]);
              setItemActions([]);
              setImportResult(null);
              navigate('/dashboard/scan-invoice');
            }}>
              {t('invoiceScanner.scanAnother')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Bulk dialogs ──────────────────────────────────────────────────── */}
      <Dialog open={showBulkDialog === 'category'} onOpenChange={() => setShowBulkDialog(null)}>
        <DialogContent className={cn(isDark ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200')}>
          <DialogHeader><DialogTitle>Change Category for {selectedCount} items</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <Label>Category</Label>
            <Input value={bulkCategoryValue} onChange={(e) => setBulkCategoryValue(e.target.value)} placeholder="e.g. Antibiotics, Vitamins" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className={outlineBtnClass} onClick={() => setShowBulkDialog(null)}>Cancel</Button>
              <Button className={primaryBtnClass} onClick={() => bulkChangeCategory(bulkCategoryValue)}>Apply</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkDialog === 'expiry'} onOpenChange={() => setShowBulkDialog(null)}>
        <DialogContent className={cn(isDark ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200')}>
          <DialogHeader><DialogTitle>Set Expiry Date for {selectedCount} items</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <Label>Expiry Date</Label>
            <Input
              type="date"
              onChange={(e) => setBulkCategoryValue(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className={outlineBtnClass} onClick={() => setShowBulkDialog(null)}>Cancel</Button>
              <Button className={primaryBtnClass} onClick={() => bulkSetExpiry(bulkCategoryValue)}>Apply</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScanInvoicePage;

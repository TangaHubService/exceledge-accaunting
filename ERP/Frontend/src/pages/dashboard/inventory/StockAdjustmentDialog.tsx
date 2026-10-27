import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "../../../components/ui/drawer";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useTheme } from "../../../context/ThemeContext";
import { useBranch } from "../../../context/BranchContext";
import { useAuth } from "../../../context/AuthContext";
import { useOrganizationSettings } from "../../../context/OrganizationSettingsContext";
import { apiClient } from "../../../lib/api-client";
import { toast } from "react-toastify";
import { cn } from "../../../lib/utils";
import {
  Loader2,
  Minus,
  Plus,
  Building,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────── */

export type AdjustmentReason =
  | 'DAMAGED'
  | 'EXPIRED'
  | 'AUDIT_VARIANCE'
  | 'RETURN'
  | 'THEFT'
  | 'WRITE_OFF'
  | 'RE_STOCK'
  | 'OTHER';

interface Branch {
  id: number;
  name: string;
  code?: string;
  isPrimary?: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

interface StockAdjustmentDialogProps {
  productId: number | null;
  productName?: string;
  currentStock?: number;
  batchNumber?: string;
  batchExpiry?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/* ─── Constants ─────────────────────────────────────── */

const ADJUSTMENT_REASONS: { value: AdjustmentReason; label: string; icon: string }[] = [
  { value: 'DAMAGED', label: 'Damaged Stock', icon: '🔴' },
  { value: 'EXPIRED', label: 'Expired', icon: '⏰' },
  { value: 'AUDIT_VARIANCE', label: 'Audit Variance', icon: '📋' },
  { value: 'RETURN', label: 'Customer Return', icon: '↩️' },
  { value: 'THEFT', label: 'Theft / Loss', icon: '🔒' },
  { value: 'WRITE_OFF', label: 'Write Off', icon: '📝' },
  { value: 'RE_STOCK', label: 'Re-stock / Replenish', icon: '📦' },
  { value: 'OTHER', label: 'Other…', icon: '⚙️' },
];

/* ─── Helper: snap-to-step quantity ─────────────────── */

function snapQuantity(current: number, direction: 1 | -1, step: '1' | '10' | '100'): number {
  const delta = direction * parseInt(step);
  return Math.max(0, current + delta);
}

/* ─── Component ─────────────────────────────────────── */

export default function StockAdjustmentDialog({
  productId,
  productName,
  currentStock,
  batchNumber,
  batchExpiry,
  open,
  onOpenChange,
  onSuccess,
}: StockAdjustmentDialogProps) {
  const { theme } = useTheme();
  const { selectedBranchId, userBranches, primaryBranch } = useBranch();
  const { user } = useAuth();
  const { settings: orgSettings } = useOrganizationSettings();

  const canAdjustDirectly =
    !orgSettings.featureFlags.requireStockAdjustmentApproval ||
    user?.role === 'ADMIN' ||
    user?.role === 'BRANCH_MANAGER';

  const [quantity, setQuantity] = useState<string>('');
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [otherReason, setOtherReason] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  /* ── Determine the target branch ────────────────────── */
  const targetBranch: Branch | null = useMemo(() => {
    if (selectedBranchId !== null) {
      return userBranches.find(b => b.id === selectedBranchId) ?? null;
    }
    return primaryBranch;
  }, [selectedBranchId, userBranches, primaryBranch]);

  /* ── Reset state on open ─────────────────────────────── */
  useEffect(() => {
    if (open) {
      setQuantity('');
      setReason('');
      setOtherReason('');
      setNote('');
      setConfirmStep(false);
    }
  }, [open]);

  /* ── Computed values ─────────────────────────────────── */
  const qtyNum = parseFloat(quantity);
  const isValidQty = !isNaN(qtyNum) && qtyNum !== 0;
  const newStock = isValidQty && currentStock !== undefined ? currentStock + qtyNum : undefined;
  const isNegative = qtyNum < 0;
  const wouldGoNegative = isNegative && currentStock !== undefined && currentStock + qtyNum < 0;
  const isOtherReason = reason === 'OTHER';
  const isReasonValid = reason !== '' && (!isOtherReason || otherReason.trim() !== '');
  const canSubmit = isValidQty && isReasonValid && !wouldGoNegative && !loading && canAdjustDirectly;

  /* ── Step adjustment ─────────────────────────────────── */
  const adjustBy = useCallback(
    (direction: 1 | -1, step: '1' | '10' | '100') => {
      const base = qtyNum || 0;
      const snapped = snapQuantity(base, direction, step);
      /* For negative adjustments, ensure we don't go below -currentStock */
      if (direction === -1 && currentStock !== undefined) {
        setQuantity(String(Math.max(-currentStock, -Math.abs(snapped))));
      } else {
        setQuantity(String(snapped));
      }
    },
    [qtyNum, currentStock],
  );

  /* ── Submit ───────────────────────────────────────────── */
  const handleSubmit = async () => {
    if (!productId || !canSubmit) return;

    try {
      setLoading(true);
      const reasonLabel = isOtherReason ? `OTHER: ${otherReason.trim()}` : reason;
      await apiClient.adjustInventoryStock({
        productId,
        quantity: qtyNum,
        branchId: targetBranch?.id ?? undefined,
        note: `[${reasonLabel}] ${note}`.trim(),
        reference: `ADJ-${productId}-${Date.now()}`,
        referenceType: 'ADJUSTMENT',
      });

      toast.success(
        <div>
          <p className="font-medium">Stock adjusted</p>
          <p className="text-xs opacity-80">
            {isNegative ? '-' : '+'}{Math.abs(qtyNum)} units · {isOtherReason ? otherReason.trim() : ADJUSTMENT_REASONS.find(r => r.value === reason)?.label ?? reason}
          </p>
        </div>,
      );

      setQuantity('');
      setReason('');
      setOtherReason('');
      setNote('');
      setConfirmStep(false);
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error?.message || 'Adjustment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Keyboard shortcut: Enter to confirm ────────────── */
  useEffect(() => {
    if (!confirmStep || !canSubmit) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [confirmStep, canSubmit, handleSubmit]);

  /* ── Close handler ───────────────────────────────────── */
  const handleClose = () => {
    if (!loading) {
      setQuantity('');
      setReason('');
      setOtherReason('');
      setNote('');
      setConfirmStep(false);
      onOpenChange(false);
    }
  };

  /* ── Render ──────────────────────────────────────────── */
  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent
        className={cn(
          'sm:max-w-[520px]',
          theme === 'dark'
            ? 'bg-gray-900 border-gray-700 text-gray-100'
            : 'bg-white border-gray-200',
        )}
      >
        <DrawerHeader>
          <DrawerTitle className={cn(theme === 'dark' ? 'text-white' : 'text-gray-900')}>
            Adjust Stock
          </DrawerTitle>
          {productName && (
            <p className="text-body-sm text-gray-500 dark:text-gray-400">
              {productName}
              {batchNumber && ` · Batch: ${batchNumber}`}
              {batchExpiry && ` · Exp: ${new Date(batchExpiry).toLocaleDateString()}`}
            </p>
          )}
        </DrawerHeader>

        {/* ── Step 1: Adjustment form ────────────────── */}
        {!confirmStep && (
          <div className="space-y-5 px-6 py-2">
            {!canAdjustDirectly && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This organization requires manager approval for stock adjustments. Ask an admin or branch manager to make this change.
                </p>
              </div>
            )}
            {/* Current stock */}
            {currentStock !== undefined && (
              <div className="flex items-center justify-between rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 dark:border dark:border-blue-800">
                <span className="text-sm text-blue-700 dark:text-blue-300">Current Stock</span>
                <span className="text-lg font-bold text-blue-800 dark:text-blue-200">
                  {currentStock.toLocaleString()}
                </span>
              </div>
            )}

            {/* Target branch (LOCKED — always visible) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400">Target Branch</Label>
              <div className="flex h-11 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <Building className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="font-medium">
                  {targetBranch?.name ?? (selectedBranchId === null ? 'All Branches' : '—')}
                </span>
                {targetBranch?.isPrimary && (
                  <span className="ml-auto rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    PRIMARY
                  </span>
                )}
              </div>
            </div>

            {/* Quantity input with + / - buttons */}
            <div className="space-y-1.5">
              <Label htmlFor="qty" className="text-sm font-medium">
                Quantity {isNegative ? '(reduction)' : '(addition)'}
              </Label>
              <div className="flex items-center gap-2">
                {/* Quick-step buttons */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => adjustBy(1, '100')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="+100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold">100</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustBy(1, '10')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="+10"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold">10</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustBy(1, '1')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="+1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold">1</span>
                  </button>
                </div>

                {/* Manual input */}
                <Input
                  id="qty"
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="0"
                  className={cn(
                    'h-14 flex-1 text-center text-xl font-bold tabular-nums',
                    isNegative ? 'text-red-600' : 'text-emerald-600',
                    theme === 'dark' ? 'bg-gray-800 border-gray-700' : '',
                  )}
                />

                {/* Decrement buttons */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => adjustBy(-1, '1')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="-1"
                  >
                    <Minus className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold">1</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustBy(-1, '10')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="-10"
                  >
                    <Minus className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold">10</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustBy(-1, '100')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="-100"
                  >
                    <Minus className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-bold">100</span>
                  </button>
                </div>
              </div>

              {/* New stock preview */}
              {newStock !== undefined && (
                <div
                  className={cn(
                    'mt-2 rounded-lg border p-3 text-center text-sm',
                    wouldGoNegative
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                  )}
                >
                  {wouldGoNegative ? (
                    <span className="flex items-center justify-center gap-1.5 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Result would be negative ({currentStock! + qtyNum}). Maximum reduction is {currentStock}.
                    </span>
                  ) : (
                    <span>
                      New stock:{' '}
                      <strong className="tabular-nums">
                        {currentStock?.toLocaleString()} {isNegative ? '−' : '+'} {Math.abs(qtyNum).toLocaleString()} ={' '}
                        <span className={isNegative ? 'text-red-600' : 'text-emerald-600'}>
                          {newStock.toLocaleString()}
                        </span>
                      </strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Reason (REQUIRED) */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-sm font-medium">
                Reason <span className="text-red-500">*</span>
              </Label>
              <Select value={reason} onValueChange={v => setReason(v as AdjustmentReason)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_REASONS.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className="flex items-center gap-2">
                        <span>{r.icon}</span>
                        <span>{r.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reason === '' && quantity && (
                <p className="text-caption text-amber-600">Select a reason before confirming</p>
              )}
              {isOtherReason && (
                <div className="space-y-1">
                  <Input
                    id="otherReason"
                    value={otherReason}
                    onChange={e => setOtherReason(e.target.value)}
                    placeholder="Please specify the reason…"
                    className={cn('h-11', theme === 'dark' ? 'bg-gray-800 border-gray-700' : '')}
                  />
                  {otherReason.trim() === '' && (
                    <p className="text-caption text-amber-600">Please specify the reason</p>
                  )}
                </div>
              )}
            </div>

            {/* Note (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="note" className="text-sm font-medium">
                Note <span className="text-xs text-gray-400">(optional)</span>
              </Label>
              <Textarea
                id="note"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Additional details about this adjustment…"
                rows={2}
                className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
              />
            </div>
          </div>
        )}

        {/* ── Step 2: Confirmation ───────────────────── */}
        {confirmStep && (
          <div className="space-y-5 px-6 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    Please confirm this adjustment
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    This change will be recorded in the inventory ledger and cannot be reversed automatically.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
              <SummaryRow label="Product" value={productName ?? '—'} />
              <SummaryRow label="Target Branch" value={targetBranch?.name ?? '—'} />
              <SummaryRow
                label="Change"
                value={`${isNegative ? '−' : '+'} ${Math.abs(qtyNum).toLocaleString()} units`}
                valueClassName={isNegative ? 'text-red-600' : 'text-emerald-600'}
              />
              <SummaryRow
                label="Current Stock"
                value={currentStock?.toLocaleString() ?? '—'}
              />
              <SummaryRow
                label="New Stock"
                value={newStock?.toLocaleString() ?? '—'}
                valueClassName="font-bold"
              />
              <SummaryRow
                label="Reason"
                value={isOtherReason ? otherReason.trim() : ADJUSTMENT_REASONS.find(r => r.value === reason)?.label ?? reason}
              />
              {note && <SummaryRow label="Note" value={note} />}
            </div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────── */}
        <DrawerFooter className="flex-row items-center justify-between gap-3 border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={confirmStep ? () => setConfirmStep(false) : handleClose}
            disabled={loading}
            className="h-11"
          >
            {confirmStep ? '← Back' : 'Cancel'}
          </Button>

          {!confirmStep ? (
            <Button
              type="button"
              onClick={() => setConfirmStep(true)}
              disabled={!canSubmit}
              className="h-11 min-w-[140px] gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              Review Adjustment
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              className={cn(
                'h-11 min-w-[140px] gap-2',
                isNegative
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white',
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  {isNegative ? 'Confirm Reduction' : 'Confirm Addition'}
                </>
              )}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/* ─── Sub-components ──────────────────────────────────── */

function SummaryRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className={cn('text-sm font-medium text-gray-900 dark:text-gray-100', valueClassName)}>
        {value}
      </span>
    </div>
  );
}

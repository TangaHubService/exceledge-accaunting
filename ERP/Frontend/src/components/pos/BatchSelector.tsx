import React, { useState, useMemo } from 'react'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

/* ─── Types ─────────────────────────────────────────── */

export interface BatchOption {
  id: number
  batchNumber: string
  quantity: number
  costPrice?: number
  sellingPrice?: number
  expiryDate?: string
  manufacturingDate?: string
}

interface BatchSelectorProps {
  productName: string
  batches: BatchOption[]
  selectedBatchId: number | null
  quantity: number
  onBatchSelect: (batchId: number) => void
  onQuantityChange: (qty: number) => void
  /** Price override (optional) */
  unitPrice?: number
  onUnitPriceChange?: (price: number) => void
  maxQuantity?: number
}

/* ─── Helpers ─────────────────────────────────────────── */

function getExpiryStatus(expiryDate?: string): 'fresh' | 'warning' | 'expired' | 'unknown' {
  if (!expiryDate) return 'unknown'
  const now = new Date()
  const expiry = new Date(expiryDate)
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 90) return 'warning'
  return 'fresh'
}

const EXPIRY_STYLES: Record<string, { dot: string; label: string; badge: string }> = {
  fresh: { dot: 'bg-emerald-500', label: 'Fresh', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300' },
  warning: { dot: 'bg-amber-500', label: 'Expiring soon', badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300' },
  expired: { dot: 'bg-red-500', label: 'Expired', badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300' },
  unknown: { dot: 'bg-gray-400', label: 'No expiry', badge: 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400' },
}

/* ─── Component ─────────────────────────────────────── */

export function BatchSelector({
  productName,
  batches,
  selectedBatchId,
  quantity,
  onBatchSelect,
  onQuantityChange,
  unitPrice,
  onUnitPriceChange,
  maxQuantity,
}: BatchSelectorProps) {
  const [expanded, setExpanded] = useState(false)

  /* ── FIFO recommendation ────────────────────────────── */
  const recommended = useMemo(() => {
    const sorted = [...batches]
      .filter(b => b.quantity > 0)
      .sort((a, b) => {
        /* Sort by expiry date first (FIFO) */
        if (a.expiryDate && b.expiryDate) {
          return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
        }
        if (a.expiryDate) return -1
        if (b.expiryDate) return 1
        return 0
      })
    return sorted[0] ?? null
  }, [batches])

  /* Auto-select recommended batch if none selected */
  React.useEffect(() => {
    if (!selectedBatchId && recommended) {
      onBatchSelect(recommended.id)
    }
  }, [recommended, selectedBatchId, onBatchSelect])

  const selected = batches.find(b => b.id === selectedBatchId)
  const qtyNum = quantity || 0
  const maxQty = maxQuantity ?? selected?.quantity ?? 0

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{productName}</p>
          {unitPrice !== undefined && (
            <p className="text-caption text-gray-500">Unit price: R{unitPrice.toFixed(2)}</p>
          )}
        </div>
      </div>

      {/* ── Selected batch (or recommended) ────────────── */}
      {selected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                  {selectedBatchId === recommended?.id ? 'Recommended (FIFO)' : 'Selected Batch'}
                </span>
                {selectedBatchId !== recommended?.id && (
                  <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                    Override
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-emerald-700 dark:text-emerald-300">
                <span className="font-mono font-medium">{selected.batchNumber}</span>
                <ExpiryBadge date={selected.expiryDate} />
                <span>Avail: {selected.quantity.toLocaleString()}</span>
              </div>
            </div>

            {/* Quantity input */}
            <div className="shrink-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onQuantityChange(Math.max(1, qtyNum - 1))}
                  disabled={qtyNum <= 1}
                  className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  −
                </button>
                <Input
                  type="number"
                  min={1}
                  max={maxQty}
                  value={qtyNum || ''}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 0
                    onQuantityChange(Math.min(Math.max(1, v), maxQty))
                  }}
                  className="h-9 w-16 text-center text-sm font-bold tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => onQuantityChange(Math.min(maxQty, qtyNum + 1))}
                  disabled={qtyNum >= maxQty}
                  className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Other batches ───────────────────────────────── */}
      {batches.filter(b => b.id !== selectedBatchId).length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Other Batches ({batches.filter(b => b.id !== selectedBatchId).length})
          </button>

          {expanded && (
            <div className="mt-1 space-y-1">
              {batches
                .filter(b => b.id !== selectedBatchId)
                .map(batch => {
                  const expiryStatus = getExpiryStatus(batch.expiryDate)
                  const isDisabled = batch.quantity <= 0 || expiryStatus === 'expired'
                  return (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => !isDisabled && onBatchSelect(batch.id)}
                      disabled={isDisabled}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                        isDisabled
                          ? 'cursor-not-allowed opacity-40'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700',
                      )}
                    >
                      {/* Status icon */}
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          expiryStatus === 'expired' ? 'bg-red-500' :
                          expiryStatus === 'warning' ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600',
                        )}
                      />

                      {/* Batch info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                            {batch.batchNumber}
                          </span>
                          {expiryStatus !== 'unknown' && (
                            <span className={cn(
                              'text-[10px] font-medium px-1 py-0.5 rounded',
                              expiryStatus === 'warning' && 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/20',
                              expiryStatus === 'expired' && 'text-red-600 bg-red-50 dark:text-red-300 dark:bg-red-900/20',
                            )}>
                              {expiryStatus === 'warning' ? 'Expiring' : expiryStatus === 'expired' ? 'Expired' : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-caption text-gray-500">
                          {batch.expiryDate && (
                            <span>Exp: {new Date(batch.expiryDate).toLocaleDateString()}</span>
                          )}
                          <span>Avail: {batch.quantity.toLocaleString()}</span>
                        </div>
                      </div>

                      {batch.sellingPrice && (
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                          R{batch.sellingPrice.toFixed(2)}
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* ── Price override ──────────────────────────────── */}
      {onUnitPriceChange && (
        <div className="flex items-center gap-2 pt-1">
          <label className="text-caption text-gray-500">Price:</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={unitPrice ?? ''}
            onChange={e => onUnitPriceChange(parseFloat(e.target.value) || 0)}
            className="h-9 w-24 text-sm"
          />
        </div>
      )}
    </div>
  )
}

/* ─── Sub-component: Expiry Badge ──────────────────────── */

function ExpiryBadge({ date }: { date?: string }) {
  const status = getExpiryStatus(date)
  const styles = EXPIRY_STYLES[status]

  if (status === 'unknown') return null

  return (
    <Badge variant="outline" className={cn('gap-1 px-1.5 py-0.5 text-[10px] font-medium', styles.badge)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
      {styles.label}
    </Badge>
  )
}

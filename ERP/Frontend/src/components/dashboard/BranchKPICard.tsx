import { memo } from 'react'
import {
  TrendingUp, DollarSign, ShoppingCart, AlertTriangle, Clock,
  ArrowUpRight, ArrowDownRight, AlertCircle, Store,
} from 'lucide-react'
import { cn } from '../../lib/utils'

export interface BranchMetrics {
  totalSales: number
  transactionCount: number
  cashAmount: number
  debtAmount: number
  insuranceAmount: number
  totalExpenses: number
  lowStockCount: number
  expiringSoonCount: number
}

export interface BranchData {
  branchId: number
  branchName: string
  branchCode: string
  location?: string | null
  metrics: BranchMetrics
}

// ── Skeleton ──────────────────────────────────────────────────────────────
export function BranchCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-1.5 flex-1">
          <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-3 w-16 bg-gray-100 dark:bg-gray-700 rounded" />
        </div>
      </div>
      <div className="h-8 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded" />
        <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded" />
        <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded" />
        <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded" />
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────
export function BranchCardEmpty() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500">
        <div className="h-12 w-12 rounded-full bg-gray-50 dark:bg-gray-700/50 flex items-center justify-center mb-3">
          <Store className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">No activity for this period</p>
        <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">No sales or transactions recorded</p>
      </div>
    </div>
  )
}

// ── Error state ───────────────────────────────────────────────────────────
export function BranchCardError({ message = 'Failed to load branch data' }: { message?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/50 p-5">
      <div className="flex flex-col items-center justify-center py-6">
        <div className="h-12 w-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-3">
          <AlertCircle className="h-6 w-6 text-red-500" />
        </div>
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{message}</p>
        <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">Data may be incomplete or unavailable</p>
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────
interface BranchKPICardProps {
  branch: BranchData
  currency?: string
  onClick?: () => void
  error?: string | null
}

function formatCurrency(amount: number, currency = 'RWF'): string {
  return new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function BranchKPICardInner({ branch, currency = 'RWF', onClick, error }: BranchKPICardProps) {
  if (error) return <BranchCardError message={error} />
  if (!branch) return <BranchCardSkeleton />

  const { metrics } = branch
  const netProfit = metrics.totalSales - metrics.totalExpenses
  const isProfitable = netProfit >= 0
  const hasActivity = metrics.transactionCount > 0 || metrics.totalSales > 0
  const totalAlerts = metrics.lowStockCount + metrics.expiringSoonCount

  if (!hasActivity) return <BranchCardEmpty />

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-xl border shadow-sm p-5',
        'transition-all duration-200',
        'border-gray-100 dark:border-gray-700',
        onClick && [
          'cursor-pointer',
          'hover:shadow-md hover:-translate-y-0.5 hover:border-blue-200 dark:hover:border-blue-700',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-300',
        ],
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0',
            'bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30',
          )}>
            <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">
              {branch.branchName}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {branch.branchCode}{branch.location ? ` · ${branch.location}` : ''}
            </p>
          </div>
        </div>
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0',
          isProfitable
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        )}>
          {isProfitable ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {isProfitable ? 'Profitable' : 'Loss'}
        </span>
      </div>

      {/* Primary metric */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Total Sales</p>
        <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
          {formatCurrency(metrics.totalSales, currency)}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {metrics.transactionCount} transaction{metrics.transactionCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Secondary metrics grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-3 border-t border-gray-100 dark:border-gray-700">
        <MetricRow
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label="Cash"
          value={formatCurrency(metrics.cashAmount, currency)}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <MetricRow
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Debt"
          value={formatCurrency(metrics.debtAmount, currency)}
          color="text-amber-600 dark:text-amber-400"
        />
        <MetricRow
          icon={<ShoppingCart className="h-3.5 w-3.5" />}
          label="Expenses"
          value={formatCurrency(metrics.totalExpenses, currency)}
          color="text-red-600 dark:text-red-400"
        />
        <MetricRow
          icon={<AlertTriangle className={cn('h-3.5 w-3.5', totalAlerts > 5 && 'text-orange-500 animate-pulse')} />}
          label="Alerts"
          value={String(totalAlerts)}
          color={cn(
            totalAlerts === 0 && 'text-gray-400 dark:text-gray-500',
            totalAlerts > 0 && totalAlerts <= 5 && 'text-orange-600 dark:text-orange-400',
            totalAlerts > 5 && 'text-red-600 dark:text-red-400 font-bold',
          )}
          sub={totalAlerts > 0 ? `${metrics.lowStockCount} low · ${metrics.expiringSoonCount} expiring` : 'All clear'}
        />
      </div>
    </div>
  )
}

function MetricRow({ icon, label, value, color, sub }: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={cn('flex-shrink-0', color)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</p>
        <p className={cn('text-sm font-semibold tabular-nums truncate', color)}>{value}</p>
        {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{sub}</p>}
      </div>
    </div>
  )
}

export const BranchKPICard = memo(BranchKPICardInner)

import { cn } from '../../lib/utils'

// ── Palette map ───────────────────────────────────────────────────────────────
// Each key maps to a Tailwind className string for bg + text + border.
// Using explicit class strings (not dynamic) so Tailwind's JIT includes them.

const STYLES: Record<string, string> = {
  // ── Sale / generic ─────────────────────────────────────────────────────────
  COMPLETED:          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  PAID:               'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  SUCCESS:            'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  ACTIVE:             'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  SYNCED:             'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  ACCEPTED:           'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  DELIVERED:          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',
  SUCCEEDED:          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40',

  PENDING:            'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700/40',
  DRAFT:              'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600/40',
  PROCESSING:         'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/40',
  TRIALING:           'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-700/40',
  APPROVED:           'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-700/40',
  SUBMITTED:          'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-700/40',
  SHIPPED:            'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-300 dark:border-cyan-700/40',

  REFUNDED:           'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700/40',
  PARTIALLY_REFUNDED: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700/40',
  PARTIALLY_FULFILLED:'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700/40',
  PAST_DUE:           'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700/40',
  RETRYING:           'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/40',

  CANCELLED:          'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  CANCELED:           'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  REJECTED:           'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  FAILED:             'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  EXPIRED:            'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  SUSPENDED:          'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  DEAD_LETTER:        'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',
  UNPAID:             'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/40',

  INACTIVE:           'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',
  DECLINED:           'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',

  FULFILLED:          'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-700/40',
}

const DISPLAY_LABELS: Record<string, string> = {
  COMPLETED:          'Completed',
  PAID:               'Paid',
  SUCCESS:            'Success',
  ACTIVE:             'Active',
  SYNCED:             'Synced',
  ACCEPTED:           'Accepted',
  DELIVERED:          'Delivered',
  SUCCEEDED:          'Succeeded',
  PENDING:            'Pending',
  DRAFT:              'Draft',
  PROCESSING:         'Processing',
  TRIALING:           'Trialing',
  APPROVED:           'Approved',
  SUBMITTED:          'Submitted',
  SHIPPED:            'Shipped',
  REFUNDED:           'Refunded',
  PARTIALLY_REFUNDED: 'Partial Refund',
  PARTIALLY_FULFILLED:'Partial',
  PAST_DUE:           'Past Due',
  RETRYING:           'Retrying',
  CANCELLED:          'Cancelled',
  CANCELED:           'Canceled',
  REJECTED:           'Rejected',
  FAILED:             'Failed',
  EXPIRED:            'Expired',
  SUSPENDED:          'Suspended',
  DEAD_LETTER:        'Dead Letter',
  UNPAID:             'Unpaid',
  INACTIVE:           'Inactive',
  DECLINED:           'Declined',
  FULFILLED:          'Fulfilled',
}

const FALLBACK = 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700/40 dark:text-gray-300 dark:border-gray-600/40'

interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, label, className, size = 'sm' }: StatusBadgeProps) {
  const key = (status ?? '').toUpperCase().trim()
  const style = STYLES[key] ?? FALLBACK
  const text = label ?? DISPLAY_LABELS[key] ?? key.replace(/_/g, ' ')

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-badge border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        style,
        className,
      )}
    >
      {text}
    </span>
  )
}

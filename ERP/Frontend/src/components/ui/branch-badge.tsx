import { cn } from '../../lib/utils'

interface BranchBadgeProps {
  name: string
  isAllBranches?: boolean
  isPrimary?: boolean
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
  className?: string
}

const statusDot: Record<string, string> = {
  ACTIVE: 'bg-emerald-500',
  INACTIVE: 'bg-slate-400',
  SUSPENDED: 'bg-red-500',
}

export function BranchBadge({ name, isAllBranches, isPrimary, status = 'ACTIVE', className }: BranchBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium',
        isAllBranches
          ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
          : isPrimary
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          isAllBranches ? 'bg-violet-500' : statusDot[status],
        )}
        aria-hidden="true"
      />
      <span className="truncate max-w-[120px]">{name}</span>
    </span>
  )
}

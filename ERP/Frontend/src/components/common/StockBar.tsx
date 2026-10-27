import { cn } from '../../lib/utils'

interface StockBarProps {
  current: number
  max: number
  min?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const DOT_CLASSES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
}

const GAP_CLASSES = {
  sm: 'gap-0.5',
  md: 'gap-1',
  lg: 'gap-1',
}

function getLevel(current: number, max: number): number {
  if (max <= 0) return 0
  const pct = current / max
  if (pct >= 0.76) return 4
  if (pct >= 0.51) return 3
  if (pct >= 0.26) return 2
  if (pct > 0) return 1
  return 0
}

const LEVEL_COLORS: Record<number, string> = {
  0: 'bg-red-400 dark:bg-red-500',
  1: 'bg-amber-400 dark:bg-amber-500',
  2: 'bg-amber-400 dark:bg-amber-500',
  3: 'bg-emerald-400 dark:bg-emerald-500',
  4: 'bg-emerald-500 dark:bg-emerald-400',
}

export function StockBar({ current, max, min, size = 'md', className }: StockBarProps) {
  const level = getLevel(current, max)
  const isLow = min !== undefined && current <= min

  return (
    <span
      className={cn('inline-flex items-center', GAP_CLASSES[size], className)}
      role="img"
      aria-label={`Stock level: ${current} of ${max} units${isLow ? ' (low stock)' : ''}`}
    >
      {[1, 2, 3, 4].map(dot => (
        <span
          key={dot}
          className={cn(
            'rounded-full transition-colors',
            DOT_CLASSES[size],
            dot <= level ? LEVEL_COLORS[level] : 'bg-gray-200 dark:bg-gray-700',
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

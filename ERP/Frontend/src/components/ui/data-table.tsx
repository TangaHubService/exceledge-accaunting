import { useMemo, useState, type ReactNode } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Skeleton } from './skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc' | null

export interface ColumnDef<T> {
  key: string
  header: string
  sortable?: boolean
  /** Value used for client-side sorting when it differs from row[key]. */
  sortValue?: (row: T) => unknown
  className?: string
  headerClassName?: string
  render?: (row: T, index: number) => ReactNode
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  keyExtractor: (row: T, index: number) => string | number
  isLoading?: boolean
  skeletonRows?: number
  emptyTitle?: string
  emptyMessage?: string
  emptyIcon?: ReactNode
  // Pagination
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (page: number) => void
  // Sorting (controlled)
  sortKey?: string
  sortDir?: SortDir
  onSort?: (key: string, dir: SortDir) => void
  // Row click
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  className?: string
}

// ── Sort header button ────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active || dir === null) return <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
  if (dir === 'asc') return <ChevronUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
  return <ChevronDown className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1

  if (typeof left === 'number' && typeof right === 'number') return left - right

  const leftText = String(left).trim()
  const rightText = String(right).trim()
  const leftNumber = Number(leftText)
  const rightNumber = Number(rightText)
  if (leftText !== '' && rightText !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber
  }

  return leftText.localeCompare(rightText, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow({ columns }: { columns: ColumnDef<any>[] }) {
  return (
    <tr>
      {columns.map(col => (
        <td key={col.key} className="px-4 py-3">
          <Skeleton className="h-4 w-full rounded" />
        </td>
      ))}
    </tr>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  icon, title, message,
}: { icon?: ReactNode; title: string; message: string }) {
  return (
    <tr>
      <td colSpan={100}>
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          {icon && <div className="mb-3 opacity-40">{icon}</div>}
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-xs mt-1">{message}</p>
        </div>
      </td>
    </tr>
  )
}

// ── Pagination bar ────────────────────────────────────────────────────────────

function PaginationBar({
  page, pageSize, total, onChange,
}: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = Math.min((page - 1) * pageSize + 1, total)
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        {total === 0 ? 'No results' : `${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* Page number pills — show at most 5 */}
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
          .reduce<(number | '...')[]>((acc, p, i, arr) => {
            if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
            acc.push(p)
            return acc
          }, [])
          .map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p as number)}
                className={cn(
                  'flex h-7 min-w-[1.75rem] items-center justify-center rounded px-1.5 text-xs font-medium transition-colors',
                  page === p
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                )}
              >
                {p}
              </button>
            )
          )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  skeletonRows = 8,
  emptyTitle = 'No results found',
  emptyMessage = 'Try adjusting your filters.',
  emptyIcon,
  page,
  pageSize = 20,
  total,
  onPageChange,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  rowClassName,
  className,
}: DataTableProps<T>) {
  // Internal sort state (uncontrolled mode)
  const [internalSortKey, setInternalSortKey] = useState<string | null>(null)
  const [internalSortDir, setInternalSortDir] = useState<SortDir>(null)

  const activeSortKey = sortKey ?? internalSortKey
  const activeSortDir = sortDir ?? internalSortDir

  const isSortable = (column: ColumnDef<T>) =>
    column.sortable ?? (column.key !== 'actions' && column.key !== 'action')

  const handleSort = (key: string) => {
    if (!onSort) {
      // Uncontrolled
      if (internalSortKey !== key) {
        setInternalSortKey(key)
        setInternalSortDir('asc')
      } else {
        const next: SortDir = internalSortDir === 'asc' ? 'desc' : internalSortDir === 'desc' ? null : 'asc'
        setInternalSortDir(next)
        if (next === null) setInternalSortKey(null)
      }
    } else {
      const next: SortDir = activeSortKey !== key ? 'asc' : activeSortDir === 'asc' ? 'desc' : activeSortDir === 'desc' ? null : 'asc'
      onSort(key, next)
    }
  }

  const hasPagination = page !== undefined && onPageChange && total !== undefined

  const displayedData = useMemo(() => {
    // A controlled table delegates ordering to its caller (usually a server query).
    if (onSort || !activeSortKey || !activeSortDir) return data
    const column = columns.find(item => item.key === activeSortKey)
    if (!column) return data

    return data
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = column.sortValue?.(a.row) ?? (a.row as any)[column.key]
        const right = column.sortValue?.(b.row) ?? (b.row as any)[column.key]
        const result = compareValues(left, right)
        return result === 0 ? a.index - b.index : activeSortDir === 'asc' ? result : -result
      })
      .map(item => item.row)
  }, [activeSortDir, activeSortKey, columns, data, onSort])

  return (
    <div className={cn('rounded-card border border-gray-200 dark:border-gray-700 overflow-hidden shadow-card', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap select-none',
                    isSortable(col) && 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200',
                    col.headerClassName,
                  )}
                  onClick={isSortable(col) ? () => handleSort(col.key) : undefined}
                  aria-sort={activeSortKey === col.key && activeSortDir
                    ? activeSortDir === 'asc' ? 'ascending' : 'descending'
                    : undefined}
                >
                  <span className="flex items-center gap-1.5">
                    {col.header}
                    {isSortable(col) && (
                      <SortIcon
                        active={activeSortKey === col.key}
                        dir={activeSortKey === col.key ? activeSortDir : null}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 bg-white dark:bg-gray-800">
            {isLoading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <SkeletonRow key={i} columns={columns} />
              ))
            ) : displayedData.length === 0 ? (
              <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
            ) : (
              displayedData.map((row, index) => (
                <tr
                  key={keyExtractor(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40',
                    rowClassName?.(row),
                  )}
                >
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3 text-gray-700 dark:text-gray-200 align-middle',
                        col.className,
                      )}
                    >
                      {col.render
                        ? col.render(row, index)
                        : (row as any)[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasPagination && (
        <PaginationBar
          page={page!}
          pageSize={pageSize}
          total={total!}
          onChange={onPageChange!}
        />
      )}
    </div>
  )
}

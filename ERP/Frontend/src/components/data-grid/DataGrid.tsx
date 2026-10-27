import React, { useState, useCallback, useMemo } from 'react'
import { cn } from '../../lib/utils'
import { Skeleton } from '../ui/skeleton'
import { Checkbox } from '../ui/checkbox'
import { ChevronUp, ChevronDown, ChevronsUpDown, PackageX } from 'lucide-react'

/* ─── Types ─────────────────────────────────────────── */

export interface Column<T> {
  id: string
  header: string
  accessor: (row: T) => React.ReactNode
  sortKey?: keyof T | string
  sortable?: boolean
  /** Value used for local sorting when it differs from the field value. */
  sortValue?: (row: T) => unknown
  className?: string
  headerClassName?: string
  /** Hide on mobile (default: visible) */
  hideOnMobile?: boolean
  /** Column width (Tailwind class or CSS value) */
  width?: string
  /** Align content */
  align?: 'left' | 'center' | 'right'
}

interface DataGridProps<T extends { id: number | string }> {
  columns: Column<T>[]
  data: T[]
  keyExtractor?: (row: T) => string | number
  /** Loading state */
  loading?: boolean
  /** Number of skeleton rows */
  skeletonRows?: number
  /** Row selection */
  selectedIds?: Set<string | number>
  onSelectionChange?: (ids: Set<string | number>) => void
  /** Sort */
  sortField?: string
  sortDirection?: 'asc' | 'desc'
  onSort?: (field: string, direction: 'asc' | 'desc') => void
  /** Row click */
  onRowClick?: (row: T) => void
  /** Empty state */
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  /** Styling */
  className?: string
  rowClassName?: string | ((row: T) => string | undefined)
  /** Enable sticky header */
  stickyHeader?: boolean
}

/* ─── Component ─────────────────────────────────────── */

export function DataGrid<T extends { id: number | string }>({
  columns,
  data,
  keyExtractor,
  loading = false,
  skeletonRows = 8,
  selectedIds,
  onSelectionChange,
  sortField,
  sortDirection = 'asc',
  onSort,
  onRowClick,
  emptyTitle = 'No data',
  emptyDescription = 'There are no items to display.',
  emptyAction,
  className,
  rowClassName,
  stickyHeader = true,
}: DataGridProps<T>) {
  const [localSortField, setLocalSortField] = useState<string | undefined>(sortField)
  const [localSortDir, setLocalSortDir] = useState<'asc' | 'desc'>(sortDirection)

  const isControlled = sortField !== undefined && onSort !== undefined

  const currentSortField = isControlled ? sortField : localSortField
  const currentSortDir = isControlled ? sortDirection : localSortDir
  const isSortable = (column: Column<T>) =>
    column.sortable ?? (column.id !== 'actions' && column.id !== 'action')
  const columnSortKey = (column: Column<T>) => String(column.sortKey ?? column.id)

  const getNestedValue = (row: T, path: string): unknown =>
    path.split('.').reduce<unknown>((value, part) =>
      value != null && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
    row,
    )

  const compareValues = (left: unknown, right: unknown): number => {
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    if (typeof left === 'number' && typeof right === 'number') return left - right
    const a = String(left).trim()
    const b = String(right).trim()
    const aNumber = Number(a)
    const bNumber = Number(b)
    if (a && b && Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }

  const displayedData = useMemo(() => {
    if (isControlled || !currentSortField) return data
    const column = columns.find(col => columnSortKey(col) === currentSortField)
    if (!column) return data
    return data
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = column.sortValue?.(a.row) ?? getNestedValue(a.row, columnSortKey(column))
        const right = column.sortValue?.(b.row) ?? getNestedValue(b.row, columnSortKey(column))
        const result = compareValues(left, right)
        return result === 0 ? a.index - b.index : currentSortDir === 'asc' ? result : -result
      })
      .map(item => item.row)
  }, [columns, currentSortDir, currentSortField, data, isControlled])

  const handleSort = useCallback(
    (column: Column<T>) => {
      if (!isSortable(column)) return
      const key = columnSortKey(column)
      if (isControlled) {
        const dir = sortField === key && sortDirection === 'asc' ? 'desc' : 'asc'
        onSort(key, dir)
      } else {
        setLocalSortDir(prev => {
          const dir = currentSortField === key && prev === 'asc' ? 'desc' : 'asc'
          return dir
        })
        setLocalSortField(key)
      }
    },
    [isControlled, sortField, sortDirection, currentSortField, onSort],
  )

  const allSelected = useMemo(
    () => selectedIds !== undefined && data.length > 0 && selectedIds.size === data.length,
    [selectedIds, data],
  )

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      const ids = keyExtractor ? data.map(keyExtractor) : data.map(r => r.id)
      onSelectionChange(new Set(ids))
    }
  }, [allSelected, onSelectionChange, data, keyExtractor])

  const toggleRow = useCallback(
    (id: string | number) => {
      if (!onSelectionChange || !selectedIds) return
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onSelectionChange(next)
    },
    [onSelectionChange, selectedIds],
  )

  const getKey = useCallback(
    (row: T, index: number): string | number => {
      return keyExtractor?.(row) ?? row.id ?? index
    },
    [keyExtractor],
  )

  /* ── Render ──────────────────────────────────────── */
  return (
    <div className={cn('w-full', className)}>
      {/* ── Desktop table ─────────────────────────── */}
      <div className="hidden overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800 sm:block">
        <table className="w-full text-left text-sm">
          {/* ── Header ─────────────────────────────── */}
          <thead>
            <tr
              className={cn(
                'border-b bg-gray-50/80 dark:border-zinc-700 dark:bg-zinc-800/80',
                stickyHeader && 'sticky top-0 z-10',
              )}
            >
              {/* Checkbox column */}
              {onSelectionChange && (
                <th className="w-12 px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}

              {columns.map(col => (
                <th
                  key={col.id}
                  className={cn(
                    'h-11 px-4 text-caption font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400',
                    isSortable(col) && 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.hideOnMobile && 'hidden lg:table-cell',
                    col.headerClassName,
                  )}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                  onClick={() => isSortable(col) && handleSort(col)}
                  aria-sort={
                    currentSortField === columnSortKey(col)
                      ? currentSortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <div className="inline-flex items-center gap-1">
                    <span>{col.header}</span>
                    {isSortable(col) && (
                      <span className="shrink-0 text-gray-300 dark:text-gray-600">
                        {currentSortField === columnSortKey(col) ? (
                          currentSortDir === 'asc' ? (
                            <ChevronUp className="h-3.5 w-3.5 text-blue-500" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-blue-500" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Body ───────────────────────────────── */}
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-700">
            {loading ? (
              <SkeletonRows columns={columns} rowCount={skeletonRows} showCheckbox={!!onSelectionChange} />
            ) : data.length === 0 ? (
              <EmptyRow
                colSpan={columns.length + (onSelectionChange ? 1 : 0)}
                title={emptyTitle}
                description={emptyDescription}
                action={emptyAction}
              />
            ) : (
              displayedData.map((row, idx) => {
                const key = getKey(row, idx)
                const isSelected = selectedIds?.has(key)
                return (
                  <tr
                    key={key}
                    className={cn(
                      'transition-colors',
                      isSelected && 'bg-blue-50 dark:bg-blue-900/10',
                      onRowClick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700/50',
                      typeof rowClassName === 'function' ? rowClassName(row) : rowClassName,
                    )}
                    onClick={() => onRowClick?.(row)}
                  >
                    {onSelectionChange && (
                      <td className="w-12 px-4 py-3" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(key)}
                          aria-label={`Select row ${idx + 1}`}
                        />
                      </td>
                    )}
                    {columns.map(col => (
                      <td
                        key={col.id}
                        className={cn(
                          'h-11 px-4 text-body text-gray-700 dark:text-gray-300',
                          col.align === 'right' && 'text-right',
                          col.align === 'center' && 'text-center',
                          col.hideOnMobile && 'hidden lg:table-cell',
                          col.className,
                        )}
                        style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                      >
                        {col.accessor(row)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Mobile card layout ──────────────────────── */}
      <div className="space-y-3 sm:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
              <div className="space-y-3">
                {columns.slice(0, 4).map(col => (
                  <div key={col.id}>
                    <Skeleton className="mb-1 h-3 w-20" />
                    <Skeleton className="h-5 w-40" />
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : data.length === 0 ? (
          <div className="rounded-xl border bg-white p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
            <EmptyContent title={emptyTitle} description={emptyDescription} action={emptyAction} />
          </div>
        ) : (
          displayedData.map((row, idx) => {
            const key = getKey(row, idx)
            const isSelected = selectedIds?.has(key)
            return (
              <div
                key={key}
                className={cn(
                  'rounded-xl border bg-white p-4 shadow-sm transition-colors dark:border-zinc-700 dark:bg-zinc-800',
                  isSelected && 'ring-2 ring-blue-500',
                  onRowClick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700',
                )}
                onClick={() => onRowClick?.(row)}
              >
                <div className="space-y-2.5">
                  {columns
                    .filter(col => !col.hideOnMobile)
                    .map(col => (
                      <div key={col.id} className="flex items-start justify-between gap-2">
                        <span className="shrink-0 text-caption font-medium text-gray-500">
                          {col.header}
                        </span>
                        <span
                          className={cn(
                            'text-right text-body text-gray-900 dark:text-gray-100',
                            col.align === 'left' && 'text-left',
                          )}
                        >
                          {col.accessor(row)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════ */

/* ── Loading skeleton rows ────────────────────────────── */

function SkeletonRows({
  columns,
  rowCount,
  showCheckbox,
}: {
  columns: Column<any>[]
  rowCount: number
  showCheckbox: boolean
}) {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          {showCheckbox && (
            <td className="w-12 px-4 py-3">
              <Skeleton className="h-4 w-4 rounded" />
            </td>
          )}
          {columns.map(col => (
            <td key={col.id} className={cn('px-4 py-3', col.hideOnMobile && 'hidden lg:table-cell')}>
              <Skeleton className={cn('h-4', i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-1/2' : 'w-2/3')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/* ── Empty row ─────────────────────────────────────────── */

function EmptyRow({
  colSpan,
  title,
  description,
  action,
}: {
  colSpan: number
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12">
        <EmptyContent title={title} description={description} action={action} />
      </td>
    </tr>
  )
}

function EmptyContent({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <PackageX className="h-10 w-10 text-gray-300 dark:text-gray-600" />
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

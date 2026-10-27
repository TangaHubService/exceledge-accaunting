import { cn } from '../../lib/utils'
import { Skeleton } from './skeleton'

interface AppShellSkeletonProps {
  sidebarCollapsed?: boolean
  variant?: 'dashboard' | 'list' | 'form'
}

/**
 * AppShellSkeleton — mirrors the exact shell layout (sidebar + header + main)
 * so there is zero layout shift when content loads.
 */
export function AppShellSkeleton({ sidebarCollapsed = false, variant = 'dashboard' }: AppShellSkeletonProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 dark:bg-zinc-900">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-white/10 bg-gradient-to-b from-[#0f2744] via-[#0c2035] to-[#0a1628] lg:flex',
          sidebarCollapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Logo area */}
        <div className="flex h-14 shrink-0 items-center border-b border-white/15 px-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg bg-white/10" />
          {!sidebarCollapsed && (
            <Skeleton className="ml-2 h-5 w-24 bg-white/10" />
          )}
        </div>

        {/* Org badge */}
        <div className={cn('py-3', sidebarCollapsed ? 'px-2' : 'px-3')}>
          <Skeleton
            className={cn(
              'rounded-lg bg-white/10',
              sidebarCollapsed ? 'h-10 w-10' : 'h-[52px] w-full',
            )}
          />
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 overflow-hidden px-2">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton
              key={i}
              className={cn(
                'h-10 rounded-lg bg-white/5',
                sidebarCollapsed ? 'w-10' : 'w-full',
              )}
            />
          ))}
        </nav>

        {/* Logout */}
        <div className={cn('border-t border-white/15 py-3', sidebarCollapsed ? 'px-2' : 'px-3')}>
          <Skeleton
            className={cn(
              'h-10 rounded-lg bg-white/5',
              sidebarCollapsed ? 'w-10' : 'w-full',
            )}
          />
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center border-b border-white/10 bg-gradient-to-b from-[#0f2744] via-[#0c2035] to-[#0a1628] px-4 lg:px-6">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg bg-white/10 lg:hidden" />
          <Skeleton className="ml-2 h-9 w-9 shrink-0 rounded-lg bg-white/10" />
          <div className="ml-auto flex items-center gap-3">
            <Skeleton className="h-9 w-[160px] rounded-md bg-white/10" />
            <Skeleton className="h-9 w-9 rounded-md bg-white/10" />
            <Skeleton className="h-9 w-9 rounded-md bg-white/10" />
            <Skeleton className="h-9 w-[120px] rounded-md bg-white/10" />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <ShellContent variant={variant} />
        </main>
      </div>
    </div>
  )
}

/* ── Variant content matchers ──────────────────────────── */

function ShellContent({ variant }: { variant: AppShellSkeletonProps['variant'] }) {
  switch (variant) {
    case 'list':
      return <ListSkeleton />
    case 'form':
      return <FormSkeleton />
    default:
      return <DashboardSkeletonContent />
  }
}

function DashboardSkeletonContent() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-xl border bg-white p-5 shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
            <div className="flex items-center justify-between">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-8 w-28" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-6 h-64 w-full rounded-lg" />
        </div>
        <div className="rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-6 h-64 w-full rounded-lg" />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
        <div className="border-b px-6 py-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="divide-y">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-4 px-6 py-4">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
      <div className="rounded-xl border bg-white shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
        <div className="divide-y">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="flex items-center gap-4 px-6 py-4">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Skeleton className="h-7 w-48" />
      <div className="rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-800 dark:border-zinc-700">
        <div className="space-y-5">
          {[1, 2, 3, 4].map(i => (
            <div key={i}>
              <Skeleton className="mb-1.5 h-4 w-24" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        <Skeleton className="h-11 w-24 rounded-md" />
        <Skeleton className="h-11 w-32 rounded-md" />
      </div>
    </div>
  )
}

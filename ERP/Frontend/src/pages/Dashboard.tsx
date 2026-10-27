import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiClient, type OverviewDashboardData } from '../lib/api-client'
import { DashboardSkeleton } from '../components/ui/DashboardSkeleton'
import { DashboardOverview } from '../components/dashboard/DashboardOverview'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred'
}

export const Dashboard = () => {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Date filter state ──────────────
  const [datePreset, setDatePreset] = useState<string>(() => {
    return searchParams.get('preset') || 'today'
  })

  const startDate = searchParams.get('startDate') || undefined
  const endDate = searchParams.get('endDate') || undefined

  // ── Query: Overview dashboard stats ──────────────────────────────
  const overviewQuery = useQuery<OverviewDashboardData>({
    queryKey: ['overview-dashboard-stats', datePreset, startDate, endDate],
    queryFn: () => apiClient.getOverviewDashboard({
      preset: datePreset,
      startDate,
      endDate,
    }),
    staleTime: 30_000,
    retry: 2,
    refetchInterval: false,
  })

  const handleDatePresetChange = useCallback((newPreset: string) => {
    setDatePreset(newPreset)
    const next: Record<string, string> = { preset: newPreset }
    setSearchParams(next, { replace: true })
  }, [setSearchParams])

  const handleDateRangeChange = useCallback((start: string, end: string) => {
    setDatePreset('custom')
    const next: Record<string, string> = { startDate: start, endDate: end }
    setSearchParams(next, { replace: true })
  }, [setSearchParams])

  const isLoading = overviewQuery.isLoading && !overviewQuery.data
  const isFetching = overviewQuery.isFetching
  const error = overviewQuery.error
  const queryError = overviewQuery.isError

  if (isLoading) return <DashboardSkeleton />

  if (queryError || !overviewQuery.data) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-md bg-white dark:bg-gray-800 p-8 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="h-16 w-16 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <RefreshCw className="h-8 w-8 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Failed to load dashboard</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{getErrorMessage(error)}</p>
          </div>
          <button
            type="button"
            onClick={() => overviewQuery.refetch()}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 bg-gray-50/50 dark:bg-gray-900 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <DashboardOverview
          data={overviewQuery.data}
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          startDate={startDate}
          endDate={endDate}
          onDateRangeChange={handleDateRangeChange}
          userDisplayName={user?.name || 'Demo Admin'}
          isFetching={isFetching}
        />
      </div>
    </div>
  )
}

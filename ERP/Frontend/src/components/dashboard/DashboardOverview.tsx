import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ShoppingBag, Store, Wallet, Bell,
  ChevronDown, MoreVertical, AlertTriangle, Calendar,
  PackageX, ArrowUpRight, BarChart3,
  Receipt, RefreshCw, UserPlus, PackageCheck
} from 'lucide-react'
import type { OverviewDashboardData } from '../../lib/api-client'
import { cn } from '../../lib/utils'

interface DashboardOverviewProps {
  data: OverviewDashboardData
  datePreset: string
  onDatePresetChange: (preset: string) => void
  userDisplayName?: string
  isFetching?: boolean
  startDate?: string
  endDate?: string
  onDateRangeChange?: (start: string, end: string) => void
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  data,
  datePreset,
  onDatePresetChange,
  userDisplayName = 'Demo Admin',
  startDate,
  endDate,
  onDateRangeChange,
}) => {
  const navigate = useNavigate()
  const [activeMenuCard, setActiveMenuCard] = useState<string | null>(null)
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false)
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customStart, setCustomStart] = useState(startDate || format(new Date(), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(endDate || format(new Date(), 'yyyy-MM-dd'))

  const PRESET_OPTIONS = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'custom', label: 'Custom Range' },
  ]

  const isCustomRange = datePreset === 'custom' && !!startDate && !!endDate

  const activePresetLabel = PRESET_OPTIONS.find(opt => opt.id === datePreset)?.label || 'Today'

  const dateSubtext = isCustomRange
    ? `${format(new Date(startDate!), 'MMM d, yyyy')} - ${format(new Date(endDate!), 'MMM d, yyyy')}`
    : format(new Date(), 'EEEE, MMMM do, yyyy')

  const openCustomRange = () => {
    setCustomStart(startDate || format(new Date(), 'yyyy-MM-dd'))
    setCustomEnd(endDate || format(new Date(), 'yyyy-MM-dd'))
    setDateDropdownOpen(false)
    setCustomRangeOpen(true)
  }

  // Dynamic time of day greeting
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const formatCurrency = (amount: number) => {
    return `${data.currency || 'RF'} ${amount.toLocaleString()}`
  }

  // Sparkline SVG Path generator
  const generateSparklinePath = (values: number[], width = 200, height = 40) => {
    if (!values || values.length === 0) return { path: '', area: '' }
    const min = Math.min(...values, 0)
    const max = Math.max(...values, 1)
    const range = max - min || 1

    const points = values.map((val, idx) => {
      const x = (idx / (values.length - 1)) * width
      const y = height - ((val - min) / range) * (height - 8) - 4
      return { x, y }
    })

    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i]
      const next = points[i + 1]
      const cpX = (curr.x + next.x) / 2
      d += ` C ${cpX} ${curr.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`
    }

    const area = `${d} L ${width} ${height} L 0 ${height} Z`
    return { path: d, area }
  }

  // Sales Overview dual line chart builder
  const renderSalesOverviewChart = () => {
    const items = data.salesOverview || []
    if (items.length === 0) return null

    const width = 600
    const height = 180
    const maxVal = Math.max(...items.flatMap(i => [i.sales, i.expenses]), 250000)

    const salesPoints = items.map((item, idx) => {
      const x = (idx / (items.length - 1)) * (width - 60) + 40
      const y = height - (item.sales / maxVal) * (height - 40) - 20
      return { x, y }
    })

    const expPoints = items.map((item, idx) => {
      const x = (idx / (items.length - 1)) * (width - 60) + 40
      const y = height - (item.expenses / maxVal) * (height - 40) - 20
      return { x, y }
    })

    const buildBezier = (pts: typeof salesPoints) => {
      if (pts.length === 0) return ''
      let d = `M ${pts[0].x} ${pts[0].y}`
      for (let i = 0; i < pts.length - 1; i++) {
        const curr = pts[i]
        const next = pts[i + 1]
        const cpX = (curr.x + next.x) / 2
        d += ` C ${cpX} ${curr.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`
      }
      return d
    }

    const salesPath = buildBezier(salesPoints)
    const salesArea = `${salesPath} L ${salesPoints[salesPoints.length - 1].x} ${height - 20} L ${salesPoints[0].x} ${height - 20} Z`

    const expPath = buildBezier(expPoints)
    const expArea = `${expPath} L ${expPoints[expPoints.length - 1].x} ${height - 20} L ${expPoints[0].x} ${height - 20} Z`

    return (
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height + 30}`} className="w-full h-auto overflow-visible font-sans text-xs">
          <defs>
            <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = height - pct * (height - 40) - 20
            const valLabel = Math.round((pct * maxVal) / 1000) + 'K'
            return (
              <g key={i}>
                <line x1="40" y1={y} x2={width - 20} y2={y} stroke="#E5E7EB" strokeDasharray="3 3" className="dark:stroke-gray-700" />
                <text x="32" y={y + 4} textAnchor="end" fill="#9CA3AF" fontSize="10">{valLabel}</text>
              </g>
            )
          })}

          {/* Area fills */}
          <path d={salesArea} fill="url(#salesGrad)" />
          <path d={expArea} fill="url(#expGrad)" />

          {/* Lines */}
          <path d={salesPath} fill="none" stroke="#2563EB" strokeWidth="2.5" />
          <path d={expPath} fill="none" stroke="#EF4444" strokeWidth="2.5" />

          {/* Data Points */}
          {salesPoints.map((pt, i) => (
            <circle key={`s-${i}`} cx={pt.x} cy={pt.y} r="4" fill="#FFFFFF" stroke="#2563EB" strokeWidth="2" />
          ))}
          {expPoints.map((pt, i) => (
            <circle key={`e-${i}`} cx={pt.x} cy={pt.y} r="4" fill="#FFFFFF" stroke="#EF4444" strokeWidth="2" />
          ))}

          {/* X Axis Labels */}
          {items.map((item, i) => {
            const x = (i / (items.length - 1)) * (width - 60) + 40
            return (
              <text key={i} x={x} y={height + 15} textAnchor="middle" fill="#6B7280" fontSize="11" fontWeight="500">
                {item.label}
              </text>
            )
          })}
        </svg>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Greeting Header ─────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            {getGreeting()}, {userDisplayName} 👋
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Here&apos;s what&apos;s happening with your business today.
          </p>
        </div>

        <div className="relative">
          <button
            onClick={() => setDateDropdownOpen(!dateDropdownOpen)}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Calendar className="h-4 w-4 text-gray-500" />
            <span>{isCustomRange ? 'Custom Range' : activePresetLabel}</span>
            <span className="text-xs text-gray-400 font-normal">
              ({dateSubtext})
            </span>
            <ChevronDown className="h-4 w-4 text-gray-400 ml-1" />
          </button>

          {dateDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1.5 z-30">
              {PRESET_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    if (opt.id === 'custom') {
                      openCustomRange()
                    } else {
                      onDatePresetChange(opt.id)
                      setCustomRangeOpen(false)
                      setDateDropdownOpen(false)
                    }
                  }}
                  className={cn(
                    'w-full text-left px-4 py-2 text-sm font-medium transition-colors',
                    datePreset === opt.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {customRangeOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-4 z-30">
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-3">Custom Range</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={customStart}
                    max={customEnd || undefined}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart || undefined}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!customStart || !customEnd}
                    onClick={() => {
                      if (customStart && customEnd) {
                        onDateRangeChange?.(customStart, customEnd)
                        setCustomRangeOpen(false)
                      }
                    }}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomRangeOpen(false)}
                    className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Top 4 KPI Cards Grid ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Total Sales */}
        <KPICard
          title="Total Sales"
          value={formatCurrency(data.kpis.totalSales.value)}
          changePct={data.kpis.totalSales.changePercentage}
          icon={ShoppingBag}
          iconBg="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
          strokeColor="#2563EB"
          sparklineData={data.kpis.totalSales.sparkline}
          generateSparkline={generateSparklinePath}
          menuOpen={activeMenuCard === 'sales'}
          onToggleMenu={() => setActiveMenuCard(activeMenuCard === 'sales' ? null : 'sales')}
          onViewDetails={() => navigate('/dashboard/sales')}
        />

        {/* Card 2: Transactions */}
        <KPICard
          title="Transactions"
          value={data.kpis.transactions.value.toLocaleString()}
          changePct={data.kpis.transactions.changePercentage}
          icon={Store}
          iconBg="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
          strokeColor="#10B981"
          sparklineData={data.kpis.transactions.sparkline}
          generateSparkline={generateSparklinePath}
          menuOpen={activeMenuCard === 'txns'}
          onToggleMenu={() => setActiveMenuCard(activeMenuCard === 'txns' ? null : 'txns')}
          onViewDetails={() => navigate('/dashboard/sales')}
        />

        {/* Card 3: Total Expenses */}
        <KPICard
          title="Total Expenses"
          value={formatCurrency(data.kpis.totalExpenses.value)}
          changePct={data.kpis.totalExpenses.changePercentage}
          icon={Wallet}
          iconBg="bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
          strokeColor="#EF4444"
          sparklineData={data.kpis.totalExpenses.sparkline}
          generateSparkline={generateSparklinePath}
          menuOpen={activeMenuCard === 'expenses'}
          onToggleMenu={() => setActiveMenuCard(activeMenuCard === 'expenses' ? null : 'expenses')}
          onViewDetails={() => navigate('/dashboard/expenses')}
        />

        {/* Card 4: Total Alerts */}
        <KPICard
          title="Total Alerts"
          value={data.kpis.totalAlerts.value.toString()}
          changePct={data.kpis.totalAlerts.changePercentage}
          icon={Bell}
          iconBg="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
          strokeColor="#8B5CF6"
          sparklineData={data.kpis.totalAlerts.sparkline}
          generateSparkline={generateSparklinePath}
          menuOpen={activeMenuCard === 'alerts'}
          onToggleMenu={() => setActiveMenuCard(activeMenuCard === 'alerts' ? null : 'alerts')}
          onViewDetails={() => navigate('/dashboard/low-stock')}
        />
      </div>

      {/* ── Middle Row: Branch Performance & Sales Overview ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Branch Performance (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                  <Store className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Branch Performance
                </h3>
              </div>
              <span className="px-3 py-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-600">
                Today
              </span>
            </div>

            {!data.branchPerformance.hasActivity ? (
              <div className="py-8 flex flex-col items-center justify-center text-center">
                {/* Illustration SVG for Store Empty State */}
                <div className="w-32 h-32 mb-4 relative flex items-center justify-center">
                  <div className="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 rounded-full blur-xl opacity-60" />
                  <svg viewBox="0 0 120 100" className="w-full h-full relative z-10">
                    <rect x="25" y="40" width="70" height="45" rx="6" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="2" className="dark:fill-gray-700" />
                    <path d="M 20 40 L 60 15 L 100 40 Z" fill="#3B82F6" opacity="0.9" />
                    <rect x="48" y="55" width="24" height="30" fill="#DBEAFE" stroke="#2563EB" strokeWidth="1.5" className="dark:fill-gray-600" />
                    <rect x="52" y="60" width="16" height="8" rx="2" fill="#2563EB" />
                    <text x="60" y="66" textAnchor="middle" fill="#FFFFFF" fontSize="6" fontWeight="bold">CLOSED</text>
                  </svg>
                </div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">
                  No activity for this period
                </h4>
                <p className="text-xs text-gray-400 max-w-xs mb-6">
                  No sales or transactions recorded for the selected time range.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard/sales-reports')}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-xs shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all hover:scale-105"
                >
                  <BarChart3 className="h-4 w-4" />
                  View Reports
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {data.branchPerformance.branches.map(b => (
                  <div key={b.branchId} className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{b.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{b.transactions} transactions</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{formatCurrency(b.sales)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Expenses: {formatCurrency(b.expenses)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Sales Overview Chart (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Sales Overview
              </h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 text-xs font-medium">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                    <span className="text-gray-600 dark:text-gray-300">Sales</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="text-gray-600 dark:text-gray-300">Expenses</span>
                  </div>
                </div>
                <span className="px-3 py-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-600">
                  This Week
                </span>
              </div>
            </div>

            <div className="pt-4">
              {renderSalesOverviewChart()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Row: 3 Columns Grid ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: Top Selling Products */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Top Selling Products
            </h3>
            <span className="px-2.5 py-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400">
              Today
            </span>
          </div>

          {data.topSellingProducts.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400">
              No product sales recorded yet today.
            </div>
          ) : (
            <div className="space-y-4">
              {data.topSellingProducts.map(prod => (
                <div key={prod.id} className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                    <PackageCheck className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {prod.name}
                      </p>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        {prod.sold} sold
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(prod.percentage, 10)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2: Stock Alerts */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Stock Alerts
            </h3>
            <button
              type="button"
              onClick={() => navigate('/dashboard/low-stock')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              View all
            </button>
          </div>

          <div className="space-y-3.5">
            {/* Low stock */}
            <button
              type="button"
              onClick={() => navigate('/dashboard/low-stock')}
              className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 flex items-center justify-between cursor-pointer hover:bg-amber-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-800/40 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Low Stock Items</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Items running low</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300 font-bold text-xs">
                {String(data.stockAlerts.lowStock.count).padStart(2, '0')}
              </span>
            </button>

            {/* Expired products */}
            <button
              type="button"
              onClick={() => navigate('/dashboard/expired')}
              className="p-3.5 rounded-xl bg-rose-50/60 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/30 flex items-center justify-between cursor-pointer hover:bg-rose-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-800/40 text-rose-600 dark:text-rose-400">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Expired Products</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Products past expiry date</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-800/60 text-rose-700 dark:text-rose-300 font-bold text-xs">
                {String(data.stockAlerts.expired.count).padStart(2, '0')}
              </span>
            </button>

            {/* Out of stock */}
            <button
              type="button"
              onClick={() => navigate('/dashboard/inventory-all')}
              className="p-3.5 rounded-xl bg-purple-50/60 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/30 flex items-center justify-between cursor-pointer hover:bg-purple-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-800/40 text-purple-600 dark:text-purple-400">
                  <PackageX className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Out of Stock</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Items out of stock</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-800/60 text-purple-700 dark:text-purple-300 font-bold text-xs">
                {String(data.stockAlerts.outOfStock.count).padStart(2, '0')}
              </span>
            </button>
          </div>
        </div>

        {/* Column 3: Recent Activities */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Recent Activities
            </h3>
            <button
              type="button"
              onClick={() => navigate('/dashboard/activity-logs')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              View all
            </button>
          </div>

          {data.recentActivities.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400">
              No recent activity recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {data.recentActivities.map(act => {
                const getActIcon = () => {
                  switch (act.type) {
                    case 'sale': return <Receipt className="h-4 w-4 text-blue-600" />
                    case 'payment': return <RefreshCw className="h-4 w-4 text-emerald-600" />
                    case 'stock': return <BarChart3 className="h-4 w-4 text-purple-600" />
                    default: return <UserPlus className="h-4 w-4 text-indigo-600" />
                  }
                }

                return (
                  <div key={act.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30">
                        {getActIcon()}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900 dark:text-white">
                          {act.title}
                        </p>
                        {act.subtext && (
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {act.subtext}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-gray-400">
                      {act.timeFormatted}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Sub-component: KPI Card
interface KPICardProps {
  title: string
  value: string
  changePct: number
  icon: React.ElementType
  iconBg: string
  strokeColor: string
  sparklineData: number[]
  generateSparkline: (val: number[]) => { path: string; area: string }
  menuOpen: boolean
  onToggleMenu: () => void
  onViewDetails: () => void
}

const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  changePct,
  icon: Icon,
  iconBg,
  strokeColor,
  sparklineData,
  generateSparkline,
  menuOpen,
  onToggleMenu,
  onViewDetails,
}) => {
  const { path, area } = generateSparkline(sparklineData)

  return (
    <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between overflow-hidden group hover:shadow-md transition-all duration-200">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className={cn('p-2.5 rounded-xl flex items-center justify-center', iconBg)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={onToggleMenu}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 py-1 z-20">
                <button
                  type="button"
                  onClick={onViewDetails}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                >
                  <span>View details</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {title}
        </p>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
          {value}
        </h3>

        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: strokeColor }}>
          <ArrowUpRight className="h-3.5 w-3.5" />
          <span>{changePct >= 0 ? `+${changePct}%` : `${changePct}%`} vs yesterday</span>
        </div>
      </div>

      {/* Sparkline curve at bottom */}
      <div className="mt-4 -mx-5 -mb-5 h-10 relative overflow-hidden">
        <svg viewBox="0 0 200 40" className="w-full h-full preserve-3d" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`grad-${strokeColor}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#grad-${strokeColor})`} />
          <path d={path} fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import {
  Plus, Clock, Banknote, TrendingUp, Smartphone, Wallet, Search, X,
  CheckCircle2, Lock, AlertTriangle, RotateCcw, XCircle, Eye, Receipt,
  ArrowDownCircle, ArrowUpCircle, BadgeCheck, History, Loader2,
} from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../components/ui/select'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '../../../components/ui/drawer'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../../../components/ui/alert-dialog'
import { DataTable, type ColumnDef } from '../../../components/ui/data-table'
import { StatusBadge } from '../../../components/ui/status-badge'
import { Badge } from '../../../components/ui/badge'
import { cn } from '../../../lib/utils'
import { apiClient } from '../../../lib/api-client'
import { useBranch } from '../../../context/BranchContext'
import { useAuth } from '../../../context/AuthContext'

// ── Constants ─────────────────────────────────────────────────────────────────

type ShiftStatus = 'OPEN' | 'CLOSING' | 'PENDING_APPROVAL' | 'CLOSED' | 'REOPENED' | 'CANCELLED'

const STATUS_LABELS: Record<ShiftStatus, string> = {
  OPEN: 'Open',
  REOPENED: 'Reopened',
  CLOSING: 'Closing',
  PENDING_APPROVAL: 'Pending Approval',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

const STATUS_TONES: Record<ShiftStatus, string> = {
  OPEN: 'ACTIVE',
  REOPENED: 'ACTIVE',
  CLOSING: 'PENDING',
  PENDING_APPROVAL: 'PROCESSING',
  CLOSED: 'INACTIVE',
  CANCELLED: 'CANCELLED',
}

const EXPENSE_CATEGORIES = [
  'SALARIES_WAGES', 'RENT', 'UTILITIES', 'TRANSPORT_FUEL', 'MAINTENANCE_REPAIRS',
  'TAXES', 'INSURANCE', 'MARKETING', 'OFFICE_SUPPLIES', 'PROFESSIONAL_FEES', 'OTHER',
] as const

const CATEGORY_LABELS: Record<string, string> = {
  SALARIES_WAGES: 'Salaries & Wages',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  TRANSPORT_FUEL: 'Transport & Fuel',
  MAINTENANCE_REPAIRS: 'Maintenance & Repairs',
  TAXES: 'Taxes',
  INSURANCE: 'Insurance',
  MARKETING: 'Marketing',
  OFFICE_SUPPLIES: 'Office Supplies',
  PROFESSIONAL_FEES: 'Professional Fees',
  OTHER: 'Other',
}

const DENOMINATIONS = [500, 1000, 2000, 5000, 10000, 20000, 50000]

function money(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0))
}

function formatDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits).toLocaleString('en-US') : ''
}

function shiftNumber(shift: Shift) {
  return shift.shiftNumber ?? `Shift #${shift.id}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shift {
  id: number
  shiftNumber?: string | null
  organizationId: number
  branchId: number
  userId: number
  deviceId?: number | null
  openingFloat: number
  openingMobileMoney?: number | null
  openingNotes?: string | null
  status: ShiftStatus
  openedAt: string
  closedAt?: string | null
  closingStartedAt?: string | null
  closingSubmittedAt?: string | null
  expectedCash?: number | null
  actualCash?: number | null
  actualMobileMoney?: number | null
  difference?: number | null
  cashIn?: number | null
  cashOut?: number | null
  expenseTotal?: number | null
  varianceReason?: string | null
  closingNotes?: string | null
  approvalDecision?: string | null
  approvalReason?: string | null
  branch?: { id: number; name: string }
  user?: { id: number; name: string }
  closedBy?: { id: number; name: string } | null
  approvedBy?: { id: number; name: string } | null
  _count?: { sales: number; cashMovements: number; expenses: number }
}

interface ShiftSummary {
  shiftNumber?: string | null
  openingFloat: number
  openingMobileMoney: number
  expectedMobileMoney: number
  grossSales: number
  netSales: number
  cashSales: number
  mobileMoneySales: number
  cardSales: number
  creditSales: number
  returns: number
  discounts: number
  cashIn: number
  cashOut: number
  expenseTotal: number
  expenseCash: number
  expectedCash: number
}

interface DailySummary {
  date: string
  shiftCount: number
  totalSales: number
  cashSales: number
  mobileMoneySales: number
  cardSales: number
  creditSales: number
  expenses: number
  returns: number
  cashIn: number
  cashOut: number
  expectedCash: number
  actualCash: number
  variance: number
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-card border border-gray-200 dark:border-gray-700 shadow-card p-4 flex items-center gap-4 h-full">
      <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
        <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white truncate">{value}</p>
        {sub && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ShiftSummaryPage() {
  const { user } = useAuth()
  const { userBranches, loading: branchesLoading, selectedBranchId, setSelectedBranch } = useBranch()

  const isManager = user?.role === 'ADMIN' || user?.role === 'BRANCH_MANAGER'
  const isAdmin = user?.role === 'ADMIN'

  // Active shift
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeShift, setActiveShift] = useState<Shift | null>(null)
  const [summary, setSummary] = useState<ShiftSummary | null>(null)

  // Open-shift dialog
  const [openDialog, setOpenDialog] = useState(false)
  const [branchId, setBranchId] = useState<number | null>(selectedBranchId)
  const [openingCash, setOpeningCash] = useState('100,000')
  const [openingMobileMoney, setOpeningMobileMoney] = useState('0')
  const [openingNotes, setOpeningNotes] = useState('')

  // Closing reconciliation
  const [actualCash, setActualCash] = useState('')
  const [actualMobileMoney, setActualMobileMoney] = useState('')
  const [varianceReason, setVarianceReason] = useState('')
  const [closingNotes, setClosingNotes] = useState('')
  const [denominations, setDenominations] = useState<Record<string, string>>({})

  // Actions
  const [movementDialog, setMovementDialog] = useState<'CASH_IN' | 'CASH_OUT' | null>(null)
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReason, setMovementReason] = useState('')
  const [expenseDialog, setExpenseDialog] = useState(false)
  const [expenseForm, setExpenseForm] = useState({ category: 'OTHER', amount: '', paymentMethod: 'CASH', description: '' })
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT' | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [reviewShift, setReviewShift] = useState<Shift | null>(null)

  const [confirmAction, setConfirmAction] = useState<{ type: 'REOPEN' | 'CANCEL'; shift: Shift } | null>(null)

  // History
  const [history, setHistory] = useState<{ items: Shift[]; pagination: { totalItems: number; totalPages: number; page: number; limit: number } }>({ items: [], pagination: { totalItems: 0, totalPages: 0, page: 1, limit: 15 } })
  const [historyFilter, setHistoryFilter] = useState<{ status: string; search: string; page: number }>({ status: 'ALL', search: '', page: 1 })
  const [historyLoading, setHistoryLoading] = useState(false)

  const [daily, setDaily] = useState<DailySummary | null>(null)
  const [details, setDetails] = useState<any>(null)

  const isOwnShift = activeShift && String(activeShift.userId) === String(user?.id)
  const pendingForReview = isManager && activeShift?.status === 'PENDING_APPROVAL' && !isOwnShift
  const denominationsTotal = DENOMINATIONS.reduce((sum, d) => sum + (Number(denominations[String(d)] ?? 0) * d), 0)

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadActiveShift = useCallback(async () => {
    setError(null)
    try {
      let shift: Shift | null = null
      try {
        shift = await apiClient.getActiveShift()
      } catch (requestError: any) {
        if (requestError?.response?.status !== 404) throw requestError
      }
      setActiveShift(shift)
      if (shift) {
        const result = await apiClient.getShiftSummary(shift.id)
        setSummary(result.summary ?? null)
        setActualCash(result.summary?.expectedCash != null ? String(result.summary.expectedCash) : '')
      } else {
        setSummary(null)
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to load shift status.')
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const params: Record<string, any> = { page: historyFilter.page, limit: 15 }
      if (historyFilter.status !== 'ALL') params.status = historyFilter.status
      if (historyFilter.search) params.search = historyFilter.search
      setHistory(await apiClient.listShifts(params))
    } catch (requestError: any) {
      console.error('Failed to load shift history:', requestError)
    } finally {
      setHistoryLoading(false)
    }
  }, [historyFilter])

  const loadDaily = useCallback(async () => {
    try {
      setDaily(await apiClient.getDailyShiftSummary({ date: new Date().toISOString().slice(0, 10) }))
    } catch (requestError: any) {
      console.error('Failed to load daily summary:', requestError)
    }
  }, [])

  useEffect(() => { loadActiveShift() }, [loadActiveShift])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => { loadDaily() }, [loadDaily])
  useEffect(() => { if (selectedBranchId) setBranchId(selectedBranchId) }, [selectedBranchId])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleOpen = async () => {
    if (!branchId) {
      setError('Select the branch where you are working.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const shift = await apiClient.openShift({
        openingFloat: Math.max(0, Number(openingCash.replace(/,/g, '')) || 0),
        openingMobileMoney: Math.max(0, Number(openingMobileMoney.replace(/,/g, '')) || 0),
        branchId,
        openingNotes: openingNotes.trim() || undefined,
      })
      setActiveShift(shift)
      setSelectedBranch(shift.branchId)
      setOpenDialog(false)
      setOpeningNotes('')
      toast.success(`${shiftNumber(shift)} opened`)
      const result = await apiClient.getShiftSummary(shift.id)
      setSummary(result.summary ?? null)
      loadDaily()
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to open shift.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleStartClose = async () => {
    if (!activeShift) return
    setBusy(true)
    setError(null)
    try {
      await apiClient.startShiftClose(activeShift.id)
      toast.success('Closing started. Enter the counted cash.')
      await loadActiveShift()
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to start closing.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleSubmitClose = async () => {
    if (!activeShift) return
    const actual = Number(actualCash) || 0
    if (actualCash.trim() === '' || actual < 0) {
      setError('Count the till and enter the actual cash amount.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await apiClient.submitShiftClose(activeShift.id, {
        actualCash: actual,
        actualMobileMoney: actualMobileMoney.trim() ? Number(actualMobileMoney) : undefined,
        varianceReason: varianceReason.trim() || undefined,
        closingNotes: closingNotes.trim() || undefined,
        denominationCounts: Object.keys(denominations).length > 0
          ? Object.fromEntries(Object.entries(denominations).map(([k, v]) => [k, Number(v) || 0]))
          : undefined,
      })
      toast.success(result.needsApproval
        ? `${shiftNumber(activeShift)} submitted for approval.`
        : `${shiftNumber(activeShift)} closed.`)
      setActualCash('')
      setActualMobileMoney('')
      setVarianceReason('')
      setClosingNotes('')
      setDenominations({})
      await loadActiveShift()
      await loadHistory()
      await loadDaily()
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to close shift.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleMovement = async () => {
    if (!activeShift || !movementDialog) return
    const amount = Number(movementAmount) || 0
    if (amount <= 0) {
      setError('Enter a positive amount.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiClient.createCashMovement({
        shiftId: activeShift.id,
        type: movementDialog,
        amount,
        reason: movementReason.trim() || undefined,
      })
      toast.success(movementDialog === 'CASH_IN' ? 'Cash added to till.' : 'Cash removed from till.')
      setMovementDialog(null)
      setMovementAmount('')
      setMovementReason('')
      await loadActiveShift()
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to record movement.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleExpense = async () => {
    if (!activeShift) return
    const amount = Number(expenseForm.amount) || 0
    if (amount <= 0 || !expenseForm.description.trim()) {
      setError('Enter a valid amount and description.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiClient.createExpense({
        category: expenseForm.category,
        amount,
        paymentMethod: expenseForm.paymentMethod,
        description: expenseForm.description.trim(),
        reference: 'Shift',
        expenseDate: new Date().toISOString(),
        shiftId: activeShift.id,
        branchId: activeShift.branchId,
      })
      toast.success('Expense recorded and linked to this shift.')
      setExpenseDialog(false)
      setExpenseForm({ category: 'OTHER', amount: '', paymentMethod: 'CASH', description: '' })
      await loadActiveShift()
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to record expense.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const openReview = (shift: Shift, action: 'APPROVE' | 'REJECT') => {
    setReviewShift(shift)
    setReviewAction(action)
    setReviewReason('')
  }

  const handleReview = async () => {
    if (!reviewShift || !reviewAction) return
    setBusy(true)
    setError(null)
    try {
      if (reviewAction === 'APPROVE') {
        await apiClient.approveShift(reviewShift.id, reviewReason.trim() || undefined)
        toast.success(`${shiftNumber(reviewShift)} approved.`)
      } else {
        await apiClient.rejectShift(reviewShift.id, reviewReason.trim() || undefined)
        toast.success(`${shiftNumber(reviewShift)} rejected. Shift reopened.`)
      }
      setReviewShift(null)
      setReviewAction(null)
      await loadActiveShift()
      await loadHistory()
      await loadDaily()
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to review shift.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleReopen = async (shift: Shift) => {
    setConfirmAction({ type: 'REOPEN', shift })
  }

  const handleCancel = async (shift: Shift) => {
    setConfirmAction({ type: 'CANCEL', shift })
  }

  const runConfirmAction = async () => {
    if (!confirmAction) return
    const { type, shift } = confirmAction
    setBusy(true)
    try {
      if (type === 'REOPEN') {
        await apiClient.reopenShift(shift.id, 'Reopened from shift management')
        toast.success(`${shiftNumber(shift)} reopened.`)
        await loadHistory()
        await loadDaily()
      } else {
        await apiClient.cancelShift(shift.id)
        toast.success(`${shiftNumber(shift)} cancelled.`)
        await loadActiveShift()
        await loadHistory()
      }
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? `Failed to ${type === 'REOPEN' ? 'reopen' : 'cancel'} shift.`
      toast.error(message)
    } finally {
      setBusy(false)
      setConfirmAction(null)
    }
  }

  const openDetails = async (shift: Shift) => {
    setBusy(true)
    try {
      setDetails(await apiClient.getShiftDetails(shift.id))
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to load shift details.'
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  // ── Header action button ────────────────────────────────────────────────────

  const headerAction = !activeShift ? (
    <Button onClick={() => setOpenDialog(true)} className="gap-2 bg-white text-blue-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto">
      <Plus className="h-4 w-4" />
      Open Shift
    </Button>
  ) : activeShift.status === 'OPEN' || activeShift.status === 'REOPENED' ? (
    <Button onClick={handleStartClose} disabled={busy} className="gap-2 bg-white text-blue-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
      Start Closing
    </Button>
  ) : activeShift.status === 'CLOSING' ? (
    <Button onClick={handleSubmitClose} disabled={busy || actualCash.trim() === ''} className="gap-2 bg-white text-blue-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
      Submit Closing
    </Button>
  ) : (
    <Badge className="bg-white/20 text-white border-white/20">
      {STATUS_LABELS[activeShift.status]}
    </Badge>
  )

  // ── History columns ─────────────────────────────────────────────────────────

  const historyColumns: ColumnDef<Shift>[] = [
    {
      key: 'shiftNumber',
      header: 'Shift',
      sortValue: row => row.shiftNumber,
      render: row => <span className="font-semibold text-gray-900 dark:text-white">{shiftNumber(row)}</span>,
    },
    {
      key: 'user',
      header: 'Cashier',
      sortValue: row => row.user?.name,
      render: row => row.user?.name ?? `#${row.userId}`,
    },
    {
      key: 'branch',
      header: 'Branch',
      sortValue: row => row.branch?.name,
      render: row => row.branch?.name ?? `#${row.branchId}`,
    },
    {
      key: 'openedAt',
      header: 'Opened',
      sortValue: row => new Date(row.openedAt).getTime(),
      render: row => (
        <span className="text-gray-600 dark:text-gray-300">
          {new Date(row.openedAt).toLocaleDateString()} {new Date(row.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'closedAt',
      header: 'Closed',
      sortValue: row => row.closedAt ? new Date(row.closedAt).getTime() : 0,
      render: row => row.closedAt
        ? `${new Date(row.closedAt).toLocaleDateString()} ${new Date(row.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : <span className="text-gray-400">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: row => row.status,
      render: row => <StatusBadge status={STATUS_TONES[row.status]} label={STATUS_LABELS[row.status]} />,
    },
    {
      key: 'sales',
      header: 'Sales',
      sortValue: row => row._count?.sales ?? 0,
      render: row => row._count?.sales ?? 0,
      className: 'tabular-nums',
    },
    {
      key: 'expectedCash',
      header: 'Expected',
      sortValue: row => row.expectedCash ?? 0,
      render: row => row.expectedCash != null ? `${money(row.expectedCash)} RWF` : <span className="text-gray-400">—</span>,
      className: 'tabular-nums',
    },
    {
      key: 'difference',
      header: 'Variance',
      sortValue: row => row.difference ?? 0,
      render: row => row.difference != null
        ? <span className={cn('tabular-nums font-medium', row.difference === 0 ? 'text-emerald-600' : 'text-amber-600')}>{money(row.difference)} RWF</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-40',
      render: row => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openDetails(row)} className="p-1 rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Details">
            <Eye className="h-3.5 w-3.5" />
          </button>
          {isAdmin && row.status === 'CLOSED' && (
            <button type="button" onClick={() => handleReopen(row)} className="p-1 rounded text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors" title="Reopen">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {isAdmin && (row.status === 'OPEN' || row.status === 'REOPENED') && (
            <button type="button" onClick={() => handleCancel(row)} className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Cancel">
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ]

  const hasHistoryFilters = historyFilter.status !== 'ALL' || historyFilter.search !== ''
  const clearHistoryFilters = () => setHistoryFilter({ status: 'ALL', search: '', page: 1 })

  const activeBranch = userBranches.find((b) => b.id === (activeShift?.branchId ?? branchId))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <Clock className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Shift Summary</h1>
              <p className="text-sm text-white/70 mt-0.5">
                Open, manage, reconcile and review shifts for your branch.
              </p>
            </div>
          </div>
          {headerAction}
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* KPI row */}
      {activeShift && summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Banknote} label="Expected Cash" value={`${money(summary.expectedCash)} RWF`} sub="float + sales ± movements" color="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" />
          <KpiCard icon={TrendingUp} label="Cash Sales" value={`${money(summary.cashSales)} RWF`} sub={`${money(summary.netSales)} RWF net sales`} color="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" />
          <KpiCard icon={Smartphone} label="Mobile Money" value={`${money(summary.mobileMoneySales)} RWF`} sub={`${money(summary.expectedMobileMoney)} RWF expected`} color="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400" />
          <KpiCard
            icon={activeShift.difference === 0 ? CheckCircle2 : AlertTriangle}
            label="Variance"
            value={`${money(activeShift.difference ?? 0)} RWF`}
            sub={activeShift.difference === 0 ? 'No variance' : (activeShift.varianceReason ?? 'Counted vs expected')}
            color={activeShift.difference === 0
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}
          />
        </div>
      ) : daily ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={TrendingUp} label="Today's Sales" value={`${money(daily.totalSales)} RWF`} sub={`${daily.shiftCount} closed shift${daily.shiftCount !== 1 ? 's' : ''}`} color="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" />
          <KpiCard icon={Banknote} label="Cash Sales" value={`${money(daily.cashSales)} RWF`} sub={`${money(daily.mobileMoneySales)} RWF mobile`} color="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" />
          <KpiCard icon={Wallet} label="Expenses" value={`${money(daily.expenses)} RWF`} sub={`${money(daily.returns)} RWF returns`} color="bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400" />
          <KpiCard
            icon={daily.variance === 0 ? CheckCircle2 : AlertTriangle}
            label="Variance"
            value={`${money(daily.variance)} RWF`}
            sub="across closed shifts"
            color={daily.variance === 0
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}
          />
        </div>
      ) : null}

      {/* No active shift → clear call to action */}
      {!activeShift && (
        <div className="bg-white dark:bg-gray-800 rounded-card border border-dashed border-gray-300 dark:border-gray-600 shadow-card px-6 py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-900/20">
            <Clock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">No active shift</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
            Open a shift to start tracking sales and till movements for the day.
          </p>
          <Button onClick={() => setOpenDialog(true)} className="mt-4 gap-2 bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Open Shift
          </Button>
        </div>
      )}

      {/* Active shift panel */}
      {activeShift && (
        <div className="bg-white dark:bg-gray-800 rounded-card border border-gray-200 dark:border-gray-700 shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <h2 className="font-semibold text-gray-900 dark:text-white">{shiftNumber(activeShift)}</h2>
              <StatusBadge status={STATUS_TONES[activeShift.status]} label={STATUS_LABELS[activeShift.status]} />
            </div>
            <p className="w-full sm:ml-auto sm:w-auto text-xs text-gray-500 dark:text-gray-400 sm:text-right">
              {activeBranch?.name ?? `Branch #${activeShift.branchId}`} · Cashier: {activeShift.user?.name ?? `#${activeShift.userId}`} · Opened {new Date(activeShift.openedAt).toLocaleString()}
              {activeShift.closedAt ? ` · Closed ${new Date(activeShift.closedAt).toLocaleString()}` : ''}
            </p>
          </div>

          <div className="p-5 space-y-5">
            {summary && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <KpiCard icon={Wallet} label="Opening Cash" value={`${money(summary.openingFloat)} RWF`} color="bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300" />
                <KpiCard icon={Smartphone} label="Opening Mobile" value={`${money(summary.openingMobileMoney)} RWF`} color="bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300" />
                <KpiCard icon={ArrowUpCircle} label="Cash In" value={`${money(summary.cashIn)} RWF`} color="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" />
                <KpiCard icon={ArrowDownCircle} label="Cash Out" value={`${money(summary.cashOut)} RWF`} color="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" />
                <KpiCard icon={Receipt} label="Expenses" value={`${money(summary.expenseTotal)} RWF`} color="bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400" />
                <KpiCard icon={History} label="Transactions" value={String(activeShift._count?.sales ?? 0)} color="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" />
              </div>
            )}

            {(activeShift.status === 'OPEN' || activeShift.status === 'REOPENED') && (
              <div className="flex flex-wrap gap-2 border-t border-gray-100 dark:border-gray-700 pt-4">
                <Button variant="outline" onClick={() => setMovementDialog('CASH_IN')} disabled={busy}>
                  <Plus className="h-4 w-4 text-emerald-600" /> Cash In
                </Button>
                <Button variant="outline" onClick={() => setMovementDialog('CASH_OUT')} disabled={busy}>
                  <ArrowDownCircle className="h-4 w-4 text-red-600" /> Cash Out
                </Button>
                <Button variant="outline" onClick={() => setExpenseDialog(true)} disabled={busy}>
                  <Receipt className="h-4 w-4 text-blue-600" /> Record Expense
                </Button>
              </div>
            )}

            {activeShift.status === 'CLOSING' && (
              <div className="space-y-4 rounded-card border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 p-4">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <Lock className="h-5 w-5" />
                  <p className="text-sm font-semibold">Reconcile the till. Sales are locked during closing.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="actual-cash">Actual Cash (RWF)</Label>
                    <Input
                      id="actual-cash"
                      value={actualCash}
                      onChange={(e) => setActualCash(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="Counted cash"
                      inputMode="decimal"
                    />
                    {summary && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Expected: {money(summary.expectedCash)} RWF
                        {actualCash.trim() ? (
                          <span className={Number(actualCash) - summary.expectedCash === 0 ? ' text-emerald-600' : ' text-amber-600'}>
                            {' '}· Variance: {money(Number(actualCash) - summary.expectedCash)} RWF
                          </span>
                        ) : null}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="actual-mobile">Actual Mobile Money (RWF)</Label>
                    <Input
                      id="actual-mobile"
                      value={actualMobileMoney}
                      onChange={(e) => setActualMobileMoney(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder={summary ? `Expected: ${money(summary.expectedMobileMoney)}` : 'Optional'}
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Denomination Count (optional)</Label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    {DENOMINATIONS.map((denom) => (
                      <div key={denom} className="space-y-1">
                        <Input
                          value={denominations[String(denom)] ?? ''}
                          onChange={(e) => setDenominations((prev) => ({ ...prev, [String(denom)]: e.target.value.replace(/\D/g, '') }))}
                          placeholder={money(denom)}
                          inputMode="numeric"
                        />
                        <p className="text-center text-[11px] text-gray-500">{money(denom)}</p>
                      </div>
                    ))}
                  </div>
                  {denominationsTotal > 0 && (
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      Counted total: {money(denominationsTotal)} RWF
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="variance-reason">Variance Reason (if any)</Label>
                    <Input
                      id="variance-reason"
                      value={varianceReason}
                      onChange={(e) => setVarianceReason(e.target.value)}
                      placeholder="Why does the cash differ?"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="closing-notes">Closing Notes</Label>
                    <Input
                      id="closing-notes"
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                      placeholder="Optional notes"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeShift.status === 'PENDING_APPROVAL' && (
              <div className="space-y-4 rounded-card border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10 p-4">
                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                  <AlertTriangle className="h-5 w-5" />
                  <p className="text-sm font-semibold">This closing is pending manager approval.</p>
                </div>
                {pendingForReview && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => openReview(activeShift, 'APPROVE')} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                      <BadgeCheck className="h-4 w-4" /> Approve
                    </Button>
                    <Button variant="destructive" onClick={() => openReview(activeShift, 'REJECT')} disabled={busy}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                )}
                {isOwnShift && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Waiting for a manager to review your closing.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shift history */}
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <History className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Shift History
        </h2>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-card border border-gray-200 dark:border-gray-700 shadow-card p-4 flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={historyFilter.search}
              onChange={e => setHistoryFilter(prev => ({ ...prev, search: e.target.value, page: 1 }))}
              placeholder="Search shift number or cashier…"
              className="pl-9"
            />
          </div>
          <div className="w-44">
            <Select value={historyFilter.status} onValueChange={v => setHistoryFilter(prev => ({ ...prev, status: v, page: 1 }))}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                {(Object.keys(STATUS_LABELS) as ShiftStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasHistoryFilters && (
            <button type="button" onClick={clearHistoryFilters} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {/* Table */}
        <DataTable
          columns={historyColumns}
          data={history.items}
          keyExtractor={row => row.id}
          isLoading={historyLoading}
          skeletonRows={8}
          emptyTitle="No shifts found"
          emptyMessage={activeShift ? 'Your shift history appears here.' : 'Open your first shift above.'}
          emptyIcon={<Clock className="h-10 w-10" />}
          page={history.pagination.page}
          pageSize={history.pagination.limit}
          total={history.pagination.totalItems}
          onPageChange={p => setHistoryFilter(prev => ({ ...prev, page: p }))}
        />
      </div>

      {/* Open shift drawer */}
      <Drawer open={openDialog} onOpenChange={setOpenDialog}>
        <DrawerContent className="sm:max-w-lg">
          <DrawerHeader>
            <DrawerTitle>Open Shift</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Branch <span className="text-red-500">*</span></Label>
              <Select value={branchId ? String(branchId) : undefined} onValueChange={v => setBranchId(Number(v))} disabled={branchesLoading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={branchesLoading ? 'Loading branches…' : 'Select branch'} />
                </SelectTrigger>
                <SelectContent>
                  {userBranches.map(branch => (
                    <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Cashier</Label>
              <Input value={user?.name ?? ''} readOnly className="bg-gray-50 dark:bg-gray-700" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-600" /> Opening Cash (RWF)
                </Label>
                <Input value={openingCash} onChange={e => setOpeningCash(formatDigits(e.target.value))} placeholder="0" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-violet-600" /> Opening Mobile Money (RWF)
                </Label>
                <Input value={openingMobileMoney} onChange={e => setOpeningMobileMoney(formatDigits(e.target.value))} placeholder="0" inputMode="numeric" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Opening Notes <span className="text-gray-400 text-xs">(optional)</span></Label>
              <Textarea value={openingNotes} onChange={e => setOpeningNotes(e.target.value)} placeholder="Anything notable at the start of the shift" rows={2} />
            </div>
          </div>
          <DrawerFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleOpen} disabled={!branchId || busy} className="bg-blue-600 hover:bg-blue-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Open Shift
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Cash movement dialog */}
      <Dialog open={movementDialog !== null} onOpenChange={(open) => !open && setMovementDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{movementDialog === 'CASH_IN' ? 'Cash In' : 'Cash Out'}</DialogTitle>
            <DialogDescription>
              {movementDialog === 'CASH_IN'
                ? 'Add cash to the till (e.g. loan repayment, float top-up).'
                : 'Remove cash from the till (e.g. petty cash withdrawal, float taken out).'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (RWF)</Label>
              <Input value={movementAmount} onChange={e => setMovementAmount(formatDigits(e.target.value))} placeholder="0" inputMode="numeric" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Input value={movementReason} onChange={e => setMovementReason(e.target.value)} placeholder="Why is this movement happening?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialog(null)} disabled={busy}>Cancel</Button>
            <Button
              onClick={handleMovement}
              disabled={busy || Number(movementAmount) <= 0}
              className={movementDialog === 'CASH_IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : movementDialog === 'CASH_IN' ? <Plus className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
              Confirm {movementDialog === 'CASH_IN' ? 'Cash In' : 'Cash Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense dialog */}
      <Dialog open={expenseDialog} onOpenChange={(open) => !open && setExpenseDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Expense on this Shift</DialogTitle>
            <DialogDescription>Expenses linked to the shift affect the expected cash reconciliation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={expenseForm.category} onValueChange={(v) => setExpenseForm(prev => ({ ...prev, category: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={expenseForm.paymentMethod} onValueChange={(v) => setExpenseForm(prev => ({ ...prev, paymentMethod: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="MOBILE_MONEY">Mobile Money</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Amount (RWF)</Label>
              <Input value={expenseForm.amount} onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: formatDigits(e.target.value) }))} placeholder="0" inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={expenseForm.description} onChange={(e) => setExpenseForm(prev => ({ ...prev, description: e.target.value }))} placeholder="What was purchased / paid for?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseDialog(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleExpense} disabled={busy || Number(expenseForm.amount) <= 0 || !expenseForm.description.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Record Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve / reject dialog */}
      <Dialog open={reviewShift !== null} onOpenChange={(open) => !open && setReviewShift(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewAction === 'APPROVE' ? 'Approve Shift Closing' : 'Reject Shift Closing'}</DialogTitle>
            <DialogDescription>
              {reviewShift && <> {shiftNumber(reviewShift)} · Variance {reviewShift.difference != null ? `${money(reviewShift.difference)} RWF` : '—'} </>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{reviewAction === 'APPROVE' ? 'Approval reason (optional)' : 'Rejection reason (required)'}</Label>
            <Input value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder={reviewAction === 'REJECT' ? 'Explain why the closing was rejected' : 'Optional note'} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewShift(null)} disabled={busy}>Cancel</Button>
            <Button
              onClick={handleReview}
              disabled={busy || (reviewAction === 'REJECT' && !reviewReason.trim())}
              className={reviewAction === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : reviewAction === 'APPROVE' ? <BadgeCheck className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {reviewAction === 'APPROVE' ? 'Approve Closing' : 'Reject Closing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shift details dialog */}
      <Dialog open={details !== null} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Shift Details — {details?.shift ? shiftNumber(details.shift) : ''}</DialogTitle>
            <DialogDescription>
              {details?.shift && (
                <>
                  Cashier: {details.shift.user?.name} · {details.shift.branch?.name} · Opened {new Date(details.shift.openedAt).toLocaleString()}
                  {details.shift.closedAt ? ` · Closed ${new Date(details.shift.closedAt).toLocaleString()}` : ''}
                  {details.shift.closedBy ? ` · Closed by ${details.shift.closedBy.name}` : ''}
                  {details.shift.approvedBy ? ` · Approved by ${details.shift.approvedBy.name}` : ''}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {details && (
            <div className="space-y-4 overflow-y-auto max-h-[65vh] pr-1">
              {details.summary && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KpiCard icon={Wallet} label="Opening Cash" value={`${money(details.summary.openingFloat)} RWF`} color="bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300" />
                  <KpiCard icon={TrendingUp} label="Cash Sales" value={`${money(details.summary.cashSales)} RWF`} color="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" />
                  <KpiCard icon={Smartphone} label="Mobile Money" value={`${money(details.summary.mobileMoneySales)} RWF`} color="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400" />
                  <KpiCard
                    icon={Number(details.shift.difference) === 0 ? CheckCircle2 : AlertTriangle}
                    label="Variance"
                    value={`${money(details.shift.difference)} RWF`}
                    color={Number(details.shift.difference) === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}
                  />
                </div>
              )}

              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Transactions ({details.transactions?.length ?? 0})
                </h4>
                {details.transactions?.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700/40 text-xs text-gray-500 dark:text-gray-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Number</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                          <th className="px-3 py-2 text-right font-medium">Cash</th>
                          <th className="px-3 py-2 text-right font-medium">Mobile</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {details.transactions.map((tx: any) => (
                          <tr key={tx.id}>
                            <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{tx.saleNumber}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{tx.status}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{money(tx.totalAmount)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{money(tx.cashAmount)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                              {money(tx.salePayments?.filter((p: any) => p.paymentMethod === 'MTN_MOMO' || p.paymentMethod === 'AIRTEL_MONEY').reduce((s: number, p: any) => s + Number(p.amount), 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No transactions on this shift.</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Cash Movements ({details.cashMovements?.length ?? 0})
                  </h4>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                    {details.cashMovements?.length > 0 ? (
                      details.cashMovements.map((m: any) => (
                        <div key={m.id} className="flex items-center justify-between rounded bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-sm">
                          <span className={m.type === 'CASH_IN' ? 'text-emerald-600' : 'text-red-600'}>
                            {m.type === 'CASH_IN' ? 'In' : 'Out'} · {money(m.amount)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{m.reason ?? ''}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">No cash movements.</p>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Expenses ({details.expenses?.length ?? 0})
                  </h4>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                    {details.expenses?.length > 0 ? (
                      details.expenses.map((e: any) => (
                        <div key={e.id} className="flex items-center justify-between rounded bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-sm">
                          <span className="text-gray-700 dark:text-gray-200">{CATEGORY_LABELS[e.category] ?? e.category} · {money(e.amount)}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{e.paymentMethod}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">No expenses on this shift.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetails(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen / Cancel confirmation */}
      <AlertDialog open={confirmAction !== null} onOpenChange={open => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'REOPEN' ? 'Reopen shift?' : 'Cancel shift?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'REOPEN'
                ? `${confirmAction ? shiftNumber(confirmAction.shift) : ''} will be returned to an active state.`
                : `${confirmAction ? shiftNumber(confirmAction.shift) : ''} will be cancelled. Only shifts with no transactions can be cancelled.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={confirmAction?.type === 'CANCEL' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}
              onClick={runConfirmAction}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmAction?.type === 'REOPEN' ? 'Reopen' : 'Cancel'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default ShiftSummaryPage
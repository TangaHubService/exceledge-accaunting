import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Plus, Receipt, DollarSign, TrendingDown, Search, Trash2, Pencil, X,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { apiClient } from '../../../lib/api-client'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../components/ui/select'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '../../../components/ui/drawer'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../../../components/ui/alert-dialog'
import { DataTable, type ColumnDef } from '../../../components/ui/data-table'
import type { SortDir } from '../../../components/ui/data-table'
import { StatusBadge } from '../../../components/ui/status-badge'
import { cn } from '../../../lib/utils'
import { useBranch } from '../../../context/BranchContext'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'SALARIES_WAGES', 'RENT', 'UTILITIES', 'TRANSPORT_FUEL',
  'MAINTENANCE_REPAIRS', 'TAXES', 'INSURANCE', 'MARKETING',
  'OFFICE_SUPPLIES', 'PROFESSIONAL_FEES', 'OTHER',
] as const

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT_CARD'] as const

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

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile Money',
  BANK_TRANSFER: 'Bank Transfer',
  CREDIT_CARD: 'Credit Card',
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', minimumFractionDigits: 0 }).format(n)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Expense {
  id: number
  category: string
  amount: number
  paymentMethod: string
  description: string
  reference?: string
  expenseDate: string
  notes?: string
  branchId: number
  user?: { name: string; email: string }
}

interface ExpenseForm {
  category: string
  otherCategory: string
  amount: string
  paymentMethod: string
  description: string
  reference: string
  expenseDate: string
  notes: string
}

const EMPTY_FORM: ExpenseForm = {
  category: '',
  otherCategory: '',
  amount: '',
  paymentMethod: 'CASH',
  description: '',
  reference: '',
  expenseDate: format(new Date(), 'yyyy-MM-dd'),
  notes: '',
}

// ── ExpenseFormDialog ─────────────────────────────────────────────────────────

function ExpenseFormDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Expense | null
  onSave: (data: ExpenseForm) => Promise<void>
}) {
  const [form, setForm] = useState<ExpenseForm>(
    initial
      ? {
          category: initial.category,
          otherCategory: '',
          amount: String(initial.amount),
          paymentMethod: initial.paymentMethod,
          description: initial.description,
          reference: initial.reference ?? '',
          expenseDate: format(new Date(initial.expenseDate), 'yyyy-MM-dd'),
          notes: initial.notes ?? '',
        }
      : { ...EMPTY_FORM },
  )
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<ExpenseForm>>({})

  const set = (k: keyof ExpenseForm, v: string) => {
    setForm(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(p => ({ ...p, [k]: '' }))
  }

  const isOtherCategory = form.category === 'OTHER'

  const validate = () => {
    const e: Partial<ExpenseForm> = {}
    if (!form.category) e.category = 'Required'
    if (isOtherCategory && !form.otherCategory.trim()) e.otherCategory = 'Please specify the category'
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) e.amount = 'Enter a valid amount'
    if (!form.paymentMethod) e.paymentMethod = 'Required'
    if (!form.description.trim()) e.description = 'Required'
    if (!form.expenseDate) e.expenseDate = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      await onSave(form)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-lg">
        <DrawerHeader>
          <DrawerTitle>{initial ? 'Edit Expense' : 'Record Expense'}</DrawerTitle>
        </DrawerHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="grid grid-cols-2 gap-4">
            {/* Category */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Category <span className="text-red-500">*</span></Label>
              <Select value={form.category} onValueChange={v => set('category', v)}>
                <SelectTrigger className={cn(errors.category && 'border-red-400')}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-xs text-red-500">{errors.category}</p>}
              {isOtherCategory && (
                <>
                  <Input
                    value={form.otherCategory}
                    onChange={e => set('otherCategory', e.target.value)}
                    placeholder="Specify the category"
                    className={cn('mt-1.5', errors.otherCategory && 'border-red-400')}
                  />
                  {errors.otherCategory && <p className="text-xs text-red-500">{errors.otherCategory}</p>}
                </>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Amount (RWF) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min={0}
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                placeholder="0"
                className={cn(errors.amount && 'border-red-400')}
              />
              {errors.amount && <p className="text-xs text-red-500">{errors.amount}</p>}
            </div>

            {/* Payment method */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Payment Method <span className="text-red-500">*</span></Label>
              <Select value={form.paymentMethod} onValueChange={v => set('paymentMethod', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => (
                    <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Expense Date <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={form.expenseDate}
                onChange={e => set('expenseDate', e.target.value)}
                className={cn(errors.expenseDate && 'border-red-400')}
              />
              {errors.expenseDate && <p className="text-xs text-red-500">{errors.expenseDate}</p>}
            </div>

            {/* Description */}
            <div className="space-y-1.5 col-span-2">
              <Label>Description <span className="text-red-500">*</span></Label>
              <Input
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Brief description of the expense"
                className={cn(errors.description && 'border-red-400')}
              />
              {errors.description && <p className="text-xs text-red-500">{errors.description}</p>}
            </div>

            {/* Reference */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Reference <span className="text-gray-400 text-xs">(optional)</span></Label>
              <Input
                value={form.reference}
                onChange={e => set('reference', e.target.value)}
                placeholder="Invoice / receipt #"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Notes <span className="text-gray-400 text-xs">(optional)</span></Label>
              <Input
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Additional notes"
              />
            </div>
          </div>

          <DrawerFooter className="flex-row pt-2 px-0 border-t border-gray-100 dark:border-gray-700">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Record Expense'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-card border border-gray-200 dark:border-gray-700 shadow-card p-4 flex items-center gap-4">
      <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
        <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white truncate">{value}</p>
        {sub && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const qc = useQueryClient()
  const { selectedBranchId } = useBranch()

  // Filters
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [methodFilter, setMethodFilter] = useState('ALL')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [sortBy, setSortBy] = useState('expenseDate')
  const [sortOrder, setSortOrder] = useState<SortDir>('desc')

  // UI state
  const [formOpen, setFormOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const PAGE_SIZE = 20

  const queryParams = {
    page: String(page),
    limit: String(PAGE_SIZE),
    sortBy,
    sortOrder: sortOrder ?? 'desc',
    ...(categoryFilter !== 'ALL' && { category: categoryFilter }),
    ...(methodFilter !== 'ALL' && { paymentMethod: methodFilter }),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(selectedBranchId && { branchId: String(selectedBranchId) }),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', queryParams],
    queryFn: () => apiClient.getExpenses(queryParams),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  })

  const expenses: Expense[] = data?.expenses ?? []
  const total: number = data?.pagination?.totalItems ?? 0
  const summary = data?.summary ?? { totalExpenses: 0, count: 0 }

  // Client-side search filter (server search not supported — filter locally on name)
  const filtered = search
    ? expenses.filter(e =>
        e.description.toLowerCase().includes(search.toLowerCase()) ||
        (e.reference ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : expenses

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.createExpense(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense recorded') },
    onError: () => toast.error('Failed to record expense'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiClient.updateExpense(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense updated') },
    onError: () => toast.error('Failed to update expense'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteExpense(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense deleted') },
    onError: () => toast.error('Failed to delete expense'),
  })

  const handleSave = useCallback(async (form: ExpenseForm) => {
    const notes = form.category === 'OTHER' && form.otherCategory.trim()
      ? `[Other category: ${form.otherCategory.trim()}] ${form.notes}`.trim()
      : form.notes
    const payload = {
      category: form.category,
      amount: parseFloat(form.amount),
      paymentMethod: form.paymentMethod,
      description: form.description,
      reference: form.reference || undefined,
      expenseDate: form.expenseDate,
      notes: notes || undefined,
      ...(selectedBranchId && { branchId: selectedBranchId }),
    }
    if (editingExpense) {
      await updateMutation.mutateAsync({ id: editingExpense.id, data: payload })
    } else {
      await createMutation.mutateAsync(payload)
    }
    setEditingExpense(null)
  }, [editingExpense, createMutation, updateMutation, selectedBranchId])

  const openCreate = () => { setEditingExpense(null); setFormOpen(true) }
  const openEdit = (e: Expense) => { setEditingExpense(e); setFormOpen(true) }

  // Table column definitions
  const columns: ColumnDef<Expense>[] = [
    {
      key: 'expenseDate',
      header: 'Date',
      sortable: true,
      className: 'whitespace-nowrap text-xs text-gray-500 dark:text-gray-400',
      render: row => format(new Date(row.expenseDate), 'dd MMM yyyy'),
    },
    {
      key: 'category',
      header: 'Category',
      sortValue: row => CATEGORY_LABELS[row.category] ?? row.category,
      render: row => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
          {CATEGORY_LABELS[row.category] ?? row.category}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      className: 'max-w-[240px]',
      render: row => (
        <span className="text-sm text-gray-900 dark:text-white truncate block max-w-[240px]" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      sortValue: row => METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
      render: row => (
        <StatusBadge status={row.paymentMethod} label={METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod} />
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: row => (
        <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
    {
      key: 'user',
      header: 'Recorded By',
      sortValue: row => row.user?.name,
      className: 'text-xs text-gray-500 dark:text-gray-400',
      render: row => row.user?.name ?? '—',
    },
    {
      key: 'actions',
      header: '',
      className: 'w-16',
      render: row => (
        <div className="flex items-center gap-1 justify-end">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); openEdit(row) }}
            className="p-1 rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setDeletingId(row.id) }}
            className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]

  const clearFilters = () => {
    setCategoryFilter('ALL')
    setMethodFilter('ALL')
    setStartDate('')
    setEndDate('')
    setSearch('')
    setPage(1)
  }

  const hasFilters = categoryFilter !== 'ALL' || methodFilter !== 'ALL' || startDate || endDate || search

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <TrendingDown className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
              <p className="text-sm text-white/70 mt-0.5">
                Track and manage operational expenses across your branches.
              </p>
            </div>
          </div>
          <Button
            onClick={openCreate}
            className="gap-2 bg-white text-amber-700 hover:bg-white/90 font-semibold shadow-sm self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Record Expense
          </Button>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon={TrendingDown}
          label="Total Expenses"
          value={formatCurrency(summary.totalExpenses)}
          sub={`${summary.count} transaction${summary.count !== 1 ? 's' : ''}`}
          color="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
        />
        <KpiCard
          icon={Receipt}
          label="This Page"
          value={String(filtered.length)}
          sub="matching records"
          color="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
        />
        <KpiCard
          icon={DollarSign}
          label="Page Total"
          value={formatCurrency(filtered.reduce((s, e) => s + Number(e.amount), 0))}
          sub="sum of visible rows"
          color="bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
        />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-card border border-gray-200 dark:border-gray-700 shadow-card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search description or reference…"
              className="pl-9"
            />
          </div>

          {/* Category */}
          <div className="w-44">
            <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Method */}
          <div className="w-40">
            <Select value={methodFilter} onValueChange={v => { setMethodFilter(v); setPage(1) }}>
              <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Methods</SelectItem>
                {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1) }}
              className="w-36"
              placeholder="From"
            />
            <span className="text-gray-400 text-sm">–</span>
            <Input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1) }}
              className="w-36"
              placeholder="To"
            />
          </div>

          {/* Clear */}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filtered}
        keyExtractor={row => row.id}
        isLoading={isLoading}
        skeletonRows={8}
        emptyTitle="No expenses found"
        emptyMessage="Record your first expense using the button above."
        emptyIcon={<TrendingDown className="h-10 w-10" />}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={p => setPage(p)}
        sortKey={sortBy}
        sortDir={sortOrder}
        onSort={(key, direction) => {
          setSortBy(direction ? key : 'expenseDate')
          setSortOrder(direction ?? 'desc')
          setPage(1)
        }}
        onRowClick={openEdit}
      />

      {/* Form dialog */}
      <ExpenseFormDialog
        key={editingExpense?.id ?? 'new'}
        open={formOpen}
        onOpenChange={v => { setFormOpen(v); if (!v) setEditingExpense(null) }}
        initial={editingExpense}
        onSave={handleSave}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={open => { if (!open) setDeletingId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The expense record will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deletingId !== null) {
                  deleteMutation.mutate(deletingId)
                  setDeletingId(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Banknote, Plus, Users, CalendarDays, Wallet, Landmark, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'react-toastify'
import { apiClient } from '../../../lib/api-client'
import { useAuth } from '../../../context/AuthContext'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '../../../components/ui/drawer'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../../../components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../components/ui/tabs'
import { DataTable, type ColumnDef } from '../../../components/ui/data-table'
import { StatusBadge } from '../../../components/ui/status-badge'
import { cn } from '../../../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentMethod = 'BANK' | 'CASH' | 'MOBILE_MONEY'

interface Employee {
  id: number
  employeeNumber: string
  fullName: string
  nationalId: string | null
  rssbNumber: string | null
  jobTitle: string | null
  email: string | null
  phone: string | null
  hireDate: string | null
  basicSalary: string | number
  housingAllowance: string | number
  transportAllowance: string | number
  otherAllowance: string | number
  paymentMethod: PaymentMethod
  bankName: string | null
  bankAccount: string | null
  status: 'ACTIVE' | 'INACTIVE'
}

interface PayrollRun {
  id: number
  periodYear: number
  periodMonth: number
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED'
  employeeCount: number
  grossPay: string | number
  paye: string | number
  employeeRssb: string | number
  employerRssb: string | number
  cbhi: string | number
  netPay: string | number
  employerCost: string | number
  rulesVersion: string
  approvedAt: string | null
  paidAt: string | null
  paymentMethod: PaymentMethod | null
  payslips?: Payslip[]
}

interface PayslipFigures {
  grossPay: number
  contributionBase: number
  paye: number
  employeePension: number
  employerPension: number
  occupationalHazard: number
  employeeMaternity: number
  employerMaternity: number
  cbhi: number
  netPay: number
  employerCost: number
}

interface Payslip extends Record<keyof PayslipFigures, string | number> {
  id: number
  employee: Employee
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<PaymentMethod, string> = { BANK: 'Bank transfer', CASH: 'Cash', MOBILE_MONEY: 'Mobile money' }

function rwf(n: string | number | null | undefined) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(n ?? 0))
}

function periodLabel(run: Pick<PayrollRun, 'periodYear' | 'periodMonth'>) {
  return format(new Date(run.periodYear, run.periodMonth - 1, 1), 'MMMM yyyy')
}

function errorMessage(e: unknown, fallback: string) {
  return (e as Error)?.message || fallback
}

function Kpi({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color: string }) {
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

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex justify-between py-1 text-sm', strong && 'font-semibold border-t border-gray-100 dark:border-gray-700 mt-1 pt-2', muted && 'text-gray-500')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

// ── Employee drawer ───────────────────────────────────────────────────────────

type EmployeeForm = Record<
  'employeeNumber' | 'fullName' | 'nationalId' | 'rssbNumber' | 'jobTitle' | 'email' | 'phone' | 'hireDate' |
  'basicSalary' | 'housingAllowance' | 'transportAllowance' | 'otherAllowance' | 'bankName' | 'bankAccount',
  string
> & { paymentMethod: PaymentMethod; status: 'ACTIVE' | 'INACTIVE' }

function toForm(e?: Employee | null): EmployeeForm {
  return {
    employeeNumber: e?.employeeNumber ?? '',
    fullName: e?.fullName ?? '',
    nationalId: e?.nationalId ?? '',
    rssbNumber: e?.rssbNumber ?? '',
    jobTitle: e?.jobTitle ?? '',
    email: e?.email ?? '',
    phone: e?.phone ?? '',
    hireDate: e?.hireDate ? e.hireDate.slice(0, 10) : '',
    basicSalary: e ? String(Number(e.basicSalary)) : '',
    housingAllowance: e ? String(Number(e.housingAllowance)) : '0',
    transportAllowance: e ? String(Number(e.transportAllowance)) : '0',
    otherAllowance: e ? String(Number(e.otherAllowance)) : '0',
    bankName: e?.bankName ?? '',
    bankAccount: e?.bankAccount ?? '',
    paymentMethod: e?.paymentMethod ?? 'BANK',
    status: e?.status ?? 'ACTIVE',
  }
}

function EmployeeDrawer({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial: Employee | null }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<EmployeeForm>(() => toForm(initial))
  const set = <K extends keyof EmployeeForm>(k: K, v: EmployeeForm[K]) => setForm(f => ({ ...f, [k]: v }))

  const pay = {
    basicSalary: Number(form.basicSalary) || 0,
    housingAllowance: Number(form.housingAllowance) || 0,
    transportAllowance: Number(form.transportAllowance) || 0,
    otherAllowance: Number(form.otherAllowance) || 0,
  }
  const preview = useQuery({
    queryKey: ['payroll-preview', pay],
    queryFn: async () => (await apiClient.previewPayslip(pay)).data as PayslipFigures,
    enabled: open && pay.basicSalary > 0,
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, ...pay, hireDate: form.hireDate || null }
      return initial ? apiClient.updateEmployee(initial.id, payload) : apiClient.createEmployee(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-employees'] })
      toast.success(initial ? 'Employee updated' : 'Employee added')
      onOpenChange(false)
    },
    onError: e => toast.error(errorMessage(e, 'Could not save the employee')),
  })

  const valid = form.employeeNumber.trim() && form.fullName.trim().length >= 2 && pay.basicSalary >= 0 && form.basicSalary !== ''
  const field = (k: keyof EmployeeForm, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={form[k] as string} onChange={e => set(k, e.target.value as never)} {...props} />
    </div>
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>{initial ? `Edit ${initial.fullName}` : 'Add employee'}</DrawerTitle>
        </DrawerHeader>
        <form
          className="space-y-5 pt-1"
          onSubmit={e => { e.preventDefault(); if (valid) save.mutate() }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('employeeNumber', 'Employee number *', { placeholder: 'EMP-001' })}
            {field('fullName', 'Full name *')}
            {field('jobTitle', 'Job title')}
            {field('hireDate', 'Hire date', { type: 'date' })}
            {field('nationalId', 'National ID')}
            {field('rssbNumber', 'RSSB number')}
            {field('phone', 'Phone')}
            {field('email', 'Email', { type: 'email' })}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Monthly pay (RWF)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {field('basicSalary', 'Basic salary *', { type: 'number', min: 0 })}
              {field('housingAllowance', 'Housing', { type: 'number', min: 0 })}
              {field('transportAllowance', 'Transport', { type: 'number', min: 0 })}
              {field('otherAllowance', 'Other', { type: 'number', min: 0 })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Transport allowance is taxed for PAYE but excluded from RSSB contributions.</p>
          </div>

          {preview.data && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Payslip preview</p>
              <Row label="Gross pay" value={rwf(preview.data.grossPay)} />
              <Row label="PAYE" value={`− ${rwf(preview.data.paye)}`} muted />
              <Row label="Pension (employee 6%)" value={`− ${rwf(preview.data.employeePension)}`} muted />
              <Row label="Maternity (employee 0.3%)" value={`− ${rwf(preview.data.employeeMaternity)}`} muted />
              <Row label="CBHI (0.5%)" value={`− ${rwf(preview.data.cbhi)}`} muted />
              <Row label="Net pay" value={rwf(preview.data.netPay)} strong />
              <Row label="Cost to the business" value={rwf(preview.data.employerCost)} muted />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Paid by</Label>
              <Select value={form.paymentMethod} onValueChange={v => set('paymentMethod', v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map(m => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v as EmployeeForm['status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive (left the business)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.paymentMethod !== 'CASH' && field('bankName', form.paymentMethod === 'BANK' ? 'Bank' : 'Mobile money provider')}
            {form.paymentMethod !== 'CASH' && field('bankAccount', form.paymentMethod === 'BANK' ? 'Account number' : 'Mobile number')}
          </div>

          <DrawerFooter className="flex-row pt-2 px-0 border-t border-gray-100 dark:border-gray-700">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || save.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Add employee'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

// ── Run drawer ────────────────────────────────────────────────────────────────

function RunDrawer({ runId, onClose, canApprove }: { runId: number | null; onClose: () => void; canApprove: boolean }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'approve' | 'pay' | 'cancel' | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('BANK')

  const { data: run, isLoading } = useQuery({
    queryKey: ['payroll-run', runId],
    queryFn: async () => (await apiClient.getPayrollRun(runId!)).data as PayrollRun,
    enabled: runId !== null,
  })

  const act = useMutation({
    mutationFn: (action: 'recalculate' | 'cancel' | 'approve' | 'pay') =>
      apiClient.payrollRunAction(runId!, action, action === 'pay' ? { paymentMethod: method } : undefined),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      qc.invalidateQueries({ queryKey: ['payroll-run', runId] })
      toast.success(res?.message || 'Payroll updated')
    },
    onError: e => toast.error(errorMessage(e, 'Payroll action failed')),
  })

  const slipColumns: ColumnDef<Payslip>[] = [
    { key: 'employee', header: 'Employee', render: s => (
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{s.employee.fullName}</p>
        <p className="text-[11px] text-gray-400">{s.employee.employeeNumber}{s.employee.jobTitle ? ` · ${s.employee.jobTitle}` : ''}</p>
      </div>
    ) },
    { key: 'grossPay', header: 'Gross', className: 'text-right tabular-nums', headerClassName: 'text-right', render: s => rwf(s.grossPay) },
    { key: 'paye', header: 'PAYE', className: 'text-right tabular-nums', headerClassName: 'text-right', render: s => rwf(s.paye) },
    { key: 'rssb', header: 'RSSB (staff)', className: 'text-right tabular-nums', headerClassName: 'text-right', render: s => rwf(Number(s.employeePension) + Number(s.employeeMaternity)) },
    { key: 'cbhi', header: 'CBHI', className: 'text-right tabular-nums', headerClassName: 'text-right', render: s => rwf(s.cbhi) },
    { key: 'netPay', header: 'Net pay', className: 'text-right tabular-nums font-semibold', headerClassName: 'text-right', render: s => rwf(s.netPay) },
  ]

  const confirmText = {
    approve: {
      title: 'Approve this payroll?',
      body: 'The payslips are locked and the salary cost, PAYE, RSSB and net salaries owed are sent to Accounting.',
      action: 'Approve',
    },
    pay: {
      title: 'Record the salary payment?',
      body: `Net pay of ${rwf(run?.netPay)} is recorded as paid by ${METHOD_LABELS[method].toLowerCase()} and sent to Accounting.`,
      action: 'Record payment',
    },
    cancel: { title: 'Cancel this draft payroll?', body: 'You can prepare the month again afterwards.', action: 'Cancel payroll' },
  }

  return (
    <Drawer open={runId !== null} onOpenChange={v => { if (!v) onClose() }}>
      <DrawerContent className="sm:max-w-4xl">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-3">
            {run ? `Payroll — ${periodLabel(run)}` : 'Payroll'}
            {run && <StatusBadge status={run.status} />}
          </DrawerTitle>
        </DrawerHeader>
        {isLoading || !run ? (
          <p className="text-sm text-gray-500 py-8 text-center">Loading payroll…</p>
        ) : (
          <div className="space-y-5 pt-1">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={Users} label="Employees" value={String(run.employeeCount)} color="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400" />
              <Kpi icon={Wallet} label="Gross pay" value={rwf(run.grossPay)} color="bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400" />
              <Kpi icon={Banknote} label="Net pay" value={rwf(run.netPay)} color="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400" />
              <Kpi icon={Landmark} label="Cost to business" value={rwf(run.employerCost)} color="bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Owed to RRA and RSSB</p>
                <Row label="PAYE" value={rwf(run.paye)} />
                <Row label="RSSB withheld from staff" value={rwf(run.employeeRssb)} />
                <Row label="RSSB paid by the business" value={rwf(run.employerRssb)} />
                <Row label="CBHI" value={rwf(run.cbhi)} />
                <Row label="Total" value={rwf(Number(run.paye) + Number(run.employeeRssb) + Number(run.employerRssb) + Number(run.cbhi))} strong />
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Progress</p>
                <p>Rules: <span className="font-medium">{run.rulesVersion}</span></p>
                <p>Approved: {run.approvedAt ? format(new Date(run.approvedAt), 'dd MMM yyyy HH:mm') : '—'}</p>
                <p>Paid: {run.paidAt ? `${format(new Date(run.paidAt), 'dd MMM yyyy HH:mm')} by ${METHOD_LABELS[run.paymentMethod ?? 'BANK'].toLowerCase()}` : '—'}</p>
                {run.status !== 'DRAFT' && run.status !== 'CANCELLED' && (
                  <p className="text-xs text-gray-500 pt-1">Sent to Accounting automatically when approved and when paid.</p>
                )}
              </div>
            </div>

            <DataTable columns={slipColumns} data={run.payslips ?? []} keyExtractor={s => s.id} emptyTitle="No payslips" />

            <DrawerFooter className="flex-row flex-wrap gap-2 pt-2 px-0 border-t border-gray-100 dark:border-gray-700">
              {run.status === 'DRAFT' && (
                <>
                  <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('recalculate')} className="gap-2">
                    <RefreshCw className="h-4 w-4" /> Recalculate
                  </Button>
                  <Button variant="outline" disabled={act.isPending} onClick={() => setConfirm('cancel')} className="gap-2 text-red-600">
                    <XCircle className="h-4 w-4" /> Cancel
                  </Button>
                  <Button
                    disabled={act.isPending || !canApprove}
                    title={canApprove ? undefined : 'Only an administrator can approve payroll'}
                    onClick={() => setConfirm('approve')}
                    className="gap-2 bg-blue-600 hover:bg-blue-700 ml-auto"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                </>
              )}
              {run.status === 'APPROVED' && (
                <div className="flex items-end gap-2 ml-auto">
                  <div className="w-44">
                    <Select value={method} onValueChange={v => setMethod(v as PaymentMethod)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map(m => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button disabled={act.isPending} onClick={() => setConfirm('pay')} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                    <Banknote className="h-4 w-4" /> Record payment
                  </Button>
                </div>
              )}
            </DrawerFooter>
          </div>
        )}

        <AlertDialog open={confirm !== null} onOpenChange={v => { if (!v) setConfirm(null) }}>
          <AlertDialogContent>
            {confirm && (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{confirmText[confirm].title}</AlertDialogTitle>
                  <AlertDialogDescription>{confirmText[confirm].body}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Back</AlertDialogCancel>
                  <AlertDialogAction
                    className={confirm === 'cancel' ? 'bg-red-600 hover:bg-red-700' : undefined}
                    onClick={() => { act.mutate(confirm); setConfirm(null) }}
                  >
                    {confirmText[confirm].action}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>
      </DrawerContent>
    </Drawer>
  )
}

// ── Prepare run drawer ────────────────────────────────────────────────────────

function PrepareRunDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [notes, setNotes] = useState('')
  const create = useMutation({
    mutationFn: () => {
      const [year, m] = month.split('-').map(Number)
      return apiClient.createPayrollRun({ year, month: m, notes: notes.trim() || undefined })
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Payroll prepared')
      onOpenChange(false)
      onCreated(res.data.id)
    },
    onError: e => toast.error(errorMessage(e, 'Could not prepare payroll')),
  })

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-md">
        <DrawerHeader><DrawerTitle>Prepare payroll</DrawerTitle></DrawerHeader>
        <form className="space-y-4 pt-1" onSubmit={e => { e.preventDefault(); if (month) create.mutate() }}>
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-gray-400 text-xs">(optional)</span></Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} />
          </div>
          <p className="text-xs text-gray-500">
            A payslip is calculated for every active employee hired by the end of the month. You can still edit employees and recalculate until the payroll is approved.
          </p>
          <DrawerFooter className="flex-row pt-2 px-0 border-t border-gray-100 dark:border-gray-700">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!month || create.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {create.isPending ? 'Preparing…' : 'Prepare payroll'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { user } = useAuth()
  const canApprove = user?.role === 'ADMIN' || user?.role === 'SYSTEM_OWNER'
  const [tab, setTab] = useState('runs')
  const [employeeOpen, setEmployeeOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [prepareOpen, setPrepareOpen] = useState(false)
  const [openRunId, setOpenRunId] = useState<number | null>(null)

  const employees = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: async () => ((await apiClient.getEmployees()).data ?? []) as Employee[],
  })
  const runs = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: async () => ((await apiClient.getPayrollRuns()).data ?? []) as PayrollRun[],
  })

  const activeEmployees = (employees.data ?? []).filter(e => e.status === 'ACTIVE')
  const monthlyGross = activeEmployees.reduce(
    (s, e) => s + Number(e.basicSalary) + Number(e.housingAllowance) + Number(e.transportAllowance) + Number(e.otherAllowance), 0)
  const lastPaid = (runs.data ?? []).find(r => r.status === 'PAID')

  const employeeColumns: ColumnDef<Employee>[] = [
    { key: 'employeeNumber', header: 'No.', sortable: true, className: 'text-xs text-gray-500 whitespace-nowrap' },
    { key: 'fullName', header: 'Name', sortable: true, render: e => (
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{e.fullName}</p>
        {e.jobTitle && <p className="text-[11px] text-gray-400">{e.jobTitle}</p>}
      </div>
    ) },
    { key: 'gross', header: 'Monthly gross', className: 'text-right tabular-nums', headerClassName: 'text-right',
      sortValue: e => Number(e.basicSalary) + Number(e.housingAllowance) + Number(e.transportAllowance) + Number(e.otherAllowance),
      render: e => rwf(Number(e.basicSalary) + Number(e.housingAllowance) + Number(e.transportAllowance) + Number(e.otherAllowance)) },
    { key: 'paymentMethod', header: 'Paid by', render: e => METHOD_LABELS[e.paymentMethod] },
    { key: 'status', header: 'Status', render: e => <StatusBadge status={e.status} /> },
  ]

  const runColumns: ColumnDef<PayrollRun>[] = [
    { key: 'period', header: 'Month', render: r => <span className="font-medium">{periodLabel(r)}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'employeeCount', header: 'Employees', className: 'text-right tabular-nums', headerClassName: 'text-right' },
    { key: 'grossPay', header: 'Gross', className: 'text-right tabular-nums', headerClassName: 'text-right', render: r => rwf(r.grossPay) },
    { key: 'paye', header: 'PAYE', className: 'text-right tabular-nums', headerClassName: 'text-right', render: r => rwf(r.paye) },
    { key: 'netPay', header: 'Net pay', className: 'text-right tabular-nums font-semibold', headerClassName: 'text-right', render: r => rwf(r.netPay) },
  ]

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <Banknote className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
              <p className="text-sm text-white/70 mt-0.5">Monthly salaries with PAYE, RSSB and CBHI, posted to Accounting on approval and payment.</p>
            </div>
          </div>
          <div className="flex gap-2 self-start sm:self-auto">
            <Button onClick={() => { setEditing(null); setEmployeeOpen(true) }} variant="outline" className="gap-2 bg-white/10 text-white border-white/30 hover:bg-white/20">
              <Plus className="h-4 w-4" /> Add employee
            </Button>
            <Button onClick={() => setPrepareOpen(true)} disabled={activeEmployees.length === 0} className="gap-2 bg-white text-emerald-700 hover:bg-white/90 font-semibold">
              <CalendarDays className="h-4 w-4" /> Prepare payroll
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi icon={Users} label="Active employees" value={String(activeEmployees.length)} color="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400" />
        <Kpi icon={Wallet} label="Monthly gross salaries" value={rwf(monthlyGross)} color="bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400" />
        <Kpi icon={Banknote} label="Last payroll paid" value={lastPaid ? rwf(lastPaid.netPay) : '—'} sub={lastPaid ? periodLabel(lastPaid) : 'No payroll paid yet'}
          color="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="runs">Payroll runs</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="mt-4">
          <DataTable
            columns={runColumns}
            data={runs.data ?? []}
            keyExtractor={r => r.id}
            isLoading={runs.isLoading}
            emptyTitle="No payroll yet"
            emptyMessage={activeEmployees.length ? 'Prepare your first monthly payroll.' : 'Add your employees first, then prepare a payroll.'}
            emptyIcon={<Banknote className="h-10 w-10" />}
            onRowClick={r => setOpenRunId(r.id)}
          />
        </TabsContent>
        <TabsContent value="employees" className="mt-4">
          <DataTable
            columns={employeeColumns}
            data={employees.data ?? []}
            keyExtractor={e => e.id}
            isLoading={employees.isLoading}
            emptyTitle="No employees yet"
            emptyMessage="Add the people you pay every month."
            emptyIcon={<Users className="h-10 w-10" />}
            onRowClick={e => { setEditing(e); setEmployeeOpen(true) }}
          />
        </TabsContent>
      </Tabs>

      <EmployeeDrawer key={editing?.id ?? 'new'} open={employeeOpen} onOpenChange={setEmployeeOpen} initial={editing} />
      <PrepareRunDrawer open={prepareOpen} onOpenChange={setPrepareOpen} onCreated={id => { setTab('runs'); setOpenRunId(id) }} />
      <RunDrawer runId={openRunId} onClose={() => setOpenRunId(null)} canApprove={canApprove} />
    </div>
  )
}

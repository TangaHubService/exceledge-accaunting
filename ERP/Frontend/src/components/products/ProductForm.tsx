import React, { useState, useCallback, useMemo } from 'react'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '../ui/accordion'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { BranchBadge } from '../ui/branch-badge'
import { StepIndicator, type Step } from './StepIndicator'
import * as yup from 'yup'
import {
  productSchema,
  sections,
  getSectionStatus,
  type SectionId,
  type ProductFormData,
} from '../../schema/product'
import {
  Save,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react'

/* ─── Types ─────────────────────────────────────────── */

interface BatchEntry {
  batchNumber: string
  quantity: number
  costPrice?: number
  sellingPrice?: number
  expiryDate?: string
  manufacturingDate?: string
}

export interface ProductFormValues {
  name: string
  description: string
  category: string
  brand: string
  costPrice: number | null
  unitPrice: number | null
  taxCode: string
  exemptionReference: string
  sku: string
  barcode: string
  minStock: number | null
  maxStock: number | null
  unitOfMeasure: string
  batches: BatchEntry[]
  supplierId: number | null
}

interface ProductFormProps {
  initialValues?: Partial<ProductFormValues>
  categories?: { value: string; label: string }[]
  unitsOfMeasure?: { value: string; label: string }[]
  suppliers?: { id: number; name: string }[]
  branchName?: string
  isAllBranches?: boolean
  loading?: boolean
  onSave: (data: ProductFormData) => Promise<void>
  onCancel?: () => void
}

/* ─── Default values ───────────────────────────────── */

const DEFAULT_VALUES: ProductFormValues = {
  name: '',
  description: '',
  category: '',
  brand: '',
  costPrice: null,
  unitPrice: null,
  taxCode: '',
  exemptionReference: '',
  sku: '',
  barcode: '',
  minStock: null,
  maxStock: null,
  unitOfMeasure: '',
  batches: [],
  supplierId: null,
}

/* ─── Helpers ──────────────────────────────────────── */

function toValidationErrors(err: unknown): Partial<Record<string, string>> {
  if (err instanceof yup.ValidationError) {
    const map: Record<string, string> = {}
    err.inner.forEach(e => {
      if (e.path) map[e.path] = e.message
    })
    return map
  }
  return {}
}

/* ─── Component ─────────────────────────────────────── */

export function ProductForm({
  initialValues,
  categories = [],
  unitsOfMeasure = [],
  suppliers = [],
  branchName,
  isAllBranches,
  loading = false,
  onSave,
  onCancel,
}: ProductFormProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [values, setValues] = useState<ProductFormValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  })
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [touched, setTouched] = useState<Partial<Record<string, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  /* ── Field change handler ──────────────────────────── */
  const setField = useCallback(<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => {
    setValues(prev => ({ ...prev, [key]: value }))
    /* Clear error for this field on change */
    setErrors(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  /* ── Blur handler ──────────────────────────────────── */
  const handleBlur = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }))
  }, [])

  /* ── Validation ─────────────────────────────────────── */
  const validate = useCallback(() => {
    try {
      productSchema.validateSync(values, { abortEarly: false })
      setErrors({})
      return true
    } catch (err) {
      setErrors(toValidationErrors(err))
      return false
    }
  }, [values])

  /* ── Submit ─────────────────────────────────────────── */
  const handleSubmit = useCallback(async () => {
    setServerError(null)
    if (!validate()) return

    try {
      setSaving(true)
      await onSave(values as any)
    } catch (err: any) {
      setServerError(err?.message || 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }, [values, validate, onSave])

  /* ── Section statuses ───────────────────────────────── */
  const steps: Step[] = useMemo(
    () =>
      sections.map(s => ({
        id: s.id,
        label: s.label,
        status: getSectionStatus(s.id, errors, touched, values),
      })),
    [errors, touched, values],
  )

  /* ── Batches management ─────────────────────────────── */
  const addBatch = useCallback(() => {
    setValues(prev => ({
      ...prev,
      batches: [
        ...prev.batches,
        { batchNumber: '', quantity: 0, expiryDate: '', manufacturingDate: '' },
      ],
    }))
  }, [])

  const updateBatch = useCallback((index: number, field: keyof BatchEntry, value: any) => {
    setValues(prev => {
      const batches = [...prev.batches]
      batches[index] = { ...batches[index], [field]: value }
      return { ...prev, batches }
    })
  }, [])

  const removeBatch = useCallback((index: number) => {
    setValues(prev => ({
      ...prev,
      batches: prev.batches.filter((_, i) => i !== index),
    }))
  }, [])

  /* ── Loading state ──────────────────────────────────── */
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-7 w-48" />
        <div className="rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-800">
          <div className="space-y-5">
            {[1, 2, 3, 4].map(i => (
              <div key={i}>
                <Skeleton className="mb-1.5 h-4 w-24" />
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-h1 text-gray-900 dark:text-gray-100">
            {initialValues ? 'Edit Product' : 'Add Product'}
          </h1>
          {branchName && (
            <BranchBadge
              name={branchName}
              isAllBranches={isAllBranches}
              className="mt-1"
            />
          )}
        </div>
      </div>

      {/* ── Step indicator ───────────────────────────── */}
      <StepIndicator
        steps={steps}
        activeStep={activeSection}
        onStepClick={id => setActiveSection(id as SectionId)}
      />

      {/* ── Server error banner ──────────────────────── */}
      {serverError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="flex-1 text-sm text-red-700 dark:text-red-300">
            <p className="font-medium">Failed to save</p>
            <p>{serverError}</p>
          </div>
          <button
            type="button"
            onClick={() => setServerError(null)}
            className="rounded-md p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Accordion form ───────────────────────────── */}
      <Accordion
        type="single"
        collapsible
        value={activeSection}
        onValueChange={v => v && setActiveSection(v as SectionId)}
        className="rounded-xl border bg-white shadow-sm dark:bg-zinc-800 dark:border-zinc-700"
      >
        {/* ── 1. Basic Information ──────────────────── */}
        <AccordionItem value="basic" className="px-6">
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader
              label="Basic Information"
              status={getSectionStatus('basic', errors, touched, values)}
              errorCount={['name', 'description', 'category', 'brand'].filter(f => errors[f]).length}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="name">Product Name *</Label>
                  <Input
                    id="name"
                    value={values.name}
                    onChange={e => setField('name', e.target.value)}
                    onBlur={() => handleBlur('name')}
                    placeholder="e.g. Paracetamol 500mg Tablets"
                    className="h-11"
                  />
                  {errors.name && (
                    <p className="text-caption text-red-500">{errors.name}</p>
                  )}
                </FieldGroup>
                <FieldGroup>
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={values.category}
                    onValueChange={v => setField('category', v)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.category && (
                    <p className="text-caption text-red-500">{errors.category}</p>
                  )}
                </FieldGroup>
              </FieldRow>
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="brand">Brand</Label>
                  <Input
                    id="brand"
                    value={values.brand}
                    onChange={e => setField('brand', e.target.value)}
                    placeholder="e.g. GSK, Pfizer"
                    className="h-11"
                  />
                </FieldGroup>
            </FieldRow>
              <FieldGroup>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={values.description}
                  onChange={e => setField('description', e.target.value)}
                  placeholder="Brief product description…"
                  rows={3}
                />
              </FieldGroup>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── 2. Pricing & Tax ──────────────────────── */}
        <AccordionItem value="pricing" className="px-6">
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader
              label="Pricing & Tax"
              status={getSectionStatus('pricing', errors, touched, values)}
              errorCount={['costPrice', 'unitPrice', 'taxCode', 'exemptionReference'].filter(f => errors[f]).length}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="costPrice">Cost Price</Label>
                  <Input
                    id="costPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={values.costPrice ?? ''}
                    onChange={e => setField('costPrice', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="0.00"
                    className="h-11"
                  />
                </FieldGroup>
                <FieldGroup>
                  <Label htmlFor="unitPrice">Selling Price *</Label>
                  <Input
                    id="unitPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={values.unitPrice ?? ''}
                    onChange={e => setField('unitPrice', e.target.value ? parseFloat(e.target.value) : null)}
                    onBlur={() => handleBlur('unitPrice')}
                    placeholder="0.00"
                    className="h-11"
                  />
                  {errors.unitPrice && (
                    <p className="text-caption text-red-500">{errors.unitPrice}</p>
                  )}
                </FieldGroup>
              </FieldRow>
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="taxCode">Tax Category</Label>
                  <Select
                    value={values.taxCode}
                    onValueChange={v => setField('taxCode', v)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select tax category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="B">B — Standard VAT (18%)</SelectItem>
                      <SelectItem value="A">A — VAT Exempt (0%)</SelectItem>
                      <SelectItem value="C">C — Export / Zero-rated (0%)</SelectItem>
                      <SelectItem value="D">D — Not VAT Registered (0%)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400">
                    RRA EBM category. If this business is not VAT registered, sales use code D automatically.
                  </p>
                </FieldGroup>
                <FieldGroup>
                  {values.taxCode === 'C' && (
                    <>
                      <Label htmlFor="exemptionReference">Exemption Reference *</Label>
                      <Input
                        id="exemptionReference"
                        value={values.exemptionReference}
                        onChange={e => setField('exemptionReference', e.target.value)}
                        onBlur={() => handleBlur('exemptionReference')}
                        placeholder="e.g. MINISANTE/2024/001"
                        className="h-11"
                      />
                      {errors.exemptionReference && (
                        <p className="text-caption text-red-500">{errors.exemptionReference}</p>
                      )}
                    </>
                  )}
                </FieldGroup>
              </FieldRow>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── 3. SKU & Barcodes ──────────────────────── */}
        <AccordionItem value="identifiers" className="px-6">
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader
              label="SKU & Barcodes"
              status={getSectionStatus('identifiers', errors, touched, values)}
              errorCount={['sku', 'barcode'].filter(f => errors[f]).length}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    value={values.sku}
                    onChange={e => setField('sku', e.target.value)}
                    onBlur={() => handleBlur('sku')}
                    placeholder="e.g. PCM-001"
                    className="h-11"
                  />
                  {errors.sku && (
                    <p className="text-caption text-red-500">{errors.sku}</p>
                  )}
                </FieldGroup>
                <FieldGroup>
                  <Label htmlFor="barcode">Barcode</Label>
                  <Input
                    id="barcode"
                    value={values.barcode}
                    onChange={e => setField('barcode', e.target.value)}
                    placeholder="e.g. 8901234567890"
                    className="h-11"
                  />
                </FieldGroup>
              </FieldRow>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── 4. Stock Settings ──────────────────────── */}
        <AccordionItem value="stock" className="px-6">
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader
              label="Stock Settings"
              status={getSectionStatus('stock', errors, touched, values)}
              errorCount={['minStock', 'maxStock', 'unitOfMeasure'].filter(f => errors[f]).length}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="minStock">Minimum Stock *</Label>
                  <Input
                    id="minStock"
                    type="number"
                    min="0"
                    value={values.minStock ?? ''}
                    onChange={e => setField('minStock', e.target.value ? parseInt(e.target.value) : null)}
                    onBlur={() => handleBlur('minStock')}
                    placeholder="e.g. 100"
                    className="h-11"
                  />
                  {errors.minStock && (
                    <p className="text-caption text-red-500">{errors.minStock}</p>
                  )}
                </FieldGroup>
                <FieldGroup>
                  <Label htmlFor="maxStock">Maximum Stock</Label>
                  <Input
                    id="maxStock"
                    type="number"
                    min="0"
                    value={values.maxStock ?? ''}
                    onChange={e => setField('maxStock', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="e.g. 5000"
                    className="h-11"
                  />
                </FieldGroup>
              </FieldRow>
              <FieldGroup>
                <Label htmlFor="unitOfMeasure">Unit of Measure</Label>
                <Select
                  value={values.unitOfMeasure}
                  onValueChange={v => setField('unitOfMeasure', v)}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitsOfMeasure.map(u => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── 5. Initial Batch & Expiry ──────────────── */}
        <AccordionItem value="batch" className="px-6">
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader
              label="Initial Batch & Expiry"
              status={getSectionStatus('batch', errors, touched, values)}
              errorCount={['batchNumber', 'initialQuantity', 'expiryDate', 'manufacturingDate'].filter(f => errors[f]).length}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Single initial batch fields */}
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="batchNumber">Batch Number</Label>
                  <Input
                    id="batchNumber"
                    value={values.batches[0]?.batchNumber ?? ''}
                    onChange={e => {
                      if (values.batches.length === 0) {
                        addBatch()
                      }
                      updateBatch(0, 'batchNumber', e.target.value)
                    }}
                    placeholder="e.g. BAT-2024-001"
                    className="h-11"
                  />
                </FieldGroup>
                <FieldGroup>
                  <Label htmlFor="initialQuantity">Initial Quantity</Label>
                  <Input
                    id="initialQuantity"
                    type="number"
                    min="0"
                    value={values.batches[0]?.quantity ?? ''}
                    onChange={e => {
                      if (values.batches.length === 0) {
                        addBatch()
                      }
                      updateBatch(0, 'quantity', parseInt(e.target.value) || 0)
                    }}
                    placeholder="0"
                    className="h-11"
                  />
                </FieldGroup>
              </FieldRow>
              <FieldRow>
                <FieldGroup>
                  <Label htmlFor="expiryDate">Expiry Date</Label>
                  <Input
                    id="expiryDate"
                    type="date"
                    value={values.batches[0]?.expiryDate ?? ''}
                    onChange={e => {
                      if (values.batches.length === 0) addBatch()
                      updateBatch(0, 'expiryDate', e.target.value)
                    }}
                    className="h-11"
                  />
                </FieldGroup>
                <FieldGroup>
                  <Label htmlFor="manufacturingDate">Manufacturing Date</Label>
                  <Input
                    id="manufacturingDate"
                    type="date"
                    value={values.batches[0]?.manufacturingDate ?? ''}
                    onChange={e => {
                      if (values.batches.length === 0) addBatch()
                      updateBatch(0, 'manufacturingDate', e.target.value)
                    }}
                    className="h-11"
                  />
                </FieldGroup>
              </FieldRow>

              {/* Multiple batches */}
              {values.batches.length > 1 && (
                <div className="space-y-3 rounded-lg border border-dashed border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-caption font-medium text-gray-500">Additional Batches</p>
                  {values.batches.slice(1).map((batch, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Input
                          value={batch.batchNumber}
                          onChange={e => updateBatch(i + 1, 'batchNumber', e.target.value)}
                          placeholder="Batch number"
                          className="h-10 text-sm"
                        />
                        <Input
                          type="number"
                          value={batch.quantity || ''}
                          onChange={e => updateBatch(i + 1, 'quantity', parseInt(e.target.value) || 0)}
                          placeholder="Qty"
                          className="h-10 text-sm"
                        />
                        <Input
                          type="date"
                          value={batch.expiryDate || ''}
                          onChange={e => updateBatch(i + 1, 'expiryDate', e.target.value)}
                          className="h-10 text-sm"
                        />
                        <Input
                          type="date"
                          value={batch.manufacturingDate || ''}
                          onChange={e => updateBatch(i + 1, 'manufacturingDate', e.target.value)}
                          className="h-10 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBatch(i + 1)}
                        className="mt-1 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBatch}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Another Batch
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── 6. Supplier ──────────────────────────── */}
        <AccordionItem value="supplier" className="px-6">
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader
              label="Supplier"
              status={getSectionStatus('supplier', errors, touched, values)}
              errorCount={0}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <FieldGroup>
                <Label htmlFor="supplierId">Supplier</Label>
                <Select
                  value={values.supplierId?.toString() ?? ''}
                  onValueChange={v => setField('supplierId', v ? parseInt(v) : null)}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select supplier (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ── Footer actions ──────────────────────────── */}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-xl border bg-white/95 p-4 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={saving}
              className="h-11"
            >
              Cancel
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const idx = sections.findIndex(s => s.id === activeSection)
              if (idx > 0) setActiveSection(sections[idx - 1].id)
            }}
            disabled={activeSection === sections[0].id || saving}
            className="h-11 gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          {activeSection !== sections[sections.length - 1].id ? (
            <Button
              type="button"
              onClick={() => {
                const idx = sections.findIndex(s => s.id === activeSection)
                if (idx < sections.length - 1) setActiveSection(sections[idx + 1].id)
              }}
              className="h-11 gap-1.5"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="h-11 gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {initialValues ? 'Update Product' : 'Save Product'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────── */

function SectionHeader({
  label,
  status,
  errorCount,
}: {
  label: string
  status: 'complete' | 'incomplete' | 'error'
  errorCount: number
}) {
  const icon =
    status === 'complete' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : status === 'error' ? (
      <AlertCircle className="h-4 w-4 text-red-500" />
    ) : null

  return (
    <div className="flex items-center gap-2 text-left">
      {icon}
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
      {status === 'incomplete' && (
        <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
      )}
      {status === 'error' && errorCount > 0 && (
        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {errorCount} error{errorCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {children}
    </div>
  )
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>
}

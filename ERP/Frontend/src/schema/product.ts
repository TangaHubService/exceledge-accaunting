import * as yup from 'yup'

export type ProductFormData = yup.InferType<typeof productSchema>

export const productSchema = yup.object({
  /* ── Basic Information ─────────────────────── */
  name: yup
    .string()
    .required('Product name is required')
    .min(2, 'Name must be at least 2 characters')
    .max(200, 'Name must be at most 200 characters'),
  description: yup
    .string()
    .max(1000, 'Description must be at most 1000 characters'),
  category: yup
    .string()
    .required('Category is required'),
  brand: yup
    .string(),

  /* ── Pricing & Tax ─────────────────────────── */
  costPrice: yup
    .number()
    .typeError('Must be a number')
    .min(0, 'Cost price cannot be negative'),
  unitPrice: yup
    .number()
    .typeError('Must be a number')
    .required('Selling price is required')
    .positive('Selling price must be greater than 0'),
  taxCode: yup
    .string(),
  exemptionReference: yup
    .string()
    .when('taxCode', ([taxCode], schema) =>
      taxCode === 'C' ? schema.required('Exemption reference is required for exempt items') : schema,
    ),

  /* ── SKU & Identifiers ─────────────────────── */
  sku: yup
    .string()
    .matches(
      /^[A-Za-z0-9-_]+$/,
      'SKU can only contain letters, numbers, hyphens, and underscores',
    ),
  barcode: yup
    .string(),

  /* ── Item Type ─────────────────────────────── */
  itemType: yup
    .string()
    .oneOf(['PRODUCT', 'RAW_MATERIAL', 'SERVICE'], 'Must be either PRODUCT, RAW_MATERIAL, or SERVICE')
    .default('PRODUCT'),

  /* ── Stock Settings ────────────────────────── */
  minStock: yup
    .number()
    .typeError('Must be a number')
    .required('Minimum stock is required')
    .min(0, 'Minimum stock cannot be negative'),
  maxStock: yup
    .number()
    .typeError('Must be a number')
    .min(0, 'Maximum stock cannot be negative'),
  unitOfMeasure: yup
    .string(),

  /* ── Initial Batch ─────────────────────────── */
  batchNumber: yup
    .string(),
  initialQuantity: yup
    .number()
    .typeError('Must be a number')
    .min(0, 'Initial quantity cannot be negative'),
  expiryDate: yup
    .string()
    .nullable(),
  manufacturingDate: yup
    .string()
    .nullable(),

  /* ── Supplier ──────────────────────────────── */
  supplierId: yup
    .number()
    .nullable(),
})

/* Map each field to a section for validation grouping */
export const sections = [
  {
    id: 'basic',
    label: 'Basic Information',
    fields: ['name', 'description', 'category', 'brand', 'itemType'] as const,
  },
  {
    id: 'pricing',
    label: 'Pricing & Tax',
    fields: ['costPrice', 'unitPrice', 'taxCode', 'exemptionReference'] as const,
  },
  {
    id: 'identifiers',
    label: 'SKU & Barcodes',
    fields: ['sku', 'barcode'] as const,
  },
  {
    id: 'stock',
    label: 'Stock Settings',
    fields: ['minStock', 'maxStock', 'unitOfMeasure'] as const,
  },
  {
    id: 'batch',
    label: 'Initial Batch & Expiry',
    fields: ['batchNumber', 'initialQuantity', 'expiryDate', 'manufacturingDate'] as const,
  },
  {
    id: 'supplier',
    label: 'Supplier',
    fields: ['supplierId'] as const,
  },
] as const

export type SectionId = (typeof sections)[number]['id']

/** Get the validation status for a given section */
export function getSectionStatus(
  sectionId: SectionId,
  errors: Partial<Record<string, string>>,
  touched: Partial<Record<string, boolean>>,
  values: Record<string, any>,
): 'complete' | 'incomplete' | 'error' {
  const section = sections.find(s => s.id === sectionId)
  if (!section) return 'incomplete'

  const hasError = section.fields.some(f => errors[f])
  const isTouched = section.fields.some(f => touched[f])
  const isEmpty = section.fields.every(f => {
    const v = values[f]
    return v === undefined || v === '' || v === null
  })

  if (hasError) return 'error'
  if (isTouched && !hasError) return 'complete'
  if (!isEmpty && !hasError) return 'complete'
  return 'incomplete'
}

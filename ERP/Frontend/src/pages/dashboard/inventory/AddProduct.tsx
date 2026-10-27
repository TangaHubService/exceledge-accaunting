import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import {
    Package, Wrench, Boxes, Upload, X, Trash2, Plus,
    Save, Check, ChevronsUpDown, ChevronLeft, ChevronRight
} from 'lucide-react'
import { cn } from '../../../lib/utils'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '../../../components/ui/command'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '../../../components/ui/popover'
import { toast } from 'react-toastify'
import { apiClient } from '../../../lib/api-client'
import { parseInventoryGetProductsResponse } from '../../../lib/inventory-response'
import { useBranch } from '../../../context/BranchContext'
import { BranchRequiredNotice } from '../../../components/BranchRequiredNotice'
import { MEASUREMENT_UNIT_OPTIONS, PACKAGING_UNIT_OPTIONS, QUANTITY_UNIT_OPTIONS } from '../../../types/ebm'
import { RraItemClassPicker } from '../../../components/inventory/RraItemClassPicker'
import { useRraCodeCatalog } from '../../../lib/useRraCodeCatalog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import type { Product } from '../../../types'

interface RawMaterialOption {
    id: number
    name: string
    sku?: string | null
    measurementUnit?: string | null
    quantity: number
    purchasePrice?: number | null
    unitPrice: number
}

interface DraftBomComponent {
    componentProductId: number
    quantity: string
    unit: string
}

function toRwf(value: number): number {
    return Math.round(value * 100) / 100
}

function computeInclusiveVat(gross: number, ratePercent: number): { taxable: number; vat: number } {
    if (ratePercent <= 0 || gross <= 0) return { taxable: toRwf(gross), vat: 0 }
    const rate = ratePercent / 100
    const taxable = toRwf(gross / (1 + rate))
    const vat = toRwf(gross - taxable)
    return { taxable, vat }
}

// RRA ItemSaveReq grpPrcL1..grpPrcL5 — five optional price tiers, all validated the same way.
const priceTierSchema = yup
    .number()
    .typeError('Must be a number')
    .min(0, 'Cannot be negative')
    .transform((v) => (isNaN(v) ? undefined : v))
    .nullable()

const addProductSchema = yup.object({
        itemType: yup.string().oneOf(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).required(),
        name: yup.string().required('Product name is required').min(2).max(200),
        category: yup.string().required('Category is required'),
        description: yup.string().max(1000),
        unitPrice: yup
            .number()
            .typeError('Must be a number')
            .required('Unit price is required')
            .positive('Must be positive'),
        purchasePrice: yup
            .number()
            .typeError('Must be a number')
            .min(0, 'Cannot be negative')
            .transform((v) => (isNaN(v) ? undefined : v))
            .nullable(),
        taxCode: yup
            .string()
            .required('Tax category is required')
            .oneOf(['A', 'B', 'C', 'D'], 'Must be A, B, C, or D'),
        batchNumber: yup.string().max(50),
        expiryDate: yup
            .date()
            .nullable()
            .transform((value, originalValue) => (originalValue === '' || originalValue == null ? null : value))
            .min(new Date(), 'Expiry must be in the future'),
        minStock: yup
            .number()
            .typeError('Must be a number')
            .transform((v) => (isNaN(v) ? undefined : v))
            .min(0, 'Cannot be negative'),
        measurementUnit: yup.string().when('itemType', {
            is: (val: string) => val === 'PRODUCT' || val === 'RAW_MATERIAL',
            then: (schema) => schema.required('Measurement unit is required'),
            otherwise: (schema) => schema.notRequired(),
        }),
        barcode: yup
            .string()
            .matches(/^\d{0,13}$/, 'Barcode must be up to 13 digits'),
        pkgUnitCd: yup.string().required('Packaging unit is required'),
        qtyUnitCd: yup.string().when('itemType', {
            is: 'SERVICE',
            then: (schema) => schema.required('RRA quantity unit is required'),
            otherwise: (schema) => schema.notRequired(),
        }),
        packagingQty: yup
            .number()
            .typeError('Must be a number')
            .transform((v) => (isNaN(v) ? undefined : v))
            .min(1, 'Must be at least 1')
            .nullable(),
        itemClsCd: yup
            .string()
            .required('RRA item classification is required')
            .matches(/^\d{1,10}$/, 'Class code must be 1–10 digits'),
        itemStandardName: yup.string().max(200),
        origin: yup.string().matches(/^[A-Za-z]{2}$/, 'Origin must be a 2-letter RRA country code').required('Origin country is required'),
        useInsurance: yup.boolean(),
        additionalInfo: yup.string().max(7, 'Up to 7 characters'),
        l1SalePrice: priceTierSchema,
        l2SalePrice: priceTierSchema,
        l3SalePrice: priceTierSchema,
        l4SalePrice: priceTierSchema,
        l5SalePrice: priceTierSchema,
    })

// RRA ItemSaveReq grpPrcL1..grpPrcL5 — five optional group/tier prices.
const PRICE_TIER_FIELDS = [
    { field: 'l1SalePrice', label: 'Tier 1' },
    { field: 'l2SalePrice', label: 'Tier 2' },
    { field: 'l3SalePrice', label: 'Tier 3' },
    { field: 'l4SalePrice', label: 'Tier 4' },
    { field: 'l5SalePrice', label: 'Tier 5' },
] as const

interface TaxCodeOption {
    code: string
    label: string
    rate: number
    category: string
}

interface AddProductProps {
    onSuccess?: () => void
    product?: Product | null
    initialItemType?: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE'
}

const STEPS = [
    { id: 'basic', label: 'Basic Info' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'details', label: 'RRA Details' },
    { id: 'bom', label: 'Bill of Materials' },
    { id: 'review', label: 'Review' },
] as const

type StepId = (typeof STEPS)[number]['id']

export default function AddProduct({ onSuccess, product, initialItemType = 'PRODUCT' }: AddProductProps) {
    const navigate = useNavigate()
    const { selectedBranchId } = useBranch()
    const { catalog } = useRraCodeCatalog()
    const countryOptions = catalog.countries.length
        ? catalog.countries.map((c) => ({ value: c.code, label: `${c.label} (${c.code})` }))
        : []
    const pkgOptions = catalog.pkgUnits.length
        ? catalog.pkgUnits.map((u) => ({ value: u.code, label: `${u.label} (${u.code})` }))
        : PACKAGING_UNIT_OPTIONS
    const qtyOptions = catalog.qtyUnits.length
        ? catalog.qtyUnits.map((u) => ({ value: u.code, label: `${u.label} (${u.code})` }))
        : QUANTITY_UNIT_OPTIONS
    const [currentStep, setCurrentStep] = useState<StepId>('basic')

    const [itemType, setItemType] = useState<'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE'>(initialItemType)
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState<string>('')
    const [isUploadingImage, setIsUploadingImage] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [taxCodes, setTaxCodes] = useState<TaxCodeOption[]>([])
    const [uploadedImageUrl, setUploadedImageUrl] = useState<string>('')
    const [existingCategories, setExistingCategories] = useState<string[]>([])
    const [existingNames, setExistingNames] = useState<string[]>([])
    const [rawMaterials, setRawMaterials] = useState<RawMaterialOption[]>([])
    const [rawMaterialsLoading, setRawMaterialsLoading] = useState(false)
    const [selectedRawMaterialId, setSelectedRawMaterialId] = useState('')
    const [bomComponents, setBomComponents] = useState<DraftBomComponent[]>([])
    const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false)
    const [namePopoverOpen, setNamePopoverOpen] = useState(false)

    const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const setSectionRef = (id: string) => (el: HTMLDivElement | null) => {
        sectionRefs.current[id] = el
    }

    const composeRefs = (rhfRef: React.Ref<any>, fieldName: string) => (el: any) => {
        if (typeof rhfRef === 'function') rhfRef(el)
        inputRefs.current[fieldName] = el
    }

    const inputRefs = useRef<Record<string, HTMLElement | null>>({})

    const advanceOnEnter =
        (nextField: string): React.KeyboardEventHandler =>
        (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                inputRefs.current[nextField]?.focus()
            }
        }

    const bindField = (field: string, nextField: string) => {
        const { ref, ...rest } = register(field as any)
        return { ...rest, ref: composeRefs(ref, field), onKeyDown: advanceOnEnter(nextField) }
    }

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        resetField,
        trigger,
        formState: { errors },
    } = useForm({
        resolver: yupResolver(addProductSchema) as any,
        defaultValues: {
            itemType: initialItemType,
            name: '',
            category: '',
            description: '',
            unitPrice: undefined as number | undefined,
            purchasePrice: undefined as number | undefined,
            taxCode: '',
            batchNumber: '',
            expiryDate: null,
            minStock: undefined as number | undefined,
            measurementUnit: 'PCS',
            barcode: '',
            pkgUnitCd: 'CT',
            qtyUnitCd: 'U',
            packagingQty: undefined as number | undefined,
            itemClsCd: '',
            itemStandardName: '',
            origin: '',
            useInsurance: false,
            additionalInfo: '',
            l1SalePrice: undefined as number | undefined,
            l2SalePrice: undefined as number | undefined,
            l3SalePrice: undefined as number | undefined,
            l4SalePrice: undefined as number | undefined,
            l5SalePrice: undefined as number | undefined,
        },
    })

    const watchItemType = watch('itemType')
    const watchUnitPrice = watch('unitPrice')
    const watchTaxCode = watch('taxCode')

    const taxOptions = taxCodes.filter((t) => t.code !== 'D' || watchTaxCode === 'D')

    useEffect(() => {
        setItemType(watchItemType as 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE')
    }, [watchItemType])

    const taxPreview = (() => {
        const price = Number(watchUnitPrice) || 0
        const code = watchTaxCode
        const rateInfo = taxCodes.find((t) => t.code === code)
        const ratePct = rateInfo?.rate ?? 0
        const { taxable, vat } = computeInclusiveVat(price, ratePct)
        return { price: toRwf(price), taxable, vat, ratePct, label: rateInfo?.label ?? '' }
    })()

    // Item code preview - computes the expected RRA itemCd based on current form values
    // Note: This is a preview only; the actual sequence number is allocated by the backend
    const itemCdPreview = (() => {
        const origin = watch('origin') || '';
        const pkgUnitCd = watch('pkgUnitCd') || pkgOptions.find((u) => u.value === 'CT')?.value || pkgOptions[0]?.value || '';
        const qtyUnitCd = watch('qtyUnitCd') ||
            ({ PCS: 'U', KG: 'KG', LTR: 'LTR', MTR: 'MTR', BOX: 'BX', PAIR: 'PR', DOZEN: 'DZ', GRAM: 'GRM', ML: 'U', OTHER: 'U' } as Record<string, string>)[watch('measurementUnit') || 'PCS'] || '';
        if (!origin || !pkgUnitCd || !qtyUnitCd) return '';
        const typeDigit = watchItemType === 'RAW_MATERIAL' ? '1' : watchItemType === 'SERVICE' ? '3' : '2';

        // Preview with placeholder sequence (actual sequence assigned by backend)
        return `${origin}${typeDigit}${pkgUnitCd}${qtyUnitCd}XXXXXXX`;
    })()

    const INVENTORY_FIELDS = ['batchNumber', 'expiryDate', 'minStock'] as const

    useEffect(() => {
        if (watchItemType === 'SERVICE') {
            for (const field of INVENTORY_FIELDS) {
                resetField(field, { defaultValue: field === 'expiryDate' ? null : '' })
            }
            setValue('minStock', 0, { shouldDirty: false, shouldTouch: false, shouldValidate: false })
            // Services still need RRA packaging/qty units for itemCd + saveItems.
            if (!watch('measurementUnit')) {
                setValue('measurementUnit', 'OTHER', { shouldDirty: false })
            }
            if (!watch('pkgUnitCd')) {
                setValue('pkgUnitCd', 'CT', { shouldDirty: false })
            }
            if (!watch('qtyUnitCd')) {
                setValue('qtyUnitCd', 'U', { shouldDirty: false })
            }
        }
    }, [watchItemType, resetField, setValue])

    useEffect(() => {
            apiClient.getTaxCodes().then((codes) => {
                if (catalog.taxTypes.length) {
                    setTaxCodes(catalog.taxTypes.map((t) => ({
                        code: t.code,
                        label: t.label,
                        rate: t.rate,
                        category: t.category,
                    })))
                } else {
                    setTaxCodes(codes)
                }
            }).catch(() => {
                if (catalog.taxTypes.length) {
                    setTaxCodes(catalog.taxTypes.map((t) => ({
                        code: t.code,
                        label: t.label,
                        rate: t.rate,
                        category: t.category,
                    })))
                }
            })
    }, [catalog.taxTypes])

    useEffect(() => {
        if (!selectedBranchId) return
        apiClient.getProducts({ page: 1, limit: 200, branchId: selectedBranchId })
            .then((res: any) => {
                const items = parseInventoryGetProductsResponse(res).items as Array<{ category?: string; name?: string }>
                const cats = Array.from(new Set(
                    items.filter((p) => p.category).map((p) => p.category)
                )) as string[]
                setExistingCategories(cats.sort())
                const names = Array.from(new Set(
                    items.filter((p) => p.name).map((p) => p.name)
                )) as string[]
                setExistingNames(names.sort())
            })
            .catch(() => {})
    }, [selectedBranchId])

    useEffect(() => {
        if (itemType !== 'PRODUCT' || !selectedBranchId) return
        let active = true
        setRawMaterialsLoading(true)
        apiClient.getProducts({ itemType: 'RAW_MATERIAL', page: 1, limit: 500, branchId: selectedBranchId })
            .then((res) => {
                if (!active) return
                const items = parseInventoryGetProductsResponse(res).items as Array<RawMaterialOption & { itemType?: string }>
                setRawMaterials(items.filter((item) => item.itemType === 'RAW_MATERIAL'))
            })
            .catch(() => { if (active) toast.error('Failed to load raw materials') })
            .finally(() => { if (active) setRawMaterialsLoading(false) })
        return () => { active = false }
    }, [itemType, selectedBranchId])

    useEffect(() => {
        if (product) {
            setValue('name', product.name)
            setValue('category', product.category || '')
            setValue('description', product.description || '')
            setValue('unitPrice', product.unitPrice)
            setValue('purchasePrice', product.purchasePrice ?? undefined)
            setValue('taxCode', product.taxCode || '')
            setValue('itemType', (product.itemType as 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE') || 'PRODUCT')
            setValue('barcode', product.barcode || '')
            setValue('batchNumber', product.batchNumber || '')
            setValue('minStock', product.minStock)
            setValue('measurementUnit', product.measurementUnit || '')
            setValue('pkgUnitCd', product.pkgUnitCd || '')
            setValue('qtyUnitCd', product.qtyUnitCd || '')
            setValue('packagingQty', product.packagingQty ?? undefined)
            setValue('itemClsCd', product.itemClsCd || '')
            setValue('itemStandardName', product.itemStandardName || '')
            setValue('origin', product.origin || '')
            setValue('useInsurance', !!product.useInsurance)
            setValue('additionalInfo', product.additionalInfo || '')
            setValue('l1SalePrice', product.l1SalePrice ?? undefined)
            setValue('l2SalePrice', product.l2SalePrice ?? undefined)
            setValue('l3SalePrice', product.l3SalePrice ?? undefined)
            setValue('l4SalePrice', product.l4SalePrice ?? undefined)
            setValue('l5SalePrice', product.l5SalePrice ?? undefined)
            if (product.expiryDate) {
                setValue('expiryDate', product.expiryDate.split('T')[0] as any)
            }
            if (product.imageUrl) {
                setUploadedImageUrl(product.imageUrl)
                setImagePreview(product.imageUrl)
            }
            setItemType((product.itemType as 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE') || 'PRODUCT')
        }
    }, [product, setValue])

    const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file')
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be under 5MB')
            return
        }
        setImageFile(file)
        setImagePreview(URL.createObjectURL(file))
    }, [])

    const removeImage = useCallback(() => {
        setImageFile(null)
        setImagePreview('')
        setUploadedImageUrl('')
    }, [])

    const uploadImage = async (): Promise<string | null> => {
        if (!imageFile) return uploadedImageUrl || null
        setIsUploadingImage(true)
        try {
            const result = await apiClient.uploadProductImage(imageFile)
            setUploadedImageUrl(result.imageUrl)
            return result.imageUrl
        } catch {
            toast.warn('Image upload failed, saving without image')
            return null
        } finally {
            setIsUploadingImage(false)
        }
    }

    const goToStep = (step: StepId) => {
        setCurrentStep(step)
    }

    const addBomMaterial = () => {
        const rawMaterial = rawMaterials.find((material) => material.id === Number(selectedRawMaterialId))
        if (!rawMaterial || bomComponents.some((component) => component.componentProductId === rawMaterial.id)) return
        setBomComponents((components) => [
            ...components,
            { componentProductId: rawMaterial.id, quantity: '1', unit: rawMaterial.measurementUnit || 'PCS' },
        ])
        setSelectedRawMaterialId('')
    }

    const hasValidBom = () => {
        const invalid = bomComponents.some((component) => {
            const quantity = Number(component.quantity)
            return !Number.isFinite(quantity) || quantity <= 0 ||
                Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7 || !component.unit.trim()
        })
        if (invalid) toast.error('Each raw material needs a quantity greater than zero (up to 3 decimals) and a unit')
        return !invalid
    }

    const handleNext = async () => {
        if (currentStep === 'basic') {
            const fields = ['itemType', 'name', 'category']
            const valid = await trigger(fields as any)
            if (!valid) {
                toast.error('Please fill in all required fields')
                return
            }
            goToStep('pricing')
        } else if (currentStep === 'pricing') {
            const fields = ['unitPrice', 'taxCode']
            const valid = await trigger(fields as any)
            if (!valid) {
                toast.error('Please fill in pricing fields')
                return
            }
            goToStep('inventory')
        } else if (currentStep === 'inventory') {
            const fields = itemType !== 'SERVICE'
                ? ['minStock', 'measurementUnit', 'pkgUnitCd', 'origin']
                : ['pkgUnitCd', 'qtyUnitCd', 'origin']
            const valid = await trigger(fields as any)
            if (!valid) {
                toast.error(itemType === 'SERVICE'
                    ? 'Please fill in RRA packaging and origin fields'
                    : 'Please fill in inventory fields')
                return
            }
            goToStep('details')
        } else if (currentStep === 'details') {
            const valid = await trigger(['itemClsCd'] as any)
            if (!valid) {
                toast.error('RRA item classification is required')
                return
            }
            goToStep(itemType === 'PRODUCT' && !product ? 'bom' : 'review')
        } else if (currentStep === 'bom') {
            if (!hasValidBom()) return
            goToStep('review')
        }
    }

    const handlePrevious = () => {
        if (currentStep === 'pricing') goToStep('basic')
        else if (currentStep === 'inventory') goToStep('pricing')
        else if (currentStep === 'details') goToStep('inventory')
        else if (currentStep === 'bom') goToStep('details')
        else if (currentStep === 'review') goToStep(itemType === 'PRODUCT' && !product ? 'bom' : 'details')
    }

    const onSubmit = async (data: Record<string, any>) => {
        const isValid = await trigger()
        if (!isValid) {
            toast.error('Please fix the highlighted fields before saving')
            return
        }

        if (data.itemType === 'PRODUCT' && !product && !hasValidBom()) return

        if (!selectedBranchId) {
            toast.error('Please select a branch before adding a product')
            return
        }

        setIsSubmitting(true)
        try {
            const imageUrl = await uploadImage()

            const payload: Record<string, any> = {
                name: data.name,
                category: data.category,
                description: data.description || '',
                unitPrice: data.unitPrice,
                taxCode: data.taxCode,
                itemType: data.itemType,
                branchId: selectedBranchId,
                imageUrl: imageUrl || undefined,
                origin: data.origin?.trim().toUpperCase(),
                useInsurance: !!data.useInsurance,
                // Required by VSDC ItemSaveReq for all types including SERVICE
                pkgUnitCd: data.pkgUnitCd,
                qtyUnitCd: data.qtyUnitCd || undefined,
                itemClsCd: data.itemClsCd,
                itemStandardName: data.itemStandardName || undefined,
                additionalInfo: data.additionalInfo || undefined,
                barcode: data.barcode || undefined,
                l1SalePrice: data.l1SalePrice ?? undefined,
                l2SalePrice: data.l2SalePrice ?? undefined,
                l3SalePrice: data.l3SalePrice ?? undefined,
                l4SalePrice: data.l4SalePrice ?? undefined,
                l5SalePrice: data.l5SalePrice ?? undefined,
            }

            if (data.itemType !== 'SERVICE') {
                payload.purchasePrice = data.purchasePrice ?? undefined
                payload.batchNumber = data.batchNumber || undefined
                // Opening stock is not collected on create — start at 0; add stock via inventory later.
                if (!product) payload.quantity = 0
                payload.expiryDate = data.expiryDate || undefined
                payload.minStock = data.minStock || 0
                payload.measurementUnit = data.measurementUnit || 'PCS'
                payload.packagingQty = data.packagingQty ?? undefined
            } else {
                payload.quantity = 0
                payload.minStock = 0
                payload.measurementUnit = data.measurementUnit || 'OTHER'
            }

            if (product) {
                await apiClient.updateProduct(String(product.id), payload)
                toast.success('Product updated successfully')
            } else {
                if (data.itemType === 'PRODUCT') {
                    payload.bomComponents = bomComponents.map((component) => ({
                        componentProductId: component.componentProductId,
                        quantity: Number(component.quantity),
                        unit: component.unit.trim(),
                    }))
                }
                await apiClient.createProduct(payload)
                toast.success(data.itemType === 'SERVICE' ? 'Service added successfully' : data.itemType === 'RAW_MATERIAL' ? 'Raw material added successfully' : 'Product added successfully')
            }
            if (onSuccess) onSuccess()
            else navigate('/dashboard/inventory-all')
        } catch (error: any) {
            toast.error(error.message || 'Failed to save product')
        } finally {
            setIsSubmitting(false)
        }
    }

    const visibleSteps = itemType === 'PRODUCT' && !product ? STEPS : STEPS.filter(s => s.id !== 'bom')
    const stepIndex = visibleSteps.findIndex(s => s.id === currentStep)
    const isFirstStep = stepIndex === 0
    const isLastStep = stepIndex === visibleSteps.length - 1

    return (
        <div className="mx-auto max-w-xl">
            <div className="space-y-6">
                {!selectedBranchId && (
                    <BranchRequiredNotice message='Select a specific branch from the header (not "All Branches") before adding a product.' />
                )}

                {/* Step Indicator */}
                <div className="flex items-center gap-1">
                    {visibleSteps.map((step, idx) => (
                        <div key={step.id} className="flex items-center gap-1 flex-1 min-w-0">
                            <button
                                type="button"
                                onClick={() => {
                                    if (idx < stepIndex) goToStep(step.id)
                                }}
                                className={cn(
                                    'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all min-w-0',
                                    currentStep === step.id && 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100',
                                    currentStep !== step.id && idx < stepIndex && 'text-emerald-600 dark:text-emerald-400',
                                    currentStep !== step.id && idx > stepIndex && 'text-gray-400 dark:text-gray-500',
                                    idx < stepIndex && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50',
                                )}
                                aria-current={currentStep === step.id ? 'step' : undefined}
                            >
                                <span className={cn(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                                    idx < stepIndex && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                                    currentStep === step.id && 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
                                    idx > stepIndex && 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
                                )}>
                                    {idx < stepIndex ? <Check className="h-3 w-3" /> : idx + 1}
                                </span>
                                <span className="hidden sm:inline truncate">{step.label}</span>
                            </button>
                            {idx < visibleSteps.length - 1 && (
                                <div className={cn(
                                    'h-px flex-1 min-w-[8px] mx-1',
                                    idx < stepIndex ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-gray-200 dark:bg-gray-700',
                                )} aria-hidden="true" />
                            )}
                        </div>
                    ))}
                </div>

                <form>
                    {/* ══════ STEP 1: BASIC INFO ══════ */}
                    {currentStep === 'basic' && (
                        <div className="space-y-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Basic Information</h2>

                            <div ref={setSectionRef('item-type')}>
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 block">
                                    Item Type <span className="text-red-500">*</span>
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setValue('itemType', 'PRODUCT'); setItemType('PRODUCT') }}
                                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                            itemType === 'PRODUCT'
                                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        <Package className="h-4 w-4" />
                                        Product
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setValue('itemType', 'RAW_MATERIAL'); setItemType('RAW_MATERIAL') }}
                                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                            itemType === 'RAW_MATERIAL'
                                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        <Boxes className="h-4 w-4" />
                                        Raw Material
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setValue('itemType', 'SERVICE'); setItemType('SERVICE') }}
                                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                            itemType === 'SERVICE'
                                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        <Wrench className="h-4 w-4" />
                                        Service
                                    </button>
                                </div>
                            </div>

                            <div ref={setSectionRef('product-image')}>
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 block">Product Image</label>
                                {imagePreview ? (
                                    <div className="relative">
                                        <img
                                            src={imagePreview}
                                            alt="Preview"
                                            className="w-full h-36 object-cover rounded-xl border border-gray-200 dark:border-gray-700"
                                        />
                                        <button
                                            type="button"
                                            onClick={removeImage}
                                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full shadow-md hover:bg-red-600 transition-colors"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ) : (
                                    <label className="flex flex-col items-center justify-center w-full h-28 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors bg-gray-50 dark:bg-gray-900/50">
                                        <Upload className="h-6 w-6 text-gray-400 mb-1.5" />
                                        <span className="text-xs text-gray-500">Click to upload image</span>
                                        <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                                    </label>
                                )}
                            </div>

                            <div ref={setSectionRef('product-info')}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-1.5 md:col-span-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            {itemType === 'SERVICE' ? 'Service Name' : itemType === 'RAW_MATERIAL' ? 'Raw Material Name' : 'Product Name'} <span className="text-red-500">*</span>
                                        </label>
                                        <Popover open={namePopoverOpen} onOpenChange={setNamePopoverOpen}>
                                            <PopoverTrigger asChild>
                                                <button
                                                    type="button"
                                                    role="combobox"
                                                    aria-expanded={namePopoverOpen}
                                                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                        errors.name ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                >
                                                    <span className={watch('name') ? 'truncate' : 'text-gray-400 truncate'}>
                                                        {watch('name') || (itemType === 'SERVICE' ? 'Select or type service name...' : itemType === 'RAW_MATERIAL' ? 'Select or type raw material name...' : 'Select or type product name...')}
                                                    </span>
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg" align="start">
                                                <Command className="bg-transparent">
                                                    <CommandInput
                                                        placeholder="Search or type new..."
                                                        className="bg-white dark:bg-gray-800"
                                                        value={watch('name')}
                                                        onValueChange={(v) => {
                                                            setValue('name', v, { shouldValidate: true })
                                                        }}
                                                    />
                                                    <CommandList>
                                                        {existingNames.length > 0 && (
                                                            <CommandGroup heading="Existing names">
                                                                {existingNames.map((n) => (
                                                                    <CommandItem
                                                                        key={n}
                                                                        value={n}
                                                                        onSelect={() => {
                                                                            setValue('name', n, { shouldValidate: true })
                                                                            setNamePopoverOpen(false)
                                                                        }}
                                                                    >
                                                                        <Check
                                                                            className={cn(
                                                                                'mr-2 h-4 w-4 shrink-0',
                                                                                watch('name') === n ? 'opacity-100' : 'opacity-0'
                                                                            )}
                                                                        />
                                                                        {n}
                                                                    </CommandItem>
                                                                ))}
                                                            </CommandGroup>
                                                        )}
                                                        {watch('name') && !existingNames.includes(watch('name')) && (
                                                            <CommandEmpty className="py-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setNamePopoverOpen(false)}
                                                                    className="w-full text-left px-2 py-1.5 text-sm text-blue-600 hover:bg-accent rounded-sm"
                                                                >
                                                                    Use "{watch('name')}"
                                                                </button>
                                                            </CommandEmpty>
                                                        )}
                                                    </CommandList>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
                                    </div>
                                    <div className="space-y-1.5 md:col-span-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Category <span className="text-red-500">*</span>
                                        </label>
                                        <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                                            <PopoverTrigger asChild>
                                                <button
                                                    type="button"
                                                    role="combobox"
                                                    aria-expanded={categoryPopoverOpen}
                                                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                        errors.category ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                >
                                                    <span className={watch('category') ? '' : 'text-gray-400'}>
                                                        {watch('category') || 'Select or type category...'}
                                                    </span>
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg" align="start">
                                                <Command className="bg-transparent">
                                                    <CommandInput
                                                        placeholder="Search or type new..."
                                                        className="bg-white dark:bg-gray-800"
                                                        value={watch('category')}
                                                        onValueChange={(v) => {
                                                            setValue('category', v, { shouldValidate: true })
                                                        }}
                                                    />
                                                    <CommandList>
                                                        {existingCategories.length > 0 && (
                                                            <CommandGroup heading="Existing categories">
                                                                {existingCategories.map((cat) => (
                                                                    <CommandItem
                                                                        key={cat}
                                                                        value={cat}
                                                                        onSelect={() => {
                                                                            setValue('category', cat, { shouldValidate: true })
                                                                            setCategoryPopoverOpen(false)
                                                                        }}
                                                                    >
                                                                        <Check
                                                                            className={cn(
                                                                                'mr-2 h-4 w-4',
                                                                                watch('category') === cat ? 'opacity-100' : 'opacity-0'
                                                                            )}
                                                                        />
                                                                        {cat}
                                                                    </CommandItem>
                                                                ))}
                                                            </CommandGroup>
                                                        )}
                                                        {watch('category') && !existingCategories.includes(watch('category')) && (
                                                            <CommandEmpty className="py-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setCategoryPopoverOpen(false)}
                                                                    className="w-full text-left px-2 py-1.5 text-sm text-blue-600 hover:bg-accent rounded-sm"
                                                                >
                                                                    Use "{watch('category')}"
                                                                </button>
                                                            </CommandEmpty>
                                                        )}
                                                    </CommandList>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                        {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category.message}</p>}
                                    </div>
                                    <div className="space-y-1.5 md:col-span-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                                        <textarea
                                            {...register('description')}
                                            rows={3}
                                            placeholder={itemType === 'SERVICE' ? 'Describe the service details...' : 'Product description...'}
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white resize-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════ STEP 2: PRICING ══════ */}
                    {currentStep === 'pricing' && (
                        <div className="space-y-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Pricing</h2>

                            <div ref={setSectionRef('pricing-tax')}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Sales Price <span className="text-red-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 dark:text-gray-400">RWF</span>
                                            <input
                                                {...bindField('unitPrice', 'purchasePrice')}
                                                type="number"
                                                inputMode="decimal"
                                                step="0.01"
                                                min="0"
                                                placeholder="0.00"
                                                className={`w-full pl-14 pr-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                    errors.unitPrice ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                }`}
                                            />
                                        </div>
                                        {errors.unitPrice && <p className="text-xs text-red-500 mt-1">{errors.unitPrice.message}</p>}
                                    </div>
                                    {itemType !== 'SERVICE' && (
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                Purchase Price
                                            </label>
                                            <div className="relative">
                                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 dark:text-gray-400">RWF</span>
                                                <input
                                                    {...bindField('purchasePrice', 'taxCode')}
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min="0"
                                                    placeholder="0.00"
                                                    className={`w-full pl-14 pr-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                        errors.purchasePrice ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                />
                                            </div>
                                            <p className="text-xs text-gray-400">What you paid for this stock — used for cost/profit tracking.</p>
                                            {errors.purchasePrice && <p className="text-xs text-red-500 mt-1">{errors.purchasePrice.message}</p>}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {itemType !== 'SERVICE' && (
                                <div>
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                                        Additional Price Tiers
                                    </label>
                                    <p className="text-xs text-gray-400 mb-2">
                                        Optional RRA group prices (e.g. wholesale/retail tiers) — leave blank if not used.
                                    </p>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                        {PRICE_TIER_FIELDS.map(({ field, label }, index) => (
                                            <div key={field} className="space-y-1">
                                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
                                                <input
                                                    {...bindField(field, PRICE_TIER_FIELDS[index + 1]?.field ?? 'taxCode')}
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min="0"
                                                    placeholder="0.00"
                                                    className={`w-full px-3 py-2 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                        (errors as any)[field] ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Tax Category <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        {...bindField('taxCode', 'batchNumber')}
                                        className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                            errors.taxCode ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                        }`}
                                    >
                                        <option value="">Select tax category (A, B or C)</option>
                                        {taxOptions.map(tc => (
                                            <option key={tc.code} value={tc.code}>{tc.label}</option>
                                        ))}
                                    </select>
                                    {errors.taxCode && <p className="text-xs text-red-500 mt-1">{errors.taxCode.message}</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════ STEP: INVENTORY ══════ */}
                    {currentStep === 'inventory' && (
                        <div className="space-y-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                                {itemType === 'SERVICE' ? 'RRA Registration' : 'Inventory & Stock'}
                            </h2>

                            {itemType === 'SERVICE' && (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Services are not stock-tracked, but RRA still requires packaging, quantity unit, and origin to register the item.
                                </p>
                            )}

                            {itemType !== 'SERVICE' && (
                                <div ref={setSectionRef('inventory-details')}>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Batch Number</label>
                                            <input
                                                {...bindField('batchNumber', 'expiryDate')}
                                                placeholder="e.g. BATCH-001"
                                                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Expiry Date</label>
                                            <input
                                                {...bindField('expiryDate', 'minStock')}
                                                type="date"
                                                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                Min Stock <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                {...bindField('minStock', 'measurementUnit')}
                                                type="number"
                                                inputMode="numeric"
                                                min="0"
                                                placeholder="10"
                                                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                    errors.minStock ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                }`}
                                            />
                                            {errors.minStock && <p className="text-xs text-red-500 mt-1">{errors.minStock.message}</p>}
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                Measurement Unit <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                {...bindField('measurementUnit', 'pkgUnitCd')}
                                                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                    errors.measurementUnit ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                }`}
                                            >
                                                <option value="">Select Unit</option>
                                                {MEASUREMENT_UNIT_OPTIONS.map(u => (
                                                    <option key={u.value} value={u.value}>{u.label}</option>
                                                ))}
                                            </select>
                                            {errors.measurementUnit && <p className="text-xs text-red-500 mt-1">{errors.measurementUnit.message}</p>}
                                        </div>
                                        <div className="space-y-1.5">
                                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                 Packaging Unit <span className="text-red-500">*</span>
                                             </label>
                                             <select
                                                 {...bindField('pkgUnitCd', 'qtyUnitCd')}
                                                 className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                     errors.pkgUnitCd ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                 }`}
                                             >
                                                 <option value="">Select packaging (e.g. Box, Carton)</option>
                                                 {pkgOptions.map(u => (
                                                     <option key={u.value} value={u.value}>{u.label}</option>
                                                 ))}
                                             </select>
                                             {errors.pkgUnitCd && <p className="text-xs text-red-500 mt-1">{errors.pkgUnitCd.message}</p>}
                                         </div>
                                         <div className="space-y-1.5">
                                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                 RRA Quantity Unit
                                             </label>
                                             <select
                                                 {...bindField('qtyUnitCd', 'packagingQty')}
                                                 className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white"
                                             >
                                                 <option value="">Auto-detect from measurement unit</option>
                                                 {qtyOptions.map(u => (
                                                     <option key={u.value} value={u.value}>{u.label}</option>
                                                 ))}
                                             </select>
                                             <p className="text-xs text-gray-400">Override the automatically derived RRA quantity unit code if needed.</p>
                                         </div>
                                         <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                Qty per Package
                                            </label>
                                            <input
                                                {...bindField('packagingQty', 'origin')}
                                                type="number"
                                                inputMode="numeric"
                                                min="1"
                                                placeholder="e.g. 24"
                                                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                    errors.packagingQty ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                }`}
                                            />
                                            {errors.packagingQty && <p className="text-xs text-red-500 mt-1">{errors.packagingQty.message}</p>}
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                Origin <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                {...bindField('origin', 'barcode')}
                                                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                    errors.origin ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                                }`}
                                            >
                                                <option value="">{countryOptions.length ? 'Select origin country' : 'Sync RRA codes to load countries'}</option>
                                                {countryOptions.map(c => (
                                                    <option key={c.value} value={c.value}>{c.label}</option>
                                                ))}
                                            </select>
                                            {errors.origin && <p className="text-xs text-red-500 mt-1">{errors.origin.message}</p>}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {itemType === 'SERVICE' && (
                                <div ref={setSectionRef('service-rra-units')} className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Packaging Unit <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            {...bindField('pkgUnitCd', 'qtyUnitCd')}
                                            className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                errors.pkgUnitCd ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                            }`}
                                        >
                                            <option value="">Select packaging</option>
                                            {pkgOptions.map(u => (
                                                <option key={u.value} value={u.value}>{u.label}</option>
                                            ))}
                                        </select>
                                        {errors.pkgUnitCd && <p className="text-xs text-red-500 mt-1">{errors.pkgUnitCd.message}</p>}
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            RRA Quantity Unit <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            {...bindField('qtyUnitCd', 'origin')}
                                            className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                errors.qtyUnitCd ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                            }`}
                                        >
                                            <option value="">Select quantity unit</option>
                                            {qtyOptions.map(u => (
                                                <option key={u.value} value={u.value}>{u.label}</option>
                                            ))}
                                        </select>
                                        {errors.qtyUnitCd && <p className="text-xs text-red-500 mt-1">{errors.qtyUnitCd.message}</p>}
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Origin <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            {...bindField('origin', 'itemClsCd')}
                                            className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                errors.origin ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                            }`}
                                        >
                                            <option value="">{countryOptions.length ? 'Select origin country' : 'Sync RRA codes to load countries'}</option>
                                            {countryOptions.map(c => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                        {errors.origin && <p className="text-xs text-red-500 mt-1">{errors.origin.message}</p>}
                                    </div>
                                    {itemCdPreview && (
                                        <div className="md:col-span-3 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-4 py-3">
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Item code preview</p>
                                            <p className="text-sm font-mono text-gray-800 dark:text-gray-200">{itemCdPreview}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ══════ STEP: RRA DETAILS ══════ */}
                    {currentStep === 'details' && (
                        <div className="space-y-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Additional Details</h2>

                            <div ref={setSectionRef('additional-info')}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Barcode</label>
                                        <input
                                            {...bindField('barcode', 'itemClsCd')}
                                            inputMode="numeric"
                                            maxLength={13}
                                            placeholder="e.g. 8901234567890"
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <RraItemClassPicker
                                            value={watch('itemClsCd') || ''}
                                            onChange={(code) => setValue('itemClsCd', code, { shouldValidate: true, shouldDirty: true })}
                                            invalid={!!errors.itemClsCd}
                                            required
                                        />
                                        {errors.itemClsCd && <p className="text-xs text-red-500 mt-1">{errors.itemClsCd.message}</p>}
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Standard Name</label>
                                        <input
                                            {...bindField('itemStandardName', 'additionalInfo')}
                                            placeholder="Optional standardized name"
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Additional Info</label>
                                        <input
                                            {...bindField('additionalInfo', '')}
                                            maxLength={7}
                                            placeholder="Up to 7 characters"
                                            className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:bg-gray-900 dark:text-white ${
                                                errors.additionalInfo ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                                            }`}
                                        />
                                        {errors.additionalInfo && <p className="text-xs text-red-500 mt-1">{errors.additionalInfo.message}</p>}
                                    </div>
                                    <div className="space-y-1.5 md:col-span-2">
                                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                            <input type="checkbox" {...register('useInsurance')} className="h-4 w-4 rounded border-gray-300 dark:border-gray-600" />
                                            Billable to customer insurance
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════ STEP 5: REVIEW & CONFIRM ══════ */}
                    {currentStep === 'review' && (
                        <div className="space-y-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Review & Confirm</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Please review the information below before saving.</p>

                            <div className="space-y-4">
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                    <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Basic Information</h3>
                                    </div>
                                    <div className="px-4 py-3 space-y-2.5">
                                        <ReviewRow label="Item Type" value={itemType === 'PRODUCT' ? 'Product' : itemType === 'RAW_MATERIAL' ? 'Raw Material' : 'Service'} />
                                        <ReviewRow label="Name" value={watch('name') || '-'} />
                                        <ReviewRow label="Category" value={watch('category') || '-'} />
                                        {watch('description') && <ReviewRow label="Description" value={watch('description')} />}
                                        {imagePreview && (
                                            <div className="flex justify-between items-start">
                                                <span className="text-sm text-gray-500 dark:text-gray-400">Image</span>
                                                <img src={imagePreview} alt="Preview" className="h-12 w-12 object-cover rounded-md border" />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                    <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pricing & Tax</h3>
                                    </div>
                                    <div className="px-4 py-3 space-y-2.5">
                                        <ReviewRow label="Sales Price" value={watch('unitPrice') ? `RWF ${Number(watch('unitPrice')).toLocaleString()}` : '-'} />
                                        {watch('purchasePrice') !== undefined && watch('purchasePrice') !== null && (
                                            <ReviewRow label="Purchase Price" value={`RWF ${Number(watch('purchasePrice')).toLocaleString()}`} />
                                        )}
                                        {PRICE_TIER_FIELDS.map(({ field, label }) => {
                                            const value = watch(field)
                                            return value !== undefined && value !== null
                                                ? <ReviewRow key={field} label={label} value={`RWF ${Number(value).toLocaleString()}`} />
                                                : null
                                        })}
                                        <ReviewRow label="Tax Category" value={watch('taxCode') ? taxCodes.find(t => t.code === watch('taxCode'))?.label || watch('taxCode') : '-'} />
                                        {watch('unitPrice') && watch('taxCode') && (
                                            <>
                                                <ReviewRow label="Taxable Amount" value={`RWF ${taxPreview.taxable.toFixed(2)}`} />
                                                <ReviewRow label="VAT" value={`RWF ${taxPreview.vat.toFixed(2)}`} />
                                            </>
                                        )}
                                    </div>
                                </div>

                                {itemType !== 'SERVICE' && (
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Inventory Details</h3>
                                        </div>
                                        <div className="px-4 py-3 space-y-2.5">
                                            {watch('batchNumber') && <ReviewRow label="Batch Number" value={watch('batchNumber')} />}
                                            {watch('expiryDate') && <ReviewRow label="Expiry Date" value={new Date(watch('expiryDate')!).toLocaleDateString()} />}
                                            <ReviewRow label="Min Stock" value={String(watch('minStock') ?? 0)} />
                                            <ReviewRow label="Measurement Unit" value={watch('measurementUnit') || 'PCS'} />
                                            {watch('pkgUnitCd') && (
                                                <ReviewRow
                                                    label="Packaging"
                                                    value={`${pkgOptions.find(u => u.value === watch('pkgUnitCd'))?.label || watch('pkgUnitCd')}${watch('packagingQty') ? ` × ${watch('packagingQty')}` : ''}`}
                                                />
                                            )}
                                            {itemCdPreview && (
                                                <ReviewRow
                                                    label="Item Code (Preview)"
                                                    value={`${itemCdPreview} (sequence assigned on save)`}
                                                />
                                            )}
                                            <ReviewRow label="Origin" value={countryOptions.find(c => c.value === watch('origin'))?.label || watch('origin') || '—'} />
                                        </div>
                                    </div>
                                )}

                                {itemType === 'SERVICE' && (
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">RRA Registration</h3>
                                        </div>
                                        <div className="px-4 py-3 space-y-2.5">
                                            <ReviewRow
                                                label="Packaging"
                                                value={pkgOptions.find(u => u.value === watch('pkgUnitCd'))?.label || watch('pkgUnitCd') || '-'}
                                            />
                                            <ReviewRow
                                                label="Quantity Unit"
                                                value={qtyOptions.find(u => u.value === watch('qtyUnitCd'))?.label || watch('qtyUnitCd') || '-'}
                                            />
                                            <ReviewRow label="Origin" value={countryOptions.find(c => c.value === watch('origin'))?.label || watch('origin') || '—'} />
                                            {itemCdPreview && (
                                                <ReviewRow
                                                    label="Item Code (Preview)"
                                                    value={`${itemCdPreview} (sequence assigned on save)`}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {itemType === 'PRODUCT' && !product && bomComponents.length > 0 && (
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Bill of Materials</h3>
                                        </div>
                                        <div className="px-4 py-3 space-y-2.5">
                                            {bomComponents.map((component) => {
                                                const material = rawMaterials.find((item) => item.id === component.componentProductId)
                                                return <ReviewRow key={component.componentProductId} label={material?.name || `Item #${component.componentProductId}`} value={`${component.quantity} ${component.unit} per product`} />
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                    <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Additional Info</h3>
                                    </div>
                                    <div className="px-4 py-3 space-y-2.5">
                                        {watch('barcode') && <ReviewRow label="Barcode" value={watch('barcode')} />}
                                        <ReviewRow label="Class Code" value={watch('itemClsCd') || '-'} />
                                        {watch('itemStandardName') && <ReviewRow label="Standard Name" value={watch('itemStandardName')} />}
                                        {watch('additionalInfo') && <ReviewRow label="Additional Info" value={watch('additionalInfo')} />}
                                        {watch('useInsurance') && <ReviewRow label="Insurance" value="Billable" />}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════ STEP: BILL OF MATERIALS ══════ */}
                    {currentStep === 'bom' && itemType === 'PRODUCT' && (
                        <div className="space-y-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Bill of Materials</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Add the raw materials needed to produce one unit of this product. They will be saved with the product.
                            </p>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <select
                                    aria-label="Select raw material"
                                    value={selectedRawMaterialId}
                                    onChange={(event) => setSelectedRawMaterialId(event.target.value)}
                                    disabled={rawMaterialsLoading}
                                    className="flex-1 min-w-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-800 dark:text-white"
                                >
                                    <option value="">{rawMaterialsLoading ? 'Loading raw materials...' : 'Select a raw material'}</option>
                                    {rawMaterials.filter((material) => !bomComponents.some((component) => component.componentProductId === material.id)).map((material) => (
                                        <option key={material.id} value={material.id}>
                                            {material.name} — Stock: {material.quantity} {material.measurementUnit || 'PCS'}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={addBomMaterial}
                                    disabled={!selectedRawMaterialId || rawMaterialsLoading}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    <Plus className="h-4 w-4" /> Add Material
                                </button>
                            </div>
                            {!rawMaterialsLoading && rawMaterials.length === 0 && (
                                <p className="text-sm text-amber-700 dark:text-amber-300">
                                    No raw materials are available in this branch. Add an item with type Raw Material first.
                                </p>
                            )}
                            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                                <Table>
                                    <TableHeader className="bg-gray-50 dark:bg-gray-800">
                                        <TableRow>
                                            <TableHead>Raw Material</TableHead>
                                            <TableHead>Qty per Unit</TableHead>
                                            <TableHead>Unit</TableHead>
                                            <TableHead className="text-right">Cost per Product</TableHead>
                                            <TableHead className="w-12"><span className="sr-only">Remove</span></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {bomComponents.length === 0 ? (
                                            <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-gray-500">No raw materials added yet</TableCell></TableRow>
                                        ) : bomComponents.map((component) => {
                                            const material = rawMaterials.find((item) => item.id === component.componentProductId)
                                            const unitCost = Number(material?.purchasePrice ?? material?.unitPrice ?? 0)
                                            return (
                                                <TableRow key={component.componentProductId}>
                                                    <TableCell className="min-w-36 font-medium">{material?.name || `Item #${component.componentProductId}`}</TableCell>
                                                    <TableCell>
                                                        <input
                                                            aria-label={`Quantity per unit for ${material?.name || 'raw material'}`}
                                                            type="number"
                                                            min="0.001"
                                                            step="0.001"
                                                            value={component.quantity}
                                                            onChange={(event) => setBomComponents((components) => components.map((entry) => entry.componentProductId === component.componentProductId ? { ...entry, quantity: event.target.value } : entry))}
                                                            className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-sm">{component.unit}</TableCell>
                                                    <TableCell className="whitespace-nowrap text-right text-sm">
                                                        {(unitCost * (Number(component.quantity) || 0)).toLocaleString()} Frw
                                                    </TableCell>
                                                    <TableCell>
                                                        <button
                                                            type="button"
                                                            aria-label={`Remove ${material?.name || 'raw material'}`}
                                                            onClick={() => setBomComponents((components) => components.filter((entry) => entry.componentProductId !== component.componentProductId))}
                                                            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                                                        ><Trash2 className="h-4 w-4" /></button>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                            {bomComponents.length > 0 && (
                                <p className="text-right text-sm font-semibold text-gray-900 dark:text-white">
                                    Estimated material cost per product: {bomComponents.reduce((total, component) => {
                                        const material = rawMaterials.find((item) => item.id === component.componentProductId)
                                        return total + Number(material?.purchasePrice ?? material?.unitPrice ?? 0) * (Number(component.quantity) || 0)
                                    }, 0).toLocaleString()} Frw
                                </p>
                            )}
                        </div>
                    )}

                    {/* ── Navigation Buttons ── */}
                    <div className="flex items-center justify-between gap-3 pt-6 pb-2 border-t border-gray-100 dark:border-gray-700 mt-6">
                        <div>
                            {!isFirstStep && (
                                <button
                                    type="button"
                                    onClick={handlePrevious}
                                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Previous
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => onSuccess ? onSuccess() : navigate('/dashboard/inventory-all')}
                                className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
                            >
                                Cancel
                            </button>
                            {!isLastStep ? (
                                <button
                                    type="button"
                                    onClick={handleNext}
                                    className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-lg shadow-blue-500/20"
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    disabled={isSubmitting || isUploadingImage}
                                    onClick={handleSubmit(onSubmit, () => toast.error('Please fix the highlighted fields before saving'))}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
                                >
                                    {isSubmitting ? (
                                        <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <Save className="h-4 w-4" />
                                    )}
                                    Save {itemType === 'SERVICE' ? 'Service' : itemType === 'RAW_MATERIAL' ? 'Raw Material' : 'Product'}
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right max-w-[60%] break-words">{value}</span>
        </div>
    )
}

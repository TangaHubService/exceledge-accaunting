import {
  useState, useEffect, useMemo, useCallback, memo, useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../components/ui/select'
import {
  ShoppingCart, Loader2, UserPlus, Search, X, WifiOff,
  Package, Minus, Plus, Trash2, Star,
  ChevronRight, FileText,
} from 'lucide-react'
import PhoneInputWithCountryCode from '../../../components/PhoneInputWithCountryCode'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '../../../components/ui/drawer'
import { toast } from 'react-toastify'
import { apiClient } from '../../../lib/api-client'
import { parseInventoryGetProductsResponse } from '../../../lib/inventory-response'
import { offlineQueue } from '../../../utils/offlineQueue'
import { PaymentModal } from '../../../components/pos/PaymentModal'
import SaleSuccessModal, { type SaleSuccessData } from '../../../components/pos/SaleSuccessModal'
import { getInvoiceFilename, round2, unwrapInvoice } from '../../../lib/invoice'
import { issueInvoicePdfBlob } from '../../../lib/invoice-pdf'
import { useVsdcOnlineStatus } from '../../../hooks/useVsdcOnlineStatus'
import { useBranch } from '../../../context/BranchContext'
import { useOrganizationSettings } from '../../../context/OrganizationSettingsContext'
import { cn } from '../../../lib/utils'
import { PACKAGING_UNIT_LABELS } from '../../../types/ebm'
import { useRraCodeCatalog } from '../../../lib/useRraCodeCatalog'

// ── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string
  name: string
  price: number
  stock: number
  quantity: number
  unitPrice?: number
  batchNumber: string
  expiryDate: string
  imageUrl?: string
  category?: string
  taxCode?: string
  itemType?: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE'
  barcode?: string
  sku?: string
  pkgUnitCd?: string
  packagingQty?: number
}

const isSellable = (p: Product, trainingMode = false) =>
  p.itemType === 'SERVICE' || p.quantity > 0 || trainingMode

interface Customer {
  id: string
  name: string
  email?: string
  phone?: string
  type: string
}

export interface CartItem {
  product: Product
  quantity: number
  unitPrice: number
}

function productsFromInventoryResponse(res: unknown): Product[] {
  // Backend Decimal(15,3) quantities serialize as strings — normalize to
  // numbers once here so every comparison and cart computation below is safe.
  return parseInventoryGetProductsResponse(res).items.map((raw) => {
    const p = raw as Record<string, unknown>
    return {
      ...(p as object),
      price: Number(p.price ?? p.unitPrice ?? 0),
      stock: Number(p.stock ?? p.quantity ?? 0),
      quantity: Number(p.quantity ?? 0),
      unitPrice: p.unitPrice != null ? Number(p.unitPrice) : undefined,
    } as Product
  })
}

// ── ProductCard ───────────────────────────────────────────────────────────────

const ProductCard = memo(({
  product, onAddToCart, isFavorite, onToggleFavorite, allowZeroStock = false,
}: {
  product: Product
  onAddToCart: (p: Product) => void
  isFavorite: boolean
  onToggleFavorite: (id: string) => void
  allowZeroStock?: boolean
}) => {
  const isService = product.itemType === 'SERVICE'
  const isLowStock = !isService && product.quantity > 0 && product.quantity <= 5
  const isOutOfStock = !isService && product.quantity <= 0
  const canAdd = !isOutOfStock || allowZeroStock

  return (
    <div className="relative flex flex-col rounded-2xl border border-gray-100 bg-white overflow-hidden group transition-all duration-200 hover:shadow-md hover:border-blue-200">
      {/* Favorite button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(product.id) }}
        className="absolute top-2 right-2 z-10 p-1 rounded-full bg-white/80 backdrop-blur-sm text-gray-300 hover:text-amber-400 transition-colors"
      >
        <Star className={cn('h-3.5 w-3.5', isFavorite && 'text-amber-400 fill-amber-400')} />
      </button>

      {/* Image / Initial */}
      <button
        type="button"
        onClick={() => canAdd && onAddToCart(product)}
        disabled={!canAdd}
        className="w-full h-24 flex items-center justify-center bg-blue-50 overflow-hidden flex-shrink-0 disabled:cursor-not-allowed"
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl font-bold text-blue-300">
            {product.name.charAt(0).toUpperCase()}
          </span>
        )}
      </button>

      {/* Content */}
      <button
        type="button"
        onClick={() => canAdd && onAddToCart(product)}
        disabled={!canAdd}
        className="flex flex-col flex-1 p-3 text-left disabled:cursor-not-allowed"
      >
        <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-snug mb-2 flex-1">
          {product.name}
        </p>
        {product.pkgUnitCd && (
          <p className="text-[10px] text-gray-400 mb-0.5">
            {PACKAGING_UNIT_LABELS[product.pkgUnitCd] || product.pkgUnitCd}
            {product.packagingQty ? ` × ${product.packagingQty}` : ''}
          </p>
        )}
        <p className="text-sm font-bold text-blue-600 tabular-nums">
          {(product.unitPrice ?? product.price ?? 0).toLocaleString()} <span className="text-xs font-normal text-gray-400">RWF</span>
        </p>
        <p className={cn(
          'text-[10px] mt-1 font-medium',
          isOutOfStock ? (allowZeroStock ? 'text-amber-500' : 'text-red-500') : isLowStock ? 'text-amber-500' : 'text-emerald-500',
        )}>
          {isService ? 'Service' : isOutOfStock ? (allowZeroStock ? `${product.quantity} in stock` : 'Out of stock') : isLowStock ? `Low: ${product.quantity} left` : `${product.quantity} in stock`}
        </p>
      </button>
    </div>
  )
})

// ── CartItemRow ───────────────────────────────────────────────────────────────

const CartItemRow = memo(({
  item, onRemove, onUpdateQuantity, onUpdatePrice, priceEditable = true, vatRegistered = true,
}: {
  item: CartItem
  onRemove: (id: string) => void
  onUpdateQuantity: (id: string, qty: number) => void
  onUpdatePrice: (id: string, price: number | string) => void
  priceEditable?: boolean
  vatRegistered?: boolean
}) => {
  const [quantityInput, setQuantityInput] = useState(String(item.quantity))
  const [editingQty, setEditingQty] = useState(false)

  const commitQty = () => {
    // Fractional quantities allowed (weighed goods: kg, litres…).
    const n = Number(quantityInput)
    if (Number.isFinite(n) && n > 0) onUpdateQuantity(item.product.id, Math.round(n * 1000) / 1000)
    else setQuantityInput(String(item.quantity))
    setEditingQty(false)
  }

  const lineTotal = (item.unitPrice * item.quantity).toLocaleString()
  const effectiveTaxCode = vatRegistered ? (item.product.taxCode || '—') : 'D'

  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-gray-50 last:border-b-0">
      {/* Thumbnail */}
      <div className="h-11 w-11 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center bg-blue-50">
        {item.product.imageUrl ? (
          <img src={item.product.imageUrl} alt={item.product.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-blue-400">
            {item.product.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name + Price */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 truncate">{item.product.name}</p>
        <p className="text-xs text-blue-600 font-medium tabular-nums mt-0.5">
          {item.unitPrice.toLocaleString()} RWF
        </p>
        <span className={`inline-block mt-0.5 rounded px-1 py-px text-[10px] font-bold ${effectiveTaxCode === 'B' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
          {effectiveTaxCode}
        </span>
      </div>

      {/* Qty Controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => onUpdateQuantity(item.product.id, Math.max(1, item.quantity - 1))}
          className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600 transition-colors"
        >
          <Minus className="h-3 w-3" />
        </button>

        {editingQty ? (
          <input
            type="number"
            min={1}
            max={item.product.itemType === 'SERVICE' ? undefined : item.product.quantity}
            value={quantityInput}
            onChange={e => setQuantityInput(e.target.value)}
            onBlur={commitQty}
            onKeyDown={e => e.key === 'Enter' && commitQty()}
            className="w-9 px-1 py-0.5 text-xs border rounded-lg text-center bg-white border-blue-300 text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingQty(true)}
            className="w-9 text-xs text-center font-bold text-gray-800 hover:text-blue-600 transition-colors"
          >
            {item.quantity}
          </button>
        )}

        <button
          type="button"
          onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
          className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600 transition-colors"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Line total + remove */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0 min-w-[60px]">
        {priceEditable ? (
          <input
            type="number"
            min={0}
            value={item.unitPrice === null ? '' : item.unitPrice}
            onChange={e => {
              const v = e.target.value
              if (v === '') { onUpdatePrice(item.product.id, ''); return }
              const n = parseFloat(v)
              if (!isNaN(n) && n >= 0) onUpdatePrice(item.product.id, n)
            }}
            className="w-16 text-right text-[11px] border rounded-lg px-1.5 py-0.5 bg-white border-gray-200 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <p className="text-xs font-bold tabular-nums text-gray-800">{lineTotal} <span className="text-gray-400 font-normal">RWF</span></p>
        )}
        <button
          type="button"
          onClick={() => onRemove(item.product.id)}
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})

// ── AddCustomerDrawer ─────────────────────────────────────────────────────────

const AddCustomerDrawer = memo(({
  onCustomerAdded, isOpen, onOpenChange,
}: {
  onCustomerAdded: (c: Customer) => void
  isOpen: boolean
  onOpenChange: (v: boolean) => void
}) => {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', countryCode: '+250', type: 'INDIVIDUAL', tin: '',
  })

  const handlePhoneChange = (phone: string, countryCode: string) => {
    setFormData(prev => ({ ...prev, phone, countryCode }))
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!formData.name.trim()) errs.name = t('validation.required')
    if (formData.phone && formData.phone.length < 10) errs.phone = t('validation.invalidPhone')
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = t('validation.invalidEmail')
    const tinDigits = formData.tin.trim()
    if (formData.type !== 'INDIVIDUAL' && !/^\d{9}$/.test(tinDigits)) {
      errs.tin = 'TIN is required for corporate and insurance customers'
    } else if (tinDigits && !/^\d{9}$/.test(tinDigits)) {
      // Individuals may also hold a real RRA TIN — optional, but when given
      // it must be a valid 9-digit TIN (it is sent to RRA on the receipt).
      errs.tin = 'TIN must be exactly 9 digits'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    try {
      const phone = formData.phone
        ? (formData.phone.startsWith('+') ? formData.phone : `${formData.countryCode}${formData.phone}`)
        : undefined
      const { countryCode, ...rest } = { ...formData, phone }
      // A TIN may be stored for every customer type (blank stays blank).
      const tin = formData.tin.trim() || undefined
      const newCustomer = await apiClient.createCustomer({ ...rest, tin })
      toast.success(t('messages.customerCreated'))
      onCustomerAdded(newCustomer)
      onOpenChange(false)
      setFormData({ name: '', email: '', phone: '', countryCode: '+250', type: 'INDIVIDUAL', tin: '' })
      setErrors({})
    } catch {
      toast.error(t('messages.saveError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-md">
        <DrawerHeader>
          <DrawerTitle>{t('pos.addNewCustomer')}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-1.5">
            <Label>{t('pos.customerName')} *</Label>
            <Input name="name" value={formData.name} onChange={handleChange} placeholder={t('pos.customerNamePlaceholder')} />
            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('pos.phoneNumber')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span></Label>
            <PhoneInputWithCountryCode
              value={formData.phone}
              countryCode={formData.countryCode}
              onChange={handlePhoneChange}
              placeholder={t('pos.phoneNumberPlaceholder')}
              error={errors.phone || ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('pos.emailOptional')}</Label>
            <Input type="email" name="email" value={formData.email} onChange={handleChange} placeholder={t('pos.emailPlaceholder')} />
            {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('pos.customerType')}</Label>
            <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INDIVIDUAL">{t('customers.individual')}</SelectItem>
                <SelectItem value="CORPORATE">{t('pos.corporate')}</SelectItem>
                <SelectItem value="INSURANCE">{t('pos.insurance')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              {t('customers.tinNumber')}{' '}
              {formData.type !== 'INDIVIDUAL'
                ? <span className="text-red-500">*</span>
                : <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>}
            </Label>
            <Input
              name="tin"
              value={formData.tin}
              onChange={e => setFormData(p => ({ ...p, tin: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
              placeholder="e.g. 123456789"
              maxLength={9}
              inputMode="numeric"
            />
            {errors.tin && <p className="text-xs text-red-500">{errors.tin}</p>}
            {formData.type === 'INDIVIDUAL' && !errors.tin && (
              <p className="text-xs text-gray-500">Optional — sent to RRA on the receipt when the individual has a real TIN.</p>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">{t('common.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('pos.addCustomer')}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
})

// ── Main Component ────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Medicines', 'Health & Care', 'Baby Care', 'Vitamins', 'Medical Devices', 'Supplements']

export default function SalesForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { selectedBranchId } = useBranch()
  const { settings: orgSettings } = useOrganizationSettings()
  const { catalog } = useRraCodeCatalog()
  const { trainingMode } = useVsdcOnlineStatus()

  const [cart, setCart] = useState<CartItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isSuccessOpen, setIsSuccessOpen] = useState(false)
  const [successSale, setSuccessSale] = useState<SaleSuccessData | null>(null)
  const [lastCreatedSale, setLastCreatedSale] = useState<any>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [isSyncing, setIsSyncing] = useState(false)
  const [displayedCount, setDisplayedCount] = useState(30)
  const [activeCategory, setActiveCategory] = useState('All')
  const [productTypeFilter, setProductTypeFilter] = useState<'ALL' | 'PRODUCT' | 'SERVICE'>('ALL')
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  const LOAD_STEP = 15
  const productsRef = useRef<HTMLDivElement | null>(null)
  const isLoadingMoreRef = useRef(false)
  const customerDropdownRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Online / offline listeners
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // CIS §7.28 — after power/paper recovery, offer to reprint the last finalized receipt.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const flag = sessionStorage.getItem('pos-recovery-checked')
        if (flag === '1') return
        sessionStorage.setItem('pos-recovery-checked', '1')
        const res = await apiClient.getLastReceipt()
        const sale = (res as any)?.data?.sale ?? (res as any)?.sale
        if (cancelled || !sale?.id) return
        toast.info(
          `Last receipt ${sale.saleNumber} available for recovery reprint`,
          {
            autoClose: 12_000,
            onClick: async () => {
              try {
                // Printing from the modal registers the issuance itself, so a
                // receipt already issued comes back as its CS/CR copy.
                setSuccessSale({
                  id: sale.id,
                  invoiceNumber: sale.invoiceNumber,
                  receiptNumber: sale.saleNumber,
                  totalAmount: Number(sale.totalAmount),
                  fiscalizationStatus: 'success',
                })
                setIsSuccessOpen(true)
              } catch (e: any) {
                toast.error(e?.message ?? 'Failed to reprint last receipt')
              }
            },
          },
        )
      } catch {
        /* no recoverable receipt — ignore */
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Close customer dropdown on outside click
  useEffect(() => {
    if (!showCustomerDropdown) return
    const handle = (e: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false)
        setCustomerSearch('')
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showCustomerDropdown])

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)
      if (!isOnline) {
        setProducts(offlineQueue.getProducts())
        setCustomers(offlineQueue.getCustomers())
        return
      }
      const [productsData, customersData] = await Promise.all([
        apiClient.getProducts({ page: 1, limit: 10000, search: '', branchId: selectedBranchId }),
        apiClient.getCustomers({ page: 1, limit: 100, search: '' }),
      ])
      const all = productsFromInventoryResponse(productsData).filter(p => isSellable(p, trainingMode))
      setProducts(all)
      setDisplayedCount(30)
      const allCustomers = customersData.customers || []
      setCustomers(allCustomers)
      offlineQueue.saveCustomers(allCustomers)
      if (allCustomers.length > 0) {
        setSelectedCustomer(allCustomers[0].id)
      } else {
        try {
          const walkIn = await apiClient.createCustomer({ name: 'Walk-in Customer', type: 'INDIVIDUAL', balance: 0 })
          setCustomers([walkIn])
          offlineQueue.saveCustomers([walkIn])
          setSelectedCustomer(walkIn.id)
        } catch {}
      }
    } catch {
      toast.error(t('pos.loadError'))
      setProducts(offlineQueue.getProducts())
      setCustomers(offlineQueue.getCustomers())
    } finally {
      setIsLoading(false)
    }
  }, [isOnline, selectedBranchId, t, trainingMode])

  useEffect(() => { fetchData() }, [fetchData])

  // Offline sync
  useEffect(() => {
    if (!isOnline || !offlineQueue.hasItems() || isSyncing) return
    const sync = async () => {
      setIsSyncing(true)
      const queue = offlineQueue.getQueue()
      toast.info(t('pos.syncingSales', { count: queue.length }) || `Syncing ${queue.length} offline sales…`)
      for (const item of queue) {
        try { await apiClient.createSale(item.payload); offlineQueue.dequeue(item.id) }
        catch { /* keep item in queue */ }
      }
      setIsSyncing(false)
      if (!offlineQueue.hasItems()) { toast.success(t('pos.syncComplete') || 'Offline sales synchronized.') }
    }
    sync()
  }, [isOnline, isSyncing, t])

  // Product search with debounce
  useEffect(() => {
    if (!searchTerm) {
      fetchData()
      return
    }
    const id = setTimeout(async () => {
      try {
        setIsLoading(true)
        if (!isOnline) {
          const cached = offlineQueue.getProducts()
          const term = searchTerm.toLowerCase()
          setProducts(cached.filter(p =>
            p.name.toLowerCase().includes(term)
            || p.barcode?.toLowerCase().includes(term)
            || p.sku?.toLowerCase().includes(term)
          ))
          return
        }
        const res = await apiClient.getProducts({ page: 1, limit: 10000, search: searchTerm, branchId: selectedBranchId })
        setProducts(productsFromInventoryResponse(res).filter(p => isSellable(p, trainingMode)))
        setDisplayedCount(30)
      } catch { toast.error(t('pos.searchError')) }
      finally { setIsLoading(false) }
    }, 400)
    return () => clearTimeout(id)
  }, [searchTerm, selectedBranchId, isOnline, trainingMode])  // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll
  useEffect(() => {
    const el = productsRef.current
    if (!el) return
    const inStock = products.filter(p => isSellable(p, trainingMode))
    const onScroll = () => {
      if (isLoadingMoreRef.current || displayedCount >= inStock.length) return
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight - scrollTop - clientHeight < 300) {
        isLoadingMoreRef.current = true
        setDisplayedCount(prev => {
          const next = Math.min(prev + LOAD_STEP, inStock.length)
          setTimeout(() => { isLoadingMoreRef.current = false }, 300)
          return next
        })
      }
    }
    let ticking = false
    const throttled = () => {
      if (!ticking) { requestAnimationFrame(() => { onScroll(); ticking = false }); ticking = true }
    }
    el.addEventListener('scroll', throttled, { passive: true })
    const check = setTimeout(onScroll, 100)
    return () => { clearTimeout(check); el.removeEventListener('scroll', throttled) }
  }, [products, displayedCount, trainingMode])

  // Cart helpers
  const addToCart = useCallback((product: Product) => {
    const isService = product.itemType === 'SERVICE'
    const allowNegativeStock = isService || trainingMode || orgSettings.featureFlags.allowNegativeStock
    if (!allowNegativeStock && (!product.quantity || product.quantity < 1)) { toast.error(t('pos.outOfStock')); return }
    setCart(prev => {
      const ex = prev.find(i => i.product.id === product.id)
      if (ex) {
        const nq = ex.quantity + 1
        if (!allowNegativeStock && nq > product.quantity) { toast.error(t('pos.lowStockWarning', { count: product.quantity })); return prev }
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: nq } : i)
      }
      return [...prev, { product, quantity: 1, unitPrice: product.unitPrice ?? product.price ?? 0 }]
    })
    toast.success(t('messages.productAdded'))
  }, [t, orgSettings.featureFlags.allowNegativeStock, trainingMode])

  const removeFromCart = useCallback((id: string) => {
    setCart(prev => prev.filter(i => i.product.id !== id))
  }, [])

  const updateQuantity = useCallback((id: string, qty: number) => {
    if (qty < 1) return
    setCart(prev => prev.map(i => {
      if (i.product.id !== id) return i
      const isService = i.product.itemType === 'SERVICE'
      if (!isService && !trainingMode && !orgSettings.featureFlags.allowNegativeStock && qty > i.product.quantity) {
        toast.error(t('pos.lowStockWarning', { count: i.product.quantity })); return i
      }
      return { ...i, quantity: qty }
    }))
  }, [t, orgSettings.featureFlags.allowNegativeStock, trainingMode])

  const updatePrice = useCallback((id: string, price: number | string) => {
    if (!orgSettings.featureFlags.allowManualDiscounts) return
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, unitPrice: price as number } : i))
  }, [orgSettings.featureFlags.allowManualDiscounts])

  const handleCustomerAdded = useCallback((c: Customer) => {
    setCustomers(prev => [...prev, c])
    setSelectedCustomer(c.id)
  }, [])

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [cart])
  // The business's VAT registration decides the treatment: when the taxpayer is
  // not VAT registered every line is tax code D (0%). When VAT registered, only
  // code B items carry 18% VAT (tax-inclusive: VAT = gross − gross/1.18).
  const vatRegistered = orgSettings.vatRegistered
  const taxRateByCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of catalog.taxTypes) map.set(t.code.toUpperCase(), t.rate)
    return map
  }, [catalog.taxTypes])
  const taxAmount = useMemo(() => cart.reduce((s, i) => {
    const code = vatRegistered ? (i.product.taxCode ?? '').toUpperCase() : 'D'
    const cached = taxRateByCode.get(code)
    const rate = cached ?? (taxRateByCode.size === 0 && code === 'B' ? 18 : 0)
    if (!rate) return s
    const gross = i.unitPrice * i.quantity
    return s + round2(gross - gross / (1 + rate / 100))
  }, 0), [cart, vatRegistered, taxRateByCode])
  const vatLabelRate = taxRateByCode.get('B') ?? (taxRateByCode.size === 0 ? 18 : 0)
  const total = useMemo(() => subtotal, [subtotal])

  const selectedCustomerObj = useMemo(
    () => customers.find(c => c.id === selectedCustomer),
    [customers, selectedCustomer],
  )

  const filteredCustomers = useMemo(
    () => customers.filter(c =>
      customerSearch
        ? c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
          c.phone?.includes(customerSearch)
        : true
    ),
    [customers, customerSearch],
  )

  const inStockProducts = useMemo(() => {
    const base = products.filter(p => isSellable(p, trainingMode))
    const typed = productTypeFilter === 'ALL'
      ? base
      : base.filter(p => (p.itemType ?? 'PRODUCT') === productTypeFilter)
    if (activeCategory === 'All') return typed
    return typed.filter(p => p.category?.toLowerCase() === activeCategory.toLowerCase())
  }, [products, activeCategory, productTypeFilter, trainingMode])

  // A USB/Bluetooth barcode scanner behaves like a keyboard: it types the
  // barcode digits into whichever input is focused, then sends Enter. Since
  // the search box already filters by barcode (server-side), Enter here just
  // needs to add the scanned/matched product straight to the cart.
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !searchTerm.trim()) return
    e.preventDefault()
    const term = searchTerm.trim()
    const exactBarcodeMatch = products.find(p => p.barcode && p.barcode === term)
    const candidate = exactBarcodeMatch ?? (inStockProducts.length === 1 ? inStockProducts[0] : null)
    if (!candidate) return
    addToCart(candidate)
    setSearchTerm('')
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchTerm, products, inStockProducts, addToCart])

  const handleOpenPayment = useCallback(() => {
    if (cart.length === 0) { toast.error(t('pos.noItemsInCart')); return }
    if (!selectedCustomer) { toast.error(t('pos.selectCustomer')); return }
    setIsPaymentModalOpen(true)
  }, [cart, selectedCustomer, t])

  // Poll GET /invoices/:saleId until VSDC confirms (200) or the wait gives up
  // — the endpoint returns 425 while `composeInvoicePayload` is still
  // blocking on fiscalization (RRA checklist §16/§22). Updates the success
  // modal's fiscalizationStatus in place so Print/Download/Share unlock the
  // moment the receipt is actually safe to issue.
  const pollFiscalization = useCallback(async (saleId: string | number) => {
    const maxAttempts = 10
    const stepMs = 1500
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, stepMs))
      try {
        await apiClient.getInvoice(saleId)
        setSuccessSale((prev) => (prev && String(prev.id) === String(saleId) ? { ...prev, fiscalizationStatus: 'success' } : prev))
        return
      } catch (e: any) {
        if (e?.response?.status === 425) continue
        break
      }
    }
    setSuccessSale((prev) => (prev && String(prev.id) === String(saleId) ? { ...prev, fiscalizationStatus: 'failed' } : prev))
  }, [])

  const handleProcessPayment = useCallback(async (
    entries: Array<{ id: string; method: string; amount: number; reference?: string }>,
  ) => {
    try {
      setIsSubmitting(true)
      const totalPaid = entries.reduce((s, p) => s + p.amount, 0)
      const remainingDebt = Math.max(0, total - totalPaid)

      const activeMethods = [...new Set(entries.filter(p => p.amount > 0).map(p => p.method))]
      let paymentType: string = 'CASH'
      if (activeMethods.length > 1 || (activeMethods.length === 1 && remainingDebt > 0 && activeMethods[0] !== 'DEBT')) {
        paymentType = 'MIXED'
      } else if (activeMethods.length === 1) {
        paymentType = activeMethods[0]
      } else if (remainingDebt > 0) {
        paymentType = 'DEBT'
      }

      let cashAmount = 0, insuranceAmount = 0, debtAmount = 0
      const splitPayments = entries
        .filter(p => p.amount > 0)
        .map(p => {
          let paymentMethod = p.method
          if (p.method === 'MOBILE_MONEY') paymentMethod = 'MTN_MOMO'
          else if (p.method === 'CREDIT_CARD') paymentMethod = 'CARD'
          else if (p.method === 'BANK_CHECK') paymentMethod = 'BANK_CHECK'
          if (paymentMethod === 'CASH' || paymentMethod === 'CARD' || paymentMethod === 'MTN_MOMO' || paymentMethod === 'BANK_CHECK') cashAmount += p.amount
          else if (p.method === 'INSURANCE') insuranceAmount += p.amount
          else if (p.method === 'DEBT') debtAmount += p.amount
          return {
            paymentMethod,
            amount: p.amount,
            reference: p.reference || undefined,
          }
        })
      if (remainingDebt > 0) debtAmount += remainingDebt

      const payload = {
        customerId: selectedCustomer,
        items: cart.map(i => {
          const list = Number(i.product.unitPrice ?? i.product.price ?? i.unitPrice)
          const charged = Number(i.unitPrice)
          return {
            productId: i.product.id,
            quantity: i.quantity,
            unitPrice: charged,
            discount: Math.max(0, round2((list - charged) * i.quantity)),
            itemType: i.product.itemType === 'SERVICE' ? 'SERVICE' : (i.product.itemType === 'RAW_MATERIAL' ? 'RAW_MATERIAL' : 'PRODUCT'),
          }
        }),
        paymentType,
        cashAmount,
        insuranceAmount,
        debtAmount,
        payments: splitPayments,
        branchId: selectedBranchId,
        receiptMode: trainingMode ? 'TRAINING' : 'NORMAL',
      }

      if (!isOnline) {
        offlineQueue.enqueue(payload)
        toast.warning(t('pos.offlineQueued') || 'Sale queued — will sync when online.')
        setCart([])
        setIsPaymentModalOpen(false)
        return
      }

      const created = await apiClient.createSale(payload)
      const createdSale = (created as any)?.data ?? created

      // Success confirmation modal replaces the transient success toast.
      let cashierName: string | undefined
      try {
        const storedUser = localStorage.getItem('user')
        if (storedUser) cashierName = (JSON.parse(storedUser).name as string) || undefined
      } catch { /* ignore */ }

      // RRA VSDC checklist §16/§22: don't let the cashier print before VSDC
      // has confirmed. The backend already waited briefly for that during
      // createSale — `fiscalization.status` tells us whether it landed in
      // time ("success"), is still in flight ("pending", poll below), or
      // gave up ("failed").
      const fiscalizationStatus = (createdSale?.fiscalization?.status as 'success' | 'pending' | 'failed' | undefined) ?? 'success'

      setSuccessSale({
        id: createdSale?.id ?? created?.id ?? '',
        invoiceNumber: createdSale?.invoiceNumber as string | null | undefined,
        receiptNumber: undefined,
        customerName: selectedCustomerObj?.name,
        totalItems: cart.reduce((s, i) => s + i.quantity, 0),
        totalAmount: Number(createdSale?.totalAmount ?? total ?? 0),
        paymentLabel: paymentType,
        amountPaid: cashAmount + insuranceAmount,
        changeReturned: Math.max(0, cashAmount - total),
        date: new Date(),
        cashierName,
        fiscalizationStatus,
      })
      setLastCreatedSale(createdSale)
      setIsSuccessOpen(true)

      if (fiscalizationStatus === 'pending' && createdSale?.id != null) {
        pollFiscalization(createdSale.id)
      }

      setCart([])
      setIsPaymentModalOpen(false)

      const res = await apiClient.getProducts({ page: 1, limit: 10000, search: '', branchId: selectedBranchId })
      setProducts(productsFromInventoryResponse(res).filter(p => isSellable(p, trainingMode)))
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.errors?.[0]?.message || error?.message || t('pos.paymentError')
      toast.error(msg)
      if (msg.includes('stock')) {
        try {
          const res = await apiClient.getProducts({ page: 1, limit: 10000, search: '', branchId: selectedBranchId })
          setProducts(productsFromInventoryResponse(res).filter(p => isSellable(p, trainingMode)))
        } catch { /* silent */ }
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [cart, selectedCustomer, total, t, isOnline, selectedBranchId, pollFiscalization, trainingMode])

  // A proforma is a quote, not a sale: no payment is collected, no stock moves,
  // and no customer debt is booked (see createSale on the backend — isProforma
  // skips stock deduction and debt entirely). It IS fiscalized through RRA
  // VSDC like every other receipt type, so its invoice matches the fiscal
  // record. debtAmount is still set to `total` here only to satisfy the
  // backend's payment-sum check; the backend does not actually add it to the
  // customer's balance.
  const handleCreateProforma = useCallback(async () => {
    if (cart.length === 0) { toast.error(t('pos.noItemsInCart')); return }
    if (!selectedCustomer) { toast.error(t('pos.selectCustomer')); return }

    try {
      setIsSubmitting(true)
      const payload = {
        customerId: selectedCustomer,
        items: cart.map(i => {
          const list = Number(i.product.unitPrice ?? i.product.price ?? i.unitPrice)
          const charged = Number(i.unitPrice)
          return {
            productId: i.product.id,
            quantity: i.quantity,
            unitPrice: charged,
            discount: Math.max(0, round2((list - charged) * i.quantity)),
            itemType: i.product.itemType === 'SERVICE' ? 'SERVICE' : (i.product.itemType === 'RAW_MATERIAL' ? 'RAW_MATERIAL' : 'PRODUCT'),
          }
        }),
        cashAmount: 0,
        insuranceAmount: 0,
        debtAmount: total,
        isProforma: true,
        branchId: selectedBranchId,
      }

      const created = await apiClient.createSale(payload)
      const createdSale = (created as any)?.data ?? created

      let cashierName: string | undefined
      try {
        const storedUser = localStorage.getItem('user')
        if (storedUser) cashierName = (JSON.parse(storedUser).name as string) || undefined
      } catch { /* ignore */ }

      setSuccessSale({
        id: createdSale?.id ?? '',
        invoiceNumber: createdSale?.invoiceNumber as string | null | undefined,
        receiptNumber: undefined,
        customerName: selectedCustomerObj?.name,
        totalItems: cart.reduce((s, i) => s + i.quantity, 0),
        totalAmount: Number(createdSale?.totalAmount ?? total ?? 0),
        paymentLabel: 'PROFORMA',
        amountPaid: 0,
        changeReturned: 0,
        date: new Date(),
        cashierName,
        // Proforma is fiscalized through VSDC like any other receipt — report
        // the real submission outcome so the success modal never claims a
        // receipt is print-ready before RRA confirms it.
        fiscalizationStatus: ((createdSale as any)?.fiscalization?.status as 'success' | 'pending' | 'failed' | undefined) ?? 'pending',
      })
      setLastCreatedSale(createdSale)
      setIsSuccessOpen(true)
      setCart([])
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.errors?.[0]?.message || error?.message || t('pos.paymentError')
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }, [cart, selectedCustomer, selectedCustomerObj, total, t, selectedBranchId])

  // ── Success modal actions ──────────────────────────────────────────────────

  const buildInvoicePdfBlob = useCallback(async (base: any): Promise<{ blob: Blob; filename: string } | null> => {
    if (!base?.id) return null
    try {
      const invoice = unwrapInvoice(await apiClient.getInvoice(base.id, { allowPending: true }))
      // The first issuance from the success modal is the original; a second
      // print/download/share of the same sale comes back as its CS/CR copy.
      const blob = await issueInvoicePdfBlob(base.id)
      return {
        blob,
        filename: getInvoiceFilename(invoice, base.invoiceNumber ?? base.saleNumber ?? base.id),
      }
    } catch (e: any) {
      console.error('Failed to build sale invoice:', e)
      if (e?.response?.status === 425) {
        toast.error(t('pos.stillFiscalizing') || 'Still confirming with the tax authority (VSDC) — try again in a moment.')
      } else {
        toast.error(t('sales.invoiceGenerationError') || 'Failed to generate invoice')
      }
      return null
    }
  }, [t])

  const handlePrintInvoice = useCallback(async () => {
    const base = lastCreatedSale ?? successSale
    if (!base) return
    const result = await buildInvoicePdfBlob(base)
    if (!result) return
    const url = URL.createObjectURL(result.blob)
    const w = window.open(url, '_blank')
    if (w) {
      w.onload = () => {
        w.print()
        URL.revokeObjectURL(url)
      }
    } else {
      toast.error(t('sales.printWindowError') || 'Failed to open print window')
    }
  }, [lastCreatedSale, successSale, buildInvoicePdfBlob, t])

  const handleDownloadInvoice = useCallback(async () => {
    const base = lastCreatedSale ?? successSale
    if (!base) return
    const result = await buildInvoicePdfBlob(base)
    if (!result) return
    const url = URL.createObjectURL(result.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [lastCreatedSale, successSale, buildInvoicePdfBlob])

  const handleShareInvoice = useCallback(async () => {
    const base = lastCreatedSale ?? successSale
    if (!base) return
    const result = await buildInvoicePdfBlob(base)
    if (!result) return
    const file = new File([result.blob], result.filename, { type: 'application/pdf' })
    const shareable = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
    if (typeof shareable.share === 'function' && typeof shareable.canShare === 'function' && shareable.canShare({ files: [file] })) {
      try {
        await shareable.share({ files: [file], title: 'Invoice' })
        return
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        // fall through to download
      }
    }
    await handleDownloadInvoice()
  }, [lastCreatedSale, successSale, buildInvoicePdfBlob, handleDownloadInvoice])

  const handleNewSale = useCallback(() => {
    setIsSuccessOpen(false)
    setSuccessSale(null)
    setLastCreatedSale(null)
    setCart([])
    setSelectedCustomer('')
    setSearchTerm('')
    setIsPaymentModalOpen(false)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  const handleViewInvoice = useCallback(() => {
    setIsSuccessOpen(false)
    navigate('/dashboard/sales')
  }, [navigate])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Offline banner */}
      {!isOnline && (
        <div className="fixed top-14 inset-x-0 z-40 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          {t('pos.offlineMode') || 'You are offline. Sales will be queued and synced when connection is restored.'}
        </div>
      )}
      {isOnline && trainingMode && (
        <div className="fixed top-14 inset-x-0 z-40 flex items-center justify-center gap-2 bg-orange-500 px-4 py-2 text-sm font-medium text-white">
          TRAINING MODE — sales print as Training Sale (TS) receipts: not official, no stock, payment or accounting changes.
        </div>
      )}

      {/* POS Shell */}
      <div className="flex h-[calc(100vh-8.5rem)] -mx-4 sm:-mx-6 lg:-mx-8 overflow-hidden bg-[#F8F9FC]">

        {/* ── LEFT: product browser ─────────────────────────────────────── */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

          {/* Search bar row */}
          <div className="flex items-center gap-3 px-5 py-3.5 bg-white border-b border-gray-100 flex-shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchInputRef}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search or scan barcode..."
                className="w-full pl-10 pr-10 h-10 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center rounded-lg bg-gray-100 p-0.5 flex-shrink-0">
              {(['ALL', 'PRODUCT', 'SERVICE'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setProductTypeFilter(type)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150',
                    productTypeFilter === type
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {type === 'ALL' ? 'All' : type === 'PRODUCT' ? 'Products' : 'Services'}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap tabular-nums bg-gray-100 px-2.5 py-1 rounded-lg">
              {inStockProducts.length} items
            </span>
          </div>

          {/* Category filter tabs */}
          <div className="flex items-center gap-2 px-5 py-3 bg-white border-b border-gray-100 flex-shrink-0 overflow-x-auto scrollbar-none">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150',
                  activeCategory === cat
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700',
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div ref={productsRef} className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
              </div>
            ) : inStockProducts.length === 0 ? (
              <div className="flex flex-col h-48 items-center justify-center text-gray-400 gap-2">
                <Package className="h-10 w-10" />
                <p className="text-sm">{t('pos.noProductsFound')}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                  {inStockProducts.slice(0, displayedCount).map(p => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onAddToCart={addToCart}
                      isFavorite={favorites.has(p.id)}
                      onToggleFavorite={toggleFavorite}
                      allowZeroStock={trainingMode}
                    />
                  ))}
                </div>
                {inStockProducts.length > displayedCount && (
                  <p className="mt-4 text-center text-xs text-gray-400">
                    Showing {displayedCount} of {inStockProducts.length} — scroll to load more
                  </p>
                )}
              </>
            )}
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center gap-3 px-5 py-3 bg-white border-t border-gray-100 flex-shrink-0">
            <button
              type="button"
              onClick={() => setCart([])}
              disabled={cart.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 hover:bg-red-50 hover:text-red-600 text-sm font-medium text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
              Clear Cart
            </button>

            {isSyncing && (
              <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing…
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: current order ──────────────────────────────────────── */}
        <div className="w-[340px] xl:w-[375px] flex flex-col flex-shrink-0 bg-white border-l border-gray-100">

          {/* Order header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <ShoppingCart className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-bold text-gray-900">Current Order</h2>
              {cart.length > 0 && (
                <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                  {cart.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Clear cart"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Customer selector */}
          <div className="px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
            <div ref={customerDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setShowCustomerDropdown(prev => !prev)}
                className={cn(
                  'w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm text-left transition-all',
                  'bg-gray-50 border-gray-200',
                  'hover:border-blue-300',
                  showCustomerDropdown && 'border-blue-500 ring-2 ring-blue-500/20 bg-white',
                )}
              >
                <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                <span className={cn('flex-1 truncate text-xs', selectedCustomerObj ? 'text-gray-800 font-medium' : 'text-gray-400')}>
                  {selectedCustomerObj ? selectedCustomerObj.name : 'Search customer or member…'}
                </span>
                {selectedCustomerObj && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium flex-shrink-0">
                    {selectedCustomerObj.type}
                  </span>
                )}
              </button>

              {showCustomerDropdown && (
                <div className="absolute top-full mt-1.5 inset-x-0 z-50 rounded-xl border border-gray-200 bg-white shadow-xl">
                  <div className="p-2 border-b border-gray-100">
                    <Input
                      value={customerSearch}
                      onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Search by name or phone…"
                      className="h-8 text-xs"
                      autoFocus
                    />
                  </div>
                  <ul className="max-h-44 overflow-y-auto py-1">
                    {filteredCustomers.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-gray-400">No customers found</li>
                    ) : filteredCustomers.map(c => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedCustomer(c.id); setShowCustomerDropdown(false); setCustomerSearch('') }}
                          className={cn(
                            'w-full px-3 py-2 text-xs text-left transition-colors',
                            'hover:bg-gray-50',
                            c.id === selectedCustomer && 'bg-blue-50 text-blue-700 font-medium',
                          )}
                        >
                          <span className="block font-medium text-gray-900">{c.name}</span>
                          {c.phone && <span className="text-gray-500">{c.phone}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsAddCustomerOpen(true)}
              className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              <UserPlus className="h-3 w-3" />
              Add New Customer
            </button>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto px-5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 text-gray-300 gap-2">
                <ShoppingCart className="h-10 w-10" />
                <p className="text-xs text-gray-400">Cart is empty — click a product to add</p>
              </div>
            ) : cart.map(item => (
              <CartItemRow
                key={item.product.id}
                item={item}
                onRemove={removeFromCart}
                onUpdateQuantity={updateQuantity}
                onUpdatePrice={updatePrice}
                priceEditable={orgSettings.featureFlags.allowManualDiscounts}
                vatRegistered={vatRegistered}
              />
            ))}
          </div>

          {/* Order summary + checkout */}
          <div className="border-t border-gray-100 px-5 py-4 space-y-3 flex-shrink-0 bg-white">
            {/* Subtotal */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Subtotal</span>
              <span className="font-semibold text-gray-800 tabular-nums">{subtotal.toLocaleString()} RWF</span>
            </div>

            {/* Tax */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{vatRegistered ? (taxAmount > 0 ? `VAT (${vatLabelRate}%)` : 'VAT (0%)') : 'VAT (Not registered — D)'}</span>
              <span className="font-semibold text-gray-800 tabular-nums">{taxAmount.toLocaleString()} RWF</span>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <span className="text-sm font-bold text-gray-900">Total</span>
              <span className="text-lg font-extrabold text-blue-600 tabular-nums">
                {total.toLocaleString()} <span className="text-xs font-normal text-gray-400">RWF</span>
              </span>
            </div>

            {/* Process Payment button */}
            <button
              type="button"
              onClick={handleOpenPayment}
              disabled={cart.length === 0 || !selectedCustomer || isSubmitting}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-all shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40 active:scale-[0.99]"
            >
              {isSubmitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
              ) : (
                <>Process Payment <ChevronRight className="h-4 w-4" /></>
              )}
            </button>

            {/* Create Quote (Proforma) — a printable estimate, not a real
                sale: no payment, no stock movement, never sent to RRA. */}
            <button
              type="button"
              onClick={handleCreateProforma}
              disabled={cart.length === 0 || !selectedCustomer || isSubmitting}
              className="w-full h-10 flex items-center justify-center gap-2 rounded-xl border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Create Quote (Proforma)
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddCustomerDrawer
        isOpen={isAddCustomerOpen}
        onOpenChange={setIsAddCustomerOpen}
        onCustomerAdded={handleCustomerAdded}
      />

      {isPaymentModalOpen && (
        <PaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          totalAmount={total}
          onProcessPayment={handleProcessPayment}
          isProcessing={isSubmitting}
        />
      )}

      <SaleSuccessModal
        isOpen={isSuccessOpen}
        saleData={successSale}
        onPrint={handlePrintInvoice}
        onDownload={handleDownloadInvoice}
        onShare={handleShareInvoice}
        onNewSale={handleNewSale}
        onViewInvoice={handleViewInvoice}
      />
    </>
  )
}

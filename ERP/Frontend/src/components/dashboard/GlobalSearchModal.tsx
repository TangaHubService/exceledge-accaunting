import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ShoppingBag, Users, Package, FileText, X } from 'lucide-react'
import { apiClient } from '../../lib/api-client'

interface GlobalSearchModalProps {
  isOpen: boolean
  onClose: () => void
}

interface SearchResult {
  id: string | number
  title: string
  subtitle?: string
  category: 'Pages' | 'Products' | 'Sales' | 'Customers'
  path: string
}

const STATIC_PAGES: SearchResult[] = [
  { id: 'p-1', title: 'Dashboard', subtitle: 'Overview & business analytics', category: 'Pages', path: '/dashboard' },
  { id: 'p-3', title: 'POS / Sales Register', subtitle: 'Process new sales', category: 'Pages', path: '/dashboard/sales/new' },
  { id: 'p-4', title: 'All Inventory', subtitle: 'Stock management', category: 'Pages', path: '/dashboard/inventory' },
  { id: 'p-5', title: 'Customers', subtitle: 'Customer database & accounts', category: 'Pages', path: '/dashboard/customers' },
  { id: 'p-6', title: 'Debt Management', subtitle: 'Outstanding debt tracking', category: 'Pages', path: '/dashboard/debt' },
  { id: 'p-7', title: 'Low Stock Items', subtitle: 'Critical inventory alerts', category: 'Pages', path: '/dashboard/low-stock' },
  { id: 'p-8', title: 'Stock Movements', subtitle: 'Audit log of stock transfers', category: 'Pages', path: '/dashboard/ledger-history' },
]

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
        else setQuery('')
      }
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!query.trim()) {
      setResults(STATIC_PAGES)
      return
    }

    const q = query.toLowerCase()
    const matchingPages = STATIC_PAGES.filter(
      p => p.title.toLowerCase().includes(q) || (p.subtitle && p.subtitle.toLowerCase().includes(q))
    )

    let isMounted = true
    setLoading(true)

    const timer = setTimeout(async () => {
      try {
        const dynamicResults: SearchResult[] = []
        
        // Search products
        try {
          const prodRes = await apiClient.getProducts({ search: query, limit: 5 })
          const prods = prodRes?.products || prodRes?.data || []
          if (Array.isArray(prods)) {
            prods.slice(0, 5).forEach((p: any) => {
              dynamicResults.push({
                id: `prod-${p.id}`,
                title: p.name,
                subtitle: `Stock: ${p.quantity} | SKU: ${p.sku || 'N/A'}`,
                category: 'Products',
                path: `/dashboard/inventory`,
              })
            })
          }
        } catch {
          // ignore
        }

        // Search customers
        try {
          const custRes = await apiClient.getCustomers({ search: query, limit: 4 })
          const custs = custRes?.customers || custRes?.data || []
          if (Array.isArray(custs)) {
            custs.slice(0, 4).forEach((c: any) => {
              dynamicResults.push({
                id: `cust-${c.id}`,
                title: c.name,
                subtitle: c.phone || c.email || 'Customer',
                category: 'Customers',
                path: `/dashboard/customers`,
              })
            })
          }
        } catch {
          // ignore
        }

        if (isMounted) {
          setResults([...matchingPages, ...dynamicResults])
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [query])

  if (!isOpen) return null

  const handleSelect = (result: SearchResult) => {
    navigate(result.path)
    onClose()
  }

  const getIcon = (category: string) => {
    switch (category) {
      case 'Products': return <Package className="h-4 w-4 text-blue-500" />
      case 'Sales': return <ShoppingBag className="h-4 w-4 text-emerald-500" />
      case 'Customers': return <Users className="h-4 w-4 text-purple-500" />
      default: return <FileText className="h-4 w-4 text-gray-400" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-gray-900/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Search Header */}
        <div className="relative flex items-center px-4 border-b border-gray-100 dark:border-gray-700">
          <Search className="h-5 w-5 text-gray-400 mr-3 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, sales, customers, or navigate..."
            className="w-full py-4 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block px-2 py-0.5 ml-2 text-xs font-semibold text-gray-400 bg-gray-100 dark:bg-gray-700 rounded">
            ESC
          </kbd>
        </div>

        {/* Results Body */}
        <div className="overflow-y-auto p-2 space-y-1 flex-1">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400 animate-pulse">
              Searching data...
            </div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left group"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-colors">
                    {getIcon(item.category)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {item.title}
                    </p>
                    {item.subtitle && (
                      <p className="text-xs text-gray-400">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400 font-medium">
                  {item.category}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-400">
          <span>Navigate with click or arrow keys</span>
          <span>Quick Search</span>
        </div>
      </div>
    </div>
  )
}

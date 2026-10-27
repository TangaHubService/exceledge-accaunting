import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '../lib/utils'

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  pos: 'Point of Sale',
  sales: 'Sales',
  customers: 'Customers',
  'inventory-all': 'All Items',
  'low-stock': 'Low Stock',
  'expiring-products': 'Expiring Products',
  expired: 'Expired Products',
  'ledger-history': 'Ledger History',
  'inventory-summary': 'Items Summary',
  'stock-transfers': 'Stock Transfers',
  warehouses: 'Warehouses',
  production: 'Production & BOM',
  orders: 'Purchases',
  purchases: 'Purchases',
  new: 'New Order',
  suppliers: 'Suppliers',
  users: 'Users',
  'activity-logs': 'Activity Logs',
  'ebm-outbox': 'EBM Outbox',
  profile: 'Profile',
  'organization-config': 'Organization Settings',
  organizations: 'Organizations',
  subscription: 'Subscription',
  history: 'Billing History',
  debt: 'Debt Management',
  'sales-reports': 'Sales Reports',
  'inventory-reports': 'Items Reports',
  'stock-reports': 'Stock Reports',
  'debt-payments-report': 'Debt Payments Report',
  'cash-flow-report': 'Cash Flow Report',
  expenses: 'Expenses',
  'system-owner': 'System Owner',
  overview: 'Overview',
  subscriptions: 'Subscriptions',
  payments: 'Payments',
  analytics: 'Analytics',
}

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function Breadcrumbs() {
  const location = useLocation()

  const segments = location.pathname
    .split('/')
    .filter(Boolean)

  // Nothing to show at root dashboard
  if (segments.length <= 1) return null

  // Build crumbs: skip numeric IDs from the label chain
  const crumbs: { label: string; href: string }[] = []
  let href = ''
  for (const seg of segments) {
    href += `/${seg}`
    const isNumeric = /^\d+$/.test(seg)
    crumbs.push({ label: isNumeric ? `#${seg}` : labelFor(seg), href })
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 px-1 mb-4 select-none"
    >
      <Link
        to="/dashboard"
        className="flex items-center gap-1 text-gray-400 dark:text-gray-500 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={crumb.href} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
            {isLast ? (
              <span className={cn('font-medium text-gray-700 dark:text-gray-200')}>
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.href}
                className="hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

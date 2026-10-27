/** Mirrors Backend/src/types/organization-settings.types.ts — keep in sync. */

export interface ISidebarConfig {
    home: boolean;
    dashboard: boolean;
    pos: boolean;
    sales: boolean;
    invoices: boolean;
    customers: boolean;
    debtManagement: boolean;
    inventoryAll: boolean;
    lowStock: boolean;
    expiredProducts: boolean;
    stockMovementHistory: boolean;
    inventorySummary: boolean;
    stockTransfers: boolean;
    warehouses: boolean;
    orders: boolean;
    suppliers: boolean;
    supplierInvoices: boolean;
    scanInvoice: boolean;
    expenses: boolean;
    payroll: boolean;
    organizations: boolean;
    users: boolean;
    activityLogs: boolean;
    ebmOutbox: boolean;
    production: boolean;
    subscription: boolean;
    billingHistory: boolean;
    salesReports: boolean;
    inventoryReports: boolean;
    stockReports: boolean;
    debtPaymentsReport: boolean;
    cashFlowReport: boolean;
}

export interface IFeatureFlags {
    allowNegativeStock: boolean;
    ebmIntegrationEnabled: boolean;
    requireStockAdjustmentApproval: boolean;
    allowManualDiscounts: boolean;
    stockTransfersEnabled: boolean;
}

export interface IPreferences {
    language: string;
    timezone: string;
    dateFormat: string;
    defaultLandingPage: string;
    lowStockThresholdOverride: number | null;
    enabledPaymentMethods: string[];
    shiftConfig?: {
        approvalRequired: boolean;
        denominationsEnabled: boolean;
        varianceThreshold: number;
    };
}

export interface IOrganizationSettings {
    sidebarConfig: ISidebarConfig;
    featureFlags: IFeatureFlags;
    preferences: IPreferences;
    /** Business/taxpayer is registered for VAT. False → every sale uses RRA tax
     *  code D regardless of product category. */
    vatRegistered: boolean;
}

/** One entry per real sidebar link, grouped the same way the sidebar itself
 *  groups them — the single source of truth for the Settings UI's labels,
 *  routes (defaultLandingPage) and section layout. */
export const SIDEBAR_SECTIONS: { label: string; items: { key: keyof ISidebarConfig; label: string; route: string }[] }[] = [
    {
        label: 'General',
        items: [
            { key: 'home', label: 'Home', route: '/' },
            { key: 'dashboard', label: 'Dashboard', route: '/dashboard' },
        ],
    },
    {
        label: 'Sales',
        items: [
            { key: 'pos', label: 'POS', route: '/dashboard/pos' },
            { key: 'sales', label: 'Sales', route: '/dashboard/sales' },
            { key: 'invoices', label: 'Invoices', route: '/dashboard/invoices' },
            { key: 'customers', label: 'Customers', route: '/dashboard/customers' },
            { key: 'debtManagement', label: 'Debt Management', route: '/dashboard/debt' },
        ],
    },
    {
        label: 'Items',
        items: [
            { key: 'inventoryAll', label: 'All Items', route: '/dashboard/inventory-all' },
            { key: 'lowStock', label: 'Low Stock', route: '/dashboard/low-stock' },
            { key: 'expiredProducts', label: 'Expired Products', route: '/dashboard/expired' },
            { key: 'stockMovementHistory', label: 'Stock Movement History', route: '/dashboard/ledger-history' },
            { key: 'inventorySummary', label: 'Items Summary', route: '/dashboard/inventory-summary' },
            { key: 'stockTransfers', label: 'Stock Transfers', route: '/dashboard/stock-transfers' },
            { key: 'warehouses', label: 'Warehouses', route: '/dashboard/warehouses' },
            { key: 'production', label: 'Production & BOM', route: '/dashboard/production' },
        ],
    },
    {
        label: 'Purchases',
        items: [
            { key: 'orders', label: 'Purchases', route: '/dashboard/purchases' },
            { key: 'suppliers', label: 'Suppliers', route: '/dashboard/suppliers' },
            { key: 'supplierInvoices', label: 'Supplier Invoices', route: '/dashboard/supplier-invoices' },
            { key: 'scanInvoice', label: 'Scan Invoice', route: '/dashboard/scan-invoice' },
        ],
    },
    {
        label: 'Finance',
        items: [
            { key: 'expenses', label: 'Expenses', route: '/dashboard/expenses' },
            { key: 'payroll', label: 'Payroll', route: '/dashboard/payroll' },
        ],
    },
    {
        label: 'Admin',
        items: [
            { key: 'organizations', label: 'Organizations', route: '/dashboard/organizations' },
            { key: 'users', label: 'Users', route: '/dashboard/users' },
            { key: 'activityLogs', label: 'Activity Logs', route: '/dashboard/activity-logs' },
            { key: 'ebmOutbox', label: 'EBM Outbox', route: '/dashboard/ebm-outbox' },
        ],
    },
    {
        label: 'Billing',
        items: [
            { key: 'subscription', label: 'Subscription', route: '/dashboard/subscription' },
            { key: 'billingHistory', label: 'Billing History', route: '/dashboard/history' },
        ],
    },
    {
        label: 'Reports',
        items: [
            { key: 'salesReports', label: 'Sales Reports', route: '/dashboard/sales-reports' },
            { key: 'inventoryReports', label: 'Items Reports', route: '/dashboard/inventory-reports' },
            { key: 'stockReports', label: 'Stock Movement Report', route: '/dashboard/stock-reports' },
            { key: 'debtPaymentsReport', label: 'Debt Payments', route: '/dashboard/debt-payments-report' },
            { key: 'cashFlowReport', label: 'Cash Flow', route: '/dashboard/cash-flow-report' },
        ],
    },
];

const allSidebarItems = SIDEBAR_SECTIONS.flatMap(s => s.items);

/** Maps a sidebar item key to the route it lands on, for defaultLandingPage. */
export const MODULE_ROUTES: Record<keyof ISidebarConfig, string> = Object.fromEntries(
    allSidebarItems.map(i => [i.key, i.route]),
) as Record<keyof ISidebarConfig, string>;

export const SIDEBAR_MODULE_LABELS: Record<keyof ISidebarConfig, string> = Object.fromEntries(
    allSidebarItems.map(i => [i.key, i.label]),
) as Record<keyof ISidebarConfig, string>;

export const DEFAULT_ORGANIZATION_SETTINGS: IOrganizationSettings = {
    sidebarConfig: Object.fromEntries(allSidebarItems.map(i => [i.key, true])) as unknown as ISidebarConfig,
    featureFlags: {
        allowNegativeStock: false,
        ebmIntegrationEnabled: true,
        requireStockAdjustmentApproval: false,
        allowManualDiscounts: true,
        stockTransfersEnabled: true,
    },
    preferences: {
        language: 'en',
        timezone: 'Africa/Kigali',
        dateFormat: 'DD/MM/YYYY',
        defaultLandingPage: 'dashboard',
        lowStockThresholdOverride: null,
        enabledPaymentMethods: ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'DEBT'],
    },
    // Defaults to true: matches the existing behavior where VAT-registered
    // products charge 18%, so organizations that never touch this setting keep
    // their current tax treatment.
    vatRegistered: true,
};

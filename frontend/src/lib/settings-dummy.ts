/** Dummy data for Settings screens (design mocks). */

export const SETTINGS_NAV = [
  { id: "company", label: "Company", to: "/settings/company" },
  { id: "usage", label: "Usage", to: "/settings/usage" },
  { id: "reports", label: "Reports", to: "/settings/reports" },
  { id: "sales", label: "Sales", to: "/settings/sales" },
  { id: "expenses", label: "Expenses", to: "/settings/expenses" },
  { id: "time", label: "Time", to: "/settings/time" },
  { id: "inbox", label: "Inbox", to: "/settings/inbox" },
  { id: "wallet", label: "Wallet", to: "/settings/wallet" },
  { id: "advanced", label: "Advanced", to: "/settings/advanced" },
] as const;

export const USAGE_LIMITS = {
  billableUsers: { used: 2, limit: 25 },
  chartOfAccounts: { count: 64, unlimited: true },
} as const;

export const COMPANY_INFO = {
  industry: "Accounting and business services",
  name: "EXCEL EDGE CPA",
  email: "enockiradukunda4@gmail.com",
  address: "Not specified",
  legalName: "EXCEL EDGE CPA",
  tin: "122714026",
  businessType: "Not specified",
  legalAddress: "Not specified",
  customerEmail: "enockiradukunda4@gmail.com",
  customerAddress: "Not specified",
} as const;

export type PrefRow =
  | { label: string; kind: "toggle"; value: boolean; badge?: string; hint?: string }
  | { label: string; kind: "text"; value: string; badge?: string; hint?: string }
  | { label: string; kind: "link"; value: string; badge?: string; hint?: string };

export const SALES_SETTINGS = {
  formContent: [
    { label: "Preferred invoice terms", value: "Net 30", kind: "text" as const },
    { label: "Preferred delivery method", value: "None", kind: "text" as const },
    { label: "Shipping", value: false, kind: "toggle" as const },
    { label: "Custom fields", value: "Manage fields", kind: "link" as const },
    { label: "Custom transaction numbers", value: true, kind: "toggle" as const },
    { label: "Service date", value: true, kind: "toggle" as const },
    { label: "Discount", value: false, kind: "toggle" as const },
    { label: "Deposit", value: false, kind: "toggle" as const },
    { label: "Tags", value: true, kind: "toggle" as const },
  ] satisfies PrefRow[],
  products: [
    { label: "Show Product/Service column on sales forms", value: true, kind: "toggle" as const },
    { label: "Show SKU column", value: false, kind: "toggle" as const },
    { label: "Turn on price rules", value: false, kind: "toggle" as const },
    { label: "Track quantity and price/rate", value: true, kind: "toggle" as const },
    { label: "Track inventory quantity on hand", value: true, kind: "toggle" as const },
    { label: "Inventory valuation method", value: "Select method", kind: "link" as const },
    { label: "Inventory receiving method", value: "Bills and expenses", kind: "text" as const, badge: "NEW" },
    { label: "Revenue recognition", value: true, kind: "toggle" as const },
  ] satisfies PrefRow[],
  invoicePayments: {
    acceptOnline: false,
    paymentInstructions: "No custom payment instructions added",
  },
  progressInvoicing: [
    { label: "Create multiple partial invoices from a single estimate", value: false },
    { label: "Show completely billed products and services on progress invoices", value: false },
  ],
  messages: { defaultEmail: "Customise message" },
  reminders: { manage: "Manage reminders" },
  customerAi: { dailyDigest: true },
  postInvoice: [
    { label: "Ask for a work request", value: false },
    { label: "Ask for a review, feedback or testimonials", value: false },
    { label: "Ask for a referral", value: false },
  ],
  postInvoiceFrequency: "90 days",
  onlineDelivery: { configure: "Configure delivery" },
  statements: { showAgeing: true },
};

export const EXPENSES_SETTINGS = {
  bills: [
    { label: "Show items table on expense and purchase forms", value: false, kind: "toggle" as const },
    { label: "Show Tags field on expense and purchase forms", value: true, kind: "toggle" as const },
    { label: "Track expenses and items by customer", value: false, kind: "toggle" as const },
    { label: "Make expenses and items billable", value: false, kind: "toggle" as const },
    { label: "Default bill payment terms", value: "Not set", kind: "text" as const },
  ] satisfies PrefRow[],
  purchaseOrders: true,
  messages: { customise: "Customise message" },
};

export const TIME_SETTINGS = {
  firstDayOfWeek: "Sunday",
  showServiceField: true,
  allowBillable: true,
};

export const INBOX_SETTINGS = {
  companyAlerts: true,
  companyAlertsSchedule: "Every Monday · 9:00 am · Africa/Kigali",
  aiFollowUp: true,
};

export const WALLET_SETTINGS = {
  cards: [
    {
      brand: "VISA",
      last4: "0930",
      usedFor: "EXCEL EDGE ERP SUBSCRIPTION",
    },
  ],
};

export const ADVANCED_SETTINGS = {
  accountingMethod: "Accrual",
  firstMonthFy: "January",
  firstMonthTax: "Same as financial year",
  closeTheBooks: false,
  taxForm: "Not configured",
  enableAccountNumbers: false,
  trackClasses: false,
  trackLocations: false,
  prefillForms: true,
  autoInvoiceUnbilled: false,
  autoApplyBillPayments: true,
  projects: true,
  language: "English",
  homeCurrency: "Rwandan franc (RWF)",
  multicurrency: false,
  dateFormat: "mm/dd/yyyy",
  currencyFormat: "RWF 123,456.00",
  warnDuplicateCheque: true,
  warnDuplicateBill: false,
  warnDuplicateJournal: false,
  notifyInactive: "1 hour",
  backups: true,
};

export const REPORT_VISUAL = [
  { id: "header", label: "Header" },
  { id: "footer", label: "Footer" },
  { id: "column", label: "Column highlights" },
  { id: "banded", label: "Banded rows" },
  { id: "empty", label: "Empty cells", badge: "NEW" },
  { id: "grid", label: "Gridlines" },
] as const;

export const REPORT_FORMATTING = [
  { id: "number", label: "Number" },
  { id: "view", label: "View" },
] as const;

export type SamplePnlRow = {
  label: string;
  total: string;
  bold?: boolean;
  indent?: number;
  highlight?: boolean;
};

export const SAMPLE_PNL_ROWS: SamplePnlRow[] = [
  { label: "Income", bold: true, total: "" },
  { label: "Sales income", indent: 1, total: "12,450,000" },
  { label: "Service income", indent: 1, total: "3,200,000" },
  { label: "Total income", bold: true, total: "15,650,000" },
  { label: "Cost of sales", bold: true, total: "4,100,000" },
  { label: "Gross profit", bold: true, highlight: true, total: "11,550,000" },
  { label: "Operating expenses", bold: true, total: "" },
  { label: "Salaries and wages", indent: 1, total: "2,800,000" },
  { label: "Rent", indent: 1, total: "720,000" },
  { label: "Utilities", indent: 1, total: "185,000" },
  { label: "Total operating expenses", bold: true, total: "3,705,000" },
  { label: "Net profit", bold: true, highlight: true, total: "7,845,000" },
];

/** Flyout menus for apps that can be pinned via Customise. */
export const APP_FLYOUTS: Record<string, { flyoutTitle: string; items: Array<{ label: string; to: string }> }> = {
  accounting: {
    flyoutTitle: "ACCOUNTING",
    items: [
      { label: "Bank transactions", to: "/banking/transactions" },
      { label: "Integration transactions", to: "/banking/integration-transactions" },
      { label: "Reconcile", to: "/banking/reconciliation" },
      { label: "Rules", to: "/banking/rules" },
      { label: "Chart of accounts", to: "/accounting/chart-of-accounts" },
      { label: "Recurring transactions", to: "/accounting/recurring-transactions" },
      { label: "Revenue recognition", to: "/accounting/revenue-recognition" },
      { label: "Fixed assets", to: "/fixed-assets" },
      { label: "Prepaid expenses", to: "/accounting/prepaid-expenses" },
      { label: "My accountant", to: "/accounting/my-accountant" },
    ],
  },
  expenses: {
    flyoutTitle: "EXPENSES & PAY BILLS",
    items: [
      { label: "Expense transactions", to: "/expenses" },
      { label: "Suppliers", to: "/suppliers" },
      { label: "Bills", to: "/bills" },
    ],
  },
  sales: {
    flyoutTitle: "SALES & GET PAID",
    items: [
      { label: "Overview", to: "/invoices" },
      { label: "Sales transactions", to: "/invoices" },
      { label: "Invoices", to: "/invoices" },
      { label: "Sales orders", to: "/invoices" },
      { label: "Products & services", to: "/inventory" },
    ],
  },
  customers: {
    flyoutTitle: "CUSTOMER HUB",
    items: [
      { label: "Overview", to: "/customers" },
      { label: "Customers & leads", to: "/customers" },
      { label: "Opportunities", to: "/customers" },
      { label: "Estimates", to: "/invoices" },
      { label: "Proposals", to: "/invoices" },
      { label: "Contracts", to: "/customers" },
      { label: "Reviews", to: "/customers" },
    ],
  },
  team: {
    flyoutTitle: "TEAM",
    items: [
      { label: "Overview", to: "/employees" },
      { label: "Employees", to: "/employees" },
      { label: "Time tracking", to: "/time/weekly" },
      { label: "Single time activity", to: "/time/single" },
      { label: "Payroll", to: "/employees" },
    ],
  },
  projects: {
    flyoutTitle: "PROJECTS",
    items: [
      { label: "Overview", to: "/dimensions" },
      { label: "Projects", to: "/dimensions" },
    ],
  },
  inventory: {
    flyoutTitle: "INVENTORY",
    items: [
      { label: "Overview", to: "/inventory" },
      { label: "Products & services", to: "/inventory" },
      { label: "Movements", to: "/inventory/movements" },
    ],
  },
  tax: {
    flyoutTitle: "TAX",
    items: [
      { label: "Overview", to: "/tax" },
      { label: "VAT", to: "/tax/vat" },
      { label: "Settings", to: "/tax/settings" },
    ],
  },
};

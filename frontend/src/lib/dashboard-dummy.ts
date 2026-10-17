/** Design-time dummy data for the Accounting home dashboard. Replace with API later. */

export const DUMMY = {
  greetingName: "Enock",
  companyName: "Excel Edge CPA",
  currency: "RWF",
  periodLabel: "This month",
  notificationCount: 3,
  cashTotal: 9_720_000,
  cashDelta: 6,
  kpis: [
    {
      key: "income",
      label: "Total income",
      value: 12_850_000,
      delta: 12,
      tone: "up" as const,
      color: "#16a34a",
      spark: [42, 48, 45, 52, 58, 55, 62, 68, 64, 72, 78, 84],
    },
    {
      key: "expenses",
      label: "Total expenses",
      value: 8_240_000,
      delta: 8,
      tone: "down" as const,
      color: "#e11d48",
      spark: [70, 68, 72, 65, 60, 58, 55, 52, 48, 50, 46, 44],
    },
    {
      key: "profit",
      label: "Net profit",
      value: 4_610_000,
      delta: 18,
      tone: "up" as const,
      color: "#2f6fed",
      spark: [30, 34, 38, 36, 42, 48, 46, 52, 58, 55, 62, 70],
    },
    {
      key: "cash",
      label: "Cash & bank",
      value: 9_720_000,
      delta: 6,
      tone: "up" as const,
      color: "#7c3aed",
      spark: [50, 52, 55, 54, 58, 60, 62, 61, 64, 66, 68, 72],
    },
  ],
  weekly: [
    { week: "W1", label: "Oct 1–7", income: 2.8, expenses: 1.9 },
    { week: "W2", label: "Oct 8–14", income: 3.1, expenses: 2.2 },
    { week: "W3", label: "Oct 15–21", income: 3.6, expenses: 2.0 },
    { week: "W4", label: "Oct 22–28", income: 3.35, expenses: 2.14 },
  ],
  banks: [
    { name: "Bank of Kigali", balance: 7_420_000, updated: "Updated 2 hours ago", tone: "main" as const },
    { name: "Mobile money", balance: 1_800_000, updated: "Updated 1 hour ago", tone: "mobile" as const },
    { name: "Cash on hand", balance: 500_000, updated: "Updated today", tone: "cashhand" as const },
  ],
  invoices: {
    outstanding: { amount: 3_250_000, count: 5 },
    overdue: { amount: 1_100_000, count: 2 },
  },
  bills: {
    unpaid: { amount: 2_180_000, count: 4 },
    dueThisWeek: { amount: 740_000, count: 2 },
  },
  activity: [
    { date: "Oct 28, 2024", type: "Invoice", number: "INV-1005", contact: "Alpha Ltd", amount: 1_250_000, status: "Paid" as const },
    { date: "Oct 27, 2024", type: "Bill", number: "BILL-0034", contact: "MTN Rwanda", amount: 420_000, status: "Unpaid" as const },
    { date: "Oct 26, 2024", type: "Payment", number: "PMT-0042", contact: "Beta Trading Co.", amount: 850_000, status: "Completed" as const },
    { date: "Oct 25, 2024", type: "Expense", number: "EXP-0112", contact: "Office supplies", amount: 85_000, status: "Paid" as const },
    { date: "Oct 24, 2024", type: "Invoice", number: "INV-1004", contact: "Kigali Foods Ltd", amount: 2_100_000, status: "Unpaid" as const },
  ],
};

export type CreateColumn = {
  title: string;
  icon: "customers" | "suppliers" | "team" | "projects" | "other";
  items: Array<{ label: string; to?: string }>;
};

export const CREATE_MENU: CreateColumn[] = [
  {
    title: "Customers",
    icon: "customers",
    items: [
      { label: "Invoice", to: "/invoices" },
      { label: "Receive payment" },
      { label: "Statement" },
      { label: "Estimate" },
      { label: "Sales order" },
      { label: "Credit note" },
      { label: "Sales receipt" },
      { label: "Refund receipt" },
      { label: "Delayed credit" },
      { label: "Delayed charge" },
      { label: "Proposal" },
      { label: "Add customer", to: "/customers" },
    ],
  },
  {
    title: "Suppliers",
    icon: "suppliers",
    items: [
      { label: "Expense", to: "/expenses" },
      { label: "Cheque" },
      { label: "Bill", to: "/bills" },
      { label: "Pay bills", to: "/supplier-payments" },
      { label: "Purchase order" },
      { label: "Item receipt" },
      { label: "Supplier credit" },
      { label: "Credit card credit" },
      { label: "Add supplier", to: "/suppliers" },
    ],
  },
  {
    title: "Team",
    icon: "team",
    items: [{ label: "Single time activity" }, { label: "Weekly timesheet" }],
  },
  {
    title: "Projects",
    icon: "projects",
    items: [{ label: "Project", to: "/dimensions" }],
  },
  {
    title: "Other",
    icon: "other",
    items: [
      { label: "Task" },
      { label: "Bank deposit", to: "/banking" },
      { label: "Transfer", to: "/banking" },
      { label: "Journal entry", to: "/journals/new" },
      { label: "Inventory adjustment", to: "/inventory/movements" },
      { label: "Pay down credit card" },
      { label: "Add product/service", to: "/inventory" },
    ],
  },
];

export const REPORTS_MENU = [
  { label: "Standard reports", to: "/reports/statements" },
  { label: "Custom reports", to: "/reports/statements" },
  { label: "Management reports", to: "/reports/statements" },
  { label: "KPIs", to: "/reports/statements" },
  { label: "Dashboards", to: "/" },
  { label: "Spreadsheet sync" },
  { label: "Performance centre" },
  { label: "Financial planning", hasChildren: true },
] as const;

export const ALL_APPS = [
  { key: "accounting", label: "Accounting", to: "/", color: "#2f6fed", icon: "accounting" as const },
  { key: "expenses", label: "Expenses & Bills", to: "/expenses", color: "#0f766e", icon: "expenses" as const },
  { key: "sales", label: "Sales & Get Paid", to: "/invoices", color: "#0d9488", icon: "sales" as const },
  { key: "customers", label: "Customer Hub", to: "/customers", color: "#0891b2", icon: "customers" as const },
  { key: "team", label: "Team", to: "/setup", color: "#2563eb", icon: "team" as const },
  { key: "projects", label: "Projects", to: "/dimensions", color: "#1d4ed8", icon: "projects" as const },
  { key: "inventory", label: "Inventory", to: "/inventory", color: "#312e81", icon: "inventory" as const },
  { key: "tax", label: "Tax", to: "/tax", color: "#e11d48", icon: "tax" as const },
] as const;

export const PINNED = [
  {
    key: "accounting",
    label: "Accounting",
    flyoutTitle: "ACCOUNTING",
    items: [
      { label: "Bank transactions", to: "/banking/transactions" },
      { label: "Integration transactions", to: "/banking/transactions" },
      { label: "Reconcile", to: "/banking/reconciliation" },
      { label: "Rules", to: "/banking" },
      { label: "Chart of accounts", to: "/accounts" },
      { label: "Recurring transactions", to: "/recurring-journals" },
      { label: "Revenue recognition", to: "/journals" },
      { label: "Fixed assets", to: "/fixed-assets" },
      { label: "Prepaid expenses", to: "/expenses" },
      { label: "My accountant", to: "/setup" },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    flyoutTitle: "EXPENSES & PAY BILLS",
    items: [
      { label: "Expense transactions", to: "/expenses" },
      { label: "Suppliers", to: "/suppliers" },
      { label: "Bills", to: "/bills" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    flyoutTitle: "SALES & GET PAID",
    items: [
      { label: "Overview", to: "/invoices" },
      { label: "Sales transactions", to: "/invoices" },
      { label: "Invoices", to: "/invoices" },
      { label: "Sales orders", to: "/invoices" },
      { label: "Products & services", to: "/inventory" },
    ],
  },
] as const;

/** Apps that can be pinned via Customise → Navigation. */
export const CUSTOMISE_NAV_APPS = [
  { key: "accounting", label: "Accounting", color: "#2f6fed", icon: "accounting" as const, pinned: true },
  { key: "expenses", label: "Expenses & Pay Bills", color: "#0f766e", icon: "expenses" as const, pinned: true },
  { key: "sales", label: "Sales & Get Paid", color: "#0d9488", icon: "sales" as const, pinned: true },
  { key: "customers", label: "Customer Hub", color: "#0891b2", icon: "customers" as const, pinned: false },
  { key: "team", label: "Team", color: "#1d4ed8", icon: "team" as const, pinned: false },
  { key: "projects", label: "Project Management", color: "#2563eb", icon: "projects" as const, pinned: false },
  { key: "inventory", label: "Inventory", color: "#312e81", icon: "inventory" as const, pinned: false },
  { key: "tax", label: "Tax", color: "#e11d48", icon: "tax" as const, pinned: false },
] as const;

/** Pages that can be bookmarked via Customise → Bookmarks. */
export const CUSTOMISE_BOOKMARK_PAGES = [
  { id: "home", label: "Home", to: "/" },
  { id: "standard-reports", label: "Standard reports", to: "/reports/statements" },
  { id: "custom-reports", label: "Custom reports", to: "/reports/statements" },
  { id: "management-reports", label: "Management reports", to: "/reports/statements" },
  { id: "kpis", label: "KPIs", to: "/reports/statements" },
  { id: "dashboards", label: "Dashboards", to: "/" },
  { id: "spreadsheet-sync", label: "Spreadsheet sync", to: "/" },
  { id: "performance-centre", label: "Performance centre", to: "/" },
  { id: "cash-flow-overview", label: "Cash flow overview", to: "/reports/statements" },
  { id: "cash-flow-planner", label: "Cash flow planner", to: "/reports/statements" },
  { id: "budgets", label: "Budgets", to: "/budgets" },
  { id: "forecasts", label: "Forecasts", to: "/reports/statements" },
  { id: "bank-transactions", label: "Bank transactions", to: "/banking/transactions" },
  { id: "integration-transactions", label: "Integration transactions", to: "/banking/transactions" },
  { id: "reconcile", label: "Reconcile", to: "/banking/reconciliation" },
  { id: "rules", label: "Rules", to: "/banking" },
  { id: "chart-of-accounts", label: "Chart of accounts", to: "/accounts" },
  { id: "recurring-transactions", label: "Recurring transactions", to: "/recurring-journals" },
  { id: "revenue-recognition", label: "Revenue recognition", to: "/journals" },
  { id: "fixed-assets", label: "Fixed assets", to: "/fixed-assets" },
  { id: "prepaid-expenses", label: "Prepaid expenses", to: "/expenses" },
  { id: "my-accountant", label: "My accountant", to: "/setup" },
  { id: "expense-transactions", label: "Expense transactions", to: "/expenses" },
  { id: "suppliers", label: "Suppliers", to: "/suppliers" },
  { id: "bills", label: "Bills", to: "/bills" },
  { id: "sales-overview", label: "Sales overview", to: "/invoices" },
  { id: "sales-transactions", label: "Sales transactions", to: "/invoices" },
  { id: "invoices", label: "Invoices", to: "/invoices" },
  { id: "sales-orders", label: "Sales orders", to: "/invoices" },
  { id: "products-services", label: "Products & services", to: "/inventory" },
  { id: "customers-overview", label: "Customers overview", to: "/customers" },
  { id: "customers-leads", label: "Customers & leads", to: "/customers" },
  { id: "opportunities", label: "Opportunities", to: "/customers" },
  { id: "estimates", label: "Estimates", to: "/invoices" },
  { id: "proposals", label: "Proposals", to: "/invoices" },
  { id: "contracts", label: "Contracts", to: "/customers" },
  { id: "reviews", label: "Reviews", to: "/customers" },
  { id: "employees", label: "Employees", to: "/setup" },
  { id: "projects-overview", label: "Projects overview", to: "/dimensions" },
  { id: "projects", label: "Projects", to: "/dimensions" },
  { id: "inventory-overview", label: "Inventory overview", to: "/inventory" },
  { id: "inventory", label: "Inventory", to: "/inventory" },
  { id: "purchase-orders", label: "Purchase orders", to: "/bills" },
  { id: "item-receipts", label: "Item receipts", to: "/inventory/movements" },
  { id: "tax-overview", label: "Tax overview", to: "/tax" },
] as const;

export const DASHBOARD_WIDGETS = [
  { key: "modules", label: "App carousel", group: "operational" as const, defaultOn: true },
  { key: "quick", label: "Create actions", group: "operational" as const, defaultOn: true },
  { key: "glance", label: "Business at a glance", group: "all" as const, defaultOn: true },
  { key: "chart", label: "Cash flow", group: "all" as const, defaultOn: true },
  { key: "banks", label: "Bank accounts", group: "all" as const, defaultOn: true },
  { key: "invoices", label: "Invoices", group: "all" as const, defaultOn: true },
  { key: "bills", label: "Expenses", group: "all" as const, defaultOn: true },
  { key: "activity", label: "Needs Attention", group: "all" as const, defaultOn: true },
  { key: "ap", label: "Accounts payable", group: "all" as const, defaultOn: false },
  { key: "ar", label: "Accounts receivable", group: "all" as const, defaultOn: false },
  { key: "funnel", label: "Customers Funnel", group: "all" as const, defaultOn: false },
  { key: "done", label: "Done For You", group: "all" as const, defaultOn: false },
  { key: "inv-reports", label: "Inventory Reports", group: "all" as const, defaultOn: false },
  { key: "low-stock", label: "Low on Stock", group: "all" as const, defaultOn: false },
  { key: "estimates", label: "Open Estimates", group: "all" as const, defaultOn: false },
  { key: "sales-orders", label: "Open Sales Orders", group: "all" as const, defaultOn: false },
  { key: "profit-loss", label: "Profit & loss", group: "all" as const, defaultOn: false },
  { key: "overdue", label: "Overdue Invoices", group: "all" as const, defaultOn: false },
  { key: "referrals", label: "Referrals", group: "all" as const, defaultOn: false },
  { key: "reviews", label: "Reviews & Testimonials", group: "all" as const, defaultOn: false },
  { key: "top-selling", label: "Top Selling Products", group: "all" as const, defaultOn: false },
  { key: "work-requests", label: "Work requests", group: "all" as const, defaultOn: false },
] as const;

export const SEARCH_RECENT = [
  {
    id: "inv-0042",
    title: "Invoice INV-0042",
    subtitle: "Demo Customer A · RWF 450,000",
    tag: "Invoice" as const,
    tone: "invoice" as const,
    to: "/invoices",
  },
  {
    id: "bank",
    title: "Bank transactions",
    subtitle: "Review and categorise your bank activity",
    tag: "Page" as const,
    tone: "page" as const,
    to: "/banking/transactions",
  },
  {
    id: "pnl",
    title: "Profit and loss",
    subtitle: "Financial performance for this month",
    tag: "Report" as const,
    tone: "report" as const,
    to: "/reports/statements",
  },
] as const;

export const SEARCH_EXPLORE = [
  { label: "Transactions", hint: "Invoices, bills, payments and journals", to: "/journals" },
  { label: "Contacts", hint: "Customers, suppliers and employees", to: "/customers" },
  { label: "Reports", hint: "Financial statements and saved reports", to: "/reports/statements" },
  { label: "Help centre", hint: "Guides and product support", to: "/" },
] as const;

export const SEARCH_RECENT_QUERIES = ["Unpaid invoices", "Bank of Kigali"] as const;

export const SEARCH_QUICK = [
  { label: "Create invoice", to: "/invoices", icon: "invoice" as const },
  { label: "Record expense", to: "/expenses", icon: "expense" as const },
  { label: "Add customer", to: "/customers", icon: "customer" as const },
] as const;

/** Module rail under the greeting (Accounting active in mock). */
export const MODULES = [
  { key: "accounting", label: "Accounting", to: "/", color: "#2f6fed", icon: "accounting" as const },
  { key: "expenses", label: "Expenses & Pay Bills", to: "/expenses", color: "#16a34a", icon: "expenses" as const },
  { key: "sales", label: "Sales & Get Paid", to: "/invoices", color: "#0d9488", icon: "sales" as const },
  { key: "customers", label: "Customer Hub", to: "/customers", color: "#0891b2", icon: "customers" as const },
  { key: "team", label: "Team", to: "/setup", color: "#1d4ed8", icon: "team" as const },
  { key: "projects", label: "Projects", to: "/dimensions", color: "#2563eb", icon: "projects" as const },
  { key: "inventory", label: "Inventory", to: "/inventory", color: "#312e81", icon: "inventory" as const },
  { key: "tax", label: "Tax", to: "/tax", color: "#7c3aed", icon: "tax" as const },
] as const;

export const QUICK_ACTIONS = [
  { label: "Create invoice", to: "/invoices", icon: "invoice" as const },
  { label: "Record expense", to: "/expenses", icon: "expense" as const },
  { label: "Add bank deposit", to: "/banking", icon: "deposit" as const },
  { label: "Create cheque", to: "/banking", icon: "cheque" as const },
] as const;

/** Dummy data and definitions for PRIMARY RIBBONS - TOOLS (#71–85). */

export type MyWorkflow = {
  id: string;
  name: string;
  transactionType: string;
  workflowType: string;
  createdOn: string;
  createdBy: string;
  lastUpdatedBy: string;
  updatedOn: string;
  enabled: boolean;
};

export const INITIAL_MY_WORKFLOWS: MyWorkflow[] = [
  {
    id: "wf-1",
    name: "Get unsent invoice reminder",
    transactionType: "Invoice",
    workflowType: "Reminder",
    createdOn: "10/16/2026",
    createdBy: "System Administration",
    lastUpdatedBy: "System Administration",
    updatedOn: "10/16/2026",
    enabled: true,
  },
  {
    id: "wf-2",
    name: "Pay vendor bill reminder",
    transactionType: "Bill",
    workflowType: "Reminder",
    createdOn: "10/16/2026",
    createdBy: "System Administration",
    lastUpdatedBy: "System Administration",
    updatedOn: "10/16/2026",
    enabled: true,
  },
  {
    id: "wf-3",
    name: "Send open estimate reminder",
    transactionType: "Estimate",
    workflowType: "Reminder",
    createdOn: "10/16/2026",
    createdBy: "System Administration",
    lastUpdatedBy: "System Administration",
    updatedOn: "10/16/2026",
    enabled: true,
  },
];

export type ImportCatalogItem = {
  id: string;
  title: string;
  iconName: string;
  category: "banking" | "sales" | "expenses" | "company" | "inventory";
  description: string;
  sampleColumns: string[];
};

export const IMPORT_CATALOG_ITEMS: ImportCatalogItem[] = [
  // Row 1 (Mockup 72)
  {
    id: "bank-data",
    title: "Bank data",
    iconName: "landmark",
    category: "banking",
    description: "Import transactions directly from CSV or OFX bank export files.",
    sampleColumns: ["Date", "Description", "Amount", "Payee", "Balance"],
  },
  {
    id: "customers",
    title: "Customers",
    iconName: "users",
    category: "sales",
    description: "Import customer contacts, billing addresses, phone numbers and tax IDs.",
    sampleColumns: ["Name", "Email", "Phone", "Billing Address", "Opening Balance"],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    iconName: "store",
    category: "expenses",
    description: "Bring in your suppliers, account numbers, payment terms and contact details.",
    sampleColumns: ["Supplier Name", "Contact Person", "Email", "Phone", "Terms"],
  },
  {
    id: "chart-of-accounts",
    title: "Chart of accounts",
    iconName: "file-text",
    category: "company",
    description: "Import existing account codes, account names, classifications and starting balances.",
    sampleColumns: ["Account Code", "Account Name", "Type", "Sub-type", "Opening Balance"],
  },
  {
    id: "products-services",
    title: "Products and services",
    iconName: "package",
    category: "inventory",
    description: "Import product catalog items, SKU codes, pricing, inventory assets and costs.",
    sampleColumns: ["Item Name", "SKU", "Type", "Sales Price", "Cost Price", "Tax Code"],
  },
  {
    id: "invoices",
    title: "Invoices",
    iconName: "file-check",
    category: "sales",
    description: "Import historical or open customer invoices and item line details.",
    sampleColumns: ["Invoice No", "Customer", "Date", "Due Date", "Item", "Quantity", "Rate"],
  },

  // Row 2 (Mockup 72)
  {
    id: "credit-notes",
    title: "Credit notes",
    iconName: "file-percent",
    category: "sales",
    description: "Import customer credit memos, allowances and returned goods adjustments.",
    sampleColumns: ["Credit Note No", "Customer", "Date", "Amount", "Reason"],
  },
  {
    id: "sales-receipts",
    title: "Sales receipts",
    iconName: "receipt",
    category: "sales",
    description: "Import point-of-sale or immediate cash sales transactions.",
    sampleColumns: ["Receipt No", "Date", "Customer", "Payment Method", "Deposit To", "Total"],
  },
  {
    id: "bills",
    title: "Bills",
    iconName: "clipboard-list",
    category: "expenses",
    description: "Import accounts payable vendor bills, due dates and line breakdowns.",
    sampleColumns: ["Bill No", "Supplier", "Date", "Due Date", "Category", "Amount"],
  },
  {
    id: "bill-payments",
    title: "Bill payments",
    iconName: "database-arrow-right",
    category: "expenses",
    description: "Import records of payments made to suppliers against open bills.",
    sampleColumns: ["Payment Date", "Supplier", "Bank Account", "Cheque No", "Amount Paid"],
  },
  {
    id: "cheques",
    title: "Cheques",
    iconName: "banknote",
    category: "banking",
    description: "Import issued cheques, payee names, cheque numbers and cleared dates.",
    sampleColumns: ["Cheque No", "Payee", "Bank Account", "Date", "Amount", "Memo"],
  },
  {
    id: "employees",
    title: "Employees",
    iconName: "user",
    category: "company",
    description: "Import payroll employee profiles, national IDs and department assignments.",
    sampleColumns: ["First Name", "Last Name", "Email", "Department", "Hire Date", "Salary"],
  },

  // Row 3 (Mockup 72 & 73)
  {
    id: "classes",
    title: "Classes",
    iconName: "git-fork",
    category: "company",
    description: "Import cost centers, segments and classification dimensions.",
    sampleColumns: ["Class Code", "Class Name", "Parent Class", "Status"],
  },
  {
    id: "credit-card-charges",
    title: "Credit card charges",
    iconName: "credit-card",
    category: "banking",
    description: "Import credit card purchase expenses and merchant statements.",
    sampleColumns: ["Transaction Date", "Card Account", "Merchant", "Amount", "Expense Category"],
  },
  {
    id: "credit-card-credits",
    title: "Credit card credits",
    iconName: "credit-card-arrow-left",
    category: "banking",
    description: "Import refunds and credit adjustments received on company credit cards.",
    sampleColumns: ["Date", "Card Account", "Merchant", "Amount", "Account"],
  },
  {
    id: "deposits",
    title: "Deposits",
    iconName: "database-arrow-down",
    category: "banking",
    description: "Import bank deposit slips and multiple lumped payment receipts.",
    sampleColumns: ["Deposit Date", "Deposit To Account", "Received From", "Amount"],
  },
  {
    id: "estimates",
    title: "Estimates",
    iconName: "calculator",
    category: "sales",
    description: "Import sales quotations and estimates provided to prospective clients.",
    sampleColumns: ["Estimate No", "Customer", "Date", "Expiry Date", "Total Amount"],
  },
  {
    id: "journal-entries",
    title: "Journal entries",
    iconName: "book-open",
    category: "company",
    description: "Import general ledger adjustment journals with balanced debit and credit lines.",
    sampleColumns: ["Journal Date", "Journal No", "Account Code", "Debit", "Credit", "Memo"],
  },

  // Row 4 (Mockup 73)
  {
    id: "locations",
    title: "Locations",
    iconName: "map-pin",
    category: "company",
    description: "Import company branches, warehouse sites and regional offices.",
    sampleColumns: ["Location Code", "Location Name", "Address", "City", "Country"],
  },
  {
    id: "purchase-orders",
    title: "Purchase orders",
    iconName: "file-plus",
    category: "expenses",
    description: "Import approved purchase orders sent to suppliers.",
    sampleColumns: ["PO Number", "Supplier", "Date", "Expected Date", "Line Items", "Total"],
  },
  {
    id: "cash-purchases",
    title: "Cash purchases",
    iconName: "shopping-cart",
    category: "expenses",
    description: "Import petty cash vouchers and out-of-pocket receipts.",
    sampleColumns: ["Date", "Paid To", "Paid From Account", "Amount", "Expense Category"],
  },
  {
    id: "receive-payments",
    title: "Receive payments",
    iconName: "hand-coins",
    category: "sales",
    description: "Import customer invoice collections, receipts and payment allocations.",
    sampleColumns: ["Payment Date", "Customer", "Invoice No", "Payment Method", "Amount"],
  },
  {
    id: "refund-receipts",
    title: "Refund receipts",
    iconName: "receipt-refund",
    category: "sales",
    description: "Import cash or card refunds issued back to customers.",
    sampleColumns: ["Refund No", "Customer", "Refund Date", "Refund From Account", "Amount"],
  },
  {
    id: "time-activities",
    title: "Time activities",
    iconName: "clock",
    category: "company",
    description: "Import billable employee timesheet activities and hours per project.",
    sampleColumns: ["Date", "Employee", "Customer/Project", "Service Item", "Hours", "Billable"],
  },

  // Row 5 (Mockup 73)
  {
    id: "transfers",
    title: "Transfers",
    iconName: "arrow-left-right",
    category: "banking",
    description: "Import internal fund transfers between company bank and cash accounts.",
    sampleColumns: ["Date", "Transfer From Account", "Transfer To Account", "Amount", "Memo"],
  },
  {
    id: "supplier-credits",
    title: "Supplier credits",
    iconName: "undo-2",
    category: "expenses",
    description: "Import credit memos and vendor returns from suppliers.",
    sampleColumns: ["Credit No", "Supplier", "Date", "Category", "Amount"],
  },
  {
    id: "stock-adjustment",
    title: "Stock adjustment",
    iconName: "boxes",
    category: "inventory",
    description: "Import physical inventory stock count adjustments and variances.",
    sampleColumns: ["Date", "Item SKU", "Location", "Quantity Adjusted", "Adjustment Reason"],
  },
];

export type ExportOption = {
  id: string;
  title: string;
  enabled: boolean;
};

export const DEFAULT_EXPORT_REPORTS: ExportOption[] = [
  { id: "general-ledger", title: "General ledger", enabled: true },
  { id: "profit-and-loss", title: "Profit and loss", enabled: true },
  { id: "balance-sheet", title: "Balance sheet", enabled: true },
  { id: "trial-balance", title: "Trial balance", enabled: true },
  { id: "journal", title: "Journal", enabled: true },
];

export const DEFAULT_EXPORT_LISTS: ExportOption[] = [
  { id: "customers", title: "Customers", enabled: true },
  { id: "suppliers", title: "Suppliers", enabled: true },
  { id: "employees", title: "Employees", enabled: true },
  { id: "products-and-services", title: "Products and services", enabled: true },
  { id: "chart-of-accounts", title: "Chart of accounts", enabled: true },
];

export type BudgetEditorRow = {
  id: string;
  category: "Income" | "Cost Of Goods Sold" | "Expenses";
  name: string;
  actualsYtd: number;
  months: number[]; // 12 values for Jan - Dec
};

export const INITIAL_BUDGET_ROWS: BudgetEditorRow[] = [
  // Income
  { id: "inc-1", category: "Income", name: "Billable Expense Income", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "inc-2", category: "Income", name: "Revenue - General", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "inc-3", category: "Income", name: "Sales - retail", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "inc-4", category: "Income", name: "Sales - wholesale", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "inc-5", category: "Income", name: "Sales of Product Income", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "inc-6", category: "Income", name: "Services", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "inc-7", category: "Income", name: "Uncategorised Income", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },

  // Cost Of Goods Sold
  { id: "cogs-1", category: "Cost Of Goods Sold", name: "Cost of sales", actualsYtd: 0.0, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

export type AuditLogItem = {
  id: string;
  dateChanged: string;
  user: string;
  event: string;
  eventLink?: string;
  hasViewHistory: boolean;
};

export const MOCKUP_AUDIT_LOG_EVENTS: AuditLogItem[] = [
  {
    id: "aud-1",
    dateChanged: "24 Oct, 12:31 pm Central Africa Time",
    user: "System Administration",
    event: "Added account Reconciliation Discrepancies",
    eventLink: "/accounting/chart-of-accounts",
    hasViewHistory: true,
  },
  {
    id: "aud-2",
    dateChanged: "24 Oct, 11:10 am Central Africa Time",
    user: "Iradukunda Enock",
    event: "Signed in.",
    hasViewHistory: false,
  },
  {
    id: "aud-3",
    dateChanged: "19 Oct, 9:15 pm Central Africa Time",
    user: "Iradukunda Enock",
    event: "Signed in.",
    hasViewHistory: false,
  },
  {
    id: "aud-4",
    dateChanged: "19 Oct, 3:00 pm Central Africa Time",
    user: "Iradukunda Enock",
    event: "Signed in.",
    hasViewHistory: false,
  },
  {
    id: "aud-5",
    dateChanged: "19 Oct, 1:02 pm Central Africa Time",
    user: "Iradukunda Enock",
    event: "Signed out.",
    hasViewHistory: false,
  },
  {
    id: "aud-6",
    dateChanged: "19 Oct, 11:24 am Central Africa Time",
    user: "Iradukunda Enock",
    event: "Signed in.",
    hasViewHistory: false,
  },
  {
    id: "aud-7",
    dateChanged: "19 Oct, 9:12 am Central Africa Time",
    user: "Iradukunda Enock",
    event: "Signed in.",
    hasViewHistory: false,
  },
];

export type BackupItem = {
  id: string;
  date: string;
  type: "Auto" | "Manual";
  kind?: "Incremental" | "Full" | "Complete";
  status: "Success" | "In progress" | "Failed";
  expiration: string;
};

export const INITIAL_BACKUPS: BackupItem[] = [
  {
    id: "bak-1",
    date: "24/10/2026 03:04 am",
    type: "Auto",
    status: "Success",
    expiration: "24/10/2027 03:04 am",
  },
  {
    id: "bak-2",
    date: "23/10/2026 03:04 am",
    type: "Auto",
    status: "Success",
    expiration: "23/10/2027 03:04 am",
  },
  {
    id: "bak-3",
    date: "22/10/2026 02:24 am",
    type: "Auto",
    status: "Success",
    expiration: "22/10/2027 02:24 am",
  },
  {
    id: "bak-4",
    date: "21/10/2026 02:17 am",
    type: "Auto",
    status: "Success",
    expiration: "21/10/2027 02:17 am",
  },
];

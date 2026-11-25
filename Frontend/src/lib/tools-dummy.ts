

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
    title: "Open invoices",
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
    title: "Open bills",
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

export type AuditLogItem = {
  id: string;
  dateChanged: string;
  user: string;
  event: string;
  eventLink?: string;
  hasViewHistory: boolean;
};

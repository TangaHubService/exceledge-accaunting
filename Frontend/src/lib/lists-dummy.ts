/** Dummy data for the PRIMARY RIBBONS List mockups (#57–70). */

export type ListEntry = {
  id: string;
  label: string;
  subtitle: string;
  count: number;
  to: string;
  icon: "accounting" | "customers" | "suppliers" | "inventory" | "team" | "bank" | "tax";
};

export const ALL_LISTS: ListEntry[] = [
  {
    id: "chart-of-accounts",
    label: "Chart of accounts",
    subtitle: "Income, expense, asset, liability and equity accounts",
    count: 64,
    to: "/accounting/chart-of-accounts",
    icon: "accounting",
  },
  {
    id: "customers",
    label: "Customers",
    subtitle: "People and businesses you sell to",
    count: 12,
    to: "/customers",
    icon: "customers",
  },
  {
    id: "suppliers",
    label: "Suppliers",
    subtitle: "People and businesses you buy from",
    count: 8,
    to: "/suppliers",
    icon: "suppliers",
  },
  {
    id: "products-services",
    label: "Products & services",
    subtitle: "Items you sell and the services you provide",
    count: 18,
    to: "/inventory",
    icon: "inventory",
  },
  {
    id: "employees",
    label: "Employees",
    subtitle: "Team members and their payroll details",
    count: 5,
    to: "/employees",
    icon: "team",
  },
  {
    id: "bank-accounts",
    label: "Bank accounts",
    subtitle: "Connected bank, mobile money and cash accounts",
    count: 3,
    to: "/banking",
    icon: "bank",
  },
  {
    id: "tax-codes",
    label: "Tax codes",
    subtitle: "VAT, withholding and sales tax rates",
    count: 6,
    to: "/tax/settings",
    icon: "tax",
  },
  {
    id: "recurring-transactions",
    label: "Recurring transactions",
    subtitle: "Automated journals, bills and expenses on a schedule",
    count: 4,
    to: "/accounting/recurring-transactions",
    icon: "accounting",
  },
];

/** Custom fields — mockup #66/#67 Custom fields onboarding + setup. */
export type CustomField = {
  id: string;
  name: string;
  appliesTo: string;
  type: "Text" | "Number" | "Date" | "Dropdown" | "Checkbox";
  required: boolean;
  active: boolean;
};

export const CUSTOM_FIELDS: CustomField[] = [
  { id: "cf1", name: "Customer PO number", appliesTo: "Invoices", type: "Text", required: false, active: true },
  { id: "cf2", name: "Project code", appliesTo: "Bills & expenses", type: "Dropdown", required: true, active: true },
  { id: "cf3", name: "Service date", appliesTo: "Invoices", type: "Date", required: false, active: true },
  { id: "cf4", name: "Priority", appliesTo: "Customers", type: "Dropdown", required: false, active: false },
  { id: "cf5", name: "Cost centre", appliesTo: "Journals", type: "Text", required: false, active: true },
];

/** Banking rules — mockup #69/#70 Rules Workspace + rule criteria / auto-post. */
export type BankRule = {
  id: string;
  name: string;
  appliesTo: "Money in" | "Money out" | "Both";
  condition: string;
  action: string;
  active: boolean;
  runs: number;
};

export const BANK_RULES: BankRule[] = [
  {
    id: "br1",
    name: "MTN mobile money receipts",
    appliesTo: "Money in",
    condition: "Description contains 'MTN'",
    action: "Categorise as Sales · Assign to Mobile money account",
    active: true,
    runs: 142,
  },
  {
    id: "br2",
    name: "Bank of Kigali supplier payments",
    appliesTo: "Money out",
    condition: "Payee contains 'BANK OF KIGALI' AND amount > 50000",
    action: "Categorise as Supplier payment · Auto-post",
    active: true,
    runs: 87,
  },
  {
    id: "br3",
    name: "Cash withdrawals",
    appliesTo: "Money out",
    condition: "Description contains 'ATM' OR 'Withdrawal'",
    action: "Categorise as Cash · Assign to Cash on hand",
    active: false,
    runs: 31,
  },
];

/** Attachments workspace — mockup #65. */
export type Attachment = {
  id: string;
  fileName: string;
  entityType: "Invoice" | "Bill" | "Expense" | "Journal" | "Purchase order";
  entityRef: string;
  uploadedAt: string;
  size: string;
};

export const ATTACHMENTS: Attachment[] = [
  { id: "a1", fileName: "INV-1005_Alpha_Ltd.pdf", entityType: "Invoice", entityRef: "INV-1005", uploadedAt: "26 Oct 2026", size: "214 KB" },
  { id: "a2", fileName: "BILL-0034_MTN.pdf", entityType: "Bill", entityRef: "BILL-0034", uploadedAt: "27 Oct 2026", size: "189 KB" },
  { id: "a3", fileName: "EXP-0112_office_supplies.jpg", entityType: "Expense", entityRef: "EXP-0112", uploadedAt: "25 Oct 2026", size: "412 KB" },
];

/** Products & services — mockup #59–62 onboarding, resource section, new service drawer/form. */
export type ProductService = {
  id: string;
  name: string;
  type: "Product" | "Service";
  category: string;
  salesAccount: string;
  purchaseAccount: string;
  salesPrice: number;
  purchaseCost: number;
  active: boolean;
};

export const PRODUCTS_SERVICES: ProductService[] = [
  { id: "ps1", name: "Consulting services", type: "Service", category: "Professional services", salesAccount: "4000 Sales", purchaseAccount: "5000 Direct costs", salesPrice: 150_000, purchaseCost: 0, active: true },
  { id: "ps2", name: "Laptop - Dell XPS 13", type: "Product", category: "IT equipment", salesAccount: "4000 Sales", purchaseAccount: "5000 Direct costs", salesPrice: 1_200_000, purchaseCost: 850_000, active: true },
  { id: "ps3", name: "Monthly bookkeeping", type: "Service", category: "Recurring", salesAccount: "4000 Sales", purchaseAccount: "5000 Direct costs", salesPrice: 350_000, purchaseCost: 0, active: true },
  { id: "ps4", name: "Office supplies", type: "Product", category: "Consumables", salesAccount: "4000 Sales", purchaseAccount: "5000 Direct costs", salesPrice: 45_000, purchaseCost: 28_000, active: true },
  { id: "ps5", name: "Tax advisory", type: "Service", category: "Professional services", salesAccount: "4000 Sales", purchaseAccount: "5000 Direct costs", salesPrice: 200_000, purchaseCost: 0, active: false },
];

export const ONBOARDING_STEPS = [
  { id: "1", label: "Add your products and services", done: true },
  { id: "2", label: "Set sales and purchase prices", done: true },
  { id: "3", label: "Link to income and expense accounts", done: false },
  { id: "4", label: "Start using on invoices and bills", done: false },
] as const;

/** Recurring transaction types — mockup #63/#64 menu and selector. */
export type RecurringTxnType = {
  id: string;
  label: string;
  subtitle: string;
  icon: "calendar" | "refresh" | "file-text" | "credit-card";
  to: string;
};

export const RECURRING_TXN_TYPES: RecurringTxnType[] = [
  { id: "recurring-invoice", label: "Recurring invoice", subtitle: "Send the same invoice to a customer on a schedule", icon: "file-text", to: "/invoices?recurring=1" },
  { id: "recurring-bill", label: "Recurring bill", subtitle: "Receive the same bill from a supplier on a schedule", icon: "file-text", to: "/bills?recurring=1" },
  { id: "recurring-expense", label: "Recurring expense", subtitle: "Record a repeating cost such as rent or subscriptions", icon: "credit-card", to: "/expenses/recurring" },
  { id: "recurring-journal", label: "Recurring journal entry", subtitle: "Post the same journal automatically each period", icon: "calendar", to: "/accounting/recurring-transactions" },
];

/** Select forms — mockup #68. */
export type FormTemplate = {
  id: string;
  name: string;
  type: "Invoice" | "Estimate" | "Sales receipt" | "Sales order" | "Bill" | "Purchase order";
  description: string;
  defaultFor: string;
};

export const FORM_TEMPLATES: FormTemplate[] = [
  { id: "f1", name: "Standard invoice", type: "Invoice", description: "Itemised bill sent to a customer for products or services.", defaultFor: "All customers" },
  { id: "f2", name: "Service invoice", type: "Invoice", description: "Invoice for time-based or professional services.", defaultFor: "Services" },
  { id: "f3", name: "Sales receipt", type: "Sales receipt", description: "Proof of payment issued at the point of sale.", defaultFor: "Retail sales" },
  { id: "f4", name: "Estimate", type: "Estimate", description: "Quote of expected costs before work begins.", defaultFor: "New projects" },
  { id: "f5", name: "Purchase order", type: "Purchase order", description: "Authorised request to a supplier for goods or services.", defaultFor: "All suppliers" },
];

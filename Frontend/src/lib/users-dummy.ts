/** Dummy data for Manage users / roles / accounting firms mocks. */

export const MANAGE_USERS = [
  {
    id: "u1",
    initials: "EI",
    color: "#2f6fed",
    name: "Enock Iradukunda",
    email: "enockiradukunda4@gmail.com",
    status: "Active" as const,
    role: "Company admin",
    billable: "Yes",
    action: "Transfer primary admin" as const,
  },
  {
    id: "u2",
    initials: "BN",
    color: "#7c3aed",
    name: "Bernard Niyonsenga",
    email: "bernard@exceledgecpa.com",
    status: "Active" as const,
    role: "Standard all access",
    billable: "Yes",
    action: "Edit" as const,
  },
];

export const SUGGESTED_ROLES = ["Sales and expense reports", "Invoices only", "Bills only"] as const;

export const MANAGE_ROLES = [
  {
    name: "Accounts payable manager",
    description: "Manage bills, suppliers and purchase transactions.",
    users: 0,
    updated: "16 Oct 2026",
    action: "Edit" as const,
  },
  {
    name: "Accounts receivable manager",
    description: "Manage invoices, customers and sales collections.",
    users: 0,
    updated: "16 Oct 2026",
    action: "Edit" as const,
  },
  {
    name: "Company admin",
    description: "Full company access, including user administration.",
    users: 1,
    updated: "16 Oct 2026",
    action: "View" as const,
  },
  {
    name: "Expense manager",
    description: "Manage expense transactions, suppliers, products, taxes and currencies.",
    users: 0,
    updated: "16 Oct 2026",
    action: "Edit" as const,
  },
  {
    name: "In-house accountant",
    description: "Access reports, bookkeeping and accounting tools; excludes payroll and user administration.",
    users: 0,
    updated: "—",
    action: "View" as const,
  },
  {
    name: "Inventory manager",
    description: "Manage products, services and inventory operations.",
    users: 0,
    updated: "16 Oct 2026",
    action: "Edit" as const,
  },
  {
    name: "Payroll manager",
    description: "Manage employee records and payroll processing.",
    users: 0,
    updated: "16 Oct 2026",
    action: "Edit" as const,
  },
  {
    name: "Sales manager",
    description: "Manage sales transactions, customers, products, taxes and currencies.",
    users: 0,
    updated: "16 Oct 2026",
    action: "Edit" as const,
  },
  {
    name: "Standard all access",
    description: "Full operational access including payroll, without admin privileges.",
    users: 0,
    updated: "—",
    action: "View" as const,
  },
  {
    name: "Standard limited customers and suppliers",
    description: "Manage customers, sales, suppliers and purchases.",
    users: 0,
    updated: "—",
    action: "View" as const,
  },
];

export const ADD_USER_ROLES = [
  "+ Add new role",
  "In-house accountant",
  "Standard all access",
  "Standard no access",
  "Accounts receivable manager",
  "Accounts payable manager",
  "Standard limited customers and suppliers",
  "Company admin",
  "Track time only",
  "View company reports",
  "Expense manager",
  "Sales manager",
  "Payroll manager",
  "Inventory manager",
] as const;

export const FORM_STYLES = [
  {
    id: "s1",
    name: "My INVOICE Template - 10-17 (4172)",
    formType: "Invoice",
    lastEdited: "17 Oct 2026",
    isDefault: false,
  },
  {
    id: "s2",
    name: "Standard",
    formType: "Default",
    lastEdited: "16 Oct 2026",
    isDefault: true,
  },
];

export const INVOICE_STYLE_MENU = [
  { id: "template", title: "Choose a template", subtitle: "Pick a layout that fits your business.", tone: "blue" },
  { id: "logo", title: "Add your logo", subtitle: "Upload and position your logo.", tone: "green" },
  { id: "colours", title: "Colours", subtitle: "Set your brand colours.", tone: "multi" },
  { id: "font", title: "Font", subtitle: "Choose a font for your invoice.", tone: "ink" },
  { id: "bank", title: "Bank transfer details", subtitle: "Add your bank or mobile money details.", tone: "teal" },
  { id: "print", title: "Print settings", subtitle: "Adjust page layout and display options.", tone: "navy" },
  {
    id: "stamp",
    title: "Stamp, signature or QR code",
    subtitle: "Add a finishing touch to your invoice.",
    tone: "lime",
    badge: "NEW",
  },
] as const;

export const KEYBOARD_SHORTCUTS = [
  { action: "Add a new transaction line", keys: ["Ctrl", "Alt", "N"] },
  { action: "Banking", keys: ["Ctrl", "Alt", "A"] },
  { action: "Batch edit", keys: ["Ctrl", "Alt", "B"] },
  { action: "Batch post", keys: ["Ctrl", "Alt", "Y"] },
  { action: "Chart of accounts", keys: ["Ctrl", "Alt", "C"] },
  { action: "Create invoice", keys: ["Ctrl", "Alt", "I"] },
  { action: "Customers", keys: ["Ctrl", "Alt", "U"] },
  { action: "Help", keys: ["Ctrl", "Alt", "H"] },
] as const;

export const COMPANY_ID = "9341 4585 0665 7455";

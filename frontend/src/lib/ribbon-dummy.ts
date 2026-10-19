/** Dummy data for Primary Ribbons overlays (workflows, inbox, settings mega-menu). */

export type WorkflowTemplate = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  icon: "file" | "chart" | "clock" | "bank" | "user" | "plane" | "bill" | "card" | "building" | "check";
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "po-update",
    title: "Notify about PO update",
    description: "Alert your team when a purchase order status or amount changes.",
    tags: ["Purchase order", "Notification"],
    icon: "file",
  },
  {
    id: "schedule-report",
    title: "Schedule and send a report",
    description: "Automatically email a report on a recurring schedule.",
    tags: ["Report", "Schedule"],
    icon: "chart",
  },
  {
    id: "supplier-credit",
    title: "Notify about supplier credit updated",
    description: "Get notified when supplier credits are created or changed.",
    tags: ["Supplier credit", "Notification"],
    icon: "card",
  },
  {
    id: "po-creation",
    title: "Notify about PO creation",
    description: "Send a notification when a new purchase order is created.",
    tags: ["Purchase order", "Notification"],
    icon: "file",
  },
  {
    id: "sales-tax-due",
    title: "Get sales tax due reminder",
    description: "Remind your team before sales tax filings are due.",
    tags: ["Tax", "Reminder"],
    icon: "clock",
  },
  {
    id: "bank-deposits-updated",
    title: "Notify about bank deposits updated",
    description: "Stay informed when bank deposits are edited or posted.",
    tags: ["Bank deposit", "Notification"],
    icon: "bank",
  },
  {
    id: "estimate-reminder",
    title: "Send estimate reminder",
    description: "Follow up with customers on outstanding estimates.",
    tags: ["Estimate", "Reminder"],
    icon: "plane",
  },
  {
    id: "payment-received",
    title: "Notify customers about payment received",
    description: "Automatically thank customers when a payment is recorded.",
    tags: ["Payment", "Notification"],
    icon: "plane",
  },
  {
    id: "pay-bill-reminder",
    title: "Pay supplier bill reminder",
    description: "Remind approvers to pay bills that are coming due.",
    tags: ["Bill", "Reminder"],
    icon: "bill",
  },
  {
    id: "overdue-invoice",
    title: "Overdue invoice memo",
    description: "Flag overdue invoices and nudge your collections workflow.",
    tags: ["Invoice", "Update"],
    icon: "file",
  },
  {
    id: "missing-customer",
    title: "Missing customer details reminder",
    description: "Prompt your team to complete incomplete customer records.",
    tags: ["Customer", "Reminder"],
    icon: "user",
  },
  {
    id: "unsent-invoice",
    title: "Get unsent invoice reminder",
    description: "Remind users to send invoices still sitting in draft.",
    tags: ["Invoice", "Reminder"],
    icon: "clock",
  },
  {
    id: "sales-receipt-created",
    title: "Notify about Sales Receipt created",
    description: "Alert stakeholders when a sales receipt is created.",
    tags: ["Sales Receipt", "Notification"],
    icon: "file",
  },
  {
    id: "bank-deposit-reminder",
    title: "Set bank deposit reminder",
    description: "Schedule a reminder to record or review bank deposits.",
    tags: ["Bank Deposit", "Reminder"],
    icon: "bank",
  },
  {
    id: "bill-approval",
    title: "Bill Multi-Condition Approval",
    description: "Route bills through multi-condition approval rules.",
    tags: ["Bill", "Approval"],
    icon: "check",
  },
  {
    id: "management-report",
    title: "Send a management report",
    description: "Schedule and send a management report to stakeholders.",
    tags: ["Management report", "Schedule"],
    icon: "chart",
  },
  {
    id: "invoice-update",
    title: "Notify about invoice update",
    description: "Notify your team when an invoice is updated.",
    tags: ["Invoice", "Notification"],
    icon: "file",
  },
  {
    id: "estimate-update",
    title: "Notify about estimate update",
    description: "Get alerts when estimates change status or amount.",
    tags: ["Estimate", "Notification"],
    icon: "file",
  },
  {
    id: "goods-feedback",
    title: "Get reminded to take feedback on the goods shipped",
    description: "Follow up after goods are shipped to collect feedback.",
    tags: ["Sales receipt", "Reminder"],
    icon: "clock",
  },
  {
    id: "invoice-approval",
    title: "Invoice Multi-Condition Approval",
    description: "Apply multi-condition approval before invoices are sent.",
    tags: ["Invoice", "Approval"],
    icon: "check",
  },
  {
    id: "bill-creation",
    title: "Notify about bill creation",
    description: "Alert approvers when a new supplier bill is entered.",
    tags: ["Bill", "Notification"],
    icon: "bill",
  },
  {
    id: "estimate-approval",
    title: "Estimate Multi-Condition Approval",
    description: "Route estimates through configurable approval conditions.",
    tags: ["Estimate", "Approval"],
    icon: "check",
  },
  {
    id: "sales-receipt-updated",
    title: "Notify about Sales Receipt updated",
    description: "Stay informed when sales receipts are edited.",
    tags: ["Sales receipt", "Notification"],
    icon: "file",
  },
  {
    id: "bank-deposits-created",
    title: "Notify about bank deposits created",
    description: "Notify your team when a bank deposit is created.",
    tags: ["Bank deposit", "Notification"],
    icon: "bank",
  },
  {
    id: "unsent-po",
    title: "Get unsent purchase order reminder",
    description: "Remind users to send purchase orders still in draft.",
    tags: ["Purchase order", "Reminder"],
    icon: "clock",
  },
  {
    id: "recurring-statement",
    title: "Send recurring statement to customer",
    description: "Automatically email customer statements on a schedule.",
    tags: ["Statement", "Schedule"],
    icon: "plane",
  },
  {
    id: "auto-send-invoices",
    title: "Automatically send unsent invoices",
    description: "Send approved invoices that are waiting to go out.",
    tags: ["Invoice", "Send"],
    icon: "plane",
  },
  {
    id: "missing-supplier",
    title: "Missing supplier details reminder",
    description: "Prompt your team to complete incomplete supplier records.",
    tags: ["Supplier", "Reminder"],
    icon: "building",
  },
  {
    id: "expenses-updated",
    title: "Notify about expenses updated",
    description: "Get notified when expenses are changed or approved.",
    tags: ["Expense", "Notification"],
    icon: "bill",
  },
  {
    id: "po-approval",
    title: "PO Multi-Condition Approval",
    description: "Route purchase orders through multi-condition approvals.",
    tags: ["Purchase order", "Approval"],
    icon: "check",
  },
  {
    id: "supplier-payment",
    title: "Notify supplier about payment",
    description: "Let suppliers know when a bill payment is recorded.",
    tags: ["Bill payment", "Notification"],
    icon: "plane",
  },
];

export type SettingsMenuItem = { label: string; to?: string; href?: string; accent?: boolean };
export type SettingsMenuColumn = { title: string; items: SettingsMenuItem[] };

export const SETTINGS_MEGA_MENU: SettingsMenuColumn[] = [
  {
    title: "YOUR COMPANY",
    items: [
      { label: "Account and settings", to: "/settings/company" },
      { label: "Manage users", to: "/users" },
      { label: "Custom form styles", to: "/settings/form-styles" },
      { label: "Default report settings", to: "/settings/reports" },
      { label: "Chart of accounts", to: "/accounts" },
      { label: "Get the mobile app" },
      { label: "Additional info", accent: true },
    ],
  },
  {
    title: "LISTS",
    items: [
      { label: "All lists", to: "/settings/company" },
      { label: "Products and services", to: "/inventory" },
      { label: "Recurring transactions", to: "/expenses/recurring" },
      { label: "Attachments", to: "/settings/advanced" },
      { label: "Custom fields", to: "/settings/advanced" },
      { label: "Rules", to: "/banking" },
    ],
  },
  {
    title: "TOOLS",
    items: [
      { label: "Manage workflows", to: "/workflows" },
      { label: "Reclassify transactions", to: "/banking/transactions" },
      { label: "Import data", to: "/journal-import" },
      { label: "Export data", to: "/reports/statements" },
      { label: "Reconcile", to: "/banking/reconciliation" },
      { label: "Budgeting", to: "/budgets" },
      { label: "Audit log", to: "/audit" },
      { label: "Back up company", to: "/settings/advanced" },
      { label: "Share screen" },
    ],
  },
  {
    title: "PROFILE",
    items: [
      { label: "Subscriptions and billing", to: "/settings/usage" },
      { label: "Feedback" },
      { label: "Privacy", to: "/settings/advanced" },
      { label: "Your Privacy Choices" },
      { label: "Switch company", to: "/settings/company" },
    ],
  },
];

export type InboxMessage = {
  id: string;
  initials: string;
  sender: string;
  badge?: string;
  date: string;
  subject: string;
  preview: string;
};

export const INBOX_SAMPLE: InboxMessage[] = [
  {
    id: "welcome",
    initials: "EE",
    sender: "Excel Edge Team",
    badge: "Preview",
    date: "14 Oct",
    subject: "Welcome to your Inbox",
    preview: "Keep your business conversations together.",
  },
];

export const HELP_SUGGESTIONS = [
  { id: "invoice", label: "How do I create an invoice?", icon: "file" as const },
  { id: "reconcile", label: "Help me reconcile a bank account", icon: "bank" as const },
  { id: "workflow", label: "Explore workflow automation", icon: "zap" as const },
  { id: "report", label: "Find a report", icon: "chart" as const },
];

export const INBOX_INTRO_KEY = "ee_inbox_intro_seen";

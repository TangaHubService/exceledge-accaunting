

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
      { label: "Chart of accounts", to: "/accounting/chart-of-accounts" },
      { label: "Get the mobile app" },
      { label: "Additional info", accent: true },
    ],
  },
  {
    title: "LISTS",
    items: [
      { label: "All lists", to: "/lists" },
      { label: "Products and services", to: "/products-services" },
      { label: "Recurring transactions", to: "/accounting/recurring-transactions" },
      { label: "Attachments", to: "/attachments" },
      { label: "Custom fields", to: "/settings/custom-fields" },
      { label: "Rules", to: "/banking/rules" },
    ],
  },
  {
    title: "TOOLS",
    items: [
      { label: "Manage workflows", to: "/workflows" },
      { label: "Reclassify transactions", to: "/banking/transactions" },
      { label: "Import data", to: "/import-data" },
      { label: "Export data", to: "/export-data" },
      { label: "Reconcile", to: "/banking/reconciliation" },
      { label: "Budgeting", to: "/budgets" },
      { label: "Audit log", to: "/audit" },
      { label: "Back up company", to: "/backup-restore" },
      { label: "Share screen", to: "share-screen" },
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

export const HELP_SUGGESTIONS = [
  { id: "invoice", label: "How do I create an invoice?", icon: "file" as const },
  { id: "reconcile", label: "Help me reconcile a bank account", icon: "bank" as const },
  { id: "workflow", label: "Explore workflow automation", icon: "zap" as const },
  { id: "report", label: "Find a report", icon: "chart" as const },
];

export const INBOX_INTRO_KEY = "ee_inbox_intro_seen";

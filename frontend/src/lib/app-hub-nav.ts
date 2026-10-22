/** Secondary “All apps” dock items — labels match the primary ribbon / flyout mocks. */

export type HubItem = {
  id: string;
  label: string;
  to: string;
  /** Path prefixes that mark this leaf active (defaults to `to`). */
  match?: string[];
};

export type HubDef = {
  key: string;
  items: readonly HubItem[];
  /** Path prefixes that mean this app is the current section. */
  activePrefixes: readonly string[];
};

export const ACCOUNTING_HUB_ITEMS: readonly HubItem[] = [
  { id: "bank-transactions", label: "Bank transactions", to: "/banking/transactions", match: ["/banking/transactions"] },
  { id: "integration-transactions", label: "Integration transactions", to: "/banking/integration-transactions", match: ["/banking/integration-transactions"] },
  { id: "reconcile", label: "Reconcile", to: "/banking/reconciliation", match: ["/banking/reconciliation"] },
  { id: "rules", label: "Rules", to: "/banking/rules", match: ["/banking/rules"] },
  {
    id: "chart-of-accounts",
    label: "Chart of accounts",
    to: "/accounting/chart-of-accounts",
    match: ["/accounting/chart-of-accounts", "/accounts"],
  },
  {
    id: "recurring-transactions",
    label: "Recurring transactions",
    to: "/accounting/recurring-transactions",
    match: ["/accounting/recurring-transactions", "/recurring-journals", "/recurring"],
  },
  { id: "revenue-recognition", label: "Revenue recognition", to: "/accounting/revenue-recognition", match: ["/accounting/revenue-recognition", "/journals"] },
  { id: "fixed-assets", label: "Fixed assets", to: "/fixed-assets", match: ["/fixed-assets"] },
  { id: "prepaid-expenses", label: "Prepaid expenses", to: "/accounting/prepaid-expenses", match: ["/accounting/prepaid-expenses"] },
  { id: "my-accountant", label: "My accountant", to: "/accounting/my-accountant", match: ["/accounting/my-accountant", "/setup"] },
];

export const EXPENSES_HUB_ITEMS: readonly HubItem[] = [
  { id: "expense-transactions", label: "Expense transactions", to: "/expenses", match: ["/expenses"] },
  { id: "suppliers", label: "Suppliers", to: "/suppliers", match: ["/suppliers"] },
  { id: "bills", label: "Bills", to: "/bills", match: ["/bills"] },
  { id: "supplier-payments", label: "Supplier payments", to: "/supplier-payments", match: ["/supplier-payments"] },
];

export const SALES_HUB_ITEMS: readonly HubItem[] = [
  { id: "sales-overview", label: "Overview", to: "/invoices" },
  { id: "sales-transactions", label: "All sales", to: "/invoices" },
  { id: "invoices", label: "Invoices", to: "/invoices", match: ["/invoices"] },
  { id: "products-services", label: "Products & services", to: "/inventory" },
];

export const CUSTOMER_HUB_ITEMS: readonly HubItem[] = [
  { id: "customers-overview", label: "Overview", to: "/customers" },
  { id: "customers-leads", label: "Customers & leads", to: "/customers", match: ["/customers"] },
  { id: "opportunities", label: "Opportunities", to: "/customers" },
  { id: "estimates", label: "Estimates", to: "/invoices" },
  { id: "proposals", label: "Proposals", to: "/invoices" },
  { id: "contracts", label: "Contracts", to: "/customers" },
  { id: "reviews", label: "Reviews", to: "/customers" },
];

export const TEAM_HUB_ITEMS: readonly HubItem[] = [
  { id: "team-overview", label: "Overview", to: "/employees" },
  { id: "employees", label: "Employees", to: "/employees", match: ["/employees"] },
  { id: "time-tracking", label: "Time tracking", to: "/time/weekly", match: ["/time"] },
  { id: "payroll", label: "Payroll", to: "/employees" },
];

export const PROJECTS_HUB_ITEMS: readonly HubItem[] = [
  { id: "projects-overview", label: "Overview", to: "/dimensions" },
  { id: "projects", label: "Projects", to: "/dimensions", match: ["/dimensions"] },
  { id: "tracking-categories", label: "Tracking categories", to: "/dimensions" },
];

export const INVENTORY_HUB_ITEMS: readonly HubItem[] = [
  { id: "items", label: "Items", to: "/inventory", match: ["/inventory"] },
  { id: "movements", label: "Stock movements", to: "/inventory/movements", match: ["/inventory/movements"] },
  { id: "stock-reconciliation", label: "Stock reconciliation", to: "/inventory/reconciliation", match: ["/inventory/reconciliation"] },
];

export const TAX_HUB_ITEMS: readonly HubItem[] = [
  { id: "tax-overview", label: "Overview", to: "/tax", match: ["/tax"] },
  { id: "vat", label: "VAT returns", to: "/tax/vat", match: ["/tax/vat"] },
  { id: "tax-payments", label: "Payments", to: "/tax/payments", match: ["/tax/payments"] },
  { id: "tax-filings", label: "Filings", to: "/tax/filings", match: ["/tax/filings"] },
  { id: "tax-settings", label: "Tax settings", to: "/tax/settings", match: ["/tax/settings"] },
];

export const APP_HUBS: readonly HubDef[] = [
  {
    key: "accounting",
    items: ACCOUNTING_HUB_ITEMS,
    activePrefixes: ["/accounting", "/accounts", "/banking", "/journals", "/fixed-assets", "/recurring", "/setup"],
  },
  { key: "expenses", items: EXPENSES_HUB_ITEMS, activePrefixes: ["/expenses", "/suppliers", "/bills", "/supplier-payments"] },
  { key: "sales", items: SALES_HUB_ITEMS, activePrefixes: ["/invoices"] },
  { key: "customers", items: CUSTOMER_HUB_ITEMS, activePrefixes: ["/customers"] },
  { key: "team", items: TEAM_HUB_ITEMS, activePrefixes: ["/employees", "/time"] },
  { key: "projects", items: PROJECTS_HUB_ITEMS, activePrefixes: ["/dimensions"] },
  { key: "inventory", items: INVENTORY_HUB_ITEMS, activePrefixes: ["/inventory"] },
  { key: "tax", items: TAX_HUB_ITEMS, activePrefixes: ["/tax"] },
];

const HUB_BY_KEY = Object.fromEntries(APP_HUBS.map((h) => [h.key, h])) as Record<string, HubDef>;

export function hubForApp(key: string): HubDef | undefined {
  return HUB_BY_KEY[key];
}

export function isAppActive(key: string, path: string): boolean {
  const hub = HUB_BY_KEY[key];
  if (!hub) return false;
  return hub.activePrefixes.some((p) => path === p || path.startsWith(p + "/"));
}

/** Longest matching leaf wins so `/inventory/movements` beats `/inventory`. */
export function resolveActiveLeaf(path: string, preferred?: string): string | undefined {
  if (preferred) return preferred;
  let best: { id: string; len: number } | undefined;
  for (const hub of APP_HUBS) {
    for (const item of hub.items) {
      const prefixes = item.match ?? [item.to];
      for (const p of prefixes) {
        if (path === p || path.startsWith(p + "/")) {
          if (!best || p.length > best.len) best = { id: item.id, len: p.length };
        }
      }
    }
  }
  return best?.id;
}

export function defaultOpenHubs(path: string): Record<string, boolean> {
  for (const hub of APP_HUBS) {
    if (isAppActive(hub.key, path)) return { [hub.key]: true };
  }
  return { accounting: true };
}

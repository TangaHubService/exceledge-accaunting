/** Setup section keys — Segment 2.6 */
export const SETUP_SECTIONS = [
  "COMPANY_PROFILE",
  "BUSINESS_ACCOUNTING_INFO",
  "FINANCIAL_YEAR_PERIODS",
  "CURRENCY",
  "ACCOUNTING_POLICIES",
  "LOCALIZATION",
  "DEFAULT_POSTING_ACCOUNTS",
  "INVENTORY_SETTINGS",
  "PARTY_DEFAULTS",
  "BANKING_PAYMENT",
  "TRANSACTION_NUMBERING",
  "APPROVAL_POSTING_CONTROLS",
  "OPENING_BALANCES",
  "REVIEW_ACTIVATION",
] as const;

export type SetupSectionKey = (typeof SETUP_SECTIONS)[number];

export const SETUP_SECTION_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "REQUIRES_REVIEW",
  "APPROVED",
  "CONFIGURATION_ERROR",
] as const;

export type SetupSectionStatusValue = (typeof SETUP_SECTION_STATUSES)[number];

export const ACTIVATION_STATUSES = [
  "NOT_ACTIVATED",
  "READY",
  "ACTIVATED",
  "CONFIGURATION_ERROR",
] as const;

export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

/** Sections that must be COMPLETED or APPROVED before activation (Seg 2.20) */
export const MANDATORY_SETUP_SECTIONS: SetupSectionKey[] = [
  "COMPANY_PROFILE",
  "BUSINESS_ACCOUNTING_INFO",
  "FINANCIAL_YEAR_PERIODS",
  "CURRENCY",
  "ACCOUNTING_POLICIES",
  "LOCALIZATION",
  "DEFAULT_POSTING_ACCOUNTS",
  "INVENTORY_SETTINGS",
  "PARTY_DEFAULTS",
  "BANKING_PAYMENT",
  "TRANSACTION_NUMBERING",
  "APPROVAL_POSTING_CONTROLS",
];

/** Opening balances are recommended; REVIEW_ACTIVATION is the gate itself */
export const SENSITIVE_SECTIONS: SetupSectionKey[] = [
  "CURRENCY",
  "FINANCIAL_YEAR_PERIODS",
  "ACCOUNTING_POLICIES",
  "LOCALIZATION",
  "DEFAULT_POSTING_ACCOUNTS",
];

export type PeriodFrequency =
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMI_ANNUAL"
  | "ANNUAL"
  | "CUSTOM";

export type PeriodStatus =
  | "FUTURE"
  | "OPEN"
  | "TEMPORARILY_LOCKED"
  | "CLOSED"
  | "REOPENED";

export interface GeneratedPeriod {
  name: string;
  sequence: number;
  startDate: Date;
  endDate: Date;
  status: PeriodStatus;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function endOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Generate non-overlapping accounting periods for a financial year (Seg 2.9).
 */
export function generateAccountingPeriods(input: {
  yearStart: Date;
  yearEnd: Date;
  frequency: PeriodFrequency;
  openFirst?: boolean;
}): GeneratedPeriod[] {
  const start = startOfDayUtc(input.yearStart);
  const end = endOfDayUtc(input.yearEnd);
  if (start > end) {
    throw new Error("Financial year start must be before end");
  }

  const monthsPerPeriod: Record<Exclude<PeriodFrequency, "CUSTOM" | "ANNUAL">, number> = {
    MONTHLY: 1,
    QUARTERLY: 3,
    SEMI_ANNUAL: 6,
  };

  if (input.frequency === "ANNUAL") {
    return [
      {
        name: `FY ${start.getUTCFullYear()}`,
        sequence: 1,
        startDate: start,
        endDate: end,
        status: "OPEN",
      },
    ];
  }

  if (input.frequency === "CUSTOM") {
    return [
      {
        name: "Period 1",
        sequence: 1,
        startDate: start,
        endDate: end,
        status: "OPEN",
      },
    ];
  }

  const step = monthsPerPeriod[input.frequency];
  const periods: GeneratedPeriod[] = [];
  let cursor = start;
  let seq = 1;

  while (cursor <= end) {
    const nextStart = addMonths(cursor, step);
    const periodEnd = endOfDayUtc(
      new Date(
        Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth(), nextStart.getUTCDate() - 1),
      ),
    );
    const clampedEnd = periodEnd > end ? end : periodEnd;
    periods.push({
      name: `P${seq}`,
      sequence: seq,
      startDate: cursor,
      endDate: clampedEnd,
      status: seq === 1 && input.openFirst !== false ? "OPEN" : "FUTURE",
    });
    cursor = startOfDayUtc(
      new Date(
        Date.UTC(clampedEnd.getUTCFullYear(), clampedEnd.getUTCMonth(), clampedEnd.getUTCDate() + 1),
      ),
    );
    seq += 1;
    if (seq > 36) break;
  }

  return periods;
}

export function periodsOverlap(
  a: { startDate: Date; endDate: Date },
  b: { startDate: Date; endDate: Date },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function assertNoPeriodOverlaps(
  periods: Array<{ startDate: Date; endDate: Date; name?: string }>,
): void {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (periodsOverlap(periods[i], periods[j])) {
        throw new Error(
          `Accounting periods overlap: ${periods[i].name ?? i} and ${periods[j].name ?? j}`,
        );
      }
    }
  }
}

export function openingBalancesBalanced(
  lines: Array<{ debit: number | string; credit: number | string }>,
  epsilon = 0.0001,
): boolean {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += Number(line.debit) || 0;
    credit += Number(line.credit) || 0;
  }
  return Math.abs(debit - credit) <= epsilon;
}

export function sumDebitsCredits(lines: Array<{ debit: number | string; credit: number | string }>) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += Number(line.debit) || 0;
    credit += Number(line.credit) || 0;
  }
  return { debit, credit, balanced: Math.abs(debit - credit) <= 0.0001 };
}

export function isSectionReadyForActivation(status: SetupSectionStatusValue): boolean {
  return status === "COMPLETED" || status === "APPROVED";
}

export interface ActivationGateInput {
  sectionStatuses: Partial<Record<SetupSectionKey, SetupSectionStatusValue>>;
  hasOpenPeriod: boolean;
  hasFinancialYear: boolean;
  hasFunctionalCurrency: boolean;
  hasChartOfAccounts: boolean;
  mandatoryDefaultAccountsMapped: boolean;
  localizationComplete: boolean;
  numberingConfigured: boolean;
  approvalControlsDefined: boolean;
  hasCriticalErrors: boolean;
}

export interface ActivationGateResult {
  canActivate: boolean;
  status: ActivationStatus;
  missing: string[];
  errors: string[];
}

export function evaluateActivationGate(input: ActivationGateInput): ActivationGateResult {
  const missing: string[] = [];
  const errors: string[] = [];

  if (input.hasCriticalErrors) {
    errors.push("Critical configuration errors must be resolved");
  }
  if (!input.hasFinancialYear) missing.push("financial_year");
  if (!input.hasOpenPeriod) missing.push("open_period");
  if (!input.hasFunctionalCurrency) missing.push("functional_currency");
  if (!input.hasChartOfAccounts) missing.push("chart_of_accounts");
  if (!input.mandatoryDefaultAccountsMapped) missing.push("default_posting_accounts");
  if (!input.localizationComplete) missing.push("localization");
  if (!input.numberingConfigured) missing.push("transaction_numbering");
  if (!input.approvalControlsDefined) missing.push("approval_posting_controls");

  for (const key of MANDATORY_SETUP_SECTIONS) {
    const status = input.sectionStatuses[key] ?? "NOT_STARTED";
    if (!isSectionReadyForActivation(status)) {
      missing.push(`section:${key}`);
    }
    if (status === "CONFIGURATION_ERROR") {
      errors.push(`Configuration error in ${key}`);
    }
  }

  const canActivate = missing.length === 0 && errors.length === 0;
  let status: ActivationStatus = "NOT_ACTIVATED";
  if (errors.length > 0) status = "CONFIGURATION_ERROR";
  else if (canActivate) status = "READY";

  return { canActivate, status, missing, errors };
}

export type ErpRole =
  | "SYSTEM_OWNER"
  | "ADMIN"
  | "BRANCH_MANAGER"
  | "ACCOUNTANT"
  | "SELLER";

export type AccountingCapability =
  | "setup:view"
  | "setup:prepare"
  | "setup:approve"
  | "setup:activate"
  | "audit:view"
  | "coa:view"
  | "coa:create"
  | "coa:edit"
  | "coa:deactivate"
  | "coa:import"
  | "coa:export"
  | "journal:view"
  | "journal:create"
  | "journal:post"
  | "journal:reverse"
  | "gl:view"
  | "exceptions:view"
  | "exceptions:retry"
  | "ar:view"
  | "ar:manage"
  | "ar:credit-override"
  | "ap:view"
  | "ap:manage"
  | "inventory:view"
  | "inventory:manage"
  | "bank:view"
  | "bank:manage"
  | "bank:approve"
  | "tax:view"
  | "tax:manage"
  | "tax:file"
  | "expense:view"
  | "expense:manage"
  | "expense:approve"
  | "fa:view"
  | "fa:manage"
  | "fa:post";

const ALL_FINANCE: AccountingCapability[] = [
  "setup:view",
  "setup:prepare",
  "setup:approve",
  "setup:activate",
  "audit:view",
  "coa:view",
  "coa:create",
  "coa:edit",
  "coa:deactivate",
  "coa:import",
  "coa:export",
  "journal:view",
  "journal:create",
  "journal:post",
  "journal:reverse",
  "gl:view",
  "exceptions:view",
  "exceptions:retry",
  "ar:view",
  "ar:manage",
  "ar:credit-override",
  "ap:view",
  "ap:manage",
  "inventory:view",
  "inventory:manage",
  "bank:view",
  "bank:manage",
  "bank:approve",
  "tax:view",
  "tax:manage",
  "tax:file",
  "expense:view",
  "expense:manage",
  "expense:approve",
  "fa:view",
  "fa:manage",
  "fa:post",
];

const ROLE_CAPABILITIES: Record<ErpRole, AccountingCapability[]> = {
  SYSTEM_OWNER: ALL_FINANCE,
  ADMIN: ALL_FINANCE,
  BRANCH_MANAGER: [
    "setup:view",
    "setup:prepare",
    "audit:view",
    "coa:view",
    "coa:create",
    "coa:edit",
    "coa:export",
    "journal:view",
    "journal:create",
    "gl:view",
    "exceptions:view",
    "ar:view",
    "ap:view",
    "inventory:view",
    "bank:view",
    "tax:view",
    "expense:view",
    "expense:manage",
    "fa:view",
  ],
  ACCOUNTANT: [
    "setup:view",
    "setup:prepare",
    "audit:view",
    "coa:view",
    "coa:create",
    "coa:edit",
    "coa:export",
    "journal:view",
    "journal:create",
    "journal:post",
    "journal:reverse",
    "gl:view",
    "exceptions:view",
    "exceptions:retry",
    "ar:view",
    "ar:manage",
    "ap:view",
    "ap:manage",
    "inventory:view",
    "inventory:manage",
    "bank:view",
    "bank:manage",
    "tax:view",
    "tax:manage",
    "expense:view",
    "expense:manage",
    "expense:approve",
    "fa:view",
    "fa:manage",
    "fa:post",
  ],
  SELLER: [],
};

export function capabilitiesForRole(role: string | undefined | null): AccountingCapability[] {
  if (!role) return [];
  const key = role.toUpperCase() as ErpRole;
  return ROLE_CAPABILITIES[key] ?? [];
}

export function hasCapability(
  role: string | undefined | null,
  capability: AccountingCapability,
): boolean {
  return capabilitiesForRole(role).includes(capability);
}

/** Minimal system COA seed codes for Phase 1 default posting maps (full COA = Phase 2) */
export const SYSTEM_ACCOUNT_SEED: Array<{
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "COST_OF_SALES" | "EXPENSE" | "OTHER_INCOME" | "OTHER_EXPENSE";
  systemProtected: boolean;
}> = [
  { code: "1100", name: "Cash on Hand", type: "ASSET", systemProtected: true },
  { code: "1110", name: "Bank Account", type: "ASSET", systemProtected: true },
  { code: "1120", name: "Petty Cash", type: "ASSET", systemProtected: true },
  { code: "1130", name: "Mobile Money Clearing", type: "ASSET", systemProtected: true },
  { code: "1140", name: "Undeposited Funds", type: "ASSET", systemProtected: true },
  { code: "1200", name: "Accounts Receivable", type: "ASSET", systemProtected: true },
  { code: "1300", name: "Inventory Asset", type: "ASSET", systemProtected: true },
  { code: "1400", name: "Input Tax Receivable", type: "ASSET", systemProtected: true },
  { code: "1500", name: "Fixed Asset Cost", type: "ASSET", systemProtected: true },
  { code: "1510", name: "Accumulated Depreciation", type: "ASSET", systemProtected: true },
  { code: "1600", name: "Goods In Transit", type: "ASSET", systemProtected: true },
  { code: "2100", name: "Accounts Payable", type: "LIABILITY", systemProtected: true },
  { code: "2110", name: "Supplier Advances", type: "LIABILITY", systemProtected: true },
  { code: "2120", name: "Customer Deposits", type: "LIABILITY", systemProtected: true },
  { code: "2130", name: "Goods Received Not Invoiced", type: "LIABILITY", systemProtected: true },
  { code: "2200", name: "Output Tax Payable", type: "LIABILITY", systemProtected: true },
  { code: "2210", name: "Withholding Tax Payable", type: "LIABILITY", systemProtected: true },
  { code: "2300", name: "Payroll Payable", type: "LIABILITY", systemProtected: true },
  { code: "2400", name: "Bank Charges", type: "EXPENSE", systemProtected: true },
  { code: "3100", name: "Retained Earnings", type: "EQUITY", systemProtected: true },
  { code: "3200", name: "Current Year Earnings", type: "EQUITY", systemProtected: true },
  { code: "3300", name: "Asset Revaluation Reserve", type: "EQUITY", systemProtected: true },
  { code: "4100", name: "Sales Revenue", type: "INCOME", systemProtected: true },
  { code: "4110", name: "Service Revenue", type: "INCOME", systemProtected: true },
  { code: "4200", name: "Interest Income", type: "OTHER_INCOME", systemProtected: true },
  { code: "4300", name: "Foreign Exchange Gain", type: "OTHER_INCOME", systemProtected: true },
  { code: "5100", name: "Cost of Sales", type: "COST_OF_SALES", systemProtected: true },
  { code: "5200", name: "Purchases", type: "COST_OF_SALES", systemProtected: true },
  { code: "6100", name: "Salaries and Wages", type: "EXPENSE", systemProtected: true },
  { code: "6200", name: "Bad Debt Expense", type: "EXPENSE", systemProtected: true },
  { code: "6300", name: "Depreciation Expense", type: "EXPENSE", systemProtected: true },
  { code: "6400", name: "Inventory Adjustment", type: "EXPENSE", systemProtected: true },
  { code: "6410", name: "Inventory Write-Off", type: "EXPENSE", systemProtected: true },
  { code: "6420", name: "Inventory Loss", type: "EXPENSE", systemProtected: true },
  { code: "6500", name: "Foreign Exchange Loss", type: "OTHER_EXPENSE", systemProtected: true },
  { code: "6600", name: "Suspense Account", type: "ASSET", systemProtected: true },
  { code: "6700", name: "Rounding Difference", type: "EXPENSE", systemProtected: true },
  { code: "6800", name: "Sales Discounts", type: "INCOME", systemProtected: true },
  { code: "6810", name: "Sales Returns", type: "INCOME", systemProtected: true },
  { code: "6900", name: "Inventory Gain", type: "OTHER_INCOME", systemProtected: true },
  { code: "7100", name: "Asset Disposal", type: "ASSET", systemProtected: true },
  { code: "7110", name: "Gain on Disposal", type: "OTHER_INCOME", systemProtected: true },
  { code: "7120", name: "Loss on Disposal", type: "OTHER_EXPENSE", systemProtected: true },
];

export const MANDATORY_DEFAULT_ACCOUNT_KEYS = [
  "accountsReceivableId",
  "salesRevenueId",
  "accountsPayableId",
  "defaultCashAccountId",
  "defaultBankAccountId",
  "inventoryAssetId",
  "costOfSalesId",
  "outputTaxPayableId",
  "inputTaxReceivableId",
  "retainedEarningsId",
  "currentYearEarningsId",
  "suspenseAccountId",
] as const;

export type MandatoryDefaultAccountKey = (typeof MANDATORY_DEFAULT_ACCOUNT_KEYS)[number];

export type AccountTypeCode =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "INCOME"
  | "COST_OF_SALES"
  | "EXPENSE"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE";

/** Seg 3.7 account numbering ranges */
export const ACCOUNT_TYPE_RANGES: Record<AccountTypeCode, { min: number; max: number; label: string }> = {
  ASSET: { min: 1000, max: 1999, label: "Assets" },
  LIABILITY: { min: 2000, max: 2999, label: "Liabilities" },
  EQUITY: { min: 3000, max: 3999, label: "Equity" },
  INCOME: { min: 4000, max: 4999, label: "Income" },
  COST_OF_SALES: { min: 5000, max: 5999, label: "Cost of Sales" },
  EXPENSE: { min: 6000, max: 6999, label: "Operating Expenses" },
  OTHER_INCOME: { min: 7000, max: 7999, label: "Other Income" },
  OTHER_EXPENSE: { min: 8000, max: 8999, label: "Other Expenses" },
};

export function parseAccountCodeNumber(code: string): number | null {
  const digits = code.replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits.slice(0, 4).padEnd(4, "0").slice(0, 4)) || Number(digits);
}

export function accountTypeForCode(code: string): AccountTypeCode | null {
  const n = parseAccountCodeNumber(code);
  if (n == null) return null;
  for (const [type, range] of Object.entries(ACCOUNT_TYPE_RANGES) as Array<
    [AccountTypeCode, { min: number; max: number }]
  >) {
    if (n >= range.min && n <= range.max) return type;
  }
  return null;
}

export function assertCodeMatchesType(code: string, type: AccountTypeCode): void {
  const inferred = accountTypeForCode(code);
  if (!inferred) {
    throw new Error("Account code must contain a numeric segment within 1000–8999");
  }
  if (inferred !== type) {
    const range = ACCOUNT_TYPE_RANGES[type];
    throw new Error(
      `Account code ${code} does not match type ${type} (expected ${range.min}–${range.max})`,
    );
  }
}

export interface CoaAccountInput {
  code: string;
  name: string;
  type: AccountTypeCode;
  parentId?: string | null;
  parentType?: AccountTypeCode | null;
  parentCode?: string | null;
  existingCodes: Set<string>;
  existingNamesInType: Set<string>;
  systemProtected?: boolean;
}

export function validateNewAccount(input: CoaAccountInput): void {
  if (!input.code?.trim()) throw new Error("Account code is required");
  if (!input.name?.trim()) throw new Error("Account name is required");
  if (!input.type) throw new Error("Account type is required");
  assertCodeMatchesType(input.code.trim(), input.type);
  if (input.existingCodes.has(input.code.trim())) {
    throw new Error("Account code must be unique");
  }
  const nameKey = input.name.trim().toLowerCase();
  if (input.existingNamesInType.has(nameKey)) {
    throw new Error("Account name must be unique within its category");
  }
  if (input.parentId) {
    if (!input.parentType) throw new Error("Parent account does not exist");
    if (input.parentType !== input.type) {
      throw new Error("Account category must match the parent account");
    }
  }
}

export function validateAccountUpdate(input: {
  existing: {
    code: string;
    systemProtected: boolean;
    hasPostedTransactions: boolean;
    type: AccountTypeCode;
  };
  nextCode?: string;
  nextType?: AccountTypeCode;
  nextName?: string;
  nameTakenInType?: boolean;
  allowProtectedMutation?: boolean;
}): void {
  if (input.existing.systemProtected && !input.allowProtectedMutation) {
    if (input.nextCode && input.nextCode !== input.existing.code) {
      throw new Error("Protected system accounts cannot change code");
    }
    if (input.nextType && input.nextType !== input.existing.type) {
      throw new Error("Protected system accounts cannot change type");
    }
  }
  if (input.existing.hasPostedTransactions && input.nextCode && input.nextCode !== input.existing.code) {
    throw new Error("Account codes cannot be modified once transactions have been posted");
  }
  if (input.nextCode && input.nextCode !== input.existing.code) {
    assertCodeMatchesType(input.nextCode, input.nextType ?? input.existing.type);
  }
  if (input.nameTakenInType) {
    throw new Error("Account name must be unique within its category");
  }
}

export function canHardDeleteAccount(input: {
  systemProtected: boolean;
  hasPostedTransactions: boolean;
  childCount: number;
}): { allowed: boolean; reason?: string } {
  if (input.systemProtected) return { allowed: false, reason: "Protected system accounts cannot be deleted" };
  if (input.hasPostedTransactions) {
    return { allowed: false, reason: "Accounts with posted transactions cannot be permanently deleted" };
  }
  if (input.childCount > 0) return { allowed: false, reason: "Deactivate or reassign child accounts first" };
  return { allowed: true };
}

export interface CoaTreeNode<T extends { id: string; parentId?: string | null; children?: CoaTreeNode<T>[] }> {
  id: string;
  parentId?: string | null;
  children: CoaTreeNode<T>[];
  [key: string]: unknown;
}

export function buildAccountTree<T extends { id: string; parentId: string | null }>(
  accounts: T[],
): Array<T & { children: Array<T & { children: unknown[] }> }> {
  const map = new Map<string, T & { children: Array<T & { children: unknown[] }> }>();
  for (const a of accounts) {
    map.set(a.id, { ...a, children: [] });
  }
  const roots: Array<T & { children: Array<T & { children: unknown[] }> }> = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (nodes: Array<T & { children: Array<T & { children: unknown[] }> }>) => {
    nodes.sort((a, b) => String((a as { code?: string }).code ?? "").localeCompare(String((b as { code?: string }).code ?? "")));
    for (const n of nodes) sortRec(n.children as typeof nodes);
  };
  sortRec(roots);
  return roots;
}

export function detectImportDuplicates(
  rows: Array<{ code: string; name: string; type: string }>,
): { duplicateCodes: string[]; duplicateNamesByType: string[] } {
  const codes = new Map<string, number>();
  const names = new Map<string, number>();
  for (const row of rows) {
    const c = row.code.trim();
    const n = `${row.type}:${row.name.trim().toLowerCase()}`;
    codes.set(c, (codes.get(c) ?? 0) + 1);
    names.set(n, (names.get(n) ?? 0) + 1);
  }
  return {
    duplicateCodes: [...codes.entries()].filter(([, n]) => n > 1).map(([c]) => c),
    duplicateNamesByType: [...names.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  };
}

export const COA_IMPORT_TEMPLATE_HEADERS = [
  "code",
  "name",
  "type",
  "parentCode",
  "description",
  "reportingGroup",
  "currency",
  "branchId",
  "costCentre",
  "taxMapping",
  "allowManualPost",
  "allowAutoPost",
  "bankReconciliationRequired",
  "isCashAccount",
  "isTaxAccount",
  "isInventoryAccount",
  "requireApproval",
  "allowNegativeBalance",
  "isActive",
] as const;

export const ACCOUNTING_EVENT_TYPES = [
  "SALE_COMPLETED",
  "SALES_RETURN_COMPLETED",
  "CUSTOMER_PAYMENT_RECEIVED",
  "SUPPLIER_BILL_APPROVED",
  "GOODS_RECEIVED",
  "SUPPLIER_PAYMENT_COMPLETED",
  "INVENTORY_ADJUSTED",
  "INVENTORY_WRITTEN_OFF",
  "EXPENSE_APPROVED",
  "BANK_TRANSACTION_POSTED",
  "PAYROLL_APPROVED",
  "ASSET_ACQUIRED",
  "DEPRECIATION_POSTED",
] as const;

export type AccountingEventType = (typeof ACCOUNTING_EVENT_TYPES)[number];

export interface JournalLineDraft {
  accountId: string;
  accountCode?: string;
  description?: string;
  debit: number;
  credit: number;
  taxCode?: string;
  customerRef?: string;
  supplierRef?: string;
}

export function sumJournalLines(lines: JournalLineDraft[]) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += Number(line.debit) || 0;
    credit += Number(line.credit) || 0;
  }
  return { debit, credit, balanced: Math.abs(debit - credit) <= 0.0001 };
}

export function assertJournalBalanced(lines: JournalLineDraft[], epsilon = 0.0001): void {
  if (lines.length < 2) {
    throw new Error("Journal must have at least two lines");
  }
  for (const line of lines) {
    const d = Number(line.debit) || 0;
    const c = Number(line.credit) || 0;
    if (d < 0 || c < 0) throw new Error("Debit and credit amounts cannot be negative");
    if (d > 0 && c > 0) throw new Error("A journal line cannot have both debit and credit");
    if (d === 0 && c === 0) throw new Error("A journal line must have a debit or credit amount");
    if (!line.accountId) throw new Error("Each journal line requires an accountId");
  }
  const { debit, credit, balanced } = sumJournalLines(lines);
  if (!balanced || Math.abs(debit - credit) > epsilon) {
    throw new Error(`Unbalanced journal: debit=${debit} credit=${credit}`);
  }
}

export function reverseJournalLines(lines: JournalLineDraft[]): JournalLineDraft[] {
  return lines.map((l) => ({
    ...l,
    debit: Number(l.credit) || 0,
    credit: Number(l.debit) || 0,
    description: l.description ? `Reversal: ${l.description}` : "Reversal",
  }));
}

export interface DefaultAccountMap {
  accountsReceivableId?: string | null;
  salesRevenueId?: string | null;
  serviceRevenueId?: string | null;
  salesDiscountsId?: string | null;
  salesReturnsId?: string | null;
  outputTaxPayableId?: string | null;
  defaultCashAccountId?: string | null;
  defaultBankAccountId?: string | null;
  mobileMoneyClearingId?: string | null;
  pettyCashAccountId?: string | null;
  undepositedFundsId?: string | null;
  bankChargesId?: string | null;
  interestIncomeId?: string | null;
  inventoryAssetId?: string | null;
  costOfSalesId?: string | null;
  accountsPayableId?: string | null;
  purchasesId?: string | null;
  purchaseDiscountsId?: string | null;
  purchaseReturnsId?: string | null;
  supplierAdvancesId?: string | null;
  withholdingTaxPayableId?: string | null;
  grniId?: string | null;
  goodsInTransitId?: string | null;
  inputTaxReceivableId?: string | null;
  inventoryAdjustmentId?: string | null;
  inventoryWriteOffId?: string | null;
  inventoryGainId?: string | null;
  inventoryLossId?: string | null;
  customerDepositsId?: string | null;
  suspenseAccountId?: string | null;
  retainedEarningsId?: string | null;
  payrollTaxPayableId?: string | null;
  withholdingTaxReceivableId?: string | null;
  accruedExpensesId?: string | null;
  fixedAssetCostId?: string | null;
  accumulatedDepreciationId?: string | null;
  depreciationExpenseId?: string | null;
  assetDisposalId?: string | null;
  gainOnDisposalId?: string | null;
  lossOnDisposalId?: string | null;
  assetRevaluationReserveId?: string | null;
}

export interface SaleEventAmounts {
  net: number;
  tax: number;
  gross: number;
  discount?: number;
  cogs?: number;
  paymentMethod?: "CASH" | "BANK" | "MOBILE_MONEY" | "CARD" | "CREDIT" | string;
}

/** Build balanced SALE_COMPLETED lines from configured default accounts (no hardcoded IDs). */
export function buildSaleCompletedLines(
  defaults: DefaultAccountMap,
  amounts: SaleEventAmounts,
): JournalLineDraft[] {
  const net = Number(amounts.net) || 0;
  const tax = Number(amounts.tax) || 0;
  const discount = Number(amounts.discount) || 0;
  const cogs = Number(amounts.cogs) || 0;
  const method = (amounts.paymentMethod || "CASH").toUpperCase();

  const debitAccount =
    method === "CREDIT" || method === "DEBT" || method === "INSURANCE"
      ? defaults.accountsReceivableId
      : method === "BANK" || method === "CARD"
        ? defaults.defaultBankAccountId
        : method === "MOBILE_MONEY" || method === "MTN_MOMO" || method === "AIRTEL_MONEY"
          ? defaults.mobileMoneyClearingId || defaults.defaultCashAccountId
          : defaults.defaultCashAccountId;

  if (!debitAccount) throw new Error("Default cash/AR/bank posting account is not configured");
  if (!defaults.salesRevenueId) throw new Error("Default sales revenue account is not configured");

  const lines: JournalLineDraft[] = [];
  const grossDebit = net + tax - discount;
  if (grossDebit <= 0 && net <= 0) {
    throw new Error("Sale amounts must be positive");
  }

  lines.push({
    accountId: debitAccount,
    description: "Sale receipt / receivable",
    debit: Math.max(grossDebit, 0),
    credit: 0,
  });

  if (discount > 0) {
    if (!defaults.salesDiscountsId) throw new Error("Sales discounts account is not configured");
    lines.push({
      accountId: defaults.salesDiscountsId,
      description: "Sales discount",
      debit: discount,
      credit: 0,
    });
  }

  lines.push({
    accountId: defaults.salesRevenueId,
    description: "Sales revenue",
    debit: 0,
    credit: net,
  });

  if (tax > 0) {
    if (!defaults.outputTaxPayableId) throw new Error("Output tax account is not configured");
    lines.push({
      accountId: defaults.outputTaxPayableId,
      description: "Output VAT",
      debit: 0,
      credit: tax,
    });
  }

  if (cogs > 0) {
    if (!defaults.costOfSalesId || !defaults.inventoryAssetId) {
      throw new Error("COGS/Inventory default accounts are not configured");
    }
    lines.push({
      accountId: defaults.costOfSalesId,
      description: "Cost of goods sold",
      debit: cogs,
      credit: 0,
    });
    lines.push({
      accountId: defaults.inventoryAssetId,
      description: "Inventory relief",
      debit: 0,
      credit: cogs,
    });
  }

  assertJournalBalanced(lines);
  return lines;
}

export function buildCustomerPaymentLines(
  defaults: DefaultAccountMap,
  amount: number,
  method: string = "CASH",
): JournalLineDraft[] {
  const m = method.toUpperCase();
  const debitAccount =
    m === "BANK" || m === "CARD"
      ? defaults.defaultBankAccountId
      : m === "MOBILE_MONEY" || m === "MTN_MOMO"
        ? defaults.mobileMoneyClearingId || defaults.defaultCashAccountId
        : defaults.defaultCashAccountId;
  if (!debitAccount || !defaults.accountsReceivableId) {
    throw new Error("Cash/Bank and AR default accounts are required for customer payments");
  }
  const lines: JournalLineDraft[] = [
    { accountId: debitAccount, description: "Customer payment", debit: amount, credit: 0 },
    {
      accountId: defaults.accountsReceivableId,
      description: "AR allocation",
      debit: 0,
      credit: amount,
    },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export const CUSTOMER_TYPES = [
  "CASH",
  "CREDIT",
  "WALK_IN",
  "GOVERNMENT",
  "CORPORATE",
  "NGO",
  "INDIVIDUAL",
  "EXPORT",
  "FOREIGN",
] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

const CREDIT_CONTROLLED_TYPES = new Set<string>([
  "CREDIT",
  "GOVERNMENT",
  "CORPORATE",
  "NGO",
  "EXPORT",
  "FOREIGN",
]);

export const AGEING_BUCKETS = [
  { key: "CURRENT", label: "Current" },
  { key: "D1_30", label: "1–30 Days" },
  { key: "D31_60", label: "31–60 Days" },
  { key: "D61_90", label: "61–90 Days" },
  { key: "D91_120", label: "91–120 Days" },
  { key: "OVER_120", label: "Over 120 Days" },
] as const;

export type AgeingBucketKey = (typeof AGEING_BUCKETS)[number]["key"];

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

export function ageingBucketKey(dueDate: Date, asOf: Date): AgeingBucketKey {
  const due = startOfDayUtc(dueDate).getTime();
  const asOfDay = startOfDayUtc(asOf).getTime();
  const days = Math.floor((asOfDay - due) / 86_400_000);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  if (days <= 120) return "D91_120";
  return "OVER_120";
}

export function assertCustomerTransactable(input: {
  exists: boolean;
  active: boolean;
  creditStatus?: string | null;
}): void {
  if (!input.exists) throw new Error("Customer does not exist");
  if (!input.active) throw new Error("Customer account is not active");
  if (input.creditStatus === "BLOCKED" || input.creditStatus === "ON_HOLD") {
    throw new Error("Customer credit status does not allow new receivables");
  }
}

export function assertCreditAvailable(input: {
  customerType: string;
  creditLimit: number;
  outstanding: number;
  additional: number;
  allowOverride?: boolean;
}): void {
  if (!CREDIT_CONTROLLED_TYPES.has(input.customerType)) return;
  const limit = Number(input.creditLimit) || 0;
  if (limit <= 0) return;
  const next = roundMoney(Number(input.outstanding) + Number(input.additional));
  if (next > limit + 0.0001 && !input.allowOverride) {
    throw new Error("Credit limit exceeded");
  }
}

export function assertReceiptAllocations(input: {
  amount: number;
  allocations: Array<{ amount: number; outstanding: number }>;
  allowOverpayment: boolean;
  document?: string;
}): { allocated: number; unallocated: number } {
  let allocated = 0;
  for (const row of input.allocations) {
    const amount = roundMoney(row.amount);
    if (amount <= 0) throw new Error("Allocation amount must be positive");
    if (amount - roundMoney(row.outstanding) > 0.0001) {
      throw new Error(`Allocation exceeds ${input.document ?? "invoice"} outstanding balance`);
    }
    allocated = roundMoney(allocated + amount);
  }
  const payment = roundMoney(input.amount);
  if (payment <= 0) throw new Error("Payment amount must be positive");
  if (allocated - payment > 0.0001) throw new Error("Allocations exceed payment amount");
  const unallocated = roundMoney(payment - allocated);
  if (unallocated > 0.0001 && !input.allowOverpayment) {
    throw new Error("Unallocated payment is not allowed");
  }
  return { allocated, unallocated };
}

export function settlementAccountId(
  defaults: DefaultAccountMap,
  method: string,
): string | null | undefined {
  const m = (method || "CASH").toUpperCase();
  if (m === "BANK" || m === "CARD" || m === "CHEQUE" || m === "ONLINE" || m === "TRANSFER" || m === "EFT") {
    return defaults.defaultBankAccountId;
  }
  if (m === "MOBILE_MONEY" || m === "MTN_MOMO" || m === "AIRTEL_MONEY") {
    return defaults.mobileMoneyClearingId || defaults.defaultCashAccountId;
  }
  return defaults.defaultCashAccountId;
}

export function buildArInvoiceLines(
  defaults: DefaultAccountMap,
  amounts: { net: number; tax: number; discount?: number; arAccountId?: string | null; salesAccountId?: string | null },
): JournalLineDraft[] {
  const net = roundMoney(amounts.net);
  const tax = roundMoney(amounts.tax);
  const discount = roundMoney(amounts.discount ?? 0);
  const gross = roundMoney(net + tax - discount);
  if (gross <= 0) throw new Error("Invoice total must be positive");
  const ar = amounts.arAccountId || defaults.accountsReceivableId;
  const sales = amounts.salesAccountId || defaults.salesRevenueId;
  if (!ar) throw new Error("Accounts receivable account is not configured");
  if (!sales) throw new Error("Sales revenue account is not configured");
  const lines: JournalLineDraft[] = [
    { accountId: ar, description: "Accounts receivable", debit: gross, credit: 0 },
  ];
  if (discount > 0) {
    if (!defaults.salesDiscountsId) throw new Error("Sales discounts account is not configured");
    lines.push({ accountId: defaults.salesDiscountsId, description: "Sales discount", debit: discount, credit: 0 });
  }
  lines.push({ accountId: sales, description: "Sales revenue", debit: 0, credit: net });
  if (tax > 0) {
    if (!defaults.outputTaxPayableId) throw new Error("Output tax account is not configured");
    lines.push({ accountId: defaults.outputTaxPayableId, description: "Output VAT", debit: 0, credit: tax });
  }
  assertJournalBalanced(lines);
  return lines;
}

export function buildArReceiptLines(
  defaults: DefaultAccountMap,
  amount: number,
  method: string,
  arAccountId?: string | null,
): JournalLineDraft[] {
  const gross = roundMoney(amount);
  if (gross <= 0) throw new Error("Receipt amount must be positive");
  const cash = settlementAccountId(defaults, method);
  const ar = arAccountId || defaults.accountsReceivableId;
  if (!cash) throw new Error("Cash or bank account is not configured for this receipt method");
  if (!ar) throw new Error("Accounts receivable account is not configured");
  const lines: JournalLineDraft[] = [
    { accountId: cash, description: "Customer receipt", debit: gross, credit: 0 },
    { accountId: ar, description: "Accounts receivable", debit: 0, credit: gross },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildArCreditNoteLines(
  defaults: DefaultAccountMap,
  amounts: { net: number; tax: number; arAccountId?: string | null },
): JournalLineDraft[] {
  const net = roundMoney(amounts.net);
  const tax = roundMoney(amounts.tax);
  const gross = roundMoney(net + tax);
  if (gross <= 0) throw new Error("Credit note total must be positive");
  const ar = amounts.arAccountId || defaults.accountsReceivableId;
  const returns = defaults.salesReturnsId || defaults.salesRevenueId;
  if (!ar || !returns) throw new Error("AR or sales returns account is not configured");
  const lines: JournalLineDraft[] = [
    { accountId: returns, description: "Sales returns", debit: net, credit: 0 },
  ];
  if (tax > 0) {
    if (!defaults.outputTaxPayableId) throw new Error("Output tax account is not configured");
    lines.push({ accountId: defaults.outputTaxPayableId, description: "Output VAT reversal", debit: tax, credit: 0 });
  }
  lines.push({ accountId: ar, description: "Accounts receivable", debit: 0, credit: gross });
  assertJournalBalanced(lines);
  return lines;
}

export function buildArDebitNoteLines(
  defaults: DefaultAccountMap,
  amounts: { net: number; tax: number; arAccountId?: string | null; salesAccountId?: string | null },
): JournalLineDraft[] {
  return buildArInvoiceLines(defaults, amounts).map((line) => ({
    ...line,
    description: line.description ? `Debit note: ${line.description}` : "Debit note",
  }));
}

export function buildCustomerDepositLines(
  defaults: DefaultAccountMap,
  amount: number,
  method: string,
): JournalLineDraft[] {
  const gross = roundMoney(amount);
  if (gross <= 0) throw new Error("Deposit amount must be positive");
  const cash = settlementAccountId(defaults, method);
  if (!cash || !defaults.customerDepositsId) {
    throw new Error("Cash and customer deposits accounts are not configured");
  }
  const lines: JournalLineDraft[] = [
    { accountId: cash, description: "Customer deposit received", debit: gross, credit: 0 },
    { accountId: defaults.customerDepositsId, description: "Customer deposits", debit: 0, credit: gross },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildDepositApplicationLines(
  defaults: DefaultAccountMap,
  amount: number,
  arAccountId?: string | null,
): JournalLineDraft[] {
  const gross = roundMoney(amount);
  if (gross <= 0) throw new Error("Deposit allocation must be positive");
  const ar = arAccountId || defaults.accountsReceivableId;
  if (!defaults.customerDepositsId || !ar) {
    throw new Error("Customer deposits and AR accounts are not configured");
  }
  const lines: JournalLineDraft[] = [
    { accountId: defaults.customerDepositsId, description: "Apply customer deposit", debit: gross, credit: 0 },
    { accountId: ar, description: "Accounts receivable", debit: 0, credit: gross },
  ];
  assertJournalBalanced(lines);
  return lines;
}

/* ── Suppliers & Accounts Payable (Segment 5) ─────────────────────── */

/** Segment 5.6 example groupings; companies may use their own labels. */
export const SUPPLIER_CATEGORIES = [
  "INVENTORY",
  "SERVICE_PROVIDER",
  "CONTRACTOR",
  "UTILITY",
  "GOVERNMENT",
  "CONSULTANT",
  "TRANSPORT",
  "EQUIPMENT",
  "INTERNATIONAL",
] as const;

export const AP_PAYMENT_METHODS = ["CASH", "BANK", "MOBILE_MONEY", "CHEQUE", "EFT"] as const;
export type ApPaymentMethod = (typeof AP_PAYMENT_METHODS)[number];

export function assertSupplierTransactable(input: { exists: boolean; active: boolean }): void {
  if (!input.exists) throw new Error("Supplier does not exist");
  if (!input.active) throw new Error("Supplier account is not active");
}

/** Bill-like postings: Dr purchases/expense (+ input VAT), Cr purchase discounts, Cr AP. */
export function buildApBillLines(
  defaults: DefaultAccountMap,
  amounts: {
    net: number;
    tax: number;
    discount?: number;
    apAccountId?: string | null;
    expenseAccountId?: string | null;
  },
): JournalLineDraft[] {
  const net = roundMoney(amounts.net);
  const tax = roundMoney(amounts.tax);
  const discount = roundMoney(amounts.discount ?? 0);
  const gross = roundMoney(net + tax - discount);
  if (net <= 0 || gross <= 0) throw new Error("Bill total must be positive");
  const ap = amounts.apAccountId || defaults.accountsPayableId;
  const expense = amounts.expenseAccountId || defaults.purchasesId;
  if (!ap) throw new Error("Accounts payable account is not configured");
  if (!expense) throw new Error("Purchases or expense account is not configured");
  const lines: JournalLineDraft[] = [{ accountId: expense, description: "Purchases / expense", debit: net, credit: 0 }];
  if (tax > 0) {
    if (!defaults.inputTaxReceivableId) throw new Error("Input tax account is not configured");
    lines.push({ accountId: defaults.inputTaxReceivableId, description: "Input VAT", debit: tax, credit: 0 });
  }
  if (discount > 0) {
    if (!defaults.purchaseDiscountsId) throw new Error("Purchase discounts account is not configured");
    lines.push({ accountId: defaults.purchaseDiscountsId, description: "Purchase discount", debit: 0, credit: discount });
  }
  lines.push({ accountId: ap, description: "Accounts payable", debit: 0, credit: gross });
  assertJournalBalanced(lines);
  return lines;
}

export function buildApDebitNoteLines(
  defaults: DefaultAccountMap,
  amounts: { net: number; tax: number; apAccountId?: string | null; expenseAccountId?: string | null },
): JournalLineDraft[] {
  return buildApBillLines(defaults, amounts).map((line) => ({
    ...line,
    description: line.description ? `Debit note: ${line.description}` : "Debit note",
  }));
}

/** Dr AP, Cr purchase returns (or the original expense/purchases account), Cr input VAT. */
export function buildApCreditNoteLines(
  defaults: DefaultAccountMap,
  amounts: { net: number; tax: number; apAccountId?: string | null; returnsAccountId?: string | null },
): JournalLineDraft[] {
  const net = roundMoney(amounts.net);
  const tax = roundMoney(amounts.tax);
  const gross = roundMoney(net + tax);
  if (net <= 0) throw new Error("Credit note total must be positive");
  const ap = amounts.apAccountId || defaults.accountsPayableId;
  const returns = amounts.returnsAccountId || defaults.purchaseReturnsId || defaults.purchasesId;
  if (!ap || !returns) throw new Error("AP or purchase returns account is not configured");
  const lines: JournalLineDraft[] = [
    { accountId: ap, description: "Accounts payable", debit: gross, credit: 0 },
    { accountId: returns, description: "Purchase returns / adjustment", debit: 0, credit: net },
  ];
  if (tax > 0) {
    if (!defaults.inputTaxReceivableId) throw new Error("Input tax account is not configured");
    lines.push({ accountId: defaults.inputTaxReceivableId, description: "Input VAT reversal", debit: 0, credit: tax });
  }
  assertJournalBalanced(lines);
  return lines;
}

export function assertWithholding(input: { settled: number; withholdingTax: number }): void {
  const wht = roundMoney(input.withholdingTax);
  if (wht < 0) throw new Error("Withholding tax can't be negative");
  if (wht > 0 && wht - roundMoney(input.settled) >= -0.0001) {
    throw new Error("Withholding tax must be less than the amount settled");
  }
}

/** Dr AP for cash paid plus tax withheld; Cr cash/bank and Cr WHT payable. */
export function buildApPaymentLines(
  defaults: DefaultAccountMap,
  input: { amount: number; withholdingTax?: number; method: string; apAccountId?: string | null },
): JournalLineDraft[] {
  const paid = roundMoney(input.amount);
  const wht = roundMoney(input.withholdingTax ?? 0);
  if (paid <= 0) throw new Error("Payment amount must be positive");
  const settled = roundMoney(paid + wht);
  assertWithholding({ settled, withholdingTax: wht });
  const cash = settlementAccountId(defaults, input.method);
  const ap = input.apAccountId || defaults.accountsPayableId;
  if (!cash) throw new Error("Cash or bank account is not configured for this payment method");
  if (!ap) throw new Error("Accounts payable account is not configured");
  const lines: JournalLineDraft[] = [
    { accountId: ap, description: "Accounts payable", debit: settled, credit: 0 },
    { accountId: cash, description: "Supplier payment", debit: 0, credit: paid },
  ];
  if (wht > 0) {
    if (!defaults.withholdingTaxPayableId) throw new Error("Withholding tax payable account is not configured");
    lines.push({ accountId: defaults.withholdingTaxPayableId, description: "Withholding tax deducted", debit: 0, credit: wht });
  }
  assertJournalBalanced(lines);
  return lines;
}

export function buildSupplierAdvanceLines(defaults: DefaultAccountMap, amount: number, method: string): JournalLineDraft[] {
  const gross = roundMoney(amount);
  if (gross <= 0) throw new Error("Advance amount must be positive");
  const cash = settlementAccountId(defaults, method);
  if (!cash || !defaults.supplierAdvancesId) throw new Error("Cash and supplier advances accounts are not configured");
  const lines: JournalLineDraft[] = [
    { accountId: defaults.supplierAdvancesId, description: "Supplier advance", debit: gross, credit: 0 },
    { accountId: cash, description: "Advance paid", debit: 0, credit: gross },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildAdvanceApplicationLines(
  defaults: DefaultAccountMap,
  amount: number,
  apAccountId?: string | null,
): JournalLineDraft[] {
  const gross = roundMoney(amount);
  if (gross <= 0) throw new Error("Advance allocation must be positive");
  const ap = apAccountId || defaults.accountsPayableId;
  if (!defaults.supplierAdvancesId || !ap) throw new Error("Supplier advances and AP accounts are not configured");
  const lines: JournalLineDraft[] = [
    { accountId: ap, description: "Accounts payable", debit: gross, credit: 0 },
    { accountId: defaults.supplierAdvancesId, description: "Apply supplier advance", debit: 0, credit: gross },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildAdvanceRefundLines(defaults: DefaultAccountMap, amount: number, method: string): JournalLineDraft[] {
  return buildSupplierAdvanceLines(defaults, amount, method).map((line) => ({
    ...line,
    debit: line.credit,
    credit: line.debit,
    description: line.debit ? "Advance refunded by supplier" : "Refund received",
  }));
}

/* ── Inventory accounting (Segment 11) ─────────────────────────────── */

export const INVENTORY_MOVEMENT_KINDS = [
  "OPENING",
  "PURCHASE",
  "SALE",
  "CUSTOMER_RETURN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "DAMAGE",
  "EXPIRED",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
export type InventoryMovementKind = (typeof INVENTORY_MOVEMENT_KINDS)[number];
export type InventoryCostingMethod = "FIFO" | "WEIGHTED_AVERAGE" | "SPECIFIC_IDENTIFICATION";
export type InventoryCostSource = "ERP" | "FIFO" | "AVERAGE" | "TRANSFER" | "OPENING" | "UNCOSTED";

const INBOUND_KINDS = new Set<InventoryMovementKind>(["OPENING", "PURCHASE", "CUSTOMER_RETURN", "ADJUSTMENT_IN", "TRANSFER_IN"]);

export function isInboundMovement(kind: InventoryMovementKind): boolean {
  return INBOUND_KINDS.has(kind);
}

/** Maps an ERP inventory ledger movement to the accounting movement kind. Production movements have no rule yet. */
export function inventoryKindForErpMovement(movementType: string, direction: string): InventoryMovementKind | null {
  const inbound = direction.toUpperCase() === "IN";
  switch (movementType.toUpperCase()) {
    case "PURCHASE":
      return "PURCHASE";
    case "INITIAL_STOCK":
      return "OPENING";
    case "SALE":
      return "SALE";
    case "RETURN_CUSTOMER":
      return "CUSTOMER_RETURN";
    case "DAMAGE":
      return "DAMAGE";
    case "EXPIRED":
      return "EXPIRED";
    case "TRANSFER_IN":
      return "TRANSFER_IN";
    case "TRANSFER_OUT":
      return "TRANSFER_OUT";
    case "ADJUSTMENT_IN":
      return "ADJUSTMENT_IN";
    case "ADJUSTMENT_OUT":
      return "ADJUSTMENT_OUT";
    case "ADJUSTMENT":
    case "CORRECTION":
      return inbound ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
    default:
      return null;
  }
}

export interface InventoryPosition {
  quantity: number;
  value: number;
}

export interface InventoryCostLayer {
  id: string;
  remaining: number;
  unitCost: number;
}

export interface InventoryCosting {
  value: number;
  unitCost: number;
  source: InventoryCostSource;
}

function roundCost(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function averageCost(position: InventoryPosition, quantity: number): InventoryCosting | null {
  if (position.quantity <= 0 || position.value <= 0) return null;
  const unitCost = roundCost(position.value / position.quantity);
  const value = quantity === position.quantity ? roundMoney(position.value) : roundMoney(quantity * (position.value / position.quantity));
  return { value, unitCost, source: "AVERAGE" };
}

/**
 * Costs a stock issue. A cost supplied by the ERP (the batch it actually issued) wins; otherwise the
 * company's valuation method is applied to the accounting layers. FIFO layers are always drawn down
 * by quantity so they stay in step with stock on hand.
 */
export function costInventoryIssue(input: {
  method: InventoryCostingMethod;
  quantity: number;
  position: InventoryPosition;
  layers: InventoryCostLayer[];
  suppliedUnitCost?: number | null;
}): InventoryCosting & { draws: Array<{ layerId: string; quantity: number; unitCost: number }> } {
  const quantity = input.quantity;
  if (!(quantity > 0)) throw new Error("Issue quantity must be positive");

  const draws: Array<{ layerId: string; quantity: number; unitCost: number }> = [];
  let left = quantity;
  for (const layer of input.layers) {
    if (left <= 0) break;
    const take = Math.min(layer.remaining, left);
    if (take <= 0) continue;
    draws.push({ layerId: layer.id, quantity: take, unitCost: layer.unitCost });
    left -= take;
  }

  const supplied = Number(input.suppliedUnitCost ?? 0);
  if (supplied > 0) {
    return { value: roundMoney(quantity * supplied), unitCost: roundCost(supplied), source: "ERP", draws };
  }
  if (input.method === "SPECIFIC_IDENTIFICATION") {
    throw new Error("Specific identification needs the actual unit cost of the item issued");
  }
  if (input.method === "FIFO" && left <= 0 && draws.length) {
    const value = roundMoney(draws.reduce((sum, d) => sum + d.quantity * d.unitCost, 0));
    return { value, unitCost: roundCost(value / quantity), source: "FIFO", draws };
  }
  const average = averageCost(input.position, quantity);
  if (average) return { ...average, draws };
  return { value: 0, unitCost: 0, source: "UNCOSTED", draws };
}

/** Costs a stock receipt: a matched transfer-out cost, then the ERP cost, then the current average. */
export function costInventoryReceipt(input: {
  quantity: number;
  position: InventoryPosition;
  suppliedUnitCost?: number | null;
  matchedUnitCost?: number | null;
}): InventoryCosting {
  const quantity = input.quantity;
  if (!(quantity > 0)) throw new Error("Receipt quantity must be positive");
  const matched = Number(input.matchedUnitCost ?? 0);
  if (matched > 0) return { value: roundMoney(quantity * matched), unitCost: roundCost(matched), source: "TRANSFER" };
  const supplied = Number(input.suppliedUnitCost ?? 0);
  if (supplied > 0) return { value: roundMoney(quantity * supplied), unitCost: roundCost(supplied), source: "ERP" };
  const average = averageCost(input.position, quantity);
  if (average) return average;
  return { value: 0, unitCost: 0, source: "UNCOSTED" };
}

/** Quantity and value needed to bring an item-location to an ERP opening snapshot. */
export function openingSnapshotDelta(position: InventoryPosition, target: { quantity: number; unitCost: number }) {
  if (target.quantity < 0) throw new Error("Opening quantity cannot be negative");
  if (target.unitCost < 0) throw new Error("Opening unit cost cannot be negative");
  const targetValue = roundMoney(target.quantity * target.unitCost);
  return {
    quantityDelta: target.quantity - position.quantity,
    valueDelta: roundMoney(targetValue - position.value),
    targetValue,
  };
}

function inventoryContraAccount(defaults: DefaultAccountMap, kind: InventoryMovementKind): { accountId: string | null | undefined; label: string } {
  switch (kind) {
    case "OPENING":
      return { accountId: defaults.suspenseAccountId || defaults.retainedEarningsId, label: "Opening stock" };
    case "PURCHASE":
      return { accountId: defaults.grniId, label: "Goods received not invoiced" };
    case "CUSTOMER_RETURN":
      return { accountId: defaults.costOfSalesId, label: "Cost of goods returned" };
    case "ADJUSTMENT_IN":
      return { accountId: defaults.inventoryGainId || defaults.inventoryAdjustmentId, label: "Inventory gain" };
    case "ADJUSTMENT_OUT":
      return { accountId: defaults.inventoryLossId || defaults.inventoryAdjustmentId, label: "Inventory loss" };
    case "DAMAGE":
    case "EXPIRED":
      return { accountId: defaults.inventoryWriteOffId, label: kind === "DAMAGE" ? "Damaged stock written off" : "Expired stock written off" };
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return { accountId: defaults.goodsInTransitId, label: "Goods in transit" };
    case "SALE":
      return { accountId: null, label: "" };
  }
}

/**
 * GL lines for an inventory movement. Sales return no lines because their cost of goods sold is posted
 * with the sale journal. A negative value (e.g. an opening snapshot below the recorded value) reverses sides.
 */
export function buildInventoryMovementLines(
  defaults: DefaultAccountMap,
  input: { kind: InventoryMovementKind; value: number },
): JournalLineDraft[] {
  const value = roundMoney(input.value);
  if (input.kind === "SALE" || value === 0) return [];
  if (!defaults.inventoryAssetId) throw new Error("Inventory asset account is not configured");
  const contra = inventoryContraAccount(defaults, input.kind);
  if (!contra.accountId) throw new Error(`No account is mapped for ${contra.label.toLowerCase()}`);

  const increasesStock = isInboundMovement(input.kind) === value > 0;
  const amount = Math.abs(value);
  const lines: JournalLineDraft[] = increasesStock
    ? [
        { accountId: defaults.inventoryAssetId, description: "Inventory", debit: amount, credit: 0 },
        { accountId: contra.accountId, description: contra.label, debit: 0, credit: amount },
      ]
    : [
        { accountId: contra.accountId, description: contra.label, debit: amount, credit: 0 },
        { accountId: defaults.inventoryAssetId, description: "Inventory", debit: 0, credit: amount },
      ];
  assertJournalBalanced(lines);
  return lines;
}

/** Cost of goods sold divided by average inventory value; null when there is no inventory to average. */
export function inventoryTurnover(costOfSales: number, openingValue: number, closingValue: number): number | null {
  const average = (openingValue + closingValue) / 2;
  if (average <= 0) return null;
  return Math.round((costOfSales / average) * 100) / 100;
}

export function buildIdempotencyKey(parts: {
  organizationId: string | number;
  sourceModule: string;
  documentType: string;
  documentId: string | number;
  eventType: string;
  version?: string | number;
}): string {
  return [
    parts.organizationId,
    parts.sourceModule,
    parts.documentType,
    parts.documentId,
    parts.eventType,
    parts.version ?? "1",
  ].join("|");
}

/* ── Banking & cash (Phase 7) ──────────────────────────────────────── */

export const FINANCIAL_ACCOUNT_KINDS = ["BANK", "CASH", "PETTY_CASH", "MOBILE_MONEY"] as const;
export type FinancialAccountKind = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

export const BANK_TRANSACTION_KINDS = ["RECEIPT", "PAYMENT", "TRANSFER", "BANK_CHARGE", "INTEREST", "CASH_COUNT"] as const;
export type BankTransactionKind = (typeof BANK_TRANSACTION_KINDS)[number];

export type TransferType = "DEPOSIT" | "WITHDRAWAL" | "REPLENISHMENT" | "TRANSFER";

export interface AllocationLine {
  accountId: string;
  amount: number;
  description?: string;
}

/** Name used for a movement between two financial accounts; the journal is the same for every type. */
export function transferTypeFor(from: FinancialAccountKind, to: FinancialAccountKind): TransferType {
  if (to === "PETTY_CASH") return "REPLENISHMENT";
  if ((from === "CASH" || from === "PETTY_CASH") && to === "BANK") return "DEPOSIT";
  if (from === "BANK" && to === "CASH") return "WITHDRAWAL";
  return "TRANSFER";
}

export function assertFundsAvailable(input: { balance: number; amount: number; allowOverdraft: boolean; accountName: string }): void {
  if (input.allowOverdraft) return;
  if (roundMoney(input.balance - input.amount) < 0) {
    throw new Error(`${input.accountName} has ${roundMoney(input.balance)} available; this needs ${roundMoney(input.amount)} and overdraft is not allowed`);
  }
}

function assertAllocations(allocations: AllocationLine[]): number {
  if (!allocations.length) throw new Error("Add at least one line");
  let total = 0;
  for (const line of allocations) {
    if (!line.accountId) throw new Error("Each line needs an account");
    if (!(line.amount > 0)) throw new Error("Line amounts must be greater than zero");
    total += line.amount;
  }
  return roundMoney(total);
}

/** Money received: Dr the financial account, Cr each line's account. */
export function buildMoneyReceivedLines(bankAccountId: string, allocations: AllocationLine[], description = "Money received"): JournalLineDraft[] {
  const total = assertAllocations(allocations);
  if (allocations.some((a) => a.accountId === bankAccountId)) throw new Error("A line can't use the account the money is going into");
  const lines: JournalLineDraft[] = [
    { accountId: bankAccountId, description, debit: total, credit: 0 },
    ...allocations.map((a) => ({ accountId: a.accountId, description: a.description || description, debit: 0, credit: roundMoney(a.amount) })),
  ];
  assertJournalBalanced(lines);
  return lines;
}

/** Money paid: Dr each line's account, Cr the financial account. */
export function buildMoneyPaidLines(bankAccountId: string, allocations: AllocationLine[], description = "Payment"): JournalLineDraft[] {
  const total = assertAllocations(allocations);
  if (allocations.some((a) => a.accountId === bankAccountId)) throw new Error("A line can't use the account the money is paid from");
  const lines: JournalLineDraft[] = [
    ...allocations.map((a) => ({ accountId: a.accountId, description: a.description || description, debit: roundMoney(a.amount), credit: 0 })),
    { accountId: bankAccountId, description, debit: 0, credit: total },
  ];
  assertJournalBalanced(lines);
  return lines;
}

/** Transfer between two financial accounts, with an optional fee charged to the sending account. */
export function buildTransferLines(input: { fromAccountId: string; toAccountId: string; amount: number; fee?: number; feeAccountId?: string | null }): JournalLineDraft[] {
  const amount = roundMoney(input.amount);
  const fee = roundMoney(input.fee ?? 0);
  if (!(amount > 0)) throw new Error("Transfer amount must be greater than zero");
  if (fee < 0) throw new Error("Fee can't be negative");
  if (input.fromAccountId === input.toAccountId) throw new Error("Choose two different accounts");
  const lines: JournalLineDraft[] = [
    { accountId: input.toAccountId, description: "Transfer in", debit: amount, credit: 0 },
    { accountId: input.fromAccountId, description: "Transfer out", debit: 0, credit: amount },
  ];
  if (fee > 0) {
    if (!input.feeAccountId) throw new Error("Bank charges account is not configured");
    lines.push(
      { accountId: input.feeAccountId, description: "Transfer fee", debit: fee, credit: 0 },
      { accountId: input.fromAccountId, description: "Transfer fee", debit: 0, credit: fee },
    );
  }
  assertJournalBalanced(lines);
  return lines;
}

/** Cash count: posts the difference between counted cash and the book balance to the over/short account. */
export function buildCashCountLines(input: { cashAccountId: string; bookBalance: number; counted: number; overShortAccountId?: string | null }): {
  difference: number;
  lines: JournalLineDraft[];
} {
  if (input.counted < 0) throw new Error("Counted cash can't be negative");
  const difference = roundMoney(input.counted - input.bookBalance);
  if (difference === 0) return { difference, lines: [] };
  if (!input.overShortAccountId) throw new Error("Choose the account for the cash difference");
  const amount = Math.abs(difference);
  const lines: JournalLineDraft[] =
    difference > 0
      ? [
          { accountId: input.cashAccountId, description: "Cash over", debit: amount, credit: 0 },
          { accountId: input.overShortAccountId, description: "Cash over", debit: 0, credit: amount },
        ]
      : [
          { accountId: input.overShortAccountId, description: "Cash short", debit: amount, credit: 0 },
          { accountId: input.cashAccountId, description: "Cash short", debit: 0, credit: amount },
        ];
  assertJournalBalanced(lines);
  return { difference, lines };
}

/* ── Bank statements ───────────────────────────────────────────────── */

export const STATEMENT_FORMATS = ["CSV", "OFX", "QIF", "CAMT053"] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];
export type StatementDateOrder = "DMY" | "MDY";

/** A statement line from the bank's side: amount is positive for money in, negative for money out. */
export interface ParsedStatementLine {
  transactionDate: string;
  valueDate?: string;
  description: string;
  reference?: string;
  chequeNumber?: string;
  amount: number;
  runningBalance?: number;
}

export interface ParsedStatement {
  lines: ParsedStatementLine[];
  errors: string[];
  openingBalance?: number;
  closingBalance?: number;
  periodStart?: string;
  periodEnd?: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parses the date layouts banks commonly export. Ambiguous numeric dates follow `order` (day first by default). */
export function parseStatementDate(raw: string | null | undefined, order: StatementDateOrder = "DMY"): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.'](\d{2,4})\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    let [d, mo] = order === "DMY" ? [a, b] : [b, a];
    if (a > 12 && b <= 12) [d, mo] = [a, b];
    else if (b > 12 && a <= 12) [d, mo] = [b, a];
    return isoDate(+m[3], mo, d);
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

/** Parses an amount such as "1,250.00", "(300)", "300-", "300 DR" or "RWF 1,000". Returns null when there is no number. */
export function parseStatementAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*DR\.?$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*DR\.?$/i, "");
  } else s = s.replace(/\s*CR\.?$/i, "");
  if (/\d-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,+-]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

function splitDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

type CsvColumn = "date" | "valueDate" | "description" | "reference" | "cheque" | "debit" | "credit" | "amount" | "balance" | "type";

const CSV_HEADERS: Record<CsvColumn, string[]> = {
  date: ["date", "transactiondate", "transdate", "txndate", "trandate", "postingdate", "postdate", "postingdt", "bookingdate", "bookdate", "entrydate"],
  valueDate: ["valuedate", "valuedt", "effectivedate"],
  description: ["description", "narrative", "narration", "details", "particulars", "transactiondetails", "transactiondescription", "memo", "remarks", "payee", "beneficiary"],
  reference: ["reference", "ref", "refno", "referenceno", "referencenumber", "transactionreference", "transactionref", "transactionid", "txnid", "documentno"],
  cheque: ["cheque", "chequeno", "chequenumber", "chqno", "check", "checkno", "checknumber"],
  debit: ["debit", "debits", "debitamount", "dr", "withdrawal", "withdrawals", "moneyout", "paidout", "out"],
  credit: ["credit", "credits", "creditamount", "cr", "deposit", "deposits", "moneyin", "paidin", "in"],
  amount: ["amount", "transactionamount", "amt", "amountrwf"],
  balance: ["balance", "runningbalance", "ledgerbalance", "bookbalance", "availablebalance", "closingbalance", "balancerwf"],
  type: ["type", "drcr", "crdr", "debitcredit", "transactiontype", "dc"],
};

function mapCsvHeader(row: string[]): Partial<Record<CsvColumn, number>> {
  const map: Partial<Record<CsvColumn, number>> = {};
  row.forEach((raw, index) => {
    const key = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (!key) return;
    for (const column of Object.keys(CSV_HEADERS) as CsvColumn[]) {
      if (map[column] === undefined && CSV_HEADERS[column].includes(key)) {
        map[column] = index;
        return;
      }
    }
  });
  return map;
}

function chronological(result: ParsedStatement): ParsedStatement {
  const { lines } = result;
  if (lines.length > 1 && lines[0].transactionDate > lines[lines.length - 1].transactionDate) lines.reverse();
  if (lines.length) {
    result.periodStart = lines.reduce((min, l) => (l.transactionDate < min ? l.transactionDate : min), lines[0].transactionDate);
    result.periodEnd = lines.reduce((max, l) => (l.transactionDate > max ? l.transactionDate : max), lines[0].transactionDate);
    const last = lines[lines.length - 1];
    if (result.closingBalance === undefined && last.runningBalance !== undefined) result.closingBalance = last.runningBalance;
    const first = lines[0];
    if (result.openingBalance === undefined && first.runningBalance !== undefined) result.openingBalance = roundMoney(first.runningBalance - first.amount);
  }
  return result;
}

function parseCsvStatement(text: string, order: StatementDateOrder): ParsedStatement {
  const rows = splitDelimited(text);
  const result: ParsedStatement = { lines: [], errors: [] };
  let headerIndex = -1;
  let map: Partial<Record<CsvColumn, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const candidate = mapCsvHeader(rows[i]);
    if (candidate.date !== undefined && (candidate.amount !== undefined || candidate.debit !== undefined || candidate.credit !== undefined)) {
      headerIndex = i;
      map = candidate;
      break;
    }
  }
  if (headerIndex < 0) {
    result.errors.push("No header row found. The file needs a date column and either an amount column or debit and credit columns.");
    return result;
  }
  const at = (row: string[], column: CsvColumn) => (map[column] === undefined ? "" : (row[map[column]!] ?? ""));
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => !c)) continue;
    const description = [at(row, "description")].filter(Boolean).join(" ");
    const balance = parseStatementAmount(at(row, "balance"));
    if (/opening balance|balance b\/?f|brought forward/i.test(description)) {
      if (balance !== null) result.openingBalance = balance;
      continue;
    }
    if (/closing balance|balance c\/?f|carried forward/i.test(description)) {
      if (balance !== null) result.closingBalance = balance;
      continue;
    }
    const rawDate = at(row, "date");
    const date = parseStatementDate(rawDate, order);
    let amount: number | null = null;
    if (map.debit !== undefined || map.credit !== undefined) {
      const debit = parseStatementAmount(at(row, "debit"));
      const credit = parseStatementAmount(at(row, "credit"));
      if (debit !== null || credit !== null) amount = roundMoney(Math.abs(credit ?? 0) - Math.abs(debit ?? 0));
    }
    if (amount === null && map.amount !== undefined) {
      amount = parseStatementAmount(at(row, "amount"));
      const type = at(row, "type").toUpperCase();
      if (amount !== null && /^(D|DR|DEBIT)/.test(type)) amount = -Math.abs(amount);
      else if (amount !== null && /^(C|CR|CREDIT)/.test(type)) amount = Math.abs(amount);
    }
    if (!date) {
      if (amount) result.errors.push(`Row ${i + 1}: "${rawDate}" is not a date`);
      continue;
    }
    if (!amount) {
      result.errors.push(`Row ${i + 1}: no amount`);
      continue;
    }
    result.lines.push({
      transactionDate: date,
      valueDate: parseStatementDate(at(row, "valueDate"), order) ?? undefined,
      description: description || "(no description)",
      reference: at(row, "reference") || undefined,
      chequeNumber: at(row, "cheque") || undefined,
      amount: roundMoney(amount),
      runningBalance: balance ?? undefined,
    });
  }
  return chronological(result);
}

function sgmlTag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  const value = m?.[1]?.trim();
  return value || undefined;
}

function parseOfxStatement(text: string): ParsedStatement {
  const result: ParsedStatement = { lines: [], errors: [] };
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  if (!blocks.length) result.errors.push("No transactions (<STMTTRN>) found in the OFX file");
  blocks.forEach((block, index) => {
    const date = parseStatementDate(sgmlTag(block, "DTPOSTED"));
    const amount = parseStatementAmount(sgmlTag(block, "TRNAMT"));
    if (!date || amount === null || amount === 0) {
      result.errors.push(`Transaction ${index + 1}: missing date or amount`);
      return;
    }
    const description = [sgmlTag(block, "NAME"), sgmlTag(block, "MEMO")].filter(Boolean).join(" — ");
    result.lines.push({
      transactionDate: date,
      valueDate: parseStatementDate(sgmlTag(block, "DTUSER")) ?? undefined,
      description: description || sgmlTag(block, "TRNTYPE") || "(no description)",
      reference: sgmlTag(block, "REFNUM") ?? sgmlTag(block, "FITID"),
      chequeNumber: sgmlTag(block, "CHECKNUM"),
      amount: roundMoney(amount),
    });
  });
  const ledger = text.split(/<LEDGERBAL>/i)[1];
  if (ledger) {
    const closing = parseStatementAmount(sgmlTag(ledger, "BALAMT"));
    if (closing !== null) result.closingBalance = closing;
  }
  return chronological(result);
}

function parseQifStatement(text: string, order: StatementDateOrder): ParsedStatement {
  const result: ParsedStatement = { lines: [], errors: [] };
  let record: Record<string, string> = {};
  let index = 0;
  const flush = () => {
    if (!Object.keys(record).length) return;
    index++;
    const date = parseStatementDate(record.D, order);
    const amount = parseStatementAmount(record.T ?? record.U);
    if (!date || amount === null || amount === 0) result.errors.push(`Record ${index}: missing date or amount`);
    else
      result.lines.push({
        transactionDate: date,
        description: [record.P, record.M].filter(Boolean).join(" — ") || "(no description)",
        reference: record.N,
        chequeNumber: record.N && /^\d+$/.test(record.N) ? record.N : undefined,
        amount: roundMoney(amount),
      });
    record = {};
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!")) continue;
    if (line === "^") {
      flush();
      continue;
    }
    const code = line[0];
    if (!(code in record)) record[code] = line.slice(1).trim();
  }
  flush();
  if (!index) result.errors.push("No transactions found in the QIF file");
  return chronological(result);
}

function xmlValue(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`));
  const value = m?.[1]?.trim();
  return value || undefined;
}

function xmlBlock(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1];
}

function parseCamtStatement(text: string): ParsedStatement {
  const xml = text.replace(/<(\/?)[A-Za-z0-9]+:/g, "<$1");
  const result: ParsedStatement = { lines: [], errors: [] };
  const signed = (block: string) => {
    const amount = parseStatementAmount(xmlValue(block, "Amt"));
    if (amount === null) return null;
    return xmlValue(block, "CdtDbtInd") === "DBIT" ? -Math.abs(amount) : Math.abs(amount);
  };
  for (const bal of xml.match(/<Bal>[\s\S]*?<\/Bal>/g) ?? []) {
    const code = xmlValue(bal, "Cd");
    const amount = signed(bal);
    if (amount === null) continue;
    if (code === "OPBD" || code === "PRCD") result.openingBalance = amount;
    if (code === "CLBD") result.closingBalance = amount;
  }
  const entries = xml.match(/<Ntry>[\s\S]*?<\/Ntry>/g) ?? [];
  if (!entries.length) result.errors.push("No entries (<Ntry>) found in the CAMT.053 file");
  entries.forEach((entry, index) => {
    const booking = xmlBlock(entry, "BookgDt") ?? "";
    const date = parseStatementDate(xmlValue(booking, "Dt") ?? xmlValue(booking, "DtTm"));
    const amount = signed(entry.replace(/<NtryDtls>[\s\S]*<\/NtryDtls>/, ""));
    if (!date || amount === null || amount === 0) {
      result.errors.push(`Entry ${index + 1}: missing date or amount`);
      return;
    }
    const value = xmlBlock(entry, "ValDt") ?? "";
    const remittance = (entry.match(/<Ustrd>([^<]*)<\/Ustrd>/g) ?? []).map((u) => u.replace(/<\/?Ustrd>/g, "").trim()).filter(Boolean);
    result.lines.push({
      transactionDate: date,
      valueDate: parseStatementDate(xmlValue(value, "Dt") ?? xmlValue(value, "DtTm")) ?? undefined,
      description: remittance.join(" ") || xmlValue(entry, "AddtlNtryInf") || xmlValue(entry, "AddtlTxInf") || xmlValue(entry, "Nm") || "(no description)",
      reference: xmlValue(entry, "AcctSvcrRef") ?? xmlValue(entry, "EndToEndId") ?? xmlValue(entry, "NtryRef"),
      chequeNumber: xmlValue(entry, "ChqNb"),
      amount: roundMoney(amount),
    });
  });
  return chronological(result);
}

export function detectStatementFormat(fileName: string, text: string): StatementFormat {
  const name = fileName.toLowerCase();
  if (name.endsWith(".ofx") || name.endsWith(".qfx") || /<OFX>/i.test(text)) return "OFX";
  if (name.endsWith(".qif") || /^!Type:/im.test(text)) return "QIF";
  if (name.endsWith(".xml") || /<(\w+:)?BkToCstmrStmt>/.test(text)) return "CAMT053";
  return "CSV";
}

export function parseStatement(text: string, format: StatementFormat, order: StatementDateOrder = "DMY"): ParsedStatement {
  const clean = text.replace(/^\uFEFF/, "");
  if (format === "OFX") return parseOfxStatement(clean);
  if (format === "QIF") return parseQifStatement(clean, order);
  if (format === "CAMT053") return parseCamtStatement(clean);
  return parseCsvStatement(clean, order);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Identity of each line for duplicate detection. Identical lines within one file are told apart by
 * their occurrence, so re-importing the same or an overlapping file gives the same fingerprints.
 */
export function statementFingerprints(lines: ParsedStatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [l.transactionDate, roundMoney(l.amount).toFixed(4), normalizeText(l.reference), normalizeText(l.description), l.runningBalance ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

export type StatementLineKind = "BANK_CHARGE" | "INTEREST" | "OTHER";

/** A starting suggestion for recording a bank-only line; the user confirms the account. */
export function suggestStatementLineKind(description: string, amount: number): StatementLineKind {
  const text = description.toLowerCase();
  if (amount > 0 && /interest|int\.? (earned|paid|credit)/.test(text)) return "INTEREST";
  if (amount < 0 && /charge|fee|commission|\bcomm\b|sms|levy|ledger|maintenance|service|stamp|excise|interest/.test(text)) return "BANK_CHARGE";
  return "OTHER";
}

/* ── Matching ──────────────────────────────────────────────────────── */

export interface MatchableLine {
  id: string;
  date: string;
  amount: number;
  reference?: string | null;
  description?: string | null;
  chequeNumber?: string | null;
}

export interface MatchableEntry {
  id: string;
  date: string;
  amount: number;
  references: Array<string | null | undefined>;
}

export interface MatchProposal {
  lineId: string;
  entryId: string;
  score: number;
  byReference: boolean;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / DAY_MS);

function referenceHit(line: MatchableLine, entry: MatchableEntry): boolean {
  const haystack = normalizeText(`${line.reference ?? ""} ${line.description ?? ""} ${line.chequeNumber ?? ""}`);
  const cheque = normalizeText(line.chequeNumber);
  const lineRef = normalizeText(line.reference);
  return entry.references.some((raw) => {
    const ref = normalizeText(raw);
    if (!ref) return false;
    if (cheque && ref === cheque) return true;
    if (ref.length >= 4 && haystack.includes(ref)) return true;
    return lineRef.length >= 4 && ref.includes(lineRef);
  });
}

/**
 * Proposes one-to-one matches between statement lines and book entries with the same amount.
 * A shared reference (document, journal or cheque number) wins; otherwise a pair is only proposed
 * when neither side has any other candidate, so ambiguous amounts are left for manual matching.
 */
export function autoMatchStatement(lines: MatchableLine[], entries: MatchableEntry[]): MatchProposal[] {
  const candidates: MatchProposal[] = [];
  for (const line of lines) {
    for (const entry of entries) {
      if (Math.abs(roundMoney(line.amount) - roundMoney(entry.amount)) > 0.005) continue;
      const lag = dayNumber(line.date) - dayNumber(entry.date);
      const byReference = referenceHit(line, entry);
      const maxLag = byReference ? 120 : entry.amount < 0 ? 60 : 10;
      const minLag = byReference ? -10 : -3;
      if (lag < minLag || lag > maxLag) continue;
      candidates.push({ lineId: line.id, entryId: entry.id, byReference, score: (byReference ? 1000 : 0) + 100 - Math.abs(lag) });
    }
  }
  const perLine = new Map<string, number>();
  const perEntry = new Map<string, number>();
  for (const c of candidates) {
    perLine.set(c.lineId, (perLine.get(c.lineId) ?? 0) + 1);
    perEntry.set(c.entryId, (perEntry.get(c.entryId) ?? 0) + 1);
  }
  const usedLines = new Set<string>();
  const usedEntries = new Set<string>();
  const proposals: MatchProposal[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (usedLines.has(c.lineId) || usedEntries.has(c.entryId)) continue;
    if (!c.byReference && (perLine.get(c.lineId)! > 1 || perEntry.get(c.entryId)! > 1)) continue;
    usedLines.add(c.lineId);
    usedEntries.add(c.entryId);
    proposals.push(c);
  }
  return proposals;
}

/** A match must group at least two items whose statement total equals their book total. */
export function assertMatchBalanced(lineAmounts: number[], entryAmounts: number[]): void {
  if (lineAmounts.length + entryAmounts.length < 2) throw new Error("Select at least two items to match");
  const lineTotal = roundMoney(lineAmounts.reduce((s, a) => s + a, 0));
  const entryTotal = roundMoney(entryAmounts.reduce((s, a) => s + a, 0));
  if (Math.abs(lineTotal - entryTotal) > 0.005) {
    throw new Error(`Statement items total ${lineTotal} and book items total ${entryTotal}; the difference is ${roundMoney(lineTotal - entryTotal)}`);
  }
}

/* ── Reconciliation ────────────────────────────────────────────────── */

export interface ReconciliationSummary {
  bookBalance: number;
  statementBalance: number;
  depositsInTransit: number;
  outstandingPayments: number;
  bankCharges: number;
  interestIncome: number;
  otherAdjustments: number;
  adjustedBankBalance: number;
  adjustedBookBalance: number;
  difference: number;
}

/**
 * Adjusted bank balance = statement + deposits in transit − outstanding payments.
 * Adjusted book balance = book + items on the statement not yet in the books.
 */
export function reconciliationSummary(input: {
  bookBalance: number;
  statementBalance: number;
  outstanding: Array<{ amount: number }>;
  unrecorded: Array<{ amount: number; kind: StatementLineKind }>;
}): ReconciliationSummary {
  const depositsInTransit = roundMoney(input.outstanding.filter((o) => o.amount > 0).reduce((s, o) => s + o.amount, 0));
  const outstandingPayments = roundMoney(-input.outstanding.filter((o) => o.amount < 0).reduce((s, o) => s + o.amount, 0));
  const bankCharges = roundMoney(-input.unrecorded.filter((u) => u.kind === "BANK_CHARGE").reduce((s, u) => s + u.amount, 0));
  const interestIncome = roundMoney(input.unrecorded.filter((u) => u.kind === "INTEREST").reduce((s, u) => s + u.amount, 0));
  const otherAdjustments = roundMoney(input.unrecorded.filter((u) => u.kind === "OTHER").reduce((s, u) => s + u.amount, 0));
  const adjustedBankBalance = roundMoney(input.statementBalance + depositsInTransit - outstandingPayments);
  const adjustedBookBalance = roundMoney(input.bookBalance - bankCharges + interestIncome + otherAdjustments);
  return {
    bookBalance: roundMoney(input.bookBalance),
    statementBalance: roundMoney(input.statementBalance),
    depositsInTransit,
    outstandingPayments,
    bankCharges,
    interestIncome,
    otherAdjustments,
    adjustedBankBalance,
    adjustedBookBalance,
    difference: roundMoney(adjustedBankBalance - adjustedBookBalance),
  };
}

export const RECONCILIATION_STATUSES = ["DRAFT", "REVIEWED", "APPROVED", "COMPLETED"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/* ── Tax (Phase 8) ─────────────────────────────────────────────────── */

export const TAX_TYPES = ["OUTPUT_VAT", "INPUT_VAT", "ZERO_RATED", "EXEMPT", "WHT_PAYABLE", "WHT_RECEIVABLE", "EXCISE", "IMPORT_VAT", "PAYE", "OTHER"] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const TAX_FILING_KINDS = ["VAT", "WHT", "PAYE", "EXCISE", "ANNUAL"] as const;
export type TaxFilingKind = (typeof TAX_FILING_KINDS)[number];

export const TAX_FILING_STATUSES = ["DRAFT", "PREPARED", "FILED"] as const;
export type TaxFilingStatus = (typeof TAX_FILING_STATUSES)[number];

/** Liability accounts: credit increases what is owed. Asset (recoverable) accounts: debit increases what is due back. */
export function taxTypeDirection(type: TaxType): "PAYABLE" | "RECOVERABLE" | "MEMO" {
  if (type === "INPUT_VAT" || type === "WHT_RECEIVABLE" || type === "IMPORT_VAT") return "RECOVERABLE";
  if (type === "ZERO_RATED" || type === "EXEMPT") return "MEMO";
  return "PAYABLE";
}

export function defaultAccountKeyForTaxType(type: TaxType): keyof DefaultAccountMap | null {
  switch (type) {
    case "OUTPUT_VAT":
      return "outputTaxPayableId";
    case "INPUT_VAT":
    case "IMPORT_VAT":
      return "inputTaxReceivableId";
    case "WHT_PAYABLE":
      return "withholdingTaxPayableId";
    case "WHT_RECEIVABLE":
      return "withholdingTaxReceivableId";
    case "PAYE":
      return "payrollTaxPayableId";
    default:
      return null;
  }
}

/** Applies the rate stored on a tax code. Does not choose a statutory rate. */
export function taxOnNet(net: number, ratePercent: number): number {
  if (!(net >= 0)) throw new Error("Amount before tax can't be negative");
  if (!(ratePercent >= 0)) throw new Error("Tax rate can't be negative");
  return roundMoney((net * ratePercent) / 100);
}

export function assertTaxCodeUsable(input: { name: string; isActive: boolean; effectiveFrom: string; effectiveTo?: string | null; on: string }): void {
  if (!input.isActive) throw new Error(`${input.name} is inactive`);
  if (input.on < input.effectiveFrom.slice(0, 10)) throw new Error(`${input.name} is not yet in effect`);
  if (input.effectiveTo && input.on > input.effectiveTo.slice(0, 10)) throw new Error(`${input.name} ended on ${input.effectiveTo.slice(0, 10)}`);
}

export function vatReturnTotals(input: { output: number; input: number; adjustments?: number; paid?: number }) {
  const output = roundMoney(input.output);
  const recovered = roundMoney(input.input);
  const adjustments = roundMoney(input.adjustments ?? 0);
  const paid = roundMoney(input.paid ?? 0);
  const net = roundMoney(output - recovered + adjustments);
  return { output, input: recovered, adjustments, paid, net, outstanding: roundMoney(net - paid) };
}

export function taxReconciliation(input: { ledger: number; gl: number; filed?: number | null; ebm?: number | null }) {
  const ledger = roundMoney(input.ledger);
  const gl = roundMoney(input.gl);
  return {
    ledger,
    gl,
    ledgerVsGl: roundMoney(ledger - gl),
    filed: input.filed ?? null,
    ledgerVsFiled: input.filed == null ? null : roundMoney(ledger - input.filed),
    ebm: input.ebm ?? null,
    ledgerVsEbm: input.ebm == null ? null : roundMoney(ledger - input.ebm),
  };
}

/** Pay a tax liability: Dr the tax account, Cr the bank. A refund received reverses the sides. */
export function buildTaxPaymentLines(input: { taxAccountId: string; bankAccountId: string; amount: number; refund?: boolean; description?: string }): JournalLineDraft[] {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  if (input.taxAccountId === input.bankAccountId) throw new Error("Choose a bank account that is not the tax account");
  const description = input.description || (input.refund ? "Tax refund received" : "Tax paid");
  const lines: JournalLineDraft[] = input.refund
    ? [
        { accountId: input.bankAccountId, description, debit: amount, credit: 0 },
        { accountId: input.taxAccountId, description, debit: 0, credit: amount },
      ]
    : [
        { accountId: input.taxAccountId, description, debit: amount, credit: 0 },
        { accountId: input.bankAccountId, description, debit: 0, credit: amount },
      ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildTaxAdjustmentLines(input: { taxAccountId: string; contraAccountId: string; amount: number; increase?: boolean; description?: string }): JournalLineDraft[] {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  if (input.taxAccountId === input.contraAccountId) throw new Error("Choose two different accounts");
  const description = input.description || "Tax adjustment";
  const increase = input.increase !== false;
  const lines: JournalLineDraft[] = increase
    ? [
        { accountId: input.contraAccountId, description, debit: amount, credit: 0 },
        { accountId: input.taxAccountId, description, debit: 0, credit: amount },
      ]
    : [
        { accountId: input.taxAccountId, description, debit: amount, credit: 0 },
        { accountId: input.contraAccountId, description, debit: 0, credit: amount },
      ];
  assertJournalBalanced(lines);
  return lines;
}

/* ── Expense management (Phase 9 / Segment 12) ─────────── */

export const EXPENSE_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "POSTED", "REVERSED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_PAYMENT_MODES = ["IMMEDIATE", "ON_ACCOUNT", "REIMBURSEMENT"] as const;
export type ExpensePaymentMode = (typeof EXPENSE_PAYMENT_MODES)[number];

export const RECURRING_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** Seed categories for a new company. Codes map to COA expense accounts when those exist. */
export const EXPENSE_CATEGORY_SEED: Array<{ code: string; name: string; glAccountCode?: string }> = [
  { code: "RENT", name: "Office rent", glAccountCode: "6110" },
  { code: "UTIL", name: "Utilities", glAccountCode: "6120" },
  { code: "FUEL", name: "Fuel and transport", glAccountCode: "6130" },
  { code: "TRAVEL", name: "Travel and accommodation", glAccountCode: "6140" },
  { code: "SUPPLIES", name: "Office supplies", glAccountCode: "6150" },
  { code: "MARKETING", name: "Marketing and advertising", glAccountCode: "6160" },
  { code: "PROF", name: "Professional services", glAccountCode: "6170" },
  { code: "MAINT", name: "Repairs and maintenance", glAccountCode: "6180" },
  { code: "SOFT", name: "Software subscriptions", glAccountCode: "6190" },
  { code: "SALARY", name: "Salaries and wages", glAccountCode: "6100" },
  { code: "BANK", name: "Bank charges", glAccountCode: "2400" },
  { code: "MISC", name: "Miscellaneous expenses" },
];

export function assertExpenseAmounts(input: { net: number; tax?: number }) {
  const net = roundMoney(input.net);
  const tax = roundMoney(input.tax ?? 0);
  if (!(net > 0)) throw new Error("Expense amount must be greater than zero");
  if (tax < 0) throw new Error("Tax cannot be negative");
  return { net, tax, gross: roundMoney(net + tax) };
}

export function assertExpenseAllocations(
  lines: Array<{ amount: number; percent?: number }>,
  total: number,
): Array<{ amount: number; percent: number }> {
  if (!lines.length) return [];
  const gross = roundMoney(total);
  if (!(gross > 0)) throw new Error("Cannot allocate a zero expense");
  const withAmounts = lines.map((l) => {
    const amount = roundMoney(l.amount);
    if (!(amount > 0)) throw new Error("Each allocation must be greater than zero");
    return { amount, percent: roundMoney((amount / gross) * 100) };
  });
  const sum = roundMoney(withAmounts.reduce((s, l) => s + l.amount, 0));
  if (Math.abs(sum - gross) > 0.01) throw new Error(`Allocations total ${sum} but the expense is ${gross}`);
  return withAmounts;
}

/**
 * Immediate / reimbursement: Dr expense (+ input VAT), Cr bank/cash.
 * On account: Dr expense (+ input VAT), Cr AP or accrued expenses.
 */
export function buildExpenseLines(input: {
  expenseAccountId: string;
  creditAccountId: string;
  net: number;
  tax?: number;
  inputTaxAccountId?: string | null;
  description?: string;
}): JournalLineDraft[] {
  const { net, tax } = assertExpenseAmounts({ net: input.net, tax: input.tax });
  if (input.expenseAccountId === input.creditAccountId) throw new Error("Choose a payment or payable account that is not the expense account");
  if (tax > 0 && !input.inputTaxAccountId) throw new Error("Map an input VAT account before posting taxable expenses");
  const description = input.description || "Expense";
  const lines: JournalLineDraft[] = [{ accountId: input.expenseAccountId, description, debit: net, credit: 0 }];
  if (tax > 0 && input.inputTaxAccountId) {
    lines.push({ accountId: input.inputTaxAccountId, description: "Input VAT", debit: tax, credit: 0 });
  }
  lines.push({ accountId: input.creditAccountId, description, debit: 0, credit: roundMoney(net + tax) });
  assertJournalBalanced(lines);
  return lines;
}

export function assertExpenseTransition(from: ExpenseStatus, to: ExpenseStatus) {
  const allowed: Record<ExpenseStatus, ExpenseStatus[]> = {
    DRAFT: ["SUBMITTED", "POSTED"],
    SUBMITTED: ["APPROVED", "REJECTED", "DRAFT"],
    APPROVED: ["POSTED", "REJECTED"],
    REJECTED: ["DRAFT"],
    POSTED: ["REVERSED"],
    REVERSED: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`An expense that is ${from.toLowerCase()} can't move to ${to.toLowerCase()}`);
}

/** Next run date for a recurring template (UTC calendar arithmetic). */
export function nextRecurringDate(from: string | Date, frequency: RecurringFrequency): string {
  const d = typeof from === "string" ? new Date(`${from.slice(0, 10)}T00:00:00.000Z`) : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  if (frequency === "WEEKLY") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "MONTHLY") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (frequency === "QUARTERLY") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === "YEARLY") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else throw new Error("Unknown frequency");
  return d.toISOString().slice(0, 10);
}

export function expenseByCategoryTotals(rows: Array<{ categoryName: string; amount: number }>) {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.categoryName, roundMoney((map.get(r.categoryName) ?? 0) + r.amount));
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/* ── Fixed assets (Phase 10 / Segment 13) ───────────────── */

export const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "REDUCING_BALANCE"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const ASSET_STATUSES = ["REGISTERED", "ACTIVE", "FULLY_DEPRECIATED", "DISPOSED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const DISPOSAL_METHODS = ["SALE", "SCRAP", "DONATION", "THEFT", "DESTRUCTION", "RETIREMENT"] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const FA_CATEGORY_SEED: Array<{
  code: string;
  name: string;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  residualPercent: number;
  ratePercent?: number;
}> = [
  { code: "LAND", name: "Land", usefulLifeMonths: 0, method: "STRAIGHT_LINE", residualPercent: 100 },
  { code: "BUILDING", name: "Buildings", usefulLifeMonths: 480, method: "STRAIGHT_LINE", residualPercent: 10 },
  { code: "FURNITURE", name: "Furniture", usefulLifeMonths: 120, method: "STRAIGHT_LINE", residualPercent: 5 },
  { code: "OFFICE", name: "Office equipment", usefulLifeMonths: 60, method: "STRAIGHT_LINE", residualPercent: 5 },
  { code: "IT", name: "Computers and IT", usefulLifeMonths: 36, method: "STRAIGHT_LINE", residualPercent: 0 },
  { code: "VEHICLE", name: "Motor vehicles", usefulLifeMonths: 60, method: "REDUCING_BALANCE", residualPercent: 10, ratePercent: 25 },
  { code: "MACHINERY", name: "Machinery", usefulLifeMonths: 120, method: "STRAIGHT_LINE", residualPercent: 5 },
  { code: "SOFTWARE", name: "Software and licenses", usefulLifeMonths: 36, method: "STRAIGHT_LINE", residualPercent: 0 },
];

export function assertResidualOk(cost: number, residual: number) {
  const c = roundMoney(cost);
  const r = roundMoney(residual);
  if (!(c > 0)) throw new Error("Acquisition cost must be greater than zero");
  if (r < 0) throw new Error("Residual value cannot be negative");
  if (r > c) throw new Error("Residual value cannot exceed acquisition cost");
  return { cost: c, residual: r, depreciable: roundMoney(c - r) };
}

export function netBookValue(cost: number, accumulated: number) {
  return roundMoney(Math.max(0, roundMoney(cost) - roundMoney(accumulated)));
}

/** Monthly straight-line charge. Land (life 0) and fully depreciated assets return 0. */
export function straightLineMonthly(input: { cost: number; residual: number; usefulLifeMonths: number; accumulated: number }) {
  const { cost, residual, depreciable } = assertResidualOk(input.cost, input.residual);
  const life = Math.floor(input.usefulLifeMonths);
  if (life <= 0 || depreciable <= 0) return 0;
  const nbv = netBookValue(cost, input.accumulated);
  if (nbv <= residual) return 0;
  const monthly = roundMoney(depreciable / life);
  return roundMoney(Math.min(monthly, nbv - residual));
}

/** Monthly reducing-balance charge using an annual rate percent. */
export function reducingBalanceMonthly(input: { cost: number; residual: number; ratePercent: number; accumulated: number }) {
  const { cost, residual } = assertResidualOk(input.cost, input.residual);
  const rate = roundMoney(input.ratePercent);
  if (!(rate > 0) || rate > 100) throw new Error("Depreciation rate must be between 0 and 100");
  const nbv = netBookValue(cost, input.accumulated);
  if (nbv <= residual) return 0;
  const annual = roundMoney(nbv * (rate / 100));
  const monthly = roundMoney(annual / 12);
  return roundMoney(Math.min(monthly, nbv - residual));
}

export function depreciationCharge(
  method: DepreciationMethod,
  input: { cost: number; residual: number; usefulLifeMonths: number; ratePercent?: number; accumulated: number },
) {
  if (method === "STRAIGHT_LINE") return straightLineMonthly(input);
  return reducingBalanceMonthly({
    cost: input.cost,
    residual: input.residual,
    ratePercent: input.ratePercent ?? 0,
    accumulated: input.accumulated,
  });
}

export function buildAssetCapitalizationLines(input: {
  assetAccountId: string;
  creditAccountId: string;
  cost: number;
  description?: string;
}): JournalLineDraft[] {
  const cost = roundMoney(input.cost);
  if (!(cost > 0)) throw new Error("Acquisition cost must be greater than zero");
  if (input.assetAccountId === input.creditAccountId) throw new Error("Choose a payment or payable account that is not the asset account");
  const description = input.description || "Asset capitalization";
  const lines: JournalLineDraft[] = [
    { accountId: input.assetAccountId, description, debit: cost, credit: 0 },
    { accountId: input.creditAccountId, description, debit: 0, credit: cost },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildDepreciationLines(input: {
  expenseAccountId: string;
  accumulatedAccountId: string;
  amount: number;
  description?: string;
}): JournalLineDraft[] {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Depreciation amount must be greater than zero");
  if (input.expenseAccountId === input.accumulatedAccountId) throw new Error("Choose two different accounts for depreciation");
  const description = input.description || "Depreciation";
  const lines: JournalLineDraft[] = [
    { accountId: input.expenseAccountId, description, debit: amount, credit: 0 },
    { accountId: input.accumulatedAccountId, description, debit: 0, credit: amount },
  ];
  assertJournalBalanced(lines);
  return lines;
}

/** Dispose: remove cost and accum dep; record proceeds and gain/loss. */
export function buildDisposalLines(input: {
  assetAccountId: string;
  accumulatedAccountId: string;
  proceedsAccountId?: string | null;
  gainAccountId?: string | null;
  lossAccountId?: string | null;
  cost: number;
  accumulated: number;
  proceeds: number;
  description?: string;
}): JournalLineDraft[] {
  const cost = roundMoney(input.cost);
  const accumulated = roundMoney(input.accumulated);
  const proceeds = roundMoney(input.proceeds);
  if (!(cost > 0)) throw new Error("Asset cost must be greater than zero");
  if (accumulated < 0 || accumulated > cost) throw new Error("Accumulated depreciation is invalid");
  if (proceeds < 0) throw new Error("Proceeds cannot be negative");
  const nbv = netBookValue(cost, accumulated);
  const gain = roundMoney(proceeds - nbv);
  const description = input.description || "Asset disposal";
  const lines: JournalLineDraft[] = [
    { accountId: input.accumulatedAccountId, description, debit: accumulated, credit: 0 },
    { accountId: input.assetAccountId, description, debit: 0, credit: cost },
  ];
  if (proceeds > 0) {
    if (!input.proceedsAccountId) throw new Error("Choose the bank or receivable account for disposal proceeds");
    lines.push({ accountId: input.proceedsAccountId, description, debit: proceeds, credit: 0 });
  }
  if (gain > 0) {
    if (!input.gainAccountId) throw new Error("Map a gain on disposal account");
    lines.push({ accountId: input.gainAccountId, description, debit: 0, credit: gain });
  } else if (gain < 0) {
    if (!input.lossAccountId) throw new Error("Map a loss on disposal account");
    lines.push({ accountId: input.lossAccountId, description, debit: roundMoney(-gain), credit: 0 });
  }
  assertJournalBalanced(lines);
  return lines;
}

export function buildImpairmentLines(input: {
  lossAccountId: string;
  accumulatedAccountId: string;
  amount: number;
  description?: string;
}): JournalLineDraft[] {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Impairment amount must be greater than zero");
  const description = input.description || "Asset impairment";
  const lines: JournalLineDraft[] = [
    { accountId: input.lossAccountId, description, debit: amount, credit: 0 },
    { accountId: input.accumulatedAccountId, description, debit: 0, credit: amount },
  ];
  assertJournalBalanced(lines);
  return lines;
}

export function buildRevaluationLines(input: {
  assetAccountId: string;
  reserveAccountId: string;
  amount: number;
  increase: boolean;
  description?: string;
}): JournalLineDraft[] {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new Error("Revaluation amount must be greater than zero");
  const description = input.description || "Asset revaluation";
  const lines: JournalLineDraft[] = input.increase
    ? [
        { accountId: input.assetAccountId, description, debit: amount, credit: 0 },
        { accountId: input.reserveAccountId, description, debit: 0, credit: amount },
      ]
    : [
        { accountId: input.reserveAccountId, description, debit: amount, credit: 0 },
        { accountId: input.assetAccountId, description, debit: 0, credit: amount },
      ];
  assertJournalBalanced(lines);
  return lines;
}

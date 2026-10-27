/**
 * Strict shapes for the JSON blobs stored on OrganizationSetting. The database
 * only guarantees `Json`, so every read must be cast through these interfaces
 * and defensively merged with DEFAULT_SETTINGS — never trust a raw row.
 */

/** Controls which individual sidebar links a workspace can see — one key per
 *  nav item (not per section), so an org can hide e.g. just "Scan Invoice"
 *  without losing the rest of Orders. Keying by nav id keeps this extensible:
 *  a new nav item ships with a new optional key and no migration, and any org
 *  missing the key falls back to `visible`. */
export interface ISidebarConfig {
  home: boolean;
  dashboard: boolean;
  pos: boolean;
  sales: boolean;
  invoices: boolean;
  customers: boolean;
  debtManagement: boolean;
  inventoryAll: boolean;
  lowStock: boolean;
  expiredProducts: boolean;
  stockMovementHistory: boolean;
  inventorySummary: boolean;
  stockTransfers: boolean;
  warehouses: boolean;
  orders: boolean;
  suppliers: boolean;
  supplierInvoices: boolean;
  scanInvoice: boolean;
  expenses: boolean;
  payroll: boolean;
  organizations: boolean;
  users: boolean;
  activityLogs: boolean;
  ebmOutbox: boolean;
  production: boolean;
  subscription: boolean;
  billingHistory: boolean;
  salesReports: boolean;
  inventoryReports: boolean;
  stockReports: boolean;
  debtPaymentsReport: boolean;
  cashFlowReport: boolean;
}

/** Global operational switches that change business logic, not just UI. */
export interface IFeatureFlags {
  /** Allow sales to push product quantity below zero instead of blocking checkout. */
  allowNegativeStock: boolean;
  /** Push completed sales to the RRA EBM/VSDC electronic-invoicing integration. */
  ebmIntegrationEnabled: boolean;
  /** Require manager approval before a stock adjustment is applied. */
  requireStockAdjustmentApproval: boolean;
  /** Let sellers grant ad-hoc discounts at the POS without manager override. */
  allowManualDiscounts: boolean;
  /** Enable multi-branch stock transfer workflows. */
  stockTransfersEnabled: boolean;
}

/** Cosmetic / UX preferences that don't affect business logic or data access. */
export interface IPreferences {
  language: string;
  timezone: string;
  dateFormat: string;
  defaultLandingPage: string;
  lowStockThresholdOverride: number | null;
  /** Default country of origin for new products (ISO 3166-1 alpha-2, RRA-supported) */
  originCountryCode: string | null;
  /** Payment method codes the organization accepts at the point of sale. */
  enabledPaymentMethods: string[];
  /** Shift-management business rules (stored alongside preferences JSON). */
  shiftConfig: {
    /** Require manager approval before a submitted closing becomes CLOSED. */
    approvalRequired: boolean;
    /** Enable the detailed denomination cash-counting interface at closing. */
    denominationsEnabled: boolean;
    /** Variance (RWF) above which a closing always requires approval. */
    varianceThreshold: number;
  };
}

export interface IOrganizationSettings {
  sidebarConfig: ISidebarConfig;
  featureFlags: IFeatureFlags;
  preferences: IPreferences;
  /** Business/taxpayer is registered for VAT. False → every sale uses RRA tax
   *  code D regardless of product category. Mirrors Organization.vatRegistered. */
  vatRegistered: boolean;
  /** RRA EBM/VSDC device credentials configurable from Organization Settings. */
  ebmConfig?: {
    tin?: string;
    bhfId?: string;
    dvcSrlNo?: string;
    /** CIS Machine Registration Code of the default branch device (Art. 3.2.1). */
    mrcNo?: string;
    ebmDeviceId?: string;
  };
}

/** Fallback applied to any record — including rows created before a given key
 *  existed — so the rest of the app can treat settings as fully populated. */
export const DEFAULT_SETTINGS: IOrganizationSettings = {
  sidebarConfig: {
    home: true,
    dashboard: true,
    pos: true,
    sales: true,
    invoices: true,
    customers: true,
    debtManagement: true,
    inventoryAll: true,
    lowStock: true,
    expiredProducts: true,
    stockMovementHistory: true,
    inventorySummary: true,
    stockTransfers: true,
    warehouses: true,
    orders: true,
    suppliers: true,
    supplierInvoices: true,
    scanInvoice: true,
    expenses: true,
    payroll: true,
    organizations: true,
    users: true,
    activityLogs: true,
    ebmOutbox: true,
    production: true,
    subscription: true,
    billingHistory: true,
    salesReports: true,
    inventoryReports: true,
    stockReports: true,
    debtPaymentsReport: true,
    cashFlowReport: true,
  },
  featureFlags: {
    allowNegativeStock: false,
    // Defaults to true: this must match the pre-existing always-on behavior
    // (gated only by the global config.ebm.enabled flag) for every org that
    // hasn't explicitly visited Settings, or EBM/RRA submission would silently
    // stop for organizations that never touched this toggle.
    ebmIntegrationEnabled: true,
    requireStockAdjustmentApproval: false,
    allowManualDiscounts: true,
    stockTransfersEnabled: true,
  },
  preferences: {
    language: "en",
    timezone: "Africa/Kigali",
    dateFormat: "DD/MM/YYYY",
    defaultLandingPage: "dashboard",
    lowStockThresholdOverride: null,
    originCountryCode: null,
    enabledPaymentMethods: ["CASH", "MOBILE_MONEY", "CARD", "BANK_TRANSFER", "DEBT"],
    shiftConfig: {
      approvalRequired: false,
      denominationsEnabled: false,
      varianceThreshold: 0,
    },
  },
// Defaults to true: matches the existing behavior where VAT-registered
// products charge 18%, so organizations that never touch this setting keep
// their current tax treatment.
  vatRegistered: true,
  ebmConfig: {
    tin: "",
    bhfId: "",
    dvcSrlNo: "",
    mrcNo: "",
    ebmDeviceId: "",
  },
};

/** Partial update payloads: every leaf is optional so callers can patch a
 *  single flag without knowing (or overwriting) the rest of the document. */
export type SidebarConfigPatch = Partial<ISidebarConfig>;
export type FeatureFlagsPatch = Partial<IFeatureFlags>;
export type PreferencesPatch = Partial<IPreferences>;

export interface OrganizationSettingsPatch {
  sidebarConfig?: SidebarConfigPatch;
  featureFlags?: FeatureFlagsPatch;
  preferences?: PreferencesPatch;
  ebmConfig?: {
    tin?: string;
    bhfId?: string;
    dvcSrlNo?: string;
    /** CIS Machine Registration Code of the default branch device (Art. 3.2.1). */
    mrcNo?: string;
    ebmDeviceId?: string;
  };
}

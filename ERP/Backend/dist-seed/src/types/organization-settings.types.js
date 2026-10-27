"use strict";
/**
 * Strict shapes for the JSON blobs stored on OrganizationSetting. The database
 * only guarantees `Json`, so every read must be cast through these interfaces
 * and defensively merged with DEFAULT_SETTINGS — never trust a raw row.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = void 0;
/** Fallback applied to any record — including rows created before a given key
 *  existed — so the rest of the app can treat settings as fully populated. */
exports.DEFAULT_SETTINGS = {
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
        ebmDeviceId: "",
    },
};

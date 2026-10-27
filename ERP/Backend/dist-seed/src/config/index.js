"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function getPrimaryFrontendUrl() {
    const urls = (process.env.FRONTEND_URL || "http://localhost:3000").split(',').map(s => s.trim()).filter(Boolean);
    return urls.find(u => u.startsWith('https://')) ?? urls[0] ?? 'http://localhost:3000';
}
exports.config = {
    appName: process.env.APP_NAME || "Exceldge-ERP",
    port: process.env.PORT || 5000,
    jwtSecret: process.env.JWT_SECRET,
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
    primaryFrontendUrl: getPrimaryFrontendUrl(),
    dpo: {
        companyToken: process.env.DPO_COMPANY_TOKEN || "",
        serviceType: process.env.DPO_SERVICE_TYPE || "",
        apiUrl: process.env.DPO_API_URL || "https://secure.3gdirectpay.com",
    },
    email: {
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: Number.parseInt(process.env.EMAIL_PORT || "587"),
        user: process.env.EMAIL_USER || "",
        password: process.env.EMAIL_PASSWORD || "",
        from: process.env.EMAIL_FROM || "noreply@exceldge-erp.com",
    },
    subscription: {
        monthly: Number.parseFloat(process.env.MONTHLY_PRICE || "29.99"),
        quarterly: Number.parseFloat(process.env.QUARTERLY_PRICE || "79.99"),
        yearly: Number.parseFloat(process.env.YEARLY_PRICE || "299.99"),
        gracePeriodDays: Number.parseInt(process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS || "3", 10),
        yearlyDiscountPercent: Number.parseFloat(process.env.SUBSCRIPTION_YEARLY_DISCOUNT_PERCENT || "20"),
    },
    inventory: {
        // Applied when auto-creating a product from a scanned supplier invoice and
        // OCR couldn't extract a selling price — keeps the product from going live
        // priced at cost (zero margin). Tune per business via env if needed.
        defaultMarkupPercent: Number.parseFloat(process.env.DEFAULT_PRODUCT_MARKUP_PERCENT || "20"),
    },
    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
        apiKey: process.env.CLOUDINARY_API_KEY || "",
        apiSecret: process.env.CLOUDINARY_API_SECRET || "",
    },
    ebm: {
        enabled: process.env.ENABLE_EBM === "true" || false,
        apiUrl: (process.env.EBM_API_URL || "").replace(/\/$/, ""),
        apiKey: process.env.EBM_API_KEY || "",
        apiSecret: process.env.EBM_API_SECRET || "",
        environment: process.env.EBM_ENVIRONMENT || "sandbox",
        defaultTin: process.env.EBM_DEFAULT_TIN || "",
        defaultBhfId: process.env.EBM_DEFAULT_BHF_ID || "00",
        defaultDvcSrlNo: process.env.EBM_DEFAULT_DVC_SRL_NO || "",
        // Canonical RRA VSDC endpoints (RRA VSDC API Documentation v1.0.5, §3.2.1)
        // Sale, refund, and cancellation all go through the same sales-transaction
        // endpoint — they're distinguished by rcptTyCd/salesSttsCd/orgInvcNo in the
        // payload, not by URL.
        salePath: process.env.EBM_SALE_PATH || "/trnsSales/saveSales",
        refundPath: process.env.EBM_REFUND_PATH || "/trnsSales/saveSales",
        voidPath: process.env.EBM_VOID_PATH || "/trnsSales/saveSales",
        // itemPath now matches the real VSDC path (§3.2.1: POST /items/saveItems),
        // fixed alongside product-sync.service.ts's payload shape.
        itemPath: process.env.EBM_ITEM_PATH || "/items/saveItems",
        // DEPRECATED: stock and purchase now use the real VSDC routes directly in
        // vsdc-api.service.ts (/stock/saveStockItems, /stockMaster/saveStockMaster,
        // /trnsPurchase/savePurchases, /trnsPurchase/selectTrnsPurchaseSales). These
        // env overrides are kept only so an old .env doesn't break startup.
        movementPath: process.env.EBM_MOVEMENT_PATH || "/selectMvmt",
        purchasePath: process.env.EBM_PURCHASE_PATH || "/savePurc",
        importPath: process.env.EBM_IMPORT_PATH || "/selectImportInvc",
        // CIS for VSDC §24.2.1: CIS must wait ≤1000 ms for a VSDC reply, then resend.
        requestTimeoutMs: Number.parseInt(process.env.EBM_REQUEST_TIMEOUT_MS || "1000", 10),
        useMock: process.env.EBM_USE_MOCK === "true",
        maxQueueRetries: Number.parseInt(process.env.EBM_MAX_QUEUE_RETRIES || "10", 10),
        // "/status" is not a real VSDC route (verified 404 against the RRA sandbox)
        // — there is no dedicated heartbeat endpoint in the spec. /code/selectCodes
        // is a real, side-effect-free lookup, so a successful response from it is
        // used as the liveness probe instead. Override via env if a genuine status
        // endpoint becomes available on production RRA infrastructure.
        statusCheckPath: process.env.EBM_STATUS_CHECK_PATH || "/code/selectCodes",
        securityKey: process.env.EBM_SECURITY_KEY || "",
        // ── EBM 2.1 / OSDC (Online Sales Data Controller) integration ────────────
        // protocol: 'vsdc' (v1, the /trnsSales/saveSales path) or 'osdc' (v2.1).
        protocol: process.env.EBM_PROTOCOL || "vsdc",
        // Base URL for the OSDC device. Either the deployed RRA OSDC WAR
        // (e.g. http://localhost:8080/osdc) or, if direct, the RRA EBM 2.1 server.
        osdcApiUrl: process.env.OSDC_API_URL || "",
        // Auth token configured on the OSDC WAR instance (set during WAR install).
        osdcAuthToken: process.env.OSDC_AUTH_TOKEN || "",
    },
};

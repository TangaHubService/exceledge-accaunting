"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Prisma exposes some columns (e.g. RraPurchase.spplrInvcNo) as BigInt, which
// JSON.stringify cannot serialize. Emit them as strings in every API response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
BigInt.prototype.toJSON = function () {
    return this.toString();
};
// Critical Security Check
if (!process.env.JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in environment variables.");
    process.exit(1);
}
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const http_1 = require("http");
const cors_1 = __importDefault(require("cors"));
const socket_1 = require("./utils/socket");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const organization_routes_1 = __importDefault(require("./routes/organization.routes"));
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const sales_routes_1 = __importDefault(require("./routes/sales.routes"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const customer_routes_1 = __importDefault(require("./routes/customer.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const report_routes_1 = __importDefault(require("./routes/report.routes"));
const system_owner_routes_1 = __importDefault(require("./routes/system-owner.routes"));
const subscription_routes_1 = __importDefault(require("./routes/subscription.routes"));
const supplier_routes_1 = __importDefault(require("./routes/supplier.routes"));
const purchaseOrder_routes_1 = __importDefault(require("./routes/purchaseOrder.routes"));
const activity_log_routes_1 = __importDefault(require("./routes/activity-log.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const debtPayment_routes_1 = __importDefault(require("./routes/debtPayment.routes"));
const batch_routes_1 = __importDefault(require("./routes/batch.routes"));
const branch_routes_1 = __importDefault(require("./routes/branch.routes"));
const warehouse_routes_1 = __importDefault(require("./routes/warehouse.routes"));
const expense_routes_1 = __importDefault(require("./routes/expense.routes"));
const supplier_payment_routes_1 = __importDefault(require("./routes/supplier-payment.routes"));
const stock_transfer_routes_1 = __importDefault(require("./routes/stock-transfer.routes"));
const ebm_outbox_routes_1 = __importDefault(require("./routes/ebm-outbox.routes"));
const shift_routes_1 = __importDefault(require("./routes/shift.routes"));
const held_sale_routes_1 = __importDefault(require("./routes/held-sale.routes"));
const device_routes_1 = __importDefault(require("./routes/device.routes"));
const error_middleware_1 = require("./middleware/error.middleware");
const paypack_webhook_routes_1 = __importDefault(require("./routes/paypack-webhook.routes"));
const subscription_job_1 = require("./jobs/subscription.job");
const product_expiry_job_1 = require("./jobs/product-expiry.job");
const ebm_outbox_job_1 = require("./jobs/ebm-outbox.job");
const vsdc_heartbeat_job_1 = require("./jobs/vsdc-heartbeat.job");
const z_report_job_1 = require("./jobs/z-report.job");
const rra_master_data_job_1 = require("./jobs/rra-master-data.job");
const stock_sync_job_1 = require("./jobs/stock-sync.job");
const pesapal_route_1 = __importDefault(require("./routes/pesapal.route"));
const system_branding_service_1 = require("./services/system-branding.service");
const upload_route_1 = __importDefault(require("./routes/upload.route"));
const supplier_invoice_routes_1 = __importDefault(require("./routes/supplier-invoice.routes"));
const supplier_portal_routes_1 = __importDefault(require("./routes/supplier-portal.routes"));
const bom_production_routes_1 = __importDefault(require("./routes/bom-production.routes"));
const swagger_1 = require("./docs/swagger");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const PORT = process.env.PORT || 5000;
/* ----------------------------------
   🔐 FIXED CORS CONFIG
------------------------------------- */
const allowedOrigins = [
    ...(process.env.FRONTEND_URL || "http://localhost:5173")
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    "https://erp.exceledgecpa.com", // always allow production origin
    "http://localhost:5173", // Vite dev server
    "http://localhost:3000",
    "http://localhost:3001",
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, mobile apps, curl, etc.)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, origin);
        }
        console.warn(`[CORS] Blocked origin: ${origin}`);
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
}));
/* ----------------------------------
   🔄 WEBHOOKS FIRST — RAW BODY
------------------------------------- */
app.use('/api/webhooks', express_1.default.raw({ type: 'application/json' }), paypack_webhook_routes_1.default);
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ limit: "50mb", extended: true }));
/* ----------------------------------
   🔌 SOCKET.IO INITIALIZATION
------------------------------------- */
(0, socket_1.initSocket)(httpServer);
/* ----------------------------------
   📌 API ROUTES
------------------------------------- */
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    message: "Too many login attempts from this IP, please try again after 15 minutes",
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/verify-email", authLimiter);
app.use("/api/auth/resend-verification", authLimiter);
app.use("/api/auth/request-password-reset", authLimiter);
app.use("/api/auth/verify-password-reset-code", authLimiter);
app.use("/api/auth", auth_routes_1.default);
app.use("/api/organizations", organization_routes_1.default);
app.use("/api/dashboard", dashboard_routes_1.default);
app.use("/api/sales", sales_routes_1.default);
app.use("/api/inventory", inventory_routes_1.default);
app.use("/api/customers", customer_routes_1.default);
app.use("/api/users", user_routes_1.default);
app.use("/api/reports", report_routes_1.default);
app.use("/api/system-owner", system_owner_routes_1.default);
app.use("/api/subscriptions", subscription_routes_1.default);
app.use("/api/debt-payments", debtPayment_routes_1.default);
app.use("/api/suppliers", supplier_routes_1.default);
app.use("/api/purchase-orders", purchaseOrder_routes_1.default);
app.use("/api/activity-logs", activity_log_routes_1.default);
app.use("/api/notifications", notification_routes_1.default);
app.use("/api/pesapal", pesapal_route_1.default);
app.use("/api/upload", upload_route_1.default);
app.use("/api/batches", batch_routes_1.default);
app.use("/api/branches", branch_routes_1.default);
app.use("/api/warehouses", warehouse_routes_1.default);
app.use("/api/expenses", expense_routes_1.default);
app.use("/api/supplier-payments", supplier_payment_routes_1.default);
app.use("/api/stock-transfers", stock_transfer_routes_1.default);
app.use("/api/organizations", ebm_outbox_routes_1.default);
app.use("/api/supplier-invoices", supplier_invoice_routes_1.default);
app.use("/api/supplier-portal", supplier_portal_routes_1.default);
app.use("/api/inventory", bom_production_routes_1.default);
app.use("/api/shifts", shift_routes_1.default);
app.use("/api/held-sales", held_sale_routes_1.default);
app.use("/api/devices", device_routes_1.default);
// Interactive OpenAPI docs (full API + RRA-focused)
(0, swagger_1.mountApiDocs)(app);
// Serve uploaded files statically
app.use('/uploads', express_1.default.static('uploads'));
/* ----------------------------------
   🏥 HEALTH CHECK
------------------------------------- */
app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "Business Management API is running" });
});
/* ----------------------------------
   🔖 CIS SOFTWARE VERSION (RRA CIS/VSDC §21)
   Verifiable software version; the same value is printed on every receipt.
------------------------------------- */
app.get(["/api/version", "/version"], (req, res) => {
    res.json({
        name: system_branding_service_1.SYSTEM_NAME,
        version: system_branding_service_1.SYSTEM_VERSION,
        label: system_branding_service_1.CIS_VERSION_LABEL,
    });
});
app.use(error_middleware_1.errorHandler);
/* ----------------------------------
   ⏰ CRON JOBS — prevent running twice
------------------------------------- */
if (process.env.RUN_JOBS !== "false") {
    subscription_job_1.subscriptionReminderJob.start();
    subscription_job_1.subscriptionStatusTransitionJob.start();
    product_expiry_job_1.productExpiryAlertJob.start();
    product_expiry_job_1.dailyReportJob.start();
    ebm_outbox_job_1.ebmOutboxJob.start();
    vsdc_heartbeat_job_1.vsdcHeartbeatJob.start();
    z_report_job_1.zReportJob.start();
    rra_master_data_job_1.rraMasterDataJob.start();
    stock_sync_job_1.stockSyncJob.start();
    // Run an immediate subscription status transition on boot so that
    // overdue statuses (TRIALING, ACTIVE, GRACE_PERIOD) are always caught
    // even if the hourly cron was down for a while.
    (0, subscription_job_1.runImmediateSubscriptionTransition)().catch((err) => console.error("Boot-time subscription transition failed:", err));
}
/* ----------------------------------
   🚀 START SERVER
------------------------------------- */
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API docs:     http://localhost:${PORT}/api/docs`);
    console.log(`Full Swagger: http://localhost:${PORT}/api/docs/full`);
    console.log(`RRA Swagger:  http://localhost:${PORT}/api/docs/rra`);
});
// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully');
    httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

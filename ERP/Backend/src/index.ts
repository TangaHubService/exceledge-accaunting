import dotenv from "dotenv";
dotenv.config();

// Prisma exposes some columns (e.g. RraPurchase.spplrInvcNo) as BigInt, which
// JSON.stringify cannot serialize. Emit them as strings in every API response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint) {
  return this.toString();
};

// Critical Security Check
if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET is not defined in environment variables.");
  process.exit(1);
}

import express from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import cors from "cors";
import bodyParser from "body-parser";
import { initSocket } from "./utils/socket";
import authRoutes from "./routes/auth.routes";
import organizationRoutes from "./routes/organization.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import salesRoutes from "./routes/sales.routes";
import inventoryRoutes from "./routes/inventory.routes";
import customerRoutes from "./routes/customer.routes";
import userRoutes from "./routes/user.routes";
import reportRoutes from "./routes/report.routes";
import systemOwnerRoutes from "./routes/system-owner.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import supplierRoutes from "./routes/supplier.routes";
import purchaseOrderRoutes from "./routes/purchaseOrder.routes";
import activityLogRoutes from "./routes/activity-log.routes";
import notificationRoutes from "./routes/notification.routes";
import debtPaymentRoutes from "./routes/debtPayment.routes";
import batchRoutes from "./routes/batch.routes";
import branchRoutes from "./routes/branch.routes";
import warehouseRoutes from "./routes/warehouse.routes";
import expenseRoutes from "./routes/expense.routes";
import supplierPaymentRoutes from "./routes/supplier-payment.routes";
import stockTransferRoutes from "./routes/stock-transfer.routes";
import accountingIntegrationRoutes from "./routes/accounting-integration.routes";
import ebmOutboxRoutes from "./routes/ebm-outbox.routes";
import shiftRoutes from "./routes/shift.routes";
import heldSaleRoutes from "./routes/held-sale.routes";
import deviceRoutes from "./routes/device.routes";
import payrollRoutes from "./routes/payroll.routes";

import { errorHandler } from "./middleware/error.middleware";
import webhookRoutes from "./routes/paypack-webhook.routes";
import {
  runImmediateSubscriptionTransition,
  subscriptionReminderJob,
  subscriptionStatusTransitionJob,
} from "./jobs/subscription.job";

import {
  productExpiryAlertJob,
  dailyReportJob,
} from "./jobs/product-expiry.job";
import { ebmOutboxJob } from "./jobs/ebm-outbox.job";
import { accountingOutboxJob } from "./jobs/accounting-outbox.job";
import { vsdcHeartbeatJob } from "./jobs/vsdc-heartbeat.job";
import { zReportJob } from "./jobs/z-report.job";
import { rraMasterDataJob } from "./jobs/rra-master-data.job";
import { stockSyncJob } from "./jobs/stock-sync.job";
import pesapalRoutes from "./routes/pesapal.route";
import { SYSTEM_NAME, SYSTEM_VERSION, CIS_VERSION_LABEL } from "./services/system-branding.service";
import uploadRoutes from "./routes/upload.route";
import supplierInvoiceRoutes from "./routes/supplier-invoice.routes";
import supplierPortalRoutes from "./routes/supplier-portal.routes";
import bomProductionRoutes from "./routes/bom-production.routes";
import { mountApiDocs } from "./docs/swagger";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

/* ----------------------------------
   🔐 FIXED CORS CONFIG
------------------------------------- */

const allowedOrigins = [
  ...(process.env.FRONTEND_URL || "http://localhost:5173")
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  ...(process.env.ACCOUNTING_WEB_URL || "http://localhost:5174") // Accounting web app
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  "https://erp.exceledgecpa.com", // always allow production origin
  "https://accounting.exceledgecpa.com", // Accounting SPA (email sign-in + handoff)
  "http://localhost:5173",         // Vite dev server
  "http://localhost:3000",
  "http://localhost:3001",
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
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
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/* ----------------------------------
   🔌 SOCKET.IO INITIALIZATION
------------------------------------- */

initSocket(httpServer);

/* ----------------------------------
   📌 API ROUTES
------------------------------------- */

const authLimiter = rateLimit({
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

app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/system-owner", systemOwnerRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/debt-payments", debtPaymentRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/activity-logs", activityLogRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/pesapal", pesapalRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/supplier-payments", supplierPaymentRoutes);
app.use("/api/stock-transfers", stockTransferRoutes);
app.use("/api/accounting-integration", accountingIntegrationRoutes);
app.use("/api/organizations", ebmOutboxRoutes);
app.use("/api/supplier-invoices", supplierInvoiceRoutes);
app.use("/api/supplier-portal", supplierPortalRoutes);
app.use("/api/inventory", bomProductionRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/held-sales", heldSaleRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/payroll", payrollRoutes);

// Interactive OpenAPI docs (full API + RRA-focused)
mountApiDocs(app);

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

/* ----------------------------------
   🏥 HEALTH CHECK
------------------------------------- */

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Business Management API is running" })
})

/* ----------------------------------
   🔖 CIS SOFTWARE VERSION (RRA CIS/VSDC §21)
   Verifiable software version; the same value is printed on every receipt.
------------------------------------- */

app.get(["/api/version", "/version"], (req, res) => {
  res.json({
    name: SYSTEM_NAME,
    version: SYSTEM_VERSION,
    label: CIS_VERSION_LABEL,
  })
})

app.use(errorHandler);

/* ----------------------------------
   ⏰ CRON JOBS — prevent running twice
------------------------------------- */

if (process.env.RUN_JOBS !== "false") {
  subscriptionReminderJob.start();
  subscriptionStatusTransitionJob.start();
  productExpiryAlertJob.start();
  dailyReportJob.start();
  ebmOutboxJob.start();
  accountingOutboxJob.start();
  vsdcHeartbeatJob.start();
  zReportJob.start();
  rraMasterDataJob.start();
  stockSyncJob.start();

  // Run an immediate subscription status transition on boot so that
  // overdue statuses (TRIALING, ACTIVE, GRACE_PERIOD) are always caught
  // even if the hourly cron was down for a while.
  runImmediateSubscriptionTransition().catch((err) =>
    console.error("Boot-time subscription transition failed:", err)
  );
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

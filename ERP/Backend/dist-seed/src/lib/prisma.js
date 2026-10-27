"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.branchStorage = void 0;
exports.withBranchScope = withBranchScope;
exports.getCurrentBranchId = getCurrentBranchId;
const client_1 = require("@prisma/client");
const async_hooks_1 = require("async_hooks");
exports.branchStorage = new async_hooks_1.AsyncLocalStorage();
/**
 * Run a callback inside a branch-scoped context.
 * Every Prisma query within the callback will automatically be filtered
 * to the given branchId (or set of branchIds) on models that support it.
 */
function withBranchScope(branchId, fn) {
    return exports.branchStorage.run({ branchId }, fn);
}
/**
 * Get the current branch ID from AsyncLocalStorage (or undefined).
 */
function getCurrentBranchId() {
    return exports.branchStorage.getStore()?.branchId;
}
// ── Models that have a `branchId` field ──────────────────────────────────
// NOTE: keep this in sync with prisma/schema.prisma. `Notification` was
// listed here previously but the `notifications` table has no `branchId`
// column — injecting one would throw P2022 ("column does not exist") the
// moment branch scoping became active for that model. Notifications are
// org-wide by design today; adding real per-branch notifications requires
// a schema migration (a nullable `branchId` column) before re-adding it here.
const BRANCH_AWARE_MODELS = new Set([
    'Sale',
    'Batch',
    'StockMovement',
    'Expense',
    'CashBalance',
    'InventoryLedger',
    'ActivityLog',
    'PurchaseOrder',
    'SupplierInvoice',
]);
// Prisma operations where we can inject `branchId` into the `where` clause.
const BRANCH_FILTERABLE_OPS = new Set([
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'findUnique',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'upsert', // upsert → where clause
    'updateMany',
]);
// Operations that create a record – inject branchId into `data`
const BRANCH_CREATE_OPS = new Set([
    'create',
    'createMany',
]);
const prisma = global.prisma || new client_1.PrismaClient({
    log: ['error', 'warn'],
    transactionOptions: {
        maxWait: 30000, // Increased to 30 seconds
        timeout: 60000, // Increased to 60 seconds
    },
});
exports.prisma = prisma;
// ── Prisma middleware: auto-inject branchId ──────────────────────────────
// NOTE: The PostgreSQL session variable (app.current_branch_id) is intentionally
// NOT set here. Doing so via $executeRawUnsafe doubles every query count and was
// the primary driver of Node.js OOM crashes. Branch isolation is enforced below
// via where-clause injection, which is the authoritative filter.
prisma.$use(async (params, next) => {
    const ctx = exports.branchStorage.getStore();
    const branchId = ctx?.branchId;
    if (branchId === undefined) {
        return next(params);
    }
    const model = params.model;
    if (!model || !BRANCH_AWARE_MODELS.has(model)) {
        return next(params);
    }
    // ── FILTER operations (findMany, findFirst, update, delete, etc.) ──
    if (BRANCH_FILTERABLE_OPS.has(params.action)) {
        const branchWhere = Array.isArray(branchId) ? { in: branchId } : branchId;
        const args = params.args;
        if (!args) {
            params.args = { where: { branchId: branchWhere } };
        }
        else {
            const existingWhere = args.where ?? {};
            // Only inject if branchId is not already specified (avoid override)
            if (existingWhere.branchId === undefined) {
                args.where = { ...existingWhere, branchId: branchWhere };
            }
        }
    }
    // ── CREATE operations – inject branchId into data ──
    // Only for a single resolved branch: a multi-branch (array) context can't
    // determine which one branch a new record belongs to, so creates rely on
    // the explicit, already-validated branchId in the request body instead.
    if (BRANCH_CREATE_OPS.has(params.action) && !Array.isArray(branchId)) {
        const args = params.args;
        if (args?.data) {
            if (Array.isArray(args.data)) {
                // createMany
                args.data = args.data.map((d) => ({ ...d, branchId }));
            }
            else {
                // create
                args.data = { ...args.data, branchId };
            }
        }
    }
    return next(params);
});
// In development, store the Prisma client in the global object to prevent hot-reloading issues
if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

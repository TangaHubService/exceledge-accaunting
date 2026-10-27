"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCodes = syncCodes;
exports.listCodes = listCodes;
exports.syncItemClasses = syncItemClasses;
exports.searchItemClasses = searchItemClasses;
exports.syncNotices = syncNotices;
exports.listNotices = listNotices;
exports.markNoticeRead = markNoticeRead;
exports.verifyCustomer = verifyCustomer;
exports.syncOneProduct = syncOneProduct;
exports.reconcileItems = reconcileItems;
exports.syncAll = syncAll;
exports.syncStock = syncStock;
exports.stockSyncStatus = stockSyncStatus;
exports.syncPurchases = syncPurchases;
exports.listRraPurchases = listRraPurchases;
exports.confirmPurchase = confirmPurchase;
exports.syncImports = syncImports;
exports.listRraImports = listRraImports;
exports.actionImport = actionImport;
exports.masterDataStatus = masterDataStatus;
exports.listRefundReasons = listRefundReasons;
exports.listPaymentMappings = listPaymentMappings;
exports.syncBranches = syncBranches;
exports.syncStockMoves = syncStockMoves;
exports.pushCustomer = pushCustomer;
exports.pushUser = pushUser;
exports.pushBomComposition = pushBomComposition;
exports.pushInsurance = pushInsurance;
exports.getAuditOverview = getAuditOverview;
const prisma_1 = require("../lib/prisma");
const apiResponse_1 = require("../utils/apiResponse");
const rra_master_data_service_1 = require("../services/rra-master-data.service");
const stock_movement_sync_service_1 = require("../services/stock-movement-sync.service");
const purchase_sync_service_1 = require("../services/purchase-sync.service");
const rra_import_service_1 = require("../services/rra-import.service");
const product_sync_service_1 = require("../services/product-sync.service");
const client_1 = require("@prisma/client");
const rra_code_service_1 = require("../services/rra-code.service");
const rra_branch_sync_service_1 = require("../services/rra-branch-sync.service");
const organization_settings_service_1 = require("../services/organization-settings.service");
const config_1 = require("../config");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const branchOf = (req) => {
    const b = req.query.branchId ?? req.body?.branchId;
    return b != null && b !== '' ? parseInt(String(b)) : null;
};
// ── Codes (§59) ───────────────────────────────────────────────
async function syncCodes(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const outcome = await (0, rra_master_data_service_1.syncRraCodes)(organizationId, branchOf(req));
        return outcome.ok ? res.json((0, apiResponse_1.success)(outcome)) : res.status(502).json((0, apiResponse_1.error)(outcome.error ?? 'Code sync failed', undefined, outcome));
    }
    catch (e) {
        console.error('[RRA codes sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync RRA codes'));
    }
}
async function listCodes(req, res) {
    var _a;
    try {
        const organizationId = parseInt(req.params.organizationId);
        const cdCls = req.query.cdCls;
        const rows = await prisma_1.prisma.rraCode.findMany({
            where: { organizationId, ...(cdCls ? { cdCls } : {}) },
            orderBy: [{ cdCls: 'asc' }, { srtOrd: 'asc' }, { cd: 'asc' }],
        });
        // Group by class for the caller's dropdowns.
        const byClass = {};
        for (const r of rows) {
            (byClass[_a = r.cdCls] ?? (byClass[_a] = { cdClsNm: r.cdClsNm, codes: [] })).codes.push(r);
        }
        res.json((0, apiResponse_1.success)({ classes: byClass, count: rows.length }));
    }
    catch (e) {
        console.error('[RRA codes list]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to list RRA codes'));
    }
}
// ── Item classification / UNSPSC (§61) ────────────────────────
async function syncItemClasses(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const outcome = await (0, rra_master_data_service_1.syncRraItemClasses)(organizationId, branchOf(req));
        return outcome.ok ? res.json((0, apiResponse_1.success)(outcome)) : res.status(502).json((0, apiResponse_1.error)(outcome.error ?? 'Item-class sync failed', undefined, outcome));
    }
    catch (e) {
        console.error('[RRA item-class sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync RRA item classifications'));
    }
}
async function searchItemClasses(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const q = req.query.q?.trim();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);
        const rows = await prisma_1.prisma.rraItemClass.findMany({
            where: {
                organizationId,
                useYn: 'Y',
                ...(q
                    ? { OR: [{ itemClsCd: { contains: q } }, { itemClsNm: { contains: q, mode: 'insensitive' } }] }
                    : {}),
            },
            orderBy: [{ itemClsLvl: 'desc' }, { itemClsCd: 'asc' }],
            take: limit,
        });
        const total = await prisma_1.prisma.rraItemClass.count({ where: { organizationId } });
        res.json((0, apiResponse_1.success)({ items: rows, cachedTotal: total }));
    }
    catch (e) {
        console.error('[RRA item-class search]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to search RRA item classifications'));
    }
}
// ── Notices (§65) ─────────────────────────────────────────────
async function syncNotices(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const outcome = await (0, rra_master_data_service_1.syncRraNotices)(organizationId, branchOf(req));
        return outcome.ok ? res.json((0, apiResponse_1.success)(outcome)) : res.status(502).json((0, apiResponse_1.error)(outcome.error ?? 'Notice sync failed', undefined, outcome));
    }
    catch (e) {
        console.error('[RRA notices sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync RRA notices'));
    }
}
async function listNotices(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const [notices, unread] = await Promise.all([
            prisma_1.prisma.rraNotice.findMany({ where: { organizationId }, orderBy: { noticeNo: 'desc' }, take: 200 }),
            prisma_1.prisma.rraNotice.count({ where: { organizationId, readAt: null } }),
        ]);
        res.json((0, apiResponse_1.success)({ notices, unread }));
    }
    catch (e) {
        console.error('[RRA notices list]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to list RRA notices'));
    }
}
async function markNoticeRead(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const noticeNo = parseInt(req.params.noticeNo);
        const updated = await prisma_1.prisma.rraNotice.updateMany({
            where: { organizationId, noticeNo, readAt: null },
            data: { readAt: new Date() },
        });
        res.json((0, apiResponse_1.success)({ updated: updated.count }));
    }
    catch (e) {
        console.error('[RRA notice read]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to update the notice'));
    }
}
// ── Customer verification (§62) ───────────────────────────────
async function verifyCustomer(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const tin = String(req.params.tin ?? req.query.tin ?? '').trim();
        const customerId = req.query.customerId ? parseInt(req.query.customerId) : undefined;
        const result = await (0, rra_master_data_service_1.verifyCustomerTin)(organizationId, tin, { branchId: branchOf(req), customerId });
        if (result.error)
            return res.status(502).json((0, apiResponse_1.error)(result.error));
        res.json((0, apiResponse_1.success)(result));
    }
    catch (e) {
        console.error('[RRA customer verify]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to verify the customer TIN with RRA'));
    }
}
// ── Select Item reconciliation (§64) ──────────────────────────
/**
 * POST /:organizationId/rra/items/:productId/sync
 * Force-register one product with RRA (used by the reconcile view to push a
 * local-only item, or to apply RRA's value on a mismatch then re-register).
 * Optional body: { itemClsCd?, taxCode? } — applied to the product first.
 */
async function syncOneProduct(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const productId = parseInt(req.params.productId);
        const { itemClsCd, taxCode } = req.body ?? {};
        const product = await prisma_1.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
        if (!product)
            return res.status(404).json((0, apiResponse_1.error)('Product not found'));
        const data = { ebmSyncStatus: 'PENDING' }; // clear the SYNCED skip-guard so a re-register runs
        if (typeof itemClsCd === 'string' && itemClsCd.trim())
            data.itemClsCd = itemClsCd.trim();
        if (typeof taxCode === 'string' && client_1.RraTaxCode[taxCode])
            data.taxCode = taxCode;
        await prisma_1.prisma.product.update({ where: { id: productId }, data });
        const result = await (0, product_sync_service_1.syncProductToRra)(productId, req.user?.userId);
        return result.success
            ? res.json((0, apiResponse_1.success)({ productId, ...result }))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Product sync failed'));
    }
    catch (e) {
        console.error('[RRA item sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync the product with RRA'));
    }
}
async function reconcileItems(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const result = await (0, rra_master_data_service_1.pullRraItems)(organizationId, branchOf(req));
        if (!result.ok)
            return res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Item reconciliation failed'));
        res.json((0, apiResponse_1.success)({
            pulled: result.items.length,
            diff: {
                rraOnly: result.diff.rraOnly.length,
                localOnly: result.diff.localOnly.length,
                mismatched: result.diff.mismatched.length,
            },
            details: result.diff,
        }));
    }
    catch (e) {
        console.error('[RRA item reconcile]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to reconcile items with RRA'));
    }
}
// ── Combined sync + status ───────────────────────────────────
async function syncAll(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const outcomes = await (0, rra_master_data_service_1.syncAllRraMasterData)(organizationId, branchOf(req));
        res.json((0, apiResponse_1.success)({ outcomes }));
    }
    catch (e) {
        console.error('[RRA master-data sync all]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync RRA master data'));
    }
}
// ── Stock In/Out + Stock Master (§23, §72, §73) ──────────────
async function syncStock(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const queued = await (0, stock_movement_sync_service_1.queuePendingStockForOrg)(organizationId);
        const result = await (0, stock_movement_sync_service_1.processStockSyncBatch)(50);
        res.json((0, apiResponse_1.success)({ queued, ...result }));
    }
    catch (e) {
        console.error('[RRA stock sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync stock with RRA'));
    }
}
async function stockSyncStatus(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const grouped = await prisma_1.prisma.inventoryLedger.groupBy({
            by: ['ebmSyncStatus'],
            where: { organizationId, movementType: { not: 'SALE' } },
            _count: true,
        });
        const counts = { PENDING: 0, SYNCED: 0, FAILED: 0, NOT_APPLICABLE: 0 };
        for (const g of grouped)
            counts[g.ebmSyncStatus ?? 'NOT_APPLICABLE'] = g._count;
        const failures = await prisma_1.prisma.inventoryLedger.findMany({
            where: { organizationId, ebmSyncStatus: 'FAILED' },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, movementType: true, quantity: true, direction: true, ebmError: true, createdAt: true, product: { select: { name: true } } },
        });
        res.json((0, apiResponse_1.success)({ counts, failures }));
    }
    catch (e) {
        console.error('[RRA stock status]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to read stock-sync status'));
    }
}
// ── B2B purchases (§70, §71) ─────────────────────────────────
async function syncPurchases(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const result = await (0, purchase_sync_service_1.syncRraPurchases)(organizationId, branchOf(req));
        return result.ok ? res.json((0, apiResponse_1.success)(result)) : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Purchase sync failed'));
    }
    catch (e) {
        console.error('[RRA purchases sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to pull purchases from RRA'));
    }
}
async function listRraPurchases(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const status = req.query.status;
        const rows = await prisma_1.prisma.rraPurchase.findMany({
            where: { organizationId, ...(status ? { status: status } : {}) },
            include: { items: { orderBy: { itemSeq: 'asc' } } },
            orderBy: { pulledAt: 'desc' },
            take: 200,
        });
        const pending = await prisma_1.prisma.rraPurchase.count({ where: { organizationId, status: 'PENDING' } });
        // spplrInvcNo is a BigInt column — JSON.stringify cannot serialize it.
        const purchases = rows.map((r) => ({ ...r, spplrInvcNo: r.spplrInvcNo.toString() }));
        res.json((0, apiResponse_1.success)({ purchases, pending }));
    }
    catch (e) {
        console.error('[RRA purchases list]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to list RRA purchases'));
    }
}
async function confirmPurchase(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const reject = req.query.reject === 'true' || req.body?.reject === true;
        const result = await (0, purchase_sync_service_1.confirmRraPurchase)(organizationId, id, {
            branchId: branchOf(req),
            userId: req.user?.userId,
            reject,
            prcOrdCd: req.body?.prcOrdCd,
        });
        return result.success ? res.json((0, apiResponse_1.success)(result)) : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Purchase confirmation failed'));
    }
    catch (e) {
        console.error('[RRA purchase confirm]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to confirm the purchase'));
    }
}
// ── Import declarations (§66, §67, §68) ──────────────────────
async function syncImports(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const requestDate = (req.body?.requestDate ?? req.query.requestDate);
        const result = await (0, rra_import_service_1.syncRraImports)(organizationId, { branchId: branchOf(req), requestDate });
        return result.ok ? res.json((0, apiResponse_1.success)(result)) : res.status(400).json((0, apiResponse_1.error)(result.error ?? 'Import sync failed', undefined, result));
    }
    catch (e) {
        console.error('[RRA imports sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to pull import declarations from RRA'));
    }
}
async function listRraImports(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const status = req.query.status;
        const [rows, pending, cursor] = await Promise.all([
            prisma_1.prisma.rraImportItem.findMany({
                where: { organizationId, ...(status ? { status: status } : {}) },
                orderBy: [{ dclDe: 'desc' }, { itemSeq: 'asc' }],
                take: 300,
            }),
            prisma_1.prisma.rraImportItem.count({ where: { organizationId, status: 'PENDING' } }),
            prisma_1.prisma.rraSyncCursor.findUnique({ where: { organizationId_resource: { organizationId, resource: 'imports' } } }),
        ]);
        res.json((0, apiResponse_1.success)({ imports: rows, pending, lastRequestDate: cursor?.lastReqDt?.slice(0, 8) ?? null }));
    }
    catch (e) {
        console.error('[RRA imports list]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to list import declarations'));
    }
}
async function actionImport(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const action = req.params.action === 'reject' ? 'reject' : 'approve';
        const { itemClsCd, itemCd, linkProductId, remark } = req.body ?? {};
        const result = await (0, rra_import_service_1.actionRraImport)(organizationId, id, action, {
            branchId: branchOf(req),
            userId: req.user?.userId,
            itemClsCd,
            itemCd,
            linkProductId: linkProductId != null ? parseInt(String(linkProductId)) : undefined,
            remark,
        });
        return result.success ? res.json((0, apiResponse_1.success)(result)) : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Import action failed'));
    }
    catch (e) {
        console.error('[RRA import action]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to update the import declaration'));
    }
}
async function masterDataStatus(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const [cursors, codeCount, classCount, noticeCount, unread] = await Promise.all([
            prisma_1.prisma.rraSyncCursor.findMany({ where: { organizationId } }),
            prisma_1.prisma.rraCode.count({ where: { organizationId } }),
            prisma_1.prisma.rraItemClass.count({ where: { organizationId } }),
            prisma_1.prisma.rraNotice.count({ where: { organizationId } }),
            prisma_1.prisma.rraNotice.count({ where: { organizationId, readAt: null } }),
        ]);
        res.json((0, apiResponse_1.success)({
            cursors,
            counts: { codes: codeCount, itemClasses: classCount, notices: noticeCount, unreadNotices: unread },
        }));
    }
    catch (e) {
        console.error('[RRA master-data status]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to read RRA master-data status'));
    }
}
// ── Fiscal document lookups (refund reasons / payment mappings) ──
/**
 * RRA refund reason codes (code class 32) for the refund-reason dropdown.
 * Served from the centralized RRA code service — the same list the fiscal
 * refund validator enforces, so the UI can never offer a code VSDC rejects.
 */
async function listRefundReasons(req, res) {
    try {
        res.json((0, apiResponse_1.success)({ reasons: (0, rra_code_service_1.getRefundReasonCodes)(), default: rra_code_service_1.DEFAULT_RFD_RSN_CD }));
    }
    catch (e) {
        console.error('[RRA refund reasons]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to list RRA refund reasons'));
    }
}
/**
 * ERP → RRA payment-method mappings with the RRA code names, for checkout
 * display and operator validation.
 */
async function listPaymentMappings(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const mappings = await (0, rra_code_service_1.getPaymentMethodMappings)(organizationId);
        res.json((0, apiResponse_1.success)({ mappings }));
    }
    catch (e) {
        console.error('[RRA payment mappings]', e);
        res.status(502).json((0, apiResponse_1.error)(e instanceof Error ? e.message : 'Failed to list payment mappings'));
    }
}
// ── Branch / customer / user / composition / stock-move (§3.3.2–3.3.3, §3.3.8.1) ──
async function syncBranches(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const result = await (0, rra_branch_sync_service_1.syncRraBranches)(organizationId, branchOf(req));
        return result.ok
            ? res.json((0, apiResponse_1.success)(result))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Branch sync failed', undefined, result));
    }
    catch (e) {
        console.error('[RRA branches sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to sync RRA branches'));
    }
}
async function syncStockMoves(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const result = await (0, rra_branch_sync_service_1.syncRraStockMoves)(organizationId, branchOf(req));
        return result.ok
            ? res.json((0, apiResponse_1.success)(result))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Stock-move pull failed', undefined, result));
    }
    catch (e) {
        console.error('[RRA stock moves sync]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to pull stock movements from RRA'));
    }
}
async function pushCustomer(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const customerId = parseInt(req.params.customerId);
        const result = await (0, rra_branch_sync_service_1.syncCustomerToRra)(organizationId, customerId, {
            branchId: branchOf(req),
            userId: req.user?.userId,
        });
        return result.success
            ? res.json((0, apiResponse_1.success)(result))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Customer push failed'));
    }
    catch (e) {
        console.error('[RRA customer push]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to push customer to VSDC'));
    }
}
async function pushUser(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = parseInt(req.params.userId);
        const result = await (0, rra_branch_sync_service_1.syncUserToRra)(organizationId, userId, {
            branchId: branchOf(req),
            actorUserId: req.user?.userId,
        });
        return result.success
            ? res.json((0, apiResponse_1.success)(result))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'User push failed'));
    }
    catch (e) {
        console.error('[RRA user push]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to push user to VSDC'));
    }
}
async function pushBomComposition(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const parentProductId = parseInt(req.params.productId);
        const componentProductId = parseInt(req.params.componentId);
        const result = await (0, rra_branch_sync_service_1.syncBomComponentToRra)(organizationId, parentProductId, componentProductId, {
            branchId: branchOf(req),
            userId: req.user?.userId,
        });
        return result.success
            ? res.json((0, apiResponse_1.success)(result))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Composition push failed'));
    }
    catch (e) {
        console.error('[RRA BOM composition push]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to push item composition to VSDC'));
    }
}
/** POST /branches/saveBrancheInsurances — pharmacy insurer registration. */
async function pushInsurance(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const customerId = parseInt(req.params.customerId);
        const result = await (0, rra_branch_sync_service_1.syncInsuranceToRra)(organizationId, customerId, {
            branchId: branchOf(req),
            userId: req.user?.userId,
        });
        if (result.skipped)
            return res.json((0, apiResponse_1.success)({ ...result, message: 'Not an insurance customer — skipped' }));
        return result.success
            ? res.json((0, apiResponse_1.success)(result))
            : res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Insurance push failed'));
    }
    catch (e) {
        console.error('[RRA insurance push]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to push insurance company to VSDC'));
    }
}
/**
 * CIS §7.26 — auditor overview of software settings and fiscal database state.
 * GET /organizations/:organizationId/rra/audit-overview
 */
async function getAuditOverview(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchId = branchOf(req);
        const [org, branches, settings, cursors, counters, outboxStats, lastSale] = await Promise.all([
            prisma_1.prisma.organization.findUnique({
                where: { id: organizationId },
                select: {
                    id: true,
                    name: true,
                    TIN: true,
                    address: true,
                    trainingMode: true,
                    ebmDeviceId: true,
                    ebmSerialNo: true,
                    lastSuccessfulVdsContact: true,
                },
            }),
            prisma_1.prisma.branch.findMany({
                where: { organizationId, status: 'ACTIVE', ...(branchId != null ? { id: branchId } : {}) },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    bhfId: true,
                    ebmDeviceId: true,
                    ebmSerialNo: true,
                    vsdcUrl: true,
                    ebmInitializedAt: true,
                    isDefault: true,
                },
                orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
            }),
            (0, organization_settings_service_1.getOrganizationSettings)(organizationId),
            prisma_1.prisma.rraSyncCursor.findMany({
                where: { organizationId },
                select: { resource: true, lastReqDt: true, lastRunAt: true, lastResult: true },
                orderBy: { resource: 'asc' },
            }),
            prisma_1.prisma.vsdcDeviceCounter.findMany({
                where: { organizationId },
                select: { deviceKey: true, nextSequence: true, updatedAt: true },
            }),
            prisma_1.prisma.ebmOutbox.groupBy({
                by: ['status'],
                where: { organizationId },
                _count: { _all: true },
            }),
            prisma_1.prisma.sale.findFirst({
                where: { organizationId, ...(branchId != null ? { branchId } : {}), status: { in: ['COMPLETED', 'REFUNDED'] } },
                orderBy: { createdAt: 'desc' },
                select: { id: true, saleNumber: true, invoiceNumber: true, rcptLabel: true, createdAt: true, status: true },
            }),
        ]);
        return res.json((0, apiResponse_1.success)({
            cis: {
                appName: config_1.config.appName,
                ebmEnabled: (0, rra_ebm_service_1.isEbmEnabled)(),
                ebmProtocol: config_1.config.ebm.protocol,
                environment: config_1.config.ebm.environment,
                requestTimeoutMs: config_1.config.ebm.requestTimeoutMs,
            },
            organization: org,
            branches,
            settings: {
                featureFlags: settings.featureFlags,
                vatRegistered: settings.vatRegistered,
                preferences: {
                    timezone: settings.preferences.timezone,
                    dateFormat: settings.preferences.dateFormat,
                    enabledPaymentMethods: settings.preferences.enabledPaymentMethods,
                },
            },
            syncCursors: cursors,
            invoiceCounters: counters,
            outboxByStatus: Object.fromEntries(outboxStats.map((r) => [r.status, r._count._all])),
            lastFiscalSale: lastSale,
            generatedAt: new Date().toISOString(),
        }));
    }
    catch (e) {
        console.error('[RRA audit overview]', e);
        res.status(500).json((0, apiResponse_1.error)('Failed to load auditor overview'));
    }
}

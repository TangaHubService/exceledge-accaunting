"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ebm_outbox_controller_1 = require("../controllers/ebm-outbox.controller");
const ebm_master_data_controller_1 = require("../controllers/ebm-master-data.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
router.get('/:organizationId/ebm-status', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.getEbmStatus);
router.get('/:organizationId/ebm-outbox', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.getEbmOutbox);
router.post('/:organizationId/ebm-outbox/:id/check-status', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.checkEbmOutboxStatus);
router.post('/:organizationId/ebm-outbox/:id/retry', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.retryEbmOutbox);
router.post('/:organizationId/z-report', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.submitZReport);
router.get('/:organizationId/z-report', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.getZReportStatus);
router.post('/:organizationId/ebm/initialize', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_outbox_controller_1.initializeDevice);
// ── RRA master-data (Codes §59 / Item Class §61 / Customer §62 / Select Item §64 / Notices §65) ──
router.get('/:organizationId/rra/status', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.masterDataStatus);
router.post('/:organizationId/rra/sync-all', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncAll);
router.get('/:organizationId/rra/codes', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.listCodes);
router.post('/:organizationId/rra/codes/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncCodes);
router.get('/:organizationId/rra/item-classes', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.searchItemClasses);
router.post('/:organizationId/rra/item-classes/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncItemClasses);
router.get('/:organizationId/rra/notices', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.listNotices);
router.post('/:organizationId/rra/notices/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncNotices);
router.post('/:organizationId/rra/notices/:noticeNo/read', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.markNoticeRead);
router.get('/:organizationId/rra/customers/:tin', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.verifyCustomer);
router.post('/:organizationId/rra/items/reconcile', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.reconcileItems);
router.post('/:organizationId/rra/items/:productId/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncOneProduct);
// ── Stock In/Out §23/§72/§73 + B2B purchases §70/§71 ──
router.get('/:organizationId/rra/stock', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.stockSyncStatus);
router.post('/:organizationId/rra/stock/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncStock);
router.get('/:organizationId/rra/purchases', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.listRraPurchases);
router.post('/:organizationId/rra/purchases/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncPurchases);
router.post('/:organizationId/rra/purchases/:id/confirm', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.confirmPurchase);
// ── Import declarations §66/§67/§68 ──
router.get('/:organizationId/rra/imports', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.listRraImports);
router.post('/:organizationId/rra/imports/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncImports);
router.post('/:organizationId/rra/imports/:id/:action', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.actionImport);
// ── Fiscal document lookups: refund reasons (code class 32) + payment mappings ──
router.get('/:organizationId/rra/refund-reasons', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.listRefundReasons);
router.get('/:organizationId/rra/payment-mappings', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.listPaymentMappings);
// ── Branch / customer / user / composition / stock-move (VSDC §3.3.2–3.3.3, §3.3.8.1) ──
router.post('/:organizationId/rra/branches/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncBranches);
router.post('/:organizationId/rra/stock-moves/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.syncStockMoves);
router.post('/:organizationId/rra/customers/:customerId/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.pushCustomer);
router.post('/:organizationId/rra/customers/:customerId/insurance/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.pushInsurance);
router.post('/:organizationId/rra/users/:userId/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.pushUser);
router.post('/:organizationId/rra/items/:productId/composition/:componentId/sync', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.pushBomComposition);
router.get('/:organizationId/rra/audit-overview', auth_middleware_1.authenticate, (0, feature_access_middleware_1.requireActiveSubscription)(), ebm_master_data_controller_1.getAuditOverview);
exports.default = router;

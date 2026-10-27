import { Router } from 'express';
import {
  getEbmOutbox,
  checkEbmOutboxStatus,
  retryEbmOutbox,
  getEbmStatus,
  submitZReport,
  getZReportStatus,
  initializeDevice,
} from '../controllers/ebm-outbox.controller';
import {
  syncCodes,
  listCodes,
  syncItemClasses,
  searchItemClasses,
  syncNotices,
  listNotices,
  markNoticeRead,
  verifyCustomer,
  reconcileItems,
  syncOneProduct,
  syncAll,
  masterDataStatus,
  syncStock,
  stockSyncStatus,
  syncPurchases,
  listRraPurchases,
  confirmPurchase,
  syncImports,
  listRraImports,
  actionImport,
  listRefundReasons,
  listPaymentMappings,
  getCodeCatalog,
  syncBranches,
  syncStockMoves,
  pushCustomer,
  pushUser,
  pushBomComposition,
  pushInsurance,
  getAuditOverview,
} from '../controllers/ebm-master-data.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';

const router = Router();
const orgAccess = requireOrganizationAccess();
const stockManagers = authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER');

router.get('/:organizationId/ebm-status', authenticate, orgAccess, requireActiveSubscription(), getEbmStatus);
router.get('/:organizationId/ebm-outbox', authenticate, orgAccess, requireActiveSubscription(), getEbmOutbox);
router.post('/:organizationId/ebm-outbox/:id/check-status', authenticate, orgAccess, requireActiveSubscription(), checkEbmOutboxStatus);
router.post('/:organizationId/ebm-outbox/:id/retry', authenticate, orgAccess, requireActiveSubscription(), retryEbmOutbox);
router.post('/:organizationId/z-report', authenticate, orgAccess, requireActiveSubscription(), submitZReport);
router.get('/:organizationId/z-report', authenticate, orgAccess, requireActiveSubscription(), getZReportStatus);
router.post('/:organizationId/ebm/initialize', authenticate, orgAccess, requireActiveSubscription(), initializeDevice);

// ── RRA master-data (Codes §59 / Item Class §61 / Customer §62 / Select Item §64 / Notices §65) ──
router.get('/:organizationId/rra/status', authenticate, orgAccess, requireActiveSubscription(), masterDataStatus);
router.post('/:organizationId/rra/sync-all', authenticate, orgAccess, requireActiveSubscription(), syncAll);

router.get('/:organizationId/rra/codes', authenticate, orgAccess, requireActiveSubscription(), listCodes);
router.get('/:organizationId/rra/code-catalog', authenticate, orgAccess, requireActiveSubscription(), getCodeCatalog);
router.post('/:organizationId/rra/codes/sync', authenticate, orgAccess, requireActiveSubscription(), syncCodes);

router.get('/:organizationId/rra/item-classes', authenticate, orgAccess, requireActiveSubscription(), searchItemClasses);
router.post('/:organizationId/rra/item-classes/sync', authenticate, orgAccess, requireActiveSubscription(), syncItemClasses);

router.get('/:organizationId/rra/notices', authenticate, orgAccess, requireActiveSubscription(), listNotices);
router.post('/:organizationId/rra/notices/sync', authenticate, orgAccess, requireActiveSubscription(), syncNotices);
router.post('/:organizationId/rra/notices/:noticeNo/read', authenticate, orgAccess, requireActiveSubscription(), markNoticeRead);

router.get('/:organizationId/rra/customers/:tin', authenticate, orgAccess, requireActiveSubscription(), verifyCustomer);
router.post('/:organizationId/rra/items/reconcile', authenticate, orgAccess, requireActiveSubscription(), reconcileItems);
router.post('/:organizationId/rra/items/:productId/sync', authenticate, orgAccess, requireActiveSubscription(), syncOneProduct);

// ── Stock In/Out §23/§72/§73 + B2B purchases §70/§71 ──
router.get('/:organizationId/rra/stock', authenticate, orgAccess, requireActiveSubscription(), stockSyncStatus);
router.post('/:organizationId/rra/stock/sync', authenticate, orgAccess, requireActiveSubscription(), stockManagers, syncStock);

router.get('/:organizationId/rra/purchases', authenticate, orgAccess, requireActiveSubscription(), listRraPurchases);
router.post('/:organizationId/rra/purchases/sync', authenticate, orgAccess, requireActiveSubscription(), syncPurchases);
router.post('/:organizationId/rra/purchases/:id/confirm', authenticate, orgAccess, requireActiveSubscription(), stockManagers, confirmPurchase);

// ── Import declarations §66/§67/§68 ──
router.get('/:organizationId/rra/imports', authenticate, orgAccess, requireActiveSubscription(), listRraImports);
router.post('/:organizationId/rra/imports/sync', authenticate, orgAccess, requireActiveSubscription(), syncImports);
router.post('/:organizationId/rra/imports/:id/:action', authenticate, orgAccess, requireActiveSubscription(), stockManagers, actionImport);

// ── Fiscal document lookups: refund reasons (code class 32) + payment mappings ──
router.get('/:organizationId/rra/refund-reasons', authenticate, orgAccess, requireActiveSubscription(), listRefundReasons);
router.get('/:organizationId/rra/payment-mappings', authenticate, orgAccess, requireActiveSubscription(), listPaymentMappings);

// ── Branch / customer / user / composition / stock-move (VSDC §3.3.2–3.3.3, §3.3.8.1) ──
router.post('/:organizationId/rra/branches/sync', authenticate, orgAccess, requireActiveSubscription(), syncBranches);
router.post('/:organizationId/rra/stock-moves/sync', authenticate, orgAccess, requireActiveSubscription(), stockManagers, syncStockMoves);
router.post('/:organizationId/rra/customers/:customerId/sync', authenticate, orgAccess, requireActiveSubscription(), pushCustomer);
router.post('/:organizationId/rra/customers/:customerId/insurance/sync', authenticate, orgAccess, requireActiveSubscription(), pushInsurance);
router.post('/:organizationId/rra/users/:userId/sync', authenticate, orgAccess, requireActiveSubscription(), pushUser);
router.post('/:organizationId/rra/items/:productId/composition/:componentId/sync', authenticate, orgAccess, requireActiveSubscription(), pushBomComposition);
router.get('/:organizationId/rra/audit-overview', authenticate, orgAccess, requireActiveSubscription(), getAuditOverview);

export default router;

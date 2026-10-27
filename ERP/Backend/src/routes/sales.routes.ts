import { Router } from "express";
import {
  createSale,
  getSales,
  getSaleById,
  payDebt,
 refundSale,
  cancelSale,
  correctSale,
  getRefundable,
  reprintSaleReceipt,
  printReceiptCopy,
  regenerateInvoice,
  getEbmReceipt,
  getInvoice,
  getInvoicePdf,
  getLastReceipt,
  updateProforma,
  convertProforma,
} from "../controllers/sales.controller";
import {
  enqueuePosPrintJob,
  claimNextPosPrintJob,
  completePosPrintJob,
} from "../controllers/pos-print.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { branchAuth } from "../middleware/branchAuth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import { vsdcOnlineGuard } from "../middleware/vsdc-offline-guard.middleware";
import { validate } from "../middleware/validate.middleware";
import { createSaleSchema, cancelSaleSchema, correctSaleSchema, refundSaleSchema, updateProformaSchema, convertProformaSchema } from "../validations/sales.validation";
import {
  initiateMobileMoneyPayment,
  getMobileMoneyPaymentStatus,
  cancelMobileMoneyPayment,
} from "../controllers/mobile-money.controller";

const router = Router();

const orgAccess = requireOrganizationAccess();

// Initiate and monitor a POS mobile-money collection using the configured
// Paypack or direct MTN MoMo provider. The sale is created only after the
// provider confirms that the collection completed.
router.post(
  "/:organizationId/mobile-money/initiate",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  initiateMobileMoneyPayment
);

router.get(
  "/:organizationId/mobile-money/:transactionId/status",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  getMobileMoneyPaymentStatus
);

router.post(
  "/:organizationId/mobile-money/:transactionId/cancel",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  cancelMobileMoneyPayment
);

// Create a new sale (vsdcOnlineGuard blocks if VSDC unreachable > 24h, per RRA requirement)
router.post(
  "/:organizationId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  vsdcOnlineGuard,
  validate(createSaleSchema),
  createSale
);

// Get all sales for an organization
router.get(
  "/:organizationId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  getSales
);

// CIS §7.28 — last finalized receipt for power/paper recovery reprint
router.get(
  "/:organizationId/last-receipt",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  getLastReceipt
);

// Edit a proforma's line items / customer (only before it is converted)
router.put(
  "/:organizationId/:saleId/proforma",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  validate(updateProformaSchema),
  updateProforma
);

// Convert a proforma into a real, fiscalized NS sale
router.post(
  "/:organizationId/:saleId/convert",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  vsdcOnlineGuard,
  validate(convertProformaSchema),
  convertProforma
);

// Get a specific sale by ID
router.get(
  "/:organizationId/:id",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  getSaleById
);

// Pay off debt for a sale
router.put(
  "/:id/pay-debt/:organizationId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  payDebt
);

// Refund a sale (full or partial)
router.post(
  "/:id/refund/:organizationId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  validate(refundSaleSchema),
  refundSale
);

// What can still be refunded on a sale (original detail + per-line
// remaining + prior refunds). Drives the refund UI; refundSale re-enforces
// every rule, so this is read-only.
router.get(
  "/:organizationId/:saleId/refundable",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  getRefundable
);

// Cancel a sale
router.post(
  "/:organizationId/:saleId/cancel",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  validate(cancelSaleSchema),
  cancelSale
);

// Pre-approval correction (Art. 12): replace an unfiscalized sale with a
// corrected one. Blocked once VSDC has confirmed (use refund instead).
router.post(
  "/:organizationId/:saleId/correct",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  validate(correctSaleSchema),
  correctSale
);

// Queue an 80mm receipt print on a logged-in POS device for this branch.
router.post(
  "/:organizationId/:saleId/pos-print",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  enqueuePosPrintJob
);

// POS app: claim the next pending remote print job (atomic).
router.post(
  "/:organizationId/pos-print-jobs/claim-next",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  claimNextPosPrintJob
);

// POS app: mark a claimed job PRINTED or FAILED.
router.post(
  "/:organizationId/pos-print-jobs/:jobId/complete",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  completePosPrintJob
);

// Reprint a sale receipt (increments reprintCount, returns isCopy=true)
router.post(
  "/:organizationId/:saleId/reprint",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  reprintSaleReceipt
);

// CS/CR — print a copy of an existing NS/NR receipt (PDF). Accepts
// ?format=A4|A5|80mm. Never submits to VSDC, so no vsdcOnlineGuard.
router.post(
  "/:organizationId/:saleId/copy",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  printReceiptCopy
);

// Regenerate invoice (new invoice number, preserves history)
router.post(
  "/:organizationId/:saleId/regenerate-invoice",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  regenerateInvoice
);

// E3: Get EBM/SDC fiscal data for a sale (polls after outbox worker runs)
router.get(
  "/:organizationId/:saleId/ebm-receipt",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  getEbmReceipt
);

// Authoritative backend-generated invoice PDF. Accepts ?format=A4|80mm (default A4).
router.get(
  "/:organizationId/invoices/:saleId/pdf",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  getInvoicePdf
);

// Composed invoice data for status/metadata and non-authoritative UI details.
router.get(
  "/:organizationId/invoices/:saleId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "SELLER", "ACCOUNTANT", "BRANCH_MANAGER"),
  getInvoice
);

export default router;

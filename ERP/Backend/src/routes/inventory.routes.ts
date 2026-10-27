import { Router } from "express";
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  updateProductImage,
  deleteProduct,
  createProducts,
  getExpiringProducts,
  getExpiredProducts,
  getLowStockProducts,
  adjustStock,
  markAsDamage,
  processExpiredStock,
  getTaxCodes,
} from "../controllers/inventory.controller";
import {
  addStockToInventory,
  removeStockFromInventory,
  adjustInventoryStock,
  getInventoryLedger,
  getInventorySummaryReport,
  getCurrentStockLevel,
  getProductInventoryHistory,
  recalculateStock,
} from "../controllers/inventory-ledger.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { branchAuth } from "../middleware/branchAuth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { requireActiveSubscription } from '../middleware/feature-access.middleware';
import { validate } from "../middleware/validate.middleware";
import { createProductSchema, updateProductSchema } from "../validations/products.validation";

const router = Router();

const orgAccess = requireOrganizationAccess();

router.get("/tax-codes", getTaxCodes);
router.get("/products/:organizationId", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getProducts);
router.get("/products/:organizationId/expiring", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getExpiringProducts);
router.get("/products/:organizationId/expired", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getExpiredProducts);
router.get("/products/:organizationId/low-stock", authenticate, orgAccess, requireActiveSubscription(), branchAuth, getLowStockProducts);
router.get("/:id", authenticate, getProductById);
router.post(
  "/:organizationId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  validate(createProductSchema),
  createProduct
);
router.post(
  "/:organizationId/products",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  createProducts
);
router.put(
  "/:organizationId/product/:id",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  validate(updateProductSchema),
  updateProduct
);

router.put(
  "/:organizationId/product/:id/image",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  updateProductImage
);
router.delete(
  "/:organizationId/product/:id",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  deleteProduct
);

router.post(
  "/:organizationId/product/:id/adjust",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  adjustStock
);

router.post(
  "/:organizationId/product/:id/damage",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  markAsDamage
);

router.post(
  "/:organizationId/product/:id/process-expired",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  processExpiredStock
);

// Inventory Ledger Routes - Append-only ledger for complete inventory history
router.post(
  "/:organizationId/ledger/in",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  addStockToInventory
);

router.post(
  "/:organizationId/ledger/out",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  removeStockFromInventory
);

router.post(
  "/:organizationId/ledger/adjustment",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"),
  adjustInventoryStock
);

router.get(
  "/:organizationId/ledger",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  getInventoryLedger
);

router.get(
  "/:organizationId/ledger/summary",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  getInventorySummaryReport
);

router.get(
  "/:organizationId/ledger/current-stock/:productId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  getCurrentStockLevel
);

router.get(
  "/:organizationId/ledger/history/:productId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  getProductInventoryHistory
);

router.post(
  "/:organizationId/ledger/recalculate/:productId",
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"),
  recalculateStock
);

export default router;

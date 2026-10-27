"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const report_controller_1 = require("../controllers/report.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
router.get("/sales/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getSalesReport);
router.get("/inventory/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getInventoryReport);
router.get("/debtors/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getDebtorsReport);
router.get("/debt-payments/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getDebtPaymentsReport);
router.get("/cash-flow/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getCashFlowReport);
router.get("/stock/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getStockReport);
router.get("/stock-history/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getStockHistory);
router.get("/profit/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getProfitReportController);
router.get("/export/:reportType/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.exportReport);
// C9: X/Z daily fiscal reports (RRA CIS/VSDC spec §6 / Articles 7, 18, 19)
router.get("/daily/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getDailyReport);
router.get("/daily/:organizationId/pdf", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getDailyReportPdf);
// C10: PLU (Price Look-Up) report (RRA CIS/VSDC spec §21)
router.get("/plu/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getPluReport);
router.get("/plu/:organizationId/pdf", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "SELLER", "BRANCH_MANAGER"), report_controller_1.getPluReportPdf);
// CIS Electronic Journal (RRA CIS/VSDC spec §5 / checklist §44)
router.get("/electronic-journal/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getElectronicJournal);
router.get("/electronic-journal/:organizationId/:saleId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getElectronicJournalEntry);
// Detailed purchases report (RRA checklist §25)
router.get("/purchases/:organizationId", auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)("ADMIN", "ACCOUNTANT", "BRANCH_MANAGER"), report_controller_1.getPurchasesReport);
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const debtPayment_controller_1 = require("../controllers/debtPayment.controller");
const payDebtRouter = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// Record a new debt payment
payDebtRouter.post('/:saleId/:organizationId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, debtPayment_controller_1.recordDebtPayment);
// Get payment history for a sale
payDebtRouter.get('/sale/:saleId/:organizationId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, debtPayment_controller_1.getSalePayments);
// Get payment history for a customer
payDebtRouter.get('/customer/:customerId/:organizationId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, debtPayment_controller_1.getCustomerDebtPayments);
// Get all outstanding debts
payDebtRouter.get('/outstanding/:organizationId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, debtPayment_controller_1.getOutstandingDebts);
payDebtRouter.get('/all/:organizationId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, debtPayment_controller_1.getAllPaymentHistory);
exports.default = payDebtRouter;

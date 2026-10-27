"use strict";
// src/routes/subscription.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const subscription_controller_1 = require("../controllers/subscription.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const paypack_controller_1 = require("../controllers/paypack.controller");
const pesapalIntergration_controller_1 = require("../controllers/pesapalIntergration.controller");
const susbscriptionRoutes = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
susbscriptionRoutes.get('/plans', subscription_controller_1.getPlans);
// Paypack payment initiation
susbscriptionRoutes.post('/organizations/paypack/initiate', auth_middleware_1.authenticate, paypack_controller_1.initiatePaypackPayment);
// Organization-specific routes
susbscriptionRoutes.post('/organizations/:organizationId/checkout', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.createCheckout);
susbscriptionRoutes.get('/organizations/:organizationId/verify', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.verifyPayment);
susbscriptionRoutes.get('/organizations/:organizationId/subscriptions', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.getUserSubscriptions);
susbscriptionRoutes.get('/organizations/:organizationId/subscriptions/:id', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.getSubscriptionById);
susbscriptionRoutes.post('/organizations/:organizationId/subscriptions/:id/cancel', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.cancelSubscription);
susbscriptionRoutes.post('/organizations/:organizationId/subscriptions/:id/reactivate', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.reactivateSubscription);
susbscriptionRoutes.post('/organizations/:organizationId/subscriptions/:id/renew', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.renewSubscription);
susbscriptionRoutes.patch('/organizations/:organizationId/subscriptions/:id/auto-renew', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.updateAutoRenew);
susbscriptionRoutes.get('/organizations/:organizationId/stats', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.getSubscriptionStats);
susbscriptionRoutes.get('/organizations/:organizationId/payments', auth_middleware_1.authenticate, (0, auth_middleware_1.restrictRoles)('SELLER'), orgAccess, subscription_controller_1.getPaymentHistory);
susbscriptionRoutes.post('/organizations/:organizationId/plans/:planId/paypack/initiate', auth_middleware_1.authenticate, orgAccess, paypack_controller_1.initiatePaypackPayment);
susbscriptionRoutes.post('/organizations/:organizationId/plans/:planId/pesapal/initiate', auth_middleware_1.authenticate, orgAccess, pesapalIntergration_controller_1.initiatePesapalPayment);
exports.default = susbscriptionRoutes;

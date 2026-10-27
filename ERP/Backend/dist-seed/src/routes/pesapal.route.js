"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/pesapal.route.ts
const express_1 = __importDefault(require("express"));
const pesapalIntergration_controller_1 = require("../controllers/pesapalIntergration.controller");
const pesapal_webhook_controller_1 = require("../controllers/pesapal-webhook.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const pesapalRoutes = (0, express_1.default)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// Webhook endpoints (no authentication needed for webhooks from Pesapal)
pesapalRoutes.post('/ipn', pesapalIntergration_controller_1.pesapalIpnController);
pesapalRoutes.post('/callback', pesapal_webhook_controller_1.handlePesapalWebhook); // Support both GET and POST
pesapalRoutes.get('/organizations/:organizationId/plans/:planId/transaction-status/:orderTrackingId', auth_middleware_1.authenticate, orgAccess, pesapalIntergration_controller_1.checkTransactionStatus);
// Protected endpoints
pesapalRoutes.post('/order-request', auth_middleware_1.authenticate, pesapalIntergration_controller_1.pesapalOrderRequest);
pesapalRoutes.post('/refund', auth_middleware_1.authenticate, pesapalIntergration_controller_1.requestRefund);
pesapalRoutes.post('/cancel/:orderTrackingId', auth_middleware_1.authenticate, pesapalIntergration_controller_1.cancelOrder);
exports.default = pesapalRoutes;

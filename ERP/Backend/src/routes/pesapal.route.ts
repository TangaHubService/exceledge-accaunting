// src/routes/pesapal.route.ts
import Router from 'express';
import {
    pesapalIpnController,
    pesapalOrderRequest,
    requestRefund,
    cancelOrder,
    checkTransactionStatus
} from '../controllers/pesapalIntergration.controller';
import { handlePesapalWebhook } from '../controllers/pesapal-webhook.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';

const pesapalRoutes = Router();

const orgAccess = requireOrganizationAccess();

// Webhook endpoints (no authentication needed for webhooks from Pesapal)
pesapalRoutes.post('/ipn', pesapalIpnController);
pesapalRoutes.post('/callback', handlePesapalWebhook); // Support both GET and POST
pesapalRoutes.get(
  '/organizations/:organizationId/plans/:planId/transaction-status/:orderTrackingId',
  authenticate,
  orgAccess,
  checkTransactionStatus
);

// Protected endpoints
pesapalRoutes.post('/order-request', authenticate, pesapalOrderRequest);
pesapalRoutes.post('/refund', authenticate, requestRefund);
pesapalRoutes.post('/cancel/:orderTrackingId', authenticate, cancelOrder);

export default pesapalRoutes;
// src/routes/subscription.routes.ts

import { Router } from 'express';
import {
    getPlans,
    createCheckout,
    verifyPayment,
    getUserSubscriptions,
    getSubscriptionById,
    cancelSubscription,
    reactivateSubscription,
    renewSubscription,
    getSubscriptionStats,
    getPaymentHistory,
    updateAutoRenew,
} from '../controllers/subscription.controller';
import { authenticate, restrictRoles } from '../middleware/auth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import { initiatePaypackPayment } from '../controllers/paypack.controller';
import { initiatePesapalPayment } from '../controllers/pesapalIntergration.controller';

const susbscriptionRoutes = Router();
const orgAccess = requireOrganizationAccess();

susbscriptionRoutes.get('/plans', getPlans);

// Paypack payment initiation
susbscriptionRoutes.post(
    '/organizations/paypack/initiate',
    authenticate,
    initiatePaypackPayment
);


// Organization-specific routes
susbscriptionRoutes.post(
    '/organizations/:organizationId/checkout',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    createCheckout
);

susbscriptionRoutes.get(
    '/organizations/:organizationId/verify',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    verifyPayment
);

susbscriptionRoutes.get(
    '/organizations/:organizationId/subscriptions',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    getUserSubscriptions
);

susbscriptionRoutes.get(
    '/organizations/:organizationId/subscriptions/:id',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    getSubscriptionById
);

susbscriptionRoutes.post(
    '/organizations/:organizationId/subscriptions/:id/cancel',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    cancelSubscription
);

susbscriptionRoutes.post(
    '/organizations/:organizationId/subscriptions/:id/reactivate',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    reactivateSubscription
);

susbscriptionRoutes.post(
    '/organizations/:organizationId/subscriptions/:id/renew',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    renewSubscription
);

susbscriptionRoutes.patch(
    '/organizations/:organizationId/subscriptions/:id/auto-renew',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    updateAutoRenew
);

susbscriptionRoutes.get(
    '/organizations/:organizationId/stats',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    getSubscriptionStats
);

susbscriptionRoutes.get(
    '/organizations/:organizationId/payments',
    authenticate,
    restrictRoles('SELLER'),
    orgAccess,
    getPaymentHistory
);
susbscriptionRoutes.post(
    '/organizations/:organizationId/plans/:planId/paypack/initiate',
    authenticate,
    orgAccess,
    initiatePaypackPayment
);

susbscriptionRoutes.post(
    '/organizations/:organizationId/plans/:planId/pesapal/initiate',
    authenticate,
    orgAccess,
    initiatePesapalPayment
);

export default susbscriptionRoutes;
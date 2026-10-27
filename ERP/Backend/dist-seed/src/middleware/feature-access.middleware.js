"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFeature = exports.requireActiveSubscription = void 0;
const subscription_service_1 = require("../services/subscription.service");
const prisma_1 = require("../lib/prisma");
/**
 * Blocks the request unless the organization has a subscription whose status
 * is ACTIVE, TRIALING, or GRACE_PERIOD. SYSTEM_OWNER bypasses, same as
 * requireOrganizationAccess. `status` is the single source of truth for
 * access here (not endDate) — the hourly status-transition job in
 * subscription.job.ts is what keeps ACTIVE -> GRACE_PERIOD -> EXPIRED honest,
 * so a GRACE_PERIOD row (whose endDate has already passed) still grants
 * access for its configured grace window. Apply this on operational
 * (paid-feature) routes — never on auth, organization-creation,
 * subscription-management, or system-owner routes, or an org with a lapsed
 * subscription could never renew.
 */
const requireActiveSubscription = () => {
    return async (req, res, next) => {
        try {
            const jwtRole = String(req.user?.role ?? '');
            if (jwtRole === 'SYSTEM_OWNER') {
                return next();
            }
            const organizationId = Number(req.params.organizationId);
            if (!organizationId || Number.isNaN(organizationId)) {
                return res.status(400).json({ error: 'Organization ID is required' });
            }
            const subscription = await prisma_1.prisma.subscription.findFirst({
                where: {
                    organizationId,
                    status: { in: ['ACTIVE', 'TRIALING', 'GRACE_PERIOD'] },
                },
                select: { id: true },
            });
            if (!subscription) {
                return res.status(403).json({
                    error: 'Your subscription has expired. Please renew your subscription to continue using the system.',
                    code: 'SUBSCRIPTION_INACTIVE',
                });
            }
            next();
        }
        catch (error) {
            console.error('Error checking subscription status:', error);
            res.status(500).json({ error: 'Failed to verify subscription status' });
        }
    };
};
exports.requireActiveSubscription = requireActiveSubscription;
const requireFeature = (featureKey) => {
    const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
    return async (req, res, next) => {
        try {
            const { organizationId } = req.params;
            if (!organizationId) {
                return res.status(400).json({ error: 'Organization ID is required' });
            }
            const hasAccess = await subscriptionService.hasFeatureAccess(Number(organizationId), featureKey);
            if (!hasAccess) {
                return res.status(403).json({
                    error: `Access denied. This feature requires a subscription that includes ${featureKey}`
                });
            }
            next();
        }
        catch (error) {
            console.error('Error checking feature access:', error);
            res.status(500).json({ error: 'Failed to verify feature access' });
        }
    };
};
exports.requireFeature = requireFeature;

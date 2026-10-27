"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionStatusTransitionJob = exports.subscriptionReminderJob = void 0;
exports.runImmediateSubscriptionTransition = runImmediateSubscriptionTransition;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("../lib/prisma");
const email_service_1 = require("../services/email.service");
const subscription_service_1 = require("../services/subscription.service");
const config_1 = require("../config");
const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
exports.subscriptionReminderJob = node_cron_1.default.schedule("0 9 * * *", async () => {
    console.log("Running subscription reminder job...");
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const expiringSubscriptions = await prisma_1.prisma.subscription.findMany({
        where: {
            status: "ACTIVE",
            endDate: {
                lte: sevenDaysFromNow,
                gt: new Date(),
            },
        },
        include: {
            organization: {
                include: {
                    userOrganizations: {
                        where: { isOwner: true },
                        include: { user: true },
                    },
                },
            },
        },
    });
    let sent = 0;
    for (const subscription of expiringSubscriptions) {
        // Reuse the same warning-level computation the API/frontend use, so the
        // 7-day/3-day thresholds can never drift out of sync with what's shown
        // in the UI.
        const summary = subscriptionService.computeSubscriptionSummary(subscription);
        if (summary.warningLevel !== "yellow" && summary.warningLevel !== "orange")
            continue;
        const owner = subscription.organization.userOrganizations[0]?.user;
        if (owner && summary.daysUntilExpiry !== null) {
            await email_service_1.emailService.sendSubscriptionReminder(owner.email, subscription.organization.name, summary.daysUntilExpiry);
            sent++;
        }
    }
    console.log(`Sent ${sent} subscription reminders`);
});
/**
 * Run one round of subscription status transitions
 * (ACTIVE/TRIALING -> GRACE_PERIOD -> EXPIRED) and deactivate orgs with no
 * remaining valid subscription.
 *
 * Exported so it can be called both from the hourly cron AND at server boot.
 */
async function runImmediateSubscriptionTransition() {
    const now = new Date();
    // ACTIVE / TRIALING -> GRACE_PERIOD
    const enteringGrace = await prisma_1.prisma.subscription.findMany({
        where: { status: { in: ["ACTIVE", "TRIALING"] }, endDate: { lte: now } },
        include: {
            organization: {
                include: { userOrganizations: { where: { isOwner: true }, include: { user: true } } },
            },
        },
    });
    for (const subscription of enteringGrace) {
        const gracePeriodDays = subscription.gracePeriodDays || config_1.config.subscription.gracePeriodDays;
        // gracePeriodEndsAt is normally already set at purchase time, but fall
        // back to computing it here for older rows (e.g. trial subscriptions)
        // that predate this column being populated.
        const gracePeriodEndsAt = subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt.getTime() > (subscription.endDate ?? now).getTime()
            ? subscription.gracePeriodEndsAt
            : (() => {
                const d = new Date(subscription.endDate ?? now);
                d.setDate(d.getDate() + gracePeriodDays);
                return d;
            })();
        await prisma_1.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "GRACE_PERIOD", gracePeriodEndsAt },
        });
        const owner = subscription.organization.userOrganizations[0]?.user;
        if (owner) {
            try {
                await email_service_1.emailService.sendSubscriptionStatusUpdate(owner.email, subscription.organization.name, "Your subscription has expired", `Your subscription for ${subscription.organization.name} has expired and you're now in a ${gracePeriodDays}-day grace period. Please renew soon to avoid losing access.`);
            }
            catch (err) {
                console.error("Failed to send grace-period email:", err);
            }
        }
    }
    if (enteringGrace.length) {
        console.log(`Moved ${enteringGrace.length} subscription(s) into GRACE_PERIOD`);
    }
    // GRACE_PERIOD -> EXPIRED (+ deactivate the org, but only if it has no
    // other still-valid subscription — a latent bug in the old daily job
    // deactivated unconditionally, which would be wrong for a multi-subscription org).
    const expiring = await prisma_1.prisma.subscription.findMany({
        where: { status: "GRACE_PERIOD", gracePeriodEndsAt: { lte: now } },
        include: {
            organization: {
                include: { userOrganizations: { where: { isOwner: true }, include: { user: true } } },
            },
        },
    });
    for (const subscription of expiring) {
        await prisma_1.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "EXPIRED" },
        });
        const otherValidSubscription = await prisma_1.prisma.subscription.findFirst({
            where: {
                organizationId: subscription.organizationId,
                id: { not: subscription.id },
                status: { in: ["ACTIVE", "TRIALING", "GRACE_PERIOD"] },
            },
            select: { id: true },
        });
        if (!otherValidSubscription) {
            await prisma_1.prisma.organization.update({
                where: { id: subscription.organizationId },
                data: { isActive: false },
            });
        }
        const owner = subscription.organization.userOrganizations[0]?.user;
        if (owner) {
            try {
                await email_service_1.emailService.sendSubscriptionStatusUpdate(owner.email, subscription.organization.name, "Your subscription has expired", "Your subscription has expired. Please renew your subscription to continue using the system.");
            }
            catch (err) {
                console.error("Failed to send expiry email:", err);
            }
        }
    }
    if (expiring.length) {
        console.log(`Expired ${expiring.length} subscription(s)`);
    }
}
/**
 * Hourly status-transition job — delegates to runImmediateSubscriptionTransition.
 * requireActiveSubscription and every other consumer trust `status` alone (not
 * endDate), so this job is what keeps that status honest.
 */
exports.subscriptionStatusTransitionJob = node_cron_1.default.schedule("0 * * * *", runImmediateSubscriptionTransition);

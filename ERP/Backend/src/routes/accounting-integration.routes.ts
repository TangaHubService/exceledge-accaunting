import { createHash, timingSafeEqual } from "crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { requireOrganizationAccess } from "../middleware/organizationAccess.middleware";
import { enqueueInventoryOpeningSnapshot, isAccountingIntegrationEnabled } from "../services/accounting-outbox.service";
import { emailService } from "../services/email.service";

const router = Router();

const INTEGRATION_KEY = process.env.ACCOUNTING_INTEGRATION_API_KEY || "dev-integration-key";
const DEFAULT_EMAIL_ROLES = ["SYSTEM_OWNER", "ADMIN", "ACCOUNTANT"] as const;
const MAX_RECIPIENTS = 50;

function validIntegrationKey(presented: unknown) {
  if (typeof presented !== "string" || !presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(INTEGRATION_KEY).digest();
  return timingSafeEqual(a, b);
}

/**
 * Emails an Accounting notification to the organization's members: the targeted user, or members
 * with the targeted role, or owners, admins and accountants. Called by the Accounting server.
 */
router.post("/notifications/email", async (req, res) => {
  if (!validIntegrationKey(req.header("x-integration-key"))) {
    return res.status(401).json({ success: false, error: "Invalid integration key" });
  }
  const { organizationId, title, body, severity, targetRole, targetErpUserId, link } = req.body ?? {};
  const orgId = Number(organizationId);
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return res.status(400).json({ success: false, error: "Invalid organization" });
  if (typeof title !== "string" || !title.trim() || typeof body !== "string") {
    return res.status(400).json({ success: false, error: "title and body are required" });
  }
  try {
    const organization = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    if (!organization) return res.status(404).json({ success: false, error: "Organization not found" });
    const roles = typeof targetRole === "string" && targetRole ? [targetRole.toUpperCase()] : [...DEFAULT_EMAIL_ROLES];
    const members = await prisma.userOrganization.findMany({
      where: {
        organizationId: orgId,
        ...(Number.isSafeInteger(targetErpUserId) ? { userId: targetErpUserId } : { role: { in: roles as never[] } }),
        user: { isActive: true, deletedAt: null, disabledAt: null },
      },
      select: { user: { select: { email: true, name: true } } },
      take: MAX_RECIPIENTS,
    });
    const recipients = [...new Map(members.map((m) => [m.user.email.toLowerCase(), m.user])).values()];
    const safeLink = typeof link === "string" && /^https?:\/\//i.test(link) ? link : undefined;
    for (const user of recipients) {
      await emailService.sendAccountingNotification(user.email, user.name, organization.name, {
        title: title.slice(0, 200),
        body: body.slice(0, 4000),
        severity: typeof severity === "string" ? severity : "INFO",
        link: safeLink,
      });
    }
    return res.json({ success: true, data: { recipients: recipients.length } });
  } catch (e) {
    return res.status(502).json({ success: false, error: (e as Error).message });
  }
});

router.use(authenticate);

/** Queues current stock by branch as Accounting's opening inventory (requested from the Accounting app). */
router.post(
  "/:organizationId/inventory-opening",
  requireOrganizationAccess(),
  authorize("SYSTEM_OWNER", "ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    if (!isAccountingIntegrationEnabled()) {
      return res.status(409).json({ success: false, error: "Accounting integration is turned off for this Excel Edge server" });
    }
    const organizationId = Number(req.params.organizationId);
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid organization" });
    }
    try {
      const data = await enqueueInventoryOpeningSnapshot(organizationId);
      return res.status(202).json({ success: true, data });
    } catch (e) {
      return res.status(500).json({ success: false, error: (e as Error).message });
    }
  },
);

export default router;

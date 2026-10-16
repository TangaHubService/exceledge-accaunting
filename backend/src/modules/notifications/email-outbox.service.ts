import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

export const MAX_EMAIL_ATTEMPTS = 6;
const TIMEOUT_MS = 15_000;

/** Where in the web app a notification about `entityType` is handled. */
const ENTITY_PATHS: Record<string, string> = {
  IntegrationEvent: "/exceptions",
  ArInvoice: "/invoices",
  ApBill: "/bills",
  AccountingPeriod: "/close",
  AnomalyFlag: "/assurance",
  ApprovalRequest: "/approvals",
  Journal: "/journals",
};

export type EmailRequest = {
  organizationId: string;
  title: string;
  body: string;
  severity: string;
  targetRole: string | null;
  targetErpUserId: number | null;
  link: string;
};

export type EmailSender = (request: EmailRequest) => Promise<{ recipients: number }>;

/** Posts to the ERP, which resolves the recipients and sends through its mailer. */
export const sendThroughErp: EmailSender = async (request) => {
  const response = await fetch(`${env.erpApiUrl}/accounting-integration/notifications/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-integration-key": env.integrationApiKey },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { success?: boolean; data?: { recipients?: number }; error?: string } | null;
  if (!response.ok || !body?.success) throw new Error(body?.error ?? `The ERP answered ${response.status}`);
  return { recipients: Number(body.data?.recipients ?? 0) };
};

const retryDelayMinutes = (attempts: number) => Math.min(2 ** attempts, 360);

/** Sends due emails from the outbox; each row is claimed first so a slow send is not repeated. */
export async function deliverDueEmails(now = new Date(), send: EmailSender = sendThroughErp, limit = 50) {
  const due = await prisma.notificationEmail.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    include: { notification: true, company: { select: { externalErpOrganizationId: true } } },
  });
  const summary = { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  for (const row of due) {
    const claimed = await prisma.notificationEmail.updateMany({
      where: { id: row.id, status: "PENDING", nextAttemptAt: row.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
    });
    if (!claimed.count) continue;
    summary.attempted += 1;
    const n = row.notification;
    const path = (n.entityType && ENTITY_PATHS[n.entityType]) || "/notifications";
    const attempts = row.attempts + 1;
    try {
      if (!row.company.externalErpOrganizationId) throw new Error("The company is not linked to an ERP organization");
      const { recipients } = await send({
        organizationId: row.company.externalErpOrganizationId,
        title: n.title,
        body: n.body,
        severity: n.severity,
        targetRole: n.targetRole,
        targetErpUserId: n.targetErpUserId,
        link: `${env.webAppUrl}${path}`,
      });
      await prisma.notificationEmail.update({
        where: { id: row.id },
        data: { attempts, recipientCount: recipients, lastError: null, status: recipients ? "SENT" : "SKIPPED", sentAt: recipients ? now : null },
      });
      if (recipients) summary.sent += 1;
      else summary.skipped += 1;
    } catch (e) {
      const failed = attempts >= MAX_EMAIL_ATTEMPTS;
      await prisma.notificationEmail.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: (e as Error).message.slice(0, 500),
          status: failed ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(attempts) * 60_000),
        },
      });
      if (failed) summary.failed += 1;
    }
  }
  return summary;
}

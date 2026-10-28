import type { NoticeSeverity, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

export type Reader = { erpUserId?: number; erpRole?: string };

export async function notify(input: {
  companyId: string;
  title: string;
  body: string;
  severity?: NoticeSeverity;
  targetRole?: string | null;
  targetErpUserId?: number | null;
  entityType?: string;
  entityId?: string;
}) {
  const severity = input.severity ?? "INFO";
  const settings = await prisma.notificationSettings.findUnique({ where: { companyId: input.companyId } });
  const email = !!settings?.emailEnabled && SEVERITY_RANK[severity] >= SEVERITY_RANK[settings.emailMinSeverity];
  return prisma.notification.create({
    data: {
      companyId: input.companyId,
      title: input.title,
      body: input.body,
      severity,
      targetRole: input.targetRole?.toUpperCase() ?? null,
      targetErpUserId: input.targetErpUserId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(email ? { email: { create: { companyId: input.companyId } } } : {}),
    },
  });
}

const SEVERITY_RANK: Record<NoticeSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

export async function getNotificationSettings(companyId: string) {
  const row = await prisma.notificationSettings.findUnique({ where: { companyId } });
  const [pending, failed, sent] = await Promise.all(
    ["PENDING", "FAILED", "SENT"].map((status) => prisma.notificationEmail.count({ where: { companyId, status } })),
  );
  return { emailEnabled: row?.emailEnabled ?? false, emailMinSeverity: row?.emailMinSeverity ?? "WARNING", outbox: { pending, failed, sent } };
}

export async function saveNotificationSettings(companyId: string, input: { emailEnabled: boolean; emailMinSeverity: NoticeSeverity }, actor: Reader) {
  const before = await prisma.notificationSettings.findUnique({ where: { companyId } });
  await prisma.notificationSettings.upsert({ where: { companyId }, create: { companyId, ...input }, update: input });
  if (actor.erpUserId) {
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId,
      erpRole: actor.erpRole,
      action: before ? "UPDATE" : "CREATE",
      entityType: "NotificationSettings",
      entityId: companyId,
      afterJson: input,
      beforeJson: before ? { emailEnabled: before.emailEnabled, emailMinSeverity: before.emailMinSeverity } : undefined,
    });
  }
  return getNotificationSettings(companyId);
}

/** Notifications addressed to everyone, to the reader's role, or to the reader. */
function visibleTo(companyId: string, reader: Reader): Prisma.NotificationWhereInput {
  const role = reader.erpRole?.toUpperCase();
  return {
    companyId,
    AND: [
      { OR: [{ targetRole: null }, ...(role ? [{ targetRole: role }] : [])] },
      { OR: [{ targetErpUserId: null }, ...(reader.erpUserId ? [{ targetErpUserId: reader.erpUserId }] : [])] },
    ],
  };
}

export async function listNotifications(companyId: string, reader: Reader) {
  const rows = await prisma.notification.findMany({
    where: visibleTo(companyId, reader),
    include: { reads: { where: { erpUserId: reader.erpUserId ?? -1 } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(({ reads, readAt: _legacy, ...n }) => ({ ...n, read: reads.length > 0, readAt: reads[0]?.readAt ?? null }));
}

export async function unreadCount(companyId: string, reader: Reader) {
  const count = await prisma.notification.count({
    where: { ...visibleTo(companyId, reader), reads: { none: { erpUserId: reader.erpUserId ?? -1 } } },
  });
  return { count };
}

export async function markNotificationRead(companyId: string, id: string, reader: Reader) {
  if (!reader.erpUserId) throw new Error("A signed-in user is required");
  const row = await prisma.notification.findFirst({ where: { id, ...visibleTo(companyId, reader) } });
  if (!row) throw new Error("Notification not found");
  const read = await prisma.notificationRead.upsert({
    where: { notificationId_erpUserId: { notificationId: id, erpUserId: reader.erpUserId } },
    create: { notificationId: id, erpUserId: reader.erpUserId },
    update: {},
  });
  return { ...row, read: true, readAt: read.readAt };
}

export async function markAllRead(companyId: string, reader: Reader) {
  if (!reader.erpUserId) throw new Error("A signed-in user is required");
  const unread = await prisma.notification.findMany({
    where: { ...visibleTo(companyId, reader), reads: { none: { erpUserId: reader.erpUserId } } },
    select: { id: true },
  });
  await prisma.notificationRead.createMany({
    data: unread.map((n) => ({ notificationId: n.id, erpUserId: reader.erpUserId! })),
    skipDuplicates: true,
  });
  return { marked: unread.length };
}

import { prisma } from "../../lib/prisma";

export async function writeAudit(input: {
  companyId?: string | null;
  erpUserId: number;
  erpRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  sectionKey?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.auditEvent.create({
    data: {
      companyId: input.companyId ?? undefined,
      erpUserId: input.erpUserId,
      erpRole: input.erpRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      sectionKey: input.sectionKey,
      beforeJson: input.beforeJson as object | undefined,
      afterJson: input.afterJson as object | undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}

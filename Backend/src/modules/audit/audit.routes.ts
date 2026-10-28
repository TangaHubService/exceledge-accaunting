import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  AuthedRequest,
  authenticateErpJwt,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { csvCell } from "../../lib/report-export";

export const auditRouter = Router();

auditRouter.use(authenticateErpJwt, requireCapability("audit:view"), resolveCompany);

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function filters(req: AuthedRequest): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = { companyId: req.companyId };
  const userId = Number(text(req.query.userId));
  if (Number.isInteger(userId) && userId > 0) where.erpUserId = userId;
  if (text(req.query.entityType)) where.entityType = text(req.query.entityType);
  if (text(req.query.entityId)) where.entityId = text(req.query.entityId);
  if (text(req.query.action)) where.action = text(req.query.action)!.toUpperCase();
  const from = text(req.query.from);
  const to = text(req.query.to);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(`${from.slice(0, 10)}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`) } : {}),
    };
  }
  return where;
}

auditRouter.get("/", async (req: AuthedRequest, res) => {
  const take = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 500);
  const data = await prisma.auditEvent.findMany({ where: filters(req), orderBy: { createdAt: "desc" }, take });
  res.json({ success: true, data });
});

auditRouter.get("/export.csv", async (req: AuthedRequest, res) => {
  const rows = await prisma.auditEvent.findMany({ where: filters(req), orderBy: { createdAt: "desc" }, take: 50_000 });
  const header = ["createdAt", "erpUserId", "erpRole", "action", "entityType", "entityId", "sectionKey", "ipAddress", "beforeJson", "afterJson"] as const;
  const lines = [header.join(",")];
  for (const row of rows) lines.push(header.map((k) => csvCell(row[k])).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join("\n"));
});

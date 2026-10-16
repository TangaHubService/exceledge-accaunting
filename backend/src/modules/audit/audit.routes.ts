import { Router } from "express";
import {
  AuthedRequest,
  authenticateErpJwt,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import { prisma } from "../../lib/prisma";

export const auditRouter = Router();

auditRouter.use(authenticateErpJwt, requireCapability("audit:view"), resolveCompany);

auditRouter.get("/", async (req: AuthedRequest, res) => {
  const take = Math.min(Number(req.query.limit ?? 50), 200);
  const data = await prisma.auditEvent.findMany({
    where: { companyId: req.companyId },
    orderBy: { createdAt: "desc" },
    take,
  });
  res.json({ success: true, data });
});

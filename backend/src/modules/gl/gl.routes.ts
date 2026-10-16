import { Router } from "express";
import {
  AuthedRequest,
  authenticateErpJwt,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import * as gl from "./gl.service";

export const glRouter = Router();
glRouter.use(authenticateErpJwt, requireCapability("gl:view"), resolveCompany);

glRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const data = await gl.getGlDashboard(req.companyId!);
  res.json({ success: true, data });
});

glRouter.get("/accounts/:accountId", async (req: AuthedRequest, res) => {
  try {
    const data = await gl.getAccountLedger(req.companyId!, req.params.accountId, {
      from: typeof req.query.from === "string" ? new Date(req.query.from) : undefined,
      to: typeof req.query.to === "string" ? new Date(req.query.to) : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

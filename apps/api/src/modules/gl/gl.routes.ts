import { Router } from "express";
import {
  AuthedRequest,
  authenticate,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import { exportFormat, queryDay, queryDims, sendReport } from "../../lib/report-export";
import { ledgerDocument } from "../books/report-documents";
import * as gl from "./gl.service";

export const glRouter = Router();
glRouter.use(authenticate, requireCapability("gl:view"), resolveCompany);

glRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const data = await gl.getGlDashboard(req.companyId!);
  res.json({ success: true, data });
});

glRouter.get("/accounts/:accountId", async (req: AuthedRequest, res) => {
  try {
    const format = exportFormat(req.query.format);
    const page = Number(req.query.page) || undefined;
    const pageSize = Number(req.query.pageSize) || undefined;
    const data = await gl.getAccountLedger(req.companyId!, req.params.accountId, {
      from: queryDay(req.query.from, "start", "from"),
      to: queryDay(req.query.to, "end", "to"),
      dims: queryDims(req.query),
      ...(format ? {} : { page, pageSize }),
    });
    if (format) return await sendReport(res, await ledgerDocument(req.companyId!, data), format);
    res.json({ success: true, data });
  } catch (e) {
    res.status((e as Error).message === "Account not found" ? 404 : 400).json({ success: false, error: (e as Error).message });
  }
});

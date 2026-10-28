import { Router } from "express";
import { z } from "zod";
import {
  AuthedRequest,
  authenticateErpJwt,
  getRequestMeta,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import * as coa from "./coa.service";

export const coaRouter = Router();

coaRouter.use(authenticateErpJwt, requireCapability("coa:view"), resolveCompany);

function actor(req: AuthedRequest) {
  return {
    erpUserId: req.erpUser!.userId,
    erpRole: req.organizationRole ?? req.erpUser!.role,
    meta: getRequestMeta(req),
  };
}

const accountTypeEnum = z.enum([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "COST_OF_SALES",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
]);

coaRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const data = await coa.getCoaDashboard(req.companyId!);
  res.json({ success: true, data });
});

coaRouter.get("/", async (req: AuthedRequest, res) => {
  const data = await coa.listAccounts(req.companyId!, {
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    type: typeof req.query.type === "string" ? (req.query.type as never) : undefined,
    isActive:
      req.query.isActive === undefined ? undefined : String(req.query.isActive) === "true",
    parentId:
      req.query.parentId === "null"
        ? null
        : typeof req.query.parentId === "string"
          ? req.query.parentId
          : undefined,
    branchId: typeof req.query.branchId === "string" ? req.query.branchId : undefined,
    costCentre: typeof req.query.costCentre === "string" ? req.query.costCentre : undefined,
    currency: typeof req.query.currency === "string" ? req.query.currency : undefined,
    taxMapping: typeof req.query.taxMapping === "string" ? req.query.taxMapping : undefined,
  });
  res.json({ success: true, data });
});

coaRouter.get("/tree", async (req: AuthedRequest, res) => {
  const data = await coa.getAccountTree(req.companyId!);
  res.json({ success: true, data });
});

coaRouter.get("/import/template", requireCapability("coa:import"), async (_req, res) => {
  res.json({ success: true, data: coa.getImportTemplate() });
});

coaRouter.get("/export", requireCapability("coa:export"), async (req: AuthedRequest, res) => {
  const format = String(req.query.format ?? "json");
  const rows = await coa.exportAccounts(req.companyId!);
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="chart-of-accounts.csv"');
    return res.send(coa.toCsv(rows));
  }
  return res.json({ success: true, data: rows });
});

coaRouter.post("/", requireCapability("coa:create"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: accountTypeEnum,
        parentId: z.string().nullable().optional(),
        description: z.string().optional(),
        reportingGroup: z.string().optional(),
        currency: z.string().optional(),
        branchId: z.string().optional(),
        costCentre: z.string().optional(),
        taxMapping: z.string().optional(),
        openingBalance: z.number().optional(),
        allowManualPost: z.boolean().optional(),
        allowAutoPost: z.boolean().optional(),
        bankReconciliationRequired: z.boolean().optional(),
        isCashAccount: z.boolean().optional(),
        isTaxAccount: z.boolean().optional(),
        isInventoryAccount: z.boolean().optional(),
        requireApproval: z.boolean().optional(),
        allowNegativeBalance: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await coa.createAccount(req.companyId!, body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

coaRouter.patch("/:id", requireCapability("coa:edit"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        type: accountTypeEnum.optional(),
        parentId: z.string().nullable().optional(),
        description: z.string().optional(),
        reportingGroup: z.string().optional(),
        currency: z.string().optional(),
        branchId: z.string().optional(),
        costCentre: z.string().optional(),
        taxMapping: z.string().optional(),
        openingBalance: z.number().optional(),
        allowManualPost: z.boolean().optional(),
        allowAutoPost: z.boolean().optional(),
        bankReconciliationRequired: z.boolean().optional(),
        isCashAccount: z.boolean().optional(),
        isTaxAccount: z.boolean().optional(),
        isInventoryAccount: z.boolean().optional(),
        requireApproval: z.boolean().optional(),
        allowNegativeBalance: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await coa.updateAccount(req.companyId!, req.params.id, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

coaRouter.post("/:id/deactivate", requireCapability("coa:deactivate"), async (req: AuthedRequest, res) => {
  try {
    const data = await coa.setAccountActive(req.companyId!, req.params.id, false, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

coaRouter.post("/:id/reactivate", requireCapability("coa:edit"), async (req: AuthedRequest, res) => {
  try {
    const data = await coa.setAccountActive(req.companyId!, req.params.id, true, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

coaRouter.delete("/:id", requireCapability("coa:deactivate"), async (req: AuthedRequest, res) => {
  try {
    const data = await coa.deleteAccount(req.companyId!, req.params.id, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

coaRouter.post("/import", requireCapability("coa:import"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ rows: z.array(z.record(z.any())).min(1) }).parse(req.body);
    const data = await coa.importAccounts(req.companyId!, body.rows, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

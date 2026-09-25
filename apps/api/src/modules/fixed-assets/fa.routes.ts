import { DEPRECIATION_METHODS, DISPOSAL_METHODS } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as fa from "./fa.service";

export const faRouter = Router();

faRouter.use(authenticateErpJwt, requireCapability("fa:view"), resolveCompany);

function actor(req: AuthedRequest) {
  return { erpUserId: req.erpUser!.userId, erpRole: req.organizationRole ?? req.erpUser?.role, meta: getRequestMeta(req) };
}

function fail(res: Response, e: unknown, status = 400) {
  const message = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") : (e as Error).message;
  res.status(status).json({ success: false, error: message });
}

type Handler = (req: AuthedRequest) => Promise<unknown>;
const handle = (fn: Handler, status = 200) => async (req: AuthedRequest, res: Response) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (e) {
    fail(res, e);
  }
};

const str = (q: unknown) => (typeof q === "string" && q.trim() ? q.trim() : undefined);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use a yyyy-mm-dd date");
const period = z.string().regex(/^\d{4}-\d{2}$/, "Use a yyyy-mm period");
const text = (max = 500) => z.string().trim().max(max).optional();
const money = z.number().positive().max(1e13);
const money0 = z.number().min(0).max(1e13);
const method = z.enum(DEPRECIATION_METHODS);
const disposal = z.enum(DISPOSAL_METHODS);

faRouter.get("/dashboard", handle((req) => fa.faDashboard(req.companyId!)));
faRouter.get("/reports/register", handle((req) => fa.registerReport(req.companyId!)));
faRouter.get("/reports/depreciation", handle((req) => fa.depreciationSchedule(req.companyId!, str(req.query.period))));

faRouter.get("/categories", handle((req) => fa.listCategories(req.companyId!, { includeInactive: req.query.all === "1" })));
faRouter.post(
  "/categories",
  requireCapability("fa:manage"),
  handle(async (req) => {
    const body = z
      .object({
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(120),
        usefulLifeMonths: z.number().int().min(0).max(1200),
        depreciationMethod: method,
        residualPercent: z.number().min(0).max(100).optional(),
        ratePercent: z.number().positive().max(100).optional(),
        assetAccountId: z.string().optional(),
        accumDepAccountId: z.string().optional(),
        depExpenseAccountId: z.string().optional(),
        notes: text(2000),
      })
      .parse(req.body);
    return fa.createCategory(req.companyId!, body, actor(req));
  }, 201),
);
faRouter.patch(
  "/categories/:id",
  requireCapability("fa:manage"),
  handle(async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        usefulLifeMonths: z.number().int().min(0).max(1200).optional(),
        depreciationMethod: method.optional(),
        residualPercent: z.number().min(0).max(100).optional(),
        ratePercent: z.number().positive().max(100).nullable().optional(),
        assetAccountId: z.string().nullable().optional(),
        accumDepAccountId: z.string().nullable().optional(),
        depExpenseAccountId: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
        notes: text(2000),
      })
      .parse(req.body);
    return fa.updateCategory(req.companyId!, req.params.id, body, actor(req));
  }),
);

faRouter.get("/depreciation/runs", handle((req) => fa.listDepreciationRuns(req.companyId!)));
faRouter.get(
  "/depreciation/preview",
  handle(async (req) => {
    const q = z.object({ period }).parse(req.query);
    return fa.previewDepreciation(req.companyId!, q.period);
  }),
);
faRouter.post(
  "/depreciation/run",
  requireCapability("fa:post"),
  handle(async (req) => {
    const body = z.object({ period }).parse(req.body);
    return fa.runDepreciation(req.companyId!, body.period, actor(req));
  }, 201),
);

faRouter.get(
  "/assets",
  handle((req) =>
    fa.listAssets(req.companyId!, {
      status: str(req.query.status),
      categoryId: str(req.query.categoryId),
      q: str(req.query.q),
      from: str(req.query.from),
      to: str(req.query.to),
    }),
  ),
);
faRouter.get("/assets/:id", handle((req) => fa.getAsset(req.companyId!, req.params.id)));
faRouter.post(
  "/assets",
  requireCapability("fa:manage"),
  handle(async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(200),
        categoryId: z.string().min(1),
        acquisitionCost: money,
        residualValue: money0.optional(),
        purchaseDate: day.optional(),
        serialNumber: text(80),
        barcode: text(80),
        description: text(2000),
        supplierId: z.string().optional(),
        supplierName: text(160),
        acquisitionMethod: z.enum(["PURCHASE", "CAPITALIZATION", "DONATION", "TRANSFER", "OTHER"]).optional(),
        usefulLifeMonths: z.number().int().min(0).max(1200).optional(),
        depreciationMethod: method.optional(),
        ratePercent: z.number().positive().max(100).optional(),
        branch: text(80),
        department: text(80),
        costCentre: text(80),
        project: text(80),
        location: text(160),
        assignedEmployee: text(120),
        warrantyExpiry: day.optional(),
        insuranceDetails: text(2000),
        capitalize: z.boolean().optional(),
        creditAccountId: z.string().optional(),
        capitalizationDate: day.optional(),
      })
      .parse(req.body);
    return fa.registerAsset(req.companyId!, body, actor(req));
  }, 201),
);
faRouter.post(
  "/assets/:id/capitalize",
  requireCapability("fa:post"),
  handle(async (req) => {
    const body = z
      .object({
        capitalizationDate: day,
        creditAccountId: z.string().optional(),
        residualValue: money0.optional(),
        usefulLifeMonths: z.number().int().min(0).max(1200).optional(),
      })
      .parse(req.body);
    return fa.capitalizeAsset(req.companyId!, req.params.id, body, actor(req));
  }),
);
faRouter.post(
  "/assets/:id/transfer",
  requireCapability("fa:manage"),
  handle(async (req) => {
    const body = z
      .object({
        transferDate: day,
        toBranch: text(80),
        toDepartment: text(80),
        toCostCentre: text(80),
        toProject: text(80),
        toLocation: text(160),
        toEmployee: text(120),
        notes: text(2000),
      })
      .parse(req.body);
    return fa.transferAsset(req.companyId!, req.params.id, body, actor(req));
  }),
);
faRouter.post(
  "/assets/:id/maintenance",
  requireCapability("fa:manage"),
  handle(async (req) => {
    const body = z
      .object({
        maintenanceDate: day,
        maintenanceType: z.string().trim().min(1).max(80),
        serviceProvider: text(160),
        description: text(2000),
        cost: money0.optional(),
        nextMaintenanceDate: day.optional(),
        postExpense: z.boolean().optional(),
        expenseAccountId: z.string().optional(),
        creditAccountId: z.string().optional(),
      })
      .parse(req.body);
    return fa.recordMaintenance(req.companyId!, req.params.id, body, actor(req));
  }),
);
faRouter.post(
  "/assets/:id/revalue",
  requireCapability("fa:post"),
  handle(async (req) => {
    const body = z.object({ effectiveDate: day, fairValue: money0, valuationReference: text(200) }).parse(req.body);
    return fa.revalueAsset(req.companyId!, req.params.id, body, actor(req));
  }),
);
faRouter.post(
  "/assets/:id/impair",
  requireCapability("fa:post"),
  handle(async (req) => {
    const body = z.object({ impairmentDate: day, recoverableAmount: money0, reason: text(2000) }).parse(req.body);
    return fa.impairAsset(req.companyId!, req.params.id, body, actor(req));
  }),
);
faRouter.post(
  "/assets/:id/dispose",
  requireCapability("fa:post"),
  handle(async (req) => {
    const body = z
      .object({
        disposalDate: day,
        disposalMethod: disposal,
        proceeds: money0.optional(),
        proceedsAccountId: z.string().optional(),
        notes: text(2000),
      })
      .parse(req.body);
    return fa.disposeAsset(req.companyId!, req.params.id, body, actor(req));
  }),
);

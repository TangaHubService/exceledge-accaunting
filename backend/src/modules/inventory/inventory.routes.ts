import { INVENTORY_MOVEMENT_KINDS } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as inventory from "./inventory.service";

export const inventoryRouter = Router();

inventoryRouter.use(authenticateErpJwt, requireCapability("inventory:view"), resolveCompany);

function fail(res: Response, e: unknown, status = 400) {
  const message = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") : (e as Error).message;
  res.status(status).json({ success: false, error: message });
}

const str = (q: unknown) => (typeof q === "string" && q.trim() ? q.trim() : undefined);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date").optional();
const kinds = z
  .string()
  .optional()
  .refine((v) => !v || v.split(",").every((k) => (INVENTORY_MOVEMENT_KINDS as readonly string[]).includes(k)), "Unknown movement type");

inventoryRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await inventory.inventoryDashboard(req.companyId!) });
  } catch (e) {
    fail(res, e, 500);
  }
});

inventoryRouter.get("/locations", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await inventory.listLocations(req.companyId!) });
});

inventoryRouter.get("/valuation", async (req: AuthedRequest, res) => {
  try {
    const asOf = day.parse(str(req.query.asOf));
    res.json({ success: true, data: await inventory.valuationReport(req.companyId!, { asOf, locationId: str(req.query.locationId), category: str(req.query.category) }) });
  } catch (e) {
    fail(res, e);
  }
});

inventoryRouter.get("/movements", async (req: AuthedRequest, res) => {
  try {
    const q = z
      .object({ from: day, to: day, kind: kinds, page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() })
      .parse({ from: str(req.query.from), to: str(req.query.to), kind: str(req.query.kind), page: str(req.query.page), pageSize: str(req.query.pageSize) });
    res.json({
      success: true,
      data: await inventory.listMovements(req.companyId!, {
        ...q,
        locationId: str(req.query.locationId),
        itemId: str(req.query.itemId),
        costSource: str(req.query.costSource),
        q: str(req.query.q),
      }),
    });
  } catch (e) {
    fail(res, e);
  }
});

inventoryRouter.get("/reconciliation", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await inventory.reconciliation(req.companyId!) });
  } catch (e) {
    fail(res, e, 500);
  }
});

inventoryRouter.get("/reports/cost-of-sales", async (req: AuthedRequest, res) => {
  try {
    const q = z.object({ from: day, to: day }).parse({ from: str(req.query.from), to: str(req.query.to) });
    res.json({ success: true, data: await inventory.costOfSalesReport(req.companyId!, q.from, q.to) });
  } catch (e) {
    fail(res, e);
  }
});

inventoryRouter.get("/reports/slow-moving", async (req: AuthedRequest, res) => {
  try {
    const q = z
      .object({ slowDays: z.coerce.number().int().min(1).max(3650).default(90), deadDays: z.coerce.number().int().min(1).max(3650).default(180) })
      .parse({ slowDays: str(req.query.slowDays), deadDays: str(req.query.deadDays) });
    res.json({ success: true, data: await inventory.slowMovingReport(req.companyId!, q.slowDays, q.deadDays) });
  } catch (e) {
    fail(res, e);
  }
});

inventoryRouter.post("/opening-snapshot", requireCapability("inventory:manage"), async (req: AuthedRequest, res) => {
  try {
    const token = (req.headers.authorization ?? "").slice("Bearer ".length);
    const data = await inventory.requestOpeningSnapshot(req.companyId!, token, {
      erpUserId: req.erpUser!.userId,
      erpRole: req.organizationRole ?? req.erpUser?.role,
      meta: getRequestMeta(req),
    });
    res.status(202).json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

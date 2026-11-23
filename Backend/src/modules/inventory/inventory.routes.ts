import { INVENTORY_MOVEMENT_KINDS } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import { actorOf, handle } from "../../lib/http";
import * as inventory from "./inventory.service";
import * as stock from "./stock-documents.service";
import * as items from "./items.service";
import { parsePage, wantsPage } from "../../lib/pagination";
import { inTransaction } from "../../lib/prisma";

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

/* ── Products and services ─────────────────────────────────────────── */

const blankToNull = <T extends z.ZodTypeAny>(schema: T) => schema.optional().nullable().or(z.literal("").transform(() => null));
const text = (max: number) => blankToNull(z.string().trim().max(max));
const amount = blankToNull(z.number().min(0, "Amounts can't be negative").max(1e12));
const itemType = z.enum(["SERVICE", "NON_INVENTORY", "INVENTORY"]);
const itemFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  type: itemType.optional(),
  sku: text(80),
  category: text(100),
  unit: text(30),
  isActive: z.boolean().optional(),
  salesDescription: text(1000),
  salesPrice: amount,
  incomeAccountId: text(40),
  salesTaxCode: text(40),
  purchaseDescription: text(1000),
  purchaseCost: amount,
  expenseAccountId: text(40),
  purchaseTaxCode: text(40),
  preferredSupplierId: text(40),
  reorderPoint: amount,
};
const itemBody = z.object(itemFields);
const itemPatch = z.object(itemFields).partial();
const itemListFilter = z.object({
  q: z.string().trim().max(200).optional(),
  type: itemType.optional(),
  category: z.string().trim().max(100).optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
  stock: z.enum(["low", "out"]).optional(),
  source: z.enum(["erp", "app"]).optional(),
  sort: z.enum(["name", "sku", "type", "salesPrice", "purchaseCost", "quantity", "updated"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
const manage = requireCapability("inventory:manage");

/** Plain array of stock items for receipts and adjustments; pass `page` for the Products and services list. */
inventoryRouter.get(
  "/items",
  handle(async (req) => (wantsPage(req.query) ? items.listItemsPage(req.companyId!, itemListFilter.parse(req.query), parsePage(req.query)) : stock.listItems(req.companyId!))),
);
inventoryRouter.get("/items/options", handle((req) => items.itemPickerOptions(req.companyId!)));
inventoryRouter.get("/items/categories",handle((req) => items.itemCategories(req.companyId!)));
inventoryRouter.get(
  "/items/duplicates",
  handle((req) => items.findItemDuplicates(req.companyId!, { name: str(req.query.name), sku: str(req.query.sku) }, str(req.query.excludeId))),
);
inventoryRouter.get("/items/export.csv", async (req: AuthedRequest, res) => {
  try {
    const csv = await items.exportItemsCsv(req.companyId!, itemListFilter.parse(req.query));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="products-and-services-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) {
    fail(res, e);
  }
});
inventoryRouter.post(
  "/items/import",
  manage,
  handle(async (req) => {
    const cell = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || undefined);
    const money = z.number().optional().nullable().transform((v) => (v == null ? undefined : v));
    const row = z.object({
      name: z.string().trim().max(200),
      type: cell(40),
      sku: cell(80),
      category: cell(100),
      unit: cell(30),
      salesDescription: cell(1000),
      salesPrice: money,
      incomeAccount: cell(200),
      salesTaxCode: cell(40),
      purchaseDescription: cell(1000),
      purchaseCost: money,
      expenseAccount: cell(200),
      purchaseTaxCode: cell(40),
      preferredSupplier: cell(200),
    });
    const body = z.object({ dryRun: z.boolean().optional(), rows: z.array(row).min(1, "The file has no rows").max(2000, "Import at most 2,000 items at a time") }).parse(req.body);
    return items.importItems(req.companyId!, body.rows, { dryRun: body.dryRun }, actorOf(req), inTransaction);
  }),
);
inventoryRouter.post(
  "/items/bulk-status",
  manage,
  handle((req) => {
    const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(500), isActive: z.boolean() }).parse(req.body);
    return inTransaction(() => items.bulkSetItemStatus(req.companyId!, body.ids, body.isActive, actorOf(req)));
  }),
);
inventoryRouter.post("/items", manage, handle((req) => inTransaction(() => items.createItem(req.companyId!, itemBody.parse(req.body), actorOf(req))), 201));
inventoryRouter.get("/items/:id", handle((req) => items.getItem(req.companyId!, req.params.id)));
inventoryRouter.patch("/items/:id", manage, handle((req) => inTransaction(() => items.updateItem(req.companyId!, req.params.id, itemPatch.parse(req.body), actorOf(req)))));

inventoryRouter.get("/item-receipts", handle((req) => stock.listItemReceipts(req.companyId!, { status: str(req.query.status), supplierId: str(req.query.supplierId) })));
inventoryRouter.post(
  "/item-receipts",
  requireCapability("inventory:manage"),
  handle((req) => stock.createItemReceipt(req.companyId!, stock.itemReceiptBody.parse(req.body), actorOf(req)), 201),
);
inventoryRouter.get("/adjustments", handle((req) => stock.listAdjustments(req.companyId!, { status: str(req.query.status) })));
inventoryRouter.get("/adjustments/:id", handle((req) => stock.getAdjustment(req.companyId!, req.params.id)));
inventoryRouter.post(
  "/adjustments",
  requireCapability("inventory:manage"),
  handle((req) => stock.createAdjustment(req.companyId!, stock.adjustmentBody.parse(req.body), actorOf(req)), 201),
);

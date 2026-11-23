import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 94101;
const otherOrgId = 94102;

async function clean(org: number) {
  const company = { externalErpOrganizationId: String(org) };
  await prisma.itemReceipt.deleteMany({ where: { company } });
  await prisma.inventoryAdjustment.deleteMany({ where: { company } });
  await prisma.approvalRequest.deleteMany({ where: { company } });
  await resetCompany(org);
}

describe("Products and services: item master, list, ERP-owned stock items, import and export", () => {
  let headers: Record<string, string>;
  let other: Record<string, string>;
  let companyId: string;
  const post = (path: string, body: unknown, h = headers) => request(app).post(`/api/v1${path}`).set(h).send(body as object);
  const patch = (path: string, body: unknown) => request(app).patch(`/api/v1${path}`).set(headers).send(body as object);
  const get = (path: string, h = headers) => request(app).get(`/api/v1${path}`).set(h);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.$connect();
    await clean(orgId);
    await clean(otherOrgId);
    headers = await activateCompany(app, orgId, { name: "Products Co", tin: "555666881" });
    other = await activateCompany(app, otherOrgId, { name: "Other Products Co", tin: "555666882" });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;

    const income = await prisma.account.findFirstOrThrow({ where: { companyId, type: "INCOME", isActive: true } });
    const expense = await prisma.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } });
    const liability = await prisma.account.findFirstOrThrow({ where: { companyId, type: "LIABILITY", isActive: true } });
    Object.assign(ids, { income: income.id, incomeCode: income.code, expense: expense.id, liability: liability.id });
    if (!(await prisma.taxCode.findFirst({ where: { companyId, code: "VAT18" } }))) {
      await prisma.taxCode.create({ data: { companyId, code: "VAT18", name: "VAT 18%", taxType: "OUTPUT_VAT", ratePercent: 18, effectiveFrom: new Date("2020-01-01") } });
    }
    ids.supplier = (await post("/ap/suppliers", { name: "Office Supplies Ltd" })).body.data.id;

    // Stock items arrive from the ERP, with balances at two locations.
    const widget = await prisma.inventoryItem.create({ data: { companyId, externalProductId: "ERP-1", name: "Widget", sku: "W-1", category: "Hardware", unit: "pcs", reorderPoint: 10 } });
    const gadget = await prisma.inventoryItem.create({ data: { companyId, externalProductId: "ERP-2", name: "Gadget", sku: "G-1" } });
    const kigali = await prisma.inventoryLocation.create({ data: { companyId, externalBranchId: "B1", name: "Kigali" } });
    const huye = await prisma.inventoryLocation.create({ data: { companyId, externalBranchId: "B2", name: "Huye" } });
    await prisma.inventoryBalance.createMany({
      data: [
        { companyId, itemId: widget.id, locationId: kigali.id, quantity: 5, value: 5000 },
        { companyId, itemId: widget.id, locationId: huye.id, quantity: 3, value: 3000 },
        { companyId, itemId: gadget.id, locationId: kigali.id, quantity: 0, value: 0 },
      ],
    });
    Object.assign(ids, { widget: widget.id, gadget: gadget.id, kigali: kigali.id });
  });

  afterAll(async () => {
    await clean(orgId);
    await clean(otherOrgId);
  });

  it("creates a service with prices, accounts, tax and a preferred supplier", async () => {
    const res = await post("/inventory/items", {
      name: "Consulting hour",
      type: "SERVICE",
      sku: "SVC-1",
      category: "Services",
      salesDescription: "Advisory, per hour",
      salesPrice: 25000,
      incomeAccountId: ids.income,
      salesTaxCode: "VAT18",
      purchaseDescription: "Subcontracted advisory",
      purchaseCost: 15000,
      expenseAccountId: ids.expense,
      preferredSupplierId: ids.supplier,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const item = res.body.data;
    ids.service = item.id;
    expect(item).toMatchObject({ type: "SERVICE", source: "APP", salesPrice: 25000, purchaseCost: 15000, salesTaxCode: "VAT18", quantity: null, stockStatus: null, isActive: true });
    expect(item.incomeAccount.id).toBe(ids.income);
    expect(item.preferredSupplier.name).toBe("Office Supplies Ltd");

    const audit = await prisma.auditEvent.findFirst({ where: { companyId, entityType: "InventoryItem", entityId: item.id, action: "CREATE" } });
    expect(audit).toBeTruthy();
  });

  it("validates input: required name, account types, tax codes, negatives, duplicates, no stock items", async () => {
    expect((await post("/inventory/items", { name: "  " })).status).toBe(400);
    const wrongAccount = await post("/inventory/items", { name: "Bad income", incomeAccountId: ids.liability });
    expect(wrongAccount.status).toBe(400);
    expect(wrongAccount.body.error).toMatch(/can't be used as the income account/);
    expect((await post("/inventory/items", { name: "Bad tax", salesTaxCode: "NOPE" })).body.error).toMatch(/not an active tax code/);
    expect((await post("/inventory/items", { name: "Negative", salesPrice: -1 })).status).toBe(400);
    const dupeName = await post("/inventory/items", { name: "consulting HOUR" });
    expect(dupeName.status).toBe(409);
    const dupeSku = await post("/inventory/items", { name: "Other", sku: "w-1" });
    expect(dupeSku.status).toBe(409);
    expect(dupeSku.body.error).toMatch(/SKU W-1/);
    const stock = await post("/inventory/items", { name: "New stock", type: "INVENTORY" });
    expect(stock.status).toBe(400);
    expect(stock.body.error).toMatch(/come from the ERP/);

    const dupes = await get(`/inventory/items/duplicates?name=Widget&sku=SVC-1`);
    expect(dupes.body.data.map((d: { name: string }) => d.name).sort()).toEqual(["Consulting hour", "Widget"]);
  });

  it("lets prices and accounts change on ERP items but keeps ERP-managed fields locked", async () => {
    const ok = await patch(`/inventory/items/${ids.widget}`, { salesPrice: 1500, incomeAccountId: ids.income, salesTaxCode: "VAT18", reorderPoint: 10, preferredSupplierId: ids.supplier });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ salesPrice: 1500, source: "ERP", type: "INVENTORY" });

    const rename = await patch(`/inventory/items/${ids.widget}`, { name: "Renamed widget" });
    expect(rename.status).toBe(400);
    expect(rename.body.error).toMatch(/managed in the ERP/);
    // Sending the same value back (as the edit form does) is fine.
    expect((await patch(`/inventory/items/${ids.widget}`, { name: "Widget", sku: "W-1" })).status).toBe(200);
    expect((await patch(`/inventory/items/${ids.widget}`, { type: "SERVICE" })).status).toBe(400);
    expect((await patch(`/inventory/items/${ids.service}`, { type: "INVENTORY" })).status).toBe(400);
    expect((await patch(`/inventory/items/${ids.service}`, { reorderPoint: 5 })).body.error).toMatch(/Only stock items/);

    const switched = await patch(`/inventory/items/${ids.service}`, { type: "NON_INVENTORY", name: "Consulting hour (fixed)" });
    expect(switched.status).toBe(200);
    expect(switched.body.data.type).toBe("NON_INVENTORY");
    await patch(`/inventory/items/${ids.service}`, { type: "SERVICE", name: "Consulting hour" });
  });

  it("shows quantity on hand, value and per-location stock for ERP items", async () => {
    const res = await get(`/inventory/items/${ids.widget}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ quantity: 8, value: 8000, averageCost: 1000, stockStatus: "LOW", externalProductId: "ERP-1" });
    expect(res.body.data.locations).toHaveLength(2);
    expect((await get(`/inventory/items/${ids.gadget}`)).body.data.stockStatus).toBe("OUT");
  });

  it("lists with search, filters, sort, counts and paging", async () => {
    await post("/inventory/items", { name: "Printer paper", type: "NON_INVENTORY", salesPrice: 6000, category: "Office" });
    const all = await get("/inventory/items?page=1&pageSize=50");
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(4);
    expect(all.body.data.counts).toMatchObject({ active: 4, service: 1, nonInventory: 1, inventory: 2, lowStock: 1, outOfStock: 1, inactive: 0 });
    expect(all.body.data.categories.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["Hardware", "Office", "Services"]));

    const names = (r: request.Response) => r.body.data.rows.map((x: { name: string }) => x.name);
    expect(names(await get("/inventory/items?page=1&q=advisory"))).toEqual(["Consulting hour"]);
    expect(names(await get("/inventory/items?page=1&type=INVENTORY"))).toEqual(["Gadget", "Widget"]);
    expect(names(await get("/inventory/items?page=1&stock=low"))).toEqual(["Widget"]);
    expect(names(await get("/inventory/items?page=1&stock=out"))).toEqual(["Gadget"]);
    expect(names(await get("/inventory/items?page=1&source=app"))).toEqual(["Consulting hour", "Printer paper"]);
    expect(names(await get("/inventory/items?page=1&category=Office"))).toEqual(["Printer paper"]);
    expect(names(await get("/inventory/items?page=1&sort=salesPrice&dir=desc")).slice(0, 3)).toEqual(["Consulting hour", "Printer paper", "Widget"]);
    const paged = await get("/inventory/items?page=2&pageSize=3");
    expect(paged.body.data).toMatchObject({ page: 2, pageCount: 2 });
    expect(paged.body.data.rows).toHaveLength(1);

    // The plain list feeds receipts and adjustments: stock items only.
    const stock = await get("/inventory/items");
    expect(stock.body.data.map((x: { name: string }) => x.name)).toEqual(["Gadget", "Widget"]);
  });

  it("makes items inactive in bulk and hides them from the default list", async () => {
    const res = await post("/inventory/items/bulk-status", { ids: [ids.service, ids.gadget], isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);
    const active = await get("/inventory/items?page=1");
    expect(active.body.data.rows.map((x: { name: string }) => x.name)).not.toContain("Consulting hour");
    expect(active.body.data.counts.inactive).toBe(2);
    const inactive = await get("/inventory/items?page=1&status=inactive");
    expect(inactive.body.data.total).toBe(2);
    // A reused name is still a duplicate while the old item is inactive.
    expect((await post("/inventory/items", { name: "Consulting hour" })).body.error).toMatch(/inactive/);
    await post("/inventory/items/bulk-status", { ids: [ids.service, ids.gadget], isActive: true });
  });

  it("offers every active item with its defaults to the transaction product picker", async () => {
    await post("/inventory/items/bulk-status", { ids: [ids.gadget], isActive: false });
    const res = await get("/inventory/items/options");
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.map((i: { name: string }) => [i.name, i]));
    expect(Object.keys(byName).sort()).toEqual(["Consulting hour", "Printer paper", "Widget"]);
    expect(byName["Consulting hour"]).toMatchObject({ type: "SERVICE", salesPrice: 25000, incomeAccountId: ids.income, salesTaxCode: "VAT18", salesDescription: "Advisory, per hour" });
    expect(byName.Widget).toMatchObject({ type: "INVENTORY", salesPrice: 1500 });
    expect((await get("/inventory/items/options", other)).body.data).toEqual([]);
    await post("/inventory/items/bulk-status", { ids: [ids.gadget], isActive: true });
  });

  it("refuses to receive or adjust services and non-stock items", async () => {
    const res = await post("/inventory/item-receipts", { supplierId: ids.supplier, date: "2026-11-12", lines: [{ itemId: ids.service, locationId: ids.kigali, quantity: 1, unitCost: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn't a stock item/);
  });

  it("exports CSV and imports services and non-stock items row by row", async () => {
    const csv = await get("/inventory/items/export.csv?status=all");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("Name,SKU,Type");
    expect(csv.text).toContain("Consulting hour,SVC-1,Service");

    const rows = [
      { name: "Delivery", type: "Service", salesPrice: 2000, incomeAccount: ids.incomeCode, salesTaxCode: "VAT18" },
      { name: "Toner", type: "non-inventory", sku: "TN-1", purchaseCost: 30000, preferredSupplier: "office supplies ltd" },
      { name: "Widget", type: "Service" },
      { name: "Pallet", type: "Inventory" },
      { name: "Setup fee", incomeAccount: "9999 Nowhere" },
      { name: "Toner refill", sku: "tn-1" },
    ];
    const dry = await post("/inventory/items/import", { dryRun: true, rows });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.data).toMatchObject({ dryRun: true, succeeded: 2, failed: 4 });
    expect(await prisma.inventoryItem.count({ where: { companyId, name: "Delivery" } })).toBe(0);

    const real = await post("/inventory/items/import", { rows });
    expect(real.body.data.succeeded).toBe(2);
    const errors = real.body.data.results.filter((r: { ok: boolean }) => !r.ok).map((r: { error: string }) => r.error);
    expect(errors[0]).toMatch(/already exists/);
    expect(errors[1]).toMatch(/come from the ERP/);
    expect(errors[2]).toMatch(/No account matches/);
    expect(errors[3]).toMatch(/earlier in the file/);
    const toner = await prisma.inventoryItem.findFirstOrThrow({ where: { companyId, name: "Toner" } });
    expect(toner).toMatchObject({ type: "NON_INVENTORY", preferredSupplierId: ids.supplier, externalProductId: null });
  });

  it("keeps companies apart", async () => {
    expect((await get(`/inventory/items/${ids.service}`, other)).status).toBe(404);
    expect((await get("/inventory/items?page=1", other)).body.data.total).toBe(0);
    const res = await post("/inventory/items", { name: "Cross-company", preferredSupplierId: ids.supplier }, other);
    expect(res.status).toBe(400);
  });
});

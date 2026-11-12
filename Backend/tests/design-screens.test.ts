import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98200;
const otherOrg = 98201;
const date = "2026-01-15";
let headers: Record<string, string>;
let companyId = "";
let customerId = "";
let supplierId = "";
let itemId = "";
let locationId = "";
let lossAccountId = "";
let incomeAccountId = "";

const accountBalance = async (id: string) => {
  const lines = await prisma.journalLine.findMany({ where: { accountId: id, journal: { status: "POSTED" } }, select: { debit: true, credit: true } });
  return lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
};

async function clean(org: number) {
  const company = { externalErpOrganizationId: String(org) };
  await prisma.itemReceipt.deleteMany({ where: { company } });
  await prisma.inventoryAdjustment.deleteMany({ where: { company } });
  await prisma.commercialDocument.deleteMany({ where: { company } });
  await prisma.approvalRequest.deleteMany({ where: { company } });
  await resetCompany(org);
}

beforeAll(async () => {
  await clean(orgId);
  await clean(otherOrg);
  headers = await activateCompany(app, orgId, { name: "Design Screens Ltd", tin: "982000001" });
  const company = await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } });
  companyId = company.id;
  const customer = await request(app).post("/api/v1/ar/customers").set(headers).send({ name: "Acme Buyer", customerType: "CREDIT", creditLimit: 100_000_000 });
  expect(customer.status).toBe(201);
  customerId = customer.body.data.id;
  const supplier = await request(app).post("/api/v1/ap/suppliers").set(headers).send({ name: "Stock Supplier" });
  expect(supplier.status).toBe(201);
  supplierId = supplier.body.data.id;
  const item = await prisma.inventoryItem.create({ data: { companyId, externalProductId: "SKU-1", name: "Widget", sku: "W1" } });
  itemId = item.id;
  const location = await prisma.inventoryLocation.create({ data: { companyId, externalBranchId: "B1", name: "Kigali" } });
  locationId = location.id;
  lossAccountId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } })).id;
  incomeAccountId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "INCOME", isActive: true } })).id;
});

afterAll(async () => {
  await clean(orgId);
  await clean(otherOrg);
});

const salesLine = () => ({ description: "Consulting", quantity: 2, unitPrice: 500, accountId: incomeAccountId });

describe("Sales documents", () => {
  it("recomputes money on the server and numbers the series", async () => {
    const res = await request(app)
      .post("/api/v1/commercial/estimate")
      .set(headers)
      .send({ customerId, docDate: date, discountPct: 10, lines: [salesLine()], total: 1 });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.total)).toBe(900);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.number).toBe("1001");
    const next = await request(app).get("/api/v1/commercial/next-numbers").set(headers);
    expect(next.body.data.estimate).toBe("1002");
  });

  it("refuses a duplicate number with 409", async () => {
    const res = await request(app).post("/api/v1/commercial/proposal").set(headers).send({ customerId, number: "1001", docDate: date, lines: [salesLine()] });
    expect(res.status).toBe(409);
  });

  it("posts nothing until converted, then invoices exactly once", async () => {
    const before = await prisma.journal.count({ where: { companyId } });
    const order = await request(app).post("/api/v1/commercial/sales-order").set(headers).send({ customerId, docDate: date, lines: [salesLine()] });
    expect(order.status).toBe(201);
    expect(await prisma.journal.count({ where: { companyId } })).toBe(before);

    const first = await request(app).post(`/api/v1/commercial/documents/${order.body.data.id}/convert`).set(headers).send({ target: "INVOICE", date });
    expect(first.status).toBe(200);
    expect(first.body.data.document.status).toBe("CONVERTED");
    const invoice = await prisma.arInvoice.findUniqueOrThrow({ where: { id: first.body.data.converted.id } });
    expect(Number(invoice.gross)).toBe(1000);
    expect(invoice.journalId).toBeTruthy();

    const again = await request(app).post(`/api/v1/commercial/documents/${order.body.data.id}/convert`).set(headers).send({ target: "INVOICE", date });
    expect(again.status).toBe(409);
  });

  it("gives one invoice when two conversions race", async () => {
    const order = await request(app).post("/api/v1/commercial/delayed-charge").set(headers).send({ customerId, docDate: date, lines: [salesLine()] });
    const path = `/api/v1/commercial/documents/${order.body.data.id}/convert`;
    const results = await Promise.all([request(app).post(path).set(headers).send({ target: "INVOICE", date }), request(app).post(path).set(headers).send({ target: "INVOICE", date })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("requires a real customer before a lead's estimate can be invoiced", async () => {
    const lead = await request(app).post("/api/v1/commercial/estimate").set(headers).send({ leadName: "New Lead", docDate: date, lines: [salesLine()] });
    expect(lead.status).toBe(201);
    const res = await request(app).post(`/api/v1/commercial/documents/${lead.body.data.id}/convert`).set(headers).send({ target: "INVOICE", date });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customer/);
  });

  it("turns a delayed credit into a posted credit note", async () => {
    const credit = await request(app).post("/api/v1/commercial/delayed-credit").set(headers).send({ customerId, docDate: date, memo: "Goodwill", lines: [salesLine()] });
    const res = await request(app).post(`/api/v1/commercial/documents/${credit.body.data.id}/convert`).set(headers).send({ target: "CREDIT_NOTE", date });
    expect(res.status).toBe(200);
    expect(res.body.data.converted.type).toBe("ArCreditNote");
  });

  it("enforces status transitions", async () => {
    const quote = await request(app).post("/api/v1/commercial/estimate").set(headers).send({ customerId, docDate: date, lines: [salesLine()] });
    const path = `/api/v1/commercial/documents/${quote.body.data.id}/status`;
    expect((await request(app).post(path).set(headers).send({ status: "ACCEPTED" })).status).toBe(200);
    expect((await request(app).post(path).set(headers).send({ status: "CLOSED" })).status).toBe(409);
  });

  it("can't reach another company's documents or use its parties", async () => {
    const quote = await request(app).post("/api/v1/commercial/estimate").set(headers).send({ customerId, docDate: date, lines: [salesLine()] });
    const other = authHeaders(otherOrg);
    await request(app).get("/api/v1/setup/dashboard").set(other);
    expect((await request(app).get(`/api/v1/commercial/documents/${quote.body.data.id}`).set(other)).status).toBe(404);
    expect((await request(app).post("/api/v1/commercial/estimate").set(other).send({ customerId, docDate: date, lines: [{ description: "x", quantity: 1, unitPrice: 1 }] })).status).toBe(400);
  });

  it("keeps sellers and read-only roles out", async () => {
    expect((await request(app).get("/api/v1/commercial/estimate").set(authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await request(app).post("/api/v1/commercial/estimate").set(authHeaders(orgId, "BRANCH_MANAGER")).send({ customerId, docDate: date, lines: [salesLine()] })).status).toBe(403);
  });
});

describe("Purchase order, goods received, bill", () => {
  it("doesn't expense stock twice: GRNI nets to zero and inventory holds the cost", async () => {
    const { accounts } = await (await import("../src/modules/inventory/inventory.service")).inventoryConfig(companyId);
    const grniBefore = await accountBalance(accounts.grniId!);
    const inventoryBefore = await accountBalance(accounts.inventoryAssetId!);
    const purchasesBefore = accounts.purchasesId ? await accountBalance(accounts.purchasesId) : 0;

    const po = await request(app)
      .post("/api/v1/commercial/purchase-order")
      .set(headers)
      .send({ supplierId, docDate: date, lines: [{ description: "Widgets", itemId, quantity: 10, unitPrice: 100 }] });
    expect(po.status).toBe(201);
    expect(po.body.data.status).toBe("OPEN");

    const empty = await request(app).post(`/api/v1/commercial/documents/${po.body.data.id}/convert`).set(headers).send({ target: "BILL", date });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/receive the goods/);

    const over = await request(app)
      .post("/api/v1/inventory/item-receipts")
      .set(headers)
      .send({ supplierId, purchaseOrderId: po.body.data.id, date, lines: [{ itemId, locationId, quantity: 11, unitCost: 100 }] });
    expect(over.status).toBe(400);

    const receipt = await request(app)
      .post("/api/v1/inventory/item-receipts")
      .set(headers)
      .send({ supplierId, purchaseOrderId: po.body.data.id, date, lines: [{ itemId, locationId, quantity: 4, unitCost: 100 }] });
    expect(receipt.status).toBe(201);
    expect(await accountBalance(accounts.inventoryAssetId!)).toBe(inventoryBefore + 400);
    expect(await accountBalance(accounts.grniId!)).toBe(grniBefore - 400);
    const status = await prisma.commercialDocument.findUniqueOrThrow({ where: { id: po.body.data.id } });
    expect(status.status).toBe("PARTIALLY_RECEIVED");

    const bill = await request(app).post(`/api/v1/commercial/documents/${po.body.data.id}/convert`).set(headers).send({ target: "BILL", date, supplierInvoiceNumber: "SUP-1" });
    expect(bill.status).toBe(200);
    expect(bill.body.data.document.status).toBe("PARTIALLY_RECEIVED");
    expect(await accountBalance(accounts.grniId!)).toBe(grniBefore);
    expect(await accountBalance(accounts.inventoryAssetId!)).toBe(inventoryBefore + 400);
    if (accounts.purchasesId) expect(await accountBalance(accounts.purchasesId)).toBe(purchasesBefore);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({ where: { itemId, locationId } });
    expect(Number(balance.quantity)).toBe(4);

    const again = await request(app).post(`/api/v1/commercial/documents/${po.body.data.id}/convert`).set(headers).send({ target: "BILL", date });
    expect(again.status).toBe(400);

    const billed = await prisma.apBill.findUniqueOrThrow({ where: { id: bill.body.data.converted.id } });
    expect(Number(billed.grniCleared)).toBe(400);
    const voided = await request(app).post(`/api/v1/ap/bills/${billed.id}/void`).set(headers).send({ reason: "test", voidDate: date });
    expect(voided.status).not.toBe(200);
  });

  it("bills a receipt with no purchase order once", async () => {
    const receipt = await request(app).post("/api/v1/inventory/item-receipts").set(headers).send({ supplierId, date, lines: [{ itemId, locationId, quantity: 1, unitCost: 100 }] });
    expect(receipt.status).toBe(201);
    const path = `/api/v1/commercial/item-receipts/${receipt.body.data.id}/bill`;
    expect((await request(app).post(path).set(headers).send({ date })).status).toBe(200);
    expect((await request(app).post(path).set(headers).send({ date })).status).toBe(409);
  });

  it("rolls everything back when a receipt can't post", async () => {
    const before = await prisma.inventoryMovement.count({ where: { companyId } });
    const res = await request(app).post("/api/v1/inventory/item-receipts").set(headers).send({ supplierId, date: "2019-01-01", lines: [{ itemId, locationId, quantity: 1, unitCost: 100 }] });
    expect(res.status).toBe(400);
    expect(await prisma.inventoryMovement.count({ where: { companyId } })).toBe(before);
    expect(await prisma.itemReceipt.count({ where: { companyId, receiptDate: new Date("2019-01-01T12:00:00Z") } })).toBe(0);
  });
});

describe("Inventory items", () => {
  it("lists items that have no stock, so a first delivery can be received", async () => {
    await prisma.inventoryItem.create({ data: { companyId, externalProductId: "SKU-NEW", name: "Brand new item" } });
    const res = await request(app).get("/api/v1/inventory/items").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.find((i: { name: string }) => i.name === "Brand new item")).toMatchObject({ quantity: 0, unitCost: 0 });
  });
});

describe("Inventory adjustments", () => {
  const body = (change: number, extra: Record<string, unknown> = {}) => ({ type: "QUANTITY", date, reason: "Stock Count Variance", accountId: lossAccountId, lines: [{ itemId, locationId, change }], ...extra });

  it("posts a loss to the chosen account through the stock ledger", async () => {
    const { accounts } = await (await import("../src/modules/inventory/inventory.service")).inventoryConfig(companyId);
    const before = await accountBalance(lossAccountId);
    const stockBefore = await accountBalance(accounts.inventoryAssetId!);
    const res = await request(app).post("/api/v1/inventory/adjustments").set(headers).send(body(-1));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("POSTED");
    expect(await accountBalance(lossAccountId)).toBe(before + 100);
    expect(await accountBalance(accounts.inventoryAssetId!)).toBe(stockBefore - 100);
  });

  it("requires a reason and refuses more than is in stock", async () => {
    expect((await request(app).post("/api/v1/inventory/adjustments").set(headers).send(body(-1, { reason: " " }))).status).toBe(400);
    const res = await request(app).post("/api/v1/inventory/adjustments").set(headers).send(body(-100000));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/in stock/);
  });

  it("changes value without changing quantity", async () => {
    const before = await prisma.inventoryBalance.findFirstOrThrow({ where: { itemId, locationId } });
    const res = await request(app).post("/api/v1/inventory/adjustments").set(headers).send({ type: "VALUE", date, reason: "Data Correction", accountId: lossAccountId, lines: [{ itemId, locationId, change: -50 }] });
    expect(res.status).toBe(201);
    const after = await prisma.inventoryBalance.findFirstOrThrow({ where: { itemId, locationId } });
    expect(Number(after.quantity)).toBe(Number(before.quantity));
    expect(Number(after.value)).toBe(Number(before.value) - 50);
  });

  it("waits for approval when the workflow is on, then posts when approved", async () => {
    await prisma.approvalPostingControls.update({ where: { companyId }, data: { approvalWorkflowEnabled: true, approvalLevels: 1 } });
    try {
      const moved = await prisma.inventoryMovement.count({ where: { companyId } });
      const res = await request(app).post("/api/v1/inventory/adjustments").set(headers).send(body(-1));
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("PENDING_APPROVAL");
      expect(await prisma.inventoryMovement.count({ where: { companyId } })).toBe(moved);

      const { decideApproval } = await import("../src/modules/approvals/approval.service");
      const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { companyId, entityType: "InventoryAdjustment", entityId: res.body.data.id } });
      await decideApproval(companyId, approval.id, "APPROVED", { erpUserId: 999, erpRole: "ADMIN" });
      const posted = await prisma.inventoryAdjustment.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(posted.status).toBe("POSTED");
      expect(posted.journalId).toBeTruthy();
      expect(await prisma.inventoryMovement.count({ where: { companyId } })).toBe(moved + 1);
    } finally {
      await prisma.approvalPostingControls.update({ where: { companyId }, data: { approvalWorkflowEnabled: false } });
    }
  });
});

describe("Projects", () => {
  const id = "projtest0001";

  it("creates a project with a dimension and works out profit from the GL", async () => {
    const res = await request(app).put(`/api/v1/projects/${id}`).set(headers).send({ name: "Fit-out", customerId, status: "IN_PROGRESS", budget: 5000 });
    expect(res.status).toBe(200);
    const code = res.body.data.code;
    expect(await prisma.dimension.count({ where: { companyId, kind: "PROJECT", code, isActive: true } })).toBe(1);

    const invoice = await request(app).post("/api/v1/ar/invoices").set(headers).send({ customerId, invoiceDate: date, lines: [{ description: "Work", quantity: 1, unitPrice: 2000, accountId: incomeAccountId }] });
    expect(invoice.status).toBe(201);
    const bill = await request(app).post("/api/v1/ap/bills").set(headers).send({ supplierId, billDate: date, lines: [{ description: "Materials", quantity: 1, unitPrice: 750, accountId: lossAccountId }] });
    expect(bill.status).toBe(201);
    const link = await request(app).post(`/api/v1/projects/${id}/links`).set(headers).send({ links: [{ kind: "invoice", sourceId: invoice.body.data.id }, { kind: "bill", sourceId: bill.body.data.id }] });
    expect(link.status).toBe(200);

    const figures = await request(app).get(`/api/v1/projects/${id}/financials`).set(headers);
    expect(figures.body.data).toMatchObject({ income: 2000, costs: 750, profit: 1250, budgetRemaining: 4250, budgetUsedPct: 15 });

    const list = await request(app).get("/api/v1/workspace/transactions").query({ projectId: id }).set(headers);
    expect(list.body.data.rows.map((r: { kind: string }) => r.kind).sort()).toEqual(["bill", "invoice"]);

    const removed = await request(app).delete(`/api/v1/projects/${id}`).set(headers);
    expect(removed.status).toBe(409);
    await request(app).delete(`/api/v1/projects/${id}/links/bill/${bill.body.data.id}`).set(headers);
    const after = await request(app).get(`/api/v1/projects/${id}/financials`).set(headers);
    expect(after.body.data.costs).toBe(0);
  });

  it("can't take over another company's project by its id", async () => {
    const res = await request(app).put(`/api/v1/projects/${id}`).set(authHeaders(otherOrg)).send({ name: "Hijack" });
    expect(res.status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).name).toBe("Fit-out");
  });

  it("refuses to tag a record from another company", async () => {
    const other = authHeaders(otherOrg);
    await request(app).put("/api/v1/projects/projother001").set(other).send({ name: "Theirs" });
    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { companyId } });
    const res = await request(app).post("/api/v1/projects/projother001/links").set(other).send({ links: [{ kind: "invoice", sourceId: invoice.id }] });
    expect(res.status).toBe(404);
  });
});

describe("Team and time", () => {
  const id = "employee0001";

  it("hides pay and bank details from people who can't manage the team", async () => {
    const saved = await request(app).put(`/api/v1/team/employees/${id}`).set(headers).send({ firstName: "Ama", lastName: "Uwase", basicSalary: 500000, accountNumber: "0001", nationalId: "119" });
    expect(saved.status).toBe(200);
    expect(saved.body.data.employeeNumber).toMatch(/^EMP/);
    const manager = await request(app).get(`/api/v1/team/employees/${id}`).set(authHeaders(orgId, "BRANCH_MANAGER"));
    expect(manager.status).toBe(200);
    expect(manager.body.data.firstName).toBe("Ama");
    for (const key of ["basicSalary", "accountNumber", "nationalId"]) expect(manager.body.data).not.toHaveProperty(key);
    const admin = await request(app).get(`/api/v1/team/employees/${id}`).set(headers);
    expect(Number(admin.body.data.basicSalary)).toBe(500000);
    expect((await request(app).put(`/api/v1/team/employees/${id}`).set(authHeaders(orgId, "BRANCH_MANAGER")).send({ firstName: "A", lastName: "B" })).status).toBe(403);
    const trail = await prisma.auditEvent.findMany({ where: { companyId, entityType: "Employee" } });
    expect(JSON.stringify(trail)).not.toContain("500000");
  });

  it("records single and weekly time and rejects impossible days", async () => {
    const single = await request(app).post("/api/v1/team/time").set(headers).send({ employeeId: id, date, durationMinutes: 90, billable: true, hourlyRate: 1000 });
    expect(single.status).toBe(201);
    expect(single.body.data.personName).toBe("Ama Uwase");
    const weekly = await request(app)
      .post("/api/v1/team/time/weekly")
      .set(headers)
      .send({ employeeId: id, rows: [{ days: [{ date: "2026-01-12", durationMinutes: 60 }, { date: "2026-01-13", durationMinutes: 0 }] }] });
    expect(weekly.body.data.entries).toBe(1);
    const tooLong = await request(app)
      .post("/api/v1/team/time/weekly")
      .set(headers)
      .send({ employeeId: id, rows: [{ days: [{ date: "2026-01-14", durationMinutes: 800 }] }, { days: [{ date: "2026-01-14", durationMinutes: 800 }] }] });
    expect(tooLong.status).toBe(400);
    const list = await request(app).get("/api/v1/workspace/transactions").query({ kind: "time" }).set(headers);
    expect(list.body.data.rows.find((r: { amount: number }) => r.amount === 1500)).toBeTruthy();
  });

  it("won't delete an employee who has time", async () => {
    expect((await request(app).delete(`/api/v1/team/employees/${id}`).set(headers)).status).toBe(400);
  });
});

describe("Workspace records", () => {
  it("only accepts known collections and keeps personal ones personal", async () => {
    expect((await request(app).put("/api/v1/workspace/records/anything/x").set(headers).send({ a: 1 })).status).toBe(404);
    const me = authHeaders(orgId, "ADMIN", 1);
    const them = authHeaders(orgId, "ADMIN", 2);
    await request(app).put("/api/v1/workspace/records/report-favourites/pnl").set(me).send({ on: true });
    expect((await request(app).get("/api/v1/workspace/records/report-favourites").set(me)).body.data).toEqual([{ on: true, id: "pnl" }]);
    expect((await request(app).get("/api/v1/workspace/records/report-favourites").set(them)).body.data).toEqual([]);
    await request(app).put("/api/v1/workspace/records/forecasts/f1").set(me).send({ name: "Plan" });
    expect((await request(app).get("/api/v1/workspace/records/forecasts").set(them)).body.data).toEqual([{ name: "Plan", id: "f1" }]);
    expect((await request(app).get("/api/v1/workspace/records/forecasts").set(authHeaders(otherOrg))).body.data).toEqual([]);
  });

  it("limits record size and who may change settings", async () => {
    const big = await request(app).put("/api/v1/workspace/records/forecasts/big").set(headers).send({ blob: "x".repeat(300 * 1024) });
    expect(big.status).toBe(413);
    expect((await request(app).put("/api/v1/workspace/records/settings/sales").set(authHeaders(orgId, "BRANCH_MANAGER", 5)).send({ a: 1 })).status).toBe(200);
    expect((await request(app).put("/api/v1/workspace/records/settings/sales").set(authHeaders(orgId, "SELLER", 5)).send({ a: 1 })).status).toBe(403);
  });

  it("loads everything for the screens at once, limited by role", async () => {
    const admin = await request(app).get("/api/v1/workspace/bootstrap").set(headers);
    expect(admin.status).toBe(200);
    expect(admin.body.data.projects.length).toBeGreaterThan(0);
    expect(admin.body.data.transactions.length).toBeGreaterThan(0);
    const seller = await request(app).get("/api/v1/workspace/bootstrap").set(authHeaders(orgId, "SELLER"));
    expect(seller.status).toBe(200);
    expect(seller.body.data).toMatchObject({ projects: [], tasks: [], transactions: [], collections: {} });
  });
});

describe("API edges", () => {
  it("answers bad JSON, unknown routes and readiness in the API's shape", async () => {
    const bad = await request(app).post("/api/v1/commercial/estimate").set({ ...headers, "Content-Type": "application/json" }).send("{nope");
    expect(bad.status).toBe(400);
    expect((await request(app).get("/api/v1/nope")).status).toBe(404);
    const ready = await request(app).get("/ready");
    expect(ready.status).toBe(200);
    expect(ready.headers["x-request-id"]).toBeTruthy();
    expect(ready.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects tokens not signed with the expected algorithm", async () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"userId":1,"role":"ADMIN","activeOrganizationId":98200}').toString("base64url")}.`;
    expect((await request(app).get("/api/v1/projects").set({ Authorization: `Bearer ${none}` })).status).toBe(401);
  });
});

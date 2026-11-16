import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 94091;
const otherOrgId = 94092;

describe("Supplier centre: directory, form fields, duplicates, bulk and CSV", () => {
  let headers: Record<string, string>;
  let other: Record<string, string>;
  const post = (path: string, body: unknown, h = headers) => request(app).post(`/api/v1${path}`).set(h).send(body as object);
  const patch = (path: string, body: unknown) => request(app).patch(`/api/v1${path}`).set(headers).send(body as object);
  const get = (path: string, h = headers) => request(app).get(`/api/v1${path}`).set(h);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    headers = await activateCompany(app, orgId, { name: "Supplier Centre Co", tin: "555666777" });
    other = await activateCompany(app, otherOrgId, { name: "Other Org Co", tin: "555666778" });

    const full = await post("/ap/suppliers", {
      name: "Kigali Hardware",
      companyName: "Kigali Hardware Ltd",
      firstName: "Jean",
      lastName: "Mugabo",
      supplierType: "BUSINESS",
      category: "INVENTORY",
      tin: "100200300",
      vatRegistered: true,
      email: "Sales@KigaliHardware.rw",
      telephone: "+250 788 123 456",
      alternateContact: "Accounts: +250 788 000 111",
      physicalAddress: "KN 5 Rd",
      postalCode: "00100",
      district: "Gasabo",
      sector: "Kimihurura",
      preferredPaymentMethod: "BANK",
      bankName: "Bank of Kigali",
      bankAccountHolder: "Kigali Hardware Ltd",
      bankAccountNumber: "000400012345",
      creditLimit: 5000000,
      internalRemarks: "Negotiate 2% early payment",
      creditPeriodDays: 15,
      openingBalance: 100000,
      openingBalanceDate: "2026-06-30",
    });
    expect(full.status).toBe(201);
    ids.hardware = full.body.data.id;
    ids.fuel = (await post("/ap/suppliers", { name: "Fuel Station", category: "TRANSPORT", telephone: "0788999888" })).body.data.id;
    ids.idle = (await post("/ap/suppliers", { name: "Idle Vendor", category: "CONSULTANT" })).body.data.id;

    // An overdue bill and a current bill for Kigali Hardware, a paid bill for Fuel Station.
    const overdue = await post("/ap/bills", { supplierId: ids.hardware, billDate: "2026-09-01", dueDate: "2026-09-15", net: 200000 });
    expect(overdue.status).toBe(201);
    const current = await post("/ap/bills", { supplierId: ids.hardware, billDate: "2026-11-10", dueDate: "2026-12-31", net: 50000 });
    expect(current.status).toBe(201);
    const fuelBill = await post("/ap/bills", { supplierId: ids.fuel, billDate: "2026-11-01", net: 30000 });
    ids.fuelBill = fuelBill.body.data.id;
    const paid = await post("/ap/payments", { supplierId: ids.fuel, paymentDate: "2026-11-05", amount: 30000, allocations: [{ billId: ids.fuelBill, amount: 30000 }] });
    expect(paid.status).toBe(201);

    await post("/ap/suppliers", { name: "Foreign Supplier" }, other);
  });

  afterAll(async () => {
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
  });

  it("saves the new QuickBooks-style fields and posts the opening balance on its date", async () => {
    const s = (await get(`/ap/suppliers/${ids.hardware}`)).body.data;
    expect(s).toMatchObject({
      companyName: "Kigali Hardware Ltd",
      firstName: "Jean",
      lastName: "Mugabo",
      supplierType: "BUSINESS",
      vatRegistered: true,
      email: "sales@kigalihardware.rw",
      postalCode: "00100",
      preferredPaymentMethod: "BANK",
      bankAccountHolder: "Kigali Hardware Ltd",
      internalRemarks: "Negotiate 2% early payment",
    });
    expect(Number(s.creditLimit)).toBe(5000000);
    const ledger = await prisma.apLedgerEntry.findFirst({ where: { supplierId: ids.hardware, docType: "OPENING" } });
    expect(ledger?.entryDate.toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("pages the list with balances, overdue, purchases and last activity from the books", async () => {
    const res = await get("/ap/suppliers?page=1&pageSize=25");
    expect(res.status).toBe(200);
    const page = res.body.data;
    expect(page.total).toBe(3);
    expect(page.counts).toMatchObject({ all: 3, owing: 1, overdue: 1, inactive: 0 });
    const hw = page.rows.find((r: { id: string }) => r.id === ids.hardware);
    // Opening 100k + 200k + 50k owed; purchases leave the opening balance out.
    expect(hw.balance).toBe(350000);
    expect(hw.purchases).toBe(250000);
    expect(hw.overdue).toBe(300000); // opening balance (due 30 Jun) + the September bill
    expect(hw.lastActivity.slice(0, 10)).toBe("2026-11-10");
    const fuel = page.rows.find((r: { id: string }) => r.id === ids.fuel);
    expect(fuel).toMatchObject({ balance: 0, purchases: 30000, overdue: 0 });
    expect(page.moneyBar.overdue).toEqual({ amount: 300000, count: 2 });
    expect(page.moneyBar.notDue).toEqual({ amount: 50000, count: 1 });
    expect(page.moneyBar.paid30.amount).toBe(30000);
    expect(page.categories.map((c: { category: string }) => c.category)).toEqual(["CONSULTANT", "INVENTORY", "TRANSPORT"]);
  });

  it("searches name, company, email, phone digits and TIN, and filters and sorts", async () => {
    const q = async (query: string) => (await get(`/ap/suppliers?page=1&${query}`)).body.data.rows.map((r: { name: string }) => r.name);
    expect(await q("q=hardware%20ltd")).toEqual(["Kigali Hardware"]);
    expect(await q("q=sales%40kigali")).toEqual(["Kigali Hardware"]);
    expect(await q("q=788-999")).toEqual(["Fuel Station"]);
    expect(await q("q=100200300")).toEqual(["Kigali Hardware"]);
    expect(await q("balance=overdue")).toEqual(["Kigali Hardware"]);
    expect(await q("category=TRANSPORT")).toEqual(["Fuel Station"]);
    expect(await q("sort=purchases&dir=desc")).toEqual(["Kigali Hardware", "Fuel Station", "Idle Vendor"]);
    expect(await q("sort=lastActivity&dir=desc")).toEqual(["Kigali Hardware", "Fuel Station", "Idle Vendor"]);
    expect(await q("sort=balance&dir=desc")).toEqual(["Kigali Hardware", "Fuel Station", "Idle Vendor"]);
    const paged = (await get("/ap/suppliers?page=2&pageSize=2")).body.data;
    expect(paged).toMatchObject({ page: 2, pageCount: 2, total: 3 });
    expect(paged.rows).toHaveLength(1);
  });

  it("keeps the plain array for transaction pickers", async () => {
    const res = await get("/ap/suppliers");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);
  });

  it("refuses duplicate names and TINs, and warns on shared phone numbers", async () => {
    const byName = await post("/ap/suppliers", { name: "kigali hardware" });
    expect(byName.status).toBe(400);
    expect(byName.body.error).toMatch(/already exists/);
    const byTin = await post("/ap/suppliers", { name: "Another Hardware", tin: "100200300" });
    expect(byTin.body.error).toMatch(/TIN 100200300 already belongs to Kigali Hardware/);
    const rename = await patch(`/ap/suppliers/${ids.fuel}`, { name: "Kigali Hardware" });
    expect(rename.status).toBe(400);
    const dupes = (await get("/ap/suppliers/duplicates?name=Fuel%20station&phone=0788%20999%20888")).body.data;
    expect(dupes[0]).toMatchObject({ id: ids.fuel, blocking: true });
    expect(dupes[0].matched).toEqual(expect.arrayContaining(["name", "phone"]));
    const phoneOnly = (await get("/ap/suppliers/duplicates?phone=0788999888")).body.data;
    expect(phoneOnly[0]).toMatchObject({ blocking: false, matched: ["phone"] });
  });

  it("locks the TIN once bills are posted and blocks making a supplier with a balance inactive", async () => {
    const tin = await patch(`/ap/suppliers/${ids.hardware}`, { tin: "999888777" });
    expect(tin.body.error).toMatch(/TIN can't be changed/);
    const idleTin = await patch(`/ap/suppliers/${ids.idle}`, { tin: "999888777" });
    expect(idleTin.status).toBe(200);
    const inactive = await patch(`/ap/suppliers/${ids.hardware}`, { status: "INACTIVE" });
    expect(inactive.body.error).toMatch(/still has a balance/);
  });

  it("bulk-changes status, skipping suppliers that still have a balance", async () => {
    const res = await post("/ap/suppliers/bulk-status", { ids: [ids.hardware, ids.fuel, ids.idle], status: "INACTIVE" });
    expect(res.body.data.updated).toBe(2);
    expect(res.body.data.skipped.map((s: { name: string }) => s.name)).toEqual(["Kigali Hardware"]);
    const counts = (await get("/ap/suppliers?page=1")).body.data.counts;
    expect(counts).toMatchObject({ all: 1, inactive: 2 });
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: "Supplier", entityId: ids.fuel, action: "DEACTIVATE" } });
    expect(audit).toBeTruthy();
    await post("/ap/suppliers/bulk-status", { ids: [ids.fuel, ids.idle], status: "ACTIVE" });
  });

  it("exports CSV and imports suppliers with a dry run first", async () => {
    const csv = await get("/ap/suppliers/export.csv?status=all");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Display name");
    expect(csv.text).toContain("Kigali Hardware");

    const rows = [
      { name: "Musanze Transport", tin: "300400500", email: "ops@musanze.rw", creditPeriodDays: 30 },
      { name: "Fuel Station" },
      { name: "Bad Tin", tin: "12" },
      { name: "Musanze Transport" },
    ];
    const dry = (await post("/ap/suppliers/import", { dryRun: true, rows })).body.data;
    expect(dry).toMatchObject({ dryRun: true, succeeded: 1, failed: 3 });
    expect(await prisma.supplier.count({ where: { name: "Musanze Transport" } })).toBe(0);
    const real = (await post("/ap/suppliers/import", { rows: [rows[0]] })).body.data;
    expect(real).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it("keeps notes per supplier and never shows another organization's suppliers", async () => {
    const note = await post(`/ap/suppliers/${ids.hardware}/notes`, { body: "Called about the September bill" });
    expect(note.status).toBe(201);
    expect((await get(`/ap/suppliers/${ids.hardware}/notes`)).body.data[0].body).toBe("Called about the September bill");

    const theirs = (await get("/ap/suppliers?page=1&status=all", other)).body.data;
    expect(theirs.rows.map((r: { name: string }) => r.name)).toEqual(["Foreign Supplier"]);
    expect((await get(`/ap/suppliers/${ids.hardware}`, other)).status).toBe(404);
    expect((await get(`/ap/suppliers/${ids.hardware}/notes`, other)).status).toBe(404);
    const crossNote = await post(`/ap/suppliers/${ids.hardware}/notes`, { body: "x" }, other);
    expect(crossNote.status).toBe(400);
    const crossBulk = await post("/ap/suppliers/bulk-status", { ids: [ids.fuel], status: "INACTIVE" }, other);
    expect(crossBulk.body.data.updated).toBe(0);
    expect((await prisma.supplier.findUnique({ where: { id: ids.fuel } }))?.status).toBe("ACTIVE");
  });

  it("refuses supplier changes to users without ap:manage", async () => {
    const viewer = authHeaders(orgId, "VIEWER", 777);
    const res = await post("/ap/suppliers/bulk-status", { ids: [ids.fuel], status: "INACTIVE" }, viewer);
    expect([401, 403]).toContain(res.status);
  });
});

describe("Supplier settings that would split the books", () => {
  const org = 94097;
  let h: Record<string, string>;
  beforeAll(async () => {
    await resetCompany(org);
    h = await activateCompany(app, org, { name: "Guard Co", tin: "555666783" });
  });
  afterAll(async () => {
    await resetCompany(org);
  });

  it("locks the currency after the first transaction and the payables account while there is a balance", async () => {
    const s = (await request(app).post("/api/v1/ap/suppliers").set(h).send({ name: "Guarded Vendor" })).body.data;
    expect((await request(app).patch(`/api/v1/ap/suppliers/${s.id}`).set(h).send({ currency: "USD" })).status).toBe(200);
    await request(app).patch(`/api/v1/ap/suppliers/${s.id}`).set(h).send({ currency: "RWF" });
    await request(app).post("/api/v1/ap/bills").set(h).send({ supplierId: s.id, billDate: "2026-05-01", net: 1000 });
    const ccy = await request(app).patch(`/api/v1/ap/suppliers/${s.id}`).set(h).send({ currency: "USD" });
    expect(ccy.body.error).toMatch(/Currency can't be changed/);
    const company = await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(org) } });
    const other = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, type: "LIABILITY", isActive: true } });
    const acct = await request(app).patch(`/api/v1/ap/suppliers/${s.id}`).set(h).send({ apAccountId: other.id });
    expect(acct.body.error).toMatch(/open balance in the current payables account/);
  });
});

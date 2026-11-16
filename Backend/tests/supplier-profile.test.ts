import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 94093;
const otherOrgId = 94094;

async function clean(org: number) {
  const company = { externalErpOrganizationId: String(org) };
  await prisma.itemReceipt.deleteMany({ where: { company } });
  await prisma.commercialDocument.deleteMany({ where: { company } });
  await prisma.approvalRequest.deleteMany({ where: { company } });
  await resetCompany(org);
}

describe("Supplier profile: summary, transactions, detail, credits and activity", () => {
  let headers: Record<string, string>;
  let other: Record<string, string>;
  const post = (path: string, body: unknown) => request(app).post(`/api/v1${path}`).set(headers).send(body as object);
  const get = (path: string, h = headers) => request(app).get(`/api/v1${path}`).set(h);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.$connect();
    await clean(orgId);
    await clean(otherOrgId);
    headers = await activateCompany(app, orgId, { name: "Supplier Profile Co", tin: "555666779" });
    other = await activateCompany(app, otherOrgId, { name: "Profile Other Co", tin: "555666780" });
    const companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;

    const s = await post("/ap/suppliers", { name: "Profile Vendor", creditPeriodDays: 30, creditLimit: 500000, openingBalance: 50000, openingBalanceDate: "2026-06-30" });
    expect(s.status).toBe(201);
    ids.supplier = s.body.data.id;
    const ok = (res: request.Response) => {
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    };
    ids.billA = ok(await post("/ap/bills", { supplierId: ids.supplier, billDate: "2026-09-01", dueDate: "2026-09-15", net: 100000, supplierInvoiceNumber: "INV-77" }));
    ids.billB = ok(await post("/ap/bills", { supplierId: ids.supplier, billDate: "2026-11-10", dueDate: "2026-12-31", net: 40000 }));
    ids.payA = ok(await post("/ap/payments", { supplierId: ids.supplier, paymentDate: "2026-10-01", amount: 30000, reference: "TRF-1", allocations: [{ billId: ids.billA, amount: 30000 }] }));
    ids.payLoose = ok(await post("/ap/payments", { supplierId: ids.supplier, paymentDate: "2026-10-05", amount: 5000 }));
    ids.credit = ok(await post("/ap/credit-notes", { supplierId: ids.supplier, noteDate: "2026-10-10", reason: "Damaged goods", net: 8000 }));
    ids.debit = ok(await post("/ap/debit-notes", { supplierId: ids.supplier, noteDate: "2026-10-12", reason: "Freight charge", net: 3000, dueDate: "2026-12-20" }));
    ids.advance = ok(await post("/ap/advances", { supplierId: ids.supplier, advanceDate: "2026-10-20", amount: 12000 }));

    // Purchase order for 10 widgets; 4 received and billed.
    const item = await prisma.inventoryItem.create({ data: { companyId, externalProductId: "SKU-P1", name: "Widget", sku: "W1" } });
    const location = await prisma.inventoryLocation.create({ data: { companyId, externalBranchId: "B1", name: "Kigali" } });
    const po = await post("/commercial/purchase-order", { supplierId: ids.supplier, docDate: "2026-11-12", lines: [{ description: "Widgets", itemId: item.id, quantity: 10, unitPrice: 100 }] });
    ids.po = ok(po);
    ids.receipt = ok(await post("/inventory/item-receipts", { supplierId: ids.supplier, purchaseOrderId: ids.po, date: "2026-11-12", lines: [{ itemId: item.id, locationId: location.id, quantity: 4, unitCost: 100 }] }));
    const bill = await post(`/commercial/documents/${ids.po}/convert`, { target: "BILL", date: "2026-11-12" });
    expect(bill.status, JSON.stringify(bill.body)).toBe(200);
    ids.poBill = bill.body.data.converted.id;
  });

  afterAll(async () => {
    await clean(orgId);
    await clean(otherOrgId);
  });

  it("summarises the account from the subledger and posted documents", async () => {
    const res = await get(`/ap/suppliers/${ids.supplier}/summary`);
    expect(res.status).toBe(200);
    const s = res.body.data;
    // 50k opening + 100k + 40k + 400 PO bill + 3k debit note − 30k − 5k paid − 8k credit
    expect(s.outstanding).toBe(150400);
    expect(s.totalBilled).toBe(140400);
    expect(s.billCount).toBe(3);
    expect(s.totalPurchases).toBe(135400); // bills and the debit note, less the credit
    expect(s.paymentsMade).toBe(47000); // two payments and the advance
    expect(s.paymentCount).toBe(3);
    expect(s.overdue).toBe(120000); // opening (due 30 Jun) + 70k left on the September bill
    expect(s.overdueCount).toBe(2);
    expect(s.openBillCount).toBe(5); // the debit note is payable like a bill
    expect(s.partlyPaidBillCount).toBe(1);
    expect(s.availableCredit).toBe(25000);
    expect(s.credits).toEqual({ creditNotes: 8000, unappliedPayments: 5000, advances: 12000 });
    expect(s.openPurchaseOrders).toEqual({ amount: 1000, count: 1 });
    expect(s.creditHeadroom).toBe(349600);
    expect(s.debitNotesTotal).toBe(3000);
    // The ledger total and the summary agree.
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } });
    expect(Number(supplier.balance)).toBe(s.outstanding);
  });

  it("lists every document type in one list, newest first, with bill statuses", async () => {
    const res = await get(`/ap/suppliers/${ids.supplier}/transactions?pageSize=50`);
    expect(res.status).toBe(200);
    const page = res.body.data;
    expect(page.total).toBe(11);
    const types = new Set(page.rows.map((r: { type: string }) => r.type));
    expect([...types].sort()).toEqual(["ADVANCE", "BILL", "CREDIT_NOTE", "DEBIT_NOTE", "ITEM_RECEIPT", "PAYMENT", "PURCHASE_ORDER"]);
    const byId = (id: string) => page.rows.find((r: { id: string }) => r.id === id);
    expect(byId(ids.billA)).toMatchObject({ open: 70000, statusTone: "negative" });
    expect(byId(ids.billA).status).toMatch(/^Overdue \d+d$/);
    expect(byId(ids.billB)).toMatchObject({ open: 40000, status: "Unpaid" });
    expect(byId(ids.payLoose)).toMatchObject({ status: "Unapplied", open: 5000 });
    expect(byId(ids.credit)).toMatchObject({ status: "Available", open: 8000 });
    expect(byId(ids.debit)).toMatchObject({ open: 3000, status: "Unpaid" });
    expect(page.rows.filter((r: { type: string }) => r.type === "BILL")).toHaveLength(4);
    expect(byId(ids.po)).toMatchObject({ posting: false, status: "Partly received" });
    expect(byId(ids.receipt)).toMatchObject({ posting: false, status: "Billed" });
    // Purchase orders and receipts never count toward the totals.
    expect(page.totals.open).toBe(70000 + 40000 + 400 + 50000 + 3000 + 5000 + 8000 + 12000);
    const dates = page.rows.map((r: { date: string }) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("filters by type, status and date range", async () => {
    const overdue = (await get(`/ap/suppliers/${ids.supplier}/transactions?type=BILL&status=overdue`)).body.data;
    expect(overdue.total).toBe(2);
    const october = (await get(`/ap/suppliers/${ids.supplier}/transactions?from=2026-10-01&to=2026-10-31`)).body.data;
    expect(october.rows.map((r: { type: string }) => r.type).sort()).toEqual(["ADVANCE", "CREDIT_NOTE", "DEBIT_NOTE", "PAYMENT", "PAYMENT"]);
    const bad = await get(`/ap/suppliers/${ids.supplier}/transactions?type=NONSENSE`);
    expect(bad.status).toBe(400);
  });

  it("opens one payment, advance and item receipt with what they relate to", async () => {
    const pay = (await get(`/ap/transactions/PAYMENT/${ids.payA}`)).body.data;
    expect(pay).toMatchObject({ number: expect.any(String), paid: 30000, open: 0, reference: "TRF-1" });
    expect(pay.applications).toEqual([expect.objectContaining({ billId: ids.billA, amount: 30000, reference: "INV-77" })]);
    const adv = (await get(`/ap/transactions/ADVANCE/${ids.advance}`)).body.data;
    expect(adv).toMatchObject({ total: 12000, open: 12000 });
    const rec = (await get(`/ap/transactions/ITEM_RECEIPT/${ids.receipt}`)).body.data;
    expect(rec.lines).toEqual([expect.objectContaining({ quantity: 4, value: 400 })]);
    expect(rec.bill.id).toBe(ids.poBill);
  });

  it("lists credits still available to apply", async () => {
    const credits = (await get(`/ap/suppliers/${ids.supplier}/credits`)).body.data;
    expect(credits.total).toBe(25000);
    expect(credits.rows.map((r: { type: string; available: number }) => [r.type, r.available])).toEqual([
      ["PAYMENT", 5000],
      ["CREDIT_NOTE", 8000],
      ["ADVANCE", 12000],
    ]);
  });

  it("shows profile changes and postings in the activity timeline", async () => {
    await request(app).patch(`/api/v1/ap/suppliers/${ids.supplier}`).set(headers).send({ email: "ap@vendor.rw" });
    const items = (await get(`/ap/suppliers/${ids.supplier}/activity`)).body.data;
    const titles = items.map((i: { title: string }) => i.title);
    expect(titles).toContain("Supplier created");
    expect(titles).toContain("Profile updated");
    expect(titles.some((t: string) => t.startsWith("Bill posted"))).toBe(true);
    expect(items.find((i: { title: string }) => i.title === "Profile updated").detail).toBe("Changed email");
  });

  it("keeps every profile endpoint inside the organization", async () => {
    for (const path of [
      `/ap/suppliers/${ids.supplier}/summary`,
      `/ap/suppliers/${ids.supplier}/transactions`,
      `/ap/suppliers/${ids.supplier}/credits`,
      `/ap/suppliers/${ids.supplier}/activity`,
      `/ap/transactions/PAYMENT/${ids.payA}`,
      `/ap/transactions/ADVANCE/${ids.advance}`,
    ]) {
      expect((await get(path, other)).status, path).toBe(404);
    }
  });
});

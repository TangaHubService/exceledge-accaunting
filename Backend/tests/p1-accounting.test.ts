import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { rateLimit } from "../src/middleware/rate-limit";
import { publicError } from "../src/middleware/safe-errors";
import { toLocalClock } from "../src/modules/integration/integration.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96911;
let h: Record<string, string>;
let companyId: string;
let bank: string;
let till: string;
const acct: Record<string, string> = {};
const post = (url: string, body: unknown = {}, headers = h) => request(app).post(`/api/v1${url}`).set(headers).send(body as object);
const get = (url: string) => request(app).get(`/api/v1${url}`).set(h);
async function balance(code: string, from?: string, to?: string) {
  const s = await prisma.glEntry.aggregate({
    where: { companyId, account: { code }, ...(from ? { transactionDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59.999Z`) } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}
const customer = async (name: string, extra: Record<string, unknown> = {}) => (await post("/ar/customers", { name, customerType: "CREDIT", creditLimit: 1e9, ...extra })).body.data.id as string;
const invoice = async (customerId: string, date: string, net: number) => (await post("/ar/invoices", { customerId, invoiceDate: date, net })).body.data;
const integrity = async () => (await post("/books/integrity/run")).body.data;

beforeAll(async () => {
  await prisma.$connect();
  await resetCompany(orgId);
  h = await activateCompany(app, orgId, { name: "P1 Co", tin: "555444222" });
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
  await get("/tax/codes");
  bank = (await post("/banking/accounts", { kind: "BANK", name: "BK", glAccountId: acct["1110"], allowOverdraft: false, dateOpened: "2026-01-01" })).body.data.id;
  till = (await post("/banking/accounts", { kind: "CASH", name: "Till", glAccountId: acct["1100"], dateOpened: "2026-01-01" })).body.data.id;
  await post("/banking/receipts", { financialAccountId: bank, transactionDate: "2026-01-01", lines: [{ accountId: acct["3000"], amount: 5_000_000 }] });
});

describe("Dates", () => {
  it("voids in the invoice's own month by default, or on the day asked for", async () => {
    const c = await customer("Void");
    const a = await invoice(c, "2026-02-03", 1_000);
    expect((await post(`/ar/invoices/${a.id}/void`, { reason: "x" })).status).toBe(200);
    expect(await balance("4100", "2026-02-01", "2026-02-28")).toBe(0);
    const b = await invoice(c, "2026-02-03", 1_000);
    expect((await post(`/ar/invoices/${b.id}/void`, { voidDate: "2026-01-31" })).body.error).toMatch(/can't be dated before/);
    expect((await post(`/ar/invoices/${b.id}/void`, { voidDate: "2026-04-05" })).status).toBe(200);
    expect(await balance("4100", "2026-04-01", "2026-04-30")).toBe(1_000);
  });

  it("applies and refunds deposits on their own dates", async () => {
    const c = await customer("Deposit");
    const inv = await invoice(c, "2026-03-04", 500);
    const d = (await post("/ar/deposits", { customerId: c, depositDate: "2026-03-01", method: "CASH", amount: 900 })).body.data;
    expect((await post(`/ar/deposits/${d.id}/allocate`, { invoiceId: inv.id, amount: 500 })).status).toBe(200);
    expect((await post(`/ar/deposits/${d.id}/refund`, { date: "2026-03-20" })).status).toBe(200);
    expect(await balance("2120", "2026-03-01", "2026-03-31")).toBe(0);
    const actions = await prisma.auditEvent.findMany({ where: { companyId, entityType: "ArDeposit" }, select: { action: true } });
    expect(actions.map((x) => x.action).sort()).toEqual(["APPLY", "POST", "REFUND"]);
  });

  it("books ERP sales on the Kigali day", async () => {
    expect(toLocalClock(new Date("2026-02-28T22:30:00Z"), "Africa/Kigali").toISOString()).toBe("2026-03-01T00:30:00.000Z");
    expect(toLocalClock(new Date("2026-02-28T22:30:00Z"), "Nowhere/Else").toISOString()).toBe("2026-03-01T00:30:00.000Z");
    const send = (id: string, occurredAt: string) =>
      request(app).post("/api/v1/integration/events").set({ "x-integration-key": env.integrationApiKey }).send({
        eventId: id, idempotencyKey: id, externalOrganizationId: String(orgId), eventType: "SALE_COMPLETED", occurredAt, sourceModule: "POS", sourceDocumentType: "Sale", sourceDocumentId: id,
        currencyCode: "RWF", amountTotals: { gross: "100", net: "100", tax: "0" }, paymentSplits: [{ paymentMethod: "CASH", amount: 100 }],
      });
    await send("TZ-1", "2026-05-31T22:30:00.000Z");
    await send("TZ-2", "2026-05-31T00:00:00.000Z");
    expect(await balance("4100", "2026-05-01", "2026-05-31")).toBe(-100);
    expect(await balance("4100", "2026-06-01", "2026-06-30")).toBe(-100);
  });
});

describe("Reports", () => {
  it("puts disposal proceeds under investing with nothing left in operating", async () => {
    const cat = (await get("/fixed-assets/categories")).body.data.find((c: { usefulLifeMonths: number }) => c.usefulLifeMonths > 0);
    const a = (await post("/fixed-assets/assets", { name: "Van", categoryId: cat.id, acquisitionCost: 1_200_000, usefulLifeMonths: 60, purchaseDate: "2026-07-01", capitalize: true, capitalizationDate: "2026-07-01", creditAccountId: acct["1110"] })).body.data;
    expect((await post(`/fixed-assets/assets/${a.id}/dispose`, { disposalDate: "2026-08-10", disposalMethod: "SALE", proceeds: 1_300_000, proceedsAccountId: acct["1110"] })).status).toBe(200);
    const cf = (await get("/books/statements?from=2026-08-01&to=2026-08-31")).body.data.cashFlow;
    expect(cf).toMatchObject({ operating: 0, investing: 1_300_000, netChange: 1_300_000, cashChange: 1_300_000 });
  });

  it("sums the trial balance in the database, by dimension too", async () => {
    const tb = (await get("/books/trial-balance?to=2026-12-31")).body.data;
    expect(tb.difference).toBe(0);
    const bankRow = tb.rows.find((r: { code: string }) => r.code === "1110");
    expect(bankRow.debit).toBe(await balance("1110"));
    expect((await get("/books/trial-balance?costCentre=NONE")).body.data.rows).toEqual([]);
  });
});

describe("Bad debts", () => {
  it("writes off and reinstates an invoice without touching sales or giving spendable credit", async () => {
    const c = await customer("Bad");
    const inv = await invoice(c, "2026-03-05", 10_000);
    const sales = await balance("4100");
    expect((await post(`/ar/invoices/${inv.id}/write-off`, { reason: "Closed", amount: 20_000 })).body.error).toMatch(/only has/);
    const w = await post(`/ar/invoices/${inv.id}/write-off`, { reason: "Business closed", date: "2026-06-01" });
    expect(w.status).toBe(201);
    expect([await balance("6200"), await balance("4100")]).toEqual([10_000, sales]);
    expect((await post(`/ar/invoices/${inv.id}/write-off`, { reason: "Again" })).status).toBe(400);
    const app2 = await request(app).delete(`/api/v1/ar/applications/CREDIT_ON_ISSUE/${w.body.data.id}`).set(h);
    expect(app2.body.error).toMatch(/write-off/);
    expect((await post("/ar/refunds", { customerId: c, refundDate: "2026-06-02", financialAccountId: bank, sources: [{ source: "CREDIT_NOTE", sourceId: w.body.data.id, amount: 1 }] })).status).toBe(400);
    expect((await get("/ar/ageing?asOf=2026-06-30")).body.data.lines.some((l: { customerId: string }) => l.customerId === c)).toBe(false);
    expect((await post(`/ar/write-offs/${w.body.data.id}/reverse`, { date: "2026-07-01" })).status).toBe(200);
    expect(await balance("6200")).toBe(0);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).balance)).toBe(10_000);
    expect((await integrity()).errors).toBe(0);
    expect((await post(`/ar/invoices/${inv.id}/write-off`, { reason: "xyz" }, authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(403);
  });
});

describe("VAT", () => {
  it("takes the tax out of an inclusive price, to the cent", async () => {
    const c = await customer("Inclusive");
    const r = await post("/ar/invoices", { customerId: c, invoiceDate: "2026-03-05", lines: [{ description: "x", quantity: 3, unitPrice: 1_180, discount: 118, taxCode: "VAT18", taxInclusive: true }] });
    expect([Number(r.body.data.net), Number(r.body.data.tax), Number(r.body.data.gross)]).toEqual([2_900, 522, 3_422]);
    const odd = await post("/ar/invoices", { customerId: c, invoiceDate: "2026-03-05", lines: [{ description: "x", quantity: 1, unitPrice: 99.99, taxCode: "VAT18", taxInclusive: true }] });
    expect(Number(odd.body.data.gross)).toBe(99.99);
    const none = await post("/ar/invoices", { customerId: c, invoiceDate: "2026-03-05", lines: [{ description: "x", quantity: 1, unitPrice: 100, taxInclusive: true }] });
    expect(Number(none.body.data.gross)).toBe(100);
  });

  it("refuses typed tax above the highest rate, and allows part-exempt totals", async () => {
    const c = await customer("Typed");
    expect((await post("/ar/invoices", { customerId: c, invoiceDate: "2026-03-05", net: 100, tax: 5_000 })).body.error).toMatch(/more than 18%/);
    expect((await post("/ar/invoices", { customerId: c, invoiceDate: "2026-03-05", net: 100, tax: 9 })).status).toBe(201);
    const s = (await post("/ap/suppliers", { name: "Typed S" })).body.data.id;
    expect((await post("/ap/bills", { supplierId: s, billDate: "2026-03-05", net: 100, tax: 50 })).status).toBe(400);
  });
});

describe("Whole documents", () => {
  it("posts a sales receipt entirely or not at all", async () => {
    const c = await customer("Receipt", { creditLimit: 0 });
    const body = { customerId: c, date: "2026-03-06", lines: [{ description: "x", quantity: 1, unitPrice: 100, taxCode: "VAT18" }], method: "CASH" };
    const r = await post("/ar/sales-receipts", { ...body, financialAccountId: till });
    expect(r.status).toBe(201);
    expect(Number(r.body.data.invoice.amountPaid)).toBe(118);
    const n = await prisma.arInvoice.count({ where: { companyId } });
    expect((await post("/ar/sales-receipts", { ...body, financialAccountId: "missing" })).status).toBeGreaterThanOrEqual(400);
    expect(await prisma.arInvoice.count({ where: { companyId } })).toBe(n);
  });

  it("undoes the deposit when its cash back can't be recorded", async () => {
    const n = await prisma.bankTransaction.count({ where: { companyId } });
    const body = { financialAccountId: bank, transactionDate: "2026-03-07", lines: [{ accountId: acct["4200"], amount: 50 }] };
    expect((await post("/banking/receipts", { ...body, cashBack: { toAccountId: "missing", amount: 10 } })).status).toBe(400);
    expect(await prisma.bankTransaction.count({ where: { companyId } })).toBe(n);
    expect((await post("/banking/receipts", { ...body, cashBack: { toAccountId: till, amount: 10 } })).status).toBe(201);
    expect(await prisma.bankTransaction.count({ where: { companyId } })).toBe(n + 2);
  });

  it("holds a bill sent for approval until someone else approves it", async () => {
    const s = (await post("/ap/suppliers", { name: "Held S" })).body.data.id;
    const ap = await balance("2100");
    const b = (await post("/ap/bills", { supplierId: s, billDate: "2026-03-05", net: 700, requireApproval: true })).body.data;
    expect(b.status).toBe("PENDING_APPROVAL");
    expect(await balance("2100")).toBe(ap);
    const own = await post(`/books/approvals/${b.approval.id}/decide`, { status: "APPROVED" });
    expect(own.status).toBeGreaterThanOrEqual(400);
    expect((await post(`/books/approvals/${b.approval.id}/decide`, { status: "APPROVED" }, authHeaders(orgId, "ADMIN", 999))).status).toBe(200);
    expect(await balance("2100")).toBe(ap - 700);
  });
});

describe("Controls", () => {
  it("won't let posted ledger rows or journals be altered or deleted in SQL", async () => {
    const e = await prisma.glEntry.findFirstOrThrow({ where: { companyId } });
    await expect(prisma.glEntry.update({ where: { id: e.id }, data: { debit: 999 } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.glEntry.update({ where: { id: e.id }, data: { accountId: acct["6140"] } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.glEntry.delete({ where: { id: e.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.journal.delete({ where: { id: e.journalId } })).rejects.toThrow();
    await expect(prisma.journal.update({ where: { id: e.journalId }, data: { journalDate: new Date() } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.glEntry.create({ data: { ...e, id: randomUUID(), debit: 5, credit: 5 } as never })).rejects.toThrow();
  });

  it("still lets a whole company be deleted", async () => {
    const other = orgId + 5;
    await resetCompany(other);
    const oh = await activateCompany(app, other, { name: "Gone", tin: "555444111" });
    const id = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(other) } })).id;
    const [a, b] = await prisma.account.findMany({ where: { companyId: id, code: { in: ["6140", "3030"] } } });
    expect((await post("/journals", { journalDate: "2026-02-01", postImmediately: true, lines: [{ accountId: a.id, debit: 1, credit: 0 }, { accountId: b.id, debit: 0, credit: 1 }] }, oh)).status).toBe(201);
    await resetCompany(other);
    expect(await prisma.company.count({ where: { id } })).toBe(0);
  });

  it("gives a company its own integration key, and then refuses the shared one", async () => {
    const event = (id: string, key: string, org = orgId) =>
      request(app).post("/api/v1/integration/events").set({ "x-integration-key": key }).send({ eventId: id, idempotencyKey: id, externalOrganizationId: String(org), eventType: "SALE_COMPLETED", occurredAt: "2026-03-01T09:00:00Z", sourceModule: "POS", sourceDocumentType: "Sale", sourceDocumentId: id, currencyCode: "RWF", amountTotals: { gross: "1", net: "1", tax: "0" }, paymentSplits: [{ paymentMethod: "CASH", amount: 1 }] });
    expect((await post("/integration/key", {}, authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(403);
    const key = (await post("/integration/key")).body.data.token as string;
    expect((await event("K1", env.integrationApiKey)).status).toBe(401);
    expect((await event("K2", key)).status).toBe(201);
    expect((await event("K3", key, orgId + 77)).status).toBe(401);
    expect(JSON.stringify((await get("/integration/key")).body)).not.toContain(key);
    expect((await request(app).delete("/api/v1/integration/key").set(h)).status).toBe(200);
    expect((await event("K4", key)).status).toBe(401);
    expect((await event("K5", env.integrationApiKey)).status).toBe(201);
  });

  it("reports stock below zero", async () => {
    const r = await request(app).post("/api/v1/integration/events").set({ "x-integration-key": env.integrationApiKey }).send({
      eventId: "NS", idempotencyKey: "NS", externalOrganizationId: String(orgId), externalBranchId: "1", eventType: "INVENTORY_MOVEMENT", occurredAt: "2026-03-01T09:00:00Z", sourceModule: "INVENTORY", sourceDocumentType: "InventoryLedger", sourceDocumentId: "NS", currencyCode: "RWF", amountTotals: { gross: "0", net: "0", tax: "0" },
      metadata: { ledgerId: 1, movementType: "SALE", direction: "OUT", productId: 9, productName: "Soap", sku: "SO", quantity: 2, runningBalance: -2, unitCost: 10, branchName: "Main" },
    });
    expect(r.status).toBe(201);
    expect((await integrity()).findings.some((f: { check: string }) => f.check === "NEGATIVE_STOCK")).toBe(true);
    expect(await prisma.notification.count({ where: { companyId, title: "Stock below zero" } })).toBe(1);
  });

  it("never shows database text or file paths in an error", async () => {
    const c = await customer("Leak");
    const bad = await post("/ar/invoices", { customerId: c, invoiceDate: "not-a-date", net: 5 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).not.toMatch(/prisma|\/Users\/|node_modules/i);
    expect((await post("/ar/invoices", { customerId: c, invoiceDate: "2026-03-01", net: -5 })).body.error).toMatch(/^net: /);
    expect(publicError("Invoice does not exist")).toBe("Invoice does not exist");
  });

  it("limits how often one caller may ask", async () => {
    const small = express();
    small.use(rateLimit(3));
    small.get("/", (_q, r) => void r.json({ success: true }));
    const call = (token: string) => request(small).get("/").set("Authorization", token);
    for (let i = 0; i < 3; i++) expect((await call("a")).status).toBe(200);
    const over = await call("a");
    expect(over.status).toBe(429);
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
    expect((await call("b")).status).toBe(200);
  });

  it("audits receipts", async () => {
    const c = await customer("Audited");
    const r = (await post("/ar/receipts", { customerId: c, receiptDate: "2026-03-01", method: "CASH", amount: 5 })).body.data;
    expect(await prisma.auditEvent.count({ where: { companyId, entityType: "ArReceipt", entityId: r.id, action: "POST" } })).toBe(1);
  });
});

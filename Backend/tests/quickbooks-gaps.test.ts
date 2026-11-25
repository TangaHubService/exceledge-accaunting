import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { sentMail } from "../src/lib/mailer";
import { prisma } from "../src/lib/prisma";
import { lowStockAlert, runCollections } from "../src/modules/books/collections.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96931;
let h: Record<string, string>;
let companyId: string;
let bank: string;
const acct: Record<string, string> = {};
const post = (url: string, body: unknown = {}, headers = h) => request(app).post(`/api/v1${url}`).set(headers).send(body as object);
const put = (url: string, body: unknown) => request(app).put(`/api/v1${url}`).set(h).send(body as object);
const get = (url: string, headers = h) => request(app).get(`/api/v1${url}`).set(headers);
const customer = async (name: string, extra = {}) => (await post("/ar/customers", { name, customerType: "CREDIT", creditLimit: 1e9, creditPeriodDays: 0, ...extra })).body.data.id as string;
const line = (unitPrice: number, extra = {}) => [{ description: "Goods", quantity: 1, unitPrice, ...extra }];
const invoice = async (customerId: string, invoiceDate: string, lines: unknown, extra = {}) => (await post("/ar/invoices", { customerId, invoiceDate, lines, ...extra })).body.data;
const receipt = (customerId: string, date: string, amount: number, invoiceId?: string) =>
  post("/ar/receipts", { customerId, receiptDate: date, method: "BANK", amount, financialAccountId: bank, ...(invoiceId ? { allocations: [{ invoiceId, amount }] } : {}) });
const cash = async (from: string, to: string) => (await get(`/books/cash-basis?from=${from}&to=${to}`)).body.data;
const accrual = async (from: string, to: string) => (await get(`/books/statements?from=${from}&to=${to}`)).body.data.income.profit as number;
const balance = async (code: string) => {
  const s = await prisma.glEntry.aggregate({ where: { companyId, account: { code } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
};
const errors = async () => (await post("/books/integrity/run")).body.data.errors;

beforeAll(async () => {
  await prisma.$connect();
  await resetCompany(orgId);
  h = await activateCompany(app, orgId, { name: "Gaps Co", tin: "555444999" });
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
  await get("/tax/codes");
  bank = (await post("/banking/accounts", { kind: "BANK", name: "BK", glAccountId: acct["1110"], dateOpened: "2026-01-01" })).body.data.id;
});

describe("Cash basis", () => {
  it("brings in each document's share when it is settled, and equals accrual once all is settled", async () => {
    const c = await customer("Cash A");
    const inv = await invoice(c, "2026-01-10", line(1_000, { taxCode: "VAT18" }));
    expect((await cash("2026-01-01", "2026-01-31")).totals.profit).toBe(0);
    await receipt(c, "2026-02-05", 590, inv.id);
    expect((await cash("2026-02-01", "2026-02-28")).totals.income).toBe(500);
    const s = (await post("/ap/suppliers", { name: "Cash S" })).body.data.id;
    const bill = (await post("/ap/bills", { supplierId: s, billDate: "2026-01-15", net: 300 })).body.data;
    await post("/ap/payments", { supplierId: s, paymentDate: "2026-02-10", method: "BANK", amount: 300, financialAccountId: bank, allocations: [{ billId: bill.id, amount: 300 }] });
    expect((await cash("2026-02-01", "2026-02-28")).totals.profit).toBe(200);
    await receipt(c, "2026-03-05", 590, inv.id);
    expect((await cash("2026-01-01", "2026-03-31")).totals.profit).toBe(await accrual("2026-01-01", "2026-03-31"));
  });

  it("handles unapplied money, credits, refunds, write-offs, voids, edits and reversals", async () => {
    const c = await customer("Cash B");
    await receipt(c, "2026-04-02", 50);
    expect((await cash("2026-04-01", "2026-04-30")).income.at(-1)).toMatchObject({ name: "Payments received, not applied yet", amount: 50 });
    const a = await invoice(c, "2026-05-01", line(100));
    const r = (await receipt(c, "2026-05-05", 100, a.id)).body.data;
    await post(`/ar/receipts/${r.id}/reverse`, { reversalDate: "2026-06-01" });
    const may = (await cash("2026-05-01", "2026-05-31")).totals.income;
    expect(may).toBe(100);
    expect((await post(`/ar/invoices/${a.id}/write-off`, { reason: "gone", date: "2026-07-01" })).status).toBe(201);
    expect((await cash("2026-07-01", "2026-07-31")).totals.profit).toBe(0);
    const v = await invoice(c, "2026-08-01", line(77));
    await post(`/ar/invoices/${v.id}/void`, { reason: "x" });
    expect((await cash("2026-08-01", "2026-08-31")).totals.profit).toBe(0);
    const n = (await post("/ar/credit-notes", { customerId: c, noteDate: "2026-08-02", reason: "x", lines: line(40) })).body.data;
    expect((await cash("2026-08-01", "2026-08-31")).totals.income).toBe(0);
    await post("/ar/refunds", { customerId: c, refundDate: "2026-09-03", financialAccountId: bank, sources: [{ source: "CREDIT_NOTE", sourceId: n.id, amount: 40 }] });
    expect((await cash("2026-09-01", "2026-09-30")).totals.income).toBe(-40);
  });
});

describe("Cash basis with ERP sales", () => {
  let n = 0;
  const event = (eventType: string, occurredAt: string, gross: number, method: string, extra: Record<string, unknown> = {}) =>
    request(app).post("/api/v1/integration/events").set({ "x-integration-key": env.integrationApiKey }).send({
      eventId: `cb${++n}`, idempotencyKey: `cb-${orgId}-${n}`, externalOrganizationId: String(orgId), eventType, occurredAt, sourceModule: "POS", sourceDocumentType: eventType === "SALE_COMPLETED" ? "Sale" : "SaleReturn", sourceDocumentId: `cb${n}`,
      currencyCode: "RWF", amountTotals: { gross: String(gross), net: String(gross), tax: "0" }, parties: { externalCustomerId: "77" }, paymentSplits: [{ paymentMethod: method, amount: gross }], metadata: { paymentType: method, ...extra },
    });
  it("counts a credit sale returned before payment as nothing, whole or part", async () => {
    const sale = (await event("SALE_COMPLETED", "2026-09-10T09:00:00Z", 100, "CREDIT")).body.data;
    const before = (await cash("2026-09-01", "2026-10-31")).totals.income;
    const back = await event("SALES_RETURN_COMPLETED", "2026-10-03T09:00:00Z", 40, "CREDIT", { saleId: sale.event.sourceDocumentId });
    expect(back.body.data.error).toBeUndefined();
    expect((await cash("2026-09-01", "2026-10-31")).totals.income).toBe(before);
    expect((await cash("2026-10-01", "2026-10-31")).totals.income).toBe(0);
  });
  it("counts a cash sale and its cash refund on their own days", async () => {
    const start = (await cash("2026-09-01", "2026-09-30")).totals.income;
    const sale = (await event("SALE_COMPLETED", "2026-09-12T09:00:00Z", 70, "CASH")).body.data;
    expect((await cash("2026-09-01", "2026-09-30")).totals.income).toBe(start + 70);
    await event("SALE_REFUNDED", "2026-10-04T09:00:00Z", 70, "CASH", { saleId: sale.event.sourceDocumentId });
    expect((await cash("2026-09-01", "2026-09-30")).totals.income).toBe(start + 70);
    expect((await cash("2026-10-01", "2026-10-31")).totals.income).toBe(-70);
    const aged = (await get("/ar/ageing?asOf=2026-09-30")).body.data.lines.filter((l: { invoiceNumber: string }) => l.invoiceNumber === sale.event.sourceDocumentId);
    expect(aged).toEqual([]);
  });
});

describe("Editing an invoice", () => {
  it("corrects it under the same number, with the ledger, VAT, ageing and customer all in step", async () => {
    const c = await customer("Edit");
    const inv = await invoice(c, "2026-03-03", line(1_000, { taxCode: "VAT18" }));
    const [ar, vat, sales] = [await balance("1200"), await balance("2200"), await balance("4100")];
    const r = await put(`/ar/invoices/${inv.id}`, { invoiceDate: "2026-03-04", lines: line(600, { taxCode: "VAT18" }) });
    expect(r.status).toBe(200);
    expect(r.body.data.invoiceNumber).toBe(inv.invoiceNumber);
    expect([await balance("1200"), await balance("2200"), await balance("4100")]).toEqual([ar - 472, vat + 72, sales + 400]);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).balance)).toBe(708);
    const aged = (await get("/ar/ageing?asOf=2026-03-31")).body.data;
    expect(aged.lines.filter((l: { customerId: string }) => l.customerId === c).map((l: { outstanding: number }) => l.outstanding)).toEqual([708]);
    expect((await put(`/ar/invoices/${inv.id}`, { invoiceDate: "2026-03-04", lines: line(1), updatedAt: inv.updatedAt })).body.error).toMatch(/changed by someone else/);
    expect(await prisma.auditEvent.count({ where: { companyId, entityId: inv.id, action: "UPDATE" } })).toBe(1);
    expect(await errors()).toBe(0);
  });

  it("refuses paid, voided and closed-period invoices, and leaves nothing behind", async () => {
    const c = await customer("Edit no");
    const paid = await invoice(c, "2026-03-03", line(100));
    await receipt(c, "2026-03-04", 10, paid.id);
    expect((await put(`/ar/invoices/${paid.id}`, { invoiceDate: "2026-03-03", lines: line(5) })).body.error).toMatch(/Remove the payments/);
    const inv = await invoice(c, "2026-03-03", line(100));
    const n = await prisma.journal.count({ where: { companyId } });
    expect((await put(`/ar/invoices/${inv.id}`, { invoiceDate: "2027-03-03", lines: line(5) })).status).toBe(400);
    expect((await put(`/ar/invoices/${inv.id}`, { invoiceDate: "2026-03-03", lines: line(5, { accountId: acct["1200"] }) })).status).toBe(400);
    expect(await prisma.journal.count({ where: { companyId } })).toBe(n);
    await post(`/ar/invoices/${inv.id}/void`, {});
    expect((await put(`/ar/invoices/${inv.id}`, { invoiceDate: "2026-03-03", lines: line(5) })).body.error).toMatch(/void/);
    expect((await request(app).put(`/api/v1/ar/invoices/${paid.id}`).set(authHeaders(orgId + 1)).send({ invoiceDate: "2026-03-03", lines: line(5) })).status).toBeGreaterThanOrEqual(400);
  });

  it("lets only one of an edit and a payment through", async () => {
    const c = await customer("Edit race");
    const inv = await invoice(c, "2026-03-03", line(100));
    const [e, p] = await Promise.all([put(`/ar/invoices/${inv.id}`, { invoiceDate: "2026-03-03", lines: line(60) }), receipt(c, "2026-03-04", 100, inv.id)]);
    expect([e.status === 200, p.status === 201].filter(Boolean).length).toBe(1);
    expect(await errors()).toBe(0);
  });
});

describe("Reminders and late fees", () => {
  const settings = (values: Record<string, unknown>) => put("/workspace/records/settings/sales-reminders", { values });
  const on = (d: string) => new Date(`${d}T06:00:00Z`);

  it("does nothing until switched on", async () => {
    expect(await runCollections(companyId, on("2026-03-10"))).toEqual({ reminders: 0, lateFees: 0, failed: 0 });
  });

  it("sends each reminder once, only near its day, and never for paid invoices", async () => {
    const c = await customer("Remind", { email: "remind@example.com" });
    const inv = await invoice(c, "2026-10-01", line(100), { dueDate: "2026-10-01" });
    expect((await settings({ enabled: true, days: "3, 10" })).status).toBe(200);
    const mine = () => prisma.invoiceAction.findMany({ where: { invoiceId: inv.id, kind: "REMINDER" }, orderBy: { day: "asc" } });
    await runCollections(companyId, on("2026-10-03"));
    expect(await mine()).toHaveLength(0);
    const before = sentMail.length;
    await Promise.all([runCollections(companyId, on("2026-10-05")), runCollections(companyId, on("2026-10-05"))]);
    expect((await mine()).map((m) => [m.day, m.status])).toEqual([[3, "SENT"]]);
    expect(sentMail.length).toBe(before + 1);
    await runCollections(companyId, on("2026-10-12"));
    expect((await mine()).map((m) => m.day)).toEqual([3, 10]);
    const old = await invoice(c, "2026-03-01", line(5), { dueDate: "2026-03-01" });
    await runCollections(companyId, on("2026-10-13"));
    expect(await prisma.invoiceAction.count({ where: { invoiceId: old.id } })).toBe(0);
  });

  it("tries a failed reminder again, but not one it can't be sure about", async () => {
    const c = await customer("Retry mail", { email: "retry@example.com" });
    const inv = await invoice(c, "2026-10-01", line(100), { dueDate: "2026-10-01" });
    const action = await prisma.invoiceAction.create({ data: { companyId, invoiceId: inv.id, kind: "REMINDER", day: 3, status: "SKIPPED" } });
    await runCollections(companyId, on("2026-10-05"));
    expect((await prisma.invoiceAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("SKIPPED");
    await prisma.invoiceAction.update({ where: { id: action.id }, data: { status: "FAILED" } });
    await runCollections(companyId, on("2026-10-06"));
    expect((await prisma.invoiceAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("SENT");
  });

  it("charges one late fee, and not on a late fee", async () => {
    const c = await customer("Fee");
    const inv = await invoice(c, "2026-10-01", line(1_000), { dueDate: "2026-10-01" });
    await settings({ enabled: false, lateFee: true, lateFeeType: "Percent of balance", lateFeeValue: "5", lateFeeGrace: "10" });
    await runCollections(companyId, on("2026-10-09"));
    await Promise.all([runCollections(companyId, on("2026-10-12")), runCollections(companyId, on("2026-10-12"))]);
    await runCollections(companyId, on("2026-10-13"));
    const fees = await prisma.arInvoice.findMany({ where: { companyId, customerId: c, description: `Late fee on ${inv.invoiceNumber}` } });
    expect(fees.map((f) => Number(f.gross))).toEqual([50]);
    await runCollections(companyId, on("2026-10-24"));
    expect(await prisma.arInvoice.count({ where: { companyId, customerId: c } })).toBe(2);
    await settings({ lateFee: true, lateFeeType: "Percent of balance", lateFeeValue: "500" });
    expect(await runCollections(companyId, on("2026-10-12"))).toMatchObject({ lateFees: 0 });
    await settings({ enabled: false, lateFee: false });
  });

  it("names low stock once a day", async () => {
    const item = await prisma.inventoryItem.create({ data: { companyId, name: "Candles", type: "INVENTORY", reorderPoint: 5 } });
    expect(await lowStockAlert(companyId, new Date())).toBe(1);
    await lowStockAlert(companyId, new Date());
    expect(await prisma.notification.count({ where: { companyId, title: "Low stock" } })).toBe(1);
    await prisma.inventoryItem.delete({ where: { id: item.id } });
  });
});

describe("Reports and estimates", () => {
  it("answers every listed report, checks permission and ties sales to the ledger", async () => {
    const slugs = ["estimates-by-customer", "open-purchase-order-list", "open-purchase-order-detail", "sales-by-product-service-detail", "sales-by-product-service-summary", "sales-by-customer-type-detail", "product-item-profitability-by-customer", "project-profitability-summary", "time-activities-by-employee-detail", "recent-edited-time-activities", "time-summary-by-pay-type", "unbilled-time", "unbilled-charges", "statement-list"];
    for (const slug of slugs) {
      const r = await get(`/books/detail-reports/${slug}?from=2026-01-01&to=2026-12-31`);
      expect(r.status, slug).toBe(200);
      expect(r.body.data.columns.length, slug).toBeGreaterThan(1);
    }
    expect((await get("/books/detail-reports/constructor")).status).toBe(404);
    expect((await get("/books/detail-reports/unbilled-time", authHeaders(orgId, "SELLER"))).status).toBe(403);
    const total = (await get("/books/detail-reports/sales-by-product-service-summary?from=2026-01-01&to=2026-12-31")).body.data.rows.reduce((s: number, r: { net: number }) => s + r.net, 0);
    const invoiced = await prisma.arInvoice.aggregate({ where: { companyId, status: "POSTED" }, _sum: { net: true } });
    expect(total).toBeCloseTo(Number(invoiced._sum.net), 2);
  });

  it("groups sales by the item sold and refuses another company's item", async () => {
    const item = (await post("/inventory/items", { name: "Consulting", type: "SERVICE", purchaseCost: 10 })).body.data;
    const c = await customer("Items");
    expect((await post("/ar/invoices", { customerId: c, invoiceDate: "2026-11-02", lines: line(90, { itemId: item.id, description: "Hour of advice" }) })).status).toBe(201);
    expect((await post("/ar/invoices", { customerId: c, invoiceDate: "2026-11-02", lines: line(90, { itemId: "nope" }) })).status).toBe(400);
    const rows = (await get("/books/detail-reports/sales-by-product-service-summary?from=2026-11-01&to=2026-11-30")).body.data.rows;
    expect(rows.find((r: { product: string }) => r.product === "Consulting")).toMatchObject({ quantity: 1, net: 90 });
  });

  it("takes VAT out of an estimate's inclusive price and keeps it when invoiced", async () => {
    const c = await customer("Estimate");
    const e = await post("/commercial/estimate", { customerId: c, docDate: "2026-11-03", discountPct: 10, lines: line(1_180, { taxCode: "VAT18", taxInclusive: true }) });
    expect([Number(e.body.data.net), Number(e.body.data.tax), Number(e.body.data.total)]).toEqual([900, 162, 1_062]);
    const conv = await post(`/commercial/documents/${e.body.data.id}/convert`, { target: "INVOICE", date: "2026-11-04" });
    const inv = await prisma.arInvoice.findUniqueOrThrow({ where: { id: conv.body.data.converted.id } });
    expect(Number(inv.gross)).toBe(1_062);
  });
});

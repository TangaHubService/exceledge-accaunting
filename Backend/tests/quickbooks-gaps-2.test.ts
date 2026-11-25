import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { sentMail } from "../src/lib/mailer";
import { prisma } from "../src/lib/prisma";
import { monthEnd, portion, runSpreads } from "../src/modules/books/spread.service";
import { runBackup } from "../src/modules/platform/backup.service";
import { invoicePdf } from "../src/modules/print/print.service";
import { runWorkflowRules } from "../src/modules/workspace/workflow-rules.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96941;
let h: Record<string, string>;
let seller: Record<string, string>;
let companyId: string;
const acct: Record<string, string> = {};
const post = (url: string, body: unknown = {}, headers = h) => request(app).post(`/api/v1${url}`).set(headers).send(body as object);
const put = (url: string, body: unknown, headers = h) => request(app).put(`/api/v1${url}`).set(headers).send(body as object);
const get = (url: string, headers = h) => request(app).get(`/api/v1${url}`).set(headers);
const customer = async (name: string, extra = {}) => (await post("/ar/customers", { name, customerType: "CREDIT", creditLimit: 1e9, ...extra })).body.data.id as string;
const invoice = async (customerId: string, amount: number) => (await post("/ar/invoices", { customerId, invoiceDate: "2026-03-10", lines: [{ description: "Goods", quantity: 1, unitPrice: amount }] })).body.data;
const balance = async (code: string) => {
  const s = await prisma.glEntry.aggregate({ where: { companyId, account: { code } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
};
const errors = async () => (await post("/books/integrity/run")).body.data.errors;

beforeAll(async () => {
  await prisma.$connect();
  await resetCompany(orgId);
  h = await activateCompany(app, orgId, { name: "Gaps Two", tin: "555444998" });
  seller = authHeaders(orgId, "SELLER", 777);
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
});

describe("Prepaid, deferred and accrual schedules", () => {
  let id: string;

  it("splits to the cent and lands on month ends", () => {
    const parts = [1, 2, 3].map((n) => portion(100, 3, n));
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(monthEnd(new Date("2026-01-31T00:00:00Z"), 2).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("posts each due month once, and finishes at exactly the total", async () => {
    const debit = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } })).id;
    const made = await post("/books/spread", { kind: "PREPAID", name: "Insurance", debitAccountId: debit, creditAccountId: acct["1240"], total: 100, months: 3, startDate: "2026-01-15" });
    expect(made.status).toBe(201);
    id = made.body.data.id;
    expect(await runSpreads(companyId, new Date("2026-02-27T12:00:00Z"))).toEqual({ posted: 1, failed: 0 });
    await Promise.all([runSpreads(companyId, new Date("2026-03-01")), runSpreads(companyId, new Date("2026-03-01"))]);
    expect(await balance("1240")).toBe(-66.66);
    await runSpreads(companyId, new Date("2026-09-01"));
    expect(await balance("1240")).toBe(-100);
    expect((await get("/books/spread")).body.data.find((s: { id: string }) => s.id === id)).toMatchObject({ status: "DONE", posted: 100, remaining: 0 });
    expect(await errors()).toBe(0);
  });

  it("waits while a period is closed, says why, then catches up", async () => {
    const debit = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } })).id;
    const made = (await post("/books/spread", { kind: "PREPAID", name: "Licence", debitAccountId: debit, creditAccountId: acct["1240"], total: 60, months: 2, startDate: "2026-04-01" })).body.data.id;
    const period = await prisma.accountingPeriod.findFirstOrThrow({ where: { financialYear: { companyId }, startDate: { lte: new Date("2026-04-15") }, endDate: { gte: new Date("2026-04-15") } } });
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED" } });
    expect(await runSpreads(companyId, new Date("2026-05-31"))).toEqual({ posted: 0, failed: 1 });
    await runSpreads(companyId, new Date("2026-05-31"));
    expect(await prisma.notification.count({ where: { companyId, entityType: "SpreadSchedule", entityId: made } })).toBe(1);
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status } });
    expect(await runSpreads(companyId, new Date("2026-05-31"))).toEqual({ posted: 2, failed: 0 });
  });

  it("refuses control, wrong-sided and other companies' accounts, and stops when told", async () => {
    const debit = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } })).id;
    const body = { kind: "PREPAID", name: "X", debitAccountId: debit, creditAccountId: acct["1240"], total: 90, months: 3, startDate: "2026-06-01" };
    const { accountsReceivableId } = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
    expect((await post("/books/spread", { ...body, creditAccountId: accountsReceivableId })).status).toBe(400);
    expect((await post("/books/spread", { ...body, creditAccountId: acct["2140"] })).status).toBe(400);
    expect((await post("/books/spread", { ...body, debitAccountId: "nope" })).status).toBe(400);
    expect((await post("/books/spread", body, seller)).status).toBe(403);
    const s = (await post("/books/spread", body)).body.data.id;
    expect((await post(`/books/spread/${s}/stop`)).status).toBe(200);
    await runSpreads(companyId, new Date("2026-12-31"));
    expect(await prisma.spreadPosting.count({ where: { scheduleId: s } })).toBe(0);
    expect((await post(`/books/spread/${s}/stop`)).status).toBe(400);
  });
});

describe("Opening invoices and bills from another system", () => {
  it("checks without saving, then posts each document and keeps the subledgers level", async () => {
    const c = await customer("Kigali Shop");
    const s = (await post("/ap/suppliers", { name: "Musanze Mill" })).body.data.id;
    const rows = [
      { name: "kigali shop", number: "QB-1", date: "2026-01-05", dueDate: "2026-02-05", amount: 1180 },
      { name: "Kigali Shop", number: "QB-2", date: "2026-01-06", amount: -180 },
      { name: "Nobody", number: "QB-3", date: "2026-01-06", amount: 5 },
      { name: "Kigali Shop", number: "QB-1", date: "2026-01-06", amount: 5 },
    ];
    const dry = (await post("/setup/open-items", { side: "customers", dryRun: true, rows })).body.data;
    expect(dry).toMatchObject({ dryRun: true, total: 4, succeeded: 2, failed: 2, amount: 1000 });
    expect(await prisma.arInvoice.count({ where: { companyId, customerId: c } })).toBe(0);
    const vat = await prisma.glEntry.count({ where: { companyId, account: { isTaxAccount: true } } });
    const real = (await post("/setup/open-items", { side: "customers", rows })).body.data;
    expect(real).toMatchObject({ succeeded: 2, failed: 2 });
    expect((await post("/setup/open-items", { side: "customers", rows })).body.data.succeeded).toBe(0);
    expect((await post("/setup/open-items", { side: "suppliers", rows: [
      { name: "Musanze Mill", number: "B-1", date: "2026-01-07", amount: 500 },
      { name: "Musanze Mill", number: "B-2", date: "2026-01-08", amount: -100 },
    ] })).body.data.succeeded).toBe(2);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).balance)).toBe(1000);
    expect(Number((await prisma.supplier.findUniqueOrThrow({ where: { id: s } })).balance)).toBe(400);
    expect(await prisma.glEntry.count({ where: { companyId, account: { isTaxAccount: true } } })).toBe(vat);
    const ageing = (await get("/ar/ageing?asOf=2026-01-31")).body.data;
    expect(ageing.total).toBe(1000);
    expect((await get("/books/cash-basis?from=2026-01-01&to=2026-01-31")).body.data.totals.profit).toBe(-33.33); // only January of the insurance above
    expect(await errors()).toBe(0);
  });

  it("posts an open invoice once when two people import the same file together", async () => {
    const c = await customer("Race Co");
    const send = () => post("/setup/open-items", { side: "customers", rows: [{ name: "Race Co", number: "R-1", date: "2026-01-05", amount: 70 }, { name: "Race Co", number: "R-2", date: "2026-01-05", amount: -20 }] });
    await Promise.all([send(), send(), send()]);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).balance)).toBe(50);
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "CustomerOpening", sourceDocumentId: c } })).toBe(2);
  });

  it("needs both setup and posting rights", async () => {
    expect((await post("/setup/open-items", { side: "customers", rows: [{ name: "Kigali Shop", number: "Z", date: "2026-01-05", amount: 1 }] }, seller)).status).toBe(403);
  });
});

describe("Custom fields and invoice wording", () => {
  it("keeps, checks and prints values", async () => {
    const c = await customer("Field Co");
    const inv = await invoice(c, 1000);
    const make = async (body: object) => (await post("/workspace/custom-fields", { entityType: "ArInvoice", ...body })).body.data?.id as string;
    const site = await make({ name: "Delivery site", type: "TEXT", showOnForm: true });
    expect((await post("/workspace/custom-fields", { entityType: "ArInvoice", name: "Delivery site", type: "TEXT" })).status).toBe(409);
    const grade = await make({ name: "Grade", type: "LIST", options: ["A", "B"] });
    const url = `/workspace/custom-values/ArInvoice/${inv.id}`;
    expect((await put(url, { [site]: "Gisozi", [grade]: "C" })).status).toBe(400);
    expect((await get(url)).body.data.map((f: { value: string }) => f.value)).toEqual(["", ""]);
    expect((await put(url, { [site]: "Gisozi", [grade]: "A" })).status).toBe(200);
    await put("/workspace/records/settings/form-style", { id: "form-style", values: { heading: "Invoice", message: "Thank you for buying", hideDiscount: true } });
    await put("/workspace/records/settings/sales-payments", { id: "sales-payments", values: { instructions: "Pay to BK 000" } });
    const pdf = (await invoicePdf(companyId, inv.id)).pdf.toString("latin1");
    for (const s of ["Delivery site", "Gisozi", "Thank you for buying", "Pay to BK 000"]) expect(pdf).toContain(s);
    expect(pdf).not.toContain("Tax invoice");
    expect(pdf).not.toContain("Discount");
    expect(pdf).not.toContain("Grade");
    expect((await put(`/workspace/custom-fields/${site}`, { entityType: "ArInvoice", name: "Delivery site", type: "NUMBER" })).status).toBe(409);
    expect((await put(`/workspace/custom-values/ArInvoice/nope`, { [site]: "x" })).status).toBe(404);
    expect((await post("/workspace/custom-fields", { entityType: "ArInvoice", name: "Q", type: "TEXT" }, seller)).status).toBe(403);
  });
});

describe("Workflow rules", () => {
  it("acts once for each event over the amount, and not on the past", async () => {
    const c = await customer("Rule Co");
    await invoice(c, 9_000);
    expect((await post("/workspace/rules", { name: "Bad", trigger: "INVOICE_POSTED", action: "EMAIL", target: "a@b.rw, c@d.rw" })).status).toBe(400);
    const rule = (await post("/workspace/rules", { name: "Big sale", trigger: "INVOICE_POSTED", minAmount: 5_000, action: "EMAIL", target: "boss@example.rw", message: "Have a look" })).body.data.id;
    await post("/workspace/rules", { name: "Voided", trigger: "INVOICE_VOIDED", minAmount: 5_000, action: "NOTIFY", target: "ACCOUNTANT" });
    const big = await invoice(c, 6_000);
    await invoice(c, 100);
    await post(`/ar/invoices/${big.id}/void`, { reason: "Wrong customer", date: "2026-03-11" });
    const at = sentMail.length;
    await Promise.all([runWorkflowRules(companyId), runWorkflowRules(companyId)]);
    await runWorkflowRules(companyId);
    const mails = sentMail.slice(at);
    expect(mails).toHaveLength(1);
    expect(JSON.stringify(mails[0])).toContain("boss@example.rw");
    expect(await prisma.workflowRuleRun.count({ where: { ruleId: rule, status: "SENT" } })).toBe(1);
    expect(await prisma.notification.findMany({ where: { companyId, title: "Voided" } })).toHaveLength(1);
    expect((await get("/workspace/rules", seller)).status).toBe(403);
  });

  it("compares amounts in the company's currency", async () => {
    const c = await customer("Dollar Co");
    const inv = await invoice(c, 200);
    await prisma.arInvoice.update({ where: { id: inv.id }, data: { exchangeRate: 1300 } });
    const rule = (await post("/workspace/rules", { name: "Dollar", trigger: "INVOICE_POSTED", minAmount: 100_000, action: "NOTIFY", target: "ADMIN" })).body.data.id;
    await prisma.workflowRule.update({ where: { id: rule }, data: { activeFrom: new Date(Date.now() - 60_000) } });
    await runWorkflowRules(companyId);
    expect(await prisma.workflowRuleRun.count({ where: { ruleId: rule, status: "SENT" } })).toBe(1);
    await prisma.arInvoice.update({ where: { id: inv.id }, data: { exchangeRate: 1 } });
  });
});

describe("Receipt inbox", () => {
  it("turns a receipt into one draft expense and moves the file", async () => {
    env.documentStorageDir = mkdtempSync(path.join(tmpdir(), "inbox-"));
    const item = (await post("/expenses/inbox", { note: "Fuel" })).body.data.id;
    const up = await request(app).post("/api/v1/books/documents/upload").set(h).field("entityType", "ReceiptInbox").field("entityId", item).attach("file", Buffer.from("%PDF-1.4\n%%EOF\n"), "fuel.pdf");
    expect(up.body.error ?? null).toBeNull();
    expect((await get("/expenses/inbox")).body.data[0].files[0].fileName).toBe("fuel.pdf");
    const categoryId = (await get("/expenses/categories")).body.data[0].id;
    const body = { expenseDate: "2026-03-01", categoryId, payeeName: "Station", net: 100 };
    const both = await Promise.all([post(`/expenses/inbox/${item}/expense`, body), post(`/expenses/inbox/${item}/expense`, body)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 400]);
    const expense = both.find((r) => r.status === 201)!.body.data;
    expect(expense.status).toBe("DRAFT");
    expect(expense.journalId ?? null).toBeNull();
    expect(await prisma.accountingDocument.count({ where: { companyId, entityType: "Expense", entityId: expense.id } })).toBe(1);
    expect((await post(`/expenses/inbox/${item}/dismiss`)).status).toBe(400);
  });
});

describe("Pay details", () => {
  afterEach(() => {
    env.fieldEncryptionKey = "";
  });

  it("are unreadable in the database and whole for those allowed", async () => {
    env.fieldEncryptionKey = randomBytes(32).toString("base64");
    const body = { firstName: "Ange", lastName: "U", nationalId: "1199", bankName: "BK", accountNumber: "0001", basicSalary: 450000.5 };
    const saved = await put("/team/employees/enc-emp-1", body);
    expect(saved.body.data).toMatchObject({ accountNumber: "0001" });
    expect(saved.body.data).not.toHaveProperty("basicSalaryEnc");
    const raw = await prisma.employee.findUniqueOrThrow({ where: { id: "enc-emp-1" } });
    expect(raw.basicSalary).toBeNull();
    expect(JSON.stringify(raw)).not.toMatch(/450000|"0001"|"BK"|1199/);
    const open = (await get("/team/employees/enc-emp-1")).body.data;
    expect(Number(open.basicSalary)).toBe(450000.5);
    expect(open.nationalId).toBe("1199");
    env.fieldEncryptionKey = randomBytes(32).toString("base64");
    expect((await get("/team/employees/enc-emp-1")).status).not.toBe(200);
  });
});

describe("Backup", () => {
  it("dumps, proves the dump restores, and keeps the newest", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bk-"));
    const first = await runBackup(dir, { keep: 1 });
    expect(first.verified).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    await runBackup(dir, { keep: 1 });
    expect(readdirSync(dir)).toHaveLength(1);
    const status = (await get("/workspace/backups")).body.data;
    expect(status.runs[0]).toMatchObject({ status: "VERIFIED" });
    expect(status.runs[0]).not.toHaveProperty("detail"); // the server's paths are not every company's business
    expect(statSync(path.join(dir, readdirSync(dir)[0])).mode & 0o077).toBe(0);
    expect((await get("/workspace/backups", seller)).status).toBe(403);
    const blocked = path.join(dir, readdirSync(dir)[0], "x");
    await expect(runBackup(blocked)).rejects.toThrow();
    expect((await get("/workspace/backups")).body.data.runs[0].status).toBe("FAILED");
  });
});

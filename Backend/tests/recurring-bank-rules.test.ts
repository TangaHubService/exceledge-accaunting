import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { occurrence, runDueTemplates } from "../src/modules/books/recurring-templates.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 95691;
const otherOrgId = 95692;
let admin: Record<string, string> = {};
let other: Record<string, string> = {};
let companyId = "";
const ids: Record<string, string> = {};

const send = (path: string, body: unknown, headers = admin) => request(app).post(path).set(headers).send(body as object);
async function created(path: string, body: unknown, headers = admin) {
  const res = await send(path, body, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

const template = (over: Record<string, unknown> = {}) => ({
  kind: "invoice", name: "Monthly retainer", mode: "SCHEDULED", interval: "MONTHLY", every: 1, startDate: "2026-01-31", endDate: "2026-03-31", daysInAdvance: 0,
  payload: { customerId: ids.customer, dueInDays: 14, lines: [{ description: "Retainer", quantity: 1, unitPrice: 1000 }] },
  ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  name: "Airtime", priority: 1, direction: "OUT", matchAll: true, conditions: [{ field: "DESCRIPTION", op: "CONTAINS", value: "mtn" }],
  splits: [{ accountId: ids.expense, percent: 60 }, { accountId: ids.expense2, percent: 40 }], payee: "MTN Rwanda", memo: "Airtime", keepMemo: true, autoPost: true, ...over,
});
const importLines = (rows: string[], name: string) =>
  send(`/api/v1/banking/accounts/${ids.bank}/statements`, { fileName: name, content: ["Date,Description,Reference,Amount", ...rows].join("\n") });

beforeAll(async () => {
  await resetCompany(orgId);
  await resetCompany(otherOrgId);
  admin = await activateCompany(app, orgId, { name: "Recurring Co", tin: "956910001" });
  other = await activateCompany(app, otherOrgId, { name: "Recurring Other", tin: "956920002" });
  companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  ids.customer = (await created("/api/v1/ar/customers", { name: "Retained Ltd", customerType: "CREDIT", creditLimit: 1_000_000 })).id;
  ids.supplier = (await created("/api/v1/ap/suppliers", { name: "Landlord Ltd" })).id;
  ids.bank = (await created("/api/v1/banking/accounts", { kind: "BANK", name: "BK Rules", openingBalance: 1_000_000, dateOpened: "2026-01-01" })).id;
  const accounts = await prisma.account.findMany({ where: { companyId, type: "EXPENSE", allowManualPost: true, systemProtected: false, children: { none: {} } }, take: 2 });
  [ids.expense, ids.expense2] = accounts.map((a) => a.id);
});

describe("recurring templates", () => {
  it("keeps month ends", () => {
    const s = new Date("2026-01-31T00:00:00Z");
    expect([0, 1, 2].map((n) => occurrence(s, "MONTHLY", 1, n).toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("creates each due invoice once, then stops at the end date", async () => {
    await created("/api/v1/recurring", template());
    expect(await runDueTemplates(companyId, new Date("2026-04-15T08:00:00Z"))).toEqual({ created: 3, failed: 0 });
    expect(await runDueTemplates(companyId, new Date("2026-04-15T08:00:00Z"))).toEqual({ created: 0, failed: 0 });
    const invoices = await prisma.arInvoice.findMany({ where: { companyId }, orderBy: { invoiceDate: "asc" } });
    expect(invoices.map((i) => i.invoiceDate.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(invoices[0].dueDate!.toISOString().slice(0, 10)).toBe("2026-02-14");
    expect((await prisma.recurringTemplate.findFirstOrThrow({ where: { companyId } })).nextDate).toBeNull();
  });

  it("creates bills, and leaves a failed one due with its reason", async () => {
    const bill = await created("/api/v1/recurring", template({ kind: "bill", name: "Rent", endDate: "", startDate: "2026-04-01", payload: { supplierId: ids.supplier, lines: [{ description: "Rent", quantity: 1, unitPrice: 500, accountId: ids.expense }] } }));
    await runDueTemplates(companyId, new Date("2026-04-15T08:00:00Z"));
    expect(await prisma.apBill.count({ where: { companyId } })).toBe(1);
    await prisma.supplier.update({ where: { id: ids.supplier }, data: { status: "INACTIVE" } as never });
    expect((await runDueTemplates(companyId, new Date("2026-05-02T08:00:00Z"))).failed).toBe(1);
    const after = await prisma.recurringTemplate.findUniqueOrThrow({ where: { id: bill.id } });
    expect(after.lastError).toBeTruthy();
    expect(after.nextDate!.toISOString().slice(0, 10)).toBe("2026-05-01");
    await prisma.supplier.update({ where: { id: ids.supplier }, data: { status: "ACTIVE" } as never });
    await prisma.recurringTemplate.delete({ where: { id: bill.id } });
  });

  it("refuses bad templates, other companies and people who can't post the kind", async () => {
    expect((await send("/api/v1/recurring", template({ kind: "transfer" }))).status).toBe(400);
    expect((await send("/api/v1/recurring", template({ payload: { customerId: ids.customer, lines: [] } }))).status).toBe(400);
    expect((await send("/api/v1/recurring", template(), other)).status).toBe(400);
    const t = await created("/api/v1/recurring", template({ name: "Reminder", mode: "REMINDER", kind: "transfer", payload: null }));
    expect((await request(app).delete(`/api/v1/recurring/${t.id}`).set(other)).status).toBe(404);
    expect((await send("/api/v1/recurring", template(), authHeaders(orgId, "AUDITOR"))).status).toBe(403);
  });
});

describe("bank rules", () => {
  it("auto-posts matching lines on import, splits them, and skips money already in the books", async () => {
    await created("/api/v1/banking/rules", rule());
    await created("/api/v1/banking/payments", { financialAccountId: ids.bank, transactionDate: "2026-02-04", lines: [{ accountId: ids.expense, amount: 777 }] });
    // Two equal payments: matching can't choose between them, so the rule must not add a third.
    await created("/api/v1/banking/payments", { financialAccountId: ids.bank, transactionDate: "2026-02-09", lines: [{ accountId: ids.expense, amount: 777 }] });
    const res = await importLines(["10/02/2026,MTN already booked,R1,-777", "11/02/2026,MTN AIRTIME,R2,-1000.01", "12/02/2026,Other shop,R3,-50", "13/02/2026,MTN refund,R4,300"], "feb.csv");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.rules).toEqual({ posted: 1, alreadyInBooks: 1, failed: [] });
    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { companyId, reference: "R2" } });
    expect(line.matchId).toBeTruthy();
    const txn = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId, partyName: "MTN Rwanda" } });
    const gl = await prisma.glEntry.findMany({ where: { journalId: txn.journalId!, debit: { gt: 0 } } });
    expect(gl.map((e) => Number(e.debit)).sort()).toEqual([400, 600.01]);
    expect(txn.description).toBe("Airtime — MTN AIRTIME");
  });

  it("previews without posting, and applies a manual rule only when asked", async () => {
    const r = rule({ name: "Shop", conditions: [{ field: "AMOUNT", op: "EQUALS", value: "50" }], splits: [{ accountId: ids.expense, percent: 100 }], autoPost: false, priority: 2 });
    const before = await prisma.bankTransaction.count({ where: { companyId } });
    expect((await send("/api/v1/banking/rules/preview", r)).body.data.count).toBe(1);
    expect(await prisma.bankTransaction.count({ where: { companyId } })).toBe(before);
    const saved = await created("/api/v1/banking/rules", r);
    expect((await send(`/api/v1/banking/rules/${saved.id}/apply`, {})).body.data.posted).toBe(1);
  });

  it("validates and isolates companies", async () => {
    expect((await send("/api/v1/banking/rules", rule({ splits: [{ accountId: ids.expense, percent: 90 }] }))).status).toBe(400);
    expect((await send("/api/v1/banking/rules", rule({ conditions: [{ field: "AMOUNT", op: "CONTAINS", value: "x" }] }))).status).toBe(400);
    expect((await send("/api/v1/banking/rules", rule(), other)).status).toBe(400);
    expect((await request(app).get("/api/v1/banking/rules").set(other)).body.data).toEqual([]);
  });
});

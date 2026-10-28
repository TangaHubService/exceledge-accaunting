import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98301;

let admin: Record<string, string>;
let companyId = "";
let cash = "";
let sales = "";

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function period(sequence: number) {
  return prisma.accountingPeriod.findFirstOrThrow({ where: { financialYear: { companyId }, sequence } });
}

function journal(journalDate: string, amount = 10, headers = admin) {
  return request(app)
    .post("/api/v1/journals")
    .set(headers)
    .send({
      journalDate,
      postImmediately: true,
      lines: [
        { accountId: cash, debit: amount, credit: 0 },
        { accountId: sales, debit: 0, credit: amount },
      ],
    });
}

describe("Posting integrity", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Integrity Co", tin: "123321123" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    cash = await accountId("1100");
    sales = await accountId("4100");
  });

  it("opens every period that has started, not just the first", async () => {
    expect((await period(1)).status).toBe("OPEN");
    expect((await period(9)).status).toBe("OPEN");

    await prisma.accountingPeriod.update({ where: { id: (await period(6)).id }, data: { status: "FUTURE" } });
    const june = await journal("2026-06-15");
    expect(june.status).toBe(201);
    expect((await period(6)).status).toBe("OPEN");
  });

  it("keeps future periods shut until they start", async () => {
    await prisma.accountingPeriod.update({
      where: { id: (await period(12)).id },
      data: { startDate: new Date(Date.now() + 86_400_000), status: "FUTURE" },
    });
    const res = await journal("2026-12-31");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/);
    await prisma.accountingPeriod.update({
      where: { id: (await period(12)).id },
      data: { startDate: new Date("2026-12-01T00:00:00.000Z") },
    });
  });

  it("locks and unlocks a period, and honours the year's lock date", async () => {
    const march = await period(3);
    expect((await request(app).post(`/api/v1/books/periods/${march.id}/lock`).set(admin)).status).toBe(200);
    const locked = await journal("2026-03-10");
    expect(locked.status).toBe(400);
    expect(locked.body.error).toMatch(/temporarily locked/);
    expect((await request(app).post(`/api/v1/books/periods/${march.id}/unlock`).set(admin)).status).toBe(200);
    expect((await journal("2026-03-10")).status).toBe(201);

    const yearId = march.financialYearId;
    const setLock = await request(app).put(`/api/v1/books/financial-years/${yearId}/lock-date`).set(admin).send({ lockDate: "2026-04-30" });
    expect(setLock.status).toBe(200);
    const april = await journal("2026-04-30");
    expect(april.status).toBe(400);
    expect(april.body.error).toMatch(/2026-04-30 are locked/);
    expect((await journal("2026-05-01")).status).toBe(201);
    await request(app).put(`/api/v1/books/financial-years/${yearId}/lock-date`).set(admin).send({ lockDate: null });
    expect((await journal("2026-04-30")).status).toBe(201);
  });

  it("numbers concurrent journals uniquely and keeps the balance exact", async () => {
    const before = Number((await prisma.account.findUniqueOrThrow({ where: { id: cash } })).currentBalance);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => journal("2026-07-10", i + 1)));
    for (const res of results) expect(res.status).toBe(201);
    const numbers = results.map((r) => r.body.data.journalNumber as string);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toContain("2026");
    const after = Number((await prisma.account.findUniqueOrThrow({ where: { id: cash } })).currentBalance);
    expect(after - before).toBe(78);
  });

  it("leaves no invoice or journal behind when the period is closed", async () => {
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "Closed Period Ltd", creditLimit: 1_000_000 });
    expect(customer.status).toBe(201);
    const january = await period(1);
    const closed = await request(app).post("/api/v1/books/close").set(admin).send({ periodId: january.id, kind: "MONTH" });
    expect(closed.status).toBe(200);

    const journalsBefore = await prisma.journal.count({ where: { companyId } });
    const invoice = await request(app).post("/api/v1/ar/invoices").set(admin).send({
      customerId: customer.body.data.id,
      invoiceDate: "2026-01-20",
      net: 5_000,
    });
    expect(invoice.status).toBe(400);
    expect(invoice.body.error).toMatch(/closed/);
    expect(await prisma.arInvoice.count({ where: { companyId } })).toBe(0);
    expect(await prisma.journal.count({ where: { companyId } })).toBe(journalsBefore);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.data.id } })).balance)).toBe(0);

    const february = await request(app).post("/api/v1/ar/invoices").set(admin).send({
      customerId: customer.body.data.id,
      invoiceDate: "2026-02-20",
      net: 5_000,
    });
    expect(february.status).toBe(201);
  });

  it("reverses a journal from a closed period into an open one", async () => {
    await request(app).post("/api/v1/books/close/reopen").set(admin).send({ periodId: (await period(1)).id, reason: "Post a January journal" });
    const original = await journal("2026-01-25", 7);
    expect(original.status).toBe(201);
    await prisma.accountingPeriod.update({ where: { id: (await period(1)).id }, data: { status: "CLOSED" } });

    const reversed = await request(app).post(`/api/v1/journals/${original.body.data.id}/reverse`).set(admin).send({ reason: "Wrong account" });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.reversal.journalDate.slice(0, 7)).toBe(new Date().toISOString().slice(0, 7));
  });

  it("requires posting rights to post", async () => {
    const manager = authHeaders(orgId, "BRANCH_MANAGER", 811);
    const res = await journal("2026-02-11", 5, manager);
    expect(res.status).toBe(403);
    const draft = await request(app)
      .post("/api/v1/journals")
      .set(manager)
      .send({
        journalDate: "2026-02-11",
        lines: [
          { accountId: cash, debit: 5, credit: 0 },
          { accountId: sales, debit: 0, credit: 5 },
        ],
      });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe("DRAFT");

    const fuel = await prisma.expenseCategory.findFirst({ where: { companyId, code: "FUEL" } });
    const categories = fuel ? [fuel] : (await request(app).get("/api/v1/expenses/categories").set(admin)).body.data;
    const expense = await request(app).post("/api/v1/expenses").set(manager).send({
      expenseDate: "2026-02-12",
      categoryId: categories.find((c: { code: string }) => c.code === "FUEL").id,
      paymentMode: "IMMEDIATE",
      payeeName: "Fuel station",
      net: 1_000,
      creditAccountId: await accountId("1110"),
    });
    expect(expense.status).toBe(201);
    const unapproved = await request(app).post(`/api/v1/expenses/${expense.body.data.id}/post`).set(manager);
    expect(unapproved.status).toBe(400);
    expect(unapproved.body.error).toMatch(/Only an approver/);
    const approverPost = await request(app).post(`/api/v1/expenses/${expense.body.data.id}/post`).set(authHeaders(orgId, "ACCOUNTANT", 812));
    expect(approverPost.status).toBe(200);
    expect(approverPost.body.data.status).toBe("POSTED");
  });
});

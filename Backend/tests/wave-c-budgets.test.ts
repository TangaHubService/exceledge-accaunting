import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98186;
const base = "/api/v1/books";

let admin: Record<string, string>;
let approver: Record<string, string>;
let accountant: Record<string, string>;
let manager: Record<string, string>;
let companyId = "";
let yearId = "";
const acc: Record<string, string> = {};
const ids: Record<string, string> = {};

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function call(method: "get" | "post" | "put", path: string, headers: Record<string, string>, body?: unknown) {
  const req = request(app)[method](`${base}${path}`).set(headers);
  return method === "get" ? req : req.send(body ?? {});
}

async function decideBudget(budgetId: string, status: "APPROVED" | "RETURNED" | "REJECTED", note?: string) {
  const pending = await prisma.approvalRequest.findFirstOrThrow({ where: { companyId, entityType: "Budget", entityId: budgetId, status: "PENDING" } });
  const res = await call("post", `/approvals/${pending.id}/decide`, approver, { status, note });
  expect(res.status).toBe(200);
  return pending.id;
}

async function journal(lines: Array<{ accountId: string; debit: number; credit: number; costCentre?: string }>, journalDate = "2026-03-15") {
  return request(app).post("/api/v1/journals").set(admin).send({ journalDate, description: "Budget test", postImmediately: true, lines });
}

const spend = (amount: number, costCentre?: string, journalDate?: string) =>
  journal(
    [
      { accountId: acc.expense, debit: amount, credit: 0, costCentre },
      { accountId: acc.cash, debit: 0, credit: amount },
    ],
    journalDate,
  );

async function setControl(budgetControl: "OFF" | "WARN" | "BLOCK") {
  const res = await request(app).put("/api/v1/setup/approvals").set(admin).send({ budgetControl });
  expect(res.status).toBe(200);
}

const budgetNotices = () => prisma.notification.findMany({ where: { companyId, title: "Budget exceeded" }, orderBy: { createdAt: "asc" } });

describe("Wave C budgets (C6)", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Budget Co", tin: "186186186" });
    approver = authHeaders(orgId, "ADMIN", 443);
    accountant = authHeaders(orgId, "ACCOUNTANT", 701);
    manager = authHeaders(orgId, "BRANCH_MANAGER", 702);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    yearId = (await prisma.financialYear.findFirstOrThrow({ where: { companyId } })).id;
    acc.cash = await accountId("1100");
    acc.bank = await accountId("1110");
    acc.expense = await accountId("6100");
    acc.sales = await accountId("4100");
    await request(app).get("/api/v1/expenses/categories").set(admin);
    const rent = await prisma.expenseCategory.findFirstOrThrow({ where: { companyId, code: "RENT" } });
    ids.rentCategory = rent.id;
    acc.rent = rent.glAccountId!;
    for (const code of ["OPS", "OLD"]) {
      expect((await call("post", "/dimensions", admin, { kind: "COST_CENTRE", code, name: code })).status).toBe(201);
    }
    expect((await call("post", "/dimensions", admin, { kind: "PROJECT", code: "P1", name: "P1" })).status).toBe(201);
    const old = await prisma.dimension.findFirstOrThrow({ where: { companyId, code: "OLD" } });
    expect((await request(app).patch(`${base}/dimensions/${old.id}`).set(admin).send({ isActive: false })).status).toBe(200);
  });

  it("leaves existing companies with budget control off", async () => {
    expect((await prisma.approvalPostingControls.findUniqueOrThrow({ where: { companyId } })).budgetControl).toBe("OFF");
  });

  it("restricts budgets by capability", async () => {
    expect((await call("get", "/budgets", authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await call("get", "/budgets", manager)).status).toBe(200);
    expect((await call("post", "/budgets", manager, { name: "X", lines: [{ accountId: acc.expense, amount: 1, periodSequence: 1 }] })).status).toBe(403);
    for (const action of ["submit", "approve", "activate", "revise"]) {
      expect((await call("post", `/budgets/nope/${action}`, manager)).status).toBe(403);
    }
    expect((await call("put", "/budgets/nope", manager, { name: "X" })).status).toBe(403);
  });

  it("rejects invalid lines", async () => {
    const make = (line: Record<string, unknown>) => call("post", "/budgets", admin, { name: "Bad", financialYearId: yearId, lines: [{ accountId: acc.expense, amount: 10, periodSequence: 1, ...line }] });
    const unknownCc = await make({ costCentre: "NOPE" });
    expect(unknownCc.status).toBe(400);
    expect(unknownCc.body.error).toMatch(/Cost centre NOPE is not an active cost centre/);
    expect((await make({ costCentre: "OLD" })).body.error).toMatch(/Cost centre OLD is not an active cost centre/);
    expect((await make({ project: "P-NONE" })).body.error).toMatch(/Project P-NONE is not an active project/);
    expect((await make({ branchId: "no-such-branch" })).body.error).toMatch(/not a branch of this company/);
    expect((await make({ accountId: acc.cash })).body.error).toMatch(/not an income or expense account/);
    expect((await make({ periodSequence: 13 })).body.error).toMatch(/period 13 is not a period/);
    expect((await make({ amount: -5 })).status).toBe(400);
    const dup = await call("post", "/budgets", admin, {
      name: "Dup",
      financialYearId: yearId,
      lines: [
        { accountId: acc.expense, amount: 1, periodSequence: 2 },
        { accountId: acc.expense, amount: 2, periodSequence: 2 },
      ],
    });
    expect(dup.body.error).toMatch(/two amounts for the same period/);
    const twoLines = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      call("post", "/budgets", admin, { name: "Mixed", financialYearId: yearId, lines: [{ accountId: acc.expense, amount: 1, ...a }, { accountId: acc.expense, amount: 2, ...b }] });
    expect((await twoLines({ periodSequence: 0 }, { periodSequence: 2 })).body.error).toMatch(/Line 2: .*whole-year amount and monthly amounts/);
    expect((await twoLines({ periodSequence: 2, costCentre: "OPS" }, { periodSequence: 2, project: "P1" })).body.error).toMatch(/Line 2: .*partly overlap/);
    expect(await prisma.budget.count({ where: { companyId } })).toBe(0);
    const nested = await twoLines({ periodSequence: 0 }, { periodSequence: 2, costCentre: "OPS" });
    expect(nested.status).toBe(201);
    await prisma.budget.delete({ where: { id: nested.body.data.id } });
  });

  it("moves a budget through draft, submitted, approved and active, refusing illegal steps", async () => {
    const created = await call("post", "/budgets", admin, {
      name: "Operating 2026",
      financialYearId: yearId,
      lines: [
        { accountId: acc.expense, amount: 1000, periodSequence: 3 },
        { accountId: acc.expense, amount: 300, periodSequence: 3, costCentre: "OPS" },
        { accountId: acc.sales, amount: 500, periodSequence: 3 },
        { accountId: acc.rent, amount: 100, periodSequence: 3 },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "DRAFT", version: 1, financialYearId: yearId });
    const id = (ids.v1 = created.body.data.id);

    expect((await call("post", `/budgets/${id}/activate`, admin)).body.error).toMatch(/Only an approved budget can be activated; this one is draft/);
    expect((await call("post", `/budgets/${id}/approve`, approver)).body.error).toMatch(/Only a submitted budget can be approved/);
    expect((await call("post", `/budgets/${id}/revise`, admin)).body.error).toMatch(/Only the active budget can be revised/);
    expect((await call("put", `/budgets/${id}`, admin, { name: "Operating budget 2026" })).body.data.name).toBe("Operating budget 2026");

    const submitted = await call("post", `/budgets/${id}/submit`, admin);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("SUBMITTED");
    expect(await prisma.approvalRequest.count({ where: { companyId, entityType: "Budget", entityId: id, status: "PENDING" } })).toBe(1);
    expect((await call("post", `/budgets/${id}/submit`, admin)).body.error).toMatch(/Only a draft budget can be submitted/);
    expect((await call("put", `/budgets/${id}`, admin, { name: "Sneaky" })).body.error).toMatch(/submitted budget cannot be changed/);
    expect((await call("post", `/budgets/${id}/activate`, admin)).body.error).toMatch(/this one is submitted/);

    const self = await call("post", `/budgets/${id}/approve`, admin);
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/requester cannot approve/);
    const approved = await call("post", `/budgets/${id}/approve`, approver);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    expect((await call("put", `/budgets/${id}`, admin, { lines: [{ accountId: acc.expense, amount: 1, periodSequence: 3 }] })).body.error).toMatch(/approved budget cannot be changed/);
    expect((await prisma.budgetLine.findMany({ where: { budgetId: id } })).length).toBe(4);

    expect((await call("post", `/budgets/${id}/activate`, manager)).status).toBe(403);
    const active = await call("post", `/budgets/${id}/activate`, admin);
    expect(active.status).toBe(200);
    expect(active.body.data).toMatchObject({ status: "ACTIVE", activatedByErpUserId: 441 });
    expect((await call("post", `/budgets/${id}/activate`, admin)).body.error).toMatch(/this one is active/);
  });

  it("sends a rejected budget back to draft", async () => {
    const other = await call("post", "/budgets", admin, { name: "Stretch", financialYearId: yearId, lines: [{ accountId: acc.expense, amount: 5, periodSequence: 1 }] });
    await call("post", `/budgets/${other.body.data.id}/submit`, admin);
    expect((await call("post", `/approvals/x/decide`, approver, { status: "REJECTED" })).status).toBe(400);
    await decideBudget(other.body.data.id, "REJECTED", "Not this year");
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: other.body.data.id } })).status).toBe("DRAFT");
    await prisma.budget.delete({ where: { id: other.body.data.id } });
  });

  it("revises the active budget into a new version and supersedes the old one on activation", async () => {
    const revised = await call("post", `/budgets/${ids.v1}/revise`, admin);
    expect(revised.status).toBe(201);
    expect(revised.body.data).toMatchObject({ status: "DRAFT", version: 2, familyId: ids.v1, revisedFromId: ids.v1 });
    expect(revised.body.data.lines).toHaveLength(4);
    const v2 = (ids.v2 = revised.body.data.id);
    expect((await call("post", `/budgets/${ids.v1}/revise`, admin)).body.error).toMatch(/Version 2 of this budget is already draft/);
    expect((await call("post", `/budgets/${v2}/revise`, admin)).body.error).toMatch(/Only the active budget can be revised/);

    await call("post", `/budgets/${v2}/submit`, admin);
    const requestId = await decideBudget(v2, "RETURNED", "Raise the March spend");
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: v2 } })).status).toBe("DRAFT");
    const edited = await call("put", `/budgets/${v2}`, admin, {
      lines: [
        { accountId: acc.expense, amount: 1200, periodSequence: 3 },
        { accountId: acc.expense, amount: 300, periodSequence: 3, costCentre: "OPS" },
        { accountId: acc.sales, amount: 500, periodSequence: 3 },
        { accountId: acc.rent, amount: 100, periodSequence: 3 },
      ],
    });
    expect(edited.status).toBe(200);
    const resubmitted = await call("post", `/budgets/${v2}/submit`, admin);
    expect(resubmitted.body.data).toMatchObject({ status: "SUBMITTED", approvalId: requestId });
    await decideBudget(v2, "APPROVED");

    expect((await prisma.budget.findUniqueOrThrow({ where: { id: ids.v1 } })).status).toBe("ACTIVE");
    expect((await call("post", `/budgets/${v2}/activate`, admin)).body.data.status).toBe("ACTIVE");
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: ids.v1 } })).status).toBe("REVISED");
    expect(await prisma.budget.count({ where: { companyId, financialYearId: yearId, status: "ACTIVE" } })).toBe(1);

    const detail = await call("get", `/budgets/${v2}`, manager);
    expect(detail.body.data.versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([
      [1, "REVISED"],
      [2, "ACTIVE"],
    ]);
    await expect(prisma.budget.update({ where: { id: ids.v1 }, data: { status: "ACTIVE" } })).rejects.toThrow();
  });

  it("does nothing to postings while control is off", async () => {
    expect((await spend(400, "OPS")).status).toBe(201);
    expect((await spend(250)).status).toBe(201);
    expect((await spend(100, undefined, "2026-04-10")).status).toBe(201);
    const sale = await journal([
      { accountId: acc.cash, debit: 700, credit: 0 },
      { accountId: acc.sales, debit: 0, credit: 700 },
    ]);
    expect(sale.status).toBe(201);
    expect(await budgetNotices()).toHaveLength(0);
  });

  it("reports budget against actual by month and dimension", async () => {
    const { createAndPostJournal } = await import("../src/modules/journals/journal.service");
    await createAndPostJournal(
      companyId,
      {
        journalDate: new Date("2026-03-31"),
        journalType: "ADJUSTMENT",
        description: "Closing entry",
        sourceModule: "CLOSE",
        lines: [
          { accountId: acc.expense, debit: 0, credit: 100 },
          { accountId: await accountId("3100"), debit: 100, credit: 0 },
        ],
      },
      { erpUserId: 441, erpRole: "ADMIN" },
    );
    const res = await call("get", `/budgets/${ids.v2}/variance`, manager);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.periods).toHaveLength(12);
    const row = (code: string, costCentre: string | null) => r.rows.find((x: { accountCode: string; costCentre: string | null }) => x.accountCode === code && x.costCentre === costCentre);
    const expense = row("6100", null);
    expect(expense).toMatchObject({ budget: 1200, actual: 750, variance: -450, favorable: true });
    expect(expense.months[2]).toEqual({ sequence: 3, budget: 1200, actual: 650, variance: -550 });
    expect(expense.months[3]).toEqual({ sequence: 4, budget: 0, actual: 100, variance: 100 });
    expect(row("6100", "OPS")).toMatchObject({ budget: 300, actual: 400, variance: 100, favorable: false });
    expect(row("4100", null)).toMatchObject({ budget: 500, actual: 700, variance: 200, favorable: true, kind: "INCOME" });
    // Cost centre OPS sits inside the 6100 line, so it is not added to the totals again.
    expect(r.totals.expense).toMatchObject({ budget: 1300, actual: 750, variance: -550 });
    expect(r.totals.expense.months[2]).toEqual({ sequence: 3, budget: 1300, actual: 650, variance: -650 });
    expect(r.totals.income).toMatchObject({ budget: 500, actual: 700 });
  });

  it("blocks a posting that would exceed the budget and posts nothing", async () => {
    await setControl("BLOCK");
    const journalsBefore = await prisma.journal.count({ where: { companyId } });
    const balanceBefore = (await prisma.account.findUniqueOrThrow({ where: { id: acc.expense } })).currentBalance;

    const over = await spend(1000);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/would exceed the active budget Operating budget 2026: 6100 .* budget 1200, spent 1650 \(450 over\)/);
    const overCc = await spend(10, "OPS");
    expect(overCc.status).toBe(400);
    expect(overCc.body.error).toMatch(/cost centre OPS: budget 300, spent 410/);
    expect(await prisma.journal.count({ where: { companyId } })).toBe(journalsBefore);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: acc.expense } })).currentBalance).toEqual(balanceBefore);

    expect((await spend(100)).status).toBe(201);
    const refund = await journal([
      { accountId: acc.cash, debit: 50, credit: 0 },
      { accountId: acc.expense, debit: 0, credit: 50, costCentre: "OPS" },
    ]);
    expect(refund.status).toBe(201);
    expect(await budgetNotices()).toHaveLength(0);
  });

  it("blocks an expense whose posting would exceed the budget", async () => {
    const expense = await request(app).post("/api/v1/expenses").set(accountant).send({
      expenseDate: "2026-03-10",
      categoryId: ids.rentCategory,
      paymentMode: "IMMEDIATE",
      payeeName: "Landlord",
      description: "March rent",
      net: 500,
      tax: 0,
      creditAccountId: acc.bank,
    });
    expect(expense.status).toBe(201);
    expect((await request(app).post(`/api/v1/expenses/${expense.body.data.id}/submit`).set(accountant)).status).toBe(200);
    const approved = await request(app).post(`/api/v1/expenses/${expense.body.data.id}/approve`).set(admin);
    expect(approved.status).toBe(400);
    expect(approved.body.error).toMatch(/would exceed the active budget/);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.body.data.id } })).status).not.toBe("POSTED");
    expect(await prisma.glEntry.count({ where: { companyId, accountId: acc.rent } })).toBe(0);
  });

  it("warns once per budget line when control is WARN", async () => {
    await setControl("WARN");
    const first = await spend(1000);
    expect(first.status).toBe(201);
    expect(first.body.data.budgetWarnings).toEqual([
      expect.objectContaining({ budget: 1200, actual: 1700, over: 500, costCentre: null, period: expect.any(String) }),
    ]);
    const again = await spend(10);
    expect(again.status).toBe(201);
    expect(again.body.data.budgetWarnings).toHaveLength(1);
    let notices = await budgetNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ severity: "WARNING", entityType: "BudgetLine" });
    expect(notices[0].body).toMatch(/6100 .* budget 1200, spent 1700/);

    const ops = await spend(20, "OPS");
    expect(ops.body.data.budgetWarnings.map((w: { costCentre: string | null }) => w.costCentre).sort()).toEqual(["OPS", null]);
    notices = await budgetNotices();
    expect(notices).toHaveLength(2);
    const visible = await call("get", "/notifications", manager);
    expect(visible.body.data.filter((n: { title: string }) => n.title === "Budget exceeded")).toHaveLength(2);

    const april = await spend(5, undefined, "2026-04-20");
    expect(april.body.data.budgetWarnings).toEqual([]);
    await setControl("OFF");
    expect((await spend(5000)).body.data.budgetWarnings).toEqual([]);
    expect(await budgetNotices()).toHaveLength(2);
  });

  it("never blocks an expense fed by the ERP, only warns", async () => {
    await setControl("BLOCK");
    const { env } = await import("../src/config/env");
    const { buildIdempotencyKey } = await import("@exceledge/accounting-domain");
    const event = await request(app)
      .post("/api/v1/integration/events")
      .set({ "x-integration-key": env.integrationApiKey })
      .send({
        eventId: "evt-budget-rent",
        idempotencyKey: buildIdempotencyKey({ organizationId: orgId, sourceModule: "EXPENSE", documentType: "Expense", documentId: 8801, eventType: "EXPENSE_APPROVED" }),
        externalOrganizationId: String(orgId),
        eventType: "EXPENSE_APPROVED",
        occurredAt: "2026-03-12T09:00:00.000Z",
        sourceModule: "EXPENSE",
        sourceDocumentType: "Expense",
        sourceDocumentId: "8801",
        currencyCode: "RWF",
        amountTotals: { gross: "500", net: "500", tax: "0" },
        metadata: { categoryCode: "RENT", payeeName: "Landlord", description: "ERP rent" },
      });
    expect(event.status).toBe(201);
    expect((await prisma.integrationEvent.findFirstOrThrow({ where: { companyId, eventId: "evt-budget-rent" } })).status).toBe("POSTED");
    expect(await prisma.glEntry.count({ where: { companyId, accountId: acc.rent } })).toBeGreaterThan(0);
    const notices = await budgetNotices();
    expect(notices).toHaveLength(3);
    expect(notices[2].body).toMatch(/budget 100, spent 500/);
    await setControl("OFF");
  });
});

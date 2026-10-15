import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98112;
const base = "/api/v1/books";

let admin: Record<string, string>;
let companyId = "";

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

describe("Phases 11-20 books", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Phase 11 Co", tin: "119119119" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("hides the books from a seller", async () => {
    expect((await request(app).get(`${base}/statements`).set(authHeaders(orgId, "SELLER"))).status).toBe(403);
  });

  it("posts a sale, reports it, budgets it, and closes the month", async () => {
    const cash = await accountId("1100");
    const sales = await accountId("4100");
    const posted = await request(app).post("/api/v1/journals").set(admin).send({
      journalDate: "2026-01-15",
      description: "Cash sale",
      postImmediately: true,
      lines: [
        { accountId: cash, debit: 80, credit: 0 },
        { accountId: sales, debit: 0, credit: 80 },
      ],
    });
    expect(posted.status).toBe(201);

    const tb = await request(app).get(`${base}/trial-balance?mode=STANDARD`).set(admin);
    expect(tb.status).toBe(200);
    expect(tb.body.data.difference).toBe(0);

    const statements = await request(app).get(`${base}/statements`).set(admin);
    expect(statements.body.data.income.profit).toBe(80);
    expect(statements.body.data.position.balanced).toBe(true);

    const budget = await request(app).post(`${base}/budgets`).set(admin).send({
      name: "FY2026",
      lines: [{ accountId: sales, amount: 100 }],
    });
    expect(budget.status).toBe(201);
    const approved = await request(app).post(`${base}/budgets/${budget.body.data.id}/approve`).set(admin);
    expect(approved.body.data.status).toBe("APPROVED");
    const variance = await request(app).get(`${base}/budgets/${budget.body.data.id}/variance`).set(admin);
    expect(variance.body.data.rows[0].actual).toBe(80);

    const period = await prisma.accountingPeriod.findFirstOrThrow({
      where: { financialYear: { companyId }, sequence: 1 },
    });
    const second = await prisma.accountingPeriod.findFirstOrThrow({
      where: { financialYear: { companyId }, sequence: 2 },
    });
    const outOfOrder = await request(app).get(`${base}/close/checklist?periodId=${second.id}`).set(admin);
    expect(outOfOrder.body.data.canClose).toBe(false);
    expect(outOfOrder.body.data.earlierOpen).toBe(1);
    const yearTooEarly = await request(app).post(`${base}/close`).set(admin).send({ periodId: period.id, kind: "YEAR" });
    expect(yearTooEarly.status).toBe(400);

    const checklist = await request(app).get(`${base}/close/checklist?periodId=${period.id}`).set(admin);
    expect(checklist.body.data.canClose).toBe(true);
    const closed = await request(app).post(`${base}/close`).set(admin).send({ periodId: period.id, kind: "MONTH" });
    expect(closed.status).toBe(200);
    const reopened = await request(app).post(`${base}/close/reopen`).set(admin).send({ periodId: period.id, reason: "Late invoice" });
    expect(reopened.body.data.status).toBe("REOPENED");
  });

  it("runs recurring journals, FX, controls, groups, and the assistant", async () => {
    const cash = await accountId("1100");
    const expense = await accountId("6100");
    const template = await request(app).post(`${base}/recurring`).set(admin).send({
      name: "Monthly salaries",
      frequency: "MONTHLY",
      nextRunDate: "2026-01-20",
      autoPost: true,
      lines: [
        { accountId: expense, debit: 10, credit: 0 },
        { accountId: cash, debit: 0, credit: 10 },
      ],
    });
    expect(template.status).toBe(201);
    const ran = await request(app).post(`${base}/recurring/run`).set(admin);
    expect(ran.body.data.generated).toBe(1);

    const rate = await request(app).post(`${base}/fx/rates`).set(admin).send({ currency: "USD", rateDate: "2026-01-28", rate: 1300, source: "BNR" });
    expect(rate.status).toBe(201);
    const revalued = await request(app).post(`${base}/fx/revalue`).set(admin).send({ currency: "USD" });
    expect(revalued.status).toBe(200);
    expect(revalued.body.data.gainLoss).toBe(0);

    const control = await request(app).post(`${base}/controls`).set(admin).send({ code: "SOD-1", title: "Requester cannot approve", category: "Approvals", status: "EFFECTIVE" });
    expect(control.status).toBe(201);
    const journalId = ran.body.data.journalIds[0];
    const approval = await request(app).post(`${base}/approvals`).set(authHeaders(orgId, "ACCOUNTANT", 702)).send({ entityType: "Journal", entityId: journalId, amount: 5000 });
    expect(approval.status).toBe(201);
    const decided = await request(app).post(`${base}/approvals/${approval.body.data.id}/decide`).set(admin).send({ status: "APPROVED" });
    expect(decided.body.data.status).toBe("APPROVED");

    const group = await request(app).post(`${base}/groups`).set(admin).send({ name: "Edge Group", members: [{ name: "Parent", ownershipPercent: 100 }] });
    expect(group.status).toBe(201);
    expect(group.body.data.members[0].companyId).toBe(companyId);
    const consolidated = await request(app).get(`${base}/groups/${group.body.data.id}/consolidate`).set(admin);
    expect(consolidated.status).toBe(200);

    const answer = await request(app).post(`${base}/assistant`).set(admin).send({ question: "What is profit?" });
    expect(answer.body.data.answer).toContain("RWF");

    const key = await request(app).post(`${base}/api-keys`).set(admin).send({ name: "Partner" });
    expect(key.body.data.token).toHaveLength(48);
    expect(key.body.data.scopes).toEqual(["report:view"]);
    const signed = await request(app).post(`${base}/signatures`).set(admin).send({ entityType: "PeriodClose", entityId: "p1", statement: "I approve this close pack" });
    expect(signed.status).toBe(201);
  });
});

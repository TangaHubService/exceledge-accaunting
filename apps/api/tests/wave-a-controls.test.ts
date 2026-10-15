import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { automationDue } from "../src/modules/books/books.service";
import { activateCompany, authHeaders, resetCompany, signErpToken } from "./helpers";

const app = createApp();
const orgA = 98401;
const orgB = 98402;
const base = "/api/v1/books";

let admin: Record<string, string>;
let adminB: Record<string, string>;
let bothOrgs: Record<string, string>;
let companyId = "";
let companyB = "";

async function account(code: string, company = companyId) {
  return prisma.account.findFirstOrThrow({ where: { companyId: company, code } });
}

function journal(lines: Array<{ accountId: string; debit: number; credit: number }>, extra: Record<string, unknown> = {}, headers = admin) {
  return request(app)
    .post("/api/v1/journals")
    .set(headers)
    .send({ journalDate: "2026-01-10", postImmediately: true, lines, ...extra });
}

describe("Wave A controls", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgA);
    await resetCompany(orgB);
    admin = await activateCompany(app, orgA, { name: "Controls Co", tin: "123450001" });
    adminB = await activateCompany(app, orgB, { name: "Controls Sub", tin: "123450002" });
    bothOrgs = {
      Authorization: `Bearer ${signErpToken({ userId: 441, role: "ADMIN", activeOrganizationId: orgA, organizationIds: [orgA, orgB] })}`,
    };
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgA) } })).id;
    companyB = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgB) } })).id;
  });

  afterAll(async () => {
    await prisma.jobLock.deleteMany({ where: { key: `recurring:${companyId}` } });
  });

  it("keeps manual journals off control accounts and honours account flags", async () => {
    const cash = await account("1100");
    const sales = await account("4100");
    const receivables = await account("1200");
    const ar = await journal([
      { accountId: receivables.id, debit: 100, credit: 0 },
      { accountId: sales.id, debit: 0, credit: 100 },
    ]);
    expect(ar.status).toBe(400);
    expect(ar.body.error).toMatch(/receivables control account/);

    await prisma.account.update({ where: { id: sales.id }, data: { allowManualPost: false } });
    const blocked = await journal([
      { accountId: cash.id, debit: 100, credit: 0 },
      { accountId: sales.id, debit: 0, credit: 100 },
    ]);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/does not accept manual journals/);
    await prisma.account.update({ where: { id: sales.id }, data: { allowManualPost: true } });

    await prisma.account.update({ where: { id: cash.id }, data: { allowNegativeBalance: false } });
    const before = await prisma.journal.count({ where: { companyId } });
    const overdrawn = await journal([
      { accountId: (await account("6100")).id, debit: 500, credit: 0 },
      { accountId: cash.id, debit: 0, credit: 500 },
    ]);
    expect(overdrawn.status).toBe(400);
    expect(overdrawn.body.error).toMatch(/below zero/);
    expect(await prisma.journal.count({ where: { companyId } })).toBe(before);
    await prisma.account.update({ where: { id: cash.id }, data: { allowNegativeBalance: true } });
  });

  it("posts foreign-currency journals at the rate and revalues the foreign balance", async () => {
    const usdBank = await prisma.account.create({ data: { companyId, code: "1115", name: "USD bank", type: "ASSET", currency: "USD" } });
    const sales = await account("4100");
    await request(app).post(`${base}/fx/rates`).set(admin).send({ currency: "USD", rateDate: "2026-01-05", rate: 1300 });
    await request(app).post(`${base}/fx/rates`).set(admin).send({ currency: "USD", rateDate: "2026-01-31", rate: 1350 });

    const usd = await journal(
      [
        { accountId: usdBank.id, debit: 1000, credit: 0 },
        { accountId: sales.id, debit: 0, credit: 1000 },
      ],
      { currencyCode: "USD" },
    );
    expect(usd.status).toBe(201);
    expect(Number(usd.body.data.exchangeRate)).toBe(1300);
    const line = await prisma.journalLine.findFirstOrThrow({ where: { journalId: usd.body.data.id, accountId: usdBank.id } });
    expect(Number(line.debit)).toBe(1_300_000);
    expect(Number(line.amountForeign)).toBe(1000);

    const rwf = await journal([
      { accountId: usdBank.id, debit: 10, credit: 0 },
      { accountId: sales.id, debit: 0, credit: 10 },
    ]);
    expect(rwf.status).toBe(400);
    expect(rwf.body.error).toMatch(/kept in USD/);

    const gain = await request(app).post(`${base}/fx/revalue`).set(admin).send({ currency: "USD", asOf: "2026-01-31" });
    expect(gain.status).toBe(200);
    expect(Number(gain.body.data.gainLoss)).toBe(50_000);
    expect(Number((await account("1115")).currentBalance)).toBe(1_350_000);
    expect(Number((await account("4300")).currentBalance)).toBe(-50_000);

    const again = await request(app).post(`${base}/fx/revalue`).set(admin).send({ currency: "USD", asOf: "2026-01-31" });
    expect(Number(again.body.data.gainLoss)).toBe(0);

    const reversed = await request(app).post(`/api/v1/journals/${usd.body.data.id}/reverse`).set(admin).send({ reason: "Test" });
    expect(reversed.status).toBe(200);
    expect(Number((await account("1115")).currentBalance)).toBe(50_000);
    const loss = await request(app).post(`${base}/fx/revalue`).set(admin).send({ currency: "USD", asOf: "2026-01-31" });
    expect(Number(loss.body.data.gainLoss)).toBe(-50_000);
    expect(Number((await account("1115")).currentBalance)).toBe(0);

    const functional = await request(app).post(`${base}/fx/revalue`).set(admin).send({ currency: "RWF" });
    expect(functional.status).toBe(200);
    expect(functional.body.data.skipped).toBeTruthy();
  });

  it("consolidates only companies the user belongs to, in full, with balanced eliminations", async () => {
    const sale = await journal(
      [
        { accountId: (await account("1100", companyB)).id, debit: 1000, credit: 0 },
        { accountId: (await account("4100", companyB)).id, debit: 0, credit: 1000 },
      ],
      { journalDate: "2026-01-12" },
      adminB,
    );
    expect(sale.status).toBe(201);

    const members = [
      { name: "Parent", ownershipPercent: 100 },
      { name: "Sub", companyId: companyB, ownershipPercent: 60 },
    ];
    const outsider = await request(app).post(`${base}/groups`).set(admin).send({ name: "Group", members });
    expect(outsider.status).toBe(400);
    expect(outsider.body.error).toMatch(/do not have access/);

    const group = await request(app).post(`${base}/groups`).set(bothOrgs).send({ name: "Group", members });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id;

    const unbalanced = await request(app)
      .post(`${base}/groups/${groupId}/eliminations`)
      .set(bothOrgs)
      .send({ description: "Bad", lines: [{ accountCode: "4100", debit: 200, credit: 0 }, { accountCode: "1100", debit: 0, credit: 150 }] });
    expect(unbalanced.status).toBe(400);
    const unknown = await request(app)
      .post(`${base}/groups/${groupId}/eliminations`)
      .set(bothOrgs)
      .send({ description: "Bad", lines: [{ accountCode: "9999", debit: 200, credit: 0 }, { accountCode: "1100", debit: 0, credit: 200 }] });
    expect(unknown.status).toBe(400);
    const elimination = await request(app)
      .post(`${base}/groups/${groupId}/eliminations`)
      .set(bothOrgs)
      .send({ description: "Intercompany sale", lines: [{ accountCode: "4100", debit: 200, credit: 0 }, { accountCode: "1100", debit: 0, credit: 200 }] });
    expect(elimination.status).toBe(201);

    const consolidated = await request(app).get(`${base}/groups/${groupId}/consolidate?asOf=2026-12-31`).set(bothOrgs);
    expect(consolidated.status).toBe(200);
    const data = consolidated.body.data;
    expect(data.totals.difference).toBe(0);
    expect(data.eliminations.debit).toBe(200);
    expect(data.nonControllingInterest).toHaveLength(1);
    expect(data.nonControllingInterest[0]).toMatchObject({ member: "Sub", netAssets: 1000, equity: 400, profit: 400 });
    expect(data.attribution.profitToNonControlling).toBe(400);

    const denied = await request(app).get(`${base}/groups/${groupId}/consolidate`).set(admin);
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/do not have access/);
  });

  it("authenticates read-only API keys by scope, and stops revoked or expired ones", async () => {
    const issued = await request(app).post(`${base}/api-keys`).set(admin).send({ name: "BI tool", scopes: ["report:view"] });
    expect(issued.status).toBe(201);
    const key = { "x-api-key": issued.body.data.token };

    const tb = await request(app).get(`${base}/trial-balance`).set(key);
    expect(tb.status).toBe(200);
    expect(tb.body.data.difference).toBe(0);
    expect((await request(app).get(`${base}/statements`).set({ Authorization: `ApiKey ${issued.body.data.token}` })).status).toBe(200);
    expect((await request(app).get("/api/v1/gl/dashboard").set(key)).status).toBe(403);
    expect((await request(app).get(`${base}/api-keys`).set(key)).status).toBe(403);
    expect((await request(app).post(`${base}/forecast`).set(key).send({ name: "x", horizonMonths: 3 })).status).toBe(403);
    expect((await request(app).get(`${base}/trial-balance`).set({ "x-api-key": `${issued.body.data.token.slice(0, 8)}${"0".repeat(40)}` })).status).toBe(401);
    expect((await prisma.apiCredential.findUniqueOrThrow({ where: { id: issued.body.data.id } })).lastUsedAt).not.toBeNull();

    await request(app).post(`${base}/api-keys/${issued.body.data.id}/revoke`).set(admin);
    expect((await request(app).get(`${base}/trial-balance`).set(key)).status).toBe(401);

    const expiring = await request(app).post(`${base}/api-keys`).set(admin).send({ name: "Short", scopes: ["gl:view"] });
    await prisma.apiCredential.update({ where: { id: expiring.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get("/api/v1/gl/dashboard").set({ "x-api-key": expiring.body.data.token })).status).toBe(401);

    expect((await request(app).post(`${base}/api-keys`).set(admin).send({ name: "Writer", scopes: ["journal:create"] })).status).toBe(400);
  });

  it("decides an approval once, for a record that exists", async () => {
    const posted = await journal([
      { accountId: (await account("1100")).id, debit: 40, credit: 0 },
      { accountId: (await account("4100")).id, debit: 0, credit: 40 },
    ]);
    const requester = authHeaders(orgA, "ACCOUNTANT", 702);
    const missing = await request(app).post(`${base}/approvals`).set(requester).send({ entityType: "Journal", entityId: "nope", amount: 40 });
    expect(missing.status).toBe(400);
    const unsupported = await request(app).post(`${base}/approvals`).set(requester).send({ entityType: "Anything", entityId: posted.body.data.id, amount: 40 });
    expect(unsupported.status).toBe(400);

    const approval = await request(app).post(`${base}/approvals`).set(requester).send({ entityType: "Journal", entityId: posted.body.data.id, amount: 40 });
    expect(approval.status).toBe(201);
    const duplicate = await request(app).post(`${base}/approvals`).set(requester).send({ entityType: "Journal", entityId: posted.body.data.id, amount: 40 });
    expect(duplicate.status).toBe(400);

    const id = approval.body.data.id;
    expect((await request(app).post(`${base}/approvals/${id}/decide`).set(admin).send({ status: "APPROVED" })).body.data.status).toBe("APPROVED");
    const flip = await request(app).post(`${base}/approvals/${id}/decide`).set(admin).send({ status: "REJECTED" });
    expect(flip.status).toBe(400);
    expect(flip.body.error).toMatch(/already approved/);
    expect(await prisma.auditEvent.count({ where: { companyId, entityType: "ApprovalRequest", entityId: id } })).toBe(2);
  });

  it("needs a different person for each consecutive workflow step", async () => {
    const template = await request(app).post(`${base}/workflows`).set(admin).send({ name: "Close pack", steps: ["Prepare", "Review"] });
    const instance = await request(app).post(`${base}/workflows/${template.body.data.id}/start`).set(admin).send({ entityType: "PeriodClose", entityId: "jan" });
    const id = instance.body.data.id;
    const first = await request(app).post(`${base}/workflows/instances/${id}/advance`).set(admin);
    expect(first.body.data.status).toBe("IN_PROGRESS");
    const same = await request(app).post(`${base}/workflows/instances/${id}/advance`).set(admin);
    expect(same.status).toBe(400);
    const second = await request(app).post(`${base}/workflows/instances/${id}/advance`).set(authHeaders(orgA, "ADMIN", 443));
    expect(second.body.data.status).toBe("COMPLETED");
    expect(second.body.data.steps.map((s: { erpUserId: number }) => s.erpUserId)).toEqual([441, 443]);
    expect((await request(app).post(`${base}/workflows/instances/${id}/advance`).set(authHeaders(orgA, "ADMIN", 444))).status).toBe(400);
  });

  it("refuses a second recurring run while one holds the company lock", async () => {
    await prisma.jobLock.create({ data: { key: `recurring:${companyId}`, holder: "other-instance", expiresAt: new Date(Date.now() + 60_000) } });
    const busy = await request(app).post(`${base}/recurring/run`).set(admin);
    expect(busy.status).toBe(400);
    expect(busy.body.error).toMatch(/already being run/);
    await prisma.jobLock.deleteMany({ where: { key: `recurring:${companyId}` } });
    expect((await request(app).post(`${base}/recurring/run`).set(admin)).status).toBe(200);
  });

  it("validates automation schedules and knows when a job is due", async () => {
    const bad = await request(app).post(`${base}/automation`).set(admin).send({ name: "Scan", jobType: "ANOMALY_SCAN", schedule: "daily" });
    expect(bad.status).toBe(400);
    const good = await request(app).post(`${base}/automation`).set(admin).send({ name: "Scan", jobType: "ANOMALY_SCAN", schedule: "0  2 * * *" });
    expect(good.status).toBe(201);
    expect(good.body.data.schedule).toBe("0 2 * * *");
    const job = { schedule: "0 2 * * *", lastRunAt: null, createdAt: new Date("2026-03-10T01:00:00Z") };
    expect(automationDue(job, new Date("2026-03-10T01:59:00Z"))).toBe(false);
    expect(automationDue(job, new Date("2026-03-10T02:00:00Z"))).toBe(true);
    expect(automationDue({ ...job, lastRunAt: new Date("2026-03-10T02:00:00Z") }, new Date("2026-03-10T03:00:00Z"))).toBe(false);
  });
});

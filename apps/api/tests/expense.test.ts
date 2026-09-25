import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98091;
const base = "/api/v1/expenses";

let admin: Record<string, string>;
let accountant: Record<string, string>;
let companyId = "";
const ids: Record<string, string> = {};

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function post(path: string, body: unknown, headers = accountant, status = 201) {
  const res = await request(app).post(`${base}${path}`).set(headers).send(body);
  if (res.status !== status) throw new Error(`${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function get(path: string, headers = accountant) {
  const res = await request(app).get(`${base}${path}`).set(headers);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe("Phase 9 expense management", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Phase9 Co", tin: "777888999" });
    accountant = authHeaders(orgId, "ACCOUNTANT", 701);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("enforces expense roles and seeds categories", async () => {
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(200);
    expect((await request(app).post(`${base}/x/approve`).set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(403);

    const categories = await get("/categories");
    expect(categories.length).toBeGreaterThanOrEqual(10);
    expect(categories.find((c: { code: string }) => c.code === "FUEL")).toMatchObject({ name: "Fuel and transport" });
    ids.fuel = categories.find((c: { code: string }) => c.code === "FUEL").id;
    ids.rent = categories.find((c: { code: string }) => c.code === "RENT").id;
  });

  it("records, submits, approves and posts an immediate expense with tax", async () => {
    const bank = await accountId("1110");
    const draft = await post("/", {
      expenseDate: "2026-01-10",
      categoryId: ids.fuel,
      paymentMode: "IMMEDIATE",
      payeeName: "Kigali Fuel Station",
      description: "Delivery van fuel",
      net: 50_000,
      tax: 9_000,
      creditAccountId: bank,
      allocations: [
        { department: "Logistics", amount: 40_000 },
        { department: "Sales", amount: 19_000 },
      ],
    });
    expect(draft).toMatchObject({ number: expect.stringMatching(/^EXP-/), status: "DRAFT", grossAmount: 59_000 });
    expect(draft.allocations).toHaveLength(2);
    ids.expense = draft.id;

    const submitted = await post(`/${draft.id}/submit`, {}, accountant, 200);
    expect(submitted.status).toBe("SUBMITTED");

    expect((await request(app).post(`${base}/${draft.id}/approve`).set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(403);
    const posted = await post(`/${draft.id}/approve`, {}, accountant, 200);
    expect(posted).toMatchObject({ status: "POSTED", journalNumber: expect.stringMatching(/^JOU-/) });

    const dash = await get("/dashboard");
    expect(dash.recent.some((r: { number: string }) => r.number === posted.number)).toBe(true);

    const report = await get("/reports/by-category?from=2026-01-01&to=2026-01-31");
    expect(report.total).toBeGreaterThanOrEqual(59_000);
    expect(report.categories.some((c: { name: string }) => c.name === "Fuel and transport")).toBe(true);
  });

  it("supports claims, recurring generation and ERP expense sync", async () => {
    const claim = await post("/", {
      expenseDate: "2026-01-12",
      categoryId: ids.fuel,
      paymentMode: "REIMBURSEMENT",
      employeeName: "Aline Uwase",
      employeeErpUserId: 42,
      description: "Client visit taxi",
      net: 15_000,
      submit: true,
    });
    expect(claim.status).toBe("SUBMITTED");
    const approved = await post(`/${claim.id}/approve`, {}, admin, 200);
    expect(approved.status).toBe("POSTED");

    const recurring = await post("/recurring", {
      name: "Office rent",
      categoryId: ids.rent,
      frequency: "MONTHLY",
      amount: 200_000,
      payeeName: "Landlord Ltd",
      startDate: "2026-01-01",
      autoPost: true,
      creditAccountId: await accountId("1110"),
    });
    expect(recurring).toMatchObject({ number: expect.stringMatching(/^REX-/), frequency: "MONTHLY" });
    const generated = await post(`/recurring/${recurring.id}/run`, {}, accountant, 200);
    expect(generated).toMatchObject({ status: "POSTED", grossAmount: 200_000, recurringExpenseId: recurring.id });

    const { env } = await import("../src/config/env");
    const { buildIdempotencyKey } = await import("@exceledge/accounting-domain");
    const idempotencyKey = buildIdempotencyKey({
      organizationId: orgId,
      sourceModule: "EXPENSE",
      documentType: "Expense",
      documentId: 9101,
      eventType: "EXPENSE_APPROVED",
    });
    const sale = await request(app)
      .post("/api/v1/integration/events")
      .set({ "x-integration-key": env.integrationApiKey })
      .send({
        eventId: "evt-exp-9101",
        idempotencyKey,
        externalOrganizationId: String(orgId),
        eventType: "EXPENSE_APPROVED",
        occurredAt: "2026-01-18T09:00:00.000Z",
        sourceModule: "EXPENSE",
        sourceDocumentType: "Expense",
        sourceDocumentId: "9101",
        sourceDocumentNumber: "ERP-EXP-9101",
        currencyCode: "RWF",
        amountTotals: { gross: "23600", net: "20000", tax: "3600" },
        metadata: { categoryCode: "SUPPLIES", payeeName: "Stationery Shop", description: "Printer paper" },
      });
    expect(sale.status).toBe(201);

    const list = await get("/?from=2026-01-01&to=2026-01-31");
    expect(list.total).toBeGreaterThanOrEqual(4);
    expect(list.rows.some((r: { description: string | null }) => r.description?.includes("Printer paper"))).toBe(true);

    const report = await get("/reports/by-category?from=2026-01-01&to=2026-01-31");
    expect(report.total).toBeGreaterThan(0);
  });
});

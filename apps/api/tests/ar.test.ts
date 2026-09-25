import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetCompany, signErpToken } from "./helpers";

const app = createApp();
const orgId = 94041;

async function activateCompany() {
  const headers = {
    Authorization: `Bearer ${signErpToken({
      activeOrganizationId: orgId,
      role: "ADMIN",
      userId: 441,
    })}`,
  };
  await request(app).get("/api/v1/setup/dashboard").set(headers);
  await request(app)
    .put("/api/v1/setup/profile")
    .set(headers)
    .send({ registeredName: "Phase4 Co", taxIdentificationNumber: "444555666", country: "RW" });
  await request(app)
    .put("/api/v1/setup/business-info")
    .set(headers)
    .send({ accountingBasis: "ACCRUAL", reportingFramework: "IFRS_SME" });
  await request(app).post("/api/v1/setup/financial-years").set(headers).send({
    name: "FY 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodFrequency: "MONTHLY",
  });
  await request(app).put("/api/v1/setup/currency").set(headers).send({ functionalCurrency: "RWF" });
  await request(app).put("/api/v1/setup/policies").set(headers).send({ inventoryValuationMethod: "WEIGHTED_AVERAGE" });
  await request(app)
    .put("/api/v1/setup/localization")
    .set(headers)
    .send({ countryOfRegistration: "RW", localizationPackage: "RW", taxAuthority: "RRA" });
  await request(app).post("/api/v1/setup/default-accounts/ensure").set(headers);
  await request(app).put("/api/v1/setup/inventory-settings").set(headers).send({});
  await request(app).put("/api/v1/setup/party-defaults").set(headers).send({});
  await request(app).put("/api/v1/setup/banking").set(headers).send({});
  await request(app).post("/api/v1/setup/numbering/ensure").set(headers);
  await request(app).put("/api/v1/setup/approvals").set(headers).send({ approvalLevels: 1 });
  for (const key of ["FINANCIAL_YEAR_PERIODS", "CURRENCY", "ACCOUNTING_POLICIES"]) {
    await request(app).post(`/api/v1/setup/sections/${key}/approve`).set(headers);
  }
  const act = await request(app).post("/api/v1/setup/activation/activate").set(headers);
  expect(act.status).toBe(200);
  return headers;
}

describe("Phase 4 Customers & Receivables", () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany();
  });

  it("posts an invoice, blocks a credit overrun, then collects and ages the balance", async () => {
    const seller = {
      Authorization: `Bearer ${signErpToken({
        activeOrganizationId: orgId,
        role: "SELLER",
        userId: 442,
      })}`,
    };
    const denied = await request(app).get("/api/v1/ar/dashboard").set(seller);
    expect(denied.status).toBe(403);

    const customer = await request(app).post("/api/v1/ar/customers").set(headers).send({
      name: "Kigali Traders",
      customerType: "CREDIT",
      creditLimit: 1500,
      creditPeriodDays: 30,
      tin: "100200300",
    });
    expect(customer.status).toBe(201);
    const customerId = customer.body.data.id as string;

    const invoice = await request(app).post("/api/v1/ar/invoices").set(headers).send({
      customerId,
      invoiceDate: "2026-01-15",
      net: 1000,
      tax: 180,
      description: "January supply",
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.gross).toBe("1180");

    const blocked = await request(app).post("/api/v1/ar/invoices").set(headers).send({
      customerId,
      invoiceDate: "2026-01-16",
      net: 500,
      tax: 0,
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/Credit limit/);

    const receipt = await request(app).post("/api/v1/ar/receipts").set(headers).send({
      customerId,
      receiptDate: "2026-01-20",
      method: "BANK",
      amount: 500,
      allocations: [{ invoiceId: invoice.body.data.id, amount: 500 }],
    });
    expect(receipt.status).toBe(201);

    const ledger = await request(app).get(`/api/v1/ar/customers/${customerId}/ledger`).set(headers);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.closingBalance).toBe(680);

    const ageing = await request(app)
      .get("/api/v1/ar/ageing")
      .query({ asOf: "2026-03-01" })
      .set(headers);
    expect(ageing.status).toBe(200);
    expect(ageing.body.data.total).toBe(680);

    const dash = await request(app).get("/api/v1/ar/dashboard").set(headers);
    expect(dash.status).toBe(200);
    expect(dash.body.data.totalCustomers).toBe(1);
    expect(dash.body.data.totalOutstanding).toBe(680);
  });
});

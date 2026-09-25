import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";

export function signErpToken(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      userId: 1,
      email: "admin@example.com",
      role: "ADMIN",
      activeOrganizationId: 100,
      organizationIds: [100],
      ...overrides,
    },
    env.jwtSecret,
    { expiresIn: "1h" },
  );
}

/** Removes a test company; allocations reference documents without cascade, so they go first. */
export async function resetCompany(orgId: number) {
  const company = { externalErpOrganizationId: String(orgId) };
  await prisma.arAllocation.deleteMany({ where: { receipt: { company } } });
  await prisma.apAllocation.deleteMany({ where: { payment: { company } } });
  await prisma.apAdvanceAllocation.deleteMany({ where: { advance: { company } } });
  await prisma.taxPayment.deleteMany({ where: { company } });
  await prisma.taxAdjustment.deleteMany({ where: { company } });
  await prisma.taxFiling.deleteMany({ where: { company } });
  await prisma.fiscalDocument.deleteMany({ where: { company } });
  await prisma.expenseAllocation.deleteMany({ where: { expense: { company } } });
  await prisma.expense.deleteMany({ where: { company } });
  await prisma.recurringExpense.deleteMany({ where: { company } });
  await prisma.expenseCategory.deleteMany({ where: { company } });
  await prisma.bankTransaction.deleteMany({ where: { company } });
  await prisma.bankStatement.deleteMany({ where: { company } });
  await prisma.bankReconciliation.deleteMany({ where: { company } });
  await prisma.company.deleteMany({ where: company });
}

export function authHeaders(orgId: number, role = "ADMIN", userId = 441) {
  return { Authorization: `Bearer ${signErpToken({ activeOrganizationId: orgId, role, userId })}` };
}

/** Runs company setup through the API and activates the books. Returns admin headers. */
export async function activateCompany(app: Express, orgId: number, profile: { name: string; tin: string }) {
  const headers = authHeaders(orgId);
  await request(app).get("/api/v1/setup/dashboard").set(headers);
  await request(app).put("/api/v1/setup/profile").set(headers).send({ registeredName: profile.name, taxIdentificationNumber: profile.tin, country: "RW" });
  await request(app).put("/api/v1/setup/business-info").set(headers).send({ accountingBasis: "ACCRUAL", reportingFramework: "IFRS_SME" });
  await request(app).post("/api/v1/setup/financial-years").set(headers).send({
    name: "FY 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodFrequency: "MONTHLY",
  });
  await request(app).put("/api/v1/setup/currency").set(headers).send({ functionalCurrency: "RWF" });
  await request(app).put("/api/v1/setup/policies").set(headers).send({ inventoryValuationMethod: "WEIGHTED_AVERAGE" });
  await request(app).put("/api/v1/setup/localization").set(headers).send({ countryOfRegistration: "RW", localizationPackage: "RW", taxAuthority: "RRA" });
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
  if (act.status !== 200) throw new Error(`Activation failed: ${JSON.stringify(act.body)}`);
  return headers;
}

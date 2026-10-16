import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { signErpToken } from "./helpers";

const app = createApp();
const orgId = 91001;
const token = () => signErpToken({ activeOrganizationId: orgId, role: "ADMIN", userId: 91 });

async function auth() {
  return { Authorization: `Bearer ${token()}` };
}

describe("Phase 1 company setup & activation", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.company.deleteMany({ where: { externalErpOrganizationId: String(orgId) } });
  });

  it("completes mandatory setup and activates accounting", async () => {
    const headers = await auth();

    let res = await request(app).get("/api/v1/setup/dashboard").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.counts.total).toBe(14);

    res = await request(app)
      .put("/api/v1/setup/profile")
      .set(headers)
      .send({
        registeredName: "Demo Trading Ltd",
        taxIdentificationNumber: "123456789",
        country: "RW",
        businessEmail: "finance@demo.rw",
      });
    expect(res.status).toBe(200);

    res = await request(app)
      .put("/api/v1/setup/business-info")
      .set(headers)
      .send({
        businessType: "RETAIL",
        accountingBasis: "ACCRUAL",
        reportingFramework: "IFRS_SME",
        timeZone: "Africa/Kigali",
      });
    expect(res.status).toBe(200);

    res = await request(app)
      .post("/api/v1/setup/financial-years")
      .set(headers)
      .send({
        name: "FY 2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        periodFrequency: "MONTHLY",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.periods.length).toBe(12);

    res = await request(app)
      .put("/api/v1/setup/currency")
      .set(headers)
      .send({ functionalCurrency: "RWF", currencySymbol: "FRw", decimalPrecision: 0 });
    expect(res.status).toBe(200);

    res = await request(app)
      .put("/api/v1/setup/policies")
      .set(headers)
      .send({
        accountingBasis: "ACCRUAL",
        inventoryValuationMethod: "WEIGHTED_AVERAGE",
      });
    expect(res.status).toBe(200);

    res = await request(app)
      .put("/api/v1/setup/localization")
      .set(headers)
      .send({
        countryOfRegistration: "RW",
        localizationPackage: "RW",
        taxAuthority: "RRA",
        electronicInvoicingRequired: true,
      });
    expect(res.status).toBe(200);

    res = await request(app).post("/api/v1/setup/default-accounts/ensure").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.accountsReceivableId).toBeTruthy();

    res = await request(app)
      .put("/api/v1/setup/inventory-settings")
      .set(headers)
      .send({ valuationMethod: "WEIGHTED_AVERAGE", automaticCogsPosting: true });
    expect(res.status).toBe(200);

    res = await request(app)
      .put("/api/v1/setup/party-defaults")
      .set(headers)
      .send({ customerPaymentTerms: "NET30", supplierApprovalRequired: true });
    expect(res.status).toBe(200);

    res = await request(app)
      .put("/api/v1/setup/banking")
      .set(headers)
      .send({ defaultReceiptMethod: "CASH", defaultPaymentMethod: "BANK_TRANSFER" });
    expect(res.status).toBe(200);

    res = await request(app).post("/api/v1/setup/numbering/ensure").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(10);

    res = await request(app)
      .put("/api/v1/setup/approvals")
      .set(headers)
      .send({
        approvalWorkflowEnabled: true,
        approvalLevels: 1,
        periodLockEnforcement: true,
        manualPostingRequired: true,
      });
    expect(res.status).toBe(200);

    // Approve sensitive sections
    for (const key of [
      "FINANCIAL_YEAR_PERIODS",
      "CURRENCY",
      "ACCOUNTING_POLICIES",
    ]) {
      res = await request(app).post(`/api/v1/setup/sections/${key}/approve`).set(headers);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("APPROVED");
    }

    res = await request(app).get("/api/v1/setup/activation/validate").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.gate.canActivate).toBe(true);

    res = await request(app).post("/api/v1/setup/activation/activate").set(headers);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVATED");
    expect(res.body.message).toMatch(/activated successfully/i);

    const audit = await request(app).get("/api/v1/audit?limit=20").set(headers);
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);
  });

  it("rejects unbalanced opening balances", async () => {
    const headers = await auth();
    const res = await request(app)
      .post("/api/v1/setup/opening-balances")
      .set(headers)
      .send({
        name: "Bad OB",
        lines: [{ debit: 100, credit: 0 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/debits must equal/i);
  });

  it("blocks activation for incomplete company", async () => {
    const incompleteToken = signErpToken({
      activeOrganizationId: 92002,
      role: "ADMIN",
      userId: 92,
    });
    const headers = { Authorization: `Bearer ${incompleteToken}` };
    await request(app).get("/api/v1/setup/dashboard").set(headers);
    const res = await request(app).post("/api/v1/setup/activation/activate").set(headers);
    expect(res.status).toBe(400);
  });

  it("prevents accountant from activating", async () => {
    const accountant = signErpToken({
      activeOrganizationId: orgId,
      role: "ACCOUNTANT",
      userId: 93,
    });
    const res = await request(app)
      .post("/api/v1/setup/activation/activate")
      .set({ Authorization: `Bearer ${accountant}` });
    expect(res.status).toBe(403);
  });
});

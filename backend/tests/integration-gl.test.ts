import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { env } from "../src/config/env";
import { signErpToken } from "./helpers";
import { buildIdempotencyKey } from "@exceledge/accounting-domain";

const app = createApp();
const orgId = 94001;
const integrationHeaders = {
  "x-integration-key": env.integrationApiKey,
  "Content-Type": "application/json",
};

async function activateCompany() {
  const headers = {
    Authorization: `Bearer ${signErpToken({
      activeOrganizationId: orgId,
      role: "ADMIN",
      userId: 401,
    })}`,
  };
  await request(app).get("/api/v1/setup/dashboard").set(headers);
  await request(app)
    .put("/api/v1/setup/profile")
    .set(headers)
    .send({
      registeredName: "Phase3 Co",
      taxIdentificationNumber: "111222333",
      country: "RW",
    });
  await request(app)
    .put("/api/v1/setup/business-info")
    .set(headers)
    .send({ accountingBasis: "ACCRUAL", reportingFramework: "IFRS_SME" });
  await request(app)
    .post("/api/v1/setup/financial-years")
    .set(headers)
    .send({
      name: "FY 2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      periodFrequency: "MONTHLY",
    });
  await request(app)
    .put("/api/v1/setup/currency")
    .set(headers)
    .send({ functionalCurrency: "RWF" });
  await request(app)
    .put("/api/v1/setup/policies")
    .set(headers)
    .send({ inventoryValuationMethod: "WEIGHTED_AVERAGE" });
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

describe("Phase 3 Integration Engine & GL", () => {
  let userHeaders: Record<string, string>;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.company.deleteMany({ where: { externalErpOrganizationId: String(orgId) } });
    userHeaders = await activateCompany();
  });

  it("rejects unbalanced manual journals", async () => {
    const accounts = await request(app).get("/api/v1/coa?type=EXPENSE").set(userHeaders);
    const a = accounts.body.data[0];
    const b = accounts.body.data[1] || accounts.body.data[0];
    const res = await request(app)
      .post("/api/v1/journals")
      .set(userHeaders)
      .send({
        journalDate: "2026-01-15",
        lines: [
          { accountId: a.id, debit: 100, credit: 0 },
          { accountId: b.id, debit: 0, credit: 50 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unbalanced|unbalanced/i);
  });

  it("posts SALE_COMPLETED event into balanced journal + GL", async () => {
    const idempotencyKey = buildIdempotencyKey({
      organizationId: orgId,
      sourceModule: "POS",
      documentType: "Sale",
      documentId: 501,
      eventType: "SALE_COMPLETED",
    });

    const envelope = {
      eventId: "evt-sale-501",
      idempotencyKey,
      externalOrganizationId: String(orgId),
      externalBranchId: "1",
      eventType: "SALE_COMPLETED",
      occurredAt: "2026-01-15T10:00:00.000Z",
      sourceModule: "POS",
      sourceDocumentType: "Sale",
      sourceDocumentId: "501",
      sourceDocumentNumber: "INV-501",
      currencyCode: "RWF",
      amountTotals: { gross: "1180", net: "1000", tax: "180" },
      paymentSplits: [{ paymentMethod: "CASH", amount: 1180 }],
      metadata: { paymentType: "CASH", cogs: 400 },
    };

    const res = await request(app)
      .post("/api/v1/integration/events")
      .set(integrationHeaders)
      .send(envelope);
    if (res.status !== 201) {
      // eslint-disable-next-line no-console
      console.error("ingest failure", res.status, res.body);
    }
    expect(res.status).toBe(201);
    expect(res.body.data.journal).toBeTruthy();
    expect(res.body.data.journal.status).toBe("POSTED");
    expect(Number(res.body.data.journal.totalDebit)).toBe(Number(res.body.data.journal.totalCredit));

    const lines = res.body.data.journal.lines;
    const debit = lines.reduce((s: number, l: { debit: string }) => s + Number(l.debit), 0);
    const credit = lines.reduce((s: number, l: { credit: string }) => s + Number(l.credit), 0);
    expect(debit).toBeCloseTo(credit, 4);

    const dup = await request(app)
      .post("/api/v1/integration/events")
      .set(integrationHeaders)
      .send(envelope);
    expect(dup.status).toBe(200);
    expect(dup.body.data.duplicate).toBe(true);
    expect(dup.body.data.journal.id).toBe(res.body.data.journal.id);

    const gl = await request(app).get("/api/v1/gl/dashboard").set(userHeaders);
    expect(gl.status).toBe(200);
    expect(gl.body.data.postedJournalEntries).toBeGreaterThan(0);
    expect(gl.body.data.totalDebits).toBeCloseTo(gl.body.data.totalCredits, 4);
  });

  it("reverses a posted journal with opposite balanced entry", async () => {
    const list = await request(app).get("/api/v1/journals?status=POSTED").set(userHeaders);
    const journal = list.body.data[0];
    const rev = await request(app)
      .post(`/api/v1/journals/${journal.id}/reverse`)
      .set(userHeaders)
      .send({ reason: "Test reversal" });
    expect(rev.status).toBe(200);
    expect(rev.body.data.reversal.status).toBe("POSTED");
    expect(Number(rev.body.data.reversal.totalDebit)).toBe(
      Number(rev.body.data.reversal.totalCredit),
    );

    const original = await request(app).get(`/api/v1/journals/${journal.id}`).set(userHeaders);
    expect(original.body.data.status).toBe("REVERSED");
  });

  it("requires integration API key", async () => {
    const res = await request(app).post("/api/v1/integration/events").send({});
    expect(res.status).toBe(401);
  });
});

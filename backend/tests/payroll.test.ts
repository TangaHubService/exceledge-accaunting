import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98121;
const integrationHeaders = { "x-integration-key": env.integrationApiKey, "Content-Type": "application/json" };
let companyId = "";

const figures = { grossPay: 400_000, paye: 58_000, employeeRssb: 25_200, employerRssb: 33_200, cbhi: 1_585, netPay: 315_215 };

function envelope(eventType: "PAYROLL_APPROVED" | "PAYROLL_PAID", overrides: Record<string, unknown> = {}) {
  return {
    eventId: `${eventType}-${Math.random()}`,
    idempotencyKey: `${orgId}|PAYROLL|PayrollRun|7|${eventType}|1`,
    externalOrganizationId: String(orgId),
    eventType,
    occurredAt: "2026-01-31T12:00:00.000Z",
    sourceModule: "PAYROLL",
    sourceDocumentType: "PayrollRun",
    sourceDocumentId: "7",
    sourceDocumentNumber: "PAYROLL-2026-01",
    currencyCode: "RWF",
    amountTotals:
      eventType === "PAYROLL_APPROVED"
        ? { gross: String(figures.grossPay), net: String(figures.netPay), tax: String(figures.paye) }
        : { gross: String(figures.netPay), net: String(figures.netPay), tax: "0" },
    paymentSplits: eventType === "PAYROLL_PAID" ? [{ paymentMethod: "BANK", amount: figures.netPay }] : undefined,
    metadata: { period: "2026-01", employeeCount: 2, ...figures },
    ...overrides,
  };
}

async function balance(code: string) {
  const account = await prisma.account.findFirstOrThrow({ where: { companyId, code } });
  return Number(account.currentBalance);
}

describe("Phase 18 payroll accounting", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await activateCompany(app, orgId, { name: "Payroll Co", tin: "555666777" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("accrues an approved payroll against PAYE, RSSB and net salaries", async () => {
    const res = await request(app).post("/api/v1/integration/events").set(integrationHeaders).send(envelope("PAYROLL_APPROVED"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await balance("6100")).toBe(400_000);
    expect(await balance("6120")).toBe(33_200);
    expect(await balance("2300")).toBe(-58_000);
    expect(await balance("2310")).toBe(-(25_200 + 33_200 + 1_585));
    expect(await balance("2320")).toBe(-315_215);
  });

  it("clears net salaries when the payroll is paid from the bank", async () => {
    const bankBefore = await balance("1110");
    const res = await request(app).post("/api/v1/integration/events").set(integrationHeaders).send(envelope("PAYROLL_PAID"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await balance("2320")).toBe(0);
    expect(await balance("1110")).toBe(bankBefore - 315_215);
  });

  it("refuses a payroll whose totals do not add up", async () => {
    const bad = envelope("PAYROLL_APPROVED", {
      idempotencyKey: `${orgId}|PAYROLL|PayrollRun|8|PAYROLL_APPROVED|1`,
      sourceDocumentId: "8",
      metadata: { period: "2026-01", ...figures, netPay: 1 },
    });
    await request(app).post("/api/v1/integration/events").set(integrationHeaders).send(bad);
    const event = await prisma.integrationEvent.findFirstOrThrow({ where: { companyId, sourceDocumentId: "8" } });
    expect(event.status).not.toBe("POSTED");
    expect(event.journalId).toBeNull();
  });
});

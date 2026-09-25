import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98092;
const base = "/api/v1/fixed-assets";

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

describe("Phase 10 fixed assets", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Phase10 Co", tin: "555666777" });
    accountant = authHeaders(orgId, "ACCOUNTANT", 801);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("enforces FA roles and seeds categories", async () => {
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(200);
    expect((await request(app).post(`${base}/depreciation/run`).set(authHeaders(orgId, "BRANCH_MANAGER")).send({ period: "2026-01" })).status).toBe(403);

    const categories = await get("/categories");
    expect(categories.length).toBeGreaterThanOrEqual(8);
    expect(categories.find((c: { code: string }) => c.code === "IT")).toMatchObject({ name: "Computers and IT" });
    ids.it = categories.find((c: { code: string }) => c.code === "IT").id;
    ids.vehicle = categories.find((c: { code: string }) => c.code === "VEHICLE").id;
  });

  it("registers, capitalizes, depreciates and disposes an asset", async () => {
    const bank = await accountId("1110");
    const registered = await post("/assets", {
      name: "Dell Latitude laptop",
      categoryId: ids.it,
      acquisitionCost: 1_200_000,
      purchaseDate: "2026-01-05",
      serialNumber: "SN-IT-001",
      branch: "Kigali HQ",
      location: "Finance office",
    });
    expect(registered).toMatchObject({ number: expect.stringMatching(/^(FA|FIX)-/), status: "REGISTERED", netBookValue: 1_200_000 });
    ids.laptop = registered.id;

    const active = await post(
      `/assets/${registered.id}/capitalize`,
      { capitalizationDate: "2026-01-05", creditAccountId: bank },
      accountant,
      200,
    );
    expect(active).toMatchObject({ status: "ACTIVE", capitalizationJournalId: expect.any(String) });

    const preview = await get("/depreciation/preview?period=2026-01");
    expect(preview.assetCount).toBeGreaterThanOrEqual(1);
    expect(preview.totalAmount).toBeGreaterThan(0);

    const run = await post("/depreciation/run", { period: "2026-01" }, accountant, 201);
    expect(run).toMatchObject({ period: "2026-01", journalNumber: expect.stringMatching(/^JOU-/) });

    const afterDep = await get(`/assets/${ids.laptop}`);
    expect(afterDep.accumulatedDepreciation).toBeGreaterThan(0);
    expect(afterDep.netBookValue).toBeLessThan(1_200_000);

    const disposed = await post(
      `/assets/${ids.laptop}/dispose`,
      { disposalDate: "2026-01-20", disposalMethod: "SALE", proceeds: 800_000, proceedsAccountId: bank },
      accountant,
      200,
    );
    expect(disposed.status).toBe("DISPOSED");

    const dash = await get("/dashboard");
    expect(dash.totals.disposed).toBeGreaterThanOrEqual(1);
    expect(dash.depreciationRuns.some((r: { period: string }) => r.period === "2026-01")).toBe(true);
  });

  it("supports transfer, maintenance, revaluation and ERP asset sync", async () => {
    const bank = await accountId("1110");
    const vehicle = await post("/assets", {
      name: "Toyota Hilux",
      categoryId: ids.vehicle,
      acquisitionCost: 25_000_000,
      residualValue: 2_500_000,
      purchaseDate: "2026-01-08",
      capitalize: true,
      creditAccountId: bank,
      capitalizationDate: "2026-01-08",
      branch: "Kigali HQ",
      location: "Yard A",
    });
    expect(vehicle.status).toBe("ACTIVE");
    ids.vehicleAsset = vehicle.id;

    const transferred = await post(
      `/assets/${vehicle.id}/transfer`,
      { transferDate: "2026-01-12", toBranch: "Musanze", toLocation: "Yard B", toEmployee: "Jean Bosco" },
      accountant,
      200,
    );
    expect(transferred).toMatchObject({ branch: "Musanze", location: "Yard B", assignedEmployee: "Jean Bosco" });

    const maintained = await post(
      `/assets/${vehicle.id}/maintenance`,
      {
        maintenanceDate: "2026-01-15",
        maintenanceType: "Service",
        serviceProvider: "Toyota Rwanda",
        cost: 150_000,
        postExpense: true,
        creditAccountId: bank,
        nextMaintenanceDate: "2026-07-15",
      },
      accountant,
      200,
    );
    expect(maintained.maintenances.length).toBeGreaterThanOrEqual(1);

    const revalued = await post(
      `/assets/${vehicle.id}/revalue`,
      { effectiveDate: "2026-01-18", fairValue: moneyAfter(vehicle), valuationReference: "Valuer report VR-1" },
      accountant,
      200,
    );
    expect(revalued.revaluations.length).toBeGreaterThanOrEqual(1);
    expect(revalued.acquisitionCost).toBeGreaterThan(25_000_000);

    const { env } = await import("../src/config/env");
    const { buildIdempotencyKey } = await import("@exceledge/accounting-domain");
    const idempotencyKey = buildIdempotencyKey({
      organizationId: orgId,
      sourceModule: "FIXED_ASSETS",
      documentType: "ASSET_PO",
      documentId: 9901,
      eventType: "ASSET_ACQUIRED",
    });
    const sync = await request(app)
      .post("/api/v1/integration/events")
      .set({ "x-integration-key": env.integrationApiKey })
      .send({
        eventId: "evt-fa-9901",
        idempotencyKey,
        externalOrganizationId: String(orgId),
        eventType: "ASSET_ACQUIRED",
        occurredAt: "2026-01-10T10:00:00.000Z",
        sourceModule: "FIXED_ASSETS",
        sourceDocumentType: "ASSET_PO",
        sourceDocumentId: "9901",
        sourceDocumentNumber: "PO-FA-99",
        currencyCode: "RWF",
        amountTotals: { gross: "450000", net: "450000", tax: "0" },
        metadata: { name: "Office printer", categoryCode: "OFFICE", branch: "Kigali HQ" },
      });
    expect(sync.status).toBe(201);
    expect(sync.body.data.event.status).toBe("POSTED");

    const register = await get("/reports/register");
    expect(register.some((a: { name: string }) => a.name === "Office printer")).toBe(true);
  });
});

function moneyAfter(vehicle: { netBookValue: number }) {
  return Math.round(vehicle.netBookValue + 1_000_000);
}

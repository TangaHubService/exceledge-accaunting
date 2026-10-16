import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96061;
const key = { "x-integration-key": env.integrationApiKey };

let headers: Record<string, string>;
let ledgerId = 0;

function movement(input: {
  movementType: string;
  direction: "IN" | "OUT";
  quantity: number;
  runningBalance: number;
  branchId?: number;
  productId?: number;
  unitCost?: number;
  reference?: string;
  day?: string;
}) {
  ledgerId += 1;
  const productId = input.productId ?? 501;
  return {
    eventId: `evt-inv-${ledgerId}`,
    idempotencyKey: `${orgId}|INVENTORY|InventoryLedger|${ledgerId}|INVENTORY_MOVEMENT|1`,
    externalOrganizationId: String(orgId),
    externalBranchId: String(input.branchId ?? 1),
    eventType: "INVENTORY_MOVEMENT",
    occurredAt: `2026-01-${input.day ?? "10"}T09:00:00.000Z`,
    sourceModule: "INVENTORY",
    sourceDocumentType: "InventoryLedger",
    sourceDocumentId: String(ledgerId),
    sourceDocumentNumber: input.reference,
    currencyCode: "RWF",
    amountTotals: { gross: "0", net: "0", tax: "0" },
    metadata: {
      ledgerId,
      movementType: input.movementType,
      direction: input.direction,
      productId,
      productName: productId === 501 ? "Inyange Milk 1L" : "Sugar 1kg",
      sku: `SKU-${productId}`,
      category: "Groceries",
      unit: "PCS",
      branchName: (input.branchId ?? 1) === 1 ? "Kigali Main" : "Musanze",
      quantity: input.quantity,
      runningBalance: input.runningBalance,
      unitCost: input.unitCost ?? null,
      reference: input.reference,
    },
  };
}

async function ingest(body: unknown) {
  const res = await request(app).post("/api/v1/integration/events").set(key).send(body);
  expect([200, 201]).toContain(res.status);
  return res.body.data;
}

describe("Phase 6 inventory accounting", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany(app, orgId, { name: "Phase6 Co", tin: "666777888" });
  });

  it("enforces inventory roles", async () => {
    expect((await request(app).get("/api/v1/inventory/dashboard").set(authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await request(app).get("/api/v1/inventory/dashboard").set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(200);
    expect((await request(app).post("/api/v1/inventory/opening-snapshot").set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(403);
  });

  it("values ERP stock movements and keeps the GL inventory account equal to the subledger", async () => {
    // Kigali Main, milk: +10 @100, +10 @130 → 20 units worth 2,300
    const p1 = await ingest(movement({ movementType: "PURCHASE", direction: "IN", quantity: 10, runningBalance: 10, unitCost: 100, reference: "PO-1" }));
    expect(p1.journal.status).toBe("POSTED");
    const duplicate = await ingest({ ...movement({ movementType: "PURCHASE", direction: "IN", quantity: 10, runningBalance: 10, unitCost: 100, reference: "PO-1" }), idempotencyKey: p1.event.idempotencyKey });
    expect(duplicate.duplicate).toBe(true);
    await ingest(movement({ movementType: "PURCHASE", direction: "IN", quantity: 10, runningBalance: 20, unitCost: 130, reference: "PO-2" }));

    // Sale of 7 at the ERP batch cost of 110 (770). The cost of goods sold is posted by the sale journal.
    const sale = await ingest(movement({ movementType: "SALE", direction: "OUT", quantity: 7, runningBalance: 13, unitCost: 110, reference: "S-1" }));
    expect(sale.journal).toBeNull();
    await ingest({
      eventId: "evt-sale-S-1",
      idempotencyKey: `${orgId}|POS|Sale|S-1|SALE_COMPLETED|1`,
      externalOrganizationId: String(orgId),
      externalBranchId: "1",
      eventType: "SALE_COMPLETED",
      occurredAt: "2026-01-10T10:00:00.000Z",
      sourceModule: "POS",
      sourceDocumentType: "Sale",
      sourceDocumentId: "S-1",
      sourceDocumentNumber: "S-1",
      currencyCode: "RWF",
      amountTotals: { gross: "1180", net: "1000", tax: "180" },
      paymentSplits: [{ paymentMethod: "CASH", amount: 1180 }],
      metadata: { paymentType: "CASH", cogs: 770 },
    });

    // Damage of 2 with no ERP cost: weighted average 2 × 1,530 / 13 → 235.3846
    const damage = await ingest(movement({ movementType: "DAMAGE", direction: "OUT", quantity: 2, runningBalance: 11 }));
    expect(damage.journal.status).toBe("POSTED");

    // Transfer 3 to Musanze: out at the average (1,294.6154 / 11 → 353.0769), in at the same cost, not the ERP's 999
    await ingest(movement({ movementType: "TRANSFER_OUT", direction: "OUT", quantity: 3, runningBalance: 8, reference: "ST-9" }));
    await ingest(movement({ movementType: "TRANSFER_IN", direction: "IN", quantity: 3, runningBalance: 3, branchId: 2, unitCost: 999, reference: "ST-9" }));

    const failed = await ingest(movement({ movementType: "PRODUCTION_CONSUME", direction: "OUT", quantity: 1, runningBalance: 7 }));
    expect(failed.error).toMatch(/No inventory posting rule/);

    const movements = await request(app).get("/api/v1/inventory/movements?from=2026-01-01&to=2026-01-31").set(headers);
    expect(movements.body.data.total).toBe(6);
    const rows = movements.body.data.rows as Array<{ kind: string; value: number; costSource: string; journalNumber: string | null }>;
    expect(rows.find((r) => r.kind === "DAMAGE")).toMatchObject({ value: -235.3846, costSource: "AVERAGE" });
    expect(rows.find((r) => r.kind === "TRANSFER_OUT")?.value).toBe(-353.0769);
    expect(rows.find((r) => r.kind === "TRANSFER_IN")).toMatchObject({ value: 353.0769, costSource: "TRANSFER" });
    expect(rows.find((r) => r.kind === "SALE")).toMatchObject({ value: -770, costSource: "ERP", journalNumber: null });
    expect(rows.find((r) => r.kind === "PURCHASE")?.journalNumber).toBeTruthy();
  });

  it("loads an ERP opening snapshot once, absorbing earlier movements", async () => {
    const snapshot = (id: string) => ({
      eventId: `evt-opening-${id}`,
      idempotencyKey: `${orgId}|INVENTORY|OpeningSnapshot|${id}|INVENTORY_OPENING|1`,
      externalOrganizationId: String(orgId),
      eventType: "INVENTORY_OPENING",
      occurredAt: "2026-01-12T08:00:00.000Z",
      sourceModule: "INVENTORY",
      sourceDocumentType: "OpeningSnapshot",
      sourceDocumentId: id,
      currencyCode: "RWF",
      amountTotals: { gross: "0", net: "0", tax: "0" },
      lines: [
        { productId: 501, productName: "Inyange Milk 1L", branchId: 1, branchName: "Kigali Main", quantity: 8, unitCost: 120 },
        { productId: 502, productName: "Sugar 1kg", category: "Groceries", branchId: 1, branchName: "Kigali Main", quantity: 5, unitCost: 40 },
      ],
    });
    // Milk at Kigali: 941.5385 recorded → 8 @ 120 = 960 (+18.4615). Sugar: 5 @ 40 = 200.
    const first = await ingest(snapshot("OS-1"));
    expect(first.journal.lines.find((l: { debit: string }) => Number(l.debit) > 0).debit).toMatch(/^218.4615/);
    const second = await ingest(snapshot("OS-2"));
    expect(second.journal).toBeNull();

    const valuation = await request(app).get("/api/v1/inventory/valuation").set(headers);
    expect(valuation.body.data.totalValue).toBe(1513.0769);
    expect(valuation.body.data.totalQuantity).toBe(16);
    const musanze = valuation.body.data.lines.find((l: { location: string }) => l.location === "Musanze");
    expect(musanze).toMatchObject({ quantity: 3, value: 353.0769 });

    const before = await request(app).get("/api/v1/inventory/valuation?asOf=2026-01-11").set(headers);
    expect(before.body.data.totalValue).toBe(1294.6154);
  });

  it("reconciles, reports cost of sales and shows the dashboard", async () => {
    const recon = await request(app).get("/api/v1/inventory/reconciliation").set(headers);
    expect(recon.status).toBe(200);
    expect(recon.body.data).toMatchObject({ glValue: 1513.0769, subledgerValue: 1513.0769, difference: 0 });
    expect(recon.body.data.explained.saleCostDifference).toBe(0);
    expect(recon.body.data.quantityDifferences).toEqual([]);
    expect(recon.body.data.failedEvents).toHaveLength(1);
    expect(recon.body.data.failedEvents[0].lastError).toMatch(/PRODUCTION_CONSUME/);

    const company = await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } });
    const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId: company.id } });
    const gl = await prisma.glEntry.aggregate({ where: { companyId: company.id, accountId: defaults.inventoryAssetId! }, _sum: { debit: true, credit: true } });
    expect(Number(gl._sum.debit) - Number(gl._sum.credit)).toBeCloseTo(1513.0769, 2);
    const git = await prisma.glEntry.aggregate({ where: { companyId: company.id, accountId: defaults.goodsInTransitId! }, _sum: { debit: true, credit: true } });
    expect(Number(git._sum.debit) - Number(git._sum.credit)).toBe(0);

    const cogs = await request(app).get("/api/v1/inventory/reports/cost-of-sales?from=2026-01-01&to=2026-01-31").set(headers);
    expect(cogs.body.data.totals).toMatchObject({ quantitySold: 7, netCost: 770 });
    expect(cogs.body.data.openingValue).toBe(0);
    expect(cogs.body.data.closingValue).toBe(1513.0769);

    expect((await request(app).get("/api/v1/inventory/reports/slow-moving?slowDays=90&deadDays=30").set(headers)).status).toBe(400);
    const slow = await request(app).get("/api/v1/inventory/reports/slow-moving").set(headers);
    expect(slow.body.data).toMatchObject({ slowDays: 90, deadDays: 180 });

    const dash = await request(app).get("/api/v1/inventory/dashboard").set(headers);
    expect(dash.body.data).toMatchObject({ valuationMethod: "WEIGHTED_AVERAGE", openingLoaded: true, totalValue: 1513.0769, locationCount: 2 });
    expect(dash.body.data.byLocation[0]).toMatchObject({ name: "Kigali Main", value: 1160 });
    expect(dash.body.data.reconciliation.difference).toBe(0);
  });
});

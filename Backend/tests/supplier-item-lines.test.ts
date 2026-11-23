import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 94111;

async function clean(org: number) {
  const company = { externalErpOrganizationId: String(org) };
  await prisma.approvalRequest.deleteMany({ where: { company } });
  await prisma.itemReceipt.deleteMany({ where: { company } });
  await prisma.commercialDocument.deleteMany({ where: { company } });
  await resetCompany(org);
}

/** Journal lines of a document as { accountId: debit - credit }. */
async function journalOf(companyId: string, sourceDocumentType: string, sourceDocumentId: string) {
  const journal = await prisma.journal.findFirstOrThrow({ where: { companyId, sourceDocumentType, sourceDocumentId }, include: { lines: true } });
  const net: Record<string, number> = {};
  for (const l of journal.lines) net[l.accountId] = Math.round(((net[l.accountId] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
  return net;
}

describe("Item details on purchase orders and supplier credits", () => {
  let headers: Record<string, string>;
  let companyId: string;
  const post = (path: string, body: unknown) => request(app).post(`/api/v1${path}`).set(headers).send(body as object);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.$connect();
    await clean(orgId);
    headers = await activateCompany(app, orgId, { name: "Supplier Items Co", tin: "555666891" });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;

    const [rent, repairs] = await prisma.account.findMany({ where: { companyId, type: "EXPENSE", isActive: true, allowAutoPost: true }, take: 2, orderBy: { code: "asc" } });
    ids.rent = rent.id;
    ids.repairs = repairs.id;
    await prisma.taxCode.create({ data: { companyId, code: "VATIN18", name: "Input VAT 18%", taxType: "INPUT_VAT", ratePercent: 18, effectiveFrom: new Date("2020-01-01") } });
    ids.supplier = (await post("/ap/suppliers", { name: "Maintenance Ltd" })).body.data.id;
    const service = await post("/inventory/items", { name: "Generator service", type: "SERVICE", purchaseCost: 10000, expenseAccountId: ids.repairs, purchaseTaxCode: "VATIN18" });
    expect(service.status, JSON.stringify(service.body)).toBe(201);
    ids.service = service.body.data.id;
    ids.stock = (await prisma.inventoryItem.create({ data: { companyId, externalProductId: "ERP-SI-1", name: "Diesel filter" } })).id;
  });

  afterAll(async () => {
    await clean(orgId);
  });

  it("credits each category and item line's own account and reverses the input tax", async () => {
    const res = await post("/ap/credit-notes", {
      supplierId: ids.supplier,
      noteDate: "2026-11-10",
      reason: "Overcharge refunded",
      lines: [
        { description: "Rent overcharge", quantity: 1, unitPrice: 2000, accountId: ids.rent },
        { description: "Generator service", quantity: 2, unitPrice: 10000, accountId: ids.repairs, taxCode: "VATIN18" },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const note = res.body.data;
    expect(Number(note.net)).toBe(22000);
    expect(Number(note.tax)).toBe(3600);
    expect(Number(note.gross)).toBe(25600);
    expect(Number(note.unapplied)).toBe(25600);

    const net = await journalOf(companyId, "ApCreditNote", note.id);
    expect(net[ids.rent]).toBe(-2000);
    expect(net[ids.repairs]).toBe(-20000);
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } });
    const apAccountId = supplier.apAccountId ?? (await prisma.account.findFirstOrThrow({ where: { companyId, code: "2100" } })).id;
    expect(net[apAccountId]).toBe(25600);
    const others = Object.entries(net).filter(([id]) => ![ids.rent, ids.repairs, apAccountId].includes(id));
    expect(others.map(([, v]) => v)).toEqual([-3600]);
  });

  it("refuses a lined credit note that also gives a net, or that returns stock", async () => {
    const lines = [{ description: "Rent", quantity: 1, unitPrice: 100, accountId: ids.rent }];
    const both = await post("/ap/credit-notes", { supplierId: ids.supplier, noteDate: "2026-11-10", reason: "x", net: 100, lines });
    expect(both.status).toBe(400);
    expect(both.body.error ?? both.body.message).toMatch(/takes its net and tax from the lines/);
    const none = await post("/ap/credit-notes", { supplierId: ids.supplier, noteDate: "2026-11-10", reason: "x" });
    expect(none.status).toBe(400);
  });

  it("bills a service line straight from the purchase order while stock waits for its receipt", async () => {
    const po = await post("/commercial/purchase-order", {
      supplierId: ids.supplier,
      docDate: "2026-11-11",
      lines: [
        { description: "Generator service", itemId: ids.service, accountId: ids.repairs, quantity: 1, unitPrice: 10000, taxCode: "VATIN18" },
        { description: "Diesel filter", itemId: ids.stock, quantity: 4, unitPrice: 500 },
      ],
    });
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    const poId = po.body.data.id;
    expect(po.body.data.lines.find((l: { description: string }) => l.description === "Generator service").itemId).toBe(ids.service);

    const converted = await post(`/commercial/documents/${poId}/convert`, { target: "BILL", date: "2026-11-12" });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    const bill = await prisma.apBill.findFirstOrThrow({ where: { companyId, poReference: po.body.data.number }, include: { lines: true } });
    expect(Number(bill.net)).toBe(10000);
    expect(Number(bill.tax)).toBe(1800);
    expect(bill.lines.map((l) => l.accountId)).toEqual([ids.repairs]);

    const doc = await prisma.commercialDocument.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    expect(doc.status).not.toBe("CONVERTED");
    expect(Number(doc.lines.find((l) => l.itemId === ids.stock)!.billedQuantity)).toBe(0);

    // The order shows each line's item type, and receiving all the stock completes it: the service is never received.
    const shown = await request(app).get(`/api/v1/commercial/documents/${poId}`).set(headers);
    expect(shown.body.data.lines.map((l: { item: { type: string } | null }) => l.item?.type)).toEqual(["SERVICE", "INVENTORY"]);
    const location = await prisma.inventoryLocation.create({ data: { companyId, externalBranchId: "SI-B1", name: "Store" } });
    const receipt = await post("/inventory/item-receipts", { supplierId: ids.supplier, purchaseOrderId: poId, date: "2026-11-13", lines: [{ itemId: ids.stock, locationId: location.id, quantity: 4, unitCost: 500 }] });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    expect((await prisma.commercialDocument.findUniqueOrThrow({ where: { id: poId } })).status).toBe("RECEIVED");
  });
});

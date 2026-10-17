import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { processIntegrationEvent } from "../src/modules/integration/integration.service";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 92301;
const integration = { "x-integration-key": env.integrationApiKey, "Content-Type": "application/json" };
let companyId = "";
let admin: Record<string, string> = {};
let defaults: Awaited<ReturnType<typeof prisma.defaultPostingAccounts.findUniqueOrThrow>>;
let seq = 0;

async function balanceOf(accountId: string | null) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId! } });
  return Number(account.currentBalance);
}

function send(eventType: string, doc: { module: string; type: string; id: string; number?: string }, body: Record<string, unknown>) {
  seq += 1;
  return request(app)
    .post("/api/v1/integration/events")
    .set(integration)
    .send({
      eventId: `wave-c-${seq}-${Math.random()}`,
      idempotencyKey: `${orgId}|${doc.module}|${doc.type}|${doc.id}|${eventType}|1`,
      externalOrganizationId: String(orgId),
      externalBranchId: "1",
      eventType,
      occurredAt: "2026-02-10T09:00:00.000Z",
      sourceModule: doc.module,
      sourceDocumentType: doc.type,
      sourceDocumentId: doc.id,
      sourceDocumentNumber: doc.number,
      currencyCode: "RWF",
      ...body,
    });
}

function stock(id: string, movementType: string, direction: string, quantity: number, unitCost?: number, productId = 701) {
  return send("INVENTORY_MOVEMENT", { module: "INVENTORY", type: "InventoryLedger", id }, {
    amountTotals: { gross: "0", net: "0", tax: "0" },
    metadata: { ledgerId: id, movementType, direction, productId, productName: "Rice 5kg", quantity, unitCost: unitCost ?? null },
  });
}

async function eventFor(id: string, eventType: string) {
  return prisma.integrationEvent.findFirstOrThrow({ where: { companyId, sourceDocumentId: id, eventType } });
}

describe("Wave C: ERP events reach the GL and subledgers together", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Wave C Events", tin: "923010001" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  });

  it("posts a split sale with one line per method and the credit part on receivables", async () => {
    const res = await send("SALE_COMPLETED", { module: "POS", type: "Sale", id: "5001", number: "S-5001" }, {
      amountTotals: { gross: "1180", net: "1000", tax: "180" },
      parties: { externalCustomerId: 81 },
      paymentSplits: [
        { paymentMethod: "CASH", amount: 180 },
        { paymentMethod: "DEBT", amount: 1000 },
      ],
      metadata: { paymentType: "SPLIT", cogs: 600 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.defaultCashAccountId)).toBe(180);
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(1000);
    expect(await balanceOf(defaults.costOfSalesId)).toBe(0);

    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { companyId, sourceDocumentId: "5001" }, include: { customer: true } });
    expect(Number(invoice.gross)).toBe(1180);
    expect(Number(invoice.amountPaid)).toBe(180);
    expect(Number(invoice.customer.balance)).toBe(1000);
  });

  it("rejects splits that do not add up and leaves nothing posted", async () => {
    const res = await send("SALE_COMPLETED", { module: "POS", type: "Sale", id: "5002" }, {
      amountTotals: { gross: "1180", net: "1000", tax: "180" },
      paymentSplits: [{ paymentMethod: "CASH", amount: 1000 }],
      metadata: { paymentType: "SPLIT" },
    });
    expect(res.body.data.error).toMatch(/do not add up/);
    const event = await eventFor("5002", "SALE_COMPLETED");
    expect(event.status).toBe("FAILED");
    expect(await prisma.journal.count({ where: { integrationEventId: event.id } })).toBe(0);
  });

  it("applies a debt payment to the sale's invoice", async () => {
    const res = await send("CUSTOMER_PAYMENT_RECEIVED", { module: "POS", type: "DebtPayment", id: "pay-1" }, {
      amountTotals: { gross: "400", net: "400", tax: "0" },
      parties: { externalCustomerId: 81 },
      paymentSplits: [{ paymentMethod: "BANK_TRANSFER", amount: 400 }],
      metadata: { saleId: "5001", paymentMethod: "BANK_TRANSFER" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.defaultBankAccountId)).toBe(400);
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(600);

    const receipt = await prisma.arReceipt.findFirstOrThrow({ where: { companyId, sourceDocumentId: "pay-1" }, include: { allocations: true } });
    expect(receipt.method).toBe("BANK");
    expect(receipt.allocations.map((a) => Number(a.amount))).toEqual([400]);
    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { companyId, sourceDocumentId: "5001" }, include: { customer: true } });
    expect(Number(invoice.amountPaid)).toBe(580);
    expect(Number(invoice.customer.balance)).toBe(600);
  });

  it("rolls the journal back when the payment's sale is not in receivables", async () => {
    const res = await send("CUSTOMER_PAYMENT_RECEIVED", { module: "POS", type: "DebtPayment", id: "pay-2" }, {
      amountTotals: { gross: "50", net: "50", tax: "0" },
      metadata: { saleId: "9999" },
    });
    expect(res.body.data.error).toMatch(/AR subledger: Sale 9999 is not in receivables/);
    const event = await eventFor("pay-2", "CUSTOMER_PAYMENT_RECEIVED");
    expect(event.status).toBe("FAILED");
    expect(event.journalId).toBeNull();
    expect(await prisma.journal.count({ where: { integrationEventId: event.id } })).toBe(0);
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(600);
  });

  it("posts a payment once when the same event is delivered or processed twice", async () => {
    const sale = await send("SALE_COMPLETED", { module: "POS", type: "Sale", id: "9999", number: "S-9999" }, {
      amountTotals: { gross: "70", net: "70", tax: "0" },
      parties: { externalCustomerId: 82 },
      paymentSplits: [{ paymentMethod: "DEBT", amount: 70 }],
    });
    expect(sale.body.data.error).toBeUndefined();
    const failed = await eventFor("pay-2", "CUSTOMER_PAYMENT_RECEIVED");
    const runs = await Promise.allSettled([processIntegrationEvent(failed.id), processIntegrationEvent(failed.id), processIntegrationEvent(failed.id)]);
    expect(runs.some((r) => r.status === "fulfilled")).toBe(true);
    for (const run of runs) if (run.status === "rejected") expect(String(run.reason)).toMatch(/already being processed/);
    expect(await prisma.journal.count({ where: { integrationEventId: failed.id } })).toBe(1);
    expect(await prisma.arReceipt.count({ where: { companyId, sourceDocumentId: "pay-2" } })).toBe(1);
    expect((await eventFor("pay-2", "CUSTOMER_PAYMENT_RECEIVED")).status).toBe("POSTED");

    const again = await send("CUSTOMER_PAYMENT_RECEIVED", { module: "POS", type: "DebtPayment", id: "pay-2" }, {
      amountTotals: { gross: "50", net: "50", tax: "0" },
      metadata: { saleId: "9999" },
    });
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(await prisma.journal.count({ where: { integrationEventId: failed.id } })).toBe(1);
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(620);
  });

  it("takes a debt payment marked Other into cash", async () => {
    const cashBefore = await balanceOf(defaults.defaultCashAccountId);
    const res = await send("CUSTOMER_PAYMENT_RECEIVED", { module: "POS", type: "DebtPayment", id: "pay-3" }, {
      amountTotals: { gross: "20", net: "20", tax: "0" },
      paymentSplits: [{ paymentMethod: "OTHER", amount: 20 }],
      metadata: { saleId: "9999", paymentMethod: "OTHER" },
    });
    expect(res.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.defaultCashAccountId)).toBe(cashBefore + 20);
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(600);
    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { companyId, sourceDocumentId: "9999" } });
    expect(Number(invoice.amountPaid)).toBe(70);
  });

  it("refuses a mixed sale that comes without its splits", async () => {
    const res = await send("SALE_COMPLETED", { module: "POS", type: "Sale", id: "5003" }, {
      amountTotals: { gross: "500", net: "500", tax: "0" },
      metadata: { paymentType: "MIXED" },
    });
    expect(res.body.data.error).toMatch(/mixed payment needs its payment splits/);
  });

  it("credits a refund on account against the sale's invoice", async () => {
    const res = await send("SALE_REFUNDED", { module: "POS", type: "SaleRefund", id: "r-2", number: "RF-2" }, {
      amountTotals: { gross: "118", net: "100", tax: "18" },
      paymentSplits: [{ paymentMethod: "DEBT", amount: 118 }],
      metadata: { originalSaleId: "5001", reason: "Damaged pack" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(482);
    expect(await balanceOf(defaults.salesReturnsId ?? defaults.salesRevenueId)).toBe(defaults.salesReturnsId ? 100 : -900);

    const note = await prisma.arCreditNote.findFirstOrThrow({ where: { companyId, sourceDocumentId: "r-2" } });
    expect(note.reason).toBe("Damaged pack");
    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { companyId, sourceDocumentId: "5001" }, include: { customer: true } });
    expect(Number(invoice.amountCredited)).toBe(118);
    expect(Number(invoice.customer.balance)).toBe(482);
  });

  it("keeps a refund beyond what is still owed on the customer's account", async () => {
    const cashBefore = await balanceOf(defaults.defaultCashAccountId);
    const res = await send("SALE_REFUNDED", { module: "POS", type: "SaleRefund", id: "r-3" }, {
      amountTotals: { gross: "800", net: "800", tax: "0" },
      paymentSplits: [
        { paymentMethod: "DEBT", amount: 600 },
        { paymentMethod: "CASH", amount: 200 },
      ],
      metadata: { originalSaleId: "5001" },
    });
    expect(res.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.defaultCashAccountId)).toBe(cashBefore - 200);
    expect(await balanceOf(defaults.accountsReceivableId)).toBe(-118);
    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { companyId, sourceDocumentId: "5001" }, include: { customer: true } });
    expect(Number(invoice.gross) - Number(invoice.amountPaid) - Number(invoice.amountCredited)).toBe(0);
    expect(Number(invoice.customer.balance)).toBe(-118);
  });

  it("posts the cost of a sale from the valuation subledger", async () => {
    expect((await stock("L-1", "PURCHASE", "IN", 10, 100)).status).toBe(201);
    const sale = await stock("L-2", "SALE", "OUT", 4);
    expect(sale.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.costOfSalesId)).toBe(400);
    expect(await balanceOf(defaults.inventoryAssetId)).toBe(600);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId, kind: "SALE" } });
    expect(movement.journalId).not.toBeNull();
  });

  it("routes adjustments through the subledger and refuses ones without a product", async () => {
    const bare = await send("INVENTORY_ADJUSTED", { module: "INVENTORY", type: "StockAdjustment", id: "adj-1" }, {
      amountTotals: { gross: "100", net: "100", tax: "0" },
      metadata: { direction: "LOSS" },
    });
    expect(bare.body.data.error).toMatch(/must name the product, the branch and the quantity/);
    const supplierReturn = await stock("L-3", "RETURN_SUPPLIER", "OUT", 1);
    expect(supplierReturn.body.data.error).toMatch(/recorded in Accounting on the supplier credit note/);

    const loss = await send("INVENTORY_ADJUSTED", { module: "INVENTORY", type: "StockAdjustment", id: "adj-2" }, {
      amountTotals: { gross: "0", net: "0", tax: "0" },
      metadata: { direction: "LOSS", productId: 701, quantity: 1 },
    });
    expect(loss.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.inventoryAssetId)).toBe(500);
    const balance = await prisma.inventoryBalance.findFirstOrThrow({ where: { companyId } });
    expect(Number(balance.quantity)).toBe(5);
  });

  it("clears goods received not invoiced when the bill matches the purchase order", async () => {
    const supplier = { externalSupplierId: 301 };
    const grniBefore = await balanceOf(defaults.grniId);
    expect(grniBefore).toBe(-1000);
    const noPo = await send("GOODS_RECEIVED", { module: "PURCHASES", type: "PurchaseOrderReceipt", id: "po-0:1" }, {
      amountTotals: { gross: "1000", net: "1000", tax: "0" },
      parties: supplier,
    });
    expect(noPo.body.data.error).toMatch(/purchase order number/);

    const received = await send("GOODS_RECEIVED", { module: "PURCHASES", type: "PurchaseOrderReceipt", id: "po-7:1" }, {
      amountTotals: { gross: "1000", net: "1000", tax: "0" },
      parties: supplier,
      metadata: { poReference: "PO-7" },
    });
    expect(received.body.data.error).toBeUndefined();
    expect(received.body.data.journal).toBeNull();

    const bill = await send("SUPPLIER_BILL_APPROVED", { module: "PURCHASES", type: "SupplierInvoice", id: "b-1" }, {
      amountTotals: { gross: "1416", net: "1200", tax: "216" },
      parties: supplier,
      metadata: { poReference: "PO-7", receivedAtCost: 0 },
    });
    expect(bill.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.grniId)).toBe(0);
    expect(await balanceOf(defaults.purchasesId)).toBe(200);
    const apBill = await prisma.apBill.findFirstOrThrow({ where: { companyId, sourceDocumentId: "b-1" } });
    expect(Number(apBill.grniCleared)).toBe(1000);

    const second = await send("SUPPLIER_BILL_APPROVED", { module: "PURCHASES", type: "SupplierInvoice", id: "b-2" }, {
      amountTotals: { gross: "500", net: "500", tax: "0" },
      parties: supplier,
      metadata: { poReference: "PO-7" },
    });
    expect(second.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.grniId)).toBe(0);
    expect(await balanceOf(defaults.purchasesId)).toBe(700);
  });

  it("moves a bill that came before its goods from purchases onto the receipt", async () => {
    const supplier = { externalSupplierId: 301 };
    const purchasesBefore = await balanceOf(defaults.purchasesId);
    const grniBefore = await balanceOf(defaults.grniId);
    const bill = await send("SUPPLIER_BILL_APPROVED", { module: "PURCHASES", type: "SupplierInvoice", id: "b-8" }, {
      amountTotals: { gross: "300", net: "300", tax: "0" },
      parties: supplier,
      metadata: { poReference: "PO-8" },
    });
    expect(bill.body.data.error).toBeUndefined();
    expect(await balanceOf(defaults.purchasesId)).toBe(purchasesBefore + 300);

    const received = await send("GOODS_RECEIVED", { module: "PURCHASES", type: "PurchaseOrderReceipt", id: "po-8:1" }, {
      amountTotals: { gross: "500", net: "500", tax: "0" },
      parties: supplier,
      metadata: { poReference: "PO-8" },
    });
    expect(received.body.data.error).toBeUndefined();
    expect(received.body.data.journal).not.toBeNull();
    expect(await balanceOf(defaults.purchasesId)).toBe(purchasesBefore);
    expect(await balanceOf(defaults.grniId)).toBe(grniBefore + 300);
    const receipt = await prisma.goodsReceipt.findFirstOrThrow({ where: { companyId, poReference: "PO-8" } });
    expect(Number(receipt.matchedValue)).toBe(300);
    const apBill = await prisma.apBill.findFirstOrThrow({ where: { companyId, sourceDocumentId: "b-8" } });
    expect(Number(apBill.grniCleared)).toBe(300);
  });

  it("allocates a split supplier payment to the purchase order's bills", async () => {
    const res = await send("SUPPLIER_PAYMENT_MADE", { module: "PURCHASES", type: "SupplierPayment", id: "sp-1" }, {
      amountTotals: { gross: "1416", net: "1416", tax: "0" },
      parties: { externalSupplierId: 301 },
      paymentSplits: [
        { paymentMethod: "BANK_TRANSFER", amount: 1000 },
        { paymentMethod: "CASH", amount: 416 },
      ],
      metadata: { poReference: "PO-7" },
    });
    expect(res.body.data.error).toBeUndefined();
    const lines = await prisma.journalLine.findMany({ where: { journalId: res.body.data.journal.id }, orderBy: { lineNumber: "asc" } });
    expect(lines.filter((l) => Number(l.credit) > 0).map((l) => Number(l.credit)).sort()).toEqual([1000, 416].sort());
    const payment = await prisma.apPayment.findFirstOrThrow({ where: { companyId, sourceDocumentId: "sp-1" }, include: { allocations: true } });
    expect(payment.method).toBe("BANK");
    expect(payment.allocations.map((a) => Number(a.amount))).toEqual([1416]);
    expect(Number(payment.unallocated)).toBe(0);
  });

  it("returns stock to a supplier at valuation cost, and refuses more than is held", async () => {
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { companyId, externalErpSupplierId: "301" } });
    const balance = await prisma.inventoryBalance.findFirstOrThrow({ where: { companyId } });
    const tooMany = await request(app)
      .post("/api/v1/ap/credit-notes")
      .set(admin)
      .send({ supplierId: supplier.id, noteDate: "2026-02-12", reason: "Returned", net: 900, returnedItems: [{ itemId: balance.itemId, locationId: balance.locationId, quantity: 9 }] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/Only 5 of Rice 5kg/);
    expect(await prisma.apCreditNote.count({ where: { companyId } })).toBe(0);

    const inventoryBefore = await balanceOf(defaults.inventoryAssetId);
    const ok = await request(app)
      .post("/api/v1/ap/credit-notes")
      .set(admin)
      .send({ supplierId: supplier.id, noteDate: "2026-02-12", reason: "Returned", net: 250, tax: 45, returnedItems: [{ itemId: balance.itemId, locationId: balance.locationId, quantity: 2 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await balanceOf(defaults.inventoryAssetId)).toBe(inventoryBefore - 200);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId, kind: "SUPPLIER_RETURN" } });
    expect(movement.journalId).toBe(ok.body.data.journalId);
    expect(Number(movement.value)).toBe(-200);
  });
});

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98122;
const headers = { "x-integration-key": env.integrationApiKey, "Content-Type": "application/json" };
let companyId = "";

async function balanceOf(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  return Number(account.currentBalance);
}

describe("Scanned supplier invoices", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await activateCompany(app, orgId, { name: "Scan Co", tin: "555666778" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("clears GRNI for imported stock, expenses the rest and attaches the scan to the bill", async () => {
    const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
    const res = await request(app)
      .post("/api/v1/integration/events")
      .set(headers)
      .send({
        eventId: `scan-${Math.random()}`,
        idempotencyKey: `${orgId}|PURCHASES|SupplierInvoice|41|SUPPLIER_BILL_APPROVED|1`,
        externalOrganizationId: String(orgId),
        eventType: "SUPPLIER_BILL_APPROVED",
        occurredAt: "2026-01-20T09:00:00.000Z",
        sourceModule: "PURCHASES",
        sourceDocumentType: "SupplierInvoice",
        sourceDocumentId: "41",
        sourceDocumentNumber: "INV-7781",
        currencyCode: "RWF",
        amountTotals: { gross: "118000", net: "100000", tax: "18000" },
        parties: { externalSupplierId: 501 },
        metadata: {
          supplierName: "Kigali Wholesale",
          supplierTin: "101202303",
          supplierInvoiceNumber: "INV-7781",
          receivedAtCost: 80_000,
          capturedBy: "OCR",
          document: { fileName: "inv-7781.pdf", path: "/uploads/invoices/inv-7781.pdf", mimeType: "application/pdf" },
        },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await balanceOf(defaults.grniId!)).toBe(80_000);
    expect(await balanceOf(defaults.purchasesId!)).toBe(20_000);
    expect(await balanceOf(defaults.accountsPayableId!)).toBe(-118_000);

    const bill = await prisma.apBill.findFirstOrThrow({ where: { companyId, sourceDocumentId: "41" } });
    expect(bill.supplierInvoiceNumber).toBe("INV-7781");
    const docs = await prisma.accountingDocument.findMany({ where: { companyId, entityType: "ApBill", entityId: bill.id } });
    expect(docs).toHaveLength(1);
    expect(docs[0].contentText).toBe("/uploads/invoices/inv-7781.pdf");
  });
});

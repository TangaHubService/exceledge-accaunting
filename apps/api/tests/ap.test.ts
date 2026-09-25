import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 95051;

describe("Phase 5 Suppliers & Payables", () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany(app, orgId, { name: "Phase5 Co", tin: "555666777" });
  });

  it("enforces payables roles", async () => {
    expect((await request(app).get("/api/v1/ap/dashboard").set(authHeaders(orgId, "SELLER", 442))).status).toBe(403);
    const manager = authHeaders(orgId, "BRANCH_MANAGER", 443);
    expect((await request(app).get("/api/v1/ap/suppliers").set(manager)).status).toBe(200);
    expect((await request(app).post("/api/v1/ap/suppliers").set(manager).send({ name: "Blocked" })).status).toBe(403);
  });

  it("bills, pays with withholding, credits, applies an advance, ages and reverses", async () => {
    const created = await request(app).post("/api/v1/ap/suppliers").set(headers).send({
      name: "Nyarugenge Supplies",
      category: "INVENTORY",
      tin: "101202303",
      creditPeriodDays: 30,
      whtRate: 15,
    });
    expect(created.status).toBe(201);
    const supplierId = created.body.data.id as string;
    expect(created.body.data.code).toMatch(/^SUP-/);

    const bill = await request(app).post("/api/v1/ap/bills").set(headers).send({
      supplierId,
      supplierInvoiceNumber: "INV-778",
      billDate: "2026-01-10",
      poReference: "PO-12",
      net: 1000,
      tax: 180,
    });
    expect(bill.status).toBe(201);
    expect(bill.body.data.gross).toBe("1180");
    expect(bill.body.data.dueDate.slice(0, 10)).toBe("2026-02-09");

    const duplicate = await request(app).post("/api/v1/ap/bills").set(headers).send({
      supplierId,
      supplierInvoiceNumber: "INV-778",
      billDate: "2026-01-11",
      net: 10,
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toMatch(/already recorded/);

    const bill2 = await request(app).post("/api/v1/ap/bills").set(headers).send({
      supplierId,
      supplierInvoiceNumber: "INV-779",
      billDate: "2026-01-12",
      net: 500,
    });
    expect(bill2.status).toBe(201);

    const overAllocated = await request(app).post("/api/v1/ap/payments").set(headers).send({
      supplierId,
      paymentDate: "2026-01-20",
      amount: 2000,
      allocations: [{ billId: bill2.body.data.id, amount: 600 }],
    });
    expect(overAllocated.status).toBe(400);
    expect(overAllocated.body.error).toMatch(/exceeds bill outstanding/);

    const payment = await request(app).post("/api/v1/ap/payments").set(headers).send({
      supplierId,
      paymentDate: "2026-01-20",
      method: "EFT",
      amount: 1030,
      withholdingTax: 150,
      reference: "EFT-0091",
      allocations: [{ billId: bill.body.data.id, amount: 1180 }],
    });
    expect(payment.status).toBe(201);

    const credit = await request(app).post("/api/v1/ap/credit-notes").set(headers).send({
      supplierId,
      billId: bill2.body.data.id,
      noteDate: "2026-01-21",
      reason: "Damaged goods returned",
      net: 100,
    });
    expect(credit.status).toBe(201);

    const advance = await request(app).post("/api/v1/ap/advances").set(headers).send({
      supplierId,
      advanceDate: "2026-01-05",
      method: "BANK",
      amount: 300,
    });
    expect(advance.status).toBe(201);
    const allocated = await request(app)
      .post(`/api/v1/ap/advances/${advance.body.data.id}/allocate`)
      .set(headers)
      .send({ billId: bill2.body.data.id, amount: 250, allocationDate: "2026-01-22" });
    expect(allocated.status).toBe(200);
    const refund = await request(app)
      .post(`/api/v1/ap/advances/${advance.body.data.id}/refund`)
      .set(headers)
      .send({ refundDate: "2026-01-23" });
    expect(refund.status).toBe(200);
    expect(refund.body.data.remaining).toBe("0");
    expect(refund.body.data.refunded).toBe("50");

    let ledger = await request(app).get(`/api/v1/ap/suppliers/${supplierId}/ledger`).set(headers);
    expect(ledger.body.data.closingBalance).toBe(150);

    const ageing = await request(app).get("/api/v1/ap/ageing").query({ asOf: "2026-03-01" }).set(headers);
    expect(ageing.body.data.total).toBe(150);
    expect(ageing.body.data.lines[0].bucket).toBe("D1_30");

    const wht = await request(app).get("/api/v1/ap/reports/withholding").query({ from: "2026-01-01", to: "2026-01-31" }).set(headers);
    expect(wht.body.data.totalWithheld).toBe(150);
    expect(wht.body.data.rows[0].supplierTin).toBe("101202303");

    const reversed = await request(app)
      .post(`/api/v1/ap/payments/${payment.body.data.id}/reverse`)
      .set(headers)
      .send({ reason: "Bank rejected transfer", reversalDate: "2026-01-25" });
    expect(reversed.status).toBe(200);
    const again = await request(app).post(`/api/v1/ap/payments/${payment.body.data.id}/reverse`).set(headers).send({ reversalDate: "2026-01-25" });
    expect(again.status).toBe(400);

    ledger = await request(app).get(`/api/v1/ap/suppliers/${supplierId}/ledger`).set(headers);
    expect(ledger.body.data.closingBalance).toBe(1330);

    const statement = await request(app).get(`/api/v1/ap/suppliers/${supplierId}/statement`).set(headers);
    expect(statement.body.data.totalOutstanding).toBe(1330);

    // Subledger agrees with the AP control account in the general ledger.
    const company = await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) }, include: { defaultAccounts: true } });
    const gl = await prisma.glEntry.aggregate({
      where: { companyId: company.id, accountId: company.defaultAccounts!.accountsPayableId! },
      _sum: { debit: true, credit: true },
    });
    expect(Number(gl._sum.credit) - Number(gl._sum.debit)).toBe(1330);

    const audit = await prisma.auditEvent.count({ where: { companyId: company.id, entityType: { in: ["ApBill", "ApPayment", "ApCreditNote", "ApAdvance"] } } });
    expect(audit).toBeGreaterThanOrEqual(7);

    const dash = await request(app).get("/api/v1/ap/dashboard").set(headers);
    expect(dash.body.data.totalSuppliers).toBe(1);
    expect(dash.body.data.totalOutstanding).toBe(1330);
    expect(dash.body.data.overdueBills.count).toBe(2);
  });

  it("refuses to transact with an inactive supplier", async () => {
    const s = await request(app).post("/api/v1/ap/suppliers").set(headers).send({ name: "Dormant Ltd" });
    await request(app).patch(`/api/v1/ap/suppliers/${s.body.data.id}`).set(headers).send({ status: "INACTIVE" });
    const bill = await request(app).post("/api/v1/ap/bills").set(headers).send({ supplierId: s.body.data.id, billDate: "2026-01-15", net: 100 });
    expect(bill.status).toBe(400);
    expect(bill.body.error).toMatch(/not active/);
  });

  it("mirrors an ERP supplier bill and payment onto the subledger once", async () => {
    const envelope = (type: string, id: string, totals: Record<string, string>, metadata: Record<string, unknown> = {}) => ({
      eventId: `evt-${type}-${id}`,
      idempotencyKey: `${orgId}|PROCUREMENT|${type}|${id}`,
      externalOrganizationId: String(orgId),
      eventType: type,
      occurredAt: "2026-01-18T09:00:00.000Z",
      sourceModule: "PROCUREMENT",
      sourceDocumentType: type === "SUPPLIER_BILL_APPROVED" ? "SupplierInvoice" : "SupplierPayment",
      sourceDocumentId: id,
      sourceDocumentNumber: `ERP-${id}`,
      currencyCode: "RWF",
      amountTotals: totals,
      parties: { externalSupplierId: 88 },
      metadata: { supplierName: "Musanze Farm Co", ...metadata },
    });
    const token = { "x-integration-key": env.integrationApiKey };
    const billEvent = envelope("SUPPLIER_BILL_APPROVED", "SI-1", { net: "2000", tax: "360", gross: "2360" });
    const posted = await request(app).post("/api/v1/integration/events").set(token).send(billEvent);
    expect([200, 201]).toContain(posted.status);
    await request(app).post("/api/v1/integration/events").set(token).send(billEvent);

    const payEvent = envelope("SUPPLIER_PAYMENT_COMPLETED", "SP-1", { net: "1000", tax: "0", gross: "1000" }, { paymentType: "BANK", billSourceDocumentId: "SI-1" });
    await request(app).post("/api/v1/integration/events").set(token).send(payEvent);

    const supplier = await prisma.supplier.findFirstOrThrow({ where: { externalErpSupplierId: "88", company: { externalErpOrganizationId: String(orgId) } } });
    expect(supplier.name).toBe("Musanze Farm Co");
    expect(Number(supplier.balance)).toBe(1360);
    const bills = await prisma.apBill.findMany({ where: { supplierId: supplier.id } });
    expect(bills).toHaveLength(1);
    expect(Number(bills[0].amountPaid)).toBe(1000);
  });
});

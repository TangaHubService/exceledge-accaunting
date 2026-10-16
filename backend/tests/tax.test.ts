import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98081;
const base = "/api/v1/tax";

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

describe("Phase 8 tax management", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Phase8 Co", tin: "888999000" });
    accountant = authHeaders(orgId, "ACCOUNTANT", 601);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("enforces tax roles and seeds Rwanda tax codes", async () => {
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(200);
    expect((await request(app).post(`${base}/codes`).set(authHeaders(orgId, "BRANCH_MANAGER")).send({})).status).toBe(403);
    expect((await request(app).post(`${base}/filings/x/file`).set(accountant)).status).toBe(403);

    const settings = await get("/settings");
    expect(settings).toMatchObject({ tin: "888999000", taxAuthority: "RRA", vatRegistered: true });
    expect(settings.codes.length).toBeGreaterThanOrEqual(6);
    expect(settings.codes.find((c: { code: string }) => c.code === "VAT18")).toMatchObject({ ratePercent: 18, taxType: "OUTPUT_VAT" });
  });

  it("posts output and input VAT from sales and bills, then pays and files VAT", async () => {
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "Taxable Buyer", customerType: "CREDIT", creditLimit: 5_000_000 });
    expect(customer.status).toBe(201);
    const invoice = await request(app)
      .post("/api/v1/ar/invoices")
      .set(admin)
      .send({ customerId: customer.body.data.id, invoiceDate: "2026-01-10", dueDate: "2026-02-10", net: 1_000_000, tax: 180_000 });
    expect(invoice.status).toBe(201);

    const supplier = await request(app).post("/api/v1/ap/suppliers").set(admin).send({ name: "Taxable Vendor", tin: "123123123" });
    expect(supplier.status).toBe(201);
    const bill = await request(app)
      .post("/api/v1/ap/bills")
      .set(admin)
      .send({ supplierId: supplier.body.data.id, billDate: "2026-01-12", dueDate: "2026-02-12", supplierInvoiceNumber: "V-1", net: 200_000, tax: 36_000 });
    expect(bill.status).toBe(201);

    const vat = await get("/reports/vat?from=2026-01-01&to=2026-01-31");
    expect(vat.totals).toMatchObject({ output: 180_000, input: 36_000, net: 144_000 });

    const bank = await accountId("1110");
    const payment = await post("/payments", {
      paymentDate: "2026-01-28",
      taxType: "OUTPUT_VAT",
      bankAccountId: bank,
      amount: 100_000,
      periodFrom: "2026-01-01",
      periodTo: "2026-01-31",
      reference: "RRA-VAT-JAN",
    });
    expect(payment).toMatchObject({ number: expect.stringMatching(/^TXP-/), amount: 100_000, status: "POSTED" });
    ids.payment = payment.id;

    const vatAfter = await get("/reports/vat?from=2026-01-01&to=2026-01-31");
    expect(vatAfter.totals.paid).toBe(100_000);
    expect(vatAfter.totals.outstanding).toBe(44_000);

    const filing = await post("/filings", { kind: "VAT", periodFrom: "2026-01-01", periodTo: "2026-01-31", dueDate: "2026-02-15" });
    expect(filing).toMatchObject({ status: "PREPARED", kind: "VAT" });
    expect(filing.summary).toMatchObject({ output: 180_000, input: 36_000, net: 144_000 });
    ids.filing = filing.id;

    expect((await request(app).post(`${base}/filings/${filing.id}/file`).set(accountant).send({ filingReference: "DEC-01" })).status).toBe(403);
    const filed = await post(`/filings/${filing.id}/file`, { filingReference: "RRA-2026-01" }, admin, 200);
    expect(filed).toMatchObject({ status: "FILED", filingReference: "RRA-2026-01" });
    expect((await request(app).delete(`${base}/filings/${filing.id}`).set(accountant)).body.error).toMatch(/can't be deleted/);
  });

  it("records adjustments, withholding filings and fiscal documents from sales events", async () => {
    const suspense = await accountId("6600");
    const adj = await post("/adjustments", {
      adjustmentDate: "2026-01-20",
      taxType: "OUTPUT_VAT",
      contraAccountId: suspense,
      amount: 5_000,
      increasesLiability: true,
      reason: "RRA assessment on under-declared sales",
    });
    expect(adj).toMatchObject({ amount: 5_000, journalNumber: expect.stringMatching(/^JOU-/) });

    const supplier = await request(app)
      .post("/api/v1/ap/suppliers")
      .set(admin)
      .send({ name: "WHT Supplier", tin: "321321321", whtCategory: "SERVICES", whtRate: 15 });
    expect(supplier.status).toBe(201);
    const bill = await request(app)
      .post("/api/v1/ap/bills")
      .set(admin)
      .send({ supplierId: supplier.body.data.id, billDate: "2026-01-18", dueDate: "2026-02-18", supplierInvoiceNumber: "W-9", net: 100_000, tax: 0 });
    expect(bill.status).toBe(201);
    const pay = await request(app)
      .post("/api/v1/ap/payments")
      .set(admin)
      .send({
        supplierId: supplier.body.data.id,
        paymentDate: "2026-01-25",
        method: "BANK",
        amount: 85_000,
        withholdingTax: 15_000,
        allocations: [{ billId: bill.body.data.id, amount: 100_000 }],
      });
    expect(pay.status).toBe(201);

    const whtFiling = await post("/filings", { kind: "WHT", periodFrom: "2026-01-01", periodTo: "2026-01-31" });
    expect(whtFiling.summary).toMatchObject({ totalWithheld: 15_000, payments: 1 });

    const { env } = await import("../src/config/env");
    const { buildIdempotencyKey } = await import("@exceledge/accounting-domain");
    const idempotencyKey = buildIdempotencyKey({
      organizationId: orgId,
      sourceModule: "POS",
      documentType: "Sale",
      documentId: 8801,
      eventType: "SALE_COMPLETED",
    });
    const sale = await request(app)
      .post("/api/v1/integration/events")
      .set({ "x-integration-key": env.integrationApiKey })
      .send({
        eventId: "evt-tax-8801",
        idempotencyKey,
        externalOrganizationId: String(orgId),
        externalBranchId: "1",
        eventType: "SALE_COMPLETED",
        occurredAt: "2026-01-22T10:00:00.000Z",
        sourceModule: "POS",
        sourceDocumentType: "Sale",
        sourceDocumentId: "8801",
        sourceDocumentNumber: "INV-8801",
        currencyCode: "RWF",
        amountTotals: { gross: "118000", net: "100000", tax: "18000" },
        paymentSplits: [{ paymentMethod: "CASH", amount: 118000 }],
        metadata: { paymentType: "CASH", cogs: 40_000, vsdcInvcNo: 42, sdcReceiptNumber: "42/99 NS", receiptSignature: "SIGTAX" },
      });
    expect(sale.status).toBe(201);

    const fiscal = await get("/fiscal-documents?from=2026-01-01&to=2026-01-31");
    expect(fiscal.total).toBeGreaterThanOrEqual(1);
    expect(fiscal.rows.some((r: { sdcReceiptNumber: string | null }) => r.sdcReceiptNumber === "42/99 NS")).toBe(true);

    const dash = await get("/dashboard");
    expect(dash.balances.vatPayable).toBeGreaterThan(0);
    expect(dash.settings.tin).toBe("888999000");

    const codes = await get("/codes");
    const vat18 = codes.find((c: { code: string }) => c.code === "VAT18");
    const patched = await request(app)
      .patch(`${base}/codes/${vat18.id}`)
      .set(accountant)
      .send({ notes: "Standard rate for taxable supplies" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.notes).toMatch(/Standard rate/);

    const recon = await get("/reconciliation?from=2026-01-01&to=2026-01-31");
    expect(recon.vat.ledgerVsGl).toBe(0);
    expect(recon.withholding.ledger).toBe(15_000);
  });
});

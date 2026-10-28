import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 95311;
const otherOrgId = 95312;

let admin: Record<string, string>;
let other: Record<string, string>;
let companyId = "";
const ids: Record<string, string> = {};

async function journalLines(journalId: string) {
  const lines = await prisma.journalLine.findMany({ where: { journalId }, orderBy: { lineNumber: "asc" } });
  return lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) }));
}

function pdf(path: string, headers: Record<string, string>) {
  return request(app)
    .get(path)
    .set(headers)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
}

describe("Wave C documents: lined invoices and bills, bill void, period statements, PDFs", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    admin = await activateCompany(app, orgId, { name: "WaveC Docs Co", tin: "953110001" });
    other = await activateCompany(app, otherOrgId, { name: "WaveC Other Co", tin: "953120002" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    expect((await request(app).get("/api/v1/tax/settings").set(admin)).status).toBe(200);

    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "Lined Buyer", customerType: "CREDIT", creditLimit: 10_000_000 });
    expect(customer.status).toBe(201);
    ids.customer = customer.body.data.id;
    const supplier = await request(app).post("/api/v1/ap/suppliers").set(admin).send({ name: "Lined Vendor", creditPeriodDays: 30 });
    expect(supplier.status).toBe(201);
    ids.supplier = supplier.body.data.id;
    const supplier2 = await request(app).post("/api/v1/ap/suppliers").set(admin).send({ name: "Settled Vendor" });
    ids.supplier2 = supplier2.body.data.id;
    const otherCustomer = await request(app).post("/api/v1/ar/customers").set(other).send({ name: "Foreign Buyer", customerType: "CREDIT", creditLimit: 1_000_000 });
    ids.otherCustomer = otherCustomer.body.data.id;
  });

  it("posts a lined invoice priced by tax code, line by line, with a balanced journal", async () => {
    const res = await request(app)
      .post("/api/v1/ar/invoices")
      .set(admin)
      .send({
        customerId: ids.customer,
        invoiceDate: "2026-01-10",
        lines: [
          { description: "Consulting", quantity: 3, unitPrice: 333.33, discount: 0.99, taxCode: "vat18" },
          { description: "Exempt books", quantity: 2, unitPrice: 250, taxCode: "VATEX" },
          { description: "Misc", quantity: 1, unitPrice: 100 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ net: "1599", tax: "179.82", gross: "1778.82", discount: "0" });
    ids.invoice = res.body.data.id;

    const detail = await request(app).get(`/api/v1/ar/invoices/${ids.invoice}`).set(admin);
    expect(detail.status).toBe(200);
    expect(detail.body.data.lines.map((l: { net: string; tax: string; taxCode: string | null; taxRate: string }) => [l.net, l.tax, l.taxCode, l.taxRate])).toEqual([
      ["999", "179.82", "VAT18", "18"],
      ["500", "0", "VATEX", "0"],
      ["100", "0", null, "0"],
    ]);
    expect(detail.body.data.outstanding).toBe(1778.82);

    const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
    const vat18 = await prisma.taxCode.findFirstOrThrow({ where: { companyId, code: "VAT18" } });
    const lines = await journalLines(detail.body.data.journalId);
    expect(lines).toEqual([
      { accountId: defaults.accountsReceivableId, debit: 1778.82, credit: 0 },
      { accountId: defaults.salesRevenueId, debit: 0, credit: 1599 },
      { accountId: vat18.glAccountId ?? defaults.outputTaxPayableId, debit: 0, credit: 179.82 },
    ]);
  });

  it("rejects unknown or wrong-side tax codes and bad lines", async () => {
    const send = (lines: unknown[], extra: Record<string, unknown> = {}) =>
      request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: ids.customer, invoiceDate: "2026-01-11", lines, ...extra });
    const unknown = await send([{ description: "x", quantity: 1, unitPrice: 10, taxCode: "NOPE" }]);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/tax code NOPE does not exist/);
    const purchaseCode = await send([{ description: "x", quantity: 1, unitPrice: 10, taxCode: "VATIN" }]);
    expect(purchaseCode.status).toBe(400);
    expect(purchaseCode.body.error).toMatch(/can't be used on a sales invoice/);
    expect((await send([{ description: "x", quantity: 0, unitPrice: 10 }])).status).toBe(400);
    expect((await send([{ description: "", quantity: 1, unitPrice: 10 }])).status).toBe(400);
    expect((await send([])).status).toBe(400);
    const overDiscount = await send([{ description: "x", quantity: 1, unitPrice: 10, discount: 11 }]);
    expect(overDiscount.body.error).toMatch(/discount is more/);
    const mixed = await send([{ description: "x", quantity: 1, unitPrice: 10 }], { net: 10 });
    expect(mixed.status).toBe(400);
    expect(mixed.body.error).toMatch(/from the lines/);

    const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
    const control = await send([{ description: "x", quantity: 1, unitPrice: 10, accountId: defaults.accountsReceivableId }]);
    expect(control.body.error).toMatch(/control account/);
    const otherCompany = await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(otherOrgId) } });
    const foreignAccount = await prisma.account.findFirstOrThrow({ where: { companyId: otherCompany.id, isActive: true, type: "INCOME" } });
    const foreign = await send([{ description: "x", quantity: 1, unitPrice: 10, accountId: foreignAccount.id }]);
    expect(foreign.body.error).toMatch(/line account does not exist/);

    const badBill = await request(app)
      .post("/api/v1/ap/bills")
      .set(admin)
      .send({ supplierId: ids.supplier, billDate: "2026-01-11", lines: [{ description: "x", quantity: 1, unitPrice: 10, taxCode: "VAT18" }] });
    expect(badBill.status).toBe(400);
    expect(badBill.body.error).toMatch(/can't be used on a supplier bill/);
    expect(await prisma.arInvoice.count({ where: { companyId } })).toBe(1);
  });

  it("lists invoices with status, date, customer and text filters", async () => {
    const second = await request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: ids.customer, invoiceDate: "2026-02-15", net: 500, description: "February retainer" });
    expect(second.status).toBe(201);
    ids.invoice2 = second.body.data.id;
    const receipt = await request(app)
      .post("/api/v1/ar/receipts")
      .set(admin)
      .send({ customerId: ids.customer, receiptDate: "2026-02-20", amount: 500, allocations: [{ invoiceId: ids.invoice2, amount: 500 }] });
    expect(receipt.status).toBe(201);

    const list = async (query: Record<string, string>) => {
      const res = await request(app).get("/api/v1/ar/invoices").query(query).set(admin);
      expect(res.status).toBe(200);
      return res.body.data;
    };
    const all = await list({});
    expect(all.total).toBe(2);
    expect(all.totals).toEqual({ gross: 2278.82, outstanding: 1778.82 });
    expect((await list({ status: "OPEN" })).rows.map((r: { id: string }) => r.id)).toEqual([ids.invoice]);
    expect((await list({ status: "PAID" })).rows.map((r: { id: string }) => r.id)).toEqual([ids.invoice2]);
    expect((await list({ status: "OVERDUE" })).rows.map((r: { id: string }) => r.id)).toEqual([ids.invoice]);
    expect((await list({ from: "2026-02-01" })).rows.map((r: { id: string }) => r.id)).toEqual([ids.invoice2]);
    expect((await list({ to: "2026-01-31" })).rows.map((r: { id: string }) => r.id)).toEqual([ids.invoice]);
    expect((await list({ q: "retainer" })).total).toBe(1);
    expect((await list({ customerId: ids.otherCustomer })).total).toBe(0);
    expect((await list({ pageSize: "1", page: "2" })).rows).toHaveLength(1);

    expect((await request(app).get("/api/v1/ar/invoices").query({ from: "2026-03-01", to: "2026-02-01" }).set(admin)).status).toBe(400);
    expect((await request(app).get("/api/v1/ar/invoices").query({ status: "BOGUS" }).set(admin)).status).toBe(400);
    expect((await request(app).get("/api/v1/ar/invoices").set(authHeaders(orgId, "SELLER", 442))).status).toBe(403);
    expect((await request(app).get(`/api/v1/ar/invoices/${ids.invoice}`).set(other)).status).toBe(404);
    expect((await request(app).get("/api/v1/ar/invoices").set(other)).body.data.total).toBe(0);
  });

  it("posts a lined bill with input VAT and voids it with an exact reversal", async () => {
    const res = await request(app)
      .post("/api/v1/ap/bills")
      .set(admin)
      .send({
        supplierId: ids.supplier,
        supplierInvoiceNumber: "LV-1",
        billDate: "2026-01-12",
        lines: [
          { description: "Rent", quantity: 1, unitPrice: 1000, taxCode: "VATIN" },
          { description: "Stationery", quantity: 4, unitPrice: 12.5, discount: 5 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ net: "1045", tax: "180", gross: "1225", status: "POSTED" });
    ids.bill = res.body.data.id;

    const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
    const vatIn = await prisma.taxCode.findFirstOrThrow({ where: { companyId, code: "VATIN" } });
    const vatAccount = vatIn.glAccountId ?? defaults.inputTaxReceivableId;
    const posted = await journalLines(res.body.data.journalId);
    expect(posted.find((l) => l.accountId === vatAccount)).toMatchObject({ debit: 180, credit: 0 });
    expect(posted.find((l) => l.credit > 0)).toMatchObject({ accountId: defaults.accountsPayableId, credit: 1225 });
    expect(posted.filter((l) => l.accountId !== vatAccount && l.debit > 0).reduce((s, l) => s + l.debit, 0)).toBe(1045);

    expect((await request(app).post(`/api/v1/ap/bills/${ids.bill}/void`).set(authHeaders(orgId, "BRANCH_MANAGER", 443)).send({ reason: "Wrong" })).status).toBe(403);
    expect((await request(app).post(`/api/v1/ap/bills/${ids.bill}/void`).set(admin).send({})).status).toBe(400);
    expect((await request(app).post(`/api/v1/ap/bills/${ids.bill}/void`).set(admin).send({ reason: "Early", voidDate: "2026-01-05" })).body.error).toMatch(/before the bill/);
    expect((await request(app).post(`/api/v1/ap/bills/${ids.bill}/void`).set(other).send({ reason: "Not mine" })).status).toBe(404);

    const voided = await request(app).post(`/api/v1/ap/bills/${ids.bill}/void`).set(admin).send({ reason: "Duplicate entry", voidDate: "2026-01-25" });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe("REVERSED");
    const reversal = await journalLines(voided.body.data.journalId);
    expect(reversal).toEqual(posted.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })));
    const bill = await prisma.apBill.findUniqueOrThrow({ where: { id: ids.bill } });
    expect(bill).toMatchObject({ status: "REVERSED", voidReason: "Duplicate entry", voidJournalId: voided.body.data.journalId, supplierInvoiceNumber: `LV-1 (void ${bill.billNumber})` });
    expect(Number((await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } })).balance)).toBe(0);
    expect(await prisma.auditEvent.count({ where: { companyId, entityType: "ApBill", entityId: ids.bill, action: "VOID" } })).toBe(1);

    const again = await request(app).post(`/api/v1/ap/bills/${ids.bill}/void`).set(admin).send({ reason: "Again" });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/only a posted bill/i);

    const reentered = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: ids.supplier, supplierInvoiceNumber: "LV-1", billDate: "2026-01-26", net: 100 });
    expect(reentered.status).toBe(201);
  });

  it("refuses to void a bill that was paid or credited", async () => {
    const paidBill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: ids.supplier2, billDate: "2026-01-15", net: 200 });
    const creditedBill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: ids.supplier2, billDate: "2026-01-16", net: 300 });
    expect(paidBill.status).toBe(201);
    expect(creditedBill.status).toBe(201);
    const payment = await request(app)
      .post("/api/v1/ap/payments")
      .set(admin)
      .send({ supplierId: ids.supplier2, paymentDate: "2026-01-20", amount: 100, reference: "EFT-1", allocations: [{ billId: paidBill.body.data.id, amount: 100 }] });
    expect(payment.status).toBe(201);
    ids.payment = payment.body.data.id;
    const credit = await request(app)
      .post("/api/v1/ap/credit-notes")
      .set(admin)
      .send({ supplierId: ids.supplier2, billId: creditedBill.body.data.id, noteDate: "2026-01-21", reason: "Short delivery", net: 50 });
    expect(credit.status).toBe(201);

    for (const id of [paidBill.body.data.id, creditedBill.body.data.id]) {
      const res = await request(app).post(`/api/v1/ap/bills/${id}/void`).set(admin).send({ reason: "Try" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/payments, credits or matched goods/);
    }
    expect(await prisma.apBill.count({ where: { companyId, status: "REVERSED" } })).toBe(1);
  });

  it("builds period statements with the balance brought forward and a running balance", async () => {
    const customer = await request(app).get(`/api/v1/ar/customers/${ids.customer}/period-statement`).query({ from: "2026-02-01", to: "2026-02-28" }).set(admin);
    expect(customer.status).toBe(200);
    expect(customer.body.data).toMatchObject({ from: "2026-02-01", to: "2026-02-28", openingBalance: 1778.82, totalCharged: 500, totalPaid: 500, closingBalance: 1778.82 });
    expect(customer.body.data.entries.map((e: { balance: number }) => e.balance)).toEqual([2278.82, 1778.82]);

    const quiet = await request(app).get(`/api/v1/ar/customers/${ids.customer}/period-statement`).query({ from: "2026-03-01", to: "2026-03-31" }).set(admin);
    expect(quiet.body.data).toMatchObject({ openingBalance: 1778.82, entries: [], closingBalance: 1778.82 });

    const supplier = await request(app).get(`/api/v1/ap/suppliers/${ids.supplier}/period-statement`).query({ from: "2026-01-20", to: "2026-01-31" }).set(admin);
    expect(supplier.status).toBe(200);
    expect(supplier.body.data).toMatchObject({ openingBalance: 1225, totalPaid: 1225, totalBilled: 100, closingBalance: 100 });
    expect(supplier.body.data.entries.map((e: { docType: string; balance: number }) => [e.docType, e.balance])).toEqual([
      ["BILL_VOID", 0],
      ["BILL", 100],
    ]);
    const supplier2 = await request(app).get(`/api/v1/ap/suppliers/${ids.supplier2}/period-statement`).query({ from: "2026-01-01", to: "2026-01-31" }).set(admin);
    expect(supplier2.body.data).toMatchObject({ openingBalance: 0, totalBilled: 500, closingBalance: 350 });

    expect((await request(app).get(`/api/v1/ar/customers/${ids.customer}/period-statement`).query({ from: "2026-03-01", to: "2026-02-01" }).set(admin)).status).toBe(400);
    expect((await request(app).get(`/api/v1/ar/customers/${ids.customer}/period-statement`).query({ from: "01/02/2026" }).set(admin)).status).toBe(400);
    expect((await request(app).get(`/api/v1/ar/customers/${ids.customer}/period-statement`).set(other)).status).toBe(404);
    expect((await request(app).get(`/api/v1/ap/suppliers/${ids.supplier}/period-statement`).set(other)).status).toBe(404);
  });

  it("prints invoices, statements and remittances as PDF, only within the company", async () => {
    const urls = [
      `/api/v1/ar/invoices/${ids.invoice}/pdf`,
      `/api/v1/ar/customers/${ids.customer}/statement.pdf?from=2026-01-01&to=2026-02-28`,
      `/api/v1/ap/suppliers/${ids.supplier2}/statement.pdf?from=2026-01-01&to=2026-01-31`,
      `/api/v1/ap/payments/${ids.payment}/remittance.pdf`,
    ];
    for (const url of urls) {
      const res = await pdf(url, admin);
      expect(res.status, url).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename=".+\.pdf"/);
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(body.toString("latin1")).toContain("%%EOF");
    }
    const invoicePdf = (await pdf(urls[0], admin)).body as Buffer;
    expect(invoicePdf.toString("latin1")).toContain("1,778.82");

    for (const url of urls) {
      const res = await request(app).get(url).set(other);
      expect(res.status, url).toBe(404);
    }
    expect((await request(app).get(urls[0]).set(authHeaders(orgId, "SELLER", 442))).status).toBe(403);
    expect((await request(app).get(urls[0])).status).toBe(401);
  });

  it("applies a customer deposit to an invoice without over-allocating under concurrency", async () => {
    const deposit = await request(app).post("/api/v1/ar/deposits").set(admin).send({ customerId: ids.customer, depositDate: "2026-03-01", amount: 500 });
    expect(deposit.status).toBe(201);
    const allocate = (amount: number, headers = admin) =>
      request(app).post(`/api/v1/ar/deposits/${deposit.body.data.id}/allocate`).set(headers).send({ invoiceId: ids.invoice, amount });

    expect((await allocate(600)).body.error).toMatch(/exceeds remaining deposit/);
    expect((await allocate(100, authHeaders(orgId, "BRANCH_MANAGER", 443))).status).toBe(403);
    expect((await allocate(100, other)).status).toBe(400);

    const results = await Promise.all([allocate(300), allocate(300)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const fresh = await prisma.arDeposit.findUniqueOrThrow({ where: { id: deposit.body.data.id } });
    expect(Number(fresh.remaining)).toBe(200);
    const invoice = await request(app).get(`/api/v1/ar/invoices/${ids.invoice}`).set(admin);
    expect(invoice.body.data.outstanding).toBe(1478.82);
  });

  it("keeps concurrent receipts and deposit applications on one invoice, and refunds a deposit once", async () => {
    const deposit = await request(app).post("/api/v1/ar/deposits").set(admin).send({ customerId: ids.customer, depositDate: "2026-03-02", amount: 300 });
    expect(deposit.status).toBe(201);
    const [receipt, applied] = await Promise.all([
      request(app)
        .post("/api/v1/ar/receipts")
        .set(admin)
        .send({ customerId: ids.customer, receiptDate: "2026-03-03", amount: 100, allocations: [{ invoiceId: ids.invoice, amount: 100 }] }),
      request(app).post(`/api/v1/ar/deposits/${deposit.body.data.id}/allocate`).set(admin).send({ invoiceId: ids.invoice, amount: 100 }),
    ]);
    expect([receipt.status, applied.status]).toEqual([201, 200]);
    const invoice = await prisma.arInvoice.findUniqueOrThrow({ where: { id: ids.invoice } });
    expect(Number(invoice.amountPaid)).toBe(500);

    const refund = () => request(app).post(`/api/v1/ar/deposits/${deposit.body.data.id}/refund`).set(admin).send({});
    const refunds = await Promise.all([refund(), refund()]);
    expect(refunds.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(Number((await prisma.arDeposit.findUniqueOrThrow({ where: { id: deposit.body.data.id } })).remaining)).toBe(0);
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "ArDepositRefund", sourceDocumentId: deposit.body.data.id } })).toBe(1);
  });

  it("allocates and refunds a supplier advance only up to what is left, under concurrency", async () => {
    const bill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: ids.supplier, billDate: "2026-03-01", net: 400 });
    const advance = await request(app).post("/api/v1/ap/advances").set(admin).send({ supplierId: ids.supplier, advanceDate: "2026-03-01", amount: 500 });
    expect([bill.status, advance.status]).toEqual([201, 201]);
    const allocate = () =>
      request(app).post(`/api/v1/ap/advances/${advance.body.data.id}/allocate`).set(admin).send({ billId: bill.body.data.id, amount: 300, allocationDate: "2026-03-02" });
    const allocations = await Promise.all([allocate(), allocate()]);
    expect(allocations.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(Number((await prisma.apBill.findUniqueOrThrow({ where: { id: bill.body.data.id } })).amountPaid)).toBe(300);

    const refund = () => request(app).post(`/api/v1/ap/advances/${advance.body.data.id}/refund`).set(admin).send({ amount: 150, refundDate: "2026-03-03" });
    const refunds = await Promise.all([refund(), refund()]);
    expect(refunds.map((r) => r.status).sort()).toEqual([200, 400]);
    const fresh = await prisma.apAdvance.findUniqueOrThrow({ where: { id: advance.body.data.id } });
    expect([Number(fresh.remaining), Number(fresh.refunded)]).toEqual([50, 150]);
  });

  it("voids a bill once under concurrency, and never alongside a payment for it", async () => {
    const bill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: ids.supplier, billDate: "2026-03-05", net: 50 });
    const voidIt = (id: string) => request(app).post(`/api/v1/ap/bills/${id}/void`).set(admin).send({ reason: "Twice", voidDate: "2026-03-06" });
    const voids = await Promise.all([voidIt(bill.body.data.id), voidIt(bill.body.data.id)]);
    expect(voids.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "ApBillVoid", sourceDocumentId: bill.body.data.id } })).toBe(1);

    const before = Number((await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } })).balance);
    const contested = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: ids.supplier, billDate: "2026-03-05", net: 80 });
    const [voided, paid] = await Promise.all([
      voidIt(contested.body.data.id),
      request(app)
        .post("/api/v1/ap/payments")
        .set(admin)
        .send({ supplierId: ids.supplier, paymentDate: "2026-03-06", amount: 80, allowUnallocated: false, allocations: [{ billId: contested.body.data.id, amount: 80 }] }),
    ]);
    expect([voided.status, paid.status].filter((s) => s < 300)).toHaveLength(1);
    const after = await prisma.apBill.findUniqueOrThrow({ where: { id: contested.body.data.id } });
    expect(after.status === "REVERSED" ? Number(after.amountPaid) : Number(after.amountPaid) - 80).toBe(0);
    expect(Number((await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } })).balance)).toBe(before);
  });

  it("refuses to void the bill behind a debit note", async () => {
    const note = await request(app).post("/api/v1/ap/debit-notes").set(admin).send({ supplierId: ids.supplier, noteDate: "2026-03-07", reason: "Freight recharge", net: 40 });
    expect(note.status).toBe(201);
    const bill = await prisma.apBill.findFirstOrThrow({ where: { companyId, sourceDocumentType: "ApDebitNote", sourceDocumentId: note.body.data.id } });
    const res = await request(app).post(`/api/v1/ap/bills/${bill.id}/void`).set(admin).send({ reason: "Undo" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/debit note/);
  });

  it("refuses unmapped excise codes and line accounts closed to automatic posting", async () => {
    const outputVat = await prisma.account.findFirstOrThrow({ where: { id: (await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } })).outputTaxPayableId! } });
    const excise = await prisma.taxCode.create({
      data: { companyId, code: "EXC10", name: "Excise 10%", taxType: "EXCISE", ratePercent: 10, effectiveFrom: new Date("2020-01-01") },
    });
    const send = (line: Record<string, unknown>) =>
      request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: ids.customer, invoiceDate: "2026-03-08", lines: [{ description: "Beer", quantity: 1, unitPrice: 100, ...line }] });
    const unmapped = await send({ taxCode: "EXC10" });
    expect(unmapped.status).toBe(400);
    expect(unmapped.body.error).toMatch(/excise and needs its own GL account/);

    const exciseAccount = await prisma.account.create({ data: { companyId, code: "2298", name: "Excise payable", type: outputVat.type } });
    await prisma.taxCode.update({ where: { id: excise.id }, data: { glAccountId: exciseAccount.id } });
    const mapped = await send({ taxCode: "EXC10" });
    expect(mapped.status).toBe(201);
    expect((await journalLines(mapped.body.data.journalId)).find((l) => l.accountId === exciseAccount.id)).toMatchObject({ credit: 10 });
    expect((await journalLines(mapped.body.data.journalId)).some((l) => l.accountId === outputVat.id)).toBe(false);

    const closed = await prisma.account.create({ data: { companyId, code: "4998", name: "Manual-only income", type: "INCOME", allowAutoPost: false } });
    const rejected = await send({ accountId: closed.id });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/does not accept automatic postings/);
  });
});

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98701;

let admin: Record<string, string>;
let companyId = "";

describe("Foreign-currency AR and AP", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "FX Co", tin: "123470001" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    await request(app).post("/api/v1/books/fx/rates").set(admin).send({ currency: "USD", rateDate: "2026-01-01", rate: 1300, source: "BNR" });
    await request(app).post("/api/v1/books/fx/rates").set(admin).send({ currency: "USD", rateDate: "2026-01-20", rate: 1400, source: "BNR" });
  });

  it("posts a foreign invoice at the rate and realizes FX when the receipt rate differs", async () => {
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "Dollar Buyer", customerType: "CREDIT", creditLimit: 10_000_000, currency: "USD" });
    expect(customer.status).toBe(201);

    const invoice = await request(app)
      .post("/api/v1/ar/invoices")
      .set(admin)
      .send({ customerId: customer.body.data.id, invoiceDate: "2026-01-10", net: 100 });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.currency).toBe("USD");
    expect(Number(invoice.body.data.exchangeRate)).toBe(1300);
    expect(Number(invoice.body.data.gross)).toBe(100);
    const journal = await prisma.journal.findUniqueOrThrow({ where: { id: invoice.body.data.journalId }, include: { lines: true } });
    expect(journal.currencyCode).toBe("USD");
    expect(Number(journal.exchangeRate)).toBe(1300);
    expect(Number(journal.totalDebit)).toBe(130_000);

    const receipt = await request(app)
      .post("/api/v1/ar/receipts")
      .set(admin)
      .send({
        customerId: customer.body.data.id,
        receiptDate: "2026-01-25",
        amount: 100,
        method: "BANK",
        allocations: [{ invoiceId: invoice.body.data.id, amount: 100 }],
      });
    expect(receipt.status).toBe(201);
    expect(Number(receipt.body.data.exchangeRate)).toBe(1400);
    const settle = await prisma.journal.findUniqueOrThrow({ where: { id: receipt.body.data.journalId }, include: { lines: true } });
    expect(settle.currencyCode).toBe("RWF");
    const byAccount = Object.fromEntries(
      (
        await Promise.all(
          settle.lines.map(async (l) => {
            const a = await prisma.account.findUniqueOrThrow({ where: { id: l.accountId } });
            return [a.code, { debit: Number(l.debit), credit: Number(l.credit) }] as const;
          }),
        )
      ),
    );
    expect(byAccount["1100"]?.debit ?? byAccount["1110"]?.debit ?? Object.values(byAccount).find((v) => v.debit === 140_000)?.debit).toBe(140_000);
    expect(Object.values(byAccount).some((v) => v.credit === 130_000)).toBe(true);
    expect(Object.values(byAccount).some((v) => v.credit === 10_000)).toBe(true);
    expect(Number((await prisma.arInvoice.findUniqueOrThrow({ where: { id: invoice.body.data.id } })).amountPaid)).toBe(100);
  });

  it("posts a foreign bill and realizes FX on payment", async () => {
    const supplier = await request(app).post("/api/v1/ap/suppliers").set(admin).send({ name: "Dollar Vendor", currency: "USD" });
    expect(supplier.status).toBe(201);
    const bill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: supplier.body.data.id, billDate: "2026-01-10", net: 50 });
    expect(bill.status).toBe(201);
    expect(bill.body.data.currency).toBe("USD");
    expect(Number(bill.body.data.exchangeRate)).toBe(1300);
    const journal = await prisma.journal.findUniqueOrThrow({ where: { id: bill.body.data.journalId } });
    expect(Number(journal.totalDebit)).toBe(65_000);

    const payment = await request(app)
      .post("/api/v1/ap/payments")
      .set(admin)
      .send({
        supplierId: supplier.body.data.id,
        paymentDate: "2026-01-25",
        amount: 50,
        method: "BANK",
        allocations: [{ billId: bill.body.data.id, amount: 50 }],
      });
    expect(payment.status).toBe(201);
    const settle = await prisma.journal.findUniqueOrThrow({ where: { id: payment.body.data.journalId }, include: { lines: true } });
    expect(settle.lines.some((l) => Number(l.debit) === 65_000)).toBe(true);
    expect(settle.lines.some((l) => Number(l.credit) === 70_000)).toBe(true);
    expect(settle.lines.some((l) => Number(l.debit) === 5_000)).toBe(true);
  });

  it("refuses a document when no rate exists, and a mismatched party currency", async () => {
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "Euro Buyer", customerType: "CREDIT", creditLimit: 1_000_000, currency: "EUR" });
    const missing = await request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: customer.body.data.id, invoiceDate: "2026-01-15", net: 10 });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/No exchange rate for EUR/);

    const usd = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "USD Only", customerType: "CREDIT", creditLimit: 1_000_000, currency: "USD" });
    const mismatch = await request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: usd.body.data.id, invoiceDate: "2026-01-15", net: 10, currency: "EUR" });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatch(/cannot be in EUR/);
  });
});

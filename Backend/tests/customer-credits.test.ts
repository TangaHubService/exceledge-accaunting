import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { LEGACY_CONTROLS, resetCompany, signErpToken } from "./helpers";

const app = createApp();
const orgId = 94077;

async function activateCompany() {
  const headers = {
    Authorization: `Bearer ${signErpToken({
      activeOrganizationId: orgId,
      role: "ADMIN",
      userId: 441,
    })}`,
  };
  await request(app).get("/api/v1/setup/dashboard").set(headers);
  await request(app)
    .put("/api/v1/setup/profile")
    .set(headers)
    .send({ registeredName: "Credits Co", taxIdentificationNumber: "444555666", country: "RW" });
  await request(app)
    .put("/api/v1/setup/business-info")
    .set(headers)
    .send({ accountingBasis: "ACCRUAL", reportingFramework: "IFRS_SME" });
  await request(app).post("/api/v1/setup/financial-years").set(headers).send({
    name: "FY 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodFrequency: "MONTHLY",
  });
  await request(app).put("/api/v1/setup/currency").set(headers).send({ functionalCurrency: "RWF" });
  await request(app).put("/api/v1/setup/policies").set(headers).send({ inventoryValuationMethod: "WEIGHTED_AVERAGE" });
  await request(app)
    .put("/api/v1/setup/localization")
    .set(headers)
    .send({ countryOfRegistration: "RW", localizationPackage: "RW", taxAuthority: "RRA" });
  await request(app).post("/api/v1/setup/default-accounts/ensure").set(headers);
  await request(app).put("/api/v1/setup/inventory-settings").set(headers).send({});
  await request(app).put("/api/v1/setup/party-defaults").set(headers).send({});
  await request(app).put("/api/v1/setup/banking").set(headers).send({});
  await request(app).post("/api/v1/setup/numbering/ensure").set(headers);
  await request(app).put("/api/v1/setup/approvals").set(headers).send(LEGACY_CONTROLS);
  for (const key of ["FINANCIAL_YEAR_PERIODS", "CURRENCY", "ACCOUNTING_POLICIES"]) {
    await request(app).post(`/api/v1/setup/sections/${key}/approve`).set(headers);
  }
  const act = await request(app).post("/api/v1/setup/activation/activate").set(headers);
  expect(act.status).toBe(200);
  return headers;
}

describe("Customer centre: apply credits", () => {
  let headers: Record<string, string>;
  let customerId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany();
    const c = await request(app).post("/api/v1/ar/customers").set(headers).send({ name: "Credit Buyer", openingBalance: 300, openingBalanceDate: "2026-02-01" });
    expect(c.status).toBe(201);
    customerId = c.body.data.id;
  });

  it("lists the opening balance on the statement with its invoice id", async () => {
    const s = await request(app).get(`/api/v1/ar/customers/${customerId}/statement`).set(headers);
    expect(s.body.data.rows).toHaveLength(1);
    expect(s.body.data.rows[0].id).toBeTruthy();
  });

  it("applies an unapplied payment, a credit note and a deposit to open invoices", async () => {
    const inv = await request(app).post("/api/v1/ar/invoices").set(headers).send({ customerId, invoiceDate: "2026-03-01", net: 1000 });
    expect(inv.status).toBe(201);
    const pay = await request(app).post("/api/v1/ar/receipts").set(headers).send({ customerId, receiptDate: "2026-03-05", amount: 500, allowOverpayment: true });
    expect(pay.status).toBe(201);
    const cn = await request(app).post("/api/v1/ar/credit-notes").set(headers).send({ customerId, noteDate: "2026-03-06", reason: "Discount", net: 200 });
    expect(cn.status).toBe(201);
    expect(Number(cn.body.data.unapplied)).toBe(200);
    const dep = await request(app).post("/api/v1/ar/deposits").set(headers).send({ customerId, depositDate: "2026-03-07", amount: 100 });
    expect(dep.status).toBe(201);

    const before = await request(app).get(`/api/v1/ar/customers/${customerId}/summary`).set(headers);
    expect(before.body.data.outstanding).toBe(600); // 300 opening + 1000 − 500 − 200
    expect(before.body.data.availableCredit).toBe(800);

    const credits = await request(app).get(`/api/v1/ar/customers/${customerId}/credits`).set(headers);
    expect(credits.body.data.credits.map((c: { type: string }) => c.type).sort()).toEqual(["CREDIT_NOTE", "DEPOSIT", "PAYMENT"]);
    expect(credits.body.data.invoices).toHaveLength(2);
    const opening = credits.body.data.invoices.find((i: { isOpening: boolean }) => i.isOpening);

    // Over-applying is refused and nothing is saved.
    const over = await request(app)
      .post(`/api/v1/ar/customers/${customerId}/apply-credits`)
      .set(headers)
      .send({ applications: [{ source: "PAYMENT", sourceId: pay.body.data.id, invoiceId: opening.id, amount: 400 }] });
    expect(over.status).toBe(400);

    const ok = await request(app)
      .post(`/api/v1/ar/customers/${customerId}/apply-credits`)
      .set(headers)
      .send({
        applications: [
          { source: "PAYMENT", sourceId: pay.body.data.id, invoiceId: opening.id, amount: 300 },
          { source: "PAYMENT", sourceId: pay.body.data.id, invoiceId: inv.body.data.id, amount: 200 },
          { source: "CREDIT_NOTE", sourceId: cn.body.data.id, invoiceId: inv.body.data.id, amount: 150 },
          { source: "DEPOSIT", sourceId: dep.body.data.id, invoiceId: inv.body.data.id, amount: 100 },
        ],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.total).toBe(750);

    const after = await request(app).get(`/api/v1/ar/customers/${customerId}/summary`).set(headers);
    // Payment and credit note were already off the balance; the deposit comes off now.
    expect(after.body.data.outstanding).toBe(500);
    expect(after.body.data.availableCredit).toBe(50);
    expect(after.body.data.openInvoiceCount).toBe(1);

    const invoice = await request(app).get(`/api/v1/ar/invoices/${inv.body.data.id}`).set(headers);
    expect(invoice.body.data.outstanding).toBe(550);
    const openingAfter = await request(app).get(`/api/v1/ar/invoices/${opening.id}`).set(headers);
    expect(openingAfter.body.data.outstanding).toBe(0);

    const note = await request(app).get(`/api/v1/ar/transactions/CREDIT_NOTE/${cn.body.data.id}`).set(headers);
    expect(note.body.data.open).toBe(50);
    expect(note.body.data.applications).toHaveLength(1);

    // Reversing the payment puts its later applications back on the invoices.
    const rev = await request(app).post(`/api/v1/ar/receipts/${pay.body.data.id}/reverse`).set(headers);
    expect(rev.status).toBe(200);
    const reopened = await request(app).get(`/api/v1/ar/invoices/${opening.id}`).set(headers);
    expect(reopened.body.data.outstanding).toBe(300);

    const activity = await request(app).get(`/api/v1/ar/customers/${customerId}/activity`).set(headers);
    expect(activity.body.data.some((a: { title: string }) => a.title === "Credits applied")).toBe(true);
  });

  it("refuses credits that belong to another customer", async () => {
    const other = await request(app).post("/api/v1/ar/customers").set(headers).send({ name: "Someone Else" });
    const cn = await request(app).post("/api/v1/ar/credit-notes").set(headers).send({ customerId: other.body.data.id, noteDate: "2026-03-06", reason: "x", net: 10 });
    const credits = await request(app).get(`/api/v1/ar/customers/${customerId}/credits`).set(headers);
    const inv = credits.body.data.invoices[0];
    const res = await request(app)
      .post(`/api/v1/ar/customers/${customerId}/apply-credits`)
      .set(headers)
      .send({ applications: [{ source: "CREDIT_NOTE", sourceId: cn.body.data.id, invoiceId: inv.id, amount: 10 }] });
    expect(res.status).toBe(400);
  });

  it("removes applied payments, credits and deposits, then voids the invoice", async () => {
    const c = await request(app).post("/api/v1/ar/customers").set(headers).send({ name: "Void Tester" });
    const id = c.body.data.id;
    const inv = await request(app).post("/api/v1/ar/invoices").set(headers).send({ customerId: id, invoiceDate: "2026-04-01", net: 1000 });
    const invoiceId = inv.body.data.id;
    const pay = await request(app).post("/api/v1/ar/receipts").set(headers).send({ customerId: id, receiptDate: "2026-04-02", amount: 300, allocations: [{ invoiceId, amount: 300 }] });
    expect(pay.status).toBe(201);
    const cn = await request(app).post("/api/v1/ar/credit-notes").set(headers).send({ customerId: id, noteDate: "2026-04-03", reason: "Goodwill", net: 100 });
    const dep = await request(app).post("/api/v1/ar/deposits").set(headers).send({ customerId: id, depositDate: "2026-04-04", amount: 200 });
    const apply = await request(app)
      .post(`/api/v1/ar/customers/${id}/apply-credits`)
      .set(headers)
      .send({ applications: [{ source: "CREDIT_NOTE", sourceId: cn.body.data.id, invoiceId, amount: 100 }, { source: "DEPOSIT", sourceId: dep.body.data.id, invoiceId, amount: 200 }] });
    expect(apply.status).toBe(200);

    // Voiding is refused while anything is applied.
    const early = await request(app).post(`/api/v1/ar/invoices/${invoiceId}/void`).set(headers).send({});
    expect(early.status).toBe(400);

    const apps = await request(app).get(`/api/v1/ar/invoices/${invoiceId}/applications`).set(headers);
    expect(apps.body.data.rows.map((r: { kind: string }) => r.kind).sort()).toEqual(["CREDIT_NOTE", "DEPOSIT", "PAYMENT"]);
    expect(apps.body.data.outstanding).toBe(400);
    const balanceBefore = (await request(app).get(`/api/v1/ar/customers/${id}/summary`).set(headers)).body.data.outstanding;
    expect(balanceBefore).toBe(400); // 1000 − 300 − 100 − 200

    for (const r of apps.body.data.rows) {
      const del = await request(app).delete(`/api/v1/ar/applications/${r.kind}/${r.id}`).set(headers);
      expect(del.status).toBe(200);
    }
    const after = (await request(app).get(`/api/v1/ar/customers/${id}/summary`).set(headers)).body.data;
    // Payment and credit note stay off the balance as credit; the deposit goes back to deposits.
    expect(after.outstanding).toBe(600);
    expect(after.availableCredit).toBe(600);
    expect((await request(app).get(`/api/v1/ar/invoices/${invoiceId}`).set(headers)).body.data.outstanding).toBe(1000);

    const voided = await request(app).post(`/api/v1/ar/invoices/${invoiceId}/void`).set(headers).send({ reason: "Raised in error" });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe("REVERSED");
    const final = (await request(app).get(`/api/v1/ar/customers/${id}/summary`).set(headers)).body.data;
    expect(final.outstanding).toBe(-400); // 300 payment + 100 credit note left in credit
    expect(final.totalInvoiced).toBe(0);
    const again = await request(app).post(`/api/v1/ar/invoices/${invoiceId}/void`).set(headers).send({});
    expect(again.status).toBe(400);

    // The void posts its own reversing journal next to the original.
    const journals = await prisma.journal.findMany({ where: { sourceDocumentId: invoiceId }, select: { sourceDocumentType: true } });
    expect(journals.map((j) => j.sourceDocumentType).sort()).toEqual(["ArInvoice", "ArInvoiceVoid"]);
  });

  it("lists estimates in the customer's transactions without counting them", async () => {
    const c = await request(app).post("/api/v1/ar/customers").set(headers).send({ name: "Estimate Tester" });
    const est = await request(app)
      .post("/api/v1/commercial/estimate")
      .set(headers)
      .send({ customerId: c.body.data.id, docDate: "2026-05-01", lines: [{ description: "Survey", quantity: 1, unitPrice: 250 }] });
    expect(est.status).toBe(201);
    const tx = await request(app).get(`/api/v1/ar/customers/${c.body.data.id}/transactions`).set(headers);
    expect(tx.body.data.rows).toHaveLength(1);
    expect(tx.body.data.rows[0]).toMatchObject({ type: "ESTIMATE", posting: false });
    expect(tx.body.data.totals.total).toBe(0);
  });
});

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { sentMail } from "../src/lib/mailer";
import { prisma } from "../src/lib/prisma";
import { LEGACY_CONTROLS, resetCompany, signErpToken } from "./helpers";

const app = createApp();
const orgId = 94078;

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
    .send({ registeredName: "Extras Co", taxIdentificationNumber: "444555666", country: "RW" });
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

describe("Customer centre: sub-customers, tax exemption, merge and more", () => {
  let headers: Record<string, string>;
  const post = (path: string, body: unknown) => request(app).post(path).set(headers).send(body as object);
  const get = (path: string) => request(app).get(path).set(headers);

  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany();
  });

  it("keeps sub-customer chains valid and rolls balances up", async () => {
    const parent = (await post("/api/v1/ar/customers", { name: "Head Office", tags: ["Key account", " key account ", "Retail"] })).body.data;
    expect(parent.tags).toEqual(["Key account", "Retail"]);
    const child = (await post("/api/v1/ar/customers", { name: "Branch A", parentId: parent.id })).body.data;
    expect(child.parentId).toBe(parent.id);
    const loop = await request(app).patch(`/api/v1/ar/customers/${parent.id}`).set(headers).send({ parentId: child.id });
    expect(loop.status).toBe(400);
    await post("/api/v1/ar/invoices", { customerId: child.id, invoiceDate: "2026-06-01", net: 500 });
    const profile = (await get(`/api/v1/ar/customers/${parent.id}`)).body.data;
    expect(profile.children.map((c: { name: string }) => c.name)).toEqual(["Branch A"]);
    expect(profile.balanceWithSubCustomers).toBe(500);
    const byTag = (await get("/api/v1/ar/customers?page=1&tag=Retail")).body.data;
    expect(byTag.rows.map((r: { name: string }) => r.name)).toEqual(["Head Office"]);
    expect(byTag.tags.some((t: { tag: string }) => t.tag === "Key account")).toBe(true);
  });

  it("invoices a tax-exempt customer without tax", async () => {
    const c = (await post("/api/v1/ar/customers", { name: "Embassy", taxExempt: true, taxExemptReason: "Diplomatic mission" })).body.data;
    const inv = await post("/api/v1/ar/invoices", { customerId: c.id, invoiceDate: "2026-06-02", net: 1000, tax: 180 });
    expect(inv.status).toBe(201);
    expect(Number(inv.body.data.tax)).toBe(0);
    expect(Number(inv.body.data.gross)).toBe(1000);
  });

  it("takes a credit note issued against an invoice back off it, and a void reopens the estimate", async () => {
    const c = (await post("/api/v1/ar/customers", { name: "Reopen Ltd" })).body.data;
    const est = (await post("/api/v1/commercial/estimate", { customerId: c.id, docDate: "2026-06-03", lines: [{ description: "Job", quantity: 1, unitPrice: 800 }] })).body.data;
    const converted = (await post(`/api/v1/commercial/documents/${est.id}/convert`, { target: "INVOICE" })).body.data;
    const invoiceId = converted.converted.id;
    const cn = (await post("/api/v1/ar/credit-notes", { customerId: c.id, invoiceId, noteDate: "2026-06-04", reason: "Short delivery", net: 100 })).body.data;
    const apps = (await get(`/api/v1/ar/invoices/${invoiceId}/applications`)).body.data;
    const onIssue = apps.rows.find((r: { kind: string }) => r.kind === "CREDIT_ON_ISSUE");
    expect(onIssue.removable).toBe(true);
    expect((await request(app).delete(`/api/v1/ar/applications/CREDIT_ON_ISSUE/${cn.id}`).set(headers)).status).toBe(200);
    expect((await get(`/api/v1/ar/customers/${c.id}/summary`)).body.data.availableCredit).toBe(100);
    expect((await post(`/api/v1/ar/invoices/${invoiceId}/void`, {})).status).toBe(200);
    const doc = (await get(`/api/v1/commercial/documents/${est.id}`)).body.data;
    expect(doc.status).toBe("ACCEPTED");
    expect(doc.convertedToId).toBeNull();
  });

  it("shows refunds and unbilled delayed charges on the customer", async () => {
    const c = (await post("/api/v1/ar/customers", { name: "Refund Co" })).body.data;
    const bank = (await post("/api/v1/banking/accounts", { kind: "BANK", name: "Refund Bank", openingBalance: 10_000, dateOpened: "2026-01-01" })).body.data;
    const income = await prisma.account.findFirstOrThrow({ where: { company: { externalErpOrganizationId: String(orgId) }, code: "1900" } });
    const refund = await post("/api/v1/banking/payments", {
      financialAccountId: bank.id,
      transactionDate: "2026-06-05",
      partyType: "CUSTOMER",
      partyName: c.name,
      relatedCustomerId: c.id,
      lines: [{ accountId: income.id, amount: 50 }],
    });
    expect(refund.status).toBe(201);
    const tx = (await get(`/api/v1/ar/customers/${c.id}/transactions?type=REFUND`)).body.data;
    expect(tx.rows).toHaveLength(1);
    expect(tx.rows[0]).toMatchObject({ type: "REFUND", posting: false, total: 50 });
    // Money in can't be tagged as a refund.
    const wrongWay = await post("/api/v1/banking/receipts", { financialAccountId: bank.id, transactionDate: "2026-06-05", relatedCustomerId: c.id, lines: [{ accountId: income.id, amount: 5 }] });
    expect(wrongWay.status).toBe(400);
    await post("/api/v1/commercial/delayed-charge", { customerId: c.id, docDate: "2026-06-05", lines: [{ description: "Call-out", quantity: 1, unitPrice: 70 }] });
    const summary = (await get(`/api/v1/ar/customers/${c.id}/summary`)).body.data;
    expect(summary.moneyBar.unbilled.amount).toBe(70);
  });

  it("merges one customer into another and keeps the ledger consistent", async () => {
    const a = (await post("/api/v1/ar/customers", { name: "Dup One", openingBalance: 200, openingBalanceDate: "2026-01-15", tags: ["A"] })).body.data;
    const b = (await post("/api/v1/ar/customers", { name: "Dup Two", tags: ["B"] })).body.data;
    await post("/api/v1/ar/invoices", { customerId: b.id, invoiceDate: "2026-06-06", net: 300 });
    await post("/api/v1/ar/receipts", { customerId: a.id, receiptDate: "2026-06-07", amount: 50, allowOverpayment: true });
    await post(`/api/v1/ar/customers/${a.id}/notes`, { body: "Called" });
    const sub = (await post("/api/v1/ar/customers", { name: "Dup One Branch", parentId: a.id })).body.data;

    const merged = await post(`/api/v1/ar/customers/${a.id}/merge`, { intoCustomerId: b.id });
    expect(merged.status).toBe(200);
    expect(merged.body.data.balance).toBe(450);
    expect((await get(`/api/v1/ar/customers/${a.id}`)).status).toBe(404);

    const target = (await get(`/api/v1/ar/customers/${b.id}`)).body.data;
    expect(Number(target.balance)).toBe(450);
    expect(target.tags.sort()).toEqual(["A", "B"]);
    expect(target.children.map((k: { id: string }) => k.id)).toContain(sub.id);
    const ledger = (await get(`/api/v1/ar/customers/${b.id}/ledger`)).body.data;
    expect(ledger.closingBalance).toBe(450);
    const tx = (await get(`/api/v1/ar/customers/${b.id}/transactions`)).body.data;
    expect(tx.rows.length).toBe(3);
    const notes = (await get(`/api/v1/ar/customers/${b.id}/notes`)).body.data;
    expect(notes).toHaveLength(1);
    const lines = await prisma.journalLine.count({ where: { customerRef: a.id } });
    expect(lines).toBe(0);

    expect((await post(`/api/v1/ar/customers/${b.id}/merge`, { intoCustomerId: b.id })).status).toBe(400);
  });

  it("manages extra contacts", async () => {
    const c = (await post("/api/v1/ar/customers", { name: "Contacts Ltd" })).body.data;
    const added = await post(`/api/v1/ar/customers/${c.id}/contacts`, { name: "Grace", role: "Accounts", email: "GRACE@x.test" });
    expect(added.status).toBe(201);
    expect(added.body.data.email).toBe("grace@x.test");
    expect((await get(`/api/v1/ar/customers/${c.id}`)).body.data.contacts).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/ar/customers/${c.id}/contacts/${added.body.data.id}`).set(headers)).status).toBe(200);
  });

  it("emails invoices, reminders and statements with the PDF attached", async () => {
    const c = (await post("/api/v1/ar/customers", { name: "Mail Me Ltd", email: "ap@mailme.test" })).body.data;
    const inv = (await post("/api/v1/ar/invoices", { customerId: c.id, invoiceDate: "2026-02-01", dueDate: "2026-02-15", net: 400 })).body.data;
    const before = sentMail.length;
    const sent = await post(`/api/v1/ar/invoices/${inv.id}/email`, {});
    expect(sent.status).toBe(200);
    expect(sentMail[before]).toMatchObject({ to: "ap@mailme.test", subject: expect.stringContaining(inv.invoiceNumber) });
    expect(sentMail[before].attachments[0]).toMatch(/\.pdf$/);
    const reminder = await post(`/api/v1/ar/invoices/${inv.id}/email`, { reminder: true, to: "boss@mailme.test", cc: "ap@mailme.test" });
    expect(reminder.status).toBe(200);
    expect(sentMail.at(-1)!.subject).toMatch(/reminder/i);
    expect(sentMail.at(-1)!.text).toMatch(/overdue/);
    const statement = await post(`/api/v1/ar/customers/${c.id}/statement/email`, { from: "2026-01-01", toDate: "2026-06-30" });
    expect(statement.status).toBe(200);
    expect(sentMail.at(-1)!.subject).toMatch(/Statement/);
    expect((await post(`/api/v1/ar/invoices/${inv.id}/email`, { to: "not-an-email" })).status).toBe(400);
    const activity = (await get(`/api/v1/ar/customers/${c.id}/activity`)).body.data;
    expect(activity.filter((a: { title: string }) => a.title.startsWith("Emailed")).length).toBe(3);
  });
});

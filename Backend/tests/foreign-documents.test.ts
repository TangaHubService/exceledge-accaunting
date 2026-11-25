import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96951;
let h: Record<string, string>;
let companyId: string;
const acct: Record<string, string> = {};
const post = (url: string, body: unknown = {}) => request(app).post(`/api/v1${url}`).set(h).send(body as object);
const get = (url: string) => request(app).get(`/api/v1${url}`).set(h);
let d: Record<string, string>;
const bal = async (id: string) => {
  const s = await prisma.glEntry.aggregate({ where: { companyId, accountId: id }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
};
/** Net realized FX so far: a loss is positive. */
const fx = async () => (await bal(d.fxGainId)) + (await bal(d.fxLossId));
const ageing = async (side: "ar" | "ap", asOf: string) => (await get(`/${side}/ageing?asOf=${asOf}`)).body.data.total as number;
/** The subledgers, documents and journals agree. (These books hold no opening cash.) */
const errors = async () => (await post("/books/integrity/run")).body.data.findings.filter((f: { severity: string; check: string }) => f.severity === "ERROR" && f.check !== "NEGATIVE_CASH").length;
const ok = async (p: ReturnType<typeof post>) => {
  const r = await p;
  expect(r.body.error ?? null).toBeNull();
  return r.body.data;
};

beforeAll(async () => {
  await resetCompany(orgId);
  h = await activateCompany(app, orgId, { name: "Foreign Co", tin: "555444997" });
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
  for (const [rateDate, rate] of [["2026-01-01", 1300], ["2026-02-01", 1350], ["2026-03-01", 1400]] as const) await ok(post("/books/fx/rates", { currency: "USD", rateDate, rate }));
  await get("/tax/codes");
  await post("/books/trial-balance");
  d = (await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } })) as unknown as Record<string, string>;
});

describe("Customers paying in a foreign currency", () => {
  it("holds a deposit at its rate, clears the invoice at its own, and books the difference", async () => {
    const c = (await ok(post("/ar/customers", { name: "Dollar Buyer", customerType: "CREDIT", creditLimit: 1e9, currency: "USD" }))).id;
    const dep = await ok(post("/ar/deposits", { customerId: c, depositDate: "2026-01-10", amount: 100, method: "BANK" }));
    expect(dep).toMatchObject({ currency: "USD" });
    expect(await bal(d.customerDepositsId)).toBe(-130_000);
    const inv = await ok(post("/ar/invoices", { customerId: c, invoiceDate: "2026-02-10", lines: [{ description: "Work", quantity: 1, unitPrice: 60 }] }));
    const before = await fx();
    await ok(post(`/ar/deposits/${dep.id}/allocate`, { invoiceId: inv.id, amount: 60, date: "2026-02-12" }));
    // 60 USD held at 1,300 settles a debt booked at 1,350: 3,000 lost.
    expect((await fx()) - before).toBe(3_000);
    expect(await bal(d.customerDepositsId)).toBe(-52_000);
    expect(await ageing("ar", "2026-02-28")).toBe(0);
    expect(await errors()).toBe(0);
    const apps = (await get(`/ar/invoices/${inv.id}/applications`)).body.data.rows;
    expect((await request(app).delete(`/api/v1/ar/applications/DEPOSIT/${apps[0].id}`).set(h)).status).toBe(200);
    expect(await fx()).toBe(before);
    expect(await bal(d.customerDepositsId)).toBe(-130_000);
    // Refunding the rest in March costs 1,400 a dollar.
    await ok(post(`/ar/deposits/${dep.id}/refund`, { date: "2026-03-05" }));
    expect((await fx()) - before).toBe(10_000);
    expect(await bal(d.customerDepositsId)).toBe(0);
    expect(await errors()).toBe(0);
  });

  it("charges a debit note at its rate and refuses another currency's invoice", async () => {
    const c = (await ok(post("/ar/customers", { name: "Dollar Two", customerType: "CREDIT", creditLimit: 1e9, currency: "USD" }))).id;
    const at = await ageing("ar", "2026-03-31");
    const note = await ok(post("/ar/debit-notes", { customerId: c, noteDate: "2026-03-02", reason: "Freight", net: 10 }));
    expect(Number(note.exchangeRate)).toBe(1400);
    expect((await ageing("ar", "2026-03-31")) - at).toBe(14_000);
    const local = (await ok(post("/ar/customers", { name: "Franc Buyer", customerType: "CREDIT", creditLimit: 1e9 }))).id;
    const dep = await ok(post("/ar/deposits", { customerId: local, depositDate: "2026-01-10", amount: 500 }));
    const inv = await ok(post("/ar/invoices", { customerId: local, invoiceDate: "2026-01-11", lines: [{ description: "x", quantity: 1, unitPrice: 500 }] }));
    const was = await fx();
    await ok(post(`/ar/deposits/${dep.id}/allocate`, { invoiceId: inv.id, amount: 500, date: "2026-01-12" }));
    expect(await fx()).toBe(was);
    expect(await errors()).toBe(0);
  });
});

describe("Suppliers billed in a foreign currency", () => {
  it("applies, takes off and refunds an advance", async () => {
    const s = (await ok(post("/ap/suppliers", { name: "Dollar Seller", currency: "USD" }))).id;
    const adv = await ok(post("/ap/advances", { supplierId: s, advanceDate: "2026-01-10", amount: 100 }));
    const bill = await ok(post("/ap/bills", { supplierId: s, billDate: "2026-02-10", net: 80 }));
    const before = await fx();
    await ok(post(`/ap/advances/${adv.id}/allocate`, { billId: bill.id, amount: 80, allocationDate: "2026-02-12" }));
    // A debt of 1,350 a dollar settled with dollars bought at 1,300: 4,000 gained.
    expect((await fx()) - before).toBe(-4_000);
    expect(await ageing("ap", "2026-02-28")).toBe(0);
    expect(await errors()).toBe(0);
    await ok(post(`/ap/advances/${adv.id}/refund`, { amount: 20, refundDate: "2026-03-05" }));
    expect((await fx()) - before).toBe(-6_000);
    const apps = (await get(`/ap/bills/${bill.id}/applications`)).body.data.rows;
    await ok(post(`/ap/bills/${bill.id}/unapply`, { kind: "ADVANCE", applicationId: apps[0].id }));
    expect((await fx()) - before).toBe(-2_000);
    expect(await errors()).toBe(0);
  });

  it("keeps a credit at its rate, books FX when it is used, and undoes it", async () => {
    const s = (await ok(post("/ap/suppliers", { name: "Credit Seller", currency: "USD" }))).id;
    const start = await ageing("ap", "2026-12-31");
    const note = await ok(post("/ap/credit-notes", { supplierId: s, noteDate: "2026-01-15", reason: "Returned", lines: [{ description: "Goods", quantity: 1, unitPrice: 50}] }));
    expect(note).toMatchObject({ currency: "USD" });
    expect((await ageing("ap", "2026-01-31")) - 0).toBe(-65_000);
    const bill = await ok(post("/ap/bills", { supplierId: s, billDate: "2026-02-10", net: 50 }));
    const before = await fx();
    await ok(post(`/ap/suppliers/${s}/apply-credits`, { date: "2026-02-15", applications: [{ source: "CREDIT_NOTE", sourceId: note.id, billId: bill.id, amount: 50 }] }));
    expect((await fx()) - before).toBe(-2_500);
    expect(await ageing("ap", "2026-12-31")).toBe(start);
    expect(await errors()).toBe(0);
    const apps = (await get(`/ap/bills/${bill.id}/applications`)).body.data.rows;
    await ok(post(`/ap/bills/${bill.id}/unapply`, { kind: "CREDIT_NOTE", applicationId: apps[0].id }));
    expect(await fx()).toBe(before);
    // On the bill itself, a credit goes back at the bill's rate.
    const onBill = await ok(post("/ap/credit-notes", { supplierId: s, billId: bill.id, noteDate: "2026-03-10", reason: "Damaged", net: 20 }));
    expect(Number(onBill.exchangeRate)).toBe(1350);
    expect(await errors()).toBe(0);
  });

  it("owes a debit note at its rate, payable like a bill", async () => {
    const s = (await ok(post("/ap/suppliers", { name: "Debit Seller", currency: "USD" }))).id;
    await ok(post("/ap/debit-notes", { supplierId: s, noteDate: "2026-02-05", reason: "Freight", net: 30 }));
    const bill = (await get(`/ap/bills?supplierId=${s}`)).body.data[0];
    const before = await fx();
    await ok(post("/ap/payments", { supplierId: s, paymentDate: "2026-03-05", amount: 30, allocations: [{ billId: bill.id, amount: 30 }] }));
    expect((await fx()) - before).toBe(1_500);
    expect(await errors()).toBe(0);
    expect((await get("/books/trial-balance")).body.data.balanced ?? true).toBe(true);
  });

  it("applies a credit once when two people use it together", async () => {
    const s = (await ok(post("/ap/suppliers", { name: "Race Seller", currency: "USD" }))).id;
    const note = await ok(post("/ap/credit-notes", { supplierId: s, noteDate: "2026-01-15", reason: "x", net: 10 }));
    const bill = await ok(post("/ap/bills", { supplierId: s, billDate: "2026-02-10", net: 30 }));
    const use = () => post(`/ap/suppliers/${s}/apply-credits`, { date: "2026-02-15", applications: [{ source: "CREDIT_NOTE", sourceId: note.id, billId: bill.id, amount: 10 }] });
    const before = await fx();
    expect((await Promise.all([use(), use()])).filter((r) => r.status < 300)).toHaveLength(1);
    expect((await fx()) - before).toBe(-500);
    expect(await errors()).toBe(0);
  });
});

describe("Reversing money paid at another rate", () => {
  it("puts every account back, for suppliers and customers", async () => {
    const accounts = async () => Object.fromEntries((await prisma.glEntry.groupBy({ by: ["accountId"], where: { companyId }, _sum: { debit: true, credit: true } })).map((r) => [r.accountId, Math.round((Number(r._sum.debit) - Number(r._sum.credit)) * 100) / 100]).filter(([, v]) => v));
    const s = (await ok(post("/ap/suppliers", { name: "Reverse Seller", currency: "USD" }))).id;
    const bill = await ok(post("/ap/bills", { supplierId: s, billDate: "2026-02-10", net: 30 }));
    const c = (await ok(post("/ar/customers", { name: "Reverse Buyer", customerType: "CREDIT", creditLimit: 1e9, currency: "USD" }))).id;
    const inv = await ok(post("/ar/invoices", { customerId: c, invoiceDate: "2026-02-10", lines: [{ description: "Work", quantity: 1, unitPrice: 30 }] }));
    const before = await accounts();
    const pay = await ok(post("/ap/payments", { supplierId: s, paymentDate: "2026-03-05", amount: 40, allocations: [{ billId: bill.id, amount: 30 }] }));
    const rec = await ok(post("/ar/receipts", { customerId: c, receiptDate: "2026-03-05", amount: 40, method: "BANK", allocations: [{ invoiceId: inv.id, amount: 30 }] }));
    expect(await accounts()).not.toEqual(before);
    await ok(post(`/ap/payments/${pay.id}/reverse`, { reason: "Wrong", reversalDate: "2026-03-06" }));
    await ok(post(`/ar/receipts/${rec.id}/reverse`, { reason: "Wrong", reversalDate: "2026-03-06" }));
    expect(await accounts()).toEqual(before);
    expect(await errors()).toBe(0);
  });

  it("refuses debit notes with more tax than any rate", async () => {
    const s = (await ok(post("/ap/suppliers", { name: "Tax Seller" }))).id;
    const c = (await ok(post("/ar/customers", { name: "Tax Buyer", customerType: "CREDIT", creditLimit: 1e9 }))).id;
    const note = { noteDate: "2026-02-05", reason: "x", net: 10, tax: 100 };
    expect((await post("/ap/debit-notes", { supplierId: s, ...note })).status).toBe(400);
    expect((await post("/ar/debit-notes", { customerId: c, ...note })).status).toBe(400);
  });
});

describe("Supplier prices with VAT inside", () => {
  it("takes the tax out of the price on bills and supplier credits", async () => {
    const s = (await ok(post("/ap/suppliers", { name: "Inclusive Seller" }))).id;
    const code = (await get("/tax/codes")).body.data.find((t: { taxType: string; ratePercent: number }) => t.taxType === "INPUT_VAT" && Number(t.ratePercent) === 18).code;
    const lines = [{ description: "Paper", quantity: 2, unitPrice: 590, taxCode: code, taxInclusive: true }];
    expect(await ok(post("/ap/bills", { supplierId: s, billDate: "2026-02-10", lines }))).toMatchObject({ net: "1000", tax: "180", gross: "1180" });
    expect(await ok(post("/ap/credit-notes", { supplierId: s, noteDate: "2026-02-11", reason: "Back", lines }))).toMatchObject({ net: "1000", tax: "180", gross: "1180" });
    const po = await ok(post("/commercial/purchase-order", { supplierId: s, docDate: "2026-02-12", lines }));
    expect(Number(po.total)).toBe(1180);
    expect(await errors()).toBe(0);
  });
});

import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96901;
let h: Record<string, string>;
let companyId: string;
let bank: string;
const acct: Record<string, string> = {};
const post = (url: string, body: unknown, extra: Record<string, string> = {}) => request(app).post(`/api/v1${url}`).set({ ...h, ...extra }).send(body as object);
const get = (url: string) => request(app).get(`/api/v1${url}`).set(h);

async function balance(code: string, to?: string) {
  const s = await prisma.glEntry.aggregate({
    where: { companyId, account: { code }, ...(to ? { transactionDate: { lte: new Date(`${to}T23:59:59.999Z`) } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}
async function customer(name: string, extra: Record<string, unknown> = {}) {
  const r = await post("/ar/customers", { name, customerType: "CREDIT", creditLimit: 1e9, ...extra });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}
const line = (unitPrice: number) => [{ description: "Goods", quantity: 1, unitPrice, taxCode: "VAT18" }];
const integrityErrors = async () => (await post("/books/integrity/run", {})).body.data.errors as number;

beforeAll(async () => {
  await prisma.$connect();
  await resetCompany(orgId);
  h = await activateCompany(app, orgId, { name: "P0 Co", tin: "555444333" });
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
  await get("/tax/codes");
  bank = (await post("/banking/accounts", { kind: "BANK", name: "BK", glAccountId: acct["1110"], allowOverdraft: false, dateOpened: "2026-01-01" })).body.data.id;
  await post("/banking/receipts", { financialAccountId: bank, transactionDate: "2026-01-01", lines: [{ accountId: acct["3000"], amount: 5_000_000 }] });
});

describe("Credit notes and refunds carry VAT", () => {
  it("reverses the VAT of a credited sale, and leaves exempt customers without tax", async () => {
    const id = await customer("Credited");
    await post("/ar/invoices", { customerId: id, invoiceDate: "2026-01-05", lines: line(100_000) });
    const vat = await balance("2200");
    const note = await post("/ar/credit-notes", { customerId: id, noteDate: "2026-01-06", reason: "Returned", lines: line(100_000) });
    expect(note.status).toBe(201);
    expect(Number(note.body.data.gross)).toBe(118_000);
    expect(await balance("2200")).toBe(vat + 18_000);
    const exempt = await customer("Exempt", { taxExempt: true });
    const n2 = await post("/ar/credit-notes", { customerId: exempt, noteDate: "2026-01-06", reason: "x", lines: line(1_000) });
    expect(Number(n2.body.data.gross)).toBe(1_000);
  });

  it("puts a credit on an invoice and refuses both lines and a net amount", async () => {
    const id = await customer("On invoice");
    const inv = (await post("/ar/invoices", { customerId: id, invoiceDate: "2026-01-05", lines: line(50_000) })).body.data;
    expect((await post("/ar/credit-notes", { customerId: id, invoiceId: inv.id, noteDate: "2026-01-06", reason: "x", lines: line(10_000) })).status).toBe(201);
    expect((await prisma.arInvoice.findUniqueOrThrow({ where: { id: inv.id } })).amountCredited.toNumber()).toBe(11_800);
    expect((await post("/ar/credit-notes", { customerId: id, noteDate: "2026-01-06", reason: "x", net: 5, lines: line(5) })).status).toBe(400);
    expect((await post("/ar/credit-notes", { customerId: id, noteDate: "2026-01-06", reason: "x" })).status).toBe(400);
  });

  it("refunds an open credit once, deducting revenue once, and gives it back when reversed", async () => {
    const id = await customer("Refunded");
    const note = (await post("/ar/credit-notes", { customerId: id, noteDate: "2026-01-07", reason: "Goodwill", lines: line(10_000) })).body.data;
    const returns = await balance("4410");
    const body = { customerId: id, refundDate: "2026-01-08", financialAccountId: bank, sources: [{ source: "CREDIT_NOTE", sourceId: note.id, amount: 11_800 }] };
    const both = await Promise.all([post("/ar/refunds", body), post("/ar/refunds", body)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await balance("4410")).toBe(returns);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id } })).balance)).toBe(0);
    const txn = await prisma.bankTransaction.findFirstOrThrow({ where: { companyId, relatedCustomerId: id } });
    expect((await post(`/banking/transactions/${txn.id}/reverse`, { reason: "Wrong account", reversalDate: "2026-01-09" })).status).toBe(200);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id } })).balance)).toBe(-11_800);
    expect(Number((await prisma.arCreditNote.findUniqueOrThrow({ where: { id: note.id } })).unapplied)).toBe(11_800);
    expect(await integrityErrors()).toBe(0);
  });

  it("refunds goods in one step: sale and VAT reversed, customer owed nothing", async () => {
    const id = await customer("Walk back");
    const vat = await balance("2200");
    const r = await post("/ar/refunds", { customerId: id, refundDate: "2026-01-08", financialAccountId: bank, lines: line(20_000) });
    expect(r.status).toBe(201);
    expect(Number(r.body.data.amount)).toBe(23_600);
    expect(await balance("2200")).toBe(vat + 3_600);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id } })).balance)).toBe(0);
  });

  it("won't reverse a receipt whose money was refunded, and rolls back a refund the bank can't pay", async () => {
    const id = await customer("Overpaid");
    const rct = (await post("/ar/receipts", { customerId: id, receiptDate: "2026-01-09", method: "BANK", amount: 5_000, financialAccountId: bank })).body.data;
    expect((await post("/ar/refunds", { customerId: id, refundDate: "2026-01-09", financialAccountId: bank, sources: [{ source: "PAYMENT", sourceId: rct.id, amount: 5_000 }] })).status).toBe(201);
    expect((await post(`/ar/receipts/${rct.id}/reverse`, {})).body.error).toMatch(/refunded/);
    const notes = await prisma.arCreditNote.count({ where: { companyId } });
    expect((await post("/ar/refunds", { customerId: id, refundDate: "2026-01-09", financialAccountId: bank, lines: line(90_000_000) })).body.error).toMatch(/enough money/);
    expect(await prisma.arCreditNote.count({ where: { companyId } })).toBe(notes);
  });
});

describe("Ageing equals the control account", () => {
  it("ages opening batches, nets unapplied credit and answers for a past date", async () => {
    const a = await customer("Opening debtor");
    const b = await customer("Opening creditor");
    const s = (await post("/ap/suppliers", { name: "Opening supplier" })).body.data.id;
    const batch = (await post("/setup/opening-balances", {
      name: "OB",
      lines: [
        { partyType: "CUSTOMER", partyRef: a, debit: 200_000, credit: 0 },
        { partyType: "CUSTOMER", partyRef: b, debit: 0, credit: 30_000 },
        { partyType: "SUPPLIER", partyRef: s, debit: 0, credit: 70_000 },
        { accountId: acct["3020"], debit: 0, credit: 100_000 },
      ],
    })).body.data.id;
    const other = { ...h, Authorization: (await import("./helpers")).authHeaders(orgId, "ADMIN", 902).Authorization };
    await request(app).post(`/api/v1/setup/opening-balances/${batch}/approve`).set(other);
    expect((await post(`/setup/opening-balances/${batch}/post`, {})).status).toBe(200);
    const inv = await prisma.arInvoice.findFirstOrThrow({ where: { companyId, customerId: a } });
    expect((await post("/ar/receipts", { customerId: a, receiptDate: "2026-03-10", method: "BANK", amount: 150_000, financialAccountId: bank, allocations: [{ invoiceId: inv.id, amount: 150_000 }] })).status).toBe(201);
    await post("/ar/invoices", { customerId: a, invoiceDate: "2026-04-01", net: 40_000 });
    for (const day of ["2026-01-31", "2026-03-31", "2026-04-30"]) {
      const ar = (await get(`/ar/ageing?asOf=${day}`)).body.data;
      expect(ar.total).toBeCloseTo(await balance("1200", day), 2);
      const ap = (await get(`/ap/ageing?asOf=${day}`)).body.data;
      expect(ap.total).toBeCloseTo(-(await balance("2100", day)), 2);
    }
    const feb = (await get("/ar/ageing?asOf=2026-02-28")).body.data.lines.filter((l: { customerId: string }) => l.customerId === a);
    expect(feb.map((l: { outstanding: number }) => l.outstanding)).toEqual([200_000]);
  });

  it("keeps a voided invoice in ageing for dates before the void", async () => {
    const id = await customer("Voided later");
    const inv = (await post("/ar/invoices", { customerId: id, invoiceDate: "2026-02-01", net: 9_000 })).body.data;
    expect((await post(`/ar/invoices/${inv.id}/void`, { reason: "x", voidDate: "2026-06-15" })).status).toBe(200);
    const at = async (day: string) => (await get(`/ar/ageing?asOf=${day}`)).body.data.lines.filter((l: { customerId: string }) => l.customerId === id);
    expect((await at("2026-02-28"))[0].outstanding).toBe(9_000);
    expect(await at(new Date().toISOString().slice(0, 10))).toEqual([]);
  });

  it("converts foreign customers and credits them at the invoice rate, with a clean integrity scan", async () => {
    await post("/books/fx/rates", { currency: "USD", rateDate: "2026-02-01", rate: 1400 });
    await post("/books/fx/rates", { currency: "USD", rateDate: "2026-03-01", rate: 1450 });
    const id = await customer("USD", { currency: "USD" });
    const before = (await get("/ar/ageing")).body.data.total;
    const inv = (await post("/ar/invoices", { customerId: id, invoiceDate: "2026-02-10", net: 1_000, currency: "USD" })).body.data;
    expect((await get("/ar/ageing")).body.data.total - before).toBeCloseTo(1_400_000, 2);
    expect(await integrityErrors()).toBe(0);
    expect((await post("/ar/credit-notes", { customerId: id, invoiceId: inv.id, noteDate: "2026-03-05", reason: "x", net: 1_000 })).status).toBe(201);
    expect((await get("/ar/ageing")).body.data.total).toBeCloseTo(before, 2);
    expect(await integrityErrors()).toBe(0);
    expect((await post("/ar/deposits", { customerId: id, depositDate: "2026-03-05", amount: 10 })).body.data).toMatchObject({ currency: "USD", exchangeRate: "1450" });
    expect(await integrityErrors()).toBe(0);
    const opening = (await post("/ar/customers", { name: "USD opening", customerType: "CREDIT", creditLimit: 1e6, currency: "USD", openingBalance: 100, openingBalanceDate: "2026-02-05" })).body.data.id;
    expect((await get("/ar/ageing")).body.data.lines.find((l: { customerId: string }) => l.customerId === opening).outstanding).toBe(140_000);
    expect(await integrityErrors()).toBe(0);
  });

  it("balances party openings against Opening Balance Equity, not suspense", async () => {
    const suspense = await balance("1900");
    await customer("Equity opening", { openingBalance: 5_000, openingBalanceDate: "2026-01-01" });
    expect(await balance("1900")).toBe(suspense);
  });
});

describe("Guards", () => {
  it("keeps expenses and bank payments off control accounts", async () => {
    const cat = (await get("/expenses/categories")).body.data[0].id;
    for (const code of ["1200", "2100", "1300"]) {
      expect((await post("/expenses", { expenseDate: "2026-02-01", categoryId: cat, expenseAccountId: acct[code], financialAccountId: bank, net: 10, post: true })).status).toBe(400);
      expect((await post("/banking/payments", { financialAccountId: bank, transactionDate: "2026-02-01", lines: [{ accountId: acct[code], amount: 10 }] })).status).toBe(400);
    }
  });

  it("refuses the cash basis and always states accrual", async () => {
    expect((await request(app).put("/api/v1/setup/policies").set(h).send({ accountingBasis: "CASH" })).status).toBe(400);
    expect((await get("/books/statements")).body.data.notes.basis.join(" ")).toMatch(/Accrual basis/);
  });
});

describe("Idempotency", () => {
  it("posts once for a double click or a retry, and replays the first answer", async () => {
    const id = await customer("Double");
    const key = { "Idempotency-Key": randomUUID() };
    const body = { customerId: id, invoiceDate: "2026-02-03", net: 7_777 };
    const rs = await Promise.all([1, 2, 3].map(() => post("/ar/invoices", body, key)));
    expect(new Set(rs.map((r) => r.body.data.id)).size).toBe(1);
    expect((await post("/ar/invoices", body, key)).body.data.id).toBe(rs[0].body.data.id);
    expect(await prisma.arInvoice.count({ where: { companyId, customerId: id } })).toBe(1);
    expect((await post("/ar/invoices", { ...body, net: 8 }, key)).status).toBe(422);
    expect((await post("/ar/invoices", body, { "Idempotency-Key": randomUUID() })).status).toBe(201);
  });

  it("frees the key when the request is refused, and keeps users' answers apart", async () => {
    const id = await customer("Retry");
    const key = { "Idempotency-Key": randomUUID() };
    expect((await post("/ar/invoices", { customerId: id, invoiceDate: "2026-02-03", net: -1 }, key)).status).toBe(400);
    const ok = await post("/ar/invoices", { customerId: id, invoiceDate: "2026-02-03", net: 10 }, key);
    expect(ok.status).toBe(201);
    const other = (await import("./helpers")).authHeaders(orgId, "ADMIN", 777);
    const r = await request(app).post("/api/v1/ar/invoices").set({ ...other, ...key }).send({ customerId: id, invoiceDate: "2026-02-03", net: 10 });
    expect(r.body.data.id).not.toBe(ok.body.data.id);
    expect((await request(app).post("/api/v1/ar/invoices").set(key).send({})).status).toBe(401);
  });
});

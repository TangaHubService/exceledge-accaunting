import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { defaultsFor } from "../src/lib/documents";
import { prisma } from "../src/lib/prisma";
import { runIntegrityScan } from "../src/modules/integrity/integrity.service";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 94096;

async function clean(org: number) {
  const company = { externalErpOrganizationId: String(org) };
  await prisma.itemReceipt.deleteMany({ where: { company } });
  await prisma.commercialDocument.deleteMany({ where: { company } });
  await prisma.approvalRequest.deleteMany({ where: { company } });
  await resetCompany(org);
}

/**
 * Final review: every way money moves on a supplier account, then the subledger must equal Accounts Payable
 * in the general ledger, each supplier balance must equal its own ledger, and the integrity scan must be clean.
 */
describe("Supplier ledger reconciles with the general ledger across every AP path", () => {
  let headers: Record<string, string>;
  let companyId: string;
  let apAccountId: string;
  const post = (path: string, body: unknown) => request(app).post(`/api/v1${path}`).set(headers).send(body as object);
  const get = (path: string) => request(app).get(`/api/v1${path}`).set(headers);
  const ok = (res: request.Response, status = 201) => {
    expect(res.status, `${res.req?.path}: ${JSON.stringify(res.body)}`).toBe(status);
    return res.body.data;
  };
  const glPayables = async (supplierRef?: string) => {
    const sum = await prisma.journalLine.aggregate({
      where: { companyId, accountId: apAccountId, journal: { status: { in: ["POSTED", "REVERSED"] } }, ...(supplierRef ? { supplierRef } : {}) },
      _sum: { debit: true, credit: true },
    });
    return Math.round((Number(sum._sum.credit ?? 0) - Number(sum._sum.debit ?? 0)) * 100) / 100;
  };

  beforeAll(async () => {
    await prisma.$connect();
    await clean(orgId);
    headers = await activateCompany(app, orgId, { name: "Reconciliation Co", tin: "555666782" });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    apAccountId = (await defaultsFor(companyId)).accountsPayableId!;
  });

  afterAll(async () => {
    await clean(orgId);
  });

  it("runs bills, payments, credits, debit notes, advances, voids, reversals, orders and expenses", async () => {
    const a = ok(await post("/ap/suppliers", { name: "Recon Hardware", openingBalance: 40000, openingBalanceDate: "2026-03-31", whtRate: 15 })).id;
    const b = ok(await post("/ap/suppliers", { name: "Recon Services" })).id;
    const taxCodes = ok(await get("/tax/codes"), 200) as Array<{ code: string; rate: number | string; isActive?: boolean }>;
    const vat = taxCodes.find((t) => Number(t.rate) === 18)?.code;
    const expenseAccount = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } })).id;

    // Bills: one by amount, one with tax-coded lines, one voided.
    const b1 = ok(await post("/ap/bills", { supplierId: a, billDate: "2026-04-02", net: 100000, tax: 18000 })).id;
    const b2 = ok(
      await post("/ap/bills", {
        supplierId: a,
        billDate: "2026-04-05",
        lines: [{ description: "Cement", quantity: 10, unitPrice: 5000, accountId: expenseAccount, ...(vat ? { taxCode: vat } : {}) }],
      }),
    ).id;
    const b3 = ok(await post("/ap/bills", { supplierId: b, billDate: "2026-04-06", net: 30000 })).id;
    ok(await post(`/ap/bills/${b3}/void`, { reason: "Entered twice" }), 200);
    const b4 = ok(await post("/ap/bills", { supplierId: b, billDate: "2026-04-07", net: 60000 })).id;

    // Payments: with withholding tax, partial with an unapplied remainder, and one reversed.
    ok(await post("/ap/payments", { supplierId: a, paymentDate: "2026-04-10", amount: 100300, withholdingTax: 17700, allocations: [{ billId: b1, amount: 118000 }] }));
    const loose = ok(await post("/ap/payments", { supplierId: b, paymentDate: "2026-04-11", amount: 25000, allocations: [{ billId: b4, amount: 20000 }] })).id;
    const reversed = ok(await post("/ap/payments", { supplierId: a, paymentDate: "2026-04-12", amount: 5000, allocations: [{ billId: b2, amount: 5000 }] })).id;
    ok(await post(`/ap/payments/${reversed}/reverse`, { reason: "Bounced" }), 200);

    // Credits: on a bill, on account then applied, then one application removed again.
    ok(await post("/ap/credit-notes", { supplierId: a, billId: b2, noteDate: "2026-04-13", reason: "Damaged bags", net: 4000 }));
    const cn = ok(await post("/ap/credit-notes", { supplierId: b, noteDate: "2026-04-14", reason: "Discount", net: 9000 })).id;
    ok(await post(`/ap/suppliers/${b}/apply-credits`, { applications: [{ source: "CREDIT_NOTE", sourceId: cn, billId: b4, amount: 9000 }, { source: "PAYMENT", sourceId: loose, billId: b4, amount: 5000 }] }), 200);
    const apps = ok(await get(`/ap/bills/${b4}/applications`), 200);
    const credit = apps.rows.find((r: { kind: string }) => r.kind === "CREDIT_NOTE");
    ok(await post(`/ap/bills/${b4}/unapply`, { kind: "CREDIT_NOTE", applicationId: credit.id }), 200);

    // Debit note, paid.
    ok(await post("/ap/debit-notes", { supplierId: a, noteDate: "2026-04-15", reason: "Freight", net: 7000 }));
    const dnBill = await prisma.apBill.findFirstOrThrow({ where: { supplierId: a, sourceDocumentType: "ApDebitNote" } });
    ok(await post("/ap/payments", { supplierId: a, paymentDate: "2026-04-16", amount: 7000, allocations: [{ billId: dnBill.id, amount: 7000 }] }));

    // Advances: applied, applied and taken back, refunded.
    const adv = ok(await post("/ap/advances", { supplierId: a, advanceDate: "2026-04-17", amount: 20000 })).id;
    ok(await post(`/ap/suppliers/${a}/apply-credits`, { applications: [{ source: "ADVANCE", sourceId: adv, billId: b2, amount: 15000 }] }), 200);
    const advApps = ok(await get(`/ap/bills/${b2}/applications`), 200);
    ok(await post(`/ap/bills/${b2}/unapply`, { kind: "ADVANCE", applicationId: advApps.rows.find((r: { kind: string }) => r.kind === "ADVANCE").id }), 200);
    ok(await post(`/ap/suppliers/${a}/apply-credits`, { applications: [{ source: "ADVANCE", sourceId: adv, billId: b2, amount: 12000 }] }), 200);
    ok(await post(`/ap/advances/${adv}/refund`, { amount: 8000, refundDate: "2026-04-18" }), 200);

    // Purchase order, goods received, billed.
    const item = await prisma.inventoryItem.create({ data: { companyId, externalProductId: "SKU-R1", name: "Nails", sku: "N1" } });
    const location = await prisma.inventoryLocation.create({ data: { companyId, externalBranchId: "R1", name: "Store" } });
    const po = ok(await post("/commercial/purchase-order", { supplierId: b, docDate: "2026-04-20", lines: [{ description: "Nails", itemId: item.id, quantity: 20, unitPrice: 250 }] })).id;
    ok(await post("/inventory/item-receipts", { supplierId: b, purchaseOrderId: po, date: "2026-04-21", lines: [{ itemId: item.id, locationId: location.id, quantity: 20, unitCost: 250 }] }));
    ok(await post(`/commercial/documents/${po}/convert`, { target: "BILL", date: "2026-04-22" }), 200);

    // Expenses on account: one stays, one reversed; plus a paid one that doesn't touch payables.
    const fuel = (ok(await get("/expenses/categories"), 200) as Array<{ code: string; id: string }>).find((c) => c.code === "FUEL")!.id;
    const e1 = ok(await post("/expenses", { expenseDate: "2026-04-23", categoryId: fuel, paymentMode: "ON_ACCOUNT", supplierId: b, net: 11000 })).id;
    ok(await post(`/expenses/${e1}/post`, {}), 200);
    const e2 = ok(await post("/expenses", { expenseDate: "2026-04-24", categoryId: fuel, paymentMode: "ON_ACCOUNT", supplierId: b, net: 6000 })).id;
    ok(await post(`/expenses/${e2}/post`, {}), 200);
    ok(await post(`/expenses/${e2}/reverse`, { reason: "Wrong month" }), 200);

    // The subledger agrees with Accounts Payable, in total and per supplier.
    const suppliers = await prisma.supplier.findMany({ where: { companyId } });
    const ledgerTotal = suppliers.reduce((s, x) => s + Number(x.balance), 0);
    expect(await glPayables()).toBeCloseTo(ledgerTotal, 2);
    for (const s of suppliers) {
      expect(await glPayables(s.id), s.name).toBeCloseTo(Number(s.balance), 2);
      const entries = await prisma.apLedgerEntry.aggregate({ where: { supplierId: s.id }, _sum: { debit: true, credit: true } });
      expect(Number(entries._sum.credit) - Number(entries._sum.debit), s.name).toBeCloseTo(Number(s.balance), 2);
    }

    // Each balance equals open bills less credits still on account (advances sit outside AP).
    for (const s of suppliers) {
      const bills = await prisma.apBill.findMany({ where: { supplierId: s.id, status: "POSTED" } });
      const openBills = bills.reduce((t, x) => t + Number(x.gross) - Number(x.amountPaid) - Number(x.amountCredited), 0);
      const notes = await prisma.apCreditNote.aggregate({ where: { supplierId: s.id, status: "POSTED" }, _sum: { unapplied: true } });
      const payments = await prisma.apPayment.aggregate({ where: { supplierId: s.id, status: "POSTED" }, _sum: { unallocated: true } });
      expect(openBills - Number(notes._sum.unapplied ?? 0) - Number(payments._sum.unallocated ?? 0), s.name).toBeCloseTo(Number(s.balance), 2);
    }

    // The statement closes on the balance, and the profile summary reads the same number.
    for (const s of suppliers) {
      const st = ok(await get(`/ap/suppliers/${s.id}/period-statement?from=2026-01-01&to=2026-12-31`), 200);
      expect(st.closingBalance, s.name).toBeCloseTo(Number(s.balance), 2);
      const summary = ok(await get(`/ap/suppliers/${s.id}/summary`), 200);
      expect(summary.outstanding).toBeCloseTo(Number(s.balance), 2);
    }

    // The app's own integrity scan finds nothing wrong with payables or missing journals.
    const findings = await runIntegrityScan(companyId);
    expect(findings.filter((f) => f.check === "AP_SUBLEDGER" || f.check === "DOCUMENT_WITHOUT_GL")).toEqual([]);
  });

  it("books realized FX when a foreign payment is applied to a bill at another rate, and reverses it with the payment", async () => {
    await post("/books/fx/rates", { currency: "USD", rateDate: "2026-05-01", rate: 1300, source: "BNR" });
    await post("/books/fx/rates", { currency: "USD", rateDate: "2026-05-20", rate: 1400, source: "BNR" });
    const usd = ok(await post("/ap/suppliers", { name: "Dollar Recon", currency: "USD" })).id;
    const bill = ok(await post("/ap/bills", { supplierId: usd, billDate: "2026-05-02", net: 100 })).id;
    const pay = ok(await post("/ap/payments", { supplierId: usd, paymentDate: "2026-05-21", amount: 100 })).id;
    ok(await post(`/ap/suppliers/${usd}/apply-credits`, { date: "2026-05-21", applications: [{ source: "PAYMENT", sourceId: pay, billId: bill, amount: 100 }] }), 200);
    const fx = await prisma.journal.findFirstOrThrow({ where: { companyId, sourceDocumentType: "ApCreditApplication", sourceDocumentId: pay } });
    expect(Number(fx.totalDebit)).toBe(10000); // 100 USD × (1400 − 1300)
    // Settled in full: Accounts Payable for this supplier nets to zero in RWF.
    expect(await glPayables(usd)).toBeCloseTo(0, 2);
    // FX-booked applications can't be taken off; reversing the payment takes the FX with it.
    const apps = ok(await get(`/ap/bills/${bill}/applications`), 200);
    expect(apps.rows[0]).toMatchObject({ kind: "PAYMENT", removable: false });
    ok(await post(`/ap/payments/${pay}/reverse`, { reason: "Recalled" }), 200);
    expect(await glPayables(usd)).toBeCloseTo(130000, 2); // back to the bill at its own rate
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "ApCreditApplicationReversal", sourceDocumentId: pay } })).toBe(1);
  });
});

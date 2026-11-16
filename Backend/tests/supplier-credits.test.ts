import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { defaultsFor } from "../src/lib/documents";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 94095;

/**
 * Applying supplier credits, paying with credits, removing applications, and expenses on account,
 * checked against the bills, the supplier subledger and Accounts Payable in the general ledger.
 */
describe("Supplier credits, payments and expenses on account", () => {
  let headers: Record<string, string>;
  let companyId: string;
  let apAccountId: string;
  const post = (path: string, body: unknown) => request(app).post(`/api/v1${path}`).set(headers).send(body as object);
  const get = (path: string) => request(app).get(`/api/v1${path}`).set(headers);
  const ids: Record<string, string> = {};
  const ok = (res: request.Response, status = 201) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body.data;
  };

  const open = async (billId: string) => {
    const b = await prisma.apBill.findUniqueOrThrow({ where: { id: billId } });
    return Number(b.gross) - Number(b.amountPaid) - Number(b.amountCredited);
  };
  const balance = async () => Number((await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } })).balance);
  /** Credit balance of Accounts Payable in the general ledger. */
  const glPayables = async () => {
    const sum = await prisma.journalLine.aggregate({ where: { companyId, accountId: apAccountId, journal: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
    return Number(sum._sum.credit ?? 0) - Number(sum._sum.debit ?? 0);
  };
  /** The subledger must agree with the ledger after every step. */
  const reconciles = async () => expect(await glPayables()).toBeCloseTo(await balance(), 2);

  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany(app, orgId, { name: "Supplier Credits Co", tin: "555666781" });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    apAccountId = (await defaultsFor(companyId)).accountsPayableId!;

    ids.supplier = ok(await post("/ap/suppliers", { name: "Credit Vendor", creditPeriodDays: 30 })).id;
    ids.b1 = ok(await post("/ap/bills", { supplierId: ids.supplier, billDate: "2026-09-01", dueDate: "2026-09-30", net: 100000 })).id;
    ids.b2 = ok(await post("/ap/bills", { supplierId: ids.supplier, billDate: "2026-10-01", dueDate: "2026-12-31", net: 50000 })).id;
    ids.cn = ok(await post("/ap/credit-notes", { supplierId: ids.supplier, noteDate: "2026-10-05", reason: "Short delivery", net: 20000 })).id;
    ids.pay = ok(await post("/ap/payments", { supplierId: ids.supplier, paymentDate: "2026-10-06", amount: 30000, reference: "ON-ACC-1" })).id;
    ids.adv = ok(await post("/ap/advances", { supplierId: ids.supplier, advanceDate: "2026-10-07", amount: 10000 })).id;
  });

  afterAll(async () => {
    await resetCompany(orgId);
  });

  it("starts with credits on account and the ledgers in agreement", async () => {
    // 150k billed − 20k credit − 30k paid; the advance sits in prepayments.
    expect(await balance()).toBe(100000);
    await reconciles();
    const items = ok(await get(`/ap/suppliers/${ids.supplier}/open-items`), 200);
    expect(items.credits.map((c: { source: string; available: number }) => [c.source, c.available])).toEqual([
      ["CREDIT_NOTE", 20000],
      ["PAYMENT", 30000],
      ["ADVANCE", 10000],
    ]);
    expect(items.bills.map((b: { id: string; open: number }) => [b.id, b.open])).toEqual([
      [ids.b1, 100000],
      [ids.b2, 50000],
    ]);
  });

  it("applies a supplier credit, an unapplied payment and an advance to bills", async () => {
    const res = ok(
      await post(`/ap/suppliers/${ids.supplier}/apply-credits`, {
        date: "2026-10-10",
        applications: [
          { source: "CREDIT_NOTE", sourceId: ids.cn, billId: ids.b1, amount: 15000 },
          { source: "PAYMENT", sourceId: ids.pay, billId: ids.b1, amount: 30000 },
          { source: "ADVANCE", sourceId: ids.adv, billId: ids.b2, amount: 10000 },
        ],
      }),
      200,
    );
    expect(res.total).toBe(55000);
    expect(await open(ids.b1)).toBe(55000);
    expect(await open(ids.b2)).toBe(40000);
    expect(Number((await prisma.apCreditNote.findUniqueOrThrow({ where: { id: ids.cn } })).unapplied)).toBe(5000);
    expect(Number((await prisma.apPayment.findUniqueOrThrow({ where: { id: ids.pay } })).unallocated)).toBe(0);
    expect(Number((await prisma.apAdvance.findUniqueOrThrow({ where: { id: ids.adv } })).remaining)).toBe(0);
    // Credit and payment only move in the subledger; the advance leaves prepayments and reduces AP.
    expect(await balance()).toBe(90000);
    await reconciles();
    // Open bills (95k) less the credit still on account (5k) is the balance.
    const summary = ok(await get(`/ap/suppliers/${ids.supplier}/summary`), 200);
    expect(summary.availableCredit).toBe(5000);
    expect(summary.outstanding).toBe(90000);
  });

  it("refuses to apply more than a credit has left or a bill still owes", async () => {
    const tooMuchCredit = await post(`/ap/suppliers/${ids.supplier}/apply-credits`, { applications: [{ source: "CREDIT_NOTE", sourceId: ids.cn, billId: ids.b2, amount: 6000 }] });
    expect(tooMuchCredit.status).toBe(400);
    expect(tooMuchCredit.body.error).toMatch(/doesn't have 6000 left/);
    const tooMuchBill = await post(`/ap/suppliers/${ids.supplier}/apply-credits`, {
      applications: [
        { source: "CREDIT_NOTE", sourceId: ids.cn, billId: ids.b2, amount: 5000 },
        { source: "CREDIT_NOTE", sourceId: ids.cn, billId: ids.b2, amount: 36000 },
      ],
    });
    expect(tooMuchBill.status).toBe(400);
    expect(tooMuchBill.body.error).toMatch(/only has 40000 left/);
    // Nothing from the refused requests stuck.
    expect(Number((await prisma.apCreditNote.findUniqueOrThrow({ where: { id: ids.cn } })).unapplied)).toBe(5000);
    expect(await open(ids.b2)).toBe(40000);
  });

  it("lists what was applied to a bill and takes credits and advances back off", async () => {
    const apps = ok(await get(`/ap/bills/${ids.b1}/applications`), 200);
    expect(apps.rows.map((r: { kind: string; amount: number }) => [r.kind, r.amount]).sort()).toEqual([
      ["CREDIT_NOTE", 15000],
      ["PAYMENT", 30000],
    ]);
    const credit = apps.rows.find((r: { kind: string }) => r.kind === "CREDIT_NOTE");
    ok(await post(`/ap/bills/${ids.b1}/unapply`, { kind: "CREDIT_NOTE", applicationId: credit.id }), 200);
    expect(await open(ids.b1)).toBe(70000);
    expect(Number((await prisma.apCreditNote.findUniqueOrThrow({ where: { id: ids.cn } })).unapplied)).toBe(20000);
    expect(await balance()).toBe(90000);

    const advApps = ok(await get(`/ap/bills/${ids.b2}/applications`), 200);
    const adv = advApps.rows.find((r: { kind: string }) => r.kind === "ADVANCE");
    ok(await post(`/ap/bills/${ids.b2}/unapply`, { kind: "ADVANCE", applicationId: adv.id }), 200);
    expect(await open(ids.b2)).toBe(50000);
    expect(Number((await prisma.apAdvance.findUniqueOrThrow({ where: { id: ids.adv } })).remaining)).toBe(10000);
    expect(await balance()).toBe(100000);
    await reconciles();

    // An application can only be removed through the bill it belongs to.
    const wrong = await post(`/ap/bills/${ids.b2}/unapply`, { kind: "PAYMENT", applicationId: apps.rows.find((r: { kind: string }) => r.kind === "PAYMENT").id });
    expect(wrong.status).toBe(400);
  });

  it("moves a credit recorded against a bill back on account", async () => {
    const onBill = ok(await post("/ap/credit-notes", { supplierId: ids.supplier, billId: ids.b2, noteDate: "2026-10-12", reason: "Price correction", net: 8000 })).id;
    expect(await open(ids.b2)).toBe(42000);
    const apps = ok(await get(`/ap/bills/${ids.b2}/applications`), 200);
    const row = apps.rows.find((r: { kind: string }) => r.kind === "CREDIT_ON_ISSUE");
    expect(row).toMatchObject({ sourceId: onBill, amount: 8000 });
    ok(await post(`/ap/bills/${ids.b2}/unapply`, { kind: "CREDIT_ON_ISSUE", applicationId: row.id }), 200);
    const note = await prisma.apCreditNote.findUniqueOrThrow({ where: { id: onBill } });
    expect(note.billId).toBeNull();
    expect(Number(note.unapplied)).toBe(8000);
    expect(await open(ids.b2)).toBe(50000);
    await reconciles();
  });

  it("pays bills with credits and cash in one transaction, or with credits alone", async () => {
    const paid = ok(
      await post("/ap/payments", {
        supplierId: ids.supplier,
        paymentDate: "2026-10-15",
        amount: 40000,
        reference: "TRF-200",
        allocations: [{ billId: ids.b1, amount: 40000 }],
        credits: [{ source: "CREDIT_NOTE", sourceId: ids.cn, billId: ids.b1, amount: 20000 }],
      }),
    );
    expect(paid.paymentNumber).toBeTruthy();
    expect(await open(ids.b1)).toBe(10000);
    await reconciles();

    const creditsOnly = ok(
      await post("/ap/payments", { supplierId: ids.supplier, paymentDate: "2026-10-16", amount: 0, credits: [{ source: "ADVANCE", sourceId: ids.adv, billId: ids.b1, amount: 10000 }] }),
    );
    expect(creditsOnly.payment).toBeNull();
    expect(creditsOnly.credited.total).toBe(10000);
    expect(await open(ids.b1)).toBe(0);
    await reconciles();

    // A failing cash part rolls the credits back too.
    const before = Number((await prisma.apCreditNote.findUniqueOrThrow({ where: { id: ids.cn } })).unapplied);
    const bad = await post("/ap/payments", {
      supplierId: ids.supplier,
      paymentDate: "2026-10-17",
      amount: 999999,
      allowUnallocated: false,
      allocations: [{ billId: ids.b2, amount: 999999 }],
      credits: [{ source: "CREDIT_NOTE", sourceId: (await prisma.apCreditNote.findFirstOrThrow({ where: { supplierId: ids.supplier, unapplied: { gt: 0 } } })).id, billId: ids.b2, amount: 1000 }],
    });
    expect(bad.status).toBe(400);
    expect(Number((await prisma.apCreditNote.findUniqueOrThrow({ where: { id: ids.cn } })).unapplied)).toBe(before);
    expect(await open(ids.b2)).toBe(50000);
  });

  it("refuses a second payment with the same reference", async () => {
    const dup = await post("/ap/payments", { supplierId: ids.supplier, paymentDate: "2026-10-18", amount: 1000, reference: "TRF-200" });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/reference TRF-200 is already recorded/);
  });

  it("puts a reversed payment's bills back to unpaid and refuses to void a credited bill", async () => {
    const reversed = await post(`/ap/payments/${ids.pay}/reverse`, { reason: "Bounced" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(await open(ids.b1)).toBe(30000);
    await reconciles();
    const voided = await post(`/ap/bills/${ids.b1}/void`, { reason: "Duplicate" });
    expect(voided.status).toBe(400);
    expect(voided.body.error).toMatch(/payments, credits/);
  });

  it("puts an on-account expense on the supplier's account, and takes it off when reversed", async () => {
    const categories = ok(await get("/expenses/categories"), 200);
    const fuel = categories.find((c: { code: string }) => c.code === "FUEL").id;
    const before = await balance();
    const draft = ok(await post("/expenses", { expenseDate: "2026-11-01", categoryId: fuel, paymentMode: "ON_ACCOUNT", supplierId: ids.supplier, description: "Generator diesel", net: 12000 }));
    const posted = ok(await post(`/expenses/${draft.id}/post`, {}), 200);
    expect(posted.status).toBe("POSTED");
    const bill = await prisma.apBill.findFirstOrThrow({ where: { sourceDocumentType: "Expense", sourceDocumentId: draft.id } });
    expect(Number(bill.gross)).toBe(12000);
    expect(await balance()).toBe(before + 12000);
    await reconciles();

    // Listed once, as the expense, with the bill's open amount; counted once in purchases.
    const txns = ok(await get(`/ap/suppliers/${ids.supplier}/transactions?pageSize=100`), 200);
    expect(txns.rows.filter((r: { id: string }) => r.id === bill.id)).toHaveLength(0);
    expect(txns.rows.find((r: { id: string }) => r.id === draft.id)).toMatchObject({ type: "EXPENSE", posting: true, open: 12000, status: "Unpaid" });
    const summary = ok(await get(`/ap/suppliers/${ids.supplier}/summary`), 200);
    const credits = Number((await prisma.apCreditNote.aggregate({ where: { supplierId: ids.supplier }, _sum: { gross: true } }))._sum.gross);
    expect(summary.totalPurchases).toBe(150000 + 12000 - credits);

    // It can't be voided from Payables, and can't be reversed while paid.
    const voidIt = await post(`/ap/bills/${bill.id}/void`, { reason: "x" });
    expect(voidIt.body.error).toMatch(/reverse the expense instead/);
    const payment = ok(await post("/ap/payments", { supplierId: ids.supplier, paymentDate: "2026-11-02", amount: 2000, allocations: [{ billId: bill.id, amount: 2000 }] }));
    const blocked = await post(`/expenses/${draft.id}/reverse`, { reason: "Wrong supplier" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/payments or credits/);
    // Reversal is all or nothing: the expense stays posted.
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("POSTED");

    ok(await post(`/ap/payments/${payment.id}/reverse`, { reason: "Undo" }), 200);
    ok(await post(`/expenses/${draft.id}/reverse`, { reason: "Wrong supplier" }), 200);
    expect((await prisma.apBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("REVERSED");
    expect(await balance()).toBe(before);
    await reconciles();
  });
});

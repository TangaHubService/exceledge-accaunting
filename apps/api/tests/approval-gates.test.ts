import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { withJobLock } from "../src/lib/job-lock";
import { autonomousPrisma, prisma } from "../src/lib/prisma";
import { revalueCurrency } from "../src/modules/books/books.service";
import { activateCompany, authHeaders, LEGACY_CONTROLS, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98601;
const CONTROLS = { ...LEGACY_CONTROLS, approvalWorkflowEnabled: true };

let creator: Record<string, string>;
const approver = authHeaders(orgId, "ADMIN", 443);
let companyId = "";
let supplierId = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function post(path: string, body: unknown, headers = creator, status = 201) {
  const res = await request(app).post(`/api/v1${path}`).set(headers).send(body);
  if (res.status !== status) throw new Error(`${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

function reversals(sourceDocumentType: string, sourceDocumentId: string) {
  return prisma.journal.count({ where: { companyId, sourceDocumentType, sourceDocumentId } });
}

function decide(id: string, headers: Record<string, string>, status: string, note?: string) {
  return request(app).post(`/api/v1/books/approvals/${id}/decide`).set(headers).send({ status, note });
}

async function requireApprovalFor(types: string[]) {
  const res = await request(app).put("/api/v1/setup/approvals").set(creator).send({ approvalRequiredFor: types });
  expect(res.status).toBe(200);
}

describe("Approval gates and race fixes", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    creator = await activateCompany(app, orgId, { name: "Gates Co", tin: "123459601" }, CONTROLS);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    supplierId = (await post("/ap/suppliers", { name: "Gate Supplies", creditPeriodDays: 30 })).id;
  });

  it("rejects unknown document types in approvalRequiredFor", async () => {
    const res = await request(app).put("/api/v1/setup/approvals").set(creator).send({ approvalRequiredFor: ["Invoice"] });
    expect(res.status).toBe(400);
  });

  it("posts supplier bills at once unless setup lists them", async () => {
    const bill = await post("/ap/bills", { supplierId, supplierInvoiceNumber: "G-1", billDate: "2026-01-10", net: 1000 });
    expect(bill).toMatchObject({ status: "POSTED", journalId: expect.any(String) });
    expect(bill.approval).toBeUndefined();
  });

  it("holds a listed supplier bill until another user approves it", async () => {
    await requireApprovalFor(["ApBill", "TaxAdjustment", "FixedAssetImpairment"]);
    const bill = await post("/ap/bills", { supplierId, supplierInvoiceNumber: "G-2", billDate: "2026-01-11", net: 2000, tax: 360 });
    expect(bill).toMatchObject({ status: "PENDING_APPROVAL", journalId: null });
    expect(bill.approval).toMatchObject({ status: "PENDING", entityType: "ApBill", requiredLevels: 1 });

    const bills = await request(app).get("/api/v1/ap/bills").set(creator);
    expect(bills.body.data.some((b: { id: string }) => b.id === bill.id)).toBe(false);

    const self = await decide(bill.approval.id, creator, "APPROVED");
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/requester cannot approve/);

    expect((await decide(bill.approval.id, approver, "APPROVED")).status).toBe(200);
    const posted = await prisma.apBill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(posted.status).toBe("POSTED");
    expect(posted.journalId).toEqual(expect.any(String));
    const journal = await prisma.journal.findUniqueOrThrow({ where: { id: posted.journalId! } });
    expect(journal).toMatchObject({ status: "POSTED", sourceDocumentType: "ApBill" });
  });

  it("marks a rejected supplier bill REJECTED without posting", async () => {
    const bill = await post("/ap/bills", { supplierId, supplierInvoiceNumber: "G-3", billDate: "2026-01-12", net: 500 });
    expect((await decide(bill.approval.id, approver, "REJECTED", "Not our order")).status).toBe(200);
    expect(await prisma.apBill.findUniqueOrThrow({ where: { id: bill.id } })).toMatchObject({ status: "REJECTED", journalId: null });
  });

  it("holds tax adjustments until approved and rejects without posting", async () => {
    const suspense = await accountId("1900");
    const body = { adjustmentDate: "2026-01-20", taxType: "OUTPUT_VAT", contraAccountId: suspense, amount: 5_000, increasesLiability: true, reason: "RRA assessment" };
    const held = await post("/tax/adjustments", body);
    expect(held).toMatchObject({ status: "PENDING_APPROVAL", journalId: null, approval: { status: "PENDING" } });
    expect((await decide(held.approval.id, creator, "APPROVED")).status).toBe(400);
    expect((await decide(held.approval.id, approver, "APPROVED")).status).toBe(200);
    const row = await prisma.taxAdjustment.findUniqueOrThrow({ where: { id: held.id } });
    expect(row).toMatchObject({ status: "POSTED", journalId: expect.any(String) });

    const rejected = await post("/tax/adjustments", { ...body, reason: "Duplicate assessment" });
    expect((await decide(rejected.approval.id, approver, "REJECTED", "Already booked")).status).toBe(200);
    expect(await prisma.taxAdjustment.findUniqueOrThrow({ where: { id: rejected.id } })).toMatchObject({ status: "REJECTED", journalId: null });
  });

  it("holds an impairment and posts it against the carrying amount when approved", async () => {
    const categories = await request(app).get("/api/v1/fixed-assets/categories").set(creator);
    const itCategory = categories.body.data.find((c: { code: string }) => c.code === "IT").id;
    const asset = await post("/fixed-assets/assets", {
      name: "Gate server",
      categoryId: itCategory,
      acquisitionCost: 1_000_000,
      purchaseDate: "2026-01-05",
      capitalize: true,
      creditAccountId: await accountId("1110"),
      capitalizationDate: "2026-01-05",
    });
    const held = await post(`/fixed-assets/assets/${asset.id}/impair`, { impairmentDate: "2026-01-25", recoverableAmount: 600_000, reason: "Water damage" }, creator, 200);
    expect(held.approval).toMatchObject({ status: "PENDING", entityType: "FixedAssetImpairment", amount: expect.anything() });
    expect(held.accumulatedDepreciation).toBe(0);
    expect(held.impairments[0]).toMatchObject({ status: "PENDING_APPROVAL" });

    const again = await request(app).post(`/api/v1/fixed-assets/assets/${asset.id}/impair`).set(creator).send({ impairmentDate: "2026-01-26", recoverableAmount: 500_000 });
    expect(again.body.error).toMatch(/already waiting for approval/);

    expect((await decide(held.approval.id, creator, "APPROVED")).status).toBe(400);
    expect((await decide(held.approval.id, approver, "APPROVED")).status).toBe(200);
    const after = await request(app).get(`/api/v1/fixed-assets/assets/${asset.id}`).set(creator);
    expect(after.body.data.accumulatedDepreciation).toBe(400_000);
    expect(after.body.data.impairments[0]).toMatchObject({ status: "POSTED" });
  });

  it("does not hold documents when the workflow is off", async () => {
    await request(app).put("/api/v1/setup/approvals").set(creator).send({ approvalWorkflowEnabled: false });
    const bill = await post("/ap/bills", { supplierId, supplierInvoiceNumber: "G-4", billDate: "2026-01-13", net: 700 });
    expect(bill.status).toBe("POSTED");
    await request(app).put("/api/v1/setup/approvals").set(creator).send({ approvalWorkflowEnabled: true, approvalRequiredFor: [] });
  });

  it("lets only one of two concurrent approval requests through", async () => {
    const draft = await request(app)
      .post("/api/v1/journals")
      .set(creator)
      .send({
        journalDate: "2026-01-14",
        lines: [
          { accountId: await accountId("1100"), debit: 10, credit: 0 },
          { accountId: await accountId("4100"), debit: 0, credit: 10 },
        ],
      });
    expect(draft.status).toBe(201);
    const id = draft.body.data.id;
    const results = await Promise.all([1, 2].map(() => request(app).post("/api/v1/books/approvals").set(creator).send({ entityType: "Journal", entityId: id, amount: 10 })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)!.body.error).toMatch(/already has a pending approval/);
    expect(await prisma.approvalRequest.count({ where: { companyId, entityId: id, status: "PENDING" } })).toBe(1);
  });

  it("reverses an AR receipt, AP payment and bank transaction once under concurrent requests", async () => {
    const customer = await post("/ar/customers", { name: "Race Customer", customerType: "CASH" });
    const receipt = await post("/ar/receipts", { customerId: customer.id, receiptDate: "2026-01-15", method: "BANK", amount: 300 });
    const ar = await Promise.all([1, 2].map(() => request(app).post(`/api/v1/ar/receipts/${receipt.id}/reverse`).set(creator).send({})));
    expect(ar.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(ar.find((r) => r.status === 400)!.body.error).toMatch(/already reversed/);
    expect(await reversals("ArReceiptReversal", receipt.id)).toBe(1);

    const bill = await post("/ap/bills", { supplierId, supplierInvoiceNumber: "G-5", billDate: "2026-01-15", net: 400 });
    const payment = await post("/ap/payments", { supplierId, paymentDate: "2026-01-16", amount: 400, allocations: [{ billId: bill.id, amount: 400 }] });
    const ap = await Promise.all([1, 2].map(() => request(app).post(`/api/v1/ap/payments/${payment.id}/reverse`).set(creator).send({ reversalDate: "2026-01-17" })));
    expect(ap.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(ap.find((r) => r.status === 400)!.body.error).toMatch(/already reversed/i);
    expect(await reversals("ApPaymentReversal", payment.id)).toBe(1);

    const bank = await post("/banking/accounts", { kind: "BANK", name: "Race Bank", openingBalance: 100_000, dateOpened: "2026-01-01" });
    const txn = await post("/banking/receipts", { financialAccountId: bank.id, transactionDate: "2026-01-15", lines: [{ accountId: await accountId("1900"), amount: 900 }] });
    const bk = await Promise.all([1, 2].map(() => request(app).post(`/api/v1/banking/transactions/${txn.id}/reverse`).set(creator).send({ reason: "Race test" })));
    expect(bk.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(bk.find((r) => r.status === 400)!.body.error).toMatch(/already reversed/);
    expect(await reversals("BankTransactionReversal", txn.id)).toBe(1);
  });

  it("surfaces the original posting error from banking and leaves no transaction behind", async () => {
    const bank = await prisma.financialAccount.findFirstOrThrow({ where: { companyId, name: "Race Bank" } });
    const before = await prisma.bankTransaction.count({ where: { companyId } });
    const res = await request(app)
      .post("/api/v1/banking/receipts")
      .set(creator)
      .send({ financialAccountId: bank.id, transactionDate: "2025-06-01", lines: [{ accountId: await accountId("1900"), amount: 50 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period|fiscal|financial year/i);
    expect(await prisma.bankTransaction.count({ where: { companyId } })).toBe(before);
  });

  it("refuses a revaluation while another one holds the lock", async () => {
    const outcome = await withJobLock(`fx-revalue:${companyId}:USD`, 60_000, () => revalueCurrency(companyId, "usd").then(() => "ran", (e: Error) => e.message));
    expect(outcome).toMatch(/USD revaluation is already running/);
  });

  it("keeps a renewed lease alive past its ttl", async () => {
    const key = `test-renew:${companyId}`;
    const ttl = 600;
    const result = await withJobLock(
      key,
      ttl,
      async () => {
        const first = (await autonomousPrisma.jobLock.findUniqueOrThrow({ where: { key } })).expiresAt;
        await sleep(ttl * 1.5);
        const later = (await autonomousPrisma.jobLock.findUniqueOrThrow({ where: { key } })).expiresAt;
        expect(later.getTime()).toBeGreaterThan(first.getTime());
        expect(await withJobLock(key, ttl, async () => "stolen")).toBeNull();
        return "held";
      },
      { renew: true },
    );
    expect(result).toBe("held");
    expect(await autonomousPrisma.jobLock.count({ where: { key } })).toBe(0);
  });
});

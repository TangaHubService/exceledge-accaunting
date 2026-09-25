import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 97071;
const base = "/api/v1/banking";

let admin: Record<string, string>;
let accountant: Record<string, string>;
let companyId = "";
const ids: Record<string, string> = {};

async function accountId(code: string) {
  const account = await prisma.account.findFirstOrThrow({ where: { companyId, code } });
  return account.id;
}

async function post(path: string, body: unknown, headers = accountant, status = 201) {
  const res = await request(app).post(`${base}${path}`).set(headers).send(body);
  if (res.status !== status) throw new Error(`${path} → ${res.status}: ${res.body.error}`);
  return res.body.data;
}

async function get(path: string, headers = accountant) {
  const res = await request(app).get(`${base}${path}`).set(headers);
  expect(res.status).toBe(200);
  return res.body.data;
}

const statement = (extra = "") =>
  [
    "Transaction Date,Narrative,Reference,Cheque No,Debit,Credit,Balance",
    "01/01/2026,Opening balance,,,,,1000000",
    "05/01/2026,Capital INV-CAP-1,TT001,,,500000,1500000",
    "06/01/2026,Cash withdrawal,WD55,,300000,,1200000",
    "06/01/2026,Withdrawal fee,WD55F,,1000,,1199000",
    "08/01/2026,Cash deposit,DP12,,,100000,1299000",
    "12/01/2026,Customer transfer ACME,TT002,,,90000,1389000",
    "20/01/2026,Cheque paid,CQ,000124,45000,,1344000",
    "31/01/2026,Monthly ledger fee,LF01,,2500,,1341500",
    "31/01/2026,Interest earned,IN01,,,300,1341800",
    extra,
  ]
    .filter(Boolean)
    .join("\n");

describe("Phase 7 banking and reconciliation", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Phase7 Co", tin: "777888999" });
    accountant = authHeaders(orgId, "ACCOUNTANT", 501);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  it("enforces banking roles", async () => {
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "SELLER"))).status).toBe(403);
    expect((await request(app).get(`${base}/dashboard`).set(authHeaders(orgId, "BRANCH_MANAGER"))).status).toBe(200);
    expect((await request(app).post(`${base}/accounts`).set(authHeaders(orgId, "BRANCH_MANAGER")).send({})).status).toBe(403);
    expect((await request(app).post(`${base}/reconciliations/x/approve`).set(accountant)).status).toBe(403);
  });

  it("registers bank, cash and petty cash accounts on their own GL accounts", async () => {
    const bank = await post("/accounts", { kind: "BANK", name: "BK Main", bankName: "Bank of Kigali", accountNumber: "100-200-300", swiftCode: "BKIGRWRW", openingBalance: 1_000_000, dateOpened: "2026-01-01" });
    expect(bank).toMatchObject({ glAccountCode: "1111", balance: 1_000_000, allowOverdraft: true });
    ids.bank = bank.id;
    const cashGl = await accountId("1100");
    const cash = await post("/accounts", { kind: "CASH", name: "Main cash", glAccountId: cashGl, dateOpened: "2026-01-01", custodian: "Cashier" });
    expect(cash).toMatchObject({ glAccountCode: "1100", allowOverdraft: false, balance: 0 });
    ids.cash = cash.id;
    ids.petty = (await post("/accounts", { kind: "PETTY_CASH", name: "Petty cash float", dateOpened: "2026-01-01" })).id;

    expect((await request(app).post(`${base}/accounts`).set(accountant).send({ kind: "BANK", name: "bk main", dateOpened: "2026-01-01" })).body.error).toMatch(/already exists/);
    expect((await request(app).post(`${base}/accounts`).set(accountant).send({ kind: "CASH", name: "Till", glAccountId: cashGl, dateOpened: "2026-01-01" })).body.error).toMatch(/already used by Main cash/);
  });

  it("posts receipts, payments, transfers, cash counts and reversals through the GL", async () => {
    const suspense = await accountId("6600");
    const salaries = await accountId("6100");
    const rounding = await accountId("6700");

    const receipt = await post("/receipts", { financialAccountId: ids.bank, transactionDate: "2026-01-05", reference: "INV-CAP-1", partyType: "INVESTOR", partyName: "Founders", lines: [{ accountId: suspense, amount: 500_000 }] });
    expect(receipt).toMatchObject({ kind: "RECEIPT", amount: 500_000, status: "POSTED" });
    expect(receipt.journalNumber).toMatch(/^JOU-/);
    expect((await request(app).post(`${base}/receipts`).set(accountant).send({ financialAccountId: ids.bank, transactionDate: "2026-01-05", reference: "inv-cap-1", lines: [{ accountId: suspense, amount: 1 }] })).body.error).toMatch(/already used/);

    const withdrawal = await post("/transfers", { fromAccountId: ids.bank, toAccountId: ids.cash, transactionDate: "2026-01-06", amount: 300_000, fee: 1_000 });
    expect(withdrawal).toMatchObject({ transferType: "WITHDRAWAL", fee: 1_000 });
    expect((await post("/transfers", { fromAccountId: ids.cash, toAccountId: ids.bank, transactionDate: "2026-01-08", amount: 100_000 })).transferType).toBe("DEPOSIT");
    expect((await post("/transfers", { fromAccountId: ids.cash, toAccountId: ids.petty, transactionDate: "2026-01-09", amount: 50_000 })).transferType).toBe("REPLENISHMENT");

    expect((await request(app).post(`${base}/payments`).set(accountant).send({ financialAccountId: ids.petty, transactionDate: "2026-01-10", lines: [{ accountId: salaries, amount: 60_000 }] })).body.error).toMatch(/overdraft is not allowed/);
    await post("/payments", { financialAccountId: ids.petty, transactionDate: "2026-01-10", partyName: "Stationers", lines: [{ accountId: salaries, amount: 12_000, description: "Stationery" }] });
    const count = await post("/cash-counts", { financialAccountId: ids.petty, countDate: "2026-01-11", counted: 37_500, overShortAccountId: rounding });
    expect(count).toMatchObject({ kind: "CASH_COUNT", bookAmount: 38_000, countedAmount: 37_500, amount: 500 });

    await post("/payments", { financialAccountId: ids.bank, transactionDate: "2026-01-02", chequeNumber: "000124", partyName: "Landlord", method: "CHEQUE", lines: [{ accountId: salaries, amount: 45_000 }] });
    const wrong = await post("/payments", { financialAccountId: ids.bank, transactionDate: "2026-01-15", partyName: "Wrong payee", lines: [{ accountId: salaries, amount: 7_000 }] });
    const reversed = await post(`/transactions/${wrong.id}/reverse`, { reason: "Paid the wrong supplier", reversalDate: "2026-01-16" }, accountant, 200);
    expect(reversed).toMatchObject({ status: "REVERSED", reversalReason: "Paid the wrong supplier" });
    expect((await request(app).post(`${base}/transactions/${wrong.id}/reverse`).set(accountant).send({ reason: "again" })).body.error).toMatch(/already reversed/);

    // A customer receipt paid straight into BK Main instead of the default bank account.
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "ACME Ltd", customerType: "CREDIT", creditLimit: 500_000 });
    expect(customer.status).toBe(201);
    const arReceipt = await request(app)
      .post("/api/v1/ar/receipts")
      .set(admin)
      .send({ customerId: customer.body.data.id, receiptDate: "2026-01-12", method: "BANK", amount: 90_000, financialAccountId: ids.bank });
    expect(arReceipt.status).toBe(201);

    await post("/payments", { financialAccountId: ids.bank, transactionDate: "2026-01-30", chequeNumber: "000125", partyName: "Contractor", method: "CHEQUE", lines: [{ accountId: salaries, amount: 20_000 }] });
    await post("/receipts", { financialAccountId: ids.bank, transactionDate: "2026-01-31", partyName: "Walk-in", lines: [{ accountId: suspense, amount: 15_000 }] });

    const accounts = await get("/accounts");
    const balance = (id: string) => accounts.find((a: { id: string }) => a.id === id).balance;
    expect(balance(ids.bank)).toBe(1_339_000);
    expect(balance(ids.cash)).toBe(150_000);
    expect(balance(ids.petty)).toBe(37_500);

    const book = await get(`/accounts/${ids.bank}/cashbook?from=2026-01-01&to=2026-01-31`);
    expect(book).toMatchObject({ openingBalance: 0, closingBalance: 1_339_000, transfersIn: 100_000, transfersOut: 301_000 });
    expect(book.rows[0]).toMatchObject({ moneyIn: 1_000_000, cleared: true });
  });

  it("imports a statement, auto-matches, and reconciles to a zero difference", async () => {
    const preview = await post(`/accounts/${ids.bank}/statements/preview`, { fileName: "bk-jan.csv", content: statement() }, accountant, 200);
    expect(preview).toMatchObject({ format: "CSV", openingBalance: 1_000_000, closingBalance: 1_341_800, counts: { new: 8, duplicate: 0 } });

    const imported = await post(`/accounts/${ids.bank}/statements`, { fileName: "bk-jan.csv", content: statement() });
    expect(imported).toMatchObject({ imported: 8, skipped: 0, autoMatched: 6 });
    expect((await request(app).post(`${base}/accounts/${ids.bank}/statements`).set(accountant).send({ fileName: "again.csv", content: statement() })).body.error).toMatch(/already imported/);

    const balanceAt = await get(`/accounts/${ids.bank}/statement-balance?date=2026-01-31`);
    expect(balanceAt.balance).toBe(1_341_800);
    const rec = await post("/reconciliations", { financialAccountId: ids.bank, statementDate: "2026-01-31", statementBalance: balanceAt.balance });
    ids.rec = rec.id;
    expect(rec.summary).toMatchObject({ bookBalance: 1_339_000, depositsInTransit: 22_000, outstandingPayments: 27_000, bankCharges: 2_500, interestIncome: 300, difference: 0 });
    expect(rec.ready).toBe(false);
    expect((await request(app).post(`${base}/reconciliations/${rec.id}/review`).set(accountant)).body.error).toMatch(/2 statement line/);
    expect((await request(app).post(`${base}/reconciliations`).set(accountant).send({ financialAccountId: ids.bank, statementDate: "2026-01-31", statementBalance: 1 })).body.error).toMatch(/still open/);

    const workspace = await get(`/accounts/${ids.bank}/matching`);
    const fee = workspace.lines.find((l: { amount: number }) => l.amount === -2_500);
    const interest = workspace.lines.find((l: { amount: number }) => l.amount === 300);
    expect([fee.suggestedKind, interest.suggestedKind]).toEqual(["BANK_CHARGE", "INTEREST"]);
    expect((await post(`/statement-lines/${fee.id}/record`, {})).kind).toBe("BANK_CHARGE");
    expect((await post(`/statement-lines/${interest.id}/record`, {})).kind).toBe("INTEREST");

    const pair = workspace.entries.filter((e: { amount: number }) => Math.abs(e.amount) === 7_000).map((e: { id: string }) => e.id);
    expect(pair).toHaveLength(2);
    expect((await request(app).post(`${base}/accounts/${ids.bank}/matches`).set(accountant).send({ entryIds: [pair[0]] })).body.error).toMatch(/at least two/);
    await post(`/accounts/${ids.bank}/matches`, { entryIds: pair });

    const ready = await get(`/reconciliations/${rec.id}`);
    expect(ready.summary).toMatchObject({ bookBalance: 1_336_800, depositsInTransit: 15_000, outstandingPayments: 20_000, adjustedBankBalance: 1_336_800, difference: 0 });
    expect(ready.outstanding.map((o: { chequeNumber: string | null; daysOutstanding: number }) => [o.chequeNumber, o.daysOutstanding])).toEqual([
      ["000125", 1],
      [null, 0],
    ]);
    expect(ready.ready).toBe(true);

    expect((await post(`/reconciliations/${rec.id}/review`, {}, accountant, 200)).status).toBe("REVIEWED");
    expect((await request(app).post(`${base}/reconciliations/${rec.id}/complete`).set(admin)).body.error).toMatch(/reviewed and approved/);
    expect((await request(app).post(`${base}/reconciliations/${rec.id}/approve`).set(authHeaders(orgId, "ADMIN", 501))).body.error).toMatch(/prepared a reconciliation can't approve/);
    expect((await post(`/reconciliations/${rec.id}/approve`, {}, admin, 200)).status).toBe("APPROVED");
    const done = await post(`/reconciliations/${rec.id}/complete`, {}, admin, 200);
    expect(done).toMatchObject({ status: "COMPLETED", preparedBy: 501, reviewedBy: 501, approvedBy: 441, completedBy: 441 });

    const locked = (await get(`/accounts/${ids.bank}/matching`)).matches.find((m: { locked: boolean }) => m.locked);
    expect((await request(app).delete(`${base}/matches/${locked.id}`).set(accountant)).body.error).toMatch(/completed reconciliation/);
    expect((await request(app).delete(`${base}/reconciliations/${rec.id}`).set(accountant)).body.error).toMatch(/can't be deleted/);
    expect((await request(app).post(`${base}/reconciliations`).set(accountant).send({ financialAccountId: ids.bank, statementDate: "2026-01-20", statementBalance: 0 })).body.error).toMatch(/reconciled to 2026-01-31/);
    const statements = await get(`/accounts/${ids.bank}/statements`);
    expect((await request(app).delete(`${base}/statements/${statements[0].id}`).set(accountant)).body.error).toMatch(/completed reconciliation/);

    const late = await post(`/accounts/${ids.bank}/statements/preview`, { fileName: "late.csv", content: statement("15/01/2026,Late line,LL,,,50,1341850") }, accountant, 200);
    expect(late.counts).toMatchObject({ new: 0, duplicate: 8, reconciledPeriod: 1 });

    const overview = await get("/reconciliations");
    expect(overview.accounts.find((a: { id: string }) => a.id === ids.bank)).toMatchObject({ lastReconciledTo: "2026-01-31", lastReconciledBalance: 1_341_800, unmatchedLines: 0 });
    expect(overview.history[0]).toMatchObject({ number: rec.number, status: "COMPLETED", outstandingCount: 2 });
  });

  it("reports the dashboard and the cash position from the GL", async () => {
    const dashboard = await get("/dashboard");
    expect(dashboard.totalAvailable).toBe(1_524_300);
    expect(dashboard.byKind.find((k: { kind: string }) => k.kind === "BANK")).toMatchObject({ count: 1, balance: 1_336_800 });
    expect(dashboard.outstandingPayments).toMatchObject({ count: 1, amount: 20_000 });
    const position = await get("/cash-position?asOf=2026-01-31");
    expect(position.totals.closing).toBe(1_524_300);
    const bank = position.rows.find((r: { id: string }) => r.id === ids.bank);
    expect(bank).toMatchObject({ opening: 1_324_000, moneyIn: 15_300, moneyOut: 2_500, closing: 1_336_800 });
    const list = await get(`/transactions?accountId=${ids.bank}&kind=BANK_CHARGE,INTEREST`);
    expect(list.total).toBe(2);
  });
});

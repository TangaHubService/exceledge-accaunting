import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 95571;
const otherOrgId = 95572;
const base = "/api/v1/banking";
let admin: Record<string, string> = {};
let other: Record<string, string> = {};
let companyId = "";
const ids: Record<string, string> = {};

async function send(path: string, body: unknown, headers = admin) {
  return request(app).post(path).set(headers).send(body);
}

async function created(path: string, body: unknown, headers = admin) {
  const res = await send(path, body, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function glNet(accountId: string) {
  const sum = await prisma.glEntry.aggregate({ where: { companyId, accountId }, _sum: { debit: true, credit: true } });
  return Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0);
}

async function arLedger() {
  const sum = await prisma.arLedgerEntry.aggregate({ where: { companyId }, _sum: { debit: true, credit: true } });
  return Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0);
}

async function apLedger() {
  const sum = await prisma.apLedgerEntry.aggregate({ where: { companyId }, _sum: { debit: true, credit: true } });
  return Number(sum._sum.credit ?? 0) - Number(sum._sum.debit ?? 0);
}

const bankGl = async (id = ids.bank) => glNet((await prisma.financialAccount.findUniqueOrThrow({ where: { id } })).glAccountId);
const counts = async () => ({
  bank: await prisma.bankTransaction.count({ where: { companyId } }),
  receipts: await prisma.arReceipt.count({ where: { companyId } }),
  payments: await prisma.apPayment.count({ where: { companyId } }),
  journals: await prisma.journal.count({ where: { companyId } }),
});

describe("Wave C: banking linked to customers and suppliers", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    admin = await activateCompany(app, orgId, { name: "WaveC Bank Co", tin: "955710001" });
    other = await activateCompany(app, otherOrgId, { name: "WaveC Bank Other", tin: "955720002" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
    ids.ar = defaults.accountsReceivableId!;
    ids.ap = defaults.accountsPayableId!;
    ids.bank = (await created(`${base}/accounts`, { kind: "BANK", name: "BK Linked", openingBalance: 1_000_000, dateOpened: "2026-01-01" })).id;
    ids.customer = (await created("/api/v1/ar/customers", { name: "Kigali Buyers", customerType: "CREDIT", creditLimit: 1_000_000 })).id;
    ids.invoice = (await created("/api/v1/ar/invoices", { customerId: ids.customer, invoiceDate: "2026-01-10", net: 1000, tax: 180 })).id;
    ids.supplier = (await created("/api/v1/ap/suppliers", { name: "Rubavu Supplies" })).id;
    ids.bill = (await created("/api/v1/ap/bills", { supplierId: ids.supplier, supplierInvoiceNumber: "RS-1", billDate: "2026-01-12", net: 500, tax: 90 })).id;
    ids.otherCustomer = (await created("/api/v1/ar/customers", { name: "Elsewhere Ltd", customerType: "CREDIT", creditLimit: 1_000 }, other)).id;
  });

  it("records money from a customer as one AR receipt and one journal that settle the invoice", async () => {
    const txn = await created(`${base}/receipts`, {
      financialAccountId: ids.bank,
      transactionDate: "2026-01-20",
      customerId: ids.customer,
      amount: 1500,
      method: "BANK_TRANSFER",
      reference: "TT-100",
      allocations: [{ documentId: ids.invoice, amount: 1000 }],
    });
    expect(txn).toMatchObject({ kind: "RECEIPT", amount: 1500, status: "POSTED", partyType: "CUSTOMER", partyName: "Kigali Buyers", customerId: ids.customer });
    expect(txn.arReceiptNumber).toMatch(/^RCT/);
    expect(txn.lines).toEqual([expect.objectContaining({ accountId: ids.ar, amount: 1500 })]);

    const receipt = await prisma.arReceipt.findUniqueOrThrow({ where: { id: txn.arReceiptId } });
    expect(receipt).toMatchObject({ customerId: ids.customer, financialAccountId: ids.bank, method: "BANK", reference: "TT-100" });
    expect(Number(receipt.unallocated)).toBe(500);
    expect(receipt.journalId).toBe(txn.journalId);
    expect(Number((await prisma.arInvoice.findUniqueOrThrow({ where: { id: ids.invoice } })).amountPaid)).toBe(1000);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: ids.customer } })).balance)).toBe(-320);

    expect(await prisma.journal.count({ where: { companyId, sourceDocumentId: { in: [txn.id, receipt.id] } } })).toBe(1);
    const entries = await prisma.glEntry.findMany({ where: { companyId, journalId: txn.journalId } });
    expect(entries.reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0)).toBe(0);
    expect(await bankGl()).toBe(1_001_500);
    expect(await glNet(ids.ar)).toBe(await arLedger());
    expect(await arLedger()).toBe(-320);
  });

  it("records a payment to a supplier as one AP payment and one journal that settle the bill", async () => {
    const txn = await created(`${base}/payments`, {
      financialAccountId: ids.bank,
      transactionDate: "2026-01-21",
      supplierId: ids.supplier,
      amount: 590,
      method: "CHEQUE",
      chequeNumber: "000501",
      allocations: [{ documentId: ids.bill, amount: 590 }],
    });
    expect(txn).toMatchObject({ kind: "PAYMENT", amount: 590, partyType: "SUPPLIER", partyName: "Rubavu Supplies", supplierId: ids.supplier });
    expect(txn.apPaymentNumber).toMatch(/^PAY/);
    expect(txn.lines).toEqual([expect.objectContaining({ accountId: ids.ap, amount: 590 })]);
    ids.supplierTxn = txn.id;
    ids.payment = txn.apPaymentId;

    const payment = await prisma.apPayment.findUniqueOrThrow({ where: { id: txn.apPaymentId } });
    expect(payment).toMatchObject({ method: "CHEQUE", financialAccountId: ids.bank, journalId: txn.journalId });
    expect(Number((await prisma.apBill.findUniqueOrThrow({ where: { id: ids.bill } })).amountPaid)).toBe(590);
    expect(Number((await prisma.supplier.findUniqueOrThrow({ where: { id: ids.supplier } })).balance)).toBe(0);
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentId: { in: [txn.id, payment.id] } } })).toBe(1);
    expect(await bankGl()).toBe(1_000_910);
    expect(0 - (await glNet(ids.ap))).toBe(await apLedger());
    expect(await apLedger()).toBe(0);

    const dup = await send(`${base}/payments`, { financialAccountId: ids.bank, transactionDate: "2026-01-22", supplierId: ids.supplier, amount: 10, chequeNumber: "000501" });
    expect(dup.body.error).toMatch(/Cheque 000501 is already used/);
  });

  it("refuses receivables and payables control accounts without a party, including from statement lines", async () => {
    const before = await counts();
    const ar = await send(`${base}/receipts`, { financialAccountId: ids.bank, transactionDate: "2026-01-22", lines: [{ accountId: ids.ar, amount: 100 }] });
    expect(ar.status).toBe(400);
    expect(ar.body.error).toMatch(/receivables control account; choose the customer/);
    const ap = await send(`${base}/payments`, { financialAccountId: ids.bank, transactionDate: "2026-01-22", lines: [{ accountId: ids.ap, amount: 100 }] });
    expect(ap.body.error).toMatch(/payables control account; choose the supplier/);

    const special = await prisma.account.create({ data: { companyId, code: "1215", name: "Receivables - related parties", type: "ASSET" } });
    const related = await created("/api/v1/ar/customers", { name: "Sister Co", customerType: "CREDIT", creditLimit: 1000 });
    await prisma.customer.update({ where: { id: related.id }, data: { arAccountId: special.id } });
    const party = await send(`${base}/receipts`, { financialAccountId: ids.bank, transactionDate: "2026-01-22", lines: [{ accountId: await accountIdByCode("1900"), amount: 5 }, { accountId: special.id, amount: 50 }] });
    expect(party.body.error).toMatch(/1215 Receivables - related parties is a receivables control account/);

    const stmtAccount = await created(`${base}/accounts`, { kind: "BANK", name: "BK Statement", dateOpened: "2026-01-01" });
    const content = ["Transaction Date,Narrative,Reference,Cheque No,Debit,Credit,Balance", "01/01/2026,Opening balance,,,,,0", "15/01/2026,Customer deposit,DEP9,,,700,700"].join("\n");
    await created(`${base}/accounts/${stmtAccount.id}/statements`, { fileName: "stmt.csv", content });
    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { companyId, financialAccountId: stmtAccount.id, amount: 700 } });
    const recorded = await send(`${base}/statement-lines/${line.id}/record`, { kind: "OTHER", accountId: ids.ar });
    expect(recorded.status).toBe(400);
    expect(recorded.body.error).toMatch(/receivables control account/);
    expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: line.id } })).matchId).toBeNull();

    const after = await counts();
    expect(after.bank - before.bank).toBe(0);
    expect(after.journals - before.journals).toBe(0);
  });

  it("refuses parties from another company, foreign-currency or inactive parties, and mismatched inputs", async () => {
    const before = await counts();
    const body = { financialAccountId: ids.bank, transactionDate: "2026-01-23", amount: 100 };
    expect((await send(`${base}/receipts`, { ...body, customerId: ids.otherCustomer })).body.error).toBe("Customer does not exist");
    const usd = await created("/api/v1/ar/customers", { name: "Dollar Buyer", customerType: "CREDIT", creditLimit: 1000, currency: "USD" });
    expect((await send(`${base}/receipts`, { ...body, customerId: usd.id })).body.error).toMatch(/No exchange rate for USD|Documents in USD are not supported/);
    const idle = await created("/api/v1/ap/suppliers", { name: "Dormant Vendor" });
    await prisma.supplier.update({ where: { id: idle.id }, data: { status: "INACTIVE" } });
    expect((await send(`${base}/payments`, { ...body, supplierId: idle.id })).body.error).toBe("Supplier account is not active");
    expect((await send(`${base}/payments`, { ...body, customerId: ids.customer })).body.error).toMatch(/customer can only be chosen on money received/);
    expect((await send(`${base}/receipts`, { ...body, supplierId: ids.supplier })).body.error).toMatch(/supplier can only be chosen on a payment/);
    expect((await send(`${base}/receipts`, { ...body, kind: "INTEREST", customerId: ids.customer })).body.error).toMatch(/customer can only be chosen/);
    expect((await send(`${base}/receipts`, { ...body, customerId: ids.customer, lines: [{ accountId: ids.ar, amount: 100 }] })).body.error).toMatch(/give the amount instead of account lines/);
    expect((await send(`${base}/receipts`, { financialAccountId: ids.bank, transactionDate: "2026-01-23", customerId: ids.customer })).body.error).toMatch(/Amount must be positive/);
    expect((await send(`${base}/receipts`, { ...body, lines: [{ accountId: await accountIdByCode("1900"), amount: 100 }], allocations: [{ documentId: ids.invoice, amount: 100 }] })).body.error).toMatch(/only be settled when a customer or supplier is chosen/);
    const after = await counts();
    expect(after).toEqual(before);
  });

  it("refuses over-allocation and documents of another party", async () => {
    const before = await counts();
    const body = { financialAccountId: ids.bank, transactionDate: "2026-01-24" };
    const invoice2 = await created("/api/v1/ar/invoices", { customerId: ids.customer, invoiceDate: "2026-01-15", net: 400 });
    ids.invoice2 = invoice2.id;
    const tooMuch = await send(`${base}/receipts`, { ...body, customerId: ids.customer, amount: 1000, allocations: [{ documentId: invoice2.id, amount: 401 }] });
    expect(tooMuch.body.error).toMatch(/exceeds invoice outstanding/);
    const overAmount = await send(`${base}/receipts`, { ...body, customerId: ids.customer, amount: 100, allocations: [{ documentId: invoice2.id, amount: 200 }] });
    expect(overAmount.body.error).toMatch(/Allocations exceed payment amount/);
    const paidInvoice = await send(`${base}/receipts`, { ...body, customerId: ids.customer, amount: 300, allocations: [{ documentId: ids.invoice, amount: 300 }] });
    expect(paidInvoice.body.error).toMatch(/exceeds invoice outstanding/);
    const stranger = await created("/api/v1/ar/customers", { name: "Stranger Ltd", customerType: "CREDIT", creditLimit: 1000 });
    expect((await send(`${base}/receipts`, { ...body, customerId: stranger.id, amount: 100, allocations: [{ documentId: invoice2.id, amount: 100 }] })).body.error).toMatch(/not found for this customer/);
    const bill2 = await created("/api/v1/ap/bills", { supplierId: ids.supplier, supplierInvoiceNumber: "RS-2", billDate: "2026-01-15", net: 300 });
    expect((await send(`${base}/payments`, { ...body, supplierId: ids.supplier, amount: 500, allocations: [{ documentId: bill2.id, amount: 350 }] })).body.error).toMatch(/exceeds bill outstanding/);
    const after = await counts();
    expect(after.bank).toBe(before.bank);
    expect(after.receipts).toBe(before.receipts);
    expect(after.payments).toBe(before.payments);
    expect(after.journals - before.journals).toBe(2);
  });

  it("reverses the AR receipt with the bank transaction, and the bank transaction with the AR receipt", async () => {
    const txn = await created(`${base}/receipts`, { financialAccountId: ids.bank, transactionDate: "2026-01-25", customerId: ids.customer, amount: 400, allocations: [{ documentId: ids.invoice2, amount: 400 }] });
    const bankBefore = await bankGl();
    const reversed = await send(`${base}/transactions/${txn.id}/reverse`, { reason: "Bounced transfer", reversalDate: "2026-01-26" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body.data).toMatchObject({ status: "REVERSED", reversalReason: "Bounced transfer" });
    const receipt = await prisma.arReceipt.findUniqueOrThrow({ where: { id: txn.arReceiptId } });
    expect(receipt.status).toBe("REVERSED");
    const reversal = await prisma.journal.findFirstOrThrow({ where: { companyId, sourceDocumentType: "ArReceiptReversal", sourceDocumentId: receipt.id } });
    expect(reversed.body.data.reversalJournalId).toBe(reversal.id);
    expect(reversal.journalDate.toISOString().slice(0, 10)).toBe("2026-01-26");
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "BankTransactionReversal", sourceDocumentId: txn.id } })).toBe(0);
    expect(Number((await prisma.arInvoice.findUniqueOrThrow({ where: { id: ids.invoice2 } })).amountPaid)).toBe(0);
    expect(await bankGl()).toBe(bankBefore - 400);
    expect(await glNet(ids.ar)).toBe(await arLedger());

    expect((await send(`${base}/transactions/${txn.id}/reverse`, { reason: "again" })).body.error).toMatch(/already reversed/);
    expect((await send(`/api/v1/ar/receipts/${receipt.id}/reverse`, {})).body.error).toMatch(/already reversed/);

    const viaAp = await send(`/api/v1/ap/payments/${ids.payment}/reverse`, { reason: "Cheque cancelled", reversalDate: "2026-01-27" });
    expect(viaAp.status, JSON.stringify(viaAp.body)).toBe(200);
    const bankTxn = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids.supplierTxn } });
    expect(bankTxn).toMatchObject({ status: "REVERSED", reversalJournalId: viaAp.body.data.journalId, reversalReason: "Cheque cancelled" });
    expect(Number((await prisma.apBill.findUniqueOrThrow({ where: { id: ids.bill } })).amountPaid)).toBe(0);
    expect(0 - (await glNet(ids.ap))).toBe(await apLedger());
    expect((await send(`${base}/transactions/${ids.supplierTxn}/reverse`, { reason: "again" })).body.error).toMatch(/already reversed/);
    expect((await send(`/api/v1/ap/payments/${ids.payment}/reverse`, {})).body.error).toMatch(/already reversed/);
  });

  it("lets only one of two concurrent reversals from Banking and Receivables through", async () => {
    const txn = await created(`${base}/receipts`, { financialAccountId: ids.bank, transactionDate: "2026-01-28", customerId: ids.customer, amount: 250 });
    const results = await Promise.all([
      send(`${base}/transactions/${txn.id}/reverse`, { reason: "Duplicate entry", reversalDate: "2026-01-28" }),
      send(`/api/v1/ar/receipts/${txn.arReceiptId}/reverse`, {}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "ArReceiptReversal", sourceDocumentId: txn.arReceiptId } })).toBe(1);
    const bankTxn = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(bankTxn.status).toBe("REVERSED");
    expect(bankTxn.reversalJournalId).not.toBeNull();
    expect(await glNet(ids.ar)).toBe(await arLedger());
  });

  it("leaves nothing behind when the period is closed", async () => {
    const date = new Date("2026-02-10T00:00:00Z");
    const period = await prisma.accountingPeriod.findFirstOrThrow({ where: { financialYear: { companyId }, startDate: { lte: date }, endDate: { gte: date } } });
    await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: "CLOSED" } });
    try {
      const before = await counts();
      const receipt = await send(`${base}/receipts`, { financialAccountId: ids.bank, transactionDate: "2026-02-10", customerId: ids.customer, amount: 100 });
      expect(receipt.status).toBe(400);
      expect(receipt.body.error).toMatch(/closed/i);
      const payment = await send(`${base}/payments`, { financialAccountId: ids.bank, transactionDate: "2026-02-10", supplierId: ids.supplier, amount: 100 });
      expect(payment.status).toBe(400);
      expect(await counts()).toEqual(before);
      expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: ids.customer } })).balance)).toBe(await arLedgerFor(ids.customer));
    } finally {
      await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: period.status } });
    }
  });

  it("checks funds before paying a supplier and takes money from a customer on credit hold", async () => {
    const till = await created(`${base}/accounts`, { kind: "CASH", name: "Till Linked", openingBalance: 200, dateOpened: "2026-01-01" });
    const before = await counts();
    const short = await send(`${base}/payments`, { financialAccountId: till.id, transactionDate: "2026-01-29", supplierId: ids.supplier, amount: 250 });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/Till Linked has 200 available; this needs 250/);
    expect(await counts()).toEqual(before);
    await created(`${base}/payments`, { financialAccountId: till.id, transactionDate: "2026-01-29", supplierId: ids.supplier, amount: 200 });
    expect(await bankGl(till.id)).toBe(0);

    await prisma.customer.update({ where: { id: ids.customer }, data: { creditStatus: "ON_HOLD" } });
    try {
      const invoice = await send("/api/v1/ar/invoices", { customerId: ids.customer, invoiceDate: "2026-01-29", net: 100 });
      expect(invoice.body.error).toMatch(/does not allow new receivables/);
      const txn = await created(`${base}/receipts`, { financialAccountId: till.id, transactionDate: "2026-01-29", customerId: ids.customer, amount: 75 });
      expect(txn.arReceiptNumber).toMatch(/^RCT/);
      expect(await bankGl(till.id)).toBe(75);
      expect(await glNet(ids.ar)).toBe(await arLedger());
    } finally {
      await prisma.customer.update({ where: { id: ids.customer }, data: { creditStatus: "GOOD" } });
    }
  });
});

async function accountIdByCode(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function arLedgerFor(customerId: string) {
  const sum = await prisma.arLedgerEntry.aggregate({ where: { companyId, customerId }, _sum: { debit: true, credit: true } });
  return Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0);
}

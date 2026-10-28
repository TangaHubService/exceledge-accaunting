import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { recordIntegrityScan } from "../src/modules/integrity/integrity.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 92410;
const otherOrgId = 92411;
const base = "/api/v1/books/integrity";
let admin: Record<string, string> = {};
let other: Record<string, string> = {};
let companyId = "";
let otherCompanyId = "";

async function accountId(code: string, company = companyId) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId: company, code } })).id;
}

async function run(headers = admin) {
  const res = await request(app).post(`${base}/run`).set(headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as { findingCount: number; checks: Array<{ check: string; count: number }>; findings: Array<{ check: string; severity: string; message: string; details: Record<string, unknown> }> };
}

const of = (scan: Awaited<ReturnType<typeof run>>, check: string) => scan.findings.filter((f) => f.check === check);

describe("Wave C: data integrity scan", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    admin = await activateCompany(app, orgId, { name: "Integrity Co", tin: "924100001" });
    other = await activateCompany(app, otherOrgId, { name: "Integrity Other", tin: "924110001" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    otherCompanyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(otherOrgId) } })).id;

    const sale = await request(app).post("/api/v1/journals").set(admin).send({
      journalDate: "2026-01-15",
      description: "Cash sale",
      postImmediately: true,
      lines: [
        { accountId: await accountId("1110"), debit: 1000, credit: 0 },
        { accountId: await accountId("4100"), debit: 0, credit: 1000 },
      ],
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const customer = await request(app).post("/api/v1/ar/customers").set(admin).send({ name: "Huye Traders", customerType: "CREDIT", creditLimit: 10000 });
    const invoice = await request(app).post("/api/v1/ar/invoices").set(admin).send({ customerId: customer.body.data.id, invoiceDate: "2026-01-16", net: 1000, tax: 180 });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const receipt = await request(app)
      .post("/api/v1/ar/receipts")
      .set(admin)
      .send({ customerId: customer.body.data.id, receiptDate: "2026-01-20", method: "BANK", amount: 400, allocations: [{ invoiceId: invoice.body.data.id, amount: 400 }] });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    const supplier = await request(app).post("/api/v1/ap/suppliers").set(admin).send({ name: "Musanze Supplies" });
    const bill = await request(app).post("/api/v1/ap/bills").set(admin).send({ supplierId: supplier.body.data.id, supplierInvoiceNumber: "S-1", billDate: "2026-01-12", net: 500, tax: 90 });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
  });

  it("has no result before the first scan and finds nothing in consistent books", async () => {
    const before = await request(app).get(base).set(admin);
    expect(before.status).toBe(200);
    expect(before.body.data).toBeNull();

    const scan = await run();
    expect(scan.findings).toEqual([]);
    expect(scan.findingCount).toBe(0);
    expect(scan.checks.every((c) => c.count === 0)).toBe(true);
    expect(await prisma.notification.count({ where: { companyId, entityType: "IntegrityScan" } })).toBe(0);
    const audit = await prisma.auditEvent.findFirst({ where: { companyId, entityType: "IntegrityScan", action: "RUN" } });
    expect(audit?.erpUserId).toBe(441);

    const latest = await request(app).get(base).set(authHeaders(orgId, "BRANCH_MANAGER", 450));
    expect(latest.status).toBe(200);
    expect(latest.body.data.findingCount).toBe(0);
  });

  it("only lets users who manage the close run a scan, and hides it from sellers", async () => {
    expect((await request(app).post(`${base}/run`).set(authHeaders(orgId, "BRANCH_MANAGER", 450))).status).toBe(403);
    expect((await request(app).post(`${base}/run`).set(authHeaders(orgId, "SELLER", 451))).status).toBe(403);
    expect((await request(app).get(base).set(authHeaders(orgId, "SELLER", 451))).status).toBe(403);
    expect(await prisma.integrityScan.count({ where: { companyId } })).toBe(1);
  });

  it("detects a receivables invoice that never reached the GL", async () => {
    const customer = await prisma.customer.findFirstOrThrow({ where: { companyId } });
    const invoice = await prisma.arInvoice.create({
      data: { companyId, customerId: customer.id, invoiceNumber: "INV-ROGUE-1", invoiceDate: new Date("2026-01-18"), dueDate: new Date("2026-02-18"), net: 250, gross: 250 },
    });
    await prisma.arLedgerEntry.create({ data: { companyId, customerId: customer.id, entryDate: new Date("2026-01-18"), docType: "INVOICE", docId: invoice.id, docNumber: invoice.invoiceNumber, debit: 250, credit: 0 } });

    const scan = await run();
    const ar = of(scan, "AR_SUBLEDGER");
    expect(ar).toHaveLength(1);
    expect(ar[0].details).toMatchObject({ glBalance: 780, subledgerBalance: 1030, difference: -250 });
    expect(of(scan, "DOCUMENT_WITHOUT_GL").map((f) => f.details.number)).toEqual(["INV-ROGUE-1"]);
    expect(of(scan, "AP_SUBLEDGER")).toHaveLength(0);

    const notes = await prisma.notification.findMany({ where: { companyId, entityType: "IntegrityScan" } });
    expect(notes.map((n) => n.targetRole).sort()).toEqual(["ACCOUNTANT", "ADMIN"]);
    expect(notes[0].severity).toBe("CRITICAL");
  });

  it("does not notify again while the findings are unchanged", async () => {
    const before = await prisma.notification.count({ where: { companyId, entityType: "IntegrityScan" } });
    const scheduled = await recordIntegrityScan(companyId, "SCHEDULED", { erpUserId: 0, erpRole: "SYSTEM" });
    expect(scheduled.findingCount).toBe(2);
    expect(scheduled.runByErpUserId).toBeNull();
    expect(await prisma.notification.count({ where: { companyId, entityType: "IntegrityScan" } })).toBe(before);
    expect(await prisma.auditEvent.count({ where: { companyId, entityType: "IntegrityScan", entityId: scheduled.id } })).toBe(0);
  });

  it("detects an unbalanced posted journal and GL entries that differ from the lines", async () => {
    const cash = await accountId("1100");
    const sales = await accountId("4100");
    const journal = await prisma.journal.create({
      data: {
        companyId,
        journalNumber: "ROGUE-UNBALANCED",
        journalDate: new Date("2026-01-20"),
        status: "POSTED",
        totalDebit: 100,
        totalCredit: 90,
        lines: {
          create: [
            { companyId, lineNumber: 1, accountId: cash, debit: 100, credit: 0 },
            { companyId, lineNumber: 2, accountId: sales, debit: 0, credit: 90 },
          ],
        },
      },
    });
    const scan = await run();
    const found = of(scan, "UNBALANCED_JOURNAL");
    expect(found).toHaveLength(1);
    expect(found[0].details).toMatchObject({ journalId: journal.id, lines: { debit: 100, credit: 90 }, gl: { debit: 0, credit: 0 } });
    expect(found[0].message).toMatch(/does not balance/);
  });

  it("detects a gap in journal numbers", async () => {
    const last = await prisma.journal.findFirstOrThrow({ where: { companyId, NOT: { journalNumber: { startsWith: "ROGUE" } } }, orderBy: { journalNumber: "desc" } });
    const n = Number(last.journalNumber.match(/(\d+)$/)![1]);
    const series = last.journalNumber.replace(/\d+$/, "");
    await prisma.journal.create({
      data: { companyId, journalNumber: `${series}${String(n + 3).padStart(6, "0")}`, journalDate: new Date("2026-01-21"), status: "DRAFT" },
    });
    const scan = await run();
    const gaps = of(scan, "JOURNAL_NUMBER_GAP");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].details).toMatchObject({ period: "2026", from: n + 1, to: n + 2, missing: 2, after: last.journalNumber });
    expect(gaps[0].severity).toBe("WARNING");
  });

  it("ignores gaps below the legacy floor of the numbering sequence", async () => {
    const seq = await prisma.numberSequence.findUniqueOrThrow({ where: { companyId_documentType: { companyId, documentType: "JOURNAL_ENTRY" } } });
    const last = await prisma.journal.findFirstOrThrow({ where: { companyId, NOT: { journalNumber: { startsWith: "ROGUE" } } }, orderBy: { journalNumber: "desc" } });
    const n = Number(last.journalNumber.match(/(\d+)$/)![1]);
    await prisma.numberSequence.update({ where: { id: seq.id }, data: { legacyFloor: n } });
    try {
      expect(of(await run(), "JOURNAL_NUMBER_GAP")).toHaveLength(0);
    } finally {
      await prisma.numberSequence.update({ where: { id: seq.id }, data: { legacyFloor: seq.legacyFloor } });
    }
  });

  it("treats month and branch segments as one counter, so backdated journals are not gaps", async () => {
    const seq = await prisma.numberSequence.findUniqueOrThrow({ where: { companyId_documentType: { companyId, documentType: "JOURNAL_ENTRY" } } });
    await prisma.numberSequence.update({ where: { id: seq.id }, data: { includeMonth: true, includeBranch: true, resetFrequency: "YEARLY" } });
    try {
      for (const [journalNumber, date] of [
        ["JE-2027-01-HQ-000001", "2027-01-05"],
        ["JE-2027-02-12-000002", "2027-02-03"],
        ["JE-2027-01-HQ-000003", "2027-01-20"],
        ["JE-2027-03-HQ-000006", "2027-03-01"],
      ]) {
        await prisma.journal.create({ data: { companyId, journalNumber, journalDate: new Date(date), status: "DRAFT" } });
      }
      const gaps = of(await run(), "JOURNAL_NUMBER_GAP").filter((f) => f.details.period === "2027");
      expect(gaps).toHaveLength(1);
      expect(gaps[0].details).toMatchObject({ from: 4, to: 5, missing: 2, after: "JE-2027-01-HQ-000003", before: "JE-2027-03-HQ-000006" });
    } finally {
      await prisma.numberSequence.update({ where: { id: seq.id }, data: { includeMonth: seq.includeMonth, includeBranch: seq.includeBranch, resetFrequency: seq.resetFrequency } });
    }
  });

  it("flags a debit note that never reached the GL", async () => {
    const customer = await prisma.customer.findFirstOrThrow({ where: { companyId } });
    await prisma.arDebitNote.create({
      data: { companyId, customerId: customer.id, debitNoteNumber: "DN-ROGUE-1", noteDate: new Date("2026-01-23"), dueDate: new Date("2026-02-23"), reason: "Late fee", net: 50, gross: 50 },
    });
    expect(of(await run(), "DOCUMENT_WITHOUT_GL").map((f) => f.details.number)).toContain("DN-ROGUE-1");
  });

  it("detects a negative bank balance", async () => {
    const paid = await request(app).post("/api/v1/journals").set(admin).send({
      journalDate: "2026-01-22",
      description: "Wages paid",
      postImmediately: true,
      lines: [
        { accountId: await accountId("6100"), debit: 1500, credit: 0 },
        { accountId: await accountId("1110"), debit: 0, credit: 1500 },
      ],
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const scan = await run();
    const cash = of(scan, "NEGATIVE_CASH");
    expect(cash).toHaveLength(1);
    const bank = await prisma.glEntry.aggregate({ where: { companyId, accountId: await accountId("1110") }, _sum: { debit: true, credit: true } });
    expect(cash[0].details).toMatchObject({ code: "1110", balance: Number(bank._sum.debit) - Number(bank._sum.credit) });
    expect(cash[0].details.balance).toBeLessThan(0);

    const latest = await request(app).get(base).set(admin);
    expect(latest.body.data.checks.find((c: { check: string }) => c.check === "NEGATIVE_CASH").count).toBe(1);
    expect(latest.body.data.findingCount).toBe(scan.findingCount);
  });

  it("keeps each company's scan to its own books", async () => {
    const scan = await run(other);
    expect(scan.findings).toEqual([]);
    const latest = await request(app).get(base).set(other);
    expect(latest.body.data.id).not.toBe((await prisma.integrityScan.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: "desc" } })).id);
    expect(await prisma.notification.count({ where: { companyId: otherCompanyId, entityType: "IntegrityScan" } })).toBe(0);
  });
});

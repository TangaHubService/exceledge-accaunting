import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { createAndPostJournal } from "../src/modules/journals/journal.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98971;
const base = "/api/v1/books";

let admin: Record<string, string>;
const accountant = authHeaders(orgId, "ACCOUNTANT", 951);
const secondAdmin = authHeaders(orgId, "ADMIN", 952);
const manager = authHeaders(orgId, "BRANCH_MANAGER", 953);
let companyId = "";
const ids: Record<string, string> = {};

type Item = { key: string; status: string; detail: string; override: { note: string; erpUserId: number } | null };
type Checklist = { canClose: boolean; blockers: string[]; warnings: string[]; items: Item[]; counts: Record<string, number>; pendingRequest: { id: string } | null };

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function periodId(sequence: number) {
  return (await prisma.accountingPeriod.findFirstOrThrow({ where: { financialYear: { companyId }, sequence } })).id;
}

async function call(method: "post" | "put", path: string, body: unknown, headers = accountant, status = 200) {
  const res = await request(app)[method](`/api/v1${path}`).set(headers).send(body);
  if (res.status !== status) throw new Error(`${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function checklist(sequence: number): Promise<Checklist> {
  const res = await request(app).get(`${base}/close/checklist?periodId=${await periodId(sequence)}`).set(accountant);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

const statuses = (c: Checklist) => Object.fromEntries(c.items.map((i) => [i.key, i.status]));

async function overrideFailing(sequence: number) {
  const id = await periodId(sequence);
  for (const item of (await checklist(sequence)).items.filter((i) => i.status === "FAILING")) {
    await call("post", "/books/close/overrides", { periodId: id, item: item.key, note: `Accepted for test: ${item.key}` }, accountant, 201);
  }
}

async function history(sequence: number) {
  const res = await request(app).get(`${base}/close/history?periodId=${await periodId(sequence)}`).set(manager);
  expect(res.status).toBe(200);
  return res.body.data as Array<Record<string, unknown> & { checklist: { items: Item[] } }>;
}

describe("Wave C closing", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "WaveC Closing Co", tin: "989710001" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    await call("put", "/tax/settings", { vatRegistered: false }, admin);
    const sale = await call("post", "/journals", {
      journalDate: "2026-01-15",
      description: "Cash sale",
      postImmediately: true,
      lines: [
        { accountId: await accountId("1100"), debit: 80_000, credit: 0 },
        { accountId: await accountId("4100"), debit: 0, credit: 80_000 },
      ],
    }, admin, 201);
    ids.sale = sale.id;
  });

  it("marks every item not applicable for a company without banks, assets, FX, VAT or payroll", async () => {
    const jan = await checklist(1);
    expect(statuses(jan)).toEqual({
      BANK_RECONCILIATION: "NOT_APPLICABLE",
      DEPRECIATION: "NOT_APPLICABLE",
      FX_REVALUATION: "NOT_APPLICABLE",
      TAX_FILING: "NOT_APPLICABLE",
      PAYROLL: "NOT_APPLICABLE",
    });
    expect(jan.canClose).toBe(true);
    expect(jan.counts).toMatchObject({ unpostedJournals: 0, pendingApprovals: 0, openExceptions: 0, unreconciledBankItems: 0 });
  });

  it("counts unposted journals, pending approvals and exceptions per period", async () => {
    const lines = [
      { accountId: await accountId("1100"), debit: 5, credit: 0 },
      { accountId: await accountId("4100"), debit: 0, credit: 5 },
    ];
    const draft = await call("post", "/journals", { journalDate: "2026-01-20", description: "Draft", lines }, accountant, 201);
    await call("post", "/journals", { journalDate: "2026-02-20", description: "February draft", lines }, accountant, 201);
    const approval = await call("post", "/books/approvals", { entityType: "Journal", entityId: ids.sale, amount: 80_000 }, accountant, 201);
    await prisma.postingException.create({ data: { companyId, reason: "February event failed", createdAt: new Date("2026-02-10T09:00:00Z") } });

    const jan = await checklist(1);
    expect(jan.counts).toMatchObject({ drafts: 1, unpostedJournals: 1, pendingApprovals: 1, openExceptions: 0 });
    expect(jan.canClose).toBe(false);
    expect(jan.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/1 journal\(s\) in the period are not posted/), expect.stringMatching(/1 approval/)]));
    const feb = await checklist(2);
    expect(feb.counts).toMatchObject({ unpostedJournals: 1, pendingApprovals: 0, openExceptions: 1 });

    await call("post", `/books/approvals/${approval.id}/decide`, { status: "REJECTED", note: "Not needed" }, secondAdmin);
    await prisma.journal.updateMany({ where: { companyId, status: "DRAFT" }, data: { status: "CANCELLED" } });
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("CANCELLED");
    expect((await checklist(1)).canClose).toBe(true);
  });

  it("fails the bank item until each bank account has a completed reconciliation to the period end", async () => {
    const bank = await call("post", "/banking/accounts", { kind: "BANK", name: "Close Bank", dateOpened: "2026-01-01" }, accountant, 201);
    ids.bank = bank.id;
    let jan = await checklist(1);
    expect(jan.items.find((i) => i.key === "BANK_RECONCILIATION")).toMatchObject({ status: "FAILING", detail: expect.stringMatching(/Close Bank/) });
    expect(jan.canClose).toBe(false);

    await call("post", "/banking/receipts", { financialAccountId: bank.id, transactionDate: "2026-01-10", partyName: "Walk-in", lines: [{ accountId: await accountId("4100"), amount: 10_000 }] }, accountant, 201);
    expect((await checklist(1)).counts.unreconciledBankItems).toBe(1);
    const csv = ["Transaction Date,Narrative,Reference,Cheque No,Debit,Credit,Balance", "01/01/2026,Opening balance,,,,,0", "10/01/2026,Walk-in deposit,DP1,,,10000,10000"].join("\n");
    expect(await call("post", `/banking/accounts/${bank.id}/statements`, { fileName: "jan.csv", content: csv }, accountant, 201)).toMatchObject({ imported: 1, autoMatched: 1 });
    const rec = await call("post", "/banking/reconciliations", { financialAccountId: bank.id, statementDate: "2026-01-31", statementBalance: 10_000 }, accountant, 201);
    await call("post", `/banking/reconciliations/${rec.id}/review`, {}, accountant);
    jan = await checklist(1);
    expect(statuses(jan).BANK_RECONCILIATION).toBe("FAILING");
    await call("post", `/banking/reconciliations/${rec.id}/approve`, {}, admin);
    await call("post", `/banking/reconciliations/${rec.id}/complete`, {}, admin);
    expect(statuses(await checklist(1)).BANK_RECONCILIATION).toBe("DONE");
    expect(statuses(await checklist(2)).BANK_RECONCILIATION).toBe("FAILING");

    await call("post", "/banking/receipts", { financialAccountId: bank.id, transactionDate: "2026-02-10", partyName: "Walk-in", lines: [{ accountId: await accountId("4100"), amount: 15_000 }] }, accountant, 201);
    const feb = await checklist(2);
    expect(feb.counts.unreconciledBankItems).toBe(1);
    expect(feb.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/1 bank or mobile money entry/)]));
    expect((await checklist(1)).counts.unreconciledBankItems).toBe(0);
  });

  it("fails depreciation for a month with depreciable assets until the run is posted", async () => {
    const categories: Array<{ id: string; code: string }> = (await request(app).get("/api/v1/fixed-assets/categories").set(accountant)).body.data;
    await call(
      "post",
      "/fixed-assets/assets",
      {
        name: "Delivery van",
        categoryId: categories.find((c) => c.code === "OFFICE")!.id,
        acquisitionCost: 6_000_000,
        residualValue: 0,
        usefulLifeMonths: 60,
        purchaseDate: "2026-01-05",
        capitalize: true,
        capitalizationDate: "2026-01-05",
        creditAccountId: await accountId("1110"),
      },
      accountant,
      201,
    );
    expect((await checklist(1)).items.find((i) => i.key === "DEPRECIATION")).toMatchObject({ status: "FAILING", detail: expect.stringMatching(/2026-01 \(1 asset/) });
    await call("post", "/fixed-assets/depreciation/run", { period: "2026-01" }, accountant, 201);
    expect((await checklist(1)).items.find((i) => i.key === "DEPRECIATION")).toMatchObject({ status: "DONE", detail: expect.stringMatching(/2026-01/) });
    expect(statuses(await checklist(2)).DEPRECIATION).toBe("FAILING");
  });

  it("asks for a VAT return only when VAT registered and a return ends in the period", async () => {
    await call("put", "/tax/settings", { vatRegistered: true, vatFilingFrequency: "MONTHLY" }, admin);
    expect(statuses(await checklist(1)).TAX_FILING).toBe("FAILING");
    await call("put", "/tax/settings", { vatFilingFrequency: "QUARTERLY" }, admin);
    expect(statuses(await checklist(1)).TAX_FILING).toBe("NOT_APPLICABLE");
    expect(statuses(await checklist(3)).TAX_FILING).toBe("FAILING");
    await call("put", "/tax/settings", { vatFilingFrequency: "MONTHLY" }, admin);
    await call("post", "/tax/filings", { kind: "VAT", periodFrom: "2026-01-01", periodTo: "2026-01-31" }, admin, 201);
    expect((await checklist(1)).items.find((i) => i.key === "TAX_FILING")).toMatchObject({ status: "DONE", detail: expect.stringMatching(/prepared/) });
    expect(statuses(await checklist(2)).TAX_FILING).toBe("FAILING");
  });

  it("asks for FX revaluation only for foreign balances, and payroll only once payroll exists", async () => {
    const usd = await prisma.account.create({ data: { companyId, code: "1190", name: "USD deposit", type: "ASSET", currency: "USD" } });
    expect(statuses(await checklist(1)).FX_REVALUATION).toBe("NOT_APPLICABLE");
    await createAndPostJournal(
      companyId,
      {
        journalDate: new Date("2026-01-10T00:00:00Z"),
        journalType: "ADJUSTMENT",
        description: "USD deposit",
        currencyCode: "USD",
        exchangeRate: 1300,
        lines: [
          { accountId: usd.id, debit: 100, credit: 0 },
          { accountId: await accountId("4100"), debit: 0, credit: 100 },
        ],
      },
      { erpUserId: 441, erpRole: "ADMIN" },
    );
    expect((await checklist(1)).items.find((i) => i.key === "FX_REVALUATION")).toMatchObject({ status: "FAILING", detail: expect.stringMatching(/USD/) });
    await call("post", "/books/fx/rates", { currency: "USD", rateDate: "2026-01-31", rate: 1350 }, admin, 201);
    await call("post", "/books/fx/revalue", { currency: "USD", asOf: "2026-01-31" }, admin);
    expect(statuses(await checklist(1)).FX_REVALUATION).toBe("DONE");
    expect(statuses(await checklist(2)).FX_REVALUATION).toBe("FAILING");

    expect(statuses(await checklist(1)).PAYROLL).toBe("NOT_APPLICABLE");
    await prisma.integrationEvent.create({
      data: {
        companyId,
        eventId: "payroll-jan",
        idempotencyKey: "payroll-jan",
        eventType: "PAYROLL_APPROVED",
        externalOrganizationId: String(orgId),
        sourceModule: "PAYROLL",
        sourceDocumentType: "PayrollRun",
        sourceDocumentId: "jan",
        occurredAt: new Date("2026-01-25T00:00:00Z"),
        currencyCode: "RWF",
        payload: {},
        status: "POSTED",
      },
    });
    expect(statuses(await checklist(1)).PAYROLL).toBe("DONE");
    expect(statuses(await checklist(2)).PAYROLL).toBe("FAILING");
  });

  it("closes January directly when close approval is off and records it in the history", async () => {
    const jan = await checklist(1);
    expect(jan.canClose, jan.blockers.join("; ")).toBe(true);
    expect(statuses(jan)).toEqual({ BANK_RECONCILIATION: "DONE", DEPRECIATION: "DONE", FX_REVALUATION: "DONE", TAX_FILING: "DONE", PAYROLL: "DONE" });
    const closed = await call("post", "/books/close", { periodId: await periodId(1), kind: "MONTH" }, admin);
    expect(closed).toMatchObject({ status: "CLOSED", requestedByErpUserId: 441, closedByErpUserId: 441, approvalRequestId: null });
    const again = await request(app).post(`${base}/close`).set(admin).send({ periodId: await periodId(1), kind: "MONTH" });
    expect(again.body.error).toMatch(/already closed/);
    const [row] = await history(1);
    expect(row).toMatchObject({ status: "CLOSED", requestedByErpUserId: 441, closedByErpUserId: 441, periodName: expect.any(String) });
    expect(row.checklist.items.map((i) => i.status)).toEqual(["DONE", "DONE", "DONE", "DONE", "DONE"]);
  });

  it("blocks a close on failing items until each is overridden with a note by someone with close:manage", async () => {
    const febId = await periodId(2);
    await prisma.postingException.updateMany({ where: { companyId }, data: { status: "RESOLVED" } });
    const blocked = await request(app).post(`${base}/close`).set(admin).send({ periodId: febId, kind: "MONTH" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/Bank reconciliations completed: .*Close Bank/);
    expect(blocked.body.error).toMatch(/Payroll posted/);

    expect((await request(app).post(`${base}/close/overrides`).set(manager).send({ periodId: febId, item: "PAYROLL", note: "No staff in February" })).status).toBe(403);
    expect((await request(app).post(`${base}/close/overrides`).set(accountant).send({ periodId: febId, item: "PAYROLL", note: "  " })).body.error).toMatch(/Explain why/);
    expect((await request(app).post(`${base}/close/overrides`).set(accountant).send({ periodId: febId, item: "INVENTORY", note: "whatever" })).status).toBe(400);
    expect((await request(app).post(`${base}/close/overrides`).set(accountant).send({ periodId: await periodId(1), item: "PAYROLL", note: "Closed month" })).body.error).toMatch(/already closed/);
    await prisma.taxFiling.create({ data: { companyId, number: "FIL-FEB", kind: "VAT", status: "PREPARED", periodFrom: new Date("2026-02-01T00:00:00Z"), periodTo: new Date("2026-02-28T00:00:00Z") } });
    expect((await request(app).post(`${base}/close/overrides`).set(accountant).send({ periodId: febId, item: "TAX_FILING", note: "Already done" })).body.error).toMatch(/not failing/);

    await call("post", "/books/close/overrides", { periodId: febId, item: "PAYROLL", note: "No staff in February" }, accountant, 201);
    const feb = await checklist(2);
    expect(feb.items.find((i) => i.key === "PAYROLL")).toMatchObject({ status: "OVERRIDDEN", override: { note: "No staff in February", erpUserId: 951 } });
    expect(feb.canClose).toBe(false);

    await call("post", "/books/close/overrides/remove", { periodId: febId, item: "PAYROLL" }, accountant);
    expect(statuses(await checklist(2)).PAYROLL).toBe("FAILING");
    await overrideFailing(2);
    expect((await checklist(2)).canClose).toBe(true);
  });

  it("closes February only after a second person approves the close request", async () => {
    const febId = await periodId(2);
    await call("put", "/setup/approvals", { closeApprovalRequired: true }, admin);
    expect((await request(app).post(`${base}/close`).set(admin).send({ periodId: febId, kind: "MONTH" })).body.error).toMatch(/needs approval/);
    expect((await request(app).post(`${base}/close/request`).set(manager).send({ periodId: febId, kind: "MONTH" })).status).toBe(403);
    expect((await request(app).post(`${base}/close/request`).set(accountant).send({ periodId: febId, kind: "YEAR" })).body.error).toMatch(/last period of the year/);

    const requested = await call("post", "/books/close/request", { periodId: febId, kind: "MONTH", note: "February pack ready" }, accountant, 201);
    expect(requested).toMatchObject({ status: "PENDING_APPROVAL", requestedByErpUserId: 951, approvalRequestId: expect.any(String) });
    expect((await request(app).post(`${base}/close/request`).set(admin).send({ periodId: febId, kind: "MONTH" })).body.error).toMatch(/waiting for approval/);
    expect((await request(app).post(`${base}/approvals`).set(accountant).send({ entityType: "PeriodClose", entityId: requested.id, amount: 0 })).status).toBe(400);
    expect((await checklist(2)).pendingRequest?.id).toBe(requested.id);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: febId } })).status).toBe("TEMPORARILY_LOCKED");

    const approvalId = requested.approvalRequestId;
    expect((await request(app).post(`${base}/approvals/${approvalId}/decide`).set(accountant).send({ status: "APPROVED" })).body.error).toMatch(/requester cannot approve/);
    expect((await request(app).post(`${base}/approvals/${approvalId}/decide`).set(manager).send({ status: "APPROVED" })).body.error).toMatch(/close:manage/);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: febId } })).status).toBe("TEMPORARILY_LOCKED");

    const decisions = await Promise.all([
      request(app).post(`${base}/approvals/${approvalId}/decide`).set(admin).send({ status: "APPROVED" }),
      request(app).post(`${base}/approvals/${approvalId}/decide`).set(secondAdmin).send({ status: "APPROVED" }),
    ]);
    expect(decisions.map((d) => d.status).sort()).toEqual([200, 400]);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: febId } })).status).toBe("CLOSED");
    expect(await prisma.periodClose.count({ where: { periodId: febId, status: "CLOSED" } })).toBe(1);
    expect(await prisma.approvalDecision.count({ where: { approvalRequestId: approvalId } })).toBe(1);

    const [row] = await history(2);
    const approver = decisions.find((d) => d.status === 200)!.body.data.decidedByErpUserId;
    expect(row).toMatchObject({ status: "CLOSED", requestedByErpUserId: 951, approvalStatus: "APPROVED", decidedByErpUserId: approver, closedByErpUserId: approver });
    expect(row.checklist.items.find((i) => i.key === "PAYROLL")).toMatchObject({ status: "OVERRIDDEN", override: { note: "Accepted for test: PAYROLL" } });
  });

  it("refuses to close on approval when the period changed after the request, and records the rejection", async () => {
    const marId = await periodId(3);
    expect((await request(app).post(`${base}/close/request`).set(accountant).send({ periodId: marId, kind: "MONTH" })).body.error).toMatch(/Bank reconciliations completed/);
    await overrideFailing(3);
    const requested = await call("post", "/books/close/request", { periodId: marId, kind: "MONTH" }, accountant, 201);
    const approvalId = requested.approvalRequestId;

    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: marId } })).status).toBe("TEMPORARILY_LOCKED");
    expect(
      (
        await request(app)
          .post("/api/v1/journals")
          .set(accountant)
          .send({
            journalDate: "2026-03-05",
            description: "Blocked while close waits",
            lines: [
              { accountId: await accountId("1100"), debit: 5, credit: 0 },
              { accountId: await accountId("4100"), debit: 0, credit: 5 },
            ],
          })
      ).body.error,
    ).toMatch(/temporarily locked/);

    await prisma.accountingPeriod.update({ where: { id: marId }, data: { status: "CLOSED" } });
    expect((await request(app).post(`${base}/approvals/${approvalId}/decide`).set(admin).send({ status: "APPROVED" })).body.error).toMatch(/already closed/);
    await prisma.accountingPeriod.update({ where: { id: marId }, data: { status: "TEMPORARILY_LOCKED" } });

    // Simulate a draft that slipped in before the lock (or via another path) so approval still re-checks blockers.
    await prisma.journal.create({
      data: {
        companyId,
        journalNumber: "J-LATE-CLOSE",
        journalDate: new Date("2026-03-05T00:00:00.000Z"),
        status: "DRAFT",
        currencyCode: "RWF",
        exchangeRate: 1,
        description: "Late draft",
        lines: {
          create: [
            { companyId, lineNumber: 1, accountId: await accountId("1100"), debit: 5, credit: 0 },
            { companyId, lineNumber: 2, accountId: await accountId("4100"), debit: 0, credit: 5 },
          ],
        },
      },
    });
    expect((await request(app).post(`${base}/approvals/${approvalId}/decide`).set(admin).send({ status: "APPROVED" })).body.error).toMatch(/cannot be closed now: 1 journal/);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("PENDING");
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: marId } })).status).toBe("TEMPORARILY_LOCKED");

    await call("post", `/books/approvals/${approvalId}/decide`, { status: "REJECTED", note: "Post the late journal first" }, admin);
    const [row] = await history(3);
    expect(row).toMatchObject({ status: "REJECTED", approvalStatus: "REJECTED", decidedByErpUserId: 441, decisionNote: "Post the late journal first" });
    expect((await checklist(3)).pendingRequest).toBeNull();
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: marId } })).status).toBe("OPEN");
  });

  it("records who reopened a period and why", async () => {
    const febId = await periodId(2);
    expect((await request(app).post(`${base}/close/reopen`).set(manager).send({ periodId: febId, reason: "Late bill" })).status).toBe(403);
    await call("post", "/books/close/reopen", { periodId: febId, reason: "Late supplier bill" }, admin);
    const [row] = await history(2);
    expect(row).toMatchObject({ status: "REOPENED", reopenReason: "Late supplier bill", reopenedByErpUserId: 441, reopenedAt: expect.any(String) });
    expect((await request(app).post(`${base}/close/reopen`).set(admin).send({ periodId: febId, reason: "Again" })).body.error).toMatch(/Only a closed period/);

    await call("put", "/setup/approvals", { closeApprovalRequired: false }, admin);
    const reopened = await checklist(2);
    expect(reopened.items.filter((i) => i.override)).toEqual([]);
    expect((await request(app).post(`${base}/close`).set(admin).send({ periodId: febId, kind: "MONTH" })).body.error).toMatch(/Payroll posted/);
    await overrideFailing(2);
    const reclosed = await call("post", "/books/close", { periodId: febId, kind: "MONTH" }, admin);
    expect(reclosed.status).toBe("CLOSED");
    expect((await history(2)).map((r) => r.status)).toEqual(["CLOSED", "REOPENED"]);
  });

  it("does not ask for a reconciliation of an account that only starts reconciling after the period", async () => {
    await call("post", "/banking/accounts", { kind: "BANK", name: "Later Bank", dateOpened: "2026-01-01", reconcileFrom: "2026-06-01" }, accountant, 201);
    const mar = (await checklist(3)).items.find((i) => i.key === "BANK_RECONCILIATION")!;
    expect(mar.detail).toMatch(/Close Bank/);
    expect(mar.detail).not.toMatch(/Later Bank/);
    expect((await checklist(6)).items.find((i) => i.key === "BANK_RECONCILIATION")!.detail).toMatch(/Later Bank/);
  });

  it("never leaves a period locked over a close that raced with the lock", async () => {
    const marId = await periodId(3);
    await prisma.journal.updateMany({ where: { companyId, status: "DRAFT" }, data: { status: "CANCELLED" } });
    expect((await checklist(3)).canClose, (await checklist(3)).blockers.join("; ")).toBe(true);
    const [closed] = await Promise.all([
      request(app).post(`${base}/close`).set(admin).send({ periodId: marId, kind: "MONTH" }),
      request(app).post(`${base}/periods/${marId}/lock`).set(admin).send({}),
    ]);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: marId } })).status).toBe("CLOSED");
    expect(await prisma.periodClose.count({ where: { periodId: marId, status: "CLOSED" } })).toBe(1);
  });

  it("refuses a direct close while a close request is pending, even after approval is switched off", async () => {
    const aprId = await periodId(4);
    await overrideFailing(4);
    await call("put", "/setup/approvals", { closeApprovalRequired: true }, admin);
    const requested = await call("post", "/books/close/request", { periodId: aprId, kind: "MONTH" }, accountant, 201);
    await call("put", "/setup/approvals", { closeApprovalRequired: false }, admin);
    expect((await request(app).post(`${base}/close`).set(admin).send({ periodId: aprId, kind: "MONTH" })).body.error).toMatch(/waiting for approval/);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: aprId } })).status).not.toBe("CLOSED");
    await call("post", `/books/approvals/${requested.approvalRequestId}/decide`, { status: "APPROVED" }, admin);
    expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: aprId } })).status).toBe("CLOSED");
  });
});

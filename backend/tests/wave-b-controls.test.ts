import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { dailyAlerts } from "../src/modules/books/scheduler";
import { notify } from "../src/modules/notifications/notification.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98501;
const books = "/api/v1/books";

const CONTROLS = {
  approvalLevels: 1,
  approvalWorkflowEnabled: true,
  requireDifferentPoster: true,
  backdatedTransactionPolicy: "REQUIRE_APPROVAL",
  futureDatedTransactionPolicy: "BLOCK",
  amountBasedApprovalLimits: [
    { minAmount: 0, levels: 1 },
    { minAmount: 1000, levels: 2, roles: ["ACCOUNTANT", "ADMIN"] },
  ],
};

let creator: Record<string, string>;
const accountant = authHeaders(orgId, "ACCOUNTANT", 702);
const adminTwo = authHeaders(orgId, "ADMIN", 443);
let companyId = "";
let cash = "";
let sales = "";

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

function lines(amount: number, extra: Record<string, unknown> = {}) {
  return [
    { accountId: cash, debit: amount, credit: 0 },
    { accountId: sales, debit: 0, credit: amount, ...extra },
  ];
}

function createJournal(body: Record<string, unknown>, headers = creator) {
  return request(app).post("/api/v1/journals").set(headers).send({ journalDate: "2026-01-12", ...body });
}

function decide(id: string, headers: Record<string, string>, status: string, note?: string) {
  return request(app).post(`${books}/approvals/${id}/decide`).set(headers).send({ status, note });
}

describe("Wave B controls", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    creator = await activateCompany(app, orgId, { name: "Wave B Co", tin: "123459001" }, CONTROLS);
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    cash = await accountId("1100");
    sales = await accountId("4100");
    expect((await request(app).post(`${books}/dimensions`).set(creator).send({ kind: "COST_CENTRE", code: "OPS", name: "Operations" })).status).toBe(201);
  });

  it("validates approval controls in setup", async () => {
    const badTier = await request(app).put("/api/v1/setup/approvals").set(creator).send({ amountBasedApprovalLimits: [{ minAmount: 0, levels: 9 }] });
    expect(badTier.status).toBe(400);
    expect(badTier.body.error).toMatch(/levels must be/);
    const tooManyRoles = await request(app).put("/api/v1/setup/approvals").set(creator).send({ amountBasedApprovalLimits: [{ minAmount: 0, levels: 1, roles: ["A", "B"] }] });
    expect(tooManyRoles.status).toBe(400);
    const badPolicy = await request(app).put("/api/v1/setup/approvals").set(creator).send({ backdatedTransactionPolicy: "MAYBE" });
    expect(badPolicy.status).toBe(400);
  });

  it("refuses to post a manual journal that needs approval, and blocks future-dated ones", async () => {
    const posted = await createJournal({ postImmediately: true, lines: lines(50) });
    expect(posted.status).toBe(400);
    expect(posted.body.error).toMatch(/needs approval before posting/);
    expect(await prisma.journal.count({ where: { companyId, status: "POSTED" } })).toBe(0);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const future = await createJournal({ journalDate: tomorrow, lines: lines(50) });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/Future-dated journals are not allowed|period/i);
  });

  it("runs a two-level, role-based approval and keeps the creator from approving or posting", async () => {
    const submitted = await createJournal({ submit: true, lines: lines(1500, { costCentre: "OPS" }) });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.status).toBe("SUBMITTED");
    const approval = submitted.body.data.approval;
    expect(approval.requiredLevels).toBe(2);
    expect(approval.levelRoles).toEqual(["ACCOUNTANT", "ADMIN"]);
    const journalId = submitted.body.data.id;

    expect((await request(app).post(`/api/v1/journals/${journalId}/post`).set(adminTwo)).body.error).toMatch(/waiting for approval/);
    expect((await decide(approval.id, creator, "APPROVED")).body.error).toMatch(/requester cannot approve/);
    expect((await decide(approval.id, adminTwo, "APPROVED")).body.error).toMatch(/Level 1 must be approved by a ACCOUNTANT/);

    const first = await decide(approval.id, accountant, "APPROVED");
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("PENDING");
    expect(first.body.data.approvedLevels).toBe(1);
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: journalId } })).status).toBe("UNDER_REVIEW");
    expect((await decide(approval.id, accountant, "APPROVED")).body.error).toMatch(/already approved an earlier level/);

    const second = await decide(approval.id, adminTwo, "APPROVED");
    expect(second.body.data.status).toBe("APPROVED");
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: journalId } })).status).toBe("APPROVED");
    expect(await prisma.approvalDecision.count({ where: { approvalRequestId: approval.id } })).toBe(2);

    const byCreator = await request(app).post(`/api/v1/journals/${journalId}/post`).set(creator);
    expect(byCreator.status).toBe(400);
    expect(byCreator.body.error).toMatch(/someone else must post it/);
    const byOther = await request(app).post(`/api/v1/journals/${journalId}/post`).set(adminTwo);
    expect(byOther.status).toBe(200);
    expect(byOther.body.data.status).toBe("POSTED");

    const gl = await prisma.glEntry.findFirstOrThrow({ where: { journalId, accountId: sales } });
    expect(gl.costCentre).toBe("OPS");
    const report = await request(app).get(`${books}/dimensions/report?kind=COST_CENTRE`).set(creator);
    expect(report.status).toBe(200);
    expect(report.body.data.find((r: { key: string }) => r.key === "OPS").income).toBe(1500);
    expect((await request(app).get(`${books}/dimensions/report?kind=COLOUR`).set(creator)).status).toBe(400);
  });

  it("returns a journal for correction, resubmits it, then rejects it", async () => {
    const submitted = await createJournal({ submit: true, lines: lines(60) });
    const approvalId = submitted.body.data.approval.id;
    const journalId = submitted.body.data.id;

    expect((await decide(approvalId, adminTwo, "RETURNED")).body.error).toMatch(/Say what needs correcting/);
    const returned = await decide(approvalId, adminTwo, "RETURNED", "Wrong amount");
    expect(returned.body.data.status).toBe("RETURNED");
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: journalId } })).status).toBe("DRAFT");

    const edited = await request(app).put(`/api/v1/journals/${journalId}`).set(creator).send({ journalDate: "2026-01-12", lines: lines(65) });
    expect(edited.status).toBe(200);
    const resubmitted = await request(app).post(`/api/v1/journals/${journalId}/submit`).set(creator);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.approval.id).toBe(approvalId);
    expect(resubmitted.body.data.approval.status).toBe("PENDING");
    expect(resubmitted.body.data.approval.resubmitCount).toBe(1);

    expect((await decide(approvalId, adminTwo, "REJECTED")).body.error).toMatch(/Give a reason/);
    const rejected = await decide(approvalId, adminTwo, "REJECTED", "Not a real sale");
    expect(rejected.body.data.status).toBe("REJECTED");
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: journalId } })).status).toBe("CANCELLED");
    expect((await decide(approvalId, accountant, "APPROVED")).body.error).toMatch(/already rejected/);
  });

  it("enforces supporting documents and the backdated BLOCK policy", async () => {
    await request(app).put("/api/v1/setup/approvals").set(creator).send({ supportingDocumentRequired: true });
    const draft = await createJournal({ lines: lines(70) });
    expect(draft.status).toBe(201);
    const bare = await request(app).post(`/api/v1/journals/${draft.body.data.id}/submit`).set(creator);
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/Attach a supporting document/);
    await request(app).post(`${books}/documents`).set(creator).send({ entityType: "Journal", entityId: draft.body.data.id, fileName: "receipt.pdf" });
    expect((await request(app).post(`/api/v1/journals/${draft.body.data.id}/submit`).set(creator)).status).toBe(200);
    await request(app).put("/api/v1/setup/approvals").set(creator).send({ supportingDocumentRequired: false });

    await request(app).put("/api/v1/setup/approvals").set(creator).send({ backdatedTransactionPolicy: "BLOCK" });
    const backdated = await createJournal({ lines: lines(10) });
    expect(backdated.status).toBe(400);
    expect(backdated.body.error).toMatch(/Backdated journals are not allowed/);
    await request(app).put("/api/v1/setup/approvals").set(creator).send({ backdatedTransactionPolicy: "REQUIRE_APPROVAL" });
  });

  it("rejects unknown or inactive dimensions", async () => {
    const unknown = await createJournal({ lines: lines(10, { costCentre: "NOPE" }) });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/not an active cost centre/);
    const project = await request(app).post(`${books}/dimensions`).set(creator).send({ kind: "PROJECT", code: "OLD", name: "Old project" });
    expect((await request(app).patch(`${books}/dimensions/${project.body.data.id}`).set(creator).send({ isActive: false })).status).toBe(200);
    const inactive = await createJournal({ project: "OLD", lines: lines(10) });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error).toMatch(/not an active project/);
  });

  it("numbers documents by the configured format and resets per period", async () => {
    const invalid = await request(app).put("/api/v1/setup/numbering/JOURNAL_ENTRY").set(creator).send({ resetFrequency: "MONTHLY", includeMonth: false });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/monthly reset needs the year and month/);
    const saved = await request(app).put("/api/v1/setup/numbering/JOURNAL_ENTRY").set(creator).send({ prefix: "GJ", includeMonth: true, resetFrequency: "MONTHLY", sequenceLength: 4 });
    expect(saved.status).toBe(200);

    const jan = await createJournal({ lines: lines(5) });
    expect(jan.body.data.journalNumber).toMatch(/^GJ-2026-01-\d{4}$/);
    const feb = await createJournal({ journalDate: "2026-02-03", lines: lines(5) });
    expect(feb.body.data.journalNumber).toBe("GJ-2026-02-0001");
    const list = await request(app).get("/api/v1/setup/numbering").set(creator);
    expect(list.body.data.find((s: { documentType: string }) => s.documentType === "JOURNAL_ENTRY").prefix).toBe("GJ");
  });

  it("keeps read state per user and addresses notifications by role", async () => {
    const forAccountants = await request(app).get(`${books}/notifications`).set(accountant);
    expect(forAccountants.body.data.some((n: { targetRole: string | null }) => n.targetRole === "ACCOUNTANT")).toBe(true);
    const forAdmin = await request(app).get(`${books}/notifications`).set(adminTwo);
    expect(forAdmin.body.data.some((n: { targetRole: string | null }) => n.targetRole === "ACCOUNTANT")).toBe(false);

    const shared = await notify({ companyId, title: "Everyone", body: "Shared notice" });
    expect((await request(app).post(`${books}/notifications/${shared.id}/read`).set(accountant)).status).toBe(200);
    const mine = (await request(app).get(`${books}/notifications`).set(accountant)).body.data.find((n: { id: string }) => n.id === shared.id);
    const theirs = (await request(app).get(`${books}/notifications`).set(adminTwo)).body.data.find((n: { id: string }) => n.id === shared.id);
    expect(mine.read).toBe(true);
    expect(theirs.read).toBe(false);

    const before = (await request(app).get(`${books}/notifications/unread-count`).set(adminTwo)).body.data.count;
    expect(before).toBeGreaterThan(0);
    await request(app).post(`${books}/notifications/read-all`).set(adminTwo);
    expect((await request(app).get(`${books}/notifications/unread-count`).set(adminTwo)).body.data.count).toBe(0);
    expect(await prisma.notificationRead.count({ where: { notificationId: shared.id } })).toBe(2);

    const first = await dailyAlerts(companyId, new Date("2026-01-30T08:00:00Z"));
    expect(first.periodsEnding).toBe(1);
    expect((await dailyAlerts(companyId, new Date("2026-01-30T08:00:00Z"))).periodsEnding).toBe(0);
  });

  it("filters and exports the audit trail, which cannot be changed", async () => {
    const filtered = await request(app).get("/api/v1/audit?entityType=Journal&action=submit").set(creator);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBeGreaterThan(0);
    expect(filtered.body.data.every((e: { action: string; entityType: string }) => e.action === "SUBMIT" && e.entityType === "Journal")).toBe(true);
    const byUser = await request(app).get("/api/v1/audit?userId=702&entityType=ApprovalRequest").set(creator);
    expect(byUser.body.data.every((e: { erpUserId: number }) => e.erpUserId === 702)).toBe(true);

    const csv = await request(app).get("/api/v1/audit/export.csv?entityType=Journal").set(creator);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toMatch(/attachment/);
    expect(csv.text.split("\n").length).toBeGreaterThan(1);

    const event = await prisma.auditEvent.findFirstOrThrow({ where: { companyId } });
    await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });

  it("locks the functional currency and valuation method after activation", async () => {
    const currency = await request(app).put("/api/v1/setup/currency").set(creator).send({ functionalCurrency: "USD" });
    expect(currency.status).toBe(400);
    expect(currency.body.error).toMatch(/cannot change after accounting is activated/);
    expect((await request(app).put("/api/v1/setup/currency").set(creator).send({ functionalCurrency: "RWF" })).status).toBe(200);
    const policy = await request(app).put("/api/v1/setup/policies").set(creator).send({ inventoryValuationMethod: "FIFO" });
    expect(policy.status).toBe(400);
    expect(policy.body.error).toMatch(/valuation method cannot change/);

    const badDefault = await request(app).put("/api/v1/setup/default-accounts").set(creator).send({ salesRevenueId: "not-an-account" });
    expect(badDefault.status).toBe(400);
    const unknownKey = await request(app).put("/api/v1/setup/default-accounts").set(creator).send({ favouriteAccountId: sales });
    expect(unknownKey.status).toBe(400);
  });

  it("approves and posts opening balances into the GL and the customer subledger", async () => {
    const customer = await prisma.customer.create({ data: { companyId, code: "C-OB", name: "Opening Customer" } });
    const saved = await request(app)
      .post("/api/v1/setup/opening-balances")
      .set(creator)
      .send({
        name: "Go-live balances",
        lines: [
          { partyType: "CUSTOMER", partyRef: "C-OB", debit: 300, credit: 0 },
          { accountId: await accountId("3100"), debit: 0, credit: 300 },
        ],
      });
    expect(saved.status).toBe(201);
    const id = saved.body.data.id;

    expect((await request(app).post(`/api/v1/setup/opening-balances/${id}/post`).set(adminTwo)).body.error).toMatch(/must be approved/);
    expect((await request(app).post(`/api/v1/setup/opening-balances/${id}/approve`).set(creator)).body.error).toMatch(/someone else must approve/);
    expect((await request(app).post(`/api/v1/setup/opening-balances/${id}/approve`).set(adminTwo)).body.data.status).toBe("APPROVED");

    const posted = await request(app).post(`/api/v1/setup/opening-balances/${id}/post`).set(adminTwo);
    expect(posted.status).toBe(200);
    expect(posted.body.data.batch.status).toBe("POSTED");
    expect(posted.body.data.journal.status).toBe("POSTED");
    expect(posted.body.data.journal.journalType).toBe("OPENING_BALANCE");
    expect(posted.body.data.journal.journalDate.slice(0, 10)).toBe("2026-01-01");
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).balance)).toBe(300);
    expect(await prisma.arLedgerEntry.count({ where: { customerId: customer.id, docType: "OPENING_BALANCE" } })).toBe(1);

    expect((await request(app).post(`/api/v1/setup/opening-balances/${id}/post`).set(adminTwo)).status).toBe(400);
    const listed = await request(app).get("/api/v1/setup/opening-balances").set(creator);
    expect(listed.body.data[0].journalId).toBe(posted.body.data.journal.id);
  });
});

import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { deliverDueEmails } from "../src/modules/notifications/email-outbox.service";
import { notify } from "../src/modules/notifications/notification.service";
import { checkWebhookUrl, deliverDueWebhooks, emitWebhook } from "../src/modules/platform/webhook.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98601;
const base = "/api/v1/books";

let admin: Record<string, string>;
let companyId = "";

async function account(code: string) {
  return prisma.account.findFirstOrThrow({ where: { companyId, code } });
}

async function postJournal(amount: number, extra: Record<string, unknown> = {}, lineExtra: Record<string, unknown> = {}) {
  const cash = await account("1100");
  const sales = await account("4100");
  return request(app)
    .post("/api/v1/journals")
    .set(admin)
    .send({
      journalDate: "2026-01-10",
      postImmediately: true,
      description: "Wave D test",
      lines: [
        { accountId: cash.id, debit: amount, credit: 0, ...lineExtra },
        { accountId: sales.id, debit: 0, credit: amount, ...lineExtra },
      ],
      ...extra,
    });
}

describe("Wave D platform", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    admin = await activateCompany(app, orgId, { name: "Platform Co", tin: "123460001" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  });

  afterAll(async () => {
    await prisma.webhookDelivery.deleteMany({ where: { companyId } });
  });

  it("reports the KPI pack with targets", async () => {
    expect((await postJournal(250_000)).status).toBe(201);
    const kpis = await request(app).get(`${base}/kpis?from=2026-01-01&to=2026-01-31`).set(admin);
    expect(kpis.status).toBe(200);
    const revenue = kpis.body.data.kpis.find((k: { code: string }) => k.code === "REVENUE");
    expect(revenue.value).toBe(250_000);
    expect(kpis.body.data.kpis.map((k: { code: string }) => k.code)).toEqual(expect.arrayContaining(["EBITDA", "QUICK_RATIO", "WORKING_CAPITAL", "DSO", "DPO", "INVENTORY_TURNOVER"]));

    expect((await request(app).put(`${base}/kpis/targets/REVENUE`).set(admin).send({ target: 200_000 })).status).toBe(200);
    const withTarget = await request(app).get(`${base}/kpis?from=2026-01-01&to=2026-01-31`).set(admin);
    const r = withTarget.body.data.kpis.find((k: { code: string }) => k.code === "REVENUE");
    expect(r.target).toBe(200_000);
    expect(r.met).toBe(true);
    expect((await request(app).put(`${base}/kpis/targets/NOPE`).set(admin).send({ target: 1 })).status).toBe(400);
    expect((await request(app).put(`${base}/kpis/targets/REVENUE`).set(admin).send({ target: null })).status).toBe(200);
  });

  it("forecasts three scenarios and compares a forecast with actuals", async () => {
    const made = await request(app)
      .post(`${base}/forecast`)
      .set(admin)
      .send({ name: "Next quarter", horizonMonths: 3, scenarios: { WORST: { revenue: 0.5, expenses: 1.2 } } });
    expect(made.status).toBe(201);
    const result = made.body.data.resultJson;
    expect(result.version).toBe(2);
    expect(Object.keys(result.forecast).sort()).toEqual(["BASE", "BEST", "WORST"]);
    expect(result.forecast.BASE).toHaveLength(3);
    expect(result.scenarios.WORST).toEqual({ revenue: 0.5, expenses: 1.2 });

    const list = await request(app).get(`${base}/forecasts`).set(admin);
    expect(list.body.data.some((f: { id: string }) => f.id === made.body.data.id)).toBe(true);
    const compared = await request(app).get(`${base}/forecasts/${made.body.data.id}/vs-actual?scenario=WORST`).set(admin);
    expect(compared.status).toBe(200);
    expect(compared.body.data.rows).toHaveLength(3);

    expect((await request(app).post(`${base}/forecast`).set(admin).send({ name: "Bad", horizonMonths: 3, scenarios: { BEST: { revenue: 9, expenses: 1 } } })).status).toBe(400);
  });

  it("flags a round manual journal once and works the case to a decision", async () => {
    const posted = await postJournal(1_000_000);
    expect(posted.status).toBe(201);
    const scan = await request(app).post(`${base}/anomalies/scan`).set(admin);
    expect(scan.status).toBe(200);
    const round = scan.body.data.find((f: { rule: string; entityId: string }) => f.rule === "ROUND_AMOUNT" && f.entityId === posted.body.data.id);
    expect(round).toBeTruthy();

    const again = await request(app).post(`${base}/anomalies/scan`).set(admin);
    expect(again.body.data.some((f: { id: string }) => f.id === round.id)).toBe(false);
    expect(await prisma.anomalyFlag.count({ where: { companyId, rule: "ROUND_AMOUNT", entityId: posted.body.data.id } })).toBe(1);

    const note = await request(app).post(`${base}/anomalies/${round.id}/notes`).set(admin).send({ note: "Asked the cashier for the deposit slip" });
    expect(note.status).toBe(201);
    const open = await request(app).get(`${base}/anomalies?status=INVESTIGATING`).set(admin);
    expect(open.body.data.find((f: { id: string }) => f.id === round.id).notes).toHaveLength(1);

    expect((await request(app).post(`${base}/anomalies/${round.id}/dismiss`).set(admin).send({})).status).toBe(400);
    const dismissed = await request(app).post(`${base}/anomalies/${round.id}/resolve`).set(admin).send({ status: "DISMISSED", reason: "Deposit slip matches" });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe("DISMISSED");
    expect(dismissed.body.data.resolution).toBe("Deposit slip matches");
    expect((await request(app).post(`${base}/anomalies/${round.id}/resolve`).set(admin).send({ status: "CONFIRMED", reason: "Changed my mind" })).status).toBe(400);
  });

  it("signs a record's content and detects later changes or tampering", async () => {
    const posted = await postJournal(12_345);
    const journalId = posted.body.data.id;
    const signed = await request(app).post(`${base}/signatures`).set(admin).send({ entityType: "Journal", entityId: journalId, statement: "Reviewed and approved" });
    expect(signed.status).toBe(201);
    expect(signed.body.data.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const ok = await request(app).get(`${base}/signatures/${signed.body.data.id}/verify`).set(admin);
    expect(ok.body.data.valid).toBe(true);

    await prisma.journal.update({ where: { id: journalId }, data: { description: "Changed after signing" } });
    const changed = await request(app).get(`${base}/signatures/${signed.body.data.id}/verify`).set(admin);
    expect(changed.body.data.valid).toBe(false);
    expect(changed.body.data.contentUnchanged).toBe(false);
    expect(changed.body.data.changedFields).toContain("description");

    await prisma.signatureRecord.update({ where: { id: signed.body.data.id }, data: { statement: "Something else" } });
    const tampered = await request(app).get(`${base}/signatures/${signed.body.data.id}/verify`).set(admin);
    expect(tampered.body.data.signatureIntact).toBe(false);

    const listed = await request(app).get(`${base}/signatures?entityType=Journal&entityId=${journalId}`).set(admin);
    expect(listed.body.data).toHaveLength(1);
    expect((await request(app).post(`${base}/signatures`).set(admin).send({ entityType: "Journal", entityId: "missing", statement: "Approve" })).status).toBe(400);
  });

  it("keeps a risk register linked to tested controls", async () => {
    const control = await request(app).post(`${base}/controls`).set(admin).send({ code: "BANK-REC", title: "Monthly bank reconciliation", category: "Cash" });
    const risk = await request(app)
      .post(`${base}/risks`)
      .set(admin)
      .send({ code: "r-1", title: "Cash misappropriation", category: "Fraud", likelihood: 4, impact: 5, controlIds: [control.body.data.id] });
    expect(risk.status).toBe(201);
    expect(risk.body.data.code).toBe("R-1");
    expect((await request(app).post(`${base}/risks`).set(admin).send({ code: "R-2", title: "Bad scores", category: "X", likelihood: 6, impact: 1 })).status).toBe(400);

    const risks = await request(app).get(`${base}/risks`).set(admin);
    const row = risks.body.data.find((r: { code: string }) => r.code === "R-1");
    expect(row.inherentScore).toBe(20);
    expect(row.inherentRating).toBe("CRITICAL");
    expect(row.controls[0].code).toBe("BANK-REC");

    const patched = await request(app).patch(`${base}/risks/${row.id}`).set(admin).send({ residualLikelihood: 2, residualImpact: 3, status: "MITIGATING" });
    expect(patched.status).toBe(200);
    expect((await request(app).patch(`${base}/risks/${row.id}`).set(admin).send({ residualLikelihood: 2, residualImpact: null })).status).toBe(400);

    const controlId = control.body.data.id;
    expect((await request(app).post(`${base}/controls/${controlId}/tests`).set(admin).send({ testedAt: "2026-02-01", result: "FAIL" })).status).toBe(400);
    const failed = await request(app).post(`${base}/controls/${controlId}/tests`).set(admin).send({ testedAt: "2026-02-01", result: "FAIL", notes: "January not reconciled", sampleSize: 1 });
    expect(failed.status).toBe(201);
    expect((await prisma.controlItem.findUniqueOrThrow({ where: { id: controlId } })).status).toBe("DEFICIENT");
    await request(app).post(`${base}/controls/${controlId}/tests`).set(admin).send({ testedAt: "2026-01-15", result: "PASS" });
    expect((await prisma.controlItem.findUniqueOrThrow({ where: { id: controlId } })).status).toBe("DEFICIENT");
    expect((await request(app).post(`${base}/controls/${controlId}/tests`).set(admin).send({ testedAt: "2099-01-01", result: "PASS" })).status).toBe(400);

    const controls = await request(app).get(`${base}/controls`).set(admin);
    const listed = controls.body.data.find((c: { id: string }) => c.id === controlId);
    expect(listed.testCount).toBe(2);
    expect(listed.riskCount).toBe(1);
    expect(listed.lastTest.result).toBe("FAIL");
    expect((await request(app).get(`${base}/controls/${controlId}/tests`).set(admin)).body.data).toHaveLength(2);
  });

  it("answers for the period asked about, with links to the report", async () => {
    const answer = await request(app).post(`${base}/assistant`).set(admin).send({ question: "What was revenue in January 2026?" });
    expect(answer.status).toBe(200);
    expect(answer.body.data.topic).toBe("REVENUE");
    expect(answer.body.data.period.from).toBe("2026-01-01");
    expect(answer.body.data.period.to).toBe("2026-01-31");
    expect(answer.body.data.answer).toContain("RWF");
    expect(answer.body.data.links.length).toBeGreaterThan(0);
  });

  it("rate-limits API keys and logs their use", async () => {
    const issued = await request(app).post(`${base}/api-keys`).set(admin).send({ name: "Limited", rateLimitPerMinute: 2 });
    expect(issued.body.data.rateLimitPerMinute).toBe(2);
    const key = { "x-api-key": issued.body.data.token };
    expect((await request(app).get(`${base}/trial-balance`).set(key)).status).toBe(200);
    expect((await request(app).get(`${base}/trial-balance`).set(key)).status).toBe(200);
    const limited = await request(app).get(`${base}/trial-balance`).set(key);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");

    await new Promise((r) => setTimeout(r, 100));
    const usage = await request(app).get(`${base}/api-keys/${issued.body.data.id}/usage`).set(admin);
    expect(usage.body.data.calls).toHaveLength(3);
    expect(usage.body.data.calls.map((c: { status: number }) => c.status).sort()).toEqual([200, 200, 429]);
    expect(usage.body.data.calls[0].path).toBe(`${base}/trial-balance`);

    expect((await request(app).patch(`${base}/api-keys/${issued.body.data.id}`).set(admin).send({ rateLimitPerMinute: 0 })).status).toBe(400);
    expect((await request(app).patch(`${base}/api-keys/${issued.body.data.id}`).set(admin).send({ rateLimitPerMinute: 10 })).status).toBe(200);
    expect((await request(app).get(`${base}/trial-balance`).set(key)).status).toBe(200);
    const keys = await request(app).get(`${base}/api-keys`).set(admin);
    expect(keys.body.data.find((k: { id: string }) => k.id === issued.body.data.id).requestsLast24h).toBe(4);
  });

  it("publishes an OpenAPI document for the API-key routes", async () => {
    const doc = await request(app).get("/api/v1/openapi.json");
    expect(doc.status).toBe(200);
    expect(doc.body.openapi).toBe("3.1.0");
    expect(doc.body.paths["/api/v1/books/trial-balance"]).toBeTruthy();
    expect(doc.body.paths["/api/v1/books/api-keys"]).toBeUndefined();
    expect(Object.keys(doc.body.webhooks)).toEqual(expect.arrayContaining(["posting.failed", "period.closed"]));
  });

  it("delivers signed webhooks and retries failures", async () => {
    expect(() => checkWebhookUrl("http://example.com/hook", true)).toThrow(/https/);
    expect(() => checkWebhookUrl("https://10.0.0.5/hook", true)).toThrow(/public/);
    expect(() => checkWebhookUrl("https://localhost/hook", true)).toThrow(/public/);
    expect(checkWebhookUrl("https://hooks.example.com/x", true)).toBe("https://hooks.example.com/x");

    const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    let answer = 200;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(answer).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    try {
      const created = await request(app).post(`${base}/webhooks`).set(admin).send({ url, events: ["period.closed"] });
      expect(created.status).toBe(201);
      const secret: string = created.body.data.secret;
      expect(secret).toMatch(/^whsec_/);
      expect((await request(app).get(`${base}/webhooks`).set(admin)).body.data.endpoints[0].secret).toBeUndefined();
      expect((await request(app).post(`${base}/webhooks`).set(admin).send({ url, events: ["nope"] })).status).toBe(400);

      expect(await emitWebhook(companyId, "posting.failed", { x: 1 })).toBe(0);
      expect(await emitWebhook(companyId, "period.closed", { periodId: "p1" })).toBe(1);
      await deliverDueWebhooks(new Date(Date.now() + 1000));
      expect(received).toHaveLength(1);
      const [{ headers, body }] = received;
      expect(headers["x-exceledge-event"]).toBe("period.closed");
      const [t, v1] = String(headers["x-exceledge-signature"]).split(",").map((p) => p.split("=")[1]);
      expect(v1).toBe(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
      expect(JSON.parse(body).data).toEqual({ periodId: "p1" });

      answer = 500;
      await emitWebhook(companyId, "period.closed", { periodId: "p2" });
      await deliverDueWebhooks(new Date(Date.now() + 1000));
      const deliveries = await request(app).get(`${base}/webhooks/${created.body.data.id}/deliveries`).set(admin);
      const failed = deliveries.body.data.find((d: { payload: { data: { periodId: string } } }) => d.payload.data.periodId === "p2");
      expect(failed.status).toBe("PENDING");
      expect(failed.attempts).toBe(1);
      expect(failed.responseStatus).toBe(500);

      answer = 200;
      const ping = await request(app).post(`${base}/webhooks/${created.body.data.id}/ping`).set(admin);
      expect(ping.body.data.status).toBe("DELIVERED");
      expect((await request(app).delete(`${base}/webhooks/${created.body.data.id}`).set(admin)).status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("queues notifications for email at the chosen severity and records the outcome", async () => {
    await notify({ companyId, title: "Before enabling", body: "x", severity: "CRITICAL" });
    expect(await prisma.notificationEmail.count({ where: { companyId } })).toBe(0);

    const saved = await request(app).put(`${base}/notifications/settings`).set(admin).send({ emailEnabled: true, emailMinSeverity: "WARNING" });
    expect(saved.status).toBe(200);
    expect(saved.body.data.emailEnabled).toBe(true);
    expect((await request(app).put(`${base}/notifications/settings`).set(authHeaders(orgId, "SELLER", 9)).send({ emailEnabled: false, emailMinSeverity: "INFO" })).status).toBe(403);

    await notify({ companyId, title: "Info only", body: "x", severity: "INFO" });
    const warning = await notify({ companyId, title: "Posting exception", body: "Sale 12 failed", severity: "WARNING", entityType: "IntegrationEvent", targetRole: "ACCOUNTANT" });
    const rows = await prisma.notificationEmail.findMany({ where: { companyId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].notificationId).toBe(warning.id);

    const sent: Array<{ organizationId: string; link: string; targetRole: string | null }> = [];
    await deliverDueEmails(new Date(Date.now() + 1000), async (req) => {
      sent.push(req);
      return { recipients: 2 };
    });
    expect(sent.find((s) => s.organizationId === String(orgId))).toMatchObject({ targetRole: "ACCOUNTANT" });
    expect(sent.find((s) => s.organizationId === String(orgId))!.link).toMatch(/\/exceptions$/);
    const done = await prisma.notificationEmail.findUniqueOrThrow({ where: { notificationId: warning.id } });
    expect(done.status).toBe("SENT");
    expect(done.recipientCount).toBe(2);

    const failing = await notify({ companyId, title: "Will fail", body: "x", severity: "CRITICAL" });
    await deliverDueEmails(new Date(Date.now() + 1000), async () => {
      throw new Error("ERP down");
    });
    const retry = await prisma.notificationEmail.findUniqueOrThrow({ where: { notificationId: failing.id } });
    expect(retry.status).toBe("PENDING");
    expect(retry.attempts).toBe(1);
    expect(retry.lastError).toBe("ERP down");
    expect(retry.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const settings = await request(app).get(`${base}/notifications/settings`).set(admin);
    expect(settings.body.data.outbox).toMatchObject({ sent: 1, pending: 1 });
  });

  it("creates the daily anomaly scan job when automation is listed", async () => {
    await prisma.automationJob.deleteMany({ where: { companyId, jobType: "ANOMALY_SCAN" } });
    const list = await request(app).get(`${base}/automation`).set(admin);
    expect(list.status).toBe(200);
    expect(list.body.data.some((j: { jobType: string; schedule: string }) => j.jobType === "ANOMALY_SCAN" && j.schedule === "0 2 * * *")).toBe(true);
  });

  it("manages branches and refuses inactive ones on new journals", async () => {
    const created = await request(app).post("/api/v1/setup/branches").set(admin).send({ externalErpBranchId: "77", name: "Kigali HQ", code: "KGL" });
    expect(created.status).toBe(201);
    expect((await request(app).post("/api/v1/setup/branches").set(admin).send({ externalErpBranchId: "77", name: "Again" })).status).toBe(400);

    expect((await postJournal(500, {}, { branchId: created.body.data.id })).status).toBe(201);
    const listed = await request(app).get("/api/v1/setup/branches").set(admin);
    expect(listed.body.data.find((b: { id: string }) => b.id === created.body.data.id).postings).toBe(2);

    const off = await request(app).patch(`/api/v1/setup/branches/${created.body.data.id}`).set(admin).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    const refused = await postJournal(500, {}, { branchId: created.body.data.id });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/inactive/);
  });
});

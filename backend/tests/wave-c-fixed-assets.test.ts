import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98821;
const otherOrgId = 98822;
const base = "/api/v1/fixed-assets";

let admin: Record<string, string>;
let other: Record<string, string>;
const accountant = authHeaders(orgId, "ACCOUNTANT", 801);
let companyId = "";
const ids: Record<string, string> = {};

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function call(method: "post" | "put", path: string, body: unknown, headers = accountant, status = 200) {
  const res = await request(app)[method](`/api/v1${path}`).set(headers).send(body);
  if (res.status !== status) throw new Error(`${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function get(path: string, headers = accountant) {
  const res = await request(app).get(`/api/v1${path}`).set(headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

type Item = { assetId: string; amount: number; months: number; units: number };
const item = (run: { items: Item[] }, assetId: string) => run.items.find((i) => i.assetId === assetId);

async function journalLines(journalId: string) {
  const lines = await prisma.journalLine.findMany({ where: { journalId }, orderBy: { lineNumber: "asc" } });
  return lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) }));
}

function pdf(path: string, headers: Record<string, string>) {
  return request(app)
    .get(path)
    .set(headers)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
}

describe("Wave C fixed assets and tax", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    admin = await activateCompany(app, orgId, { name: "WaveC Assets Co", tin: "988210001" });
    other = await activateCompany(app, otherOrgId, { name: "WaveC Assets Other", tin: "988220002" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    const categories: Array<{ id: string; code: string }> = await get("/fixed-assets/categories");
    const cat = (code: string) => categories.find((c) => c.code === code)!.id;
    const bank = await accountId("1110");
    const register = (body: Record<string, unknown>) =>
      call("post", "/fixed-assets/assets", { purchaseDate: "2026-01-05", capitalize: true, creditAccountId: bank, capitalizationDate: "2026-01-05", ...body }, accountant, 201);

    ids.syd = (await register({ name: "CNC lathe", categoryId: cat("MACHINERY"), acquisitionCost: 1_560_000, residualValue: 60_000, usefulLifeMonths: 60, depreciationMethod: "SUM_OF_YEARS_DIGITS" })).id;
    ids.uop = (
      await register({ name: "Printing press", categoryId: cat("MACHINERY"), acquisitionCost: 10_000_000, residualValue: 1_000_000, depreciationMethod: "UNITS_OF_PRODUCTION", totalUnits: 100_000 })
    ).id;
    ids.quarterly = (
      await register({ name: "Boardroom AV", categoryId: cat("OFFICE"), acquisitionCost: 1_200_000, residualValue: 0, usefulLifeMonths: 60, depreciationFrequency: "QUARTERLY", capitalizationDate: "2026-01-10" })
    ).id;
    ids.revalued = (await register({ name: "Office block fit-out", categoryId: cat("OFFICE"), acquisitionCost: 1_200_000, residualValue: 0, usefulLifeMonths: 60 })).id;
  });

  it("rejects units-of-production assets without total units and usage from the wrong roles or assets", async () => {
    const categories: Array<{ id: string; code: string }> = await get("/fixed-assets/categories");
    const res = await request(app)
      .post(`${base}/assets`)
      .set(accountant)
      .send({ name: "Unmetered press", categoryId: categories.find((c) => c.code === "MACHINERY")!.id, acquisitionCost: 500_000, depreciationMethod: "UNITS_OF_PRODUCTION" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/total units/);

    const manager = await request(app).put(`${base}/assets/${ids.uop}/usage`).set(authHeaders(orgId, "BRANCH_MANAGER", 802)).send({ period: "2026-01", units: 10 });
    expect(manager.status).toBe(403);
    const wrongAsset = await request(app).put(`${base}/assets/${ids.syd}/usage`).set(accountant).send({ period: "2026-01", units: 10 });
    expect(wrongAsset.status).toBe(400);
    expect(wrongAsset.body.error).toMatch(/only recorded for units-of-production/);
    const otherCompany = await request(app).put(`${base}/assets/${ids.uop}/usage`).set(other).send({ period: "2026-01", units: 10 });
    expect(otherCompany.status).toBe(400);
    expect(otherCompany.body.error).toMatch(/does not exist/);
    const negative = await request(app).put(`${base}/assets/${ids.uop}/usage`).set(accountant).send({ period: "2026-01", units: -5 });
    expect(negative.status).toBe(400);
  });

  it("posts sum-of-years in January and leaves the quarterly and unmetered assets alone", async () => {
    const preview = await get("/fixed-assets/depreciation/preview?period=2026-01");
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetId: ids.uop, reason: expect.stringMatching(/No units used/) }),
        expect.objectContaining({ assetId: ids.quarterly, reason: expect.stringMatching(/quarter/) }),
      ]),
    );
    const run = await call("post", "/fixed-assets/depreciation/run", { period: "2026-01" }, accountant, 201);
    expect(item(run, ids.syd)).toMatchObject({ amount: 41_666.6667, months: 1 });
    expect(item(run, ids.revalued)).toMatchObject({ amount: 20_000 });
    expect(item(run, ids.uop)).toBeUndefined();
    expect(item(run, ids.quarterly)).toBeUndefined();
    expect(await prisma.fixedAssetDepreciation.count({ where: { assetId: { in: [ids.uop, ids.quarterly] } } })).toBe(0);
  });

  it("charges units of production on recorded usage and locks usage once depreciated", async () => {
    await call("put", `/fixed-assets/assets/${ids.uop}/usage`, { period: "2026-01", units: 1_000 });
    const asset = await call("put", `/fixed-assets/assets/${ids.uop}/usage`, { period: "2026-02", units: 1_500, notes: "Meter 1,500" });
    expect(asset.usages.map((u: { period: string; units: number }) => [u.period, u.units])).toEqual([
      ["2026-02", 1_500],
      ["2026-01", 1_000],
    ]);

    const run = await call("post", "/fixed-assets/depreciation/run", { period: "2026-02" }, accountant, 201);
    expect(item(run, ids.uop)).toMatchObject({ amount: 225_000, units: 2_500 });
    expect(item(run, ids.syd)).toMatchObject({ amount: 41_666.6667 });
    expect(run.totalAmount).toBe(286_666.6667);
    const lines = await journalLines(run.journalId);
    const expense = await accountId("6300");
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBeCloseTo(286_666.6667, 4);
    expect(lines.find((l) => l.accountId === expense)?.debit).toBeCloseTo(286_666.6667, 4);

    const locked = await request(app).put(`${base}/assets/${ids.uop}/usage`).set(accountant).send({ period: "2026-02", units: 9_000 });
    expect(locked.status).toBe(400);
    expect(locked.body.error).toMatch(/already posted through 2026-02/);
    const after = await get(`/fixed-assets/assets/${ids.uop}`);
    expect(after).toMatchObject({ accumulatedDepreciation: 225_000, unitsDepreciated: 2_500, netBookValue: 9_775_000 });
    expect(after.usages.every((u: { locked: boolean }) => u.locked)).toBe(true);
  });

  it("posts a quarterly asset only at quarter end, catching up three months once", async () => {
    const run = await call("post", "/fixed-assets/depreciation/run", { period: "2026-03" }, accountant, 201);
    expect(item(run, ids.quarterly)).toMatchObject({ amount: 60_000, months: 3 });
    expect(item(run, ids.uop)).toBeUndefined();
    const rows = await prisma.fixedAssetDepreciation.findMany({ where: { assetId: ids.quarterly } });
    expect(rows.map((r) => [r.period, Number(r.amount)])).toEqual([["2026-03", 60_000]]);
    expect(await get(`/fixed-assets/assets/${ids.quarterly}`)).toMatchObject({ accumulatedDepreciation: 60_000, depreciatedMonths: 3, lastDepreciationPeriod: "2026-03" });

    const again = await request(app).post(`${base}/depreciation/run`).set(accountant).send({ period: "2026-03" });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already posted/);
  });

  it("posts a period once when two runs race", async () => {
    const [a, b] = await Promise.all([
      request(app).post(`${base}/depreciation/run`).set(accountant).send({ period: "2026-04" }),
      request(app).post(`${base}/depreciation/run`).set(admin).send({ period: "2026-04" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await prisma.fixedAssetDepreciationRun.count({ where: { companyId, period: "2026-04" } })).toBe(1);
    expect(await prisma.fixedAssetDepreciation.count({ where: { assetId: ids.syd, period: "2026-04" } })).toBe(1);
    expect(await prisma.journal.count({ where: { companyId, sourceDocumentType: "FA_DEPRECIATION_RUN", sourceDocumentNumber: "2026-04" } })).toBe(1);
    expect(await prisma.fixedAssetDepreciation.count({ where: { assetId: ids.quarterly, period: "2026-04" } })).toBe(0);
  });

  it("splits revaluations between the surplus and profit or loss and restarts depreciation from the revalued amount", async () => {
    const reserve = await accountId("3300");
    const asset = await get(`/fixed-assets/assets/${ids.revalued}`);
    expect(asset).toMatchObject({ netBookValue: 1_120_000, depreciatedMonths: 4 });

    const down = await call("post", `/fixed-assets/assets/${ids.revalued}/revalue`, { effectiveDate: "2026-04-28", fairValue: 1_020_000 });
    expect(down.revaluations[0]).toMatchObject({ increase: false, amount: 100_000, reserveAmount: 0, plAmount: 100_000 });
    expect(down).toMatchObject({
      revaluationSurplus: 0,
      revaluationLossInPl: 100_000,
      netBookValue: 1_020_000,
      acquisitionCost: 1_020_000,
      accumulatedDepreciation: 0,
    });
    const lossAccount = await accountId("7130");
    const accum = await accountId("1510");
    expect((await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } })).revaluationLossId).toBe(lossAccount);
    const downLines = await journalLines(down.revaluations[0].journalId);
    expect(downLines).toEqual(
      expect.arrayContaining([
        { accountId: accum, debit: 80_000, credit: 0 },
        { accountId: down.assetAccountId, debit: 0, credit: 80_000 },
        { accountId: lossAccount, debit: 100_000, credit: 0 },
        { accountId: down.assetAccountId, debit: 0, credit: 100_000 },
      ]),
    );

    const up = await call("post", `/fixed-assets/assets/${ids.revalued}/revalue`, { effectiveDate: "2026-04-29", fairValue: 1_270_000 });
    expect(up.revaluations[0]).toMatchObject({ increase: true, amount: 250_000, reserveAmount: 150_000, plAmount: 100_000 });
    expect(up).toMatchObject({ revaluationSurplus: 150_000, revaluationLossInPl: 0, acquisitionCost: 1_270_000, accumulatedDepreciation: 0 });
    const upLines = await journalLines(up.revaluations[0].journalId);
    expect(upLines.find((l) => l.accountId === lossAccount)).toMatchObject({ debit: 0, credit: 100_000 });
    expect(upLines.find((l) => l.accountId === reserve)).toMatchObject({ debit: 0, credit: 150_000 });

    const split = await call("post", `/fixed-assets/assets/${ids.revalued}/revalue`, { effectiveDate: "2026-04-30", fairValue: 1_070_000 });
    expect(split.revaluations[0]).toMatchObject({ increase: false, amount: 200_000, reserveAmount: 150_000, plAmount: 50_000 });
    expect(split).toMatchObject({ revaluationSurplus: 0, revaluationLossInPl: 50_000, netBookValue: 1_070_000, acquisitionCost: 1_070_000, accumulatedDepreciation: 0 });
    const splitLines = await journalLines(split.revaluations[0].journalId);
    expect(splitLines).toEqual(
      expect.arrayContaining([
        { accountId: reserve, debit: 150_000, credit: 0 },
        { accountId: lossAccount, debit: 50_000, credit: 0 },
        { accountId: split.assetAccountId, debit: 0, credit: 200_000 },
      ]),
    );

    const may = await call("post", "/fixed-assets/depreciation/run", { period: "2026-05" }, accountant, 201);
    expect(item(may, ids.revalued)).toMatchObject({ amount: 19_107.1429 });
    expect(item(may, ids.syd)).toMatchObject({ amount: 41_666.6667 });
  });

  it("still holds an impairment for approval and posts it on approval", async () => {
    const setup = await request(app).put("/api/v1/setup/approvals").set(admin).send({ approvalWorkflowEnabled: true, approvalRequiredFor: ["FixedAssetImpairment"] });
    expect(setup.status).toBe(200);
    try {
      const held = await call("post", `/fixed-assets/assets/${ids.quarterly}/impair`, { impairmentDate: "2026-05-10", recoverableAmount: 1_000_000, reason: "Obsolete" });
      expect(held.approval).toMatchObject({ status: "PENDING", entityType: "FixedAssetImpairment" });
      expect(held.impairments[0]).toMatchObject({ status: "PENDING_APPROVAL", lossAmount: 140_000 });
      expect(held.accumulatedDepreciation).toBe(60_000);
      const decided = await request(app).post(`/api/v1/books/approvals/${held.approval.id}/decide`).set(admin).send({ status: "APPROVED" });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      const after = await get(`/fixed-assets/assets/${ids.quarterly}`);
      expect(after.impairments[0]).toMatchObject({ status: "POSTED", journalId: expect.any(String) });
      expect(after.accumulatedDepreciation).toBe(200_000);
    } finally {
      await request(app).put("/api/v1/setup/approvals").set(admin).send({ approvalWorkflowEnabled: false, approvalRequiredFor: [] });
    }
  });

  it("issues a WHT certificate PDF for a supplier payment with tax withheld", async () => {
    const supplier = await call("post", "/ap/suppliers", { name: "Kigali Consultants", tin: "123456789", whtRate: 15, whtCategory: "Professional services" }, admin, 201);
    const bill = await call("post", "/ap/bills", { supplierId: supplier.id, supplierInvoiceNumber: "KC-1", billDate: "2026-02-10", net: 1_000 }, admin, 201);
    const payment = await call(
      "post",
      "/ap/payments",
      { supplierId: supplier.id, paymentDate: "2026-02-20", amount: 850, withholdingTax: 150, allocations: [{ billId: bill.id, amount: 1_000 }] },
      admin,
      201,
    );
    const plain = await call("post", "/ap/payments", { supplierId: supplier.id, paymentDate: "2026-02-21", amount: 100 }, admin, 201);

    const res = await pdf(`/api/v1/tax/wht/certificates/${payment.id}.pdf`, admin);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain(`wht-certificate-${payment.paymentNumber}.pdf`);
    const text = (res.body as Buffer).toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    for (const expected of ["Withholding tax certificate", "WaveC Assets Co", "988210001", "Kigali Consultants", "123456789", "1,000.00", "15%", "150.00", "850.00", "2026-02-01 to 2026-02-28"]) {
      expect(text).toContain(expected);
    }

    expect((await pdf(`/api/v1/tax/wht/certificates/${payment.id}.pdf`, other)).status).toBe(404);
    expect((await pdf(`/api/v1/tax/wht/certificates/missing-payment.pdf`, admin)).status).toBe(404);
    expect((await pdf(`/api/v1/tax/wht/certificates/${payment.id}.pdf`, authHeaders(orgId, "SELLER", 803))).status).toBe(403);
    expect((await pdf(`/api/v1/tax/wht/certificates/${payment.id}.pdf`, authHeaders(orgId, "BRANCH_MANAGER", 802))).status).toBe(200);
    const none = await request(app).get(`/api/v1/tax/wht/certificates/${plain.id}.pdf`).set(admin);
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/no withholding tax/);
  });

  it("does not depreciate a monthly asset for a period before the month it was capitalized", async () => {
    const categories: Array<{ id: string; code: string }> = await get("/fixed-assets/categories");
    const office = categories.find((c) => c.code === "OFFICE")!.id;
    const bank = await accountId("1110");
    const register = (name: string, capitalizationDate: string) =>
      call(
        "post",
        "/fixed-assets/assets",
        { name, categoryId: office, acquisitionCost: 600_000, residualValue: 0, usefulLifeMonths: 60, purchaseDate: capitalizationDate, capitalize: true, creditAccountId: bank, capitalizationDate },
        accountant,
        201,
      );
    ids.rack = (await register("Warehouse racking", "2026-06-02")).id;
    ids.late = (await register("Forklift", "2026-07-15")).id;

    const june = await call("post", "/fixed-assets/depreciation/run", { period: "2026-06" }, accountant, 201);
    expect(item(june, ids.rack)).toMatchObject({ amount: 10_000, months: 1 });
    expect(item(june, ids.late)).toBeUndefined();
    expect(await prisma.fixedAssetDepreciation.count({ where: { assetId: ids.late } })).toBe(0);

    const july = await call("post", "/fixed-assets/depreciation/run", { period: "2026-07" }, accountant, 201);
    expect(item(july, ids.late)).toMatchObject({ amount: 10_000, months: 1 });
    expect(await get(`/fixed-assets/assets/${ids.late}`)).toMatchObject({ depreciatedMonths: 1, netBookValue: 590_000 });
  });

  it("charges an impairment of a revalued asset against its surplus first and restarts depreciation", async () => {
    const reserve = await accountId("3300");
    const loss = await accountId("8100");
    const up = await call("post", `/fixed-assets/assets/${ids.rack}/revalue`, { effectiveDate: "2026-07-31", fairValue: 680_000 });
    expect(up).toMatchObject({ revaluationSurplus: 100_000, netBookValue: 680_000 });

    const impaired = await call("post", `/fixed-assets/assets/${ids.rack}/impair`, { impairmentDate: "2026-07-31", recoverableAmount: 530_000, reason: "Damaged" });
    expect(impaired).toMatchObject({ revaluationSurplus: 0, revaluationLossInPl: 50_000, netBookValue: 530_000 });
    const lines = await journalLines(impaired.impairments[0].journalId);
    expect(lines).toEqual([
      { accountId: reserve, debit: 100_000, credit: 0 },
      { accountId: loss, debit: 50_000, credit: 0 },
      { accountId: impaired.accumDepAccountId, debit: 0, credit: 150_000 },
    ]);
  });

  it("moves the remaining revaluation surplus to retained earnings on disposal", async () => {
    const reserve = await accountId("3300");
    const retained = await accountId("3100");
    const up = await call("post", `/fixed-assets/assets/${ids.late}/revalue`, { effectiveDate: "2026-07-31", fairValue: 640_000 });
    expect(up.revaluationSurplus).toBe(50_000);
    const bank = await accountId("1110");
    const disposed = await call("post", `/fixed-assets/assets/${ids.late}/dispose`, {
      disposalDate: "2026-07-31",
      disposalMethod: "SALE",
      proceeds: 700_000,
      proceedsAccountId: bank,
    });
    expect(disposed).toMatchObject({ status: "DISPOSED", revaluationSurplus: 0 });
    const lines = await journalLines(disposed.disposalJournalId);
    expect(lines).toEqual(
      expect.arrayContaining([
        { accountId: reserve, debit: 50_000, credit: 0 },
        { accountId: retained, debit: 0, credit: 50_000 },
        { accountId: await accountId("7300"), debit: 0, credit: 60_000 },
      ]),
    );
    const again = await request(app).post(`${base}/assets/${ids.late}/dispose`).set(accountant).send({ disposalDate: "2026-07-31", disposalMethod: "SCRAP" });
    expect(again.status).toBe(400);

    const august = await call("post", "/fixed-assets/depreciation/run", { period: "2026-08" }, accountant, 201);
    expect(item(august, ids.rack)).toMatchObject({ amount: 9_137.931 });
    expect(item(august, ids.late)).toBeUndefined();
  });
});

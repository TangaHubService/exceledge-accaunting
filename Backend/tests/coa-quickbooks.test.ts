import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { activateCompany, resetCompany } from "./helpers";

const app = createApp();
const orgId = 93101;
let headers: Record<string, string>;

async function create(body: Record<string, unknown>) {
  return request(app).post("/api/v1/coa").set(headers).send(body);
}

describe("Chart of accounts — QuickBooks parity", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    headers = await activateCompany(app, orgId, { name: "COA Parity Co", tin: "931010101" });
  });

  it("making a parent inactive makes its subaccounts inactive; a child cannot be reactivated alone", async () => {
    const parent = await create({ code: "6910", name: "Vehicle costs", type: "EXPENSE" });
    const child = await create({ code: "6911", name: "Fuel", type: "EXPENSE", parentId: parent.body.data.id });
    const grandchild = await create({ code: "6912", name: "Diesel", type: "EXPENSE", parentId: child.body.data.id });
    expect(grandchild.status).toBe(201);

    const off = await request(app).post(`/api/v1/coa/${parent.body.data.id}/deactivate`).set(headers);
    expect(off.status).toBe(200);
    const rows = await prisma.account.findMany({ where: { id: { in: [child.body.data.id, grandchild.body.data.id] } } });
    expect(rows.every((r) => !r.isActive)).toBe(true);

    const childOn = await request(app).post(`/api/v1/coa/${child.body.data.id}/reactivate`).set(headers);
    expect(childOn.status).toBe(400);
    expect(childOn.body.error).toMatch(/parent/i);

    const batch = await request(app)
      .post("/api/v1/coa/batch/reactivate")
      .set(headers)
      .send({ ids: [grandchild.body.data.id, child.body.data.id, parent.body.data.id] });
    expect(batch.status).toBe(200);
    expect(batch.body.data.updated).toBe(3);
  });

  it("blocks moving an account under its own subaccount and changing type while it has subaccounts", async () => {
    const a = await create({ code: "6920", name: "Marketing", type: "EXPENSE" });
    const b = await create({ code: "6921", name: "Online ads", type: "EXPENSE", parentId: a.body.data.id });
    const loop = await request(app).patch(`/api/v1/coa/${a.body.data.id}`).set(headers).send({ parentId: b.body.data.id });
    expect(loop.status).toBe(400);
    expect(loop.body.error).toMatch(/own subaccounts/);

    const retype = await request(app).patch(`/api/v1/coa/${a.body.data.id}`).set(headers).send({ type: "OTHER_EXPENSE", code: "8920" });
    expect(retype.status).toBe(400);
  });

  it("batch deactivate reports protected system accounts per row", async () => {
    const cash = await prisma.account.findFirstOrThrow({ where: { company: { externalErpOrganizationId: String(orgId) }, code: "1100" } });
    const spare = await create({ code: "6930", name: "Spare", type: "EXPENSE" });
    const res = await request(app)
      .post("/api/v1/coa/batch/deactivate")
      .set(headers)
      .send({ ids: [cash.id, spare.body.data.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.results.find((r: { id: string }) => r.id === cash.id).ok).toBe(false);
  });

  it("imports subaccounts nested several levels deep in any row order", async () => {
    const res = await request(app)
      .post("/api/v1/coa/import")
      .set(headers)
      .send({
        rows: [
          { code: "6942", name: "Level three", type: "EXPENSE", parentCode: "6941" },
          { code: "6941", name: "Level two", type: "EXPENSE", parentCode: "6940" },
          { code: "6940", name: "Level one", type: "EXPENSE" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.errors).toEqual([]);
    expect(res.body.data.createdCount).toBe(3);
  });

  it("posts an opening balance against Opening Balance Equity", async () => {
    const res = await create({
      code: "1185",
      name: "Savings account",
      type: "ASSET",
      openingBalance: 250000,
      openingBalanceDate: "2026-01-01",
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.currentBalance)).toBe(250000);
    const obe = await prisma.account.findFirstOrThrow({ where: { companyId: res.body.data.companyId, code: "3020" } });
    expect(Number(obe.currentBalance)).toBe(-250000);

    const loan = await create({ code: "2485", name: "Bank loan", type: "LIABILITY", openingBalance: 100000, openingBalanceDate: "2026-01-01" });
    expect(loan.status).toBe(201);
    expect(Number(loan.body.data.currentBalance)).toBe(-100000); // credit balance, stored debit-positive

    const pl = await create({ code: "6950", name: "Not allowed", type: "EXPENSE", openingBalance: 10, openingBalanceDate: "2026-01-01" });
    expect(pl.status).toBe(400);
    // the failed create must not leave the account behind
    expect(await prisma.account.count({ where: { companyId: res.body.data.companyId, code: "6950" } })).toBe(0);
  });

  it("treats account numbers as optional and free-form, with a company setting", async () => {
    const free = await create({ code: "2105", name: "Numbered anywhere", type: "EXPENSE" });
    expect(free.status).toBe(201);
    const auto = await create({ name: "No number given", type: "EXPENSE" });
    expect(auto.status).toBe(201);
    expect(auto.body.data.code).toMatch(/^6\d{3}$/);

    expect((await request(app).get("/api/v1/coa/settings").set(headers)).body.data.useAccountNumbers).toBe(true);
    const off = await request(app).put("/api/v1/coa/settings").set(headers).send({ useAccountNumbers: false });
    expect(off.body.data.useAccountNumbers).toBe(false);
    await request(app).put("/api/v1/coa/settings").set(headers).send({ useAccountNumbers: true });

    // renumbering is allowed even after postings (system accounts stay fixed)
    const used = await create({ code: "1186", name: "Renumber me", type: "ASSET", openingBalance: 10, openingBalanceDate: "2026-01-01" });
    const renum = await request(app).patch(`/api/v1/coa/${used.body.data.id}`).set(headers).send({ code: "B-100" });
    expect(renum.status).toBe(200);
    expect(renum.body.data.code).toBe("B-100");
  });

  it("keeps names unique among accounts sharing a parent, like QuickBooks", async () => {
    const a = await create({ code: "6960", name: "Fuel", type: "EXPENSE" });
    expect(a.status).toBe(201);
    const sameTop = await create({ code: "4960", name: "fuel", type: "INCOME" });
    expect(sameTop.status).toBe(400);
    const p1 = await create({ code: "6961", name: "Vehicle A", type: "EXPENSE" });
    const p2 = await create({ code: "6962", name: "Vehicle B", type: "EXPENSE" });
    expect((await create({ code: "6963", name: "Fuel", type: "EXPENSE", parentId: p1.body.data.id })).status).toBe(201);
    expect((await create({ code: "6964", name: "Fuel", type: "EXPENSE", parentId: p2.body.data.id })).status).toBe(201);
    expect((await create({ code: "6965", name: "FUEL", type: "EXPENSE", parentId: p2.body.data.id })).status).toBe(400);
  });

  it("allows a type change after postings only within the same statement", async () => {
    const acc = await create({ code: "1187", name: "Deposit held", type: "ASSET", openingBalance: 500, openingBalanceDate: "2026-01-01" });
    expect(acc.status).toBe(201);
    const toLiability = await request(app).patch(`/api/v1/coa/${acc.body.data.id}`).set(headers).send({ type: "LIABILITY" });
    expect(toLiability.status).toBe(200);
    const toExpense = await request(app).patch(`/api/v1/coa/${acc.body.data.id}`).set(headers).send({ type: "EXPENSE" });
    expect(toExpense.status).toBe(400);
    expect(toExpense.body.error).toMatch(/same statement|balance sheet type/);
  });

  it("merges an account into a sibling of the same type and moves its history", async () => {
    const rg = "Cash and cash equivalents|||Bank";
    const keep = await create({ code: "1188", name: "Main bank", type: "ASSET", reportingGroup: rg, openingBalance: 100, openingBalanceDate: "2026-01-01" });
    const fold = await create({ code: "1189", name: "Main bank old", type: "ASSET", reportingGroup: rg, openingBalance: 50, openingBalanceDate: "2026-01-01" });
    const sub = await create({ code: "1190", name: "Sub of old", type: "ASSET", reportingGroup: rg, parentId: fold.body.data.id });
    expect(sub.status).toBe(201);
    const companyId = keep.body.data.companyId;
    const foldEntries = await prisma.glEntry.count({ where: { companyId, accountId: fold.body.data.id } });
    const keepEntries = await prisma.glEntry.count({ where: { companyId, accountId: keep.body.data.id } });

    const merged = await request(app).post(`/api/v1/coa/${fold.body.data.id}/merge`).set(headers).send({ targetId: keep.body.data.id });
    expect(merged.status).toBe(200);
    expect(Number(merged.body.data.kept.currentBalance)).toBe(150);
    expect(await prisma.account.count({ where: { id: fold.body.data.id } })).toBe(0);
    expect(await prisma.glEntry.count({ where: { companyId, accountId: keep.body.data.id } })).toBe(keepEntries + foldEntries);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: sub.body.data.id } })).parentId).toBe(keep.body.data.id);

    const other = await create({ code: "1191", name: "Other type", type: "ASSET", reportingGroup: "Current assets|||Prepaid expenses" });
    const bad = await request(app).post(`/api/v1/coa/${other.body.data.id}/merge`).set(headers).send({ targetId: keep.body.data.id });
    expect(bad.status).toBe(400);
  });

  it("imports QuickBooks full names without numbers and skips accounts already there", async () => {
    const res = await request(app)
      .post("/api/v1/coa/import")
      .set(headers)
      .send({
        rows: [
          { name: "Travel:Flights", type: "EXPENSE" },
          { name: "Travel", type: "EXPENSE" },
          { name: "Fuel", type: "EXPENSE" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.createdCount).toBe(2);
    const travel = res.body.data.created.find((a: { name: string }) => a.name === "Travel");
    const flights = res.body.data.created.find((a: { name: string }) => a.name === "Flights");
    expect(flights.parentId).toBe(travel.id);
    expect(res.body.data.errors).toEqual([expect.objectContaining({ code: "Fuel" })]);
  });

  it("pages the chart of accounts with subaccounts kept under their parent", async () => {
    const parent = await create({ code: "6980", name: "Paging parent", type: "EXPENSE", reportingGroup: "Expenses|||Office/General Administrative Expenses" });
    await create({ code: "6981", name: "Paging child", type: "EXPENSE", reportingGroup: "Expenses|||Office/General Administrative Expenses", parentId: parent.body.data.id });

    const first = await request(app).get("/api/v1/coa/rows?page=1&pageSize=10").set(headers);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ page: 1, pageSize: 10 });
    expect(first.body.data.rows).toHaveLength(10);
    expect(first.body.data.total).toBeGreaterThan(10);
    expect(first.body.data.pageCount).toBe(Math.ceil(first.body.data.total / 10));

    const all = await request(app).get("/api/v1/coa/rows?pageSize=500").set(headers);
    const codes = all.body.data.rows.map((r: { code: string }) => r.code);
    expect(codes.indexOf("6981")).toBe(codes.indexOf("6980") + 1);
    expect(all.body.data.rows.find((r: { code: string }) => r.code === "6981")).toMatchObject({ depth: 1 });

    const search = await request(app).get("/api/v1/coa/rows?q=paging&pageSize=5").set(headers);
    expect(search.body.data.rows.map((r: { name: string }) => r.name)).toEqual(["Paging parent", "Paging child"]);
    const byType = await request(app).get("/api/v1/coa/rows?type=Cash%20and%20cash%20equivalents&pageSize=500").set(headers);
    expect(byType.body.data.rows.every((r: { accountType: string }) => r.accountType === "Cash and cash equivalents")).toBe(true);

    const desc = await request(app).get("/api/v1/coa/rows?sort=name&dir=desc&pageSize=3").set(headers);
    const names = desc.body.data.rows.map((r: { name: string }) => r.name);
    expect([...names].sort((a: string, b: string) => b.localeCompare(a))).toEqual(names);

    const past = await request(app).get("/api/v1/coa/rows?page=999&pageSize=10").set(headers);
    expect(past.body.data.page).toBe(past.body.data.pageCount);
  });
});

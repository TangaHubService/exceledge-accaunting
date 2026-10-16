import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { signErpToken } from "./helpers";

const app = createApp();
const orgId = 93001;
const token = (role = "ADMIN", userId = 101) =>
  signErpToken({ activeOrganizationId: orgId, role, userId });

describe("Phase 2 Chart of Accounts", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.company.deleteMany({ where: { externalErpOrganizationId: String(orgId) } });
  });

  it("lists dashboard and seeded accounts for tenant", async () => {
    const headers = { Authorization: `Bearer ${token()}` };
    // provision company via setup dashboard
    await request(app).get("/api/v1/setup/dashboard").set(headers);

    const dash = await request(app).get("/api/v1/coa/dashboard").set(headers);
    expect(dash.status).toBe(200);
    expect(dash.body.data.total).toBeGreaterThan(10);
    expect(dash.body.data.categories.length).toBe(8);

    const list = await request(app).get("/api/v1/coa?type=ASSET").set(headers);
    expect(list.status).toBe(200);
    expect(list.body.data.every((a: { type: string }) => a.type === "ASSET")).toBe(true);
  });

  it("creates hierarchical accounts and enforces validations", async () => {
    const headers = { Authorization: `Bearer ${token()}` };

    const parent = await request(app)
      .post("/api/v1/coa")
      .set(headers)
      .send({ code: "6105", name: "Occupancy Costs", type: "EXPENSE", description: "Parent" });
    expect(parent.status).toBe(201);

    const child = await request(app)
      .post("/api/v1/coa")
      .set(headers)
      .send({
        code: "6111",
        name: "Warehouse Rent",
        type: "EXPENSE",
        parentId: parent.body.data.id,
      });
    expect(child.status).toBe(201);

    const badType = await request(app)
      .post("/api/v1/coa")
      .set(headers)
      .send({ code: "2105", name: "Bad", type: "EXPENSE" });
    expect(badType.status).toBe(400);

    const badParent = await request(app)
      .post("/api/v1/coa")
      .set(headers)
      .send({
        code: "6112",
        name: "Wrong Parent",
        type: "EXPENSE",
        parentId: (
          await request(app).get("/api/v1/coa?q=1200").set(headers)
        ).body.data[0].id,
      });
    expect(badParent.status).toBe(400);

    const tree = await request(app).get("/api/v1/coa/tree").set(headers);
    expect(tree.status).toBe(200);
    expect(Array.isArray(tree.body.data)).toBe(true);
  });

  it("protects system accounts and blocks seller", async () => {
    const admin = { Authorization: `Bearer ${token()}` };
    const cash = (
      await request(app).get("/api/v1/coa?q=1100").set(admin)
    ).body.data.find((a: { code: string }) => a.code === "1100");

    const renameCode = await request(app)
      .patch(`/api/v1/coa/${cash.id}`)
      .set(admin)
      .send({ code: "1199" });
    expect(renameCode.status).toBe(400);

    const deactivate = await request(app)
      .post(`/api/v1/coa/${cash.id}/deactivate`)
      .set(admin);
    expect(deactivate.status).toBe(400);

    const seller = {
      Authorization: `Bearer ${token("SELLER", 202)}`,
    };
    const denied = await request(app).get("/api/v1/coa/dashboard").set(seller);
    expect(denied.status).toBe(403);
  });

  it("imports, exports, and isolates tenants", async () => {
    const headers = { Authorization: `Bearer ${token()}` };
    const imported = await request(app)
      .post("/api/v1/coa/import")
      .set(headers)
      .send({
        rows: [
          { code: "6120", name: "Electricity", type: "EXPENSE" },
          { code: "6121", name: "Water Utility", type: "EXPENSE", parentCode: "6120" },
        ],
      });
    expect(imported.status).toBe(201);
    expect(imported.body.data.createdCount).toBe(2);

    const exported = await request(app).get("/api/v1/coa/export?format=json").set(headers);
    expect(exported.status).toBe(200);
    expect(exported.body.data.some((r: { code: string }) => r.code === "6121")).toBe(true);

    const csv = await request(app).get("/api/v1/coa/export?format=csv").set(headers);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("code,name,type");

    const other = {
      Authorization: `Bearer ${signErpToken({
        activeOrganizationId: 93002,
        role: "ADMIN",
        userId: 303,
      })}`,
    };
    await request(app).get("/api/v1/setup/dashboard").set(other);
    const otherList = await request(app).get("/api/v1/coa?q=6120").set(other);
    expect(otherList.status).toBe(200);
    // other org only has system seed unless imported — 6120 should not exist there
    expect(otherList.body.data.some((a: { code: string }) => a.code === "6120")).toBe(false);
  });

  it("deactivates custom account and prevents delete when posted flag set", async () => {
    const headers = { Authorization: `Bearer ${token()}` };
    const created = await request(app)
      .post("/api/v1/coa")
      .set(headers)
      .send({ code: "6130", name: "Internet", type: "EXPENSE" });
    expect(created.status).toBe(201);

    const deactivated = await request(app)
      .post(`/api/v1/coa/${created.body.data.id}/deactivate`)
      .set(headers);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);

    await prisma.account.update({
      where: { id: created.body.data.id },
      data: { hasPostedTransactions: true },
    });
    const del = await request(app).delete(`/api/v1/coa/${created.body.data.id}`).set(headers);
    expect(del.status).toBe(400);
  });
});

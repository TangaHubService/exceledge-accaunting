import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { clearAccessCache } from "../src/modules/users/access.service";
import { authHeaders, resetCompany, signErpToken } from "./helpers";

const app = createApp();
const orgId = 97711;
const admin = authHeaders(orgId, "ADMIN", 7000);
const clerkId = 7001;
const clerk = authHeaders(orgId, "ACCOUNTANT", clerkId);

async function companyId() {
  const c = await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } });
  return c.id;
}

describe("Custom roles (QuickBooks model)", () => {
  let roleId = "";

  beforeAll(async () => {
    await resetCompany(orgId);
    clearAccessCache();
    // First request creates the company.
    await request(app).get("/api/v1/access/me").set(admin);
  });

  afterAll(async () => {
    await resetCompany(orgId);
    clearAccessCache();
  });

  it("lets a company admin create a role from exact permissions", async () => {
    const res = await request(app)
      .post("/api/v1/users/roles")
      .set(admin)
      .send({ name: "Invoice clerk", description: "Invoices only", capabilities: ["ar:view", "ar:manage", "report:view"], erpRole: "ACCOUNTANT" });
    expect(res.status).toBe(201);
    roleId = res.body.data.id;
    const list = await request(app).get("/api/v1/users/roles").set(admin);
    expect(list.body.data.roles.map((r: { name: string }) => r.name)).toContain("Invoice clerk");
    expect(list.body.data.grantable).not.toContain("setup:approve");
  });

  it("rejects duplicate names, admin-only permissions and empty roles", async () => {
    const dup = await request(app).post("/api/v1/users/roles").set(admin).send({ name: "invoice CLERK", capabilities: ["ar:view"], erpRole: "ACCOUNTANT" });
    expect(dup.status).toBe(409);
    const adminOnly = await request(app).post("/api/v1/users/roles").set(admin).send({ name: "Sneaky", capabilities: ["setup:approve"], erpRole: "ACCOUNTANT" });
    expect(adminOnly.status).toBe(400);
    const empty = await request(app).post("/api/v1/users/roles").set(admin).send({ name: "Empty", capabilities: [], erpRole: "ACCOUNTANT" });
    expect(empty.status).toBe(400);
    const adminErp = await request(app).post("/api/v1/users/roles").set(admin).send({ name: "Boss", capabilities: ["ar:view"], erpRole: "ADMIN" });
    expect(adminErp.status).toBe(400);
  });

  it("only company admins manage roles", async () => {
    const res = await request(app).post("/api/v1/users/roles").set(clerk).send({ name: "Mine", capabilities: ["ar:view"], erpRole: "ACCOUNTANT" });
    expect(res.status).toBe(403);
  });

  it("replaces the built-in role's access for the person who holds it", async () => {
    // Built-in Accountant can read journals.
    expect((await request(app).get("/api/v1/journals").set(clerk)).status).toBe(200);

    await prisma.userRoleAssignment.create({ data: { companyId: await companyId(), erpUserId: clerkId, customRoleId: roleId, assignedByErpUserId: 7000 } });
    clearAccessCache();

    const me = await request(app).get("/api/v1/access/me").set(clerk);
    expect(me.body.data.customRole.name).toBe("Invoice clerk");
    expect(me.body.data.capabilities.sort()).toEqual(["ar:manage", "ar:view", "report:view"]);
    expect((await request(app).get("/api/v1/journals").set(clerk)).status).toBe(403);
    expect((await request(app).get("/api/v1/coa/tree").set(clerk)).status).toBe(403);
    expect((await request(app).get("/api/v1/ar/customers").set(clerk)).status).toBe(200);
  });

  it("applies role edits straight away", async () => {
    const res = await request(app)
      .put(`/api/v1/users/roles/${roleId}`)
      .set(admin)
      .send({ name: "Invoice clerk", capabilities: ["ar:view", "report:view", "journal:view"], erpRole: "ACCOUNTANT" });
    expect(res.status).toBe(200);
    expect((await request(app).get("/api/v1/journals").set(clerk)).status).toBe(200);
    const me = await request(app).get("/api/v1/access/me").set(clerk);
    expect(me.body.data.capabilities).not.toContain("ar:manage");
  });

  it("never applies a custom role to a company admin", async () => {
    await prisma.userRoleAssignment.create({ data: { companyId: await companyId(), erpUserId: 7000, customRoleId: roleId, assignedByErpUserId: 7000 } });
    clearAccessCache();
    const me = await request(app).get("/api/v1/access/me").set(admin);
    expect(me.body.data.customRole).toBeNull();
    expect(me.body.data.capabilities).toContain("setup:approve");
    await prisma.userRoleAssignment.deleteMany({ where: { erpUserId: 7000 } });
  });

  it("attaches a custom role chosen at invite time on first sign-in", async () => {
    await prisma.inviteRoleAssignment.create({ data: { companyId: await companyId(), email: "new.clerk@example.com", customRoleId: roleId, createdByErpUserId: 7000 } });
    clearAccessCache();
    const token = signErpToken({ activeOrganizationId: orgId, role: "ACCOUNTANT", userId: 7002, email: "New.Clerk@example.com" });
    const me = await request(app).get("/api/v1/access/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.data.customRole.name).toBe("Invoice clerk");
    expect(await prisma.inviteRoleAssignment.count({ where: { email: "new.clerk@example.com" } })).toBe(0);
    expect(await prisma.userRoleAssignment.count({ where: { erpUserId: 7002 } })).toBe(1);
  });

  it("won't delete a role that people hold", async () => {
    const blocked = await request(app).delete(`/api/v1/users/roles/${roleId}`).set(admin);
    expect(blocked.status).toBe(409);
    await prisma.userRoleAssignment.deleteMany({ where: { customRoleId: roleId } });
    const ok = await request(app).delete(`/api/v1/users/roles/${roleId}`).set(admin);
    expect(ok.status).toBe(200);
    // Without the role the person is back on their built-in access.
    expect((await request(app).get("/api/v1/coa/tree").set(clerk)).status).toBe(200);
  });
});

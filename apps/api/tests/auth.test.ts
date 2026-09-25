import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { signErpToken } from "./helpers";

const app = createApp();

describe("Phase 1 auth & tenant isolation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  it("rejects missing token", async () => {
    const res = await request(app).get("/api/v1/setup/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects invalid token", async () => {
    const res = await request(app)
      .get("/api/v1/setup/dashboard")
      .set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(401);
  });

  it("denies SELLER setup access", async () => {
    const token = signErpToken({ role: "SELLER", activeOrganizationId: 200 });
    const res = await request(app)
      .get("/api/v1/setup/dashboard")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("isolates companies by ERP organization id", async () => {
    const tokenA = signErpToken({ activeOrganizationId: 301, role: "ADMIN" });
    const tokenB = signErpToken({ activeOrganizationId: 302, role: "ADMIN", userId: 2 });

    const dashA = await request(app)
      .get("/api/v1/setup/dashboard")
      .set("Authorization", `Bearer ${tokenA}`);
    const dashB = await request(app)
      .get("/api/v1/setup/dashboard")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(dashA.status).toBe(200);
    expect(dashB.status).toBe(200);
    expect(dashA.body.data.companyId).not.toBe(dashB.body.data.companyId);
    expect(dashA.body.data.externalErpOrganizationId).toBe("301");
    expect(dashB.body.data.externalErpOrganizationId).toBe("302");
  });
});

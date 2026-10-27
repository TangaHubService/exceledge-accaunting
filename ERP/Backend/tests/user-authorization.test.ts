import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userOrganization: { findFirst: vi.fn(), update: vi.fn() },
    user: { update: vi.fn() },
  },
}));

vi.mock("../src/utils/auditLogger", () => {
  const users = vi.fn().mockResolvedValue(undefined);
  return { auditLogger: { users }, default: { users } };
});

import { prisma } from "../src/lib/prisma";
import { updateUser, deleteUser } from "../src/controllers/user.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(overrides: any) {
  return {
    params: { organizationId: "1", id: "2" },
    body: {},
    ...overrides,
  } as any;
}

describe("updateUser authorization (Issue 1 – permission escalation)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks a SELLER from changing another user's role (403, no write)", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 2, role: "ADMIN" }) // target
      .mockResolvedValueOnce({ role: "SELLER" }); // actor membership

    const req = makeReq({
      params: { organizationId: "1", id: "2" },
      body: { role: "SELLER" },
      user: { userId: "10", role: "SELLER" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.userOrganization.update).not.toHaveBeenCalled();
  });

  it("blocks a SELLER from editing any field on another user's account", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 5, role: "SELLER" }) // target
      .mockResolvedValueOnce({ role: "SELLER" }); // actor membership

    const req = makeReq({
      params: { organizationId: "1", id: "5" },
      body: { name: "Renamed" },
      user: { userId: "10", role: "SELLER" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows a user to edit their own non-sensitive profile fields", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 10, role: "SELLER" }) // target = self
      .mockResolvedValueOnce({ role: "SELLER" }); // actor membership = self
    (prisma.user.update as any).mockResolvedValueOnce({});

    const req = makeReq({
      params: { organizationId: "1", id: "10" },
      body: { name: "New Name" },
      user: { userId: "10", role: "SELLER" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { name: "New Name" } });
  });

  it("blocks self-service role escalation even on one's own account", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 10, role: "SELLER" })
      .mockResolvedValueOnce({ role: "SELLER" });

    const req = makeReq({
      params: { organizationId: "1", id: "10" },
      body: { role: "ADMIN" },
      user: { userId: "10", role: "SELLER" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.userOrganization.update).not.toHaveBeenCalled();
  });

  it("prevents an org ADMIN (non-System-Owner) from modifying another Admin's role", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 2, role: "ADMIN" }) // target
      .mockResolvedValueOnce({ role: "ADMIN" }); // actor

    const req = makeReq({
      params: { organizationId: "1", id: "2" },
      body: { role: "SELLER" },
      user: { userId: "10", role: "ADMIN" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.userOrganization.update).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to change a non-admin user's role", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 2, role: "SELLER" }) // target
      .mockResolvedValueOnce({ role: "ADMIN" }); // actor
    (prisma.userOrganization.update as any).mockResolvedValueOnce({});

    const req = makeReq({
      params: { organizationId: "1", id: "2" },
      body: { role: "BRANCH_MANAGER" },
      user: { userId: "10", role: "ADMIN" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(prisma.userOrganization.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { role: "BRANCH_MANAGER" },
    });
  });

  it("rejects an invalid/unknown role value", async () => {
    (prisma.userOrganization.findFirst as any)
      .mockResolvedValueOnce({ id: 1, userId: 2, role: "SELLER" })
      .mockResolvedValueOnce({ role: "ADMIN" });

    const req = makeReq({
      params: { organizationId: "1", id: "2" },
      body: { role: "SUPER_HACKER" },
      user: { userId: "10", role: "ADMIN" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("allows a SYSTEM_OWNER to change an Admin's role", async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValueOnce({ id: 1, userId: 2, role: "ADMIN" }); // target only
    (prisma.userOrganization.update as any).mockResolvedValueOnce({});

    const req = makeReq({
      params: { organizationId: "1", id: "2" },
      body: { role: "SELLER" },
      user: { userId: "99", role: "SYSTEM_OWNER" },
    });
    const res = makeRes();

    await updateUser(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(prisma.userOrganization.update).toHaveBeenCalled();
  });
});

describe("deleteUser authorization (Issue 1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prevents disabling an Admin account unless requester is SYSTEM_OWNER", async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValueOnce({ id: 1, userId: 2, role: "ADMIN" });

    const req = makeReq({
      params: { organizationId: "1", id: "2" },
      user: { userId: "10", role: "ADMIN" },
    });
    const res = makeRes();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("prevents a user from disabling their own account", async () => {
    (prisma.userOrganization.findFirst as any).mockResolvedValueOnce({ id: 1, userId: 10, role: "ADMIN" });

    const req = makeReq({
      params: { organizationId: "1", id: "10" },
      user: { userId: "10", role: "ADMIN" },
    });
    const res = makeRes();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

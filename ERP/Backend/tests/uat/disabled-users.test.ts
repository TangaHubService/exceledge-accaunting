import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  userOrganization: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  user: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("../../src/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("../../src/utils/auditLogger", () => ({
  auditLogger: { users: vi.fn().mockResolvedValue(undefined) },
  default: { users: vi.fn().mockResolvedValue(undefined) },
}));

import { getUsers, reactivateUser } from "../../src/controllers/user.controller";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("Disabled Users (#4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters active users by default", async () => {
    mockPrisma.userOrganization.findMany.mockResolvedValue([
      { id: 1, role: "ADMIN", user: { id: 1, name: "Active User", email: "active@test.com", isActive: true, disabledAt: null, reactivatedAt: null } },
    ]);
    mockPrisma.userOrganization.count.mockResolvedValue(1);

    const req: any = { params: { organizationId: "1" }, query: { page: "1", limit: "10" } };
    const res = makeRes();
    await getUsers(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].users[0].name).toBe("Active User");
  });

  it("returns disabled users when status=disabled", async () => {
    mockPrisma.userOrganization.findMany.mockResolvedValue([
      { id: 2, role: "USER", user: { id: 2, name: "Disabled User", email: "disabled@test.com", isActive: false, disabledAt: new Date(), reactivatedAt: null } },
    ]);
    mockPrisma.userOrganization.count.mockResolvedValue(1);

    const req: any = { params: { organizationId: "1" }, query: { page: "1", limit: "10", status: "disabled" } };
    const res = makeRes();
    await getUsers(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].users[0].name).toBe("Disabled User");
  });

  it("returns all users when status=all", async () => {
    mockPrisma.userOrganization.findMany.mockResolvedValue([
      { id: 1, role: "ADMIN", user: { id: 1, name: "Active", email: "a@t.com", isActive: true, disabledAt: null, reactivatedAt: null } },
      { id: 2, role: "USER", user: { id: 2, name: "Disabled", email: "d@t.com", isActive: false, disabledAt: new Date(), reactivatedAt: null } },
    ]);
    mockPrisma.userOrganization.count.mockResolvedValue(2);

    const req: any = { params: { organizationId: "1" }, query: { page: "1", limit: "10", status: "all" } };
    const res = makeRes();
    await getUsers(req, res);
    expect(res.json.mock.calls[0][0].users).toHaveLength(2);
  });

  it("reactivates a disabled user", async () => {
    mockPrisma.userOrganization.findFirst.mockResolvedValue({
      id: 2, userId: 2, organizationId: 1, role: "USER",
      user: { id: 2, name: "Disabled User", email: "d@t.com", isActive: false, disabledAt: new Date(), reactivatedAt: null },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 2, name: "Disabled User", email: "d@t.com", isActive: false, disabledAt: new Date(), reactivatedAt: null });
    mockPrisma.user.update.mockResolvedValue({ id: 2, name: "Disabled User", email: "d@t.com", isActive: true, disabledAt: null, reactivatedAt: new Date() });

    const req: any = { params: { organizationId: "1", id: "2" }, user: { userId: 1 } };
    const res = makeRes();
    await reactivateUser(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 2 },
      data: expect.objectContaining({ isActive: true }),
    }));
  });

  it("rejects reactivation of already active user", async () => {
    mockPrisma.userOrganization.findFirst.mockResolvedValue({
      id: 1, userId: 1, organizationId: 1, role: "ADMIN",
      user: { id: 1, name: "Active User", email: "a@t.com", isActive: true },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 1, name: "Active User", email: "a@t.com", isActive: true });

    const req: any = { params: { organizationId: "1", id: "1" }, user: { userId: 1 } };
    const res = makeRes();
    await reactivateUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

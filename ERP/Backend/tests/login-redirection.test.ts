import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    userOrganization: { findFirst: vi.fn(), findMany: vi.fn() },
    userBranch: { findMany: vi.fn() },
    subscription: { findFirst: vi.fn() },
  },
}));

vi.mock("../src/utils/auditLogger", () => {
  const users = vi.fn().mockResolvedValue(undefined);
  return { auditLogger: { users }, default: { users } };
});

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("hashed"),
  },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("hashed"),
}));

import { prisma } from "../src/lib/prisma";
import { login } from "../src/controllers/auth.controller";
import bcrypt from "bcryptjs";

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(overrides: any) {
  return {
    body: { email: "test@example.com", password: "password123" },
    ...overrides,
  } as any;
}

const mockUserBase = {
  id: 1,
  email: "test@example.com",
  name: "Test User",
  password: "hashed_password",
  isEmailVerified: true,
  isActive: true,
  requirePasswordChange: false,
  role: "ADMIN",
  phone: null,
  profileImage: null,
  refreshToken: null,
  refreshTokenExpiry: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  defaultPassword: null,
  isOwner: false,
};

describe("Login redirection — role-based landing page logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (bcrypt.compare as any).mockResolvedValue(true);
  });

  it("SYSTEM_OWNER without organisations — role is SYSTEM_OWNER in response", async () => {
    const user = { ...mockUserBase, role: "SYSTEM_OWNER", userOrganizations: [] };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();

    const callArgs = res.json.mock.calls[0][0];
    expect(callArgs.user.role).toBe("SYSTEM_OWNER");
    expect(callArgs.hasOrganization).toBe(false);
  });

  it("SYSTEM_OWNER with organisations — role is SYSTEM_OWNER (not org role)", async () => {
    const user = {
      ...mockUserBase,
      role: "SYSTEM_OWNER",
      userOrganizations: [
        {
          id: 10,
          userId: 1,
          organizationId: 5,
          role: "ADMIN",
          isOwner: true,
          createdAt: new Date("2024-01-01"),
          organization: {
            id: 5,
            name: "Test Org",
            address: null,
            phone: null,
            email: null,
            businessType: "PHARMACY",
            isActive: true,
            avatar: null,
          },
        },
      ],
    };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 1,
      organizationId: 5,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      amount: 100,
    });
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();

    const callArgs = res.json.mock.calls[0][0];
    // SYSTEM_OWNER must keep their role regardless of org membership
    expect(callArgs.user.role).toBe("SYSTEM_OWNER");
    expect(callArgs.hasOrganization).toBe(true);
    expect(callArgs.organizations.length).toBe(1);
  });

  it("ADMIN without organisations — role is ADMIN", async () => {
    const user = { ...mockUserBase, role: "ADMIN", userOrganizations: [] };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    const callArgs = res.json.mock.calls[0][0];
    expect(callArgs.user.role).toBe("ADMIN");
    expect(callArgs.hasOrganization).toBe(false);
  });

  it("ADMIN with one organisation — role is ADMIN", async () => {
    const user = {
      ...mockUserBase,
      role: "ADMIN",
      userOrganizations: [
        {
          id: 10,
          userId: 1,
          organizationId: 5,
          role: "ADMIN",
          isOwner: true,
          createdAt: new Date("2024-01-01"),
          organization: {
            id: 5,
            name: "Test Org",
            address: null,
            phone: null,
            email: null,
            businessType: "PHARMACY",
            isActive: true,
            avatar: null,
          },
        },
      ],
    };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 1,
      organizationId: 5,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      amount: 100,
    });
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    const callArgs = res.json.mock.calls[0][0];
    expect(callArgs.user.role).toBe("ADMIN");
    expect(callArgs.hasOrganization).toBe(true);
    expect(callArgs.organizations.length).toBe(1);
    // org-level role is available per-org
    expect(callArgs.organizations[0].role).toBe("ADMIN");
  });

  it("SELLER with one organisation — role is preserved", async () => {
    const user = {
      ...mockUserBase,
      role: "SELLER",
      userOrganizations: [
        {
          id: 10,
          userId: 1,
          organizationId: 5,
          role: "SELLER",
          isOwner: false,
          createdAt: new Date("2024-01-01"),
          organization: {
            id: 5,
            name: "Test Org",
            address: null,
            phone: null,
            email: null,
            businessType: "PHARMACY",
            isActive: true,
            avatar: null,
          },
        },
      ],
    };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 1,
      organizationId: 5,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      amount: 100,
    });
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    const callArgs = res.json.mock.calls[0][0];
    expect(callArgs.user.role).toBe("SELLER");
    expect(callArgs.hasOrganization).toBe(true);
  });

  it("SYSTEM_OWNER with multiple organisations — role is still SYSTEM_OWNER", async () => {
    const user = {
      ...mockUserBase,
      role: "SYSTEM_OWNER",
      userOrganizations: [
        {
          id: 10,
          userId: 1,
          organizationId: 5,
          role: "ADMIN",
          isOwner: true,
          createdAt: new Date("2024-01-01"),
          organization: {
            id: 5,
            name: "Org One",
            address: null,
            phone: null,
            email: null,
            businessType: "PHARMACY",
            isActive: true,
            avatar: null,
          },
        },
        {
          id: 11,
          userId: 1,
          organizationId: 6,
          role: "BRANCH_MANAGER",
          isOwner: false,
          createdAt: new Date("2024-02-01"),
          organization: {
            id: 6,
            name: "Org Two",
            address: null,
            phone: null,
            email: null,
            businessType: "CLINIC",
            isActive: true,
            avatar: null,
          },
        },
      ],
    };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 1,
      organizationId: 5,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      amount: 100,
    });
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    const callArgs = res.json.mock.calls[0][0];
    // SYSTEM_OWNER role is preserved regardless of multiple org memberships
    expect(callArgs.user.role).toBe("SYSTEM_OWNER");
    expect(callArgs.hasOrganization).toBe(true);
    expect(callArgs.organizations.length).toBe(2);
    // Each organisation carries its own per-org role
    expect(callArgs.organizations[0].role).toBe("ADMIN");
    expect(callArgs.organizations[1].role).toBe("BRANCH_MANAGER");
  });

  it("returns organisations with per-org roles for all user types", async () => {
    const user = {
      ...mockUserBase,
      role: "ADMIN",
      userOrganizations: [
        {
          id: 10,
          userId: 1,
          organizationId: 5,
          role: "BRANCH_MANAGER",
          isOwner: false,
          createdAt: new Date("2024-01-01"),
          organization: {
            id: 5,
            name: "Org Alpha",
            address: null,
            phone: null,
            email: null,
            businessType: "PHARMACY",
            isActive: true,
            avatar: null,
          },
        },
      ],
    };
    (prisma.user.findUnique as any).mockResolvedValue(user);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 1,
      organizationId: 5,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      amount: 100,
    });
    (prisma.userBranch.findMany as any).mockResolvedValue([]);
    (prisma.user.update as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    const callArgs = res.json.mock.calls[0][0];
    // User's top-level role
    expect(callArgs.user.role).toBe("ADMIN");
    // Per-org role in the organization list
    expect(callArgs.organizations[0].role).toBe("BRANCH_MANAGER");
  });

  it("rejects unverified email with 403 EMAIL_NOT_VERIFIED", async () => {
    const user = { ...mockUserBase, isEmailVerified: false, role: "SYSTEM_OWNER", userOrganizations: [] };
    (prisma.user.findUnique as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }),
    );
  });

  it("rejects inactive account with 401", async () => {
    const user = { ...mockUserBase, isActive: false, role: "SYSTEM_OWNER", userOrganizations: [] };
    (prisma.user.findUnique as any).mockResolvedValue(user);

    const req = makeReq({});
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

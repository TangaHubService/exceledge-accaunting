import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    userBranch: { findMany: vi.fn() },
    userOrganization: { findFirst: vi.fn() },
  },
  // Simplified stand-in: the real implementation runs `fn` inside an
  // AsyncLocalStorage context so Prisma can auto-inject branchId; for these
  // middleware-level tests we only assert what gets attached to `req` and
  // that `next()` is reached, so a synchronous passthrough is sufficient.
  withBranchScope: (_branchId: unknown, fn: () => unknown) => fn(),
}));

import { prisma } from "../src/lib/prisma";
import { branchAuth, buildBranchFilter } from "../src/middleware/branchAuth.middleware";

function makeReq(overrides: any = {}) {
  return {
    query: {},
    body: {},
    params: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("branchAuth default scoping (Issue 2 – branch access control)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto-scopes a single-branch SELLER to their own branch when no branchId is passed", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([{ branchId: 7 }]);
    const req = makeReq({ user: { userId: "1", role: "SELLER" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(req.selectedBranchId).toBe(7);
    expect(req.branchScope).toBe("LIMITED");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(buildBranchFilter(req)).toEqual({ branchId: 7 });
  });

  it("fails closed for a LIMITED user with no branch assignment at all", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([]);
    const req = makeReq({ user: { userId: "1", role: "SELLER" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    // Sentinel branch id that matches no real branch — filters resolve to zero rows
    // instead of silently falling through to "no filter = see everything".
    expect(req.selectedBranchId).toBe(-1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("scopes a multi-branch SELLER to the union of their assigned branches", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([{ branchId: 3 }, { branchId: 4 }]);
    const req = makeReq({ user: { userId: "1", role: "SELLER" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(req.selectedBranchId).toBeNull();
    expect(req.selectedBranchIds).toEqual([3, 4]);
    expect(buildBranchFilter(req)).toEqual({ branchId: { in: [3, 4] } });
  });

  it("leaves an org ADMIN with no branch restrictions unfiltered", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([]);
    const req = makeReq({ user: { userId: "1", role: "ADMIN" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(req.selectedBranchId).toBeNull();
    expect(req.branchScope).toBe("ALL");
    expect(buildBranchFilter(req)).toEqual({});
  });

  it("SYSTEM_OWNER always gets unrestricted access regardless of branch rows", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([{ branchId: 7 }]);
    const req = makeReq({ user: { userId: "1", role: "SYSTEM_OWNER" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(req.branchScope).toBe("ALL");
    expect(req.selectedBranchId).toBeNull();
  });

  it("rejects a branch-restricted user requesting a branch outside their assignment (403)", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([{ branchId: 7 }]);
    const req = makeReq({ user: { userId: "1", role: "SELLER" }, query: { branchId: "9" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a branch-restricted user to explicitly request their own assigned branch", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([{ branchId: 7 }]);
    const req = makeReq({ user: { userId: "1", role: "SELLER" }, query: { branchId: "7" } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(req.selectedBranchId).toBe(7);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a branchId supplied only in the request body from a restricted user (write-path tamper)", async () => {
    (prisma.userBranch.findMany as any).mockResolvedValueOnce([{ branchId: 7 }]);
    const req = makeReq({ user: { userId: "1", role: "SELLER" }, body: { branchId: 9 } });
    const res = makeRes();
    const next = vi.fn();

    await branchAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

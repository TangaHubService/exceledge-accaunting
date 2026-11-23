import { Router, type Response } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as users from "./users.service";

/** Manage users: list, invite, change role, deactivate/reactivate, remove. Data lives in the ERP. */
export const usersRouter = Router();

usersRouter.use(authenticateErpJwt, requireCapability("setup:view"), resolveCompany);

/** Only company admins manage users, as in QuickBooks; the ERP enforces the same rule. */
const manage = requireCapability("setup:approve");

function actor(req: AuthedRequest) {
  return { erpUserId: req.erpUser!.userId, erpRole: req.organizationRole ?? req.erpUser!.role, meta: getRequestMeta(req) };
}

function bearer(req: AuthedRequest) {
  return (req.headers.authorization ?? "").slice("Bearer ".length);
}

function fail(res: Response, e: unknown) {
  if (e instanceof z.ZodError) return res.status(400).json({ success: false, error: e.issues[0]?.message ?? "Invalid request" });
  const status = e instanceof users.ErpError ? e.status : 400;
  res.status(status).json({ success: false, error: (e as Error).message });
}

const idParam = z.coerce.number().int().positive();
const role = z.enum(users.ASSIGNABLE_ROLES, { errorMap: () => ({ message: "Choose a role" }) });

usersRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await users.listUsers(req.companyId!, bearer(req)) });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.post("/invite", manage, async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        email: z.string().trim().email("Enter a valid email address"),
        role,
        branchId: z.coerce.number().int().positive().nullish(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await users.inviteUser(req.companyId!, bearer(req), body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.patch("/:id", manage, async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ role: role.optional(), isActive: z.boolean().optional() }).parse(req.body);
    await users.updateUser(req.companyId!, bearer(req), idParam.parse(req.params.id), body, actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.delete("/:id", manage, async (req: AuthedRequest, res) => {
  try {
    await users.removeUser(req.companyId!, bearer(req), idParam.parse(req.params.id), actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.delete("/invitations/:id", manage, async (req: AuthedRequest, res) => {
  try {
    await users.cancelInvitation(req.companyId!, bearer(req), idParam.parse(req.params.id), actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.post("/invitations/:id/resend", manage, async (req: AuthedRequest, res) => {
  try {
    await users.resendInvitation(req.companyId!, bearer(req), idParam.parse(req.params.id), actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

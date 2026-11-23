import { Router, type Response } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import { ADMIN_ONLY_CAPABILITIES, GRANTABLE_CAPABILITIES, isAdminRole } from "./access.service";
import * as roles from "./roles.service";
import * as users from "./users.service";

/** Manage users: list, invite, change role, deactivate/reactivate, remove. Data lives in the ERP. */
export const usersRouter = Router();

usersRouter.use(authenticateErpJwt, requireCapability("setup:view"), resolveCompany);

/** Only company admins manage users, as in QuickBooks; the ERP enforces the same rule. */
const manage = requireCapability("setup:approve");

function actor(req: AuthedRequest) {
  return { erpUserId: req.erpUser!.userId, erpRole: req.organizationRole ?? req.erpUser!.role, capabilities: req.capabilities ? [...req.capabilities] : undefined, meta: getRequestMeta(req) };
}

function bearer(req: AuthedRequest) {
  return (req.headers.authorization ?? "").slice("Bearer ".length);
}

function fail(res: Response, e: unknown) {
  if (e instanceof z.ZodError) return res.status(400).json({ success: false, error: e.issues[0]?.message ?? "Invalid request" });
  const status = e instanceof users.ErpError || e instanceof roles.RoleError ? e.status : 400;
  res.status(status).json({ success: false, error: (e as Error).message });
}

const idParam = z.coerce.number().int().positive();
const role = z.enum(users.ASSIGNABLE_ROLES, { errorMap: () => ({ message: "Choose a role" }) });
/** Either a built-in role or one of the company's custom roles, never both. */
const roleChoice = z
  .object({ role: role.optional(), customRoleId: z.string().min(1).optional() })
  .refine((v) => Boolean(v.role) !== Boolean(v.customRoleId), { message: "Choose a role" });

usersRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await users.listUsers(req.companyId!, bearer(req)) });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.post("/invite", manage, async (req: AuthedRequest, res) => {
  try {
    const base = z.object({ email: z.string().trim().email("Enter a valid email address"), branchId: z.coerce.number().int().positive().nullish() }).parse(req.body);
    const choice = roleChoice.parse(req.body) as users.RoleChoice;
    res.status(201).json({ success: true, data: await users.inviteUser(req.companyId!, bearer(req), { ...base, ...choice }, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

/* ── Custom roles ─────────────────────────────────────────────────────────────── */

const roleBody = z.object({
  name: z.string(),
  description: z.string().max(300).nullish(),
  capabilities: z.array(z.string()),
  erpRole: z.enum(roles.CUSTOM_ROLE_ERP_ROLES, { errorMap: () => ({ message: "Choose the Excel Edge access" }) }),
});

usersRouter.get("/roles", async (req: AuthedRequest, res) => {
  try {
    res.json({
      success: true,
      data: { roles: await roles.listRoles(req.companyId!), grantable: GRANTABLE_CAPABILITIES, adminOnly: ADMIN_ONLY_CAPABILITIES },
    });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.post("/roles", manage, async (req: AuthedRequest, res) => {
  try {
    res.status(201).json({ success: true, data: await roles.createRole(req.companyId!, roleBody.parse(req.body), actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.put("/roles/:roleId", manage, async (req: AuthedRequest, res) => {
  try {
    const { before, after } = await roles.updateRole(req.companyId!, req.params.roleId, roleBody.parse(req.body), actor(req));
    const synced = before.erpRole !== after.erpRole ? await users.syncRoleHolders(req.companyId!, bearer(req), after.id, after.erpRole) : { updated: 0 };
    res.json({ success: true, data: { ...after, holdersUpdated: synced.updated } });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.delete("/roles/:roleId", manage, async (req: AuthedRequest, res) => {
  try {
    await roles.deleteRole(req.companyId!, req.params.roleId, actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

/* ── Accounting firms ─────────────────────────────────────────────────────────── */

usersRouter.get("/firms", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await users.listFirms(req.companyId!, bearer(req)) });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.post("/firms", manage, async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        firmName: z.string().trim().min(2, "Enter the firm's name").max(120),
        email: z.string().trim().email("Enter a valid email address"),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await users.inviteFirm(req.companyId!, bearer(req), body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.delete("/firms/:firmId", manage, async (req: AuthedRequest, res) => {
  try {
    await users.removeFirm(req.companyId!, bearer(req), req.params.firmId, actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

/* ── Primary admin ────────────────────────────────────────────────────────────── */

usersRouter.post("/:id/transfer-primary-admin", manage, async (req: AuthedRequest, res) => {
  try {
    await users.transferPrimaryAdmin(req.companyId!, bearer(req), idParam.parse(req.params.id), actor(req));
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});

usersRouter.patch("/:id", manage, async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ role: role.optional(), customRoleId: z.string().min(1).optional(), isActive: z.boolean().optional() })
      .refine((v) => !(v.role && v.customRoleId), { message: "Choose one role" })
      .parse(req.body);
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

/**
 * What the signed-in person can do in this company: their custom role's capabilities, or their
 * Excel Edge role's. Open to every signed-in user (the app uses it to show and hide screens).
 */
export const accessRouter = Router();
accessRouter.use(authenticateErpJwt, resolveCompany);
accessRouter.get("/me", (req: AuthedRequest, res) => {
  res.json({
    success: true,
    data: {
      capabilities: [...(req.capabilities ?? [])],
      customRole: req.customRole ?? null,
      erpRole: req.organizationRole ?? req.erpUser?.role ?? null,
      isAdmin: isAdminRole(req.organizationRole ?? req.erpUser?.role),
    },
  });
});

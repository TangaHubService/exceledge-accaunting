import { Router } from "express";
import { z } from "zod";
import { hasCapability } from "@exceledge/accounting-domain";
import {
  AuthedRequest,
  authenticateErpJwt,
  getRequestMeta,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import * as journals from "./journal.service";

export const journalsRouter = Router();
journalsRouter.use(authenticateErpJwt, requireCapability("journal:view"), resolveCompany);

function actor(req: AuthedRequest) {
  return {
    erpUserId: req.erpUser!.userId,
    erpRole: req.organizationRole ?? req.erpUser!.role,
    meta: getRequestMeta(req),
  };
}

const journalBody = z.object({
  journalDate: z.string(),
  description: z.string().optional(),
  referenceNumber: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  branchId: z.string().optional(),
  costCentre: z.string().optional(),
  project: z.string().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string(),
        description: z.string().optional(),
        debit: z.number().nonnegative(),
        credit: z.number().nonnegative(),
        costCentre: z.string().optional(),
        project: z.string().optional(),
        branchId: z.string().optional(),
      }),
    )
    .min(2),
});

function fail(res: { status: (c: number) => { json: (b: unknown) => void } }, e: unknown) {
  res.status(400).json({ success: false, error: (e as Error).message });
}

journalsRouter.get("/", async (req: AuthedRequest, res) => {
  const data = await journals.listJournals(req.companyId!, {
    status: typeof req.query.status === "string" ? (req.query.status as never) : undefined,
    q: typeof req.query.q === "string" ? req.query.q : undefined,
  });
  res.json({ success: true, data });
});

journalsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const data = await journals.getJournal(req.companyId!, req.params.id);
  if (!data) return res.status(404).json({ success: false, error: "Not found" });
  return res.json({ success: true, data });
});

journalsRouter.get("/:id/approval-requirement", async (req: AuthedRequest, res) => {
  const journal = await journals.getJournal(req.companyId!, req.params.id);
  if (!journal) return res.status(404).json({ success: false, error: "Not found" });
  const { plan: _plan, ...data } = await journals.journalApprovalRequirement(req.companyId!, journal);
  return res.json({ success: true, data });
});

journalsRouter.post("/", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = journalBody.extend({ postImmediately: z.boolean().optional(), submit: z.boolean().optional() }).parse(req.body);

    if (body.postImmediately && !hasCapability(req.organizationRole ?? req.erpUser?.role, "journal:post")) {
      return res.status(403).json({ success: false, error: "Missing capability: journal:post" });
    }

    const { postImmediately, submit, ...rest } = body;
    const input = { ...rest, journalType: "MANUAL" as const };
    if (postImmediately) return res.status(201).json({ success: true, data: await journals.createAndPostJournal(req.companyId!, input, actor(req)) });
    if (submit) {
      const submitted = await journals.createAndSubmitJournal(req.companyId!, input, actor(req));
      return res.status(201).json({ success: true, data: { ...submitted.journal, approval: submitted.approval } });
    }
    return res.status(201).json({ success: true, data: await journals.createJournal(req.companyId!, input, actor(req)) });
  } catch (e) {
    return fail(res, e);
  }
});

journalsRouter.put("/:id", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = journalBody.parse(req.body);
    res.json({ success: true, data: await journals.updateJournal(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

journalsRouter.post("/:id/submit", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await journals.submitJournal(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

journalsRouter.post("/:id/cancel", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await journals.cancelJournal(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

journalsRouter.post("/:id/post", requireCapability("journal:post"), async (req: AuthedRequest, res) => {
  try {
    const data = await journals.postJournal(req.companyId!, req.params.id, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

journalsRouter.post(
  "/:id/reverse",
  requireCapability("journal:reverse"),
  async (req: AuthedRequest, res) => {
    try {
      const data = await journals.reverseJournal(
        req.companyId!,
        req.params.id,
        actor(req),
        typeof req.body?.reason === "string" ? req.body.reason : undefined,
      );
      res.json({ success: true, data });
    } catch (e) {
      fail(res, e);
    }
  },
);

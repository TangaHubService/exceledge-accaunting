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

journalsRouter.post("/", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        journalDate: z.string(),
        description: z.string().optional(),
        referenceNumber: z.string().optional(),
        currencyCode: z.string().length(3).optional(),
        exchangeRate: z.number().positive().optional(),
        branchId: z.string().optional(),
        lines: z
          .array(
            z.object({
              accountId: z.string(),
              description: z.string().optional(),
              debit: z.number().nonnegative(),
              credit: z.number().nonnegative(),
            }),
          )
          .min(2),
        postImmediately: z.boolean().optional(),
      })
      .parse(req.body);

    if (body.postImmediately && !hasCapability(req.organizationRole ?? req.erpUser?.role, "journal:post")) {
      return res.status(403).json({ success: false, error: "Missing capability: journal:post" });
    }

    const input = {
      journalDate: body.journalDate,
      description: body.description,
      referenceNumber: body.referenceNumber,
      currencyCode: body.currencyCode,
      exchangeRate: body.exchangeRate,
      branchId: body.branchId,
      journalType: "MANUAL" as const,
      lines: body.lines,
    };
    const data = body.postImmediately
      ? await journals.createAndPostJournal(req.companyId!, input, actor(req))
      : await journals.createJournal(req.companyId!, input, actor(req));
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, error: (e as Error).message });
  }
});

journalsRouter.post("/:id/post", requireCapability("journal:post"), async (req: AuthedRequest, res) => {
  try {
    const data = await journals.postJournal(req.companyId!, req.params.id, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
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
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  },
);

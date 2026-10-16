import { type Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { API_KEY_SCOPES, AuthedRequest, authenticate, requireCapability, resolveCompany } from "../../middleware/auth";
import * as approvals from "../approvals/approval.service";
import * as integrity from "../integrity/integrity.service";
import * as notifications from "../notifications/notification.service";
import * as webhooks from "../platform/webhook.service";
import * as books from "./books.service";
import * as budgets from "./budget.service";
import * as close from "./close.service";
import * as documents from "./documents.service";
import * as insights from "./insights.service";
import * as risks from "./risk.service";
import * as signatures from "./signatures.service";
import * as reportDocs from "./report-documents";
import { exportFormat, queryDay, queryDims, sendReport } from "../../lib/report-export";

export const booksRouter = Router();
booksRouter.use(authenticate, resolveCompany);

function actor(req: AuthedRequest) {
  return { erpUserId: req.erpUser!.userId, erpRole: req.organizationRole ?? req.erpUser!.role };
}

/** Companies whose books the caller may read: every ERP organization in their token. */
async function readableCompanies(req: AuthedRequest) {
  const user = req.erpUser;
  if (!user) return [req.companyId!];
  const orgIds = new Set<number>(user.organizationIds ?? []);
  for (const id of Array.isArray(user.organizationId) ? user.organizationId : [user.organizationId]) if (id) orgIds.add(id);
  if (user.activeOrganizationId) orgIds.add(user.activeOrganizationId);
  return [...new Set([req.companyId!, ...(await books.companiesForOrganizations([...orgIds]))])];
}

const day = (value: unknown) => (typeof value === "string" && value ? new Date(`${value.slice(0, 10)}T23:59:59.999Z`) : undefined);

function fail(res: { status: (c: number) => { json: (b: unknown) => void } }, e: unknown) {
  res.status(400).json({ success: false, error: (e as Error).message });
}

const TB_MODES = ["STANDARD", "UNADJUSTED", "ADJUSTED", "POST_CLOSING", "COMPARATIVE", "COLUMNS"] as const;

booksRouter.get("/trial-balance", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    const format = exportFormat(req.query.format);
    const mode = typeof req.query.mode === "string" && req.query.mode ? req.query.mode.toUpperCase() : "STANDARD";
    if (!(TB_MODES as readonly string[]).includes(mode)) throw new Error(`mode must be one of ${TB_MODES.join(", ")}`);
    const asOf = queryDay(req.query.to ?? req.query.asOf, "end", "to");
    const compareAsOf = queryDay(req.query.compareAsOf, "end", "compareAsOf");
    const from = queryDay(req.query.from, "start", "from");
    const data = await books.getTrialBalance(req.companyId!, { mode: mode as (typeof TB_MODES)[number], asOf, compareAsOf, from, dims: queryDims(req.query) });
    if (format) return await sendReport(res, await reportDocs.trialBalanceDocument(req.companyId!, data, asOf, compareAsOf), format);
    res.json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/statements", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    const format = exportFormat(req.query.format);
    const parts = typeof req.query.statement === "string" && req.query.statement ? req.query.statement.split(",") : [...reportDocs.STATEMENT_PARTS];
    const unknown = parts.filter((p) => !(reportDocs.STATEMENT_PARTS as readonly string[]).includes(p));
    if (unknown.length) throw new Error(`statement must be any of ${reportDocs.STATEMENT_PARTS.join(", ")}`);
    const data = await books.getStatements(req.companyId!, queryDay(req.query.to ?? req.query.asOf, "end", "to"), {
      from: queryDay(req.query.from, "start", "from"),
      compareFrom: queryDay(req.query.compareFrom, "start", "compareFrom"),
      compareTo: queryDay(req.query.compareTo, "end", "compareTo"),
    });
    if (format) return await sendReport(res, await reportDocs.statementsDocument(req.companyId!, data, parts as reportDocs.StatementPart[]), format);
    res.json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/periods", requireCapability("close:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listPeriods(req.companyId!) });
});

booksRouter.get("/close/checklist", requireCapability("close:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await close.closeChecklist(req.companyId!, String(req.query.periodId ?? "")) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/close/history", requireCapability("close:view"), async (req: AuthedRequest, res) => {
  const periodId = typeof req.query.periodId === "string" && req.query.periodId ? req.query.periodId : undefined;
  res.json({ success: true, data: await close.closeHistory(req.companyId!, periodId) });
});

booksRouter.post("/close", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), kind: z.enum(["MONTH", "YEAR"]) }).parse(req.body);
    res.json({ success: true, data: await close.closePeriod(req.companyId!, body.periodId, body.kind, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/close/request", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), kind: z.enum(["MONTH", "YEAR"]), note: z.string().max(500).optional() }).parse(req.body);
    res.status(201).json({ success: true, data: await close.requestClose(req.companyId!, body.periodId, body.kind, actor(req), body.note) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/close/overrides", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), item: z.enum(close.CLOSE_ITEMS), note: z.string() }).parse(req.body);
    res.status(201).json({ success: true, data: await close.overrideCloseItem(req.companyId!, body.periodId, body.item, body.note, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/close/overrides/remove", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), item: z.enum(close.CLOSE_ITEMS) }).parse(req.body);
    res.json({ success: true, data: await close.removeCloseOverride(req.companyId!, body.periodId, body.item, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/close/reopen", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), reason: z.string().min(3) }).parse(req.body);
    res.json({ success: true, data: await close.reopenPeriod(req.companyId!, body.periodId, body.reason, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/periods/:id/lock", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.lockPeriod(req.companyId!, req.params.id, true, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/periods/:id/unlock", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.lockPeriod(req.companyId!, req.params.id, false, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.put("/financial-years/:id/lock-date", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ lockDate: z.string().nullable() }).parse(req.body);
    const lockDate = body.lockDate ? new Date(`${body.lockDate.slice(0, 10)}T23:59:59.999Z`) : null;
    res.json({ success: true, data: await books.setTransactionLockDate(req.companyId!, req.params.id, lockDate, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/recurring", requireCapability("journal:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listRecurring(req.companyId!) });
});

booksRouter.post("/recurring", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
        nextRunDate: z.string(),
        autoPost: z.boolean().optional(),
        lines: z.array(z.object({ accountId: z.string(), debit: z.number(), credit: z.number(), description: z.string().optional() })).min(2),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await books.createRecurring(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/recurring/run", requireCapability("journal:post"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.runRecurring(req.companyId!, new Date(), actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/fx/rates", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listRates(req.companyId!) });
});

booksRouter.post("/fx/rates", requireCapability("fx:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ currency: z.string().length(3), rateDate: z.string(), rate: z.number().positive(), source: z.string().optional() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.saveRate(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/fx/revalue", requireCapability("fx:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ currency: z.string().length(3), asOf: z.string().optional() }).parse(req.body);
    res.json({ success: true, data: await books.revalueCurrency(req.companyId!, body.currency, actor(req), day(body.asOf)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/budgets", requireCapability("budget:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await budgets.listBudgets(req.companyId!) });
});

const budgetLine = z.object({
  accountId: z.string().min(1),
  amount: z.number().nonnegative(),
  periodSequence: z.number().int().min(0).optional(),
  costCentre: z.string().nullish(),
  project: z.string().nullish(),
  branchId: z.string().nullish(),
});

booksRouter.post("/budgets", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ name: z.string().trim().min(1), financialYearId: z.string().optional(), lines: z.array(budgetLine).min(1) }).parse(req.body);
    res.status(201).json({ success: true, data: await budgets.createBudget(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/budgets/:id", requireCapability("budget:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await budgets.getBudget(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.put("/budgets/:id", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).optional(), lines: z.array(budgetLine).min(1).optional() }).parse(req.body);
    res.json({ success: true, data: await budgets.updateBudget(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

for (const [action, run] of [
  ["submit", budgets.submitBudget],
  ["approve", budgets.approveBudget],
  ["activate", budgets.activateBudget],
  ["revise", budgets.reviseBudget],
] as const) {
  booksRouter.post(`/budgets/:id/${action}`, requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
    try {
      res.status(action === "revise" ? 201 : 200).json({ success: true, data: await run(req.companyId!, req.params.id, actor(req)) });
    } catch (e) {
      fail(res, e);
    }
  });
}

booksRouter.get("/budgets/:id/variance", requireCapability("budget:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await budgets.budgetVarianceReport(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/dimensions", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listDimensions(req.companyId!) });
});

booksRouter.post("/dimensions", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ kind: z.enum(["COST_CENTRE", "PROJECT"]), code: z.string().min(1), name: z.string().min(1) }).parse(req.body);
    res.status(201).json({ success: true, data: await books.createDimension(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/dimensions/report", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  const kind = z.enum(["COST_CENTRE", "PROJECT", "BRANCH"]).safeParse(req.query.kind ?? "COST_CENTRE");
  if (!kind.success) return res.status(400).json({ success: false, error: "kind must be COST_CENTRE, PROJECT or BRANCH" });
  const from = typeof req.query.from === "string" && req.query.from ? new Date(`${req.query.from.slice(0, 10)}T00:00:00.000Z`) : undefined;
  return res.json({ success: true, data: await books.dimensionReport(req.companyId!, kind.data, { from, to: day(req.query.to) }) });
});

booksRouter.patch("/dimensions/:id", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() }).parse(req.body);
    res.json({ success: true, data: await books.updateDimension(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/controls", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await risks.listControlsWithTests(req.companyId!) });
});

booksRouter.get("/controls/:id/tests", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await risks.listControlTests(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/controls/:id/tests", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ testedAt: z.string(), result: z.enum(["PASS", "FAIL"]), sampleSize: z.number().int().min(1).nullable().optional(), notes: z.string().max(4000).nullable().optional() })
      .parse(req.body);
    const testedAt = new Date(`${body.testedAt.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(testedAt.getTime())) throw new Error("A valid test date is required");
    res.status(201).json({ success: true, data: await risks.recordControlTest(req.companyId!, req.params.id, { ...body, testedAt }, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

const level = z.number().int().min(1).max(5);
const riskBody = z.object({
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(3).max(200),
  category: z.string().trim().min(1).max(80),
  description: z.string().max(4000).nullable().optional(),
  likelihood: level,
  impact: level,
  residualLikelihood: level.nullable().optional(),
  residualImpact: level.nullable().optional(),
  status: z.enum(risks.RISK_STATUSES).optional(),
  ownerName: z.string().max(120).nullable().optional(),
  ownerErpUserId: z.number().int().nullable().optional(),
  reviewDate: z.string().nullable().optional(),
  controlIds: z.array(z.string()).max(50).optional(),
});

booksRouter.get("/risks", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await risks.listRisks(req.companyId!) });
});

booksRouter.post("/risks", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = riskBody.parse(req.body);
    res.status(201).json({ success: true, data: await risks.createRisk(req.companyId!, { ...body, reviewDate: day(body.reviewDate) ?? null }, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.patch("/risks/:id", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const { reviewDate, ...body } = riskBody.omit({ code: true }).partial().parse(req.body);
    const input = reviewDate === undefined ? body : { ...body, reviewDate: day(reviewDate) ?? null };
    res.json({ success: true, data: await risks.updateRisk(req.companyId!, req.params.id, input, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/controls", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ code: z.string(), title: z.string(), category: z.string(), status: z.enum(["OPEN", "EFFECTIVE", "DEFICIENT"]).optional(), notes: z.string().optional() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.saveControl(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/approvals", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  const status = z.enum(["PENDING", "APPROVED", "REJECTED", "RETURNED"]).optional().safeParse(req.query.status || undefined);
  res.json({
    success: true,
    data: await approvals.listApprovals(req.companyId!, {
      status: status.success ? status.data : undefined,
      entityType: typeof req.query.entityType === "string" && req.query.entityType ? req.query.entityType : undefined,
      entityId: typeof req.query.entityId === "string" && req.query.entityId ? req.query.entityId : undefined,
    }),
  });
});

booksRouter.get("/approvals/queue", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await approvals.approvalQueue(req.companyId!, actor(req)) });
});

booksRouter.get("/approvals/:id", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await approvals.getApproval(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/approvals", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        entityType: z.enum(approvals.APPROVAL_ENTITY_TYPES).refine((t) => t !== "PeriodClose", "Request a period close from the close checklist"),
        entityId: z.string().min(1),
        amount: z.number().nonnegative(),
        reason: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await approvals.requestApproval(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

/** Capability to decide depends on the entity type and is checked by the approval service. */
booksRouter.post("/approvals/:id/decide", async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ status: z.enum(["APPROVED", "REJECTED", "RETURNED"]), note: z.string().optional() }).parse(req.body);
    res.json({ success: true, data: await approvals.decideApproval(req.companyId!, req.params.id, body.status, actor(req), body.note) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/approvals/:id/resubmit", async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await approvals.resubmitApproval(req.companyId!, req.params.id, actor(req), { note: body.note }) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/notifications", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await notifications.listNotifications(req.companyId!, actor(req)) });
});

booksRouter.get("/notifications/unread-count", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await notifications.unreadCount(req.companyId!, actor(req)) });
});

booksRouter.get("/notifications/settings", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await notifications.getNotificationSettings(req.companyId!) });
});

booksRouter.put("/notifications/settings", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ emailEnabled: z.boolean(), emailMinSeverity: z.enum(["INFO", "WARNING", "CRITICAL"]) }).parse(req.body);
    res.json({ success: true, data: await notifications.saveNotificationSettings(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/notifications/read-all", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await notifications.markAllRead(req.companyId!, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/notifications/:id/read", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await notifications.markNotificationRead(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/documents", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  try {
    res.json({ success: true, data: await documents.listDocuments(req.companyId!, entityType, entityId, actor(req)) });
  } catch (e) {
    documentFail(res, e);
  }
});

function documentFail(res: Response, e: unknown) {
  if (e instanceof documents.DocumentError) return res.status(e.status).json({ success: false, error: e.message });
  if (e instanceof multer.MulterError) {
    const error = e.code === "LIMIT_FILE_SIZE" ? `Files can be at most ${Math.floor(env.documentMaxBytes / (1024 * 1024))} MB` : e.message;
    return res.status(e.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, error });
  }
  return fail(res, e);
}

/** Fields must come before the file, so a caller who may not attach is refused before the file is buffered. */
function receiveFile(req: AuthedRequest, res: Response) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.documentMaxBytes, files: 1, fields: 10, parts: 11, fieldSize: 4096 },
    defParamCharset: "utf8",
    fileFilter: (_req, _file, cb) => {
      try {
        documents.assertCanAttach(req.body?.entityType, actor(req));
        cb(null, true);
      } catch (e) {
        cb(e as Error);
      }
    },
  }).single("file");
  return new Promise<void>((resolve, reject) => upload(req, res, (err: unknown) => (err ? reject(err) : resolve())));
}

booksRouter.post("/documents/upload", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    await receiveFile(req, res);
    const body = z.object({ entityType: z.string(), entityId: z.string().min(1).max(64), note: z.string().max(500).optional() }).parse(req.body);
    res.status(201).json({ success: true, data: await documents.uploadDocument(req.companyId!, body, req.file, actor(req)) });
  } catch (e) {
    documentFail(res, e);
  }
});

booksRouter.get("/documents/:id/download", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    const { doc, stream } = await documents.openDocument(req.companyId!, req.params.id, actor(req));
    res.on("close", () => stream.destroy());
    res.setHeader("Content-Type", doc.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", documents.contentDisposition(doc.fileName));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    if (doc.sizeBytes != null) res.setHeader("Content-Length", String(doc.sizeBytes));
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    documentFail(res, e);
  }
});

booksRouter.delete("/documents/:id", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await documents.deleteDocument(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    documentFail(res, e);
  }
});

booksRouter.post("/documents", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ entityType: z.string(), entityId: z.string(), fileName: z.string(), note: z.string().optional(), contentText: z.string().optional() }).parse(req.body);
    const entityType = await documents.referenceTarget(req.companyId!, body.entityType, body.entityId, actor(req));
    res.status(201).json({ success: true, data: await books.addDocument(req.companyId!, { ...body, entityType }, actor(req)) });
  } catch (e) {
    documentFail(res, e);
  }
});

booksRouter.post("/import/journal", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ csv: z.string().min(1), journalDate: z.string() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.importJournalCsv(req.companyId!, body.csv, body.journalDate, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/groups", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listGroups(req.companyId!) });
});

booksRouter.post("/groups", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        members: z.array(z.object({ name: z.string().min(1), companyId: z.string().optional(), ownershipPercent: z.number().gt(0).max(100).optional() })).min(1),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await books.createGroup(req.companyId!, body, await readableCompanies(req), actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/groups/:id/eliminations", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        description: z.string().min(1),
        lines: z.array(z.object({ accountCode: z.string().min(1), debit: z.number().nonnegative(), credit: z.number().nonnegative() })).min(2),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await books.addElimination(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/groups/:id/consolidate", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.consolidateGroup(req.companyId!, req.params.id, await readableCompanies(req), day(req.query.asOf)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/kpis", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await insights.kpiReport(req.companyId!, { from: queryDay(req.query.from, "start", "from"), to: queryDay(req.query.to, "end", "to") }) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.put("/kpis/targets/:code", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ target: z.number().finite().nullable() }).parse(req.body);
    res.json({ success: true, data: await insights.saveKpiTarget(req.companyId!, req.params.code, body.target, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

const scenarioSchema = z.object({ revenue: z.number().min(0.1).max(3), expenses: z.number().min(0.1).max(3) });

booksRouter.post("/forecast", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        horizonMonths: z.number().int().min(1).max(36),
        scenarios: z.object({ BEST: scenarioSchema, BASE: scenarioSchema, WORST: scenarioSchema }).partial().optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await insights.createForecast(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/forecasts", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await insights.listForecasts(req.companyId!) });
});

booksRouter.get("/forecasts/:id/vs-actual", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    const scenario = z.enum(["BEST", "BASE", "WORST"]).default("BASE").parse(req.query.scenario || undefined);
    res.json({ success: true, data: await insights.forecastAgainstActual(req.companyId!, req.params.id, scenario) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/anomalies", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  try {
    const status = z.enum(["OPEN", "INVESTIGATING", "CONFIRMED", "DISMISSED"]).optional().parse(req.query.status || undefined);
    res.json({ success: true, data: await insights.listAnomalies(req.companyId!, status) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/anomalies/scan", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await insights.scanAnomalies(req.companyId!, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/anomalies/:id/notes", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ note: z.string().trim().min(3).max(2000) }).parse(req.body);
    res.status(201).json({ success: true, data: await insights.addAnomalyNote(req.companyId!, req.params.id, body.note, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/anomalies/:id/resolve", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ status: z.enum(["CONFIRMED", "DISMISSED"]), reason: z.string().trim().min(3).max(2000) }).parse(req.body);
    res.json({ success: true, data: await insights.resolveAnomaly(req.companyId!, req.params.id, body.status, body.reason, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/integrity", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await integrity.latestIntegrityScan(req.companyId!) });
});

booksRouter.post("/integrity/run", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await integrity.recordIntegrityScan(req.companyId!, "MANUAL", actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/anomalies/:id/dismiss", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ reason: z.string().trim().min(3).max(2000) }).parse(req.body ?? {});
    res.json({ success: true, data: await insights.resolveAnomaly(req.companyId!, req.params.id, "DISMISSED", body.reason, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/esg", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listEsg(req.companyId!) });
});

booksRouter.post("/esg", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ period: z.string(), code: z.string(), name: z.string(), value: z.number(), unit: z.string() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.saveEsg(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/workflows", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listWorkflows(req.companyId!) });
});

booksRouter.post("/workflows", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ name: z.string(), steps: z.array(z.string()).min(1) }).parse(req.body);
    res.status(201).json({ success: true, data: await books.createWorkflow(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/workflows/:id/start", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ entityType: z.string(), entityId: z.string() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.startWorkflow(req.companyId!, req.params.id, body.entityType, body.entityId, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/workflows/instances/:id/advance", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.advanceWorkflow(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/api-keys", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listApiKeys(req.companyId!) });
});

booksRouter.post("/api-keys", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        scopes: z.array(z.enum(API_KEY_SCOPES)).optional(),
        expiresAt: z.string().optional(),
        rateLimitPerMinute: z.number().int().min(1).max(6000).optional(),
      })
      .parse(req.body);
    const data = await books.issueApiKey(req.companyId!, { ...body, expiresAt: day(body.expiresAt) }, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.patch("/api-keys/:id", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ rateLimitPerMinute: z.number().int().min(1).max(6000) }).parse(req.body);
    res.json({ success: true, data: await books.setApiKeyRateLimit(req.companyId!, req.params.id, body.rateLimitPerMinute, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/api-keys/:id/usage", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.apiKeyUsage(req.companyId!, req.params.id, Number(req.query.limit) || 100) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/api-keys/:id/revoke", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.revokeApiKey(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/webhooks", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: { events: webhooks.WEBHOOK_EVENTS, endpoints: await webhooks.listWebhooks(req.companyId!) } });
});

const webhookBody = z.object({
  url: z.string().trim().min(8).max(500),
  events: z.array(z.string()).min(1).max(webhooks.WEBHOOK_EVENTS.length),
  description: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

booksRouter.post("/webhooks", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = webhookBody.omit({ isActive: true }).parse(req.body);
    res.status(201).json({ success: true, data: await webhooks.createWebhook(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.patch("/webhooks/:id", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = webhookBody.partial().parse(req.body);
    res.json({ success: true, data: await webhooks.updateWebhook(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.delete("/webhooks/:id", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await webhooks.deleteWebhook(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/webhooks/:id/deliveries", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await webhooks.listDeliveries(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/webhooks/:id/ping", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await webhooks.pingWebhook(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/signatures", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ entityType: z.string(), entityId: z.string(), statement: z.string().trim().min(3).max(1000) }).parse(req.body);
    res.status(201).json({ success: true, data: await signatures.recordSignature(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/signatures", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  try {
    const q = z.object({ entityType: z.string().optional(), entityId: z.string().optional() }).parse(req.query);
    res.json({ success: true, data: await signatures.listSignatures(req.companyId!, q) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/signatures/:id/verify", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await signatures.verifySignature(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/automation", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listAutomation(req.companyId!) });
});

booksRouter.post("/automation", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ name: z.string(), jobType: z.enum(["RECURRING_JOURNALS", "ANOMALY_SCAN", "FX_REVALUE"]), schedule: z.string() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.createAutomation(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/automation/:id/run", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.runAutomation(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/assistant", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ question: z.string().trim().min(2).max(500) }).parse(req.body);
    res.json({ success: true, data: await insights.askAssistant(req.companyId!, body.question) });
  } catch (e) {
    fail(res, e);
  }
});

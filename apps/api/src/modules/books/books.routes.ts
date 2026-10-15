import { Router } from "express";
import { z } from "zod";
import { API_KEY_SCOPES, AuthedRequest, authenticate, requireCapability, resolveCompany } from "../../middleware/auth";
import * as books from "./books.service";

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

booksRouter.get("/trial-balance", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  const mode = typeof req.query.mode === "string" ? (req.query.mode as never) : "STANDARD";
  const asOf = typeof req.query.asOf === "string" ? new Date(req.query.asOf) : undefined;
  const compareAsOf = typeof req.query.compareAsOf === "string" ? new Date(req.query.compareAsOf) : undefined;
  res.json({ success: true, data: await books.getTrialBalance(req.companyId!, { mode, asOf, compareAsOf }) });
});

booksRouter.get("/statements", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  const asOf = typeof req.query.asOf === "string" ? new Date(req.query.asOf) : undefined;
  res.json({ success: true, data: await books.getStatements(req.companyId!, asOf) });
});

booksRouter.get("/periods", requireCapability("close:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listPeriods(req.companyId!) });
});

booksRouter.get("/close/checklist", requireCapability("close:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.closeChecklist(req.companyId!, String(req.query.periodId ?? "")) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/close", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), kind: z.enum(["MONTH", "YEAR"]) }).parse(req.body);
    res.json({ success: true, data: await books.closePeriod(req.companyId!, body.periodId, body.kind, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/close/reopen", requireCapability("close:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ periodId: z.string(), reason: z.string().min(3) }).parse(req.body);
    res.json({ success: true, data: await books.reopenPeriod(req.companyId!, body.periodId, body.reason, actor(req)) });
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
    res.status(201).json({ success: true, data: await books.saveRate(req.companyId!, body) });
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
  res.json({ success: true, data: await books.listBudgets(req.companyId!) });
});

booksRouter.post("/budgets", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        financialYearId: z.string().optional(),
        lines: z.array(z.object({ accountId: z.string(), amount: z.number(), periodSequence: z.number().optional(), costCentre: z.string().optional(), project: z.string().optional() })).min(1),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await books.createBudget(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/budgets/:id/approve", requireCapability("budget:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.approveBudget(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/budgets/:id/variance", requireCapability("budget:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.budgetVarianceReport(req.companyId!, req.params.id) });
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
    res.status(201).json({ success: true, data: await books.createDimension(req.companyId!, body) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/dimensions/report", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.dimensionReport(req.companyId!) });
});

booksRouter.get("/controls", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listControls(req.companyId!) });
});

booksRouter.post("/controls", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ code: z.string(), title: z.string(), category: z.string(), status: z.enum(["OPEN", "EFFECTIVE", "DEFICIENT"]).optional(), notes: z.string().optional() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.saveControl(req.companyId!, body) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/approvals", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listApprovals(req.companyId!) });
});

booksRouter.post("/approvals", requireCapability("journal:create"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ entityType: z.enum(books.APPROVAL_ENTITY_TYPES), entityId: z.string().min(1), amount: z.number().nonnegative(), reason: z.string().optional() })
      .parse(req.body);
    res.status(201).json({ success: true, data: await books.requestApproval(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.post("/approvals/:id/decide", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ status: z.enum(["APPROVED", "REJECTED"]) }).parse(req.body);
    res.json({ success: true, data: await books.decideApproval(req.companyId!, req.params.id, body.status, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/notifications", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listNotifications(req.companyId!) });
});

booksRouter.post("/notifications/:id/read", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.markNotificationRead(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/documents", requireCapability("platform:view"), async (req: AuthedRequest, res) => {
  res.json({
    success: true,
    data: await books.listDocuments(req.companyId!, typeof req.query.entityType === "string" ? req.query.entityType : undefined, typeof req.query.entityId === "string" ? req.query.entityId : undefined),
  });
});

booksRouter.post("/documents", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ entityType: z.string(), entityId: z.string(), fileName: z.string(), note: z.string().optional(), contentText: z.string().optional() }).parse(req.body);
    res.status(201).json({ success: true, data: await books.addDocument(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
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
    res.status(201).json({ success: true, data: await books.createGroup(req.companyId!, body, await readableCompanies(req)) });
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
    res.status(201).json({ success: true, data: await books.addElimination(req.companyId!, req.params.id, body) });
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

booksRouter.post("/forecast", requireCapability("report:view"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ name: z.string(), horizonMonths: z.number().int().min(1).max(36) }).parse(req.body);
    res.status(201).json({ success: true, data: await books.createForecast(req.companyId!, body.name, body.horizonMonths) });
  } catch (e) {
    fail(res, e);
  }
});

booksRouter.get("/anomalies", requireCapability("control:view"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.listAnomalies(req.companyId!) });
});

booksRouter.post("/anomalies/scan", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await books.scanAnomalies(req.companyId!) });
});

booksRouter.post("/anomalies/:id/dismiss", requireCapability("control:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await books.dismissAnomaly(req.companyId!, req.params.id) });
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
    res.status(201).json({ success: true, data: await books.saveEsg(req.companyId!, body) });
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
    res.status(201).json({ success: true, data: await books.createWorkflow(req.companyId!, body) });
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
      .object({ name: z.string().min(1), scopes: z.array(z.enum(API_KEY_SCOPES)).optional(), expiresAt: z.string().optional() })
      .parse(req.body);
    const data = await books.issueApiKey(req.companyId!, { name: body.name, scopes: body.scopes, expiresAt: day(body.expiresAt) }, actor(req));
    res.status(201).json({ success: true, data });
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

booksRouter.post("/signatures", requireCapability("platform:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ entityType: z.string(), entityId: z.string(), statement: z.string().min(3) }).parse(req.body);
    res.status(201).json({ success: true, data: await books.signDocument(req.companyId!, body, actor(req)) });
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
    res.status(201).json({ success: true, data: await books.createAutomation(req.companyId!, body) });
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
    const body = z.object({ question: z.string().min(2) }).parse(req.body);
    res.json({ success: true, data: await books.askAssistant(req.companyId!, body.question) });
  } catch (e) {
    fail(res, e);
  }
});

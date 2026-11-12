import { hasCapability } from "@exceledge/accounting-domain";
import { Router } from "express";
import { z } from "zod";
import { actorOf, handle, isoDay } from "../../lib/http";
import { type AuthedRequest, authenticateErpJwt, requireCapability, resolveCompany } from "../../middleware/auth";
import { nextNumbers } from "../commercial/commercial.service";
import * as projects from "./projects.service";
import * as team from "./team.service";
import { listTransactions } from "./transactions.service";
import * as workspace from "./workspace.service";

const roleOf = (req: AuthedRequest) => req.organizationRole ?? req.erpUser?.role;
const userOf = (req: AuthedRequest) => ({ userId: req.erpUser!.userId, role: roleOf(req) });
const str = (q: unknown) => (typeof q === "string" && q.trim() ? q.trim() : undefined);

/* ── Projects ─────────────────────────────────────────────────────────────────── */

export const projectsRouter = Router();
projectsRouter.use(authenticateErpJwt, requireCapability("project:view"), resolveCompany);
const manageProjects = requireCapability("project:manage");

projectsRouter.get("/", handle((req) => projects.listProjects(req.companyId!)));
projectsRouter.get("/:id", handle((req) => projects.getProject(req.companyId!, req.params.id)));
projectsRouter.get("/:id/financials", handle((req) => projects.projectFinancials(req.companyId!, req.params.id)));
projectsRouter.put("/:id", manageProjects, handle((req) => projects.saveProject(req.companyId!, req.params.id, projects.projectBody.parse(req.body), actorOf(req))));
projectsRouter.delete("/:id", manageProjects, handle((req) => projects.deleteProject(req.companyId!, req.params.id, actorOf(req))));
projectsRouter.post("/:id/links", manageProjects, handle((req) => projects.linkTransactions(req.companyId!, req.params.id, projects.linkBody.parse(req.body).links, actorOf(req))));
projectsRouter.delete("/:id/links/:kind/:sourceId", manageProjects, handle((req) => projects.unlinkTransaction(req.companyId!, req.params.id, req.params.kind, req.params.sourceId, actorOf(req))));

/* ── Tasks ────────────────────────────────────────────────────────────────────── */

export const tasksRouter = Router();
tasksRouter.use(authenticateErpJwt, requireCapability("project:view"), resolveCompany);
tasksRouter.get("/", handle((req) => projects.listTasks(req.companyId!)));
tasksRouter.put("/:id", manageProjects, handle((req) => projects.saveTask(req.companyId!, req.params.id, projects.taskBody.parse(req.body), actorOf(req))));
tasksRouter.delete("/:id", manageProjects, handle((req) => projects.deleteTask(req.companyId!, req.params.id, actorOf(req))));

/* ── Team ─────────────────────────────────────────────────────────────────────── */

export const teamRouter = Router();
teamRouter.use(authenticateErpJwt, requireCapability("team:view"), resolveCompany);
const manageTeam = requireCapability("team:manage");
const canSeePrivate = (req: AuthedRequest) => hasCapability(roleOf(req), "team:manage");

teamRouter.get("/employees", handle((req) => team.listEmployees(req.companyId!, canSeePrivate(req))));
teamRouter.get("/employees/:id", handle((req) => team.getEmployee(req.companyId!, req.params.id, canSeePrivate(req))));
teamRouter.put("/employees/:id", manageTeam, handle((req) => team.saveEmployee(req.companyId!, req.params.id, team.employeeBody.parse(req.body), actorOf(req))));
teamRouter.delete("/employees/:id", manageTeam, handle((req) => team.deleteEmployee(req.companyId!, req.params.id, actorOf(req))));

teamRouter.get(
  "/time",
  handle((req) => {
    const q = z.object({ from: isoDay.optional(), to: isoDay.optional() }).parse({ from: str(req.query.from), to: str(req.query.to) });
    return team.listTime(req.companyId!, { ...q, employeeId: str(req.query.employeeId), projectId: str(req.query.projectId) });
  }),
);
teamRouter.post("/time", handle((req) => team.createTime(req.companyId!, team.timeBody.parse(req.body), actorOf(req)), 201));
teamRouter.post("/time/weekly", handle((req) => team.createWeekly(req.companyId!, team.weeklyBody.parse(req.body), actorOf(req)), 201));
teamRouter.delete("/time/:id", manageTeam, handle((req) => team.deleteTime(req.companyId!, req.params.id, actorOf(req))));

/* ── Workspace: the whole-company transaction list and saved screen state ─────── */

export const workspaceRouter = Router();
workspaceRouter.use(authenticateErpJwt, resolveCompany);

/** Everything the screens load on sign-in; each part appears only for roles allowed to see it. */
workspaceRouter.get(
  "/bootstrap",
  handle(async (req) => {
    const role = roleOf(req);
    const [collections, numbers] = await Promise.all([workspace.bootstrap(req.companyId!, userOf(req)), nextNumbers(req.companyId!)]);
    return {
      collections,
      nextNumbers: numbers,
      projects: hasCapability(role, "project:view") ? await projects.listProjects(req.companyId!) : [],
      tasks: hasCapability(role, "project:view") ? await projects.listTasks(req.companyId!) : [],
      transactions: hasCapability(role, "report:view") ? (await listTransactions(req.companyId!, { pageSize: 2000 })).rows : [],
    };
  }),
);

workspaceRouter.get(
  "/transactions",
  requireCapability("report:view"),
  handle((req) => {
    const q = z
      .object({ from: isoDay.optional(), to: isoDay.optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(2000).optional() })
      .parse({ from: str(req.query.from), to: str(req.query.to), page: str(req.query.page), pageSize: str(req.query.pageSize) });
    return listTransactions(req.companyId!, { ...q, kind: str(req.query.kind), projectId: str(req.query.projectId), q: str(req.query.q) });
  }),
);

const recordId = z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/, "Invalid record id");

workspaceRouter.get("/records/:collection", handle((req) => workspace.listRecords(req.companyId!, req.params.collection, userOf(req))));
workspaceRouter.put("/records/:collection/:id", handle((req) => workspace.saveRecord(req.companyId!, req.params.collection, recordId.parse(req.params.id), req.body, userOf(req))));
workspaceRouter.delete("/records/:collection/:id", handle((req) => workspace.deleteRecord(req.companyId!, req.params.collection, recordId.parse(req.params.id), userOf(req))));

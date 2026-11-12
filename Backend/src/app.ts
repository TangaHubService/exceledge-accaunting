import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Router } from "express";
import "express-async-errors";
import { env } from "./config/env";
import { apRouter } from "./modules/ap/ap.routes";
import { arRouter } from "./modules/ar/ar.routes";
import { auditRouter } from "./modules/audit/audit.routes";
import { coaRouter } from "./modules/coa/coa.routes";
import { exceptionsRouter, integrationRouter } from "./modules/integration/integration.routes";
import { bankingRouter } from "./modules/banking/banking.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { taxRouter } from "./modules/tax/tax.routes";
import { expenseRouter } from "./modules/expense/expense.routes";
import { booksRouter } from "./modules/books/books.routes";
import { faRouter } from "./modules/fixed-assets/fa.routes";
import { journalsRouter } from "./modules/journals/journal.routes";
import { glRouter } from "./modules/gl/gl.routes";
import { setupRouter } from "./modules/setup/setup.routes";
import { commercialRouter } from "./modules/commercial/commercial.routes";
import { projectsRouter, tasksRouter, teamRouter, workspaceRouter } from "./modules/workspace/workspace.routes";
import { prisma } from "./lib/prisma";
import { processPendingEvents } from "./modules/integration/integration.service";
import { openApiDocument } from "./modules/platform/openapi";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);
  app.use((req, res, next) => {
    const requestId = (typeof req.headers["x-request-id"] === "string" && /^[\w-]{8,64}$/.test(req.headers["x-request-id"]) && req.headers["x-request-id"]) || randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (env.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    (req as express.Request & { requestId?: string }).requestId = requestId;
    next();
  });
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin }));
  app.use("/api/v1/banking", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      service: "exceledge-accounting-api",
      phase: 20,
      status: "ok",
    });
  });

  const mounts: Array<[string, Router]> = [
    ["/api/v1/setup", setupRouter],
    ["/api/v1/coa", coaRouter],
    ["/api/v1/ar", arRouter],
    ["/api/v1/ap", apRouter],
    ["/api/v1/inventory", inventoryRouter],
    ["/api/v1/banking", bankingRouter],
    ["/api/v1/tax", taxRouter],
    ["/api/v1/expenses", expenseRouter],
    ["/api/v1/fixed-assets", faRouter],
    ["/api/v1/journals", journalsRouter],
    ["/api/v1/gl", glRouter],
    ["/api/v1/integration", integrationRouter],
    ["/api/v1/exceptions", exceptionsRouter],
    ["/api/v1/audit", auditRouter],
    ["/api/v1/books", booksRouter],
    ["/api/v1/commercial", commercialRouter],
    ["/api/v1/projects", projectsRouter],
    ["/api/v1/tasks", tasksRouter],
    ["/api/v1/team", teamRouter],
    ["/api/v1/workspace", workspaceRouter],
  ];
  /** For load balancers: unlike /health, this fails when the database can't be reached. */
  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ success: true, status: "ready" });
    } catch (e) {
      console.error("[ready]", e);
      res.status(503).json({ success: false, status: "database unavailable" });
    }
  });

  let openApi: unknown;
  app.get("/api/v1/openapi.json", (_req, res) => {
    openApi ??= openApiDocument(mounts);
    res.json(openApi);
  });
  for (const [path, router] of mounts) app.use(path, router);

  app.use((req, res) => {
    res.status(404).json({ success: false, error: `No route for ${req.method} ${req.path}` });
  });

  app.use((err: Error & { status?: number; type?: string }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Body-parser refusals are the caller's mistake, not a server fault.
    if (err.type === "entity.parse.failed") return res.status(400).json({ success: false, error: "The request body isn't valid JSON" });
    if (err.type === "entity.too.large") return res.status(413).json({ success: false, error: "The request body is too large" });
    console.error(`[${(req as express.Request & { requestId?: string }).requestId ?? "-"}]`, err);
    res.status(500).json({ success: false, error: "Internal server error" });
  });

  return app;
}

/** Optional in-process retry worker for failed integration events */
export function startIntegrationWorker(intervalMs = 60_000) {
  const timer = setInterval(() => {
    processPendingEvents(25).catch((e) => console.error("[integration-worker]", e));
  }, intervalMs);
  return timer;
}

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
import { processPendingEvents } from "./modules/integration/integration.service";
import { openApiDocument } from "./modules/platform/openapi";

export function createApp() {
  const app = express();
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
  ];
  let openApi: unknown;
  app.get("/api/v1/openapi.json", (_req, res) => {
    openApi ??= openApiDocument(mounts);
    res.json(openApi);
  });
  for (const [path, router] of mounts) app.use(path, router);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
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

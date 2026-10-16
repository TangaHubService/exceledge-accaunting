import cors from "cors";
import express from "express";
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
import { faRouter } from "./modules/fixed-assets/fa.routes";
import { journalsRouter } from "./modules/journals/journal.routes";
import { glRouter } from "./modules/gl/gl.routes";
import { setupRouter } from "./modules/setup/setup.routes";
import { processPendingEvents } from "./modules/integration/integration.service";

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin }));
  app.use("/api/v1/banking", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      service: "exceledge-accounting-api",
      phase: 10,
      status: "ok",
    });
  });

  app.use("/api/v1/setup", setupRouter);
  app.use("/api/v1/coa", coaRouter);
  app.use("/api/v1/ar", arRouter);
  app.use("/api/v1/ap", apRouter);
  app.use("/api/v1/inventory", inventoryRouter);
  app.use("/api/v1/banking", bankingRouter);
  app.use("/api/v1/tax", taxRouter);
  app.use("/api/v1/expenses", expenseRouter);
  app.use("/api/v1/fixed-assets", faRouter);
  app.use("/api/v1/journals", journalsRouter);
  app.use("/api/v1/gl", glRouter);
  app.use("/api/v1/integration", integrationRouter);
  app.use("/api/v1/exceptions", exceptionsRouter);
  app.use("/api/v1/audit", auditRouter);

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

import { createApp, startIntegrationWorker } from "./app";
import { env } from "./config/env";
import { autonomousPrisma } from "./lib/prisma";
import { startScheduler } from "./modules/books/scheduler";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`Accounting API listening on :${env.port}`);
  if (env.nodeEnv !== "test") {
    startIntegrationWorker();
    startScheduler();
  }
});

/** Lets requests in flight finish, so a deploy never cuts a posting transaction short. */
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  server.close(() => {
    autonomousPrisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

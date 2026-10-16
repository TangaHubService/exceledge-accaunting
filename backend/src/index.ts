import { createApp, startIntegrationWorker } from "./app";
import { env } from "./config/env";
import { startScheduler } from "./modules/books/scheduler";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Accounting API listening on :${env.port}`);
  if (env.nodeEnv !== "test") {
    startIntegrationWorker();
    startScheduler();
  }
});

import { createApp, startIntegrationWorker } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Accounting API listening on :${env.port}`);
  if (env.nodeEnv !== "test") {
    startIntegrationWorker();
  }
});

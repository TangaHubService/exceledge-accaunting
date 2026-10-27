import cron from "node-cron";
import {
  isAccountingIntegrationEnabled,
  processAccountingOutboxBatch,
} from "../services/accounting-outbox.service";

/**
 * Deliver ERP accounting outbox events to the Accounting microservice.
 */
export const accountingOutboxJob = cron.schedule("*/2 * * * *", async () => {
  if (!isAccountingIntegrationEnabled()) return;
  try {
    const { processed, succeeded, failed } = await processAccountingOutboxBatch(40);
    if (processed > 0) {
      console.log(
        `[Accounting outbox] processed=${processed} succeeded=${succeeded} failed=${failed}`,
      );
    }
  } catch (e) {
    console.error("[Accounting outbox] job error:", e);
  }
});

import cron from 'node-cron';
import { isEbmEnabled, processEbmOutboxBatch } from '../services/ebm-outbox.service';

/**
 * Process the EBM transactional outbox every 2 minutes.
 * Handles PENDING, PROCESSING (orphan reconciliation), and FAILED retries.
 */
export const ebmOutboxJob = cron.schedule('*/2 * * * *', async () => {
  if (!isEbmEnabled()) {
    return;
  }
  try {
    const { processed, succeeded, failed } = await processEbmOutboxBatch(40);
    if (processed > 0) {
      console.log(`[EBM outbox] processed=${processed} succeeded=${succeeded} failed=${failed}`);
    }
  } catch (e) {
    console.error('[EBM outbox] job error:', e);
  }
});

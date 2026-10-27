import cron from 'node-cron';
import { isEbmEnabled } from '../services/rra-ebm.service';
import { processStockSyncBatch } from '../services/stock-movement-sync.service';
import logger from '../utils/logger';

/**
 * Push queued (non-sale) inventory movements to the VSDC as Stock In/Out
 * records + Stock Master updates (RRA checklist §72/§73). Runs every 5 minutes
 * as a backstop; movement write paths mark rows PENDING and this drains them.
 */
export const stockSyncJob = cron.schedule('*/5 * * * *', async () => {
  if (!isEbmEnabled()) return;
  try {
    const result = await processStockSyncBatch(50);
    if (result.processed > 0) {
      logger.info(`[STOCK-SYNC] processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} deferred=${result.deferred}`);
    }
  } catch (e) {
    logger.error('[STOCK-SYNC] job failed', e);
  }
});

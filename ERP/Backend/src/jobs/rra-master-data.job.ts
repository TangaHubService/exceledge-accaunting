import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { isEbmEnabled } from '../services/rra-ebm.service';
import { syncAllRraMasterData } from '../services/rra-master-data.service';
import { syncRraPurchases } from '../services/purchase-sync.service';
import { syncRraImports } from '../services/rra-import.service';
import logger from '../utils/logger';

/**
 * Daily incremental pull of the RRA VSDC master data every EBM-enabled
 * organisation depends on — Codes (§59), item classifications / UNSPSC (§61)
 * and notices (§65). Each sync is incremental (sends the stored `lastReqDt`),
 * so a daily cadence keeps the local caches fresh without re-pulling
 * everything. Runs early morning, before trading, at a different minute from
 * the Z-report job.
 */
export const rraMasterDataJob = cron.schedule('20 4 * * *', async () => {
  if (!isEbmEnabled()) return;

  try {
    const organizations = await prisma.organization.findMany({
      where: {
        isActive: true,
        TIN: { not: null },
        OR: [{ ebmDeviceId: { not: null } }, { ebmSerialNo: { not: null } }],
      },
      select: { id: true, TIN: true },
    });

    let ok = 0;
    let failed = 0;
    for (const org of organizations) {
      try {
        const outcomes = await syncAllRraMasterData(org.id);
        // §70: also pull the day's B2B purchases issued to this taxpayer.
        await syncRraPurchases(org.id).catch((e) => logger.warn(`[RRA-MASTER-DATA] org ${org.id} purchases pull failed`, e));
        // §66: pull any new import-declaration lines (cursor-driven — no manual request date here).
        await syncRraImports(org.id).catch((e) => logger.warn(`[RRA-MASTER-DATA] org ${org.id} imports pull failed`, e));
        const bad = outcomes.filter((o) => !o.ok);
        if (bad.length) {
          failed += 1;
          logger.warn(`[RRA-MASTER-DATA] org ${org.id}: ${bad.map((b) => `${b.resource}=${b.error}`).join(', ')}`);
        } else {
          ok += 1;
        }
      } catch (e) {
        failed += 1;
        logger.error(`[RRA-MASTER-DATA] org ${org.id} sync error`, e);
      }
    }

    if (ok || failed) {
      logger.info(`[RRA-MASTER-DATA] daily sync: ok=${ok} failed=${failed}`);
    }
  } catch (e) {
    logger.error('[RRA-MASTER-DATA] job failed', e);
  }
});

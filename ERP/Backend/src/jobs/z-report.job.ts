import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { isEbmEnabled } from '../services/rra-ebm.service';
import { buildVsdcEnvelope, saveAndVerifyZReport, listActiveVsdcDevices } from '../services/vsdc-api.service';

/** One rra_sync_cursor row per VSDC device holds the last Z-close outcome. */
function zReportResource(branchId: number | null): string {
  return branchId != null ? `zReport:${branchId}` : 'zReport';
}

/**
 * Automated daily Z (closing) report — RRA CIS/VSDC spec §6/§18/§19 requires
 * the device's daily counters to be legally closed out once per business day.
 * Filed per VSDC device (per branch, with the org-level fallback for legacy
 * single-branch tenants). Training-mode orgs are skipped — there is no real
 * day to close.
 *
 * Each close is save + verify (`saveAndVerifyZReport`): the day is only counted
 * as closed once `/reports/checkZReport` confirms RRA has it. The outcome is
 * persisted to `rra_sync_cursors` (resource `zReport:<branchId>`) so there is
 * durable certification evidence and the operator can spot a device that saved
 * but did not verify.
 */
export const zReportJob = cron.schedule('55 23 * * *', async () => {
  if (!isEbmEnabled()) {
    return;
  }

  try {
    const devices = await listActiveVsdcDevices();
    let verified = 0;
    let savedUnverified = 0;
    let failed = 0;

    for (const dev of devices) {
      try {
        const envelope = await buildVsdcEnvelope(dev.organizationId, dev.branchId);
        const z = await saveAndVerifyZReport(envelope);

        const state = z.verified ? 'VERIFIED' : z.saved ? 'SAVED_UNVERIFIED' : 'FAILED';
        if (z.verified) verified += 1;
        else if (z.saved) savedUnverified += 1;
        else failed += 1;

        const detail = [
          state,
          dev.label,
          `(${z.rptDeDate})`,
          z.saveError ? `save:${z.saveError}` : '',
          z.verifyError ? `check:${z.verifyError}` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 480);

        await prisma.rraSyncCursor.upsert({
          where: {
            organizationId_resource: {
              organizationId: dev.organizationId,
              resource: zReportResource(dev.branchId),
            },
          },
          create: {
            organizationId: dev.organizationId,
            resource: zReportResource(dev.branchId),
            lastReqDt: z.rptDeTimestamp,
            lastRunAt: new Date(),
            lastResult: detail,
          },
          update: {
            lastReqDt: z.rptDeTimestamp,
            lastRunAt: new Date(),
            lastResult: detail,
          },
        });

        if (z.saved) {
          await prisma.organization.update({
            where: { id: dev.organizationId },
            data: { lastSuccessfulVdsContact: new Date() },
          });
        }
        if (!z.verified) {
          console.warn(`[Z-report] ${dev.label}: ${state} — save:${z.saveError ?? 'ok'} check:${z.verifyError ?? 'ok'}`);
        }
      } catch (e) {
        failed += 1;
        console.warn(`[Z-report] ${dev.label} error:`, e);
      }
    }

    if (devices.length) {
      console.log(
        `[Z-report] daily close: devices=${devices.length} verified=${verified} savedUnverified=${savedUnverified} failed=${failed}`,
      );
    }
  } catch (e) {
    console.error('[Z-report] job error:', e);
  }
});

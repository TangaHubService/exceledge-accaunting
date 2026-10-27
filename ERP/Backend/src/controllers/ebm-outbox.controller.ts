import type { Response } from 'express';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { prisma } from '../lib/prisma';
import { isEbmEnabled } from '../services/rra-ebm.service';
import { buildVsdcEnvelope, saveAndVerifyZReport, checkZReport } from '../services/vsdc-api.service';
import { initializeVsdcDevice } from '../services/vsdc-init.service';
import { retryEbmOutboxEntry } from '../services/ebm-outbox.service';
import { success, error as apiError } from '../utils/apiResponse';

const OFFLINE_BLOCK_MS = Number(process.env.VSDC_OFFLINE_BLOCK_MS ?? 2 * 60 * 60 * 1000);

export async function getEbmOutbox(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const saleId = req.query.saleId ? parseInt(req.query.saleId as string) : undefined;

    const entries = await prisma.ebmOutbox.findMany({
      where: { organizationId, ...(saleId ? { saleId } : {}) },
      include: {
        sale: {
          select: {
            saleNumber: true,
            invoiceNumber: true,
            totalAmount: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    res.json(success(entries));
  } catch (error) {
    console.error('[EbmOutbox] Failed to fetch:', error);
    res.status(500).json(apiError('Failed to fetch EBM outbox entries'));
  }
}

/**
 * GET /:organizationId/ebm-status — VSDC presence indicator payload.
 * Derives reachability from the persisted last-contact timestamp (updated on
 * every real successful VSDC call/heartbeat) rather than a synthetic probe,
 * since a bare unauthenticated GET to the gateway root is not representative
 * of the authenticated POST endpoints actual fiscalisation traffic uses.
 */
export async function getEbmStatus(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { lastSuccessfulVdsContact: true, trainingMode: true },
    });
    if (!org) {
      return res.status(404).json(apiError('Organization not found'));
    }

    const lastContact = org.lastSuccessfulVdsContact;
    const elapsedMs = lastContact ? Date.now() - lastContact.getTime() : null;
    const enabled = isEbmEnabled();
    const online = enabled && elapsedMs !== null && elapsedMs < OFFLINE_BLOCK_MS;

    res.json(success({
      enabled,
      online,
      trainingMode: !!org.trainingMode,
      lastContact: lastContact ? lastContact.toISOString() : null,
      offlineLimitMs: OFFLINE_BLOCK_MS,
    }));
  } catch (error) {
    console.error('[EbmStatus] Failed to read VSDC status:', error);
    res.status(500).json(apiError('Failed to read VSDC status'));
  }
}

export async function checkEbmOutboxStatus(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    const { idempotencyKey } = req.body;

    const entry = await prisma.ebmOutbox.findFirst({
      where: { id, organizationId },
    });

    if (!entry) {
      return res.status(404).json(apiError('Outbox entry not found'));
    }

    // If there's a status check path configured, query VSDC
    // For now, verify against EbmTransaction table
    const tx = await prisma.ebmTransaction.findFirst({
      where: {
        idempotencyKey,
        submissionStatus: 'SUCCESS',
        ebmInvoiceNumber: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (tx?.ebmInvoiceNumber) {
      await prisma.ebmOutbox.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          sdcDateTime: tx.sdcDateTime,
          lastError: null,
        },
      });
      return res.json(success({ resolved: true, ebmInvoiceNumber: tx.ebmInvoiceNumber }));
    }

    res.json(success({ resolved: false }));
  } catch (error) {
    console.error('[EbmOutbox] Status check failed:', error);
    res.status(500).json(apiError('Failed to check outbox status'));
  }
}

/**
 * POST /:organizationId/ebm-outbox/:id/retry — re-queue FAILED / DEAD_LETTER
 * (unfiscalized) entries after the underlying issue is fixed.
 */
export async function retryEbmOutbox(req: BranchAuthRequest, res: Response) {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const id = parseInt(req.params.id);
    if (!Number.isFinite(organizationId) || !Number.isFinite(id)) {
      return res.status(400).json(apiError('Invalid organization or outbox id'));
    }

    const result = await retryEbmOutboxEntry(organizationId, id);
    if (!result.success) {
      return res.status(400).json(apiError(result.error ?? 'Retry failed'));
    }
    res.json(success({
      message: 'Outbox entry re-queued for fiscalization',
      entry: result.entry,
    }));
  } catch (error) {
    console.error('[EbmOutbox] Retry failed:', error);
    res.status(500).json(apiError('Failed to retry outbox entry'));
  }
}

/**
 * POST /:organizationId/ebm/initialize — one-time RRA VSDC device initialization
 * (RRA checklist §58). Body: { branchId? }.
 */
export async function initializeDevice(req: BranchAuthRequest, res: Response) {
  try {
    if (!isEbmEnabled()) {
      return res.status(400).json(apiError('EBM is not enabled for this organization'));
    }
    const organizationId = parseInt(req.params.organizationId);
    const branchId = req.body?.branchId != null ? parseInt(req.body.branchId) : undefined;

    const result = await initializeVsdcDevice(organizationId, branchId ?? null);
    if (!result.success) {
      return res.status(502).json(apiError(result.error ?? 'Device initialization failed'));
    }
    const info = result.info ?? {};
    res.json(success({
      taxpayer: info.taxprNm,
      branch: info.bhfNm,
      sdcId: info.sdcId,
      mrcNo: result.mrcNo ?? info.mrcNo,
      reportedMrcNo: info.mrcNo,
      mrcWarning: result.mrcWarning ?? null,
      dvcId: info.dvcId,
      lastInvoiceNo: info.lastSaleInvcNo ?? info.lastInvcNo ?? 0,
      lastReceiptNo: info.lastSaleRcptNo ?? 0,
      seededCounterTo: result.seededCounterTo ?? null,
    }));
  } catch (error) {
    console.error('[EbmInit] Initialization failed:', error);
    res.status(500).json(apiError('Failed to initialize the VSDC device'));
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/**
 * `yyyyMMdd` report date — expanded to a 14-digit `yyyyMMddHH24MISS`
 * timestamp (`yyyyMMdd000000`) inside `checkZReport`, which is what the VSDC
 * validates against (error 910 rejects a bare 8-digit `rptDe`).
 */
function toRptDeDate(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/**
 * POST /:organizationId/z-report — trigger the daily Z (closing) report for
 * a branch's VSDC device. Manually triggered for now; day-end cutoff timing
 * is an operational policy decision (per-branch closing hour) that isn't
 * automated yet.
 */
export async function submitZReport(req: BranchAuthRequest, res: Response) {
  try {
    if (!isEbmEnabled()) {
      return res.status(400).json(apiError('EBM is not enabled for this organization'));
    }
    const organizationId = parseInt(req.params.organizationId);
    const branchId = req.body?.branchId != null ? parseInt(req.body.branchId) : undefined;

    const envelope = await buildVsdcEnvelope(organizationId, branchId);
    const z = await saveAndVerifyZReport(envelope);

    if (!z.saved) {
      return res.status(502).json(apiError(z.saveError ?? 'Z-report submission failed'));
    }
    res.json(success({
      rptDe: z.rptDeTimestamp,
      rptDeDate: z.rptDeDate,
      saved: z.saved,
      verified: z.verified,
      verifyError: z.verifyError ?? null,
      response: z.raw,
    }));
  } catch (error) {
    console.error('[EbmZReport] Submission failed:', error);
    res.status(500).json(apiError('Failed to submit Z-report'));
  }
}

/**
 * GET /:organizationId/z-report?branchId=&date=yyyyMMdd[HHmmss] — look up a
 * previously saved Z report for a given day (defaults to today). A bare
 * 8-digit date is expanded to `yyyyMMdd000000` inside `checkZReport` because
 * the VSDC requires `yyyyMMddHH24MISS` (error 910 otherwise).
 */
export async function getZReportStatus(req: BranchAuthRequest, res: Response) {
  try {
    if (!isEbmEnabled()) {
      return res.status(400).json(apiError('EBM is not enabled for this organization'));
    }
    const organizationId = parseInt(req.params.organizationId);
    const branchId = req.query.branchId != null ? parseInt(req.query.branchId as string) : undefined;
    const rawDate = (req.query.date as string) || toRptDeDate(new Date());
    const rptDe = rawDate.replace(/\D/g, '');
    if (!/^(\d{8}|\d{14})$/.test(rptDe)) {
      return res.status(400).json(apiError('date must be yyyyMMdd or yyyyMMddHHmmss'));
    }

    const envelope = await buildVsdcEnvelope(organizationId, branchId);
    const result = await checkZReport(envelope, rptDe);

    if (!result.success) {
      return res.status(502).json(apiError(result.error ?? 'Z-report lookup failed'));
    }
    res.json(success({ rptDe, response: result.rawBody }));
  } catch (error) {
    console.error('[EbmZReport] Lookup failed:', error);
    res.status(500).json(apiError('Failed to check Z-report status'));
  }
}

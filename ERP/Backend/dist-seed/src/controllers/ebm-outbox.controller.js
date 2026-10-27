"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEbmOutbox = getEbmOutbox;
exports.getEbmStatus = getEbmStatus;
exports.checkEbmOutboxStatus = checkEbmOutboxStatus;
exports.retryEbmOutbox = retryEbmOutbox;
exports.initializeDevice = initializeDevice;
exports.submitZReport = submitZReport;
exports.getZReportStatus = getZReportStatus;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const vsdc_api_service_1 = require("../services/vsdc-api.service");
const vsdc_init_service_1 = require("../services/vsdc-init.service");
const ebm_outbox_service_1 = require("../services/ebm-outbox.service");
const apiResponse_1 = require("../utils/apiResponse");
const OFFLINE_BLOCK_MS = Number(process.env.VSDC_OFFLINE_BLOCK_MS ?? 2 * 60 * 60 * 1000);
async function getEbmOutbox(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const saleId = req.query.saleId ? parseInt(req.query.saleId) : undefined;
        const entries = await prisma_1.prisma.ebmOutbox.findMany({
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
        res.json((0, apiResponse_1.success)(entries));
    }
    catch (error) {
        console.error('[EbmOutbox] Failed to fetch:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to fetch EBM outbox entries'));
    }
}
/**
 * GET /:organizationId/ebm-status — VSDC presence indicator payload.
 * Derives reachability from the persisted last-contact timestamp (updated on
 * every real successful VSDC call/heartbeat) rather than a synthetic probe,
 * since a bare unauthenticated GET to the gateway root is not representative
 * of the authenticated POST endpoints actual fiscalisation traffic uses.
 */
async function getEbmStatus(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const org = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { lastSuccessfulVdsContact: true },
        });
        if (!org) {
            return res.status(404).json((0, apiResponse_1.error)('Organization not found'));
        }
        const lastContact = org.lastSuccessfulVdsContact;
        const elapsedMs = lastContact ? Date.now() - lastContact.getTime() : null;
        const enabled = (0, rra_ebm_service_1.isEbmEnabled)();
        const online = enabled && elapsedMs !== null && elapsedMs < OFFLINE_BLOCK_MS;
        res.json((0, apiResponse_1.success)({
            enabled,
            online,
            lastContact: lastContact ? lastContact.toISOString() : null,
            offlineLimitMs: OFFLINE_BLOCK_MS,
        }));
    }
    catch (error) {
        console.error('[EbmStatus] Failed to read VSDC status:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to read VSDC status'));
    }
}
async function checkEbmOutboxStatus(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const { idempotencyKey } = req.body;
        const entry = await prisma_1.prisma.ebmOutbox.findFirst({
            where: { id, organizationId },
        });
        if (!entry) {
            return res.status(404).json((0, apiResponse_1.error)('Outbox entry not found'));
        }
        // If there's a status check path configured, query VSDC
        // For now, verify against EbmTransaction table
        const tx = await prisma_1.prisma.ebmTransaction.findFirst({
            where: {
                idempotencyKey,
                submissionStatus: 'SUCCESS',
                ebmInvoiceNumber: { not: null },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (tx?.ebmInvoiceNumber) {
            await prisma_1.prisma.ebmOutbox.update({
                where: { id },
                data: {
                    status: 'SUCCEEDED',
                    sdcDateTime: tx.sdcDateTime,
                    lastError: null,
                },
            });
            return res.json((0, apiResponse_1.success)({ resolved: true, ebmInvoiceNumber: tx.ebmInvoiceNumber }));
        }
        res.json((0, apiResponse_1.success)({ resolved: false }));
    }
    catch (error) {
        console.error('[EbmOutbox] Status check failed:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to check outbox status'));
    }
}
/**
 * POST /:organizationId/ebm-outbox/:id/retry — re-queue FAILED / DEAD_LETTER
 * (unfiscalized) entries after the underlying issue is fixed.
 */
async function retryEbmOutbox(req, res) {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        if (!Number.isFinite(organizationId) || !Number.isFinite(id)) {
            return res.status(400).json((0, apiResponse_1.error)('Invalid organization or outbox id'));
        }
        const result = await (0, ebm_outbox_service_1.retryEbmOutboxEntry)(organizationId, id);
        if (!result.success) {
            return res.status(400).json((0, apiResponse_1.error)(result.error ?? 'Retry failed'));
        }
        res.json((0, apiResponse_1.success)({
            message: 'Outbox entry re-queued for fiscalization',
            entry: result.entry,
        }));
    }
    catch (error) {
        console.error('[EbmOutbox] Retry failed:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to retry outbox entry'));
    }
}
/**
 * POST /:organizationId/ebm/initialize — one-time RRA VSDC device initialization
 * (RRA checklist §58). Body: { branchId? }.
 */
async function initializeDevice(req, res) {
    try {
        if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
            return res.status(400).json((0, apiResponse_1.error)('EBM is not enabled for this organization'));
        }
        const organizationId = parseInt(req.params.organizationId);
        const branchId = req.body?.branchId != null ? parseInt(req.body.branchId) : undefined;
        const result = await (0, vsdc_init_service_1.initializeVsdcDevice)(organizationId, branchId ?? null);
        if (!result.success) {
            return res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Device initialization failed'));
        }
        const info = result.info ?? {};
        res.json((0, apiResponse_1.success)({
            taxpayer: info.taxprNm,
            branch: info.bhfNm,
            sdcId: info.sdcId,
            mrcNo: info.mrcNo,
            dvcId: info.dvcId,
            lastInvoiceNo: info.lastSaleInvcNo ?? info.lastInvcNo ?? 0,
            lastReceiptNo: info.lastSaleRcptNo ?? 0,
            seededCounterTo: result.seededCounterTo ?? null,
        }));
    }
    catch (error) {
        console.error('[EbmInit] Initialization failed:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to initialize the VSDC device'));
    }
}
const pad2 = (n) => String(n).padStart(2, '0');
/**
 * `yyyyMMdd` report date — expanded to a 14-digit `yyyyMMddHH24MISS`
 * timestamp (`yyyyMMdd000000`) inside `checkZReport`, which is what the VSDC
 * validates against (error 910 rejects a bare 8-digit `rptDe`).
 */
function toRptDeDate(d) {
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
/**
 * POST /:organizationId/z-report — trigger the daily Z (closing) report for
 * a branch's VSDC device. Manually triggered for now; day-end cutoff timing
 * is an operational policy decision (per-branch closing hour) that isn't
 * automated yet.
 */
async function submitZReport(req, res) {
    try {
        if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
            return res.status(400).json((0, apiResponse_1.error)('EBM is not enabled for this organization'));
        }
        const organizationId = parseInt(req.params.organizationId);
        const branchId = req.body?.branchId != null ? parseInt(req.body.branchId) : undefined;
        const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId);
        const z = await (0, vsdc_api_service_1.saveAndVerifyZReport)(envelope);
        if (!z.saved) {
            return res.status(502).json((0, apiResponse_1.error)(z.saveError ?? 'Z-report submission failed'));
        }
        res.json((0, apiResponse_1.success)({
            rptDe: z.rptDeTimestamp,
            rptDeDate: z.rptDeDate,
            saved: z.saved,
            verified: z.verified,
            verifyError: z.verifyError ?? null,
            response: z.raw,
        }));
    }
    catch (error) {
        console.error('[EbmZReport] Submission failed:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to submit Z-report'));
    }
}
/**
 * GET /:organizationId/z-report?branchId=&date=yyyyMMdd[HHmmss] — look up a
 * previously saved Z report for a given day (defaults to today). A bare
 * 8-digit date is expanded to `yyyyMMdd000000` inside `checkZReport` because
 * the VSDC requires `yyyyMMddHH24MISS` (error 910 otherwise).
 */
async function getZReportStatus(req, res) {
    try {
        if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
            return res.status(400).json((0, apiResponse_1.error)('EBM is not enabled for this organization'));
        }
        const organizationId = parseInt(req.params.organizationId);
        const branchId = req.query.branchId != null ? parseInt(req.query.branchId) : undefined;
        const rawDate = req.query.date || toRptDeDate(new Date());
        const rptDe = rawDate.replace(/\D/g, '');
        if (!/^(\d{8}|\d{14})$/.test(rptDe)) {
            return res.status(400).json((0, apiResponse_1.error)('date must be yyyyMMdd or yyyyMMddHHmmss'));
        }
        const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId);
        const result = await (0, vsdc_api_service_1.checkZReport)(envelope, rptDe);
        if (!result.success) {
            return res.status(502).json((0, apiResponse_1.error)(result.error ?? 'Z-report lookup failed'));
        }
        res.json((0, apiResponse_1.success)({ rptDe, response: result.rawBody }));
    }
    catch (error) {
        console.error('[EbmZReport] Lookup failed:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to check Z-report status'));
    }
}

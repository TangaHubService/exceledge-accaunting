"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRraImports = syncRraImports;
exports.actionRraImport = actionRraImport;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("./rra-ebm.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
const inventory_ledger_service_1 = require("./inventory-ledger.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * RRA import declarations (RRA checklist §66, §67, §68).
 *
 *  §66  syncRraImports()          — pull import-declaration lines from RRA
 *                                   (/imports/selectImportItems) and cache them.
 *  §67  request-date validation   — each pull's request date must be strictly
 *                                   later than the previous one.
 *  §68  approveRraImport() /      — classify + approve or reject a line
 *       rejectRraImport()           (/imports/updateImportItems). An approval
 *                                   optionally links a product and books the
 *                                   stock-in as an Import (sarTyCd 01).
 */
const CURSOR_RESOURCE = 'imports';
/** VSDC §4.20 Import Item Status — 2 Approved, 3 Rejected (1 = pending, the incoming default). */
const IMPT_STTS = { APPROVED: '2', REJECTED: '3' };
async function getCursor(organizationId) {
    const row = await prisma_1.prisma.rraSyncCursor.findUnique({
        where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
    });
    return row?.lastReqDt ?? '20200101000000';
}
async function saveCursor(organizationId, lastReqDt, result) {
    await prisma_1.prisma.rraSyncCursor.upsert({
        where: { organizationId_resource: { organizationId, resource: CURSOR_RESOURCE } },
        create: { organizationId, resource: CURSOR_RESOURCE, lastReqDt, lastRunAt: new Date(), lastResult: result },
        update: { lastReqDt, lastRunAt: new Date(), lastResult: result },
    });
}
// ── §66 / §67: pull import declarations ──────────────────────
async function syncRraImports(organizationId, opts = {}) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { ok: false, fetched: 0, cached: 0, lastReqDt: '', error: 'EBM is not enabled' };
    const prevCursor = await getCursor(organizationId);
    // §67: a manually-specified request date must be strictly after the previous
    // request. `requestDate` is yyyy-mm-dd; the cursor is yyyyMMddHHmmss.
    let lastReqDt;
    if (opts.requestDate) {
        const digits = opts.requestDate.replace(/\D/g, '');
        if (digits.length < 8)
            return { ok: false, fetched: 0, cached: 0, lastReqDt: prevCursor, error: 'Request date must be yyyy-mm-dd' };
        lastReqDt = `${digits.slice(0, 8)}000000`;
        if (lastReqDt <= prevCursor) {
            return {
                ok: false,
                fetched: 0,
                cached: 0,
                lastReqDt: prevCursor,
                error: `Request date must be later than the previous request (${prevCursor.slice(0, 8)})`,
            };
        }
    }
    else {
        lastReqDt = prevCursor;
    }
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectImportItems)(envelope, lastReqDt);
    if (!res.success) {
        await saveCursor(organizationId, prevCursor, `FAILED: ${res.resultMsg}`);
        return { ok: false, fetched: 0, cached: 0, lastReqDt: prevCursor, error: `${res.resultCd}: ${res.resultMsg}` };
    }
    const list = res.data?.itemList ?? [];
    let cached = 0;
    for (const it of list) {
        await prisma_1.prisma.rraImportItem.upsert({
            where: {
                organizationId_taskCd_dclDe_itemSeq: {
                    organizationId,
                    taskCd: it.taskCd,
                    dclDe: it.dclDe,
                    itemSeq: it.itemSeq,
                },
            },
            create: {
                organizationId,
                taskCd: it.taskCd,
                dclNo: it.dclNo ?? null,
                dclDe: it.dclDe,
                itemSeq: it.itemSeq,
                hsCd: it.hsCd ?? null,
                itemNm: it.itemNm ?? null,
                orgnNatCd: it.orgnNatCd ?? null,
                exptNatCd: it.exptNatCd ?? null,
                pkg: it.pkg ?? null,
                pkgUnitCd: it.pkgUnitCd ?? null,
                qty: it.qty ?? null,
                qtyUnitCd: it.qtyUnitCd ?? null,
                totWt: it.totWt ?? null,
                netWt: it.netWt ?? null,
                spplrNm: it.spplrNm ?? null,
                agntNm: it.agntNm ?? null,
                invcFcurAmt: it.invcFcurAmt ?? null,
                invcFcurCd: it.invcFcurCd ?? null,
                invcFcurExcrt: it.invcFcurExcrt ?? null,
                itemCd: it.itemCd ?? null,
                itemClsCd: it.itemClsCd ?? null,
                rawResponse: it,
            },
            // Never clobber a line the operator has already actioned.
            update: { rawResponse: it },
        });
        cached += 1;
    }
    // §67: only advance the cursor to the actual request time on success.
    await saveCursor(organizationId, runAt, `OK: ${cached} import lines`);
    return { ok: true, fetched: list.length, cached, lastReqDt: runAt };
}
// ── §68: approve / reject an import line ─────────────────────
async function actionRraImport(organizationId, importItemId, action, opts = {}) {
    const line = await prisma_1.prisma.rraImportItem.findFirst({ where: { id: importItemId, organizationId } });
    if (!line)
        return { success: false, error: 'Import line not found' };
    if (line.status !== 'PENDING')
        return { success: false, error: `Import line already ${line.status.toLowerCase()}` };
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: false, error: 'EBM is not enabled' };
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? null);
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const user = opts.userId
        ? await prisma_1.prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
        : null;
    const modr = { id: String(user?.id ?? 'system'), name: user?.name ?? 'System' };
    const itemClsCd = (opts.itemClsCd ?? line.itemClsCd ?? '').trim();
    if (action === 'approve' && !itemClsCd) {
        return { success: false, error: 'itemClsCd is required to approve an import — pick an RRA item classification' };
    }
    const itemCd = opts.itemCd ?? line.itemCd ?? undefined;
    const payload = {
        taskCd: line.taskCd,
        dclDe: line.dclDe,
        itemSeq: line.itemSeq,
        hsCd: line.hsCd ?? '',
        itemClsCd,
        itemCd: itemCd ?? '',
        imptItemSttsCd: action === 'approve' ? IMPT_STTS.APPROVED : IMPT_STTS.REJECTED,
        remark: opts.remark ?? '',
        modrId: modr.id,
        modrNm: modr.name,
    };
    try {
        const res = await (0, vsdc_api_service_1.updateImportItems)(envelope, payload);
        if (!res.success)
            return { success: false, error: res.error ?? 'updateImportItems failed' };
        await prisma_1.prisma.rraImportItem.update({
            where: { id: importItemId },
            data: {
                status: action === 'approve' ? 'APPROVED' : 'REJECTED',
                actionedAt: new Date(),
                remark: opts.remark ?? null,
                itemClsCd,
                itemCd: itemCd ?? null,
                linkedProductId: action === 'approve' ? opts.linkProductId ?? null : null,
            },
        });
        // §74: an approved import affects stock in real time. When a local product
        // is linked, book the stock-in — the stock-sync batch reports it to RRA as
        // an Import (sarTyCd 01) via /stock/saveStockItems + /stockMaster.
        if (action === 'approve' && opts.linkProductId && opts.branchId != null && line.qty) {
            await (0, inventory_ledger_service_1.addStock)({
                organizationId,
                productId: opts.linkProductId,
                userId: opts.userId ?? 0,
                quantity: Math.round(line.qty.toNumber()),
                movementType: 'PURCHASE',
                branchId: opts.branchId,
                reference: `IMPORT-${line.taskCd}-${line.dclNo ?? line.dclDe}`,
                referenceType: 'RRA_IMPORT',
                note: `Approved import declaration ${line.dclNo ?? line.taskCd} line ${line.itemSeq}`,
            });
        }
        await prisma_1.prisma.organization.update({
            where: { id: organizationId },
            data: { lastSuccessfulVdsContact: new Date() },
        });
        return { success: true };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Import action failed';
        logger_1.default.error(`[EBM] import action #${importItemId} (${action}) failed`, e);
        return { success: false, error: message };
    }
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRraPurchases = syncRraPurchases;
exports.confirmRraPurchase = confirmRraPurchase;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("./rra-ebm.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
const inventory_ledger_service_1 = require("./inventory-ledger.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * RRA B2B purchases (RRA checklist §70, §71).
 *
 *  §70  syncRraPurchases()   — pull the B2B sales issued to this taxpayer
 *                              (/trnsPurchase/selectTrnsPurchaseSales) and
 *                              cache them for review.
 *  §71  confirmRraPurchase() — record/confirm a received purchase
 *                              (/trnsPurchase/savePurchases, pchsSttsCd='02'),
 *                              which also books the stock-in at RRA.
 */
const CURSOR_RESOURCE = 'purchases';
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
// ── §70: pull received purchases ─────────────────────────────
async function syncRraPurchases(organizationId, branchId) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { ok: false, fetched: 0, cached: 0, error: 'EBM is not enabled' };
    const since = await getCursor(organizationId);
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectPurchases)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, since, `FAILED: ${res.resultMsg}`);
        return { ok: false, fetched: 0, cached: 0, error: `${res.resultCd}: ${res.resultMsg}` };
    }
    // The sandbox returns the list under `saleList` (per TrnsPurchaseSalesRes).
    const list = res.data?.saleList ?? res.data?.trnsPurchaseSalesList ?? [];
    let cached = 0;
    for (const p of list) {
        const spplrInvcNo = BigInt(p.spplrInvcNo ?? 0);
        await prisma_1.prisma.rraPurchase.upsert({
            where: {
                organizationId_spplrTin_spplrInvcNo: {
                    organizationId,
                    spplrTin: p.spplrTin ?? '',
                    spplrInvcNo,
                },
            },
            create: {
                organizationId,
                spplrTin: p.spplrTin ?? '',
                spplrNm: p.spplrNm ?? null,
                spplrBhfId: p.spplrBhfId ?? null,
                spplrInvcNo,
                rcptTyCd: p.rcptTyCd ?? null,
                pmtTyCd: p.pmtTyCd ?? null,
                salesDt: p.salesDt ?? null,
                totItemCnt: p.totItemCnt ?? null,
                totTaxblAmt: p.totTaxblAmt ?? null,
                totTaxAmt: p.totTaxAmt ?? null,
                totAmt: p.totAmt ?? null,
                remark: p.remark ?? null,
                rawResponse: p,
                items: {
                    create: (p.itemList ?? []).map((it, idx) => ({
                        itemSeq: it.itemSeq ?? idx + 1,
                        itemCd: it.itemCd ?? null,
                        itemClsCd: it.itemClsCd ?? null,
                        itemNm: it.itemNm ?? null,
                        bcd: it.bcd ?? null,
                        pkgUnitCd: it.pkgUnitCd ?? null,
                        pkg: it.pkg ?? null,
                        qtyUnitCd: it.qtyUnitCd ?? null,
                        qty: it.qty ?? 0,
                        prc: it.prc ?? 0,
                        splyAmt: it.splyAmt ?? 0,
                        dcRt: it.dcRt ?? null,
                        dcAmt: it.dcAmt ?? null,
                        taxTyCd: it.taxTyCd ?? null,
                        taxblAmt: it.taxblAmt ?? null,
                        taxAmt: it.taxAmt ?? null,
                        totAmt: it.totAmt ?? null,
                    })),
                },
            },
            update: {
                // Do not clobber a purchase the operator has already actioned.
                rawResponse: p,
                spplrNm: p.spplrNm ?? null,
            },
        });
        cached += 1;
    }
    await saveCursor(organizationId, runAt, `OK: ${cached} purchases`);
    return { ok: true, fetched: list.length, cached };
}
// ── §71: confirm / record a received purchase ────────────────
const A_D = ['A', 'B', 'C', 'D'];
const TAX_RATES = { A: 0, B: 18, C: 0, D: 0 };
async function confirmRraPurchase(organizationId, rraPurchaseId, opts = {}) {
    const rp = await prisma_1.prisma.rraPurchase.findFirst({
        where: { id: rraPurchaseId, organizationId },
        include: { items: { orderBy: { itemSeq: 'asc' } } },
    });
    if (!rp)
        return { success: false, error: 'Purchase not found' };
    if (rp.status !== 'PENDING')
        return { success: false, error: `Purchase already ${rp.status.toLowerCase()}` };
    if (opts.reject) {
        await prisma_1.prisma.rraPurchase.update({ where: { id: rraPurchaseId }, data: { status: 'REJECTED' } });
        return { success: true };
    }
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: false, error: 'EBM is not enabled' };
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? null);
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const user = opts.userId
        ? await prisma_1.prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
        : null;
    const regr = { id: String(user?.id ?? 'system'), name: user?.name ?? 'System' };
    const taxblByBand = { A: 0, B: 0, C: 0, D: 0 };
    const taxByBand = { A: 0, B: 0, C: 0, D: 0 };
    const itemList = rp.items.map((it, idx) => {
        const band = (it.taxTyCd ?? 'B').toUpperCase();
        const slot = A_D.includes(band) ? band : 'B';
        const qty = Math.abs(it.qty.toNumber());
        const prc = Math.abs(it.prc.toNumber());
        const splyAmt = (0, rra_ebm_service_1.fix2)(it.splyAmt != null ? Math.abs(it.splyAmt.toNumber()) : qty * prc);
        const taxAmt = it.taxAmt != null ? Math.abs(it.taxAmt.toNumber()) : 0;
        // RRA TrnsPurchaseSaveReq sample (§3.3.7.2): tax-inclusive — taxblAmt == splyAmt == totAmt
        // with taxAmt extracted inside the gross (e.g. totTaxblAmt=10500, totTaxAmt=1890, totAmt=10500).
        const lineTot = it.totAmt != null ? Math.abs(it.totAmt.toNumber()) : splyAmt;
        const taxblAmt = (0, rra_ebm_service_1.fix2)(lineTot);
        taxblByBand[slot] = (0, rra_ebm_service_1.fix2)(taxblByBand[slot] + taxblAmt);
        taxByBand[slot] = (0, rra_ebm_service_1.fix2)(taxByBand[slot] + taxAmt);
        return {
            itemSeq: it.itemSeq ?? idx + 1,
            itemCd: it.itemCd ?? undefined,
            itemClsCd: it.itemClsCd ?? undefined,
            itemNm: it.itemNm ?? 'Item',
            bcd: it.bcd ?? undefined,
            spplrItemClsCd: it.itemClsCd ?? undefined,
            spplrItemCd: it.itemCd ?? undefined,
            spplrItemNm: it.itemNm ?? undefined,
            pkgUnitCd: it.pkgUnitCd ?? 'CT',
            pkg: it.pkg != null ? it.pkg.toNumber() : qty,
            qtyUnitCd: it.qtyUnitCd ?? 'U',
            qty,
            prc,
            splyAmt: taxblAmt,
            dcRt: it.dcRt != null ? it.dcRt.toNumber() : 0,
            dcAmt: it.dcAmt != null ? it.dcAmt.toNumber() : 0,
            taxblAmt,
            taxTyCd: slot,
            taxAmt,
            totAmt: taxblAmt,
            itemExprDt: null,
        };
    });
    const totTaxblAmt = (0, rra_ebm_service_1.fix2)(A_D.reduce((s, b) => s + taxblByBand[b], 0));
    const totTaxAmt = (0, rra_ebm_service_1.fix2)(A_D.reduce((s, b) => s + taxByBand[b], 0));
    // Spec sample: totAmt equals totTaxblAmt (do NOT add totTaxAmt).
    const totAmt = totTaxblAmt;
    const now = new Date();
    // The pull side (syncRraPurchases above) caches rcptTyCd straight from RRA's
    // *Sales* Receipt Type code list (S=Sale, R=Refund after Sale) — that's the
    // vocabulary `/trnsPurchase/selectTrnsPurchaseSales` returns, since it's the
    // supplier's own sale record. `/trnsPurchase/savePurchases` validates this
    // field against the distinct *Purchase* Receipt Type list (P=Purchase,
    // R=Refund after Purchase) instead; forwarding the sales code unmapped gets
    // rejected with `resultCd 913: Code value error ... [<rcptTyCd>]`.
    const PURCHASE_RCPT_TY_CD_BY_SALES_RCPT_TY_CD = { S: 'P', R: 'R' };
    const rcptTyCd = PURCHASE_RCPT_TY_CD_BY_SALES_RCPT_TY_CD[(rp.rcptTyCd ?? '').toUpperCase()] ?? 'P';
    const payload = {
        invcNo: Number(rp.spplrInvcNo),
        orgInvcNo: 0,
        spplrTin: rp.spplrTin,
        spplrBhfId: rp.spplrBhfId ?? '00',
        spplrNm: rp.spplrNm ?? '',
        spplrInvcNo: Number(rp.spplrInvcNo),
        regTyCd: 'M',
        pchsTyCd: 'N',
        // §38: the RRA purchase order code for this incoming purchase, when the
        // operator provides one (the select-purchases pull does not return it).
        ...(opts.prcOrdCd?.trim() ? { prcOrdCd: opts.prcOrdCd.trim() } : {}),
        rcptTyCd,
        pmtTyCd: rp.pmtTyCd ?? '01',
        pchsSttsCd: '02', // §4.x — 02 Approved (records the purchase + stock-in)
        cfmDt: (0, rra_ebm_service_1.toRraDateTime)(now),
        pchsDt: (0, rra_ebm_service_1.toRraDate)(now),
        wrhsDt: (0, rra_ebm_service_1.toRraDateTime)(now),
        totItemCnt: itemList.length,
        taxblAmtA: taxblByBand.A, taxblAmtB: taxblByBand.B, taxblAmtC: taxblByBand.C, taxblAmtD: taxblByBand.D,
        taxRtA: TAX_RATES.A, taxRtB: TAX_RATES.B, taxRtC: TAX_RATES.C, taxRtD: TAX_RATES.D,
        taxAmtA: taxByBand.A, taxAmtB: taxByBand.B, taxAmtC: taxByBand.C, taxAmtD: taxByBand.D,
        totTaxblAmt,
        totTaxAmt,
        totAmt,
        remark: rp.remark ?? '',
        regrId: regr.id,
        regrNm: regr.name,
        modrId: regr.id,
        modrNm: regr.name,
        itemList,
    };
    try {
        const res = await (0, vsdc_api_service_1.savePurchase)(envelope, payload);
        if (!res.success) {
            return { success: false, error: res.error ?? 'savePurchases failed' };
        }
        await prisma_1.prisma.rraPurchase.update({
            where: { id: rraPurchaseId },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        // §74: a confirmed purchase must affect local stock in real time. RRA has
        // already booked the stock-in from /trnsPurchase/savePurchases (pchsSttsCd
        // 02), so these ledger rows are written with skipEbmSync — re-sending them
        // via /stock/saveStockItems would double-count the same receipt at the VSDC.
        let stockBooked = 0;
        if (opts.branchId != null) {
            const itemCds = rp.items.map((it) => it.itemCd).filter((c) => !!c);
            const productByCd = new Map((itemCds.length
                ? await prisma_1.prisma.product.findMany({
                    where: { organizationId, itemCd: { in: itemCds } },
                    select: { id: true, itemCd: true },
                })
                : []).map((p) => [p.itemCd, p.id]));
            for (const it of rp.items) {
                const productId = it.itemCd ? productByCd.get(it.itemCd) : undefined;
                const qty = Math.round(Math.abs(it.qty.toNumber()));
                if (!productId || qty <= 0)
                    continue;
                await (0, inventory_ledger_service_1.addStock)({
                    organizationId,
                    productId,
                    userId: opts.userId ?? 0,
                    quantity: qty,
                    movementType: 'PURCHASE',
                    branchId: opts.branchId,
                    unitCost: Math.abs(it.prc.toNumber()),
                    reference: `RRA-PURCHASE-${rp.spplrTin}-${rp.spplrInvcNo}`,
                    referenceType: 'RRA_PURCHASE',
                    note: `Confirmed RRA purchase from ${rp.spplrNm ?? rp.spplrTin}`,
                    skipEbmSync: true,
                });
                stockBooked += 1;
            }
        }
        else {
            logger_1.default.warn(`[EBM] confirm RRA purchase #${rraPurchaseId}: no branch supplied — local stock not booked`);
        }
        await prisma_1.prisma.organization.update({
            where: { id: organizationId },
            data: { lastSuccessfulVdsContact: new Date() },
        });
        logger_1.default.info(`[EBM] confirmed RRA purchase #${rraPurchaseId} — ${stockBooked} item(s) booked into branch ${opts.branchId ?? '-'} stock`);
        return { success: true };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Purchase confirmation failed';
        logger_1.default.error(`[EBM] confirm RRA purchase #${rraPurchaseId} failed`, e);
        return { success: false, error: message };
    }
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRraCodes = syncRraCodes;
exports.syncRraItemClasses = syncRraItemClasses;
exports.syncRraNotices = syncRraNotices;
exports.verifyCustomerTin = verifyCustomerTin;
exports.pullRraItems = pullRraItems;
exports.syncAllRraMasterData = syncAllRraMasterData;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("./rra-ebm.service");
const item_code_service_1 = require("./item-code.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
const logger_1 = __importDefault(require("../utils/logger"));
async function getCursor(organizationId, resource) {
    const row = await prisma_1.prisma.rraSyncCursor.findUnique({
        where: { organizationId_resource: { organizationId, resource } },
    });
    return row?.lastReqDt ?? '20200101000000';
}
async function saveCursor(organizationId, resource, lastReqDt, result) {
    await prisma_1.prisma.rraSyncCursor.upsert({
        where: { organizationId_resource: { organizationId, resource } },
        create: { organizationId, resource, lastReqDt, lastRunAt: new Date(), lastResult: result },
        update: { lastReqDt, lastRunAt: new Date(), lastResult: result },
    });
}
// ──────────────────────────────────────────────────────────────
// Codes (§59)
// ──────────────────────────────────────────────────────────────
async function syncRraCodes(organizationId, branchId) {
    const resource = 'codes';
    const since = await getCursor(organizationId, resource);
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return { resource, ok: false, fetched: 0, upserted: 0, error: 'EBM is not enabled', lastReqDt: since };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectCodes)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, resource, since, `FAILED: ${res.resultMsg}`);
        return { resource, ok: false, fetched: 0, upserted: 0, error: `${res.resultCd}: ${res.resultMsg}`, lastReqDt: since };
    }
    const classes = res.data?.clsList ?? [];
    let fetched = 0;
    let upserted = 0;
    for (const cls of classes) {
        for (const dtl of cls.dtlList ?? []) {
            fetched += 1;
            await prisma_1.prisma.rraCode.upsert({
                where: { organizationId_cdCls_cd: { organizationId, cdCls: cls.cdCls, cd: dtl.cd } },
                create: {
                    organizationId,
                    cdCls: cls.cdCls,
                    cdClsNm: cls.cdClsNm ?? null,
                    cd: dtl.cd,
                    cdNm: dtl.cdNm ?? null,
                    cdDesc: dtl.cdDesc ?? null,
                    useYn: dtl.useYn ?? 'Y',
                    srtOrd: dtl.srtOrd ?? null,
                    userDfnCd1: dtl.userDfnCd1 ?? null,
                    userDfnCd2: dtl.userDfnCd2 ?? null,
                    userDfnCd3: dtl.userDfnCd3 ?? null,
                },
                update: {
                    cdClsNm: cls.cdClsNm ?? null,
                    cdNm: dtl.cdNm ?? null,
                    cdDesc: dtl.cdDesc ?? null,
                    useYn: dtl.useYn ?? 'Y',
                    srtOrd: dtl.srtOrd ?? null,
                    userDfnCd1: dtl.userDfnCd1 ?? null,
                    userDfnCd2: dtl.userDfnCd2 ?? null,
                    userDfnCd3: dtl.userDfnCd3 ?? null,
                    lastSyncedAt: new Date(),
                },
            });
            upserted += 1;
        }
    }
    await saveCursor(organizationId, resource, runAt, `OK: ${upserted} codes`);
    return { resource, ok: true, fetched, upserted, lastReqDt: runAt };
}
// ──────────────────────────────────────────────────────────────
// Item classification / UNSPSC (§61)
// ──────────────────────────────────────────────────────────────
async function syncRraItemClasses(organizationId, branchId) {
    const resource = 'itemClasses';
    const since = await getCursor(organizationId, resource);
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return { resource, ok: false, fetched: 0, upserted: 0, error: 'EBM is not enabled', lastReqDt: since };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectItemsClass)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, resource, since, `FAILED: ${res.resultMsg}`);
        return { resource, ok: false, fetched: 0, upserted: 0, error: `${res.resultCd}: ${res.resultMsg}`, lastReqDt: since };
    }
    const list = res.data?.itemClsList ?? [];
    let upserted = 0;
    for (const cls of list) {
        await prisma_1.prisma.rraItemClass.upsert({
            where: { organizationId_itemClsCd: { organizationId, itemClsCd: cls.itemClsCd } },
            create: {
                organizationId,
                itemClsCd: cls.itemClsCd,
                itemClsNm: cls.itemClsNm ?? null,
                itemClsLvl: cls.itemClsLvl ?? null,
                taxTyCd: cls.taxTyCd ?? null,
                mjrTgYn: cls.mjrTgYn ?? null,
                useYn: cls.useYn ?? 'Y',
            },
            update: {
                itemClsNm: cls.itemClsNm ?? null,
                itemClsLvl: cls.itemClsLvl ?? null,
                taxTyCd: cls.taxTyCd ?? null,
                mjrTgYn: cls.mjrTgYn ?? null,
                useYn: cls.useYn ?? 'Y',
                lastSyncedAt: new Date(),
            },
        });
        upserted += 1;
    }
    await saveCursor(organizationId, resource, runAt, `OK: ${upserted} classes`);
    return { resource, ok: true, fetched: list.length, upserted, lastReqDt: runAt };
}
// ──────────────────────────────────────────────────────────────
// Notices (§65)
// ──────────────────────────────────────────────────────────────
async function syncRraNotices(organizationId, branchId) {
    const resource = 'notices';
    const since = await getCursor(organizationId, resource);
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return { resource, ok: false, fetched: 0, upserted: 0, error: 'EBM is not enabled', lastReqDt: since };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectNotices)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, resource, since, `FAILED: ${res.resultMsg}`);
        return { resource, ok: false, fetched: 0, upserted: 0, error: `${res.resultCd}: ${res.resultMsg}`, lastReqDt: since };
    }
    const list = res.data?.noticeList ?? [];
    let upserted = 0;
    for (const n of list) {
        await prisma_1.prisma.rraNotice.upsert({
            where: { organizationId_noticeNo: { organizationId, noticeNo: n.noticeNo } },
            create: {
                organizationId,
                noticeNo: n.noticeNo,
                title: n.title ?? null,
                cont: n.cont ?? null,
                dtlUrl: n.dtlUrl ?? null,
                regrNm: n.regrNm ?? null,
                regDt: n.regDt ?? null,
            },
            update: {
                title: n.title ?? null,
                cont: n.cont ?? null,
                dtlUrl: n.dtlUrl ?? null,
                regrNm: n.regrNm ?? null,
                regDt: n.regDt ?? null,
            },
        });
        upserted += 1;
    }
    await saveCursor(organizationId, resource, runAt, `OK: ${upserted} notices`);
    return { resource, ok: true, fetched: list.length, upserted, lastReqDt: runAt };
}
// ──────────────────────────────────────────────────────────────
// Customer lookup (§62)
// ──────────────────────────────────────────────────────────────
async function verifyCustomerTin(organizationId, custmTin, opts = {}) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return { found: false, error: 'EBM is not enabled' };
    }
    const tin = custmTin.trim();
    if (!/^\d{9}$/.test(tin)) {
        return { found: false, error: 'A customer TIN must be 9 digits' };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectCustomer)(envelope, tin);
    if (!res.success) {
        return { found: false, error: `${res.resultCd}: ${res.resultMsg}` };
    }
    const match = (res.data?.custList ?? []).find((c) => (c.tin ?? '').trim() === tin) ?? res.data?.custList?.[0];
    if (!match) {
        return { found: false, raw: res.raw };
    }
    if (opts.customerId != null) {
        await prisma_1.prisma.customer.updateMany({
            where: { id: opts.customerId, organizationId },
            data: {
                rraVerifiedName: match.taxprNm ?? null,
                rraTaxprSttsCd: match.taxprSttsCd ?? null,
                rraVerifiedAt: new Date(),
            },
        });
    }
    return { found: true, taxprNm: match.taxprNm, taxprSttsCd: match.taxprSttsCd, raw: res.raw };
}
async function pullRraItems(organizationId, branchId) {
    const emptyDiff = { rraOnly: [], localOnly: [], mismatched: [] };
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        return { ok: false, items: [], diff: emptyDiff, error: 'EBM is not enabled' };
    }
    const since = await getCursor(organizationId, 'items');
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? null);
    const res = await (0, vsdc_api_service_1.selectItems)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, 'items', since, `FAILED: ${res.resultMsg}`);
        return { ok: false, items: [], diff: emptyDiff, error: `${res.resultCd}: ${res.resultMsg}` };
    }
    const rraItems = res.data?.itemList ?? [];
    const localProducts = await prisma_1.prisma.product.findMany({
        where: { organizationId },
        select: { id: true, name: true, itemCd: true, itemClsCd: true, itemType: true, taxCode: true, unitPrice: true, ebmSyncStatus: true, origin: true, pkgUnitCd: true, qtyUnitCd: true },
    });
    const localByCd = new Map(localProducts.filter((p) => p.itemCd).map((p) => [p.itemCd, p]));
    const rraByCd = new Map(rraItems.map((i) => [i.itemCd, i]));
    const diff = { rraOnly: [], localOnly: [], mismatched: [] };
    for (const item of rraItems) {
        const local = localByCd.get(item.itemCd);
        if (!local) {
            diff.rraOnly.push(item);
            continue;
        }
        if (item.itemClsCd && local.itemClsCd && item.itemClsCd !== local.itemClsCd) {
            diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'itemClsCd', rra: item.itemClsCd, local: local.itemClsCd });
        }
        if (item.itemTyCd && item.itemTyCd !== (0, item_code_service_1.itemTypeCodeDigit)(local.itemType)) {
            diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'itemTyCd', rra: item.itemTyCd, local: (0, item_code_service_1.itemTypeCodeDigit)(local.itemType) });
        }
        if (item.orgnNatCd && local.origin && item.orgnNatCd !== local.origin) {
            diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'orgnNatCd', rra: item.orgnNatCd, local: local.origin });
        }
        if (item.pkgUnitCd && local.pkgUnitCd && item.pkgUnitCd !== local.pkgUnitCd) {
            diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'pkgUnitCd', rra: item.pkgUnitCd, local: local.pkgUnitCd });
        }
        if (item.qtyUnitCd && local.qtyUnitCd && item.qtyUnitCd !== local.qtyUnitCd) {
            diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'qtyUnitCd', rra: item.qtyUnitCd, local: local.qtyUnitCd });
        }
        if (item.taxTyCd && local.taxCode && item.taxTyCd !== local.taxCode) {
            diff.mismatched.push({ productId: local.id, productName: local.name, itemCd: item.itemCd, field: 'taxTyCd', rra: item.taxTyCd, local: local.taxCode });
        }
    }
    for (const p of localProducts) {
        if (p.itemCd && !rraByCd.has(p.itemCd)) {
            diff.localOnly.push({ id: p.id, name: p.name, itemCd: p.itemCd, ebmSyncStatus: p.ebmSyncStatus ?? null });
        }
    }
    await saveCursor(organizationId, 'items', runAt, `OK: ${rraItems.length} items pulled`);
    return { ok: true, items: rraItems, diff };
}
// ──────────────────────────────────────────────────────────────
// Bulk sync (cron entry point)
// ──────────────────────────────────────────────────────────────
async function syncAllRraMasterData(organizationId, branchId) {
    const outcomes = [];
    for (const fn of [syncRraCodes, syncRraItemClasses, syncRraNotices]) {
        try {
            outcomes.push(await fn(organizationId, branchId));
        }
        catch (e) {
            logger_1.default.error(`[RRA-MASTER-DATA] org ${organizationId} ${fn.name} failed`, e);
            outcomes.push({
                resource: 'codes',
                ok: false,
                fetched: 0,
                upserted: 0,
                error: e instanceof Error ? e.message : 'sync failed',
                lastReqDt: '',
            });
        }
    }
    return outcomes;
}

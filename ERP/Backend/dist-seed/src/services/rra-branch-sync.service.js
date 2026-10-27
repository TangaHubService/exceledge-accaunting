"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRraBranches = syncRraBranches;
exports.syncCustomerToRra = syncCustomerToRra;
exports.syncCustomerToRraAsync = syncCustomerToRraAsync;
exports.syncInsuranceToRra = syncInsuranceToRra;
exports.syncInsuranceToRraAsync = syncInsuranceToRraAsync;
exports.syncUserToRra = syncUserToRra;
exports.syncUserToRraAsync = syncUserToRraAsync;
exports.syncBomComponentToRra = syncBomComponentToRra;
exports.syncBomComponentToRraAsync = syncBomComponentToRraAsync;
exports.syncRraStockMoves = syncRraStockMoves;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("./rra-ebm.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
/**
 * VSDC branch / customer / user / composition / stock-move sync
 * (RRA VSDC API v1.0.5 §3.3.2.4, §3.3.3.1–3.3.3.2, §3.3.4.2, §3.3.8.1).
 */
function clamp(s, max) {
    return (s ?? '').slice(0, max);
}
function custNoFromId(id) {
    // BhfCustSaveReq custNo is CHAR(9) — zero-pad the local customer id.
    return String(id).padStart(9, '0').slice(-9);
}
async function defaultBranchId(organizationId) {
    const b = await prisma_1.prisma.branch.findFirst({
        where: { organizationId, status: 'ACTIVE' },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
        select: { id: true },
    });
    return b?.id ?? null;
}
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
/** POST /branches/selectBranches — align local Branch.bhfId with RRA. */
async function syncRraBranches(organizationId, branchId) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { ok: false, fetched: 0, matched: 0, error: 'EBM is not enabled', branches: [] };
    const since = await getCursor(organizationId, 'branches');
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? (await defaultBranchId(organizationId)));
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { ok: false, fetched: 0, matched: 0, error: envErr, branches: [] };
    const res = await (0, vsdc_api_service_1.selectBranches)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, 'branches', since, `FAILED: ${res.resultMsg}`);
        return { ok: false, fetched: 0, matched: 0, error: `${res.resultCd}: ${res.resultMsg}`, branches: [] };
    }
    const list = res.data?.bhfList ?? [];
    let matched = 0;
    for (const bhf of list) {
        if (!bhf.bhfId)
            continue;
        const local = await prisma_1.prisma.branch.findFirst({
            where: { organizationId, bhfId: bhf.bhfId },
            select: { id: true },
        });
        if (local) {
            matched += 1;
            await prisma_1.prisma.branch.update({
                where: { id: local.id },
                data: {
                    name: bhf.bhfNm || undefined,
                    location: [bhf.prvncNm, bhf.dstrtNm, bhf.sctrNm].filter(Boolean).join(', ') || undefined,
                    address: bhf.locDesc || undefined,
                    phone: bhf.mgrTelNo || undefined,
                    metadata: {
                        rraBranch: bhf,
                        hqYn: bhf.hqYn,
                        bhfSttsCd: bhf.bhfSttsCd,
                        syncedAt: new Date().toISOString(),
                    },
                },
            });
        }
    }
    await saveCursor(organizationId, 'branches', runAt, `OK: ${list.length} branches`);
    return { ok: true, fetched: list.length, matched, branches: list };
}
/** POST /branches/saveBrancheCustomers — push one CIS customer to VSDC. */
async function syncCustomerToRra(organizationId, customerId, opts = {}) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: true };
    const customer = await prisma_1.prisma.customer.findFirst({
        where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer)
        return { success: false, error: 'Customer not found' };
    // Spec requires custTin CHAR(9). Walk-ins without a TIN cannot be pushed.
    const custTin = (customer.TIN ?? '').trim();
    if (!/^\d{9}$/.test(custTin)) {
        return { success: true }; // skip silently — not an RRA taxpayer customer yet
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? (await defaultBranchId(organizationId)));
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const user = opts.userId
        ? await prisma_1.prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
        : null;
    const regrNm = clamp(user?.name ?? 'System', 60);
    const regrId = clamp(user ? String(user.id) : 'system', 20);
    const payload = {
        custNo: custNoFromId(customer.id),
        custTin,
        custNm: clamp(customer.name, 60),
        adrs: clamp(customer.address, 300) || null,
        telNo: clamp(customer.phone, 20) || null,
        email: clamp(customer.email, 50) || null,
        faxNo: null,
        useYn: customer.isActive ? 'Y' : 'N',
        remark: null,
        regrNm,
        regrId,
        modrNm: regrNm,
        modrId: regrId,
    };
    const res = await (0, vsdc_api_service_1.saveBrancheCustomer)(envelope, payload);
    return res.success ? { success: true } : { success: false, error: res.error };
}
function syncCustomerToRraAsync(organizationId, customerId, opts = {}) {
    syncCustomerToRra(organizationId, customerId, opts).catch((err) => {
        console.error(`[EBM][CustomerSync] customerId=${customerId}`, err);
    });
    // Pharmacy insurers also need BhfInsuranceSaveReq (§3.3.3.3).
    syncInsuranceToRra(organizationId, customerId, opts).catch((err) => {
        console.error(`[EBM][InsuranceSync] customerId=${customerId}`, err);
    });
}
/**
 * POST /branches/saveBrancheInsurances — push one pharmacy insurance company.
 * Only applies to CustomerType.INSURANCE with a non-empty isrccCd.
 */
async function syncInsuranceToRra(organizationId, customerId, opts = {}) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: true, skipped: true };
    const customer = await prisma_1.prisma.customer.findFirst({
        where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer)
        return { success: false, error: 'Customer not found' };
    if (customer.customerType !== 'INSURANCE')
        return { success: true, skipped: true };
    const isrccCd = (customer.isrccCd ?? '').trim();
    if (!isrccCd) {
        return { success: false, error: 'Insurance customer requires isrccCd before VSDC sync' };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? (await defaultBranchId(organizationId)));
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const user = opts.userId
        ? await prisma_1.prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
        : null;
    const regrNm = clamp(user?.name ?? 'System', 60);
    const regrId = clamp(user ? String(user.id) : 'system', 20);
    const isrcRt = customer.isrcRt != null ? Number(customer.isrcRt) : 0;
    const payload = {
        isrccCd: clamp(isrccCd, 10),
        isrccNm: clamp(customer.name, 100),
        isrcRt,
        useYn: customer.isActive ? 'Y' : 'N',
        regrNm,
        regrId,
        modrNm: regrNm,
        modrId: regrId,
    };
    const res = await (0, vsdc_api_service_1.saveBrancheInsurance)(envelope, payload);
    return res.success ? { success: true } : { success: false, error: res.error };
}
function syncInsuranceToRraAsync(organizationId, customerId, opts = {}) {
    syncInsuranceToRra(organizationId, customerId, opts).catch((err) => {
        console.error(`[EBM][InsuranceSync] customerId=${customerId}`, err);
    });
}
/** POST /branches/saveBrancheUsers — push a branch cashier/user account. */
async function syncUserToRra(organizationId, userId, opts = {}) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: true };
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            password: true,
            isActive: true,
            deletedAt: true,
            userBranches: { where: { branch: { organizationId } }, select: { branchId: true, isPrimary: true } },
        },
    });
    if (!user || user.deletedAt)
        return { success: false, error: 'User not found' };
    const branchId = opts.branchId
        ?? user.userBranches.find((b) => b.isPrimary)?.branchId
        ?? user.userBranches[0]?.branchId
        ?? (await defaultBranchId(organizationId));
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId);
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const actor = opts.actorUserId
        ? await prisma_1.prisma.user.findUnique({ where: { id: opts.actorUserId }, select: { id: true, name: true } })
        : null;
    const regrNm = clamp(actor?.name ?? 'System', 60);
    const regrId = clamp(actor ? String(actor.id) : 'system', 20);
    // VSDC stores a CIS login credential for recovery — send a non-reversible
    // placeholder derived from the already-hashed password, never a cleartext secret.
    const pwd = clamp(user.password || `user-${user.id}`, 255);
    const payload = {
        userId: clamp(String(user.id), 20),
        userNm: clamp(user.name, 60),
        pwd,
        adrs: null,
        cntc: clamp(user.phone, 20) || null,
        authCd: null,
        remark: clamp(user.email, 2000) || null,
        useYn: user.isActive ? 'Y' : 'N',
        regrNm,
        regrId,
        modrNm: regrNm,
        modrId: regrId,
    };
    const res = await (0, vsdc_api_service_1.saveBrancheUser)(envelope, payload);
    return res.success ? { success: true } : { success: false, error: res.error };
}
function syncUserToRraAsync(organizationId, userId, opts = {}) {
    syncUserToRra(organizationId, userId, opts).catch((err) => {
        console.error(`[EBM][UserSync] userId=${userId}`, err);
    });
}
/** POST /items/saveItemComposition — push one BOM component to VSDC. */
async function syncBomComponentToRra(organizationId, parentProductId, componentProductId, opts = {}) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: true };
    const [parent, component, bom] = await Promise.all([
        prisma_1.prisma.product.findFirst({
            where: { id: parentProductId, organizationId, deletedAt: null },
            select: { itemCd: true },
        }),
        prisma_1.prisma.product.findFirst({
            where: { id: componentProductId, organizationId, deletedAt: null },
            select: { itemCd: true },
        }),
        prisma_1.prisma.bomComponent.findUnique({
            where: {
                parentProductId_componentProductId: { parentProductId, componentProductId },
            },
        }),
    ]);
    if (!bom)
        return { success: false, error: 'BOM component not found' };
    if (!parent?.itemCd || !component?.itemCd) {
        return { success: false, error: 'Parent and component must both have RRA itemCd before composition sync' };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, opts.branchId ?? (await defaultBranchId(organizationId)));
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { success: false, error: envErr };
    const user = opts.userId
        ? await prisma_1.prisma.user.findUnique({ where: { id: opts.userId }, select: { id: true, name: true } })
        : null;
    const regrNm = clamp(user?.name ?? 'System', 60);
    const regrId = clamp(user ? String(user.id) : 'system', 20);
    const res = await (0, vsdc_api_service_1.saveItemComposition)(envelope, {
        itemCd: parent.itemCd,
        cpstItemCd: component.itemCd,
        cpstQty: Number(bom.quantity),
        regrId,
        regrNm,
        modrId: regrId,
        modrNm: regrNm,
    });
    return res.success ? { success: true } : { success: false, error: res.error };
}
function syncBomComponentToRraAsync(organizationId, parentProductId, componentProductId, opts = {}) {
    syncBomComponentToRra(organizationId, parentProductId, componentProductId, opts).catch((err) => {
        console.error(`[EBM][BomSync] parent=${parentProductId} component=${componentProductId}`, err);
    });
}
/** POST /stock/selectStockItems — pull HQ↔branch stock movements for audit. */
async function syncRraStockMoves(organizationId, branchId) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { ok: false, fetched: 0, error: 'EBM is not enabled', stockList: [] };
    const since = await getCursor(organizationId, 'stockMoves');
    const runAt = (0, vsdc_api_service_1.toRraReqDt)(new Date());
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, branchId ?? (await defaultBranchId(organizationId)));
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr)
        return { ok: false, fetched: 0, error: envErr, stockList: [] };
    const res = await (0, vsdc_api_service_1.selectStockItems)(envelope, since);
    if (!res.success) {
        await saveCursor(organizationId, 'stockMoves', since, `FAILED: ${res.resultMsg}`);
        return { ok: false, fetched: 0, error: `${res.resultCd}: ${res.resultMsg}`, stockList: [] };
    }
    const list = res.data?.stockList ?? [];
    await saveCursor(organizationId, 'stockMoves', runAt, `OK: ${list.length} stock moves`);
    return { ok: true, fetched: list.length, stockList: list };
}

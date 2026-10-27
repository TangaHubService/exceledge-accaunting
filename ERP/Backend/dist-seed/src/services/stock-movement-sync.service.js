"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sarTyCdFor = sarTyCdFor;
exports.stockMovementNeedsEbm = stockMovementNeedsEbm;
exports.submitStockLedgerEntryToEbm = submitStockLedgerEntryToEbm;
exports.submitStockLedgerEntryToEbmAsync = submitStockLedgerEntryToEbmAsync;
exports.processStockSyncBatch = processStockSyncBatch;
exports.queuePendingStockForOrg = queuePendingStockForOrg;
const prisma_1 = require("../lib/prisma");
const rra_ebm_service_1 = require("./rra-ebm.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
const inventory_ledger_service_1 = require("./inventory-ledger.service");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * RRA Stock In/Out + Stock Master sync (RRA checklist §23, §72, §73).
 *
 * Every non-sale inventory movement (purchase receipt, adjustment, transfer,
 * damage/expiry, customer return) is reported to the VSDC as a Store Adjustment
 * Record via /stock/saveStockItems, and the item's new on-hand quantity is
 * pushed via /stockMaster/saveStockMaster. SALE movements are NOT sent here —
 * RRA derives the stock-out from /trnsSales/saveSales (stockRlsDt), so
 * double-reporting is avoided by never marking SALE ledger rows PENDING.
 */
/** VSDC §4.19 Stock In/Out (`sarTyCd`) — mapped from our movement type + direction. */
function sarTyCdFor(movementType, direction, referenceType) {
    if (direction === 'IN') {
        // An approved import declaration books its stock-in as an Import (01),
        // not a Purchase (02) — see rra-import.service.ts.
        if (referenceType === 'RRA_IMPORT')
            return '01';
        switch (movementType) {
            case 'PURCHASE': return '02'; // Purchase
            case 'RETURN_CUSTOMER': return '03'; // Return
            case 'TRANSFER_IN': return '04'; // Stock Movement
            case 'INITIAL_STOCK':
            case 'ADJUSTMENT_IN':
            case 'ADJUSTMENT':
            case 'CORRECTION': return '06'; // Adjustment (incremental)
            default: return '06';
        }
    }
    switch (movementType) {
        case 'SALE': return null; // handled by /trnsSales/saveSales
        case 'TRANSFER_OUT': return '13'; // Stock Movement
        case 'DAMAGE':
        case 'EXPIRED': return '15'; // Discarding
        case 'ADJUSTMENT_OUT':
        case 'ADJUSTMENT':
        case 'CORRECTION': return '16'; // Adjustment (decremental)
        default: return '16';
    }
}
/** Whether an inventory movement needs to be reported to RRA as a stock adjustment. */
function stockMovementNeedsEbm(movementType) {
    return movementType !== 'SALE';
}
async function allocateSarNo(organizationId) {
    const row = await prisma_1.prisma.inventoryLedger.aggregate({
        where: { organizationId, ebmSarNo: { not: null } },
        _max: { ebmSarNo: true },
    });
    return (row._max.ebmSarNo ?? 0) + 1;
}
/**
 * Submit one InventoryLedger entry to RRA (/stock/saveStockItems) and then
 * push the item's new remaining quantity (/stockMaster/saveStockMaster).
 * Idempotent: a row already SYNCED is skipped; a persisted `ebmSarNo` is reused
 * on retry so RRA does not reject a duplicate SAR number.
 */
async function submitStockLedgerEntryToEbm(ledgerId) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { success: true };
    const entry = await prisma_1.prisma.inventoryLedger.findUnique({
        where: { id: ledgerId },
        include: {
            product: { select: { id: true, name: true, itemCd: true, itemClsCd: true, pkgUnitCd: true, qtyUnitCd: true, barcode: true, taxCode: true, unitPrice: true } },
            user: { select: { id: true, name: true } },
        },
    });
    if (!entry)
        return { success: false, error: 'Ledger entry not found' };
    if (entry.ebmSyncStatus === 'SYNCED')
        return { success: true };
    if (!stockMovementNeedsEbm(entry.movementType)) {
        await prisma_1.prisma.inventoryLedger.update({ where: { id: ledgerId }, data: { ebmSyncStatus: null } });
        return { success: true };
    }
    const sarTyCd = sarTyCdFor(entry.movementType, entry.direction, entry.referenceType);
    if (!sarTyCd) {
        await prisma_1.prisma.inventoryLedger.update({ where: { id: ledgerId }, data: { ebmSyncStatus: null } });
        return { success: true };
    }
    const product = entry.product;
    if (!product?.itemCd) {
        await prisma_1.prisma.inventoryLedger.update({
            where: { id: ledgerId },
            data: { ebmSyncStatus: 'FAILED', ebmError: 'Product has no itemCd — register it with RRA first' },
        });
        return { success: false, error: 'Product has no itemCd' };
    }
    if (!product.itemClsCd?.trim()) {
        await prisma_1.prisma.inventoryLedger.update({
            where: { id: ledgerId },
            data: { ebmSyncStatus: 'FAILED', ebmError: 'Product has no itemClsCd — select an RRA item classification first' },
        });
        return { success: false, error: 'Product has no itemClsCd' };
    }
    const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(entry.organizationId, entry.branchId);
    const envErr = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
    if (envErr) {
        await prisma_1.prisma.inventoryLedger.update({ where: { id: ledgerId }, data: { ebmSyncStatus: 'FAILED', ebmError: envErr } });
        return { success: false, error: envErr };
    }
    const qty = Math.abs(entry.quantity);
    const prc = entry.unitCost != null ? Math.abs(entry.unitCost.toNumber()) : Math.abs(product.unitPrice.toNumber());
    const splyAmt = (0, rra_ebm_service_1.fix2)(qty * prc);
    const taxTyCd = (product.taxCode ?? 'B').toUpperCase();
    // §4.19: incoming purchases carry input VAT; other adjustments net to zero tax.
    const rate = taxTyCd === 'B' ? 18 : 0;
    const taxAmt = sarTyCd === '02' && rate > 0 ? (0, rra_ebm_service_1.fix2)(splyAmt - splyAmt / (1 + rate / 100)) : 0;
    const taxblAmt = (0, rra_ebm_service_1.fix2)(splyAmt - taxAmt);
    const sarNo = entry.ebmSarNo ?? (await allocateSarNo(entry.organizationId));
    const regr = { id: String(entry.user?.id ?? 'system'), name: entry.user?.name ?? 'System' };
    const now = entry.createdAt;
    const payload = {
        sarNo,
        orgSarNo: 0,
        regTyCd: 'M', // Manual
        // StockIOSaveReq sample uses null customer fields for non-transfer movements.
        // Only inter-branch transfers should populate the counterparty TIN/bhfId.
        custTin: null,
        custNm: null,
        custBhfId: null,
        sarTyCd,
        ocrnDt: (0, rra_ebm_service_1.toRraDate)(now),
        totItemCnt: 1,
        totTaxblAmt: taxblAmt,
        totTaxAmt: taxAmt,
        totAmt: splyAmt,
        remark: entry.note ?? entry.movementType,
        regrId: regr.id,
        regrNm: regr.name,
        modrId: regr.id,
        modrNm: regr.name,
        itemList: [
            {
                itemSeq: 1,
                itemCd: product.itemCd,
                itemClsCd: product.itemClsCd,
                itemNm: product.name,
                bcd: product.barcode ?? null,
                pkgUnitCd: product.pkgUnitCd ?? 'CT',
                pkg: qty,
                qtyUnitCd: product.qtyUnitCd ?? 'U',
                qty,
                itemExprDt: null,
                prc,
                splyAmt,
                totDcAmt: 0,
                taxblAmt,
                taxTyCd,
                taxAmt,
                totAmt: splyAmt,
            },
        ],
    };
    try {
        await prisma_1.prisma.inventoryLedger.update({
            where: { id: ledgerId },
            data: { ebmSyncStatus: 'PENDING', ebmSarNo: sarNo, ebmError: null },
        });
        const io = await (0, vsdc_api_service_1.saveStockItems)(envelope, payload);
        if (!io.success) {
            await prisma_1.prisma.inventoryLedger.update({
                where: { id: ledgerId },
                data: { ebmSyncStatus: 'FAILED', ebmError: io.error ?? 'saveStockItems failed' },
            });
            return { success: false, error: io.error };
        }
        // §73 — push the item's new on-hand quantity to the stock master.
        const onHand = await (0, inventory_ledger_service_1.getCurrentStock)(entry.organizationId, product.id, entry.branchId);
        const master = await (0, vsdc_api_service_1.saveStockMaster)(envelope, product.itemCd, onHand, regr);
        if (!master.success) {
            // The IO record went through; flag the master push for retry but do not lose the IO.
            await prisma_1.prisma.inventoryLedger.update({
                where: { id: ledgerId },
                data: { ebmSyncStatus: 'FAILED', ebmError: `stock master push failed: ${master.error}` },
            });
            return { success: false, error: master.error };
        }
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.inventoryLedger.update({
                where: { id: ledgerId },
                data: { ebmSyncStatus: 'SYNCED', ebmSyncedAt: new Date(), ebmError: null },
            }),
            prisma_1.prisma.organization.update({
                where: { id: entry.organizationId },
                data: { lastSuccessfulVdsContact: new Date() },
            }),
        ]);
        return { success: true };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Stock sync error';
        await prisma_1.prisma.inventoryLedger.update({
            where: { id: ledgerId },
            data: { ebmSyncStatus: 'FAILED', ebmError: message },
        });
        return { success: false, error: message };
    }
}
/** Fire-and-forget wrapper — called from the write paths that create a ledger row. */
function submitStockLedgerEntryToEbmAsync(ledgerId) {
    submitStockLedgerEntryToEbm(ledgerId).catch((err) => logger_1.default.error(`[EBM] stock ledger #${ledgerId} sync failed`, err));
}
/** Process PENDING/FAILED stock ledger rows in batch (cron job). */
async function processStockSyncBatch(limit = 25) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)())
        return { processed: 0, succeeded: 0, failed: 0 };
    const rows = await prisma_1.prisma.inventoryLedger.findMany({
        where: { ebmSyncStatus: { in: ['PENDING', 'FAILED'] }, movementType: { not: 'SALE' } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
    });
    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
        const r = await submitStockLedgerEntryToEbm(row.id);
        if (r.success)
            succeeded += 1;
        else
            failed += 1;
    }
    return { processed: rows.length, succeeded, failed };
}
/**
 * Mark every not-yet-synced non-sale ledger row for this org PENDING so the
 * next batch picks them up. Used by the "sync stock now" endpoint.
 */
async function queuePendingStockForOrg(organizationId) {
    const res = await prisma_1.prisma.inventoryLedger.updateMany({
        where: {
            organizationId,
            movementType: { not: 'SALE' },
            OR: [{ ebmSyncStatus: null }, { ebmSyncStatus: 'FAILED' }],
        },
        data: { ebmSyncStatus: 'PENDING' },
    });
    return res.count;
}

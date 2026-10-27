"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEbmEnabled = void 0;
exports.createSaleWithOutbox = createSaleWithOutbox;
exports.payDebtWithTransaction = payDebtWithTransaction;
exports.processEbmOutboxBatch = processEbmOutboxBatch;
exports.retryEbmOutboxEntry = retryEbmOutboxEntry;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../config");
const rra_ebm_service_1 = require("./rra-ebm.service");
Object.defineProperty(exports, "isEbmEnabled", { enumerable: true, get: function () { return rra_ebm_service_1.isEbmEnabled; } });
const rra_code_service_1 = require("./rra-code.service");
const vsdc_api_service_1 = require("./vsdc-api.service");
const electronic_journal_service_1 = require("./electronic-journal.service");
const logger_1 = __importDefault(require("../utils/logger"));
const tax_service_1 = require("./tax.service");
const inventory_ledger_service_1 = require("./inventory-ledger.service");
// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function generateIdempotencyKey(orgId, operation, saleId) {
    return `ebm-${operation}-${orgId}-${saleId}`;
}
// ──────────────────────────────────────────────
// Module 2: Atomic Checkout with Transactional Outbox
// ──────────────────────────────────────────────
/**
 * Create a sale and write an EBM outbox entry in a single atomic transaction.
 *
 * Guarantees:
 *  - Inventory deduction, balance update, and outbox write are ACID.
 *  - Idempotency key is unique at the DB level, preventing double-submission
 *    even if the outbox worker crashes and restarts.
 *  - Sale is always completed; VSDC submission is async via the outbox.
 */
async function createSaleWithOutbox(input) {
    const { organizationId, branchId, userId, customerId, items, paymentType, cashAmount, insuranceAmount, debtAmount, shiftId, } = input;
    const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const saleNumber = `SALE-${Date.now()}`;
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { vatRegistered: true, isTaxExempt: true },
    });
    const vatRegistered = org?.vatRegistered ?? false;
    const isTaxExempt = org?.isTaxExempt ?? false;
    const operation = 'SALE';
    const sale = await prisma_1.prisma.$transaction(async (tx) => {
        // 1. Validate stock with row-level locking
        for (const item of items) {
            const [locked] = await tx.$queryRaw `
        SELECT id, name FROM products
        WHERE id = ${item.productId} AND "organizationId" = ${organizationId}
        FOR UPDATE
      `;
            if (!locked) {
                throw new Error(`Product ID ${item.productId} not found`);
            }
            const stock = await (0, inventory_ledger_service_1.getCurrentStockInTransaction)(tx, organizationId, item.productId, branchId);
            if (stock < item.quantity) {
                const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
                throw new Error(`Insufficient stock for ${prod?.name ?? `#${item.productId}`}. Available: ${stock}, requested: ${item.quantity}`);
            }
        }
        // 2. Calculate tax (forced to A for tax-exempt entities, else D for non-VAT-registered taxpayers)
        const taxSummary = await tax_service_1.TaxService.calculateSaleTax(organizationId, items.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })), vatRegistered, isTaxExempt);
        // 3. Create sale + items
        const saleItemsData = items.map((item, idx) => {
            const t = taxSummary.items[idx];
            return {
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.quantity * item.unitPrice,
                costPrice: 0,
                profit: 0,
                taxRate: t.taxRate,
                taxAmount: t.taxAmount,
                taxCode: t.taxCode,
                measurementUnit: item.measurementUnit,
                exemptionReference: item.exemptionReference ?? null,
                product: { connect: { id: item.productId } },
            };
        });
        // Allocate the RRA invoice sequence inside the transaction so a rollback
        // (bad stock, tax mismatch, etc.) also rolls back the sequence increment.
        const { invoiceNumber, vsdcInvcNo } = await (0, rra_ebm_service_1.generateInvoiceNumber)(organizationId, branchId, tx);
        const newSale = await tx.sale.create({
            data: {
                saleNumber,
                invoiceNumber,
                vsdcInvcNo,
                customerId,
                userId,
                organizationId,
                branchId,
                paymentType,
                cashAmount,
                insuranceAmount,
                debtAmount,
                shiftId,
                totalAmount,
                vatAmount: taxSummary.vatAmount,
                taxableAmount: taxSummary.taxableAmount,
                status: 'COMPLETED',
                saleItems: { create: saleItemsData },
            },
            include: {
                saleItems: { include: { product: true } },
                customer: true,
            },
        });
        // 4. Deduct inventory (ledger entries)
        for (const item of items) {
            await (0, inventory_ledger_service_1.removeStock)({
                organizationId,
                productId: item.productId,
                userId,
                quantity: item.quantity,
                movementType: 'SALE',
                branchId,
                reference: saleNumber,
                referenceType: 'SALE',
                note: `Sale #${saleNumber}`,
                tx,
            });
        }
        // 5. Update customer balance for debt
        const remainingDebt = totalAmount - cashAmount - insuranceAmount;
        if (remainingDebt > 0) {
            await tx.customer.update({
                where: { id: customerId },
                data: { balance: { increment: remainingDebt } },
            });
        }
        // 6. Write transactional outbox (atomic with the sale)
        const outboxPayload = {
            version: 1,
            saleId: newSale.id,
            organizationId,
            operation,
        };
        await tx.ebmOutbox.create({
            data: {
                organizationId,
                saleId: newSale.id,
                operation,
                idempotencyKey: generateIdempotencyKey(organizationId, operation, newSale.id),
                payload: outboxPayload,
                status: 'PENDING',
                nextAttemptAt: new Date(),
            },
        });
        return newSale;
    }, {
        maxWait: 30000,
        timeout: 60000,
    });
    return sale;
}
// ──────────────────────────────────────────────
// payDebt — now inside a transaction
// ──────────────────────────────────────────────
async function payDebtWithTransaction(saleId, organizationId, amount) {
    await prisma_1.prisma.$transaction(async (tx) => {
        const sale = await tx.sale.findFirst({
            where: { id: saleId, organizationId },
            select: { id: true, debtAmount: true, customerId: true, status: true },
        });
        if (!sale)
            throw new Error('Sale not found');
        if (sale.status === 'REFUNDED' || sale.status === 'CANCELLED') {
            throw new Error(`Cannot process payment for ${sale.status.toLowerCase()} sale`);
        }
        const currentDebt = Number(sale.debtAmount);
        if (amount > currentDebt) {
            throw new Error('Payment amount exceeds remaining debt');
        }
        await tx.sale.update({
            where: { id: saleId },
            data: {
                debtAmount: { decrement: amount },
                cashAmount: { increment: amount },
            },
        });
        await tx.customer.update({
            where: { id: sale.customerId },
            data: { balance: { decrement: amount } },
        });
    });
}
// ──────────────────────────────────────────────
// Module 4: Resilient Outbox Worker & Reconciler
// ──────────────────────────────────────────────
/**
 * Resolve an orphan outbox entry stuck in PROCESSING state.
 * Queries the VSDC status endpoint; marks SUCCEEDED if already fiscalized.
 */
async function resolveOrphanedSubmission(outboxEntry) {
    const statusPath = config_1.config.ebm.statusCheckPath;
    if (!statusPath)
        return 'RETRY';
    try {
        const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(outboxEntry.organizationId);
        const result = await (0, vsdc_api_service_1.vsdcHeartbeat)(envelope);
        if (result.success && result.data) {
            const normalized = (0, vsdc_api_service_1.parseVsdcResponse)(result.rawBody);
            if (normalized.rcptNo) {
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: outboxEntry.id },
                    data: {
                        status: 'SUCCEEDED',
                        sdcDateTime: normalized.sdcDateTime ? new Date(normalized.sdcDateTime) : null,
                        lastError: null,
                    },
                });
                return 'SUCCEEDED';
            }
        }
        return 'FAILED';
    }
    catch {
        return 'RETRY';
    }
}
/**
 * Process pending EBM outbox entries in batch.
 *
 * 1. Orphan reconciliaition: entries in PROCESSING are probed via status endpoint.
 * 2. Idempotent dispatch: every VSDC payload carries the idempotencyKey.
 * 3. Cursor persistence: on success, saves sdcDateTime and updates organization sync state.
 */
async function processEbmOutboxBatch(limit = 25) {
    if (!(0, rra_ebm_service_1.isEbmEnabled)()) {
        logger_1.default.info('[EBM-OUTBOX] processEbmOutboxBatch skipped: EBM disabled');
        return { processed: 0, succeeded: 0, failed: 0 };
    }
    // A VSDC call can take up to the configured request timeout. Do not let the
    // cron job (or another checkout) reclaim a row that is still being sent by a
    // live worker. Only genuinely stale PROCESSING rows are reconciled.
    const staleProcessingBefore = new Date(Date.now() - Math.max(config_1.config.ebm.requestTimeoutMs * 2, 60000));
    const rows = await prisma_1.prisma.ebmOutbox.findMany({
        where: {
            nextAttemptAt: { lte: new Date() },
            retryCount: { lt: config_1.config.ebm.maxQueueRetries },
            OR: [
                { status: { in: ['PENDING', 'FAILED'] } },
                { status: 'PROCESSING', updatedAt: { lte: staleProcessingBefore } },
            ],
        },
        orderBy: [{ retryCount: 'asc' }, { createdAt: 'asc' }],
        take: limit,
    });
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    logger_1.default.info(`[EBM-OUTBOX] processEbmOutboxBatch: fetched ${rows.length} due row(s) (limit=${limit})`);
    for (const row of rows) {
        // Claim the row before building its payload or calling VSDC. The previous
        // implementation selected then updated it, allowing simultaneous requests
        // from the immediate checkout worker and the cron worker to both submit the
        // same fiscal receipt. `updatedAt` makes this conditional update a lease for
        // stale PROCESSING rows as well.
        const claim = await prisma_1.prisma.ebmOutbox.updateMany({
            where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
            data: { status: 'PROCESSING' },
        });
        if (claim.count !== 1) {
            logger_1.default.warn(`[EBM-OUTBOX] row ${row.id} (op=${row.operation}) not claimed (concurrent worker) — skipping`);
            continue;
        }
        processed += 1;
        logger_1.default.info(`[EBM-OUTBOX] row ${row.id} (op=${row.operation}, saleId=${row.saleId}, org=${row.organizationId}) claimed — processing (status=${row.status}, retry=${row.retryCount})`);
        // ── Orphan reconciliaition ──
        if (row.status === 'PROCESSING') {
            const resolution = await resolveOrphanedSubmission(row);
            if (resolution === 'SUCCEEDED') {
                succeeded += 1;
                continue;
            }
            if (resolution === 'RETRY') {
                continue; // leave for next cycle
            }
            // resolution === 'FAILED' — fall through to re-submit below
        }
        // ── Reload sale & build payload ──
        const sale = (await prisma_1.prisma.sale.findFirst({
            where: { id: row.saleId, organizationId: row.organizationId },
            include: {
                saleItems: {
                    include: {
                        product: { select: { name: true, itemCd: true, itemClsCd: true, pkgUnitCd: true, qtyUnitCd: true, packagingQty: true, barcode: true, useInsurance: true } },
                    },
                },
                customer: true,
                branch: true,
                user: { select: { id: true, name: true } },
            },
        }));
        if (!sale) {
            await prisma_1.prisma.ebmOutbox.update({
                where: { id: row.id },
                data: { status: 'DEAD_LETTER', lastError: 'Sale not found' },
            });
            logger_1.default.error(`[EBM-OUTBOX] row ${row.id}: sale ${row.saleId} not found — DEAD_LETTER`);
            failed += 1;
            continue;
        }
        logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: sale ${sale.id} loaded (invoice=${sale.invoiceNumber}, vsdcInvcNo=${sale.vsdcInvcNo ?? 'N/A'}, custTin=${sale.customer?.TIN ?? 'N/A'}, cust prcOrdCd=${sale.customer?.prcOrdCd ?? 'N/A'}, sale prcOrdCd=${sale.prcOrdCd ?? 'N/A'})`);
        // For SALE operations only: skip if the sale was voided/refunded before we submitted it.
        // For REFUND/VOID operations the sale status is *expected* to be REFUNDED/CANCELLED.
        if (row.operation === 'SALE' && (sale.status === 'REFUNDED' || sale.status === 'CANCELLED')) {
            await prisma_1.prisma.ebmOutbox.update({
                where: { id: row.id },
                data: { status: 'DEAD_LETTER', lastError: `Sale ${sale.status.toLowerCase()} before VSDC processing` },
            });
            failed += 1;
            continue;
        }
        const org = await prisma_1.prisma.organization.findUnique({
            where: { id: row.organizationId },
            select: { TIN: true, name: true, address: true },
        });
        if (!org) {
            await prisma_1.prisma.ebmOutbox.update({
                where: { id: row.id },
                data: { status: 'DEAD_LETTER', lastError: 'Organization not found' },
            });
            failed += 1;
            continue;
        }
        // ── Auto-allocate an RRA purchase code when the sale has none on record ──
        // The sandbox rejects every sale without a real single-use code (881/882).
        // Allocation is strictly buyer-scoped (consumeAnyOrgPurchaseCode): a code
        // pooled for another buyer TIN carries the wrong checksum and is rejected
        // with 882, so we never borrow across buyers. When this buyer's pool is
        // empty the payload builder throws an actionable top-up error and the row
        // retries with backoff until the operator tops the pool up.
        // Only persists when an allocation is actually made, so retries reuse the
        // same code (a consumed code cannot be re-submitted: 883).
        if (row.operation === 'SALE') {
            const needsCode = !(sale.prcOrdCd?.trim())
                && !(sale.customer?.prcOrdCd?.trim());
            logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: SALE code check — needsCode=${needsCode}`);
            if (needsCode) {
                const allocated = await (0, rra_ebm_service_1.consumeAnyOrgPurchaseCode)(row.organizationId, sale.id, prisma_1.prisma, (0, rra_ebm_service_1.effectiveBuyerTin)(sale) || undefined)
                    ?? (sale.customer?.prcOrdCd ?? null);
                logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: allocated purchase code = ${allocated ?? 'NONE (pool empty, no customer fallback)'}`);
                if (allocated) {
                    await prisma_1.prisma.sale.update({
                        where: { id: sale.id },
                        data: { prcOrdCd: allocated },
                    });
                    sale.prcOrdCd = allocated;
                }
            }
        }
        // Build gateway payload based on operation type
        let payload;
        if (row.operation === 'SALE') {
            let rraPaymentCode;
            try {
                rraPaymentCode = await (0, rra_code_service_1.getRraPaymentCode)(row.organizationId, sale.paymentType);
            }
            catch (e) {
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: { status: 'DEAD_LETTER', lastError: e instanceof Error ? e.message : 'Invalid payment method mapping' },
                });
                failed += 1;
                continue;
            }
            try {
                payload = (0, rra_ebm_service_1.buildRraSendReceiptPayload)(sale, org, rraPaymentCode);
            }
            catch (e) {
                // A structurally bad sale dead-letters alone without blocking the
                // batch; a missing purchase code backs off for retry (transient).
                await handleBuildError(row, e);
                failed += 1;
                continue;
            }
            payload['idempotencyKey'] = row.idempotencyKey;
        }
        else if (row.operation === 'REFUND') {
            // For REFUND: find the original SALE's EBM invoice number
            const outboxPayload = row.payload;
            const originalSaleId = outboxPayload?.originalSaleId ?? sale.originalSaleId;
            const origTx = originalSaleId
                ? await prisma_1.prisma.ebmTransaction.findFirst({
                    where: { saleId: originalSaleId, operation: 'SALE', submissionStatus: 'SUCCESS', ebmInvoiceNumber: { not: null } },
                    orderBy: { createdAt: 'desc' },
                })
                : null;
            if (!origTx?.ebmInvoiceNumber) {
                // Original invoice not fiscalized yet — defer this refund to retry later
                const nextRetry = scheduleNextRetry(row.retryCount);
                const isDead = row.retryCount + 1 >= (config_1.config.ebm.maxQueueRetries ?? 10);
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: {
                        status: isDead ? 'DEAD_LETTER' : 'FAILED',
                        retryCount: { increment: 1 },
                        lastError: 'Original invoice not yet fiscalized — deferring refund',
                        nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
                    },
                });
                if (isDead)
                    failed += 1;
                continue;
            }
            const originalSale = originalSaleId
                ? await prisma_1.prisma.sale.findFirst({ where: { id: originalSaleId }, select: { invoiceNumber: true, vsdcInvcNo: true, totalAmount: true } })
                : null;
            let rraPaymentCode;
            try {
                rraPaymentCode = await (0, rra_code_service_1.getRraPaymentCode)(row.organizationId, sale.paymentType);
            }
            catch (e) {
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: { status: 'DEAD_LETTER', lastError: e instanceof Error ? e.message : 'Invalid payment method mapping' },
                });
                failed += 1;
                continue;
            }
            try {
                // RRA refund reason (code class 32, sent as rfdRsnCd): the operator's
                // selection travels on the outbox payload (preferred) with the refund
                // sale's stored code as fallback; anything outside RRA's list is a
                // permanent error (the sandbox rejects it with 910), so validate
                // before submitting. Default '06 Refund' when neither carries one.
                const rawRsn = row.payload?.rfdRsnCd
                    ?? sale.rfdRsnCd
                    ?? rra_code_service_1.DEFAULT_RFD_RSN_CD;
                let rfdRsnCd;
                try {
                    rfdRsnCd = (0, rra_code_service_1.validateRefundReasonCode)(rawRsn);
                }
                catch (e) {
                    await prisma_1.prisma.ebmOutbox.update({
                        where: { id: row.id },
                        data: { status: 'DEAD_LETTER', lastError: e instanceof Error ? e.message : 'Invalid refund reason code' },
                    });
                    failed += 1;
                    continue;
                }
                // A refund is a fresh fiscal document (new invcNo, salesSttsCd=05),
                // so it needs its own unconsumed purchase code for the customer TIN —
                // a code already consumed by the original sale is rejected (883), and
                // a missing/invalid one is rejected (881/882).
                const refundCustTin = (0, rra_ebm_service_1.effectiveBuyerTin)(sale);
                const refundCode = await (0, rra_ebm_service_1.consumeAnyOrgPurchaseCode)(row.organizationId, sale.id, prisma_1.prisma, refundCustTin || undefined);
                if (refundCode) {
                    await prisma_1.prisma.sale.update({ where: { id: sale.id }, data: { prcOrdCd: refundCode } });
                    sale.prcOrdCd = refundCode;
                }
                payload = (0, rra_ebm_service_1.buildRraSendReceiptPayload)(sale, org, rraPaymentCode, {
                    orgInvcNo: originalSale?.vsdcInvcNo ?? undefined,
                    rfdDt: new Date(),
                    rfdRsnCd,
                });
                payload.remark = row.payload?.reason ?? '';
                payload.idempotencyKey = row.idempotencyKey;
            }
            catch (e) {
                await handleBuildError(row, e);
                failed += 1;
                continue;
            }
        }
        else {
            // VOID: only fire if original was fiscalized
            const origTx = await prisma_1.prisma.ebmTransaction.findFirst({
                where: { saleId: row.saleId, operation: 'SALE', submissionStatus: 'SUCCESS', ebmInvoiceNumber: { not: null } },
                orderBy: { createdAt: 'desc' },
            });
            if (!origTx?.ebmInvoiceNumber) {
                // Sale was never fiscalized — nothing to void at RRA
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: { status: 'SUCCEEDED', lastError: 'Original invoice never fiscalized — void skipped' },
                });
                succeeded += 1;
                continue;
            }
            let rraPaymentCode;
            try {
                rraPaymentCode = await (0, rra_code_service_1.getRraPaymentCode)(row.organizationId, sale.paymentType);
            }
            catch (e) {
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: { status: 'DEAD_LETTER', lastError: e instanceof Error ? e.message : 'Invalid payment method mapping' },
                });
                failed += 1;
                continue;
            }
            try {
                // A cancellation is a NEW sales-transaction document (fresh invcNo)
                // with cnclDt/cnclReqDt set and salesSttsCd='04' — the sandbox
                // rejects a resubmitted invcNo (924) and rejects orgInvcNo on a void
                // (910: orgInvcNo is refund-only). Confirmed against the RRA VSDC
                // sandbox 2026-08-10.
                //
                // A void is a fresh submission, so it needs a fresh unconsumed
                // purchase code too: reusing the original sale's (already consumed)
                // code is rejected with 883. Allocate a new valid one for the buyer.
                const voidCustTin = (0, rra_ebm_service_1.effectiveBuyerTin)(sale);
                const voidCode = await (0, rra_ebm_service_1.consumeAnyOrgPurchaseCode)(row.organizationId, sale.id, prisma_1.prisma, voidCustTin || undefined);
                if (voidCode) {
                    await prisma_1.prisma.sale.update({ where: { id: sale.id }, data: { prcOrdCd: voidCode } });
                    sale.prcOrdCd = voidCode;
                }
                const { vsdcInvcNo: voidInvcNo } = await (0, rra_ebm_service_1.generateInvoiceNumber)(row.organizationId, sale.branchId);
                payload = (0, rra_ebm_service_1.buildRraSendReceiptPayload)(sale, org, rraPaymentCode, { cnclDt: new Date(), invcNoOverride: voidInvcNo });
                payload.remark = row.payload?.reason ?? '';
                payload.idempotencyKey = row.idempotencyKey;
            }
            catch (e) {
                await handleBuildError(row, e);
                failed += 1;
                continue;
            }
        }
        // ── Record attempt in EbmTransaction (audit trail) ──
        // Retries re-use the transaction row created on the first attempt
        // (idempotencyKey is unique), resetting it to SUBMITTED instead of failing
        // the duplicate insert.
        const txRow = await prisma_1.prisma.ebmTransaction.upsert({
            where: { idempotencyKey: row.idempotencyKey },
            create: {
                organizationId: row.organizationId,
                saleId: row.saleId,
                invoiceNumber: sale.invoiceNumber,
                operation: row.operation,
                submissionStatus: 'SUBMITTED',
                idempotencyKey: row.idempotencyKey,
            },
            update: {
                submissionStatus: 'SUBMITTED',
                ebmInvoiceNumber: null,
                errorMessage: null,
                sdcRcptNo: null,
                totalRcptNo: null,
                sdcId: null,
                internalData: null,
                receiptSignature: null,
            },
        });
        try {
            // Check training mode — log but do not hit the live VSDC endpoint.
            // Mark SUCCEEDED so the entry doesn't pile up as failures.
            const orgCheck = await prisma_1.prisma.organization.findUnique({
                where: { id: row.organizationId },
                select: { trainingMode: true },
            });
            if (orgCheck?.trainingMode) {
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: { status: 'SUCCEEDED', lastError: 'Training mode — VSDC submission skipped' },
                });
                succeeded += 1;
                continue;
            }
            const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(row.organizationId, sale.branchId);
            // §22: never submit against a device that is not usable (missing/invalid
            // TIN or no MRC serial). Retryable — the operator can fix the config and
            // the next cron cycle picks the row back up.
            const envelopeError = (0, vsdc_api_service_1.validateVsdcEnvelope)(envelope);
            if (envelopeError) {
                await failSubmission(txRow.id, envelopeError);
                const nextRetry = scheduleNextRetry(row.retryCount);
                const isDead = row.retryCount + 1 >= (config_1.config.ebm.maxQueueRetries ?? 10);
                await prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: {
                        status: isDead ? 'DEAD_LETTER' : 'FAILED',
                        retryCount: { increment: 1 },
                        lastError: envelopeError,
                        nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
                    },
                });
                logger_1.default.warn(`[EBM-OUTBOX] row ${row.id}: device not configured — ${envelopeError}`);
                failed += 1;
                continue;
            }
            logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: calling saveInvc (${config_1.config.ebm.apiUrl ?? ''}/trnsSales/saveSales) — prcOrdCd=${payload.prcOrdCd ?? 'N/A'}, custTin=${payload.receipt?.custTin ?? 'N/A'}, invcNo=${payload.invcNo ?? 'N/A'}`);
            let result = await (0, vsdc_api_service_1.saveInvc)(envelope, payload);
            logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: saveInvc returned success=${result.success} error=${result.error ?? 'none'} rawStatus=${result.rawStatus} rawBody=${JSON.stringify(result.rawBody)?.slice(0, 500)}`);
            if (!result.success || !result.data?.rcptNo) {
                const msg = result.error ?? 'VSDC gateway error';
                // Idempotency: resultCd 924 ("Invoice number already exists.") means
                // this invcNo was already fiscalized by a prior attempt (or a manual
                // re-submission) — treat it as a success, not a failure.
                const raw = result.rawBody;
                const replayed = raw && String(raw.resultCd) === '924';
                const replayedVsdc = replayed ? (0, vsdc_api_service_1.parseVsdcResponse)(raw) : null;
                if (replayedVsdc?.rcptNo) {
                    result = { ...result, success: true, data: replayedVsdc };
                    logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: already fiscalized (924) — treating as SUCCEEDED rcptNo=${replayedVsdc.rcptNo}`);
                }
                else {
                    logger_1.default.warn(`[EBM-OUTBOX] row ${row.id}: submission FAILED — ${msg}`);
                    // 882/883 = the purchase code itself is bad (invalid checksum, or
                    // already burned in the sandbox ledger by a prior probe). Burning it
                    // in the pool prevents every future allocation from re-drawing the
                    // same poisoned code. Also clear it from the sale so the next retry
                    // allocates a fresh valid one instead of re-sending the same code.
                    if (/VSDC error (882|883):/.test(msg)) {
                        const usedCode = sale.prcOrdCd?.trim();
                        if (usedCode) {
                            await prisma_1.prisma.organizationPurchaseCode.updateMany({
                                where: { organizationId: row.organizationId, code: usedCode, consumed: false },
                                data: { consumed: true, consumedSaleId: sale.id, consumedAt: new Date() },
                            });
                            await prisma_1.prisma.sale.update({
                                where: { id: sale.id },
                                data: { prcOrdCd: null },
                            });
                            logger_1.default.warn(`[EBM-OUTBOX] row ${row.id}: burned purchase code ${usedCode} (${msg}) — cleared from sale for re-allocation`);
                        }
                    }
                    // 899 = SQLite persistence failure (disk pressure) — transient infrastructure issue
                    if (msg.includes('SQLite') || msg.includes('persistence') || msg.includes('disk pressure')) {
                        logger_1.default.warn(`[EBM-OUTBOX] row ${row.id}: submission FAILED — transient infrastructure error, retrying...`);
                        // Re-raise the error to trigger retry mechanism
                        throw new Error(`Transient VSDC error: ${msg}`);
                    }
                    await failSubmission(txRow.id, msg);
                    const nextRetry = scheduleNextRetry(row.retryCount);
                    const isDead = row.retryCount + 1 >= (config_1.config.ebm.maxQueueRetries ?? 10);
                    await prisma_1.prisma.ebmOutbox.update({
                        where: { id: row.id },
                        data: {
                            status: isDead ? 'DEAD_LETTER' : 'FAILED',
                            retryCount: { increment: 1 },
                            lastError: msg,
                            nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
                        },
                    });
                    failed += 1;
                    continue;
                }
            }
            const vsdc = result.data;
            const sdcDateTime = vsdc.sdcDateTime ? new Date(vsdc.sdcDateTime) : null;
            // C8: build electronic journal text
            const rcptLabel = sale.rcptLabel ?? (row.operation === 'REFUND' ? 'NR' : 'NS');
            const ejText = row.operation === 'SALE'
                ? (0, electronic_journal_service_1.buildElectronicJournal)(sale, rcptLabel, {
                    sdcId: envelope.sdcId,
                    mrcNo: envelope.mrcNo,
                    sdcRcptNo: vsdc.rcptNo ? parseInt(vsdc.rcptNo, 10) || 0 : 0,
                    internalData: vsdc.intrlData,
                    receiptSignature: vsdc.vsdcSignature,
                    sdcDateTime: sdcDateTime ?? new Date(),
                })
                : null;
            // C5: write SDC dedicated columns alongside the JSON blob
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.ebmTransaction.update({
                    where: { id: txRow.id },
                    data: {
                        submissionStatus: 'SUCCESS',
                        ebmInvoiceNumber: vsdc.rcptNo,
                        submittedAt: new Date(),
                        sdcDateTime: sdcDateTime,
                        // B1 dedicated columns — sdcRcptNo/totalRcptNo are the "A"/"B" halves
                        // of the required A/B RT receipt counter (§7.24.4/7.25); VSDC does not
                        // return a QR payload — the CIS builds the QR string itself (qrCode.ts).
                        sdcRcptNo: vsdc.rcptNo ? parseInt(vsdc.rcptNo, 10) || null : null,
                        totalRcptNo: vsdc.totRcptNo ? parseInt(vsdc.totRcptNo, 10) || null : null,
                        sdcId: vsdc.sdcId || null,
                        internalData: vsdc.intrlData || null,
                        receiptSignature: vsdc.vsdcSignature || null,
                        rcptLabel: rcptLabel,
                        // C8 electronic journal
                        journalText: ejText,
                        ejSent: !!ejText,
                        responseData: { raw: result.rawBody, normalized: vsdc, requestPayload: payload },
                    },
                }),
                prisma_1.prisma.ebmOutbox.update({
                    where: { id: row.id },
                    data: {
                        status: 'SUCCEEDED',
                        sdcDateTime: sdcDateTime,
                        lastError: null,
                    },
                }),
                prisma_1.prisma.organization.update({
                    where: { id: row.organizationId },
                    data: {
                        lastSyncCursor: new Date(),
                        lastSuccessfulVdsContact: new Date(),
                    },
                }),
            ]);
            succeeded += 1;
            logger_1.default.info(`[EBM-OUTBOX] row ${row.id}: SUCCEEDED — rcptNo=${vsdc.rcptNo}, sdcId=${vsdc.sdcId ?? 'N/A'}, sdcDateTime=${sdcDateTime?.toISOString() ?? 'N/A'}`);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : 'EBM request failed';
            logger_1.default.error(`[EBM-OUTBOX] row ${row.id}: EXCEPTION during submission — ${message}`);
            await failSubmission(txRow.id, message);
            const nextRetry = scheduleNextRetry(row.retryCount);
            const isDead = row.retryCount + 1 >= (config_1.config.ebm.maxQueueRetries ?? 10);
            await prisma_1.prisma.ebmOutbox.update({
                where: { id: row.id },
                data: {
                    status: isDead ? 'DEAD_LETTER' : 'FAILED',
                    retryCount: { increment: 1 },
                    lastError: message,
                    nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
                },
            });
            failed += 1;
        }
    }
    logger_1.default.info(`[EBM-OUTBOX] processEbmOutboxBatch done: processed=${processed} succeeded=${succeeded} failed=${failed}`);
    return { processed, succeeded, failed };
}
// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────
async function failSubmission(ebmTransactionId, message) {
    await prisma_1.prisma.ebmTransaction.update({
        where: { id: ebmTransactionId },
        data: {
            submissionStatus: 'FAILED',
            errorMessage: message,
            retryCount: { increment: 1 },
        },
    });
}
function scheduleNextRetry(currentRetryCount) {
    const delayMs = Math.min(60 * 60 * 1000, 2 * 60 * 1000 * Math.pow(2, currentRetryCount));
    return new Date(Date.now() + delayMs);
}
/**
 * Classify a payload-build failure. A missing purchase code is TRANSIENT (the
 * operator tops the pool up and the retry succeeds), so the row backs off
 * with retries; anything else structural (bad tax code, bad TIN, unknown
 * product) can never heal and dead-letters immediately with the reason.
 */
async function handleBuildError(row, e) {
    const message = e instanceof Error ? e.message : 'Invalid sale payload';
    if (e instanceof rra_ebm_service_1.PurchaseCodeMissingError) {
        const nextRetry = scheduleNextRetry(row.retryCount);
        const isDead = row.retryCount + 1 >= (config_1.config.ebm.maxQueueRetries ?? 10);
        await prisma_1.prisma.ebmOutbox.update({
            where: { id: row.id },
            data: {
                status: isDead ? 'DEAD_LETTER' : 'FAILED',
                retryCount: { increment: 1 },
                lastError: message,
                nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
            },
        });
        return;
    }
    await prisma_1.prisma.ebmOutbox.update({
        where: { id: row.id },
        data: { status: 'DEAD_LETTER', lastError: message },
    });
}
/**
 * Sentinel `nextAttemptAt` for a DEAD_LETTER row. `nextAttemptAt` is a
 * non-nullable `DateTime`, so instead of `null` we store a far-future timestamp
 * meaning "never retry" — the worker only selects PENDING/PROCESSING/FAILED
 * rows whose `nextAttemptAt` is in the past, so DEAD_LETTER entries stay put.
 */
function deadLetterAttemptAt() {
    return new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
}
/**
 * Manually re-queue a FAILED or DEAD_LETTER outbox row so the worker will
 * attempt fiscalization again (e.g. after fixing a missing itemClsCd).
 * Resets status to PENDING with nextAttemptAt=now and optionally kicks the
 * batch processor immediately.
 */
async function retryEbmOutboxEntry(organizationId, outboxId, opts) {
    const entry = await prisma_1.prisma.ebmOutbox.findFirst({
        where: { id: outboxId, organizationId },
        select: { id: true, status: true, saleId: true, operation: true },
    });
    if (!entry) {
        return { success: false, error: 'Outbox entry not found' };
    }
    if (entry.status === 'SUCCEEDED') {
        return { success: false, error: 'Already fiscalized — nothing to retry' };
    }
    if (entry.status === 'PROCESSING') {
        return { success: false, error: 'Entry is currently processing — wait and try again' };
    }
    if (entry.status !== 'FAILED' && entry.status !== 'DEAD_LETTER' && entry.status !== 'PENDING') {
        return { success: false, error: `Cannot retry status ${entry.status}` };
    }
    const updated = await prisma_1.prisma.ebmOutbox.update({
        where: { id: outboxId },
        data: {
            status: 'PENDING',
            retryCount: 0,
            nextAttemptAt: new Date(),
            lastError: entry.status === 'DEAD_LETTER'
                ? `Re-queued from DEAD_LETTER for retry`
                : null,
        },
        select: { id: true, status: true, saleId: true },
    });
    if (opts?.processNow !== false) {
        processEbmOutboxBatch(5).catch((e) => console.error(`[EBM-OUTBOX] immediate retry after re-queue #${outboxId} failed:`, e));
    }
    return { success: true, entry: updated };
}

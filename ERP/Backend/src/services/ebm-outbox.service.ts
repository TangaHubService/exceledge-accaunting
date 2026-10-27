import { prisma } from '../lib/prisma';
import { config } from '../config';
import {
  type SaleWithRelations,
  buildRraSendReceiptPayload,
  generateInvoiceNumber,
  consumeAnyOrgPurchaseCode,
  effectiveBuyerTin,
  isEbmEnabled,
  gatewayErrorMessage,
  PurchaseCodeMissingError,
  clampField,
  withBranchSellerAddress,
} from './rra-ebm.service';
import { getRraPaymentCode, validateRefundReasonCodeForOrg, DEFAULT_RFD_RSN_CD, getTaxRatesBySlot } from './rra-code.service';
import {
  buildVsdcEnvelope,
  saveInvc,
  saveElectronicJournal,
  decideVsdcReceiptResult,
  validateVsdcEnvelope,
} from './vsdc-api.service';
import { buildElectronicJournal } from './electronic-journal.service';
import { assertNrWirePayload } from './refund-calculation.service';
import { isTrainingLabel, isUnsignedLabel } from './training-mode.service';
import logger from '../utils/logger';

export { isEbmEnabled };
import { TaxService } from './tax.service';
import { getCurrentStockInTransaction, removeStock } from './inventory-ledger.service';
import type { Decimal } from '@prisma/client/runtime/library';
import type {
  EbmOperation,
  SalePaymentType,
  RraTaxCode,
  MeasurementUnit,
} from '@prisma/client';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface SaleOutboxInput {
  organizationId: number;
  branchId: number;
  userId: number;
  customerId: number;
  items: Array<{
    productId: number;
    quantity: number;
    unitPrice: number;
    measurementUnit: MeasurementUnit;
    exemptionReference?: string | null;
  }>;
  paymentType: SalePaymentType;
  cashAmount: number;
  insuranceAmount: number;
  debtAmount: number;
  shiftId?: number;
}

type OutboxPayloadV1 = {
  version: 1;
  saleId: number;
  organizationId: number;
  operation: EbmOperation;
};

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function generateIdempotencyKey(orgId: number, operation: EbmOperation, saleId: number): string {
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
export async function createSaleWithOutbox(input: SaleOutboxInput) {
  const {
    organizationId, branchId, userId, customerId,
    items, paymentType, cashAmount, insuranceAmount, debtAmount, shiftId,
  } = input;

  const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const saleNumber = `SALE-${Date.now()}`;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { vatRegistered: true, isTaxExempt: true, trainingMode: true },
  });
  const vatRegistered = org?.vatRegistered ?? false;
  const isTaxExempt = org?.isTaxExempt ?? false;

  const operation: EbmOperation = 'SALE';

  const sale = await prisma.$transaction(async (tx) => {
    // 1. Validate stock with row-level locking
    for (const item of items) {
      const [locked] = await tx.$queryRaw<Array<{ id: number; name: string }>>`
        SELECT id, name FROM products
        WHERE id = ${item.productId} AND "organizationId" = ${organizationId}
        FOR UPDATE
      `;
      if (!locked) {
        throw new Error(`Product ID ${item.productId} not found`);
      }

      const stock = await getCurrentStockInTransaction(tx, organizationId, item.productId, branchId);
      if (stock < item.quantity && !org?.trainingMode) {
        const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
        throw new Error(`Insufficient stock for ${prod?.name ?? `#${item.productId}`}. Available: ${stock}, requested: ${item.quantity}`);
      }
    }

    // 2. Calculate tax (forced to A for tax-exempt entities, else D for non-VAT-registered taxpayers)
    const taxSummary = await TaxService.calculateSaleTax(
      organizationId,
      items.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
      vatRegistered,
      isTaxExempt,
    );

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
    const { invoiceNumber, vsdcInvcNo } = await generateInvoiceNumber(organizationId, branchId, tx);

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
        saleItems: { create: saleItemsData as any },
      },
      include: {
        saleItems: { include: { product: true } },
        customer: true,
      },
    });

    // 4. Deduct inventory (ledger entries)
    for (const item of items) {
      await removeStock({
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
    const outboxPayload: OutboxPayloadV1 = {
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
        payload: outboxPayload as any,
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });

    return newSale;
  }, {
    maxWait: 30_000,
    timeout: 60_000,
  });

  return sale;
}

// ──────────────────────────────────────────────
// payDebt — now inside a transaction
// ──────────────────────────────────────────────

export async function payDebtWithTransaction(
  saleId: number,
  organizationId: number,
  amount: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, organizationId },
      select: { id: true, debtAmount: true, customerId: true, status: true },
    });

    if (!sale) throw new Error('Sale not found');
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
 * Process pending EBM outbox entries in batch.
 *
 * 1. Orphan recovery: a stale PROCESSING entry is resent as the SAME document
 *    (same invcNo). The VSDC API has no receipt lookup, so a heartbeat can
 *    never prove an earlier attempt was signed; VSDC itself answers 924 if it
 *    was, and only a complete receipt block is ever accepted as success.
 * 2. Idempotent dispatch: every VSDC payload carries the idempotencyKey.
 * 3. Cursor persistence: on success, saves sdcDateTime and updates organization sync state.
 */
export async function processEbmOutboxBatch(limit = 25): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (!isEbmEnabled()) {
    logger.info('[EBM-OUTBOX] processEbmOutboxBatch skipped: EBM disabled');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // A VSDC call can take up to the configured request timeout. Do not let the
  // cron job (or another checkout) reclaim a row that is still being sent by a
  // live worker. Only genuinely stale PROCESSING rows are reconciled.
  const staleProcessingBefore = new Date(
    Date.now() - Math.max(config.ebm.requestTimeoutMs * 2, 60_000),
  );
  const rows = await prisma.ebmOutbox.findMany({
    where: {
      nextAttemptAt: { lte: new Date() },
      retryCount: { lt: config.ebm.maxQueueRetries },
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

  if (rows.length > 0) {
    logger.info(`[EBM-OUTBOX] processEbmOutboxBatch: fetched ${rows.length} due row(s) (limit=${limit})`);
  }

  for (const row of rows) {
    // Claim the row before building its payload or calling VSDC. The previous
    // implementation selected then updated it, allowing simultaneous requests
    // from the immediate checkout worker and the cron worker to both submit the
    // same fiscal receipt. `updatedAt` makes this conditional update a lease for
    // stale PROCESSING rows as well.
    const claim = await prisma.ebmOutbox.updateMany({
      where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data: { status: 'PROCESSING' },
    });
    if (claim.count !== 1) {
      logger.warn(`[EBM-OUTBOX] row ${row.id} (op=${row.operation}) not claimed (concurrent worker) — skipping`);
      continue;
    }

    processed += 1;
    logger.info(`[EBM-OUTBOX] row ${row.id} (op=${row.operation}, saleId=${row.saleId}, org=${row.organizationId}) claimed — processing (status=${row.status}, retry=${row.retryCount})`);

    if (row.status === 'PROCESSING') {
      logger.warn(`[EBM-OUTBOX] row ${row.id}: stale PROCESSING lease — resending the same document`);
    }

    // ── Reload sale & build payload ──
    const sale = (await prisma.sale.findFirst({
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
    })) as (SaleWithRelations & { originalSaleId?: number | null }) | null;

    if (!sale) {
      await prisma.ebmOutbox.update({
        where: { id: row.id },
        data: { status: 'DEAD_LETTER', lastError: 'Sale not found' },
      });
      logger.error(`[EBM-OUTBOX] row ${row.id}: sale ${row.saleId} not found — DEAD_LETTER`);
      failed += 1;
      continue;
    }

    logger.info(`[EBM-OUTBOX] row ${row.id}: sale ${sale.id} loaded (invoice=${sale.invoiceNumber}, vsdcInvcNo=${sale.vsdcInvcNo ?? 'N/A'}, custTin=${sale.customer?.TIN ?? 'N/A'}, cust prcOrdCd=${sale.customer?.prcOrdCd ?? 'N/A'}, sale prcOrdCd=${sale.prcOrdCd ?? 'N/A'})`);

    // For SALE operations only: skip if the sale was voided/refunded before we submitted it.
    // For REFUND/VOID operations the sale status is *expected* to be REFUNDED/CANCELLED.
    if (row.operation === 'SALE' && (sale.status === 'REFUNDED' || sale.status === 'CANCELLED')) {
      await prisma.ebmOutbox.update({
        where: { id: row.id },
        data: { status: 'DEAD_LETTER', lastError: `Sale ${sale.status.toLowerCase()} before VSDC processing` },
      });
      failed += 1;
      continue;
    }

    const orgRow = await prisma.organization.findUnique({
      where: { id: row.organizationId },
      select: { TIN: true, name: true, address: true, phone: true },
    });
    const org = orgRow ? await withBranchSellerAddress(orgRow, sale.branchId) : null;

    if (!org) {
      await prisma.ebmOutbox.update({
        where: { id: row.id },
        data: { status: 'DEAD_LETTER', lastError: 'Organization not found' },
      });
      failed += 1;
      continue;
    }

    const taxRates = await getTaxRatesBySlot(row.organizationId);
    const rateOpts = { taxRates };

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
      logger.info(`[EBM-OUTBOX] row ${row.id}: SALE code check — needsCode=${needsCode}`);
      if (needsCode) {
        const allocated = await consumeAnyOrgPurchaseCode(
          row.organizationId,
          sale.id,
          prisma,
          effectiveBuyerTin(sale) || undefined,
        )
          ?? (sale.customer?.prcOrdCd ?? null);
        logger.info(`[EBM-OUTBOX] row ${row.id}: allocated purchase code = ${allocated ?? 'NONE (pool empty, no customer fallback)'}`);
        if (allocated) {
          await prisma.sale.update({
            where: { id: sale.id },
            data: { prcOrdCd: allocated },
          });
          (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd = allocated;
        }
      }
    }

    // Build gateway payload based on operation type
    let payload: Record<string, unknown>;
    if (row.operation === 'SALE') {
      let rraPaymentCode: string;
      try {
        rraPaymentCode = await getRraPaymentCode(row.organizationId, sale.paymentType);
      } catch (e: unknown) {
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: { status: 'DEAD_LETTER', lastError: e instanceof Error ? e.message : 'Invalid payment method mapping' },
        });
        failed += 1;
        continue;
      }
      try {
        payload = buildRraSendReceiptPayload(sale, org, rraPaymentCode, rateOpts);
      } catch (e: unknown) {
        // A structurally bad sale dead-letters alone without blocking the
        // batch; a missing purchase code backs off for retry (transient).
        await handleBuildError(row, e);
        failed += 1;
        continue;
      }
      payload['idempotencyKey'] = row.idempotencyKey;
    } else if (row.operation === 'REFUND') {
      // For REFUND: find the original SALE's EBM invoice number
      const outboxPayload = row.payload as { originalSaleId?: number };
      const originalSaleId = outboxPayload?.originalSaleId ?? sale.originalSaleId;
      const origTx = originalSaleId
        ? await prisma.ebmTransaction.findFirst({
            where: { saleId: originalSaleId, operation: 'SALE', submissionStatus: 'SUCCESS', ebmInvoiceNumber: { not: null } },
            orderBy: { createdAt: 'desc' },
          })
        : null;
      if (!origTx?.ebmInvoiceNumber) {
        // Original invoice not fiscalized yet — defer this refund to retry later
        const nextRetry = scheduleNextRetry(row.retryCount);
        const isDead = row.retryCount + 1 >= (config.ebm.maxQueueRetries ?? 10);
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: {
            status: isDead ? 'DEAD_LETTER' : 'FAILED',
            retryCount: { increment: 1 },
            lastError: 'Original invoice not yet fiscalized — deferring refund',
            nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
          },
        });
        if (isDead) failed += 1;
        continue;
      }
      const originalSale = originalSaleId
        ? await prisma.sale.findFirst({ where: { id: originalSaleId }, select: { invoiceNumber: true, vsdcInvcNo: true, totalAmount: true } })
        : null;
      // orgInvcNo is the original NS invcNo. 0 is what VSDC rejects with 910,
      // and it is not a stand-in for "unknown" — refuse the submission.
      const orgInvcNo = originalSale?.vsdcInvcNo;
      if (typeof orgInvcNo !== 'number' || !Number.isInteger(orgInvcNo) || orgInvcNo <= 0) {
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: {
            status: 'DEAD_LETTER',
            lastError: 'Original NS has no VSDC invoice number (orgInvcNo) — NR was not submitted',
          },
        });
        failed += 1;
        continue;
      }
      const justification = String(
        (row.payload as { reason?: string })?.reason ?? (sale as { refundReason?: string | null }).refundReason ?? '',
      ).trim();
      if (!justification) {
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: {
            status: 'DEAD_LETTER',
            lastError: 'Refund justification is missing — NR was not submitted',
          },
        });
        failed += 1;
        continue;
      }
      let rraPaymentCode: string;
      try {
        rraPaymentCode = await getRraPaymentCode(row.organizationId, sale.paymentType);
      } catch (e: unknown) {
        await prisma.ebmOutbox.update({
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
        const rawRsn = (row.payload as { rfdRsnCd?: string })?.rfdRsnCd
          ?? (sale as unknown as { rfdRsnCd?: string | null }).rfdRsnCd
          ?? DEFAULT_RFD_RSN_CD;
        let rfdRsnCd: string;
        try {
          rfdRsnCd = await validateRefundReasonCodeForOrg(row.organizationId, rawRsn);
        } catch (e: unknown) {
          await prisma.ebmOutbox.update({
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
        // A retry reuses the code already allocated to this refund (the VSDC may
        // have accepted the earlier attempt); a burned code is replaced by the
        // 882/883 handler below.
        const allocatedCode = (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd?.trim();
        if (!allocatedCode) {
          const refundCustTin = effectiveBuyerTin(sale);
          const refundCode = await consumeAnyOrgPurchaseCode(
            row.organizationId,
            sale.id,
            prisma,
            refundCustTin || undefined,
          );
          if (refundCode) {
            await prisma.sale.update({ where: { id: sale.id }, data: { prcOrdCd: refundCode } });
            (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd = refundCode;
          }
        }
        payload = buildRraSendReceiptPayload(sale, org, rraPaymentCode, {
          orgInvcNo,
          // The refund happened when the NR row was created; retries must
          // resend the same rfdDt, not the time of the attempt.
          rfdDt: sale.createdAt,
          rfdRsnCd,
          ...rateOpts,
        });
        // VSDC remark is the human justification (max 400). The code travels
        // separately as rfdRsnCd. Stored sale amounts stay negative; the wire
        // magnitudes are positive (sandbox 910 on a negative supply amount).
        payload.remark = clampField(justification, 400);
        payload.idempotencyKey = row.idempotencyKey;
        assertNrWirePayload(payload, { training: isTrainingLabel(sale.rcptLabel) });
      } catch (e: unknown) {
        await handleBuildError(row, e);
        failed += 1;
        continue;
      }
    } else {
      // VOID: only fire if original was fiscalized
      const origTx = await prisma.ebmTransaction.findFirst({
        where: { saleId: row.saleId, operation: 'SALE', submissionStatus: 'SUCCESS', ebmInvoiceNumber: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (!origTx?.ebmInvoiceNumber) {
        // Sale was never fiscalized — nothing to void at RRA
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: { status: 'SUCCEEDED', lastError: 'Original invoice never fiscalized — void skipped' },
        });
        succeeded += 1;
        continue;
      }
      // orgInvcNo on the cancellation is the original NS invcNo. Sending 0 would
      // detach the cancellation from the document it cancels, so refuse.
      const voidOrgInvcNo = sale.vsdcInvcNo;
      if (typeof voidOrgInvcNo !== 'number' || !Number.isInteger(voidOrgInvcNo) || voidOrgInvcNo <= 0) {
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: {
            status: 'DEAD_LETTER',
            lastError: 'Original NS has no VSDC invoice number (orgInvcNo) — cancellation was not submitted',
          },
        });
        failed += 1;
        continue;
      }
      let rraPaymentCode: string;
      try {
        rraPaymentCode = await getRraPaymentCode(row.organizationId, sale.paymentType);
      } catch (e: unknown) {
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: { status: 'DEAD_LETTER', lastError: e instanceof Error ? e.message : 'Invalid payment method mapping' },
        });
        failed += 1;
        continue;
      }
      try {
        // A cancellation is a NEW sales-transaction document (fresh invcNo)
        // with cnclDt/cnclReqDt set, salesSttsCd='04' and orgInvcNo = the
        // original NS invcNo. The sandbox rejects a resubmitted invcNo (924).
        // A 2026-08-10 sandbox run answered 910 to orgInvcNo on a void; if that
        // recurs the row dead-letters with the VSDC message rather than
        // silently sending 0.
        //
        // A void is a fresh submission, so it needs a fresh unconsumed
        // purchase code too: reusing the original sale's (already consumed)
        // code is rejected with 883. Allocate a new valid one for the buyer.
        //
        // A retry (timeout, stale lease) must resend the SAME cancellation
        // document: the invcNo allocated on the first attempt is kept on the
        // outbox payload, so VSDC can answer 924 instead of receiving a second
        // cancellation under a new number. Its purchase code stays on the sale
        // unless the 882/883 handler burned and cleared it.
        const voidState = (row.payload ?? {}) as { voidInvcNo?: number };
        const storedVoidInvcNo =
          Number.isInteger(voidState.voidInvcNo) && (voidState.voidInvcNo as number) > 0 ? (voidState.voidInvcNo as number) : null;
        const existingVoidCode = storedVoidInvcNo ? (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd?.trim() : '';
        if (!existingVoidCode) {
          const voidCustTin = effectiveBuyerTin(sale);
          const voidCode = await consumeAnyOrgPurchaseCode(
            row.organizationId,
            sale.id,
            prisma,
            voidCustTin || undefined,
          );
          if (voidCode) {
            await prisma.sale.update({ where: { id: sale.id }, data: { prcOrdCd: voidCode } });
            (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd = voidCode;
          }
        }
        let voidInvcNo = storedVoidInvcNo;
        if (voidInvcNo == null) {
          voidInvcNo = (await generateInvoiceNumber(row.organizationId, sale.branchId)).vsdcInvcNo;
          await prisma.ebmOutbox.update({
            where: { id: row.id },
            data: { payload: { ...(row.payload as Record<string, unknown>), voidInvcNo } as any },
          });
        }
        payload = buildRraSendReceiptPayload(sale, org, rraPaymentCode, {
          cnclDt: new Date(),
          invcNoOverride: voidInvcNo,
          orgInvcNo: voidOrgInvcNo,
          ...rateOpts,
        });
        payload.remark = (row.payload as { reason?: string })?.reason ?? '';
        payload.idempotencyKey = row.idempotencyKey;
      } catch (e: unknown) {
        await handleBuildError(row, e);
        failed += 1;
        continue;
      }
    }

    // ── Record attempt in EbmTransaction (audit trail) ──
    // Retries re-use the transaction row created on the first attempt
    // (idempotencyKey is unique), resetting it to SUBMITTED instead of failing
    // the duplicate insert.
    const txRow = await prisma.ebmTransaction.upsert({
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
      // Every receipt type goes through VSDC (CIS §6). Training (TS/TR)
      // travels as salesTyCd 'T' and proforma (PS) as 'P' (see
      // buildRraSendReceiptPayload), so VSDC records them under their own
      // counters without a signature.
      const envelope = await buildVsdcEnvelope(row.organizationId, sale.branchId);

      // §22: never submit against a device that is not usable (missing/invalid
      // TIN or no MRC serial). Retryable — the operator can fix the config and
      // the next cron cycle picks the row back up.
      const envelopeError = validateVsdcEnvelope(envelope);
      if (envelopeError) {
        await failSubmission(txRow.id, envelopeError);
        const nextRetry = scheduleNextRetry(row.retryCount);
        const isDead = row.retryCount + 1 >= (config.ebm.maxQueueRetries ?? 10);
        await prisma.ebmOutbox.update({
          where: { id: row.id },
          data: {
            status: isDead ? 'DEAD_LETTER' : 'FAILED',
            retryCount: { increment: 1 },
            lastError: envelopeError,
            nextAttemptAt: isDead ? deadLetterAttemptAt() : nextRetry,
          },
        });
        logger.warn(`[EBM-OUTBOX] row ${row.id}: device not configured — ${envelopeError}`);
        failed += 1;
        continue;
      }

      logger.info(`[EBM-OUTBOX] row ${row.id}: calling saveInvc (${config.ebm.apiUrl ?? ''}/trnsSales/saveSales) — prcOrdCd=${payload.prcOrdCd ?? 'N/A'}, custTin=${(payload.receipt as any)?.custTin ?? 'N/A'}, invcNo=${(payload as any).invcNo ?? 'N/A'}`);
      // Sandbox purchase codes survive DB resets in VSDC's ledger. On 882/883,
      // burn the poisoned code and immediately try a fresh one (same cycle)
      // instead of waiting for the next cron tick.
      const MAX_PRC_RETRIES = 8;
      let result = await saveInvc(envelope, payload);
      logger.info(`[EBM-OUTBOX] row ${row.id}: saveInvc returned success=${result.success} error=${result.error ?? 'none'} rawStatus=${result.rawStatus} rawBody=${JSON.stringify(result.rawBody)?.slice(0, 500)}`);

      for (let prcAttempt = 0; prcAttempt < MAX_PRC_RETRIES; prcAttempt++) {
        if (result.success && result.data?.rcptNo) break;
        const rawProbe = result.rawBody as Record<string, unknown> | null;
        if (rawProbe && String(rawProbe.resultCd) === '924') break;
        const failMsg = result.error ?? 'VSDC gateway error';
        if (!/VSDC error (882|883):/.test(failMsg)) break;

        const usedCode = String(payload.prcOrdCd ?? (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd ?? '').trim();
        if (usedCode) {
          await prisma.organizationPurchaseCode.updateMany({
            where: { organizationId: row.organizationId, code: usedCode },
            data: { consumed: true, consumedSaleId: sale.id, consumedAt: new Date() },
          });
        }
        await prisma.sale.update({ where: { id: sale.id }, data: { prcOrdCd: null } });
        (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd = null;

        const freshCode = await consumeAnyOrgPurchaseCode(
          row.organizationId,
          sale.id,
          prisma,
          effectiveBuyerTin(sale) || undefined,
        );
        if (!freshCode) {
          logger.warn(`[EBM-OUTBOX] row ${row.id}: ${failMsg} — no fresh purchase code left to retry`);
          break;
        }
        await prisma.sale.update({ where: { id: sale.id }, data: { prcOrdCd: freshCode } });
        (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd = freshCode;
        payload = { ...payload, prcOrdCd: freshCode };
        if (payload.receipt && typeof payload.receipt === 'object') {
          // receipt block does not carry prcOrdCd; keep top-level in sync only
        }
        logger.warn(`[EBM-OUTBOX] row ${row.id}: burned ${usedCode || '?'} (${failMsg}) — retrying with ${freshCode}`);
        result = await saveInvc(envelope, payload);
        logger.info(`[EBM-OUTBOX] row ${row.id}: saveInvc retry returned success=${result.success} error=${result.error ?? 'none'}`);
      }

      // Every document type is confirmed only by a complete VSDC receipt block
      // (rcptNo, totRcptNo, intrlData, rcptSign, sdcId, mrcNo, vsdcRcptPbctDate).
      // A bare rcptNo, a 924 without the original block, a non-2xx reply or a
      // timeout is not a receipt. Training (TS/TR) and proforma (PS) get the
      // same check minus the signature fields VSDC leaves empty for them.
      const isTraining = isUnsignedLabel(sale.rcptLabel);
      const decision = decideVsdcReceiptResult(result, {
        training: isTraining,
        docLabel: row.operation === 'REFUND' ? 'NR receipt' : row.operation === 'VOID' ? 'cancellation' : `${sale.rcptLabel ?? 'NS'} receipt`,
      });
      const forceDeadLetter = !decision.confirmed && !decision.retryable;
      result = decision.confirmed
        ? { ...result, success: true, data: decision.data, error: undefined }
        : { ...result, success: false, data: undefined, error: decision.error };

      if (!decision.confirmed) {
        const msg = result.error ?? 'VSDC gateway error';
        logger.warn(`[EBM-OUTBOX] row ${row.id}: submission FAILED — ${msg}`);

        // Final 882/883 burn if retries exhausted without clearing the sale code.
        if (/VSDC error (882|883):/.test(msg)) {
          const usedCode = (sale as SaleWithRelations & { prcOrdCd?: string | null }).prcOrdCd?.trim();
          if (usedCode) {
            await prisma.organizationPurchaseCode.updateMany({
              where: { organizationId: row.organizationId, code: usedCode },
              data: { consumed: true, consumedSaleId: sale.id, consumedAt: new Date() },
            });
            await prisma.sale.update({
              where: { id: sale.id },
              data: { prcOrdCd: null },
            });
            logger.warn(`[EBM-OUTBOX] row ${row.id}: burned purchase code ${usedCode} (${msg}) — cleared from sale for re-allocation`);
          }
        }

        // 899 = SQLite persistence failure (disk pressure) — transient infrastructure issue
        if (msg.includes('SQLite') || msg.includes('persistence') || msg.includes('disk pressure')) {
          logger.warn(`[EBM-OUTBOX] row ${row.id}: submission FAILED — transient infrastructure error, retrying...`);
          // Re-raise the error to trigger retry mechanism
          throw new Error(`Transient VSDC error: ${msg}`);
        }

        await failSubmission(txRow.id, msg);

        const nextRetry = scheduleNextRetry(row.retryCount);
        const isDead = forceDeadLetter || row.retryCount + 1 >= (config.ebm.maxQueueRetries ?? 10);

        await prisma.ebmOutbox.update({
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

      const vsdc = decision.data;
      const sdcDateTime = new Date(vsdc.sdcDateTime);

      // C8: build electronic journal text
      const rcptLabel = (sale as any).rcptLabel ?? (row.operation === 'REFUND' ? 'NR' : 'NS');
      const ejText = row.operation === 'SALE' || row.operation === 'REFUND'
        ? buildElectronicJournal(sale as SaleWithRelations, rcptLabel, {
            sdcId: vsdc.sdcId || envelope.sdcId,
            mrcNo: envelope.mrcNo || vsdc.mrcNo,
            sdcRcptNo: vsdc.rcptNo ? parseInt(vsdc.rcptNo, 10) || 0 : 0,
            internalData: vsdc.intrlData,
            receiptSignature: vsdc.vsdcSignature,
            sdcDateTime,
            orgInvcNo: typeof payload.orgInvcNo === 'number' ? payload.orgInvcNo : null,
            rfdRsnCd: typeof payload.rfdRsnCd === 'string' ? payload.rfdRsnCd : null,
            refundReason: typeof payload.remark === 'string' ? payload.remark : null,
          })
        : null;

      // C5: write SDC dedicated columns alongside the JSON blob
      await prisma.$transaction([
        prisma.ebmTransaction.update({
          where: { id: txRow.id },
          data: {
            submissionStatus: 'SUCCESS',
            ebmInvoiceNumber: vsdc.rcptNo,
            submittedAt: new Date(),
            sdcDateTime: sdcDateTime as any,
            // B1 dedicated columns — sdcRcptNo/totalRcptNo are the "A"/"B" halves
            // of the required A/B RT receipt counter (§7.24.4/7.25); VSDC does not
            // return a QR payload — the CIS builds the QR string itself (qrCode.ts).
            sdcRcptNo: vsdc.rcptNo ? parseInt(vsdc.rcptNo, 10) || null : null,
            totalRcptNo: vsdc.totRcptNo ? parseInt(vsdc.totRcptNo, 10) || null : null,
            sdcId: vsdc.sdcId || null,
            internalData: vsdc.intrlData || null,
            receiptSignature: vsdc.vsdcSignature || null,
            rcptLabel: rcptLabel as any,
            // C8 electronic journal: the text is always stored for inspector
            // comparison. ejSent means TRANSMITTED to the VSDC (2018 Art. 6.5),
            // not merely stored — it flips to true only when the EJ POST below
            // is acknowledged. Without EBM_EJ_SYNC_PATH there is no 2023-API
            // endpoint to send it to, so it stays stored-but-unsent.
            journalText: ejText,
            ejSent: false,
            responseData: { raw: result.rawBody, normalized: vsdc, requestPayload: payload } as any,
          },
        }),
        prisma.ebmOutbox.update({
          where: { id: row.id },
          data: {
            status: 'SUCCEEDED',
            sdcDateTime: sdcDateTime as any,
            lastError: null,
          },
        }),
        prisma.organization.update({
          where: { id: row.organizationId },
          data: {
            lastSyncCursor: new Date(),
            lastSuccessfulVdsContact: new Date(),
          },
        }),
      ]);

      succeeded += 1;
      logger.info(`[EBM-OUTBOX] row ${row.id}: SUCCEEDED — rcptNo=${vsdc.rcptNo}, sdcId=${vsdc.sdcId ?? 'N/A'}, sdcDateTime=${sdcDateTime?.toISOString() ?? 'N/A'}`);
      // C8 follow-up: transmit the journal text when a device EJ endpoint is
      // configured. Best-effort — a failure here never un-fiscalizes the sale;
      // the text is retained and ejSent stays false so it can be resent.
      if (ejText && config.ebm.ejSyncPath) {
        try {
          const ejRes = await saveElectronicJournal(envelope, {
            saleId: sale.id,
            invcNo: (payload as any).invcNo ?? sale.vsdcInvcNo ?? 0,
            rcptLabel,
            journalText: ejText,
          });
          if (ejRes.success) {
            await prisma.ebmTransaction.update({
              where: { id: txRow.id },
              data: { ejSent: true },
            });
            logger.info(`[EBM-OUTBOX] row ${row.id}: EJ transmitted`);
          } else {
            logger.warn(`[EBM-OUTBOX] row ${row.id}: EJ POST failed — ${ejRes.error} (journal retained, ejSent=false)`);
          }
        } catch (e: unknown) {
          logger.warn(`[EBM-OUTBOX] row ${row.id}: EJ POST threw — ${e instanceof Error ? e.message : e} (journal retained, ejSent=false)`);
        }
      }
      // S8 order: the sales invoice is now acked — the linked SALE stock-out
      // rows (sarTyCd 11) become eligible for /stock/saveStockItems. The stock
      // worker gates on this ack, but kick it immediately instead of waiting
      // for the next cron tick.
      if (row.operation === 'SALE' || row.operation === 'REFUND') {
        setImmediate(() => {
          import('./stock-movement-sync.service')
            .then((m) => m.processStockSyncBatch(25))
            .catch(() => undefined);
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'EBM request failed';
      logger.error(`[EBM-OUTBOX] row ${row.id}: EXCEPTION during submission — ${message}`);
      await failSubmission(txRow.id, message);

      const nextRetry = scheduleNextRetry(row.retryCount);
      const isDead = row.retryCount + 1 >= (config.ebm.maxQueueRetries ?? 10);

      await prisma.ebmOutbox.update({
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

  if (processed > 0) {
    logger.info(`[EBM-OUTBOX] processEbmOutboxBatch done: processed=${processed} succeeded=${succeeded} failed=${failed}`);
  }
  return { processed, succeeded, failed };
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

async function failSubmission(ebmTransactionId: number, message: string): Promise<void> {
  await prisma.ebmTransaction.update({
    where: { id: ebmTransactionId },
    data: {
      submissionStatus: 'FAILED',
      errorMessage: message,
      retryCount: { increment: 1 },
    },
  });
}

function scheduleNextRetry(currentRetryCount: number): Date {
  const delayMs = Math.min(60 * 60 * 1000, 2 * 60 * 1000 * Math.pow(2, currentRetryCount));
  return new Date(Date.now() + delayMs);
}

/**
 * Classify a payload-build failure. A missing purchase code is TRANSIENT (the
 * operator tops the pool up and the retry succeeds), so the row backs off
 * with retries; anything else structural (bad tax code, bad TIN, unknown
 * product) can never heal and dead-letters immediately with the reason.
 */
async function handleBuildError(
  row: { id: number; retryCount: number },
  e: unknown,
): Promise<void> {
  const message = e instanceof Error ? e.message : 'Invalid sale payload';
  if (e instanceof PurchaseCodeMissingError) {
    const nextRetry = scheduleNextRetry(row.retryCount);
    const isDead = row.retryCount + 1 >= (config.ebm.maxQueueRetries ?? 10);
    await prisma.ebmOutbox.update({
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
  await prisma.ebmOutbox.update({
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
function deadLetterAttemptAt(): Date {
  return new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
}

/**
 * Manually re-queue a FAILED or DEAD_LETTER outbox row so the worker will
 * attempt fiscalization again (e.g. after fixing a missing itemClsCd).
 * Resets status to PENDING with nextAttemptAt=now and optionally kicks the
 * batch processor immediately.
 */
export async function retryEbmOutboxEntry(
  organizationId: number,
  outboxId: number,
  opts?: { processNow?: boolean },
): Promise<{ success: boolean; error?: string; entry?: { id: number; status: string; saleId: number } }> {
  const entry = await prisma.ebmOutbox.findFirst({
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

  const updated = await prisma.ebmOutbox.update({
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
    processEbmOutboxBatch(5).catch((e) =>
      console.error(`[EBM-OUTBOX] immediate retry after re-queue #${outboxId} failed:`, e),
    );
  }

  return { success: true, entry: updated };
}


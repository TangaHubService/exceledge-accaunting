import { roundMoney } from "@exceledge/accounting-domain";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { syncSupplierBillToSubledger, syncSupplierPaymentToSubledger } from "../ap/ap.service";
import { syncCustomerPaymentToSubledger, syncSaleRefundToSubledger, syncSaleToSubledger } from "../ar/ar.service";
import { withBudgetWarningsOnly } from "../books/budget.service";
import { syncExpenseFromEvent } from "../expense/expense.service";
import { syncAssetFromEvent } from "../fixed-assets/fa.service";
import { INVENTORY_EVENT_TYPES, inventoryConfig, processInventoryEvent } from "../inventory/inventory.service";
import { createAndPostJournal } from "../journals/journal.service";
import { notify } from "../notifications/notification.service";
import { emitWebhook } from "../platform/webhook.service";
import { resolvePostingLines } from "./posting-rules.service";

/** Subledger updates run in the posting transaction: if one fails, the journal is rolled back and the event retried. */
const SUBLEDGER_SYNC: Record<string, { label: string; run: (eventId: string) => Promise<unknown> }> = {
  SALE_COMPLETED: { label: "AR", run: syncSaleToSubledger },
  CUSTOMER_PAYMENT_RECEIVED: { label: "AR", run: syncCustomerPaymentToSubledger },
  SALE_REFUNDED: { label: "AR", run: syncSaleRefundToSubledger },
  SALES_RETURN_COMPLETED: { label: "AR", run: syncSaleRefundToSubledger },
  SUPPLIER_BILL_APPROVED: { label: "AP", run: syncSupplierBillToSubledger },
  SUPPLIER_PAYMENT_COMPLETED: { label: "AP", run: syncSupplierPaymentToSubledger },
  SUPPLIER_PAYMENT_MADE: { label: "AP", run: syncSupplierPaymentToSubledger },
};

/** Events handled without a posting rule journal. */
const DIRECT_EVENT_TYPES = new Set(["EXPENSE_APPROVED", "ASSET_ACQUIRED", "GOODS_RECEIVED"]);

/** Longer than the posting transaction timeout. */
const PROCESSING_CLAIM_MS = 5 * 60_000;

/**
 * Goods received on a purchase order. The stock movements already put the value on goods received not
 * invoiced, so no journal is posted; the receipt is kept for the supplier bill to clear.
 */
async function recordGoodsReceipt(event: { id: string; companyId: string; occurredAt: Date; sourceDocumentNumber: string | null; payload: unknown }) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const totals = (payload.amountTotals ?? {}) as Record<string, unknown>;
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const parties = (payload.parties ?? {}) as Record<string, unknown>;
  const value = Number(totals.net ?? totals.gross ?? 0);
  if (!(value > 0)) throw new Error("Goods received event has no value");
  const poReference = typeof metadata.poReference === "string" && metadata.poReference.trim() ? metadata.poReference.trim() : null;
  if (!poReference) throw new Error("Goods received event needs the purchase order number (metadata.poReference)");
  const externalSupplierId = parties.externalSupplierId === undefined || parties.externalSupplierId === null ? null : String(parties.externalSupplierId);
  const supplier = externalSupplierId
    ? await prisma.supplier.findFirst({ where: { companyId: event.companyId, externalErpSupplierId: externalSupplierId } })
    : null;
  await lockForTransaction(`goods-receipt:${event.companyId}:${poReference}`);
  const existing = await prisma.goodsReceipt.findUnique({ where: { integrationEventId: event.id } });
  if (existing) return { receipt: existing, journal: null };
  const receipt = await prisma.goodsReceipt.create({
    data: {
      companyId: event.companyId,
      supplierId: supplier?.id,
      integrationEventId: event.id,
      receiptDate: event.occurredAt,
      poReference,
      reference: event.sourceDocumentNumber,
      value,
    },
  });

  // Bills for this order that arrived before the goods went to purchases; move that much onto the receipt.
  const { accounts: defaults } = await inventoryConfig(event.companyId);
  if (!defaults.grniId || !defaults.purchasesId) return { receipt, journal: null };
  const candidates = await prisma.apBill.findMany({
    where: { companyId: event.companyId, poReference, status: "POSTED", sourceModule: "PURCHASES" },
    orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
  });
  // A bill that carried its own stock cost already cleared that stock; the rest of it is not goods.
  const billEvents = candidates.length
    ? await prisma.integrationEvent.findMany({
        where: { companyId: event.companyId, eventType: "SUPPLIER_BILL_APPROVED", sourceDocumentId: { in: candidates.map((b) => b.sourceDocumentId ?? "") } },
        select: { sourceDocumentId: true, payload: true },
      })
    : [];
  const carriedStockCost = new Set(
    billEvents
      .filter((e) => Number(((e.payload as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined)?.receivedAtCost) > 0)
      .map((e) => e.sourceDocumentId),
  );
  const bills = candidates.filter((b) => !carriedStockCost.has(b.sourceDocumentId ?? ""));
  let left = roundMoney(value);
  const matches: Array<{ billId: string; billNumber: string; amount: number }> = [];
  for (const bill of bills) {
    if (left <= 0) break;
    const take = roundMoney(Math.min(left, Number(bill.net) - Number(bill.grniCleared)));
    if (take <= 0) continue;
    matches.push({ billId: bill.id, billNumber: bill.billNumber, amount: take });
    left = roundMoney(left - take);
  }
  if (!matches.length) return { receipt, journal: null };
  const total = roundMoney(value - left);
  const journal = await createAndPostJournal(
    event.companyId,
    {
      journalDate: event.occurredAt,
      journalType: "AUTOMATIC",
      description: `Goods for ${poReference} received after billing: ${matches.map((m) => m.billNumber).join(", ")}`,
      referenceNumber: event.sourceDocumentNumber ?? poReference,
      currencyCode: "RWF",
      sourceModule: "PURCHASES",
      sourceDocumentType: "GoodsReceipt",
      sourceDocumentId: receipt.id,
      integrationEventId: event.id,
      status: "APPROVED",
      lines: [
        { accountId: defaults.grniId, description: "Goods received, already invoiced", debit: total, credit: 0 },
        { accountId: defaults.purchasesId, description: "Billed purchases now in stock", debit: 0, credit: total },
      ],
    },
    { erpUserId: 0, erpRole: "SYSTEM" },
  );
  for (const match of matches) {
    const bill = await prisma.apBill.update({ where: { id: match.billId }, data: { grniCleared: { increment: match.amount } } });
    if (Number(bill.grniCleared) - Number(bill.net) > 0.0001) throw new Error(`Bill ${bill.billNumber} was matched by another receipt at the same time; retry`);
  }
  await prisma.goodsReceipt.update({ where: { id: receipt.id }, data: { matchedValue: total } });
  return { receipt, journal };
}

export interface IngestEnvelope {
  eventId: string;
  idempotencyKey: string;
  externalOrganizationId: string;
  externalBranchId?: string | null;
  eventType: string;
  occurredAt: string;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber?: string;
  currencyCode: string;
  amountTotals: { gross: string; net: string; tax: string; discount?: string };
  parties?: { externalCustomerId?: string | number; externalSupplierId?: string | number };
  lines?: unknown[];
  paymentSplits?: unknown[];
  taxSummary?: unknown[];
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

async function resolveCompany(externalOrganizationId: string) {
  const company = await prisma.company.findUnique({
    where: { externalErpOrganizationId: String(externalOrganizationId) },
    include: { activation: true },
  });
  if (!company) {
    throw new Error(`No accounting company linked to ERP org ${externalOrganizationId}`);
  }
  return company;
}

export async function ingestEvent(envelope: IngestEnvelope) {
  const company = await resolveCompany(envelope.externalOrganizationId);

  const existing = await prisma.integrationEvent.findUnique({
    where: {
      companyId_idempotencyKey: {
        companyId: company.id,
        idempotencyKey: envelope.idempotencyKey,
      },
    },
    include: { journal: true },
  });
  if (existing) {
    return {
      duplicate: true,
      event: existing,
      journal: existing.journal,
    };
  }

  const event = await prisma.integrationEvent.create({
    data: {
      companyId: company.id,
      eventId: envelope.eventId,
      idempotencyKey: envelope.idempotencyKey,
      eventType: envelope.eventType,
      externalOrganizationId: String(envelope.externalOrganizationId),
      externalBranchId: envelope.externalBranchId ? String(envelope.externalBranchId) : null,
      sourceModule: envelope.sourceModule,
      sourceDocumentType: envelope.sourceDocumentType,
      sourceDocumentId: String(envelope.sourceDocumentId),
      sourceDocumentNumber: envelope.sourceDocumentNumber,
      occurredAt: new Date(envelope.occurredAt),
      currencyCode: envelope.currencyCode,
      payload: envelope as object,
      status: "RECEIVED",
    },
  });

  try {
    const processed = await processIntegrationEvent(event.id);
    return { duplicate: false, ...processed };
  } catch (e) {
    return {
      duplicate: false,
      event: await prisma.integrationEvent.findUniqueOrThrow({ where: { id: event.id } }),
      error: (e as Error).message,
    };
  }
}

export async function processIntegrationEvent(eventId: string) {
  return withBudgetWarningsOnly(() => processEvent(eventId));
}

async function processEvent(eventId: string) {
  const event = await prisma.integrationEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.status === "POSTED" && (event.journalId || INVENTORY_EVENT_TYPES.has(event.eventType) || DIRECT_EVENT_TYPES.has(event.eventType))) {
    const journal = event.journalId ? await prisma.journal.findUnique({ where: { id: event.journalId } }) : null;
    return { event, journal };
  }

  // Claim the event as read, so the inline ingest, the worker and a manual retry cannot post it twice.
  // A claim older than any posting transaction can last belongs to a process that died; it may be taken over.
  if (event.status === "PROCESSING" && Date.now() - event.updatedAt.getTime() < PROCESSING_CLAIM_MS) {
    throw new Error("This event is already being processed");
  }
  const claimed = await prisma.integrationEvent.updateMany({
    where: { id: event.id, status: event.status, updatedAt: event.updatedAt },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) throw new Error("This event is already being processed");

  try {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: event.companyId },
      include: { activation: true },
    });
    if (company.activation?.status !== "ACTIVATED") {
      throw new Error("Accounting not activated");
    }

    if (INVENTORY_EVENT_TYPES.has(event.eventType)) {
      const journal = await processInventoryEvent(event.id);
      const updatedEvent = await prisma.integrationEvent.update({
        where: { id: event.id },
        data: { status: "POSTED", journalId: journal?.id ?? null, processedAt: new Date(), lastError: null },
      });
      await prisma.postingException.updateMany({
        where: { integrationEventId: event.id, status: { in: ["OPEN", "RETRYING"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      return { event: updatedEvent, journal };
    }

    if (event.eventType === "EXPENSE_APPROVED") {
      const payload = event.payload as Record<string, unknown>;
      const expense = await syncExpenseFromEvent(
        event.companyId,
        {
          sourceModule: event.sourceModule,
          sourceDocumentType: event.sourceDocumentType,
          sourceDocumentId: event.sourceDocumentId,
          sourceDocumentNumber: event.sourceDocumentNumber,
          occurredAt: event.occurredAt,
          amountTotals: (payload.amountTotals as { net?: string; tax?: string; gross?: string }) ?? null,
          metadata: (payload.metadata as Record<string, unknown>) ?? null,
        },
        { erpUserId: 0, erpRole: "SYSTEM" },
      );
      const updatedEvent = await prisma.integrationEvent.update({
        where: { id: event.id },
        data: { status: "POSTED", journalId: expense.journalId, processedAt: new Date(), lastError: null },
      });
      await prisma.postingException.updateMany({
        where: { integrationEventId: event.id, status: { in: ["OPEN", "RETRYING"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      const journal = expense.journalId ? await prisma.journal.findUnique({ where: { id: expense.journalId } }) : null;
      return { event: updatedEvent, journal };
    }

    if (event.eventType === "GOODS_RECEIVED") {
      const { updatedEvent, journal } = await inTransaction(async () => {
        const { journal } = await recordGoodsReceipt(event);
        const updatedEvent = await prisma.integrationEvent.update({
          where: { id: event.id },
          data: { status: "POSTED", journalId: journal?.id ?? null, processedAt: new Date(), lastError: null },
        });
        return { updatedEvent, journal };
      });
      await prisma.postingException.updateMany({
        where: { integrationEventId: event.id, status: { in: ["OPEN", "RETRYING"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      return { event: updatedEvent, journal };
    }

    if (event.eventType === "ASSET_ACQUIRED") {
      const payload = event.payload as Record<string, unknown>;
      const asset = await syncAssetFromEvent(
        event.companyId,
        {
          sourceModule: event.sourceModule,
          sourceDocumentType: event.sourceDocumentType,
          sourceDocumentId: event.sourceDocumentId,
          sourceDocumentNumber: event.sourceDocumentNumber,
          occurredAt: event.occurredAt,
          amountTotals: (payload.amountTotals as { net?: string; tax?: string; gross?: string }) ?? null,
          metadata: (payload.metadata as Record<string, unknown>) ?? null,
        },
        { erpUserId: 0, erpRole: "SYSTEM" },
      );
      const updatedEvent = await prisma.integrationEvent.update({
        where: { id: event.id },
        data: { status: "POSTED", journalId: asset.capitalizationJournalId, processedAt: new Date(), lastError: null },
      });
      await prisma.postingException.updateMany({
        where: { integrationEventId: event.id, status: { in: ["OPEN", "RETRYING"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      const journal = asset.capitalizationJournalId ? await prisma.journal.findUnique({ where: { id: asset.capitalizationJournalId } }) : null;
      return { event: updatedEvent, journal };
    }

    const payload = event.payload as Record<string, unknown>;
    const subledgerSync = SUBLEDGER_SYNC[event.eventType];
    const { posted, updatedEvent } = await inTransaction(async () => {
      const { lines, description } = await resolvePostingLines(
        event.companyId,
        event.eventType,
        {
          ...payload,
          sourceDocumentId: event.sourceDocumentId,
          sourceDocumentNumber: event.sourceDocumentNumber,
        },
      );
      const posted = await createAndPostJournal(
        event.companyId,
        {
          journalDate: event.occurredAt,
          journalType: "AUTOMATIC",
          description,
          referenceNumber: event.sourceDocumentNumber ?? event.sourceDocumentId,
          currencyCode: event.currencyCode,
          branchId: event.externalBranchId ?? undefined,
          sourceModule: event.sourceModule,
          sourceDocumentType: event.sourceDocumentType,
          sourceDocumentId: event.sourceDocumentId,
          sourceDocumentNumber: event.sourceDocumentNumber ?? undefined,
          integrationEventId: event.id,
          lines,
          status: "APPROVED",
        },
        { erpUserId: 0, erpRole: "SYSTEM" },
      );
      const updatedEvent = await prisma.integrationEvent.update({
        where: { id: event.id },
        data: {
          status: "POSTED",
          journalId: posted.id,
          processedAt: new Date(),
          lastError: null,
        },
      });
      if (subledgerSync) {
        try {
          await subledgerSync.run(updatedEvent.id);
        } catch (syncError) {
          throw new Error(`${subledgerSync.label} subledger: ${(syncError as Error).message}`);
        }
      }
      return { posted, updatedEvent };
    });

    await prisma.postingException.updateMany({
      where: { integrationEventId: event.id, status: { in: ["OPEN", "RETRYING"] } },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    if (event.eventType === "SALE_COMPLETED" || event.eventType === "SALES_RETURN_COMPLETED") {
      try {
        const { recordFiscalDocumentFromEvent } = await import("../tax/tax.service");
        const amounts = (payload.amountTotals ?? {}) as { net?: string; tax?: string; gross?: string };
        await recordFiscalDocumentFromEvent(event.companyId, {
          sourceDocumentType: event.sourceDocumentType,
          sourceDocumentId: event.sourceDocumentId,
          sourceDocumentNumber: event.sourceDocumentNumber ?? undefined,
          occurredAt: event.occurredAt,
          net: Number(amounts.net ?? 0),
          tax: Number(amounts.tax ?? 0),
          gross: Number(amounts.gross ?? 0),
          currencyCode: event.currencyCode,
          journalId: posted.id,
          integrationEventId: event.id,
          metadata: (payload.metadata as Record<string, unknown> | undefined) ?? null,
        });
      } catch (fiscalError) {
        console.error("[tax] fiscal document record failed", (fiscalError as Error).message);
      }
    }

    return { event: updatedEvent, journal: posted };
  } catch (e) {
    const message = (e as Error).message;
    const attempts = event.attemptCount + 1;
    const dead = attempts >= 5;
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: dead ? "DEAD_LETTER" : "FAILED",
        lastError: message,
        nextAttemptAt: new Date(Date.now() + Math.min(attempts, 10) * 60_000),
      },
    });
    await prisma.postingException.create({
      data: {
        companyId: event.companyId,
        integrationEventId: event.id,
        reason: message,
        detailsJson: { eventType: event.eventType, idempotencyKey: event.idempotencyKey },
        status: dead ? "DISMISSED" : "OPEN",
      },
    });
    await notify({
      companyId: event.companyId,
      title: dead ? "Posting failed permanently" : "Posting exception",
      body: `${event.eventType} ${event.sourceDocumentNumber ?? event.sourceDocumentId}: ${message}`,
      severity: dead ? "CRITICAL" : "WARNING",
      entityType: "IntegrationEvent",
      entityId: event.id,
    });
    await emitWebhook(event.companyId, "posting.failed", {
      integrationEventId: event.id,
      eventType: event.eventType,
      sourceDocumentId: event.sourceDocumentId,
      sourceDocumentNumber: event.sourceDocumentNumber,
      idempotencyKey: event.idempotencyKey,
      attempts,
      final: dead,
      reason: message,
    });
    throw e;
  }
}

export async function getEventByIdempotency(companyId: string, idempotencyKey: string) {
  return prisma.integrationEvent.findUnique({
    where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
    include: { journal: { include: { lines: true } } },
  });
}

export async function listExceptions(companyId: string, status?: string) {
  return prisma.postingException.findMany({
    where: {
      companyId,
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function retryException(companyId: string, exceptionId: string, erpUserId?: number) {
  const ex = await prisma.postingException.findFirst({
    where: { id: exceptionId, companyId },
  });
  if (!ex?.integrationEventId) throw new Error("Exception has no linked integration event");
  await prisma.postingException.update({
    where: { id: ex.id },
    data: { status: "RETRYING", resolvedByErpUserId: erpUserId },
  });
  return processIntegrationEvent(ex.integrationEventId);
}

export async function processPendingEvents(limit = 20) {
  const pending = await prisma.integrationEvent.findMany({
    where: {
      status: { in: ["RECEIVED", "FAILED"] },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const results = [];
  for (const event of pending) {
    try {
      results.push({ id: event.id, ...(await processIntegrationEvent(event.id)) });
    } catch (e) {
      results.push({ id: event.id, error: (e as Error).message });
    }
  }
  return results;
}

import { prisma } from "../../lib/prisma";
import { syncSupplierBillToSubledger, syncSupplierPaymentToSubledger } from "../ap/ap.service";
import { syncSaleToSubledger } from "../ar/ar.service";
import { syncExpenseFromEvent } from "../expense/expense.service";
import { syncAssetFromEvent } from "../fixed-assets/fa.service";
import { INVENTORY_EVENT_TYPES, processInventoryEvent } from "../inventory/inventory.service";
import { createJournal, postJournal } from "../journals/journal.service";
import { resolvePostingLines } from "./posting-rules.service";

const SUBLEDGER_SYNC: Record<string, { label: string; run: (eventId: string) => Promise<unknown> }> = {
  SALE_COMPLETED: { label: "AR", run: syncSaleToSubledger },
  SUPPLIER_BILL_APPROVED: { label: "AP", run: syncSupplierBillToSubledger },
  SUPPLIER_PAYMENT_COMPLETED: { label: "AP", run: syncSupplierPaymentToSubledger },
};

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
  const event = await prisma.integrationEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.status === "POSTED" && (event.journalId || INVENTORY_EVENT_TYPES.has(event.eventType) || event.eventType === "EXPENSE_APPROVED" || event.eventType === "ASSET_ACQUIRED")) {
    const journal = event.journalId ? await prisma.journal.findUnique({ where: { id: event.journalId } }) : null;
    return { event, journal };
  }

  await prisma.integrationEvent.update({
    where: { id: event.id },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
    },
  });

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
    const { lines, description } = await resolvePostingLines(
      event.companyId,
      event.eventType,
      {
        ...payload,
        sourceDocumentId: event.sourceDocumentId,
        sourceDocumentNumber: event.sourceDocumentNumber,
      },
    );

    const journal = await createJournal(
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

    const posted = await postJournal(event.companyId, journal.id, {
      erpUserId: 0,
      erpRole: "SYSTEM",
    });

    const updatedEvent = await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: "POSTED",
        journalId: posted.id,
        processedAt: new Date(),
        lastError: null,
      },
    });

    await prisma.postingException.updateMany({
      where: { integrationEventId: event.id, status: { in: ["OPEN", "RETRYING"] } },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    const subledgerSync = SUBLEDGER_SYNC[event.eventType];
    if (subledgerSync) {
      try {
        await subledgerSync.run(updatedEvent.id);
      } catch (syncError) {
        await prisma.postingException.create({
          data: {
            companyId: event.companyId,
            integrationEventId: event.id,
            journalId: posted.id,
            reason: `${subledgerSync.label} subledger sync failed: ${(syncError as Error).message}`,
            status: "OPEN",
          },
        });
      }
    }

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

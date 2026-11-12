import { roundMoney, type DocumentLineInput } from "@exceledge/accounting-domain";
import type { CommercialDocumentKind, CommercialDocumentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { functionalCurrencyOf, priceDocumentLines } from "../../lib/documents";
import { type Actor, HttpError, isoDay, notFound, optionalDay, optionalText, toDate } from "../../lib/http";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import * as ap from "../ap/ap.service";
import { documentApprovalPlan, requestApproval } from "../approvals/approval.service";
import * as ar from "../ar/ar.service";
import { writeAudit } from "../audit/audit.service";
import { inventoryConfig } from "../inventory/inventory.service";

/** URL and screen names for each kind, with its number series and first status. */
export const KINDS = {
  estimate: { kind: "ESTIMATE", series: "estimate", start: 1001, first: "PENDING", side: "sales" },
  proposal: { kind: "PROPOSAL", series: "estimate", start: 1001, first: "PENDING", side: "sales" },
  "sales-order": { kind: "SALES_ORDER", series: "sales-order", start: 1001, first: "OPEN", side: "sales" },
  "delayed-charge": { kind: "DELAYED_CHARGE", series: "delayed-charge", start: 1001, first: "OPEN", side: "sales" },
  "delayed-credit": { kind: "DELAYED_CREDIT", series: "delayed-credit", start: 1001, first: "OPEN", side: "sales" },
  "purchase-order": { kind: "PURCHASE_ORDER", series: "purchase-order", start: 1001, first: "OPEN", side: "purchase" },
} as const satisfies Record<string, { kind: CommercialDocumentKind; series: string; start: number; first: CommercialDocumentStatus; side: "sales" | "purchase" }>;
export type KindSlug = keyof typeof KINDS;

export const isKindSlug = (value: string): value is KindSlug => Object.prototype.hasOwnProperty.call(KINDS, value);
export const slugOf = (kind: CommercialDocumentKind) => (Object.keys(KINDS) as KindSlug[]).find((k) => KINDS[k].kind === kind)!;
export const capabilityFor = (slug: KindSlug) => (KINDS[slug].side === "purchase" ? "ap" : "ar");

/** Who may move a document where by hand. Conversions and receipts move status on their own. */
const TRANSITIONS: Record<CommercialDocumentKind, Partial<Record<CommercialDocumentStatus, CommercialDocumentStatus[]>>> = {
  ESTIMATE: { PENDING: ["ACCEPTED", "DECLINED", "VOID"], ACCEPTED: ["PENDING", "DECLINED", "VOID"], DECLINED: ["PENDING", "VOID"] },
  PROPOSAL: { PENDING: ["ACCEPTED", "DECLINED", "VOID"], ACCEPTED: ["PENDING", "DECLINED", "VOID"], DECLINED: ["PENDING", "VOID"] },
  SALES_ORDER: { OPEN: ["CLOSED", "VOID"], CLOSED: ["OPEN"] },
  DELAYED_CHARGE: { OPEN: ["VOID"] },
  DELAYED_CREDIT: { OPEN: ["VOID"] },
  PURCHASE_ORDER: { OPEN: ["CLOSED", "VOID"], PARTIALLY_RECEIVED: ["CLOSED"], RECEIVED: ["CLOSED"], CLOSED: ["OPEN"] },
};

const EDITABLE: CommercialDocumentStatus[] = ["PENDING", "ACCEPTED", "DECLINED", "OPEN", "PENDING_APPROVAL"];

const lineBody = z.object({
  description: z.string().trim().min(1).max(500),
  serviceDate: optionalDay,
  itemId: z.string().min(1).nullish(),
  accountId: z.string().min(1).nullish(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxCode: optionalText(40),
});

export const documentBody = z.object({
  number: optionalText(40),
  customerId: z.string().min(1).nullish(),
  supplierId: z.string().min(1).nullish(),
  leadName: optionalText(200),
  leadEmail: z.union([z.string().trim().email("Enter a valid lead email"), z.literal("")]).nullish().transform((v) => v || null),
  contact: optionalText(300),
  billTo: optionalText(1000),
  shipTo: optionalText(1000),
  shipVia: optionalText(100),
  terms: optionalText(40),
  docDate: isoDay,
  dueDate: optionalDay,
  expirationDate: optionalDay,
  acceptedBy: optionalText(200),
  acceptedDate: optionalDay,
  memo: optionalText(2000),
  note: optionalText(4000),
  currency: optionalText(3),
  exchangeRate: z.number().positive().nullish(),
  discountPct: z.number().min(0).max(100).nullish(),
  deposit: z.number().min(0).nullish(),
  projectId: z.string().min(1).nullish(),
  meta: z.record(z.unknown()).nullish(),
  lines: z.array(lineBody).min(1, "Add at least one line").max(200),
});
export type DocumentBody = z.infer<typeof documentBody>;

const audit = (companyId: string, actor: Actor, action: string, id: string, afterJson?: unknown) =>
  writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType: "CommercialDocument", entityId: id, afterJson, ...actor.meta });

const withLines = { lines: { orderBy: { lineNumber: "asc" } } } satisfies Prisma.CommercialDocumentInclude;

/** Next free number per series: one past the highest numeric number in use. */
export async function nextNumbers(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ series: string; top: number | null }>>`
    SELECT series, MAX(number::numeric)::float8 AS top FROM "commercial_documents"
    WHERE "companyId" = ${companyId} AND number ~ '^[0-9]{1,15}$' GROUP BY series`;
  const out: Record<string, string> = {};
  for (const { series, start } of Object.values(KINDS)) {
    const top = rows.find((r) => r.series === series)?.top;
    out[series] = String(top != null ? Math.max(top + 1, start) : start);
  }
  const [receipts, adjustments] = await Promise.all([
    prisma.$queryRaw<Array<{ top: number | null }>>`SELECT MAX(number::numeric)::float8 AS top FROM "item_receipts" WHERE "companyId" = ${companyId} AND number ~ '^[0-9]{1,15}$'`,
    prisma.$queryRaw<Array<{ top: number | null }>>`SELECT MAX(number::numeric)::float8 AS top FROM "inventory_adjustments" WHERE "companyId" = ${companyId} AND number ~ '^[0-9]{1,15}$'`,
  ]);
  out["item-receipt"] = String(receipts[0]?.top != null ? receipts[0].top + 1 : 1001);
  out["inventory-adjustment"] = String(adjustments[0]?.top != null ? adjustments[0].top + 1 : 1);
  return out;
}

/** Works out party, totals and priced lines. Everything the browser sends about money is recomputed here. */
async function prepare(companyId: string, slug: KindSlug, input: DocumentBody) {
  const config = KINDS[slug];
  const isQuote = config.kind === "ESTIMATE" || config.kind === "PROPOSAL";
  let partyName: string;
  let partyCurrency: string | null = null;
  if (config.side === "purchase") {
    if (input.customerId) throw new Error("A purchase order is for a supplier");
    if (!input.supplierId) throw new Error("Choose a supplier");
    const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, companyId } });
    if (!supplier) throw new Error("Choose an existing supplier");
    partyName = supplier.name;
    partyCurrency = supplier.currency;
  } else {
    if (input.supplierId) throw new Error("This document is for a customer");
    if (input.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: input.customerId, companyId } });
      if (!customer) throw new Error("Choose an existing customer");
      partyName = customer.name;
      partyCurrency = customer.currency;
    } else if (isQuote && input.leadName) {
      partyName = input.leadName;
    } else {
      throw new Error(isQuote ? "Choose a customer or enter a lead" : "Choose a customer");
    }
  }
  if (input.projectId && !(await prisma.project.findFirst({ where: { id: input.projectId, companyId } }))) throw new Error("Choose an existing project");
  const itemIds = [...new Set(input.lines.map((l) => l.itemId).filter(Boolean) as string[])];
  if (itemIds.length && (await prisma.inventoryItem.count({ where: { companyId, id: { in: itemIds } } })) !== itemIds.length) throw new Error("A selected item does not exist");
  const accountIds = [...new Set(input.lines.map((l) => l.accountId).filter(Boolean) as string[])];
  if (accountIds.length && (await prisma.account.count({ where: { companyId, id: { in: accountIds }, isActive: true } })) !== accountIds.length) {
    throw new Error("A selected account does not exist or is inactive");
  }

  const date = toDate(input.docDate)!;
  const functional = await functionalCurrencyOf(companyId);
  const currency = input.currency?.toUpperCase() || partyCurrency || functional;
  const pct = input.discountPct ?? 0;
  const priced = await priceDocumentLines(
    companyId,
    input.lines.map((l): DocumentLineInput => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: roundMoney((l.quantity * l.unitPrice * pct) / 100),
      taxCode: l.taxCode,
      accountId: l.accountId,
    })),
    date,
    config.side,
  );
  const net = roundMoney(priced.net);
  const tax = roundMoney(priced.tax);
  return {
    config,
    partyName,
    date,
    currency,
    net,
    tax,
    total: roundMoney(net + tax),
    lines: priced.lines.map((l, index) => ({
      lineNumber: index + 1,
      description: l.description,
      serviceDate: toDate(input.lines[index].serviceDate),
      itemId: input.lines[index].itemId ?? null,
      accountId: l.accountId ?? null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      net: l.net,
      taxCode: l.taxCode ?? null,
      taxRate: l.taxRate,
      tax: l.tax,
    })),
  };
}

function headerData(input: DocumentBody, p: Awaited<ReturnType<typeof prepare>>) {
  return {
    customerId: input.customerId ?? null,
    supplierId: input.supplierId ?? null,
    partyName: p.partyName,
    leadName: input.leadName,
    leadEmail: input.leadEmail,
    contact: input.contact,
    billTo: input.billTo,
    shipTo: input.shipTo,
    shipVia: input.shipVia,
    terms: input.terms,
    docDate: p.date,
    dueDate: toDate(input.dueDate),
    expirationDate: toDate(input.expirationDate),
    acceptedBy: input.acceptedBy,
    acceptedDate: toDate(input.acceptedDate),
    memo: input.memo,
    note: input.note,
    currency: p.currency,
    exchangeRate: input.exchangeRate ?? 1,
    discountPct: input.discountPct ?? 0,
    net: p.net,
    tax: p.tax,
    total: p.total,
    deposit: input.deposit ?? 0,
    projectId: input.projectId ?? null,
    meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

export async function createDocument(companyId: string, slug: KindSlug, input: DocumentBody, actor: Actor) {
  return inTransaction(async () => {
    const p = await prepare(companyId, slug, input);
    await lockForTransaction(`commercial-series:${companyId}:${p.config.series}`);
    const number = input.number ?? (await nextNumbers(companyId))[p.config.series];
    const plan = p.config.kind === "PURCHASE_ORDER" ? await documentApprovalPlan(companyId, "PurchaseOrder", p.total) : null;
    const accepted = input.acceptedBy && (p.config.kind === "ESTIMATE" || p.config.kind === "PROPOSAL");
    const row = await prisma.commercialDocument.create({
      data: {
        companyId,
        kind: p.config.kind,
        series: p.config.series,
        number,
        status: plan ? "PENDING_APPROVAL" : accepted ? "ACCEPTED" : p.config.first,
        createdByErpUserId: actor.erpUserId,
        ...headerData(input, p),
        lines: { create: p.lines },
      },
      include: withLines,
    });
    await audit(companyId, actor, "CREATE", row.id, { kind: row.kind, number, total: p.total, status: row.status });
    if (plan) {
      const approval = await requestApproval(companyId, { entityType: "PurchaseOrder", entityId: row.id, amount: p.total, plan }, actor);
      return { ...row, approval };
    }
    return row;
  });
}

export async function updateDocument(companyId: string, id: string, input: DocumentBody, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`commercial:${id}`);
    const existing = await loadDocument(companyId, id);
    if (!EDITABLE.includes(existing.status)) throw new HttpError(409, `This document is ${existing.status.toLowerCase().replace(/_/g, " ")} and can't be edited`);
    const p = await prepare(companyId, slugOf(existing.kind), input);
    await prisma.commercialDocumentLine.deleteMany({ where: { documentId: id } });
    const row = await prisma.commercialDocument.update({
      where: { id },
      data: { ...(input.number ? { number: input.number } : {}), ...headerData(input, p), lines: { create: p.lines } },
      include: withLines,
    });
    await audit(companyId, actor, "UPDATE", id, { number: row.number, total: p.total });
    return row;
  });
}

async function loadDocument(companyId: string, id: string) {
  const row = await prisma.commercialDocument.findFirst({ where: { id, companyId }, include: withLines });
  if (!row) throw notFound("Document");
  return row;
}
export const getDocument = loadDocument;

export async function listDocuments(companyId: string, slug: KindSlug, filter: { status?: string; q?: string; customerId?: string; supplierId?: string }) {
  const q = filter.q?.trim();
  return prisma.commercialDocument.findMany({
    where: {
      companyId,
      kind: KINDS[slug].kind,
      ...(filter.status ? { status: filter.status as CommercialDocumentStatus } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { partyName: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: withLines,
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

export const STATUS_VALUES = ["PENDING", "ACCEPTED", "DECLINED", "OPEN", "CLOSED", "VOID"] as const;

export async function setStatus(companyId: string, id: string, status: CommercialDocumentStatus, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`commercial:${id}`);
    const row = await loadDocument(companyId, id);
    if (!TRANSITIONS[row.kind][row.status]?.includes(status)) {
      throw new HttpError(409, `A ${row.status.toLowerCase().replace(/_/g, " ")} document can't become ${status.toLowerCase()}`);
    }
    if (status === "OPEN" && row.kind === "PURCHASE_ORDER" && row.lines.some((l) => Number(l.receivedQuantity) > 0)) {
      throw new HttpError(409, "This order already has goods received against it");
    }
    const updated = await prisma.commercialDocument.update({ where: { id }, data: { status }, include: withLines });
    await audit(companyId, actor, "STATUS", id, { from: row.status, to: status });
    return updated;
  });
}

/** Deleting is only for documents nothing depends on; anything else is voided so the trail stays. */
export async function deleteDocument(companyId: string, id: string, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`commercial:${id}`);
    const row = await loadDocument(companyId, id);
    if (row.convertedToId || row.lines.some((l) => Number(l.receivedQuantity) > 0 || Number(l.billedQuantity) > 0)) {
      throw new HttpError(409, "This document has been used; void it instead");
    }
    await prisma.commercialDocument.delete({ where: { id } });
    await audit(companyId, actor, "DELETE", id, { kind: row.kind, number: row.number });
    return { id };
  });
}

/* ── Conversion to posted documents ────────────────────────────────────────────── */

export const convertBody = z.object({
  target: z.enum(["INVOICE", "SALES_ORDER", "CREDIT_NOTE", "BILL"]),
  date: isoDay.optional(),
  dueDate: isoDay.optional(),
  supplierInvoiceNumber: optionalText(60),
  creditOverride: z.boolean().optional(),
});

const CONVERTS_FROM: Record<CommercialDocumentKind, { targets: string[]; statuses: CommercialDocumentStatus[] }> = {
  ESTIMATE: { targets: ["INVOICE", "SALES_ORDER"], statuses: ["PENDING", "ACCEPTED"] },
  PROPOSAL: { targets: ["INVOICE", "SALES_ORDER"], statuses: ["PENDING", "ACCEPTED"] },
  SALES_ORDER: { targets: ["INVOICE"], statuses: ["OPEN"] },
  DELAYED_CHARGE: { targets: ["INVOICE"], statuses: ["OPEN"] },
  DELAYED_CREDIT: { targets: ["CREDIT_NOTE"], statuses: ["OPEN"] },
  PURCHASE_ORDER: { targets: ["BILL"], statuses: ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED"] },
};

export async function convertDocument(companyId: string, id: string, input: z.infer<typeof convertBody>, actor: Actor & { allowCreditOverride?: boolean }) {
  return inTransaction(async () => {
    await lockForTransaction(`commercial:${id}`);
    const doc = await loadDocument(companyId, id);
    const rule = CONVERTS_FROM[doc.kind];
    if (!rule.targets.includes(input.target)) throw new Error(`A ${slugOf(doc.kind).replace(/-/g, " ")} can't become a ${input.target.toLowerCase().replace(/_/g, " ")}`);
    if (!rule.statuses.includes(doc.status)) throw new HttpError(409, `This document is ${doc.status.toLowerCase().replace(/_/g, " ")} and can't be converted`);
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    const lines = doc.lines.map((l): DocumentLineInput => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discount: Number(l.discount),
      taxCode: l.taxCode,
      accountId: l.accountId,
    }));

    if (input.target === "BILL") return billPurchaseOrder(companyId, doc, input, date, actor);

    if (!doc.customerId) throw new Error("Add this lead as a customer before converting");
    let result: { id: string; number: string; type: string };
    if (input.target === "INVOICE") {
      const invoice = await ar.createInvoice(companyId, { customerId: doc.customerId, invoiceDate: date, dueDate: input.dueDate, currency: doc.currency, description: doc.memo ?? undefined, lines }, actor);
      result = { id: invoice.id, number: invoice.invoiceNumber, type: "ArInvoice" };
    } else if (input.target === "CREDIT_NOTE") {
      const note = await ar.createCreditNote(companyId, { customerId: doc.customerId, noteDate: date, reason: doc.memo || `Delayed credit ${doc.number}`, net: Number(doc.net), tax: Number(doc.tax), description: doc.memo ?? undefined }, actor);
      result = { id: note.id, number: note.creditNoteNumber, type: "ArCreditNote" };
    } else {
      const series = "sales-order";
      await lockForTransaction(`commercial-series:${companyId}:${series}`);
      const number = (await nextNumbers(companyId))[series];
      const order = await prisma.commercialDocument.create({
        data: {
          companyId,
          kind: "SALES_ORDER",
          series,
          number,
          status: "OPEN",
          customerId: doc.customerId,
          partyName: doc.partyName,
          contact: doc.contact,
          billTo: doc.billTo,
          shipTo: doc.shipTo,
          terms: doc.terms,
          docDate: toDate(date)!,
          memo: doc.memo,
          note: doc.note,
          currency: doc.currency,
          exchangeRate: doc.exchangeRate,
          discountPct: doc.discountPct,
          net: doc.net,
          tax: doc.tax,
          total: doc.total,
          projectId: doc.projectId,
          createdByErpUserId: actor.erpUserId,
          lines: {
            create: doc.lines.map(({ lineNumber, description, serviceDate, itemId, accountId, quantity, unitPrice, discount, net, taxCode, taxRate, tax }) => ({ lineNumber, description, serviceDate, itemId, accountId, quantity, unitPrice, discount, net, taxCode, taxRate, tax })),
          },
        },
      });
      result = { id: order.id, number: order.number, type: "CommercialDocument" };
    }
    await prisma.commercialDocument.update({ where: { id }, data: { status: "CONVERTED", convertedToType: result.type, convertedToId: result.id, convertedToNumber: result.number } });
    await audit(companyId, actor, "CONVERT", id, result);
    return { document: await loadDocument(companyId, id), converted: result };
  });
}

/** Item receipts not yet on a live bill; a rejected or reversed bill frees its receipts again. */
async function billableReceipts(companyId: string, where: Prisma.ItemReceiptWhereInput) {
  const receipts = await prisma.itemReceipt.findMany({ where: { companyId, ...where }, include: { lines: { orderBy: { lineNumber: "asc" } } }, orderBy: { receiptDate: "asc" } });
  const billIds = receipts.map((r) => r.billId).filter(Boolean) as string[];
  const dead = billIds.length ? await prisma.apBill.findMany({ where: { id: { in: billIds }, status: { in: ["REJECTED", "REVERSED"] } }, select: { id: true } }) : [];
  const deadIds = new Set(dead.map((b) => b.id));
  return receipts.filter((r) => !r.billId || deadIds.has(r.billId));
}

/**
 * Bills what has been received plus any non-stock lines. Received goods debit goods received not invoiced at the
 * value they were received at, so stock isn't expensed a second time; unreceived stock lines wait for their receipt.
 */
async function billPurchaseOrder(
  companyId: string,
  doc: Awaited<ReturnType<typeof loadDocument>>,
  input: z.infer<typeof convertBody>,
  date: string,
  actor: Actor,
) {
  const { accounts } = await inventoryConfig(companyId);
  const receipts = await billableReceipts(companyId, { purchaseOrderId: doc.id });
  const lines: DocumentLineInput[] = [];
  const billedByLine = new Map<string, number>();
  for (const receipt of receipts) {
    for (const l of receipt.lines) {
      if (!accounts.grniId) throw new Error("Goods received not invoiced account is not configured");
      const orderLine = doc.lines.find((o) => o.id === l.purchaseOrderLineId) ?? doc.lines.find((o) => o.itemId === l.itemId);
      lines.push({ description: l.description || orderLine?.description || `Received on ${receipt.number}`, quantity: Number(l.quantity), unitPrice: Number(l.unitCost), taxCode: l.taxCode ?? orderLine?.taxCode, accountId: accounts.grniId });
      if (orderLine) billedByLine.set(orderLine.id, (billedByLine.get(orderLine.id) ?? 0) + Number(l.quantity));
    }
  }
  for (const l of doc.lines) {
    if (l.itemId || Number(l.billedQuantity) > 0) continue;
    lines.push({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discount: Number(l.discount), taxCode: l.taxCode, accountId: l.accountId });
    billedByLine.set(l.id, Number(l.quantity));
  }
  if (!lines.length) throw new Error("Nothing to bill yet: receive the goods on this order first");

  const bill = await ap.createBill(
    companyId,
    { supplierId: doc.supplierId!, supplierInvoiceNumber: input.supplierInvoiceNumber ?? undefined, billDate: date, dueDate: input.dueDate, poReference: doc.number, currency: doc.currency, description: doc.memo ?? undefined, lines },
    actor,
  );
  await markReceiptsBilled(receipts, bill.id);
  for (const [lineId, quantity] of billedByLine) await prisma.commercialDocumentLine.update({ where: { id: lineId }, data: { billedQuantity: { increment: quantity } } });
  const fresh = await loadDocument(companyId, doc.id);
  const fullyBilled = fresh.lines.every((l) => Number(l.billedQuantity) >= Number(l.quantity) - 0.0001);
  await prisma.commercialDocument.update({
    where: { id: doc.id },
    data: { convertedToType: "ApBill", convertedToId: bill.id, convertedToNumber: bill.billNumber, ...(fullyBilled ? { status: "CONVERTED" } : {}) },
  });
  await audit(companyId, actor, "CONVERT", doc.id, { billId: bill.id, billNumber: bill.billNumber, gross: bill.gross });
  return { document: await loadDocument(companyId, doc.id), converted: { id: bill.id, number: bill.billNumber, type: "ApBill" } };
}

async function markReceiptsBilled(receipts: Array<{ id: string; goodsReceiptId: string | null; value: unknown }>, billId: string) {
  const cleared = roundMoney(receipts.reduce((sum, r) => sum + Number(r.value), 0));
  for (const receipt of receipts) {
    await prisma.itemReceipt.update({ where: { id: receipt.id }, data: { status: "BILLED", billId } });
    if (receipt.goodsReceiptId) await prisma.goodsReceipt.update({ where: { id: receipt.goodsReceiptId }, data: { matchedValue: Number(receipt.value) } });
  }
  // A bill that cleared goods can't be voided on its own; that would leave the receipt marked as billed.
  if (cleared > 0) await prisma.apBill.update({ where: { id: billId }, data: { grniCleared: cleared } });
}

/** Bills a receipt that has no purchase order. */
export async function billItemReceipt(companyId: string, receiptId: string, input: { date?: string; dueDate?: string; supplierInvoiceNumber?: string | null }, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`item-receipt:${receiptId}`);
    const [receipt] = await billableReceipts(companyId, { id: receiptId });
    if (!receipt) {
      if (await prisma.itemReceipt.findFirst({ where: { id: receiptId, companyId } })) throw new HttpError(409, "This receipt is already on a bill");
      throw notFound("Item receipt");
    }
    if (receipt.purchaseOrderId) throw new Error("Bill this receipt from its purchase order");
    const { accounts } = await inventoryConfig(companyId);
    if (!accounts.grniId) throw new Error("Goods received not invoiced account is not configured");
    const bill = await ap.createBill(
      companyId,
      {
        supplierId: receipt.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? undefined,
        billDate: input.date ?? new Date().toISOString().slice(0, 10),
        dueDate: input.dueDate,
        grnReference: receipt.number,
        description: receipt.memo ?? undefined,
        lines: receipt.lines.map((l) => ({ description: l.description || `Received on ${receipt.number}`, quantity: Number(l.quantity), unitPrice: Number(l.unitCost), taxCode: l.taxCode, accountId: accounts.grniId })),
      },
      actor,
    );
    await markReceiptsBilled([receipt], bill.id);
    await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "BILL", entityType: "ItemReceipt", entityId: receipt.id, afterJson: { billId: bill.id, billNumber: bill.billNumber }, ...actor.meta });
    return { receiptId: receipt.id, bill };
  });
}

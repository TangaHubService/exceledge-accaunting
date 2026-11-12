import { roundMoney } from "@exceledge/accounting-domain";
import { z } from "zod";
import { nextNumber } from "../../lib/documents";
import { type Actor, HttpError, isoDay, notFound, optionalText, toDate } from "../../lib/http";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { approvalControls, documentApprovalPlan, planFor, requestApproval } from "../approvals/approval.service";
import { writeAudit } from "../audit/audit.service";
import { defaultLocationFor, inventoryConfig, postStockDocument, type StockDocumentLine } from "./inventory.service";

const audit = (companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown) =>
  writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, afterJson, ...actor.meta });

async function assertItems(companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await prisma.inventoryItem.count({ where: { companyId, id: { in: unique } } });
  if (found !== unique.length) throw new Error("A selected item does not exist");
}

async function resolveLocation(companyId: string, itemId: string, locationId?: string | null) {
  if (!locationId) return defaultLocationFor(companyId, itemId);
  const location = await prisma.inventoryLocation.findFirst({ where: { id: locationId, companyId } });
  if (!location) throw new Error("A selected location does not exist");
  return location.id;
}

/** Every item, in stock or not: the first delivery of a product has to be receivable. */
export async function listItems(companyId: string) {
  const items = await prisma.inventoryItem.findMany({ where: { companyId }, include: { balances: { select: { quantity: true, value: true } } }, orderBy: { name: "asc" }, take: 5000 });
  return items.map((item) => {
    const quantity = item.balances.reduce((sum, b) => sum + Number(b.quantity), 0);
    const value = item.balances.reduce((sum, b) => sum + Number(b.value), 0);
    return { id: item.id, name: item.name, sku: item.sku ?? "", quantity, value: roundMoney(value), unitCost: quantity > 0 ? value / quantity : 0 };
  });
}

/* ── Item receipts ─────────────────────────────────────────────────────────────── */

export const itemReceiptBody = z.object({
  supplierId: z.string().min(1),
  purchaseOrderId: z.string().min(1).nullish(),
  number: optionalText(40),
  date: isoDay,
  memo: optionalText(1000),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        locationId: z.string().min(1).nullish(),
        purchaseOrderLineId: z.string().min(1).nullish(),
        description: optionalText(500),
        quantity: z.number().positive(),
        unitCost: z.number().positive("Enter what the goods cost"),
        taxCode: optionalText(40),
      }),
    )
    .min(1)
    .max(200),
});

/** Receives goods: stock goes up at cost, against goods received not invoiced, until the supplier's bill clears it. */
export async function createItemReceipt(companyId: string, input: z.infer<typeof itemReceiptBody>, actor: Actor) {
  return inTransaction(async () => {
    const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, companyId } });
    if (!supplier) throw new Error("Choose an existing supplier");
    await assertItems(companyId, input.lines.map((l) => l.itemId));
    const { accounts } = await inventoryConfig(companyId);
    if (!accounts.grniId) throw new Error("Goods received not invoiced account is not configured");

    const order = input.purchaseOrderId ? await lockOrderForReceiving(companyId, input.purchaseOrderId, supplier.id) : null;
    const date = toDate(input.date)!;
    const number = input.number ?? (await nextNumber(companyId, "ITEM_RECEIPT", "GRN", { date }));
    const value = roundMoney(input.lines.reduce((sum, l) => sum + roundMoney(l.quantity * l.unitCost), 0));
    const goods = await prisma.goodsReceipt.create({
      data: { companyId, supplierId: supplier.id, receiptDate: date, poReference: order?.number ?? number, reference: number, value },
    });
    const located = [];
    for (const line of input.lines) located.push({ ...line, locationId: await resolveLocation(companyId, line.itemId, line.locationId) });
    const receipt = await prisma.itemReceipt.create({
      data: {
        companyId,
        number,
        supplierId: supplier.id,
        purchaseOrderId: order?.id,
        goodsReceiptId: goods.id,
        receiptDate: date,
        memo: input.memo,
        value,
        createdByErpUserId: actor.erpUserId,
        lines: {
          create: located.map((l, index) => ({
            lineNumber: index + 1,
            itemId: l.itemId,
            locationId: l.locationId,
            description: l.description,
            purchaseOrderLineId: l.purchaseOrderLineId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            value: roundMoney(l.quantity * l.unitCost),
            taxCode: l.taxCode,
          })),
        },
      },
      include: { lines: true },
    });
    if (order) await applyReceiptToOrder(order.id, located);
    const posted = await postStockDocument(
      companyId,
      { type: "ItemReceipt", id: receipt.id, number, date, description: `Goods received ${number} from ${supplier.name}` },
      located.map((l, index): StockDocumentLine => ({ sourceKey: `item-receipt:${receipt.id}:${index}`, itemId: l.itemId, locationId: l.locationId, kind: "PURCHASE", quantity: l.quantity, unitCost: l.unitCost })),
      actor,
    );
    const saved = await prisma.itemReceipt.update({ where: { id: receipt.id }, data: { journalId: posted.journal?.id }, include: { lines: true, supplier: { select: { name: true } } } });
    await audit(companyId, actor, "CREATE", "ItemReceipt", receipt.id, { number, value, purchaseOrder: order?.number });
    return saved;
  });
}

async function lockOrderForReceiving(companyId: string, orderId: string, supplierId: string) {
  await lockForTransaction(`commercial:${orderId}`);
  const order = await prisma.commercialDocument.findFirst({ where: { id: orderId, companyId, kind: "PURCHASE_ORDER" } });
  if (!order) throw notFound("Purchase order");
  if (order.supplierId !== supplierId) throw new Error("This purchase order is for a different supplier");
  if (!["OPEN", "PARTIALLY_RECEIVED"].includes(order.status)) throw new HttpError(409, `Purchase order ${order.number} is ${order.status.toLowerCase().replace(/_/g, " ")} and can't receive goods`);
  const settings = await prisma.currencySettings.findUnique({ where: { companyId } });
  if (settings?.functionalCurrency && order.currency !== settings.functionalCurrency) {
    throw new Error(`Goods on a ${order.currency} order can't be received at cost yet; bill them directly`);
  }
  return order;
}

async function applyReceiptToOrder(orderId: string, lines: Array<{ purchaseOrderLineId?: string | null; quantity: number; itemId: string }>) {
  const orderLines = await prisma.commercialDocumentLine.findMany({ where: { documentId: orderId }, orderBy: { lineNumber: "asc" } });
  const received = new Map(orderLines.map((l) => [l.id, Number(l.receivedQuantity)]));
  for (const line of lines) {
    const target = line.purchaseOrderLineId
      ? orderLines.find((l) => l.id === line.purchaseOrderLineId)
      : orderLines.find((l) => l.itemId === line.itemId && received.get(l.id)! < Number(l.quantity));
    if (!target) throw new Error("A received line doesn't match this purchase order");
    if (target.itemId && target.itemId !== line.itemId) throw new Error("A received line is for a different item than its order line");
    const after = received.get(target.id)! + line.quantity;
    if (after - Number(target.quantity) > 0.0001) throw new Error(`Line ${target.lineNumber} of the order only has ${Number(target.quantity) - received.get(target.id)!} left to receive`);
    received.set(target.id, after);
    await prisma.commercialDocumentLine.update({ where: { id: target.id }, data: { receivedQuantity: after } });
  }
  const complete = orderLines.filter((l) => l.itemId).every((l) => received.get(l.id)! >= Number(l.quantity) - 0.0001);
  await prisma.commercialDocument.update({ where: { id: orderId }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
}

export function listItemReceipts(companyId: string, filter: { status?: string; supplierId?: string }) {
  return prisma.itemReceipt.findMany({
    where: { companyId, ...(filter.status === "RECEIVED" || filter.status === "BILLED" ? { status: filter.status } : {}), ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
    include: { lines: true, supplier: { select: { name: true } } },
    orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

/* ── Inventory adjustments ─────────────────────────────────────────────────────── */

export const adjustmentBody = z.object({
  number: optionalText(40),
  type: z.enum(["QUANTITY", "VALUE"]),
  date: isoDay,
  reason: z.string().trim().min(1, "An adjustment needs a reason").max(120),
  accountId: z.string().min(1),
  memo: optionalText(1000),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        locationId: z.string().min(1).nullish(),
        change: z.number().refine((v) => v !== 0, "The change can't be zero"),
        unitCost: z.number().positive().nullish(),
      }),
    )
    .min(1)
    .max(200),
});

/** Damage and expiry are write-offs in the stock ledger; everything else is a gain or loss. */
function outboundKind(reason: string) {
  if (/damag/i.test(reason)) return "DAMAGE" as const;
  if (/expir/i.test(reason)) return "EXPIRED" as const;
  return "ADJUSTMENT_OUT" as const;
}

/** Roughly what the adjustment is worth, to size its approval; the posted value comes from the stock ledger. */
async function estimateValue(companyId: string, type: "QUANTITY" | "VALUE", lines: Array<{ itemId: string; locationId: string; change: number; unitCost?: number | null }>) {
  let total = 0;
  for (const line of lines) {
    if (type === "VALUE") {
      total += Math.abs(line.change);
      continue;
    }
    const balance = await prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: line.itemId, locationId: line.locationId } } });
    const average = balance && Number(balance.quantity) > 0 ? Number(balance.value) / Number(balance.quantity) : 0;
    total += Math.abs(line.change) * (line.unitCost ?? average);
  }
  return roundMoney(total);
}

export async function createAdjustment(companyId: string, input: z.infer<typeof adjustmentBody>, actor: Actor) {
  return inTransaction(async () => {
    await assertItems(companyId, input.lines.map((l) => l.itemId));
    const account = await prisma.account.findFirst({ where: { id: input.accountId, companyId, isActive: true } });
    if (!account) throw new Error("Choose an active adjustment account");
    const date = toDate(input.date)!;
    const number = input.number ?? (await nextNumber(companyId, "INVENTORY_ADJUSTMENT", "ADJ", { date }));
    const lines = [];
    for (const line of input.lines) lines.push({ ...line, locationId: await resolveLocation(companyId, line.itemId, line.locationId) });
    const estimate = await estimateValue(companyId, input.type, lines);
    const settings = await prisma.inventoryAccountingSettings.findUnique({ where: { companyId } });
    const controls = await approvalControls(companyId);
    // Setup can require approval for adjustments in either place; both need the workflow to be switched on.
    const plan =
      (await documentApprovalPlan(companyId, "InventoryAdjustment", estimate)) ??
      (controls.enabled && (settings?.adjustmentRequiresApproval ?? true) ? await planFor(companyId, estimate, true) : null);
    const needsApproval = Boolean(plan && plan.levels >= 1);
    const adjustment = await prisma.inventoryAdjustment.create({
      data: {
        companyId,
        number,
        type: input.type,
        status: needsApproval ? "PENDING_APPROVAL" : "POSTED",
        adjustmentDate: date,
        reason: input.reason,
        accountId: account.id,
        memo: input.memo,
        value: estimate,
        createdByErpUserId: actor.erpUserId,
        lines: { create: lines.map((l, index) => ({ lineNumber: index + 1, itemId: l.itemId, locationId: l.locationId, change: l.change, unitCost: l.unitCost })) },
      },
    });
    await audit(companyId, actor, "CREATE", "InventoryAdjustment", adjustment.id, { number, reason: input.reason, status: adjustment.status });
    if (needsApproval) {
      const approval = await requestApproval(companyId, { entityType: "InventoryAdjustment", entityId: adjustment.id, amount: estimate, plan: plan! }, actor);
      return { ...(await getAdjustment(companyId, adjustment.id)), approval };
    }
    return postAdjustment(companyId, adjustment.id, actor);
  });
}

async function postAdjustment(companyId: string, id: string, actor: Actor) {
  const adjustment = await prisma.inventoryAdjustment.findFirstOrThrow({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
  const stockLines = adjustment.lines.map((l, index): StockDocumentLine => {
    const change = Number(l.change);
    const sourceKey = `inventory-adjustment:${id}:${index}`;
    if (adjustment.type === "VALUE") return { sourceKey, itemId: l.itemId, locationId: l.locationId, valueChange: change };
    return change > 0
      ? { sourceKey, itemId: l.itemId, locationId: l.locationId, kind: "ADJUSTMENT_IN", quantity: change, unitCost: l.unitCost ? Number(l.unitCost) : undefined }
      : { sourceKey, itemId: l.itemId, locationId: l.locationId, kind: outboundKind(adjustment.reason), quantity: -change };
  });
  const posted = await postStockDocument(
    companyId,
    { type: "InventoryAdjustment", id, number: adjustment.number, date: adjustment.adjustmentDate, description: `Inventory adjustment ${adjustment.number}: ${adjustment.reason}`, contraAccountId: adjustment.accountId },
    stockLines,
    actor,
  );
  for (const [index, movement] of posted.movements.entries()) {
    await prisma.inventoryAdjustmentLine.update({ where: { id: adjustment.lines[index].id }, data: { value: movement.value } });
  }
  await prisma.inventoryAdjustment.update({ where: { id }, data: { status: "POSTED", journalId: posted.journal?.id, value: posted.value } });
  return getAdjustment(companyId, id);
}

/** Posts an adjustment whose approval is final. */
export async function postPendingAdjustment(companyId: string, id: string, actor: Actor) {
  return inTransaction(async () => {
    const claimed = await prisma.inventoryAdjustment.updateMany({ where: { id, companyId, status: "PENDING_APPROVAL" }, data: { status: "POSTED" } });
    if (!claimed.count) return null;
    return postAdjustment(companyId, id, actor);
  });
}

export async function getAdjustment(companyId: string, id: string) {
  const row = await prisma.inventoryAdjustment.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { lineNumber: "asc" }, include: { item: { select: { name: true, sku: true } } } } } });
  if (!row) throw notFound("Inventory adjustment");
  return row;
}

export function listAdjustments(companyId: string, filter: { status?: string }) {
  const status = filter.status === "PENDING_APPROVAL" || filter.status === "POSTED" || filter.status === "REJECTED" ? filter.status : undefined;
  return prisma.inventoryAdjustment.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    include: { lines: { orderBy: { lineNumber: "asc" }, include: { item: { select: { name: true, sku: true } } } } },
    orderBy: [{ adjustmentDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

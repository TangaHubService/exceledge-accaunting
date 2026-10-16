import {
  buildInventoryMovementLines,
  costInventoryIssue,
  costInventoryReceipt,
  inventoryKindForErpMovement,
  inventoryTurnover,
  isInboundMovement,
  openingSnapshotDelta,
  roundMoney,
  type DefaultAccountMap,
  type InventoryCostingMethod,
  type InventoryMovementKind,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { InventoryMovement, Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { defaultsFor, money } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { assertAccountsPostable, assertOpenPeriod, createJournal, postJournal } from "../journals/journal.service";

export const INVENTORY_EVENT_TYPES = new Set(["INVENTORY_MOVEMENT", "INVENTORY_OPENING"]);

const DAY = 86_400_000;
const SYSTEM = { erpUserId: 0, erpRole: "SYSTEM" };

type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

const qty = (value: { toString(): string } | number | null | undefined) => Number(value ?? 0);
const text = (value: unknown) => (value === null || value === undefined || value === "" ? undefined : String(value));
const positiveNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/* ── Configuration ─────────────────────────────────────────────────── */

/** Inventory settings override the company default accounts; the inventory setup step wins over the accounting policy. */
export async function inventoryConfig(companyId: string) {
  const [defaults, settings, policy] = await Promise.all([
    defaultsFor(companyId),
    prisma.inventoryAccountingSettings.findUnique({ where: { companyId } }),
    prisma.accountingPolicy.findUnique({ where: { companyId } }),
  ]);
  const accounts: DefaultAccountMap = {
    ...defaults,
    inventoryAssetId: settings?.inventoryAssetAccountId || defaults.inventoryAssetId,
    costOfSalesId: settings?.costOfSalesAccountId || defaults.costOfSalesId,
    inventoryAdjustmentId: settings?.adjustmentAccountId || defaults.inventoryAdjustmentId,
    inventoryWriteOffId: settings?.writeOffAccountId || defaults.inventoryWriteOffId,
    inventoryGainId: settings?.gainAccountId || defaults.inventoryGainId,
    inventoryLossId: settings?.lossAccountId || defaults.inventoryLossId,
    grniId: settings?.grniAccountId || defaults.grniId,
    goodsInTransitId: settings?.goodsInTransitAccountId || defaults.goodsInTransitId,
  };
  const method = (settings?.valuationMethod ?? policy?.inventoryValuationMethod ?? "WEIGHTED_AVERAGE") as InventoryCostingMethod;
  const inventoryAccountIds = [...new Set([accounts.inventoryAssetId, defaults.inventoryAssetId].filter(Boolean) as string[])];
  return { accounts, method, inventoryAccountIds, saleInventoryAccountId: defaults.inventoryAssetId ?? null };
}

/* ── Subledger primitives ──────────────────────────────────────────── */

type ItemRef = { productId: string; name?: string; sku?: string; category?: string; unit?: string };

async function upsertItem(tx: Prisma.TransactionClient, companyId: string, ref: ItemRef) {
  const details = {
    ...(ref.name ? { name: ref.name } : {}),
    ...(ref.sku ? { sku: ref.sku } : {}),
    ...(ref.category ? { category: ref.category } : {}),
    ...(ref.unit ? { unit: ref.unit } : {}),
  };
  return tx.inventoryItem.upsert({
    where: { companyId_externalProductId: { companyId, externalProductId: ref.productId } },
    create: { companyId, externalProductId: ref.productId, name: ref.name ?? `Product ${ref.productId}`, sku: ref.sku, category: ref.category, unit: ref.unit },
    update: details,
  });
}

async function upsertLocation(tx: Prisma.TransactionClient, companyId: string, branchId: string, name?: string) {
  return tx.inventoryLocation.upsert({
    where: { companyId_externalBranchId: { companyId, externalBranchId: branchId } },
    create: { companyId, externalBranchId: branchId, name: name ?? `Branch ${branchId}` },
    update: name ? { name } : {},
  });
}

async function balanceFor(tx: Prisma.TransactionClient, companyId: string, itemId: string, locationId: string) {
  return tx.inventoryBalance.upsert({
    where: { itemId_locationId: { itemId, locationId } },
    create: { companyId, itemId, locationId },
    update: {},
  });
}

type MovementInput = {
  companyId: string;
  sourceKey: string;
  itemId: string;
  locationId: string;
  kind: InventoryMovementKind;
  movementDate: Date;
  quantity: number;
  suppliedUnitCost?: number;
  method: InventoryCostingMethod;
  erpMovementType?: string;
  erpLedgerId?: string;
  erpQuantityAfter?: number;
  reference?: string;
  referenceType?: string;
  batchNumber?: string;
  note?: string;
  integrationEventId?: string;
};

/** Values one ERP stock movement and moves the item-location balance and FIFO layers with it. */
async function recordMovement(tx: Prisma.TransactionClient, input: MovementInput) {
  const balance = await balanceFor(tx, input.companyId, input.itemId, input.locationId);
  const position = { quantity: qty(balance.quantity), value: money(balance.value) };
  const inbound = isInboundMovement(input.kind);

  let unitCost: number;
  let value: number;
  let costSource: string;

  if (inbound) {
    let matchedUnitCost: number | undefined;
    if (input.kind === "TRANSFER_IN" && input.reference) {
      const out = await tx.inventoryMovement.findFirst({
        where: { companyId: input.companyId, itemId: input.itemId, kind: "TRANSFER_OUT", reference: input.reference },
        orderBy: { createdAt: "desc" },
      });
      matchedUnitCost = out ? qty(out.unitCost) : undefined;
    }
    const costing = costInventoryReceipt({ quantity: input.quantity, position, suppliedUnitCost: input.suppliedUnitCost, matchedUnitCost });
    ({ unitCost, value, source: costSource } = costing);
  } else {
    const layers = await tx.inventoryCostLayer.findMany({
      where: { itemId: input.itemId, locationId: input.locationId, remaining: { gt: 0 } },
      orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
    });
    const costing = costInventoryIssue({
      method: input.method,
      quantity: input.quantity,
      position,
      layers: layers.map((l) => ({ id: l.id, remaining: qty(l.remaining), unitCost: qty(l.unitCost) })),
      suppliedUnitCost: input.suppliedUnitCost,
    });
    ({ unitCost, value, source: costSource } = costing);
    for (const draw of costing.draws) {
      await tx.inventoryCostLayer.update({ where: { id: draw.layerId }, data: { remaining: { decrement: draw.quantity } } });
    }
  }

  const signedValue = inbound ? value : -value;
  const quantityAfter = position.quantity + (inbound ? input.quantity : -input.quantity);
  const valueAfter = roundMoney(position.value + signedValue);

  const movement = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      sourceKey: input.sourceKey,
      itemId: input.itemId,
      locationId: input.locationId,
      kind: input.kind,
      movementDate: input.movementDate,
      quantityIn: inbound ? input.quantity : 0,
      quantityOut: inbound ? 0 : input.quantity,
      unitCost,
      value: signedValue,
      quantityAfter,
      valueAfter,
      costSource,
      erpMovementType: input.erpMovementType,
      erpLedgerId: input.erpLedgerId,
      erpQuantityAfter: input.erpQuantityAfter,
      reference: input.reference,
      referenceType: input.referenceType,
      batchNumber: input.batchNumber,
      note: input.note,
      integrationEventId: input.integrationEventId,
    },
  });

  if (inbound && unitCost > 0) {
    await tx.inventoryCostLayer.create({
      data: {
        companyId: input.companyId,
        itemId: input.itemId,
        locationId: input.locationId,
        movementId: movement.id,
        receivedAt: input.movementDate,
        quantity: input.quantity,
        remaining: input.quantity,
        unitCost,
      },
    });
  }

  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantity: quantityAfter,
      value: valueAfter,
      lastMovementAt: input.movementDate,
      ...(input.kind === "SALE" ? { lastIssueAt: input.movementDate } : {}),
      ...(input.kind === "OPENING" ? { openingRecorded: true } : {}),
      ...(input.erpQuantityAfter !== undefined ? { erpQuantity: input.erpQuantityAfter, erpQuantityAt: input.movementDate } : {}),
    },
  });
  return movement;
}

/** Brings an item-location to the ERP snapshot. Differences from movements already recorded are absorbed here. */
async function recordOpening(
  tx: Prisma.TransactionClient,
  input: { companyId: string; sourceKey: string; itemId: string; locationId: string; movementDate: Date; quantity: number; unitCost: number; integrationEventId: string },
) {
  const balance = await balanceFor(tx, input.companyId, input.itemId, input.locationId);
  if (balance.openingRecorded) return null;
  const position = { quantity: qty(balance.quantity), value: money(balance.value) };
  const delta = openingSnapshotDelta(position, { quantity: input.quantity, unitCost: input.unitCost });

  const movement = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      sourceKey: input.sourceKey,
      itemId: input.itemId,
      locationId: input.locationId,
      kind: "OPENING",
      movementDate: input.movementDate,
      quantityIn: Math.max(delta.quantityDelta, 0),
      quantityOut: Math.max(-delta.quantityDelta, 0),
      unitCost: input.unitCost,
      value: delta.valueDelta,
      quantityAfter: input.quantity,
      valueAfter: delta.targetValue,
      costSource: "OPENING",
      erpMovementType: "OPENING_SNAPSHOT",
      erpQuantityAfter: input.quantity,
      referenceType: "OPENING_SNAPSHOT",
      integrationEventId: input.integrationEventId,
    },
  });

  await tx.inventoryCostLayer.deleteMany({ where: { itemId: input.itemId, locationId: input.locationId } });
  if (input.quantity > 0 && input.unitCost > 0) {
    await tx.inventoryCostLayer.create({
      data: {
        companyId: input.companyId,
        itemId: input.itemId,
        locationId: input.locationId,
        movementId: movement.id,
        receivedAt: input.movementDate,
        quantity: input.quantity,
        remaining: input.quantity,
        unitCost: input.unitCost,
      },
    });
  }
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantity: input.quantity,
      value: delta.targetValue,
      openingRecorded: true,
      erpQuantity: input.quantity,
      erpQuantityAt: input.movementDate,
      lastMovementAt: input.movementDate,
    },
  });
  return movement;
}

function movementLines(accounts: DefaultAccountMap, movement: Pick<InventoryMovement, "kind" | "value">) {
  const value = money(movement.value);
  return buildInventoryMovementLines(accounts, { kind: movement.kind, value: movement.kind === "OPENING" ? value : Math.abs(value) });
}

/** Nets lines by account so one event gives one compact journal. */
function netLines(lines: JournalLineDraft[]): JournalLineDraft[] {
  const byAccount = new Map<string, { net: number; description?: string }>();
  for (const line of lines) {
    const current = byAccount.get(line.accountId) ?? { net: 0, description: line.description };
    current.net = roundMoney(current.net + line.debit - line.credit);
    byAccount.set(line.accountId, current);
  }
  return [...byAccount.entries()]
    .filter(([, v]) => v.net !== 0)
    .map(([accountId, v]) => ({ accountId, description: v.description, debit: v.net > 0 ? v.net : 0, credit: v.net < 0 ? -v.net : 0 }));
}

/* ── ERP events ────────────────────────────────────────────────────── */

type EventLine = {
  sourceKey: string;
  item: ItemRef;
  branchId: string;
  branchName?: string;
  kind: InventoryMovementKind;
  quantity: number;
  unitCost?: number;
  erpMovementType?: string;
  erpLedgerId?: string;
  erpQuantityAfter?: number;
  reference?: string;
  referenceType?: string;
  batchNumber?: string;
  note?: string;
};

function readEventLines(event: { id: string; eventType: string; externalBranchId: string | null; payload: Prisma.JsonValue }): EventLine[] {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (event.eventType === "INVENTORY_OPENING") {
    const lines = Array.isArray(payload.lines) ? (payload.lines as Record<string, unknown>[]) : [];
    if (!lines.length) throw new Error("Opening stock snapshot has no lines");
    return lines.map((line, index) => {
      const productId = text(line.productId);
      const branchId = text(line.branchId);
      if (!productId || !branchId) throw new Error(`Opening line ${index + 1} needs a product and a branch`);
      return {
        sourceKey: `${event.id}:${index}`,
        item: { productId, name: text(line.productName), sku: text(line.sku), category: text(line.category), unit: text(line.unit) },
        branchId,
        branchName: text(line.branchName),
        kind: "OPENING" as const,
        quantity: Number(line.quantity ?? 0),
        unitCost: Number(line.unitCost ?? 0),
      };
    });
  }

  const meta = (payload.metadata ?? {}) as Record<string, unknown>;
  const productId = text(meta.productId);
  const branchId = text(event.externalBranchId) ?? text(meta.branchId);
  const movementType = text(meta.movementType);
  const direction = text(meta.direction) ?? "IN";
  if (!productId || !branchId || !movementType) throw new Error("Inventory movement needs a product, a branch and a movement type");
  const kind = inventoryKindForErpMovement(movementType, direction);
  if (!kind) throw new Error(`No inventory posting rule for ERP movement ${movementType}`);
  const quantity = Number(meta.quantity ?? 0);
  if (!(quantity > 0)) throw new Error("Inventory movement quantity must be positive");
  return [
    {
      sourceKey: `${event.id}:0`,
      item: { productId, name: text(meta.productName), sku: text(meta.sku), category: text(meta.category), unit: text(meta.unit) },
      branchId,
      branchName: text(meta.branchName),
      kind,
      quantity,
      unitCost: positiveNumber(meta.unitCost),
      erpMovementType: movementType,
      erpLedgerId: text(meta.ledgerId),
      erpQuantityAfter: meta.runningBalance === undefined || meta.runningBalance === null ? undefined : Number(meta.runningBalance),
      reference: text(meta.reference),
      referenceType: text(meta.referenceType),
      batchNumber: text(meta.batchNumber),
      note: text(meta.note),
    },
  ];
}

/**
 * Records an ERP inventory event in the valuation subledger, then posts one journal for its value.
 * Re-running is safe: recorded movements are found by source key and only unposted value is journalled.
 */
export async function processInventoryEvent(eventId: string) {
  const event = await prisma.integrationEvent.findUniqueOrThrow({ where: { id: eventId } });
  const companyId = event.companyId;
  const { accounts, method } = await inventoryConfig(companyId);
  const lines = readEventLines(event);
  const movementDate = event.occurredAt;

  await assertOpenPeriod(companyId, movementDate);
  const probeAccounts = new Set<string>();
  for (const kind of new Set(lines.map((l) => l.kind))) {
    for (const line of buildInventoryMovementLines(accounts, { kind, value: 1 })) probeAccounts.add(line.accountId);
  }
  if (probeAccounts.size) await assertAccountsPostable(companyId, [...probeAccounts]);

  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      const exists = await tx.inventoryMovement.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey: line.sourceKey } } });
      if (exists) continue;
      const item = await upsertItem(tx, companyId, line.item);
      const location = await upsertLocation(tx, companyId, line.branchId, line.branchName);
      if (event.eventType === "INVENTORY_OPENING") {
        await recordOpening(tx, {
          companyId,
          sourceKey: line.sourceKey,
          itemId: item.id,
          locationId: location.id,
          movementDate,
          quantity: line.quantity,
          unitCost: line.unitCost ?? 0,
          integrationEventId: event.id,
        });
      } else {
        await recordMovement(tx, {
          companyId,
          sourceKey: line.sourceKey,
          itemId: item.id,
          locationId: location.id,
          kind: line.kind,
          movementDate,
          quantity: line.quantity,
          suppliedUnitCost: line.unitCost,
          method,
          erpMovementType: line.erpMovementType,
          erpLedgerId: line.erpLedgerId,
          erpQuantityAfter: line.erpQuantityAfter,
          reference: line.reference ?? event.sourceDocumentNumber ?? undefined,
          referenceType: line.referenceType,
          batchNumber: line.batchNumber,
          note: line.note,
          integrationEventId: event.id,
        });
      }
    }
  });

  const unposted = await prisma.inventoryMovement.findMany({
    where: { companyId, integrationEventId: event.id, journalId: null, kind: { not: "SALE" }, NOT: { value: 0 } },
  });
  const journalLines = netLines(unposted.flatMap((m) => movementLines(accounts, m)));
  if (!journalLines.length) return null;

  const first = unposted[0];
  const describe =
    event.eventType === "INVENTORY_OPENING"
      ? `Opening stock from ERP snapshot (${unposted.length} item-locations)`
      : `Inventory ${first.kind.toLowerCase().replace(/_/g, " ")} ${first.reference ?? ""}`.trim();
  const journal = await createJournal(
    companyId,
    {
      journalDate: movementDate,
      journalType: "AUTOMATIC",
      description: describe,
      referenceNumber: event.sourceDocumentNumber ?? event.sourceDocumentId,
      currencyCode: event.currencyCode,
      branchId: event.externalBranchId ?? undefined,
      sourceModule: "INVENTORY",
      sourceDocumentType: event.sourceDocumentType,
      sourceDocumentId: event.sourceDocumentId,
      sourceDocumentNumber: event.sourceDocumentNumber ?? undefined,
      integrationEventId: event.id,
      status: "APPROVED",
      lines: journalLines,
    },
    SYSTEM,
  );
  const posted = await postJournal(companyId, journal.id, SYSTEM);
  await prisma.inventoryMovement.updateMany({ where: { id: { in: unposted.map((m) => m.id) } }, data: { journalId: posted.id } });
  return posted;
}

/** Asks the ERP to publish its current stock and costs as an opening snapshot, using the signed-in user's token. */
export async function requestOpeningSnapshot(companyId: string, bearerToken: string, actor: Actor) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.externalErpOrganizationId) throw new Error("This company is not linked to an Excel Edge organization");
  const res = await fetch(`${env.erpApiUrl}/accounting-integration/${company.externalErpOrganizationId}/inventory-opening`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
  }).catch(() => null);
  if (!res) throw new Error("Excel Edge could not be reached. Check ERP_API_URL and that the ERP is running.");
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: unknown; error?: string; message?: string };
  if (!res.ok || body.success === false) throw new Error(body.error || body.message || `Excel Edge refused the request (HTTP ${res.status})`);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "INVENTORY_OPENING_REQUESTED",
    entityType: "Company",
    entityId: companyId,
    afterJson: body.data ?? null,
    ...actor.meta,
  });
  return body.data ?? null;
}

/* ── Reads & reports ───────────────────────────────────────────────── */

function parseDay(value: string | undefined, endOfDay = false) {
  if (!value) return undefined;
  const d = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date ${value}`);
  return endOfDay ? new Date(d.getTime() + DAY - 1) : d;
}

async function glBalance(companyId: string, accountIds: string[], where: Prisma.GlEntryWhereInput = {}) {
  if (!accountIds.length) return 0;
  const sum = await prisma.glEntry.aggregate({ where: { companyId, accountId: { in: accountIds }, ...where }, _sum: { debit: true, credit: true } });
  return roundMoney(money(sum._sum.debit) - money(sum._sum.credit));
}

async function movementValueSum(where: Prisma.InventoryMovementWhereInput) {
  const sum = await prisma.inventoryMovement.aggregate({ where, _sum: { value: true } });
  return money(sum._sum.value);
}

/** Subledger value at the end of a day: current value less everything recorded after it. */
async function valueAt(companyId: string, at: Date, current: number) {
  return roundMoney(current - (await movementValueSum({ companyId, movementDate: { gt: at } })));
}

export async function inventoryDashboard(companyId: string) {
  const { method, inventoryAccountIds } = await inventoryConfig(companyId);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearAgo = new Date(now.getTime() - 365 * DAY);

  const [balances, monthByKind, yearByKind, recent, glValue, failedEvents, unpostedCount, uncostedCount] = await Promise.all([
    prisma.inventoryBalance.findMany({ where: { companyId }, include: { item: true, location: true } }),
    prisma.inventoryMovement.groupBy({ by: ["kind"], where: { companyId, movementDate: { gte: monthStart } }, _sum: { value: true }, _count: true }),
    prisma.inventoryMovement.groupBy({ by: ["kind"], where: { companyId, movementDate: { gte: yearAgo } }, _sum: { value: true } }),
    prisma.inventoryMovement.findMany({ where: { companyId }, include: { item: true, location: true }, orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }], take: 8 }),
    glBalance(companyId, inventoryAccountIds),
    prisma.integrationEvent.count({ where: { companyId, eventType: { in: [...INVENTORY_EVENT_TYPES] }, status: { in: ["FAILED", "DEAD_LETTER"] } } }),
    prisma.inventoryMovement.count({ where: { companyId, journalId: null, kind: { not: "SALE" }, NOT: { value: 0 } } }),
    prisma.inventoryMovement.count({ where: { companyId, costSource: "UNCOSTED" } }),
  ]);

  const totalValue = roundMoney(balances.reduce((s, b) => s + money(b.value), 0));
  const totalQuantity = balances.reduce((s, b) => s + qty(b.quantity), 0);
  const kindSum = (rows: typeof yearByKind, kinds: InventoryMovementKind[]) =>
    roundMoney(Math.abs(rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + money(r._sum.value), 0)));

  const group = (key: (b: (typeof balances)[number]) => string) => {
    const map = new Map<string, { name: string; value: number; quantity: number }>();
    for (const b of balances) {
      const name = key(b);
      const row = map.get(name) ?? { name, value: 0, quantity: 0 };
      row.value = roundMoney(row.value + money(b.value));
      row.quantity += qty(b.quantity);
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  };

  const trend: Array<{ month: string; value: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1) - 1);
    trend.push({ month: end.toISOString().slice(0, 7), value: i === 0 ? totalValue : await valueAt(companyId, end, totalValue) });
  }

  const yearCostOfSales = roundMoney(kindSum(yearByKind, ["SALE"]) - kindSum(yearByKind, ["CUSTOMER_RETURN"]));
  const openingYearValue = await valueAt(companyId, yearAgo, totalValue);

  return {
    valuationMethod: method,
    openingLoaded: balances.some((b) => b.openingRecorded),
    itemCount: new Set(balances.filter((b) => qty(b.quantity) !== 0).map((b) => b.itemId)).size,
    locationCount: new Set(balances.map((b) => b.locationId)).size,
    totalValue,
    totalQuantity,
    averageUnitCost: totalQuantity > 0 ? Math.round((totalValue / totalQuantity) * 100) / 100 : null,
    month: {
      from: monthStart.toISOString().slice(0, 10),
      costOfSales: kindSum(monthByKind, ["SALE"]),
      purchases: kindSum(monthByKind, ["PURCHASE"]),
      gains: kindSum(monthByKind, ["ADJUSTMENT_IN"]),
      losses: kindSum(monthByKind, ["ADJUSTMENT_OUT"]),
      writeOffs: kindSum(monthByKind, ["DAMAGE", "EXPIRED"]),
      returns: kindSum(monthByKind, ["CUSTOMER_RETURN"]),
      adjustments: monthByKind.filter((r) => ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE", "EXPIRED"].includes(r.kind)).reduce((s, r) => s + r._count, 0),
    },
    turnover: {
      costOfSales: yearCostOfSales,
      ratio: inventoryTurnover(yearCostOfSales, openingYearValue, totalValue),
    },
    byLocation: group((b) => b.location.name),
    byCategory: group((b) => b.item.category || "Uncategorised"),
    trend,
    reconciliation: {
      glValue,
      subledgerValue: totalValue,
      difference: roundMoney(glValue - totalValue),
      failedEvents,
      unpostedMovements: unpostedCount,
      uncostedMovements: uncostedCount,
    },
    recentMovements: recent.map((m) => serializeMovement(m)),
  };
}

function serializeMovement(m: InventoryMovement & { item: { id: string; name: string; sku: string | null }; location: { id: string; name: string } }, journalNumber?: string | null) {
  return {
    id: m.id,
    movementDate: m.movementDate,
    kind: m.kind,
    item: { id: m.item.id, name: m.item.name, sku: m.item.sku },
    location: { id: m.location.id, name: m.location.name },
    quantityIn: qty(m.quantityIn),
    quantityOut: qty(m.quantityOut),
    unitCost: qty(m.unitCost),
    value: money(m.value),
    quantityAfter: qty(m.quantityAfter),
    valueAfter: money(m.valueAfter),
    costSource: m.costSource,
    reference: m.reference,
    referenceType: m.referenceType,
    batchNumber: m.batchNumber,
    note: m.note,
    journalId: m.journalId,
    journalNumber: journalNumber ?? null,
  };
}

export async function listLocations(companyId: string) {
  return prisma.inventoryLocation.findMany({ where: { companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, externalBranchId: true } });
}

export async function valuationReport(companyId: string, filter: { asOf?: string; locationId?: string; category?: string }) {
  const asOf = parseDay(filter.asOf, true);
  const { method } = await inventoryConfig(companyId);
  const itemWhere: Prisma.InventoryItemWhereInput = filter.category ? { category: filter.category } : {};

  let rows: Array<{ itemId: string; locationId: string; quantity: number; value: number; item: { name: string; sku: string | null; category: string | null; unit: string | null }; location: { name: string } }>;
  if (!asOf) {
    const balances = await prisma.inventoryBalance.findMany({
      where: { companyId, ...(filter.locationId ? { locationId: filter.locationId } : {}), item: itemWhere },
      include: { item: true, location: true },
    });
    rows = balances.map((b) => ({ itemId: b.itemId, locationId: b.locationId, quantity: qty(b.quantity), value: money(b.value), item: b.item, location: b.location }));
  } else {
    const latest = await prisma.inventoryMovement.findMany({
      where: { companyId, movementDate: { lte: asOf }, ...(filter.locationId ? { locationId: filter.locationId } : {}), item: itemWhere },
      orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
      distinct: ["itemId", "locationId"],
      include: { item: true, location: true },
    });
    rows = latest.map((m) => ({ itemId: m.itemId, locationId: m.locationId, quantity: qty(m.quantityAfter), value: money(m.valueAfter), item: m.item, location: m.location }));
  }

  const lines = rows
    .filter((r) => r.quantity !== 0 || r.value !== 0)
    .map((r) => ({
      itemId: r.itemId,
      locationId: r.locationId,
      name: r.item.name,
      sku: r.item.sku,
      category: r.item.category,
      unit: r.item.unit,
      location: r.location.name,
      quantity: r.quantity,
      unitCost: r.quantity > 0 ? Math.round((r.value / r.quantity) * 10_000) / 10_000 : null,
      value: r.value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.location.localeCompare(b.location));

  const categories = await prisma.inventoryItem.findMany({ where: { companyId, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return {
    asOf: (asOf ?? new Date()).toISOString().slice(0, 10),
    valuationMethod: method,
    lines,
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    totalValue: roundMoney(lines.reduce((s, l) => s + l.value, 0)),
    categories: categories.map((c) => c.category as string),
  };
}

export async function listMovements(
  companyId: string,
  filter: { from?: string; to?: string; kind?: string; locationId?: string; itemId?: string; costSource?: string; q?: string; page?: number; pageSize?: number },
) {
  const from = parseDay(filter.from);
  const to = parseDay(filter.to, true);
  const kinds = filter.kind ? (filter.kind.split(",") as InventoryMovementKind[]) : undefined;
  const where: Prisma.InventoryMovementWhereInput = {
    companyId,
    ...(from || to ? { movementDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(kinds ? { kind: { in: kinds } } : {}),
    ...(filter.locationId ? { locationId: filter.locationId } : {}),
    ...(filter.itemId ? { itemId: filter.itemId } : {}),
    ...(filter.costSource ? { costSource: filter.costSource } : {}),
    ...(filter.q
      ? {
          OR: [
            { reference: { contains: filter.q, mode: "insensitive" } },
            { item: { name: { contains: filter.q, mode: "insensitive" } } },
            { item: { sku: { contains: filter.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const [total, rows, totals] = await Promise.all([
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.findMany({
      where,
      include: { item: true, location: true },
      orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inventoryMovement.aggregate({ where, _sum: { quantityIn: true, quantityOut: true, value: true } }),
  ]);
  const journalIds = [...new Set(rows.map((r) => r.journalId).filter(Boolean) as string[])];
  const journals = journalIds.length ? await prisma.journal.findMany({ where: { id: { in: journalIds } }, select: { id: true, journalNumber: true } }) : [];
  const numbers = new Map(journals.map((j) => [j.id, j.journalNumber]));
  return {
    page,
    pageSize,
    total,
    totals: { quantityIn: qty(totals._sum.quantityIn), quantityOut: qty(totals._sum.quantityOut), value: money(totals._sum.value) },
    rows: rows.map((r) => serializeMovement(r, r.journalId ? numbers.get(r.journalId) : null)),
  };
}

export async function reconciliation(companyId: string) {
  const { inventoryAccountIds, saleInventoryAccountId, accounts } = await inventoryConfig(companyId);
  const [balances, glValue, saleGl, saleSubledger, unposted, uncosted, failed, accountRows] = await Promise.all([
    prisma.inventoryBalance.findMany({ where: { companyId }, include: { item: true, location: true } }),
    glBalance(companyId, inventoryAccountIds),
    glBalance(companyId, saleInventoryAccountId ? [saleInventoryAccountId] : [], { sourceModule: { not: "INVENTORY" }, sourceDocumentType: "Sale" }),
    movementValueSum({ companyId, kind: "SALE" }),
    prisma.inventoryMovement.aggregate({ where: { companyId, journalId: null, kind: { not: "SALE" }, NOT: { value: 0 } }, _sum: { value: true }, _count: true }),
    prisma.inventoryMovement.count({ where: { companyId, costSource: "UNCOSTED" } }),
    prisma.integrationEvent.findMany({
      where: { companyId, eventType: { in: [...INVENTORY_EVENT_TYPES] }, status: { in: ["FAILED", "DEAD_LETTER"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, eventType: true, sourceDocumentNumber: true, sourceDocumentId: true, occurredAt: true, status: true, lastError: true },
    }),
    prisma.account.findMany({ where: { companyId, id: { in: inventoryAccountIds } }, select: { id: true, code: true, name: true } }),
  ]);

  const subledgerValue = roundMoney(balances.reduce((s, b) => s + money(b.value), 0));
  const unpostedValue = money(unposted._sum.value);
  const quantityDifferences = balances
    .filter((b) => b.erpQuantity !== null && qty(b.erpQuantity) !== qty(b.quantity))
    .map((b) => ({
      item: b.item.name,
      sku: b.item.sku,
      location: b.location.name,
      erpQuantity: qty(b.erpQuantity),
      erpQuantityAt: b.erpQuantityAt,
      accountingQuantity: qty(b.quantity),
      difference: qty(b.quantity) - qty(b.erpQuantity),
      openingRecorded: b.openingRecorded,
    }))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  const valueWithoutStock = balances
    .filter((b) => qty(b.quantity) === 0 && money(b.value) !== 0)
    .map((b) => ({ item: b.item.name, sku: b.item.sku, location: b.location.name, value: money(b.value) }));
  const negativeStock = balances
    .filter((b) => qty(b.quantity) < 0)
    .map((b) => ({ item: b.item.name, sku: b.item.sku, location: b.location.name, quantity: qty(b.quantity), value: money(b.value) }));

  return {
    accounts: accountRows,
    accountsDiffer: Boolean(saleInventoryAccountId && accounts.inventoryAssetId && saleInventoryAccountId !== accounts.inventoryAssetId),
    glValue,
    subledgerValue,
    difference: roundMoney(glValue - subledgerValue),
    explained: {
      unpostedMovements: { count: unposted._count, value: unpostedValue },
      saleCostDifference: roundMoney(saleGl - saleSubledger),
    },
    quantityDifferences,
    valueWithoutStock,
    negativeStock,
    uncostedMovements: uncosted,
    failedEvents: failed,
  };
}

export async function costOfSalesReport(companyId: string, fromDay?: string, toDay?: string) {
  const now = new Date();
  const from = parseDay(fromDay) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = parseDay(toDay, true) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY - 1);
  if (from > to) throw new Error("The start date is after the end date");

  const rows = await prisma.inventoryMovement.groupBy({
    by: ["itemId", "kind"],
    where: { companyId, kind: { in: ["SALE", "CUSTOMER_RETURN"] }, movementDate: { gte: from, lte: to } },
    _sum: { quantityIn: true, quantityOut: true, value: true },
  });
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const map = new Map<string, { itemId: string; name: string; sku: string | null; category: string | null; quantitySold: number; quantityReturned: number; cost: number; returnedCost: number }>();
  for (const r of rows) {
    const item = byId.get(r.itemId);
    const row = map.get(r.itemId) ?? { itemId: r.itemId, name: item?.name ?? "Unknown item", sku: item?.sku ?? null, category: item?.category ?? null, quantitySold: 0, quantityReturned: 0, cost: 0, returnedCost: 0 };
    if (r.kind === "SALE") {
      row.quantitySold += qty(r._sum.quantityOut);
      row.cost = roundMoney(row.cost + Math.abs(money(r._sum.value)));
    } else {
      row.quantityReturned += qty(r._sum.quantityIn);
      row.returnedCost = roundMoney(row.returnedCost + Math.abs(money(r._sum.value)));
    }
    map.set(r.itemId, row);
  }
  const lines = [...map.values()].map((r) => ({ ...r, netCost: roundMoney(r.cost - r.returnedCost) })).sort((a, b) => b.netCost - a.netCost);
  const netCost = roundMoney(lines.reduce((s, l) => s + l.netCost, 0));

  const current = await movementValueSum({ companyId });
  const openingValue = await valueAt(companyId, new Date(from.getTime() - 1), current);
  const closingValue = await valueAt(companyId, to, current);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    lines,
    totals: {
      quantitySold: lines.reduce((s, l) => s + l.quantitySold, 0),
      cost: roundMoney(lines.reduce((s, l) => s + l.cost, 0)),
      returnedCost: roundMoney(lines.reduce((s, l) => s + l.returnedCost, 0)),
      netCost,
    },
    openingValue,
    closingValue,
    turnover: inventoryTurnover(netCost, openingValue, closingValue),
  };
}

export async function slowMovingReport(companyId: string, slowDays = 90, deadDays = 180) {
  if (!(slowDays > 0) || !(deadDays >= slowDays)) throw new Error("Dead-stock days must be at least the slow-moving days");
  const now = Date.now();
  const balances = await prisma.inventoryBalance.findMany({ where: { companyId, quantity: { gt: 0 } }, include: { item: true, location: true } });
  const lines = balances
    .map((b) => {
      const since = b.lastIssueAt ?? b.createdAt;
      const days = Math.floor((now - since.getTime()) / DAY);
      return {
        itemId: b.itemId,
        name: b.item.name,
        sku: b.item.sku,
        category: b.item.category,
        location: b.location.name,
        quantity: qty(b.quantity),
        value: money(b.value),
        lastSaleAt: b.lastIssueAt,
        trackedSince: b.createdAt,
        daysWithoutSale: days,
        status: days >= deadDays ? ("DEAD" as const) : days >= slowDays ? ("SLOW" as const) : ("ACTIVE" as const),
      };
    })
    .filter((l) => l.status !== "ACTIVE")
    .sort((a, b) => b.daysWithoutSale - a.daysWithoutSale || b.value - a.value);
  const sum = (status: "DEAD" | "SLOW") => {
    const rows = lines.filter((l) => l.status === status);
    return { count: rows.length, value: roundMoney(rows.reduce((s, l) => s + l.value, 0)) };
  };
  return { slowDays, deadDays, lines, slow: sum("SLOW"), dead: sum("DEAD") };
}

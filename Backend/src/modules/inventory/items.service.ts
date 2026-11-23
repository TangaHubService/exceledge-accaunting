/**
 * Products and services (QuickBooks "Products and services" list).
 *
 * The ERP owns stock: INVENTORY items arrive from ERP inventory events (keyed by externalProductId) and their
 * name, SKU, category and unit are kept in step with the ERP. Services and non-stock items are created here.
 * Prices, accounts, tax codes, the preferred supplier and the reorder point are maintained here for every item.
 */
import { roundMoney } from "@exceledge/accounting-domain";
import { type AccountType, type ItemType, Prisma, type TaxType } from "@prisma/client";
import { type Actor, HttpError, notFound } from "../../lib/http";
import { type PageRequest, paginateArray } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

const INCOME_TYPES: AccountType[] = ["INCOME", "OTHER_INCOME"];
const EXPENSE_TYPES: AccountType[] = ["EXPENSE", "COST_OF_SALES", "OTHER_EXPENSE", "ASSET"];
const SALES_TAX_TYPES: TaxType[] = ["OUTPUT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE", "OTHER"];
const PURCHASE_TAX_TYPES: TaxType[] = ["INPUT_VAT", "IMPORT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE", "OTHER"];
const ERP_FIELDS = ["name", "sku", "category", "unit"] as const;

export type ItemInput = {
  name: string;
  type?: ItemType;
  sku?: string | null;
  category?: string | null;
  unit?: string | null;
  isActive?: boolean;
  salesDescription?: string | null;
  salesPrice?: number | null;
  incomeAccountId?: string | null;
  salesTaxCode?: string | null;
  purchaseDescription?: string | null;
  purchaseCost?: number | null;
  expenseAccountId?: string | null;
  purchaseTaxCode?: string | null;
  preferredSupplierId?: string | null;
  reorderPoint?: number | null;
};
export type ItemUpdate = Partial<ItemInput>;

export type ItemListFilter = {
  q?: string;
  type?: ItemType;
  category?: string;
  status?: "active" | "inactive" | "all";
  stock?: "low" | "out";
  source?: "erp" | "app";
  sort?: "name" | "sku" | "type" | "salesPrice" | "purchaseCost" | "quantity" | "updated";
  dir?: "asc" | "desc";
};

const audit = (companyId: string, actor: Actor, action: string, entityId: string, beforeJson?: unknown, afterJson?: unknown) =>
  writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType: "InventoryItem", entityId, beforeJson, afterJson, ...actor.meta });

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));
const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/* ── Validation ─────────────────────────────────────────────────────── */

async function assertAccount(companyId: string, id: string | null | undefined, types: AccountType[], label: string) {
  if (!id) return;
  const account = await prisma.account.findFirst({ where: { id, companyId }, select: { type: true, isActive: true, name: true } });
  if (!account) throw new Error(`The ${label} does not exist`);
  if (!account.isActive) throw new Error(`${account.name} is inactive; choose another ${label}`);
  if (!types.includes(account.type)) throw new Error(`${account.name} can't be used as the ${label}`);
}

async function assertTaxCode(companyId: string, code: string | null | undefined, label: string, types: TaxType[]) {
  if (!code) return;
  const found = await prisma.taxCode.findFirst({ where: { companyId, code, isActive: true }, select: { taxType: true } });
  if (!found) throw new Error(`${label} ${code} is not an active tax code`);
  if (!types.includes(found.taxType)) throw new Error(`${code} can't be used as ${label.toLowerCase()}`);
}

async function assertSupplier(companyId: string, id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.supplier.findFirst({ where: { id, companyId }, select: { id: true } });
  if (!found) throw new Error("The preferred supplier does not exist");
}

/** Name and SKU must be unique (ignoring case), as in QuickBooks. */
export async function findItemDuplicates(companyId: string, input: { name?: string | null; sku?: string | null }, excludeId?: string) {
  const name = clean(input.name);
  const sku = clean(input.sku);
  if (!name && !sku) return [];
  const rows = await prisma.inventoryItem.findMany({
    where: {
      companyId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [...(name ? [{ name: { equals: name, mode: "insensitive" as const } }] : []), ...(sku ? [{ sku: { equals: sku, mode: "insensitive" as const } }] : [])],
    },
    select: { id: true, name: true, sku: true, isActive: true },
    take: 5,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    isActive: r.isActive,
    matched: [
      ...(name && r.name.toLowerCase() === name.toLowerCase() ? ["name"] : []),
      ...(sku && r.sku?.toLowerCase() === sku.toLowerCase() ? ["sku"] : []),
    ],
  }));
}

async function assertNoDuplicate(companyId: string, input: { name?: string | null; sku?: string | null }, excludeId?: string) {
  const dupe = (await findItemDuplicates(companyId, input, excludeId))[0];
  if (!dupe) return;
  const what = dupe.matched.includes("name") ? `name "${dupe.name}"` : `SKU ${dupe.sku}`;
  throw new HttpError(409, `Another item already uses the ${what}${dupe.isActive ? "" : " (it's inactive)"}`);
}

function checkAmounts(input: ItemUpdate) {
  if (input.salesPrice != null && input.salesPrice < 0) throw new Error("Sales price can't be negative");
  if (input.purchaseCost != null && input.purchaseCost < 0) throw new Error("Cost can't be negative");
  if (input.reorderPoint != null && input.reorderPoint < 0) throw new Error("Reorder point can't be negative");
}

async function validate(companyId: string, type: ItemType, input: ItemUpdate) {
  checkAmounts(input);
  await Promise.all([
    assertAccount(companyId, input.incomeAccountId, INCOME_TYPES, "income account"),
    type === "INVENTORY" ? Promise.resolve() : assertAccount(companyId, input.expenseAccountId, EXPENSE_TYPES, "expense account"),
    assertTaxCode(companyId, input.salesTaxCode, "Sales tax", SALES_TAX_TYPES),
    assertTaxCode(companyId, input.purchaseTaxCode, "Purchase tax", PURCHASE_TAX_TYPES),
    assertSupplier(companyId, input.preferredSupplierId),
  ]);
}

function dataOf(input: ItemUpdate) {
  const out: Prisma.InventoryItemUncheckedUpdateInput = {};
  if (input.name !== undefined) out.name = input.name.trim();
  for (const k of ["sku", "category", "unit", "salesDescription", "salesTaxCode", "purchaseDescription", "purchaseTaxCode"] as const) {
    if (input[k] !== undefined) out[k] = clean(input[k]);
  }
  for (const k of ["incomeAccountId", "expenseAccountId", "preferredSupplierId"] as const) {
    if (input[k] !== undefined) out[k] = input[k] || null;
  }
  for (const k of ["salesPrice", "purchaseCost", "reorderPoint"] as const) {
    if (input[k] !== undefined) out[k] = input[k] == null ? null : new Prisma.Decimal(input[k]!);
  }
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/* ── Create / update ────────────────────────────────────────────────── */

export async function createItem(companyId: string, input: ItemInput, actor: Actor) {
  const type = input.type ?? "SERVICE";
  if (type === "INVENTORY") throw new Error("Stock items come from the ERP. Create services and non-stock items here.");
  const name = input.name?.trim();
  if (!name) throw new Error("Name is required");
  await validate(companyId, type, input);
  await assertNoDuplicate(companyId, { name, sku: input.sku });
  const created = await prisma.inventoryItem.create({
    data: { ...(dataOf({ ...input, name, reorderPoint: null }) as Prisma.InventoryItemUncheckedCreateInput), companyId, type, name },
  });
  await audit(companyId, actor, "CREATE", created.id, undefined, { name, type });
  return getItem(companyId, created.id);
}

export async function updateItem(companyId: string, id: string, input: ItemUpdate, actor: Actor) {
  const item = await prisma.inventoryItem.findFirst({ where: { id, companyId } });
  if (!item) throw notFound("Item");
  const fromErp = Boolean(item.externalProductId);

  if (input.type !== undefined && input.type !== item.type) {
    if (input.type === "INVENTORY" || item.type === "INVENTORY") throw new Error("Stock items are managed in the ERP; an item can't be switched to or from a stock item here.");
  }
  if (fromErp) {
    for (const k of ERP_FIELDS) {
      if (input[k] !== undefined && clean(input[k] as string | null) !== clean(item[k])) {
        throw new Error(`${k === "sku" ? "SKU" : k[0].toUpperCase() + k.slice(1)} is managed in the ERP for this item`);
      }
    }
  }
  if (input.name !== undefined && !input.name.trim()) throw new Error("Name is required");
  const type = input.type ?? item.type;
  if (input.reorderPoint != null && type !== "INVENTORY") throw new Error("Only stock items have a reorder point");
  await validate(companyId, type, input);
  const nameChanged = input.name !== undefined && input.name.trim().toLowerCase() !== item.name.toLowerCase();
  const skuChanged = input.sku !== undefined && (clean(input.sku)?.toLowerCase() ?? null) !== (item.sku?.toLowerCase() ?? null);
  if (nameChanged || skuChanged) await assertNoDuplicate(companyId, { name: nameChanged ? input.name : null, sku: skuChanged ? input.sku : null }, id);

  const data = dataOf(input);
  if (input.type !== undefined) data.type = input.type;
  const changed = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => {
      const before = (item as Record<string, unknown>)[k];
      const norm = (x: unknown) => (x instanceof Prisma.Decimal ? Number(x) : x ?? null);
      return norm(before) !== norm(v);
    }),
  );
  if (!Object.keys(changed).length) return getItem(companyId, id);
  await prisma.inventoryItem.update({ where: { id }, data: changed });
  const before = Object.fromEntries(Object.keys(changed).map((k) => [k, (item as Record<string, unknown>)[k]]));
  await audit(companyId, actor, input.isActive === false && Object.keys(changed).length === 1 ? "DEACTIVATE" : "UPDATE", id, before, changed);
  return getItem(companyId, id);
}

export async function bulkSetItemStatus(companyId: string, ids: string[], isActive: boolean, actor: Actor) {
  const items = await prisma.inventoryItem.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, isActive: true } });
  let updated = 0;
  for (const i of items) {
    if (i.isActive === isActive) continue;
    await updateItem(companyId, i.id, { isActive }, actor);
    updated += 1;
  }
  return { updated };
}

/* ── Read ───────────────────────────────────────────────────────────── */

async function quantities(companyId: string, itemIds?: string[]) {
  const rows = await prisma.inventoryBalance.groupBy({
    by: ["itemId"],
    where: { companyId, ...(itemIds ? { itemId: { in: itemIds } } : {}) },
    _sum: { quantity: true, value: true },
  });
  return new Map(rows.map((r) => [r.itemId, { quantity: Number(r._sum.quantity ?? 0), value: Number(r._sum.value ?? 0) }]));
}

function stockStatus(type: ItemType, quantity: number, reorderPoint: number | null) {
  if (type !== "INVENTORY") return null;
  if (quantity <= 0) return "OUT" as const;
  if (reorderPoint != null && quantity <= reorderPoint) return "LOW" as const;
  return "OK" as const;
}

const LIST_SELECT = {
  id: true,
  externalProductId: true,
  type: true,
  name: true,
  sku: true,
  category: true,
  unit: true,
  isActive: true,
  salesDescription: true,
  salesPrice: true,
  salesTaxCode: true,
  purchaseDescription: true,
  purchaseCost: true,
  purchaseTaxCode: true,
  reorderPoint: true,
  updatedAt: true,
  incomeAccount: { select: { id: true, code: true, name: true } },
  expenseAccount: { select: { id: true, code: true, name: true } },
  preferredSupplier: { select: { id: true, name: true } },
} satisfies Prisma.InventoryItemSelect;

type ListRow = Prisma.InventoryItemGetPayload<{ select: typeof LIST_SELECT }>;

function serialize(i: ListRow, q: { quantity: number; value: number } | undefined) {
  const quantity = q?.quantity ?? 0;
  const reorderPoint = num(i.reorderPoint);
  return {
    id: i.id,
    name: i.name,
    sku: i.sku,
    type: i.type,
    category: i.category,
    unit: i.unit,
    isActive: i.isActive,
    source: i.externalProductId ? ("ERP" as const) : ("APP" as const),
    salesDescription: i.salesDescription,
    salesPrice: num(i.salesPrice),
    salesTaxCode: i.salesTaxCode,
    incomeAccount: i.incomeAccount,
    purchaseDescription: i.purchaseDescription,
    purchaseCost: num(i.purchaseCost),
    purchaseTaxCode: i.purchaseTaxCode,
    expenseAccount: i.expenseAccount,
    preferredSupplier: i.preferredSupplier,
    reorderPoint,
    quantity: i.type === "INVENTORY" ? quantity : null,
    value: i.type === "INVENTORY" ? roundMoney(q?.value ?? 0) : null,
    averageCost: i.type === "INVENTORY" && quantity > 0 ? roundMoney((q?.value ?? 0) / quantity) : null,
    stockStatus: stockStatus(i.type, quantity, reorderPoint),
    updatedAt: i.updatedAt,
  };
}
export type ItemRow = ReturnType<typeof serialize>;

function whereOf(companyId: string, f: ItemListFilter): Prisma.InventoryItemWhereInput {
  const q = f.q?.trim();
  return {
    companyId,
    ...(f.type ? { type: f.type } : {}),
    ...(f.stock ? { type: "INVENTORY" } : {}),
    ...(f.category ? { category: f.category === "__none" ? null : f.category } : {}),
    ...(f.status === "all" ? {} : { isActive: f.status !== "inactive" }),
    ...(f.source === "erp" ? { externalProductId: { not: null } } : f.source === "app" ? { externalProductId: null } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { salesDescription: { contains: q, mode: "insensitive" } },
            { purchaseDescription: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Filters and sorts in memory after one indexed query, so stock status (from balances) can filter and sort too. */
async function filteredRows(companyId: string, f: ItemListFilter) {
  const items = await prisma.inventoryItem.findMany({ where: whereOf(companyId, f), select: LIST_SELECT, take: 20000 });
  const qty = await quantities(companyId);
  let rows = items.map((i) => serialize(i, qty.get(i.id)));
  if (f.stock === "low") rows = rows.filter((r) => r.stockStatus === "LOW");
  if (f.stock === "out") rows = rows.filter((r) => r.stockStatus === "OUT");
  const dir = f.dir === "desc" ? -1 : 1;
  const sort = f.sort ?? "name";
  const nullsLast = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * dir);
  rows.sort((a, b) => {
    switch (sort) {
      case "sku":
        return collator.compare(a.sku ?? "￿", b.sku ?? "￿") * dir || collator.compare(a.name, b.name);
      case "type":
        return collator.compare(a.type, b.type) * dir || collator.compare(a.name, b.name);
      case "salesPrice":
        return nullsLast(a.salesPrice, b.salesPrice) || collator.compare(a.name, b.name);
      case "purchaseCost":
        return nullsLast(a.purchaseCost, b.purchaseCost) || collator.compare(a.name, b.name);
      case "quantity":
        return nullsLast(a.quantity, b.quantity) || collator.compare(a.name, b.name);
      case "updated":
        return (a.updatedAt.getTime() - b.updatedAt.getTime()) * dir;
      default:
        return collator.compare(a.name, b.name) * dir;
    }
  });
  return rows;
}

/** Counts for the stock cards and tabs: always across active items, whatever the current filter. */
async function itemCounts(companyId: string) {
  const [byType, inactive, active] = await Promise.all([
    prisma.inventoryItem.groupBy({ by: ["type"], where: { companyId, isActive: true }, _count: { _all: true } }),
    prisma.inventoryItem.count({ where: { companyId, isActive: false } }),
    prisma.inventoryItem.findMany({ where: { companyId, isActive: true, type: "INVENTORY" }, select: { id: true, reorderPoint: true } }),
  ]);
  const qty = await quantities(companyId);
  let low = 0;
  let out = 0;
  for (const i of active) {
    const s = stockStatus("INVENTORY", qty.get(i.id)?.quantity ?? 0, num(i.reorderPoint));
    if (s === "LOW") low += 1;
    if (s === "OUT") out += 1;
  }
  const t = Object.fromEntries(byType.map((r) => [r.type, r._count._all])) as Partial<Record<ItemType, number>>;
  return {
    active: (t.SERVICE ?? 0) + (t.NON_INVENTORY ?? 0) + (t.INVENTORY ?? 0),
    inactive,
    service: t.SERVICE ?? 0,
    nonInventory: t.NON_INVENTORY ?? 0,
    inventory: t.INVENTORY ?? 0,
    lowStock: low,
    outOfStock: out,
  };
}

export async function itemCategories(companyId: string) {
  const rows = await prisma.inventoryItem.groupBy({ by: ["category"], where: { companyId, category: { not: null } }, _count: { _all: true }, orderBy: { category: "asc" } });
  return rows.map((r) => ({ name: r.category!, count: r._count._all }));
}

export async function listItemsPage(companyId: string, filter: ItemListFilter, page: PageRequest) {
  const [rows, counts, categories] = await Promise.all([filteredRows(companyId, filter), itemCounts(companyId), itemCategories(companyId)]);
  return { ...paginateArray(rows, page), counts, categories };
}

/** Active items of every type with their sales and purchasing defaults, for the product picker on transaction lines. */
export async function itemPickerOptions(companyId: string) {
  const rows = await prisma.inventoryItem.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      type: true,
      unit: true,
      salesDescription: true,
      salesPrice: true,
      incomeAccountId: true,
      salesTaxCode: true,
      purchaseDescription: true,
      purchaseCost: true,
      expenseAccountId: true,
      purchaseTaxCode: true,
    },
    orderBy: { name: "asc" },
    take: 5000,
  });
  return rows.map((r) => ({ ...r, salesPrice: num(r.salesPrice), purchaseCost: num(r.purchaseCost) }));
}

export async function getItem(companyId: string, id: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id, companyId },
    select: { ...LIST_SELECT, externalProductId: true, createdAt: true, balances: { select: { quantity: true, value: true, location: { select: { id: true, name: true } } } } },
  });
  if (!item) throw notFound("Item");
  const qty = await quantities(companyId, [id]);
  const lastMovement = await prisma.inventoryMovement.findFirst({ where: { companyId, itemId: id }, orderBy: { movementDate: "desc" }, select: { movementDate: true, kind: true } });
  return {
    ...serialize(item, qty.get(id)),
    externalProductId: item.externalProductId,
    createdAt: item.createdAt,
    locations:
      item.type === "INVENTORY"
        ? item.balances.map((b) => ({ id: b.location.id, name: b.location.name, quantity: Number(b.quantity), value: roundMoney(Number(b.value)) }))
        : [],
    lastMovement,
  };
}

/* ── CSV export / import ────────────────────────────────────────────── */

const TYPE_LABEL: Record<ItemType, string> = { SERVICE: "Service", NON_INVENTORY: "Non-stock", INVENTORY: "Stock" };

function csvCell(value: unknown) {
  const s = value == null ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const acct = (a: { code: string; name: string } | null) => (a ? `${a.code} ${a.name}` : "");

export const ITEM_CSV_COLUMNS: Array<[string, (r: ItemRow) => unknown]> = [
  ["Name", (r) => r.name],
  ["SKU", (r) => r.sku],
  ["Type", (r) => TYPE_LABEL[r.type]],
  ["Category", (r) => r.category],
  ["Unit", (r) => r.unit],
  ["Sales description", (r) => r.salesDescription],
  ["Sales price", (r) => r.salesPrice],
  ["Income account", (r) => acct(r.incomeAccount)],
  ["Sales tax", (r) => r.salesTaxCode],
  ["Purchase description", (r) => r.purchaseDescription],
  ["Cost", (r) => r.purchaseCost],
  ["Expense account", (r) => acct(r.expenseAccount)],
  ["Purchase tax", (r) => r.purchaseTaxCode],
  ["Preferred supplier", (r) => r.preferredSupplier?.name],
  ["Quantity on hand", (r) => r.quantity],
  ["Reorder point", (r) => r.reorderPoint],
  ["Source", (r) => (r.source === "ERP" ? "ERP" : "This app")],
  ["Status", (r) => (r.isActive ? "Active" : "Inactive")],
];

export async function exportItemsCsv(companyId: string, filter: ItemListFilter) {
  const rows = await filteredRows(companyId, filter);
  const lines = [ITEM_CSV_COLUMNS.map(([label]) => csvCell(label)).join(",")];
  for (const r of rows) lines.push(ITEM_CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export type ItemImportRow = {
  name: string;
  type?: string;
  sku?: string;
  category?: string;
  unit?: string;
  salesDescription?: string;
  salesPrice?: number;
  incomeAccount?: string;
  salesTaxCode?: string;
  purchaseDescription?: string;
  purchaseCost?: number;
  expenseAccount?: string;
  purchaseTaxCode?: string;
  preferredSupplier?: string;
};

function typeOf(cell: string | undefined): ItemType | "INVENTORY_REJECTED" | undefined {
  const t = cell?.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!t) return undefined;
  if (["service", "services"].includes(t)) return "SERVICE";
  if (["noninventory", "nonstock", "noninventorypart", "nonstockitem"].includes(t)) return "NON_INVENTORY";
  if (["inventory", "stock", "inventorypart", "stockitem"].includes(t)) return "INVENTORY_REJECTED";
  return undefined;
}

/** Looks an account up by "code name", code, or name. */
function accountResolver(accounts: Array<{ id: string; code: string; name: string; type: AccountType; isActive: boolean }>) {
  return (cell: string | undefined, types: AccountType[]) => {
    const v = cell?.trim();
    if (!v) return { id: null as string | null };
    const lc = v.toLowerCase();
    const code = v.split(/\s+/)[0];
    const match =
      accounts.find((a) => `${a.code} ${a.name}`.toLowerCase() === lc) ??
      accounts.find((a) => a.code === code) ??
      accounts.find((a) => a.name.toLowerCase() === lc);
    if (!match) return { error: `No account matches "${v}"` };
    if (!match.isActive) return { error: `${match.name} is inactive` };
    if (!types.includes(match.type)) return { error: `${match.name} can't be used here` };
    return { id: match.id };
  };
}

/** Creates services and non-stock items row by row; a bad row is reported on its line and the rest still import. */
export async function importItems(
  companyId: string,
  rows: ItemImportRow[],
  options: { dryRun?: boolean },
  actor: Actor,
  runInTransaction: <T>(fn: () => Promise<T>) => Promise<T>,
) {
  const [accounts, suppliers, taxCodes] = await Promise.all([
    prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true, type: true, isActive: true } }),
    prisma.supplier.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.taxCode.findMany({ where: { companyId, isActive: true }, select: { code: true, taxType: true } }),
  ]);
  const account = accountResolver(accounts);
  const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s.id]));
  const codeType = new Map(taxCodes.map((t) => [t.code.toLowerCase(), t.taxType]));
  const seenNames = new Set<string>();
  const seenSkus = new Set<string>();
  const results: Array<{ row: number; name: string; ok: boolean; error?: string; id?: string }> = [];

  for (const [index, row] of rows.entries()) {
    const n = index + 2;
    const name = row.name?.trim() ?? "";
    const sku = clean(row.sku);
    const problems: string[] = [];
    if (!name) problems.push("Name is required");
    const type = typeOf(row.type);
    if (type === "INVENTORY_REJECTED") problems.push("Stock items come from the ERP; import services and non-stock items only");
    else if (row.type?.trim() && !type) problems.push(`Type "${row.type}" isn't Service or Non-stock`);
    if (row.salesPrice != null && row.salesPrice < 0) problems.push("Sales price can't be negative");
    if (row.purchaseCost != null && row.purchaseCost < 0) problems.push("Cost can't be negative");
    const income = account(row.incomeAccount, INCOME_TYPES);
    const expense = account(row.expenseAccount, EXPENSE_TYPES);
    if ("error" in income) problems.push(`Income account: ${income.error}`);
    if ("error" in expense) problems.push(`Expense account: ${expense.error}`);
    for (const [label, code, types] of [["Sales tax", row.salesTaxCode, SALES_TAX_TYPES], ["Purchase tax", row.purchaseTaxCode, PURCHASE_TAX_TYPES]] as const) {
      if (!code?.trim()) continue;
      const t = codeType.get(code.trim().toLowerCase());
      if (!t) problems.push(`${label} ${code} is not an active tax code`);
      else if (!types.includes(t)) problems.push(`${code} can't be used as ${label.toLowerCase()}`);
    }
    let preferredSupplierId: string | null = null;
    if (row.preferredSupplier?.trim()) {
      preferredSupplierId = supplierByName.get(row.preferredSupplier.trim().toLowerCase()) ?? null;
      if (!preferredSupplierId) problems.push(`No supplier named "${row.preferredSupplier}"`);
    }
    if (name && seenNames.has(name.toLowerCase())) problems.push("Same name appears earlier in the file");
    if (sku && seenSkus.has(sku.toLowerCase())) problems.push("Same SKU appears earlier in the file");
    if (!problems.length) {
      const dupe = (await findItemDuplicates(companyId, { name, sku }))[0];
      if (dupe) problems.push(dupe.matched.includes("name") ? `An item named "${dupe.name}" already exists` : `SKU ${dupe.sku} is already used by ${dupe.name}`);
    }
    if (name) seenNames.add(name.toLowerCase());
    if (sku) seenSkus.add(sku.toLowerCase());
    if (problems.length) {
      results.push({ row: n, name, ok: false, error: problems.join("; ") });
      continue;
    }
    if (options.dryRun) {
      results.push({ row: n, name, ok: true });
      continue;
    }
    const input: ItemInput = {
      name,
      type: (type as ItemType | undefined) ?? "SERVICE",
      sku,
      category: row.category,
      unit: row.unit,
      salesDescription: row.salesDescription,
      salesPrice: row.salesPrice ?? null,
      incomeAccountId: (income as { id: string | null }).id,
      salesTaxCode: clean(row.salesTaxCode),
      purchaseDescription: row.purchaseDescription,
      purchaseCost: row.purchaseCost ?? null,
      expenseAccountId: (expense as { id: string | null }).id,
      purchaseTaxCode: clean(row.purchaseTaxCode),
      preferredSupplierId,
    };
    try {
      const created = await runInTransaction(() => createItem(companyId, input, actor));
      results.push({ row: n, name, ok: true, id: created.id });
    } catch (e) {
      results.push({ row: n, name, ok: false, error: (e as Error).message });
    }
  }
  return {
    dryRun: Boolean(options.dryRun),
    total: rows.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

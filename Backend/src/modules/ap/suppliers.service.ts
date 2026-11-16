/**
 * Supplier centre reads and bulk work: the paged supplier list with its money bar, duplicate checks,
 * notes, bulk status changes, and CSV import/export.
 *
 * Every money figure is read from the AP subledger (supplier.balance) or summed from posted documents.
 * The frontend only displays them.
 */
import { roundMoney } from "@exceledge/accounting-domain";
import { Prisma, type ApPaymentMethod, type SupplierType } from "@prisma/client";
import { money } from "../../lib/documents";
import { paginateArray, type PageRequest, pageResult } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { createSupplier, updateSupplier } from "./ap.service";

type Actor = Parameters<typeof updateSupplier>[3];

export type SupplierListFilter = {
  q?: string;
  status?: "active" | "inactive" | "all";
  balance?: "owing" | "overdue" | "credit";
  category?: string;
  type?: SupplierType;
  sort?: "name" | "code" | "balance" | "purchases" | "lastActivity" | "created";
  dir?: "asc" | "desc";
};

/** Open purchase orders: not yet fully billed, so still a commitment to pay. */
const OPEN_PO_STATUSES = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED"] as const;

/** Bills created from a supplier's opening balance are not purchases made in these books. */
const NOT_OPENING: Prisma.ApBillWhereInput = { OR: [{ sourceDocumentType: null }, { sourceDocumentType: { not: "SupplierOpening" } }] };

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function searchWhere(companyId: string, q?: string): Promise<Prisma.SupplierWhereInput> {
  const term = q?.trim();
  if (!term) return {};
  const like = { contains: term, mode: "insensitive" as const };
  // Phone numbers are saved with and without spaces or dashes; compare digits only.
  const digits = term.replace(/\D/g, "");
  const phoneIds =
    digits.length >= 4
      ? (
          await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM suppliers
            WHERE "companyId" = ${companyId}
              AND (regexp_replace(coalesce(telephone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}
                OR regexp_replace(coalesce(mobile, ''), '\\D', '', 'g') LIKE ${`%${digits}%`})
            LIMIT 500`
        ).map((r) => r.id)
      : [];
  return {
    OR: [
      { name: like },
      { companyName: like },
      { code: like },
      { tin: like },
      { email: like },
      { contactPerson: like },
      { telephone: like },
      { mobile: like },
      ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
    ],
  };
}

/** Overdue amount per supplier: posted bills past their due date, less what was paid or credited on them. */
async function overdueBySupplier(companyId: string, supplierIds?: string[]) {
  const groups = await prisma.apBill.groupBy({
    by: ["supplierId"],
    where: { companyId, status: "POSTED", dueDate: { lt: startOfTodayUtc() }, ...(supplierIds ? { supplierId: { in: supplierIds } } : {}) },
    _sum: { gross: true, amountPaid: true, amountCredited: true },
  });
  const out = new Map<string, number>();
  for (const g of groups) {
    const open = roundMoney(money(g._sum.gross ?? 0) - money(g._sum.amountPaid ?? 0) - money(g._sum.amountCredited ?? 0));
    if (open > 0.005) out.set(g.supplierId, open);
  }
  return out;
}

export type SupplierStats = { purchases: number; lastActivity: Date | null };

/**
 * Purchases and last activity per supplier.
 * Purchases = posted bills and debit notes (not opening balances) + posted expenses for the supplier − posted supplier credits.
 * Expenses on account never create a bill, so nothing is counted twice. Voided bills and reversed expenses drop out.
 */
export async function supplierStats(companyId: string, supplierIds?: string[]) {
  const ids = supplierIds ? { supplierId: { in: supplierIds } } : {};
  const [bills, expenses, credits, ledger, orders] = await Promise.all([
    prisma.apBill.groupBy({ by: ["supplierId"], where: { companyId, status: "POSTED", ...NOT_OPENING, ...ids }, _sum: { gross: true } }),
    prisma.expense.groupBy({
      by: ["supplierId"],
      where: { companyId, status: "POSTED", ...(supplierIds ? { supplierId: { in: supplierIds } } : { supplierId: { not: null } }) },
      _sum: { grossAmount: true },
      _max: { expenseDate: true },
    }),
    prisma.apCreditNote.groupBy({ by: ["supplierId"], where: { companyId, status: "POSTED", ...ids }, _sum: { gross: true } }),
    prisma.apLedgerEntry.groupBy({ by: ["supplierId"], where: { companyId, ...ids }, _max: { entryDate: true } }),
    prisma.commercialDocument.groupBy({
      by: ["supplierId"],
      where: { companyId, kind: "PURCHASE_ORDER", status: { not: "VOID" }, ...(supplierIds ? { supplierId: { in: supplierIds } } : { supplierId: { not: null } }) },
      _max: { docDate: true },
    }),
  ]);
  const out = new Map<string, SupplierStats>();
  const row = (id: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { purchases: 0, lastActivity: null }));
    return r;
  };
  const later = (r: SupplierStats, d: Date | null | undefined) => {
    if (d && (!r.lastActivity || d > r.lastActivity)) r.lastActivity = d;
  };
  for (const b of bills) row(b.supplierId).purchases += money(b._sum.gross ?? 0);
  for (const c of credits) row(c.supplierId).purchases -= money(c._sum.gross ?? 0);
  for (const e of expenses) {
    if (!e.supplierId) continue;
    const r = row(e.supplierId);
    r.purchases += money(e._sum.grossAmount ?? 0);
    later(r, e._max.expenseDate);
  }
  for (const l of ledger) later(row(l.supplierId), l._max.entryDate);
  for (const o of orders) if (o.supplierId) later(row(o.supplierId), o._max.docDate);
  for (const r of out.values()) r.purchases = roundMoney(r.purchases);
  return out;
}

/**
 * The payables money bar (as in QuickBooks Vendors): open purchase orders, unpaid bills split into overdue
 * and not yet due, and payments made in the last 30 days. Company-wide, or one supplier when `supplierId` is given.
 */
export async function apMoneyBar(companyId: string, supplierId?: string) {
  const today = startOfTodayUtc();
  const since = new Date(today.getTime() - 30 * 86_400_000);
  const scope = { companyId, ...(supplierId ? { supplierId } : {}) };
  const openBills = (overdueOnly: boolean) => prisma.$queryRaw<Array<{ amount: Prisma.Decimal | null; n: bigint }>>`
    SELECT coalesce(sum(gross - "amountPaid" - "amountCredited"), 0) AS amount, count(*)::bigint AS n FROM ap_bills
    WHERE "companyId" = ${companyId} AND status = 'POSTED'
      AND gross - "amountPaid" - "amountCredited" > 0.005
      ${overdueOnly ? Prisma.sql`AND "dueDate" < ${today}` : Prisma.empty}
      ${supplierId ? Prisma.sql`AND "supplierId" = ${supplierId}` : Prisma.empty}`;
  const [open, overdue, paid, orders] = await Promise.all([
    openBills(false),
    openBills(true),
    prisma.apPayment.aggregate({ where: { ...scope, status: "POSTED", paymentDate: { gte: since } }, _sum: { amount: true }, _count: true }),
    prisma.commercialDocument.aggregate({ where: { ...scope, kind: "PURCHASE_ORDER", status: { in: [...OPEN_PO_STATUSES] } }, _sum: { total: true }, _count: true }),
  ]);
  const openAmount = money(open[0]?.amount ?? 0);
  const overdueAmount = money(overdue[0]?.amount ?? 0);
  const openN = Number(open[0]?.n ?? 0);
  const overdueN = Number(overdue[0]?.n ?? 0);
  return {
    purchaseOrders: { amount: money(orders._sum.total ?? 0), count: orders._count },
    overdue: { amount: overdueAmount, count: overdueN },
    notDue: { amount: roundMoney(openAmount - overdueAmount), count: openN - overdueN },
    paid30: { amount: money(paid._sum.amount ?? 0), count: paid._count },
  };
}

/** Categories in use in the company, for the list filter. */
export async function supplierCategories(companyId: string) {
  const rows = await prisma.supplier.groupBy({ by: ["category"], where: { companyId, category: { not: null } }, _count: true, orderBy: { category: "asc" } });
  return rows.filter((r) => r.category).map((r) => ({ category: r.category!, count: r._count }));
}

type SupplierRow = Awaited<ReturnType<typeof prisma.supplier.findMany>>[number];

function serializeRow(s: SupplierRow, overdue: Map<string, number>, stats: Map<string, SupplierStats>) {
  const st = stats.get(s.id);
  return {
    ...s,
    balance: money(s.balance),
    openingBalance: money(s.openingBalance),
    creditLimit: money(s.creditLimit),
    whtRate: money(s.whtRate),
    overdue: overdue.get(s.id) ?? 0,
    purchases: st?.purchases ?? 0,
    lastActivity: st?.lastActivity ?? null,
  };
}

export async function listSuppliersPage(companyId: string, filter: SupplierListFilter, page: PageRequest): Promise<ReturnType<typeof buildPage>> {
  const statusWhere: Prisma.SupplierWhereInput =
    filter.status === "inactive" ? { status: "INACTIVE" } : filter.status === "all" ? {} : { status: "ACTIVE" };
  const base: Prisma.SupplierWhereInput = {
    companyId,
    ...(await searchWhere(companyId, filter.q)),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.type ? { supplierType: filter.type } : {}),
  };
  const scoped: Prisma.SupplierWhereInput = { ...base, ...statusWhere };

  const overdueMap = await overdueBySupplier(companyId);
  const balanceWhere: Record<NonNullable<SupplierListFilter["balance"]>, Prisma.SupplierWhereInput> = {
    owing: { balance: { gt: 0.005 } },
    overdue: { id: { in: [...overdueMap.keys()] } },
    credit: { balance: { lt: -0.005 } },
  };
  const where: Prisma.SupplierWhereInput = filter.balance ? { AND: [scoped, balanceWhere[filter.balance]] } : scoped;
  const dir = filter.dir === "desc" ? "desc" : "asc";

  let rows: ReturnType<typeof serializeRow>[];
  let total: number;
  if (filter.sort === "purchases" || filter.sort === "lastActivity") {
    // Computed figures: sort the whole filtered set in memory, then page it. Fine for thousands of suppliers.
    const all = await prisma.supplier.findMany({ where });
    const stats = await supplierStats(companyId, all.map((s) => s.id));
    const sign = dir === "desc" ? -1 : 1;
    const key = (s: SupplierRow) => {
      const st = stats.get(s.id);
      return filter.sort === "purchases" ? (st?.purchases ?? 0) : (st?.lastActivity?.getTime() ?? 0);
    };
    all.sort((a, b) => sign * (key(a) - key(b)) || a.name.localeCompare(b.name));
    const paged = paginateArray(all, page);
    rows = paged.rows.map((s) => serializeRow(s, overdueMap, stats));
    total = all.length;
    page = { ...page, page: paged.page };
  } else {
    const orderBy: Prisma.SupplierOrderByWithRelationInput[] =
      filter.sort === "balance"
        ? [{ balance: dir }, { name: "asc" }]
        : filter.sort === "code"
          ? [{ code: dir }]
          : filter.sort === "created"
            ? [{ createdAt: dir }]
            : [{ name: dir }];
    const [found, count] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
      prisma.supplier.count({ where }),
    ]);
    // A page past the end (e.g. after a bulk change) answers with the last page.
    const lastPage = Math.max(1, Math.ceil(count / page.pageSize));
    if (page.page > lastPage && count > 0) return listSuppliersPage(companyId, filter, { ...page, page: lastPage });
    const stats = await supplierStats(companyId, found.map((s) => s.id));
    rows = found.map((s) => serializeRow(s, overdueMap, stats));
    total = count;
  }
  return buildPage(companyId, rows, total, page, base, scoped, balanceWhere, where);
}

async function buildPage(
  companyId: string,
  rows: Array<ReturnType<typeof serializeRow>>,
  total: number,
  page: PageRequest,
  base: Prisma.SupplierWhereInput,
  scoped: Prisma.SupplierWhereInput,
  balanceWhere: Record<"owing" | "overdue" | "credit", Prisma.SupplierWhereInput>,
  where: Prisma.SupplierWhereInput,
) {
  const [all, inactive, owing, overdue, credit, owed, bar, categories] = await Promise.all([
    prisma.supplier.count({ where: scoped }),
    prisma.supplier.count({ where: { ...base, status: "INACTIVE" } }),
    prisma.supplier.count({ where: { AND: [scoped, balanceWhere.owing] } }),
    prisma.supplier.count({ where: { AND: [scoped, balanceWhere.overdue] } }),
    prisma.supplier.count({ where: { AND: [scoped, balanceWhere.credit] } }),
    prisma.supplier.aggregate({ where: { AND: [where, { balance: { gt: 0 } }] }, _sum: { balance: true } }),
    apMoneyBar(companyId),
    supplierCategories(companyId),
  ]);
  return {
    ...pageResult(rows, total, page),
    counts: { all, inactive, owing, overdue, credit },
    totals: { owed: roundMoney(money(owed._sum.balance ?? 0)) },
    moneyBar: bar,
    categories,
  };
}

/** Likely duplicates of a supplier being entered. Name and TIN block saving; email and phone only warn. */
export async function findSupplierDuplicates(
  companyId: string,
  input: { name?: string; tin?: string; email?: string; phone?: string; exceptId?: string },
) {
  const or: Prisma.SupplierWhereInput[] = [];
  const name = input.name?.trim();
  const tin = input.tin?.trim();
  const email = input.email?.trim().toLowerCase();
  if (name && name.length >= 2) or.push({ name: { equals: name, mode: "insensitive" } });
  if (tin) or.push({ tin });
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });
  const phone = input.phone?.replace(/\D/g, "");
  if (phone && phone.length >= 6) or.push({ telephone: { contains: phone.slice(-9) } }, { mobile: { contains: phone.slice(-9) } });
  if (!or.length) return [];
  const hits = await prisma.supplier.findMany({
    where: { companyId, OR: or, ...(input.exceptId ? { NOT: { id: input.exceptId } } : {}) },
    take: 5,
    select: { id: true, code: true, name: true, tin: true, email: true, telephone: true, mobile: true, status: true },
  });
  return hits.map((h) => {
    const matched: string[] = [];
    if (name && h.name.toLowerCase() === name.toLowerCase()) matched.push("name");
    if (tin && h.tin === tin) matched.push("tin");
    if (email && h.email?.toLowerCase() === email) matched.push("email");
    if (phone && phone.length >= 6 && [h.telephone, h.mobile].some((p) => p?.replace(/\D/g, "").endsWith(phone.slice(-9)))) matched.push("phone");
    return { ...h, matched, blocking: matched.includes("name") || matched.includes("tin") };
  });
}

/* ── Notes ─────────────────────────────────────────────── */

async function loadSupplier(companyId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!supplier) throw new Error("Supplier does not exist");
  return supplier;
}

export async function listSupplierNotes(companyId: string, supplierId: string) {
  await loadSupplier(companyId, supplierId);
  return prisma.supplierNote.findMany({ where: { companyId, supplierId }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function addSupplierNote(companyId: string, supplierId: string, body: string, author: { erpUserId: number; name?: string }) {
  await loadSupplier(companyId, supplierId);
  const text = body.trim();
  if (!text) throw new Error("Write something in the note");
  return prisma.supplierNote.create({ data: { companyId, supplierId, body: text.slice(0, 4000), erpUserId: author.erpUserId, authorName: author.name } });
}

/* ── Bulk, export, import ─────────────────────────────── */

export async function bulkSetStatus(companyId: string, ids: string[], status: "ACTIVE" | "INACTIVE", actor: Actor) {
  const done: string[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  const suppliers = await prisma.supplier.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, status: true } });
  for (const s of suppliers) {
    if (s.status === status) continue;
    try {
      await updateSupplier(companyId, s.id, { status }, actor);
      done.push(s.id);
    } catch (e) {
      skipped.push({ id: s.id, name: s.name, reason: (e as Error).message });
    }
  }
  return { updated: done.length, skipped };
}

function csvCell(value: unknown) {
  const s = value == null ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  // Leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const SUPPLIER_CSV_COLUMNS = [
  ["code", "Code"],
  ["name", "Display name"],
  ["companyName", "Company"],
  ["supplierType", "Type"],
  ["category", "Category"],
  ["contactPerson", "Contact person"],
  ["email", "Email"],
  ["telephone", "Phone"],
  ["mobile", "Mobile"],
  ["website", "Website"],
  ["tin", "TIN"],
  ["vatRegistered", "VAT registered"],
  ["physicalAddress", "Street address"],
  ["district", "District"],
  ["province", "Province"],
  ["country", "Country"],
  ["creditPeriodDays", "Terms (days)"],
  ["preferredPaymentMethod", "Payment method"],
  ["bankName", "Bank"],
  ["bankAccountHolder", "Account holder"],
  ["bankAccountNumber", "Account number"],
  ["currency", "Currency"],
  ["status", "Status"],
  ["purchases", "Total purchases"],
  ["balance", "Open balance"],
  ["overdue", "Overdue"],
  ["lastActivity", "Last transaction"],
  ["notes", "Notes"],
] as const;

export async function exportSuppliersCsv(companyId: string, filter: SupplierListFilter) {
  const pageSize = 2000;
  const lines = [SUPPLIER_CSV_COLUMNS.map(([, label]) => csvCell(label)).join(",")];
  for (let page = 1; ; page += 1) {
    const chunk = await listSuppliersPage(companyId, filter, { page, pageSize });
    for (const s of chunk.rows) lines.push(SUPPLIER_CSV_COLUMNS.map(([key]) => csvCell((s as Record<string, unknown>)[key])).join(","));
    if (page >= chunk.pageCount) break;
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export type SupplierImportRow = {
  name: string;
  companyName?: string;
  supplierType?: SupplierType;
  category?: string;
  contactPerson?: string;
  email?: string;
  telephone?: string;
  mobile?: string;
  website?: string;
  tin?: string;
  vatRegistered?: boolean;
  physicalAddress?: string;
  district?: string;
  province?: string;
  country?: string;
  creditPeriodDays?: number;
  preferredPaymentMethod?: ApPaymentMethod;
  bankName?: string;
  bankAccountHolder?: string;
  bankAccountNumber?: string;
  openingBalance?: number;
  openingBalanceDate?: string;
  notes?: string;
};

/**
 * Creates suppliers one row at a time, each in its own transaction, so one bad row doesn't stop the rest.
 * `dryRun` validates (required name, TIN format, duplicates in the file and in the books) without saving.
 */
export async function importSuppliers(
  companyId: string,
  rows: SupplierImportRow[],
  options: { dryRun?: boolean },
  actor: Actor,
  runInTransaction: <T>(fn: () => Promise<T>) => Promise<T>,
) {
  const results: Array<{ row: number; name: string; ok: boolean; error?: string; code?: string; id?: string }> = [];
  const seenNames = new Set<string>();
  const seenTins = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const n = index + 2; // header is row 1
    const name = row.name?.trim() ?? "";
    const problems: string[] = [];
    if (!name) problems.push("Display name is required");
    if (row.tin && !/^\d{9}$/.test(row.tin)) problems.push("TIN must be 9 digits");
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) problems.push("Email is not valid");
    if (row.openingBalance !== undefined && row.openingBalance < 0) problems.push("Opening balance can't be negative");
    if (name && seenNames.has(name.toLowerCase())) problems.push("Same name appears earlier in the file");
    if (row.tin && seenTins.has(row.tin)) problems.push("Same TIN appears earlier in the file");
    if (!problems.length) {
      const dupes = await findSupplierDuplicates(companyId, { name, tin: row.tin });
      const blocking = dupes.find((d) => d.blocking);
      if (blocking) problems.push(`${blocking.matched.includes("tin") ? "TIN" : "Name"} already used by ${blocking.name} (${blocking.code})`);
    }
    if (name) seenNames.add(name.toLowerCase());
    if (row.tin) seenTins.add(row.tin);
    if (problems.length) {
      results.push({ row: n, name, ok: false, error: problems.join("; ") });
      continue;
    }
    if (options.dryRun) {
      results.push({ row: n, name, ok: true });
      continue;
    }
    try {
      const created = await runInTransaction(() => createSupplier(companyId, { ...row, name }, actor));
      results.push({ row: n, name, ok: true, code: created.code, id: created.id });
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

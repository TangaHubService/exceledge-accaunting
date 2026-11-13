/**
 * Customer centre reads: the paged list, a customer's account summary, the unified transaction list,
 * notes and activity, CSV import/export and bulk status changes.
 *
 * Every money figure here is read from the AR subledger (customer.balance, ArLedgerEntry) or summed from
 * posted documents. The frontend only displays them.
 */
import { roundMoney } from "@exceledge/accounting-domain";
import { Prisma, type ArPaymentMethod, type CustomerType } from "@prisma/client";
import { money } from "../../lib/documents";
import { paginateArray, type PageRequest, pageResult } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createCustomer, updateCustomer } from "./ar.service";

type Actor = Parameters<typeof updateCustomer>[3];

export type CustomerListFilter = {
  q?: string;
  status?: "active" | "inactive" | "all";
  balance?: "owing" | "overdue" | "over-limit" | "credit";
  type?: CustomerType;
  tag?: string;
  sort?: "name" | "code" | "balance" | "created";
  dir?: "asc" | "desc";
};

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function searchWhere(companyId: string, q?: string): Promise<Prisma.CustomerWhereInput> {
  const term = q?.trim();
  if (!term) return {};
  const like = { contains: term, mode: "insensitive" as const };
  // Phone numbers are saved with and without spaces or dashes; compare digits only.
  const digits = term.replace(/\D/g, "");
  const phoneIds =
    digits.length >= 4
      ? (
          await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM customers
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

/** Overdue amount per customer: posted invoices past their due date, less what was paid or credited on them. */
async function overdueByCustomer(companyId: string, customerIds?: string[]) {
  const groups = await prisma.arInvoice.groupBy({
    by: ["customerId"],
    where: { companyId, status: "POSTED", dueDate: { lt: startOfTodayUtc() }, ...(customerIds ? { customerId: { in: customerIds } } : {}) },
    _sum: { gross: true, amountPaid: true, amountCredited: true },
  });
  const out = new Map<string, number>();
  for (const g of groups) {
    const open = roundMoney(money(g._sum.gross ?? 0) - money(g._sum.amountPaid ?? 0) - money(g._sum.amountCredited ?? 0));
    if (open > 0.005) out.set(g.customerId, open);
  }
  return out;
}

/**
 * The receivables money bar (as in QuickBooks): open invoices split into overdue and not yet due,
 * plus payments received in the last 30 days. Company-wide, or one customer when `customerId` is given.
 */
export async function moneyBar(companyId: string, customerId?: string) {
  const today = startOfTodayUtc();
  const since = new Date(today.getTime() - 30 * 86_400_000);
  const scope = { companyId, ...(customerId ? { customerId } : {}) };
  const [open, overdue, paid, overdueCount, openCount, unbilled] = await Promise.all([
    prisma.arInvoice.aggregate({ where: { ...scope, status: "POSTED" }, _sum: { gross: true, amountPaid: true, amountCredited: true } }),
    prisma.arInvoice.aggregate({ where: { ...scope, status: "POSTED", dueDate: { lt: today } }, _sum: { gross: true, amountPaid: true, amountCredited: true } }),
    prisma.arReceipt.aggregate({ where: { ...scope, status: "POSTED", receiptDate: { gte: since } }, _sum: { amount: true }, _count: true }),
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ar_invoices
      WHERE "companyId" = ${companyId} AND status = 'POSTED' AND "dueDate" < ${today}
        AND gross - "amountPaid" - "amountCredited" > 0.005
        ${customerId ? Prisma.sql`AND "customerId" = ${customerId}` : Prisma.empty}`,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ar_invoices
      WHERE "companyId" = ${companyId} AND status = 'POSTED'
        AND gross - "amountPaid" - "amountCredited" > 0.005
        ${customerId ? Prisma.sql`AND "customerId" = ${customerId}` : Prisma.empty}`,
    // Delayed charges are work done but not invoiced yet (QuickBooks "Unbilled").
    prisma.commercialDocument.aggregate({ where: { ...scope, kind: "DELAYED_CHARGE", status: "OPEN" }, _sum: { total: true }, _count: true }),
  ]);
  const net = (a: typeof open) => roundMoney(money(a._sum.gross ?? 0) - money(a._sum.amountPaid ?? 0) - money(a._sum.amountCredited ?? 0));
  const openTotal = net(open);
  const overdueTotal = net(overdue);
  const overdueN = Number(overdueCount[0]?.n ?? 0);
  return {
    overdue: { amount: overdueTotal, count: overdueN },
    notDue: { amount: roundMoney(openTotal - overdueTotal), count: Number(openCount[0]?.n ?? 0) - overdueN },
    paid30: { amount: money(paid._sum.amount ?? 0), count: paid._count },
    unbilled: { amount: money(unbilled._sum.total ?? 0), count: unbilled._count },
  };
}

export async function listCustomersPage(companyId: string, filter: CustomerListFilter, page: PageRequest) {
  const statusWhere: Prisma.CustomerWhereInput =
    filter.status === "inactive" ? { status: "INACTIVE" } : filter.status === "all" ? {} : { status: "ACTIVE" };
  const base: Prisma.CustomerWhereInput = {
    companyId,
    ...(await searchWhere(companyId, filter.q)),
    ...(filter.type ? { customerType: filter.type } : {}),
    ...(filter.tag ? { tags: { has: filter.tag } } : {}),
  };
  const scoped: Prisma.CustomerWhereInput = { ...base, ...statusWhere };

  const overdueMap = await overdueByCustomer(companyId);
  const overdueIds = [...overdueMap.keys()];
  const balanceWhere: Record<NonNullable<CustomerListFilter["balance"]>, Prisma.CustomerWhereInput> = {
    owing: { balance: { gt: 0.005 } },
    overdue: { id: { in: overdueIds } },
    "over-limit": { creditLimit: { gt: 0 }, balance: { gt: prisma.customer.fields.creditLimit } },
    credit: { balance: { lt: -0.005 } },
  };
  const where: Prisma.CustomerWhereInput = filter.balance ? { AND: [scoped, balanceWhere[filter.balance]] } : scoped;

  const dir = filter.dir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    filter.sort === "balance"
      ? [{ balance: dir }, { name: "asc" }]
      : filter.sort === "code"
        ? [{ code: dir }]
        : filter.sort === "created"
          ? [{ createdAt: dir }]
          : [{ name: dir }];

  const [rows, total, all, inactive, owing, overdue, overLimit, credit, totalOwed, bar] = await Promise.all([
    prisma.customer.findMany({ where, orderBy, skip: (page.page - 1) * page.pageSize, take: page.pageSize, include: { parent: { select: { id: true, name: true } }, _count: { select: { children: true } } } }),
    prisma.customer.count({ where }),
    prisma.customer.count({ where: scoped }),
    prisma.customer.count({ where: { ...base, status: "INACTIVE" } }),
    prisma.customer.count({ where: { AND: [scoped, balanceWhere.owing] } }),
    prisma.customer.count({ where: { AND: [scoped, balanceWhere.overdue] } }),
    prisma.customer.count({ where: { AND: [scoped, balanceWhere["over-limit"]] } }),
    prisma.customer.count({ where: { AND: [scoped, balanceWhere.credit] } }),
    prisma.customer.aggregate({ where: { AND: [where, { balance: { gt: 0 } }] }, _sum: { balance: true } }),
    moneyBar(companyId),
  ]);

  const result = pageResult(
    rows.map(({ _count, ...c }) => ({ ...c, subCustomerCount: _count.children, balance: money(c.balance), creditLimit: money(c.creditLimit), openingBalance: money(c.openingBalance), overdue: overdueMap.get(c.id) ?? 0 })),
    total,
    page,
  );
  // A page past the end (e.g. after a bulk change) answers with the last page.
  if (result.page > result.pageCount && total > 0) return listCustomersPage(companyId, filter, { ...page, page: result.pageCount });
  return {
    ...result,
    counts: { all, inactive, owing, overdue, overLimit, credit },
    totals: { owed: roundMoney(money(totalOwed._sum.balance ?? 0)) },
    moneyBar: bar,
    tags: await companyTags(companyId),
  };
}

/** Every tag in use in the company, for the filter. */
export async function companyTags(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ tag: string; n: bigint }>>`
    SELECT t AS tag, count(*)::bigint AS n FROM customers, unnest(tags) AS t
    WHERE "companyId" = ${companyId} GROUP BY t ORDER BY lower(t)`;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
}

/** The customer with its parent, sub-customers and extra contacts, for the profile. */
export async function customerProfile(companyId: string, customerId: string) {
  const c = await prisma.customer.findFirst({
    where: { id: customerId, companyId },
    include: {
      parent: { select: { id: true, name: true, code: true } },
      children: { select: { id: true, name: true, code: true, balance: true, status: true }, orderBy: { name: "asc" } },
      contacts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) throw new Error("Customer does not exist");
  return {
    ...c,
    children: c.children.map((k) => ({ ...k, balance: money(k.balance) })),
    /** This customer plus every sub-customer below it. */
    balanceWithSubCustomers: roundMoney(money(c.balance) + (await descendantBalance(companyId, c.id))),
  };
}

async function descendantBalance(companyId: string, customerId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    WITH RECURSIVE tree AS (
      SELECT id FROM customers WHERE "parentId" = ${customerId} AND "companyId" = ${companyId}
      UNION
      SELECT c.id FROM customers c JOIN tree t ON c."parentId" = t.id WHERE c."companyId" = ${companyId}
    )
    SELECT sum(balance) AS total FROM customers WHERE id IN (SELECT id FROM tree)`;
  return money(rows[0]?.total ?? 0);
}

/* ── Contacts ─────────────────────────────────────────── */

export async function addContact(companyId: string, customerId: string, input: { name: string; role?: string | null; email?: string | null; phone?: string | null }) {
  await loadCustomer(companyId, customerId);
  if ((await prisma.customerContact.count({ where: { companyId, customerId } })) >= 20) throw new Error("A customer can have at most 20 extra contacts");
  return prisma.customerContact.create({
    data: { companyId, customerId, name: input.name.trim(), role: input.role?.trim() || null, email: input.email?.trim().toLowerCase() || null, phone: input.phone?.trim() || null },
  });
}

export async function removeContact(companyId: string, customerId: string, contactId: string) {
  const gone = await prisma.customerContact.deleteMany({ where: { id: contactId, companyId, customerId } });
  if (!gone.count) throw new Error("Contact does not exist");
  return { removed: contactId };
}

/* ── Merge ────────────────────────────────────────────── */

/**
 * Merges `sourceId` into `targetId` (QuickBooks: rename one customer to the other's name). Every document,
 * ledger entry, journal line reference, note, contact, attachment and sub-customer moves to the target, the
 * target's ledger running balances are rebuilt in posting order, and the source is deleted. Nothing is reposted:
 * the GL already holds the same amounts against the same receivables account.
 */
export async function mergeCustomers(companyId: string, sourceId: string, targetId: string, actor: Actor) {
  if (sourceId === targetId) throw new Error("Choose a different customer to merge into");
  const [source, target] = await Promise.all([loadCustomer(companyId, sourceId), loadCustomer(companyId, targetId)]);
  if (source.currency !== target.currency) throw new Error(`${source.name} is in ${source.currency} and ${target.name} is in ${target.currency}; only customers in the same currency can be merged`);
  if ((source.arAccountId ?? null) !== (target.arAccountId ?? null)) throw new Error("The two customers post to different receivables accounts; align them before merging");
  if (source.externalErpCustomerId && target.externalErpCustomerId) throw new Error("Both customers are linked to Excel Edge ERP customers; merge them in the ERP first");
  let cursor: string | null = target.parentId;
  while (cursor) {
    if (cursor === source.id) throw new Error(`${target.name} is a sub-customer of ${source.name}; merge the other way round`);
    cursor = (await prisma.customer.findFirst({ where: { id: cursor, companyId }, select: { parentId: true } }))?.parentId ?? null;
  }

  const move = { customerId: target.id };
  const where = { companyId, customerId: source.id };
  const moved = {
    invoices: (await prisma.arInvoice.updateMany({ where, data: move })).count,
    payments: (await prisma.arReceipt.updateMany({ where, data: move })).count,
    creditNotes: (await prisma.arCreditNote.updateMany({ where, data: move })).count,
    debitNotes: (await prisma.arDebitNote.updateMany({ where, data: move })).count,
    deposits: (await prisma.arDeposit.updateMany({ where, data: move })).count,
    documents: (await prisma.commercialDocument.updateMany({ where, data: move })).count,
  };
  await prisma.arLedgerEntry.updateMany({ where, data: move });
  await prisma.project.updateMany({ where, data: move });
  await prisma.timeActivity.updateMany({ where, data: move });
  await prisma.customerNote.updateMany({ where, data: move });
  await prisma.customerContact.updateMany({ where, data: move });
  await prisma.bankTransaction.updateMany({ where, data: move });
  await prisma.bankTransaction.updateMany({ where: { companyId, relatedCustomerId: source.id }, data: { relatedCustomerId: target.id } });
  await prisma.journalLine.updateMany({ where: { customerRef: source.id, journal: { companyId } }, data: { customerRef: target.id } });
  await prisma.accountingDocument.updateMany({ where: { companyId, entityType: "Customer", entityId: source.id }, data: { entityId: target.id } });
  await prisma.customer.updateMany({ where: { companyId, parentId: source.id }, data: { parentId: target.id } });

  // Rebuild running balances on the combined ledger, in the order entries were posted.
  const entries = await prisma.arLedgerEntry.findMany({ where: { companyId, customerId: target.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let running = 0;
  for (const e of entries) {
    running = roundMoney(running + money(e.debit) - money(e.credit));
    if (Math.abs(money(e.runningBalance) - running) > 0.0001) await prisma.arLedgerEntry.update({ where: { id: e.id }, data: { runningBalance: running } });
  }
  await prisma.customer.update({
    where: { id: target.id },
    data: {
      balance: running,
      openingBalance: roundMoney(money(target.openingBalance) + money(source.openingBalance)),
      notes: [target.notes, source.notes ? `From ${source.name} (${source.code}): ${source.notes}` : null].filter(Boolean).join("\n\n") || null,
      tags: [...new Set([...target.tags, ...source.tags])].slice(0, 10),
      ...(source.externalErpCustomerId && !target.externalErpCustomerId ? { externalErpCustomerId: source.externalErpCustomerId } : {}),
    },
  });
  if (source.externalErpCustomerId) await prisma.customer.update({ where: { id: source.id }, data: { externalErpCustomerId: null } });
  await prisma.customer.delete({ where: { id: source.id } });
  await writeAudit({
    companyId,
    erpUserId: actor?.erpUserId ?? 0,
    erpRole: actor?.erpRole,
    action: "MERGE",
    entityType: "Customer",
    entityId: target.id,
    beforeJson: { merged: { id: source.id, code: source.code, name: source.name, balance: money(source.balance) } },
    afterJson: { moved, balance: running },
    ...actor?.meta,
  });
  return { targetId: target.id, moved, balance: running };
}

export async function findCustomerDuplicates(
  companyId: string,
  input: { name?: string; tin?: string; email?: string; phone?: string; exceptId?: string },
) {
  const or: Prisma.CustomerWhereInput[] = [];
  const name = input.name?.trim();
  if (name && name.length >= 2) or.push({ name: { equals: name, mode: "insensitive" } });
  if (input.tin?.trim()) or.push({ tin: input.tin.trim() });
  if (input.email?.trim()) or.push({ email: { equals: input.email.trim(), mode: "insensitive" } });
  const phone = input.phone?.replace(/\D/g, "");
  if (phone && phone.length >= 6) or.push({ telephone: { contains: phone.slice(-9) } }, { mobile: { contains: phone.slice(-9) } });
  if (!or.length) return [];
  const hits = await prisma.customer.findMany({
    where: { companyId, OR: or, ...(input.exceptId ? { NOT: { id: input.exceptId } } : {}) },
    take: 5,
    select: { id: true, code: true, name: true, tin: true, email: true, telephone: true, mobile: true, status: true },
  });
  return hits.map((h) => {
    const matched: string[] = [];
    if (name && h.name.toLowerCase() === name.toLowerCase()) matched.push("name");
    if (input.tin?.trim() && h.tin === input.tin.trim()) matched.push("tin");
    if (input.email?.trim() && h.email?.toLowerCase() === input.email.trim().toLowerCase()) matched.push("email");
    if (phone && phone.length >= 6 && [h.telephone, h.mobile].some((p) => p?.replace(/\D/g, "").endsWith(phone.slice(-9)))) matched.push("phone");
    // Name and TIN block saving; email and phone only warn.
    return { ...h, matched, blocking: matched.includes("name") || matched.includes("tin") };
  });
}

async function loadCustomer(companyId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!customer) throw new Error("Customer does not exist");
  return customer;
}

/** The figures on the customer profile header. */
export async function customerSummary(companyId: string, customerId: string) {
  const customer = await loadCustomer(companyId, customerId);
  const today = startOfTodayUtc();
  const [invoiced, openInvoices, receipts, deposits, unappliedNotes, debitNotes, last, overdueMap, bar] = await Promise.all([
    prisma.arInvoice.aggregate({
      where: { companyId, customerId, status: "POSTED", NOT: { sourceDocumentType: "CustomerOpening" } },
      _sum: { gross: true },
      _count: true,
    }),
    prisma.arInvoice.findMany({
      where: { companyId, customerId, status: "POSTED" },
      select: { gross: true, amountPaid: true, amountCredited: true, dueDate: true },
    }),
    prisma.arReceipt.aggregate({ where: { companyId, customerId, status: "POSTED" }, _sum: { amount: true, unallocated: true }, _count: true }),
    prisma.arDeposit.aggregate({ where: { companyId, customerId, status: "POSTED" }, _sum: { remaining: true } }),
    prisma.arCreditNote.aggregate({ where: { companyId, customerId, status: "POSTED" }, _sum: { unapplied: true } }),
    prisma.arDebitNote.aggregate({ where: { companyId, customerId, status: "POSTED" }, _sum: { gross: true } }),
    prisma.arLedgerEntry.findFirst({ where: { companyId, customerId }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] }),
    overdueByCustomer(companyId, [customerId]),
    moneyBar(companyId, customerId),
  ]);

  let openCount = 0;
  let overdueCount = 0;
  let oldestDue: Date | null = null;
  for (const inv of openInvoices) {
    const open = money(inv.gross) - money(inv.amountPaid) - money(inv.amountCredited);
    if (open <= 0.005) continue;
    openCount += 1;
    if (inv.dueDate < today) {
      overdueCount += 1;
      if (!oldestDue || inv.dueDate < oldestDue) oldestDue = inv.dueDate;
    }
  }
  const balance = money(customer.balance);
  const limit = money(customer.creditLimit);
  const depositsAvailable = money(deposits._sum.remaining ?? 0);
  const unappliedPayments = money(receipts._sum.unallocated ?? 0);
  const unappliedCredits = money(unappliedNotes._sum.unapplied ?? 0);
  return {
    customerId,
    currency: customer.currency,
    /** Ledger balance: invoices + debit notes + opening − payments − credits. Negative means the customer is in credit. */
    outstanding: balance,
    totalInvoiced: money(invoiced._sum.gross ?? 0),
    invoiceCount: invoiced._count,
    debitNotesTotal: money(debitNotes._sum.gross ?? 0),
    openingBalance: money(customer.openingBalance),
    paymentsReceived: money(receipts._sum.amount ?? 0),
    paymentCount: receipts._count,
    overdue: overdueMap.get(customerId) ?? 0,
    overdueCount,
    oldestOverdueDays: oldestDue ? Math.floor((today.getTime() - oldestDue.getTime()) / 86_400_000) : 0,
    openInvoiceCount: openCount,
    /** Money held for the customer that can still be applied: unused deposits, unapplied payments and credit notes not tied to an invoice. */
    availableCredit: roundMoney(depositsAvailable + unappliedPayments + unappliedCredits),
    credits: { deposits: depositsAvailable, unappliedPayments, unappliedCreditNotes: unappliedCredits },
    moneyBar: bar,
    creditLimit: limit,
    creditHeadroom: limit > 0 ? roundMoney(limit - balance) : null,
    lastTransaction: last
      ? { date: last.entryDate, docType: last.docType, docId: last.docId, docNumber: last.docNumber, amount: money(last.debit) || money(last.credit) }
      : null,
  };
}

export type TxnType = "INVOICE" | "PAYMENT" | "CREDIT_NOTE" | "DEBIT_NOTE" | "DEPOSIT" | "ESTIMATE" | "SALES_ORDER" | "DELAYED_CHARGE" | "DELAYED_CREDIT" | "REFUND";

/** Non-posting sales documents (QuickBooks shows them in a customer's transaction list without a balance). */
const COMMERCIAL_TYPES = ["ESTIMATE", "SALES_ORDER", "DELAYED_CHARGE", "DELAYED_CREDIT"] as const;
export type TxnRow = {
  id: string;
  type: TxnType;
  number: string;
  date: Date;
  dueDate: Date | null;
  description: string | null;
  total: number;
  /** What is still open on the document: unpaid on invoices/debit notes, unapplied on payments/deposits. */
  open: number;
  status: string;
  statusTone: "positive" | "negative" | "warning" | "neutral";
  isOpening?: boolean;
  /** False for estimates, orders and delayed charges/credits: they don't touch the books or the balance. */
  posting: boolean;
  /** For non-posting documents: the commercial document kind (PROPOSAL shows as an estimate). */
  kind?: string;
  convertedTo?: { type: string; id: string; number: string } | null;
};

function dayStart(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined;
}
function dayEnd(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : undefined;
}

/** Every AR document for one customer in one list, newest first. */
export async function customerTransactions(
  companyId: string,
  customerId: string,
  filter: { type?: TxnType; status?: "open" | "overdue" | "closed"; from?: string; to?: string },
  page: PageRequest,
) {
  await loadCustomer(companyId, customerId);
  const today = startOfTodayUtc();
  const range = (field: string) => {
    const gte = dayStart(filter.from);
    const lte = dayEnd(filter.to);
    return gte || lte ? { [field]: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {};
  };
  const want = (t: TxnType) => !filter.type || filter.type === t;
  const base = { companyId, customerId };
  const commercialKinds = COMMERCIAL_TYPES.filter((t) => want(t)).flatMap((t) => (t === "ESTIMATE" ? (["ESTIMATE", "PROPOSAL"] as const) : [t]));
  const [invoices, receipts, credits, debits, deposits, documents, refunds] = await Promise.all([
    want("INVOICE") ? prisma.arInvoice.findMany({ where: { ...base, ...range("invoiceDate") } }) : [],
    want("PAYMENT") ? prisma.arReceipt.findMany({ where: { ...base, ...range("receiptDate") } }) : [],
    want("CREDIT_NOTE")
      ? prisma.arCreditNote.findMany({ where: { ...base, ...range("noteDate") }, include: { invoice: { select: { invoiceNumber: true } }, applications: { select: { id: true } } } })
      : [],
    want("DEBIT_NOTE") ? prisma.arDebitNote.findMany({ where: { ...base, ...range("noteDate") } }) : [],
    want("DEPOSIT") ? prisma.arDeposit.findMany({ where: { ...base, ...range("depositDate") } }) : [],
    commercialKinds.length
      ? prisma.commercialDocument.findMany({ where: { ...base, kind: { in: [...commercialKinds] }, ...range("docDate") } })
      : [],
    want("REFUND") ? prisma.bankTransaction.findMany({ where: { companyId, relatedCustomerId: customerId, ...range("transactionDate") } }) : [],
  ]);

  const rows: TxnRow[] = [];
  for (const i of invoices) {
    const gross = money(i.gross);
    const open = i.status === "POSTED" ? roundMoney(gross - money(i.amountPaid) - money(i.amountCredited)) : 0;
    const overdue = open > 0.005 && i.dueDate < today;
    const status =
      i.status === "REVERSED" ? "Voided" : open <= 0.005 ? "Paid" : overdue ? `Overdue ${Math.floor((today.getTime() - i.dueDate.getTime()) / 86_400_000)}d` : open < gross ? "Partially paid" : "Open";
    rows.push({
      id: i.id,
      type: "INVOICE",
      posting: true,
      number: i.invoiceNumber,
      date: i.invoiceDate,
      dueDate: i.dueDate,
      description: i.description,
      total: gross,
      open,
      status,
      statusTone: i.status === "REVERSED" ? "neutral" : open <= 0.005 ? "positive" : overdue ? "negative" : "warning",
      isOpening: i.sourceDocumentType === "CustomerOpening",
    });
  }
  for (const r of receipts) {
    const unapplied = r.status === "POSTED" ? money(r.unallocated) : 0;
    rows.push({
      id: r.id,
      type: "PAYMENT",
      posting: true,
      number: r.receiptNumber,
      date: r.receiptDate,
      dueDate: null,
      description: [r.method.replace("_", " ").toLowerCase(), r.reference, r.description].filter(Boolean).join(" · ") || null,
      total: money(r.amount),
      open: unapplied,
      status: r.status === "REVERSED" ? "Reversed" : unapplied > 0.005 ? "Unapplied" : "Closed",
      statusTone: r.status === "REVERSED" ? "neutral" : unapplied > 0.005 ? "warning" : "positive",
    });
  }
  for (const n of credits) {
    const unapplied = n.status === "POSTED" ? money(n.unapplied) : 0;
    const gross = money(n.gross);
    rows.push({
      id: n.id,
      type: "CREDIT_NOTE",
      posting: true,
      number: n.creditNoteNumber,
      date: n.noteDate,
      dueDate: null,
      description: [n.reason, n.invoice ? `on ${n.invoice.invoiceNumber}` : null].filter(Boolean).join(" · "),
      total: gross,
      open: unapplied,
      status: n.status === "REVERSED" ? "Reversed" : unapplied <= 0.005 ? "Applied" : unapplied < gross ? "Partly applied" : "Unapplied",
      statusTone: n.status === "REVERSED" ? "neutral" : unapplied <= 0.005 ? "positive" : "warning",
    });
  }
  for (const d of debits) {
    const open = d.status === "POSTED" ? roundMoney(money(d.gross) - money(d.amountSettled)) : 0;
    const overdue = open > 0.005 && d.dueDate < today;
    rows.push({
      id: d.id,
      type: "DEBIT_NOTE",
      posting: true,
      number: d.debitNoteNumber,
      date: d.noteDate,
      dueDate: d.dueDate,
      description: d.reason,
      total: money(d.gross),
      open,
      status: d.status === "REVERSED" ? "Reversed" : open <= 0.005 ? "Settled" : overdue ? "Overdue" : "Open",
      statusTone: d.status === "REVERSED" ? "neutral" : open <= 0.005 ? "positive" : overdue ? "negative" : "warning",
    });
  }
  for (const d of deposits) {
    const remaining = d.status === "POSTED" ? money(d.remaining) : 0;
    rows.push({
      id: d.id,
      type: "DEPOSIT",
      posting: true,
      number: d.depositNumber,
      date: d.depositDate,
      dueDate: null,
      description: [d.method.replace("_", " ").toLowerCase(), d.reference, d.description].filter(Boolean).join(" · ") || null,
      total: money(d.amount),
      open: remaining,
      status: d.status === "REVERSED" ? "Refunded" : remaining <= 0.005 ? "Used" : remaining < money(d.amount) ? "Partly used" : "Available",
      statusTone: d.status === "REVERSED" ? "neutral" : remaining <= 0.005 ? "positive" : "warning",
    });
  }

  for (const d of documents) {
    const type: TxnType = d.kind === "PROPOSAL" ? "ESTIMATE" : (d.kind as TxnType);
    const live = ["PENDING", "ACCEPTED", "OPEN", "PENDING_APPROVAL"].includes(d.status);
    rows.push({
      id: d.id,
      type,
      kind: d.kind,
      number: d.number,
      date: d.docDate,
      dueDate: d.expirationDate ?? d.dueDate ?? null,
      description: d.memo || d.note || null,
      total: money(d.total),
      open: 0,
      posting: false,
      status: d.status === "CONVERTED" && d.convertedToNumber ? `Converted to ${d.convertedToNumber}` : d.status.charAt(0) + d.status.slice(1).toLowerCase().replace(/_/g, " "),
      statusTone: d.status === "DECLINED" || d.status === "VOID" ? "neutral" : live ? "warning" : "positive",
      convertedTo: d.convertedToId && d.convertedToType && d.convertedToNumber ? { type: d.convertedToType, id: d.convertedToId, number: d.convertedToNumber } : null,
    });
  }

  for (const b of refunds) {
    rows.push({
      id: b.id,
      type: "REFUND",
      number: b.number,
      date: b.transactionDate,
      dueDate: null,
      description: b.description,
      total: money(b.amount),
      open: 0,
      posting: false,
      status: b.status === "REVERSED" ? "Reversed" : "Paid out",
      statusTone: b.status === "REVERSED" ? "neutral" : "positive",
    });
  }

  const filtered = rows.filter((r) => {
    if (filter.status === "open") return r.posting ? r.open > 0.005 : r.statusTone === "warning";
    if (filter.status === "closed") return r.posting ? r.open <= 0.005 : r.statusTone !== "warning";
    if (filter.status === "overdue") return r.statusTone === "negative";
    return true;
  });
  filtered.sort((a, b) => b.date.getTime() - a.date.getTime() || b.number.localeCompare(a.number));
  return {
    ...paginateArray(filtered, page),
    totals: {
      total: roundMoney(filtered.filter((r) => r.posting).reduce((s, r) => s + r.total, 0)),
      open: roundMoney(filtered.filter((r) => r.posting).reduce((s, r) => s + r.open, 0)),
    },
  };
}

/** One payment, credit note, debit note or deposit with what it was applied to. Invoices use `getInvoice`. */
export async function customerTransactionDetail(companyId: string, type: Exclude<TxnType, "INVOICE">, id: string) {
  if (type === "PAYMENT") {
    const r = await prisma.arReceipt.findFirst({
      where: { id, companyId },
      include: { customer: { select: { id: true, code: true, name: true } }, allocations: { include: { invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } } } } },
    });
    if (!r) throw new Error("Payment does not exist");
    return {
      type,
      id: r.id,
      number: r.receiptNumber,
      date: r.receiptDate,
      status: r.status,
      customer: r.customer,
      total: money(r.amount),
      open: money(r.unallocated),
      method: r.method,
      reference: r.reference,
      description: r.description,
      journalId: r.journalId,
      applications: r.allocations.map((a) => ({ applicationId: a.id, invoiceId: a.invoice.id, invoiceNumber: a.invoice.invoiceNumber, date: a.invoice.invoiceDate, amount: money(a.amount) })),
    };
  }
  if (type === "CREDIT_NOTE") {
    const n = await prisma.arCreditNote.findFirst({
      where: { id, companyId },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
        applications: { include: { invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!n) throw new Error("Credit note does not exist");
    const unapplied = money(n.unapplied);
    const onIssue = n.invoice ? roundMoney(money(n.gross) - unapplied - n.applications.reduce((s, a) => s + money(a.amount), 0)) : 0;
    return {
      type,
      id: n.id,
      number: n.creditNoteNumber,
      date: n.noteDate,
      status: n.status,
      customer: n.customer,
      total: money(n.gross),
      net: money(n.net),
      tax: money(n.tax),
      open: unapplied,
      reference: n.reason,
      description: n.description,
      journalId: n.journalId,
      applications: [
        ...(n.invoice && onIssue > 0.005 ? [{ invoiceId: n.invoice.id, invoiceNumber: n.invoice.invoiceNumber, date: n.invoice.invoiceDate, amount: onIssue }] : []),
        ...n.applications.map((a) => ({ applicationId: a.id, invoiceId: a.invoice.id, invoiceNumber: a.invoice.invoiceNumber, date: a.invoice.invoiceDate, amount: money(a.amount) })),
      ],
    };
  }
  if (type === "DEBIT_NOTE") {
    const d = await prisma.arDebitNote.findFirst({ where: { id, companyId }, include: { customer: { select: { id: true, code: true, name: true } } } });
    if (!d) throw new Error("Debit note does not exist");
    return {
      type,
      id: d.id,
      number: d.debitNoteNumber,
      date: d.noteDate,
      dueDate: d.dueDate,
      status: d.status,
      customer: d.customer,
      total: money(d.gross),
      net: money(d.net),
      tax: money(d.tax),
      open: roundMoney(money(d.gross) - money(d.amountSettled)),
      reference: d.reason,
      description: d.description,
      journalId: d.journalId,
      applications: [],
    };
  }
  const d = await prisma.arDeposit.findFirst({ where: { id, companyId }, include: { customer: { select: { id: true, code: true, name: true } }, allocations: true } });
  if (!d) throw new Error("Deposit does not exist");
  const invoices = await prisma.arInvoice.findMany({
    where: { companyId, id: { in: d.allocations.map((a) => a.invoiceId) } },
    select: { id: true, invoiceNumber: true, invoiceDate: true },
  });
  const byId = new Map(invoices.map((i) => [i.id, i]));
  return {
    type,
    id: d.id,
    number: d.depositNumber,
    date: d.depositDate,
    status: d.status,
    customer: d.customer,
    total: money(d.amount),
    open: money(d.remaining),
    method: d.method,
    reference: d.reference,
    description: d.description,
    journalId: d.journalId,
    applications: d.allocations.map((a) => ({
      applicationId: a.id,
      invoiceId: a.invoiceId,
      invoiceNumber: byId.get(a.invoiceId)?.invoiceNumber ?? "—",
      date: byId.get(a.invoiceId)?.invoiceDate ?? a.createdAt,
      amount: money(a.amount),
    })),
  };
}

/* ── Notes & activity ─────────────────────────────────── */

export async function listCustomerNotes(companyId: string, customerId: string) {
  await loadCustomer(companyId, customerId);
  return prisma.customerNote.findMany({ where: { companyId, customerId }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function addCustomerNote(companyId: string, customerId: string, body: string, author: { erpUserId: number; name?: string }) {
  await loadCustomer(companyId, customerId);
  const text = body.trim();
  if (!text) throw new Error("Write something in the note");
  return prisma.customerNote.create({ data: { companyId, customerId, body: text.slice(0, 4000), erpUserId: author.erpUserId, authorName: author.name } });
}

const ACTIVITY_LABEL: Record<string, string> = {
  INVOICE: "Invoice posted",
  RECEIPT: "Payment received",
  RECEIPT_REVERSAL: "Payment reversed",
  CREDIT_NOTE: "Credit note issued",
  DEBIT_NOTE: "Debit note issued",
  DEPOSIT_APPLICATION: "Deposit applied",
  DEPOSIT_UNAPPLY: "Deposit unapplied",
  INVOICE_VOID: "Invoice voided",
  OPENING: "Opening balance",
};

/** Profile changes (from the audit log) and postings (from the subledger), newest first. */
export async function customerActivity(companyId: string, customerId: string) {
  await loadCustomer(companyId, customerId);
  const [audits, ledger] = await Promise.all([
    prisma.auditEvent.findMany({ where: { companyId, entityType: "Customer", entityId: customerId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.arLedgerEntry.findMany({ where: { companyId, customerId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const items = [
    ...audits.map((a) => {
      const after = (a.afterJson ?? {}) as Record<string, unknown>;
      const fields = Object.keys(after).filter((k) => k !== "code");
      const title =
        a.action === "EMAIL"
          ? `Emailed ${String(after.kind ?? "").toLowerCase()}${after.documentNumber ? ` ${after.documentNumber}` : ""}`
          : a.action === "APPLY_CREDIT"
          ? "Credits applied"
          : a.action === "UNAPPLY_CREDIT"
            ? "Credit removed from invoice"
          : a.action === "CREATE"
            ? "Customer created"
            : a.action === "DEACTIVATE" ? "Made inactive" : a.action === "ACTIVATE" ? "Made active" : "Profile updated";
      return {
        id: `audit-${a.id}`,
        at: a.createdAt,
        kind: "change" as const,
        title,
        detail:
          a.action === "EMAIL"
            ? `To ${String(after.to ?? "")}`
            : a.action === "APPLY_CREDIT" || a.action === "UNAPPLY_CREDIT"
            ? ((after.applied ?? after.removed ?? []) as Array<{ number: string; invoiceNumber: string; amount: number }>).map((x) => `${x.number} → ${x.invoiceNumber} (${x.amount})`).join(", ")
            : a.action === "UPDATE" && fields.length
              ? `Changed ${fields.join(", ")}`
              : null,
        erpUserId: a.erpUserId,
        docType: null as string | null,
        docId: null as string | null,
        amount: null as number | null,
      };
    }),
    ...ledger.map((e) => ({
      id: `ledger-${e.id}`,
      at: e.createdAt,
      kind: "posting" as const,
      title: `${ACTIVITY_LABEL[e.docType] ?? e.docType} ${e.docNumber ?? ""}`.trim(),
      detail: e.description,
      erpUserId: null as number | null,
      docType: e.docType,
      docId: e.docId,
      amount: money(e.debit) || -money(e.credit),
    })),
  ];
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 150);
}

/* ── Bulk, export, import ─────────────────────────────── */

export async function bulkSetStatus(companyId: string, ids: string[], status: "ACTIVE" | "INACTIVE", actor: Actor) {
  const done: string[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  const customers = await prisma.customer.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, status: true } });
  for (const c of customers) {
    if (c.status === status) continue;
    try {
      await updateCustomer(companyId, c.id, { status }, actor);
      done.push(c.id);
    } catch (e) {
      skipped.push({ id: c.id, name: c.name, reason: (e as Error).message });
    }
  }
  return { updated: done.length, skipped };
}

function csvCell(value: unknown) {
  const s = value == null ? "" : String(value);
  // Leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_COLUMNS = [
  ["code", "Code"],
  ["name", "Display name"],
  ["companyName", "Company"],
  ["customerType", "Type"],
  ["contactPerson", "Contact person"],
  ["email", "Email"],
  ["telephone", "Phone"],
  ["mobile", "Mobile"],
  ["website", "Website"],
  ["tin", "TIN"],
  ["physicalAddress", "Billing address"],
  ["shippingAddress", "Shipping address"],
  ["country", "Country"],
  ["creditPeriodDays", "Terms (days)"],
  ["preferredPaymentMethod", "Payment method"],
  ["creditLimit", "Credit limit"],
  ["status", "Status"],
  ["balance", "Balance"],
  ["overdue", "Overdue"],
  ["notes", "Notes"],
] as const;

export async function exportCustomersCsv(companyId: string, filter: CustomerListFilter) {
  const pageSize = 2000;
  const lines = [CSV_COLUMNS.map(([, label]) => csvCell(label)).join(",")];
  for (let page = 1; ; page += 1) {
    const chunk = await listCustomersPage(companyId, filter, { page, pageSize });
    for (const c of chunk.rows) lines.push(CSV_COLUMNS.map(([key]) => csvCell((c as Record<string, unknown>)[key])).join(","));
    if (page >= chunk.pageCount) break;
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export type ImportRow = {
  name: string;
  companyName?: string;
  customerType?: CustomerType;
  contactPerson?: string;
  email?: string;
  telephone?: string;
  mobile?: string;
  website?: string;
  tin?: string;
  physicalAddress?: string;
  shippingAddress?: string;
  country?: string;
  creditPeriodDays?: number;
  preferredPaymentMethod?: ArPaymentMethod;
  creditLimit?: number;
  openingBalance?: number;
  openingBalanceDate?: string;
  notes?: string;
};

/**
 * Creates customers one row at a time, each in its own transaction, so one bad row doesn't stop the rest.
 * `dryRun` validates (required name, TIN format, duplicates in the file and in the books) without saving.
 */
export async function importCustomers(
  companyId: string,
  rows: ImportRow[],
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
      const dupes = await findCustomerDuplicates(companyId, { name, tin: row.tin });
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
      const created = await runInTransaction(() => createCustomer(companyId, { ...row, name }, actor));
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

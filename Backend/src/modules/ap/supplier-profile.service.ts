/**
 * Supplier profile reads: the account summary, every document for the supplier in one list,
 * one document's detail, credits that are still available, and the activity timeline.
 *
 * Money figures come from the AP subledger (supplier.balance, ApLedgerEntry) or from posted documents.
 * Purchase orders, item receipts and direct expenses are listed for context but never change the AP balance.
 */
import { roundMoney } from "@exceledge/accounting-domain";
import { money } from "../../lib/documents";
import { paginateArray, type PageRequest } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { apMoneyBar, supplierStats } from "./suppliers.service";

const DAY = 86_400_000;

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function loadSupplier(companyId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!supplier) throw new Error("Supplier does not exist");
  return supplier;
}

const OPEN_PO = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED"] as const;

/**
 * Debit notes and expenses on account are carried by a payable bill (sourceDocumentType "ApDebitNote" / "Expense") so
 * they can be paid like one. Lists show that bill as the debit note or expense, and bill totals leave them and opening
 * balances out.
 */
const ORDINARY_BILL = { OR: [{ sourceDocumentType: null }, { sourceDocumentType: { notIn: ["SupplierOpening", "ApDebitNote", "Expense"] } }] };
/** Debit notes and on-account expenses are listed as themselves, with the open amount of the bill that carries them. */
const LISTED_AS_BILL = { OR: [{ sourceDocumentType: null }, { sourceDocumentType: { notIn: ["ApDebitNote", "Expense"] } }] };

type BillRow = { gross: unknown; amountPaid: unknown; amountCredited: unknown; status: string; dueDate: Date };

/** Open amount and status of a bill, from what was paid and credited on it. */
function billState(b: BillRow, today: Date) {
  const gross = money(b.gross as never);
  const open = b.status === "POSTED" ? roundMoney(gross - money(b.amountPaid as never) - money(b.amountCredited as never)) : 0;
  const overdue = open > 0.005 && b.dueDate < today;
  const status =
    b.status === "REVERSED"
      ? "Void"
      : b.status === "PENDING_APPROVAL"
        ? "Awaiting approval"
        : b.status === "REJECTED"
          ? "Rejected"
          : open <= 0.005
            ? "Paid"
            : overdue
              ? `Overdue ${Math.floor((today.getTime() - b.dueDate.getTime()) / DAY)}d`
              : open < gross - 0.005
                ? "Partly paid"
                : "Unpaid";
  const tone: SupplierTxnRow["statusTone"] = b.status !== "POSTED" ? "neutral" : open <= 0.005 ? "positive" : overdue ? "negative" : "warning";
  return { gross, open, status, tone };
}

/** The part of a supplier credit not yet set against a bill. */
function creditNoteUnapplied(n: { unapplied: unknown; status: string }) {
  return n.status === "POSTED" ? money(n.unapplied as never) : 0;
}

/** The figures on the supplier profile header and overview. */
export async function supplierSummary(companyId: string, supplierId: string) {
  const supplier = await loadSupplier(companyId, supplierId);
  const today = startOfTodayUtc();
  const [billed, openBills, payments, notes, advances, debitNotes, orders, last, stats, bar] = await Promise.all([
    prisma.apBill.aggregate({
      where: { companyId, supplierId, status: "POSTED", ...ORDINARY_BILL },
      _sum: { gross: true },
      _count: true,
    }),
    prisma.apBill.findMany({ where: { companyId, supplierId, status: "POSTED" }, select: { gross: true, amountPaid: true, amountCredited: true, dueDate: true } }),
    prisma.apPayment.aggregate({ where: { companyId, supplierId, status: "POSTED" }, _sum: { amount: true, withholdingTax: true, unallocated: true }, _count: true }),
    prisma.apCreditNote.findMany({ where: { companyId, supplierId, status: "POSTED" }, select: { unapplied: true, status: true } }),
    prisma.apAdvance.aggregate({ where: { companyId, supplierId, status: "POSTED" }, _sum: { remaining: true, amount: true, refunded: true }, _count: true }),
    prisma.apDebitNote.aggregate({ where: { companyId, supplierId, status: "POSTED" }, _sum: { gross: true } }),
    prisma.commercialDocument.aggregate({ where: { companyId, supplierId, kind: "PURCHASE_ORDER", status: { in: [...OPEN_PO] } }, _sum: { total: true }, _count: true }),
    prisma.apLedgerEntry.findFirst({ where: { companyId, supplierId }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] }),
    supplierStats(companyId, [supplierId]),
    apMoneyBar(companyId, supplierId),
  ]);

  let openCount = 0;
  let partlyPaidCount = 0;
  let overdueCount = 0;
  let overdue = 0;
  let oldestDue: Date | null = null;
  for (const b of openBills) {
    const gross = money(b.gross);
    const open = roundMoney(gross - money(b.amountPaid) - money(b.amountCredited));
    if (open <= 0.005) continue;
    openCount += 1;
    if (open < gross - 0.005) partlyPaidCount += 1;
    if (b.dueDate < today) {
      overdueCount += 1;
      overdue += open;
      if (!oldestDue || b.dueDate < oldestDue) oldestDue = b.dueDate;
    }
  }
  const unappliedCreditNotes = roundMoney(notes.reduce((s, n) => s + creditNoteUnapplied(n), 0));
  const unappliedPayments = money(payments._sum.unallocated ?? 0);
  const advancesAvailable = money(advances._sum.remaining ?? 0);
  const limit = money(supplier.creditLimit);
  const balance = money(supplier.balance);
  return {
    supplierId,
    currency: supplier.currency,
    /** Subledger balance: bills + debit notes + opening − payments − credits. Negative means the supplier owes you. */
    outstanding: balance,
    totalPurchases: stats.get(supplierId)?.purchases ?? 0,
    totalBilled: money(billed._sum.gross ?? 0),
    billCount: billed._count,
    debitNotesTotal: money(debitNotes._sum.gross ?? 0),
    openingBalance: money(supplier.openingBalance),
    /** Cash paid plus tax withheld, and advances paid ahead (less refunds): everything paid to the supplier. */
    paymentsMade: roundMoney(
      money(payments._sum.amount ?? 0) + money(payments._sum.withholdingTax ?? 0) + money(advances._sum.amount ?? 0) - money(advances._sum.refunded ?? 0),
    ),
    paymentCount: payments._count + advances._count,
    overdue: roundMoney(overdue),
    overdueCount,
    oldestOverdueDays: oldestDue ? Math.floor((today.getTime() - oldestDue.getTime()) / DAY) : 0,
    openBillCount: openCount,
    partlyPaidBillCount: partlyPaidCount,
    /**
     * Credits not yet set against a bill. Unapplied credit notes and payments already reduce the balance;
     * advances sit in prepayments and reduce it only when applied.
     */
    availableCredit: roundMoney(unappliedCreditNotes + unappliedPayments + advancesAvailable),
    credits: { creditNotes: unappliedCreditNotes, unappliedPayments, advances: advancesAvailable },
    openPurchaseOrders: { amount: money(orders._sum.total ?? 0), count: orders._count },
    moneyBar: bar,
    creditLimit: limit,
    creditHeadroom: limit > 0 ? roundMoney(limit - balance) : null,
    lastTransaction: last
      ? { date: last.entryDate, docType: last.docType, docId: last.docId, docNumber: last.docNumber, amount: money(last.credit) || money(last.debit) }
      : null,
  };
}

export const SUPPLIER_TXN_TYPES = ["BILL", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "ADVANCE", "EXPENSE", "PURCHASE_ORDER", "ITEM_RECEIPT"] as const;
export type SupplierTxnType = (typeof SUPPLIER_TXN_TYPES)[number];

export type SupplierTxnRow = {
  id: string;
  type: SupplierTxnType;
  number: string;
  date: Date;
  dueDate: Date | null;
  description: string | null;
  total: number;
  /** Still open: unpaid on bills and debit notes, unapplied on payments, credit notes and advances. */
  open: number;
  status: string;
  statusTone: "positive" | "negative" | "warning" | "neutral";
  /** False for purchase orders, item receipts and direct expenses: they don't change what you owe the supplier. */
  posting: boolean;
  isOpening?: boolean;
  reference?: string | null;
};

function dayStart(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined;
}
function dayEnd(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : undefined;
}

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

const PO_STATUS: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  OPEN: "Open",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received",
  CONVERTED: "Billed",
  CLOSED: "Closed",
  VOID: "Cancelled",
};

/** Every document for one supplier in one list, newest first. */
export async function supplierTransactions(
  companyId: string,
  supplierId: string,
  filter: { type?: SupplierTxnType; status?: "open" | "overdue" | "closed"; from?: string; to?: string },
  page: PageRequest,
  /** Types the caller may not see (expenses need expense:view, item receipts inventory:view). */
  hidden: SupplierTxnType[] = [],
) {
  await loadSupplier(companyId, supplierId);
  const today = startOfTodayUtc();
  const range = (field: string) => {
    const gte = dayStart(filter.from);
    const lte = dayEnd(filter.to);
    return gte || lte ? { [field]: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {};
  };
  const want = (t: SupplierTxnType) => !hidden.includes(t) && (!filter.type || filter.type === t);
  const base = { companyId, supplierId };
  const [bills, payments, credits, debits, advances, expenses, orders, receipts] = await Promise.all([
    want("BILL") ? prisma.apBill.findMany({ where: { ...base, ...LISTED_AS_BILL, ...range("billDate") } }) : [],
    want("PAYMENT") ? prisma.apPayment.findMany({ where: { ...base, ...range("paymentDate") }, include: { allocations: { include: { bill: { select: { billNumber: true } } } } } }) : [],
    want("CREDIT_NOTE") ? prisma.apCreditNote.findMany({ where: { ...base, ...range("noteDate") }, include: { bill: { select: { billNumber: true } } } }) : [],
    want("DEBIT_NOTE") ? prisma.apDebitNote.findMany({ where: { ...base, ...range("noteDate") } }) : [],
    want("ADVANCE") ? prisma.apAdvance.findMany({ where: { ...base, ...range("advanceDate") } }) : [],
    want("EXPENSE") ? prisma.expense.findMany({ where: { ...base, status: { in: ["POSTED", "REVERSED", "APPROVED", "SUBMITTED"] }, ...range("expenseDate") } }) : [],
    want("PURCHASE_ORDER") ? prisma.commercialDocument.findMany({ where: { ...base, kind: "PURCHASE_ORDER", ...range("docDate") } }) : [],
    want("ITEM_RECEIPT") ? prisma.itemReceipt.findMany({ where: { ...base, ...range("receiptDate") }, include: { purchaseOrder: { select: { number: true } } } }) : [],
  ]);

  const rows: SupplierTxnRow[] = [];
  for (const b of bills) {
    const st = billState(b, today);
    rows.push({
      id: b.id,
      type: "BILL",
      posting: true,
      number: b.billNumber,
      date: b.billDate,
      dueDate: b.dueDate,
      description: [b.supplierInvoiceNumber && `Inv. ${b.supplierInvoiceNumber}`, b.poReference && `PO ${b.poReference}`, b.description].filter(Boolean).join(" · ") || null,
      reference: b.supplierInvoiceNumber,
      total: st.gross,
      open: st.open,
      status: st.status,
      statusTone: st.tone,
      isOpening: b.sourceDocumentType === "SupplierOpening",
    });
  }
  for (const p of payments) {
    const unapplied = p.status === "POSTED" ? money(p.unallocated) : 0;
    rows.push({
      id: p.id,
      type: "PAYMENT",
      posting: true,
      number: p.paymentNumber,
      date: p.paymentDate,
      dueDate: null,
      description:
        [sentence(p.method), p.reference, p.allocations.length ? `for ${p.allocations.map((a) => a.bill.billNumber).join(", ")}` : null].filter(Boolean).join(" · ") || null,
      reference: p.reference,
      total: roundMoney(money(p.amount) + money(p.withholdingTax)),
      open: unapplied,
      status: p.status === "REVERSED" ? "Reversed" : unapplied > 0.005 ? "Unapplied" : "Applied",
      statusTone: p.status === "REVERSED" ? "neutral" : unapplied > 0.005 ? "warning" : "positive",
    });
  }
  for (const n of credits) {
    const unapplied = creditNoteUnapplied(n);
    rows.push({
      id: n.id,
      type: "CREDIT_NOTE",
      posting: true,
      number: n.creditNoteNumber,
      date: n.noteDate,
      dueDate: null,
      description: [n.reason, n.bill ? `on ${n.bill.billNumber}` : null].filter(Boolean).join(" · "),
      reference: n.supplierReference,
      total: money(n.gross),
      open: unapplied,
      status: n.status === "REVERSED" ? "Reversed" : unapplied > 0.005 ? "Available" : "Applied",
      statusTone: n.status === "REVERSED" ? "neutral" : unapplied > 0.005 ? "warning" : "positive",
    });
  }
  const debitBills = debits.length
    ? await prisma.apBill.findMany({ where: { companyId, sourceDocumentType: "ApDebitNote", sourceDocumentId: { in: debits.map((d) => d.id) } } })
    : [];
  for (const d of debits) {
    const bill = debitBills.find((b) => b.sourceDocumentId === d.id);
    const st = bill ? billState(bill, today) : null;
    rows.push({
      id: d.id,
      type: "DEBIT_NOTE",
      posting: true,
      number: d.debitNoteNumber,
      date: d.noteDate,
      dueDate: d.dueDate,
      description: d.reason,
      reference: d.supplierReference,
      total: money(d.gross),
      open: st?.open ?? 0,
      status: d.status !== "POSTED" ? sentence(d.status) : (st?.status ?? "Posted"),
      statusTone: d.status !== "POSTED" ? "neutral" : (st?.tone ?? "positive"),
    });
  }
  for (const a of advances) {
    const remaining = a.status === "POSTED" ? money(a.remaining) : 0;
    rows.push({
      id: a.id,
      type: "ADVANCE",
      posting: true,
      number: a.advanceNumber,
      date: a.advanceDate,
      dueDate: null,
      description: [sentence(a.method), a.reference, a.description].filter(Boolean).join(" · ") || null,
      reference: a.reference,
      total: money(a.amount),
      open: remaining,
      status: a.status !== "POSTED" ? sentence(a.status) : remaining <= 0.005 ? (money(a.refunded) > 0 ? "Refunded" : "Used") : remaining < money(a.amount) ? "Partly used" : "Available",
      statusTone: a.status !== "POSTED" ? "neutral" : remaining <= 0.005 ? "positive" : "warning",
    });
  }
  const expenseBills = expenses.length
    ? await prisma.apBill.findMany({ where: { companyId, sourceDocumentType: "Expense", sourceDocumentId: { in: expenses.map((e) => e.id) } } })
    : [];
  for (const e of expenses) {
    // On account: payable through its bill, so it carries that bill's open amount and status.
    const bill = expenseBills.find((b) => b.sourceDocumentId === e.id);
    if (bill && e.status === "POSTED") {
      const st = billState(bill, today);
      rows.push({
        id: e.id,
        type: "EXPENSE",
        posting: true,
        number: e.number,
        date: e.expenseDate,
        dueDate: bill.dueDate,
        description: [e.description, `on account · ${bill.billNumber}`].filter(Boolean).join(" · "),
        reference: e.reference,
        total: money(e.grossAmount),
        open: st.open,
        status: st.status,
        statusTone: st.tone,
      });
      continue;
    }
    rows.push({
      id: e.id,
      type: "EXPENSE",
      posting: false,
      number: e.number,
      date: e.expenseDate,
      dueDate: null,
      description: e.description,
      reference: e.reference,
      total: money(e.grossAmount),
      open: 0,
      status: e.status === "POSTED" ? (e.paymentMode === "ON_ACCOUNT" ? "On account" : "Paid") : sentence(e.status),
      statusTone: e.status === "POSTED" ? "positive" : e.status === "REVERSED" ? "neutral" : "warning",
    });
  }
  for (const o of orders) {
    const live = OPEN_PO.includes(o.status as (typeof OPEN_PO)[number]) || o.status === "PENDING_APPROVAL";
    rows.push({
      id: o.id,
      type: "PURCHASE_ORDER",
      posting: false,
      number: o.number,
      date: o.docDate,
      dueDate: o.dueDate,
      description: o.memo || null,
      total: money(o.total),
      open: 0,
      status: o.status === "CONVERTED" && o.convertedToNumber ? `Billed (${o.convertedToNumber})` : (PO_STATUS[o.status] ?? sentence(o.status)),
      statusTone: o.status === "VOID" ? "neutral" : live ? "warning" : "positive",
    });
  }
  for (const r of receipts) {
    rows.push({
      id: r.id,
      type: "ITEM_RECEIPT",
      posting: false,
      number: r.number,
      date: r.receiptDate,
      dueDate: null,
      description: [r.purchaseOrder ? `PO ${r.purchaseOrder.number}` : null, r.memo].filter(Boolean).join(" · ") || null,
      total: money(r.value),
      open: 0,
      status: r.status === "BILLED" ? "Billed" : "Not billed",
      statusTone: r.status === "BILLED" ? "positive" : "warning",
    });
  }

  const filtered = rows.filter((r) => {
    if (filter.status === "open") return r.posting ? r.open > 0.005 : r.statusTone === "warning";
    if (filter.status === "closed") return r.posting ? r.open <= 0.005 && r.statusTone !== "neutral" : r.statusTone === "positive";
    if (filter.status === "overdue") return r.statusTone === "negative";
    return true;
  });
  filtered.sort((a, b) => b.date.getTime() - a.date.getTime() || b.number.localeCompare(a.number));
  const posting = filtered.filter((r) => r.posting && r.statusTone !== "neutral");
  return {
    ...paginateArray(filtered, page),
    totals: {
      total: roundMoney(posting.reduce((s, r) => s + r.total, 0)),
      open: roundMoney(posting.reduce((s, r) => s + r.open, 0)),
    },
  };
}

/** One payment, credit note, debit note, advance, expense or item receipt. Bills use GET /ap/bills/:id, orders the commercial documents API. */
export async function supplierTransactionDetail(companyId: string, type: Exclude<SupplierTxnType, "BILL" | "PURCHASE_ORDER">, id: string) {
  const supplierSelect = { select: { id: true, code: true, name: true } } as const;
  if (type === "PAYMENT") {
    const p = await prisma.apPayment.findFirst({
      where: { id, companyId },
      include: { supplier: supplierSelect, allocations: { include: { bill: { select: { id: true, billNumber: true, billDate: true, supplierInvoiceNumber: true } } } } },
    });
    if (!p) throw new Error("Payment does not exist");
    const account = p.financialAccountId ? await prisma.financialAccount.findFirst({ where: { id: p.financialAccountId, companyId }, select: { name: true } }) : null;
    return {
      type,
      id: p.id,
      number: p.paymentNumber,
      date: p.paymentDate,
      status: p.status,
      supplier: p.supplier,
      total: roundMoney(money(p.amount) + money(p.withholdingTax)),
      paid: money(p.amount),
      withholdingTax: money(p.withholdingTax),
      open: p.status === "POSTED" ? money(p.unallocated) : 0,
      method: p.method,
      account: account?.name ?? null,
      reference: p.reference,
      description: p.description,
      journalId: p.journalId,
      sourceModule: p.sourceModule,
      applications: p.allocations.map((a) => ({ billId: a.bill.id, billNumber: a.bill.billNumber, reference: a.bill.supplierInvoiceNumber, date: a.bill.billDate, amount: money(a.amount) })),
    };
  }
  if (type === "CREDIT_NOTE") {
    const billSelect = { select: { id: true, billNumber: true, billDate: true, supplierInvoiceNumber: true } } as const;
    const n = await prisma.apCreditNote.findFirst({
      where: { id, companyId },
      include: { supplier: supplierSelect, bill: billSelect, applications: { include: { bill: billSelect }, orderBy: { createdAt: "asc" } } },
    });
    if (!n) throw new Error("Credit note does not exist");
    const onIssue = n.bill ? roundMoney(money(n.gross) - money(n.unapplied) - n.applications.reduce((sum, a) => sum + money(a.amount), 0)) : 0;
    return {
      type,
      id: n.id,
      number: n.creditNoteNumber,
      date: n.noteDate,
      status: n.status,
      supplier: n.supplier,
      total: money(n.gross),
      net: money(n.net),
      tax: money(n.tax),
      open: creditNoteUnapplied(n),
      reference: n.supplierReference,
      description: [n.reason, n.description].filter(Boolean).join(" · "),
      journalId: n.journalId,
      applications: [
        ...(n.bill && onIssue > 0.005 ? [{ billId: n.bill.id, billNumber: n.bill.billNumber, reference: n.bill.supplierInvoiceNumber, date: n.bill.billDate, amount: onIssue }] : []),
        ...n.applications.map((a) => ({ billId: a.bill.id, billNumber: a.bill.billNumber, reference: a.bill.supplierInvoiceNumber, date: a.createdAt, amount: money(a.amount) })),
      ],
    };
  }
  if (type === "DEBIT_NOTE") {
    const d = await prisma.apDebitNote.findFirst({ where: { id, companyId }, include: { supplier: supplierSelect } });
    if (!d) throw new Error("Debit note does not exist");
    const bill = await prisma.apBill.findFirst({
      where: { companyId, sourceDocumentType: "ApDebitNote", sourceDocumentId: d.id },
      include: { allocations: { include: { payment: { select: { id: true, paymentNumber: true, paymentDate: true, status: true } } } } },
    });
    return {
      type,
      id: d.id,
      number: d.debitNoteNumber,
      date: d.noteDate,
      dueDate: d.dueDate,
      status: d.status,
      supplier: d.supplier,
      total: money(d.gross),
      net: money(d.net),
      tax: money(d.tax),
      open: bill ? billState(bill, startOfTodayUtc()).open : 0,
      billId: bill?.id ?? null,
      reference: d.supplierReference,
      description: [d.reason, d.description].filter(Boolean).join(" · "),
      journalId: d.journalId,
      payments: (bill?.allocations ?? []).filter((a) => a.payment.status === "POSTED").map((a) => ({ paymentId: a.payment.id, paymentNumber: a.payment.paymentNumber, date: a.payment.paymentDate, amount: money(a.amount) })),
      applications: [],
    };
  }
  if (type === "ADVANCE") {
    const a = await prisma.apAdvance.findFirst({
      where: { id, companyId },
      include: { supplier: supplierSelect, allocations: { include: { bill: { select: { id: true, billNumber: true, billDate: true, supplierInvoiceNumber: true } } }, orderBy: { createdAt: "asc" } } },
    });
    if (!a) throw new Error("Advance does not exist");
    return {
      type,
      id: a.id,
      number: a.advanceNumber,
      date: a.advanceDate,
      status: a.status,
      supplier: a.supplier,
      total: money(a.amount),
      open: a.status === "POSTED" ? money(a.remaining) : 0,
      refunded: money(a.refunded),
      method: a.method,
      reference: a.reference,
      description: a.description,
      journalId: a.journalId,
      applications: a.allocations.map((x) => ({ billId: x.bill.id, billNumber: x.bill.billNumber, reference: x.bill.supplierInvoiceNumber, date: x.createdAt, amount: money(x.amount) })),
    };
  }
  if (type === "EXPENSE") {
    const e = await prisma.expense.findFirst({ where: { id, companyId }, include: { category: { select: { name: true } } } });
    if (!e || !e.supplierId) throw new Error("Expense does not exist");
    const supplier = await prisma.supplier.findFirst({ where: { id: e.supplierId, companyId }, select: { id: true, code: true, name: true } });
    return {
      type,
      id: e.id,
      number: e.number,
      date: e.expenseDate,
      status: e.status,
      supplier: supplier!,
      total: money(e.grossAmount),
      net: money(e.netAmount),
      tax: money(e.taxAmount),
      open: 0,
      method: e.paymentMethod,
      category: e.category.name,
      paymentMode: e.paymentMode,
      reference: e.reference,
      description: e.description,
      journalId: e.journalId,
      applications: [],
    };
  }
  const r = await prisma.itemReceipt.findFirst({
    where: { id, companyId },
    include: { supplier: supplierSelect, purchaseOrder: { select: { id: true, number: true } }, lines: { include: { item: { select: { name: true, sku: true } } }, orderBy: { lineNumber: "asc" } } },
  });
  if (!r) throw new Error("Item receipt does not exist");
  const bill = r.billId ? await prisma.apBill.findFirst({ where: { id: r.billId, companyId }, select: { id: true, billNumber: true } }) : null;
  return {
    type,
    id: r.id,
    number: r.number,
    date: r.receiptDate,
    status: r.status,
    supplier: r.supplier,
    total: money(r.value),
    open: 0,
    reference: r.purchaseOrder ? `PO ${r.purchaseOrder.number}` : null,
    purchaseOrder: r.purchaseOrder,
    bill,
    description: r.memo,
    journalId: r.journalId,
    lines: r.lines.map((l) => ({ description: l.description ?? l.item.name, sku: l.item.sku, quantity: money(l.quantity), unitCost: money(l.unitCost), value: money(l.value) })),
    applications: [],
  };
}

/** Credits that can still go against bills: unapplied credit notes, unapplied payments and unused advances. */
export async function supplierCredits(companyId: string, supplierId: string) {
  await loadSupplier(companyId, supplierId);
  const [notes, payments, advances] = await Promise.all([
    prisma.apCreditNote.findMany({ where: { companyId, supplierId, status: "POSTED", unapplied: { gt: 0.005 } }, orderBy: { noteDate: "asc" } }),
    prisma.apPayment.findMany({ where: { companyId, supplierId, status: "POSTED", unallocated: { gt: 0.005 } }, orderBy: { paymentDate: "asc" } }),
    prisma.apAdvance.findMany({ where: { companyId, supplierId, status: "POSTED", remaining: { gt: 0.005 } }, orderBy: { advanceDate: "asc" } }),
  ]);
  const rows = [
    ...notes.map((n) => ({ type: "CREDIT_NOTE" as const, id: n.id, number: n.creditNoteNumber, date: n.noteDate, description: n.reason, total: money(n.gross), available: money(n.unapplied) })),
    ...payments.map((p) => ({ type: "PAYMENT" as const, id: p.id, number: p.paymentNumber, date: p.paymentDate, description: p.description ?? p.reference, total: money(p.amount), available: money(p.unallocated) })),
    ...advances.map((a) => ({ type: "ADVANCE" as const, id: a.id, number: a.advanceNumber, date: a.advanceDate, description: a.description ?? a.reference, total: money(a.amount), available: money(a.remaining) })),
  ];
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { rows, total: roundMoney(rows.reduce((s, r) => s + r.available, 0)) };
}

const ACTIVITY_LABEL: Record<string, string> = {
  BILL: "Bill posted",
  BILL_VOID: "Bill voided",
  PAYMENT: "Payment made",
  PAYMENT_REVERSAL: "Payment reversed",
  CREDIT_NOTE: "Supplier credit recorded",
  DEBIT_NOTE: "Debit note recorded",
  ADVANCE_APPLICATION: "Advance applied",
  ADVANCE_UNAPPLY: "Advance taken off a bill",
  OPENING: "Opening balance",
};

/** Profile changes (from the audit log) and postings (from the subledger), newest first. */
export async function supplierActivity(companyId: string, supplierId: string) {
  await loadSupplier(companyId, supplierId);
  const [audits, ledger] = await Promise.all([
    prisma.auditEvent.findMany({ where: { companyId, entityType: "Supplier", entityId: supplierId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.apLedgerEntry.findMany({ where: { companyId, supplierId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const items = [
    ...audits.map((a) => {
      const after = (a.afterJson ?? {}) as Record<string, unknown>;
      const fields = Object.keys(after).filter((k) => k !== "code");
      const title =
        a.action === "CREATE"
          ? "Supplier created"
          : a.action === "DEACTIVATE"
            ? "Made inactive"
            : a.action === "ACTIVATE"
              ? "Made active"
              : a.action === "APPLY_CREDIT"
                ? "Credits applied to bills"
                : a.action === "UNAPPLY_CREDIT"
                  ? "Credit taken off a bill"
                  : "Profile updated";
      const moved = (after.applied ?? after.removed ?? []) as Array<{ number: string; billNumber: string; amount: number }>;
      return {
        id: `audit-${a.id}`,
        at: a.createdAt,
        kind: "change" as const,
        title,
        detail:
          a.action === "APPLY_CREDIT" || a.action === "UNAPPLY_CREDIT"
            ? moved.map((x) => `${x.number} → ${x.billNumber} (${x.amount})`).join(", ")
            : a.action === "UPDATE" && fields.length
              ? `Changed ${fields.map((f) => f.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}`
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
      // Positive adds to what you owe, negative reduces it.
      amount: money(e.credit) || -money(e.debit),
    })),
  ];
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 150);
}

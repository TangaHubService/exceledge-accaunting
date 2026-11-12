import { prisma } from "../../lib/prisma";

export type TransactionRow = {
  id: string;
  kind: string;
  number: string;
  date: string;
  party: string;
  amount: number;
  memo: string;
  status: string;
  projectId?: string;
  posted: boolean;
  createdAt: string;
};

export type TransactionFilter = { kind?: string; projectId?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

const COMMERCIAL_SLUGS: Record<string, string> = {
  ESTIMATE: "estimate",
  PROPOSAL: "proposal",
  SALES_ORDER: "sales-order",
  DELAYED_CHARGE: "delayed-charge",
  DELAYED_CREDIT: "delayed-credit",
  PURCHASE_ORDER: "purchase-order",
};

/** Bank activity has one table; the screens name it by what it did. */
function bankKind(type: string) {
  if (type === "TRANSFER") return "transfer";
  if (type === "RECEIPT") return "bank-deposit";
  return "cheque";
}

/**
 * One list across every document table, always derived from the records themselves so it can't drift.
 * Each source is read up to the page being asked for, then merged by date.
 */
export async function listTransactions(companyId: string, filter: TransactionFilter = {}) {
  const page = Math.max(filter.page ?? 1, 1);
  const pageSize = Math.min(filter.pageSize ?? 200, 2000);
  const take = page * pageSize;
  const dates = (field: string) =>
    filter.from || filter.to
      ? { [field]: { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}), ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59Z`) } : {}) } }
      : {};

  const [invoices, receipts, arNotes, bills, payments, apNotes, expenses, journals, bank, documents, itemReceipts, adjustments, time] = await Promise.all([
    prisma.arInvoice.findMany({ where: { companyId, ...dates("invoiceDate") }, orderBy: { invoiceDate: "desc" }, take, select: { id: true, invoiceNumber: true, invoiceDate: true, gross: true, description: true, status: true, createdAt: true, customer: { select: { name: true } } } }),
    prisma.arReceipt.findMany({ where: { companyId, ...dates("receiptDate") }, orderBy: { receiptDate: "desc" }, take, select: { id: true, receiptNumber: true, receiptDate: true, amount: true, status: true, createdAt: true, customer: { select: { name: true } } } }),
    prisma.arCreditNote.findMany({ where: { companyId, ...dates("noteDate") }, orderBy: { noteDate: "desc" }, take, select: { id: true, creditNoteNumber: true, noteDate: true, gross: true, reason: true, status: true, createdAt: true, customer: { select: { name: true } } } }),
    prisma.apBill.findMany({ where: { companyId, ...dates("billDate") }, orderBy: { billDate: "desc" }, take, select: { id: true, billNumber: true, billDate: true, gross: true, description: true, status: true, createdAt: true, supplier: { select: { name: true } } } }),
    prisma.apPayment.findMany({ where: { companyId, ...dates("paymentDate") }, orderBy: { paymentDate: "desc" }, take, select: { id: true, paymentNumber: true, paymentDate: true, amount: true, status: true, createdAt: true, supplier: { select: { name: true } } } }),
    prisma.apCreditNote.findMany({ where: { companyId, ...dates("noteDate") }, orderBy: { noteDate: "desc" }, take, select: { id: true, creditNoteNumber: true, noteDate: true, gross: true, reason: true, status: true, createdAt: true, supplier: { select: { name: true } } } }),
    prisma.expense.findMany({ where: { companyId, ...dates("expenseDate") }, orderBy: { expenseDate: "desc" }, take, select: { id: true, number: true, expenseDate: true, grossAmount: true, description: true, status: true, createdAt: true } }),
    prisma.journal.findMany({ where: { companyId, journalType: "MANUAL", ...dates("journalDate") }, orderBy: { journalDate: "desc" }, take, select: { id: true, journalNumber: true, journalDate: true, totalDebit: true, description: true, status: true, createdAt: true } }),
    prisma.bankTransaction.findMany({ where: { companyId, kind: { in: ["RECEIPT", "PAYMENT", "TRANSFER"] }, ...dates("transactionDate") }, orderBy: { transactionDate: "desc" }, take, select: { id: true, number: true, kind: true, transactionDate: true, amount: true, description: true, status: true, createdAt: true } }),
    prisma.commercialDocument.findMany({ where: { companyId, ...dates("docDate") }, orderBy: { docDate: "desc" }, take, select: { id: true, kind: true, number: true, docDate: true, total: true, memo: true, status: true, partyName: true, projectId: true, createdAt: true } }),
    prisma.itemReceipt.findMany({ where: { companyId, ...dates("receiptDate") }, orderBy: { receiptDate: "desc" }, take, select: { id: true, number: true, receiptDate: true, value: true, memo: true, status: true, createdAt: true, supplier: { select: { name: true } } } }),
    prisma.inventoryAdjustment.findMany({ where: { companyId, ...dates("adjustmentDate") }, orderBy: { adjustmentDate: "desc" }, take, select: { id: true, number: true, adjustmentDate: true, value: true, memo: true, reason: true, status: true, createdAt: true } }),
    prisma.timeActivity.findMany({ where: { companyId, ...dates("activityDate") }, orderBy: { activityDate: "desc" }, take, select: { id: true, activityDate: true, durationMinutes: true, hourlyRate: true, billable: true, notes: true, personName: true, projectId: true, createdAt: true } }),
  ]);

  const posted = (status: string) => status === "POSTED" || status === "PAID" || status === "PARTIALLY_PAID";
  const rows: TransactionRow[] = [
    ...invoices.map((r) => ({ id: r.id, kind: "invoice", number: r.invoiceNumber, date: day(r.invoiceDate), party: r.customer.name, amount: Number(r.gross), memo: r.description ?? "", status: title(r.status), posted: r.status === "POSTED", createdAt: r.createdAt.toISOString() })),
    ...receipts.map((r) => ({ id: r.id, kind: "payment", number: r.receiptNumber, date: day(r.receiptDate), party: r.customer.name, amount: Number(r.amount), memo: "", status: title(r.status), posted: true, createdAt: r.createdAt.toISOString() })),
    ...arNotes.map((r) => ({ id: r.id, kind: "credit-note", number: r.creditNoteNumber, date: day(r.noteDate), party: r.customer.name, amount: Number(r.gross), memo: r.reason, status: title(r.status), posted: true, createdAt: r.createdAt.toISOString() })),
    ...bills.map((r) => ({ id: r.id, kind: "bill", number: r.billNumber, date: day(r.billDate), party: r.supplier.name, amount: Number(r.gross), memo: r.description ?? "", status: title(r.status), posted: posted(r.status), createdAt: r.createdAt.toISOString() })),
    ...payments.map((r) => ({ id: r.id, kind: "bill-payment", number: r.paymentNumber, date: day(r.paymentDate), party: r.supplier.name, amount: Number(r.amount), memo: "", status: title(r.status), posted: true, createdAt: r.createdAt.toISOString() })),
    ...apNotes.map((r) => ({ id: r.id, kind: "supplier-credit", number: r.creditNoteNumber, date: day(r.noteDate), party: r.supplier.name, amount: Number(r.gross), memo: r.reason, status: title(r.status), posted: true, createdAt: r.createdAt.toISOString() })),
    ...expenses.map((r) => ({ id: r.id, kind: "expense", number: r.number, date: day(r.expenseDate), party: "", amount: Number(r.grossAmount), memo: r.description ?? "", status: title(r.status), posted: posted(r.status), createdAt: r.createdAt.toISOString() })),
    ...journals.map((r) => ({ id: r.id, kind: "journal", number: r.journalNumber, date: day(r.journalDate), party: "", amount: Number(r.totalDebit), memo: r.description ?? "", status: title(r.status), posted: r.status === "POSTED", createdAt: r.createdAt.toISOString() })),
    ...bank.map((r) => ({ id: r.id, kind: bankKind(String(r.kind)), number: r.number, date: day(r.transactionDate), party: "", amount: Number(r.amount), memo: r.description ?? "", status: title(String(r.status)), posted: String(r.status) === "POSTED", createdAt: r.createdAt.toISOString() })),
    ...documents.map((r) => ({ id: r.id, kind: COMMERCIAL_SLUGS[r.kind], number: r.number, date: day(r.docDate), party: r.partyName, amount: Number(r.total), memo: r.memo ?? "", status: title(r.status), projectId: r.projectId ?? undefined, posted: false, createdAt: r.createdAt.toISOString() })),
    ...itemReceipts.map((r) => ({ id: r.id, kind: "item-receipt", number: r.number, date: day(r.receiptDate), party: r.supplier.name, amount: Number(r.value), memo: r.memo ?? "", status: title(r.status), posted: true, createdAt: r.createdAt.toISOString() })),
    ...adjustments.map((r) => ({ id: r.id, kind: "inventory-adjustment", number: r.number, date: day(r.adjustmentDate), party: r.reason, amount: Math.abs(Number(r.value)), memo: r.memo ?? "", status: title(r.status), posted: r.status === "POSTED", createdAt: r.createdAt.toISOString() })),
    ...time.map((r) => ({ id: r.id, kind: "time", number: "", date: day(r.activityDate), party: r.personName, amount: r.billable && r.hourlyRate ? Math.round((Number(r.hourlyRate) * r.durationMinutes) / 0.6) / 100 : 0, memo: r.notes ?? "", status: r.billable ? "Billable" : "Not billable", projectId: r.projectId ?? undefined, posted: false, createdAt: r.createdAt.toISOString() })),
  ];

  const links = await prisma.projectLink.findMany({ where: { companyId }, select: { kind: true, sourceId: true, projectId: true } });
  // By record id alone: a sales receipt is tagged as such but listed as its invoice.
  const linked = new Map(links.map((l) => [l.sourceId, l.projectId]));
  for (const row of rows) row.projectId = row.projectId ?? linked.get(row.id);

  const q = filter.q?.toLowerCase();
  const filtered = rows
    .filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.projectId || r.projectId === filter.projectId))
    .filter((r) => !q || `${r.number} ${r.party} ${r.memo}`.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const start = (page - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), page, pageSize, hasMore: filtered.length > start + pageSize };
}

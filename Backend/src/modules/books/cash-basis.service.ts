import { money4, type BookAccountType } from "@exceledge/accounting-domain";
import { money } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { type OpenItem, payableItems, receivableItems } from "./ageing.service";
import { endOfDay, financialYearFor } from "./reports.service";

/** Journals of documents that become income or cost only when they are settled. */
const DOCUMENT_TYPES = [
  "ArInvoice", "ArInvoiceEdit", "ArInvoiceVoid", "ArDebitNote", "ArCreditNote", "ArWriteOff", "ArWriteOffReversal",
  "ApBill", "ApBillVoid", "ApCreditNote", "ApDebitNote",
];
const PNL: BookAccountType[] = ["INCOME", "OTHER_INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"];
/** A share of a document's profit and loss lines counts on a day; negative when a settlement is undone. */
type Recognition = { journalId: string; gross: number; date: Date; amount: number };

function recognitions(items: OpenItem[]): Recognition[] {
  const out: Recognition[] = [];
  for (const item of items) {
    if (!item.journalId || !(item.gross > 0) || item.voidDate) continue;
    const base = { journalId: item.journalId, gross: item.gross };
    const dated = item.settled.filter((s) => !s.until).reduce((t, s) => t + s.amount, 0);
    const undated = item.settledTotal - dated;
    if (undated > 0.005) out.push({ ...base, date: item.date, amount: undated });
    for (const s of item.settled) {
      out.push({ ...base, date: s.date, amount: s.amount });
      if (s.until) out.push({ ...base, date: s.until, amount: -s.amount });
    }
  }
  return out;
}

const later = (a: Date, b: Date) => (a > b ? a : b);

/** A credit counts when it is used: against an invoice or bill, or paid back. */
async function creditRecognitions(companyId: string, to: Date): Promise<Recognition[]> {
  const [arNotes, apNotes, refunds, reversals] = await Promise.all([
    prisma.arCreditNote.findMany({
      // A refund made in the ERP posts with its money, so it already counts on its day.
      where: { companyId, sourceModule: null, noteDate: { lte: to }, journalId: { not: null }, OR: [{ status: "POSTED" }, { kind: "WRITE_OFF" }] },
      include: { invoice: { select: { invoiceDate: true } }, applications: { include: { invoice: { select: { invoiceDate: true } } } } },
    }),
    prisma.apCreditNote.findMany({
      where: { companyId, noteDate: { lte: to }, journalId: { not: null }, status: "POSTED" },
      include: { bill: { select: { billDate: true } }, applications: { include: { bill: { select: { billDate: true } } } } },
    }),
    prisma.arRefund.findMany({ where: { companyId, refundDate: { lte: to } } }),
    prisma.journal.findMany({ where: { companyId, status: "POSTED", sourceDocumentType: { in: ["ArWriteOffReversal", "ArRefundReversal"] } }, select: { sourceDocumentId: true, journalDate: true } }),
  ]);
  const undone = new Map(reversals.map((r) => [r.sourceDocumentId ?? "", r.journalDate]));
  const out: Recognition[] = [];
  for (const n of arNotes) {
    const base = { journalId: n.journalId!, gross: money(n.gross) };
    let used = 0;
    for (const a of n.applications) {
      used += money(a.amount);
      out.push({ ...base, date: later(n.noteDate, a.invoice.invoiceDate), amount: money(a.amount) });
    }
    if (n.invoice) {
      const onIssue = money(n.gross) - money(n.unapplied) - used;
      if (onIssue > 0.005) {
        out.push({ ...base, date: later(n.noteDate, n.invoice.invoiceDate), amount: onIssue });
        const until = n.status === "POSTED" ? undefined : undone.get(n.id);
        if (until) out.push({ ...base, date: until, amount: -onIssue });
      }
    }
    for (const r of refunds) {
      for (const source of r.sources as Array<{ source: string; sourceId: string; amount: number }>) {
        if (source.source !== "CREDIT_NOTE" || source.sourceId !== n.id) continue;
        out.push({ ...base, date: r.refundDate, amount: source.amount });
        const until = r.status === "POSTED" ? undefined : undone.get(r.id);
        if (until) out.push({ ...base, date: until, amount: -source.amount });
      }
    }
  }
  for (const n of apNotes) {
    const base = { journalId: n.journalId!, gross: money(n.gross) };
    let used = 0;
    for (const a of n.applications) {
      used += money(a.amount);
      out.push({ ...base, date: later(n.noteDate, a.bill.billDate), amount: money(a.amount) });
    }
    const onIssue = money(n.gross) - money(n.unapplied) - used;
    if (n.bill && onIssue > 0.005) out.push({ ...base, date: later(n.noteDate, n.bill.billDate), amount: onIssue });
  }
  return out;
}

/**
 * Profit and loss on the cash basis: income when customers pay, costs when suppliers are paid. Each payment brings in
 * the same share of every income and cost line of the document it settles. Money received or paid that is not applied
 * to a document yet is shown on its own line. Cost of stock sold stays on the day it left, as in QuickBooks.
 */
export async function cashBasisProfit(companyId: string, opts: { from?: Date; to?: Date } = {}) {
  const to = opts.to ?? endOfDay(new Date());
  const from = opts.from ?? (await financialYearFor(companyId, to)).start;
  if (from > to) throw new Error("from must be on or before to");
  const [accounts, ar, ap, credits] = await Promise.all([
    prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true, type: true } }),
    receivableItems(companyId, to),
    payableItems(companyId, to),
    creditRecognitions(companyId, to),
  ]);
  const pnl = new Set(accounts.filter((a) => PNL.includes(a.type as BookAccountType)).map((a) => a.id));
  const net = new Map<string, number>(); // credit-positive
  const add = (accountId: string, amount: number) => net.set(accountId, (net.get(accountId) ?? 0) + amount);

  const documentJournals = await prisma.journal.findMany({
    where: { companyId, status: { in: ["POSTED", "REVERSED"] }, OR: [{ sourceDocumentType: { in: DOCUMENT_TYPES } }, // A voided one keeps both its journals in, and they cancel.
      { id: { in: [...ar, ...ap].flatMap((i) => (i.voidDate ? [] : (i.journalId ?? []))) } }] },
    select: { id: true, sourceModule: true, sourceDocumentType: true },
  });
  // A sale or bill from the ERP, and an expense on account, post once for both sides; they wait for settlement as well.
  const excluded = new Set(documentJournals.map((j) => j.id));
  const straight = await prisma.glEntry.groupBy({
    by: ["accountId", "journalId"],
    where: { companyId, accountId: { in: [...pnl] }, transactionDate: { gte: from, lte: to }, OR: [{ sourceDocumentType: null }, { sourceDocumentType: { not: "YEAR_END_CLOSE" } }] },
    _sum: { debit: true, credit: true },
  });
  for (const r of straight) if (!excluded.has(r.journalId)) add(r.accountId, Number(r._sum.credit ?? 0) - Number(r._sum.debit ?? 0));

  const due = [...recognitions(ar), ...recognitions(ap), ...credits].filter((r) => r.date >= from && r.date <= to);
  const lines = await prisma.glEntry.findMany({
    where: { companyId, journalId: { in: [...new Set(due.map((d) => d.journalId))] }, accountId: { in: [...pnl] } },
    select: { journalId: true, accountId: true, debit: true, credit: true },
  });
  const byJournal = new Map<string, Array<{ accountId: string; amount: number }>>();
  for (const l of lines) {
    const list = byJournal.get(l.journalId) ?? [];
    list.push({ accountId: l.accountId, amount: Number(l.credit) - Number(l.debit) });
    byJournal.set(l.journalId, list);
  }
  for (const d of due) for (const l of byJournal.get(d.journalId) ?? []) add(l.accountId, (l.amount * d.amount) / d.gross);

  const unapplied = await unappliedCash(companyId, from, to);
  const section = (types: BookAccountType[], sign: 1 | -1) =>
    accounts
      .filter((a) => types.includes(a.type as BookAccountType) && Math.abs(net.get(a.id) ?? 0) > 0.005)
      .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amount: money4(sign * net.get(a.id)!) }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const extra = (name: string, amount: number) => (Math.abs(amount) > 0.005 ? [{ accountId: "", code: "", name, amount: money4(amount) }] : []);
  const income = [...section(["INCOME", "OTHER_INCOME"], 1), ...extra("Payments received, not applied yet", unapplied.received)];
  const costOfSales = section(["COST_OF_SALES"], -1);
  const expenses = [...section(["EXPENSE", "OTHER_EXPENSE"], -1), ...extra("Payments made, not applied yet", unapplied.paid)];
  const total = (rows: Array<{ amount: number }>) => money4(rows.reduce((s, r) => s + r.amount, 0));
  return {
    from,
    to,
    income,
    costOfSales,
    expenses,
    totals: { income: total(income), costOfSales: total(costOfSales), expenses: total(expenses), profit: money4(total(income) - total(costOfSales) - total(expenses)) },
    notes: [
      "Income counts when customers pay and costs when suppliers are paid. VAT collected and paid is not part of it.",
      "Cost of stock sold counts on the day the stock left.",
      "Profit and loss only: the balance sheet and other reports stay on the accrual basis.",
    ],
  };
}

/** Receipts and supplier payments left on account, in functional currency, by the day the money moved. */
async function unappliedCash(companyId: string, from: Date, to: Date) {
  const during = { gte: from, lte: to };
  const [receipts, payments] = await Promise.all([
    prisma.arReceipt.findMany({ where: { companyId, status: "POSTED", receiptDate: during, unallocated: { gt: 0 } }, select: { unallocated: true, exchangeRate: true } }),
    prisma.apPayment.findMany({ where: { companyId, status: "POSTED", paymentDate: during, unallocated: { gt: 0 } }, select: { unallocated: true, exchangeRate: true } }),
  ]);
  const sum = (rows: Array<{ unallocated: unknown; exchangeRate: unknown }>) => rows.reduce((s, r) => s + money(r.unallocated as number) * Number(r.exchangeRate), 0);
  return { received: sum(receipts), paid: sum(payments) };
}

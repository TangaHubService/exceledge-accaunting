import { ageingBucketKey, AGEING_BUCKETS, roundMoney } from "@exceledge/accounting-domain";
import { controlAccounts, functionalCurrencyOf, money } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { endOfDay } from "./reports.service";

type Side = "receivables" | "payables";
type BucketKey = (typeof AGEING_BUCKETS)[number]["key"];
/** One document as it stood: what it was for, and what was settled on which date. */
export type OpenItem = {
  partyId: string;
  journalId: string | null;
  documentId: string;
  number: string;
  partyReference?: string | null;
  date: Date;
  dueDate: Date;
  gross: number;
  /** `until`: the day a settlement was reversed. It no longer counts in settledTotal. */
  /** paid + credited on the document; whatever no dated application explains counts from the document date */
  settledTotal: number;
  settled: Array<{ date: Date; amount: number; until?: Date }>;
  voidDate?: Date;
  currency: string;
  rate: number;
};

export type AgedLine = {
  partyId: string;
  partyCode: string;
  partyName: string;
  documentId: string | null;
  number: string;
  partyReference: string | null;
  dueDate: Date;
  /** Functional currency; negative for credit not yet used */
  outstanding: number;
  currency: string;
  outstandingForeign: number | null;
  bucket: BucketKey;
  kind: "DOCUMENT" | "ON_ACCOUNT";
};

/** The later of the two: a credit counts against a document only once both exist. */
const later = (a: Date, b: Date) => (a > b ? a : b);

/** When each reversed document was reversed, by its id. */
async function reversalDates(companyId: string, types: string[]) {
  const rows = await prisma.journal.findMany({ where: { companyId, sourceDocumentType: { in: types }, status: "POSTED" }, select: { sourceDocumentId: true, journalDate: true } });
  return new Map(rows.map((r) => [r.sourceDocumentId ?? "", r.journalDate]));
}

export async function receivableItems(companyId: string, to: Date): Promise<OpenItem[]> {
  const [invoices, debitNotes, depositAllocations, voids] = await Promise.all([
    prisma.arInvoice.findMany({
      where: { companyId, status: { in: ["POSTED", "REVERSED"] }, invoiceDate: { lte: to } },
      include: {
        allocations: { include: { receipt: { select: { id: true, receiptDate: true, status: true } } } },
        creditApplications: { include: { creditNote: { select: { noteDate: true } } } },
        creditNotes: { where: { OR: [{ status: "POSTED" }, { kind: "WRITE_OFF" }] }, select: { id: true, status: true, noteDate: true, gross: true, unapplied: true, applications: { select: { amount: true } } } },
      },
    }),
    prisma.arDebitNote.findMany({ where: { companyId, status: "POSTED", noteDate: { lte: to } } }),
    prisma.arDepositAllocation.findMany({ where: { deposit: { companyId } }, select: { invoiceId: true, amount: true, journalId: true, createdAt: true } }),
    prisma.journal.findMany({ where: { companyId, sourceDocumentType: "ArInvoiceVoid", status: "POSTED" }, select: { sourceDocumentId: true, journalDate: true } }),
  ]);
  const erpNotes = invoices.flatMap((i) => i.creditNotes.map((n) => n.id));
  const paidBack = new Map(
    (await prisma.arLedgerEntry.findMany({ where: { companyId, docType: "REFUND", docId: { in: erpNotes } }, select: { docId: true, debit: true } })).map((e) => [e.docId, money(e.debit)]),
  );
  const reversed = await reversalDates(companyId, ["ArReceiptReversal", "ArWriteOffReversal"]);
  const journals = new Map(
    (await prisma.journal.findMany({ where: { companyId, id: { in: depositAllocations.flatMap((d) => d.journalId ?? []) } }, select: { id: true, journalDate: true } })).map((j) => [j.id, j.journalDate]),
  );
  const deposits = new Map<string, Array<{ date: Date; amount: number }>>();
  for (const d of depositAllocations) {
    const list = deposits.get(d.invoiceId) ?? [];
    list.push({ date: (d.journalId && journals.get(d.journalId)) || d.createdAt, amount: money(d.amount) });
    deposits.set(d.invoiceId, list);
  }
  const voided = new Map(voids.map((v) => [v.sourceDocumentId ?? "", v.journalDate]));
  return [
    ...invoices
      .filter((i) => i.status === "POSTED" || voided.has(i.id))
      .map((i) => ({
        partyId: i.customerId,
        journalId: i.journalId,
        documentId: i.id,
        number: i.invoiceNumber,
        date: i.invoiceDate,
        dueDate: i.dueDate,
        gross: money(i.gross),
        settledTotal: money(i.amountPaid) + money(i.amountCredited),
        settled: [
          ...i.allocations.filter((a) => a.receipt.status === "POSTED" || reversed.has(a.receipt.id)).map((a) => ({ date: later(a.receipt.receiptDate, i.invoiceDate), amount: money(a.amount), until: a.receipt.status === "POSTED" ? undefined : reversed.get(a.receipt.id) })),
          ...i.creditApplications.map((a) => ({ date: later(a.creditNote.noteDate, i.invoiceDate), amount: money(a.amount) })),
          ...i.creditNotes.filter((n) => n.status === "POSTED" || reversed.has(n.id)).flatMap((n) => {
            const amount = roundMoney(money(n.gross) - money(n.unapplied) - n.applications.reduce((s, a) => s + money(a.amount), 0));
            const until = n.status === "POSTED" ? undefined : reversed.get(n.id);
            // Money paid back for an ERP sale had settled it since the sale; the refund only swapped payment for credit.
            const wasPaid = Math.min(paidBack.get(n.id) ?? 0, amount);
            return [
              { date: later(n.noteDate, i.invoiceDate), until, amount: roundMoney(amount - wasPaid) },
              ...(wasPaid > 0 ? [{ date: i.invoiceDate, until, amount: wasPaid }] : []),
            ];
          }),
          ...(deposits.get(i.id) ?? []),
        ],
        voidDate: i.status === "REVERSED" ? voided.get(i.id) : undefined,
        currency: i.currency.toUpperCase(),
        rate: Number(i.exchangeRate),
      })),
    ...debitNotes.map((n) => ({
      partyId: n.customerId,
      journalId: n.journalId,
      documentId: n.id,
      number: n.debitNoteNumber,
      date: n.noteDate,
      dueDate: n.dueDate,
      gross: money(n.gross),
      settledTotal: money(n.amountSettled),
      settled: [],
      currency: n.currency.toUpperCase(),
      rate: Number(n.exchangeRate),
    })),
  ];
}

export async function payableItems(companyId: string, to: Date): Promise<OpenItem[]> {
  const bills = await prisma.apBill.findMany({
    where: { companyId, billDate: { lte: to }, OR: [{ status: "POSTED" }, { voidJournalId: { not: null } }] },
    include: {
      allocations: { include: { payment: { select: { id: true, paymentDate: true, status: true } } } },
      creditApplications: { include: { creditNote: { select: { noteDate: true } } } },
      creditNotes: { where: { status: "POSTED" }, select: { noteDate: true, gross: true, unapplied: true, applications: { select: { amount: true } } } },
      advanceAllocations: { select: { amount: true, journalId: true, createdAt: true } },
    },
  });
  const journalIds = bills.flatMap((b) => [b.voidJournalId, ...b.advanceAllocations.map((a) => a.journalId)]).filter((x): x is string => Boolean(x));
  const journals = new Map((await prisma.journal.findMany({ where: { companyId, id: { in: journalIds } }, select: { id: true, journalDate: true } })).map((j) => [j.id, j.journalDate]));
  const reversed = await reversalDates(companyId, ["ApPaymentReversal"]);
  return bills.map((b) => ({
    partyId: b.supplierId,
    journalId: b.journalId,
    documentId: b.id,
    number: b.billNumber,
    partyReference: b.supplierInvoiceNumber,
    date: b.billDate,
    dueDate: b.dueDate,
    gross: money(b.gross),
    settledTotal: money(b.amountPaid) + money(b.amountCredited),
    settled: [
      ...b.allocations.filter((a) => a.payment.status === "POSTED" || reversed.has(a.payment.id)).map((a) => ({ date: later(a.payment.paymentDate, b.billDate), amount: money(a.amount), until: a.payment.status === "POSTED" ? undefined : reversed.get(a.payment.id) })),
      ...b.creditApplications.map((a) => ({ date: later(a.creditNote.noteDate, b.billDate), amount: money(a.amount) })),
      ...b.creditNotes.map((n) => ({ date: later(n.noteDate, b.billDate), amount: roundMoney(money(n.gross) - money(n.unapplied) - n.applications.reduce((s, a) => s + money(a.amount), 0)) })),
      ...b.advanceAllocations.map((a) => ({ date: (a.journalId && journals.get(a.journalId)) || a.createdAt, amount: money(a.amount) })),
    ],
    voidDate: b.status === "POSTED" ? undefined : b.voidJournalId ? journals.get(b.voidJournalId) : undefined,
    currency: b.currency.toUpperCase(),
    rate: Number(b.exchangeRate),
  }));
}

function outstandingAt(item: OpenItem, to: Date) {
  if (item.voidDate && item.voidDate <= to) return 0;
  const dated = item.settled.filter((a) => !a.until).reduce((s, a) => s + a.amount, 0);
  const undated = Math.max(0, item.settledTotal - dated);
  const settled = undated + item.settled.filter((a) => a.date <= to && (!a.until || a.until > to)).reduce((s, a) => s + a.amount, 0);
  return roundMoney(item.gross - settled);
}

/** Control-account balance per party at `to`, in functional currency (what the party owes, or is owed). */
async function partyBalances(companyId: string, side: Side, to: Date) {
  const ids = [...(await controlAccounts(companyId))].filter(([, k]) => k === side).map(([id]) => id);
  const balances = new Map<string, number>();
  if (!ids.length) return balances;
  const sign = side === "receivables" ? 1 : -1;
  const add = (party: string, amount: number) => balances.set(party, (balances.get(party) ?? 0) + sign * amount);
  const rows = await prisma.$queryRaw<Array<{ party: string | null; journalId: string | null; net: number }>>`
    SELECT r.party, CASE WHEN r.party IS NULL THEN r."journalId" END AS "journalId", SUM(r.net)::float8 AS net
    FROM (
      SELECT CASE WHEN ${side} = 'receivables' THEN l."customerRef" ELSE l."supplierRef" END AS party, g."journalId", g."debit" - g."credit" AS net
      FROM "gl_entries" g LEFT JOIN "journal_lines" l ON l.id = g."journalLineId"
      WHERE g."companyId" = ${companyId} AND g."accountId" = ANY(${ids}) AND g."transactionDate" <= ${to.toISOString()}::timestamp
    ) r
    GROUP BY 1, 2`;
  // Journals from ERP events carry no party on the line; the document they posted does.
  const loose = rows.filter((r) => !r.party && r.journalId).map((r) => r.journalId!);
  const owner = new Map<string, string>();
  if (loose.length) {
    const where = { companyId, journalId: { in: loose } };
    if (side === "receivables") {
      const select = { journalId: true, customerId: true } as const;
      const found = await Promise.all([
        prisma.arInvoice.findMany({ where, select }),
        prisma.arReceipt.findMany({ where, select }),
        prisma.arCreditNote.findMany({ where, select }),
        prisma.arDebitNote.findMany({ where, select }),
      ]);
      for (const d of found.flat()) owner.set(d.journalId!, d.customerId);
    } else {
      const select = { journalId: true, supplierId: true } as const;
      const found = await Promise.all([prisma.apBill.findMany({ where, select }), prisma.apPayment.findMany({ where, select }), prisma.apCreditNote.findMany({ where, select })]);
      for (const d of found.flat()) owner.set(d.journalId!, d.supplierId);
    }
  }
  for (const r of rows) add(r.party ?? owner.get(r.journalId ?? "") ?? "", r.net);
  return balances;
}

/**
 * Who owes what (or is owed) at the end of `asOf`, in functional currency.
 *
 * Open documents are aged by due date. Whatever else is on a party's account at that date (payments and credits
 * not used yet, amounts with no document) is one extra line, so the total always equals the control account.
 */
export async function agedBalances(companyId: string, side: Side, asOf?: Date | string) {
  const given = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(given.getTime())) throw new Error("asOf must be a yyyy-mm-dd date");
  const to = endOfDay(given);
  const [items, balances, functional, parties] = await Promise.all([
    side === "receivables" ? receivableItems(companyId, to) : payableItems(companyId, to),
    partyBalances(companyId, side, to),
    functionalCurrencyOf(companyId),
    side === "receivables"
      ? prisma.customer.findMany({ where: { companyId }, select: { id: true, code: true, name: true } })
      : prisma.supplier.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
  ]);
  const party = new Map(parties.map((p) => [p.id, p]));
  const lines: AgedLine[] = [];
  const documents = new Map<string, number>();
  for (const item of items) {
    const open = outstandingAt(item, to);
    if (open <= 0.0001) continue;
    const outstanding = roundMoney(open * item.rate);
    documents.set(item.partyId, (documents.get(item.partyId) ?? 0) + outstanding);
    const p = party.get(item.partyId);
    lines.push({
      partyId: item.partyId,
      partyCode: p?.code ?? "",
      partyName: p?.name ?? "",
      documentId: item.documentId,
      number: item.number,
      partyReference: item.partyReference ?? null,
      dueDate: item.dueDate,
      outstanding,
      currency: item.currency,
      outstandingForeign: item.currency === functional ? null : open,
      bucket: ageingBucketKey(item.dueDate, given),
      kind: "DOCUMENT",
    });
  }
  for (const id of new Set([...balances.keys(), ...documents.keys()])) {
    const rest = roundMoney((balances.get(id) ?? 0) - (documents.get(id) ?? 0));
    if (Math.abs(rest) < 0.005) continue;
    const p = party.get(id);
    lines.push({
      partyId: id,
      partyCode: p?.code ?? "",
      partyName: p?.name ?? (side === "receivables" ? "Not linked to a customer" : "Not linked to a supplier"),
      documentId: null,
      number: rest < 0 ? "Unapplied payments and credits" : "Other balance",
      partyReference: null,
      dueDate: given,
      outstanding: rest,
      currency: functional,
      outstandingForeign: null,
      bucket: "CURRENT",
      kind: "ON_ACCOUNT",
    });
  }
  const buckets = AGEING_BUCKETS.map((b) => ({ ...b, amount: roundMoney(lines.filter((l) => l.bucket === b.key).reduce((s, l) => s + l.outstanding, 0)) }));
  return { asOf: given, buckets, lines, total: roundMoney(lines.reduce((s, l) => s + l.outstanding, 0)) };
}

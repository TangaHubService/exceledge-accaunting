/** Wave C: invoice and bill line items with tax codes. */
import type { DefaultAccountMap, JournalLineDraft } from "./index";

export interface DocumentLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxCode?: string | null;
  accountId?: string | null;
}

export interface TaxCodeRate {
  code: string;
  ratePercent: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  glAccountId?: string | null;
}

export interface ComputedDocumentLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  net: number;
  taxCode: string | null;
  taxRate: number;
  tax: number;
  accountId: string | null;
  taxAccountId: string | null;
}

const round = (value: number) => Math.round((Number(value) || 0) * 10000) / 10000;
/** Line amounts and tax are charged to the cent, line by line, as they appear on the document. */
const cents = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Prices each line: quantity × unit price less the line discount, then tax at the rate of its tax code on the
 * document date. Codes must exist, be active and be in force on that date.
 */
export function computeDocumentLines(lines: DocumentLineInput[], taxCodes: TaxCodeRate[], documentDate: Date) {
  if (!lines.length) throw new Error("Add at least one line");
  if (lines.length > 200) throw new Error("A document can have at most 200 lines");
  const byCode = new Map(taxCodes.map((code) => [code.code.toUpperCase(), code]));
  const computed: ComputedDocumentLine[] = lines.map((line, index) => {
    const label = `Line ${index + 1}`;
    const description = String(line.description ?? "").trim();
    if (!description) throw new Error(`${label} needs a description`);
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const discount = cents(Number(line.discount ?? 0));
    if (!(quantity > 0)) throw new Error(`${label}: quantity must be positive`);
    if (!(unitPrice >= 0)) throw new Error(`${label}: unit price cannot be negative`);
    if (discount < 0) throw new Error(`${label}: discount cannot be negative`);
    const gross = round(quantity * unitPrice);
    if (discount - gross > 0.0001) throw new Error(`${label}: discount is more than the line amount`);
    const net = cents(gross - discount);
    let taxRate = 0;
    let taxCode: string | null = null;
    let taxAccountId: string | null = null;
    if (line.taxCode?.trim()) {
      const code = byCode.get(String(line.taxCode).trim().toUpperCase());
      if (!code) throw new Error(`${label}: tax code ${line.taxCode} does not exist`);
      if (!code.isActive) throw new Error(`${label}: tax code ${code.code} is inactive`);
      if (code.effectiveFrom > documentDate || (code.effectiveTo && code.effectiveTo < documentDate)) {
        throw new Error(`${label}: tax code ${code.code} is not in force on the document date`);
      }
      taxRate = Number(code.ratePercent);
      taxCode = code.code;
      taxAccountId = code.glAccountId ?? null;
    }
    return {
      lineNumber: index + 1,
      description,
      quantity,
      unitPrice,
      discount,
      net,
      taxCode,
      taxRate,
      tax: cents((net * taxRate) / 100),
      accountId: line.accountId || null,
      taxAccountId,
    };
  });
  const net = round(computed.reduce((s, l) => s + l.net, 0));
  const tax = round(computed.reduce((s, l) => s + l.tax, 0));
  if (net + tax <= 0) throw new Error("Document total must be positive");
  return { lines: computed, net, tax, gross: round(net + tax) };
}

function grouped(entries: Array<{ accountId: string; amount: number }>) {
  const map = new Map<string, number>();
  for (const e of entries) if (e.amount) map.set(e.accountId, round((map.get(e.accountId) ?? 0) + e.amount));
  return [...map.entries()].filter(([, amount]) => amount !== 0);
}

function balanced(lines: JournalLineDraft[]) {
  const debit = round(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debit - credit) > 0.0001) throw new Error(`Journal is not balanced: debits ${debit}, credits ${credit}`);
  return lines;
}

/** A lined sales invoice: receivables for the total, revenue by line account, VAT by tax account. */
export function buildLinedInvoiceJournal(
  defaults: DefaultAccountMap,
  input: { lines: ComputedDocumentLine[]; arAccountId?: string | null; salesAccountId?: string | null },
): JournalLineDraft[] {
  const ar = input.arAccountId || defaults.accountsReceivableId;
  if (!ar) throw new Error("Accounts receivable account is not configured");
  const fallbackRevenue = input.salesAccountId || defaults.salesRevenueId;
  const revenue = grouped(
    input.lines.map((l) => {
      const accountId = l.accountId || fallbackRevenue;
      if (!accountId) throw new Error("Sales revenue account is not configured");
      return { accountId, amount: l.net };
    }),
  );
  const taxes = grouped(
    input.lines.map((l) => {
      const accountId = l.taxAccountId || defaults.outputTaxPayableId;
      if (l.tax && !accountId) throw new Error("Output tax account is not configured");
      return { accountId: accountId ?? "", amount: l.tax };
    }),
  );
  const total = round(input.lines.reduce((s, l) => s + l.net + l.tax, 0));
  return balanced([
    { accountId: ar, description: "Accounts receivable", debit: total, credit: 0 },
    ...revenue.map(([accountId, amount]) => ({ accountId, description: "Sales", debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0 })),
    ...taxes.map(([accountId, amount]) => ({ accountId, description: "Output VAT", debit: 0, credit: amount })),
  ]);
}

/** A lined supplier bill: expense or stock by line account, input VAT by tax account, payables for the total. */
export function buildLinedBillJournal(
  defaults: DefaultAccountMap,
  input: { lines: ComputedDocumentLine[]; apAccountId?: string | null; expenseAccountId?: string | null },
): JournalLineDraft[] {
  const ap = input.apAccountId || defaults.accountsPayableId;
  if (!ap) throw new Error("Accounts payable account is not configured");
  const fallbackExpense = input.expenseAccountId || defaults.purchasesId;
  const expenses = grouped(
    input.lines.map((l) => {
      const accountId = l.accountId || fallbackExpense;
      if (!accountId) throw new Error("Purchases account is not configured");
      return { accountId, amount: l.net };
    }),
  );
  const taxes = grouped(
    input.lines.map((l) => {
      const accountId = l.taxAccountId || defaults.inputTaxReceivableId;
      if (l.tax && !accountId) throw new Error("Input tax account is not configured");
      return { accountId: accountId ?? "", amount: l.tax };
    }),
  );
  const total = round(input.lines.reduce((s, l) => s + l.net + l.tax, 0));
  return balanced([
    ...expenses.map(([accountId, amount]) => ({ accountId, description: "Purchases / expense", debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 })),
    ...taxes.map(([accountId, amount]) => ({ accountId, description: "Input VAT", debit: amount, credit: 0 })),
    { accountId: ap, description: "Accounts payable", debit: 0, credit: total },
  ]);
}

export interface StatementEntry {
  entryDate: Date;
  debit: number;
  credit: number;
}

/**
 * A party statement for a period: the balance brought forward from before it, the period's entries with a
 * running balance, and the closing balance. `sign` is +1 for customers (debits raise the balance) and -1 for
 * suppliers (credits raise it).
 */
export function periodStatement<T extends StatementEntry>(entries: T[], from: Date, to: Date, sign: 1 | -1) {
  if (from > to) throw new Error("The start date is after the end date");
  let opening = 0;
  const inPeriod: Array<T & { balance: number }> = [];
  let running = 0;
  const sorted = [...entries].sort((a, b) => a.entryDate.getTime() - b.entryDate.getTime());
  for (const entry of sorted) {
    const movement = round(sign * (Number(entry.debit) - Number(entry.credit)));
    if (entry.entryDate < from) {
      opening = round(opening + movement);
      continue;
    }
    if (entry.entryDate > to) continue;
    if (!inPeriod.length) running = opening;
    running = round(running + movement);
    inPeriod.push({ ...entry, balance: running });
  }
  const totalDebit = round(inPeriod.reduce((s, e) => s + Number(e.debit), 0));
  const totalCredit = round(inPeriod.reduce((s, e) => s + Number(e.credit), 0));
  return { opening, entries: inPeriod, totalDebit, totalCredit, closing: inPeriod.length ? running : opening };
}

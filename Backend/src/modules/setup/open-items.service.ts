import { roundMoney, type JournalLineDraft } from "@exceledge/accounting-domain";
import { z } from "zod";
import { defaultsFor, functionalCurrencyOf, money, nextNumber, openingContraAccount, resolveDocumentMoney } from "../../lib/documents";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal } from "../journals/journal.service";

type Actor = { erpUserId?: number; erpRole?: string };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be yyyy-mm-dd");
/** One open invoice or bill from the old system: what is still owed, not its original total. Negative means a credit. */
export const openItemRow = z.object({ name: z.string().trim().max(200).default(""), number: z.string().trim().max(60).default(""), date: z.string().trim().default(""), dueDate: z.string().trim().optional(), amount: z.number().optional(), currency: z.string().trim().max(3).optional(), memo: z.string().trim().max(500).optional() });
export const openItemsBody = z.object({ side: z.enum(["customers", "suppliers"]), dryRun: z.boolean().optional(), rows: z.array(openItemRow).min(1, "The file has no rows").max(2000, "At most 2,000 rows at a time") });

async function importOne(companyId: string, side: "customers" | "suppliers", row: z.infer<typeof openItemRow>, seen: Set<string>, actor: Actor) {
  const name = row.name;
  if (!name) throw new Error("Name is required");
  if (!row.number) throw new Error("The document number is required");
  const date = new Date(`${day.parse(row.date)}T00:00:00Z`);
  const dueDate = row.dueDate ? new Date(`${day.parse(row.dueDate)}T00:00:00Z`) : date;
  if (Number.isNaN(date.getTime()) || Number.isNaN(dueDate.getTime())) throw new Error("That date doesn't exist");
  const amount = roundMoney(row.amount ?? 0);
  if (!amount) throw new Error("The open balance is required");
  const party =
    side === "customers"
      ? await prisma.customer.findMany({ where: { companyId, OR: [{ name: { equals: name, mode: "insensitive" } }, { code: name }] } })
      : await prisma.supplier.findMany({ where: { companyId, OR: [{ name: { equals: name, mode: "insensitive" } }, { code: name }] } });
  if (party.length !== 1) throw new Error(party.length ? `More than one match for ${name}` : `${name} isn't in the ${side} list; import them first`);
  const p = party[0] as (typeof party)[number] & { arAccountId?: string | null; apAccountId?: string | null };
  const key = `${p.id}|${row.number.toLowerCase()}`;
  if (seen.has(key)) throw new Error(`${row.number} appears twice in the file`);
  seen.add(key);
  await lockForTransaction(`open-item:${side}:${p.id}:${row.number.toLowerCase()}`);
  const already =
    side === "customers"
      ? (await prisma.arInvoice.count({ where: { companyId, customerId: p.id, OR: [{ invoiceNumber: row.number }, { sourceDocumentNumber: row.number }] } })) + (await prisma.arCreditNote.count({ where: { companyId, customerId: p.id, sourceDocumentType: "OpenItemImport", sourceDocumentId: row.number } }))
      : (await prisma.apBill.count({ where: { companyId, supplierId: p.id, supplierInvoiceNumber: row.number } })) + (await prisma.apCreditNote.count({ where: { companyId, supplierId: p.id, supplierReference: row.number } }));
  if (already) throw new Error(`${row.number} is already recorded for ${name}`);
  const fx = await resolveDocumentMoney(companyId, { documentCurrency: row.currency?.toUpperCase() || undefined, partyCurrency: p.currency, date });

  const defaults = await defaultsFor(companyId);
  const control = side === "customers" ? p.arAccountId || defaults.accountsReceivableId : p.apAccountId || defaults.accountsPayableId;
  const contra = await openingContraAccount(companyId);
  if (!control || !contra) throw new Error("Set up the receivables or payables and opening balance equity accounts first");
  const size = Math.abs(amount);
  // A customer's debt and a supplier's credit both debit the control account.
  const debitControl = (side === "customers") === amount > 0;
  const ref = side === "customers" ? { customerRef: p.id } : { supplierRef: p.id };
  const line = (accountId: string, debit: boolean): JournalLineDraft => ({ accountId, description: `Open ${row.number}`, debit: debit ? size : 0, credit: debit ? 0 : size, ...ref }) as JournalLineDraft;
  const type = side === "customers" ? "CustomerOpening" : "SupplierOpening";
  const journal = await createAndPostJournal(
    companyId,
    { journalDate: date, journalType: "AUTOMATIC", description: `Opening ${row.number} ${name}`, referenceNumber: row.number, currencyCode: fx.currency, exchangeRate: fx.rate, sourceModule: side === "customers" ? "AR" : "AP", sourceDocumentType: type, sourceDocumentId: p.id, sourceDocumentNumber: row.number, status: "APPROVED", lines: [line(control, debitControl), line(contra, !debitControl)] },
    actor,
  );
  const description = row.memo || `Opening ${row.number}`;
  let docId: string;
  if (side === "customers") {
    docId =
      amount > 0
        ? (await prisma.arInvoice.create({ data: { companyId, customerId: p.id, invoiceNumber: await nextNumber(companyId, "AR_INVOICE", "INV"), invoiceDate: date, dueDate, currency: fx.currency, exchangeRate: fx.rate, net: size, gross: size, description, journalId: journal.id, sourceModule: "AR", sourceDocumentType: type, sourceDocumentId: p.id, sourceDocumentNumber: row.number, createdByErpUserId: actor.erpUserId } })).id
        : (await prisma.arCreditNote.create({ data: { companyId, customerId: p.id, creditNoteNumber: await nextNumber(companyId, "AR_CREDIT_NOTE", "CN"), noteDate: date, reason: description, currency: fx.currency, exchangeRate: fx.rate, net: size, gross: size, unapplied: size, journalId: journal.id, sourceDocumentType: "OpenItemImport", sourceDocumentId: row.number, createdByErpUserId: actor.erpUserId } })).id;
    const c = await prisma.customer.update({ where: { id: p.id }, data: { balance: { increment: amount } } });
    await prisma.arLedgerEntry.create({ data: { companyId, customerId: p.id, entryDate: date, docType: "OPENING", docId, docNumber: row.number, description, debit: amount > 0 ? size : 0, credit: amount > 0 ? 0 : size, runningBalance: c.balance } });
  } else {
    docId =
      amount > 0
        ? (await prisma.apBill.create({ data: { companyId, supplierId: p.id, billNumber: await nextNumber(companyId, "AP_BILL", "BILL"), supplierInvoiceNumber: row.number, billDate: date, dueDate, currency: fx.currency, exchangeRate: fx.rate, net: size, gross: size, description, journalId: journal.id, sourceModule: "AP", sourceDocumentType: type, sourceDocumentId: p.id, sourceDocumentNumber: row.number, createdByErpUserId: actor.erpUserId } })).id
        : (await prisma.apCreditNote.create({ data: { companyId, supplierId: p.id, creditNoteNumber: await nextNumber(companyId, "AP_CREDIT_NOTE", "SCN"), supplierReference: row.number, noteDate: date, reason: description, currency: fx.currency, exchangeRate: fx.rate, net: size, gross: size, unapplied: size, journalId: journal.id, createdByErpUserId: actor.erpUserId } })).id;
    const s = await prisma.supplier.update({ where: { id: p.id }, data: { balance: { increment: amount } } });
    await prisma.apLedgerEntry.create({ data: { companyId, supplierId: p.id, entryDate: date, docType: "OPENING", docId, docNumber: row.number, description, debit: amount > 0 ? 0 : size, credit: amount > 0 ? size : 0, runningBalance: s.balance } });
  }
  return roundMoney(amount * fx.rate);
}

class DryRun extends Error {}

/** Brings over what customers owe and suppliers are owed from another system, document by document. Posts no income, cost or VAT. */
export async function importOpenItems(companyId: string, input: z.infer<typeof openItemsBody>, actor: Actor) {
  const seen = new Set<string>();
  const results: Array<{ row: number; name: string; ok: boolean; error?: string }> = [];
  let total = 0;
  for (const [i, row] of input.rows.entries()) {
    let value = 0;
    try {
      await inTransaction(async () => {
        value = await importOne(companyId, input.side, row, seen, actor);
        // Every rule is tried for real, then undone.
        if (input.dryRun) throw new DryRun();
      });
    } catch (e) {
      if (!(e instanceof DryRun)) {
        results.push({ row: i + 2, name: row.name, ok: false, error: e instanceof z.ZodError ? e.issues[0].message : (e as Error).message });
        continue;
      }
    }
    total = roundMoney(total + value);
    results.push({ row: i + 2, name: row.name, ok: true });
  }
  const succeeded = results.filter((r) => r.ok).length;
  if (!input.dryRun && succeeded) await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "IMPORT", entityType: input.side === "customers" ? "ArInvoice" : "ApBill", afterJson: { rows: succeeded, total } });
  return { dryRun: Boolean(input.dryRun), total: input.rows.length, amount: total, succeeded, failed: results.length - succeeded, currency: await functionalCurrencyOf(companyId), results };
}

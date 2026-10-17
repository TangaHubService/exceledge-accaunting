import {
  ageingBucketKey,
  AGEING_BUCKETS,
  assertReceiptAllocations,
  assertSupplierTransactable,
  assertWithholding,
  buildAdvanceApplicationLines,
  buildAdvanceRefundLines,
  buildApBillLines,
  buildApCreditNoteLines,
  buildApDebitNoteLines,
  buildApPaymentLines,
  buildLinedBillJournal,
  buildSupplierAdvanceLines,
  buildSupplierReturnLines,
  periodStatement,
  realizedFxSettlement,
  type DocumentLineInput,
  readPaymentSplits,
  roundMoney,
  settlementAccountId,
  type ApPaymentMethod,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { Prisma } from "@prisma/client";
import { defaultsFor, fxAccounts, money, nextNumber, priceDocumentLines, resolveDocumentMoney, settlementDefaults } from "../../lib/documents";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { documentApprovalPlan, requestApproval } from "../approvals/approval.service";
import { inventoryConfig, recordSupplierReturn } from "../inventory/inventory.service";
import { createAndPostJournal, reversalCurrency } from "../journals/journal.service";

type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

const DAY = 86_400_000;

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action,
    entityType,
    entityId,
    beforeJson,
    afterJson,
    ...actor.meta,
  });
}

/** Supplier balance is credit-positive: credits (bills) increase what is owed, debits (payments) reduce it. */
async function appendLedger(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    supplierId: string;
    entryDate: Date;
    docType: string;
    docId: string;
    docNumber?: string | null;
    description?: string | null;
    debit: number;
    credit: number;
  },
) {
  // An increment locks the supplier row, so concurrent postings cannot overwrite each other's balance.
  const supplier = await tx.supplier.update({
    where: { id: input.supplierId },
    data: { balance: { increment: roundMoney(input.credit - input.debit) } },
  });
  const next = money(supplier.balance);
  return tx.apLedgerEntry.create({
    data: {
      companyId: input.companyId,
      supplierId: input.supplierId,
      entryDate: input.entryDate,
      docType: input.docType,
      docId: input.docId,
      docNumber: input.docNumber ?? undefined,
      description: input.description ?? undefined,
      debit: input.debit,
      credit: input.credit,
      runningBalance: next,
    },
  });
}

async function postBalanced(
  companyId: string,
  input: {
    journalDate: Date;
    description: string;
    referenceNumber?: string;
    currencyCode?: string;
    exchangeRate?: number;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string;
    lines: JournalLineDraft[];
    supplierRef?: string;
  },
  actor: Actor,
) {
  return createAndPostJournal(
    companyId,
    {
      journalDate: input.journalDate,
      journalType: "AUTOMATIC",
      description: input.description,
      referenceNumber: input.referenceNumber,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      sourceModule: "AP",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      status: "APPROVED",
      lines: input.lines.map((line) => ({ ...line, supplierRef: input.supplierRef })),
    },
    actor,
  );
}

export function billOutstanding(bill: {
  gross: { toString(): string } | number;
  amountPaid: { toString(): string } | number;
  amountCredited: { toString(): string } | number;
  status: string;
}) {
  if (bill.status !== "POSTED") return 0;
  return roundMoney(money(bill.gross) - money(bill.amountPaid) - money(bill.amountCredited));
}

/* ── Suppliers ─────────────────────────────────────────────────────── */

export type SupplierInput = {
  code?: string;
  name: string;
  category?: string;
  tin?: string;
  vatNumber?: string;
  registrationNumber?: string;
  contactPerson?: string;
  telephone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  physicalAddress?: string;
  country?: string;
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
  currency?: string;
  paymentTerms?: string;
  creditPeriodDays?: number;
  apAccountId?: string;
  defaultExpenseAccountId?: string;
  defaultInventoryAccountId?: string;
  taxCategory?: string;
  whtCategory?: string;
  whtRate?: number;
  bankName?: string;
  bankAccountNumber?: string;
  branchId?: string;
  costCentre?: string;
  openingBalance?: number;
  notes?: string;
  externalErpSupplierId?: string;
};

async function assertAccountsUsable(companyId: string, ids: Array<string | undefined | null>) {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (!wanted.length) return;
  const found = await prisma.account.count({ where: { companyId, id: { in: wanted }, isActive: true } });
  if (found !== new Set(wanted).size) throw new Error("A selected account does not exist or is inactive");
}

export async function createSupplier(companyId: string, input: SupplierInput, actor: Actor = {}) {
  const { code: requestedCode, openingBalance, ...rest } = input;
  const code = requestedCode?.trim() || (await nextNumber(companyId, "SUPPLIER", "SUP"));
  if (await prisma.supplier.findFirst({ where: { companyId, code } })) throw new Error("Supplier code already exists");
  await assertAccountsUsable(companyId, [input.apAccountId, input.defaultExpenseAccountId, input.defaultInventoryAccountId]);
  const opening = roundMoney(openingBalance ?? 0);
  if (opening < 0) throw new Error("Opening balance can't be negative");

  const supplier = await prisma.supplier.create({
    data: {
      ...rest,
      companyId,
      code,
      name: input.name.trim(),
      currency: input.currency ?? "RWF",
      creditPeriodDays: input.creditPeriodDays ?? 30,
      whtRate: input.whtRate ?? 0,
      openingBalance: opening,
    },
  });

  if (opening > 0) {
    const defaults = await defaultsFor(companyId);
    const ap = supplier.apAccountId || defaults.accountsPayableId;
    const contra = defaults.suspenseAccountId || defaults.retainedEarningsId;
    if (!ap || !contra) throw new Error("AP and suspense/retained earnings accounts are required for opening balances");
    const billNumber = await nextNumber(companyId, "AP_BILL", "BILL");
    const posted = await postBalanced(
      companyId,
      {
        journalDate: new Date(),
        description: `Opening balance ${supplier.code}`,
        referenceNumber: supplier.code,
        sourceDocumentType: "SupplierOpening",
        sourceDocumentId: supplier.id,
        sourceDocumentNumber: supplier.code,
        supplierRef: supplier.id,
        lines: [
          { accountId: contra, description: "Opening balance contra", debit: opening, credit: 0 },
          { accountId: ap, description: "Supplier opening balance", debit: 0, credit: opening },
        ],
      },
      actor,
    );
    await prisma.$transaction(async (tx) => {
      const bill = await tx.apBill.create({
        data: {
          companyId,
          supplierId: supplier.id,
          billNumber,
          billDate: new Date(),
          dueDate: new Date(),
          currency: supplier.currency,
          net: opening,
          gross: opening,
          description: "Opening balance",
          journalId: posted.id,
          sourceModule: "AP",
          sourceDocumentType: "SupplierOpening",
          sourceDocumentId: supplier.id,
        },
      });
      await appendLedger(tx, {
        companyId,
        supplierId: supplier.id,
        entryDate: new Date(),
        docType: "OPENING",
        docId: bill.id,
        docNumber: billNumber,
        description: "Opening balance",
        debit: 0,
        credit: opening,
      });
    });
  }

  await audit(companyId, actor, "CREATE", "Supplier", supplier.id, { code: supplier.code, name: supplier.name, openingBalance: opening });
  return prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
}

export async function updateSupplier(
  companyId: string,
  supplierId: string,
  input: Partial<Omit<SupplierInput, "code" | "openingBalance" | "externalErpSupplierId">> & { status?: "ACTIVE" | "INACTIVE" },
  actor: Actor = {},
) {
  const before = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!before) throw new Error("Supplier does not exist");
  await assertAccountsUsable(companyId, [input.apAccountId, input.defaultExpenseAccountId, input.defaultInventoryAccountId]);
  const updated = await prisma.supplier.update({ where: { id: before.id }, data: input });
  const pick = (s: typeof before) => ({ name: s.name, status: s.status, creditPeriodDays: s.creditPeriodDays, whtRate: money(s.whtRate), apAccountId: s.apAccountId });
  await audit(companyId, actor, "UPDATE", "Supplier", updated.id, pick(updated), pick(before));
  return updated;
}

export async function listSuppliers(companyId: string, q?: string) {
  return prisma.supplier.findMany({
    where: {
      companyId,
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { tin: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getSupplier(companyId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  if (!supplier) throw new Error("Supplier does not exist");
  return supplier;
}

async function loadActiveSupplier(companyId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId } });
  assertSupplierTransactable({ exists: Boolean(supplier), active: supplier?.status === "ACTIVE" });
  return supplier!;
}

/* ── Bills ─────────────────────────────────────────────────────────── */

export async function createBill(
  companyId: string,
  input: {
    supplierId: string;
    supplierInvoiceNumber?: string;
    billDate: Date | string;
    dueDate?: Date | string;
    poReference?: string;
    grnReference?: string;
    net?: number;
    tax?: number;
    discount?: number;
    expenseAccountId?: string;
    description?: string;
    currency?: string;
    exchangeRate?: number;
    /** Line items; when given, the totals come from the lines and their tax codes. */
    lines?: DocumentLineInput[];
  },
  actor: Actor = {},
) {
  const supplier = await loadActiveSupplier(companyId, input.supplierId);
  const billDateEarly = new Date(input.billDate);
  const fx = await resolveDocumentMoney(companyId, {
    documentCurrency: input.currency,
    partyCurrency: supplier.currency,
    date: billDateEarly,
    rate: input.exchangeRate,
  });
  const supplierInvoiceNumber = input.supplierInvoiceNumber?.trim() || undefined;
  if (supplierInvoiceNumber) {
    const duplicate = await prisma.apBill.findFirst({ where: { companyId, supplierId: supplier.id, supplierInvoiceNumber } });
    if (duplicate) throw new Error(`Supplier invoice ${supplierInvoiceNumber} is already recorded as ${duplicate.billNumber}`);
  }
  const expenseAccountId = input.expenseAccountId || supplier.defaultExpenseAccountId || undefined;
  await assertAccountsUsable(companyId, [expenseAccountId]);
  const billDate = billDateEarly;
  const priced = input.lines?.length ? await priceDocumentLines(companyId, input.lines, billDate, "purchase") : null;
  if (priced && input.discount) throw new Error("Give discounts on the lines when a bill has lines");
  if (priced && (input.net != null || input.tax != null)) throw new Error("A bill with lines takes its net and tax from the lines");
  if (!priced && !(Number(input.net) > 0)) throw new Error("Bill amount must be positive");
  const net = priced ? priced.net : roundMoney(input.net!);
  const tax = priced ? priced.tax : roundMoney(input.tax ?? 0);
  const discount = priced ? 0 : roundMoney(input.discount ?? 0);
  const gross = roundMoney(net + tax - discount);
  const defaults = await defaultsFor(companyId);
  if (priced) buildLinedBillJournal(defaults, { lines: priced.lines, apAccountId: supplier.apAccountId, expenseAccountId });
  else buildApBillLines(defaults, { net, tax, discount, apAccountId: supplier.apAccountId, expenseAccountId });
  const dueDate = input.dueDate ? new Date(input.dueDate) : new Date(billDate.getTime() + supplier.creditPeriodDays * DAY);
  if (dueDate < billDate) throw new Error("Due date can't be before the bill date");
  const plan = await documentApprovalPlan(companyId, "ApBill", gross);
  const billNumber = await nextNumber(companyId, "AP_BILL", "BILL");
  const bill = await prisma.apBill.create({
    data: {
      companyId,
      supplierId: supplier.id,
      billNumber,
      supplierInvoiceNumber,
      billDate,
      dueDate,
      poReference: input.poReference || undefined,
      grnReference: input.grnReference || undefined,
      status: plan ? "PENDING_APPROVAL" : "POSTED",
      currency: fx.currency,
      exchangeRate: fx.rate,
      net,
      tax,
      discount,
      gross,
      expenseAccountId: input.expenseAccountId || undefined,
      description: input.description,
      sourceModule: "AP",
      sourceDocumentType: "ApBill",
      createdByErpUserId: actor.erpUserId,
      ...(priced
        ? {
            lines: {
              create: priced.lines.map((l) => ({
                lineNumber: l.lineNumber,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discount: l.discount,
                net: l.net,
                taxCode: l.taxCode,
                taxRate: l.taxRate,
                tax: l.tax,
                accountId: l.accountId,
              })),
            },
          }
        : {}),
    },
  });
  if (plan) {
    await audit(companyId, actor, "CREATE", "ApBill", bill.id, { billNumber, supplierInvoiceNumber, gross, status: "PENDING_APPROVAL" });
    const approval = await requestApproval(companyId, { entityType: "ApBill", entityId: bill.id, amount: gross, plan }, actor);
    return { ...(await prisma.apBill.findUniqueOrThrow({ where: { id: bill.id } })), approval };
  }
  await postBillJournal(companyId, bill.id, actor);
  return prisma.apBill.findUniqueOrThrow({ where: { id: bill.id } });
}

/** Posts a bill that was held for approval, once its approval is final. */
export async function postPendingBill(companyId: string, billId: string, actor: Actor = {}) {
  const claimed = await prisma.apBill.updateMany({ where: { id: billId, companyId, status: "PENDING_APPROVAL" }, data: { status: "POSTED" } });
  if (!claimed.count) throw new Error("This bill is not waiting for approval");
  await postBillJournal(companyId, billId, actor);
  return prisma.apBill.findUniqueOrThrow({ where: { id: billId } });
}

async function postBillJournal(companyId: string, billId: string, actor: Actor) {
  const bill = await prisma.apBill.findUniqueOrThrow({ where: { id: billId }, include: { supplier: true, lines: { orderBy: { lineNumber: "asc" } } } });
  const { billNumber, supplierInvoiceNumber, billDate, supplier } = bill;
  const gross = money(bill.gross);
  const defaults = await defaultsFor(companyId);
  const expenseAccountId = bill.expenseAccountId || supplier.defaultExpenseAccountId || undefined;
  let lines: JournalLineDraft[];
  if (bill.lines.length) {
    // Tax accounts follow the tax codes as they are when the bill posts; rates and amounts were fixed on entry.
    const codes = [...new Set(bill.lines.map((l) => l.taxCode).filter(Boolean) as string[])];
    const taxCodes = codes.length ? await prisma.taxCode.findMany({ where: { companyId, code: { in: codes } } }) : [];
    lines = buildLinedBillJournal(defaults, {
      lines: bill.lines.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discount: money(l.discount),
        net: money(l.net),
        taxCode: l.taxCode,
        taxRate: Number(l.taxRate),
        tax: money(l.tax),
        accountId: l.accountId,
        taxAccountId: taxCodes.find((c) => c.code === l.taxCode)?.glAccountId ?? null,
      })),
      apAccountId: supplier.apAccountId,
      expenseAccountId,
    });
  } else {
    lines = buildApBillLines(defaults, {
      net: money(bill.net),
      tax: money(bill.tax),
      discount: money(bill.discount),
      apAccountId: supplier.apAccountId,
      expenseAccountId,
    });
  }
  const posted = await postBalanced(
    companyId,
    {
      journalDate: billDate,
      description: bill.description || `Supplier bill ${billNumber}`,
      referenceNumber: supplierInvoiceNumber ?? billNumber,
      currencyCode: bill.currency,
      exchangeRate: Number(bill.exchangeRate),
      sourceDocumentType: "ApBill",
      sourceDocumentId: bill.id,
      sourceDocumentNumber: billNumber,
      supplierRef: supplier.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.apBill.update({ where: { id: bill.id }, data: { journalId: posted.id, sourceDocumentId: bill.id } });
    await appendLedger(tx, {
      companyId,
      supplierId: supplier.id,
      entryDate: billDate,
      docType: "BILL",
      docId: bill.id,
      docNumber: billNumber,
      description: bill.description || (supplierInvoiceNumber ? `Supplier invoice ${supplierInvoiceNumber}` : "Supplier bill"),
      debit: 0,
      credit: gross,
    });
  });
  await audit(companyId, actor, "POST", "ApBill", bill.id, { billNumber, supplierInvoiceNumber, gross });
}

export async function listBills(companyId: string, filter: { status?: "OPEN" | "ALL"; supplierId?: string } = {}) {
  const bills = await prisma.apBill.findMany({
    where: { companyId, status: "POSTED", ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
    include: { supplier: { select: { id: true, code: true, name: true } } },
    orderBy: [{ dueDate: "asc" }, { billNumber: "asc" }],
    take: 1000,
  });
  return bills
    .map((bill) => ({
      id: bill.id,
      billNumber: bill.billNumber,
      supplierInvoiceNumber: bill.supplierInvoiceNumber,
      supplierId: bill.supplierId,
      supplierCode: bill.supplier.code,
      supplierName: bill.supplier.name,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      poReference: bill.poReference,
      grnReference: bill.grnReference,
      net: money(bill.net),
      tax: money(bill.tax),
      gross: money(bill.gross),
      paid: money(bill.amountPaid),
      credited: money(bill.amountCredited),
      outstanding: billOutstanding(bill),
      description: bill.description,
      sourceModule: bill.sourceModule,
    }))
    .filter((row) => (filter.status === "ALL" ? true : row.outstanding > 0));
}

/* ── Payments ──────────────────────────────────────────────────────── */

export async function createPayment(
  companyId: string,
  input: {
    supplierId: string;
    paymentDate: Date | string;
    method?: ApPaymentMethod;
    amount: number;
    currency?: string;
    exchangeRate?: number;
    withholdingTax?: number;
    reference?: string;
    description?: string;
    allocations?: Array<{ billId: string; amount: number }>;
    allowUnallocated?: boolean;
    financialAccountId?: string;
  },
  actor: Actor = {},
) {
  const supplier = await loadActiveSupplier(companyId, input.supplierId);
  const paid = roundMoney(input.amount);
  const wht = roundMoney(input.withholdingTax ?? 0);
  const settled = roundMoney(paid + wht);
  assertWithholding({ settled, withholdingTax: wht });
  const paymentDate = new Date(input.paymentDate);
  const fx = await resolveDocumentMoney(companyId, {
    documentCurrency: input.currency,
    partyCurrency: supplier.currency,
    date: paymentDate,
    rate: input.exchangeRate,
  });
  if (wht > 0 && fx.currency !== fx.functional) throw new Error("Withholding tax on a foreign-currency payment is not supported yet");
  const requested = input.allocations ?? [];
  if (new Set(requested.map((r) => r.billId)).size !== requested.length) throw new Error("A bill appears more than once in the allocation");
  const bills = requested.length
    ? await prisma.apBill.findMany({ where: { companyId, supplierId: supplier.id, status: "POSTED", id: { in: requested.map((a) => a.billId) } } })
    : [];
  if (bills.length !== requested.length) throw new Error("One or more bills were not found for this supplier");
  for (const bill of bills) {
    if (bill.currency.toUpperCase() !== fx.currency) throw new Error(`Bill ${bill.billNumber} is in ${bill.currency}; the payment is in ${fx.currency}`);
  }
  const check = assertReceiptAllocations({
    amount: settled,
    document: "bill",
    allowOverpayment: input.allowUnallocated !== false,
    allocations: requested.map((row) => ({ amount: row.amount, outstanding: billOutstanding(bills.find((b) => b.id === row.billId)!) })),
  });
  const method = input.method ?? "BANK";
  const defaults = await settlementDefaults(companyId, input.financialAccountId);
  const ratesMatch = bills.every((b) => Math.abs(Number(b.exchangeRate) - fx.rate) < 1e-10);
  let lines: JournalLineDraft[];
  let journalCurrency = fx.currency;
  let journalRate = fx.rate;
  if (fx.currency === fx.functional || ratesMatch || wht > 0) {
    lines = buildApPaymentLines(defaults, { amount: paid, withholdingTax: wht, method, apAccountId: supplier.apAccountId });
  } else {
    const cash = settlementAccountId(defaults, method);
    const ap = supplier.apAccountId || defaults.accountsPayableId;
    if (!cash || !ap) throw new Error("Bank or payables account is not configured");
    const { gainId, lossId } = await fxAccounts(companyId);
    lines = realizedFxSettlement({
      cashAccountId: cash,
      controlAccountId: ap,
      fxGainAccountId: gainId,
      fxLossAccountId: lossId,
      amount: paid,
      paymentRate: fx.rate,
      allocations: requested.map((row) => {
        const bill = bills.find((b) => b.id === row.billId)!;
        return { amount: roundMoney(row.amount), documentRate: Number(bill.exchangeRate) };
      }),
      side: "AP",
    });
    journalCurrency = fx.functional;
    journalRate = 1;
  }
  const paymentNumber = await nextNumber(companyId, "AP_PAYMENT", "PAY");
  const payment = await prisma.apPayment.create({
    data: {
      companyId,
      supplierId: supplier.id,
      paymentNumber,
      paymentDate,
      method,
      amount: paid,
      currency: fx.currency,
      exchangeRate: fx.rate,
      withholdingTax: wht,
      unallocated: check.unallocated,
      reference: input.reference,
      description: input.description,
      sourceModule: "AP",
      sourceDocumentType: "ApPayment",
      financialAccountId: input.financialAccountId,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: paymentDate,
      description: input.description || `Supplier payment ${paymentNumber}`,
      referenceNumber: input.reference || paymentNumber,
      currencyCode: journalCurrency,
      exchangeRate: journalRate,
      sourceDocumentType: "ApPayment",
      sourceDocumentId: payment.id,
      sourceDocumentNumber: paymentNumber,
      supplierRef: supplier.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.apPayment.update({ where: { id: payment.id }, data: { journalId: posted.id, sourceDocumentId: payment.id } });
    for (const row of requested) {
      const amount = roundMoney(row.amount);
      await tx.apAllocation.create({ data: { paymentId: payment.id, billId: row.billId, amount } });
      await bumpPostedBill(tx, row.billId, { amountPaid: { increment: amount } });
    }
    await appendLedger(tx, {
      companyId,
      supplierId: supplier.id,
      entryDate: paymentDate,
      docType: "PAYMENT",
      docId: payment.id,
      docNumber: paymentNumber,
      description: wht > 0 ? `Paid ${paid} with ${wht} withholding tax` : input.description || "Supplier payment",
      debit: settled,
      credit: 0,
    });
  });
  await audit(companyId, actor, "POST", "ApPayment", payment.id, { paymentNumber, amount: paid, withholdingTax: wht, allocations: requested });
  return prisma.apPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } });
}

export async function reversePayment(
  companyId: string,
  paymentId: string,
  input: { reason?: string; reversalDate?: Date | string } = {},
  actor: Actor = {},
) {
  return inTransaction(() => reversePaymentOnce(companyId, paymentId, input, actor));
}

async function reversePaymentOnce(companyId: string, paymentId: string, input: { reason?: string; reversalDate?: Date | string }, actor: Actor) {
  const { reason } = input;
  const reversalDate = input.reversalDate ? new Date(input.reversalDate) : new Date();
  const payment = await prisma.apPayment.findFirst({
    where: { id: paymentId, companyId },
    include: { allocations: true, supplier: true },
  });
  if (!payment) throw new Error("Payment does not exist");
  if (payment.status !== "POSTED") throw new Error("Payment is already reversed");
  if (payment.sourceModule !== "AP") throw new Error("Payments from Excel Edge must be reversed in Excel Edge");
  if (reversalDate < payment.paymentDate) throw new Error("A reversal can't be dated before the payment");
  // A payment recorded in Banking is claimed through its bank transaction first, in the same order Banking uses.
  const bankLinked = await prisma.bankTransaction.updateMany({ where: { companyId, apPaymentId: paymentId, status: "POSTED" }, data: { status: "REVERSED" } });
  // The conditional update row-locks the payment, so a concurrent reversal waits and then finds it reversed.
  const claimed = await prisma.apPayment.updateMany({ where: { id: paymentId, companyId, status: "POSTED" }, data: { status: "REVERSED" } });
  if (!claimed.count) throw new Error("Payment is already reversed");
  const paid = money(payment.amount);
  const wht = money(payment.withholdingTax);
  const defaults = await settlementDefaults(companyId, payment.financialAccountId);
  const lines = buildApPaymentLines(defaults, {
    amount: paid,
    withholdingTax: wht,
    method: payment.method,
    apAccountId: payment.supplier.apAccountId,
  }).map((line) => ({ ...line, debit: line.credit, credit: line.debit, description: `Reversal: ${line.description ?? "payment"}` }));
  const posted = await postBalanced(
    companyId,
    {
      journalDate: reversalDate,
      description: `Reverse supplier payment ${payment.paymentNumber}${reason ? ` — ${reason}` : ""}`,
      referenceNumber: payment.paymentNumber,
      ...(await reversalCurrency(companyId, payment.journalId)),
      sourceDocumentType: "ApPaymentReversal",
      sourceDocumentId: payment.id,
      sourceDocumentNumber: payment.paymentNumber,
      supplierRef: payment.supplierId,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    for (const allocation of payment.allocations) {
      await tx.apBill.update({ where: { id: allocation.billId }, data: { amountPaid: { decrement: money(allocation.amount) } } });
    }
    await appendLedger(tx, {
      companyId,
      supplierId: payment.supplierId,
      entryDate: reversalDate,
      docType: "PAYMENT_REVERSAL",
      docId: payment.id,
      docNumber: payment.paymentNumber,
      description: reason || "Payment reversal",
      debit: 0,
      credit: roundMoney(paid + wht),
    });
  });
  if (bankLinked.count) {
    await prisma.bankTransaction.updateMany({
      where: { companyId, apPaymentId: paymentId },
      data: { reversalJournalId: posted.id, reversedAt: reversalDate, reversedByErpUserId: actor.erpUserId, reversalReason: reason || `Payment ${payment.paymentNumber} reversed in Payables` },
    });
  }
  await audit(companyId, actor, "REVERSE", "ApPayment", payment.id, { status: "REVERSED", journalId: posted.id, reason }, { status: "POSTED" });
  return { paymentId: payment.id, journalId: posted.id, status: "REVERSED" as const };
}

export async function listPayments(companyId: string, filter: { supplierId?: string } = {}) {
  const payments = await prisma.apPayment.findMany({
    where: { companyId, ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
    include: { supplier: { select: { id: true, code: true, name: true } }, allocations: { include: { bill: { select: { billNumber: true } } } } },
    orderBy: [{ paymentDate: "desc" }, { paymentNumber: "desc" }],
    take: 500,
  });
  return payments.map((p) => ({
    id: p.id,
    paymentNumber: p.paymentNumber,
    paymentDate: p.paymentDate,
    supplierId: p.supplierId,
    supplierCode: p.supplier.code,
    supplierName: p.supplier.name,
    method: p.method,
    amount: money(p.amount),
    withholdingTax: money(p.withholdingTax),
    unallocated: money(p.unallocated),
    status: p.status,
    reference: p.reference,
    sourceModule: p.sourceModule,
    bills: p.allocations.map((a) => ({ billNumber: a.bill.billNumber, amount: money(a.amount) })),
  }));
}

/* ── Credit & debit notes ──────────────────────────────────────────── */

export async function createCreditNote(
  companyId: string,
  input: {
    supplierId: string;
    billId?: string;
    supplierReference?: string;
    noteDate: Date | string;
    reason: string;
    net: number;
    tax?: number;
    description?: string;
    /** Stock sent back to the supplier; it leaves inventory at valuation cost. */
    returnedItems?: Array<{ itemId: string; locationId: string; quantity: number }>;
  },
  actor: Actor = {},
) {
  return inTransaction(() => createCreditNoteInTransaction(companyId, input, actor));
}

async function createCreditNoteInTransaction(
  companyId: string,
  input: Parameters<typeof createCreditNote>[1],
  actor: Actor,
) {
  const supplier = await loadActiveSupplier(companyId, input.supplierId);
  const net = roundMoney(input.net);
  const tax = roundMoney(input.tax ?? 0);
  const gross = roundMoney(net + tax);
  let bill: Awaited<ReturnType<typeof prisma.apBill.findFirst>> = null;
  if (input.billId) {
    bill = await prisma.apBill.findFirst({ where: { id: input.billId, companyId, supplierId: supplier.id, status: "POSTED" } });
    if (!bill) throw new Error("Bill does not exist");
    if (gross - billOutstanding(bill) > 0.0001) throw new Error("Credit note exceeds the bill's outstanding balance");
  }
  const defaults = await defaultsFor(companyId);
  const noteDate = new Date(input.noteDate);
  const creditNoteNumber = await nextNumber(companyId, "AP_CREDIT_NOTE", "SCN");
  const returned = (input.returnedItems ?? []).filter((item) => item && item.itemId);
  const note = await prisma.apCreditNote.create({
    data: {
      companyId,
      supplierId: supplier.id,
      billId: bill?.id,
      creditNoteNumber,
      supplierReference: input.supplierReference || undefined,
      noteDate,
      reason: input.reason,
      net,
      tax,
      gross,
      description: input.description,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const stock = returned.length
    ? await recordSupplierReturn(companyId, { documentId: note.id, reference: creditNoteNumber, date: noteDate, items: returned })
    : null;
  const lines = stock
    ? buildSupplierReturnLines((await inventoryConfig(companyId)).accounts, { net, tax, cost: stock.cost, apAccountId: supplier.apAccountId, returnsAccountId: bill?.expenseAccountId })
    : buildApCreditNoteLines(defaults, { net, tax, apAccountId: supplier.apAccountId, returnsAccountId: bill?.expenseAccountId });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: noteDate,
      description: input.description || `Supplier credit note ${creditNoteNumber}`,
      referenceNumber: input.supplierReference || creditNoteNumber,
      sourceDocumentType: "ApCreditNote",
      sourceDocumentId: note.id,
      sourceDocumentNumber: creditNoteNumber,
      supplierRef: supplier.id,
      lines,
    },
    actor,
  );
  if (stock) {
    await prisma.inventoryMovement.updateMany({ where: { id: { in: stock.movements.map((m) => m.id) } }, data: { journalId: posted.id } });
  }
  await prisma.$transaction(async (tx) => {
    await tx.apCreditNote.update({ where: { id: note.id }, data: { journalId: posted.id } });
    if (bill) {
      const updated = await bumpPostedBill(tx, bill.id, { amountCredited: { increment: gross } });
      if (billOutstanding(updated) < -0.0001) throw new Error("Credit note exceeds the bill's outstanding balance");
    }
    await appendLedger(tx, {
      companyId,
      supplierId: supplier.id,
      entryDate: noteDate,
      docType: "CREDIT_NOTE",
      docId: note.id,
      docNumber: creditNoteNumber,
      description: input.reason,
      debit: gross,
      credit: 0,
    });
  });
  await audit(companyId, actor, "POST", "ApCreditNote", note.id, { creditNoteNumber, gross, billId: bill?.id });
  return prisma.apCreditNote.findUniqueOrThrow({ where: { id: note.id } });
}

export async function createDebitNote(
  companyId: string,
  input: {
    supplierId: string;
    supplierReference?: string;
    noteDate: Date | string;
    dueDate?: Date | string;
    reason: string;
    net: number;
    tax?: number;
    expenseAccountId?: string;
    description?: string;
  },
  actor: Actor = {},
) {
  const supplier = await loadActiveSupplier(companyId, input.supplierId);
  const expenseAccountId = input.expenseAccountId || supplier.defaultExpenseAccountId || undefined;
  await assertAccountsUsable(companyId, [expenseAccountId]);
  const net = roundMoney(input.net);
  const tax = roundMoney(input.tax ?? 0);
  const gross = roundMoney(net + tax);
  const defaults = await defaultsFor(companyId);
  const lines = buildApDebitNoteLines(defaults, { net, tax, apAccountId: supplier.apAccountId, expenseAccountId });
  const noteDate = new Date(input.noteDate);
  const dueDate = input.dueDate ? new Date(input.dueDate) : new Date(noteDate.getTime() + supplier.creditPeriodDays * DAY);
  const debitNoteNumber = await nextNumber(companyId, "AP_DEBIT_NOTE", "SDN");
  // A debit note is payable like a bill, so it is carried as a bill for allocation and ageing.
  const billNumber = await nextNumber(companyId, "AP_BILL", "BILL");
  const note = await prisma.apDebitNote.create({
    data: {
      companyId,
      supplierId: supplier.id,
      debitNoteNumber,
      supplierReference: input.supplierReference || undefined,
      noteDate,
      dueDate,
      reason: input.reason,
      net,
      tax,
      gross,
      expenseAccountId: input.expenseAccountId || undefined,
      description: input.description,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: noteDate,
      description: input.description || `Supplier debit note ${debitNoteNumber}`,
      referenceNumber: input.supplierReference || debitNoteNumber,
      sourceDocumentType: "ApDebitNote",
      sourceDocumentId: note.id,
      sourceDocumentNumber: debitNoteNumber,
      supplierRef: supplier.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.apDebitNote.update({ where: { id: note.id }, data: { journalId: posted.id } });
    await tx.apBill.create({
      data: {
        companyId,
        supplierId: supplier.id,
        billNumber,
        billDate: noteDate,
        dueDate,
        currency: (await resolveDocumentMoney(companyId, { date: new Date() })).currency,
        net,
        tax,
        gross,
        expenseAccountId: input.expenseAccountId || undefined,
        description: `Debit note ${debitNoteNumber}: ${input.reason}`,
        journalId: posted.id,
        sourceModule: "AP",
        sourceDocumentType: "ApDebitNote",
        sourceDocumentId: note.id,
        sourceDocumentNumber: debitNoteNumber,
        createdByErpUserId: actor.erpUserId,
      },
    });
    await appendLedger(tx, {
      companyId,
      supplierId: supplier.id,
      entryDate: noteDate,
      docType: "DEBIT_NOTE",
      docId: note.id,
      docNumber: debitNoteNumber,
      description: input.reason,
      debit: 0,
      credit: gross,
    });
  });
  await audit(companyId, actor, "POST", "ApDebitNote", note.id, { debitNoteNumber, gross });
  return prisma.apDebitNote.findUniqueOrThrow({ where: { id: note.id } });
}

/* ── Advances ──────────────────────────────────────────────────────── */

export async function createAdvance(
  companyId: string,
  input: {
    supplierId: string;
    advanceDate: Date | string;
    method?: ApPaymentMethod;
    amount: number;
    reference?: string;
    description?: string;
  },
  actor: Actor = {},
) {
  const supplier = await loadActiveSupplier(companyId, input.supplierId);
  const amount = roundMoney(input.amount);
  const method = input.method ?? "BANK";
  const defaults = await defaultsFor(companyId);
  const lines = buildSupplierAdvanceLines(defaults, amount, method);
  const advanceDate = new Date(input.advanceDate);
  const advanceNumber = await nextNumber(companyId, "AP_ADVANCE", "ADV");
  const advance = await prisma.apAdvance.create({
    data: {
      companyId,
      supplierId: supplier.id,
      advanceNumber,
      advanceDate,
      method,
      amount,
      remaining: amount,
      reference: input.reference,
      description: input.description,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: advanceDate,
      description: input.description || `Supplier advance ${advanceNumber}`,
      referenceNumber: input.reference || advanceNumber,
      sourceDocumentType: "ApAdvance",
      sourceDocumentId: advance.id,
      sourceDocumentNumber: advanceNumber,
      supplierRef: supplier.id,
      lines,
    },
    actor,
  );
  await audit(companyId, actor, "POST", "ApAdvance", advance.id, { advanceNumber, amount });
  return prisma.apAdvance.update({ where: { id: advance.id }, data: { journalId: posted.id } });
}

export async function allocateAdvance(
  companyId: string,
  advanceId: string,
  input: { billId: string; amount: number; allocationDate?: Date | string },
  actor: Actor = {},
) {
  const advance = await prisma.apAdvance.findFirst({ where: { id: advanceId, companyId, status: "POSTED" }, include: { supplier: true } });
  if (!advance) throw new Error("Advance does not exist");
  const allocationDate = input.allocationDate ? new Date(input.allocationDate) : new Date();
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new Error("Allocation amount must be positive");
  if (amount - money(advance.remaining) > 0.0001) throw new Error("Allocation exceeds the advance still available");
  const bill = await prisma.apBill.findFirst({ where: { id: input.billId, companyId, supplierId: advance.supplierId, status: "POSTED" } });
  if (!bill) throw new Error("Bill does not exist");
  if (amount - billOutstanding(bill) > 0.0001) throw new Error("Allocation exceeds bill outstanding balance");
  const defaults = await defaultsFor(companyId);
  const lines = buildAdvanceApplicationLines(defaults, amount, advance.supplier.apAccountId);
  const allocation = await prisma.apAdvanceAllocation.create({ data: { advanceId: advance.id, billId: bill.id, amount } });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: allocationDate,
      description: `Apply advance ${advance.advanceNumber} to ${bill.billNumber}`,
      referenceNumber: advance.advanceNumber,
      sourceDocumentType: "ApAdvanceAllocation",
      sourceDocumentId: allocation.id,
      sourceDocumentNumber: advance.advanceNumber,
      supplierRef: advance.supplierId,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.apAdvanceAllocation.update({ where: { id: allocation.id }, data: { journalId: posted.id } });
    const taken = await tx.apAdvance.updateMany({ where: { id: advance.id, status: "POSTED", remaining: { gte: amount } }, data: { remaining: { decrement: amount } } });
    if (!taken.count) throw new Error("Allocation exceeds the advance still available");
    const updated = await bumpPostedBill(tx, bill.id, { amountPaid: { increment: amount } });
    if (billOutstanding(updated) < -0.0001) throw new Error("Allocation exceeds bill outstanding balance");
    await appendLedger(tx, {
      companyId,
      supplierId: advance.supplierId,
      entryDate: allocationDate,
      docType: "ADVANCE_APPLICATION",
      docId: allocation.id,
      docNumber: advance.advanceNumber,
      description: `Advance applied to ${bill.billNumber}`,
      debit: amount,
      credit: 0,
    });
  });
  await audit(companyId, actor, "ALLOCATE", "ApAdvance", advance.id, { billId: bill.id, amount });
  return prisma.apAdvance.findUniqueOrThrow({ where: { id: advance.id }, include: { allocations: true } });
}

export async function refundAdvance(
  companyId: string,
  advanceId: string,
  input: { amount?: number; method?: ApPaymentMethod; refundDate?: Date | string },
  actor: Actor = {},
) {
  const advance = await prisma.apAdvance.findFirst({ where: { id: advanceId, companyId, status: "POSTED" } });
  if (!advance) throw new Error("Advance does not exist");
  const remaining = money(advance.remaining);
  const amount = roundMoney(input.amount ?? remaining);
  if (amount <= 0) throw new Error("Advance has no remaining balance to refund");
  if (amount - remaining > 0.0001) throw new Error("Refund exceeds the advance still available");
  const defaults = await defaultsFor(companyId);
  const lines = buildAdvanceRefundLines(defaults, amount, input.method ?? advance.method);
  const posted = await postBalanced(
    companyId,
    {
      journalDate: input.refundDate ? new Date(input.refundDate) : new Date(),
      description: `Refund of supplier advance ${advance.advanceNumber}`,
      referenceNumber: advance.advanceNumber,
      sourceDocumentType: "ApAdvanceRefund",
      sourceDocumentId: advance.id,
      sourceDocumentNumber: advance.advanceNumber,
      supplierRef: advance.supplierId,
      lines,
    },
    actor,
  );
  const taken = await prisma.apAdvance.updateMany({
    where: { id: advance.id, status: "POSTED", remaining: { gte: amount } },
    data: { remaining: { decrement: amount }, refunded: { increment: amount } },
  });
  if (!taken.count) throw new Error("Refund exceeds the advance still available");
  await audit(companyId, actor, "REFUND", "ApAdvance", advance.id, { amount, journalId: posted.id });
  return prisma.apAdvance.findUniqueOrThrow({ where: { id: advance.id } });
}

export async function listAdvances(companyId: string, filter: { supplierId?: string; openOnly?: boolean } = {}) {
  const advances = await prisma.apAdvance.findMany({
    where: {
      companyId,
      status: "POSTED",
      ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(filter.openOnly ? { remaining: { gt: 0 } } : {}),
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      allocations: { include: { bill: { select: { billNumber: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { advanceDate: "desc" },
    take: 500,
  });
  return advances.map((a) => ({
    id: a.id,
    advanceNumber: a.advanceNumber,
    advanceDate: a.advanceDate,
    supplierId: a.supplierId,
    supplierName: a.supplier.name,
    method: a.method,
    amount: money(a.amount),
    remaining: money(a.remaining),
    refunded: money(a.refunded),
    reference: a.reference,
    description: a.description,
    allocations: a.allocations.map((x) => ({ billNumber: x.bill.billNumber, amount: money(x.amount), date: x.createdAt })),
  }));
}

/* ── Ledger, statement, reports ────────────────────────────────────── */

export async function supplierLedger(companyId: string, supplierId: string) {
  await getSupplier(companyId, supplierId);
  const entries = await prisma.apLedgerEntry.findMany({ where: { companyId, supplierId }, orderBy: { createdAt: "asc" } });
  const closing = entries.length ? money(entries[entries.length - 1].runningBalance) : 0;
  return { openingBalance: 0, entries, closingBalance: closing };
}

export async function supplierStatement(companyId: string, supplierId: string, type: "OUTSTANDING" | "FULL" = "OUTSTANDING") {
  const supplier = await getSupplier(companyId, supplierId);
  const rows = await listBills(companyId, { supplierId, status: type === "FULL" ? "ALL" : "OPEN" });
  return {
    type,
    supplier: { id: supplier.id, code: supplier.code, name: supplier.name, balance: money(supplier.balance) },
    rows,
    totalOutstanding: roundMoney(rows.reduce((sum, row) => sum + row.outstanding, 0)),
  };
}

/** Supplier statement for a period: balance brought forward, each movement with a running balance, closing balance. */
export async function supplierPeriodStatement(companyId: string, supplierId: string, from?: string, to?: string) {
  const supplier = await getSupplier(companyId, supplierId);
  const { start, end } = range(from, to);
  const entries = await prisma.apLedgerEntry.findMany({
    where: { companyId, supplierId, entryDate: { lte: end } },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  const statement = periodStatement(
    entries.map((e) => ({ ...e, debit: money(e.debit), credit: money(e.credit) })),
    start,
    end,
    -1,
  );
  return {
    supplier: { id: supplier.id, code: supplier.code, name: supplier.name, tin: supplier.tin },
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    openingBalance: statement.opening,
    entries: statement.entries.map((e) => ({
      id: e.id,
      entryDate: e.entryDate,
      docType: e.docType,
      docNumber: e.docNumber,
      description: e.description,
      debit: e.debit,
      credit: e.credit,
      balance: e.balance,
    })),
    totalBilled: statement.totalCredit,
    totalPaid: statement.totalDebit,
    closingBalance: statement.closing,
  };
}

export async function getBill(companyId: string, billId: string) {
  const bill = await prisma.apBill.findFirst({
    where: { id: billId, companyId },
    include: {
      supplier: true,
      lines: { orderBy: { lineNumber: "asc" } },
      allocations: { include: { payment: { select: { paymentNumber: true, paymentDate: true, status: true } } } },
    },
  });
  if (!bill) throw new Error("Bill does not exist");
  return { ...bill, outstanding: billOutstanding(bill) };
}

/** Bumps a bill's paid or credited amount, refusing bills that were voided or reversed meanwhile. */
async function bumpPostedBill(tx: Prisma.TransactionClient, billId: string, data: Prisma.ApBillUpdateManyMutationInput) {
  const updated = await tx.apBill.updateMany({ where: { id: billId, status: "POSTED" }, data });
  if (!updated.count) throw new Error("The bill is no longer posted (it was voided or reversed); refresh and try again");
  return tx.apBill.findUniqueOrThrow({ where: { id: billId } });
}

/**
 * Voids a bill entered in Accounting by posting the exact reverse of its journal. Only an untouched bill can be
 * voided: nothing paid, credited or matched against goods received.
 */
export async function voidBill(
  companyId: string,
  billId: string,
  input: { reason: string; voidDate?: Date | string },
  actor: Actor = {},
) {
  return inTransaction(() => voidBillOnce(companyId, billId, input, actor));
}

async function voidBillOnce(companyId: string, billId: string, input: { reason: string; voidDate?: Date | string }, actor: Actor) {
  const reason = input.reason?.trim();
  if (!reason) throw new Error("Give a reason for voiding the bill");
  const voidDate = input.voidDate ? new Date(input.voidDate) : new Date();
  const bill = await prisma.apBill.findFirst({ where: { id: billId, companyId } });
  if (!bill) throw new Error("Bill does not exist");
  if (bill.status !== "POSTED") throw new Error(`Only a posted bill can be voided; this one is ${bill.status.toLowerCase().replace("_", " ")}`);
  if (bill.sourceModule !== "AP") throw new Error("Bills from Excel Edge must be cancelled in Excel Edge");
  if (bill.sourceDocumentType === "ApDebitNote") throw new Error("This bill carries a debit note; settle it with a credit note instead of voiding it");
  if (!bill.journalId) throw new Error("The bill has no journal to reverse");
  if (voidDate < bill.billDate) throw new Error("A void can't be dated before the bill");
  // The conditional update row-locks the bill; a concurrent payment or credit waits and then finds it voided.
  const claimed = await prisma.apBill.updateMany({
    where: { id: billId, companyId, status: "POSTED", amountPaid: 0, amountCredited: 0, grniCleared: 0 },
    data: {
      status: "REVERSED",
      voidedAt: new Date(),
      voidReason: reason,
      voidedByErpUserId: actor.erpUserId,
      // Frees the supplier's invoice number so the corrected bill can be entered under it.
      ...(bill.supplierInvoiceNumber ? { supplierInvoiceNumber: `${bill.supplierInvoiceNumber} (void ${bill.billNumber})` } : {}),
    },
  });
  if (!claimed.count) {
    const fresh = await prisma.apBill.findUniqueOrThrow({ where: { id: billId } });
    if (fresh.status !== "POSTED") throw new Error("Bill is already voided");
    throw new Error("The bill has payments, credits or matched goods; reverse those first");
  }
  const original = await prisma.journalLine.findMany({ where: { journalId: bill.journalId }, orderBy: { lineNumber: "asc" } });
  if (!original.length) throw new Error("The bill's journal has no lines");
  const lines: JournalLineDraft[] = original.map((line) => ({
    accountId: line.accountId,
    description: `Void: ${line.description ?? "bill"}`,
    debit: money(line.credit),
    credit: money(line.debit),
    taxCode: line.taxCode ?? undefined,
    customerRef: line.customerRef ?? undefined,
    supplierRef: line.supplierRef ?? undefined,
    costCentre: line.costCentre ?? undefined,
    project: line.project ?? undefined,
    branchId: line.branchId ?? undefined,
  }));
  const posted = await postBalanced(
    companyId,
    {
      journalDate: voidDate,
      description: `Void bill ${bill.billNumber} — ${reason}`,
      referenceNumber: bill.supplierInvoiceNumber || bill.billNumber,
      ...(await reversalCurrency(companyId, bill.journalId)),
      sourceDocumentType: "ApBillVoid",
      sourceDocumentId: bill.id,
      sourceDocumentNumber: bill.billNumber,
      supplierRef: bill.supplierId,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.apBill.update({ where: { id: bill.id }, data: { voidJournalId: posted.id } });
    await appendLedger(tx, {
      companyId,
      supplierId: bill.supplierId,
      entryDate: voidDate,
      docType: "BILL_VOID",
      docId: bill.id,
      docNumber: bill.billNumber,
      description: reason,
      debit: money(bill.gross),
      credit: 0,
    });
  });
  await audit(companyId, actor, "VOID", "ApBill", bill.id, { status: "REVERSED", journalId: posted.id, reason }, { status: "POSTED" });
  return { billId: bill.id, journalId: posted.id, status: "REVERSED" as const };
}

export async function ageingReport(companyId: string, asOf?: Date | string) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const bills = await prisma.apBill.findMany({
    where: { companyId, status: "POSTED", billDate: { lte: asOfDate } },
    include: { supplier: true },
  });
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b.key, 0])) as Record<(typeof AGEING_BUCKETS)[number]["key"], number>;
  const lines = [];
  for (const bill of bills) {
    const outstanding = billOutstanding(bill);
    if (outstanding <= 0) continue;
    const bucket = ageingBucketKey(bill.dueDate, asOfDate);
    buckets[bucket] = roundMoney(buckets[bucket] + outstanding);
    lines.push({
      billId: bill.id,
      supplierId: bill.supplierId,
      supplierCode: bill.supplier.code,
      supplierName: bill.supplier.name,
      billNumber: bill.billNumber,
      supplierInvoiceNumber: bill.supplierInvoiceNumber,
      dueDate: bill.dueDate,
      outstanding,
      bucket,
    });
  }
  return {
    asOf: asOfDate,
    buckets: AGEING_BUCKETS.map((b) => ({ ...b, amount: buckets[b.key] })),
    lines,
    total: roundMoney(Object.values(buckets).reduce((sum, v) => sum + v, 0)),
  };
}

function range(from?: string, to?: string) {
  const end = to ? new Date(`${to.slice(0, 10)}T23:59:59.999Z`) : new Date();
  const start = from ? new Date(`${from.slice(0, 10)}T00:00:00.000Z`) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  if (start > end) throw new Error("The start date must be on or before the end date");
  return { start, end };
}

export async function withholdingReport(companyId: string, from?: string, to?: string) {
  const { start, end } = range(from, to);
  const payments = await prisma.apPayment.findMany({
    where: { companyId, status: "POSTED", withholdingTax: { gt: 0 }, paymentDate: { gte: start, lte: end } },
    include: { supplier: true },
    orderBy: { paymentDate: "asc" },
  });
  const rows = payments.map((p) => ({
    paymentId: p.id,
    paymentNumber: p.paymentNumber,
    paymentDate: p.paymentDate,
    supplierId: p.supplierId,
    supplierName: p.supplier.name,
    supplierTin: p.supplier.tin,
    whtCategory: p.supplier.whtCategory,
    grossSettled: roundMoney(money(p.amount) + money(p.withholdingTax)),
    withholdingTax: money(p.withholdingTax),
    netPaid: money(p.amount),
    reference: p.reference,
  }));
  return {
    from: start,
    to: end,
    rows,
    totalWithheld: roundMoney(rows.reduce((s, r) => s + r.withholdingTax, 0)),
    totalSettled: roundMoney(rows.reduce((s, r) => s + r.grossSettled, 0)),
  };
}

export async function purchasesBySupplier(companyId: string, from?: string, to?: string) {
  const { start, end } = range(from, to);
  const bills = await prisma.apBill.findMany({
    where: { companyId, status: "POSTED", billDate: { gte: start, lte: end }, sourceDocumentType: { not: "SupplierOpening" } },
    include: { supplier: true },
  });
  const map = new Map<string, { supplierId: string; supplierCode: string; supplierName: string; bills: number; net: number; tax: number; gross: number; outstanding: number }>();
  for (const bill of bills) {
    const row = map.get(bill.supplierId) ?? {
      supplierId: bill.supplierId,
      supplierCode: bill.supplier.code,
      supplierName: bill.supplier.name,
      bills: 0,
      net: 0,
      tax: 0,
      gross: 0,
      outstanding: 0,
    };
    row.bills += 1;
    row.net = roundMoney(row.net + money(bill.net) - money(bill.discount));
    row.tax = roundMoney(row.tax + money(bill.tax));
    row.gross = roundMoney(row.gross + money(bill.gross));
    row.outstanding = roundMoney(row.outstanding + billOutstanding(bill));
    map.set(bill.supplierId, row);
  }
  const rows = [...map.values()].sort((a, b) => b.gross - a.gross);
  return {
    from: start,
    to: end,
    rows,
    totalGross: roundMoney(rows.reduce((s, r) => s + r.gross, 0)),
    totalTax: roundMoney(rows.reduce((s, r) => s + r.tax, 0)),
  };
}

export async function apDashboard(companyId: string) {
  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const yearAgo = new Date(todayStart.getTime() - 365 * DAY);
  const [suppliers, bills, payments, advances, creditNotes, allocations] = await Promise.all([
    prisma.supplier.findMany({ where: { companyId }, select: { status: true } }),
    prisma.apBill.findMany({ where: { companyId, status: "POSTED" }, include: { supplier: { select: { name: true } } } }),
    prisma.apPayment.findMany({
      where: { companyId, status: "POSTED" },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: { supplier: { select: { name: true } } },
    }),
    prisma.apAdvance.findMany({ where: { companyId, status: "POSTED" }, select: { remaining: true } }),
    prisma.apCreditNote.findMany({ where: { companyId, status: "POSTED" }, orderBy: { noteDate: "desc" }, take: 5, include: { supplier: { select: { name: true } } } }),
    prisma.apAllocation.findMany({
      where: { payment: { companyId, status: "POSTED", paymentDate: { gte: yearAgo } } },
      include: { payment: { select: { paymentDate: true } }, bill: { select: { billDate: true, sourceDocumentType: true } } },
    }),
  ]);

  let outstanding = 0;
  const dueToday = { count: 0, amount: 0 };
  const overdue = { count: 0, amount: 0 };
  const dueNext7 = { count: 0, amount: 0 };
  const calendar = new Map<string, { date: string; count: number; amount: number }>();
  let monthlyPurchases = 0;
  for (const bill of bills) {
    if (bill.billDate >= monthStart && bill.sourceDocumentType !== "SupplierOpening") monthlyPurchases = roundMoney(monthlyPurchases + money(bill.gross));
    const open = billOutstanding(bill);
    if (open <= 0) continue;
    outstanding = roundMoney(outstanding + open);
    const days = Math.floor((bill.dueDate.getTime() - todayStart.getTime()) / DAY);
    if (days < 0) {
      overdue.count += 1;
      overdue.amount = roundMoney(overdue.amount + open);
    } else if (days === 0) {
      dueToday.count += 1;
      dueToday.amount = roundMoney(dueToday.amount + open);
    }
    if (days >= 0 && days <= 7) {
      dueNext7.count += 1;
      dueNext7.amount = roundMoney(dueNext7.amount + open);
    }
    if (days >= 0 && days <= 30) {
      const key = bill.dueDate.toISOString().slice(0, 10);
      const slot = calendar.get(key) ?? { date: key, count: 0, amount: 0 };
      slot.count += 1;
      slot.amount = roundMoney(slot.amount + open);
      calendar.set(key, slot);
    }
  }

  let weighted = 0;
  let weight = 0;
  for (const a of allocations) {
    if (a.bill.sourceDocumentType === "SupplierOpening") continue;
    const days = Math.max(0, (a.payment.paymentDate.getTime() - a.bill.billDate.getTime()) / DAY);
    weighted += days * money(a.amount);
    weight += money(a.amount);
  }

  const recentBills = [...bills]
    .filter((b) => b.sourceDocumentType !== "SupplierOpening")
    .sort((a, b) => b.billDate.getTime() - a.billDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8);
  const ageing = await ageingReport(companyId, today);
  return {
    totalSuppliers: suppliers.length,
    activeSuppliers: suppliers.filter((s) => s.status === "ACTIVE").length,
    totalOutstanding: outstanding,
    billsDueToday: dueToday,
    overdueBills: overdue,
    dueNext7Days: dueNext7,
    totalAdvances: roundMoney(advances.reduce((s, a) => s + money(a.remaining), 0)),
    monthlyPurchases,
    averagePaymentDays: weight > 0 ? Math.round(weighted / weight) : null,
    ageing: ageing.buckets,
    paymentCalendar: [...calendar.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recentBills: recentBills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      supplierId: b.supplierId,
      supplierName: b.supplier.name,
      billDate: b.billDate,
      gross: money(b.gross),
      outstanding: billOutstanding(b),
    })),
    recentPayments: payments.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      supplierId: p.supplierId,
      supplierName: p.supplier.name,
      paymentDate: p.paymentDate,
      amount: money(p.amount),
      withholdingTax: money(p.withholdingTax),
    })),
    recentCreditNotes: creditNotes.map((n) => ({
      id: n.id,
      creditNoteNumber: n.creditNoteNumber,
      supplierName: n.supplier.name,
      noteDate: n.noteDate,
      gross: money(n.gross),
      reason: n.reason,
    })),
  };
}

/* ── ERP integration: mirror posted events onto the AP subledger ──── */

type SupplierEventPayload = {
  parties?: { externalSupplierId?: string | number };
  amountTotals?: { gross?: string | number; net?: string | number; tax?: string | number };
  metadata?: Record<string, unknown>;
  paymentSplits?: Array<{ paymentMethod?: string }>;
};

async function resolveEventSupplier(companyId: string, payload: SupplierEventPayload, currency: string) {
  const externalId = payload.parties?.externalSupplierId !== undefined ? String(payload.parties.externalSupplierId) : undefined;
  const name = typeof payload.metadata?.supplierName === "string" ? payload.metadata.supplierName : undefined;
  if (!externalId) throw new Error("Supplier event has no supplier reference (parties.externalSupplierId)");
  const existing = await prisma.supplier.findFirst({ where: { companyId, externalErpSupplierId: externalId } });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      companyId,
      code: `ERP-${externalId}`,
      name: name || `Excel Edge supplier ${externalId}`,
      externalErpSupplierId: externalId,
      currency: currency || "RWF",
    },
  });
}

export async function syncSupplierBillToSubledger(eventId: string) {
  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || event.eventType !== "SUPPLIER_BILL_APPROVED" || !event.journalId) return null;
  const existing = await prisma.apBill.findFirst({
    where: { companyId: event.companyId, sourceModule: event.sourceModule, sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  if (existing) return existing;
  const payload = event.payload as SupplierEventPayload;
  const supplier = await resolveEventSupplier(event.companyId, payload, event.currencyCode);
  const meta = payload.metadata ?? {};
  const net = roundMoney(Number(payload.amountTotals?.net || meta.net || 0));
  const tax = roundMoney(Number(payload.amountTotals?.tax || meta.tax || 0));
  const gross = roundMoney(net + tax);
  const due = typeof meta.dueDate === "string" && !Number.isNaN(Date.parse(meta.dueDate))
    ? new Date(meta.dueDate)
    : new Date(event.occurredAt.getTime() + supplier.creditPeriodDays * DAY);
  const billNumber = await nextNumber(event.companyId, "AP_BILL", "BILL");
  const { accounts } = await inventoryConfig(event.companyId);
  const grniCleared = accounts.grniId
    ? await prisma.journalLine.aggregate({ where: { journalId: event.journalId, accountId: accounts.grniId }, _sum: { debit: true } })
    : null;
  const bill = await prisma.apBill.create({
    data: {
      companyId: event.companyId,
      supplierId: supplier.id,
      billNumber,
      grniCleared: money(grniCleared?._sum.debit),
      supplierInvoiceNumber: typeof meta.supplierInvoiceNumber === "string" ? meta.supplierInvoiceNumber : undefined,
      billDate: event.occurredAt,
      dueDate: due,
      poReference: typeof meta.poReference === "string" && meta.poReference.trim() ? meta.poReference.trim() : undefined,
      grnReference: typeof meta.grnReference === "string" ? meta.grnReference : undefined,
      currency: event.currencyCode,
      net,
      tax,
      gross,
      description: event.sourceDocumentNumber ? `Excel Edge bill ${event.sourceDocumentNumber}` : "Excel Edge supplier bill",
      journalId: event.journalId,
      sourceModule: event.sourceModule,
      sourceDocumentType: event.sourceDocumentType,
      sourceDocumentId: event.sourceDocumentId,
      sourceDocumentNumber: event.sourceDocumentNumber,
    },
  });
  await prisma.$transaction((tx) =>
    appendLedger(tx, {
      companyId: event.companyId,
      supplierId: supplier.id,
      entryDate: event.occurredAt,
      docType: "BILL",
      docId: bill.id,
      docNumber: bill.billNumber,
      description: bill.description,
      debit: 0,
      credit: gross,
    }),
  );
  const document = meta.document as { fileName?: string; path?: string } | undefined;
  if (document?.path) {
    await prisma.accountingDocument.create({
      data: {
        companyId: event.companyId,
        entityType: "ApBill",
        entityId: bill.id,
        fileName: document.fileName || "Scanned invoice",
        note: `Captured by scan in Excel Edge${meta.supplierTin ? `, supplier TIN ${meta.supplierTin}` : ""}`,
        contentText: document.path,
      },
    });
  }
  return bill;
}

export async function syncSupplierPaymentToSubledger(eventId: string) {
  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || !["SUPPLIER_PAYMENT_COMPLETED", "SUPPLIER_PAYMENT_MADE"].includes(event.eventType) || !event.journalId) return null;
  const existing = await prisma.apPayment.findFirst({
    where: { companyId: event.companyId, sourceModule: event.sourceModule, sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  if (existing) return existing;
  const payload = event.payload as SupplierEventPayload;
  const supplier = await resolveEventSupplier(event.companyId, payload, event.currencyCode);
  const meta = payload.metadata ?? {};
  const amount = roundMoney(Number(payload.amountTotals?.gross ?? payload.amountTotals?.net ?? meta.amount ?? 0));
  if (amount <= 0) throw new Error("Supplier payment event has no amount");
  const splits = readPaymentSplits(payload.paymentSplits, amount, meta.paymentType ?? meta.paymentMethod);
  const main = splits.reduce((a, b) => (b.amount > a.amount ? b : a), splits[0]);
  const method: ApPaymentMethod = main?.method === "BANK" ? "BANK" : main?.method === "MOBILE_MONEY" ? "MOBILE_MONEY" : "CASH";

  // The bill named by the event, otherwise the open bills of the same purchase order, oldest first.
  const billRef = typeof meta.billSourceDocumentId === "string" || typeof meta.billSourceDocumentId === "number" ? String(meta.billSourceDocumentId) : undefined;
  const poReference = typeof meta.poReference === "string" && meta.poReference.trim() ? meta.poReference.trim() : undefined;
  const candidates = billRef
    ? await prisma.apBill.findMany({ where: { companyId: event.companyId, supplierId: supplier.id, sourceDocumentId: billRef, status: "POSTED" } })
    : poReference
      ? await prisma.apBill.findMany({ where: { companyId: event.companyId, supplierId: supplier.id, poReference, status: "POSTED" }, orderBy: [{ billDate: "asc" }, { createdAt: "asc" }] })
      : [];
  const paymentNumber = await nextNumber(event.companyId, "AP_PAYMENT", "PAY");

  return prisma.$transaction(async (tx) => {
    let left = amount;
    const allocations: Array<{ billId: string; amount: number }> = [];
    for (const bill of candidates) {
      if (left <= 0) break;
      const take = roundMoney(Math.min(left, billOutstanding(bill)));
      if (take <= 0) continue;
      allocations.push({ billId: bill.id, amount: take });
      left = roundMoney(left - take);
    }
    const payment = await tx.apPayment.create({
      data: {
        companyId: event.companyId,
        supplierId: supplier.id,
        paymentNumber,
        paymentDate: event.occurredAt,
        method,
        amount,
        unallocated: left,
        journalId: event.journalId,
        description: event.sourceDocumentNumber ? `Excel Edge payment ${event.sourceDocumentNumber}` : "Excel Edge supplier payment",
        sourceModule: event.sourceModule,
        sourceDocumentType: event.sourceDocumentType,
        sourceDocumentId: event.sourceDocumentId,
      },
    });
    for (const allocation of allocations) {
      await tx.apAllocation.create({ data: { paymentId: payment.id, billId: allocation.billId, amount: allocation.amount } });
      const updated = await bumpPostedBill(tx, allocation.billId, { amountPaid: { increment: allocation.amount } });
      if (billOutstanding(updated) < -0.0001) throw new Error(`Bill ${updated.billNumber} was paid by another payment at the same time; retry`);
    }
    await appendLedger(tx, {
      companyId: event.companyId,
      supplierId: supplier.id,
      entryDate: event.occurredAt,
      docType: "PAYMENT",
      docId: payment.id,
      docNumber: payment.paymentNumber,
      description: payment.description,
      debit: amount,
      credit: 0,
    });
    return payment;
  });
}

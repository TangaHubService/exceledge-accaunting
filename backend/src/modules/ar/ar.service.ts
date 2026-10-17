import {
  ageingBucketKey,
  AGEING_BUCKETS,
  assertCreditAvailable,
  assertCustomerTransactable,
  assertReceiptAllocations,
  buildArCreditNoteLines,
  buildArDebitNoteLines,
  buildArInvoiceLines,
  buildArReceiptLines,
  buildCustomerDepositLines,
  buildDepositApplicationLines,
  buildArReceiptLines as buildReceiptReversalSource,
  buildLinedInvoiceJournal,
  creditPortion,
  periodStatement,
  type DocumentLineInput,
  readPaymentSplits,
  realizedFxSettlement,
  roundMoney,
  settledPortion,
  settlementAccountId,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { CustomerType, Prisma } from "@prisma/client";
import { defaultsFor, fxAccounts, money, nextNumber, priceDocumentLines, resolveDocumentMoney, settlementDefaults } from "../../lib/documents";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal, reversalCurrency } from "../journals/journal.service";

type Actor = {
  erpUserId?: number;
  erpRole?: string;
  allowCreditOverride?: boolean;
  meta?: { ipAddress?: string; userAgent?: string };
};

async function appendLedger(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    customerId: string;
    entryDate: Date;
    docType: string;
    docId: string;
    docNumber?: string | null;
    description?: string | null;
    debit: number;
    credit: number;
  },
) {
  // An increment locks the customer row, so concurrent postings cannot overwrite each other's balance.
  const customer = await tx.customer.update({
    where: { id: input.customerId },
    data: { balance: { increment: roundMoney(input.debit - input.credit) } },
  });
  const next = money(customer.balance);
  return tx.arLedgerEntry.create({
    data: {
      companyId: input.companyId,
      customerId: input.customerId,
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
    customerRef?: string;
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
      sourceModule: "AR",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      status: "APPROVED",
      lines: input.lines.map((line) => ({
        ...line,
        customerRef: input.customerRef,
      })),
    },
    actor,
  );
}

function invoiceOutstanding(invoice: {
  gross: { toString(): string } | number;
  amountPaid: { toString(): string } | number;
  amountCredited: { toString(): string } | number;
  status: string;
}) {
  if (invoice.status !== "POSTED") return 0;
  return roundMoney(money(invoice.gross) - money(invoice.amountPaid) - money(invoice.amountCredited));
}

/** Adds to an invoice's paid or credited amount in place, refusing one that is no longer posted or would go below zero. */
async function bumpOpenInvoice(tx: Prisma.TransactionClient, invoiceId: string, data: Prisma.ArInvoiceUpdateManyMutationInput) {
  const updated = await tx.arInvoice.updateMany({ where: { id: invoiceId, status: "POSTED" }, data });
  if (!updated.count) throw new Error("Invoice is no longer open");
  const invoice = await tx.arInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoiceOutstanding(invoice) < -0.0001) throw new Error(`Invoice ${invoice.invoiceNumber} was settled by another transaction at the same time; refresh and try again`);
  return invoice;
}

export async function createCustomer(
  companyId: string,
  input: {
    code?: string;
    name: string;
    customerType?: CustomerType;
    category?: string;
    tin?: string;
    vatNumber?: string;
    nationalId?: string;
    registrationNumber?: string;
    contactPerson?: string;
    telephone?: string;
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
    creditLimit?: number;
    creditPeriodDays?: number;
    arAccountId?: string;
    taxCategory?: string;
    defaultSalesAccountId?: string;
    defaultPriceList?: string;
    salesRepresentative?: string;
    branchId?: string;
    costCentre?: string;
    creditStatus?: "GOOD" | "WATCH" | "ON_HOLD" | "BLOCKED";
    riskCategory?: string;
    collectionPriority?: string;
    openingBalance?: number;
    notes?: string;
    externalErpCustomerId?: string;
  },
  actor: Actor = {},
) {
  const code = input.code?.trim() || (await nextNumber(companyId, "CUSTOMER", "CUS"));
  const existing = await prisma.customer.findFirst({
    where: { companyId, code },
  });
  if (existing) throw new Error("Customer code already exists");

  const opening = roundMoney(input.openingBalance ?? 0);
  const customer = await prisma.customer.create({
    data: {
      companyId,
      code,
      name: input.name.trim(),
      customerType: input.customerType ?? "CREDIT",
      category: input.category,
      tin: input.tin,
      vatNumber: input.vatNumber,
      nationalId: input.nationalId,
      registrationNumber: input.registrationNumber,
      contactPerson: input.contactPerson,
      telephone: input.telephone,
      email: input.email,
      website: input.website,
      physicalAddress: input.physicalAddress,
      country: input.country,
      province: input.province,
      district: input.district,
      sector: input.sector,
      cell: input.cell,
      village: input.village,
      currency: input.currency ?? "RWF",
      paymentTerms: input.paymentTerms,
      creditLimit: input.creditLimit ?? 0,
      creditPeriodDays: input.creditPeriodDays ?? 30,
      arAccountId: input.arAccountId,
      taxCategory: input.taxCategory,
      defaultSalesAccountId: input.defaultSalesAccountId,
      defaultPriceList: input.defaultPriceList,
      salesRepresentative: input.salesRepresentative,
      branchId: input.branchId,
      costCentre: input.costCentre,
      creditStatus: input.creditStatus ?? "GOOD",
      riskCategory: input.riskCategory,
      collectionPriority: input.collectionPriority,
      openingBalance: opening,
      notes: input.notes,
      externalErpCustomerId: input.externalErpCustomerId,
    },
  });

  if (opening > 0) {
    const defaults = await defaultsFor(companyId);
    const ar = customer.arAccountId || defaults.accountsReceivableId;
    const contra = defaults.suspenseAccountId || defaults.retainedEarningsId;
    if (!ar || !contra) throw new Error("AR and suspense/retained earnings accounts are required for opening balances");
    const posted = await postBalanced(
      companyId,
      {
        journalDate: new Date(),
        description: `Opening balance ${customer.code}`,
        referenceNumber: customer.code,
        sourceDocumentType: "CustomerOpening",
        sourceDocumentId: customer.id,
        sourceDocumentNumber: customer.code,
        customerRef: customer.id,
        lines: [
          { accountId: ar, description: "Customer opening balance", debit: opening, credit: 0 },
          { accountId: contra, description: "Opening balance contra", debit: 0, credit: opening },
        ],
      },
      actor,
    );
    await prisma.$transaction(async (tx) => {
      await appendLedger(tx, {
        companyId,
        customerId: customer.id,
        entryDate: new Date(),
        docType: "OPENING",
        docId: customer.id,
        docNumber: customer.code,
        description: "Opening balance",
        debit: opening,
        credit: 0,
      });
      await tx.arInvoice.create({
        data: {
          companyId,
          customerId: customer.id,
          invoiceNumber: await nextNumber(companyId, "AR_INVOICE", "INV"),
          invoiceDate: new Date(),
          dueDate: new Date(),
          currency: customer.currency,
          net: opening,
          gross: opening,
          description: "Opening balance",
          journalId: posted.id,
          sourceModule: "AR",
          sourceDocumentType: "CustomerOpening",
          sourceDocumentId: customer.id,
        },
      });
    });
  }

  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "CREATE",
    entityType: "Customer",
    entityId: customer.id,
    afterJson: { code: customer.code, name: customer.name },
    ...actor.meta,
  });

  return prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
}

export async function updateCustomer(
  companyId: string,
  customerId: string,
  input: Partial<{
    name: string;
    customerType: CustomerType;
    category: string;
    tin: string;
    telephone: string;
    email: string;
    paymentTerms: string;
    creditLimit: number;
    creditPeriodDays: number;
    creditStatus: "GOOD" | "WATCH" | "ON_HOLD" | "BLOCKED";
    status: "ACTIVE" | "INACTIVE";
    notes: string;
    physicalAddress: string;
  }>,
  actor: Actor = {},
) {
  const before = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!before) throw new Error("Customer does not exist");
  const updated = await prisma.customer.update({
    where: { id: before.id },
    data: input,
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "Customer",
    entityId: updated.id,
    beforeJson: { name: before.name, creditLimit: money(before.creditLimit), status: before.status },
    afterJson: { name: updated.name, creditLimit: money(updated.creditLimit), status: updated.status },
    ...actor.meta,
  });
  return updated;
}

export async function listCustomers(companyId: string, q?: string) {
  return prisma.customer.findMany({
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

export async function getCustomer(companyId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!customer) throw new Error("Customer does not exist");
  return customer;
}

/** A credit hold stops new receivables, not money coming in: `collecting` skips it for receipts. */
async function loadActiveCustomer(companyId: string, customerId: string, options: { collecting?: boolean } = {}) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  assertCustomerTransactable({
    exists: Boolean(customer),
    active: customer?.status === "ACTIVE",
    creditStatus: options.collecting ? undefined : customer?.creditStatus,
  });
  return customer!;
}

export async function createInvoice(
  companyId: string,
  input: {
    customerId: string;
    invoiceDate: Date | string;
    dueDate?: Date | string;
    net?: number;
    tax?: number;
    discount?: number;
    description?: string;
    currency?: string;
    exchangeRate?: number;
    /** Line items; when given, the totals come from the lines and their tax codes. */
    lines?: DocumentLineInput[];
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId);
  const invoiceDate = new Date(input.invoiceDate);
  const fx = await resolveDocumentMoney(companyId, {
    documentCurrency: input.currency,
    partyCurrency: customer.currency,
    date: invoiceDate,
    rate: input.exchangeRate,
  });
  const priced = input.lines?.length ? await priceDocumentLines(companyId, input.lines, invoiceDate, "sales") : null;
  if (priced && input.discount) throw new Error("Give discounts on the lines when an invoice has lines");
  if (priced && (input.net != null || input.tax != null)) throw new Error("An invoice with lines takes its net and tax from the lines");
  if (!priced && !(Number(input.net) > 0)) throw new Error("Invoice amount must be positive");
  const net = priced ? priced.net : roundMoney(input.net!);
  const tax = priced ? priced.tax : roundMoney(input.tax ?? 0);
  const discount = priced ? 0 : roundMoney(input.discount ?? 0);
  const gross = roundMoney(net + tax - discount);
  assertCreditAvailable({
    customerType: customer.customerType,
    creditLimit: money(customer.creditLimit),
    outstanding: money(customer.balance),
    additional: gross,
    allowOverride: actor.allowCreditOverride,
  });
  const defaults = await defaultsFor(companyId);
  const lines = priced
    ? buildLinedInvoiceJournal(defaults, { lines: priced.lines, arAccountId: customer.arAccountId, salesAccountId: customer.defaultSalesAccountId })
    : buildArInvoiceLines(defaults, {
        net,
        tax,
        discount,
        arAccountId: customer.arAccountId,
        salesAccountId: customer.defaultSalesAccountId,
      });
  const due = input.dueDate
    ? new Date(input.dueDate)
    : new Date(invoiceDate.getTime() + customer.creditPeriodDays * 86_400_000);
  const invoiceNumber = await nextNumber(companyId, "AR_INVOICE", "INV");
  const draft = await prisma.arInvoice.create({
    data: {
      companyId,
      customerId: customer.id,
      invoiceNumber,
      invoiceDate,
      dueDate: due,
      currency: fx.currency,
      exchangeRate: fx.rate,
      net,
      tax,
      discount,
      gross,
      description: input.description,
      sourceModule: "AR",
      sourceDocumentType: "ArInvoice",
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
  const posted = await postBalanced(
    companyId,
    {
      journalDate: invoiceDate,
      description: input.description || `Invoice ${invoiceNumber}`,
      referenceNumber: invoiceNumber,
      currencyCode: fx.currency,
      exchangeRate: fx.rate,
      sourceDocumentType: "ArInvoice",
      sourceDocumentId: draft.id,
      sourceDocumentNumber: invoiceNumber,
      customerRef: customer.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.arInvoice.update({
      where: { id: draft.id },
      data: { journalId: posted.id, sourceDocumentId: draft.id },
    });
    await appendLedger(tx, {
      companyId,
      customerId: customer.id,
      entryDate: invoiceDate,
      docType: "INVOICE",
      docId: draft.id,
      docNumber: invoiceNumber,
      description: input.description || "Sales invoice",
      debit: gross,
      credit: 0,
    });
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "POST",
    entityType: "ArInvoice",
    entityId: draft.id,
    afterJson: { invoiceNumber, gross },
    ...actor.meta,
  });
  return prisma.arInvoice.findUniqueOrThrow({ where: { id: draft.id } });
}

export async function createReceipt(
  companyId: string,
  input: {
    customerId: string;
    receiptDate: Date | string;
    method?: "CASH" | "BANK" | "MOBILE_MONEY" | "CARD" | "CHEQUE" | "ONLINE";
    amount: number;
    currency?: string;
    exchangeRate?: number;
    reference?: string;
    description?: string;
    allocations?: Array<{ invoiceId: string; amount: number }>;
    allowOverpayment?: boolean;
    financialAccountId?: string;
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId, { collecting: true });
  const amount = roundMoney(input.amount);
  const receiptDate = new Date(input.receiptDate);
  const fx = await resolveDocumentMoney(companyId, {
    documentCurrency: input.currency,
    partyCurrency: customer.currency,
    date: receiptDate,
    rate: input.exchangeRate,
  });
  const requested = input.allocations ?? [];
  const invoices = requested.length
    ? await prisma.arInvoice.findMany({
        where: { companyId, customerId: customer.id, id: { in: requested.map((a) => a.invoiceId) } },
      })
    : [];
  if (invoices.length !== requested.length) throw new Error("One or more invoices were not found for this customer");
  for (const inv of invoices) {
    if (inv.currency.toUpperCase() !== fx.currency) throw new Error(`Invoice ${inv.invoiceNumber} is in ${inv.currency}; the receipt is in ${fx.currency}`);
  }
  const allocationCheck = assertReceiptAllocations({
    amount,
    allowOverpayment: input.allowOverpayment !== false,
    allocations: requested.map((row) => {
      const invoice = invoices.find((inv) => inv.id === row.invoiceId)!;
      return { amount: row.amount, outstanding: invoiceOutstanding(invoice) };
    }),
  });
  const defaults = await settlementDefaults(companyId, input.financialAccountId);
  const method = input.method ?? "CASH";
  const ratesMatch = invoices.every((inv) => Math.abs(Number(inv.exchangeRate) - fx.rate) < 1e-10);
  let lines: JournalLineDraft[];
  let journalCurrency = fx.currency;
  let journalRate = fx.rate;
  if (fx.currency === fx.functional || ratesMatch) {
    lines = buildArReceiptLines(defaults, amount, method, customer.arAccountId);
  } else {
    const cash = settlementAccountId(defaults, method);
    const ar = customer.arAccountId || defaults.accountsReceivableId;
    if (!cash || !ar) throw new Error("Cash or receivables account is not configured");
    const { gainId, lossId } = await fxAccounts(companyId);
    lines = realizedFxSettlement({
      cashAccountId: cash,
      controlAccountId: ar,
      fxGainAccountId: gainId,
      fxLossAccountId: lossId,
      amount,
      paymentRate: fx.rate,
      allocations: requested.map((row) => {
        const inv = invoices.find((i) => i.id === row.invoiceId)!;
        return { amount: roundMoney(row.amount), documentRate: Number(inv.exchangeRate) };
      }),
      side: "AR",
    });
    journalCurrency = fx.functional;
    journalRate = 1;
  }
  const receiptNumber = await nextNumber(companyId, "AR_RECEIPT", "RCT");
  const receipt = await prisma.arReceipt.create({
    data: {
      companyId,
      customerId: customer.id,
      receiptNumber,
      receiptDate,
      method,
      amount,
      currency: fx.currency,
      exchangeRate: fx.rate,
      unallocated: allocationCheck.unallocated,
      reference: input.reference,
      description: input.description,
      financialAccountId: input.financialAccountId,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: receiptDate,
      description: input.description || `Receipt ${receiptNumber}`,
      referenceNumber: receiptNumber,
      currencyCode: journalCurrency,
      exchangeRate: journalRate,
      sourceDocumentType: "ArReceipt",
      sourceDocumentId: receipt.id,
      sourceDocumentNumber: receiptNumber,
      customerRef: customer.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.arReceipt.update({ where: { id: receipt.id }, data: { journalId: posted.id } });
    for (const row of requested) {
      await tx.arAllocation.create({
        data: { receiptId: receipt.id, invoiceId: row.invoiceId, amount: roundMoney(row.amount) },
      });
      await bumpOpenInvoice(tx, row.invoiceId, { amountPaid: { increment: roundMoney(row.amount) } });
    }
    await appendLedger(tx, {
      companyId,
      customerId: customer.id,
      entryDate: receiptDate,
      docType: "RECEIPT",
      docId: receipt.id,
      docNumber: receiptNumber,
      description: input.description || "Customer receipt",
      debit: 0,
      credit: amount,
    });
  });
  return prisma.arReceipt.findUniqueOrThrow({
    where: { id: receipt.id },
    include: { allocations: true },
  });
}

export async function reverseReceipt(companyId: string, receiptId: string, actor: Actor = {}, options: { reason?: string; reversalDate?: Date } = {}) {
  return inTransaction(() => reverseReceiptOnce(companyId, receiptId, actor, options));
}

async function reverseReceiptOnce(companyId: string, receiptId: string, actor: Actor, options: { reason?: string; reversalDate?: Date }) {
  const reversalDate = options.reversalDate ?? new Date();
  const receipt = await prisma.arReceipt.findFirst({
    where: { id: receiptId, companyId },
    include: { allocations: true, customer: true },
  });
  if (!receipt) throw new Error("Receipt does not exist");
  // A receipt recorded in Banking is claimed through its bank transaction first, in the same order Banking uses.
  const bankLinked = await prisma.bankTransaction.updateMany({ where: { companyId, arReceiptId: receiptId, status: "POSTED" }, data: { status: "REVERSED" } });
  // The conditional update row-locks the receipt, so a concurrent reversal waits and then finds it reversed.
  const claimed = await prisma.arReceipt.updateMany({ where: { id: receiptId, companyId, status: "POSTED" }, data: { status: "REVERSED" } });
  if (!claimed.count) throw new Error("Receipt is already reversed");
  const defaults = await settlementDefaults(companyId, receipt.financialAccountId);
  const original = buildReceiptReversalSource(
    defaults,
    money(receipt.amount),
    receipt.method,
    receipt.customer.arAccountId,
  );
  const lines = original.map((line) => ({
    ...line,
    debit: line.credit,
    credit: line.debit,
    description: `Reversal: ${line.description ?? "receipt"}`,
  }));
  const posted = await postBalanced(
    companyId,
    {
      journalDate: reversalDate,
      description: `Reverse receipt ${receipt.receiptNumber}${options.reason ? ` — ${options.reason}` : ""}`,
      referenceNumber: receipt.receiptNumber,
      ...(await reversalCurrency(companyId, receipt.journalId)),
      sourceDocumentType: "ArReceiptReversal",
      sourceDocumentId: receipt.id,
      sourceDocumentNumber: receipt.receiptNumber,
      customerRef: receipt.customerId,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    for (const allocation of receipt.allocations) {
      await tx.arInvoice.update({ where: { id: allocation.invoiceId }, data: { amountPaid: { decrement: money(allocation.amount) } } });
    }
    await appendLedger(tx, {
      companyId,
      customerId: receipt.customerId,
      entryDate: reversalDate,
      docType: "RECEIPT_REVERSAL",
      docId: receipt.id,
      docNumber: receipt.receiptNumber,
      description: options.reason || "Receipt reversal",
      debit: money(receipt.amount),
      credit: 0,
    });
  });
  if (bankLinked.count) {
    await prisma.bankTransaction.updateMany({
      where: { companyId, arReceiptId: receiptId },
      data: { reversalJournalId: posted.id, reversedAt: reversalDate, reversedByErpUserId: actor.erpUserId, reversalReason: options.reason || `Receipt ${receipt.receiptNumber} reversed in Receivables` },
    });
  }
  return { receiptId: receipt.id, journalId: posted.id, status: "REVERSED" as const };
}

export async function createCreditNote(
  companyId: string,
  input: {
    customerId: string;
    invoiceId?: string;
    noteDate: Date | string;
    reason: string;
    net: number;
    tax?: number;
    description?: string;
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId);
  const net = roundMoney(input.net);
  const tax = roundMoney(input.tax ?? 0);
  const gross = roundMoney(net + tax);
  let invoice = null as Awaited<ReturnType<typeof prisma.arInvoice.findFirst>>;
  if (input.invoiceId) {
    invoice = await prisma.arInvoice.findFirst({
      where: { id: input.invoiceId, companyId, customerId: customer.id, status: "POSTED" },
    });
    if (!invoice) throw new Error("Invoice does not exist");
    if (gross - invoiceOutstanding(invoice) > 0.0001) {
      throw new Error("Credit note exceeds invoice outstanding balance");
    }
  }
  const defaults = await defaultsFor(companyId);
  const lines = buildArCreditNoteLines(defaults, { net, tax, arAccountId: customer.arAccountId });
  const noteDate = new Date(input.noteDate);
  const creditNoteNumber = await nextNumber(companyId, "AR_CREDIT_NOTE", "CN");
  const note = await prisma.arCreditNote.create({
    data: {
      companyId,
      customerId: customer.id,
      invoiceId: invoice?.id,
      creditNoteNumber,
      noteDate,
      reason: input.reason,
      net,
      tax,
      gross,
      description: input.description,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: noteDate,
      description: input.description || `Credit note ${creditNoteNumber}`,
      referenceNumber: creditNoteNumber,
      sourceDocumentType: "ArCreditNote",
      sourceDocumentId: note.id,
      sourceDocumentNumber: creditNoteNumber,
      customerRef: customer.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.arCreditNote.update({ where: { id: note.id }, data: { journalId: posted.id } });
    if (invoice) await bumpOpenInvoice(tx, invoice.id, { amountCredited: { increment: gross } });
    await appendLedger(tx, {
      companyId,
      customerId: customer.id,
      entryDate: noteDate,
      docType: "CREDIT_NOTE",
      docId: note.id,
      docNumber: creditNoteNumber,
      description: input.reason,
      debit: 0,
      credit: gross,
    });
  });
  return prisma.arCreditNote.findUniqueOrThrow({ where: { id: note.id } });
}

export async function createDebitNote(
  companyId: string,
  input: {
    customerId: string;
    noteDate: Date | string;
    dueDate?: Date | string;
    reason: string;
    net: number;
    tax?: number;
    description?: string;
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId);
  const net = roundMoney(input.net);
  const tax = roundMoney(input.tax ?? 0);
  const gross = roundMoney(net + tax);
  assertCreditAvailable({
    customerType: customer.customerType,
    creditLimit: money(customer.creditLimit),
    outstanding: money(customer.balance),
    additional: gross,
    allowOverride: actor.allowCreditOverride,
  });
  const defaults = await defaultsFor(companyId);
  const lines = buildArDebitNoteLines(defaults, {
    net,
    tax,
    arAccountId: customer.arAccountId,
    salesAccountId: customer.defaultSalesAccountId,
  });
  const noteDate = new Date(input.noteDate);
  const due = input.dueDate
    ? new Date(input.dueDate)
    : new Date(noteDate.getTime() + customer.creditPeriodDays * 86_400_000);
  const debitNoteNumber = await nextNumber(companyId, "AR_DEBIT_NOTE", "DN");
  const note = await prisma.arDebitNote.create({
    data: {
      companyId,
      customerId: customer.id,
      debitNoteNumber,
      noteDate,
      dueDate: due,
      reason: input.reason,
      net,
      tax,
      gross,
      description: input.description,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: noteDate,
      description: input.description || `Debit note ${debitNoteNumber}`,
      referenceNumber: debitNoteNumber,
      sourceDocumentType: "ArDebitNote",
      sourceDocumentId: note.id,
      sourceDocumentNumber: debitNoteNumber,
      customerRef: customer.id,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.arDebitNote.update({ where: { id: note.id }, data: { journalId: posted.id } });
    await appendLedger(tx, {
      companyId,
      customerId: customer.id,
      entryDate: noteDate,
      docType: "DEBIT_NOTE",
      docId: note.id,
      docNumber: debitNoteNumber,
      description: input.reason,
      debit: gross,
      credit: 0,
    });
  });
  return prisma.arDebitNote.findUniqueOrThrow({ where: { id: note.id } });
}

export async function createDeposit(
  companyId: string,
  input: {
    customerId: string;
    depositDate: Date | string;
    method?: "CASH" | "BANK" | "MOBILE_MONEY" | "CARD" | "CHEQUE" | "ONLINE";
    amount: number;
    reference?: string;
    description?: string;
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId);
  const amount = roundMoney(input.amount);
  const defaults = await defaultsFor(companyId);
  const lines = buildCustomerDepositLines(defaults, amount, input.method ?? "CASH");
  const depositDate = new Date(input.depositDate);
  const depositNumber = await nextNumber(companyId, "AR_DEPOSIT", "DEP");
  const deposit = await prisma.arDeposit.create({
    data: {
      companyId,
      customerId: customer.id,
      depositNumber,
      depositDate,
      method: input.method ?? "CASH",
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
      journalDate: depositDate,
      description: input.description || `Customer deposit ${depositNumber}`,
      referenceNumber: depositNumber,
      sourceDocumentType: "ArDeposit",
      sourceDocumentId: deposit.id,
      sourceDocumentNumber: depositNumber,
      customerRef: customer.id,
      lines,
    },
    actor,
  );
  return prisma.arDeposit.update({
    where: { id: deposit.id },
    data: { journalId: posted.id },
  });
}

export async function allocateDeposit(
  companyId: string,
  depositId: string,
  input: { invoiceId: string; amount: number },
  actor: Actor = {},
) {
  const deposit = await prisma.arDeposit.findFirst({
    where: { id: depositId, companyId, status: "POSTED" },
    include: { customer: true },
  });
  if (!deposit) throw new Error("Deposit does not exist");
  const amount = roundMoney(input.amount);
  if (amount - money(deposit.remaining) > 0.0001) throw new Error("Allocation exceeds remaining deposit");
  const invoice = await prisma.arInvoice.findFirst({
    where: { id: input.invoiceId, companyId, customerId: deposit.customerId, status: "POSTED" },
  });
  if (!invoice) throw new Error("Invoice does not exist");
  if (amount - invoiceOutstanding(invoice) > 0.0001) {
    throw new Error("Allocation exceeds invoice outstanding balance");
  }
  const defaults = await defaultsFor(companyId);
  const lines = buildDepositApplicationLines(defaults, amount, deposit.customer.arAccountId);
  const allocation = await prisma.arDepositAllocation.create({
    data: { depositId: deposit.id, invoiceId: invoice.id, amount },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: new Date(),
      description: `Apply deposit ${deposit.depositNumber}`,
      referenceNumber: deposit.depositNumber,
      sourceDocumentType: "ArDepositAllocation",
      sourceDocumentId: allocation.id,
      sourceDocumentNumber: deposit.depositNumber,
      customerRef: deposit.customerId,
      lines,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.arDepositAllocation.update({ where: { id: allocation.id }, data: { journalId: posted.id } });
    const taken = await tx.arDeposit.updateMany({
      where: { id: deposit.id, status: "POSTED", remaining: { gte: amount } },
      data: { remaining: { decrement: amount } },
    });
    if (!taken.count) throw new Error("Allocation exceeds remaining deposit");
    const updated = await tx.arInvoice.updateMany({ where: { id: invoice.id, status: "POSTED" }, data: { amountPaid: { increment: amount } } });
    if (!updated.count) throw new Error("Invoice is no longer open");
    if (invoiceOutstanding(await tx.arInvoice.findUniqueOrThrow({ where: { id: invoice.id } })) < -0.0001) {
      throw new Error("Allocation exceeds invoice outstanding balance");
    }
    await appendLedger(tx, {
      companyId,
      customerId: deposit.customerId,
      entryDate: new Date(),
      docType: "DEPOSIT_APPLICATION",
      docId: allocation.id,
      docNumber: deposit.depositNumber,
      description: "Deposit applied to invoice",
      debit: 0,
      credit: amount,
    });
  });
  return prisma.arDeposit.findUniqueOrThrow({
    where: { id: deposit.id },
    include: { allocations: true },
  });
}

export async function refundDeposit(companyId: string, depositId: string, actor: Actor = {}) {
  const deposit = await prisma.arDeposit.findFirst({
    where: { id: depositId, companyId, status: "POSTED" },
  });
  if (!deposit) throw new Error("Deposit does not exist");
  const amount = money(deposit.remaining);
  if (amount <= 0) throw new Error("Deposit has no remaining balance to refund");
  const defaults = await defaultsFor(companyId);
  const cash = settlementAccountId(defaults, deposit.method);
  if (!cash || !defaults.customerDepositsId) {
    throw new Error("Cash and customer deposits accounts are not configured");
  }
  // Claims exactly the balance read above, so a concurrent refund or allocation makes this one fail.
  const claimed = await prisma.arDeposit.updateMany({
    where: { id: deposit.id, status: "POSTED", remaining: deposit.remaining },
    data: { remaining: 0 },
  });
  if (!claimed.count) throw new Error("The deposit changed while refunding; refresh and try again");
  const posted = await postBalanced(
    companyId,
    {
      journalDate: new Date(),
      description: `Refund deposit ${deposit.depositNumber}`,
      referenceNumber: deposit.depositNumber,
      sourceDocumentType: "ArDepositRefund",
      sourceDocumentId: deposit.id,
      sourceDocumentNumber: deposit.depositNumber,
      customerRef: deposit.customerId,
      lines: [
        { accountId: defaults.customerDepositsId, description: "Refund customer deposit", debit: amount, credit: 0 },
        { accountId: cash, description: "Deposit refund", debit: 0, credit: amount },
      ],
    },
    actor,
  );
  return prisma.arDeposit.update({
    where: { id: deposit.id },
    data: { description: `Refunded via journal ${posted.journalNumber}` },
  });
}

export async function customerLedger(companyId: string, customerId: string) {
  await getCustomer(companyId, customerId);
  const entries = await prisma.arLedgerEntry.findMany({
    where: { companyId, customerId },
    orderBy: { createdAt: "asc" },
  });
  const opening = entries.length ? 0 : 0;
  const closing = entries.length ? money(entries[entries.length - 1].runningBalance) : 0;
  return { openingBalance: opening, entries, closingBalance: closing };
}

export async function customerStatement(
  companyId: string,
  customerId: string,
  type: "OUTSTANDING" | "FULL" = "OUTSTANDING",
) {
  const customer = await getCustomer(companyId, customerId);
  const invoices = await prisma.arInvoice.findMany({
    where: { companyId, customerId, status: "POSTED" },
    orderBy: { invoiceDate: "asc" },
  });
  const rows = invoices
    .map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      gross: money(invoice.gross),
      outstanding: invoiceOutstanding(invoice),
      description: invoice.description,
    }))
    .filter((row) => (type === "OUTSTANDING" ? row.outstanding > 0 : true));
  return {
    type,
    customer: { id: customer.id, code: customer.code, name: customer.name, balance: money(customer.balance) },
    rows,
    totalOutstanding: roundMoney(rows.reduce((sum, row) => sum + row.outstanding, 0)),
  };
}

function dayRange(from?: string, to?: string) {
  const parse = (value: string, end: boolean) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use yyyy-mm-dd dates");
    return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  };
  const now = new Date();
  const end = to ? parse(to, true) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const start = from ? parse(from, false) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  if (start > end) throw new Error("The start date is after the end date");
  return { start, end };
}

export async function listInvoices(
  companyId: string,
  filter: { status?: "OPEN" | "OVERDUE" | "PAID" | "ALL"; customerId?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number } = {},
) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = filter.from ? dayRange(filter.from, filter.from).start : undefined;
  const end = filter.to ? dayRange(filter.to, filter.to).end : undefined;
  if (start && end && start > end) throw new Error("The start date is after the end date");
  const q = filter.q?.trim();
  const invoices = await prisma.arInvoice.findMany({
    where: {
      companyId,
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(start || end ? { invoiceDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q, mode: "insensitive" as const } },
              { customer: { name: { contains: q, mode: "insensitive" as const } } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: { customer: { select: { id: true, code: true, name: true } } },
    orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
    take: 5000,
  });
  const rows = invoices
    .map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      customerId: invoice.customerId,
      customerCode: invoice.customer.code,
      customerName: invoice.customer.name,
      net: money(invoice.net),
      tax: money(invoice.tax),
      gross: money(invoice.gross),
      paid: money(invoice.amountPaid),
      credited: money(invoice.amountCredited),
      outstanding: invoiceOutstanding(invoice),
      sourceModule: invoice.sourceModule,
      description: invoice.description,
    }))
    .filter((row) =>
      filter.status === "OPEN"
        ? row.outstanding > 0
        : filter.status === "OVERDUE"
          ? row.outstanding > 0 && row.dueDate < today
          : filter.status === "PAID"
            ? row.status === "POSTED" && row.outstanding <= 0
            : true,
    );
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 500);
  const page = Math.max(filter.page ?? 1, 1);
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    totals: {
      gross: roundMoney(rows.reduce((s, r) => s + r.gross, 0)),
      outstanding: roundMoney(rows.reduce((s, r) => s + r.outstanding, 0)),
    },
  };
}

export async function getInvoice(companyId: string, invoiceId: string) {
  const invoice = await prisma.arInvoice.findFirst({
    where: { id: invoiceId, companyId },
    include: {
      customer: true,
      lines: { orderBy: { lineNumber: "asc" } },
      allocations: { include: { receipt: { select: { receiptNumber: true, receiptDate: true, status: true } } } },
      creditNotes: { select: { id: true, creditNoteNumber: true, noteDate: true, gross: true, status: true } },
    },
  });
  if (!invoice) throw new Error("Invoice does not exist");
  return { ...invoice, outstanding: invoiceOutstanding(invoice) };
}

/** Customer statement for a period: balance brought forward, each movement with a running balance, closing balance. */
export async function customerPeriodStatement(companyId: string, customerId: string, from?: string, to?: string) {
  const customer = await getCustomer(companyId, customerId);
  const { start, end } = dayRange(from, to);
  const entries = await prisma.arLedgerEntry.findMany({
    where: { companyId, customerId, entryDate: { lte: end } },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  const statement = periodStatement(
    entries.map((e) => ({ ...e, debit: money(e.debit), credit: money(e.credit) })),
    start,
    end,
    1,
  );
  return {
    customer: { id: customer.id, code: customer.code, name: customer.name, tin: customer.tin, physicalAddress: customer.physicalAddress },
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
    totalCharged: statement.totalDebit,
    totalPaid: statement.totalCredit,
    closingBalance: statement.closing,
  };
}

export async function listDeposits(companyId: string, customerId: string) {
  await getCustomer(companyId, customerId);
  const deposits = await prisma.arDeposit.findMany({ where: { companyId, customerId }, orderBy: { depositDate: "desc" } });
  return deposits.map((d) => ({ ...d, amount: money(d.amount), remaining: money(d.remaining) }));
}

export async function ageingReport(companyId: string, asOf?: Date | string) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const invoices = await prisma.arInvoice.findMany({
    where: { companyId, status: "POSTED" },
    include: { customer: true },
  });
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket.key, 0])) as Record<
    (typeof AGEING_BUCKETS)[number]["key"],
    number
  >;
  const lines = [];
  for (const invoice of invoices) {
    const outstanding = invoiceOutstanding(invoice);
    if (outstanding <= 0) continue;
    const bucket = ageingBucketKey(invoice.dueDate, asOfDate);
    buckets[bucket] = roundMoney(buckets[bucket] + outstanding);
    lines.push({
      customerId: invoice.customerId,
      customerCode: invoice.customer.code,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      dueDate: invoice.dueDate,
      outstanding,
      bucket,
    });
  }
  return {
    asOf: asOfDate,
    buckets: AGEING_BUCKETS.map((bucket) => ({ ...bucket, amount: buckets[bucket.key] })),
    lines,
    total: roundMoney(Object.values(buckets).reduce((sum, value) => sum + value, 0)),
  };
}

export async function arDashboard(companyId: string) {
  const [customers, invoices, receipts, creditNotes, deposits] = await Promise.all([
    prisma.customer.findMany({ where: { companyId } }),
    prisma.arInvoice.findMany({ where: { companyId, status: "POSTED" } }),
    prisma.arReceipt.findMany({
      where: { companyId, status: "POSTED" },
      orderBy: { receiptDate: "desc" },
      take: 8,
      include: { customer: true },
    }),
    prisma.arCreditNote.findMany({
      where: { companyId, status: "POSTED" },
      orderBy: { noteDate: "desc" },
      take: 8,
    }),
    prisma.arDeposit.findMany({ where: { companyId, status: "POSTED" } }),
  ]);
  const today = new Date();
  let outstanding = 0;
  let overdue = 0;
  for (const invoice of invoices) {
    const open = invoiceOutstanding(invoice);
    outstanding = roundMoney(outstanding + open);
    if (open > 0 && invoice.dueDate < today) overdue += 1;
  }
  const creditCustomers = customers.filter((customer) =>
    ["CREDIT", "GOVERNMENT", "CORPORATE", "NGO", "EXPORT", "FOREIGN"].includes(customer.customerType),
  );
  const limitTotal = creditCustomers.reduce((sum, customer) => sum + money(customer.creditLimit), 0);
  const utilized = creditCustomers.reduce((sum, customer) => sum + Math.max(money(customer.balance), 0), 0);
  const ageing = await ageingReport(companyId, today);
  return {
    totalCustomers: customers.length,
    activeCustomers: customers.filter((customer) => customer.status === "ACTIVE").length,
    cashCustomers: customers.filter((customer) => customer.customerType === "CASH" || customer.customerType === "WALK_IN").length,
    creditCustomers: creditCustomers.length,
    totalOutstanding: outstanding,
    totalDeposits: roundMoney(deposits.reduce((sum, deposit) => sum + money(deposit.remaining), 0)),
    overdueInvoices: overdue,
    creditUtilization: limitTotal > 0 ? roundMoney(utilized / limitTotal) : 0,
    ageing: ageing.buckets,
    recentReceipts: receipts.map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      amount: money(receipt.amount),
      customerName: receipt.customer.name,
      receiptDate: receipt.receiptDate,
    })),
    recentCreditNotes: creditNotes.map((note) => ({
      id: note.id,
      creditNoteNumber: note.creditNoteNumber,
      gross: money(note.gross),
      reason: note.reason,
      noteDate: note.noteDate,
    })),
  };
}

export async function syncSaleToSubledger(eventId: string) {
  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || event.eventType !== "SALE_COMPLETED" || !event.journalId) return null;
  const existing = await prisma.arInvoice.findFirst({
    where: {
      companyId: event.companyId,
      sourceModule: event.sourceModule,
      sourceDocumentType: event.sourceDocumentType,
      sourceDocumentId: event.sourceDocumentId,
    },
  });
  if (existing) return existing;

  const payload = event.payload as SaleEventPayload;
  const externalId = payload.parties?.externalCustomerId
    ? String(payload.parties.externalCustomerId)
    : undefined;
  const { net, tax, gross, splits } = saleEventAmounts(payload);
  const owed = creditPortion(splits);
  const settled = settledPortion(splits);
  const isCredit = owed > 0;
  let customer = externalId
    ? await prisma.customer.findFirst({
        where: { companyId: event.companyId, externalErpCustomerId: externalId },
      })
    : await prisma.customer.findFirst({
        where: { companyId: event.companyId, code: "WALK-IN" },
      });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        companyId: event.companyId,
        code: externalId ? `ERP-${externalId}` : "WALK-IN",
        name: payload.metadata?.customerName || (externalId ? `ERP Customer ${externalId}` : "Walk-in Customer"),
        customerType: isCredit ? "CREDIT" : "WALK_IN",
        externalErpCustomerId: externalId,
        currency: event.currencyCode || "RWF",
      },
    });
  }
  const invoice = await prisma.arInvoice.create({
    data: {
      companyId: event.companyId,
      customerId: customer.id,
      invoiceNumber: event.sourceDocumentNumber || `POS-${event.sourceDocumentId}`,
      invoiceDate: event.occurredAt,
      dueDate: isCredit
        ? new Date(event.occurredAt.getTime() + customer.creditPeriodDays * 86_400_000)
        : event.occurredAt,
      currency: event.currencyCode,
      net,
      tax,
      gross,
      amountPaid: settled,
      description: "POS sale",
      journalId: event.journalId,
      sourceModule: event.sourceModule,
      sourceDocumentType: event.sourceDocumentType,
      sourceDocumentId: event.sourceDocumentId,
      sourceDocumentNumber: event.sourceDocumentNumber,
    },
  });
  await prisma.$transaction(async (tx) => {
    await appendLedger(tx, {
      companyId: event.companyId,
      customerId: customer!.id,
      entryDate: event.occurredAt,
      docType: "INVOICE",
      docId: invoice.id,
      docNumber: invoice.invoiceNumber,
      description: "POS sale",
      debit: gross,
      credit: 0,
    });
    if (settled > 0) {
      await appendLedger(tx, {
        companyId: event.companyId,
        customerId: customer!.id,
        entryDate: event.occurredAt,
        docType: "RECEIPT",
        docId: invoice.id,
        docNumber: invoice.invoiceNumber,
        description: "POS settlement",
        debit: 0,
        credit: settled,
      });
    }
  });
  return invoice;
}

type SaleEventPayload = {
  parties?: { externalCustomerId?: string | number };
  metadata?: Record<string, unknown> & { paymentType?: string; paymentMethod?: string; customerName?: string };
  amountTotals?: { gross?: string | number; net?: string | number; tax?: string | number; discount?: string | number };
  paymentSplits?: unknown;
};

/** Same figures the posting rule journals: gross is what changed hands, net is the rest after VAT. */
function saleEventAmounts(payload: SaleEventPayload) {
  const tax = roundMoney(Number(payload.amountTotals?.tax ?? 0));
  const discount = roundMoney(Number(payload.amountTotals?.discount ?? 0));
  const statedGross = roundMoney(Number(payload.amountTotals?.gross ?? 0));
  const gross = statedGross > 0 ? statedGross : roundMoney(Number(payload.amountTotals?.net ?? 0) + tax - discount);
  const net = roundMoney(gross - tax);
  const splits = readPaymentSplits(payload.paymentSplits, gross, payload.metadata?.paymentType ?? payload.metadata?.paymentMethod);
  return { net, tax, gross, splits };
}

async function invoiceForSale(companyId: string, saleId: unknown, what: string) {
  const id = saleId === undefined || saleId === null ? "" : String(saleId);
  if (!id) throw new Error(`${what} does not name the original sale (metadata.saleId)`);
  const invoice = await prisma.arInvoice.findFirst({
    where: { companyId, sourceDocumentType: "Sale", sourceDocumentId: id },
    orderBy: { createdAt: "asc" },
  });
  if (!invoice) throw new Error(`Sale ${id} is not in receivables yet; ${what.toLowerCase()} will be retried after the sale posts`);
  return invoice;
}

function arMethod(method: string | undefined): "CASH" | "BANK" | "MOBILE_MONEY" {
  return method === "BANK" ? "BANK" : method === "MOBILE_MONEY" ? "MOBILE_MONEY" : "CASH";
}

/** A debt payment taken in the ERP: a receipt allocated to the sale's invoice; any excess stays on account. */
export async function syncCustomerPaymentToSubledger(eventId: string) {
  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || event.eventType !== "CUSTOMER_PAYMENT_RECEIVED" || !event.journalId) return null;
  const existing = await prisma.arReceipt.findFirst({
    where: { companyId: event.companyId, sourceModule: event.sourceModule, sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  if (existing) return existing;
  const payload = event.payload as SaleEventPayload;
  const amount = roundMoney(Number(payload.amountTotals?.gross ?? payload.amountTotals?.net ?? 0));
  if (amount <= 0) throw new Error("Customer payment event has no amount");
  const splits = readPaymentSplits(payload.paymentSplits, amount, payload.metadata?.paymentMethod ?? payload.metadata?.paymentType);
  const main = splits.reduce((a, b) => (b.amount > a.amount ? b : a), splits[0]);
  const invoice = await invoiceForSale(event.companyId, payload.metadata?.saleId, "Customer payment");
  const applied = roundMoney(Math.min(amount, invoiceOutstanding(invoice)));
  const receiptNumber = await nextNumber(event.companyId, "AR_RECEIPT", "RCT");

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.arReceipt.create({
      data: {
        companyId: event.companyId,
        customerId: invoice.customerId,
        receiptNumber,
        receiptDate: event.occurredAt,
        method: arMethod(main?.method),
        amount,
        unallocated: roundMoney(amount - applied),
        reference: event.sourceDocumentNumber ?? undefined,
        journalId: event.journalId,
        description: `Excel Edge payment for ${invoice.invoiceNumber}`,
        sourceModule: event.sourceModule,
        sourceDocumentType: event.sourceDocumentType,
        sourceDocumentId: event.sourceDocumentId,
      },
    });
    if (applied > 0) {
      await tx.arAllocation.create({ data: { receiptId: receipt.id, invoiceId: invoice.id, amount: applied } });
      const updated = await tx.arInvoice.update({ where: { id: invoice.id }, data: { amountPaid: { increment: applied } } });
      if (invoiceOutstanding(updated) < -0.0001) throw new Error(`Invoice ${updated.invoiceNumber} was settled by another document at the same time; retry`);
    }
    await appendLedger(tx, {
      companyId: event.companyId,
      customerId: invoice.customerId,
      entryDate: event.occurredAt,
      docType: "RECEIPT",
      docId: receipt.id,
      docNumber: receipt.receiptNumber,
      description: receipt.description,
      debit: 0,
      credit: amount,
    });
    return receipt;
  });
}

/**
 * A refund or return of an ERP sale: a credit note against the sale's invoice. The part paid back in cash,
 * bank or mobile money also reverses that much of what was paid on the invoice.
 */
export async function syncSaleRefundToSubledger(eventId: string) {
  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || !["SALE_REFUNDED", "SALES_RETURN_COMPLETED"].includes(event.eventType) || !event.journalId) return null;
  const existing = await prisma.arCreditNote.findFirst({
    where: { companyId: event.companyId, sourceModule: event.sourceModule, sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  if (existing) return existing;
  const payload = event.payload as SaleEventPayload;
  const { net, tax, gross, splits } = saleEventAmounts(payload);
  const paidBack = settledPortion(splits);
  const onAccount = roundMoney(gross - paidBack);
  const invoice = await invoiceForSale(event.companyId, payload.metadata?.originalSaleId ?? payload.metadata?.saleId, "Refund");
  // The customer ledger takes the full credit and any cash paid back, matching the GL. On the invoice, the part
  // left on account reduces what is still owed; what it cannot absorb stays on the customer's account as credit.
  const paidReversed = roundMoney(Math.min(paidBack, money(invoice.amountPaid)));
  const reducesOutstanding = roundMoney(Math.min(onAccount, invoiceOutstanding(invoice)));
  const applied = roundMoney(paidReversed + reducesOutstanding);
  const creditNoteNumber = await nextNumber(event.companyId, "AR_CREDIT_NOTE", "CN");
  const reason = typeof payload.metadata?.reason === "string" && payload.metadata.reason.trim() ? payload.metadata.reason.trim() : "Excel Edge refund";

  return prisma.$transaction(async (tx) => {
    const note = await tx.arCreditNote.create({
      data: {
        companyId: event.companyId,
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        creditNoteNumber,
        noteDate: event.occurredAt,
        reason,
        net,
        tax,
        gross,
        journalId: event.journalId,
        description: `Refund ${event.sourceDocumentNumber ?? event.sourceDocumentId} on ${invoice.invoiceNumber}`,
        sourceModule: event.sourceModule,
        sourceDocumentType: event.sourceDocumentType,
        sourceDocumentId: event.sourceDocumentId,
      },
    });
    if (applied > 0) {
      const updated = await tx.arInvoice.update({
        where: { id: invoice.id },
        data: { amountCredited: { increment: applied }, amountPaid: { decrement: paidReversed } },
      });
      if (money(updated.amountPaid) < -0.0001 || invoiceOutstanding(updated) < -0.0001) {
        throw new Error(`Invoice ${invoice.invoiceNumber} was settled by another document at the same time; retry`);
      }
    }
    await appendLedger(tx, {
      companyId: event.companyId,
      customerId: invoice.customerId,
      entryDate: event.occurredAt,
      docType: "CREDIT_NOTE",
      docId: note.id,
      docNumber: note.creditNoteNumber,
      description: note.description,
      debit: 0,
      credit: gross,
    });
    if (paidBack > 0) {
      await appendLedger(tx, {
        companyId: event.companyId,
        customerId: invoice.customerId,
        entryDate: event.occurredAt,
        docType: "REFUND",
        docId: note.id,
        docNumber: note.creditNoteNumber,
        description: "Refund paid out",
        debit: paidBack,
        credit: 0,
      });
    }
    return note;
  });
}

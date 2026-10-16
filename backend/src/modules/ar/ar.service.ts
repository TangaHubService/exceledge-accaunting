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
  roundMoney,
  settlementAccountId,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { CustomerType, Prisma } from "@prisma/client";
import { defaultsFor, money, nextNumber, settlementDefaults } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createJournal, postJournal } from "../journals/journal.service";

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
  const customer = await tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
  const next = roundMoney(money(customer.balance) + input.debit - input.credit);
  await tx.customer.update({
    where: { id: customer.id },
    data: { balance: next },
  });
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
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string;
    lines: JournalLineDraft[];
    customerRef?: string;
  },
  actor: Actor,
) {
  const journal = await createJournal(
    companyId,
    {
      journalDate: input.journalDate,
      journalType: "AUTOMATIC",
      description: input.description,
      referenceNumber: input.referenceNumber,
      currencyCode: input.currencyCode ?? "RWF",
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
  return postJournal(companyId, journal.id, actor);
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

async function loadActiveCustomer(companyId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  assertCustomerTransactable({
    exists: Boolean(customer),
    active: customer?.status === "ACTIVE",
    creditStatus: customer?.creditStatus,
  });
  return customer!;
}

export async function createInvoice(
  companyId: string,
  input: {
    customerId: string;
    invoiceDate: Date | string;
    dueDate?: Date | string;
    net: number;
    tax?: number;
    discount?: number;
    description?: string;
    currency?: string;
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId);
  const net = roundMoney(input.net);
  const tax = roundMoney(input.tax ?? 0);
  const discount = roundMoney(input.discount ?? 0);
  const gross = roundMoney(net + tax - discount);
  assertCreditAvailable({
    customerType: customer.customerType,
    creditLimit: money(customer.creditLimit),
    outstanding: money(customer.balance),
    additional: gross,
    allowOverride: actor.allowCreditOverride,
  });
  const defaults = await defaultsFor(companyId);
  const lines = buildArInvoiceLines(defaults, {
    net,
    tax,
    discount,
    arAccountId: customer.arAccountId,
    salesAccountId: customer.defaultSalesAccountId,
  });
  const invoiceDate = new Date(input.invoiceDate);
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
      currency: input.currency ?? customer.currency,
      net,
      tax,
      discount,
      gross,
      description: input.description,
      sourceModule: "AR",
      sourceDocumentType: "ArInvoice",
      createdByErpUserId: actor.erpUserId,
    },
  });
  const posted = await postBalanced(
    companyId,
    {
      journalDate: invoiceDate,
      description: input.description || `Invoice ${invoiceNumber}`,
      referenceNumber: invoiceNumber,
      currencyCode: draft.currency,
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
    reference?: string;
    description?: string;
    allocations?: Array<{ invoiceId: string; amount: number }>;
    allowOverpayment?: boolean;
    financialAccountId?: string;
  },
  actor: Actor = {},
) {
  const customer = await loadActiveCustomer(companyId, input.customerId);
  const amount = roundMoney(input.amount);
  const requested = input.allocations ?? [];
  const invoices = requested.length
    ? await prisma.arInvoice.findMany({
        where: { companyId, customerId: customer.id, id: { in: requested.map((a) => a.invoiceId) } },
      })
    : [];
  if (invoices.length !== requested.length) throw new Error("One or more invoices were not found for this customer");
  const allocationCheck = assertReceiptAllocations({
    amount,
    allowOverpayment: input.allowOverpayment !== false,
    allocations: requested.map((row) => {
      const invoice = invoices.find((inv) => inv.id === row.invoiceId)!;
      return { amount: row.amount, outstanding: invoiceOutstanding(invoice) };
    }),
  });
  const defaults = await settlementDefaults(companyId, input.financialAccountId);
  const lines = buildArReceiptLines(defaults, amount, input.method ?? "CASH", customer.arAccountId);
  const receiptDate = new Date(input.receiptDate);
  const receiptNumber = await nextNumber(companyId, "AR_RECEIPT", "RCT");
  const receipt = await prisma.arReceipt.create({
    data: {
      companyId,
      customerId: customer.id,
      receiptNumber,
      receiptDate,
      method: input.method ?? "CASH",
      amount,
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
      currencyCode: customer.currency,
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
      const invoice = invoices.find((inv) => inv.id === row.invoiceId)!;
      await tx.arInvoice.update({
        where: { id: invoice.id },
        data: { amountPaid: roundMoney(money(invoice.amountPaid) + row.amount) },
      });
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

export async function reverseReceipt(companyId: string, receiptId: string, actor: Actor = {}) {
  const receipt = await prisma.arReceipt.findFirst({
    where: { id: receiptId, companyId },
    include: { allocations: true, customer: true },
  });
  if (!receipt) throw new Error("Receipt does not exist");
  if (receipt.status !== "POSTED") throw new Error("Receipt is already reversed");
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
      journalDate: new Date(),
      description: `Reverse receipt ${receipt.receiptNumber}`,
      referenceNumber: receipt.receiptNumber,
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
      const invoice = await tx.arInvoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
      await tx.arInvoice.update({
        where: { id: invoice.id },
        data: { amountPaid: roundMoney(money(invoice.amountPaid) - money(allocation.amount)) },
      });
    }
    await tx.arReceipt.update({ where: { id: receipt.id }, data: { status: "REVERSED" } });
    await appendLedger(tx, {
      companyId,
      customerId: receipt.customerId,
      entryDate: new Date(),
      docType: "RECEIPT_REVERSAL",
      docId: receipt.id,
      docNumber: receipt.receiptNumber,
      description: "Receipt reversal",
      debit: money(receipt.amount),
      credit: 0,
    });
  });
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
    if (invoice) {
      await tx.arInvoice.update({
        where: { id: invoice.id },
        data: { amountCredited: roundMoney(money(invoice.amountCredited) + gross) },
      });
    }
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
    await tx.arDeposit.update({
      where: { id: deposit.id },
      data: { remaining: roundMoney(money(deposit.remaining) - amount) },
    });
    await tx.arInvoice.update({
      where: { id: invoice.id },
      data: { amountPaid: roundMoney(money(invoice.amountPaid) + amount) },
    });
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
    data: { remaining: 0, description: `Refunded via journal ${posted.journalNumber}` },
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

  const payload = event.payload as {
    parties?: { externalCustomerId?: string | number };
    metadata?: { paymentType?: string; customerName?: string };
    amountTotals?: { gross?: string; net?: string; tax?: string };
  };
  const externalId = payload.parties?.externalCustomerId
    ? String(payload.parties.externalCustomerId)
    : undefined;
  const method = String(payload.metadata?.paymentType || "CASH").toUpperCase();
  const isCredit = method === "CREDIT" || method === "DEBT" || method === "INSURANCE";
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
  const net = roundMoney(Number(payload.amountTotals?.net ?? 0));
  const tax = roundMoney(Number(payload.amountTotals?.tax ?? 0));
  const gross = roundMoney(Number(payload.amountTotals?.gross ?? net + tax));
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
      amountPaid: isCredit ? 0 : gross,
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
    if (!isCredit) {
      await appendLedger(tx, {
        companyId: event.companyId,
        customerId: customer!.id,
        entryDate: event.occurredAt,
        docType: "RECEIPT",
        docId: invoice.id,
        docNumber: invoice.invoiceNumber,
        description: "POS cash settlement",
        debit: 0,
        credit: gross,
      });
    }
  });
  return invoice;
}

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
  reverseJournalLines,
  realizedFxSettlement,
  roundMoney,
  settledPortion,
  settlementAccountId,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { ArPaymentMethod, CustomerType, Prisma } from "@prisma/client";
import { defaultsFor, functionalCurrencyOf, fxAccounts, money, nextNumber, priceDocumentLines, resolveDocumentMoney, settlementDefaults } from "../../lib/documents";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal, linesInJournalCurrency, reversalCurrency } from "../journals/journal.service";

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
    companyName?: string;
    customerType?: CustomerType;
    category?: string;
    tin?: string;
    vatNumber?: string;
    nationalId?: string;
    registrationNumber?: string;
    contactPerson?: string;
    telephone?: string;
    mobile?: string;
    email?: string;
    website?: string;
    physicalAddress?: string;
    shippingAddress?: string;
    country?: string;
    province?: string;
    district?: string;
    sector?: string;
    cell?: string;
    village?: string;
    currency?: string;
    paymentTerms?: string;
    preferredPaymentMethod?: ArPaymentMethod;
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
    /** yyyy-mm-dd the opening balance is owed from; defaults to today. */
    openingBalanceDate?: string;
    notes?: string;
    externalErpCustomerId?: string;
    parentId?: string;
    tags?: string[];
    taxExempt?: boolean;
    taxExemptReason?: string;
  },
  actor: Actor = {},
) {
  if (input.parentId) await assertValidParent(companyId, input.parentId);
  const code = input.code?.trim() || (await nextNumber(companyId, "CUSTOMER", "CUS"));
  const existing = await prisma.customer.findFirst({
    where: { companyId, code },
  });
  if (existing) throw new Error("Customer code already exists");
  await assertNoDuplicateCustomer(companyId, { name: input.name, tin: input.tin });

  const opening = roundMoney(input.openingBalance ?? 0);
  if (opening < 0) throw new Error("Opening balance can't be negative; record a credit note or deposit for money you owe the customer");
  const openingDate = input.openingBalanceDate ? new Date(`${input.openingBalanceDate}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(openingDate.getTime())) throw new Error("Opening balance date must be yyyy-mm-dd");
  if (openingDate > new Date()) throw new Error("Opening balance date can't be in the future");
  const customer = await prisma.customer.create({
    data: {
      companyId,
      code,
      name: input.name.trim(),
      companyName: input.companyName?.trim() || undefined,
      customerType: input.customerType ?? "CREDIT",
      category: input.category,
      tin: input.tin,
      vatNumber: input.vatNumber,
      nationalId: input.nationalId,
      registrationNumber: input.registrationNumber,
      contactPerson: input.contactPerson,
      telephone: input.telephone,
      mobile: input.mobile,
      email: input.email?.trim().toLowerCase() || undefined,
      website: input.website,
      physicalAddress: input.physicalAddress,
      shippingAddress: input.shippingAddress,
      country: input.country,
      province: input.province,
      district: input.district,
      sector: input.sector,
      cell: input.cell,
      village: input.village,
      currency: input.currency ?? "RWF",
      paymentTerms: input.paymentTerms,
      preferredPaymentMethod: input.preferredPaymentMethod,
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
      parentId: input.parentId,
      tags: normalizeTags(input.tags),
      taxExempt: input.taxExempt ?? false,
      taxExemptReason: input.taxExempt ? input.taxExemptReason?.trim() || null : null,
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
        journalDate: openingDate,
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
        entryDate: openingDate,
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
          invoiceDate: openingDate,
          dueDate: openingDate,
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

export type CustomerUpdate = Partial<{
  name: string;
  companyName: string | null;
  customerType: CustomerType;
  category: string | null;
  tin: string | null;
  contactPerson: string | null;
  telephone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  physicalAddress: string | null;
  shippingAddress: string | null;
  country: string | null;
  province: string | null;
  district: string | null;
  paymentTerms: string | null;
  preferredPaymentMethod: ArPaymentMethod | null;
  creditLimit: number;
  creditPeriodDays: number;
  creditStatus: "GOOD" | "WATCH" | "ON_HOLD" | "BLOCKED";
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  parentId: string | null;
  tags: string[];
  taxExempt: boolean;
  taxExemptReason: string | null;
}>;

/** Tags are short labels, trimmed, de-duplicated case-insensitively, at most 10. */
export function normalizeTags(tags?: string[] | null) {
  const seen = new Map<string, string>();
  for (const t of tags ?? []) {
    const clean = t.trim().replace(/\s+/g, " ").slice(0, 30);
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()].slice(0, 10);
}

/** A parent must be another customer in the same company, and the chain must not loop back to `childId`. */
export async function assertValidParent(companyId: string, parentId: string, childId?: string) {
  if (childId && parentId === childId) throw new Error("A customer can't be its own parent");
  let cursor: string | null = parentId;
  for (let depth = 0; cursor; depth += 1) {
    if (depth > 10) throw new Error("Sub-customers can be nested at most 10 levels deep");
    const row: { id: string; parentId: string | null } | null = await prisma.customer.findFirst({ where: { id: cursor, companyId }, select: { id: true, parentId: true } });
    if (!row) throw new Error("Parent customer does not exist");
    if (childId && row.parentId === childId) throw new Error("That would make the customer a sub-customer of its own sub-customer");
    cursor = row.parentId;
  }
}

/**
 * Refuses a second customer with the same display name or TIN in one company.
 * Email and phone matches are only warnings (see `findCustomerDuplicates`), since families and branches share them.
 */
export async function assertNoDuplicateCustomer(companyId: string, input: { name?: string; tin?: string | null }, exceptId?: string) {
  const name = input.name?.trim();
  const tin = input.tin?.trim();
  const or: Prisma.CustomerWhereInput[] = [];
  if (name) or.push({ name: { equals: name, mode: "insensitive" } });
  if (tin) or.push({ tin });
  if (!or.length) return;
  const clash = await prisma.customer.findFirst({ where: { companyId, OR: or, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  if (!clash) return;
  if (tin && clash.tin === tin) throw new Error(`TIN ${tin} already belongs to ${clash.name} (${clash.code})`);
  throw new Error(`A customer named "${clash.name}" already exists (${clash.code})`);
}

export async function updateCustomer(companyId: string, customerId: string, input: CustomerUpdate, actor: Actor = {}) {
  const before = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!before) throw new Error("Customer does not exist");
  const data: CustomerUpdate = { ...input };
  if (data.parentId) await assertValidParent(companyId, data.parentId, before.id);
  if (data.tags !== undefined) data.tags = normalizeTags(data.tags);
  if (data.taxExempt === false) data.taxExemptReason = null;
  if (data.name !== undefined) data.name = data.name.trim();
  if (data.email) data.email = data.email.trim().toLowerCase();
  if (data.tin !== undefined && (data.tin ?? "") !== (before.tin ?? "")) {
    // Posted invoices carry the buyer TIN on the fiscal record; changing it afterwards would break the tie.
    const invoiced = await prisma.arInvoice.count({ where: { companyId, customerId, status: "POSTED", NOT: { sourceDocumentType: "CustomerOpening" } } });
    if (invoiced) throw new Error("TIN can't be changed once the customer has posted invoices");
  }
  if (data.status === "INACTIVE" && before.status !== "INACTIVE" && Math.abs(money(before.balance)) > 0.005) {
    throw new Error(`${before.name} still has a balance of ${money(before.balance)}; settle or credit it before making the customer inactive`);
  }
  await assertNoDuplicateCustomer(
    companyId,
    { name: data.name !== undefined && data.name !== before.name ? data.name : undefined, tin: data.tin !== undefined && data.tin !== before.tin ? data.tin : undefined },
    before.id,
  );
  const updated = await prisma.customer.update({ where: { id: before.id }, data });
  const changed = Object.keys(data).filter((k) => String((before as Record<string, unknown>)[k] ?? "") !== String((updated as Record<string, unknown>)[k] ?? ""));
  const pick = (c: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, c[k] == null ? null : String(c[k])]));
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: data.status && data.status !== before.status ? (data.status === "INACTIVE" ? "DEACTIVATE" : "ACTIVATE") : "UPDATE",
    entityType: "Customer",
    entityId: updated.id,
    beforeJson: pick(before as unknown as Record<string, unknown>),
    afterJson: pick(updated as unknown as Record<string, unknown>),
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
              { companyName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { telephone: { contains: q } },
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
  // A tax-exempt customer is invoiced without tax, whatever tax codes the lines or the caller carry.
  const exempt = customer.taxExempt;
  const pricedLines = input.lines?.length ? (exempt ? input.lines.map((l) => ({ ...l, taxCode: null })) : input.lines) : undefined;
  const priced = pricedLines ? await priceDocumentLines(companyId, pricedLines, invoiceDate, "sales") : null;
  if (priced && input.discount) throw new Error("Give discounts on the lines when an invoice has lines");
  if (priced && (input.net != null || input.tax != null)) throw new Error("An invoice with lines takes its net and tax from the lines");
  if (!priced && !(Number(input.net) > 0)) throw new Error("Invoice amount must be positive");
  const net = priced ? priced.net : roundMoney(input.net!);
  const tax = exempt ? 0 : priced ? priced.tax : roundMoney(input.tax ?? 0);
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
  // Realized FX booked when this payment's credit was applied later goes with it.
  const fxApplications = await prisma.journal.findMany({ where: { companyId, sourceDocumentType: "ArCreditApplication", sourceDocumentId: receipt.id, status: "POSTED" } });
  for (const j of fxApplications) {
    await postSourceReversal(
      companyId,
      j.id,
      {
        date: reversalDate,
        description: `Reverse FX on ${receipt.receiptNumber}`,
        sourceDocumentType: "ArCreditApplicationReversal",
        sourceDocumentId: receipt.id,
        sourceDocumentNumber: receipt.receiptNumber,
        customerRef: receipt.customerId,
      },
      actor,
    );
  }
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
      unapplied: invoice ? 0 : gross,
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
  // Rows stay in posting order so each running balance reads straight down the list.
  const closing = entries.length ? money(entries[entries.length - 1].runningBalance) : 0;
  return { openingBalance: 0, entries, closingBalance: closing };
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
      id: invoice.id,
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
      creditApplications: { include: { creditNote: { select: { id: true, creditNoteNumber: true, noteDate: true } } } },
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
        // Whatever the original invoice couldn't absorb stays on the customer's account to apply later.
        unapplied: Math.max(0, roundMoney(onAccount - reducesOutstanding)),
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

/* ── Apply customer credits ─────────────────────────────────────────────── */

export type CreditSource = "PAYMENT" | "CREDIT_NOTE" | "DEPOSIT";

/** What a customer can apply (unapplied payments, credit notes, deposits) and what it can be applied to. */
export async function customerCredits(companyId: string, customerId: string) {
  const customer = await getCustomer(companyId, customerId);
  const [receipts, notes, deposits, invoices] = await Promise.all([
    prisma.arReceipt.findMany({ where: { companyId, customerId, status: "POSTED", unallocated: { gt: 0 } }, orderBy: { receiptDate: "asc" } }),
    prisma.arCreditNote.findMany({ where: { companyId, customerId, status: "POSTED", unapplied: { gt: 0 } }, orderBy: { noteDate: "asc" } }),
    prisma.arDeposit.findMany({ where: { companyId, customerId, status: "POSTED", remaining: { gt: 0 } }, orderBy: { depositDate: "asc" } }),
    prisma.arInvoice.findMany({ where: { companyId, customerId, status: "POSTED" }, orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }] }),
  ]);
  return {
    customer: { id: customer.id, code: customer.code, name: customer.name, currency: customer.currency },
    credits: [
      ...receipts.map((r) => ({ type: "PAYMENT" as const, id: r.id, number: r.receiptNumber, date: r.receiptDate, currency: r.currency, available: money(r.unallocated), description: r.reference ?? r.description })),
      ...notes.map((n) => ({ type: "CREDIT_NOTE" as const, id: n.id, number: n.creditNoteNumber, date: n.noteDate, currency: n.currency, available: money(n.unapplied), description: n.reason })),
      ...deposits.map((d) => ({ type: "DEPOSIT" as const, id: d.id, number: d.depositNumber, date: d.depositDate, currency: d.currency, available: money(d.remaining), description: d.reference ?? d.description })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime()),
    invoices: invoices
      .map((i) => ({
        id: i.id,
        number: i.invoiceNumber,
        date: i.invoiceDate,
        dueDate: i.dueDate,
        currency: i.currency,
        open: invoiceOutstanding(i),
        description: i.description,
        isOpening: i.sourceDocumentType === "CustomerOpening",
      }))
      .filter((i) => i.open > 0.005),
  };
}

/**
 * Sets credits the customer already has against open invoices.
 *
 * - Unapplied payment: AR was credited when the money came in, so only the subledger allocation changes
 *   (plus a realized FX line when a foreign payment meets an invoice booked at another rate).
 * - Credit note: AR was credited when it was issued; the invoice's credited amount goes up.
 * - Deposit: held as a liability until now, so it posts Dr customer deposits / Cr AR through `allocateDeposit`.
 *
 * Runs inside the caller's transaction; any failing row rolls the whole set back.
 */
export async function applyCustomerCredits(
  companyId: string,
  customerId: string,
  input: { applications: Array<{ source: CreditSource; sourceId: string; invoiceId: string; amount: number }>; date?: string },
  actor: Actor = {},
) {
  const customer = await getCustomer(companyId, customerId);
  const rows = input.applications.map((a) => ({ ...a, amount: roundMoney(a.amount) })).filter((a) => a.amount > 0);
  if (!rows.length) throw new Error("Enter an amount to apply");
  const applyDate = input.date ? new Date(`${input.date}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(applyDate.getTime())) throw new Error("Date must be yyyy-mm-dd");

  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId))];
  const invoices = await prisma.arInvoice.findMany({ where: { companyId, customerId, id: { in: invoiceIds }, status: "POSTED" } });
  if (invoices.length !== invoiceIds.length) throw new Error("One or more invoices are not open for this customer");
  const byInvoice = new Map(invoices.map((i) => [i.id, i]));

  // Refuse over-application up front with a clear message; the row-level guards below still catch races.
  const perInvoice = new Map<string, number>();
  for (const r of rows) perInvoice.set(r.invoiceId, roundMoney((perInvoice.get(r.invoiceId) ?? 0) + r.amount));
  for (const [id, total] of perInvoice) {
    const inv = byInvoice.get(id)!;
    if (total - invoiceOutstanding(inv) > 0.0001) throw new Error(`Invoice ${inv.invoiceNumber} only has ${invoiceOutstanding(inv)} left to pay`);
  }

  const applied: Array<{ source: CreditSource; number: string; invoiceNumber: string; amount: number }> = [];
  for (const r of rows) {
    const invoice = byInvoice.get(r.invoiceId)!;
    if (r.source === "DEPOSIT") {
      const dep = await prisma.arDeposit.findFirst({ where: { id: r.sourceId, companyId, customerId, status: "POSTED" } });
      if (!dep) throw new Error("Deposit is not available");
      await allocateDeposit(companyId, dep.id, { invoiceId: invoice.id, amount: r.amount }, actor);
      applied.push({ source: r.source, number: dep.depositNumber, invoiceNumber: invoice.invoiceNumber, amount: r.amount });
      continue;
    }

    if (r.source === "PAYMENT") {
      const receipt = await prisma.arReceipt.findFirst({ where: { id: r.sourceId, companyId, customerId, status: "POSTED" } });
      if (!receipt) throw new Error("Payment is not available");
      if (receipt.currency !== invoice.currency) throw new Error(`Payment ${receipt.receiptNumber} is in ${receipt.currency}; invoice ${invoice.invoiceNumber} is in ${invoice.currency}`);
      const receiptRate = Number(receipt.exchangeRate);
      const invoiceRate = Number(invoice.exchangeRate);
      if (Math.abs(receiptRate - invoiceRate) > 1e-10) {
        // The payment cleared AR at its own rate and the invoice was booked at another: book the difference.
        const diff = roundMoney(r.amount * (receiptRate - invoiceRate));
        if (Math.abs(diff) >= 0.01) {
          const ar = customer.arAccountId || (await defaultsFor(companyId)).accountsReceivableId;
          if (!ar) throw new Error("Receivables account is not configured");
          const { gainId, lossId } = await fxAccounts(companyId);
          const lines: JournalLineDraft[] =
            diff > 0
              ? [
                  { accountId: ar, description: `FX on ${receipt.receiptNumber} applied to ${invoice.invoiceNumber}`, debit: diff, credit: 0 },
                  { accountId: gainId, description: "Realized FX gain", debit: 0, credit: diff },
                ]
              : [
                  { accountId: lossId, description: "Realized FX loss", debit: -diff, credit: 0 },
                  { accountId: ar, description: `FX on ${receipt.receiptNumber} applied to ${invoice.invoiceNumber}`, debit: 0, credit: -diff },
                ];
          await postBalanced(
            companyId,
            {
              journalDate: applyDate,
              description: `Apply ${receipt.receiptNumber} to ${invoice.invoiceNumber} (realized FX)`,
              referenceNumber: receipt.receiptNumber,
              currencyCode: await functionalCurrencyOf(companyId),
              exchangeRate: 1,
              sourceDocumentType: "ArCreditApplication",
              sourceDocumentId: receipt.id,
              sourceDocumentNumber: receipt.receiptNumber,
              customerRef: customer.id,
              lines,
            },
            actor,
          );
        }
      }
      await prisma.$transaction(async (tx) => {
        const taken = await tx.arReceipt.updateMany({
          where: { id: receipt.id, status: "POSTED", unallocated: { gte: r.amount } },
          data: { unallocated: { decrement: r.amount } },
        });
        if (!taken.count) throw new Error(`Payment ${receipt.receiptNumber} doesn't have ${r.amount} left to apply`);
        await tx.arAllocation.create({ data: { receiptId: receipt.id, invoiceId: invoice.id, amount: r.amount } });
        await bumpOpenInvoice(tx, invoice.id, { amountPaid: { increment: r.amount } });
      });
      applied.push({ source: r.source, number: receipt.receiptNumber, invoiceNumber: invoice.invoiceNumber, amount: r.amount });
      continue;
    }

    const note = await prisma.arCreditNote.findFirst({ where: { id: r.sourceId, companyId, customerId, status: "POSTED" } });
    if (!note) throw new Error("Credit note is not available");
    if (note.currency !== invoice.currency) throw new Error(`Credit note ${note.creditNoteNumber} is in ${note.currency}; invoice ${invoice.invoiceNumber} is in ${invoice.currency}`);
    await prisma.$transaction(async (tx) => {
      const taken = await tx.arCreditNote.updateMany({
        where: { id: note.id, status: "POSTED", unapplied: { gte: r.amount } },
        data: { unapplied: { decrement: r.amount } },
      });
      if (!taken.count) throw new Error(`Credit note ${note.creditNoteNumber} doesn't have ${r.amount} left to apply`);
      await tx.arCreditApplication.create({ data: { creditNoteId: note.id, invoiceId: invoice.id, amount: r.amount, erpUserId: actor.erpUserId } });
      await bumpOpenInvoice(tx, invoice.id, { amountCredited: { increment: r.amount } });
    });
    applied.push({ source: r.source, number: note.creditNoteNumber, invoiceNumber: invoice.invoiceNumber, amount: r.amount });
  }

  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "APPLY_CREDIT",
    entityType: "Customer",
    entityId: customer.id,
    afterJson: { applied },
    ...actor.meta,
  });
  return { applied, total: roundMoney(applied.reduce((s, a) => s + a.amount, 0)) };
}


/* ── Void and un-apply ──────────────────────────────────────────────────── */

/** Posts the mirror image of a posted source journal (invoice, deposit application), in the original currency. */
async function postSourceReversal(
  companyId: string,
  journalId: string,
  info: { date: Date; description: string; sourceDocumentType: string; sourceDocumentId: string; sourceDocumentNumber: string; customerRef: string },
  actor: Actor,
) {
  const original = await prisma.journal.findFirst({ where: { id: journalId, companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
  if (!original) throw new Error("The original journal could not be found");
  return postBalanced(
    companyId,
    {
      journalDate: info.date,
      description: info.description,
      referenceNumber: info.sourceDocumentNumber,
      ...(await reversalCurrency(companyId, journalId)),
      sourceDocumentType: info.sourceDocumentType,
      sourceDocumentId: info.sourceDocumentId,
      sourceDocumentNumber: info.sourceDocumentNumber,
      customerRef: info.customerRef,
      lines: reverseJournalLines(linesInJournalCurrency(original.lines)),
    },
    actor,
  );
}

/**
 * Voids an invoice nothing has been applied to (QuickBooks "Void"): the invoice keeps its number with a zero
 * balance, its journal is reversed and the customer ledger takes a matching credit.
 * Payments, credits and deposits must be removed from it first, so their money goes back on account.
 */
export async function voidInvoice(companyId: string, invoiceId: string, reason: string | undefined, actor: Actor = {}) {
  const invoice = await prisma.arInvoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice) throw new Error("Invoice does not exist");
  if (invoice.status !== "POSTED") throw new Error(`Invoice ${invoice.invoiceNumber} is already void`);
  if (invoice.sourceModule && invoice.sourceModule !== "AR") {
    throw new Error(`Invoice ${invoice.invoiceNumber} came from ${invoice.sourceModule}; cancel it there so both systems agree`);
  }
  if (money(invoice.amountPaid) > 0.005 || money(invoice.amountCredited) > 0.005) {
    throw new Error(`Remove the payments and credits applied to ${invoice.invoiceNumber} before voiding it`);
  }
  // The conditional update locks the row, so a payment applied at the same moment can't slip in.
  const claimed = await prisma.arInvoice.updateMany({
    where: { id: invoice.id, companyId, status: "POSTED", amountPaid: 0, amountCredited: 0 },
    data: { status: "REVERSED", description: [invoice.description, `Voided${reason ? `: ${reason}` : ""}`].filter(Boolean).join(" · ") },
  });
  if (!claimed.count) throw new Error(`Invoice ${invoice.invoiceNumber} changed while you were voiding it; refresh and try again`);
  const voidDate = new Date();
  if (invoice.journalId) {
    await postSourceReversal(
      companyId,
      invoice.journalId,
      {
        date: voidDate,
        description: `Void invoice ${invoice.invoiceNumber}${reason ? ` — ${reason}` : ""}`,
        sourceDocumentType: "ArInvoiceVoid",
        sourceDocumentId: invoice.id,
        sourceDocumentNumber: invoice.invoiceNumber,
        customerRef: invoice.customerId,
      },
      actor,
    );
  }
  await prisma.$transaction(async (tx) => {
    await appendLedger(tx, {
      companyId,
      customerId: invoice.customerId,
      entryDate: voidDate,
      docType: "INVOICE_VOID",
      docId: invoice.id,
      docNumber: invoice.invoiceNumber,
      description: reason || "Invoice voided",
      debit: 0,
      credit: money(invoice.gross),
    });
  });
  // An estimate, order or delayed charge that became this invoice is live again, as in QuickBooks.
  const sources = await prisma.commercialDocument.findMany({ where: { companyId, convertedToId: invoice.id, status: "CONVERTED" } });
  for (const doc of sources) {
    await prisma.commercialDocument.update({
      where: { id: doc.id },
      data: { status: doc.kind === "ESTIMATE" || doc.kind === "PROPOSAL" ? "ACCEPTED" : "OPEN", convertedToType: null, convertedToId: null, convertedToNumber: null },
    });
  }
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "VOID",
    entityType: "ArInvoice",
    entityId: invoice.id,
    beforeJson: { status: "POSTED", gross: money(invoice.gross) },
    afterJson: { status: "REVERSED", reason },
    ...actor.meta,
  });
  return prisma.arInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

export type ApplicationKind = "PAYMENT" | "CREDIT_NOTE" | "DEPOSIT";

/** Everything applied to one invoice, each with whether it can be removed here. */
export async function invoiceApplications(companyId: string, invoiceId: string) {
  const invoice = await prisma.arInvoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice) throw new Error("Invoice does not exist");
  const functional = await functionalCurrencyOf(companyId);
  const [allocations, creditApps, notesOnIssue, depositAllocs] = await Promise.all([
    prisma.arAllocation.findMany({ where: { invoiceId }, include: { receipt: true }, orderBy: { createdAt: "asc" } }),
    prisma.arCreditApplication.findMany({ where: { invoiceId }, include: { creditNote: true }, orderBy: { createdAt: "asc" } }),
    prisma.arCreditNote.findMany({ where: { companyId, invoiceId, status: "POSTED" }, include: { applications: true } }),
    prisma.arDepositAllocation.findMany({ where: { invoiceId }, include: { deposit: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const rows: Array<{ kind: ApplicationKind | "CREDIT_ON_ISSUE"; id: string; sourceId: string; sourceNumber: string; date: Date; amount: number; removable: boolean; reason?: string }> = [];
  for (const a of allocations) {
    if (a.receipt.companyId !== companyId) continue;
    const fxLocked = a.receipt.currency !== functional && Math.abs(Number(a.receipt.exchangeRate) - Number(invoice.exchangeRate)) > 1e-10;
    rows.push({
      kind: "PAYMENT",
      id: a.id,
      sourceId: a.receiptId,
      sourceNumber: a.receipt.receiptNumber,
      date: a.receipt.receiptDate,
      amount: money(a.amount),
      removable: a.receipt.status === "POSTED" && !fxLocked,
      reason: a.receipt.status !== "POSTED" ? "Payment is reversed" : fxLocked ? "Booked a realized FX difference; reverse the payment instead" : undefined,
    });
  }
  for (const c of creditApps) {
    rows.push({ kind: "CREDIT_NOTE", id: c.id, sourceId: c.creditNoteId, sourceNumber: c.creditNote.creditNoteNumber, date: c.createdAt, amount: money(c.amount), removable: c.creditNote.status === "POSTED" });
  }
  for (const n of notesOnIssue) {
    const onIssue = roundMoney(money(n.gross) - money(n.unapplied) - n.applications.reduce((s, a) => s + money(a.amount), 0));
    if (onIssue <= 0.005) continue;
    const external = Boolean(n.sourceModule && n.sourceModule !== "AR");
    rows.push({
      kind: "CREDIT_ON_ISSUE",
      id: n.id,
      sourceId: n.id,
      sourceNumber: n.creditNoteNumber,
      date: n.noteDate,
      amount: onIssue,
      removable: !external,
      reason: external ? `From ${n.sourceModule}` : "Issued against this invoice",
    });
  }
  for (const d of depositAllocs) {
    if (d.deposit.companyId !== companyId) continue;
    rows.push({ kind: "DEPOSIT", id: d.id, sourceId: d.depositId, sourceNumber: d.deposit.depositNumber, date: d.createdAt, amount: money(d.amount), removable: d.deposit.status === "POSTED" && Boolean(d.journalId) });
  }
  return { invoiceId, status: invoice.status, outstanding: invoiceOutstanding(invoice), rows };
}

/**
 * Takes a payment, credit note or deposit back off an invoice (QuickBooks "unapply"). The money goes back on
 * the customer's account as credit. Payments and credit notes only move in the subledger; a deposit's
 * application journal is reversed and it returns to customer deposits.
 */
export async function unapplyFromInvoice(companyId: string, kind: ApplicationKind | "CREDIT_ON_ISSUE", applicationId: string, actor: Actor = {}) {
  let detail: { customerId: string; sourceNumber: string; invoiceNumber: string; amount: number };
  if (kind === "CREDIT_ON_ISSUE") {
    // A credit note issued against an invoice: take it off and keep it on account, like a later application.
    const n = await prisma.arCreditNote.findFirst({ where: { id: applicationId, companyId, status: "POSTED" }, include: { applications: true, invoice: true } });
    if (!n || !n.invoice) throw new Error("This credit note is no longer applied to the invoice");
    if (n.sourceModule && n.sourceModule !== "AR") throw new Error(`Credit note ${n.creditNoteNumber} came from ${n.sourceModule}; it can't be moved here`);
    const amount = roundMoney(money(n.gross) - money(n.unapplied) - n.applications.reduce((s, a) => s + money(a.amount), 0));
    if (amount <= 0.005) throw new Error("This credit note is no longer applied to the invoice");
    const invoice = n.invoice;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.arCreditNote.updateMany({ where: { id: n.id, invoiceId: invoice.id }, data: { invoiceId: null, unapplied: { increment: amount } } });
      if (!claimed.count) throw new Error("This credit note is no longer applied to the invoice");
      await tx.arInvoice.update({ where: { id: invoice.id }, data: { amountCredited: { decrement: amount } } });
    });
    detail = { customerId: n.customerId, sourceNumber: n.creditNoteNumber, invoiceNumber: invoice.invoiceNumber, amount };
  } else if (kind === "PAYMENT") {
    const a = await prisma.arAllocation.findFirst({ where: { id: applicationId, receipt: { companyId } }, include: { receipt: true, invoice: true } });
    if (!a) throw new Error("This payment is no longer applied to the invoice");
    if (a.receipt.status !== "POSTED") throw new Error(`Payment ${a.receipt.receiptNumber} is reversed`);
    const functional = await functionalCurrencyOf(companyId);
    if (a.receipt.currency !== functional && Math.abs(Number(a.receipt.exchangeRate) - Number(a.invoice.exchangeRate)) > 1e-10) {
      throw new Error(`Payment ${a.receipt.receiptNumber} booked a realized FX difference on this invoice; reverse the payment instead`);
    }
    const amount = money(a.amount);
    await prisma.$transaction(async (tx) => {
      const gone = await tx.arAllocation.deleteMany({ where: { id: a.id } });
      if (!gone.count) throw new Error("This payment is no longer applied to the invoice");
      await tx.arReceipt.update({ where: { id: a.receiptId }, data: { unallocated: { increment: amount } } });
      await tx.arInvoice.update({ where: { id: a.invoiceId }, data: { amountPaid: { decrement: amount } } });
    });
    detail = { customerId: a.receipt.customerId, sourceNumber: a.receipt.receiptNumber, invoiceNumber: a.invoice.invoiceNumber, amount };
  } else if (kind === "CREDIT_NOTE") {
    const c = await prisma.arCreditApplication.findFirst({ where: { id: applicationId, creditNote: { companyId } }, include: { creditNote: true, invoice: true } });
    if (!c) throw new Error("This credit note is no longer applied to the invoice");
    const amount = money(c.amount);
    await prisma.$transaction(async (tx) => {
      const gone = await tx.arCreditApplication.deleteMany({ where: { id: c.id } });
      if (!gone.count) throw new Error("This credit note is no longer applied to the invoice");
      await tx.arCreditNote.update({ where: { id: c.creditNoteId }, data: { unapplied: { increment: amount } } });
      await tx.arInvoice.update({ where: { id: c.invoiceId }, data: { amountCredited: { decrement: amount } } });
    });
    detail = { customerId: c.creditNote.customerId, sourceNumber: c.creditNote.creditNoteNumber, invoiceNumber: c.invoice.invoiceNumber, amount };
  } else {
    const d = await prisma.arDepositAllocation.findFirst({ where: { id: applicationId, deposit: { companyId } }, include: { deposit: true } });
    if (!d) throw new Error("This deposit is no longer applied to the invoice");
    if (d.deposit.status !== "POSTED") throw new Error(`Deposit ${d.deposit.depositNumber} is refunded`);
    if (!d.journalId) throw new Error("This deposit application has no journal to reverse");
    const invoice = await prisma.arInvoice.findFirstOrThrow({ where: { id: d.invoiceId, companyId } });
    const amount = money(d.amount);
    const when = new Date();
    await postSourceReversal(
      companyId,
      d.journalId,
      {
        date: when,
        description: `Unapply deposit ${d.deposit.depositNumber} from ${invoice.invoiceNumber}`,
        sourceDocumentType: "ArDepositUnapply",
        sourceDocumentId: d.id,
        sourceDocumentNumber: d.deposit.depositNumber,
        customerRef: d.deposit.customerId,
      },
      actor,
    );
    await prisma.$transaction(async (tx) => {
      const gone = await tx.arDepositAllocation.deleteMany({ where: { id: d.id } });
      if (!gone.count) throw new Error("This deposit is no longer applied to the invoice");
      await tx.arDeposit.update({ where: { id: d.depositId }, data: { remaining: { increment: amount } } });
      await tx.arInvoice.update({ where: { id: d.invoiceId }, data: { amountPaid: { decrement: amount } } });
      await appendLedger(tx, {
        companyId,
        customerId: d.deposit.customerId,
        entryDate: when,
        docType: "DEPOSIT_UNAPPLY",
        docId: d.id,
        docNumber: d.deposit.depositNumber,
        description: `Deposit taken back off ${invoice.invoiceNumber}`,
        debit: amount,
        credit: 0,
      });
    });
    detail = { customerId: d.deposit.customerId, sourceNumber: d.deposit.depositNumber, invoiceNumber: invoice.invoiceNumber, amount };
  }
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId ?? 0,
    erpRole: actor.erpRole,
    action: "UNAPPLY_CREDIT",
    entityType: "Customer",
    entityId: detail.customerId,
    afterJson: { removed: [{ number: detail.sourceNumber, invoiceNumber: detail.invoiceNumber, amount: detail.amount }] },
    ...actor.meta,
  });
  return detail;
}

import {
  EXPENSE_CATEGORY_SEED,
  assertExpenseAllocations,
  assertExpenseAmounts,
  assertExpenseTransition,
  buildExpenseLines,
  expenseByCategoryTotals,
  nextRecurringDate,
  reverseJournalLines,
  roundMoney,
  type ExpensePaymentMode,
  type ExpenseStatus,
  type JournalLineDraft,
  type RecurringFrequency,
} from "@exceledge/accounting-domain";
import { defaultsFor, money, nextNumber } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createJournal, postJournal } from "../journals/journal.service";
import { endOfDay, isoDay, startOfDay } from "../banking/banking.service";

export type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, beforeJson, afterJson, ...actor.meta });
}

async function postExpenseJournal(
  companyId: string,
  input: {
    journalDate: Date;
    description: string;
    referenceNumber?: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string;
    lines: JournalLineDraft[];
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
      currencyCode: "RWF",
      sourceModule: "EXPENSE",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      status: "APPROVED",
      lines: input.lines,
    },
    actor,
  );
  return postJournal(companyId, journal.id, actor);
}

async function accountName(companyId: string, id: string | null | undefined) {
  if (!id) return null;
  return prisma.account.findFirst({ where: { id, companyId }, select: { id: true, code: true, name: true } });
}

async function ensureExpenseGlAccount(companyId: string, code: string, name: string, actor: Actor) {
  const existing = await prisma.account.findFirst({ where: { companyId, code } });
  if (existing) return existing.id;
  const created = await prisma.account.create({
    data: {
      companyId,
      code,
      name,
      type: "EXPENSE",
      isActive: true,
      systemProtected: false,
      allowManualPost: true,
      createdByErpUserId: actor.erpUserId,
    },
  });
  return created.id;
}

export async function ensureExpenseCategories(companyId: string, actor: Actor = {}) {
  const count = await prisma.expenseCategory.count({ where: { companyId } });
  if (count > 0) return;

  for (const seed of EXPENSE_CATEGORY_SEED) {
    let glAccountId: string | null = null;
    if (seed.glAccountCode) {
      const found = await prisma.account.findFirst({ where: { companyId, code: seed.glAccountCode } });
      glAccountId = found?.id ?? (await ensureExpenseGlAccount(companyId, seed.glAccountCode, seed.name, actor));
    } else {
      glAccountId = await ensureExpenseGlAccount(companyId, "6999", seed.name, actor);
    }
    await prisma.expenseCategory.create({
      data: {
        companyId,
        code: seed.code,
        name: seed.name,
        glAccountId,
        createdByErpUserId: actor.erpUserId,
      },
    });
  }
}

function serializeCategory(c: { id: string; code: string; name: string; glAccountId: string | null; isActive: boolean; notes: string | null; gl?: { code: string; name: string } | null }) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    glAccountId: c.glAccountId,
    glAccountCode: c.gl?.code ?? null,
    glAccountName: c.gl?.name ?? null,
    isActive: c.isActive,
    notes: c.notes,
  };
}

export async function listCategories(companyId: string, options: { includeInactive?: boolean } = {}) {
  await ensureExpenseCategories(companyId);
  const rows = await prisma.expenseCategory.findMany({
    where: { companyId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: { code: "asc" },
  });
  const accounts = await prisma.account.findMany({
    where: { companyId, id: { in: rows.map((r) => r.glAccountId).filter(Boolean) as string[] } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((c) => serializeCategory({ ...c, gl: c.glAccountId ? byId.get(c.glAccountId) ?? null : null }));
}

export async function createCategory(
  companyId: string,
  input: { code: string; name: string; glAccountId?: string; notes?: string },
  actor: Actor = {},
) {
  await ensureExpenseCategories(companyId, actor);
  if (input.glAccountId) {
    const gl = await prisma.account.findFirst({ where: { id: input.glAccountId, companyId, isActive: true } });
    if (!gl) throw new Error("GL account does not exist");
    if (gl.type !== "EXPENSE" && gl.type !== "OTHER_EXPENSE" && gl.type !== "COST_OF_SALES") {
      throw new Error("Expense categories must map to an expense account");
    }
  }
  const created = await prisma.expenseCategory.create({
    data: {
      companyId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      glAccountId: input.glAccountId,
      notes: input.notes,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "ExpenseCategory", created.id, created);
  return (await listCategories(companyId, { includeInactive: true })).find((c) => c.id === created.id)!;
}

export async function updateCategory(
  companyId: string,
  id: string,
  input: { name?: string; glAccountId?: string | null; isActive?: boolean; notes?: string | null },
  actor: Actor = {},
) {
  const before = await prisma.expenseCategory.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Expense category does not exist");
  if (input.glAccountId) {
    const gl = await prisma.account.findFirst({ where: { id: input.glAccountId, companyId, isActive: true } });
    if (!gl) throw new Error("GL account does not exist");
  }
  const updated = await prisma.expenseCategory.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      glAccountId: input.glAccountId === undefined ? undefined : input.glAccountId,
      isActive: input.isActive,
      notes: input.notes === undefined ? undefined : input.notes,
    },
  });
  await audit(companyId, actor, "UPDATE", "ExpenseCategory", id, updated, before);
  return (await listCategories(companyId, { includeInactive: true })).find((c) => c.id === id)!;
}

type AllocationInput = { branch?: string; department?: string; costCentre?: string; project?: string; amount: number; notes?: string };

async function resolveCreditAccount(
  companyId: string,
  paymentMode: ExpensePaymentMode,
  input: { creditAccountId?: string; financialAccountId?: string; supplierId?: string },
) {
  if (input.financialAccountId) {
    const fa = await prisma.financialAccount.findFirst({ where: { id: input.financialAccountId, companyId } });
    if (!fa) throw new Error("Bank or cash account does not exist");
    if (!fa.isActive) throw new Error(`${fa.name} is inactive`);
    return { creditAccountId: fa.glAccountId, financialAccountId: fa.id };
  }
  if (input.creditAccountId) {
    const gl = await prisma.account.findFirst({ where: { id: input.creditAccountId, companyId, isActive: true } });
    if (!gl) throw new Error("Payment or payable account does not exist");
    return { creditAccountId: gl.id, financialAccountId: null as string | null };
  }
  const defaults = await defaultsFor(companyId);
  if (paymentMode === "ON_ACCOUNT") {
    if (input.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, companyId } });
      if (!supplier) throw new Error("Supplier does not exist");
      return { creditAccountId: supplier.apAccountId, financialAccountId: null };
    }
    const accrued = defaults.accruedExpensesId ?? defaults.accountsPayableId;
    if (!accrued) throw new Error("Map an accrued expenses or accounts payable account for expenses on account");
    return { creditAccountId: accrued, financialAccountId: null };
  }
  const bank = defaults.defaultBankAccountId ?? defaults.defaultCashAccountId;
  if (!bank) throw new Error("Choose the bank or cash account this expense was paid from");
  return { creditAccountId: bank, financialAccountId: null };
}

async function serializeExpense(companyId: string, id: string) {
  const e = await prisma.expense.findFirst({
    where: { id, companyId },
    include: { category: true, allocations: true },
  });
  if (!e) throw new Error("Expense does not exist");
  const [expenseAccount, creditAccount, journal] = await Promise.all([
    accountName(companyId, e.expenseAccountId),
    accountName(companyId, e.creditAccountId),
    e.journalId ? prisma.journal.findFirst({ where: { id: e.journalId, companyId }, select: { id: true, journalNumber: true } }) : null,
  ]);
  return {
    id: e.id,
    number: e.number,
    expenseDate: e.expenseDate,
    categoryId: e.categoryId,
    categoryCode: e.category.code,
    categoryName: e.category.name,
    expenseAccountId: e.expenseAccountId,
    expenseAccount,
    paymentMode: e.paymentMode as ExpensePaymentMode,
    status: e.status as ExpenseStatus,
    payeeName: e.payeeName,
    supplierId: e.supplierId,
    employeeErpUserId: e.employeeErpUserId,
    employeeName: e.employeeName,
    description: e.description,
    netAmount: money(e.netAmount),
    taxAmount: money(e.taxAmount),
    grossAmount: money(e.grossAmount),
    taxCodeId: e.taxCodeId,
    currencyCode: e.currencyCode,
    creditAccountId: e.creditAccountId,
    creditAccount,
    financialAccountId: e.financialAccountId,
    paymentMethod: e.paymentMethod,
    reference: e.reference,
    branch: e.branch,
    department: e.department,
    costCentre: e.costCentre,
    project: e.project,
    receiptReference: e.receiptReference,
    rejectionReason: e.rejectionReason,
    submittedAt: e.submittedAt,
    approvedAt: e.approvedAt,
    rejectedAt: e.rejectedAt,
    postedAt: e.postedAt,
    journalId: e.journalId,
    journalNumber: journal?.journalNumber ?? null,
    recurringExpenseId: e.recurringExpenseId,
    allocations: e.allocations.map((a) => ({
      id: a.id,
      branch: a.branch,
      department: a.department,
      costCentre: a.costCentre,
      project: a.project,
      amount: money(a.amount),
      percent: money(a.percent),
      notes: a.notes,
    })),
  };
}

export async function getExpense(companyId: string, id: string) {
  return serializeExpense(companyId, id);
}

export async function listExpenses(
  companyId: string,
  options: { from?: string; to?: string; status?: ExpenseStatus; categoryId?: string; page?: number; pageSize?: number } = {},
) {
  await ensureExpenseCategories(companyId);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50));
  const where = {
    companyId,
    ...(options.status ? { status: options.status } : {}),
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    ...(options.from || options.to
      ? {
          expenseDate: {
            ...(options.from ? { gte: startOfDay(options.from) } : {}),
            ...(options.to ? { lte: endOfDay(options.to) } : {}),
          },
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: { category: true },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    rows: rows.map((e) => ({
      id: e.id,
      number: e.number,
      expenseDate: e.expenseDate,
      categoryCode: e.category.code,
      categoryName: e.category.name,
      paymentMode: e.paymentMode,
      status: e.status,
      payeeName: e.payeeName,
      employeeName: e.employeeName,
      description: e.description,
      netAmount: money(e.netAmount),
      taxAmount: money(e.taxAmount),
      grossAmount: money(e.grossAmount),
      branch: e.branch,
      department: e.department,
    })),
  };
}

export async function createExpense(
  companyId: string,
  input: {
    expenseDate: string;
    categoryId: string;
    expenseAccountId?: string;
    paymentMode?: ExpensePaymentMode;
    payeeName?: string;
    supplierId?: string;
    employeeErpUserId?: number;
    employeeName?: string;
    description?: string;
    net: number;
    tax?: number;
    taxCodeId?: string;
    creditAccountId?: string;
    financialAccountId?: string;
    paymentMethod?: string;
    reference?: string;
    branch?: string;
    department?: string;
    costCentre?: string;
    project?: string;
    receiptReference?: string;
    allocations?: AllocationInput[];
    submit?: boolean;
    post?: boolean;
  },
  actor: Actor = {},
) {
  await ensureExpenseCategories(companyId, actor);
  const category = await prisma.expenseCategory.findFirst({ where: { id: input.categoryId, companyId } });
  if (!category) throw new Error("Expense category does not exist");
  if (!category.isActive) throw new Error(`${category.name} is inactive`);
  const expenseAccountId = input.expenseAccountId || category.glAccountId;
  if (!expenseAccountId) throw new Error("Map a GL account on the category or choose one on the expense");
  const gl = await prisma.account.findFirst({ where: { id: expenseAccountId, companyId, isActive: true } });
  if (!gl) throw new Error("Expense account does not exist");

  const paymentMode = input.paymentMode ?? "IMMEDIATE";
  const { net, tax, gross } = assertExpenseAmounts({ net: input.net, tax: input.tax });
  const credit = await resolveCreditAccount(companyId, paymentMode, input);
  const number = await nextNumber(companyId, "EXPENSE", "EXP");
  const allocations = input.allocations?.length ? assertExpenseAllocations(input.allocations, gross) : [];

  const expense = await prisma.expense.create({
    data: {
      companyId,
      number,
      expenseDate: startOfDay(input.expenseDate),
      categoryId: category.id,
      expenseAccountId,
      paymentMode,
      status: "DRAFT",
      payeeName: input.payeeName?.trim() || input.employeeName?.trim() || null,
      supplierId: input.supplierId,
      employeeErpUserId: input.employeeErpUserId,
      employeeName: input.employeeName?.trim() || null,
      description: input.description?.trim() || null,
      netAmount: net,
      taxAmount: tax,
      grossAmount: gross,
      taxCodeId: input.taxCodeId,
      creditAccountId: credit.creditAccountId,
      financialAccountId: credit.financialAccountId,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      branch: input.branch,
      department: input.department,
      costCentre: input.costCentre,
      project: input.project,
      receiptReference: input.receiptReference,
      createdByErpUserId: actor.erpUserId,
      allocations: allocations.length
        ? {
            create: allocations.map((a, i) => ({
              companyId,
              branch: input.allocations![i].branch,
              department: input.allocations![i].department,
              costCentre: input.allocations![i].costCentre,
              project: input.allocations![i].project,
              amount: a.amount,
              percent: a.percent,
              notes: input.allocations![i].notes,
            })),
          }
        : undefined,
    },
  });
  await audit(companyId, actor, "CREATE", "Expense", expense.id, { number, net, tax, gross });

  if (input.post) return postExpense(companyId, expense.id, actor);
  if (input.submit) return submitExpense(companyId, expense.id, actor);
  return serializeExpense(companyId, expense.id);
}

export async function submitExpense(companyId: string, id: string, actor: Actor = {}) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId } });
  if (!expense) throw new Error("Expense does not exist");
  assertExpenseTransition(expense.status as ExpenseStatus, "SUBMITTED");
  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date(), submittedByErpUserId: actor.erpUserId, rejectionReason: null },
  });
  await audit(companyId, actor, "SUBMIT", "Expense", id, updated, expense);
  return serializeExpense(companyId, id);
}

export async function approveExpense(companyId: string, id: string, actor: Actor = {}) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId } });
  if (!expense) throw new Error("Expense does not exist");
  assertExpenseTransition(expense.status as ExpenseStatus, "APPROVED");
  await prisma.expense.update({
    where: { id },
    data: { status: "APPROVED", approvedAt: new Date(), approvedByErpUserId: actor.erpUserId, rejectionReason: null },
  });
  await audit(companyId, actor, "APPROVE", "Expense", id, { status: "APPROVED" }, expense);
  return postExpense(companyId, id, actor);
}

export async function rejectExpense(companyId: string, id: string, input: { reason: string }, actor: Actor = {}) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId } });
  if (!expense) throw new Error("Expense does not exist");
  assertExpenseTransition(expense.status as ExpenseStatus, "REJECTED");
  if (!input.reason.trim() || input.reason.trim().length < 3) throw new Error("Give a reason for rejecting the expense");
  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedByErpUserId: actor.erpUserId, rejectionReason: input.reason.trim() },
  });
  await audit(companyId, actor, "REJECT", "Expense", id, updated, expense);
  return serializeExpense(companyId, id);
}

export async function postExpense(companyId: string, id: string, actor: Actor = {}) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId }, include: { category: true } });
  if (!expense) throw new Error("Expense does not exist");
  if (expense.status === "POSTED") return serializeExpense(companyId, id);
  if (expense.status === "REVERSED") throw new Error("A reversed expense can't be posted again");
  if (expense.status === "REJECTED") throw new Error("A rejected expense can't be posted");
  if (expense.status === "DRAFT") assertExpenseTransition("DRAFT", "POSTED");
  else if (expense.status === "SUBMITTED") {
    await prisma.expense.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedByErpUserId: actor.erpUserId },
    });
  } else if (expense.status !== "APPROVED") {
    assertExpenseTransition(expense.status as ExpenseStatus, "POSTED");
  }

  if (!expense.creditAccountId) throw new Error("Choose the bank, cash or payable account for this expense");
  const defaults = await defaultsFor(companyId);
  const lines = buildExpenseLines({
    expenseAccountId: expense.expenseAccountId,
    creditAccountId: expense.creditAccountId,
    net: money(expense.netAmount),
    tax: money(expense.taxAmount),
    inputTaxAccountId: defaults.inputTaxReceivableId,
    description: expense.description || `${expense.category.name} ${expense.number}`,
  });
  const journal = await postExpenseJournal(
    companyId,
    {
      journalDate: expense.expenseDate,
      description: expense.description || `Expense ${expense.number}`,
      referenceNumber: expense.reference || expense.number,
      sourceDocumentType: "Expense",
      sourceDocumentId: expense.id,
      sourceDocumentNumber: expense.number,
      lines,
    },
    actor,
  );
  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "POSTED", postedAt: new Date(), postedByErpUserId: actor.erpUserId, journalId: journal.id },
  });
  await audit(companyId, actor, "POST", "Expense", id, updated, expense);
  return serializeExpense(companyId, id);
}

export async function reverseExpense(companyId: string, id: string, input: { reason: string; reversalDate?: string }, actor: Actor = {}) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId } });
  if (!expense) throw new Error("Expense does not exist");
  assertExpenseTransition(expense.status as ExpenseStatus, "REVERSED");
  if (!expense.journalId) throw new Error("Expense has no journal to reverse");
  if (!input.reason.trim() || input.reason.trim().length < 3) throw new Error("Give a reason for the reversal");
  const original = await prisma.journal.findFirst({ where: { id: expense.journalId, companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
  if (!original) throw new Error("Original journal was not found");
  const lines = reverseJournalLines(
    original.lines.map((l) => ({ accountId: l.accountId, description: l.description ?? undefined, debit: money(l.debit), credit: money(l.credit) })),
  );
  const reversalDate = input.reversalDate ? startOfDay(input.reversalDate) : startOfDay(new Date());
  if (reversalDate < expense.expenseDate) throw new Error("A reversal can't be dated before the expense");
  const journal = await postExpenseJournal(
    companyId,
    {
      journalDate: reversalDate,
      description: `Reversal of ${expense.number}: ${input.reason.trim()}`,
      referenceNumber: expense.number,
      sourceDocumentType: "ExpenseReversal",
      sourceDocumentId: expense.id,
      sourceDocumentNumber: expense.number,
      lines,
    },
    actor,
  );
  const updated = await prisma.expense.update({
    where: { id },
    data: {
      status: "REVERSED",
      reversedAt: new Date(),
      reversedByErpUserId: actor.erpUserId,
      reversalReason: input.reason.trim(),
      reversalJournalId: journal.id,
    },
  });
  await audit(companyId, actor, "REVERSE", "Expense", id, updated, expense);
  return serializeExpense(companyId, id);
}

export async function discardExpense(companyId: string, id: string, actor: Actor = {}) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId } });
  if (!expense) throw new Error("Expense does not exist");
  if (expense.status === "POSTED" || expense.status === "REVERSED") throw new Error("A posted expense can't be deleted");
  await prisma.expenseAllocation.deleteMany({ where: { expenseId: id } });
  await prisma.expense.delete({ where: { id } });
  await audit(companyId, actor, "DELETE", "Expense", id, null, expense);
  return { id };
}

/* ── Recurring ──────────────────────────────────────────── */

export async function listRecurring(companyId: string) {
  await ensureExpenseCategories(companyId);
  const rows = await prisma.recurringExpense.findMany({ where: { companyId }, orderBy: { nextRunDate: "asc" } });
  const categories = await prisma.expenseCategory.findMany({ where: { companyId, id: { in: rows.map((r) => r.categoryId) } } });
  const byId = new Map(categories.map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    name: r.name,
    categoryId: r.categoryId,
    categoryCode: byId.get(r.categoryId)?.code ?? null,
    categoryName: byId.get(r.categoryId)?.name ?? null,
    paymentMode: r.paymentMode,
    frequency: r.frequency,
    amount: money(r.amount),
    taxAmount: money(r.taxAmount),
    payeeName: r.payeeName,
    nextRunDate: r.nextRunDate,
    endDate: r.endDate,
    autoPost: r.autoPost,
    isActive: r.isActive,
    lastGeneratedAt: r.lastGeneratedAt,
  }));
}

export async function createRecurring(
  companyId: string,
  input: {
    name: string;
    categoryId: string;
    expenseAccountId?: string;
    paymentMode?: ExpensePaymentMode;
    frequency: RecurringFrequency;
    amount: number;
    taxAmount?: number;
    payeeName?: string;
    supplierId?: string;
    creditAccountId?: string;
    financialAccountId?: string;
    description?: string;
    branch?: string;
    department?: string;
    costCentre?: string;
    project?: string;
    startDate: string;
    endDate?: string;
    autoPost?: boolean;
  },
  actor: Actor = {},
) {
  await ensureExpenseCategories(companyId, actor);
  const category = await prisma.expenseCategory.findFirst({ where: { id: input.categoryId, companyId } });
  if (!category) throw new Error("Expense category does not exist");
  const { net, tax } = assertExpenseAmounts({ net: input.amount, tax: input.taxAmount });
  const number = await nextNumber(companyId, "RECURRING_EXPENSE", "REX");
  const created = await prisma.recurringExpense.create({
    data: {
      companyId,
      number,
      name: input.name.trim(),
      categoryId: category.id,
      expenseAccountId: input.expenseAccountId || category.glAccountId,
      paymentMode: input.paymentMode ?? "IMMEDIATE",
      frequency: input.frequency,
      amount: net,
      taxAmount: tax,
      payeeName: input.payeeName,
      supplierId: input.supplierId,
      creditAccountId: input.creditAccountId,
      financialAccountId: input.financialAccountId,
      description: input.description,
      branch: input.branch,
      department: input.department,
      costCentre: input.costCentre,
      project: input.project,
      startDate: startOfDay(input.startDate),
      endDate: input.endDate ? startOfDay(input.endDate) : null,
      nextRunDate: startOfDay(input.startDate),
      autoPost: Boolean(input.autoPost),
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "RecurringExpense", created.id, created);
  return (await listRecurring(companyId)).find((r) => r.id === created.id)!;
}

export async function runRecurring(companyId: string, id: string, actor: Actor = {}) {
  const template = await prisma.recurringExpense.findFirst({ where: { id, companyId } });
  if (!template) throw new Error("Recurring expense does not exist");
  if (!template.isActive) throw new Error("This recurring expense is inactive");
  if (template.endDate && template.nextRunDate > template.endDate) throw new Error("This recurring expense has ended");

  const expense = await createExpense(
    companyId,
    {
      expenseDate: isoDay(template.nextRunDate),
      categoryId: template.categoryId,
      expenseAccountId: template.expenseAccountId || undefined,
      paymentMode: template.paymentMode as ExpensePaymentMode,
      payeeName: template.payeeName || undefined,
      supplierId: template.supplierId || undefined,
      description: template.description || template.name,
      net: money(template.amount),
      tax: money(template.taxAmount),
      creditAccountId: template.creditAccountId || undefined,
      financialAccountId: template.financialAccountId || undefined,
      branch: template.branch || undefined,
      department: template.department || undefined,
      costCentre: template.costCentre || undefined,
      project: template.project || undefined,
      post: template.autoPost,
      submit: !template.autoPost,
    },
    actor,
  );
  await prisma.expense.update({ where: { id: expense.id }, data: { recurringExpenseId: template.id } });

  const next = nextRecurringDate(template.nextRunDate, template.frequency as RecurringFrequency);
  const ended = template.endDate && startOfDay(next) > template.endDate;
  await prisma.recurringExpense.update({
    where: { id },
    data: {
      nextRunDate: startOfDay(next),
      lastGeneratedAt: new Date(),
      isActive: ended ? false : template.isActive,
    },
  });
  await audit(companyId, actor, "GENERATE", "RecurringExpense", id, { expenseId: expense.id, next });
  return serializeExpense(companyId, expense.id);
}

/* ── Dashboard & reports ────────────────────────────────── */

export async function expenseDashboard(companyId: string) {
  await ensureExpenseCategories(companyId);
  const today = isoDay(new Date());
  const monthStart = startOfDay(`${today.slice(0, 8)}01`);
  const monthEnd = endOfDay(today);
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const posted = { companyId, status: "POSTED" as const };
  const [monthAgg, todayAgg, pending, approved, rejected, recent, byCategory] = await Promise.all([
    prisma.expense.aggregate({ where: { ...posted, expenseDate: { gte: monthStart, lte: monthEnd } }, _sum: { grossAmount: true }, _count: true }),
    prisma.expense.aggregate({ where: { ...posted, expenseDate: { gte: dayStart, lte: dayEnd } }, _sum: { grossAmount: true }, _count: true }),
    prisma.expense.count({ where: { companyId, status: { in: ["SUBMITTED", "APPROVED"] } } }),
    prisma.expense.count({ where: { companyId, status: "APPROVED" } }),
    prisma.expense.count({ where: { companyId, status: "REJECTED", expenseDate: { gte: monthStart } } }),
    prisma.expense.findMany({
      where: { companyId },
      include: { category: true },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
    prisma.expense.findMany({
      where: { ...posted, expenseDate: { gte: monthStart, lte: monthEnd } },
      select: { grossAmount: true, category: { select: { name: true } } },
    }),
  ]);

  const reimbursable = await prisma.expense.aggregate({
    where: { companyId, paymentMode: "REIMBURSEMENT", status: { in: ["SUBMITTED", "APPROVED"] } },
    _sum: { grossAmount: true },
    _count: true,
  });

  return {
    month: { from: monthStart, to: monthEnd, total: money(monthAgg._sum.grossAmount), count: monthAgg._count },
    today: { total: money(todayAgg._sum.grossAmount), count: todayAgg._count },
    pendingApprovals: pending,
    approvedWaiting: approved,
    rejectedThisMonth: rejected,
    reimbursable: { count: reimbursable._count, amount: money(reimbursable._sum.grossAmount) },
    topCategories: expenseByCategoryTotals(byCategory.map((e) => ({ categoryName: e.category.name, amount: money(e.grossAmount) }))).slice(0, 6),
    recent: recent.map((e) => ({
      id: e.id,
      number: e.number,
      expenseDate: e.expenseDate,
      categoryName: e.category.name,
      status: e.status,
      payeeName: e.payeeName,
      grossAmount: money(e.grossAmount),
      description: e.description,
    })),
  };
}

export async function expensesByCategoryReport(companyId: string, from?: string, to?: string) {
  const start = from ? startOfDay(from) : startOfDay(`${isoDay().slice(0, 8)}01`);
  const end = to ? endOfDay(to) : endOfDay(new Date());
  const rows = await prisma.expense.findMany({
    where: { companyId, status: "POSTED", expenseDate: { gte: start, lte: end } },
    include: { category: true },
    orderBy: { expenseDate: "asc" },
  });
  const totals = expenseByCategoryTotals(rows.map((e) => ({ categoryName: e.category.name, amount: money(e.grossAmount) })));
  return {
    from: start,
    to: end,
    total: roundMoney(totals.reduce((s, t) => s + t.amount, 0)),
    categories: totals,
    rows: rows.map((e) => ({
      id: e.id,
      number: e.number,
      expenseDate: e.expenseDate,
      categoryName: e.category.name,
      payeeName: e.payeeName,
      description: e.description,
      branch: e.branch,
      department: e.department,
      amount: money(e.grossAmount),
    })),
  };
}

/** ERP EXPENSE_APPROVED → posted expense (idempotent on source document). */
export async function syncExpenseFromEvent(
  companyId: string,
  event: {
    sourceModule: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string | null;
    occurredAt: Date;
    amountTotals?: { net?: string | number; tax?: string | number; gross?: string | number } | null;
    metadata?: Record<string, unknown> | null;
  },
  actor: Actor = {},
) {
  const existing = await prisma.expense.findFirst({
    where: { companyId, sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  if (existing) return serializeExpense(companyId, existing.id);

  await ensureExpenseCategories(companyId, actor);
  const meta = event.metadata ?? {};
  const categoryCode = typeof meta.categoryCode === "string" ? meta.categoryCode.toUpperCase() : "MISC";
  let category = await prisma.expenseCategory.findFirst({ where: { companyId, code: categoryCode } });
  if (!category) category = await prisma.expenseCategory.findFirst({ where: { companyId, code: "MISC" } });
  if (!category) throw new Error("No expense category available for ERP expense sync");

  const net = Number(event.amountTotals?.net ?? meta.net ?? 0);
  const tax = Number(event.amountTotals?.tax ?? meta.tax ?? 0);
  const expense = await createExpense(
    companyId,
    {
      expenseDate: isoDay(event.occurredAt),
      categoryId: category.id,
      paymentMode: meta.paymentMode === "ON_ACCOUNT" ? "ON_ACCOUNT" : meta.paymentMode === "REIMBURSEMENT" ? "REIMBURSEMENT" : "IMMEDIATE",
      payeeName: typeof meta.payeeName === "string" ? meta.payeeName : event.sourceDocumentNumber ?? "ERP expense",
      description: typeof meta.description === "string" ? meta.description : `ERP expense ${event.sourceDocumentNumber || event.sourceDocumentId}`,
      net: net || Number(event.amountTotals?.gross ?? 0),
      tax,
      financialAccountId: typeof meta.financialAccountId === "string" ? meta.financialAccountId : undefined,
      reference: event.sourceDocumentNumber || undefined,
      branch: typeof meta.branch === "string" ? meta.branch : undefined,
      department: typeof meta.department === "string" ? meta.department : undefined,
      post: true,
    },
    actor,
  );
  await prisma.expense.update({
    where: { id: expense.id },
    data: { sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  return serializeExpense(companyId, expense.id);
}

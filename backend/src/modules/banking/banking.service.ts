import {
  assertFundsAvailable,
  buildCashCountLines,
  buildMoneyPaidLines,
  buildMoneyReceivedLines,
  buildTransferLines,
  reverseJournalLines,
  roundMoney,
  transferTypeFor,
  type AllocationLine,
  type BankTransactionKind,
  type FinancialAccountKind,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import type { FinancialAccount, Prisma } from "@prisma/client";
import { defaultsFor, money, nextNumber } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAccount } from "../coa/coa.service";
import { createJournal, postJournal } from "../journals/journal.service";

export type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

const DAY = 86_400_000;

export const KIND_LABELS: Record<FinancialAccountKind, string> = {
  BANK: "Bank",
  CASH: "Cash",
  PETTY_CASH: "Petty cash",
  MOBILE_MONEY: "Mobile money",
};

const GL_CODE_BASE: Record<FinancialAccountKind, number> = { CASH: 1100, BANK: 1110, PETTY_CASH: 1120, MOBILE_MONEY: 1130 };

const NUMBERING: Record<BankTransactionKind, [string, string]> = {
  RECEIPT: ["BANK_RECEIPT", "RCV"],
  PAYMENT: ["BANK_PAYMENT", "PMT"],
  TRANSFER: ["BANK_TRANSFER", "TRF"],
  BANK_CHARGE: ["BANK_CHARGE", "CHG"],
  INTEREST: ["BANK_INTEREST", "INT"],
  CASH_COUNT: ["CASH_COUNT", "CNT"],
};

export async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, beforeJson, afterJson, ...actor.meta });
}

export function startOfDay(value: Date | string) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function endOfDay(value: Date | string) {
  return new Date(startOfDay(value).getTime() + DAY - 1);
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** GL balance (debit − credit) of an account up to the end of `asOf`, or all postings when omitted. */
export async function glBalance(companyId: string, accountId: string, asOf?: Date | string) {
  const sum = await prisma.glEntry.aggregate({
    where: { companyId, accountId, ...(asOf ? { transactionDate: { lte: endOfDay(asOf) } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return roundMoney(money(sum._sum.debit) - money(sum._sum.credit));
}

export async function loadFinancialAccount(companyId: string, id: string, options: { active?: boolean } = {}) {
  const account = await prisma.financialAccount.findFirst({ where: { id, companyId } });
  if (!account) throw new Error("Bank or cash account does not exist");
  if (options.active && !account.isActive) throw new Error(`${account.name} is inactive`);
  return account;
}

async function postBanking(
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
      sourceModule: "BANKING",
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

async function assertReferenceFree(companyId: string, financialAccountId: string, input: { reference?: string | null; chequeNumber?: string | null }) {
  const checks: Prisma.BankTransactionWhereInput[] = [];
  if (input.reference) checks.push({ reference: { equals: input.reference, mode: "insensitive" } });
  if (input.chequeNumber) checks.push({ chequeNumber: { equals: input.chequeNumber, mode: "insensitive" } });
  if (!checks.length) return;
  const clash = await prisma.bankTransaction.findFirst({ where: { companyId, financialAccountId, status: "POSTED", OR: checks } });
  if (clash) {
    const what = input.chequeNumber && clash.chequeNumber?.toLowerCase() === input.chequeNumber.toLowerCase() ? `Cheque ${input.chequeNumber}` : `Reference ${input.reference}`;
    throw new Error(`${what} is already used on this account (${clash.number})`);
  }
}

async function nextFreeGlCode(companyId: string, kind: FinancialAccountKind) {
  const used = new Set((await prisma.account.findMany({ where: { companyId }, select: { code: true } })).map((a) => a.code));
  const base = GL_CODE_BASE[kind];
  const candidates = [...Array.from({ length: 9 }, (_, i) => base + 1 + i), ...Array.from({ length: 50 }, (_, i) => 1150 + i)];
  const code = candidates.find((c) => !used.has(String(c)));
  if (!code) throw new Error("No free account code is left between 1100 and 1199; choose an existing GL account instead");
  return String(code);
}

/* ── Financial accounts ─────────────────────────────────────────────── */

type AccountInput = {
  kind: FinancialAccountKind;
  name: string;
  accountNumber?: string;
  bankName?: string;
  branchName?: string;
  swiftCode?: string;
  provider?: string;
  currency?: string;
  glAccountId?: string;
  openingBalance?: number;
  dateOpened: string | Date;
  reconcileFrom?: string | Date;
  allowOverdraft?: boolean;
  custodian?: string;
  notes?: string;
};

export async function createFinancialAccount(companyId: string, input: AccountInput, actor: Actor = {}) {
  const name = input.name.trim();
  if (await prisma.financialAccount.findFirst({ where: { companyId, name: { equals: name, mode: "insensitive" } } })) {
    throw new Error(`An account named ${name} already exists`);
  }
  const opening = roundMoney(input.openingBalance ?? 0);
  const dateOpened = startOfDay(input.dateOpened);
  let glAccountId = input.glAccountId;
  if (glAccountId) {
    const gl = await prisma.account.findFirst({ where: { id: glAccountId, companyId } });
    if (!gl) throw new Error("GL account does not exist");
    if (gl.type !== "ASSET") throw new Error(`${gl.code} ${gl.name} is not an asset account`);
    if (!gl.isActive) throw new Error(`${gl.code} ${gl.name} is inactive`);
    const linked = await prisma.financialAccount.findFirst({ where: { companyId, glAccountId } });
    if (linked) throw new Error(`${gl.code} ${gl.name} is already used by ${linked.name}`);
    if (opening !== 0 && (await prisma.glEntry.count({ where: { companyId, accountId: gl.id } }))) {
      throw new Error(`${gl.code} ${gl.name} already carries postings; leave the opening balance at zero`);
    }
  } else {
    const code = await nextFreeGlCode(companyId, input.kind);
    const clash = await prisma.account.findFirst({ where: { companyId, type: "ASSET", name: { equals: name, mode: "insensitive" } } });
    const gl = await createAccount(
      companyId,
      {
        code,
        name: clash ? `${name} (${code})` : name,
        type: "ASSET",
        currency: input.currency,
        isCashAccount: true,
        bankReconciliationRequired: input.kind === "BANK" || input.kind === "MOBILE_MONEY",
        description: `${KIND_LABELS[input.kind]} account ${name}`,
      },
      { ...actor, erpUserId: actor.erpUserId ?? 0 },
    );
    glAccountId = gl.id;
  }
  const account = await prisma.financialAccount.create({
    data: {
      companyId,
      kind: input.kind,
      name,
      accountNumber: input.accountNumber,
      bankName: input.bankName,
      branchName: input.branchName,
      swiftCode: input.swiftCode,
      provider: input.provider,
      currency: input.currency ?? "RWF",
      glAccountId,
      openingBalance: opening,
      dateOpened,
      reconcileFrom: input.reconcileFrom ? startOfDay(input.reconcileFrom) : dateOpened,
      allowOverdraft: input.allowOverdraft ?? input.kind === "BANK",
      custodian: input.custodian,
      notes: input.notes,
      createdByErpUserId: actor.erpUserId,
    },
  });
  if (opening !== 0) {
    const defaults = await defaultsFor(companyId);
    const contra = defaults.suspenseAccountId ?? defaults.retainedEarningsId;
    if (!contra) throw new Error("Map the suspense or retained earnings account before entering an opening balance");
    const amount = Math.abs(opening);
    const lines: JournalLineDraft[] =
      opening > 0
        ? [
            { accountId: glAccountId, description: `Opening balance ${name}`, debit: amount, credit: 0 },
            { accountId: contra, description: `Opening balance ${name}`, debit: 0, credit: amount },
          ]
        : [
            { accountId: contra, description: `Opening balance ${name}`, debit: amount, credit: 0 },
            { accountId: glAccountId, description: `Opening balance ${name}`, debit: 0, credit: amount },
          ];
    const journal = await postBanking(
      companyId,
      { journalDate: dateOpened, description: `Opening balance ${name}`, sourceDocumentType: "FinancialAccountOpening", sourceDocumentId: account.id, sourceDocumentNumber: name, lines },
      actor,
    );
    const entry = await prisma.glEntry.findFirst({ where: { companyId, journalId: journal.id, accountId: glAccountId } });
    if (entry) {
      await prisma.bankMatch.create({
        data: {
          companyId,
          financialAccountId: account.id,
          method: "OPENING",
          clearedDate: dateOpened,
          createdByErpUserId: actor.erpUserId,
          entries: { create: { glEntryId: entry.id, amount: opening, entryDate: entry.transactionDate } },
        },
      });
    }
  }
  await audit(companyId, actor, "CREATE", "FinancialAccount", account.id, { ...account, openingBalance: opening });
  return getFinancialAccount(companyId, account.id);
}

export async function updateFinancialAccount(
  companyId: string,
  id: string,
  input: Partial<Pick<AccountInput, "name" | "accountNumber" | "bankName" | "branchName" | "swiftCode" | "provider" | "allowOverdraft" | "custodian" | "notes" | "reconcileFrom">> & { isActive?: boolean },
  actor: Actor = {},
) {
  const before = await loadFinancialAccount(companyId, id);
  if (input.name && input.name.trim().toLowerCase() !== before.name.toLowerCase()) {
    if (await prisma.financialAccount.findFirst({ where: { companyId, name: { equals: input.name.trim(), mode: "insensitive" }, NOT: { id } } })) {
      throw new Error(`An account named ${input.name.trim()} already exists`);
    }
  }
  if (input.reconcileFrom && (await prisma.bankReconciliation.count({ where: { companyId, financialAccountId: id, status: "COMPLETED" } }))) {
    throw new Error("The reconcile-from date can't change after a reconciliation has been completed");
  }
  if (input.isActive === false && (await prisma.bankReconciliation.count({ where: { companyId, financialAccountId: id, status: { not: "COMPLETED" } } }))) {
    throw new Error("Finish or discard the open reconciliation before deactivating this account");
  }
  const updated = await prisma.financialAccount.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      accountNumber: input.accountNumber,
      bankName: input.bankName,
      branchName: input.branchName,
      swiftCode: input.swiftCode,
      provider: input.provider,
      allowOverdraft: input.allowOverdraft,
      custodian: input.custodian,
      notes: input.notes,
      isActive: input.isActive,
      reconcileFrom: input.reconcileFrom ? startOfDay(input.reconcileFrom) : undefined,
    },
  });
  await audit(companyId, actor, "UPDATE", "FinancialAccount", id, updated, before);
  return getFinancialAccount(companyId, id);
}

async function describeAccounts(companyId: string, accounts: FinancialAccount[]) {
  const glAccounts = await prisma.account.findMany({ where: { companyId, id: { in: accounts.map((a) => a.glAccountId) } }, select: { id: true, code: true, name: true } });
  const sums = await prisma.glEntry.groupBy({
    by: ["accountId"],
    where: { companyId, accountId: { in: accounts.map((a) => a.glAccountId) } },
    _sum: { debit: true, credit: true },
  });
  const completed = await prisma.bankReconciliation.findMany({
    where: { companyId, financialAccountId: { in: accounts.map((a) => a.id) }, status: "COMPLETED" },
    orderBy: { statementDate: "desc" },
    distinct: ["financialAccountId"],
  });
  const open = await prisma.bankReconciliation.findMany({ where: { companyId, financialAccountId: { in: accounts.map((a) => a.id) }, status: { not: "COMPLETED" } } });
  const unmatched = await prisma.bankStatementLine.groupBy({
    by: ["financialAccountId"],
    where: { companyId, financialAccountId: { in: accounts.map((a) => a.id) }, matchId: null },
    _count: { _all: true },
  });
  return accounts.map((a) => {
    const gl = glAccounts.find((g) => g.id === a.glAccountId);
    const s = sums.find((x) => x.accountId === a.glAccountId);
    const last = completed.find((r) => r.financialAccountId === a.id);
    const current = open.find((r) => r.financialAccountId === a.id);
    return {
      id: a.id,
      kind: a.kind,
      name: a.name,
      accountNumber: a.accountNumber,
      bankName: a.bankName,
      branchName: a.branchName,
      swiftCode: a.swiftCode,
      provider: a.provider,
      currency: a.currency,
      glAccountId: a.glAccountId,
      glAccountCode: gl?.code ?? null,
      glAccountName: gl?.name ?? null,
      openingBalance: money(a.openingBalance),
      balance: roundMoney(money(s?._sum.debit) - money(s?._sum.credit)),
      dateOpened: a.dateOpened,
      reconcileFrom: a.reconcileFrom,
      isActive: a.isActive,
      allowOverdraft: a.allowOverdraft,
      custodian: a.custodian,
      notes: a.notes,
      lastReconciledTo: last?.statementDate ?? null,
      lastReconciledBalance: last ? money(last.statementBalance) : null,
      openReconciliation: current ? { id: current.id, number: current.number, status: current.status, statementDate: current.statementDate } : null,
      unmatchedStatementLines: unmatched.find((u) => u.financialAccountId === a.id)?._count._all ?? 0,
    };
  });
}

export async function listFinancialAccounts(companyId: string, filter: { includeInactive?: boolean } = {}) {
  const accounts = await prisma.financialAccount.findMany({
    where: { companyId, ...(filter.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return describeAccounts(companyId, accounts);
}

export async function getFinancialAccount(companyId: string, id: string) {
  const account = await loadFinancialAccount(companyId, id);
  const [described] = await describeAccounts(companyId, [account]);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const month = await prisma.glEntry.aggregate({
    where: { companyId, accountId: account.glAccountId, transactionDate: { gte: monthStart } },
    _sum: { debit: true, credit: true },
  });
  const statements = await prisma.bankStatement.count({ where: { companyId, financialAccountId: id } });
  return { ...described, monthIn: money(month._sum.debit), monthOut: money(month._sum.credit), statementCount: statements };
}

/* ── Transactions ───────────────────────────────────────────────────── */

type MoneyInput = {
  financialAccountId: string;
  transactionDate: string | Date;
  lines: AllocationLine[];
  kind?: BankTransactionKind;
  method?: string;
  reference?: string;
  chequeNumber?: string;
  partyType?: string;
  partyName?: string;
  description?: string;
  statementLineId?: string;
  skipFundsCheck?: boolean;
};

async function recordMoney(companyId: string, direction: "IN" | "OUT", input: MoneyInput, actor: Actor) {
  const account = await loadFinancialAccount(companyId, input.financialAccountId, { active: true });
  const kind: BankTransactionKind = input.kind ?? (direction === "IN" ? "RECEIPT" : "PAYMENT");
  const date = startOfDay(input.transactionDate);
  const label = kind === "BANK_CHARGE" ? "Bank charges" : kind === "INTEREST" ? "Interest" : direction === "IN" ? `Received${input.partyName ? ` from ${input.partyName}` : ""}` : `Paid${input.partyName ? ` to ${input.partyName}` : ""}`;
  const description = input.description?.trim() || label;
  const lines = direction === "IN" ? buildMoneyReceivedLines(account.glAccountId, input.lines, description) : buildMoneyPaidLines(account.glAccountId, input.lines, description);
  const amount = roundMoney(input.lines.reduce((s, l) => s + l.amount, 0));
  if (direction === "OUT" && !input.skipFundsCheck) {
    assertFundsAvailable({ balance: await glBalance(companyId, account.glAccountId), amount, allowOverdraft: account.allowOverdraft, accountName: account.name });
  }
  await assertReferenceFree(companyId, account.id, { reference: input.reference, chequeNumber: input.chequeNumber });
  const [sequence, prefix] = NUMBERING[kind];
  const number = await nextNumber(companyId, sequence, prefix);
  const txn = await prisma.bankTransaction.create({
    data: {
      companyId,
      number,
      kind,
      financialAccountId: account.id,
      transactionDate: date,
      amount,
      method: input.method,
      reference: input.reference || undefined,
      chequeNumber: input.chequeNumber || undefined,
      partyType: input.partyType,
      partyName: input.partyName,
      description,
      lines: input.lines.map((l) => ({ accountId: l.accountId, amount: roundMoney(l.amount), description: l.description ?? null })),
      statementLineId: input.statementLineId,
      createdByErpUserId: actor.erpUserId,
    },
  });
  try {
    const journal = await postBanking(
      companyId,
      { journalDate: date, description, referenceNumber: input.reference || number, currencyCode: account.currency, sourceDocumentType: "BankTransaction", sourceDocumentId: txn.id, sourceDocumentNumber: number, lines },
      actor,
    );
    await prisma.bankTransaction.update({ where: { id: txn.id }, data: { journalId: journal.id } });
  } catch (e) {
    await prisma.bankTransaction.delete({ where: { id: txn.id } });
    throw e;
  }
  await audit(companyId, actor, "POST", "BankTransaction", txn.id, { number, kind, amount, account: account.name, lines: input.lines });
  return getTransaction(companyId, txn.id);
}

export function receiveMoney(companyId: string, input: MoneyInput, actor: Actor = {}) {
  return recordMoney(companyId, "IN", { ...input, kind: input.kind ?? "RECEIPT" }, actor);
}

export function makePayment(companyId: string, input: MoneyInput, actor: Actor = {}) {
  return recordMoney(companyId, "OUT", { ...input, kind: input.kind ?? "PAYMENT" }, actor);
}

export async function transferFunds(
  companyId: string,
  input: { fromAccountId: string; toAccountId: string; transactionDate: string | Date; amount: number; fee?: number; reference?: string; chequeNumber?: string; description?: string },
  actor: Actor = {},
) {
  const from = await loadFinancialAccount(companyId, input.fromAccountId, { active: true });
  const to = await loadFinancialAccount(companyId, input.toAccountId, { active: true });
  if (from.currency !== to.currency) throw new Error(`${from.name} is in ${from.currency} and ${to.name} is in ${to.currency}; transfers between currencies aren't supported yet`);
  const defaults = await defaultsFor(companyId);
  const lines = buildTransferLines({ fromAccountId: from.glAccountId, toAccountId: to.glAccountId, amount: input.amount, fee: input.fee, feeAccountId: defaults.bankChargesId });
  const amount = roundMoney(input.amount);
  const fee = roundMoney(input.fee ?? 0);
  assertFundsAvailable({ balance: await glBalance(companyId, from.glAccountId), amount: amount + fee, allowOverdraft: from.allowOverdraft, accountName: from.name });
  await assertReferenceFree(companyId, from.id, { reference: input.reference, chequeNumber: input.chequeNumber });
  const transferType = transferTypeFor(from.kind, to.kind);
  const label = { DEPOSIT: "Deposit", WITHDRAWAL: "Withdrawal", REPLENISHMENT: "Petty cash replenishment", TRANSFER: "Transfer" }[transferType];
  const description = input.description?.trim() || `${label}: ${from.name} to ${to.name}`;
  const date = startOfDay(input.transactionDate);
  const number = await nextNumber(companyId, ...NUMBERING.TRANSFER);
  const txn = await prisma.bankTransaction.create({
    data: {
      companyId,
      number,
      kind: "TRANSFER",
      transferType,
      financialAccountId: from.id,
      counterFinancialAccountId: to.id,
      transactionDate: date,
      amount,
      fee,
      reference: input.reference || undefined,
      chequeNumber: input.chequeNumber || undefined,
      description,
      createdByErpUserId: actor.erpUserId,
    },
  });
  try {
    const journal = await postBanking(
      companyId,
      { journalDate: date, description, referenceNumber: input.reference || number, currencyCode: from.currency, sourceDocumentType: "BankTransaction", sourceDocumentId: txn.id, sourceDocumentNumber: number, lines },
      actor,
    );
    await prisma.bankTransaction.update({ where: { id: txn.id }, data: { journalId: journal.id } });
  } catch (e) {
    await prisma.bankTransaction.delete({ where: { id: txn.id } });
    throw e;
  }
  await audit(companyId, actor, "POST", "BankTransaction", txn.id, { number, kind: "TRANSFER", transferType, amount, fee, from: from.name, to: to.name });
  return getTransaction(companyId, txn.id);
}

export async function recordCashCount(
  companyId: string,
  input: { financialAccountId: string; countDate: string | Date; counted: number; overShortAccountId?: string; description?: string },
  actor: Actor = {},
) {
  const account = await loadFinancialAccount(companyId, input.financialAccountId, { active: true });
  if (account.kind !== "CASH" && account.kind !== "PETTY_CASH") throw new Error("Cash counts are for cash and petty cash accounts");
  const date = startOfDay(input.countDate);
  const bookBalance = await glBalance(companyId, account.glAccountId, date);
  const { difference, lines } = buildCashCountLines({ cashAccountId: account.glAccountId, bookBalance, counted: roundMoney(input.counted), overShortAccountId: input.overShortAccountId });
  const number = await nextNumber(companyId, ...NUMBERING.CASH_COUNT);
  const description = input.description?.trim() || (difference === 0 ? `Cash count ${account.name}: agrees` : `Cash count ${account.name}: ${difference > 0 ? "over" : "short"} ${Math.abs(difference)}`);
  const txn = await prisma.bankTransaction.create({
    data: {
      companyId,
      number,
      kind: "CASH_COUNT",
      financialAccountId: account.id,
      transactionDate: date,
      amount: Math.abs(difference),
      countedAmount: roundMoney(input.counted),
      bookAmount: bookBalance,
      description,
      lines: difference === 0 ? undefined : [{ accountId: input.overShortAccountId, amount: Math.abs(difference), description: difference > 0 ? "Cash over" : "Cash short" }],
      createdByErpUserId: actor.erpUserId,
    },
  });
  if (lines.length) {
    try {
      const journal = await postBanking(
        companyId,
        { journalDate: date, description, referenceNumber: number, currencyCode: account.currency, sourceDocumentType: "BankTransaction", sourceDocumentId: txn.id, sourceDocumentNumber: number, lines },
        actor,
      );
      await prisma.bankTransaction.update({ where: { id: txn.id }, data: { journalId: journal.id } });
    } catch (e) {
      await prisma.bankTransaction.delete({ where: { id: txn.id } });
      throw e;
    }
  }
  await audit(companyId, actor, "POST", "BankTransaction", txn.id, { number, kind: "CASH_COUNT", counted: input.counted, bookBalance, difference });
  return getTransaction(companyId, txn.id);
}

export async function reverseTransaction(companyId: string, id: string, input: { reason: string; reversalDate?: string | Date }, actor: Actor = {}) {
  const txn = await prisma.bankTransaction.findFirst({ where: { id, companyId } });
  if (!txn) throw new Error("Transaction does not exist");
  if (txn.status === "REVERSED") throw new Error("Transaction is already reversed");
  if (!txn.journalId) throw new Error("This cash count posted nothing, so there is nothing to reverse");
  const reversalDate = startOfDay(input.reversalDate ?? new Date());
  if (reversalDate < txn.transactionDate) throw new Error("A reversal can't be dated before the transaction");
  const original = await prisma.journal.findFirstOrThrow({ where: { id: txn.journalId, companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
  const lines = reverseJournalLines(original.lines.map((l) => ({ accountId: l.accountId, debit: money(l.debit), credit: money(l.credit), description: l.description ?? undefined })));
  const journal = await postBanking(
    companyId,
    {
      journalDate: reversalDate,
      description: `Reverse ${txn.number}: ${input.reason}`,
      referenceNumber: txn.number,
      currencyCode: original.currencyCode,
      sourceDocumentType: "BankTransactionReversal",
      sourceDocumentId: txn.id,
      sourceDocumentNumber: txn.number,
      lines,
    },
    actor,
  );
  await prisma.bankTransaction.update({
    where: { id },
    data: { status: "REVERSED", reversalJournalId: journal.id, reversedAt: reversalDate, reversedByErpUserId: actor.erpUserId, reversalReason: input.reason },
  });
  await audit(companyId, actor, "REVERSE", "BankTransaction", id, { status: "REVERSED", reason: input.reason, journalId: journal.id }, { status: "POSTED" });
  return getTransaction(companyId, id);
}

type TxnWithAccounts = Prisma.BankTransactionGetPayload<{ include: { financialAccount: true; counterAccount: true } }>;

async function serializeTransactions(companyId: string, rows: TxnWithAccounts[]) {
  const journalIds = rows.flatMap((r) => [r.journalId, r.reversalJournalId]).filter((x): x is string => !!x);
  const journals = await prisma.journal.findMany({ where: { companyId, id: { in: journalIds } }, select: { id: true, journalNumber: true } });
  const accountIds = [...new Set(rows.flatMap((r) => ((r.lines as Array<{ accountId: string }> | null) ?? []).map((l) => l.accountId)))];
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: accountIds } }, select: { id: true, code: true, name: true } });
  const number = (id: string | null) => journals.find((j) => j.id === id)?.journalNumber ?? null;
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    transferType: r.transferType,
    financialAccountId: r.financialAccountId,
    financialAccountName: r.financialAccount.name,
    financialAccountKind: r.financialAccount.kind,
    counterAccountId: r.counterFinancialAccountId,
    counterAccountName: r.counterAccount?.name ?? null,
    transactionDate: r.transactionDate,
    amount: money(r.amount),
    fee: money(r.fee),
    method: r.method,
    reference: r.reference,
    chequeNumber: r.chequeNumber,
    partyType: r.partyType,
    partyName: r.partyName,
    description: r.description,
    countedAmount: r.countedAmount === null ? null : money(r.countedAmount),
    bookAmount: r.bookAmount === null ? null : money(r.bookAmount),
    lines: ((r.lines as Array<{ accountId: string; amount: number; description?: string | null }> | null) ?? []).map((l) => {
      const account = accounts.find((a) => a.id === l.accountId);
      return { accountId: l.accountId, accountCode: account?.code ?? null, accountName: account?.name ?? null, amount: l.amount, description: l.description ?? null };
    }),
    status: r.status,
    journalId: r.journalId,
    journalNumber: number(r.journalId),
    reversalJournalId: r.reversalJournalId,
    reversalJournalNumber: number(r.reversalJournalId),
    reversedAt: r.reversedAt,
    reversalReason: r.reversalReason,
    createdAt: r.createdAt,
  }));
}

export async function getTransaction(companyId: string, id: string) {
  const row = await prisma.bankTransaction.findFirst({ where: { id, companyId }, include: { financialAccount: true, counterAccount: true } });
  if (!row) throw new Error("Transaction does not exist");
  return (await serializeTransactions(companyId, [row]))[0];
}

export async function listTransactions(
  companyId: string,
  filter: { financialAccountId?: string; kind?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number } = {},
) {
  const kinds = filter.kind?.split(",").filter(Boolean) as BankTransactionKind[] | undefined;
  const where: Prisma.BankTransactionWhereInput = {
    companyId,
    ...(filter.financialAccountId ? { OR: [{ financialAccountId: filter.financialAccountId }, { counterFinancialAccountId: filter.financialAccountId }] } : {}),
    ...(kinds?.length ? { kind: { in: kinds } } : {}),
    ...(filter.from || filter.to ? { transactionDate: { ...(filter.from ? { gte: startOfDay(filter.from) } : {}), ...(filter.to ? { lte: endOfDay(filter.to) } : {}) } } : {}),
    ...(filter.q
      ? {
          AND: [
            {
              OR: [
                { number: { contains: filter.q, mode: "insensitive" } },
                { reference: { contains: filter.q, mode: "insensitive" } },
                { chequeNumber: { contains: filter.q, mode: "insensitive" } },
                { partyName: { contains: filter.q, mode: "insensitive" } },
                { description: { contains: filter.q, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
  };
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const [total, rows, sums] = await Promise.all([
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.findMany({ where, include: { financialAccount: true, counterAccount: true }, orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.bankTransaction.groupBy({ by: ["kind"], where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
  ]);
  const sum = (k: BankTransactionKind[]) => roundMoney(sums.filter((s) => k.includes(s.kind)).reduce((t, s) => t + money(s._sum.amount), 0));
  return {
    page,
    pageSize,
    total,
    totals: { received: sum(["RECEIPT", "INTEREST"]), paid: sum(["PAYMENT", "BANK_CHARGE"]), transferred: sum(["TRANSFER"]) },
    rows: await serializeTransactions(companyId, rows),
  };
}

/* ── Cashbook, dashboard, cash position ─────────────────────────────── */

export async function clearedEntryIds(entryIds: string[]) {
  if (!entryIds.length) return new Set<string>();
  const rows = await prisma.bankMatchEntry.findMany({ where: { glEntryId: { in: entryIds } }, select: { glEntryId: true } });
  return new Set(rows.map((r) => r.glEntryId));
}

export async function cashbook(companyId: string, financialAccountId: string, range: { from?: string; to?: string } = {}) {
  const account = await loadFinancialAccount(companyId, financialAccountId);
  const now = new Date();
  const to = range.to ? endOfDay(range.to) : endOfDay(now);
  const from = range.from ? startOfDay(range.from) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  if (from > to) throw new Error("The start date is after the end date");
  const opening = await glBalance(companyId, account.glAccountId, new Date(from.getTime() - 1));
  const entries = await prisma.glEntry.findMany({
    where: { companyId, accountId: account.glAccountId, transactionDate: { gte: from, lte: to } },
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
    take: 5000,
  });
  const txns = await prisma.bankTransaction.findMany({
    where: { companyId, OR: [{ journalId: { in: entries.map((e) => e.journalId) } }, { reversalJournalId: { in: entries.map((e) => e.journalId) } }] },
    select: { id: true, number: true, kind: true, journalId: true, reversalJournalId: true, partyName: true },
  });
  const cleared = await clearedEntryIds(entries.map((e) => e.id));
  let running = opening;
  let receipts = 0;
  let payments = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  const rows = entries.map((e) => {
    const debit = money(e.debit);
    const credit = money(e.credit);
    running = roundMoney(running + debit - credit);
    const txn = txns.find((t) => t.journalId === e.journalId || t.reversalJournalId === e.journalId);
    if (txn?.kind === "TRANSFER" && txn.journalId === e.journalId) {
      transfersIn += debit;
      transfersOut += credit;
    } else {
      receipts += debit;
      payments += credit;
    }
    return {
      id: e.id,
      date: e.transactionDate,
      journalId: e.journalId,
      journalNumber: e.journalNumber,
      reference: e.referenceNumber,
      description: e.description,
      sourceModule: e.sourceModule,
      sourceDocumentType: e.sourceDocumentType,
      transactionId: txn?.id ?? null,
      transactionNumber: txn?.number ?? null,
      transactionKind: txn?.kind ?? null,
      moneyIn: debit,
      moneyOut: credit,
      balance: running,
      cleared: cleared.has(e.id) || e.transactionDate < account.reconcileFrom,
    };
  });
  return {
    account: (await describeAccounts(companyId, [account]))[0],
    from: isoDay(from),
    to: isoDay(to),
    openingBalance: opening,
    receipts: roundMoney(receipts),
    payments: roundMoney(payments),
    transfersIn: roundMoney(transfersIn),
    transfersOut: roundMoney(transfersOut),
    closingBalance: running,
    rows,
  };
}

export async function bankingDashboard(companyId: string) {
  const accounts = await listFinancialAccounts(companyId);
  const glIds = accounts.map((a) => a.glAccountId);
  const today = startOfDay(new Date());
  const since = new Date(today.getTime() - 29 * DAY);
  const transferJournals = new Set(
    (await prisma.bankTransaction.findMany({ where: { companyId, kind: "TRANSFER", transactionDate: { gte: since } }, select: { journalId: true, reversalJournalId: true } }))
      .flatMap((t) => [t.journalId, t.reversalJournalId])
      .filter((x): x is string => !!x),
  );
  const recentEntries = glIds.length
    ? await prisma.glEntry.findMany({ where: { companyId, accountId: { in: glIds }, transactionDate: { gte: since } }, orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }] })
    : [];
  const flow = Array.from({ length: 30 }, (_, i) => ({ day: isoDay(new Date(since.getTime() + i * DAY)), moneyIn: 0, moneyOut: 0 }));
  for (const e of recentEntries) {
    if (transferJournals.has(e.journalId)) continue;
    const bucket = flow.find((f) => f.day === isoDay(e.transactionDate));
    if (!bucket) continue;
    bucket.moneyIn = roundMoney(bucket.moneyIn + money(e.debit));
    bucket.moneyOut = roundMoney(bucket.moneyOut + money(e.credit));
  }
  const todayFlow = flow[flow.length - 1];
  const byKind = (Object.keys(KIND_LABELS) as FinancialAccountKind[]).map((kind) => {
    const list = accounts.filter((a) => a.kind === kind);
    return { kind, count: list.length, balance: roundMoney(list.reduce((s, a) => s + a.balance, 0)) };
  });
  const defaults = await defaultsFor(companyId);
  const undepositedLinked = accounts.some((a) => a.glAccountId === defaults.undepositedFundsId);
  const pendingDeposits = defaults.undepositedFundsId && !undepositedLinked ? await glBalance(companyId, defaults.undepositedFundsId) : null;

  const bankLike = accounts.filter((a) => a.kind === "BANK" || a.kind === "MOBILE_MONEY");
  const uncleared = bankLike.length
    ? await prisma.glEntry.findMany({
        where: { companyId, OR: bankLike.map((a) => ({ accountId: a.glAccountId, transactionDate: { gte: a.reconcileFrom } })) },
        select: { id: true, debit: true, credit: true },
      })
    : [];
  const clearedIds = await clearedEntryIds(uncleared.map((e) => e.id));
  const open = uncleared.filter((e) => !clearedIds.has(e.id));
  const outstandingPayments = open.filter((e) => money(e.credit) > 0);
  const depositsInTransit = open.filter((e) => money(e.debit) > 0);

  const latest = glIds.length
    ? await prisma.glEntry.findMany({ where: { companyId, accountId: { in: glIds } }, orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }], take: 10 })
    : [];
  return {
    accounts,
    byKind,
    totalAvailable: roundMoney(accounts.reduce((s, a) => s + a.balance, 0)),
    receivedToday: todayFlow.moneyIn,
    paidToday: todayFlow.moneyOut,
    pendingDeposits,
    outstandingPayments: { count: outstandingPayments.length, amount: roundMoney(outstandingPayments.reduce((s, e) => s + money(e.credit), 0)) },
    depositsInTransit: { count: depositsInTransit.length, amount: roundMoney(depositsInTransit.reduce((s, e) => s + money(e.debit), 0)) },
    unmatchedStatementLines: accounts.reduce((s, a) => s + a.unmatchedStatementLines, 0),
    cashFlow: flow,
    recent: latest.map((e) => ({
      id: e.id,
      date: e.transactionDate,
      accountId: accounts.find((a) => a.glAccountId === e.accountId)?.id ?? null,
      accountName: accounts.find((a) => a.glAccountId === e.accountId)?.name ?? "",
      journalId: e.journalId,
      journalNumber: e.journalNumber,
      description: e.description,
      sourceModule: e.sourceModule,
      moneyIn: money(e.debit),
      moneyOut: money(e.credit),
    })),
  };
}

export async function cashPosition(companyId: string, asOf?: string) {
  const day = asOf ? startOfDay(asOf) : startOfDay(new Date());
  const accounts = await prisma.financialAccount.findMany({ where: { companyId }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  const rows: Array<{ id: string; kind: FinancialAccountKind; name: string; currency: string; isActive: boolean; opening: number; moneyIn: number; moneyOut: number; closing: number }> = [];
  for (const a of accounts) {
    const [opening, movement] = await Promise.all([
      glBalance(companyId, a.glAccountId, new Date(day.getTime() - 1)),
      prisma.glEntry.aggregate({ where: { companyId, accountId: a.glAccountId, transactionDate: { gte: day, lte: endOfDay(day) } }, _sum: { debit: true, credit: true } }),
    ]);
    const moneyIn = money(movement._sum.debit);
    const moneyOut = money(movement._sum.credit);
    if (!a.isActive && opening === 0 && moneyIn === 0 && moneyOut === 0) continue;
    rows.push({ id: a.id, kind: a.kind, name: a.name, currency: a.currency, isActive: a.isActive, opening, moneyIn, moneyOut, closing: roundMoney(opening + moneyIn - moneyOut) });
  }
  const total = (key: "opening" | "moneyIn" | "moneyOut" | "closing") => roundMoney(rows.reduce((s, r) => s + r[key], 0));
  return { asOf: isoDay(day), rows, totals: { opening: total("opening"), moneyIn: total("moneyIn"), moneyOut: total("moneyOut"), closing: total("closing") } };
}

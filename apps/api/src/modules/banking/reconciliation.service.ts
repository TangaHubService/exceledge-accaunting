import {
  assertMatchBalanced,
  autoMatchStatement,
  detectStatementFormat,
  parseStatement,
  reconciliationSummary,
  roundMoney,
  statementFingerprints,
  suggestStatementLineKind,
  type StatementDateOrder,
  type StatementFormat,
  type StatementLineKind,
} from "@exceledge/accounting-domain";
import type { FinancialAccount } from "@prisma/client";
import { defaultsFor, money, nextNumber } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { assertOpenPeriod } from "../journals/journal.service";
import { audit, endOfDay, glBalance, isoDay, loadFinancialAccount, makePayment, receiveMoney, startOfDay, type Actor } from "./banking.service";

const DAY = 86_400_000;

async function lastCompleted(companyId: string, financialAccountId: string) {
  return prisma.bankReconciliation.findFirst({ where: { companyId, financialAccountId, status: "COMPLETED" }, orderBy: { statementDate: "desc" } });
}

/* ── Statements ─────────────────────────────────────────────────────── */

type StatementUpload = { fileName: string; content: string; format?: StatementFormat; dateOrder?: StatementDateOrder };

async function prepareStatement(companyId: string, account: FinancialAccount, input: StatementUpload) {
  const format = input.format ?? detectStatementFormat(input.fileName, input.content);
  const parsed = parseStatement(input.content, format, input.dateOrder ?? "DMY");
  const fingerprints = statementFingerprints(parsed.lines);
  const existing = new Set(
    (await prisma.bankStatementLine.findMany({ where: { financialAccountId: account.id, fingerprint: { in: fingerprints } }, select: { fingerprint: true } })).map((r) => r.fingerprint),
  );
  const locked = await lastCompleted(companyId, account.id);
  const lines = parsed.lines.map((line, index) => {
    const status: "NEW" | "DUPLICATE" | "RECONCILED_PERIOD" | "BEFORE_START" = existing.has(fingerprints[index])
      ? "DUPLICATE"
      : locked && line.transactionDate <= isoDay(locked.statementDate)
        ? "RECONCILED_PERIOD"
        : line.transactionDate < isoDay(account.reconcileFrom)
          ? "BEFORE_START"
          : "NEW";
    return { ...line, fingerprint: fingerprints[index], status };
  });
  return { format, parsed, lines };
}

export async function previewStatement(companyId: string, financialAccountId: string, input: StatementUpload) {
  const account = await loadFinancialAccount(companyId, financialAccountId);
  const { format, parsed, lines } = await prepareStatement(companyId, account, input);
  return {
    format,
    errors: parsed.errors,
    openingBalance: parsed.openingBalance ?? null,
    closingBalance: parsed.closingBalance ?? null,
    periodStart: parsed.periodStart ?? null,
    periodEnd: parsed.periodEnd ?? null,
    lines: lines.map(({ fingerprint: _f, ...l }) => l),
    counts: {
      new: lines.filter((l) => l.status === "NEW").length,
      duplicate: lines.filter((l) => l.status === "DUPLICATE").length,
      reconciledPeriod: lines.filter((l) => l.status === "RECONCILED_PERIOD").length,
      beforeStart: lines.filter((l) => l.status === "BEFORE_START").length,
    },
  };
}

export async function importStatement(companyId: string, financialAccountId: string, input: StatementUpload, actor: Actor = {}) {
  const account = await loadFinancialAccount(companyId, financialAccountId, { active: true });
  const { format, parsed, lines } = await prepareStatement(companyId, account, input);
  const fresh = lines.filter((l) => l.status === "NEW");
  if (!parsed.lines.length) throw new Error(parsed.errors[0] ?? "The file has no transactions");
  if (!fresh.length) throw new Error("Every line in this file is already imported or falls in a reconciled period");
  const statement = await prisma.bankStatement.create({
    data: {
      companyId,
      financialAccountId: account.id,
      fileName: input.fileName,
      format,
      periodStart: parsed.periodStart ? startOfDay(parsed.periodStart) : undefined,
      periodEnd: parsed.periodEnd ? startOfDay(parsed.periodEnd) : undefined,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      lineCount: fresh.length,
      duplicateCount: lines.length - fresh.length,
      errorCount: parsed.errors.length,
      importedByErpUserId: actor.erpUserId,
      lines: {
        create: fresh.map((l, index) => ({
          companyId,
          financialAccountId: account.id,
          lineNumber: index + 1,
          transactionDate: startOfDay(l.transactionDate),
          valueDate: l.valueDate ? startOfDay(l.valueDate) : undefined,
          description: l.description.slice(0, 500),
          reference: l.reference?.slice(0, 120),
          chequeNumber: l.chequeNumber?.slice(0, 40),
          amount: l.amount,
          runningBalance: l.runningBalance,
          fingerprint: l.fingerprint,
        })),
      },
    },
  });
  await audit(companyId, actor, "IMPORT", "BankStatement", statement.id, { account: account.name, fileName: input.fileName, format, imported: fresh.length, skipped: lines.length - fresh.length, errors: parsed.errors.length });
  const matched = await autoMatch(companyId, account.id, actor);
  return { statementId: statement.id, imported: fresh.length, skipped: lines.length - fresh.length, errors: parsed.errors, autoMatched: matched.matched };
}

export async function listStatements(companyId: string, financialAccountId: string) {
  await loadFinancialAccount(companyId, financialAccountId);
  const statements = await prisma.bankStatement.findMany({ where: { companyId, financialAccountId }, orderBy: { createdAt: "desc" } });
  const matched = await prisma.bankStatementLine.groupBy({ by: ["statementId"], where: { statementId: { in: statements.map((s) => s.id) }, matchId: { not: null } }, _count: { _all: true } });
  return statements.map((s) => ({
    id: s.id,
    fileName: s.fileName,
    format: s.format,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    openingBalance: s.openingBalance === null ? null : money(s.openingBalance),
    closingBalance: s.closingBalance === null ? null : money(s.closingBalance),
    lineCount: s.lineCount,
    matchedCount: matched.find((m) => m.statementId === s.id)?._count._all ?? 0,
    duplicateCount: s.duplicateCount,
    errorCount: s.errorCount,
    importedAt: s.createdAt,
  }));
}

export async function deleteStatement(companyId: string, statementId: string, actor: Actor = {}) {
  const statement = await prisma.bankStatement.findFirst({ where: { id: statementId, companyId }, include: { lines: { select: { matchId: true } } } });
  if (!statement) throw new Error("Statement does not exist");
  const matchIds = [...new Set(statement.lines.map((l) => l.matchId).filter((x): x is string => !!x))];
  if (await prisma.bankMatch.count({ where: { id: { in: matchIds }, reconciliationId: { not: null } } })) {
    throw new Error("Lines from this statement are part of a completed reconciliation and can't be removed");
  }
  await prisma.$transaction([prisma.bankMatch.deleteMany({ where: { id: { in: matchIds } } }), prisma.bankStatement.delete({ where: { id: statementId } })]);
  await audit(companyId, actor, "DELETE", "BankStatement", statementId, null, { fileName: statement.fileName, lines: statement.lines.length });
  return { deleted: true };
}

/* ── Matching ───────────────────────────────────────────────────────── */

async function openBookEntries(companyId: string, account: FinancialAccount, until?: Date) {
  const entries = await prisma.glEntry.findMany({
    where: { companyId, accountId: account.glAccountId, transactionDate: { gte: account.reconcileFrom, ...(until ? { lte: endOfDay(until) } : {}) } },
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
  });
  const matched = new Set((await prisma.bankMatchEntry.findMany({ where: { glEntryId: { in: entries.map((e) => e.id) } }, select: { glEntryId: true } })).map((m) => m.glEntryId));
  const open = entries.filter((e) => !matched.has(e.id));
  const journals = await prisma.journal.findMany({ where: { companyId, id: { in: open.map((e) => e.journalId) } }, select: { id: true, sourceDocumentNumber: true, referenceNumber: true } });
  const txns = await prisma.bankTransaction.findMany({
    where: { companyId, journalId: { in: open.map((e) => e.journalId) } },
    select: { journalId: true, chequeNumber: true, reference: true, partyName: true },
  });
  return open.map((e) => {
    const journal = journals.find((j) => j.id === e.journalId);
    const txn = txns.find((t) => t.journalId === e.journalId);
    return {
      id: e.id,
      date: isoDay(e.transactionDate),
      amount: roundMoney(money(e.debit) - money(e.credit)),
      journalId: e.journalId,
      journalNumber: e.journalNumber,
      description: e.description,
      reference: e.referenceNumber,
      documentNumber: journal?.sourceDocumentNumber ?? null,
      chequeNumber: txn?.chequeNumber ?? null,
      partyName: txn?.partyName ?? null,
      sourceModule: e.sourceModule,
      references: [e.journalNumber, e.referenceNumber, journal?.sourceDocumentNumber, journal?.referenceNumber, txn?.chequeNumber, txn?.reference],
    };
  });
}

async function openStatementLines(companyId: string, account: FinancialAccount, until?: Date) {
  const lines = await prisma.bankStatementLine.findMany({
    where: { companyId, financialAccountId: account.id, matchId: null, ...(until ? { transactionDate: { lte: endOfDay(until) } } : {}) },
    orderBy: [{ transactionDate: "asc" }, { lineNumber: "asc" }],
  });
  return lines.map((l) => ({
    id: l.id,
    date: isoDay(l.transactionDate),
    valueDate: l.valueDate ? isoDay(l.valueDate) : null,
    amount: money(l.amount),
    description: l.description,
    reference: l.reference,
    chequeNumber: l.chequeNumber,
    runningBalance: l.runningBalance === null ? null : money(l.runningBalance),
    suggestedKind: suggestStatementLineKind(l.description, money(l.amount)),
  }));
}

async function createMatchRecord(
  companyId: string,
  account: FinancialAccount,
  input: { lineIds: string[]; entryIds: string[]; method: string },
  actor: Actor,
) {
  const lines = input.lineIds.length ? await prisma.bankStatementLine.findMany({ where: { id: { in: input.lineIds }, companyId, financialAccountId: account.id } }) : [];
  if (lines.length !== new Set(input.lineIds).size) throw new Error("One or more statement lines were not found on this account");
  if (lines.some((l) => l.matchId)) throw new Error("A statement line is already matched");
  const entries = input.entryIds.length ? await prisma.glEntry.findMany({ where: { id: { in: input.entryIds }, companyId, accountId: account.glAccountId } }) : [];
  if (entries.length !== new Set(input.entryIds).size) throw new Error("One or more book entries were not found on this account");
  if (entries.some((e) => e.transactionDate < account.reconcileFrom)) throw new Error("Entries before the reconcile-from date are already treated as cleared");
  if (await prisma.bankMatchEntry.count({ where: { glEntryId: { in: input.entryIds } } })) throw new Error("A book entry is already matched");
  const entryAmounts = entries.map((e) => roundMoney(money(e.debit) - money(e.credit)));
  assertMatchBalanced(
    lines.map((l) => money(l.amount)),
    entryAmounts,
  );
  const dates = lines.length ? lines.map((l) => l.transactionDate.getTime()) : entries.map((e) => e.transactionDate.getTime());
  return prisma.bankMatch.create({
    data: {
      companyId,
      financialAccountId: account.id,
      method: input.method,
      clearedDate: new Date(Math.max(...dates)),
      createdByErpUserId: actor.erpUserId,
      lines: { connect: lines.map((l) => ({ id: l.id })) },
      entries: { create: entries.map((e, i) => ({ glEntryId: e.id, amount: entryAmounts[i], entryDate: e.transactionDate })) },
    },
  });
}

export async function createMatch(companyId: string, financialAccountId: string, input: { lineIds: string[]; entryIds: string[] }, actor: Actor = {}) {
  const account = await loadFinancialAccount(companyId, financialAccountId);
  const match = await createMatchRecord(companyId, account, { ...input, method: "MANUAL" }, actor);
  await audit(companyId, actor, "MATCH", "BankMatch", match.id, { account: account.name, lines: input.lineIds.length, entries: input.entryIds.length });
  return { matchId: match.id };
}

export async function removeMatch(companyId: string, matchId: string, actor: Actor = {}) {
  const match = await prisma.bankMatch.findFirst({ where: { id: matchId, companyId }, include: { lines: true, entries: true } });
  if (!match) throw new Error("Match does not exist");
  if (match.reconciliationId) throw new Error("This match is part of a completed reconciliation");
  if (match.method === "OPENING") throw new Error("The opening balance is cleared by definition");
  await prisma.bankMatch.delete({ where: { id: matchId } });
  await audit(companyId, actor, "UNMATCH", "BankMatch", matchId, null, { method: match.method, lines: match.lines.length, entries: match.entries.length });
  return { removed: true };
}

export async function autoMatch(companyId: string, financialAccountId: string, actor: Actor = {}) {
  const account = await loadFinancialAccount(companyId, financialAccountId);
  const [lines, entries] = await Promise.all([openStatementLines(companyId, account), openBookEntries(companyId, account)]);
  const proposals = autoMatchStatement(lines, entries);
  for (const p of proposals) await createMatchRecord(companyId, account, { lineIds: [p.lineId], entryIds: [p.entryId], method: "AUTO" }, actor);
  if (proposals.length) await audit(companyId, actor, "AUTO_MATCH", "FinancialAccount", account.id, { matched: proposals.length });
  return { matched: proposals.length };
}

export async function matchingWorkspace(companyId: string, financialAccountId: string, filter: { until?: string } = {}) {
  const account = await loadFinancialAccount(companyId, financialAccountId);
  const until = filter.until ? startOfDay(filter.until) : undefined;
  const [lines, entries, matches] = await Promise.all([
    openStatementLines(companyId, account, until),
    openBookEntries(companyId, account, until),
    prisma.bankMatch.findMany({
      where: { companyId, financialAccountId: account.id, method: { not: "OPENING" } },
      include: { lines: true, entries: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const entryIds = matches.flatMap((m) => m.entries.map((e) => e.glEntryId));
  const glEntries = await prisma.glEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, journalId: true, journalNumber: true, description: true } });
  return {
    lines,
    entries: entries.map(({ references: _r, ...e }) => e),
    matches: matches.map((m) => ({
      id: m.id,
      method: m.method,
      clearedDate: m.clearedDate,
      locked: !!m.reconciliationId,
      createdAt: m.createdAt,
      lines: m.lines.map((l) => ({ id: l.id, date: l.transactionDate, description: l.description, reference: l.reference, amount: money(l.amount) })),
      entries: m.entries.map((e) => {
        const gl = glEntries.find((g) => g.id === e.glEntryId);
        return { id: e.glEntryId, date: e.entryDate, amount: money(e.amount), journalId: gl?.journalId ?? null, journalNumber: gl?.journalNumber ?? null, description: gl?.description ?? null };
      }),
    })),
  };
}

export async function suggestionsForLine(companyId: string, lineId: string) {
  const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, companyId } });
  if (!line) throw new Error("Statement line does not exist");
  const account = await loadFinancialAccount(companyId, line.financialAccountId);
  const entries = await openBookEntries(companyId, account);
  const amount = money(line.amount);
  const lineDay = line.transactionDate.getTime();
  return entries
    .filter((e) => Math.sign(e.amount) === Math.sign(amount))
    .map((e) => ({ ...e, difference: roundMoney(amount - e.amount), days: Math.round((lineDay - Date.parse(e.date)) / DAY) }))
    .sort((a, b) => Math.abs(a.difference) - Math.abs(b.difference) || Math.abs(a.days) - Math.abs(b.days))
    .slice(0, 8)
    .map(({ references: _r, ...e }) => e);
}

/** Records a bank-only line (charge, interest or other) as a banking transaction and matches it. */
export async function recordStatementLine(
  companyId: string,
  lineId: string,
  input: { kind?: StatementLineKind; accountId?: string; description?: string },
  actor: Actor = {},
) {
  const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, companyId } });
  if (!line) throw new Error("Statement line does not exist");
  if (line.matchId) throw new Error("This statement line is already matched");
  const account = await loadFinancialAccount(companyId, line.financialAccountId, { active: true });
  const amount = money(line.amount);
  const kind = input.kind ?? suggestStatementLineKind(line.description, amount);
  const defaults = await defaultsFor(companyId);
  const accountId = input.accountId ?? (kind === "BANK_CHARGE" ? defaults.bankChargesId : kind === "INTEREST" ? defaults.interestIncomeId : null);
  if (!accountId) throw new Error(kind === "OTHER" ? "Choose the account for this item" : `Map the ${kind === "BANK_CHARGE" ? "bank charges" : "interest income"} account in Company setup, or choose an account`);
  const common = {
    financialAccountId: account.id,
    transactionDate: line.transactionDate,
    lines: [{ accountId, amount: Math.abs(amount), description: input.description || line.description }],
    reference: line.reference ?? undefined,
    description: input.description || line.description,
    statementLineId: line.id,
    partyName: undefined,
  };
  const txn =
    amount > 0
      ? await receiveMoney(companyId, { ...common, kind: kind === "INTEREST" ? "INTEREST" : "RECEIPT" }, actor)
      : await makePayment(companyId, { ...common, kind: kind === "BANK_CHARGE" ? "BANK_CHARGE" : "PAYMENT", skipFundsCheck: true }, actor);
  const entry = await prisma.glEntry.findFirstOrThrow({ where: { companyId, journalId: txn.journalId!, accountId: account.glAccountId } });
  await createMatchRecord(companyId, account, { lineIds: [line.id], entryIds: [entry.id], method: "RECORDED" }, actor);
  return txn;
}

/* ── Reconciliation ─────────────────────────────────────────────────── */

async function workflowEnabled(companyId: string) {
  const controls = await prisma.approvalPostingControls.findUnique({ where: { companyId } });
  return controls?.approvalWorkflowEnabled ?? true;
}

export async function startReconciliation(
  companyId: string,
  input: { financialAccountId: string; statementDate: string; statementBalance: number; notes?: string },
  actor: Actor = {},
) {
  const account = await loadFinancialAccount(companyId, input.financialAccountId, { active: true });
  const statementDate = startOfDay(input.statementDate);
  const open = await prisma.bankReconciliation.findFirst({ where: { companyId, financialAccountId: account.id, status: { not: "COMPLETED" } } });
  if (open) throw new Error(`${open.number} is still open for this account`);
  const last = await lastCompleted(companyId, account.id);
  if (last && statementDate <= last.statementDate) throw new Error(`This account is reconciled to ${isoDay(last.statementDate)}; choose a later statement date`);
  if (statementDate < account.reconcileFrom) throw new Error(`Reconciliation for this account starts from ${isoDay(account.reconcileFrom)}`);
  const number = await nextNumber(companyId, "BANK_RECONCILIATION", "REC");
  const rec = await prisma.bankReconciliation.create({
    data: {
      companyId,
      financialAccountId: account.id,
      number,
      statementDate,
      statementBalance: roundMoney(input.statementBalance),
      notes: input.notes,
      preparedByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "BankReconciliation", rec.id, { number, account: account.name, statementDate: input.statementDate, statementBalance: input.statementBalance });
  return getReconciliation(companyId, rec.id);
}

export async function updateReconciliation(companyId: string, id: string, input: { statementBalance?: number; notes?: string }, actor: Actor = {}) {
  const rec = await prisma.bankReconciliation.findFirst({ where: { id, companyId } });
  if (!rec) throw new Error("Reconciliation does not exist");
  if (rec.status !== "DRAFT") throw new Error("Send the reconciliation back to draft before changing it");
  await prisma.bankReconciliation.update({ where: { id }, data: { statementBalance: input.statementBalance === undefined ? undefined : roundMoney(input.statementBalance), notes: input.notes } });
  await audit(companyId, actor, "UPDATE", "BankReconciliation", id, input, { statementBalance: money(rec.statementBalance), notes: rec.notes });
  return getReconciliation(companyId, id);
}

/** Works out the reconciliation position of an account at a statement date from matches, GL entries and statement lines. */
async function position(companyId: string, account: FinancialAccount, statementDate: Date, statementBalance: number) {
  const end = endOfDay(statementDate);
  const [entries, lines, bookBalance] = await Promise.all([
    prisma.glEntry.findMany({ where: { companyId, accountId: account.glAccountId, transactionDate: { gte: account.reconcileFrom, lte: end } }, orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }] }),
    prisma.bankStatementLine.findMany({ where: { companyId, financialAccountId: account.id, transactionDate: { gte: account.reconcileFrom, lte: end } }, orderBy: [{ transactionDate: "asc" }, { lineNumber: "asc" }] }),
    glBalance(companyId, account.glAccountId, statementDate),
  ]);
  const matchEntries = await prisma.bankMatchEntry.findMany({ where: { glEntryId: { in: entries.map((e) => e.id) } } });
  const matchIds = [...new Set([...matchEntries.map((m) => m.matchId), ...lines.map((l) => l.matchId).filter((x): x is string => !!x)])];
  const matches = await prisma.bankMatch.findMany({ where: { id: { in: matchIds } }, include: { lines: { select: { transactionDate: true } }, entries: { select: { entryDate: true } } } });
  const complete = new Set(matches.filter((m) => m.lines.every((l) => l.transactionDate <= end) && m.entries.every((e) => e.entryDate <= end)).map((m) => m.id));
  const entryMatch = new Map(matchEntries.map((m) => [m.glEntryId, m.matchId]));
  const outstanding = entries.filter((e) => !complete.has(entryMatch.get(e.id) ?? ""));
  const unrecorded = lines.filter((l) => !l.matchId || !complete.has(l.matchId));
  const journals = await prisma.journal.findMany({ where: { companyId, id: { in: outstanding.map((e) => e.journalId) } }, select: { id: true, sourceDocumentNumber: true } });
  const txns = await prisma.bankTransaction.findMany({ where: { companyId, journalId: { in: outstanding.map((e) => e.journalId) } }, select: { journalId: true, chequeNumber: true, partyName: true } });
  const outstandingRows = outstanding.map((e) => {
    const txn = txns.find((t) => t.journalId === e.journalId);
    return {
      id: e.id,
      date: isoDay(e.transactionDate),
      amount: roundMoney(money(e.debit) - money(e.credit)),
      journalId: e.journalId,
      journalNumber: e.journalNumber,
      documentNumber: journals.find((j) => j.id === e.journalId)?.sourceDocumentNumber ?? null,
      reference: e.referenceNumber,
      chequeNumber: txn?.chequeNumber ?? null,
      partyName: txn?.partyName ?? null,
      description: e.description,
      daysOutstanding: Math.max(0, Math.round((statementDate.getTime() - startOfDay(e.transactionDate).getTime()) / DAY)),
      matched: entryMatch.has(e.id),
    };
  });
  const unrecordedRows = unrecorded.map((l) => ({
    id: l.id,
    date: isoDay(l.transactionDate),
    amount: money(l.amount),
    description: l.description,
    reference: l.reference,
    chequeNumber: l.chequeNumber,
    kind: suggestStatementLineKind(l.description, money(l.amount)),
    matched: !!l.matchId,
  }));
  const summary = reconciliationSummary({ bookBalance, statementBalance, outstanding: outstandingRows, unrecorded: unrecordedRows });
  return {
    summary,
    outstanding: outstandingRows,
    unrecorded: unrecordedRows,
    completeMatchIds: [...complete],
    statementLineCount: lines.length,
    clearedEntryCount: entries.length - outstanding.length,
  };
}

async function reconciliationUsers(rec: { preparedByErpUserId: number | null; reviewedByErpUserId: number | null; approvedByErpUserId: number | null; completedByErpUserId: number | null }) {
  return {
    preparedBy: rec.preparedByErpUserId,
    reviewedBy: rec.reviewedByErpUserId,
    approvedBy: rec.approvedByErpUserId,
    completedBy: rec.completedByErpUserId,
  };
}

export async function getReconciliation(companyId: string, id: string) {
  const rec = await prisma.bankReconciliation.findFirst({ where: { id, companyId }, include: { financialAccount: true } });
  if (!rec) throw new Error("Reconciliation does not exist");
  const account = rec.financialAccount;
  const gl = await prisma.account.findUnique({ where: { id: account.glAccountId }, select: { code: true, name: true } });
  const previous = await prisma.bankReconciliation.findFirst({
    where: { companyId, financialAccountId: account.id, status: "COMPLETED", statementDate: { lt: rec.statementDate } },
    orderBy: { statementDate: "desc" },
  });
  const live = rec.status === "COMPLETED" && rec.summary ? null : await position(companyId, account, rec.statementDate, money(rec.statementBalance));
  const stored = (rec.summary ?? null) as Awaited<ReturnType<typeof position>> | null;
  const data = live ?? stored!;
  const statementLines = await prisma.bankStatementLine.count({ where: { companyId, financialAccountId: account.id } });
  const periodOpen = await assertOpenPeriod(companyId, rec.statementDate).then(
    () => true,
    () => false,
  );
  const checks = {
    statementImported: statementLines > 0,
    differenceZero: Math.abs(data.summary.difference) < 0.005,
    allLinesAccounted: data.unrecorded.length === 0,
    periodOpen,
  };
  return {
    id: rec.id,
    number: rec.number,
    status: rec.status,
    financialAccountId: account.id,
    accountName: account.name,
    accountKind: account.kind,
    accountNumber: account.accountNumber,
    bankName: account.bankName,
    currency: account.currency,
    glAccountCode: gl?.code ?? null,
    glAccountName: gl?.name ?? null,
    periodStart: previous ? isoDay(new Date(previous.statementDate.getTime() + DAY)) : isoDay(account.reconcileFrom),
    statementDate: isoDay(rec.statementDate),
    statementBalance: money(rec.statementBalance),
    notes: rec.notes,
    summary: data.summary,
    outstanding: data.outstanding,
    unrecorded: data.unrecorded,
    clearedEntryCount: data.clearedEntryCount,
    statementLineCount: data.statementLineCount,
    checks,
    ready: checks.statementImported && checks.differenceZero && checks.allLinesAccounted && checks.periodOpen,
    workflowEnabled: await workflowEnabled(companyId),
    ...(await reconciliationUsers(rec)),
    preparedAt: rec.preparedAt,
    reviewedAt: rec.reviewedAt,
    approvedAt: rec.approvedAt,
    completedAt: rec.completedAt,
  };
}

function assertReady(rec: Awaited<ReturnType<typeof getReconciliation>>) {
  if (!rec.checks.statementImported) throw new Error("Import a bank statement for this account first");
  if (!rec.checks.allLinesAccounted) throw new Error(`${rec.unrecorded.length} statement line(s) are not matched or recorded yet`);
  if (!rec.checks.differenceZero) throw new Error(`The reconciliation is out by ${rec.summary.difference}`);
  if (!rec.checks.periodOpen) throw new Error("The accounting period for the statement date is not open");
}

export async function reviewReconciliation(companyId: string, id: string, actor: Actor = {}) {
  const rec = await getReconciliation(companyId, id);
  if (rec.status !== "DRAFT") throw new Error("Only a draft reconciliation can be marked as reviewed");
  assertReady(rec);
  await prisma.bankReconciliation.update({ where: { id }, data: { status: "REVIEWED", reviewedByErpUserId: actor.erpUserId, reviewedAt: new Date(), bookBalance: rec.summary.bookBalance, difference: rec.summary.difference } });
  await audit(companyId, actor, "REVIEW", "BankReconciliation", id, { status: "REVIEWED" }, { status: "DRAFT" });
  return getReconciliation(companyId, id);
}

export async function approveReconciliation(companyId: string, id: string, actor: Actor = {}) {
  const rec = await getReconciliation(companyId, id);
  if (rec.status !== "REVIEWED") throw new Error("Only a reviewed reconciliation can be approved");
  if (rec.workflowEnabled && rec.preparedBy === actor.erpUserId) throw new Error("The person who prepared a reconciliation can't approve it");
  assertReady(rec);
  await prisma.bankReconciliation.update({ where: { id }, data: { status: "APPROVED", approvedByErpUserId: actor.erpUserId, approvedAt: new Date() } });
  await audit(companyId, actor, "APPROVE", "BankReconciliation", id, { status: "APPROVED" }, { status: "REVIEWED" });
  return getReconciliation(companyId, id);
}

export async function completeReconciliation(companyId: string, id: string, actor: Actor = {}) {
  const rec = await getReconciliation(companyId, id);
  if (rec.status === "COMPLETED") throw new Error("This reconciliation is already completed");
  if (rec.workflowEnabled && rec.status !== "APPROVED") throw new Error("The reconciliation must be reviewed and approved before it is completed");
  assertReady(rec);
  const account = await loadFinancialAccount(companyId, rec.financialAccountId);
  const snapshot = await position(companyId, account, startOfDay(rec.statementDate), rec.statementBalance);
  const now = new Date();
  await prisma.$transaction([
    prisma.bankMatch.updateMany({ where: { id: { in: snapshot.completeMatchIds }, reconciliationId: null }, data: { reconciliationId: id } }),
    prisma.bankReconciliation.update({
      where: { id },
      data: {
        status: "COMPLETED",
        bookBalance: snapshot.summary.bookBalance,
        difference: snapshot.summary.difference,
        summary: JSON.parse(JSON.stringify(snapshot)),
        reviewedByErpUserId: rec.reviewedBy ?? actor.erpUserId,
        reviewedAt: rec.reviewedAt ?? now,
        approvedByErpUserId: rec.approvedBy ?? actor.erpUserId,
        approvedAt: rec.approvedAt ?? now,
        completedByErpUserId: actor.erpUserId,
        completedAt: now,
      },
    }),
  ]);
  await audit(companyId, actor, "COMPLETE", "BankReconciliation", id, { status: "COMPLETED", statementBalance: rec.statementBalance, bookBalance: snapshot.summary.bookBalance, outstanding: snapshot.outstanding.length }, { status: rec.status });
  return getReconciliation(companyId, id);
}

export async function reopenReconciliation(companyId: string, id: string, actor: Actor = {}) {
  const rec = await prisma.bankReconciliation.findFirst({ where: { id, companyId } });
  if (!rec) throw new Error("Reconciliation does not exist");
  if (rec.status === "COMPLETED") throw new Error("A completed reconciliation can't be reopened");
  if (rec.status === "DRAFT") throw new Error("The reconciliation is already a draft");
  await prisma.bankReconciliation.update({ where: { id }, data: { status: "DRAFT", reviewedByErpUserId: null, reviewedAt: null, approvedByErpUserId: null, approvedAt: null } });
  await audit(companyId, actor, "REOPEN", "BankReconciliation", id, { status: "DRAFT" }, { status: rec.status });
  return getReconciliation(companyId, id);
}

export async function discardReconciliation(companyId: string, id: string, actor: Actor = {}) {
  const rec = await prisma.bankReconciliation.findFirst({ where: { id, companyId } });
  if (!rec) throw new Error("Reconciliation does not exist");
  if (rec.status === "COMPLETED") throw new Error("Completed reconciliations can't be deleted");
  await prisma.bankReconciliation.delete({ where: { id } });
  await audit(companyId, actor, "DELETE", "BankReconciliation", id, null, { number: rec.number, status: rec.status });
  return { deleted: true };
}

export async function reconciliationOverview(companyId: string) {
  const accounts = await prisma.financialAccount.findMany({ where: { companyId, kind: { in: ["BANK", "MOBILE_MONEY"] } }, orderBy: { name: "asc" } });
  const history = await prisma.bankReconciliation.findMany({ where: { companyId }, include: { financialAccount: { select: { name: true } } }, orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }], take: 200 });
  const rows = [];
  for (const a of accounts) {
    const last = history.find((r) => r.financialAccountId === a.id && r.status === "COMPLETED");
    const open = history.find((r) => r.financialAccountId === a.id && r.status !== "COMPLETED");
    const latestLine = await prisma.bankStatementLine.findFirst({ where: { companyId, financialAccountId: a.id }, orderBy: [{ transactionDate: "desc" }, { lineNumber: "desc" }] });
    const latestStatement = await prisma.bankStatement.findFirst({ where: { companyId, financialAccountId: a.id }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }] });
    const unmatched = await prisma.bankStatementLine.count({ where: { companyId, financialAccountId: a.id, matchId: null } });
    rows.push({
      id: a.id,
      name: a.name,
      kind: a.kind,
      isActive: a.isActive,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      bookBalance: await glBalance(companyId, a.glAccountId),
      lastStatementDate: latestLine ? isoDay(latestLine.transactionDate) : null,
      lastStatementBalance:
        latestStatement?.closingBalance !== null && latestStatement?.closingBalance !== undefined
          ? money(latestStatement.closingBalance)
          : latestLine?.runningBalance !== null && latestLine?.runningBalance !== undefined
            ? money(latestLine.runningBalance)
            : null,
      unmatchedLines: unmatched,
      lastReconciledTo: last ? isoDay(last.statementDate) : null,
      lastReconciledBalance: last ? money(last.statementBalance) : null,
      openReconciliation: open ? { id: open.id, number: open.number, status: open.status, statementDate: isoDay(open.statementDate), difference: open.difference === null ? null : money(open.difference) } : null,
    });
  }
  return {
    accounts: rows,
    history: history.map((r) => ({
      id: r.id,
      number: r.number,
      accountId: r.financialAccountId,
      accountName: r.financialAccount.name,
      statementDate: isoDay(r.statementDate),
      statementBalance: money(r.statementBalance),
      bookBalance: r.bookBalance === null ? null : money(r.bookBalance),
      status: r.status,
      outstandingCount: r.summary ? ((r.summary as { outstanding?: unknown[] }).outstanding?.length ?? 0) : null,
      preparedBy: r.preparedByErpUserId,
      approvedBy: r.approvedByErpUserId,
      completedAt: r.completedAt,
      preparedAt: r.preparedAt,
    })),
  };
}

/** Closing balance the statement shows at a date: the running balance of the last line on or before it. */
export async function statementBalanceAt(companyId: string, financialAccountId: string, date: string) {
  const end = endOfDay(date);
  const line = await prisma.bankStatementLine.findFirst({
    where: { companyId, financialAccountId, transactionDate: { lte: end }, runningBalance: { not: null } },
    orderBy: [{ transactionDate: "desc" }, { lineNumber: "desc" }],
  });
  const statement = await prisma.bankStatement.findFirst({ where: { companyId, financialAccountId, periodEnd: startOfDay(date), closingBalance: { not: null } }, orderBy: { createdAt: "desc" } });
  if (statement?.closingBalance) return { balance: money(statement.closingBalance), source: "STATEMENT" as const };
  if (line?.runningBalance !== null && line?.runningBalance !== undefined) return { balance: money(line.runningBalance), source: "LINE" as const, lineDate: isoDay(line.transactionDate) };
  return { balance: null, source: null };
}

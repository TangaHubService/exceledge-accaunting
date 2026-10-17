import { createHash, randomBytes } from "crypto";
import {
  aggregateTrialBalance,
  comparativeTrialBalance,
  assertEliminationBalanced,
  consolidateTrialBalances,
  dimensionProfitAndLoss,
  esgIntensity,
  money4,
  naturalBalance,
  nextCronTime,
  nextRecurringDate,
  parseCron,
  revaluationDelta,
  trialBalanceTotals,
  type BookAccountType,
  type TrialBalanceMode,
} from "@exceledge/accounting-domain";
import { withJobLock } from "../../lib/job-lock";
import type { ApiKeyScope } from "../../middleware/auth";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal, createJournal } from "../journals/journal.service";
import { notify } from "../notifications/notification.service";
import { scanAnomalies } from "./insights.service";
import { dimWhere, periodStatements, trialBalanceColumns, type Dims, type StatementOptions } from "./reports.service";

type Actor = { erpUserId?: number; erpRole?: string };

function asType(type: string): BookAccountType {
  return type as BookAccountType;
}

export async function movements(companyId: string, opts: { to?: Date; from?: Date; dims?: Dims } = {}) {
  const entries = await prisma.glEntry.findMany({
    where: {
      companyId,
      ...dimWhere(opts.dims),
      ...(opts.from || opts.to
        ? {
            transactionDate: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: { account: true, journal: true },
  });
  return entries.map((e) => ({
    accountId: e.accountId,
    code: e.account.code,
    name: e.account.name,
    type: asType(e.account.type),
    debit: Number(e.debit),
    credit: Number(e.credit),
    journalType: e.journal.journalType,
    costCentre: e.costCentre ?? e.journal.costCentre,
    project: e.project ?? e.journal.project,
    branchId: e.branchId ?? e.journal.branchId,
    postingDate: e.transactionDate,
    journalId: e.journalId,
    amount: Number(e.debit) + Number(e.credit),
  }));
}

export async function getTrialBalance(
  companyId: string,
  opts: { mode?: TrialBalanceMode | "COLUMNS"; asOf?: Date; compareAsOf?: Date; from?: Date; dims?: Dims } = {},
) {
  if (opts.mode === "COLUMNS") return trialBalanceColumns(companyId, { from: opts.from, to: opts.asOf, dims: opts.dims });
  const mode = opts.mode ?? "STANDARD";
  const current = aggregateTrialBalance(await movements(companyId, { to: opts.asOf, dims: opts.dims }), mode);
  if (mode !== "COMPARATIVE") {
    const totals = current.reduce(
      (s, r) => ({ debit: money4(s.debit + r.debit), credit: money4(s.credit + r.credit) }),
      { debit: 0, credit: 0 },
    );
    return { mode, rows: current, ...totals, difference: money4(totals.debit - totals.credit) };
  }
  const prior = aggregateTrialBalance(await movements(companyId, { to: opts.compareAsOf, dims: opts.dims }), "STANDARD");
  const rows = comparativeTrialBalance(current, prior);
  return { mode, rows, ...trialBalanceTotals(rows) };
}

export async function getStatements(companyId: string, asOf?: Date, opts: Omit<StatementOptions, "to"> = {}) {
  return periodStatements(companyId, { ...opts, to: asOf });
}

async function periodOrThrow(companyId: string, periodId: string) {
  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, financialYear: { companyId } },
    include: { financialYear: true },
  });
  if (!period) throw new Error("Accounting period not found");
  return period;
}

export async function listPeriods(companyId: string) {
  return prisma.financialYear.findMany({
    where: { companyId },
    include: { periods: { orderBy: { sequence: "asc" } } },
    orderBy: { startDate: "desc" },
  });
}

export async function lockPeriod(companyId: string, periodId: string, locked: boolean, actor: Actor = {}) {
  const period = await periodOrThrow(companyId, periodId);
  if (locked && !["FUTURE", "OPEN", "REOPENED"].includes(period.status)) {
    throw new Error(`A ${period.status.toLowerCase()} period cannot be locked`);
  }
  if (!locked && period.status !== "TEMPORARILY_LOCKED") throw new Error("Only a locked period can be unlocked");
  const status = locked ? "TEMPORARILY_LOCKED" : "OPEN";
  const moved = await prisma.accountingPeriod.updateMany({ where: { id: periodId, status: period.status }, data: { status } });
  if (!moved.count) throw new Error("The period changed a moment ago; refresh and try again");
  if (actor.erpUserId) {
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId,
      erpRole: actor.erpRole,
      action: locked ? "LOCK_PERIOD" : "UNLOCK_PERIOD",
      entityType: "AccountingPeriod",
      entityId: periodId,
      beforeJson: { status: period.status },
      afterJson: { status },
    });
  }
  return { id: periodId, status };
}

export async function setTransactionLockDate(companyId: string, financialYearId: string, lockDate: Date | null, actor: Actor = {}) {
  const year = await prisma.financialYear.findFirst({ where: { id: financialYearId, companyId } });
  if (!year) throw new Error("Financial year not found");
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (lockDate && (day(lockDate) < day(year.startDate) || day(lockDate) > day(year.endDate))) {
    throw new Error("The lock date must fall inside the financial year");
  }
  const updated = await prisma.financialYear.update({ where: { id: year.id }, data: { transactionLockDate: lockDate } });
  if (actor.erpUserId) {
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId,
      erpRole: actor.erpRole,
      action: "SET_LOCK_DATE",
      entityType: "FinancialYear",
      entityId: year.id,
      beforeJson: { transactionLockDate: year.transactionLockDate },
      afterJson: { transactionLockDate: lockDate },
    });
  }
  return updated;
}

export async function listRecurring(companyId: string) {
  return prisma.recurringJournal.findMany({ where: { companyId }, include: { lines: { orderBy: { lineNumber: "asc" } } }, orderBy: { name: "asc" } });
}

export async function createRecurring(
  companyId: string,
  input: {
    name: string;
    description?: string;
    frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
    nextRunDate: string;
    autoPost?: boolean;
    lines: Array<{ accountId: string; debit: number; credit: number; description?: string }>;
  },
  actor: Actor = {},
) {
  if (input.lines.length < 2) throw new Error("A recurring journal needs at least two lines");
  const debit = money4(input.lines.reduce((s, l) => s + l.debit, 0));
  const credit = money4(input.lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debit - credit) > 0.0001) throw new Error("Recurring journal does not balance");
  const row = await prisma.recurringJournal.create({
    data: {
      companyId,
      name: input.name,
      description: input.description,
      frequency: input.frequency,
      nextRunDate: new Date(input.nextRunDate),
      autoPost: input.autoPost ?? false,
      createdByErpUserId: actor.erpUserId,
      lines: { create: input.lines.map((l, i) => ({ lineNumber: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })) },
    },
    include: { lines: true },
  });
  await auditBooks(companyId, actor, "CREATE", "RecurringJournal", row.id, { name: row.name, frequency: row.frequency, autoPost: row.autoPost, total: debit });
  return row;
}

export async function runRecurring(companyId: string, asOf = new Date(), actor: Actor = {}) {
  const result = await withJobLock(`recurring:${companyId}`, 5 * 60_000, () => runDueRecurring(companyId, asOf, actor), { renew: true });
  if (!result) throw new Error("Recurring journals are already being run for this company");
  return result;
}

async function runDueRecurring(companyId: string, asOf: Date, actor: Actor) {
  const due = await prisma.recurringJournal.findMany({
    where: { companyId, isActive: true, nextRunDate: { lte: asOf } },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  const created: string[] = [];
  const failed: Array<{ templateId: string; name: string; error: string }> = [];
  for (const template of due) {
    if (template.endDate && template.nextRunDate > template.endDate) {
      await prisma.recurringJournal.update({ where: { id: template.id }, data: { isActive: false } });
      continue;
    }
    try {
      const journalId = await inTransaction(async () => {
        const input = {
          journalDate: template.nextRunDate,
          description: template.description || template.name,
          sourceModule: "RECURRING",
          sourceDocumentType: "RECURRING_JOURNAL",
          sourceDocumentId: template.id,
          lines: template.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), description: l.description ?? undefined })),
        };
        const journal = template.autoPost
          ? await createAndPostJournal(companyId, input, actor)
          : await createJournal(companyId, input, actor);
        const nextRunDate = new Date(nextRecurringDate(template.nextRunDate, template.frequency));
        const advanced = await prisma.recurringJournal.updateMany({
          where: { id: template.id, nextRunDate: template.nextRunDate },
          data: { nextRunDate, isActive: !template.endDate || nextRunDate <= template.endDate },
        });
        if (!advanced.count) throw new Error("This occurrence was already generated by another run");
        return journal.id;
      });
      created.push(journalId);
    } catch (e) {
      const error = (e as Error).message;
      failed.push({ templateId: template.id, name: template.name, error });
      await notify({ companyId, title: "Recurring journal failed", body: `${template.name}: ${error}`, severity: "WARNING", entityType: "RecurringJournal", entityId: template.id });
    }
  }
  return { generated: created.length, journalIds: created, failed };
}

export async function listRates(companyId: string) {
  return prisma.exchangeRate.findMany({ where: { companyId }, orderBy: { rateDate: "desc" } });
}

export async function saveRate(companyId: string, input: { currency: string; rateDate: string; rate: number; source?: string }, actor: Actor = {}) {
  const rateDate = new Date(input.rateDate);
  const where = { companyId_currency_rateDate: { companyId, currency: input.currency.toUpperCase(), rateDate } };
  const before = await prisma.exchangeRate.findUnique({ where });
  const row = await prisma.exchangeRate.upsert({
    where,
    create: { companyId, currency: input.currency.toUpperCase(), rateDate, rate: input.rate, source: input.source },
    update: { rate: input.rate, source: input.source },
  });
  await auditBooks(companyId, actor, before ? "UPDATE" : "CREATE", "ExchangeRate", row.id, { currency: row.currency, rateDate, rate: input.rate }, before && { rate: Number(before.rate) });
  return row;
}

async function fxResultAccounts(companyId: string) {
  const [settings, defaults] = await Promise.all([
    prisma.currencySettings.findUnique({ where: { companyId } }),
    prisma.defaultPostingAccounts.findUnique({ where: { companyId } }),
  ]);
  const pick = async (ids: Array<string | null | undefined>, code: string) => {
    const id = ids.find(Boolean);
    return id ? prisma.account.findFirst({ where: { id, companyId } }) : prisma.account.findFirst({ where: { companyId, code } });
  };
  const gain = await pick([settings?.fxGainAccountId, defaults?.fxGainId], "4300");
  const loss = await pick([settings?.fxLossAccountId, defaults?.fxLossId], "6500");
  if (!gain || !loss) throw new Error("Set FX gain and loss accounts in currency settings before revaluing");
  return { gain, loss, functional: settings?.functionalCurrency ?? "RWF" };
}

/**
 * Restates accounts kept in `currency` at the closing rate. The foreign balance is the sum of
 * the foreign amounts posted to each account; the book value is its functional balance.
 */
export async function revalueCurrency(companyId: string, currency: string, actor: Actor = {}, asOf = new Date()) {
  const code = currency.toUpperCase();
  const result = await withJobLock(`fx-revalue:${companyId}:${code}`, 5 * 60_000, () => revalue(companyId, code, actor, asOf), { renew: true });
  if (!result) throw new Error(`A ${code} revaluation is already running for this company; try again when it finishes`);
  return result;
}

async function revalue(companyId: string, code: string, actor: Actor, asOf: Date) {
  const { gain: gainAccount, loss: lossAccount, functional } = await fxResultAccounts(companyId);
  if (code === functional) return { currency: code, gainLoss: 0, journalId: null, skipped: "Functional currency is not revalued" };
  const rate = await prisma.exchangeRate.findFirst({
    where: { companyId, currency: code, rateDate: { lte: asOf } },
    orderBy: { rateDate: "desc" },
  });
  if (!rate) throw new Error(`No ${code} exchange rate is on file on or before ${asOf.toISOString().slice(0, 10)}`);
  const accounts = await prisma.account.findMany({ where: { companyId, currency: code, isActive: true } });
  const withoutForeign = await prisma.journalLine.findMany({
    where: {
      companyId,
      accountId: { in: accounts.map((a) => a.id) },
      amountForeign: null,
      journal: { status: { in: ["POSTED", "REVERSED"] }, OR: [{ sourceModule: null }, { sourceModule: { not: "FX" } }] },
    },
    distinct: ["accountId"],
    select: { account: { select: { code: true } } },
  });
  if (withoutForeign.length) {
    const codes = withoutForeign.map((l) => l.account.code).join(", ");
    throw new Error(`Account(s) ${codes} have postings without a ${code} amount; revaluing them would write off their balance`);
  }
  const postedLines = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      accountId: { in: accounts.map((a) => a.id) },
      journal: { status: { in: ["POSTED", "REVERSED"] }, journalDate: { lte: rate.rateDate } },
    },
    _sum: { debit: true, credit: true, amountForeign: true },
  });
  let gain = 0;
  const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
  for (const account of accounts) {
    const sums = postedLines.find((p) => p.accountId === account.id)?._sum;
    const delta = revaluationDelta({
      foreignBalance: Number(sums?.amountForeign ?? 0),
      bookFunctional: money4(Number(sums?.debit ?? 0) - Number(sums?.credit ?? 0)),
      closingRate: Number(rate.rate),
    });
    if (Math.abs(delta) < 0.0001) continue;
    gain = money4(gain + delta);
    if (delta > 0) lines.push({ accountId: account.id, description: `Revalue ${code}`, debit: delta, credit: 0 });
    else lines.push({ accountId: account.id, description: `Revalue ${code}`, debit: 0, credit: money4(-delta) });
  }
  if (!lines.length) {
    await prisma.fxRevaluation.create({
      data: { companyId, currency: code, rateDate: rate.rateDate, closingRate: rate.rate, gainLoss: 0, createdByErpUserId: actor.erpUserId },
    });
    return { currency: code, gainLoss: 0, journalId: null };
  }
  if (gain > 0) lines.push({ accountId: gainAccount.id, description: `Unrealized FX gain ${code}`, debit: 0, credit: gain });
  else if (gain < 0) lines.push({ accountId: lossAccount.id, description: `Unrealized FX loss ${code}`, debit: money4(-gain), credit: 0 });
  return inTransaction(async () => {
    const journal = await createAndPostJournal(
      companyId,
      { journalDate: rate.rateDate, journalType: "ADJUSTMENT", description: `FX revaluation ${code} at ${Number(rate.rate)}`, sourceModule: "FX", lines },
      actor,
    );
    return prisma.fxRevaluation.create({
      data: { companyId, currency: code, rateDate: rate.rateDate, closingRate: rate.rate, gainLoss: gain, journalId: journal.id, createdByErpUserId: actor.erpUserId },
    });
  });
}

export async function listDimensions(companyId: string) {
  return prisma.dimension.findMany({ where: { companyId }, orderBy: [{ kind: "asc" }, { code: "asc" }] });
}

export async function createDimension(companyId: string, input: { kind: "COST_CENTRE" | "PROJECT"; code: string; name: string }, actor: Actor = {}) {
  const code = input.code.trim();
  if (await prisma.dimension.count({ where: { companyId, kind: input.kind, code } })) throw new Error(`${input.kind === "PROJECT" ? "Project" : "Cost centre"} ${code} already exists`);
  const row = await prisma.dimension.create({ data: { companyId, kind: input.kind, code, name: input.name } });
  await auditBooks(companyId, actor, "CREATE", "Dimension", row.id, { kind: row.kind, code: row.code, name: row.name });
  return row;
}

export async function updateDimension(companyId: string, id: string, input: { name?: string; isActive?: boolean }, actor: Actor = {}) {
  const before = await prisma.dimension.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Dimension not found");
  const row = await prisma.dimension.update({ where: { id }, data: { name: input.name ?? before.name, isActive: input.isActive ?? before.isActive } });
  await auditBooks(companyId, actor, "UPDATE", "Dimension", id, { name: row.name, isActive: row.isActive }, { name: before.name, isActive: before.isActive });
  return row;
}

/** Profit and loss per cost centre, project or branch, from posted ledger lines. */
export async function dimensionReport(companyId: string, kind: "COST_CENTRE" | "PROJECT" | "BRANCH" = "COST_CENTRE", range: { from?: Date; to?: Date } = {}) {
  const lines = await movements(companyId, range);
  const pick = (l: (typeof lines)[number]) => (kind === "PROJECT" ? l.project : kind === "BRANCH" ? l.branchId : l.costCentre);
  const rows = dimensionProfitAndLoss(lines.map((l) => ({ key: pick(l) || "Unassigned", type: l.type, debit: l.debit, credit: l.credit })));
  const names = new Map<string, string>();
  if (kind === "BRANCH") {
    for (const b of await prisma.companyBranch.findMany({ where: { companyId } })) {
      const name = b.name ?? b.code ?? b.externalErpBranchId;
      names.set(b.id, name);
      names.set(b.externalErpBranchId, name);
    }
  } else {
    for (const d of await prisma.dimension.findMany({ where: { companyId, kind } })) names.set(d.code, d.name);
  }
  return rows.map((r) => ({ ...r, name: names.get(r.key) ?? (r.key === "Unassigned" ? "Unassigned" : r.key) }));
}

export async function saveControl(
  companyId: string,
  input: { code: string; title: string; category: string; status?: "OPEN" | "EFFECTIVE" | "DEFICIENT"; notes?: string },
  actor: Actor = {},
) {
  const before = await prisma.controlItem.findUnique({ where: { companyId_code: { companyId, code: input.code } } });
  const row = await prisma.controlItem.upsert({
    where: { companyId_code: { companyId, code: input.code } },
    create: { companyId, code: input.code, title: input.title, category: input.category, status: input.status ?? "OPEN", notes: input.notes },
    update: { title: input.title, category: input.category, status: input.status ?? "OPEN", notes: input.notes },
  });
  await auditBooks(companyId, actor, before ? "UPDATE" : "CREATE", "ControlItem", row.id, { code: row.code, status: row.status, title: row.title }, before && { status: before.status, title: before.title });
  return row;
}

async function auditBooks(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType, entityId, beforeJson: beforeJson ?? undefined, afterJson });
}

export async function listDocuments(companyId: string, entityType?: string, entityId?: string) {
  return prisma.accountingDocument.findMany({
    where: { companyId, ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function addDocument(
  companyId: string,
  input: { entityType: string; entityId: string; fileName: string; note?: string; contentText?: string },
  actor: Actor = {},
) {
  const row = await prisma.accountingDocument.create({
    data: { companyId, ...input, createdByErpUserId: actor.erpUserId },
  });
  await auditBooks(companyId, actor, "ATTACH_DOCUMENT", input.entityType, input.entityId, { documentId: row.id, fileName: row.fileName });
  return row;
}

export async function importJournalCsv(companyId: string, csv: string, journalDate: string, actor: Actor = {}) {
  const accounts = await prisma.account.findMany({ where: { companyId } });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const lines: Array<{ accountId: string; debit: number; credit: number; description?: string }> = [];
  const errors: string[] = [];
  csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.toLowerCase().startsWith("account"))
    .forEach((line, idx) => {
      const [code, debit, credit, description] = line.split(",").map((p) => p.trim());
      const account = byCode.get(code);
      if (!account) {
        errors.push(`Line ${idx + 1}: unknown account ${code}`);
        return;
      }
      lines.push({ accountId: account.id, debit: Number(debit) || 0, credit: Number(credit) || 0, description });
    });
  if (!errors.length && lines.length < 2) errors.push("A journal needs at least two lines");
  if (errors.length) {
    const batch = await prisma.importBatch.create({
      data: { companyId, kind: "JOURNAL", status: "FAILED", rowCount: lines.length, errorCount: errors.length, summaryJson: { errors }, createdByErpUserId: actor.erpUserId },
    });
    await auditBooks(companyId, actor, "IMPORT_FAILED", "ImportBatch", batch.id, { kind: "JOURNAL", errors: errors.length });
    return { batch, journal: null };
  }
  return inTransaction(async () => {
    const journal = await createJournal(companyId, { journalDate, description: "Imported journal", sourceModule: "IMPORT", lines }, actor);
    const batch = await prisma.importBatch.create({
      data: { companyId, kind: "JOURNAL", status: "IMPORTED", rowCount: lines.length, errorCount: 0, summaryJson: { journalId: journal.id }, createdByErpUserId: actor.erpUserId },
    });
    await auditBooks(companyId, actor, "IMPORT", "ImportBatch", batch.id, { kind: "JOURNAL", journalId: journal.id, rows: lines.length });
    return { batch, journal };
  });
}

/** Accounting companies for the ERP organizations a user belongs to. */
export async function companiesForOrganizations(organizationIds: number[]) {
  if (!organizationIds.length) return [];
  const rows = await prisma.company.findMany({
    where: { externalErpOrganizationId: { in: organizationIds.map(String) } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function assertMembersAllowed(members: Array<{ name: string; companyId: string | null }>, allowedCompanyIds: string[]) {
  for (const m of members) {
    if (!m.companyId) throw new Error(`Group member ${m.name} is not linked to a company`);
    if (!allowedCompanyIds.includes(m.companyId)) throw new Error(`You do not have access to the books of ${m.name}`);
  }
}

export async function listGroups(companyId: string) {
  return prisma.companyGroup.findMany({
    where: { ownerCompanyId: companyId },
    include: { members: true, eliminations: { include: { lines: { orderBy: { lineNumber: "asc" } } } } },
  });
}

export async function createGroup(
  companyId: string,
  input: { name: string; members: Array<{ name: string; companyId?: string; ownershipPercent?: number }> },
  allowedCompanyIds: string[],
  actor: Actor = {},
) {
  const members = input.members.map((m) => ({ name: m.name, companyId: m.companyId ?? companyId, ownershipPercent: m.ownershipPercent ?? 100 }));
  assertMembersAllowed(members, allowedCompanyIds);
  if (new Set(members.map((m) => m.companyId)).size !== members.length) throw new Error("A company can only be in a group once");
  const row = await prisma.companyGroup.create({
    data: { ownerCompanyId: companyId, name: input.name, members: { create: members } },
    include: { members: true },
  });
  await auditBooks(companyId, actor, "CREATE", "CompanyGroup", row.id, { name: row.name, members });
  return row;
}

export async function addElimination(
  companyId: string,
  groupId: string,
  input: { description: string; lines: Array<{ accountCode: string; debit: number; credit: number }> },
  actor: Actor = {},
) {
  const group = await prisma.companyGroup.findFirst({ where: { id: groupId, ownerCompanyId: companyId }, include: { members: true } });
  if (!group) throw new Error("Group not found");
  assertEliminationBalanced(input.lines.map((l) => ({ code: l.accountCode, debit: l.debit, credit: l.credit })));
  const memberIds = group.members.map((m) => m.companyId).filter((id): id is string => Boolean(id));
  for (const code of new Set(input.lines.map((l) => l.accountCode))) {
    if (!(await prisma.account.count({ where: { companyId: { in: memberIds }, code } }))) {
      throw new Error(`No company in ${group.name} has account ${code}`);
    }
  }
  const row = await prisma.elimination.create({
    data: {
      companyId,
      groupId,
      description: input.description,
      debit: money4(input.lines.reduce((s, l) => s + l.debit, 0)),
      credit: money4(input.lines.reduce((s, l) => s + l.credit, 0)),
      lines: { create: input.lines.map((l, i) => ({ lineNumber: i + 1, accountCode: l.accountCode, debit: l.debit, credit: l.credit })) },
    },
    include: { lines: true },
  });
  await auditBooks(companyId, actor, "CREATE", "Elimination", row.id, { groupId, description: row.description, lines: input.lines });
  return row;
}

export async function consolidateGroup(companyId: string, groupId: string, allowedCompanyIds: string[], asOf?: Date) {
  const group = await prisma.companyGroup.findFirst({
    where: { id: groupId, ownerCompanyId: companyId },
    include: { members: true, eliminations: { include: { lines: { orderBy: { lineNumber: "asc" } } } } },
  });
  if (!group) throw new Error("Group not found");
  assertMembersAllowed(group.members, allowedCompanyIds);
  const members = [];
  for (const member of group.members) {
    const rows = aggregateTrialBalance(await movements(member.companyId!, { to: asOf }), "STANDARD");
    members.push({ name: member.name, ownershipPercent: Number(member.ownershipPercent), rows });
  }
  const applied = group.eliminations.filter((e) => e.lines.length > 0);
  const result = consolidateTrialBalances(
    members,
    applied.map((e) => ({
      description: e.description,
      lines: e.lines.map((l) => ({ code: l.accountCode, debit: Number(l.debit), credit: Number(l.credit) })),
    })),
  );
  return {
    ...result,
    asOf: asOf ?? null,
    ignoredEliminations: group.eliminations.filter((e) => !e.lines.length).map((e) => ({ id: e.id, description: e.description })),
  };
}

export async function listEsg(companyId: string) {
  const rows = await prisma.esgMeasure.findMany({ where: { companyId }, orderBy: { period: "desc" } });
  const statements = await getStatements(companyId);
  return rows.map((r) => ({ ...r, value: Number(r.value), intensity: esgIntensity(Number(r.value), statements.income.totalRevenue) }));
}

export async function saveEsg(companyId: string, input: { period: string; code: string; name: string; value: number; unit: string }, actor: Actor = {}) {
  const where = { companyId_period_code: { companyId, period: input.period, code: input.code } };
  const before = await prisma.esgMeasure.findUnique({ where });
  const row = await prisma.esgMeasure.upsert({
    where,
    create: { companyId, ...input },
    update: { name: input.name, value: input.value, unit: input.unit },
  });
  await auditBooks(companyId, actor, before ? "UPDATE" : "CREATE", "EsgMeasure", row.id, input, before && { value: Number(before.value), unit: before.unit });
  return row;
}

export async function listWorkflows(companyId: string) {
  return prisma.workflowTemplate.findMany({
    where: { companyId },
    include: { instances: { include: { steps: { orderBy: { stepIndex: "asc" } } } } },
  });
}

export async function createWorkflow(companyId: string, input: { name: string; steps: string[] }, actor: Actor = {}) {
  if (input.steps.length < 1) throw new Error("A workflow needs at least one step");
  const row = await prisma.workflowTemplate.create({ data: { companyId, name: input.name, stepsJson: input.steps } });
  await auditBooks(companyId, actor, "CREATE", "WorkflowTemplate", row.id, input);
  return row;
}

export async function startWorkflow(companyId: string, templateId: string, entityType: string, entityId: string, actor: Actor = {}) {
  const template = await prisma.workflowTemplate.findFirst({ where: { id: templateId, companyId, isActive: true } });
  if (!template) throw new Error("Workflow not found");
  const row = await prisma.workflowInstance.create({ data: { companyId, templateId, entityType, entityId } });
  await auditBooks(companyId, actor, "START_WORKFLOW", "WorkflowInstance", row.id, { templateId, entityType, entityId });
  return row;
}

/** Completes the current step. One person cannot complete two steps in a row. */
export async function advanceWorkflow(companyId: string, instanceId: string, actor: Actor = {}) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  return inTransaction(async () => {
    const instance = await prisma.workflowInstance.findFirst({
      where: { id: instanceId, companyId },
      include: { template: true, steps: { orderBy: { stepIndex: "desc" }, take: 1 } },
    });
    if (!instance) throw new Error("Workflow instance not found");
    if (instance.status === "COMPLETED") throw new Error("This workflow is already complete");
    const previous = instance.steps[0];
    if (previous && previous.erpUserId === actor.erpUserId) {
      throw new Error(`You completed "${previous.stepName}"; someone else must complete the next step`);
    }
    const steps = instance.template.stepsJson as string[];
    const stepName = steps[instance.stepIndex] ?? `Step ${instance.stepIndex + 1}`;
    await prisma.workflowStepLog.create({
      data: { instanceId, stepIndex: instance.stepIndex, stepName, erpUserId: actor.erpUserId!, erpRole: actor.erpRole },
    });
    const next = instance.stepIndex + 1;
    const done = next >= steps.length;
    const updated = await prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { stepIndex: done ? steps.length - 1 : next, status: done ? "COMPLETED" : "IN_PROGRESS" },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
    await auditBooks(companyId, actor, "COMPLETE_WORKFLOW_STEP", "WorkflowInstance", instanceId, { step: stepName, status: updated.status });
    return updated;
  });
}

export async function issueApiKey(
  companyId: string,
  input: { name: string; scopes?: ApiKeyScope[]; expiresAt?: Date; rateLimitPerMinute?: number },
  actor: Actor = {},
) {
  const scopes = [...new Set(input.scopes?.length ? input.scopes : (["report:view"] as ApiKeyScope[]))];
  if (input.expiresAt && input.expiresAt <= new Date()) throw new Error("The expiry date must be in the future");
  const rateLimitPerMinute = checkRateLimit(input.rateLimitPerMinute ?? 120);
  const token = randomBytes(24).toString("hex");
  const prefix = token.slice(0, 8);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await prisma.apiCredential.create({
    data: { companyId, name: input.name, prefix, tokenHash, scopes, expiresAt: input.expiresAt, rateLimitPerMinute, createdByErpUserId: actor.erpUserId },
  });
  await auditBooks(companyId, actor, "ISSUE_API_KEY", "ApiCredential", row.id, { name: row.name, prefix, scopes, expiresAt: row.expiresAt, rateLimitPerMinute });
  return { id: row.id, name: row.name, prefix, token, scopes, expiresAt: row.expiresAt, rateLimitPerMinute, createdAt: row.createdAt };
}

function checkRateLimit(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 6000) throw new Error("The rate limit must be a whole number from 1 to 6000 requests per minute");
  return value;
}

export async function listApiKeys(companyId: string, now = new Date()) {
  const [keys, counts] = await Promise.all([
    prisma.apiCredential.findMany({
      where: { companyId },
      select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, rateLimitPerMinute: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.apiKeyUsage.groupBy({ by: ["credentialId"], where: { companyId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, _count: { _all: true } }),
  ]);
  const last24h = new Map(counts.map((c) => [c.credentialId, c._count._all]));
  return keys.map((k) => ({ ...k, requestsLast24h: last24h.get(k.id) ?? 0 }));
}

export async function setApiKeyRateLimit(companyId: string, id: string, rateLimitPerMinute: number, actor: Actor = {}) {
  const row = await prisma.apiCredential.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("API key not found");
  const updated = await prisma.apiCredential.update({ where: { id }, data: { rateLimitPerMinute: checkRateLimit(rateLimitPerMinute) } });
  await auditBooks(companyId, actor, "UPDATE", "ApiCredential", id, { rateLimitPerMinute }, { rateLimitPerMinute: row.rateLimitPerMinute });
  return { id, rateLimitPerMinute: updated.rateLimitPerMinute };
}

/** Recent calls made with a key, newest first, with totals by status for the last 24 hours. */
export async function apiKeyUsage(companyId: string, id: string, limit = 100, now = new Date()) {
  const key = await prisma.apiCredential.findFirst({ where: { id, companyId }, select: { id: true, name: true, prefix: true, rateLimitPerMinute: true } });
  if (!key) throw new Error("API key not found");
  const [calls, byStatus] = await Promise.all([
    prisma.apiKeyUsage.findMany({ where: { credentialId: id }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 500) }),
    prisma.apiKeyUsage.groupBy({ by: ["status"], where: { credentialId: id, createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, _count: { _all: true } }),
  ]);
  return {
    key,
    calls: calls.map(({ id: callId, method, path, status, ipAddress, createdAt }) => ({ id: callId, method, path, status, ipAddress, createdAt })),
    last24h: byStatus.map((s) => ({ status: s.status, count: s._count._all })).sort((a, b) => (a.status ?? 0) - (b.status ?? 0)),
  };
}

/** Removes API key usage older than `days` days. */
export async function purgeApiKeyUsage(now = new Date(), days = 90) {
  const { count } = await prisma.apiKeyUsage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - days * 86_400_000) } } });
  return count;
}

export async function revokeApiKey(companyId: string, id: string, actor: Actor = {}) {
  const row = await prisma.apiCredential.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("API key not found");
  if (row.revokedAt) return row;
  const revoked = await prisma.apiCredential.update({ where: { id }, data: { revokedAt: new Date() } });
  await auditBooks(companyId, actor, "REVOKE_API_KEY", "ApiCredential", id, { revokedAt: revoked.revokedAt });
  return revoked;
}

/** Default jobs every activated company should have; only created when missing. */
export const DEFAULT_AUTOMATION = [{ name: "Daily anomaly scan", jobType: "ANOMALY_SCAN", schedule: "0 2 * * *" }] as const;

export async function ensureDefaultAutomation(companyId: string) {
  const existing = await prisma.automationJob.findMany({ where: { companyId }, select: { jobType: true } });
  const have = new Set(existing.map((j) => j.jobType));
  const created = [];
  for (const job of DEFAULT_AUTOMATION) {
    if (have.has(job.jobType)) continue;
    created.push(await prisma.automationJob.create({ data: { companyId, ...job } }));
  }
  return created;
}

export async function listAutomation(companyId: string) {
  await ensureDefaultAutomation(companyId);
  return prisma.automationJob.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createAutomation(companyId: string, input: { name: string; jobType: string; schedule: string }, actor: Actor = {}) {
  const schedule = input.schedule.trim().replace(/\s+/g, " ");
  if (!nextCronTime(parseCron(schedule), new Date())) throw new Error("This schedule never runs");
  const row = await prisma.automationJob.create({ data: { companyId, name: input.name, jobType: input.jobType, schedule } });
  await auditBooks(companyId, actor, "CREATE", "AutomationJob", row.id, { name: row.name, jobType: row.jobType, schedule });
  return row;
}

/** True when the job's schedule has a run time between its last run (or creation) and `now`. */
export function automationDue(job: { schedule: string; lastRunAt: Date | null; createdAt: Date }, now: Date) {
  try {
    const next = nextCronTime(job.schedule, job.lastRunAt ?? job.createdAt);
    return next !== null && next <= now;
  } catch {
    return false;
  }
}

export async function runAutomation(companyId: string, id: string, actor: Actor = {}) {
  const job = await prisma.automationJob.findFirst({ where: { id, companyId, enabled: true } });
  if (!job) throw new Error("Automation job not found");
  let detail: unknown = null;
  try {
    if (job.jobType === "RECURRING_JOURNALS") detail = await runRecurring(companyId, new Date(), actor);
    else if (job.jobType === "ANOMALY_SCAN") detail = await scanAnomalies(companyId, actor);
    else if (job.jobType === "FX_REVALUE") {
      const rates = await prisma.exchangeRate.findMany({ where: { companyId }, distinct: ["currency"] });
      detail = [];
      for (const rate of rates) (detail as unknown[]).push(await revalueCurrency(companyId, rate.currency, actor));
    } else throw new Error(`Unknown job type ${job.jobType}`);
    await prisma.automationJob.update({ where: { id }, data: { lastRunAt: new Date(), lastStatus: "OK" } });
    await auditBooks(companyId, actor, "RUN", "AutomationJob", id, { jobType: job.jobType, status: "OK" });
    return { status: "OK", detail };
  } catch (e) {
    await prisma.automationJob.update({ where: { id }, data: { lastRunAt: new Date(), lastStatus: "FAILED" } });
    throw e;
  }
}
